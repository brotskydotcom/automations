/*
 * Copyright 2024-2025 Daniel C. Brotsky. All rights reserved.
 * All the copyrighted work in this repository is licensed under the
 * open source MIT License, reproduced in the LICENSE file.
 */

// Global definitions
import { base, input } from "../library/airtable.internal";

// noinspection SpellCheckingInspection
const masterNamedFieldMap = {
    canonicalPhone: "fld4lEBvUftT8MoGs", // E.164 Phone Number
    formattedPhone: "fld1CNjHs3PRuqCok", // Phone
    conflicts: "fldcohpR70JZIqqEl", // Additional General Inquiry Submission Info
    infoLinks: "fldjfWfWjsv40TKAw", // General Inquiry Form
    multiLink: "fldEVYjKOxyLSYJZF", // Has Duplicates?
    initialDate: "fldNXsbL7u6kLJ0xB", // Submission Date
    link: "fldnBfsb2vLkvNtoM", // General Info Link
    linkId: "fldXwcQ5eeBHMsN4K", // General Info Link ID
};

// noinspection SpellCheckingInspection
const formNamedFieldMap = {
    phone: "fldtEKncXLHsuOkzl", // Phone Number
    masterLink: "fld9ghCK30RWk5Aqj", // Contact
    createdDate: "fldv8RwffC8hEMfDX", // Created
};

// noinspection SpellCheckingInspection
const stringFieldMap = {
    // map from field IDs in General Inquiry Form table to All Contacts table
    fldrgAOfCe3Axxprk: "fldGF8G0cEoxqKgrd", // Full Name -> Name
    fldLqNQKwzU9W07l2: "fldG8MGdqTySJhHJ4", // Preferred Name -> Preferred Name
    fldPXPC6kjOgxgJku: "fldli2SXrunrRmRap", // Email -> Email
    fldeFK3Gkz0E9rfSA: "fldpgAXOS3LnRVb4B", // City -> City
    fldYqCvfEE7epiqqH: "fldAKnzpM4C78B68g", // Zip Code -> Zip Code
    fldK8W2ZczRKOlnV0: "fldp6DqsrrskD9Kwc", // Preferred Language - Other -> Preferred Language (Other)
    fldUM9r7ZpETOnXYt: "flddEBS3pVsatT6Zh", // A Number -> A Number
    fldJKQPw75j2HzPLN: "fldwaD4ycbdumuQpv", // Country of Origin -> Country of Origin
    fldW3vEpJ2R7RnfFE: "fldXCH3uVyuqLEzJY", // Assistance/Request -> Service Request Information
};

// noinspection SpellCheckingInspection
const singleChoiceFieldMap = {
    // map from field IDs in General Inquiry Form table to All Contacts table
    fldbL2M482evbXy1C: "fldfeDUc7AwkLAcxn", // Preferred Language -> Preferred Language
    fldcMicusItnPJAld: "fld0q3mP5U6GRA1uT", // State -> State
    fldnBRerNM3AvLNmr: "fld3SiQOVVKjHrw9n", // Do you identify as LGBTQ+? -> LGBTQ+?
};

// noinspection SpellCheckingInspection
const multiChoiceFieldMap = {
    // map from field IDs in General Inquiry Form table to All Contacts table
    fldUYF8hIEBLdfLaH: "fldRrH5d7z3uTxdQD", // Pronouns -> Pronouns
};

// noinspection SpellCheckingInspection
const attachmentFieldMap = {
    // map from field IDs in General Inquiry Form table to All Contacts table
    fldmI6bv1pJgyr0ki: "fldtWTfL7aLfTjMLd", // Documents -> Documents Provided
};

const fieldMap = {
    ...stringFieldMap,
    ...singleChoiceFieldMap,
    ...multiChoiceFieldMap,
    ...attachmentFieldMap,
};

