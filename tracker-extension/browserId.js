/* globals util, log, communication, catcher */

this.browserId = null;
(function() {
  catcher.watchPromise(browser.storage.local.get(["browserId"]).then(async (result) => {
    if (!result.browserId) {
      browserId = util.makeUuid();
      await browser.storage.local.set({browserId}).catch((error) => {
        log.error("Error setting browserId", error);
      });
    } else {
      browserId = result.browserId;
    }
    await communication.register_browser();
  }));
})();
