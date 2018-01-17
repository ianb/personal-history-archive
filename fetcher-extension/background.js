/* globals browser */

const SERVER = "http://localhost:11180";
const SERVER_BASE = "http://localhost";

browser.runtime.onMessage.addListener((message) => {
  if (message.type == "fetchPage") {
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
    }
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
  return browser.tabs.executeScript(tabId, {
    file: "make-static-html.js"
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
  return browser.tabs.create({url, active: false}).then((tab) => {
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
    console.error("Error fetching page", url, error);
    throw error;
  });
}
