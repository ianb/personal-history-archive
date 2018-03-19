const express = require("express");
const { dbRun, dbAll, dbGet } = require("./db");
const { sendError } = require("./responses");
const { readPage, deletePage } = require("./json-files");
const ejs = require("ejs");
const fs = require("fs");
const { URL } = require("url");

const app = exports.app = express();

const homepageTemplate = ejs.compile(fs.readFileSync(`${__dirname}/homepage.ejs`, {encoding: "UTF-8"}));
const viewTemplate = ejs.compile(fs.readFileSync(`${__dirname}/view.ejs`, {encoding: "UTF-8"}));
const contentTemplate = ejs.compile(fs.readFileSync(`${__dirname}/content.ejs`, {encoding: "UTF-8"}));
const confirmDeleteTemplate = ejs.compile(fs.readFileSync(`${__dirname}/confirmDelete.ejs`, {encoding: "UTF-8"}));
const redirectedTemplate = ejs.compile(fs.readFileSync(`${__dirname}/redirected.ejs`, {encoding: "UTF-8"}));


function urlDomain(url) {
  let u = new URL(url);
  return u.hostname + u.pathname;
}

function formatDate(d) {
  let date = new Date(d);
  let timestamp = date.getTime();
  let diff = Date.now() - timestamp;
  let days = Math.floor(diff / (1000 * 60 * 60 * 24));
  let hour = date.getHours();
  let minute = date.getMinutes();
  if (minute < 10) {
    minute = `0${minute}`;
  }
  let ampm = 'am';
  if (hour == 0) {
    hour = 12;
  } else if (hour == 12) {
    ampm = 'pm';
  } else if (hour > 12) {
    hour -= 12;
    ampm = 'pm';
  }
  return `${days} days ago ${hour}:${minute}${ampm}`;
}

function substituteResources(s, resources) {
  for (let id of Object.keys(resources)) {
    s = s.replace(id, resources[id].url);
  }
  return s;
}

app.get("/view", async function(req, res) {
  try {
    let url = req.query.url;
    let dataRows;
    let sql;
    let rows = await dbAll(sql = `
      SELECT
        history.id AS history_id,
        history.browser_id,
        browser.user_agent,
        history.title,
        history.lastVisitTime,
        history.visitCount,
        -- history2.url AS refer_url,
        -- history2.title AS refer_title,
        visit.id AS visit_id,
        visit.visitTime,
        visit.referringVisitId,
        visit.transition,
        page.fetched,
        page.timeToFetch,
        page.redirectUrl
      FROM history, visit, page, browser
      -- LEFT JOIN visit AS visit2, history AS history2
      --   ON visit2.id = visit.referringVisitId
      --   AND history2.id = visit2.history_id
      WHERE history.url = ?
        AND history.id = visit.history_id
        AND page.url = history.url
        AND browser.id = history.browser_id
      ORDER BY visit.visitTime DESC
    `, url);
    if (!rows.length) {
      res.status(404).type("text").send(`Not Found: ${JSON.stringify(url)}`);
      sql = sql.replace(/[?]/g, `'${url}'`);
      console.info("Not found:\n", sql);
      return;
    }
    dataRows = rows;
    let pageJson = await readPage(url);
    let histories = {};
    let page = {};
    for (let row of dataRows) {
      page.fetched = row.fetched;
      page.timeToFetch = row.timeToFetch;
      page.redirectUrl = row.redirectUrl;
      let history = histories[row.history_id];
      if (!history) {
        history = histories[row.history_id] = {visits: {}};
      }
      history.title = row.title;
      history.lastVisitTime = row.lastVisitTime;
      history.visitCount = row.visitCount;
      history.browser_id = row.browser_id;
      history.user_agent = row.user_agent;
      let visit = history.visits[row.visit_id];
      if (!visit) {
        visit = history.visits[row.visit_id] = {};
      }
      visit.visitTime = row.visitTime;
      visit.referringVisitId = row.referringVisitId;
      visit.refer_url = row.refer_url;
      visit.refer_title = row.refer_title;
      visit.transition = row.transition;
    }
    let urlEscaped = url.replace('%', '%%');
    let html = viewTemplate({histories, page, url, urlEscaped, pageJson, formatDate});
    res.type("html").send(html);
  } catch (error) {
    sendError(error, res);
  }
});

