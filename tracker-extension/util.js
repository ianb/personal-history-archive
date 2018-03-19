this.util = (function () {
  let exports = {};

  exports.sleep = function(time) {
    return new Promise((resolve) => {
      setTimeout(resolve, time);
    });
  };

  return exports;
})();
