const express = require("express");
const { Configuration, OpenAIApi } = require("openai");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { nameFixer } = require("name-fixer");
const https = require("https");
const crypto = require("crypto");
const cors = require("cors");
const fs = require("fs");
require("dotenv").config();
const {
  disciplines,
  GRAPHQL_ENDPOINT,
  GRAPHQL_API_KEY,
  GetCompetitorBasicInfo,
  GetSingleCompetitorResultsDate,
} = require("./const");
const { getAge, nth } = require("./util");
const db = require("better-sqlite3")("/meta/h/habs/db/fantasy1500.db");
db.pragma("journal_mode = WAL");

const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

const mkHash = async (pw, salt) =>
  new Promise((res) =>
    crypto.pbkdf2(pw, salt, 10000, 256, "sha512", (_, buf) =>
      res(buf.toString("base64"))
    )
  );

const app = express();
const whitelist = [
  "https://securetoken.googleapis.com",
  "https://api.getmimo.com",
];

app.use(cors());
app.use(
  express.json({
    type: () => true,
  })
);

app.use("/match", async (req, res) => {
  console.log(req.body);
  try {
    const { athletes, discipline, gender } = req.body;
    if (!athletes) return res.send({ error: "No athletes" });
    if (!disciplines.includes(discipline))
      return res.send({ error: "Invalid discipline" });
    if (!["Men", "Women"].includes(gender))
      return res.send({ error: "Invalid gender" });
    let prompt = `Write a race prediction and preview for the ${gender}'s ${discipline} in a hypothetical athletics competition. Start your response with a listing of the predicted finish and times of the athletes. Here are the competitors:\n\n`;
    for (const athlete of athletes.slice(0, 12)) {
      const { id, year } = athlete;
      const basicInfo = (
        await (
          await fetch(GRAPHQL_ENDPOINT, {
            headers: { "x-api-key": GRAPHQL_API_KEY },
            body: JSON.stringify({
              operationName: "GetCompetitorBasicInfo",
              query: GetCompetitorBasicInfo,
              variables: { id },
            }),
            method: "POST",
          })
        ).json()
      ).data.competitor;

      const competitor = (
        await (
          await fetch(GRAPHQL_ENDPOINT, {
            headers: { "x-api-key": GRAPHQL_API_KEY },
            body: JSON.stringify({
              operationName: "GetSingleCompetitorResultsDate",
              query: GetSingleCompetitorResultsDate,
              variables: {
                id,
                resultsByYear: year,
                resultsByYearOrderBy: "date",
              },
            }),
            method: "POST",
          })
        ).json()
      ).data.getSingleCompetitorResultsDate;
      const prevYear = +year - 1;
      if (competitor.activeYears.includes(prevYear)) {
        const prevYearCompetitor = (
          await (
            await fetch(GRAPHQL_ENDPOINT, {
              headers: { "x-api-key": GRAPHQL_API_KEY },
              body: JSON.stringify({
                operationName: "GetSingleCompetitorResultsDate",
                query: GetSingleCompetitorResultsDate,
                variables: {
                  id,
                  resultsByYear: prevYear,
                  resultsByYearOrderBy: "date",
                },
              }),
              method: "POST",
            })
          ).json()
        ).data.getSingleCompetitorResultsDate;
        competitor.resultsByDate = [
          ...prevYearCompetitor.resultsByDate,
          ...competitor.resultsByDate,
        ];
      }
      //console.log(competitor.resultsByYear.resultsByEvent[0].results);

      const firstName = basicInfo.basicData.givenName;
      const lastName = nameFixer(basicInfo.basicData.familyName);
      const pb = "";
      const nat = basicInfo.basicData.countryCode;

      const fullName = `${firstName} ${lastName}`;
      console.log(fullName, id);
      const rank = athletes.indexOf(athlete) + 1;

      prompt += `${rank}. ${fullName} (${nat}), ${getAge(
        new Date(basicInfo.basicData.birthDate),
        year
      )} years old\n`;

      // prompt += `Personal Best: ${pb || "N/A"}\n`;

      prompt += `Performances by ${fullName}:\n`;
      prompt +=
        competitor.resultsByDate
          .map(
            ({
              discipline,
              indoor,
              date,
              venue,
              place,
              mark,
              wind,
              notLegal,
            }) =>
              `${date.split(" ").slice(0, -1).join(" ")}: ${
                Number.parseInt(place) ? `${nth(+place)} place, ` : ""
              }time of ${mark}${notLegal ? "*" : ""}${
                wind ? ` (${wind})` : ""
              } in ${discipline}${indoor ? ` (indoor)` : ""} @ ${venue}`
          )
          .join("\n") + "\n\n";
    }
    prompt += `Please predict the final places and times of the athletes. List the athletes in order of finish with their times. Then, explain why you think they will finish in that order. In your reasoning, compare athletes with each other and don't be afraid to make harsh judgements based on the data. Make reference to specific standout performances for the athletes in your reasoning, whether good or bad.`;
    console.log(prompt.length);
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo-16k",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
    });
    console.log(completion.data.choices[0].message);
    res.send({ response: completion.data.choices[0].message.content });
  } catch (e) {
    console.log(e);
    res.send({ error: e.message });
  }
});

