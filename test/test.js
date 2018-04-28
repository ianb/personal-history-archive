/* globals describe, it, before, after */

/* Environmental variables that help control this test:

FIREFOX_CHANNEL = empty (default NIGHTLY)
                  NIGHTLY
                  AURORA (often Developer Edition)
                  BETA
                  RELEASE

NO_CLOSE = if not empty then when the test is finished, the browser will not be closed

*/

const assert = require("assert");
const webdriver = require("selenium-webdriver");
const express = require("express");
const cookieParser = require("cookie-parser");
const http = require("http");
const { By, until, Key } = webdriver;
const path = require("path");
const fs = require("fs");
const { getDriver, closeBrowser } = require("./driver-setup");
const { promiseTimeout } = require("./test-utils");

const PORT = 11180;
const SERVER = `http://localhost:${PORT}`;
const SERVER_STATIC = `${SERVER}/test-static`;
const COMMAND_MOD = process.platform === "darwin" ? Key.COMMAND : Key.CONTROL;
const addonFileLocation = path.join(process.cwd(), "test", "build", "extension.zip");

let server;

function startServer() {
  if (server) {
    server.close();
  }
  const app = express();
  app.use(cookieParser());
  app.get("/cookie", (req, res) => {
    if (req.query.remove) {
      res.cookie("testCookie", "", {maxAge: 0});
    } else {
      res.cookie("testCookie", "test value", {maxAge: 3600000});
    }
    res.send("OK");
  });
  app.use("/test-static", express.static(path.join(__dirname, "static"), {
    index: ["index.html"],
    maxAge: null
  }));
  server = http.createServer(app);
  server.listen(PORT);
}

function stopServer() {
  server.close();
  server = null;
}

function filenameForUrl(url) {
  // FIXME: this won't work for long pages
  return path.join(__dirname, "test-data", "pages", encodeURIComponent(url) + "-page.json");
}

async function collectInformation(driver) {
  await driver.get(`${SERVER}/test-static/debug.html`);
  await driver.wait(until.elementLocated(By.css("#status")));
  let result = await driver.findElement(By.css("#status")).getAttribute("value");
  result = JSON.parse(result);
  await driver.findElement(By.css("#flush")).click();
  let status = await driver.findElement(By.css("#flush-status"));
  await driver.wait(until.elementTextContains(status, "finished"));
  return result;
}

