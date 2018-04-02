/* globals elementToSelector */

this.contentWatcher = (function() {

  const IDLE_TIME = 30000;

  document.addEventListener("click", (event) => {
    let target = event.target;
    if (target.tagName === "A") {
      browser.runtime.sendMessage({
        type: "anchorClick",
        text: target.textContent,
        href: target.href
      });
    }
  });

  document.addEventListener("copy", (event) => {
    let selection = window.getSelection();
    let startLocation;
    let endLocation;
    if (selection.anchorNode) {
      startLocation = elementToSelector(selection.anchorNode);
    }
    if (selection.focusNode && selection.focusNode !== selection.anchorNode) {
      endLocation = elementToSelector(selection.focusNode);
    }
    browser.runtime.sendMessage({
      type: "copy",
      text: window.getSelection().toString(),
      startLocation,
      endLocation,
    });
  });

  document.addEventListener("change", (event) => {
    let changed = event.target;
    let isText = changed.tagName === "TEXTAREA";
    if (changed.tagName === "INPUT") {
      let type = (changed.getAttribute("text") || "").toLowerCase();
      let textyTypes = [
        "", "text", "password", "email", "number", "search", "tel", "url",
      ];
      if (textyTypes.includes(type)) {
        isText = true;
      }
    }
    browser.runtime.sendMessage({
      type: "change",
      isText
    });
  });

  let maxScroll = 0;
  let sendScrollTimeout = null;

  window.addEventListener("scroll", function(event) {
    let position = window.scrollY;
    if (position > maxScroll) {
      maxScroll = position;
      if (!sendScrollTimeout) {
        sendScrollTimeout = setTimeout(() => {
          sendScrollTimeout = null;
          let documentHeight = Math.max(
            document.documentElement.clientHeight,
            document.body.clientHeight,
            document.documentElement.scrollHeight,
            document.body.scrollHeight);
          browser.runtime.sendMessage({
            type: "scroll",
            maxScroll,
            documentHeight
          });
        }, 100);
      }
    }
  });

  window.addEventListener("hashchange", (event) => {
    let newHash = (new URL(event.newURL)).hash;
    if (!newHash || newHash === "#") {
      return;
    }
    newHash = newHash.substr(1);
    let element = document.getElementById(newHash);
    if (element) {
      browser.runtime.sendMessage({
        type: "hashchange",
        hash: newHash,
        hasElement: !!element
      });
    }
  });

  let activityTimer;
  let lastActivity;
  let isActive = true;

  function updateActivity() {
    lastActivity = Date.now();
    if (!isActive) {
      browser.runtime.sendMessage({
        type: "activity"
      });
      isActive = true;
    }
    if (activityTimer) {
      clearTimeout(activityTimer);
    }
    activityTimer = setTimeout(() => {
      browser.runtime.sendMessage({
        type: "idle",
        lastActivity
      });
      activityTimer = null;
      isActive = false;
    }, IDLE_TIME);
  }

  function watchForActivity() {
    document.addEventListener("mousemove", updateActivity);
    document.addEventListener("keypress", updateActivity);
    updateActivity();
  }

  function unwatchForActivity() {
    document.removeEventListener("mousemove", updateActivity);
    document.removeEventListener("keypress", updateActivity);
    if (!isActive) {
      isActive = true;
    }
    clearTimeout(activityTimer);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      unwatchForActivity();
    } else {
      watchForActivity();
    }
  });

  if (!document.hidden) {
    watchForActivity();
  }

  function sendDevicePixelRatio() {
    browser.runtime.sendMessage({
      type: "devicePixelRatio",
      devicePixelRatio: window.devicePixelRatio
    });
  }

  window.addEventListener("resize", () => {
    sendDevicePixelRatio();
  });

  function sendCanonicalUrl() {
    let el = document.querySelector("link[rel=canonical]");
    if (el) {
      browser.runtime.sendMessage({
        type: "canonicalUrl",
        href: el.href
      });
    }
  }

  sendDevicePixelRatio();
  sendCanonicalUrl();

})();
