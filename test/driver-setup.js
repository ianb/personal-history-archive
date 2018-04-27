const firefox = require("selenium-webdriver/firefox");
const webdriver = require("selenium-webdriver");

exports.getDriver = function(addonFileLocation) {
  const channel = process.env.FIREFOX_CHANNEL || "NIGHTLY";
  if (!(channel in firefox.Channel)) {
    throw new Error(`Unknown channel: "${channel}"`);
  }

  const options = new firefox.Options()
    .setBinary(firefox.Channel[channel])
    //.setPreference("extensions.legacy.enabled", true)
    // Let our unsigned add-on be installed:
    .setPreference("xpinstall.signatures.required", false)
    // Try to keep audio from playing (doesn't work):
    .setPreference("dom.webaudio.enabled", false)
    // Try to keep videos from auto-playing (doesn't work that well):
    .setPreference("media.autoplay.enabled", false)
    // Don't let pages do something before unloading:
    .setPreference("dom.disable_beforeunload", true)
    // Automatically deny all these permission prompts:
    .setPreference("permissions.default.camera", 2)
    .setPreference("permissions.default.desktop-notification", 2)
    .setPreference("permissions.default.geo", 2)
    .setPreference("permissions.default.microphone", 2)
    .setPreference("permissions.default.shortcuts", 2)
    // Don't let pages make popups:
    .setPreference("capability.policy.default.Window.alert", "noAccess")
    .setPreference("capability.policy.default.Window.confirm", "noAccess")
    .setPreference("capability.policy.default.Window.prompt", "noAccess")
    // Tracking protection blocks some nice thing to block:
    .setPreference("privacy.trackingprotection.enabled", true)
    .setPreference("privacy.trackingprotection.introCount", 20)
    // Time out requests after 20 seconds:
    .setPreference("network.http.response.timeout", 20)
    .setPreference("network.http.connection-timeout", 20);

  const driver = new webdriver.Builder()
    .withCapabilities({"moz:webdriverClick": true})
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build();

  driver.installAddon(addonFileLocation);

  return driver;
};

exports.closeBrowser = async function(driver) {
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
};