describe("Test history collection", function() {
  this.timeout(120000);
  let driver;

  before(async function() {
    startServer();
    driver = await getDriver(addonFileLocation);
    // Give the add-on a moment to load:
    await promiseTimeout(1000);
  });

  after(async function() {
    stopServer();
    if (!process.env.NO_CLOSE) {
      closeBrowser(driver);
      return null;
    }
    console.info("Note: leaving browser open");
    return null;
  });

  it("will browse about", async function() {
    this.timeout(15000);
    await driver.get(`${SERVER_STATIC}/search.html`);
    await driver.findElement(By.name("q")).sendKeys("test query\n");
    await driver.findElement(By.css("button")).click();
    await driver.wait(until.titleIs("Search results"));
    await driver.wait(until.elementLocated(By.css("a.result")));
    await driver.findElement(By.css("a.result")).click();
    await driver.wait(async () => {
      let url = await driver.getCurrentUrl();
      return !url.includes("search-results.html");
    });
    await driver.wait(until.elementLocated(By.css("#first-link")));
    await driver.findElement(By.css("#first-link")).click();
    await driver.navigate().back();
    await driver.navigate().back();
    await driver.wait(until.elementLocated(By.css("a.result")));
    let selectLinkOpeninNewTab = Key.chord(COMMAND_MOD, Key.RETURN);
    await driver.findElement(By.css("a.result")).sendKeys(selectLinkOpeninNewTab);
    // We want to be sure the Cmd+click opens a tab before we do the next step:
    await promiseTimeout(1000);

    /** *********************
     *  fetch the results  */
    let result = await collectInformation(driver);

    /** **********************
     *  analyze the results */
    let pages = result.currentPages.concat(result.pendingPages);
    pages.sort((a, b) => a.loadTime > b.loadTime ? 1 : -1);
    if (pages[0].url === "about:blank") {
      // Sometimes about:blank shows up in the history, and sometimes it doesn't (presumably related
      // to load time), so we remove it if it is the first
      pages.shift();
    }
    function idToIndex(id) {
      return pages.map(p => p.id).indexOf(id);
    }
    function property(name) {
      return pages.map(p => p[name]);
    }
    let urls = pages.map(p => p.url);
    let expectedUrls = [
      `${SERVER_STATIC}/search.html`,
      `${SERVER_STATIC}/search-results.html?q=test+query`,
      `${SERVER_STATIC}/search-destination.html`,
      `${SERVER_STATIC}/search-destination.html#first`,
      `${SERVER_STATIC}/search-destination.html`,
      `${SERVER_STATIC}/search-results.html?q=test+query`,
      `${SERVER_STATIC}/search-destination.html`,
      `${SERVER}/test-static/debug.html`,
    ];
    assert.deepEqual(urls, expectedUrls);
    // Apparently driver.get() doesn't act like from_address_bar
    assert.deepEqual(property("from_address_bar"), [
      false, false, false, false, false, false, false, false
    ], "from_address_bar");
    // We went "back" to the 4th item (the google search)
    assert.deepEqual(property("forward_back"), [
      false, false, false, false, true, true, false, false
    ], "forward_back");
    assert.deepEqual(property("transitionType"), [
      "link",
      "form_submit", // search result
      "link", // clicked on search result
      "link", // clicked on anchor link
      "link", // clicked on back...?
      "link", // clicked on back again
      undefined, // apparently open in new window is misunderstood
      "link", // driver.get looks like link?
    ], "transitionType");
    assert.deepEqual(pages.map(p => idToIndex(p.sourceId)), [
      -1, // Didn't come from anywhere, about:blank
      0, // search page
      1, // search result
      2, // click on link
      3, // went "back" to this page... FIXME: is this right?
      4, // came from previous search result,
      5, // something else...
      5, // mysterious extra copy of a page
    ]);
    assert.deepEqual(property("newTab"), [
      false, false, false, false, false, false, true, false,
    ], "newTab");
    assert.deepEqual(property("sourceClickText"), [
      null,
      null,
      "A pretend destination",
      "first place",
      null,
      null,
      null,
      "A pretend destination",
    ], "sourceClickText");
    assert.deepEqual(pages.map(p => !!p.unloadTime), [
      true, true, true, true, true, true,
      false, false, // only the last two pages are still loaded
    ], "is unloaded");
    assert.deepEqual(pages.map(p => typeof p.activeTime), [
      "number", "number", "number", "number", "number", "number", "number", "number",
    ]);
    assert.deepEqual(property("closedReason"), [
      "navigation",
      "navigation",
      "navigation",
      "navigation",
      "navigation",
      "navigation",
      null,
      null, // Only the last two pages haven't been redirected away
    ], "closedReason");
    assert.deepEqual(property("title"), [
      "Pretend Search",
      "Search results",
      "Pretend destination",
      null,
      null,
      "Search results",
      "Pretend destination",
      null,
    ], "captured title");
    let searchResultLinks = [{
      text: "A pretend destination",
      url: "http://localhost:11180/test-static/search-destination.html",
    }];
    let destinationLinks = [
      {
        elementId: "first-link",
        text: "first place",
        url: "#first",
      },
      {
        elementId: "second-link",
        text: "second place",
        url: "#second",
      }
    ];
    assert.deepEqual(property("linkInformation"), [
      [],
      searchResultLinks,
      destinationLinks,
      null, // I'm not sure why these are null, probably because there isn't time to get the information?
      null, // that's not a good reason for null values, might be fragile in the future
      searchResultLinks,
      null,
      null,
    ]);
    return true;
  });

  it("Will detect 404s", async function() {
    this.timeout(10000);
    let url = `${SERVER_STATIC}/does-not-exist.html`;
    await driver.get(url);
    await promiseTimeout(5000);
    let result = await collectInformation(driver);
    let page = result.pendingPages.filter(p => p.url.endsWith("does-not-exist.html"))[0];
    assert.equal(page.statusCode, 404, `Status code not 404: ${page.statusCode}`);
    assert(page.contentType.startsWith("text/html"), `contentType: ${page.contentType}`);
    let filename = filenameForUrl(url);
    let pageData = JSON.parse(fs.readFileSync(filename, {encoding: "UTF-8"}));
    assert.equal(pageData.statusCode, 404);
    return true;
  });

  it("Will detect cookies", async function() {
    this.timeout(10000);
    let url = `${SERVER}/cookie`;
    await driver.get(url);
    await promiseTimeout(500);
    await driver.get(url + "?remove=1");
    await promiseTimeout(500);
    let result = await collectInformation(driver);
    let pages = result.currentPages.concat(result.pendingPages);
    pages.sort((a, b) => a.loadTime > b.loadTime ? 1 : -1);
    // Depending on previous tests, there might be other pages before the one we care about
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].url.endsWith("cookie")) {
        // The page we want to start with
        pages.splice(0, i);
        break;
      }
    }
    assert.deepEqual(pages.map(p => [p.hasCookie, p.hasSetCookie]), [
      [false, true], // has no cookie, but did set one
      [true, true], // has no cookie, but did set the deleting cookie
      [false, false], // the debug page, sets no cookie, and cookie has been deleted
    ]);
  });

});
