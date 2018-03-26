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
const firefox = require("selenium-webdriver/firefox");
const webdriver = require("selenium-webdriver");
const express = require("express");
const http = require("http");
const { By, until, Key } = webdriver;
// Uncomment the next line and others with `ServiceBuilder` to enable trace logs from Firefox and Geckodriver
// const { ServiceBuilder } = firefox;
const path = require("path");
const fs = require("fs");

const PORT = 11180;
const SERVER = `http://localhost:${PORT}`;
const SERVER_STATIC = `${SERVER}/test-static`;
const COMMAND_MOD = process.platform == "darwin" ? Key.COMMAND : Key.CONTROL;
const addonFileLocation = path.join(process.cwd(), "test", "build", "extension.zip");

let server;

function startServer() {
  if (server) {
    server.close();
  }
  const app = express();
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


function getDriver() {
  const channel = process.env.FIREFOX_CHANNEL || "NIGHTLY";
  if (!(channel in firefox.Channel)) {
    throw new Error(`Unknown channel: "${channel}"`);
  }

  const options = new firefox.Options()
    .setBinary(firefox.Channel[channel])
    .setPreference("extensions.legacy.enabled", true)
    .setPreference("xpinstall.signatures.required", false);

  const driver = new webdriver.Builder()
    .withCapabilities({"moz:webdriverClick": true})
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build();

  driver.installAddon(addonFileLocation);

  return driver;
}

function promiseTimeout(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

function filenameForUrl(url) {
  // FIXME: this won't work for long pages
  return path.join(__dirname, 'test-data', 'pages', encodeURIComponent(url) + "-page.json");
}

async function closeBrowser(driver) {
  // This works around some geckodriver bugs in driver.quit()
  let handles = await driver.getAllWindowHandles();
  for (let handle of handles) {
    await driver.switchTo().window(handle);
    await driver.close();
  }
  try {
    driver.quit();
  } catch (error) {
    // Ignore it (probably the browser is closed by now)
  }
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
    driver = await getDriver();
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
    await driver.findElement(By.name('q')).sendKeys("test query\n");
    await driver.findElement(By.css('button')).click();
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
    if (pages[0].url == "about:blank") {
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
      'link',
      'form_submit', // search result
      'link', // clicked on search result
      'link', // clicked on anchor link
      'link', // clicked on back...?
      'link', // clicked on back again
      undefined, // apparently open in new window is misunderstood
      'link', // driver.get looks like link?
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
    assert.deepEqual(pages.map(p => !!p.unloadTime), [
      true, true, true, true, true, true,
      false, false, // only the last two pages are still loaded
    ], "is unloaded");
    assert.deepEqual(property("closedReason"), [
      'navigation',
      'navigation',
      'navigation',
      'navigation',
      'navigation',
      'navigation',
      null,
      null, // Only the last two pages haven't been redirected away
    ], "closedReason");
    return true;
  });

  it("Will detect 404s", async function() {
    this.timeout(10000);
    let url = `${SERVER_STATIC}/does-not-exist.html`;
    await driver.get(url);
    await promiseTimeout(5000);
    console.log("now at here");
    let result = await collectInformation(driver);
    console.log("done collection");
    let page = result.pendingPages.filter(p => p.url.endsWith("does-not-exist.html"))[0];
    console.log("all pages are", result.pendingPages.filter(p => p.url.endsWith("does-not-exist.html")));
    console.log("page is:", page);
    assert.equal(page.statusCode, 404, `Status code not 404: ${page.statusCode}`);
    assert(page.contentType.startsWith("text/html"), `contentType: ${page.contentType}`);
    let filename = filenameForUrl(url);
    let pageData = JSON.parse(fs.readFileSync(filename, {encoding: "UTF-8"}));
    assert.equal(pageData.statusCode, 404);
    return true;
  });

});
