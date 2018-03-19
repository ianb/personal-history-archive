async function scrapeTab(tabId, requireUrl) {
  let start = Date.now();
  let foundUrl = await waitForStableTab(tabId)
  if (foundUrl !== requireUrl) {
    log.debug("Change", requireUrl, "to", foundUrl);
    throw new Error("URL changed from what was expected");
  }
  await browser.tabs.executeScript(tabId, {
    file: "build/buildSettings.js"
  });
  await browser.tabs.executeScript(tabId, {
    file: "log.js"
  });
  await browser.tabs.executeScript(tabId, {
    file: "scraper/make-static-html.js"
  });
  await browser.tabs.executeScript(tabId, {
    file: "scraper/Readability.js"
  });
  await browser.tabs.executeScript(tabId, {
    file: "scraper/extractor-worker.js"
  });
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
  await setTimeoutPromise(buildSettings.idleWaitTime);
  tab = await browser.tabs.get(tabId);
  if (tab.url != originalUrl) {
    return await waitForStableTab(tabId, attempts - 1);
  }
  return tab.url;
}

function waitForIdle(tabId) {
  return browser.tabs.executeScript(tabId, {
    code: "null",
    runAt: "document_start"
  });
}
