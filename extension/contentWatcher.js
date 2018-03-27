this.contentWatcher = (function () {

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
  })

})();
