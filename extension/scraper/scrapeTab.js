/* globals util, log, buildSettings */

this.scrapeTab = (function() {

  let restrictiveCsp = "font-src 'none'; frame-src 'self' data:; object-src 'none'; worker-src 'none'; manifest-src 'none'";

  let rssContentTypes = [
    "application/rss+xml",
    "application/atom+xml",
    "application/rdf+xml",
    "application/rss",
    "application/atom",
    "application/rdf",
    "text/rss+xml",
    "text/atom+xml",
    "text/rdf+xml",
    "text/rss",
    "text/atom",
    "text/rdf",
  ];

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
        scraped.feeds.push(await getFeed(feed, true));
      }
      log.info("Scraped feeds:", scraped.feeds.length, "bytes:", JSON.stringify(scraped.feeds).length);
    }
    if (scraped.speculativeFeedLinks) {
      for (let feed of scraped.speculativeFeedLinks) {
        let fetched = await getFeed(feed, false);
        if (fetched) {
          found++;
          scraped.feeds.push(fetched);
        } else {
          feed.shouldDelete = true;
        }
      }
      log.info("Scraped feed links:", found, "of potential", scraped.speculativeFeedLinks.length);
      scraped.speculativeFeedLinks = scraped.speculativeFeedLinks.filter(f => !f.shouldDelete);
      if (!scraped.speculativeFeedLinks.length) {
        delete scraped.speculativeFeedLinks;
      }
    }
  }

  async function getFeed(feed, ignoreContentType) {
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
        result.contentType = resp.headers.get("Content-Type").split(";")[0];
        if (!ignoreContentType && !rssContentTypes.includes(result.contentType)) {
          return null;
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

  function installCsp() {
    let options = ["blocking", "responseHeaders"];
    let filter = {
      types: ["main_frame"],
      urls: ["http://*/*", "https://*/*"],
    }
    browser.webRequest.onHeadersReceived.addListener(
      cspHeaderRewriter,
      filter,
      options,
    );
    return () => {
      browser.webRequest.onHeadersReceived.removeListener(
        cspHeaderRewriter,
        filter,
        options,
      );
    }
  }

  function cspHeaderRewriter(info) {
    let headers = info.responseHeaders;
    for (let i = 0; i < headers.length; i++) {
      let name = headers[i].name.toLowerCase();
      if (name === "content-security-policy" || name === "content-security-policy-report-only") {
        headers.splice(i, 1);
        i--;
      }
    }
    headers.push({
      name: "Content-Security-Policy",
      value: restrictiveCsp,
    });
    return {"responseHeaders": headers};
  }

  if (buildSettings.cspRestrict) {
    installCsp();
    log.info("Installed CSP adder for all requests");
  }

  return scrapeTab;
})();
