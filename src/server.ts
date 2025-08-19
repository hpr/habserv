import express from "express";
import OpenAI from "openai";
import { createProxyMiddleware } from "http-proxy-middleware";
import { nameFixer } from "name-fixer";
import https from "https";
import crypto from "crypto";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import { Transform } from 'stream';
import Unblocker from 'unblocker';
dotenv.config();

import {
  disciplines,
  fieldDisciplines,
  MAX_CONTEXT_LENGTH,
  POST_PROMPT,
  P_WA_ATHLETE_ID,
  USE_CACHE,
} from "./const";
import { fetchRetry, getAge, getBasicInfo, getWaApi, getYearCompetitor, nth } from "./util";
import { InstanceConfig, Wbk } from "wikibase-sdk";
const db = require("better-sqlite3")("/meta/h/habs/db/fantasy1500.db");
db.pragma("journal_mode = WAL");

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

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

const unblocker = new Unblocker({
  prefix: `/${process.env.PROXY_SECRET}/`, responseMiddleware: [
    function (data: { contentType: string, stream: Transform }) {
      if (data.contentType == 'text/html') {
        const myStream = new Transform({
          decodeStrings: false,
          transform(chunk, encoding, next) {
            chunk = chunk.toString()
              .replace(/VueRouter\.createWebHistory\('\/(\w+)'\)/, `VueRouter.createWebHistory('/${process.env.PROXY_SECRET}/${process.env.PROXY_SECRET_URL}$1')`)
              .replace(new RegExp(`<script src="/${process.env.PROXY_SECRET}/https://unpkg.com/([^"]+)"></script>`, 'g'), '<script src="https://unpkg.com/$1"></script>');
            this.push(chunk);
            next();
          }
        });
        data.stream = data.stream.pipe(myStream);
      }
    }
  ]
});
app.use(unblocker);

app.use(
  express.json({
    type: () => true,
  })
);

const waCache = JSON.parse(fs.readFileSync("./waCache.json", "utf-8"));

app.use("/match", async (req, res) => {
  console.log(req.body);
  try {
    if (!cachedResponse) cachedResponse = await getWaApi();
    const { endpoint, apiKey } = cachedResponse!;
    const { athletes, discipline, gender, temperature } = req.body;
    if (!athletes) return res.send({ error: "No athletes" });
    if (!disciplines.includes(discipline))
      return res.send({ error: "Invalid discipline" });
    if (!["Men", "Women"].includes(gender))
      return res.send({ error: "Invalid gender" });
    const isField = fieldDisciplines.includes(discipline);
    let prompt = `Write a ${isField ? "competition" : "race"
      } prediction and preview for the ${gender}'s ${discipline} in a hypothetical athletics meeting today. Assume all athletes are at the ages specified. Start your response with a listing of the predicted finish and ${isField ? "times" : "marks"
      } of the athletes. Here are the competitors in no particular order:\n\n`;
    const athletePrompts: { id: string, txt: string }[] = [];
    const cutAthletes = athletes.slice(0, 25);
    for (const athlete of cutAthletes) {
      let prompt = "";
      const { id, year } = athlete;
      const basicInfo = waCache[id]?.basicInfo ?? await getBasicInfo(id, endpoint, apiKey);
      waCache[id] ??= {};
      waCache[id].basicInfo ??= basicInfo;
      if (!basicInfo) continue;
      athlete.iaafId = basicInfo.basicData.iaafId;

      let competitor = (USE_CACHE ? waCache[id]?.[year] : null) ?? await getYearCompetitor(id, year, endpoint, apiKey);
      if (!competitor) competitor = {
        activeYears: [String(+year - 1), String(+year - 2)],
        resultsByDate: [],
      };
      waCache[id] ??= {};
      waCache[id][year] ??= competitor;
      const prevYears = cutAthletes.length <= 3 ? 4 : 1;
      for (let i = 1; i <= prevYears; i++) {
        const prevYear = +year - i;
        if (competitor.activeYears.map(y => +y).includes(prevYear)) {
          const prevYearCompetitor = (USE_CACHE ? waCache[id]?.[prevYear] : null) ?? await getYearCompetitor(id, prevYear, endpoint, apiKey);
          if (!prevYearCompetitor) continue;
          waCache[id][prevYear] = prevYearCompetitor;
          competitor.resultsByDate = [
            ...prevYearCompetitor.resultsByDate,
            ...competitor.resultsByDate,
          ];
        }
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

      competitor.resultsByDate.sort((a: { date: string }, b: { date: string }) => new Date(a.date).getTime() - new Date(b.date).getTime())
      let resultsByDate = competitor.resultsByDate;
      // if (cutAthletes.length > 8 && resultsByDate.length > 11) resultsByDate = resultsByDate.slice(-11);

      prompt += `Performances by ${fullName}:\n`;
      prompt += resultsByDate
        .map(
          ({ discipline, indoor, date, venue, place, mark, wind, notLegal }) =>
            `${date}: ${Number.parseInt(place) ? `${nth(+place)} place, ` : ""
            }${isField ? "mark" : "time"} of ${mark}${notLegal ? "*" : ""}${wind ? ` (${wind})` : ""
            } in ${discipline}${indoor ? ` (indoor)` : ""} @ ${venue}`
        )
        .join("\n");
      athletePrompts.push({ id: athlete.id, txt: prompt });
    }
    for (const athlete of cutAthletes) {
      const idx = cutAthletes.indexOf(athlete);
      const { id, fullName, iaafId } = athlete;
      const totalChars = athletePrompts.reduce((acc, x) => acc + x.txt.length, 0);
      if (totalChars < 500000) {
        const cirrusSearchUrl = wbk?.cirrusSearchPages({
          haswbstatement: `${P_WA_ATHLETE_ID}=${id}${iaafId ? `|${P_WA_ATHLETE_ID}=${iaafId}` : ""}`,
        });
        const qid = wbk?.parse.pagesTitles(await fetchRetry(cirrusSearchUrl!))[0] as `Q${number}`;
        if (qid && wbk) {
          const entityUrl = wbk.getEntities({ ids: qid });
          const entity = (await fetchRetry(entityUrl)).entities[qid];
          if (entity?.sitelinks?.enwiki) {
            const foundPrompt = athletePrompts.find(ap => ap.id === athlete.id);
            if (!foundPrompt) continue;
            foundPrompt.txt += `\nWikipedia bio for ${fullName}:\n`;
            const wikiUrl = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
              format: "json",
              action: "query",
              prop: "extracts",
              exintro: "true",
              explaintext: "true",
              redirects: "1",
              exchars: "1800",
              // Math.floor(
              //   (MAX_CONTEXT_LENGTH -
              //     (prePromptLength + POST_PROMPT.length + 100)) /
              //     cutAthletes.length
              // ),
              titles: entity.sitelinks.enwiki?.title ?? entity.sitelinks.enwiki,
            });
            const bio = await fetchRetry(wikiUrl);
            const page = Object.keys(bio.query.pages)[0];
            foundPrompt.txt += bio.query.pages[page].extract;
          }
        }
      }
    }
    prompt += athletePrompts.map(p => p.txt).join("\n\n") + "\n\n";
    if (discipline === 'Mile') prompt += 'Remember this hypothetical race is a mile, not a 1500m, so the predicted times should be mile times. '
    prompt += isField ? POST_PROMPT.replaceAll("time", "mark") : POST_PROMPT;
    console.log(prompt);
    console.log(prompt.length);
    const completion = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: temperature ?? 0.7,
    });
    console.log(completion.choices[0]);
    res.send({ response: completion.choices[0].message.content });
    if (USE_CACHE) fs.writeFileSync("./waCache.json", JSON.stringify(waCache));
  } catch (e) {
    console.log(e, e.message, e.response?.data);
    res.status(400).send({ error: e.response?.data });
  }
});

