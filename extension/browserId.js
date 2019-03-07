/* globals util, log, communication, catcher */

this.browserId = null;
this.sessionId = null;
this.browserIdPromise = catcher.watchPromise(browser.storage.local.get(["browserId"]).then(async (result) => {
  if (!result || !result.browserId) {
    browserId = util.makeUuid();
    await browser.storage.local.set({browserId}).catch((error) => {
      log.error("Error setting browserId", error);
    });
  } else {
    browserId = result.browserId;
  }
  sessionId = util.makeUuid();
}));
