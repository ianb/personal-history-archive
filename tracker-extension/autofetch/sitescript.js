/* globals content, browser */

const DEFAULT_PAGE_LIMIT = 3;
const DEFAULT_PAGE_TOTAL = 100;
const SERVER = "http://localhost:11180";

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
  browser.runtime.sendMessage({
    type: "focusMainTab"
  });
}

document.addEventListener("keyup", (event) => {
  if ((event.code || event.key) == "Escape") {
    abortWorkerNow();
  }
});

let fetchSomeButton = document.querySelector("#fetchSome");

fetchSomeButton.addEventListener("click", async () => {
  if (!abortWorker) {
    abortWorkerNow();
    return;
  }
  abortWorker = false;
  let numberOfPages = parseInt(document.querySelector("#fetch-total").value, 10) || DEFAULT_PAGE_TOTAL;
  fetchSomeButton.textContent = "Stop fetching";
  let pages = await browser.runtime.sendMessage({type: "get_needed_pages", limit: numberOfPages});
  for (let page of pages) {
    model.fetching.set(page.url, false);
  }
  startWorker();
  render();
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
    browser.runtime.sendMessage({
      type: "setBadgeText",
      text: String(model.fetching.size)
    });
  } else {
    browser.runtime.sendMessage({
      type: "setBadgeText",
      text: ""
    });
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
  let anyFetched = false;
  for (let url of model.fetching.keys()) {
    if (model.fetching.get(url)) {
      continue;
    }
    if (model.failed.get(url)) {
      continue;
    }
    anyFetched = true;
    fetchPage(url);
    model.fetching.set(url, true);
    found++;
    if (found >= limit) {
      break;
    }
  }
  if (!anyFetched) {
    render();
    abortWorkerNow();
    return;
  }
  render();
}

async function fetchPage(url) {
  try {
    let start = Date.now();
    let result = await browser.runtime.sendMessage({
      type: "fetchPage",
      url
    });
    if (!result) {
      console.error("Error fetching url:", url);
      return;
    }
    let sendPromise = browser.runtime.sendMessage({type: "add_fetched_page", url, page: result});
    model.fetching.delete(url);
    startWorker();
    return await sendPromise;
  } catch (error) {
    model.fetching.delete(url);
    model.failed.set(url, error);
    browser.runtime.sendMessage({type: "add_fetch_failure", url, error_message: String(error)});
    render();
    startWorker();
  }
}
