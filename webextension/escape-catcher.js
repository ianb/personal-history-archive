document.addEventListener("keyup", (event) => {
  if ((event.key || event.code) == "Escape") {
    browser.runtime.sendMessage({
      type: "escapeKey"
    });
  }
}, false);
