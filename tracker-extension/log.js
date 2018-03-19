/* globals buildSettings, communication */
/* eslint-disable no-console */

"use strict";

this.log = (function() {
  const exports = {};

  const levels = ["debug", "info", "warn", "error"];
  if (!levels.includes(buildSettings.logLevel)) {
    console.warn("Invalid buildSettings.logLevel:", buildSettings.logLevel);
  }
  const shouldLog = {};
  const shouldLogServer = {};

  {
    let startLogging = false;
    let startServerLogging = false;
    for (const level of levels) {
      if (buildSettings.logLevel === level) {
        startLogging = true;
      }
      if (buildSettings.serverLogLevel === level) {
        startServerLogging = true;
      }
      if (startLogging) {
        shouldLog[level] = true;
      }
      if (startServerLogging) {
        shouldLogServer[level] = true;
      }
    }
  }

  function logger(level) {
    return function(...args) {
      logWithLevel(level, args);
    };
  }

  function logWithLevel(level, args) {
    if (shouldLog[level]) {
      console[level](...args);
    }
    if (shouldLogServer[level]) {
      if (typeof communication !== "undefined") {
        communication.log(...args);
      } else {
        console.info("Cannot send log to server from this context");
      }
    }
  }

  exports.debug = logger("debug");
  exports.info = logger("info");
  exports.warn = logger("warn");
  exports.error = logger("error");

  return exports;
})();
