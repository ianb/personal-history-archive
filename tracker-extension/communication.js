/* globals buildSettings, log, browserId */

/** Routines to communicate with the backend via native connection */
this.communication = (function() {
  let exports = {};
  let port = browser.runtime.connectNative(buildSettings.nativeScriptName);
  let responderId = 1;
  let responders = new Map();

  function portCall(name, args, kwargs) {
    args = args || [];
    kwargs = kwargs || {};
    let id = responderId++;
    port.postMessage({name, args, kwargs, id});
    return new Promise((resolve, reject) => {
      responders.set(id, {resolve, reject, name});
    });
  }

  port.onMessage.addListener((message) => {
    let id = message.id;
    let responder = responders.get(id);
    if ('result' in message) {
      responder.resolve(message.result);
    } else if (message.error) {
      // Using console.error so we don't ever send this back to the server:
      console.error("Error calling", responder.name, ":", message.error, message.traceback);
      responder.reject(new Error(`Backend error: ${message.error}`));
    } else {
      log.warn("Response without result/error:", message);
    }
    responders.delete(id);
  });

  /* Each of these exported functions is a function in pha.saver: */

  exports.add_history_list = function(historyItems) {
    return portCall("add_history_list", [], {browserId, historyItems});
  };

  exports.add_activity_list = function(activityItems) {
    return portCall("add_activity_list", [], {browserId, activityItems});
  };

  exports.register_browser = function() {
    return portCall("register_browser", [], {
      browserId,
      userAgent: navigator.userAgent,
      testing: buildSettings.testingBrowser,
      autofetch: buildSettings.autofetchBrowser,
    });
  };

  exports.register_session = function(sessionId) {
    return portCall("register_session", [sessionId, browserId]);
  };

  exports.get_needed_pages = function(limit = 100) {
    return portCall("get_needed_pages", [limit]);
  };

  exports.check_page_needed = function(url) {
    return portCall("check_page_needed", [url]);
  };

  // FIXME: should be (url, pageData) but needs updating in saver.py
  exports.add_fetched_page = function(id, url, page) {
    return portCall("add_fetched_page", [id, url, page]);
  };

  exports.add_fetch_failure = function(url, error_message) {
    return portCall("add_fetch_failure", [url, error_message]);
  };

  exports.log = function(level, ...args) {
    return portCall("log", args, {level});
  };

  exports.status = function() {
    return portCall("status", [browserId]);
  };

  return exports;
})();
