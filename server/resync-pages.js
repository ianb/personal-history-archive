const { dbRun } = require("./db");
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

insertAllPages().then(() => {
  console.info("All pages inserted!");
}).catch((error) => {
  console.error("Error inserting pages:", error);
  console.error(error.stack);
});
