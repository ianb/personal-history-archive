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

function insertAllPages() {
  return listPageUrls().then((urls) => {
    return Promise.all(urls.map(u => readPage(u)));
  }).then((datas) => {
    return Promise.all(datas.map(data => insertPage(data.originalUrl, data)));
  });
}

function clearPages() {
  let existing = {};
  return listPageUrls().then((urls) => {
    for (let url of urls) {
      existing[url] = true;
    }
    return dbAll(`
      SELECT url FROM page
    `);
  }).then((rows) => {
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
  });
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
