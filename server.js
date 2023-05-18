const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const https = require("https");
const crypto = require("crypto");
const cors = require("cors");
const fs = require("fs");
const db = require("better-sqlite3")("/meta/h/habs/db/fantasy1500.db");
db.pragma("journal_mode = WAL");

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

app.post("/fantasy", async (req, res) => {
  let output = { status: "failure" };
  const { body } = req;
  switch (body.action) {
    case "register": {
      const { email, name, password } = body;
      const salt = crypto.randomBytes(128).toString("base64");
      try {
        db.prepare(
          `insert into users (email, name, salt, hash) values (?, ?, ?, ?)`
        ).run(email, name, salt, await mkHash(password, salt));
        output = { status: "success" };
      } catch {}
      break;
    }
    case "getPicks": {
      const { email, password, meet } = body;
      const { id, salt, hash } = db
        .prepare("select * from users where email = ?")
        .get(email);
      if (hash === (await mkHash(password, salt))) {
        const { picksJson } = db
          .prepare("select * from picks where userid = ? and meet = ?")
          .get(id, meet);
        output = JSON.parse(picksJson);
      }
      break;
    }
    case "addPicks": {
      const { email, password, meet, picksJson } = body;
      const { id, salt, hash } = db
        .prepare("select * from users where email = ?")
        .get(email);
      if (hash === (await mkHash(password, salt))) {
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
