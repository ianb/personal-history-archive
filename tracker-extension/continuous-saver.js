/* globals browser */

let browserId;
let currentServerTimestamp;
let lastError;
let lastUpdated;
const SERVER = "http://localhost:11180";
const SERVER_BASE = "http://localhost";
const VERY_BIG_MAX_RESULTS = 1e9;
const UPDATE_SEARCH_PERIOD = 60 * 60 * 1000; // 1 hour

browser.storage.local.get(["browserId"]).then((result) => {
  if (!result.browserId) {
    browserId = makeUuid();
    browser.storage.local.set({browserId}).catch((error) => {
      log.error("Error setting browserId", error);
    });
  } else {
    browserId = result.browserId;
  }
  serverRegister();
}).catch((error) => {
  log.error("Error getting browserId:", error);
});

function makeUuid() { // eslint-disable-line no-unused-vars
  // get sixteen unsigned 8 bit random values
  let randomValues = window
    .crypto
    .getRandomValues(new Uint8Array(36));

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    let i = Array.prototype.slice.call(arguments).slice(-2)[0]; // grab the `offset` parameter
    let r = randomValues[i] % 16|0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type == "requestStatus") {
    return Promise.resolve({
      browserId,
      currentServerTimestamp,
      lastUpdated,
      lastError: lastError ? String(lastError) : null,
      currentPages: Array.from(currentPages.values()),
      pendingPages
    });
  } else if (message.type == "sendNow") {
    return sendNewHistory(message.force).catch((error) => {
      log.error("Error in sendNow:", error);
      throw error;
    });
  } else if (message.type == "flushNow") {
    return flush().catch((error) => {
      log.error("Error in flushNow:", String(error), error);
      throw error;
    });
  }
  autofetchOnMessage(message);
  log.error("Bad message:", message);
});

setInterval(sendNewHistory, UPDATE_SEARCH_PERIOD);

async function sendNewHistory(force) {
    try {
    let startTime;
    let foundStartTime = await serverQueryStartTime(browserId);
    startTime = foundStartTime || 0;
    if (force) {
      startTime = 0;
    }
    currentServerTimestamp = startTime;
    let results = await browser.history.search({
      text: "",
      startTime: startTime || 0,
      maxResults: VERY_BIG_MAX_RESULTS
    });
    let annotatedHistory = await getVisitsForHistoryItems(results, startTime);
    await serverSendHistory(annotatedHistory);
    lastUpdated = Date.now();
  } catch (error) {
    lastError = error;
    throw error;
  }
}

async function serverQueryStartTime(browserId) {
  let status = await communication.status();
  return Math.floor(status || 0);
}

async function serverSendHistory(annotatedHistory) {
  log.info("Sending history", annotatedHistory.length, "items and", Math.floor(body.length / 1000), "kb");
  await communication.add_history_list(annotatedHistory);
}

async function serverRegister() {
  await communication.register_browser();
}

function getVisitsForHistoryItems(historyItems, startTime) {
  let result = {};
  let promises = [];
  historyItems = historyItems.filter((item) => {
    return !item.url.startsWith(SERVER);
  });
  historyItems.forEach((historyItem) => {
    let visits = {};
    result[historyItem.id] = {
      url: historyItem.url,
      title: historyItem.title,
      lastVisitTime: historyItem.lastVisitTime,
      visitCount: historyItem.visitCount,
      typedCount: historyItem.typedCount,
      visits
    };
    promises.push(browser.history.getVisits({
      url: historyItem.url
    }).then((visitItems) => {
      for (let visit of visitItems) {
        if (startTime && visit.visitTime < startTime) {
          continue;
        }
        visits[visit.visitId] = {
          visitTime: visit.visitTime,
          referringVisitId: visit.referringVisitId,
          transition: visit.transition
        };
      }
    }));
  });
  return Promise.all(promises).then(() => {
    return result;
  });
}