// Script invocation (as automation)
// noinspection SpellCheckingInspection
const formTable = base.getTable("tblYKtj0Hhl6e5Wti"); // General Inquiry Form Table
// noinspection SpellCheckingInspection
const masterTable = base.getTable("tblsnJnJ4ubpZFLwq"); // All Contacts Master Table
const { formRecordId } = input.config();
const formRecord = await formTable.selectRecordAsync(formRecordId);
if (!formRecord) {
    throw new Error(`No general inquiry form record exists for ID ${formRecordId}`);
}
const { masterRecordId, e164Phone } = await extractMatchData();
await newGeneralInfoRecordAction();

async function extractMatchData() {
    const masterLinks = formRecord.getCellValue(formNamedFieldMap.masterLink) || [];
    const masterRecordId = masterLinks.length ? masterLinks[0].id : null;
    const e164Phone = canonicalizePhone(formRecord.getCellValueAsString(formNamedFieldMap.phone));
    // console.log(JSON.stringify({ masterRecordId, e164Phone }, null, 2))
    return { masterRecordId, e164Phone };
}

async function newGeneralInfoRecordAction() {
    // if this form refers to a specific record, update that one
    if (masterRecordId) {
        let masterRecord = await masterTable.selectRecordAsync(masterRecordId);
        if (!masterRecord) {
            throw new Error(`Form refers to master record ${masterRecordId}, but it doesn't exist`);
        }
        const hook = "https://hook.us1.make.com/8gu8l8h6jxnnbh5tejhmptfrfeuypppy";
        const linkId = masterRecord.getCellValue(masterNamedFieldMap.linkId);
        if (linkId) {
            await triggerLinkUpdate(hook, masterRecordId, linkId);
        } else {
            console.warn(
                `Form refers to master record ${masterRecordId}, but it has no link to update`
            );
        }
        await updateExistingMasterRecords([masterRecord]);
        return;
    }
    // find all the master record phone numbers
    let result = await masterTable.selectRecordsAsync({
        fields: [masterNamedFieldMap.canonicalPhone],
    });
    const matching = result.records.filter(
        (r) => r.getCellValue(masterNamedFieldMap.canonicalPhone) === e164Phone
    );
    if (matching.length === 0) {
        console.log(`No master record has phone number ${e164Phone}; creating one`);
        await makeNewMasterRecord();
    } else if (matching.length === 1) {
        console.log(`One master record has phone number ${e164Phone}; updating it`);
        let masterRecord = await masterTable.selectRecordAsync(matching[0].id);
        await updateExistingMasterRecords([masterRecord]);
    } else if (matching.length > 100) {
        throw new Error(`Over 100 master records have phone number ${e164Phone}`);
    } else {
        console.log(
            `${matching.length} master records have phone number ${e164Phone}, updating them all`
        );
        // we need to fetch just those fields we are going to read as part of the merge
        let masterFetchFields = [
            masterNamedFieldMap.infoLinks,
            masterNamedFieldMap.conflicts,
            masterNamedFieldMap.canonicalPhone,
            ...Object.entries(fieldMap).map((pair) => pair[1]),
        ];
        const result = await masterTable.selectRecordsAsync({
            recordIds: matching.map((r) => r.id),
            fields: masterFetchFields,
        });
        const records = result.records;
        await updateExistingMasterRecords(records);
        await markMasterRecordsAsDuplicates(masterTable, records);
    }
}

async function makeNewMasterRecord() {
    // a form has been submitted against this record
    const masterFields = { [masterNamedFieldMap.link]: "Submitted" };
    for (let [srcKey, targetKey] of Object.entries(stringFieldMap)) {
        masterFields[targetKey] = formRecord.getCellValueAsString(srcKey);
    }
    for (let [srcKey, targetKey] of Object.entries(singleChoiceFieldMap)) {
        const val = formRecord.getCellValueAsString(srcKey);
        if (val) {
            masterFields[targetKey] = { name: val };
        }
    }
    for (let [srcKey, targetKey] of Object.entries(multiChoiceFieldMap)) {
        const val = formRecord.getCellValue(srcKey) || [];
        if (val.length) {
            masterFields[targetKey] = val.map((v) => ({ name: v.name }));
        }
    }
    for (let [srcKey, targetKey] of Object.entries(attachmentFieldMap)) {
        const val = formRecord.getCellValue(srcKey) || [];
        if (val.length) {
            // console.log(`Sending attachments value: ${JSON.stringify(val, null, 2)}`)
            masterFields[targetKey] = val;
        }
    }
    masterFields[masterNamedFieldMap.infoLinks] = [{ id: formRecordId }];
    masterFields[masterNamedFieldMap.canonicalPhone] = e164Phone;
    masterFields[masterNamedFieldMap.formattedPhone] = formatPhone(e164Phone);
    masterFields[masterNamedFieldMap.initialDate] = formRecord.getCellValue(
        formNamedFieldMap.createdDate
    );
    console.log(JSON.stringify(masterFields, null, 2));
    await masterTable.createRecordAsync(masterFields);
}

