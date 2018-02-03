/* globals browser */

const SERVER = "http://localhost:11180";
const SERVER_BASE = "http://localhost";
const FETCH_TIMEOUT = 45000;
const IDLE_WAIT_TIME = 2000;

browser.runtime.onMessage.addListener((message) => {
  if (message.type == "fetchPage") {
    if (message.url.startsWith("https://addons.mozilla.org")) {
      return Promise.reject(new Error("Cannot load special URL"));
    }
    return fetchPage(message.url);
  } else if (message.type == "escapeKey") {
    getServerPage().then((tabs) => {
      if (!tabs) {
        return;
      }
      for (let tab of tabs) {
        browser.tabs.sendMessage(tab.id, {
          type: "escapeKey"
        }).catch((error) => {
          console.error("Error sending message to tab:", error);
        });
      }
    }).catch((error) => {
      console.error("Error in getServerPage:", error);
    });
  } else if (message.type == "focusMainTab") {
    return getServerPage().then((tabs) => {
      return browser.tabs.update(tabs[0].id, {active: true});
    });
  } else if (message.type == "setBadgeText") {
    console.error("setting bade text", message.text);
    browser.browserAction.setBadgeText({text: message.text});
    return Promise.resolve();
  } else {
    throw new Error("Bad message: " + JSON.stringify(message));
  }
});

browser.browserAction.onClicked.addListener(() => {
  return browser.tabs.query({
    active: true
  }).then((tabs) => {
    return scrapeTab(tabs[0].id);
  }).then((json) => {
    return browser.tabs.create({url: `${SERVER}/show-json.html`}).then((tab) => {
      return browser.tabs.executeScript({
        file: "inject-json.js"
      }).then(() => {
        return browser.tabs.sendMessage({json});
      });
    });
  }).catch((error) => {
    let s = `Error: ${error}\n\n${error.stack}`;
    let errorUrl = `${SERVER}/echo?type=text/plain&content=${encodeURIComponent(s)}`;
    browser.tabs.create({url: errorUrl});
  });
});

setTimeout(() => {
  getServerPage().then((tabs) => {
    if (!tabs) {
      browser.tabs.create({url: SERVER, pinned: true, active: true});
    } else {
      browser.tabs.update(tabs[0].id, {active: true});
    }
    browser.tabs.query({}).then((tabs) => {
      return browser.tabs.remove(tabs.filter((t) => t.url == "about:newtab").map((t) => t.id));
    }).catch((error) => {
      console.error("Error closing newtabs:", error);
    });
  }).catch((error) => {
    console.error("Error in getServerPage:", error);
  });
}, 2000);

function getServerPage() {
  return browser.tabs.query({
    currentWindow: true,
    url: [SERVER + "/*", SERVER_BASE + "/*"]
  }).then((tabs) => {
    let filtered = [];
    for (let tab of tabs) {
      if (tab.url.startsWith(SERVER)) {
        filtered.push(tab);
      }
    }
    if (!filtered.length) {
      return null;
    }
    return filtered;
  });
}

function scrapeTab(tabId) {
  return waitForStableTab(tabId).then(() => {
    return browser.tabs.executeScript(tabId, {
      file: "make-static-html.js"
    });
  }).then(() => {
    return browser.tabs.executeScript(tabId, {
      file: "Readability.js"
    });
  }).then(() => {
    return browser.tabs.executeScript(tabId, {
      file: "extractor-worker.js"
    });
  }).then(() => {
    return browser.tabs.executeScript(tabId, {
      code: "extractorWorker.documentStaticJson()"
    });
  }).then((resultList) => {
    return resultList[0];
  });
}

function fetchPage(url) {
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
        file: "escape-catcher.js",
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
      console.error("Error fetching page", url, error);
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

function setTimeoutPromise(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
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
