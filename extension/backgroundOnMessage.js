/* globals log */

this.backgroundOnMessage = (function() {
  let exports = {};

  const handlers = {};

  browser.runtime.onMessage.addListener((message, sender) => {
    let type = message.type;
    message.senderTabId = sender.tab && sender.tab.id;
    message.senderUrl = sender.url;
    message.senderFrameId = sender.frameId;
    if (!handlers[type]) {
      log.error("Got unexpected message type:", type, "from", message);
      return Promise.reject(new Error(`Unexpected message type: ${type}`));
    }
    try {
      let result = handlers[type](message);
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  });

  exports.register = function(type, handler) {
    if (handlers[type]) {
      throw new Error(`Attempt to reregister message type ${type}`);
    }
    handlers[type] = handler;
  };

  exports.registerListener = function(type, handler) {
    let existing = handlers[type];
    if (!existing) {
      handlers[type] = handler;
    } else if (Array.isArray(existing)) {
      existing.push(handler);
    } else {
      handlers[type] = [existing, handler];
    }
  };

  exports.unregister = function(type, handler) {
    let existing = handlers[type];
    if (!existing) {
      throw new Error(`Attempt to unregister handler that has no handlers: ${type}`);
    }
    if (Array.isArray(existing)) {
      if (!existing.includes(handler)) {
        throw new Error(`Attempt to unregister handler that hasn't been registered: ${type}`);
      }
      handlers[type] = existing.filter(x => x !== handler);
      if (handlers.length === 1) {
        handlers[type] = handlers[type][0];
      }
    } else {
      if (existing === handler) {
        throw new Error(`Attepmt to unregister handler that hasn't been registered: ${type}`);
      }
      delete handlers[type];
    }
  };

  return exports;
})();