async function updateExistingMasterRecords(masterRecords) {
    const updates = [];
    for (const masterRecord of masterRecords) {
        // a form has been submitted against this record
        const masterFields = { [masterNamedFieldMap.link]: "Submitted" };
        let links = masterRecord.getCellValue(masterNamedFieldMap.infoLinks) || [];
        links = links.map((l) => ({ id: l.id }));
        if (links.map((l) => l.id).includes(formRecordId)) {
            console.log(`Master record ${masterRecord.id} already linked to this form`);
        } else {
            console.log(`Adding form link to master record ${masterRecord.id}`);
            links.push({ id: formRecordId });
            masterFields[masterNamedFieldMap.infoLinks] = links;
        }
        let conflicts = "";
        // special logic for the phone number, because it's been canonicalized
        const masterCanonicalPhone = masterRecord.getCellValueAsString(
            masterNamedFieldMap.canonicalPhone
        );
        if (masterCanonicalPhone === e164Phone) {
        } else if (!masterCanonicalPhone) {
            masterFields[masterNamedFieldMap.canonicalPhone] = e164Phone;
            masterFields[masterNamedFieldMap.formattedPhone] = formatPhone(e164Phone);
        } else {
            const fieldName = masterTable.getField(masterNamedFieldMap.canonicalPhone).name;
            conflicts += `\t${fieldName}: ${e164Phone}\n`;
        }
        // standard logic for every other matching field, specific to the field type
        for (let [srcKey, targetKey] of Object.entries(stringFieldMap)) {
            const master = masterRecord.getCellValueAsString(targetKey);
            const form = formRecord.getCellValueAsString(srcKey);
            if (!form || master === form) {
            } else if (!master) {
                masterFields[targetKey] = form;
            } else {
                const fieldName = masterTable.getField(targetKey).name;
                conflicts += `\t${fieldName}: ${form.replace(/\n/g, " ")}\n`;
            }
        }
        for (let [srcKey, targetKey] of Object.entries(singleChoiceFieldMap)) {
            const master = masterRecord.getCellValueAsString(targetKey);
            const form = formRecord.getCellValueAsString(srcKey);
            if (!form || master === form) {
            } else if (!master) {
                masterFields[targetKey] = { name: form };
            } else {
                const fieldName = masterTable.getField(targetKey).name;
                conflicts += `\t${fieldName}: ${form}\n`;
            }
        }
        for (let [srcKey, targetKey] of Object.entries(multiChoiceFieldMap)) {
            const master = masterRecord.getCellValue(targetKey) || [];
            const masterVals = master
                .map((v) => v.name)
                .sort()
                .join("|");
            const form = formRecord.getCellValue(srcKey) || [];
            const formVals = form
                .map((v) => v.name)
                .sort()
                .join("|");
            if (!formVals || masterVals === formVals) {
            } else if (!master.length) {
                masterFields[targetKey] = form.map((v) => ({ name: v.name }));
            } else {
                const fieldName = masterTable.getField(targetKey).name;
                const val = form.map((v) => v.name).join(", ");
                conflicts += `\t${fieldName}: ${val}\n`;
            }
        }
        for (let [srcKey, targetKey] of Object.entries(attachmentFieldMap)) {
            const master = masterRecord.getCellValue(targetKey) || [];
            const form = formRecord.getCellValue(srcKey) || [];
            if (form.length) {
                // console.log(`Sending attachments value: ${JSON.stringify(form, null, 2)}`)
                masterFields[targetKey] = [...master, ...form];
            }
        }
        if (conflicts) {
            const master = masterRecord.getCellValueAsString(masterNamedFieldMap.conflicts);
            const date = new Date(formRecord.getCellValue(formNamedFieldMap.createdDate));
            const timestamp = date.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
            const header = `Additional general inquiry data submitted ${timestamp}:`;
            masterFields[masterNamedFieldMap.conflicts] = `${header}\n${conflicts}\n${master}`;
        }
        updates.push({ id: masterRecord.id, fields: masterFields });
    }
    for (let i = 0; i < updates.length; i += 50) {
        const end = Math.min(updates.length, i + 50);
        await masterTable.updateRecordsAsync(updates.slice(i, end));
    }
}

