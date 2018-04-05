/* globals elementToSelector */

this.contentWatcher = (function() {

  const IDLE_TIME = 30000;
  const LINK_TEXT_LIMIT = 80;

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

  function sendBasicMetadata() {
    let message = {
      type: "basicPageMetadata",
      title: document.title
    };
    let el = document.querySelector("link[rel=canonical]");
    if (el) {
      message.canonicalUrl = el.href;
    }
    let ogTitleEl = document.querySelector("meta[name='og:title'], meta[name='twitter:title']")
    if (ogTitleEl) {
      message.ogTitle = ogTitleEl.getAttribute("content");
    }
    browser.runtime.sendMessage(message);
  }

  function sendFeedInformation() {
    let contentTypes = [
      "application/rss+xml",
      "application/atom+xml",
      "application/rdf+xml",
      "application/rss",
      "application/atom",
      "application/rdf",
      "text/rss+xml",
      "text/atom+xml",
      "text/rdf+xml",
      "text/rss",
      "text/atom",
      "text/rdf",
    ];
    let selector = contentTypes.map((t) => `link[rel=alternate][type="${t}"]`).join(", ");
    let feeds = document.querySelectorAll(selector);
    if (!feeds.length) {
      return;
    }
    let mainFeedUrl = feeds[0].href;
    let allFeeds = Array.from(feeds).map(el => ({type: el.type, href: el.href, title: el.title}));
    browser.runtime.sendMessage({
      type: "feedInformation",
      mainFeedUrl,
      allFeeds,
    });
  }

  function sendLinkInformation() {
    let links = Array.from(document.querySelectorAll("a[href]"));
    links = links.filter(el => el.getAttribute("href") !== "#");
    let linkInformation = links.map((el) => {
      let info = {
        url: el.href
      };
      let text = el.textContent;
      if (text.length > LINK_TEXT_LIMIT) {
        text = text.substr(0, LINK_TEXT_LIMIT) + "...";
      }
      info.text = text;
      if (el.href.startsWith(location.href.split("#")[0] + "#")) {
        info.url = "#" + el.href.split("#")[1];
      }
      if (el.rel) {
        info.rel = el.rel;
      }
      if (el.target) {
        info.target = el.target;
      }
      if (el.id) {
        info.elementId = el.id;
      }
      return info;
    });
    browser.runtime.sendMessage({
      type: "linkInformation",
      linkInformation
    });
  }

  sendDevicePixelRatio();
  sendBasicMetadata();
  setTimeout(sendFeedInformation);
  setTimeout(sendLinkInformation);

})();
