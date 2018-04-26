/* globals browser, log, communication, buildSettings, backgroundOnMessage, activityTracker, catcher */

this.historySaver = (function() {
  let exports = {};

  let browserId;
  let currentServerTimestamp;
  let lastError;
  let lastUpdated;
  const VERY_BIG_MAX_RESULTS = 1e9;

  backgroundOnMessage.register("requestStatus", catcher.watchFunction((message) => {
    return Object.assign({
      browserId,
      currentServerTimestamp,
      lastUpdated,
      lastError: lastError ? String(lastError) : null,
    }, activityTracker.status());
  }));

  backgroundOnMessage.register("sendNow", catcher.watchFunction((message) => {
    let force = "force" in message ? message.force : false;
    return sendNewHistory(force);
  }));

  backgroundOnMessage.register("flushNow", catcher.watchFunction((message) => {
    return activityTracker.flush().catch((error) => {
      log.error("Error in flushNow:", String(error), error);
      throw error;
    });
  }));

  setInterval(catcher.watchFunction(sendNewHistory), buildSettings.updateServerPeriod);

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
    log.info("Sending history", Object.keys(annotatedHistory).length);
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
