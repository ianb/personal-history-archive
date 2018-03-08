const express = require("express");
const bodyParser = require('body-parser');
const http = require("http");
const path = require("path");
const { dbGet, dbRun, dbAll } = require("./db");
const { writePage } = require("./json-files");
const viewer = require("./viewer");
const { sendError } = require("./responses");

const app = express();

app.use((req, res, next) => {
  console.info("Incoming:", req.method, req.url);
  next();
});

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json({limit: '100mb'}));

app.use((req, res, next) => {
  // Everything is CORS-enabled
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, GET, PUT, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Cookie, Content-Type, User-Agent");
  if (req.method === "OPTIONS") {
    res.type("text");
    res.send("");
    return;
  }
  next();
});

app.get("/status", async function(req, res) {
  try {
    if (!req.query.browserId) {
      res.status(400);
      res.send("Bad request: no browserId");
      return;
    }
    let result = {};
    let row = await dbGet(`
      SELECT
        (SELECT COUNT(*) FROM history) AS history_count,
        (SELECT latest FROM browser WHERE id = ?) AS latest,
        (SELECT oldest FROM browser WHERE id = ?) AS oldest,
        (SELECT COUNT(*) FROM history, page WHERE history.url = page.url) AS fetched_count
    `, req.query.browserId, req.query.browserId);
    result.historyCount = row.history_count;
    result.latest = row.latest || 0;
    result.oldest = row.oldest || null;
    result.fetchedCount = row.fetched_count;
    result.unfetchedCount = result.historyCount - result.fetchedCount;
    res.send(result);
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/add-history-list", async function(req, res) {
  try {
    let browserId = req.body.browserId;
    let historyItems = req.body.historyItems;
    console.info("Processing history:", Object.keys(historyItems).length, "items");
    let promise = Promise.resolve();
    Object.keys(historyItems).forEach((historyId) => {
      let historyItem = historyItems[historyId];
      promise = promise.then(() => {
        return dbRun(`
          INSERT OR REPLACE INTO history (
            id,
            browser_id,
            url,
            title,
            lastVisitTime,
            visitCount,
            typedCount
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, historyId, browserId, historyItem.url, historyItem.title, historyItem.lastVisitTime, historyItem.visitCount, historyItem.typedCount);
      });
      Object.keys(historyItem.visits).forEach((visitId) => {
        let visit = historyItem.visits[visitId];
        promise = promise.then(() => {
          return dbRun(`
            INSERT OR REPLACE INTO visit (
              id,
              history_id,
              visitTime,
              referringVisitId,
              transition
            ) VALUES (?, ?, ?, ?, ?)
          `, visitId, historyId, visit.visitTime, visit.referringVisitId, visit.transition);
        });
      });
    });
    await promise;
    await dbRun(`
      UPDATE browser
      SET latest = (SELECT MAX(lastvisitTime)
                    FROM history WHERE browser_id = ?),
          oldest = (SELECT MIN(lastvisitTime)
                    FROM history WHERE browser_id = ?)
    `, browserId, browserId);
    console.info("Finished importing:", Object.keys(historyItems).length, "items");
    res.send("OK");
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/add-activity-list", async function(req, res) {
  try {
    let browserId = req.body.browserId;
    let activityItems = req.body.activityItems;
    let promise = Promise.resolve();
    Object.keys(activityItems).forEach((activityId) => {
      let activity = activityItems[activityId];
      promise = promise.then(() => {
        let columns = `
        id
        browser_id
        url
        loadTime
        unloadTime
        transitionType
        client_redirect
        server_redirect
        forward_back
        from_address_bar
        previousId
        initialLoadId
        newTab
        activeCount
        closedReason
        method
        statusCode
        contentType
        hasSetCookie
        `.split(/\s+/g).filter(x => x);
        let marks = columns.map(x => "?");
        let values = columns.map(x => activity[x]);
        return dbRun(`
          INSERT OR REPLACE INTO activity (
            ${columns.join(", ")}
          ) VALUES (${marks.join(",")})
        `, ...values);
      });
    });
    await promise;
    console.info("Imported activities:", activityItems.length);
    res.send("OK");
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/register", async function(req, res) {
  try {
    let browserId = req.body.browserId;
    let row = await dbGet(`
      SELECT created FROM browser
      WHERE id = ?
    `, browserId);
    if (row) {
      res.send("Already created");
    } else {
      await dbRun(`
        INSERT INTO browser (id, user_agent)
        VALUES (?, ?)
      `, browserId, req.headers["user-agent"]);
      res.send("Created");
    }
  } catch (error) {
    sendError(error, res);
  };
});

app.get("/get-history", async function(req, res) {
  try {
    let rows = await dbAll(`
      SELECT history.url, history.title, history.lastVisitTime, page.fetched FROM history
      LEFT JOIN page ON page.url = history.url
      ORDER BY history.lastVisitTime DESC
      LIMIT 100
    `);
    res.send(rows);
  } catch (error) {
    sendError(error, res);
  }
});

app.get("/get-needed-pages", async function(req, res) {
  try {
    let limit = parseInt(req.query.limit || 100, 10);
    let rows = await dbAll(`
      SELECT history.url, fetch_error.error_message FROM history
      LEFT JOIN page
        ON page.url = history.url
      LEFT JOIN fetch_error
        ON fetch_error.url = history.url
      WHERE page.url IS NULL
      ORDER BY fetch_error.url IS NULL DESC, lastVisitTime DESC
      LIMIT ?
    `, limit);
    let result = [];
    for (let row of rows) {
      result.push({url: row.url, lastError: row.error_message});
    }
    res.send(result);
  } catch (error) {
    sendError(error, res);
  }
});

app.get("/check-page-needed", async function(req, res) {
  try {
    let url = req.query.url;
    let row = await dbGet(`
      SELECT COUNT(*) AS counter FROM page WHERE page.url = ?
    `, url);
    let result = {needed: !row.counter};
    res.send(result);
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/add-fetched-page", async function(req, res) {
  try {
    let page = req.body;
    let redirectUrl = page.data.url.split("#")[0];
    let origUrl = page.url.split("#")[0];
    page.data.originalUrl = page.url;
    if (redirectUrl == origUrl) {
      redirectUrl = null;
    } else {
      redirectUrl = req.body.data.url;
    }
    if (redirectUrl) {
      // Removes the YouTube start time we add
      redirectUrl = redirectUrl.replace("&start=86400", "");
    }
    page.data.fetchedTime = Date.now();
    await dbRun(`
      INSERT OR REPLACE INTO page (url, fetched, redirectUrl, timeToFetch)
      VALUES (?, CURRENT_TIMESTAMP, ?, ?)
    `, req.body.url, redirectUrl, req.body.data.timeToFetch);
    await dbRun(`
      DELETE FROM fetch_error
      WHERE url = ?
    `, req.body.url);
    await writePage(req.body.url, req.body.data);
    res.send("OK");
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/add-fetch-failure", async function(req, res) {
  try {
    let url = req.body.url;
    let error_message = req.body.error_message;
    await dbRun(`
      INSERT OR REPLACE INTO fetch_error (url, error_message)
      VALUES (?, ?)
    `, url, error_message);
    res.send("OK");
  } catch (error) {
    sendError(error, res);
  }
});

app.use("/viewer", viewer.app);

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
console.info("\n\nListening on http://localhost:11180");
