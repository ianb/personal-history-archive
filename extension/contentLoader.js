this.contentLoader = (function() {
  const exports = {};

  const SCRIPTS = [
    "browser-polyfill.js",
    "build/buildSettings.js",
    "log.js",
    "catcher.js",
    "util.js",
    "elementToSelector.js",
    "rssFinder.js",
    "contentWatcher.js",
  ];

  exports.loadScripts = async function(tabId) {
    for (const script of SCRIPTS) {
      await browser.tabs.executeScript(tabId, {
        file: script,
        runAt: "document_idle",
      });
    }
  };

  exports.trackTabs = function() {
    let callback = (tab) => {
      console.log("tab update", tab.id, tab.status);
      if (tab.status === "loading") {
        exports.loadScripts(tab.id);
      }
    };
    browser.tabs.onUpdated.addListener(callback, {
      properties: ["status"],
    });
    let cancel = () => {
      browser.tabs.onUpdated.removeListener(callback);
    };
    return cancel;
  };

  return exports;
})();
