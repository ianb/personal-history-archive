/* globals buildSettings, communication, backgroundOnMessage */
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
      let newArgs = [];
      for (let arg of args) {
        newArgs.push(arg);
        if (arg instanceof Error) {
          newArgs.push(String(arg));
        }
      }
      console[level](...newArgs);
    }
    if (shouldLogServer[level]) {
      let newArgs = [];
      let stackLines = (new Error()).stack.split("\n");
      while (stackLines[0] && /\/log.js:/.test(stackLines[0])) {
        stackLines.shift();
      }
      let stack = stackLines.join("\n");
      for (let arg of args) {
        if (arg instanceof Error) {
          newArgs.push(String(arg));
          newArgs.push(arg.stack);
        } else {
          newArgs.push(arg);
        }
      }
      if (typeof communication !== "undefined") {
        communication.log({level, args: newArgs, stack});
      } else {
        browser.runtime.sendMessage({type: "log", level, args: newArgs, stack});
      }
    }
  }

  if (typeof backgroundOnMessage !== "undefined") {
    backgroundOnMessage.register("log", (message) => {
      logWithLevel(message.level, message.args);
    });
  }

  exports.debug = logger("debug");
  exports.info = logger("info");
  exports.warn = logger("warn");
  exports.error = logger("error");

  return exports;
})();
