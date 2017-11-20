const DEFAULT_PAGE_LIMIT = 6;

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
}, false);

function register() {
  return new Promise((resolve, reject) => {
    let req = new content.XMLHttpRequest();
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
  let req = new content.XMLHttpRequest();
  req.open("POST", "/add-history");
  req.setRequestHeader("Content-Type", "application/json");
  req.onload = () => {
    if (req.status != 200) {
      console.error("Bad response to /add-history:", req.status);
    } else {
      refresh();
    }
  };
  console.log("sending history", JSON.stringify(historyItems));
  req.send(JSON.stringify({
    browserId,
    items: historyItems
  }));
}

document.querySelector("#sendHistory").addEventListener("click", () => {
  let startTime = document.querySelector(".latest").textContent;
  if (startTime == "null") {
    startTime = 0;
  }
  startTime = parseInt(startTime, 10);
  console.log("sending history since", startTime);
  browser.runtime.sendMessage({
    type: "history.search",
    maxResults: 100,
    startTime
  }).then((results) => {
    sendHistory(results);
  });
}, false);

let fetchSomeButton = document.querySelector("#fetchSome");

fetchSomeButton.addEventListener("click", () => {
  if (!abortWorker) {
    abortWorkerNow();
    return;
  }
  abortWorker = false;
  fetchSomeButton.textContent = "Stop fetching";
  content.fetch("/get-needed-pages").then((resp) => {
    return resp.json();
  }).then((pages) => {
    for (let url of pages) {
      model.fetching.set(url, false);
    }
    startWorker();
    render();
  });
}, false);

function refresh() {
  let req = new content.XMLHttpRequest();
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
  return content.fetch("/get-history").then((resp) => {
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
  }
  if (model.history) {
    let table = document.querySelector("#history-items");
    table.innerHTML = '<tr><th>Title</th><th>URL</th><th>Fetched</th></tr>';
    for (let h of model.history) {
      let tr = document.createElement('tr');
      let title = document.createElement('td');
      title.textContent = h.title;
      let url = document.createElement('td');
      url.textContent = h.url;
      let fetched = document.createElement('td');
      fetched.textContent = h.fetched;
      tr.appendChild(title);
      tr.appendChild(url);
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
      } else {
        return 1;
      }
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
    url: url
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
  return content.fetch("/add-fetched-page", {
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
