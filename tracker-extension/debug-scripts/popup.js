/* globals browser */

function showStatus(status) {
  let textarea = document.querySelector("textarea");
  textarea.value = JSON.stringify(status, null, "  ");
}

function showError(error) {
  showStatus({
    error: String(error),
    stack: error.stack
  });
}

function requestStatus() {
  browser.runtime.sendMessage({type: "requestStatus"}).then((status) => {
    showStatus(status);
  }).catch((error) => {
    showError(error);
  });
}

document.querySelector("#sendNow").addEventListener("click", () => {
  showStatus({status: "sending now..."});
  browser.runtime.sendMessage({type: "sendNow"}).then(() => {
    requestStatus();
  }).catch((error) => {
    showError(error);
  });
});

document.querySelector("#sendAllNow").addEventListener("click", () => {
  showStatus({status: "Sending everything all over..."});
  browser.runtime.sendMessage({type: "sendNow", force: true}).then(() => {
    requestStatus();
  }).catch((error) => {
    showError(error);
  });
});

document.querySelector("#flush").addEventListener("click", () => {
  showStatus({status: "Sending activity..."});
  browser.runtime.sendMessage({type: "flushNow"}).then(() => {
    requestStatus();
  }).catch((error) => {
    showError(error);
  });
});

requestStatus();
