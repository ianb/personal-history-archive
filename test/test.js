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
const { By, until, Key } = webdriver;
// Uncomment the next line and others with `ServiceBuilder` to enable trace logs from Firefox and Geckodriver
// const { ServiceBuilder } = firefox;
const path = require("path");

const SERVER = "http://localhost:11180";
const SERVER_STATIC = `${SERVER}/test-static`;
const addonFileLocation = path.join(process.cwd(), "build", "tracker-extension.zip");

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

function getChromeElement(driver, selector) {
  return driver.setContext(firefox.Context.CHROME)
    .then(() => driver.wait(until.elementLocated(selector)));
}

/** Calls finallyCallback() after the promise completes, successfully or not,
    returning the resolved or rejected promise as normal */
function promiseFinally(promise, finallyCallback) {
  return promise.then((result) => {
    finallyCallback();
    return result;
  }, (error) => {
    finallyCallback();
    throw error;
  });
}

function promiseTimeout(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

describe("Test history collection", function() {
  this.timeout(120000);
  let driver;

  before(async function() {
    driver = await getDriver();
  });

  after(async function() {
    if (!process.env.NO_CLOSE) {
      // FIXME: arg, this doesn't quit! Bug in geckodriver?
      return await driver.quit();
    }
    console.info("Note: leaving browser open");
    return null;
  });

  it("will browse about", async function() {
    this.timeout(15000);
    let driver = await getDriver();
    // Give the add-on a moment to load:
    await promiseTimeout(1000);
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
    let mod = process.platform == "darwin" ? Key.COMMAND : Key.CONTROL;
    let selectLinkOpeninNewTab = Key.chord(mod, Key.RETURN);
    await driver.findElement(By.css("a.result")).sendKeys(selectLinkOpeninNewTab);
    // We want to be sure the Cmd+click opens a tab before we do the next step:
    await promiseTimeout(1000);

    /***********************
     *  fetch the results  */
    await driver.get(`${SERVER}/test-static/debug.html`);
    await driver.wait(until.elementLocated(By.css("#status")));
    let result = await driver.findElement(By.css("#status")).getAttribute("value");
    result = JSON.parse(result);
    await driver.findElement(By.css("#flush")).click();
    let status = await driver.findElement(By.css("#flush-status"));
    await driver.wait(until.elementTextContains(status, "finished"));

    /************************
     *  analyze the results */
    let pages = result.currentPages.concat(result.pendingPages);
    pages.sort((a, b) => a.loadTime > b.loadTime ? 1 : -1)
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
      `${SERVER_STATIC}/search-destination.html`, // This item should not be here
      `${SERVER}/test-static/debug.html`,
    ];
    assert.deepEqual(urls, expectedUrls);
    // Apparently driver.get() doesn't act like from_address_bar
    assert.deepEqual(property("from_address_bar"), [
      false, false, false, false, false, false, false, false, false
    ], "from_address_bar");
    // We went "back" to the 4th item (the google search)
    assert.deepEqual(property("forward_back"), [
      false, false, false, false, true, true, false, false, false
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
      'link', // I don't understand this entry at all
    ], "transitionType");
    assert.deepEqual(pages.map(p => idToIndex(p.previousId)), [
      -1, // Didn't come from anywhere, about:blank
      0, // search page
      1, // search result
      2, // click on link
      3, // went "back" to this page... FIXME: is this right?
      4, // came from previous search result,
      5, // something else...
      6, // back again
      5, // mysterious extra copy of a page
    ]);
    assert.deepEqual(property("newTab"), [
      false, false, false, false, false, false, true, false, false,
    ], "newTab");
    assert.deepEqual(pages.map(p => !!p.unloadTime), [
      true, true, true, true, true, true, true,
      false, false, // only the last two pages are still loaded
    ], "is unloaded");
    assert.deepEqual(property("closedReason"), [
      'navigation',
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

});
