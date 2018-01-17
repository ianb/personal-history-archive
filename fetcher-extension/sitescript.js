/* globals content, browser */

const DEFAULT_PAGE_LIMIT = 6;
const DEFAULT_PAGE_TOTAL = 100;

let Content_fetch;
if (typeof content === "undefined") {
  Content_fetch = fetch;
} else {
  Content_fetch = content.fetch;
}

let model = {
  fetching: new Map(),
  failed: new Map()
};

browser.runtime.onMessage.addListener((message) => {
  if (message.type == "escapeKey") {
    abortWorkerNow();
  } else {
    console.warn("sitescript got unexpected message:", message);
  }
});

function abortWorkerNow() {
  fetchSomeButton.textContent = "Fetch some pages";
  abortWorker = true;
}

document.addEventListener("keyup", (event) => {
  if ((event.code || event.key) == "Escape") {
    abortWorkerNow();
  }
});

let fetchSomeButton = document.querySelector("#fetchSome");

fetchSomeButton.addEventListener("click", () => {
  if (!abortWorker) {
    abortWorkerNow();
    return;
  }
  abortWorker = false;
  let numberOfPages = parseInt(document.querySelector("#fetch-total").value, 10) || DEFAULT_PAGE_TOTAL;
  fetchSomeButton.textContent = "Stop fetching";
  Content_fetch(`/get-needed-pages?limit=${numberOfPages}`).then((resp) => {
    return resp.json();
  }).then((pages) => {
    for (let url of pages) {
      model.fetching.set(url, false);
    }
    startWorker();
    render();
  }).catch((error) => {
    console.error("Got error from /get-needed-pages:", error);
  });
});

function render() {
  for (let key in model) {
    let value = model[key];
    for (let el of document.querySelectorAll("." + key)) {
      el.textContent = value;
    }
    for (let el of document.querySelectorAll(`.${key}-date`)) {
      el.textContent = String(new Date(value));
    }
  }
  if (model.history) {
    let table = document.querySelector("#history-items");
    table.innerHTML = '<tr><th>Title</th><th>URL</th><th>Visit</th><th>Fetched</th></tr>';
    for (let h of model.history) {
      let tr = document.createElement('tr');
      let title = document.createElement('td');
      title.textContent = h.title;
      let url = document.createElement('td');
      url.textContent = h.url;
      let visit = document.createElement('td');
      visit.textContent = (new Date(h.lastVisitTime)).toLocaleDateString("en-US", {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
      let fetched = document.createElement('td');
      fetched.textContent = h.fetched;
      tr.appendChild(title);
      tr.appendChild(url);
      tr.appendChild(visit);
      tr.appendChild(fetched);
      table.appendChild(tr);
    }
  }
  let list = document.querySelector("#fetching");
  list.innerHTML = '';
  if (model.fetching) {
    let items = Array.from(model.fetching.entries());
    items.sort((a, b) => {
      if (a[1] && !b[1]) {
        return 1;
      } else if (b[1] && !a[1]) {
        return -1;
      } else if (a[0] < b[0]) {
        return 1;
      }
      return 1;
    });
    for (let [url, fetching] of items) {
      let li = document.createElement('li');
      if (fetching) {
        li.className = 'fetching';
      } else {
        li.className = 'queued';
      }
      li.textContent = url;
      list.appendChild(li);
    }
  }
  let failedList = document.querySelector("#failed");
  failedList.innerHTML = '';
  for (let [url, problem] of model.failed.entries()) {
    let li = document.createElement("li");
    li.textContent = `${url}: ${problem}`;
    failedList.appendChild(li);
  }
}

let abortWorker = true;

function startWorker() {
  if (abortWorker) {
    return;
  }
  let limit = parseInt(document.querySelector("#fetch-batch").value, 10) || DEFAULT_PAGE_LIMIT;
  let found = 0;
  for (let url of model.fetching.keys()) {
    if (model.fetching.get(url)) {
      found++;
    }
  }
  if (found >= limit) {
    console.info("Already have", found, "pages running");
    return;
  }
  for (let url of model.fetching.keys()) {
    if (model.fetching.get(url)) {
      continue;
    }
    if (model.failed.get(url)) {
      continue;
    }
    fetchPage(url);
    model.fetching.set(url, true);
    found++;
    if (found >= limit) {
      break;
    }
  }
  render();
}

function fetchPage(url) {
  let start = Date.now();
  browser.runtime.sendMessage({
    type: "fetchPage",
    url
  }).then((result) => {
    if (!result) {
      console.error("Error fetching url:", url);
      return;
    }
    result.timeToFetch = Date.now() - start;
    sendPage(url, result);
    model.fetching.delete(url);
    startWorker();
  }).catch((error) => {
    model.fetching.delete(url);
    model.failed.set(url, error);
    startWorker();
  });
}

function sendPage(url, pageData) {
  console.info("sending", url, JSON.stringify(pageData));
  return Content_fetch("/add-fetched-page", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url,
      data: pageData
    })
  }).then(() => {
    console.info("Send data on", url);
  }).catch((error) => {
    console.error("Error sending data for", url, ":", error);
    throw error;
  });
}