async function markMasterRecordsAsDuplicates(masterTable, masterRecords) {
    const updates = masterRecords.map((r) => ({
        id: r.id,
        fields: { [masterNamedFieldMap.multiLink]: true },
    }));
    console.log(JSON.stringify(updates, null, 2));
    for (let i = 0; i < updates.length; i += 50) {
        const end = Math.min(updates.length, i + 50);
        await masterTable.updateRecordsAsync(updates.slice(i, end));
    }
}

// takes a phone in E.164 format and formats it for display
function formatPhone(phone) {
    const twoDigitCountryCodes = [
        "20",
        "27",
        "30",
        "31",
        "32",
        "33",
        "34",
        "36",
        "39",
        "40",
        "41",
        "43",
        "44",
        "45",
        "46",
        "47",
        "48",
        "49",
        "51",
        "52",
        "53",
        "54",
        "55",
        "56",
        "57",
        "58",
        "60",
        "61",
        "62",
        "63",
        "64",
        "65",
        "66",
        "70",
        "71",
        "72",
        "73",
        "74",
        "75",
        "76",
        "77",
        "78",
        "79",
        "81",
        "82",
        "84",
        "86",
        "87",
        "88",
        "90",
        "91",
        "92",
        "93",
        "94",
        "95",
        "98",
    ];
    if (phone.startsWith("+1")) {
        // Zone 1
        if (phone.length < 12) {
            return "invalid";
        }
        const part1 = `(${phone.substring(2, 5)}) ${phone.substring(5, 8)}-${phone.substring(8, 12)}`;
        if (phone.length === 12) {
            return part1;
        } else {
            return part1 + " x" + phone.substring(12);
        }
    }
    // international
    let prefix = phone.substring(0, 3);
    let suffix = phone.substring(3);
    if (!twoDigitCountryCodes.includes(phone.substring(1, 3))) {
        prefix = phone.substring(0, 4);
        suffix = phone.substring(4);
    }
    let suffixSuffix = "";
    if (suffix.length % 3 === 1) {
        // put the last four numbers together
        suffixSuffix = "-" + suffix.substring(suffix.length - 4);
        suffix = suffix.substring(0, suffix.length - 4);
    }
    for (let i = suffix.length; i > 3; i = i - 3) {
        suffix = suffix.substring(0, i - 3) + "-" + suffix.substring(i - 3);
    }
    return prefix + "-" + suffix + suffixSuffix;
}

// takes a flexibly formatted number that starts with '+' and strips non-digits
function canonicalizePhone(phone) {
    if (!phone.startsWith("+")) {
        throw new Error(`Form phone number '${phone}' is invalid.`);
    }
    let digits = phone.replace(/\D/g, "");
    return "+" + digits;
}

async function triggerLinkUpdate(hook, recordId, linkId) {
    console.log(`Requesting reset of link '${linkId}' from record ${recordId}...`);
    const response = await fetch(hook, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            recordId: recordId,
            shortLinkId: linkId,
        }),
    }).catch((error) => {
        console.error("Error sending request to make:", error);
    });
    if (response) {
        console.log(`Response code from make is ${response.status}`);
    }
}
