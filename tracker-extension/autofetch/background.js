/* globals browser */

const FETCH_TIMEOUT = 45000;
const IDLE_WAIT_TIME = 2000;

async function autofetchOnMessage(message) {
  if (message.type == "fetchPage") {
    if (message.url.startsWith("https://addons.mozilla.org")) {
      throw new Error("Cannot load special URL");
    }
    return fetchPage(message.url);
  } else if (message.type == "escapeKey") {
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
        console.error("Error sending message to tab:", error);
      }
    }
  } else if (message.type == "focusMainTab") {
    let tabs = await getServerPage();
    return await browser.tabs.update(tabs[0].id, {active: true});
  } else if (message.type == "setBadgeText") {
    browser.browserAction.setBadgeText({text: message.text});
    return;
  } else {
    throw new Error("Bad message: " + JSON.stringify(message));
  }
}

async function getServerPage() {
  let tabs = await browser.tabs.query({
    currentWindow: true,
    url: [SERVER + "/fetcher.html", SERVER_BASE + "/fetcher.html"]
  });
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
  }
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
