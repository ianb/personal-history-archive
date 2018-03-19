this.browserId = null;
(function () {
  browser.storage.local.get(["browserId"]).then((result) => {
    if (!result.browserId) {
      browserId = util.makeUuid();
      browser.storage.local.set({browserId}).catch((error) => {
        log.error("Error setting browserId", error);
      });
    } else {
      browserId = result.browserId;
    }
    communication.register_browser();
  }).catch((error) => {
    log.error("Error getting browserId:", error);
  });
})();
