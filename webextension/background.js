let browserId;
const SERVER = "http://localhost:11180"
const SERVER_BASE = "http://localhost"

browser.storage.local.get(["browserId"]).then((result) => {
  if (!result.browserId) {
    browserId = makeUuid();
    browser.storage.local.set({browserId}).catch((error) => {
      console.error("Error setting browserId", error);
    });
  } else {
    browserId = result.browserId;
  }
}).catch((error) => {
  console.error("Error getting browserId:", error);
});

function makeUuid() { // eslint-disable-line no-unused-vars
  // get sixteen unsigned 8 bit random values
  var randomValues = window
    .crypto
    .getRandomValues(new Uint8Array(36));

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var i = Array.prototype.slice.call(arguments).slice(-2)[0]; // grab the `offset` parameter
    var r = randomValues[i] % 16|0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type == "init") {
    return Promise.resolve({browserId});
  } else if (message.type == "history.search") {
    console.log("Searching from", message.startTime || 0, "to", message.endTime, String(new Date(message.endTime)), "for max", message.maxResults);
    return browser.history.search({
      text: "",
      startTime: message.startTime || 0,
      endTime: message.endTime,
      maxResults: message.maxResults
    }).then((results) => {
      let correctResults = [];
      // Workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=1419197
      for (let result of results) {
        console.log(String(new Date(result.lastVisitTime)), result.id, result.lastVisitTime > message.endTime);
        if (result.lastVisitTime < message.endTime) {
          correctResults.push(result);
        }
      }
      console.log("Sending", correctResults.length, "/", results.length);
      return correctResults;
    });
  } else if (message.type == "fetchPage") {
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
    });
  }
  throw new Error("Bad message: " + JSON.stringify(message));
});

browser.browserAction.onClicked.addListener(() => {
  getServerPage().then((tabs) => {
    if (tabs) {
      browser.tabs.update(tabs[0].id, {active: true});
    } else {
      browser.tabs.create({url: SERVER, pinned: true});
    }
  });
});

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

function fetchPage(url) {
  let focusTimer = null;
  let startTime = Date.now();
  return browser.tabs.create({url, active: false}).then((tab) => {
    focusTimer = setInterval(() => {
      browser.tabs.update(tab.id, {active: true});
    }, 5000);
    return browser.tabs.executeScript(tab.id, {
      file: "escape-catcher.js",
      runAt: "document_start"
    }).then(() => {
      return browser.tabs.executeScript(tab.id, {
        file: "make-static-html.js"
      });
    }).then(() => {
      return browser.tabs.executeScript(tab.id, {
        file: "Readability.js"
      });
    }).then(() => {
      return browser.tabs.executeScript(tab.id, {
        file: "extractor-worker.js"
      });
    }).then(() => {
      return browser.tabs.executeScript(tab.id, {
        code: "extractorWorker.documentStaticJson()"
      }).then((resultList) => {
        clearTimeout(focusTimer);
        return browser.tabs.remove(tab.id).then(() => {
          // Remove our own repeated visit:
          browser.history.deleteRange({
            startTime,
            endTime: Date.now()
          });
          return resultList[0];
        });
      });
    });
  }).catch((error) => {
    // FIXME: remove history here too?
    clearTimeout(focusTimer);
    console.error("Error fetching page", url, error);
    throw error;
  });
}
