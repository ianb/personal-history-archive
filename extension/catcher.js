/* globals log, buildSettings, util, backgroundOnMessage */

this.catcher = (function() {
  let exports = {};

  exports.watchFunction = function(func) {
    return function(...args) {
      try {
        let result = func(...args);
        if (result && "then" in result && result.then) {
          return exports.watchPromise(result);
        }
        return result;
      } catch (error) {
        report(error);
        throw error;
      }
    };
  };

  exports.watchPromise = function(promise) {
    return promise.catch((error) => {
      report(error);
      throw error;
    });
  };

  const report = exports.report = function(error) {
    log.error("Error:", error);
    if (buildSettings.notifyError) {
      if (typeof backgroundOnMessage === "undefined") {
        // Then we are in a worker context
        browser.runtime.sendMessage({type: "reportError", error: String(error)});
      } else {
        exports.notifyError(error);
      }
    }
  };

  exports.notifyError = function(error) {
    error = String(error);
    let id = util.makeUuid();
    browser.notifications.create(id, {
      type: "basic",
      title: "PHA Error",
      message: error
    });
  };

  if (typeof backgroundOnMessage !== "undefined") {
    backgroundOnMessage.register("reportError", (message) => {
      exports.notifyError(message.error);
    });
  }

  return exports;
})();
