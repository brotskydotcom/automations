// This script can run either as a create-time automation
// (for importing new records with URLs) or as an update-time
// modification (for adding URLs to an existing record)

import { base, input } from "../library/airtable.internal";

// just copy the parts to Airtable that start at line 11
// because the Airtable doesn't understand the import line above
// and starting at line 11 makes it easy to add 10 to all error message lines
//
const table = base.getTable("General Info Test");
const recordId = input.config().recordId;
await getGeneralInfo(recordId);

async function getGeneralInfo(recordId) {
    const record = await table.selectRecordAsync(recordId, { fields: ["eImmigration URL"] });
    const url = record.getCellValueAsString("eImmigration URL");
    const id = getClientIdFromUrl(url);
    const authToken = await getAuthToken(
        input.secret("eImmigrationUsername"),
        input.secret("eImmigrationPassword")
    );
    let info = await getClientGeneralInfo(authToken, id);
    await copyGeneralInfoToAirtable(info);
}

function getClientIdFromUrl(url) {
    const regex = /([0-9]+)/;
    const result = url.match(regex);
    if (!result) {
        throw new Error("Could not find a client ID");
    }
    return result[1];
}

async function copyGeneralInfoToAirtable(generalInfo) {
    const updateData = {};
    const stringFieldMap = {
        fullName: "Full Name",
        firstName: "First Name",
        middleName: "Middle Name",
        lastName: "Last Name",
        phoneNumber: "Phone Number",
        email: "Email",
        aNumber: "A Number",
        preferredName: "Preferred Name",
    };
    for (const [giName, atName] of Object.entries(stringFieldMap)) {
        const value = generalInfo[giName];
        if (value) {
            updateData[atName] = value;
        }
    }
    const singleSelectFieldMap = {
        birthCountry: "Birth Country",
        citizenship: "Country of Citizenship",
        pronouns: "Pronouns",
        primaryLanguage: "Primary Language",
    };
    for (const [giName, atName] of Object.entries(singleSelectFieldMap)) {
        const value = generalInfo[giName];
        if (value) {
            updateData[atName] = { name: value };
        }
    }
    const dateFieldMap = {
        birthDate: "Date of Birth",
    };
    for (const [giName, atName] of Object.entries(dateFieldMap)) {
        const value = generalInfo[giName];
        if (value) {
            const [mm, dd, yyyy] = value.split("/");
            updateData[atName] = `${yyyy}-${mm}-${dd}`;
        }
    }
    console.log(JSON.stringify(updateData, null, 2));
    await table.updateRecordAsync(recordId, updateData);
}

async function getAuthToken(username, password) {
    const url = "https://www.eimmigration.com/OasisLegalServices/api/Account/token";
    const data = {
        username: username,
        password: password,
    };
    const response = await fetch(url, {
        method: "POST", // Specify the HTTP method
        headers: {
            "Content-Type": "application/json", // Inform the server about the data format
        },
        body: JSON.stringify(data), // Convert JavaScript object into a JSON string
    });
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const result = await response.json();
    if (!result.authenticated) {
        throw new Error(`HTTP error! Not authenticated: ${JSON.stringify(result)}`);
    }
    console.log("Authenticated with token!");
    return result.token;
}

async function getClientGeneralInfo(authToken, clientID) {
    const rootURL = "https://www.eimmigration.com/OasisLegalServices/api/v1";
    const generalInfo = {};

    // get the fields from the overall client info
    const generalFields = {
        fullName: "fullName",
        firstName: "name1",
        middleName: "name2",
        lastName: "name3",
        birthCountry: "birthCountry",
        citizenship: "nationality",
        phoneNumber: "dayPhone",
        email: "email",
        aNumber: "alienNumber",
        birthDate: "birthText",
    };
    const urlGeneral = `${rootURL}/Clients/${clientID}`;
    const response = await fetch(urlGeneral, {
        headers: {
            Authorization: "Bearer " + authToken,
        },
    });
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const result = await response.json();
    for (const [fname, fvalue] of Object.entries(generalFields)) {
        generalInfo[fname] = result[fvalue];
    }

    // get the custom fields
    const customFieldMap = {
        preferredName: 56,
        pronouns: 99,
        primaryLanguage: 148,
    };
    for (const [fname, fieldId] of Object.entries(customFieldMap)) {
        const urlCustom = `${rootURL}/Clients/${clientID}/CustomFields/${fieldId}`;
        const response = await fetch(urlCustom, {
            headers: {
                Authorization: "Bearer " + authToken,
            },
        });
        if (response.status === 404) {
            generalInfo[fname] = "";
            continue;
        }
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const result = await response.json();
        generalInfo[fname] = result.fieldValue;
    }

    return generalInfo;
}
