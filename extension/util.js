this.util = (function() {
  let exports = {};

  exports.sleep = function(time) {
    return new Promise((resolve) => {
      setTimeout(resolve, time);
    });
  };

  exports.makeUuid = function() { // eslint-disable-line no-unused-vars
    // get sixteen unsigned 8 bit random values
    let randomValues = window
      .crypto
      .getRandomValues(new Uint8Array(36));

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      let i = Array.prototype.slice.call(arguments).slice(-2)[0]; // grab the `offset` parameter
      let r = randomValues[i] % 16|0, v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  return exports;
})();
