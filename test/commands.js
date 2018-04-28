const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const feedparser = require("node-feedparser");
const { By, until, Key } = require("selenium-webdriver");
const { promiseTimeout, eitherPromise } = require("./test-utils");

const LOAD_TIMEOUT = 20000;

exports.fetchPage = async function(driver, url, base) {
  let timer = setTimeout(() => {
    console.log("    Sending ESCAPE key");
    driver.findElement(By.tagName("body")).sendKeys(Key.ESCAPE);
  }, LOAD_TIMEOUT);
  await driver.get(url);
  clearTimeout(timer);
  let result = await eitherPromise(
    driver.wait(until.elementLocated(By.css("#pha-completed-freeze"))).then(() => true),
    promiseTimeout(30000).then(() => false)
  );
  url = await driver.getCurrentUrl();
  if (!result) {
    console.log("Freezing page timed out");
    return null;
  }
  await promiseTimeout(500);
  let filename = filenameForUrl(base, url);
  let json = await readJson(filename, null);
  if (json && json.feeds) {
    json.parsedFeeds = [];
    for (let feed of json.feeds) {
      json.parsedFeeds.push(await parseFeed(feed.body));
    }
  }
  return json;
};

exports.pageExists = function(url, base) {
  let filename = filenameForUrl(base, url);
  return new Promise((resolve, reject) => {
    fs.access(filename, (error) => {
      resolve(!error);
    });
  });
};

function filenameForUrl(base, url) {
  let name = encodeURIComponent(url);
  if (name.length > 200) {
    let sha1 = crypto.createHash("sha1");
    let hash = sha1.digest(url).toString("hex");
    name = `${name.substr(0, 100)}-${hash}-trunc`;
  }
  return path.join(base, "pages", name + "-page.json");
}

function readJson(filename, defaultValue) {
  return new Promise((resolve, reject) => {
    fs.readFile(filename, {encoding: "UTF-8"}, (error, data) => {
      if (error && error.code === "ENOENT") {
        resolve(defaultValue);
        return;
      } else if (error) {
        reject(error);
        return;
      }
      let json;
      try {
        json = JSON.parse(data);
      } catch (e) {
        console.error("Error parsing JSON from", filename, ":", e);
        console.error(e.stack);
        console.error("text:", JSON.stringify(data));
        reject(e);
        return;
      }
      resolve(json);
    });
  });
}

function parseFeed(feedBody) {
  return new Promise((resolve, reject) => {
    feedparser(feedBody, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
