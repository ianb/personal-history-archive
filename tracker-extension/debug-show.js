function requestStatus() {
  browser.runtime.sendMessage({type: "requestStatus"}).then((status) => {
    console.log("going to get status", status);
    showStatus(status);
  }).catch((error) => {
    showError(error);
  });
}

function getTextarea() {
  let el = document.querySelector("textarea");
  if (!el) {
    el = document.createElement("textarea");
    el.style.width = "100%";
    el.style.height = "20em";
    document.body.appendChild(el);
  }
  return el;
}

function showStatus(status) {
  getTextarea().value = JSON.stringify(status, null, "  ");
}

function showError(error) {
  getTextarea().value = JSON.stringify({error}, null, "  ");
}

console.log("I'm sending a request...");

requestStatus();
