function scrapeTab(tabId) {
  return waitForStableTab(tabId).then(() => {
    return browser.tabs.executeScript(tabId, {
      file: "scraper/make-static-html.js"
    });
  }).then(() => {
    return browser.tabs.executeScript(tabId, {
      file: "scraper/Readability.js"
    });
  }).then(() => {
    return browser.tabs.executeScript(tabId, {
      file: "scraper/extractor-worker.js"
    });
  }).then(() => {
    return browser.tabs.executeScript(tabId, {
      code: "extractorWorker.documentStaticJson()"
    });
  }).then((resultList) => {
    return resultList[0];
  });
}

function waitForStableTab(tabId, attempts = 3) {
  let originalUrl;
  return browser.tabs.get(tabId).then((tab) => {
    originalUrl = tab.url;
    return waitForIdle(tabId);
  }).then(() => {
    if (!attempts) {
      return;
    }
    return setTimeoutPromise(IDLE_WAIT_TIME).then(() => {
      return browser.tabs.get(tabId).then((tab) => {
        if (tab.url != originalUrl) {
          return waitForStableTab(tabId, attempts - 1);
        }
      });
    });
  });
}

function waitForIdle(tabId) {
  return browser.tabs.executeScript({
    code: "null",
    runAt: "document_start"
  });
}
