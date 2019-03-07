/* globals buildSettings, log, browserId, sessionId */

/** Routines to communicate with the backend via native connection */
this.communication = (function() {
  let exports = {};
  let port = browser.runtime.connectNative(buildSettings.nativeScriptName);
  let responderId = 1;
  let responders = new Map();
  let hasActiveArchive = false;
  let callCache = [];
  const CALL_CACHE_LIMIT = 10;

  function portCall(name, args, kwargs, withoutArchive = false) {
    if (!sessionId) {
      // Stuff really hasn't initialized yet!
      log.warn(`Calling ${name}() before sessionId is set`);
      return new Promise((resolve, reject) => {
        callCache.push({name, args, kwargs, resolve, reject});
      });
    }
    if (!withoutArchive && !hasActiveArchive) {
      if (callCache.length > CALL_CACHE_LIMIT) {
        throw new Error("Attempted to send too many messages before setting archive");
      }
      log.info(`Deferring message: ${name}()`);
      return new Promise((resolve, reject) => {
        callCache.push({name, args, kwargs, resolve, reject});
      });
    }
    args = args || [];
    kwargs = kwargs || {};
    let id = responderId++;
    for (let i = 0; i < args.length; i++) {
      if (args[i] && typeof args[i] === "object" && "toJSON" in args[i]) {
        args[i] = args[i].toJSON();
      }
    }
    for (let name in (kwargs || {})) {
      if (kwargs[name] && typeof kwargs[name] === "object" && "toJSON" in kwargs[name]) {
        kwargs[name] = kwargs[name].toJSON();
      }
    }
    port.postMessage({name, args, kwargs, id});
    return new Promise((resolve, reject) => {
      responders.set(id, {resolve, reject, name});
    });
  }

  port.onMessage.addListener((message) => {
    let id = message.id;
    let responder = responders.get(id);
    if ("result" in message) {
      responder.resolve(message.result);
    } else if (message.error) {
      // Using console.error so we don't ever send this back to the server:
      //
      console.error("Error calling", responder.name, ":", message.error, message.traceback); // eslint-disable-line no-console
      responder.reject(new Error(`Backend error: ${message.error}`));
    } else {
      log.warn("Response without result/error:", message);
    }
    responders.delete(id);
  });

  function setHasActiveArchive() {
    hasActiveArchive = true;
    for (let item of callCache) {
      portCall(item.name, item.args, item.kwargs).then(item.resolve).catch(item.reject);
    }
    callCache = [];
  }

  /* Each of these exported functions is a function in browsinglab.connect: */

  exports.add_activity_list = function(activityItems) {
    if (!hasActiveArchive) {
      // Just throw it away then
      log.warn("Disposing of activity", hasActiveArchive);
      return null;
    }
    return portCall("add_activity_list", [], {browserId, sessionId, activityItems});
  };

  exports.register_browser = function() {
    return portCall("register_browser", [], {
      browserId,
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
    });
  };

  exports.register_session = function() {
    return portCall("register_session", [sessionId, browserId, (new Date()).getTimezoneOffset()]);
  };

  exports.check_page_needed = function(url) {
    return portCall("check_page_needed", [url]);
  };

  // FIXME: should be (url, pageData) but needs updating in saver.py
  exports.add_fetched_page = function(id, url, page) {
    return portCall("add_fetched_page", [id, url, page]);
  };

  exports.log = function({level, args, stack}) {
    return portCall("log", args, {level, stack}, true);
  };

  exports.set_active_archive = async function(path) {
    await portCall("set_active_archive", [path], {}, true);
    setHasActiveArchive();
    await exports.register_browser();
    await exports.register_session();
  };

  exports.unset_active_archive = async function() {
    hasActiveArchive = false;
    await portCall("unset_active_archive");
  };

  exports.set_archive_title = function(title) {
    return portCall("set_archive_title", [title]);
  };

  exports.get_archive_info = function() {
    return portCall("get_archive_info", [], {}, true);
  };

  exports.get_all_archives = function() {
    return portCall("get_all_archives", [], {}, true);
  };

  return exports;
})();
