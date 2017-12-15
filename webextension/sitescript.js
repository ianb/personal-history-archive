/* globals content, browser */

const DEFAULT_PAGE_LIMIT = 6;

let ContentXMLHttpRequest;
let Content_fetch;
if (typeof content === "undefined") {
  ContentXMLHttpRequest = XMLHttpRequest;
  Content_fetch = fetch;
} else {
  ContentXMLHttpRequest = content.XMLHttpRequest;
  Content_fetch = content.fetch;
}

let browserId;
let model = {
  fetching: new Map(),
  failed: new Map()
};

setTimeout(() => {
  browser.runtime.sendMessage({
    type: "init"
  }).then((result) => {
    browserId = result.browserId;
    return register().then(refresh);
  }).catch((error) => {
    console.error("Error initializing:", error);
  });
}, 200);

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

function register() {
  return new Promise((resolve, reject) => {
    let req = new ContentXMLHttpRequest();
    req.open("POST", "/register");
    req.setRequestHeader("Content-Type", "application/json");
    req.onload = () => {
      if (req.status != 200) {
        console.error("Bad response to /register:", req.status);
        reject(new Error("Bad response to /register"));
      } else {
        console.info("Registration succeeded", browserId);
        resolve();
      }
    };
    req.send(JSON.stringify({browserId}));
  });
}

function sendHistory(historyItems) {
  return new Promise((resolve, reject) => {
    let req = new ContentXMLHttpRequest();
    req.open("POST", "/add-history");
    req.setRequestHeader("Content-Type", "application/json");
    req.onload = () => {
      if (req.status != 200) {
        console.error("Bad response to /add-history:", req.status);
        reject(req);
      } else {
        for (let item of historyItems) {
          let last = item.lastVisitTime;
          if (!model.latest) {
            model.latest = last;
          } else if (model.latest < last) {
            model.latest = last;
          }
          if (!model.oldest) {
            model.oldest = last;
          } else if (model.oldest > last) {
            model.oldest = last;
          }
        }
        refresh();
        resolve();
      }
    };
    console.log("sending history", JSON.stringify(historyItems));
    req.send(JSON.stringify({
      browserId,
      items: historyItems
    }));
  });
}

document.querySelector("#sendHistory").addEventListener("click", () => {
  let continuous = document.querySelector("#sendHistoryContinuous").checked;
  let endTime = model.oldest || Date.now();
  let latest = model.latest || Date.now();
  console.log("sending history since", endTime, "or until", latest);
  if (continuous) {
    sendContinuousHistory();
  } else {
    sendSomeHistory(endTime, latest);
  }
});

function sendContinuousHistory() {
  let endTime = model.oldest || Date.now();
  let latest = model.latest || Date.now();
  console.log("Starting continuous history sending");
  return sendSomeHistory(endTime, latest).then((anySent) => {
    if (anySent) {
      console.log("Sending another batch!");
      return sendContinuousHistory();
    }
  });
}

function sendSomeHistory(endTime, latest) {
  return browser.runtime.sendMessage({
    type: "history.search",
    maxResults: 1000,
    endTime: endTime - 1
  }).then((results) => {
    if (!results.length) {
      console.log("No old items, sending new items", latest + 1, Date.now());
      return browser.runtime.sendMessage({
        type: "history.search",
        maxResults: 100000,
        startTime: latest + 1,
        endTime: Date.now()
      }).then((results) => {
        if (!results.length) {
          console.log("No recent items to send");
          model.historyStatus = "fully up to date";
          refresh();
          return false;
        }
        model.historyStatus = `Up to date with ${results.length} recent items`;
        return sendHistory(results).then(() => {
          return true;
        });
      });
    }
    model.historyStatus = `Sent ${results.length} old items`;
    return sendHistory(results).then(() => {
      return true;
    });
  });
}

let fetchSomeButton = document.querySelector("#fetchSome");

fetchSomeButton.addEventListener("click", () => {
  if (!abortWorker) {
    abortWorkerNow();
    return;
  }
  abortWorker = false;
  fetchSomeButton.textContent = "Stop fetching";
  Content_fetch("/get-needed-pages").then((resp) => {
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

function refresh() {
  let req = new ContentXMLHttpRequest();
  req.open("GET", `/status?browserId=${encodeURIComponent(browserId)}`);
  req.onload = () => {
    let data = JSON.parse(req.responseText);
    Object.assign(model, data);
    render();
  };
  req.send();
  getRemoteHistory();
}

function getRemoteHistory() {
  return Content_fetch("/get-history").then((resp) => {
    return resp.json();
  }).then((rows) => {
    model.history = rows;
    render();
  }).catch((error) => {
    console.error("Error getting remote history:", error);
  });
}

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
    console.log("Already have", found, "pages running");
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
    refresh();
    startWorker();
  }).catch((error) => {
    model.fetching.delete(url);
    model.failed.set(url, error);
    startWorker();
  });
}

function sendPage(url, pageData) {
  console.log("sending", url, JSON.stringify(pageData));
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
    console.log("Send data on", url);
  }).catch((error) => {
    console.error("Error sending data for", url, ":", error);
    throw error;
  });
}
