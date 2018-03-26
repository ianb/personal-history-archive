/* globals log, communication, buildSettings, scrapeTab, util, catcher, sessionId */

this.activityTracker = (function() {
  let exports = {};

  let standardRequestFilter = {
    urls: ["http://*/*", "https://*/*"],
    types: ["main_frame"]
  };


  // FIXME: track pinned tabs
  let currentPages = new Map();
  let pendingAnnotations = new Map();
  let activeTabId;
  let pendingPages = [];
  // This represents pages we'd like to serialize, but haven't yet, as a mapping of tabId
  // to URL
  let pagesToSerialize = new Map();
  let urlsAlreadySerialized = new Set();

  class Page {
    constructor(options) {
      this.id = util.makeUuid();
      this.url = options.url;
      this.loadTime = options.timeStamp;
      this.unloadTime = null;
      this.transitionType = options.transitionType;
      for (let name of ["client_redirect", "server_redirect", "forward_back", "from_address_bar"]) {
        this[name] = (!!options.transitionQualifiers) && options.transitionQualifiers.includes(name);
      }
      this.sourceId = options.previous && options.previous.id;
      this.newTab = !!options.newTab;
      this.isHashChange = !!options.isHashChange;
      this.initialLoadId = options.initialLoadId || null;
      this.active = false;
      this.activeCount = 0;
      this.closed = false;
      this.closedReason = null;
      this._activeStartTime = null;
      this._activeCumulatedTime = 0;
      this.method = null;
      this.statusCode = null;
      this.contentType = null;
      this.hasSetCookie = null;
      this.sessionId = sessionId;
    }

    toJSON() {
      let clone = {...this};
      delete clone._activeStartTime;
      delete clone._activeCumulatedTime;
      delete clone.closed;
      clone.activeTime = this.activeTime;
      return clone;
    }

    setActive() {
      this.active = true;
      this._activeStartTime = Date.now();
      this.activeCount++;
    }

    setInactive() {
      this.active = false;
      if (Date.now() - this._activeStartTime < 1000) {
        // It got deactivated so quickly we shouldn't include it in activeCount
        this.activeCount--;
      }
      this._activeCumulatedTime += Date.now() - this._activeStartTime;
      this._activeStartTime = null;
    }

    get activeTime() {
      let adjust = 0;
      if (this.active) {
        adjust = Date.now() - this._activeStartTime;
      }
      return this._activeCumulatedTime + adjust;
    }

    close(reason) {
      if (this.active) {
        this.setInactive();
      }
      this.unloadTime = Date.now();
      this.closed = true;
      this.closedReason = reason;
    }

    addToScrapedData(scraped) {
      for (let prop of ["loadTime", "transitionType", "client_redirect", "server_redirect", "forward_back", "from_address_bar", "method", "statusCode", "contentType", "hasSetCookie"]) {
        scraped[prop] = this[prop];
      }
    }
  }


  function addNewPage({tabId, url, timeStamp, transitionType, transitionQualifiers, sourceTabId, newTab, isHashChange}) {
    let previous;
    if (sourceTabId) {
      previous = currentPages.get(sourceTabId);
    } else if (tabId) {
      previous = currentPages.get(tabId);
      if (previous && previous.url === url && previous.newTab && !newTab) {
        // Pages created as new tabs frequently appear twice due to events
        return;
      }
      if (previous) {
        closePage(tabId, "navigation");
      }
    }
    let page = new Page({url, timeStamp, transitionType, transitionQualifiers, previous, newTab, isHashChange});
    if (isHashChange && previous) {
      page.initialLoadId = previous.initialLoadId || previous.id;
    }
    currentPages.set(tabId, page);
    if (tabId == activeTabId) {
      page.setActive();
    }
    let annotations = pendingAnnotations.get(tabId);
    if (annotations && annotations.url === url) {
      pendingAnnotations.delete(tabId);
      annotatePage(annotations);
    }
  }

  function closePage(tabId, reason) {
    if (!tabId) {
      throw new Error("closePage with no tabId");
    }
    let page = currentPages.get(tabId);
    log.debug("closing", tabId, reason, page && page.url);
    page.close(reason);
    currentPages.delete(tabId);
    pendingPages.push(page);
  }

  function addNewFragment({tabId, url, timeStamp, transitionType, transitionQualifiers}) {
    addNewPage({tabId, url, timeStamp, transitionType, transitionQualifiers, isHashChange: true});
  }

  function annotatePage({tabId, url, originUrl, method, statusCode, contentType, hasSetCookie}) {
    // FIXME: I think we don't need originUrl
    let page = currentPages.get(tabId);
    if (!page) {
      log.warn("Cannot annotate tab", tabId, "url:", url);
      return;
    }
    if (page.url == url) {
      page.method = method;
      page.statusCode = statusCode;
      page.contentType = contentType;
      page.hasSetCookie = hasSetCookie;
    } else {
      pendingAnnotations.set(tabId, {
        tabId, url, method, statusCode, contentType, hasSetCookie
      });
    }
  }

  function setActiveTabId(tabId) {
    if (activeTabId) {
      let current = currentPages.get(activeTabId);
      if (current) {
        current.setInactive();
      } else {
        log.warn("Trying to change activeTabId from", activeTabId, "to", tabId, "but the original tab isn't being tracked");
      }
    }
    let current = currentPages.get(tabId);
    if (!current) {
      log.warn("Unexpectedly unable to get page from tab", tabId);
    } else {
      current.setActive();
    }
    activeTabId = tabId;
  }

  browser.webNavigation.onCommitted.addListener(catcher.watchFunction((event) => {
    if (event.frameId) {
      return;
    }
    let {tabId, url, timeStamp, transitionType, transitionQualifiers} = event;
    if (!url) {
      log.warn("Got onCommitted with no URL", tabId);
      return;
    }
    addPageToSerialize(tabId, url);
    addNewPage({
      tabId, url, timeStamp, transitionType, transitionQualifiers
    });
  }));

  browser.webNavigation.onCreatedNavigationTarget.addListener(catcher.watchFunction((event) => {
    if (event.frameId) {
      return;
    }
    let {sourceTabId, tabId, timeStamp, url} = event;
    if (!url) {
      log.warn("Got onCreatedNavigationTarget with no URL", tabId);
      return;
    }
    addPageToSerialize(tabId, url);
    addNewPage({
      tabId, url, timeStamp, sourceTabId, newTab: true
    });
  }));

  browser.webNavigation.onHistoryStateUpdated.addListener(catcher.watchFunction((event) => {
    if (event.frameId) {
      return;
    }
    let {tabId, url, timeStamp, transitionType, transitionQualifiers} = event;
    if (!url) {
      log.warn("Got onHistoryStateUpdated with no URL", tabId);
      return;
    }
    addPageToSerialize(tabId, url);
    addNewPage({
      tabId, url, timeStamp, transitionType, transitionQualifiers
    });
  }));

  browser.webNavigation.onReferenceFragmentUpdated.addListener(catcher.watchFunction((event) => {
    if (event.frameId) {
      return;
    }
    let {tabId, url, timeStamp, transitionType, transitionQualifiers} = event;
    if (!url) {
      log.warn("Got onReferenceFragmentUpdated with no URL", tabId);
      return;
    }
    addPageToSerialize(tabId, url);
    addNewFragment({
      tabId, url, timeStamp, transitionType, transitionQualifiers
    });
  }));

  browser.webRequest.onHeadersReceived.addListener(catcher.watchFunction((event) => {
    if (event.frameId) {
      return;
    }
    let {method, originUrl, responseHeaders, statusCode, tabId, url} = event;
    let contentType;
    let hasSetCookie;
    if (!responseHeaders) {
      log.error("no response headers", method, originUrl, url, tabId, statusCode);
    }
    if (responseHeaders) {
      hasSetCookie = false;
      for (let header of responseHeaders) {
        if (header.name.toLowerCase() === "content-type") {
          contentType = header.value;
        } else if (header.name.toLowerCase() == "set-cookie") {
          hasSetCookie = true;
        }
      }
    }
    annotatePage({
      tabId, url, originUrl, method, statusCode, contentType, hasSetCookie
    });
  }), standardRequestFilter, ["responseHeaders"]);

  browser.tabs.onActivated.addListener(catcher.watchFunction((event) => {
    let current = currentPages.get(event.tabId);
    log.debug("Set active:", event.tabId, current ? current.url : "unknown");
    setActiveTabId(event.tabId);
  }));

  browser.tabs.onRemoved.addListener(catcher.watchFunction((event) => {
    closePage(event.tabId, "tabClose");
  }));

  catcher.watchPromise(browser.tabs.query({}).then((tabs) => {
    for (let tab of tabs) {
      if (tab.active) {
        activeTabId = tab.id;
      }
      // FIXME: use isArticle and isInReadableMode
      // FIXME: use lastAccessed (not sure if this is meaningful?)
      // FIXME: use openerTabId (maybe not worth it?)
      addPageToSerialize(tab.id, tab.url);
      addNewPage({
        tabId: tab.id,
        url: tab.url,
        timeStamp: Date.now(),
        transitionType: "existed_onload",
        transitionQualifiers: []
      });
    }
  }));

  function pagePossiblyAllowed(url) {
    let u = new URL(url);
    if (!["http:", "https:", "file:", "data:"].includes(u.protocol)) {
      return false;
    }
    if (u.hostname == "addons.mozilla.org" || u.hostname == "testpilot.firefox.com") {
      return false;
    }
    return true;
  }

  async function checkIfUrlNeeded(url) {
    if (!pagePossiblyAllowed(url)) {
      return false;
    }
    if (urlsAlreadySerialized.has(url)) {
      return false;
    }
    let needed = await communication.check_page_needed(url);
    if (needed) {
      urlsAlreadySerialized.add(url);
    }
    return needed;
  }

  async function addPageToSerialize(tabId, url) {
    log.debug("ready to load:", tabId, url);
    // Any old page is now invalid:
    pagesToSerialize.delete(tabId);
    let needed = await checkIfUrlNeeded(url);
    log.debug("attempting to serialize", tabId, url, "needed:", needed);
    if (needed) {
      pagesToSerialize.set(tabId, url);
      startQueue(tabId, url);
    } else {
      log.debug("loading was not necessary:", tabId, url);
    }
  }

  async function startQueue(tabId, url) {
    let id = util.makeUuid();
    let page = currentPages.get(tabId);
    if (page.url !== url) {
      log.warn(`Page in tab ${tabId} (url=${page.url}) doesn't match expected scraping URL ${url}`);
      page = null;
    }
    await util.sleep(buildSettings.historyPauseBeforeCollection);
    let scraped;
    try {
      scraped = await scrapeTab(tabId, url);
    } catch (e) {
      log.warn("Failed to fetch", url, "Error:", e);
    }
    if (!scraped) {
      log.info("Could not scrape", url, "from", tabId);
      if (pagesToSerialize.get(tabId) == url) {
        pagesToSerialize.delete(tabId);
      }
      return;
    }
    if (page) {
      page.addToScrapedData(scraped);
      scraped.activityId = page.id;
    }
    log.debug("Successfully sending", url, "from", tabId);
    await communication.add_fetched_page(id, url, scraped);
  }

  async function flush() {
    let pages = Array.from(currentPages.values());
    pages = pages.concat(pendingPages);
    await communication.add_activity_list(pages);
    log.info("Sent", pages.length, "pages of activity");
    pendingPages = [];
  }

  exports.flush = flush;

  exports.status = function() {
    return {
      currentPages: Array.from(currentPages.values()),
      pendingPages,
    };
  };

  setInterval(catcher.watchFunction(flush), buildSettings.updateSearchPeriod / 4 + 1000);

  return exports;
})();
