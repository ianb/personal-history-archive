const { dbRun, dbAll } = require("./db");
const { listPageUrls, readPage } = require("./json-files");

function insertPage(url, pageData) {
  let redirectUrl = pageData.url.split("#")[0];
  let fetchedTime = Math.round(pageData.fetchedTime || Date.now() / 1000);
  return dbRun(`
    INSERT OR REPLACE INTO page (url, fetched, redirectUrl, timeToFetch)
    VALUES (?, ?, ?, ?)
  `, url, fetchedTime, redirectUrl, pageData.timeToFetch);
}

async function insertAllPages() {
  let urls = await listPageUrls();
  let datas = await Promise.all(urls.map(u => readPage(u)));
  return Promise.all(datas.map(data => insertPage(data.originalUrl, data)));
}

async function clearPages() {
  let existing = {};
  let urls = await listPageUrls();
  for (let url of urls) {
    existing[url] = true;
  }
  let rows = await dbAll(`
    SELECT url FROM page
  `);
  let toRemove = [];
  for (let row of rows) {
    if (!existing[row.url]) {
      toRemove.push(row.url);
    }
  }
  console.info("Found", toRemove.length, "orphaned pages");
  let promises = [];
  for (let url of toRemove) {
    promises.push(dbRun(`
      DELETE FROM page WHERE url = ?
    `, url));
  }
  return Promise.all(promises);
}

insertAllPages().then(() => {
  console.info("All pages inserted!");
  return clearPages();
}).then(() => {
  console.info("All orphaned pages removed");
}).catch((error) => {
  console.error("Error inserting pages:", error);
  console.error(error.stack);
});