app.use(
  "/p",
  createProxyMiddleware({
    // router: (req) => req.url.match(/^\/p\/(.*)\//)[1],
    router: Object.fromEntries(whitelist.map((url) => [`/p/${url}`, url])),
    pathRewrite: (path) => (path.match(/^\/p\/https?:\/\/[^\/]+(\/.*)$/) || " /")[1],
    changeOrigin: true,
    logLevel: "debug",
  })
);

app.get("/ping", async (req, res) => {
  res.send("pong");
});

let cachedResponse: Awaited<ReturnType<typeof getWaApi>> = undefined;
let lastFetchTime: number = 0;
let isFetching: boolean = false;
app.get('/wa', async (req, res) => {
  const now = Date.now();
  const oneDay = 3 * 60 * 60 * 1000; // 3 hours

  if (now - lastFetchTime < oneDay && cachedResponse) {
    return res.send(cachedResponse);
  }

  // Prevent concurrent fetches
  if (!isFetching) {
    isFetching = true;
    try {
      cachedResponse = await getWaApi();
      lastFetchTime = Date.now();
      console.log(cachedResponse, lastFetchTime);
    } catch (error) {
      console.error('Failed to fetch WA API:', error);
      return res.status(500).send(cachedResponse ?? {});
    } finally {
      isFetching = false;
    }
  }
  res.send(cachedResponse ?? {});
});

app.post("/fantasy", async (req, res) => {
  let output = { status: "failure" };
  try {
    const { body } = req;
    const { password, ...rest } = body;
    console.log(new Date().toISOString(), rest);
    if (rest && rest.picksJson) console.log(JSON.stringify(rest.picksJson));
    switch (body.action) {
      case "register": {
        const { email, name, password } = body;
        const existsUser = db.prepare("select id from users where email = ? collate nocase").get(email);
        if (existsUser) break;

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
          .prepare("select id from users where email = ? collate nocase")
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
          db.prepare("select * from users where email = ? collate nocase").get(email) ?? {};
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
          db.prepare("select * from users where email = ? collate nocase").get(email) ?? {};
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
server.listen(8080).on('upgrade', unblocker.onUpgrade);
