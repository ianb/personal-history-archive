/* globals util, log, buildSettings */

this.scrapeTab = (function() {

  async function scrapeTab(tabId, requireUrl) {
    let start = Date.now();
    let foundUrl = await waitForStableTab(tabId);
    if (foundUrl !== requireUrl) {
      log.debug("Change", requireUrl, "to", foundUrl);
      throw new Error("URL changed from what was expected");
    }
    for (let file of ["build/buildSettings.js", "log.js", "util.js", "elementToSelector.js", "scraper/make-static-html.js", "scraper/Readability.js", "scraper/extractor-worker.js"]) {
      await browser.tabs.executeScript(tabId, {file});
    }
    let resultList = await browser.tabs.executeScript(tabId, {
      code: "extractorWorker.documentStaticJson()"
    });
    resultList[0].timeToFetch = Date.now() - start;
    return resultList[0];
  }

  async function waitForStableTab(tabId, attempts = 3) {
    let originalUrl;
    let tab = await browser.tabs.get(tabId);
    originalUrl = tab.url;
    await waitForIdle(tabId);
    if (!attempts) {
      return tab.url;
    }
    await util.sleep(buildSettings.idleWaitTime);
    tab = await browser.tabs.get(tabId);
    if (tab.url !== originalUrl) {
      return waitForStableTab(tabId, attempts - 1);
    }
    return tab.url;
  }

  function waitForIdle(tabId) {
    return browser.tabs.executeScript(tabId, {
      code: "null",
      runAt: "document_start"
    });
  }

  return scrapeTab;
})();