app.get("/content", async function(req, res) {
  try {
    let url = req.query.url;
    let pageJson = await readPage(url);
    pageJson.headSub = substituteResources(pageJson.head, pageJson.resources);
    pageJson.bodySub = substituteResources(pageJson.body, pageJson.resources);
    let html = contentTemplate({page: pageJson, url});
    res.type("html").send(html);
  } catch (error) {
    sendError(error, res);
  }
});

app.get("/redirected", async function(req, res) {
  try {
    let rows = await dbAll(`
      SELECT url, redirectUrl
      FROM page
      WHERE (redirectUrl IS NOT NULL AND url != redirectUrl
            AND REPLACE(REPLACE(url, 'http:', 'https:'), 'www.', '') !=
            REPLACE(REPLACE(redirectUrl, 'http:', 'https:'), 'www.', ''))
            AND NOT redirectOk
        OR not_logged_in
    `);
    let html = redirectedTemplate({pages: rows});
    res.type("html").send(html);
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/mark-needs-login", async function(req, res) {
  try {
    let url = req.body.url;
    await dbRun(`
      UPDATE page
      SET not_logged_in = 1
      WHERE url = ?
    `, url);
    res.redirect(`/viewer/view?url=${encodeURIComponent(url)}`);
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/remove-page", async function(req, res) {
  try {
    let url = req.body.url_pattern;
    if (req.body.confirmed) {
      let rows = await dbRun(`
        DELETE FROM history WHERE history.url LIKE ?
      `, url).then(() => {
        return dbAll(`
          SELECT url FROM page WHERE url LIKE ?
        `, url);
      });
      let deletes = [];
      for (let row of rows) {
        deletes.push(deletePage(row.url));
      }
      await Promise.all(deletes);
      await dbRun(`
        DELETE FROM page WHERE page.url LIKE ?
      `, url);
      res.redirect('/viewer/');
    } else {
      let row = await dbGet(`
        SELECT
          (SELECT COUNT(*) FROM history WHERE history.url LIKE ?) AS history_count,
          (SELECT COUNT(*) FROM page WHERE page.url LIKE ?) AS page_count
      `, url, url);
      let html = confirmDeleteTemplate({url_pattern: url, history_count: row.history_count, page_count: row.page_count});
      res.type("html").send(html);
    }
  } catch (error) {
      sendError(error, res);
  }
});

app.post("/clear-redirected", async function(req, res) {
  try {
    let urls = req.body.url;
    if (typeof urls == "string") {
      urls = [urls];
    }
    let promises = [];
    for (let url of urls) {
      promises.push(dbRun(`
        DELETE FROM page WHERE url = ?
      `, url));
      promises.push(deletePage(url));
    }
    await Promise.all(promises);
    res.redirect("/viewer/redirected");
  } catch (error) {
    sendError(error, res);
  }
});

app.post("/set-redirect-ok", async function(req, res) {
  try {
    let urls = req.body.url;
    if (typeof urls == "string") {
      urls = [urls];
    }
    let promise = Promise.resolve();
    urls.forEach((url) => {
      promise = promise.then(() => {
        return dbRun(`
          UPDATE page
          SET redirectOk = 1
          WHERE url = ?
        `, url);
      });
    });
    await promise;
    res.redirect("/viewer/redirected");
  } catch (error) {
    sendError(error, res);
  }
});

app.get("/", async function(req, res) {
  try {
    if (req.originalUrl == "/viewer") {
      res.redirect("/viewer/");
      return;
    }
    let rows = await dbAll(`
      SELECT history.url, history.title, history.lastVisitTime, page.fetched FROM history
      LEFT JOIN page ON page.url = history.url
      ORDER BY page.fetched IS NULL, history.lastVisitTime DESC
    `);
    let page = homepageTemplate({rows, urlDomain});
    res.type("html").send(page);
  } catch (error) {
    sendError(error, res);
  }
});
