const { dbAll } = require("./db");
const { pageExists } = require("./json-files");

exports.getAllPageData = function() {
  return dbAll(`
    SELECT
      page.url,
      history.id AS history_id,
      history.browser_id,
      browser.user_agent,
      history.title,
      history.lastVisitTime,
      history.visitCount,
      visit.id AS visit_id,
      visit.visitTime,
      visit.referringVisitId,
      visit.transition,
      page.fetched,
      page.timeToFetch,
      page.redirectUrl
    FROM history, visit, page, browser
    WHERE history.id = visit.history_id
      AND page.url = history.url
      AND browser.id = history.browser_id
    ORDER BY visit.visitTime DESC
  `).then((rows) => {
    let result = [];
    let promise = Promise.resolve();
    for (let row of rows) {
      promise = promise.then(() => {
        return pageExists(row.url).then((exists) => {
          if (exists) {
            result.push(row);
          }
        });
      });
    }
    return promise.then(() => {
      return result;
    });
  }).then((rows) => {
    let result = [];
    let pages = {};
    for (let row of rows) {
      let page = pages[row.url];
      if (!page) {
        page = pages[row.url] = {histories: {}};
        result.push(page);
      }
      let histories = page.histories;
      page.url = row.url;
      page.fetched = row.fetched;
      page.timeToFetch = row.timeToFetch;
      page.redirectUrl = row.redirectUrl;
      let history = histories[row.history_id];
      if (!history) {
        history = histories[row.history_id] = {visits: {}};
      }
      history.title = row.title;
      if (!page.title) {
        page.title = row.title;
      }
      history.lastVisitTime = row.lastVisitTime;
      history.visitCount = row.visitCount;
      history.browser_id = row.browser_id;
      history.user_agent = row.user_agent;
      let visit = history.visits[row.visit_id];
      if (!visit) {
        visit = history.visits[row.visit_id] = {};
      }
      visit.visitTime = row.visitTime;
      visit.referringVisitId = row.referringVisitId;
      visit.refer_url = row.refer_url;
      visit.refer_title = row.refer_title;
      visit.transition = row.transition;
    }
    return result;
  });
};
