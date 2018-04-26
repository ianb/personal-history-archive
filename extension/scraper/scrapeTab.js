/* globals util, log, buildSettings */

this.scrapeTab = (function() {

  async function scrapeTab(tabId, requireUrl) {
    let scraped = await scrapeTabDOM(tabId, requireUrl);
    await addRss(scraped);
    return scraped;
  }

  async function scrapeTabDOM(tabId, requireUrl) {
    let start = Date.now();
    let foundUrl = await waitForStableTab(tabId);
    if (foundUrl !== requireUrl) {
      log.debug("Change", requireUrl, "to", foundUrl);
      throw new Error("URL changed from what was expected");
    }
    for (let file of ["build/buildSettings.js", "log.js", "util.js", "elementToSelector.js", "rssFinder.js", "scraper/make-static-html.js", "scraper/Readability.js", "scraper/extractor-worker.js"]) {
      await browser.tabs.executeScript(tabId, {file});
    }
    let resultList = await browser.tabs.executeScript(tabId, {
      code: "extractorWorker.documentStaticJson()"
    });
    resultList[0].timeToFetch = Date.now() - start;
    return resultList[0];
  }

  async function addRss(scraped) {
    if (scraped.allFeeds) {
      scraped.feeds = [];
      for (let feed of scraped.allFeeds) {
        scraped.feeds.push(await getFeed(feed));
      }
      log.info("Scraped feeds:", scraped.feeds.length, "bytes:", JSON.stringify(scraped.feeds).length);
    }
  }

  async function getFeed(feed) {
    let start = Date.now();
    let result = {
      url: feed.href,
      fetchStart: start,
    };
    try {
      let resp = await fetch(feed.href);
      if (!resp.ok) {
        result.error = "Response error";
        result.status = resp.status;
        result.statusCode = resp.statusCode;
      } else {
        result.body = await resp.text();
        result.contentType = resp.headers.get("Content-Type");
        if (result.contentType) {
          result.contentType = result.contentType.replace(/;?\s*charset=[^\s]+/i, "");
        }
        result.lastModified = (new Date(resp.headers.get("Last-Modified"))).getTime();
      }
      result.fetchTime = Date.now() - start;
      if (resp.url !== feed.href) {
        result.redirectUrl = resp.url;
      }
      return result;
    } catch (e) {
      log.error("Got error fetching feed", feed, e);
      result.fetchTime = Date.now() - start;
      result.error = String(e);
      result.errorStack = e.stack;
      return result;
    }
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
