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

describe("Test history collection", function() {
  this.timeout(120000);
  let driver;

  before(function() {
    return getDriver().then((aDriver) => {
      driver = aDriver;
    });
  });

  after(function() {
    if (!process.env.NO_CLOSE) {
      return driver.quit();
    }
    console.info("Note: leaving browser open");
    return null;
  });

  it("will browse about", async function() {
    this.timeout(15000);
    let driver = await getDriver();
    await driver.get("https://google.com");
    await driver.findElement(By.name('q')).sendKeys('webdriver\n');
    //await driver.findElement(By.name('btnK')).click();
    await driver.wait(until.titleIs('webdriver - Google Search'));
    await driver.wait(until.elementLocated(By.css(".r a")));
    await driver.findElement(By.css(".r a")).click();
    await driver.wait(async () => {
      let url = await driver.getCurrentUrl();
      return !url.includes("google.com");
    });
    await driver.navigate().back();
    await driver.wait(until.elementLocated(By.css(".r a")));
    let mod = process.platform == "darwin" ? Key.COMMAND : Key.CONTROL;
    let selectLinkOpeninNewTab = Key.chord(mod, Key.RETURN);
    await driver.findElement(By.css(".r a")).sendKeys(selectLinkOpeninNewTab);
    await driver.get(`${SERVER}/debug.html`);
    await driver.wait(until.elementLocated(By.css("textarea")));
    let result = await driver.findElement(By.css("textarea")).getAttribute("value");
    result = JSON.parse(result);

    console.log("Got browsing data:", result);

    let pages = result.currentPages.concat(result.pendingPages);
    pages.sort((a, b) => a.loadTime > b.loadTime ? 1 : -1)
    function idToIndex(id) {
      return pages.map(p => p.id).indexOf(id);
    }
    // FIXME: verify these values!
    console.log("loadTime:", pages.map(p => p.loadTime));
    let urls = pages.map(p => p.url);
    console.log("urls:", urls);
    console.log("from_address_bar", pages.map(p => p.from_address_bar));
    console.log("forward_back:", pages.map(p => p.forward_back));
    console.log("transitionType:", pages.map(p => p.transitionType));
    console.log("previous:", pages.map(p => idToIndex(p.previousId)));
    console.log("newTab:", pages.map(p => p.newTab));

    return true;
  });

});
