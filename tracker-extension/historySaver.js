/* globals browser, log, communication, buildSettings */

this.historySaver = (function() {
  let exports = {};

  let browserId;
  let currentServerTimestamp;
  let lastError;
  let lastUpdated;
  const VERY_BIG_MAX_RESULTS = 1e9;

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
    autofetchListener.autofetchOnMessage(message);
    log.error("Bad message:", message);
  });

  setInterval(sendNewHistory, buildSettings.updateSearchPeriod);

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
    log.info("Sending history", annotatedHistory.length);
    await communication.add_history_list(annotatedHistory);
  }

  function getVisitsForHistoryItems(historyItems, startTime) {
    let result = {};
    let promises = [];
    historyItems = historyItems.filter((item) => {
      return !item.url.startsWith(buildSettings.server);
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

  return exports;
})();
