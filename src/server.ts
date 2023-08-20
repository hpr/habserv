import express from "express";
import { Configuration, OpenAIApi } from "openai";
import { createProxyMiddleware } from "http-proxy-middleware";
import { nameFixer } from "name-fixer";
import https from "https";
import crypto from "crypto";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

import {
  disciplines,
  fieldDisciplines,
  GRAPHQL_ENDPOINT,
  GRAPHQL_API_KEY,
  MAX_CONTEXT_LENGTH,
  POST_PROMPT,
  GetCompetitorBasicInfo,
  GetSingleCompetitorResultsDate,
  P_WA_ATHLETE_ID,
} from "./const";
import { getAge, nth } from "./util";
import { InstanceConfig, Wbk } from "wikibase-sdk";
const db = require("better-sqlite3")("/meta/h/habs/db/fantasy1500.db");
db.pragma("journal_mode = WAL");

const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

let WBK: (config: InstanceConfig) => Wbk | undefined, wbk: Wbk | undefined;
(async () => {
  WBK = (await import("wikibase-sdk")).WBK;
  wbk = WBK({
    instance: "https://www.wikidata.org",
    sparqlEndpoint: "https://query.wikidata.org/sparql",
  });
})();

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

const waCache = JSON.parse(fs.readFileSync("./waCache.json", "utf-8"));

app.use("/match", async (req, res) => {
  console.log(req.body);
  try {
    const { athletes, discipline, gender, temperature } = req.body;
    if (!athletes) return res.send({ error: "No athletes" });
    if (!disciplines.includes(discipline))
      return res.send({ error: "Invalid discipline" });
    if (!["Men", "Women"].includes(gender))
      return res.send({ error: "Invalid gender" });
    const isField = fieldDisciplines.includes(discipline);
    let prompt = `Write a ${isField ? "competition" : "race"
      } prediction and preview for the ${gender}'s ${discipline} in an athletics championship. Start your response with a listing of the predicted finish and ${isField ? "times" : "marks"
      } of the athletes. Here are the competitors in no particular order:\n\n`;
    let prePromptLength = prompt.length;
    const athletePrompts: string[] = [];
    const cutAthletes = athletes.slice(0, 12);
    for (const athlete of cutAthletes) {
      let prompt = "";
      const { id, year } = athlete;
      const basicInfo =
        waCache[id]?.basicInfo ??
        (
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
      waCache[id] ??= {};
      waCache[id].basicInfo ??= basicInfo;
      athlete.iaafId = basicInfo.basicData.iaafId;

      const competitor =
        waCache[id]?.[year] ??
        (
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
      if (!competitor) continue;
      waCache[id] ??= {};
      waCache[id][year] ??= competitor;
      const prevYear = +year - 1;
      if (competitor.activeYears.includes(prevYear)) {
        const prevYearCompetitor =
          waCache[id]?.[prevYear] ??
          (
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
        waCache[id][prevYear] = prevYearCompetitor;
        competitor.resultsByDate = [
          ...prevYearCompetitor.resultsByDate,
          ...competitor.resultsByDate,
        ];
      }
      //console.log(competitor.resultsByYear.resultsByEvent[0].results);

      const firstName = basicInfo.basicData.givenName;
      const lastName = nameFixer(basicInfo.basicData.familyName);
      const nat = basicInfo.basicData.countryCode;

      const fullName = `${firstName} ${lastName}`;
      athlete.fullName = fullName;
      console.log(fullName, id);
      const rank = cutAthletes.indexOf(athlete) + 1;

      prompt += `${rank}. ${fullName} (${nat}), ${getAge(
        new Date(basicInfo.basicData.birthDate),
        year
      )} years old\n`;

      prompt += `Performances by ${fullName}:\n`;
      prompt += competitor.resultsByDate
        .map(
          ({ discipline, indoor, date, venue, place, mark, wind, notLegal }) =>
            `${date}: ${Number.parseInt(place) ? `${nth(+place)} place, ` : ""
            }${isField ? "mark" : "time"} of ${mark}${notLegal ? "*" : ""}${wind ? ` (${wind})` : ""
            } in ${discipline}${indoor ? ` (indoor)` : ""} @ ${venue}`
        )
        .join("\n");
      athletePrompts.push(prompt);
    }
    for (const athlete of cutAthletes) {
      const idx = cutAthletes.indexOf(athlete);
      const { id, fullName, iaafId } = athlete;
      const totalChars = athletePrompts.reduce((acc, x) => acc + x.length, 0);
      if (totalChars < 50000) {
        const qid = wbk?.parse.pagesTitles(
          await (
            await fetch(
              wbk.cirrusSearchPages({
                haswbstatement: `${P_WA_ATHLETE_ID}=${id}${iaafId ? `|${P_WA_ATHLETE_ID}=${iaafId}` : ""
                  }`,
              })
            )
          ).json()
        )[0] as `Q${number}`;
        if (qid && wbk) {
          const entity =
            (await (await fetch(wbk.getEntities({ ids: qid }))).json())
              .entities[qid]
          if (entity?.sitelinks?.enwiki) {
            athletePrompts[idx] += `\nWikipedia bio for ${fullName}:\n`;
            const bio = await (
              await fetch(
                "https://en.wikipedia.org/w/api.php?" +
                new URLSearchParams({
                  format: "json",
                  action: "query",
                  prop: "extracts",
                  exintro: "true",
                  explaintext: "true",
                  redirects: "1",
                  exchars: "1000",
                  // Math.floor(
                  //   (MAX_CONTEXT_LENGTH -
                  //     (prePromptLength + POST_PROMPT.length + 100)) /
                  //     cutAthletes.length
                  // ),
                  titles: entity.sitelinks.enwiki,
                })
              )
            ).json();
            const page = Object.keys(bio.query.pages)[0];
            athletePrompts[idx] += bio.query.pages[page].extract;
          }
        }
      }
    }
    prompt += athletePrompts.join("\n\n") + "\n\n";
    prompt += isField ? POST_PROMPT.replaceAll("time", "mark") : POST_PROMPT;
    console.log(prompt);
    console.log(prompt.length);
    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: temperature ?? 0.7,
    });
    console.log(completion.data.choices[0].message);
    res.send({ response: completion.data.choices[0].message?.content });
    fs.writeFileSync("./waCache.json", JSON.stringify(waCache));
  } catch (e) {
    console.log(e.message, e.response?.data);
    res.status(400).send({ error: e.response?.data });
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
