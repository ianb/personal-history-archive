function element(selector) {
  return document.querySelector(selector);
}

function requestStatus() {
  browser.runtime.sendMessage({type: "requestStatus"}).then((status) => {
    showStatus(status);
  }).catch((error) => {
    showError(error);
  });
}

function showStatus(status) {
  element("#status").value = JSON.stringify(status, null, "  ");
}

function showError(error) {
  element("#status").value = JSON.stringify({error}, null, "  ");
}

element("#flush").addEventListener("click", async () => {
  await browser.runtime.sendMessage({type: "flushNow"});
  element("#flush-status").textContent = `finished at ${Date.now()}`;
});

requestStatus();
