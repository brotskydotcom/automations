/*
 * Copyright 2024-2025 Daniel C. Brotsky. All rights reserved.
 * All the copyrighted work in this repository is licensed under the
 * open source MIT License, reproduced in the LICENSE file.
 */

const inputs = input.config();
await newDialpadRecordAction(base, inputs.recordId, inputs.contactPhone);

async function newDialpadRecordAction(base, recordId, phoneNumber) {
    const masterTable = base.getTable("tblsnJnJ4ubpZFLwq"); // All Contacts Master Table
    let result = await masterTable.selectRecordsAsync({
        fields: [
            "fld4lEBvUftT8MoGs", // E.164 Number
            "flden5oBfu9Gniz2P", // Dialpad Contacts from Person
        ],
        sorts: [{ field: "fldA1vt9a0BtASfib", direction: "asc" }], // Created date
    });
    const matching = result.records.filter((r) =>
        r.getCellValueAsString("fld4lEBvUftT8MoGs").includes(phoneNumber)
    );
    if (matching.length === 0) {
        console.log(`No master record found; creating one`);
        await makeNewDialpadMasterRecord(masterTable, recordId, phoneNumber);
    } else if (matching.length === 1) {
        console.log(`One matching master record found; updating it`);
        await updateExistingDialpadMasterRecords(masterTable, matching, recordId);
    } else {
        console.log(
            `Multiple matching master records found, updating all and marking as duplicates`
        );
        await updateExistingDialpadMasterRecords(masterTable, matching, recordId);
        await markMasterRecordsAsDuplicates(masterTable, matching);
    }
}

async function makeNewDialpadMasterRecord(masterTable, recordId, phoneNumber) {
    await masterTable.createRecordAsync({
        fld4lEBvUftT8MoGs: phoneNumber, // E.164 Number
        flden5oBfu9Gniz2P: [{ id: recordId }], // Dialpad Contacts from Person
        fld1CNjHs3PRuqCok: formatPhone(phoneNumber), // Phone
    });
}

async function updateExistingDialpadMasterRecords(masterTable, masterRecords, newRecordId) {
    const updates = [];
    for (const masterRecord of masterRecords) {
        let existingLinks = masterRecord.getCellValue("flden5oBfu9Gniz2P"); // Dialpad Contacts from Person
        if (existingLinks) {
            if (existingLinks && existingLinks.map((v) => v.id).includes(newRecordId)) {
                console.log(
                    `Master record ${masterRecord.id} is already linked to this form; skipping update`
                );
                continue;
            }
            existingLinks.push({ id: newRecordId });
        } else {
            existingLinks = [{ id: newRecordId }];
        }
        update = { id: masterRecord.id, fields: { flden5oBfu9Gniz2P: existingLinks } };
        updates.push(update);
    }
    for (let i = 0; i < updates.length; i += 50) {
        const end = Math.min(updates.length, i + 50);
        await masterTable.updateRecordsAsync(updates.slice(i, end));
    }
}

async function markMasterRecordsAsDuplicates(masterTable, masterRecords) {
    const updates = masterRecords.map((r) => ({
        id: r.id,
        fields: {
            fldEVYjKOxyLSYJZF: true, // Has Duplicates?
        },
    }));
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
        return `(${phone.substring(2, 5)}) ${phone.substring(5, 8)}-${phone.substring(8, 12)}`;
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
        // put last four numbers together
        suffixSuffix = "-" + suffix.substring(suffix.length - 4);
        suffix = suffix.substring(0, suffix.length - 4);
    }
    for (let i = suffix.length; i > 3; i = i - 3) {
        suffix = suffix.substring(0, i - 3) + "-" + suffix.substring(i - 3);
    }
    return prefix + "-" + suffix + suffixSuffix;
}
