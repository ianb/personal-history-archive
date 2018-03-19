/* globals browser, buildSettings, scrapeTab, log, communication */

this.autofetchListener = (function() {
  let exports = {};

  const FETCH_TIMEOUT = 45000;

  backgroundOnMessage.register("fetchPage", (message) => {
    if (message.url.startsWith("https://addons.mozilla.org")) {
      throw new Error("Cannot load special URL");
    }
    return fetchPage(message.url);
  });

  backgroundOnMessage.register("escapeKey", async (message) => {
    let tabs = await getServerPage();
    if (!tabs) {
      return;
    }
    for (let tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, {
          type: "escapeKey"
        });
      } catch (error) {
        log.error("Error sending message to tab:", error);
      }
    }
  });

  backgroundOnMessage.register("focusMainTab", async (message) => {
    let tabs = await getServerPage();
    return browser.tabs.update(tabs[0].id, {active: true});
  });

  backgroundOnMessage.register("setBadgeText", (message) => {
    browser.browserAction.setBadgeText({text: message.text});
  });

  backgroundOnMessage.register("add_fetched_page", (message) => {
    return communication.add_fetched_page(message.url, message.page);
  });

  backgroundOnMessage.register("get_needed_pages", (message) => {
    return communication.get_needed_pages(message.limit);
  });

  backgroundOnMessage.register("add_fetch_failure", (message) => {
    return communication.add_fetch_failure(message.url, message.error_message);
  });

  async function getServerPage() {
    let tabs = await browser.tabs.query({
      currentWindow: true,
      url: [buildSettings.server + "/fetcher.html", buildSettings.serverBase + "/fetcher.html"]
    });
    let filtered = [];
    for (let tab of tabs) {
      if (tab.url.startsWith(buildSettings.server)) {
        filtered.push(tab);
      }
    }
    if (!filtered.length) {
      return null;
    }
    return filtered;
  }

  function fetchPage(url) {
    // FIXME: convert to async/await. This will be harder because timeoutPromise is not a
    // normal promise pattern
    let focusTimer = null;
    if (/^https?:\/\/(www\.youtube\.com|m\.youtube\.com|youtu\.be)\/watch\?/.test(url)) {
      // This keeps the YouTube videos from auto-playing:
      url += "&start=86400";
    }
    let tabId;
    return timeoutPromise(
      FETCH_TIMEOUT,
      browser.tabs.create({url, active: false}).then((tab) => {
        tabId = tab.id;
        focusTimer = setInterval(() => {
          browser.tabs.update(tab.id, {active: true});
        }, 10000);
        return browser.tabs.executeScript(tab.id, {
          file: "autofetch/escape-catcher.js",
          runAt: "document_start"
        }).then(() => {
          return scrapeTab(tab.id);
        }).then((result) => {
          clearTimeout(focusTimer);
          return browser.tabs.remove(tab.id).then(() => {
            return result;
          });
        });
      }).catch((error) => {
        // FIXME: remove history here too?
        clearTimeout(focusTimer);
        if (tabId) {
          browser.tabs.remove(tabId);
        }
        log.error("Error fetching page", url, error);
        throw error;
      }),
      () => {
        clearTimeout(focusTimer);
        if (tabId) {
          browser.tabs.remove(tabId);
        }
        throw new Error("Timeout");
      }
    );
  }

  function timeoutPromise(time, promise, onCancel) {
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        cancelled = true;
        if (onCancel instanceof Error) {
          reject(onCancel);
        } else {
          try {
            let result = Promise.resolve(onCancel());
            result.then(resolve).catch(reject);
          } catch (e) {
            reject(e);
          }
        }
      }, time);
      let cancelled = false;
      promise.then((result) => {
        if (!cancelled) {
          clearTimeout(timer);
          resolve(result);
        }
      }).catch((error) => {
        if (!cancelled) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }


  return exports;
})();
