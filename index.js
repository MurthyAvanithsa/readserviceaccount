const parse = require("csv-parse");
var fs = require("fs");
const axios = require("axios");
require("dotenv").config();

const OKTA_BASE_URl = process.env.OKTA_BASE_URl;
const OKTA_KEY = process.env.OKTA_KEY;
const PARSER_OPTIONS = { columns: true };
const USER_ID_COLUMN = "User Id";
const PRIMARY_EMAIL_COLUMN = "Primary email";
const SECONDARY_EMAIl_COLUMN = "Secondary email";
const USER_TYPE = "User type";

const api = axios.create({
  baseURL: OKTA_BASE_URl,
  timeout: 10000,
  headers: { Authorization: `SSWS ${OKTA_KEY}` },
});

const parser = fs
  .createReadStream(__dirname + "/input.csv")
  .pipe(parse({ skip_empty_lines: true, columns: true }));

async function parseCsv(parser) {
  const csvUserObject = {};
  for await (const record of parser) {
    // Report current line
    const userId = record[USER_ID_COLUMN];
    const pmEmail = record[PRIMARY_EMAIL_COLUMN];
    const secEmail = record[SECONDARY_EMAIl_COLUMN];
    const userType = record[USER_TYPE];
    if (userType !== "User")
      csvUserObject[pmEmail] = { userId, pmEmail, secEmail };
  }
  return csvUserObject;
}

async function getUsers(apiClient) {
  return await apiClient.get("/users?limit=100").then((response) => {
    return response.data;
  });
}

async function getFunctionalUsers(csvResults, oktaUsers) {
  return oktaUsers.filter((user) => {
    if ("userType" in user.profile) {
      return (
        user.profile.userType !== "User" && user.profile.email in csvResults
      );
    }
    return false;
  });
}

(async () => {
  const csvUserObject = await parseCsv(parser);
  const usersFromOkta = await getUsers(api);
  const functionalUsers = getFunctionalUsers(csvUserObject, usersFromOkta);
  console.log(functionalUsers);
})();
