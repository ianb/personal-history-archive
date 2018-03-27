/* globals elementToSelector */

this.contentWatcher = (function() {

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

})();
