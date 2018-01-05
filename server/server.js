const express = require("express");
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require("path");
const fs = require("fs");
const http = require("http");
const dataPath = path.join(__dirname, "../pages");
const atob = require("atob");

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath);
}

const db = new sqlite3.Database("./history.sqlite", () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS browsers (
      id TEXT PRIMARY KEY,
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      latest INT,
      oldest INT
    );

    CREATE TABLE IF NOT EXISTS ignore (
      id TEXT PRIMARY KEY,
      url_hash TEXT,
      domain_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS history (
      browser_history_id TEXT UNIQUE PRIMARY KEY,
      browser TEXT REFERENCES browsers (id),
      url TEXT,
      title TEXT,
      lastVisitTime TIMESTAMP,
      visitCount INT NOT NULL DEFAULT 0,
      typedCount INT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS page (
      url TEXT PRIMARY KEY,
      fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      timeToFetch INT,
      redirectUrl TEXT
    );
  `);
});

function dbRun(sql, ...params) {
  return dbSomething('run', sql, ...params);
}

function dbGet(sql, ...params) {
  return dbSomething('get', sql, ...params);
}

function dbAll(sql, ...params) {
  return dbSomething('all', sql, ...params);
}

function dbSomething(command, sql, ...params) {
  return new Promise((resolve, reject) => {
    db[command](sql, ...params, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

const app = express();

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json({limit: '25mb'}));

app.get("/status", function(req, res) {
  if (!req.query.browserId) {
    res.status(400);
    res.send("Bad request: no browserId");
    return;
  }
  let result = {};
  dbGet(`
    SELECT
      (SELECT COUNT(*) FROM history) AS history_count,
      (SELECT latest FROM browsers WHERE id = ?) AS latest,
      (SELECT oldest FROM browsers WHERE id = ?) AS oldest,
      (SELECT COUNT(*) FROM history, page WHERE history.url = page.url) AS fetched_count
  `, req.query.browserId, req.query.browserId).then((row) => {
    result.historyCount = row.history_count;
    result.latest = row.latest || 0;
    result.oldest = row.oldest || null;
    result.fetchedCount = row.fetched_count;
    result.unfetchedCount = result.historyCount - result.fetchedCount;
    res.send(result);
  }).catch((error) => {
    res.status(500).type("text").send(String(error));
  });
});

app.post("/add-history", function(req, res) {
  console.log("Adding history", req.body);
  let promise = Promise.resolve();
  for (let item of req.body.items) {
    item.typedCount = item.typedCount || 0;
    console.log("Added history", item);
    promise = promise.then(dbRun(`
        INSERT OR REPLACE INTO history (browser_history_id, browser, url, title, lastVisitTime, visitCount, typedCount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, item.id, req.body.browserId, item.url, item.title, item.lastVisitTime, item.visitCount, item.typedCount)
    );
  }
  promise.then(() => {
    return dbRun(`
      UPDATE browsers
      SET latest = (SELECT MAX(lastvisitTime)
                    FROM history WHERE browser = ?),
          oldest = (SELECT MIN(lastvisitTime)
                    FROM history WHERE browser = ?)
    `, req.body.browserId, req.body.browserId);
  }).then(() => {
    res.send("OK");
  }).catch((error) => {
    res.status(500).type("text").send(String(error));
  });
});

app.post("/register", function(req, res) {
  let browserId = req.body.browserId;
  dbGet(`
    SELECT created FROM browsers
    WHERE id = ?
  `, browserId).then((row) => {
    if (row) {
      res.send("Already created");
    } else {
      return dbRun(`
        INSERT INTO browsers (id)
        VALUES ($1)
      `, browserId).then(() => {
        res.send("Created");
      });
    }
  }).catch((error) => {
    res.status(500).type("text").send(String(error));
  });
});

app.get("/get-history", function(req, res) {
  dbAll(`
    SELECT history.url, history.title, history.lastVisitTime, page.fetched FROM history
    LEFT JOIN page ON page.url = history.url
    ORDER BY history.lastVisitTime DESC
    LIMIT 100
  `).then((rows) => {
    console.log("sending", rows);
    res.send(rows);
  }).catch((error) => {
    res.status(500).type("text").send(String(error));
  });
});

app.get("/get-needed-pages", function(req, res) {
  dbAll(`
    SELECT history.url FROM history
    LEFT JOIN page ON page.url = history.url
    WHERE page.url IS NULL
    ORDER BY lastVisitTime DESC
    LIMIT 100
  `).then((rows) => {
    console.log("sending", rows);
    let result = [];
    for (let row of rows) {
      result.push(row.url);
    }
    res.send(result);
  }).catch((error) => {
    res.status(500).type("text").send(String(error));
  });
});

function fixedEncodeURIComponent(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16);
  });
}

app.post("/add-fetched-page", function(req, res) {
  let redirectUrl = req.body.data.url.split("#")[0];
  let origUrl = req.body.url.split("#")[0];
  if (redirectUrl == origUrl) {
    redirectUrl = null;
  } else {
    redirectUrl = req.body.data.url;
  }
  dbRun(`
    INSERT OR REPLACE INTO page (url, fetched, redirectUrl, timeToFetch)
    VALUES (?, CURRENT_TIMESTAMP, ?, ?)
  `, req.body.url, redirectUrl, req.body.data.timeToFetch).then(() => {
    let p = path.join(dataPath, fixedEncodeURIComponent(req.body.url));
    fs.writeFile(p, JSON.stringify(req.body.data), 'UTF-8', (error) => {
      if (error) {
        res.status(500);
        res.send("Failed");
        console.error("Got error writing file", p, error);
      } else {
        res.send("OK");
      }
    });
  }).catch((error) => {
    res.status(500).type("text").send(String(error));
  });
});

app.get("/echo", function(req, res) {
  res.type(req.query.type);
  res.send(req.query.content);
});

app.use("/", express.static(path.join(__dirname, "static"), {
  index: ["index.html"],
  maxAge: null
}));

app.use(function(err, req, res, next) {
  console.error("Error:", String(err), "\n", err.stack, "\n\n");
  res.header("Content-Type", "text/plain; charset=utf-8");
  res.status(500);
  let message = "Error:";
  if (err) {
    message += "\n" + err;
    if (err.stack) {
      message += "\n\n" + err.stack;
    }
  }
  res.send(message);
});

let server = http.createServer(app);
server.listen(11180);
console.log("Listening on http://localhost:11180");
