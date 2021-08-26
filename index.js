const parse = require("csv-parse");
var fs = require("fs");
const axios = require("axios");
const PromisePool = require("@supercharge/promise-pool");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

require("dotenv").config();

const csvWriter = createCsvWriter({
  path: "out.csv",
  header: [
    { id: "id", title: "ID" },
    { id: "status", title: "STATUS" },
    { id: "email", title: "EMAIL" },
  ],
});

const OKTA_BASE_URl = process.env.OKTA_BASE_URl;
const OKTA_KEY = process.env.OKTA_KEY;
const PARSER_OPTIONS = { columns: true };
const USER_ID_COLUMN = "User Id";
const PRIMARY_EMAIL_COLUMN = "Primary email";
const SECONDARY_EMAIl_COLUMN = "Secondary email";
const USER_TYPE = "User type";
const CONCURRENCY_LIMIT = 10;

const inputFile = process.argv.splice(2);
console.log(inputFile);
const api = axios.create({
  baseURL: OKTA_BASE_URl,
  timeout: 10000,
  headers: { Authorization: `SSWS ${OKTA_KEY}` },
});

var twirlTimer = function () {
  var P = ["\\", "|", "/", "-"];
  var x = 0;
  return setInterval(function () {
    process.stdout.write("\r" + P[x++]);
    x &= 3;
  }, 250);
};

const parser = fs
  .createReadStream(__dirname + inputFile[0])
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

const rateLimitSleep = (epoch, relay) => {
  const timeToReset = new Date(0); // The 0 there is the key, which sets the date to the epoch
  timeToReset.setUTCSeconds(epoch);
  const currentDate = new Date();
  var secondsToWait = (timeToReset.getTime() - currentDate.getTime()) / 1000;
  process.stdout.write(
    `Reached the API rate limit, waiting for ${secondsToWait}  seconds.\n`
  );
  // const loader = twirlTimer();
  return new Promise((resolve) =>
    setTimeout(() => resolve(relay), secondsToWait * 1000)
  );
};

async function getUserFromOkta(email) {
  return await api
    .get("/users", {
      params: {
        filter: `profile.email eq "${email}"`,
        limit: 1,
      },
    })
    .then((response) => {
      const headers = response.headers;
      // if ("x-rate-limit-remaining" in headers) {
      const rateLimit = headers["x-rate-limit-remaining"];
      const restTime = headers["x-rate-limit-reset"];
      console.log("rate limit", rateLimit);
      if (rateLimit <= 5 || response.status == 429) {
        return rateLimitSleep(restTime, response.data);
      }
      return response.data;
    })
    .catch((err) => {
      if (err.response.status == 429) {
        return rateLimitSleep(restTime);
      }
      process.stderr.write(`Error while processing api call: ${err}`);
    });
}

(async () => {
  const csvUserObject = await parseCsv(parser);
  const serviceUsers = Object.entries(csvUserObject);
  // .splice(
  //   Object.entries(1, csvUserObject).length - 2000
  // );
  const { results, errors } = await PromisePool.withConcurrency(
    CONCURRENCY_LIMIT
  )
    .for(serviceUsers)
    .process(async ([key, value]) => {
      console.log("Processing..", key);
      const users = await getUserFromOkta(key);
      if (users.length > 0) {
        const user = users[0];
        return { id: user.id, status: user.status, email: user.profile.email };
      }
      return users;
    });
  var finalUsersList = [].concat.apply([], results);
  await csvWriter.writeRecords(finalUsersList); // finish writing
})();
