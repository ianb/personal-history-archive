/* globals log */

this.backgroundOnMessage = (function() {
  let exports = {};

  const handlers = {};

  browser.runtime.onMessage.addListener((message, sender) => {
    let type = message.type;
    message.senderTabId = sender.tab.id;
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

  return exports;
})();