app.use(
  "/p",
  createProxyMiddleware({
    // router: (req) => req.url.match(/^\/p\/(.*)\//)[1],
    router: Object.fromEntries(whitelist.map((url) => [`/p/${url}`, url])),
    pathRewrite: (path) =>
      (path.match(/^\/p\/https?:\/\/[^\/]+(\/.*)$/) || " /")[1],
    changeOrigin: true,
    logLevel: "debug",
  })
);

app.get("/ping", async (req, res) => {
  res.send("pong");
});

app.post("/fantasy", async (req, res) => {
  let output = { status: "failure" };
  try {
    const { body } = req;
    const { password, ...rest } = body;
    console.log(new Date().toISOString(), rest);
    switch (body.action) {
      case "register": {
        const { email, name, password } = body;
        const salt = crypto.randomBytes(128).toString("base64");
        try {
          db.prepare(
            `insert into users (email, name, salt, hash) values (?, ?, ?, ?)`
          ).run(email, name, salt, await mkHash(password, salt));
          output = { status: "success" };
        } catch (e) {
          console.error(e);
        }
        const { id } = db
          .prepare("select id from users where email = ?")
          .get(email);
        // try {
        //   const beeResp = await (
        //     await fetch(
        //       `https://api.beehiiv.com/v2/publications/${process.env.BEEHIIV_PUBLICATION_ID}/subscriptions`,
        //       {
        //         method: "POST",
        //         headers: {
        //           Authorization: `Bearer ${process.env.BEEHIIV_API_KEY}`,
        //           "Content-type": "application/json",
        //         },
        //         body: JSON.stringify({
        //           email,
        //           utm_source: "habserv",
        //           custom_fields: [
        //             { name: "Name", value: name },
        //             { name: "ID", value: String(id) },
        //           ],
        //         }),
        //       }
        //     )
        //   ).json();
        //   console.log(beeResp);
        // } catch (e) {
        //   console.error(e);
        // }
        break;
      }
      case "addPicks": {
        const { email, password, meet, picksJson } = body;
        const { id, salt, hash } =
          db.prepare("select * from users where email = ?").get(email) ?? {};
        if (salt && hash === (await mkHash(password, salt))) {
          const picks = db
            .prepare("select * from picks where userid = ? and meet = ?")
            .get(id, meet);
          if (picks) {
            db.prepare(
              "update picks set picksJson = ? where userid = ? and meet = ?"
            ).run(JSON.stringify(picksJson), id, meet);
          } else {
            db.prepare(
              "insert into picks (userid, meet, picksJson) values (?, ?, ?)"
            ).run(id, meet, JSON.stringify(picksJson));
          }
          output = { status: "success" };
        }
        break;
      }
      case "getPicks": {
        const { email, password, meet } = body;
        const { id, salt, hash } =
          db.prepare("select * from users where email = ?").get(email) ?? {};
        if (hash === (await mkHash(password, salt))) {
          const { picksJson } = db
            .prepare("select * from picks where userid = ? and meet = ?")
            .get(id, meet);
          output = JSON.parse(picksJson);
        }
        break;
      }
      case "getSubmissions": {
        const { meet } = body;
        const getName = db.prepare("select name, id from users where id = ?");
        const names = db
          .prepare("select userid from picks where meet = ?")
          .all(meet)
          .map(({ userid }) => getName.get(userid));
        output = names;
      }
    }
  } catch (e) {
    console.error(e);
  }
  res.send(output);
});

const server = https.createServer(
  {
    key: fs.readFileSync(
      "/meta/h/habs/certbot/config/live/habs.sdf.org/privkey.pem",
      "utf8"
    ),
    cert: fs.readFileSync(
      "/meta/h/habs/certbot/config/live/habs.sdf.org/cert.pem",
      "utf8"
    ),
  },
  app
);
server.listen(8080);
