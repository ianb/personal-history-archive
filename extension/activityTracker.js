/* globals log, communication, buildSettings, scrapeTab, util, catcher, sessionId, backgroundOnMessage, contentLoader */

this.activityTracker = (function() {
  let exports = {};

  let baseDevicePixelRatio = window.devicePixelRatio;

  let standardRequestFilter = {
    urls: ["http://*/*", "https://*/*"],
    types: ["main_frame"]
  };

  exports.Tracker = class Tracker {
    constructor() {
      // FIXME: track pinned tabs
      this.currentPages = new Map();
      this.pendingAnnotations = new Map();
      this.lastClickInformation = new Map();
      this.activeTabId = null;
      this.pendingPages = [];
      // This represents pages we'd like to serialize, but haven't yet, as a mapping of tabId
      this.pagesToSerialize = new Map();
      this.urlsAlreadySerialized = new Set();
      this.backgroundListeners = new Map();
      this.handlers = new Map();
      for (let name of Object.getOwnPropertyNames(exports.Tracker.prototype)) {
        if (name.startsWith("background_")) {
          let func = this[name].bind(this);
          this[name] = func;
          let messageName = name.substr("background_".length);
          this.backgroundListeners.set(messageName, func);
        }
        if (name.startsWith("handler_")) {
          let func = catcher.watchFunction(this[name].bind(this));
          this[name] = func;
          let parts = name.split("_");
          parts.shift();
          if (!this.handlers.get(parts[0])) {
            this.handlers.set(parts[0], new Map());
          }
          this.handlers.get(parts[0]).set(parts[1], func);
        }
      }
      this.flush = this.flush.bind(this);
    }

    /** **********************************************************
     * Initialization routines
     */

    init() {
      this.addBrowserHandlers();
      this.addPageListeners();
      this.addSender();
      this._cancelLoader = contentLoader.trackTabs();
    }

    uninit() {
      this._cancelLoader();
      this._cancelLoader = null;
      this.removeSender();
      this.removePageListeners();
      this.removeBrowserHandlers();
    }

    async flush() {
      let pages = Array.from(this.currentPages.values());
      if (!pages.length) {
        return;
      }
      pages = pages.concat(this.pendingPages);
      await communication.add_activity_list(pages);
      if (this.pendingPages.length) {
        log.info("Sent", pages.length, "pages of activity");
      }
      this.pendingPages = [];
    }

    addSender() {
      clearInterval(this._senderId);
      this._senderId = setInterval(this.flush, buildSettings.updateServerPeriod / 4 + 1000);
    }

    removeSender() {
      clearInterval(this._senderId);
      this._senderId = null;
    }

    addBrowserHandlers() {
      let special = ["onHeadersReceived", "onSendHeaders"];
      for (let [propName, events] of this.handlers.entries()) {
        for (let [eventName, func] of events.entries()) {
          if (!special.includes(eventName)) {
            browser[propName][eventName].addListener(func);
          }
        }
      }
      browser.webRequest.onHeadersReceived.addListener(
        this.handlers.get("webRequest").get("onHeadersReceived"),
        standardRequestFilter,
        ["responseHeaders"],
      );
      browser.webRequest.onSendHeaders.addListener(
        this.handlers.get("webRequest").get("onSendHeaders"),
        standardRequestFilter,
        ["requestHeaders"],
      );
    }

    removeBrowserHandlers() {
      for (let [propName, events] of this.handlers.entries()) {
        for (let [eventName, func] of events.entries()) {
          if (!browser[propName][eventName].hasListener(func)) {
            log.warn(`Trying to remove a browser handler that isn't registered: ${propName}.${eventName}`);
          }
          browser[propName][eventName].removeListener(func);
        }
      }
    }

    addPageListeners() {
      for (let [messageName, func] of this.backgroundListeners.entries()) {
        backgroundOnMessage.registerListener(messageName, func);
      }
    }

    removePageListeners() {
      for (let [messageName, func] of this.backgroundListeners.entries()) {
        backgroundOnMessage.unregister(messageName, func);
      }
    }

    async trackOpenedTabs() {
      let tabs = await browser.tabs.query({});
      for (let tab of tabs) {
        if (tab.active) {
          this.activeTabId = tab.id;
        }
        // FIXME: use isArticle and isInReadableMode
        // FIXME: use lastAccessed (not sure if this is meaningful?)
        // FIXME: use openerTabId (maybe not worth it?)
        this.addPageToSerialize(tab.id, tab.url);
        this.addNewPage({
          tabId: tab.id,
          title: tab.title,
          url: tab.url,
          timeStamp: Date.now(),
          transitionType: "existed_onload",
          transitionQualifiers: []
        });
      }
    }

    addNewPage({tabId, url, timeStamp, transitionType, transitionQualifiers, sourceTabId, newTab, isHashChange, title}) {
      let previous;
      if (sourceTabId) {
        previous = this.currentPages.get(sourceTabId);
      } else if (tabId) {
        previous = this.currentPages.get(tabId);
        if (previous && previous.url === url && previous.newTab && !newTab) {
          // Pages created as new tabs frequently appear twice due to events
          return;
        }
        if (previous) {
          this.closePage(tabId, "navigation");
        }
      }
      let sourceClick = this.lastClickInformation.get(tabId) || {};
      this.lastClickInformation.delete(tabId);
      let page = new Page({url, timeStamp, transitionType, transitionQualifiers, previous, newTab, isHashChange, title, sourceClickText: sourceClick.text, sourceClickHref: sourceClick.href});
      if (isHashChange && previous) {
        page.initialLoadId = previous.initialLoadId || previous.id;
      }
      this.currentPages.set(tabId, page);
      if (tabId === this.activeTabId) {
        page.setActive();
      }
      let annotations = this.pendingAnnotations.get(tabId);
      if (annotations && annotations.url === url) {
        this.pendingAnnotations.delete(tabId);
        this.annotatePage(annotations);
      }
    }

    closePage(tabId, reason) {
      if (!tabId) {
        throw new Error("closePage with no tabId");
      }
      let page = this.currentPages.get(tabId);
      log.debug("closing", tabId, reason, page && page.url);
      page.close(reason);
      this.currentPages.delete(tabId);
      this.pendingPages.push(page);
    }

    addNewFragment({tabId, url, timeStamp, transitionType, transitionQualifiers}) {
      this.addNewPage({tabId, url, timeStamp, transitionType, transitionQualifiers, isHashChange: true});
    }

    annotatePage(options) {
      let {tabId, url} = options;
      delete options.tabId;
      delete options.url;
      let page = this.currentPages.get(tabId);
      if (!page) {
        log.warn("Cannot annotate tab", tabId, "url:", url);
        return;
      }
      if (page.url === url) {
        Object.assign(page, options);
      } else {
        let existing = this.pendingAnnotations.get(tabId);
        if (existing && existing.url === url) {
          options = Object.assign(existing, options);
        }
        this.pendingAnnotations.set(tabId, Object.assign({tabId, url}, options));
      }
    }

    setActiveTabId(tabId) {
      if (this.activeTabId) {
        let current = this.currentPages.get(this.activeTabId);
        if (current) {
          current.setInactive();
        } else {
          log.warn("Trying to change activeTabId from", this.activeTabId, "to", tabId, "but the original tab isn't being tracked");
        }
      }
      let current = this.currentPages.get(tabId);
      if (!current) {
        log.warn("Unexpectedly unable to get page from tab", tabId);
      } else {
        current.setActive();
      }
      this.activeTabId = tabId;
    }

    /** **********************************************************
     * Job queues
     */

    async checkIfUrlNeeded(url) {
      if (!pagePossiblyAllowed(url)) {
        return false;
      }
      if (this.urlsAlreadySerialized.has(url)) {
        return false;
      }
      let needed = await communication.check_page_needed(url);
      if (needed) {
        this.urlsAlreadySerialized.add(url);
      }
      return needed;
    }

    async startQueue(tabId, url) {
      let id = util.makeUuid();
      let page = this.currentPages.get(tabId);
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
        if (this.pagesToSerialize.get(tabId) === url) {
          this.pagesToSerialize.delete(tabId);
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

    async addPageToSerialize(tabId, url) {
      log.debug("ready to load:", tabId, url);
      // Any old page is now invalid:
      this.pagesToSerialize.delete(tabId);
      let needed = await this.checkIfUrlNeeded(url);
      log.debug("attempting to serialize", tabId, url, "needed:", needed);
      if (needed) {
        this.pagesToSerialize.set(tabId, url);
        this.startQueue(tabId, url);
      } else {
        log.debug("Page has already been serialized:", tabId, url);
      }
    }

    /** **********************************************************
     * Handlers
     */

    handler_webNavigation_onCommitted(event) {
      if (event.frameId) {
        return;
      }
      let {tabId, url, timeStamp, transitionType, transitionQualifiers} = event;
      if (!url) {
        log.warn("Got onCommitted with no URL", tabId);
        return;
      }
      this.addPageToSerialize(tabId, url);
      this.addNewPage({
        tabId, url, timeStamp, transitionType, transitionQualifiers
      });
    }

    handler_webNavigation_onHistoryStateUpdated(event) {
      if (event.frameId) {
        return;
      }
      let {tabId, url, timeStamp, transitionType, transitionQualifiers} = event;
      if (!url) {
        log.warn("Got onHistoryStateUpdated with no URL", tabId);
        return;
      }
      this.addPageToSerialize(tabId, url);
      this.addNewPage({
        tabId, url, timeStamp, transitionType, transitionQualifiers
      });
    }

    handler_webNavigation_onReferenceFragmentUpdated(event) {
      if (event.frameId) {
        return;
      }
      let {tabId, url, timeStamp, transitionType, transitionQualifiers} = event;
      if (!url) {
        log.warn("Got onReferenceFragmentUpdated with no URL", tabId);
        return;
      }
      this.addPageToSerialize(tabId, url);
      this.addNewFragment({
        tabId, url, timeStamp, transitionType, transitionQualifiers
      });
    }

    handler_webRequest_onHeadersReceived(event) {
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
            contentType = header.value && header.value.split(";")[0];
          } else if (header.name.toLowerCase() === "set-cookie") {
            hasSetCookie = true;
          }
        }
      }
      this.annotatePage({
        tabId, url, method, statusCode, contentType, hasSetCookie
      });
    }

    handler_webRequest_onSendHeaders(event) {
      if (event.frameId) {
        return;
      }
      let {tabId, requestHeaders, url} = event;
      if (!requestHeaders) {
        log.error("no request headers", url);
        return;
      }
      let hasCookie = false;
      for (let header of requestHeaders) {
        if (header.name.toLowerCase() === "cookie") {
          hasCookie = true;
          break;
        }
      }
      this.annotatePage({
        tabId, url, hasCookie
      });
    }

    handler_tabs_onActivated(event) {
      let current = this.currentPages.get(event.tabId);
      log.debug("Set active:", event.tabId, current ? current.url : "unknown");
      this.setActiveTabId(event.tabId);
    }

    handler_tabs_onRemoved(tabId) {
      this.closePage(tabId, "tabClose");
    }

    background_anchorClick(message) {
      this.lastClickInformation.set(message.senderTabId, {text: message.text, href: message.href});
    }

    background_copy(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got copy event for a tab that isn't in our record:", message);
        return;
      }
      page.copyEvents.push({text: message.text, startLocation: message.startLocation, endLocation: message.endLocation, time: Date.now()});
    }

    background_change(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got change event for a tab that isn't in our record:", message);
        return;
      }
      if (message.isText) {
        page.formTextInteraction++;
      } else {
        page.formControlInteraction++;
      }
    }

    background_scroll(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got scroll event for a tab that isn't in our record:", message);
        return;
      }
      page.maxScroll = message.maxScroll;
      page.documentHeight = message.documentHeight;
    }

    background_hashchange(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got hashchange event for a tab that isn't in our record:", message);
        return;
      }
      if (page.hash !== message.hash) {
        log.warn(`Got hashchange event for a tab with an unmatching hash (not ${page.hash})`, message);
        return;
      }
      page.hashPointsToElement = message.hasElement;
    }

    background_idle(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got idle event for a tab that isn't in our record:", message);
        return;
      }
      if (!page.active) {
        log.warn("Got idle event for a tab that isn't active:", message);
        return;
      }
      page.setInactive();
    }

    background_activity(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got activity event for a tab that isn't in our record:", message);
        return;
      }
      if (page.active) {
        log.warn("Got activity event for a tab that is already active:", message);
        return;
      }
      if (message.senderTabId !== this.activeTabId) {
        log.warn("Got activity even for a tab that isn't the active tab:", message);
        return;
      }
      page.setActive();
    }

    background_devicePixelRatio(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got devicePixelRatio event for a tab that isn't in our record:", message);
        return;
      }
      page.zoomLevel = message.devicePixelRatio / baseDevicePixelRatio;
    }

    background_basicPageMetadata(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got basicPageMetadata event for a tab that isn't in our record:", message);
        return;
      }
      if (message.canonicalUrl) {
        page.canonicalUrl = message.canonicalUrl;
      }
      page.title = message.title;
      if (message.ogTitle) {
        page.ogTitle = message.ogTitle;
      }
    }

    background_feedInformation(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got feedInformation event for a tab that isn't in our record:", message);
        return;
      }
      page.mainFeedUrl = message.mainFeedUrl;
      page.allFeeds = message.allFeeds;
    }

    background_linkInformation(message) {
      let page = this.currentPages.get(message.senderTabId);
      if (!page) {
        log.warn("Got linkInformation event for a tab that isn't in our record:", message);
        return;
      }
      page.linkInformation = message.linkInformation;
    }

  };

  class Page {
    constructor(options) {
      this.id = util.makeUuid();
      this.url = options.url;
      this.title = options.title || null;
      this.ogTitle = options.ogTitle || null;
      this.loadTime = options.timeStamp;
      this.unloadTime = null;
      this.transitionType = options.transitionType;
      for (let [name, dest] of [["client_redirect", "clientRedirect"], ["server_redirect", "serverRedirect"], ["forward_back", "forwardBack"], ["from_address_bar", "fromAddressBar"]]) {
        this[dest] = (!!options.transitionQualifiers) && options.transitionQualifiers.includes(name);
      }
      this.sourceId = options.previous && options.previous.id;
      this.newTab = !!options.newTab;
      this.isHashChange = !!options.isHashChange;
      this.initialLoadId = options.initialLoadId || null;
      this.sourceClickText = options.sourceClickText === undefined ? null : options.sourceClickText;
      this.sourceClickHref = options.sourceClickHref === undefined ? null : options.sourceClickHref;
      this.copyEvents = [];
      this.formControlInteraction = 0;
      this.formTextInteraction = 0;
      this.maxScroll = 0;
      this.documentHeight = null;
      this.hashPointsToElement = null;
      this.zoomLevel = null;
      this.canonicalUrl = null;
      this.mainFeedUrl = null;
      this.allFeeds = null;
      this.linkInformation = null;
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
      this.hasCookie = null;
      this.sessionId = sessionId;
    }

    toJSON() {
      let clone = {...this};
      delete clone.active;
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

    get hash() {
      let hash = (new URL(this.url)).hash;
      if (!hash || hash === "#") {
        return "";
      }
      return hash.substr(1);
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

  function pagePossiblyAllowed(url) {
    let u = new URL(url);
    if (!["http:", "https:", "file:", "data:"].includes(u.protocol)) {
      return false;
    }
    if (u.hostname === "addons.mozilla.org" || u.hostname === "testpilot.firefox.com") {
      return false;
    }
    return true;
  }

  return exports;
})();
