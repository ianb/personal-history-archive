const firefox = require("selenium-webdriver/firefox");
const webdriver = require("selenium-webdriver");
const { By } = webdriver;
const fs = require("fs");
const path = require("path");
const RandomGenerator = require("random-seed");

let seed = process.env.SEED || Date.now();

const randomGenerator = RandomGenerator.create(seed);
const random = randomGenerator.random.bind(randomGenerator);

const addonFileLocation = path.join(process.cwd(), "test", "build-walk", "extension.zip");

function getDriver() {
  const channel = process.env.FIREFOX_CHANNEL || "NIGHTLY";
  if (!(channel in firefox.Channel)) {
    throw new Error(`Unknown channel: "${channel}"`);
  }

  const options = new firefox.Options()
    .setBinary(firefox.Channel[channel])
    .setPreference("extensions.legacy.enabled", true)
    .setPreference("xpinstall.signatures.required", false);

  const driver = new webdriver.Builder()
    .withCapabilities({"moz:webdriverClick": true})
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .build();

  driver.installAddon(addonFileLocation);

  return driver;
}

function promiseTimeout(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

async function closeBrowser(driver) {
  // This works around some geckodriver bugs in driver.quit()
  let handles = await driver.getAllWindowHandles();
  for (let handle of handles) {
    await driver.switchTo().window(handle);
    await driver.close();
  }
  try {
    driver.quit();
  } catch (error) {
    // Ignore it (probably the browser is closed by now)
  }
}

function choose(options) {
  return options[Math.floor(options.length * random())];
}

function weightedChoice(options) {
  let sum = 0;
  for (let pair of options) {
    sum += pair[1];
  }
  let choice = sum * random();
  let pos = 0;
  for (let pair of options) {
    pos += pair[1];
    if (pos >= choice) {
      return pair[0];
    }
  }
  throw new Error("Weight choice returned nothing, how?");
}

function chooseDestination(destinations, seenUrls) {
  let chooseOptions = destinations.filter(u => !seenUrls.has(u));
  if (!chooseOptions.length) {
    chooseOptions = destinations;
  }
  return choose(chooseOptions);
}

function chooseQuery(queries, url) {
  let choices = [];
  for (let prefix in queries) {
    if (!url.startsWith(prefix)) {
      continue;
    }
    for (let selector in queries[prefix]) {
      choices.push([selector, queries[prefix][selector]]);
    }
  }
  if (!choices.length) {
    return null;
  }
  return weightedChoice(choices);
}

function chooseSearchTerm(terms) {
  let wordCount = choose([1, 2, 3]);
  let words = [];
  while (words.length < wordCount) {
    let w = choose(terms);
    if (!words.includes(w)) {
      words.push(w);
    }
  }
  return words.join(" ");
}

let driver;

async function walk(config) {
  console.log("");
  console.log("");
  console.log("======================== RANDOM WALK ========================");
  console.log("");
  driver = await getDriver();
  // Give the add-on a moment to load:
  await promiseTimeout(1000);
  let seenUrls = new Set();
  let steps = 0;
  let lastWasSearch = false;
  for (;;) {
    await promiseTimeout(500);
    steps++;
    let url = await driver.getCurrentUrl();
    seenUrls.add(url);
    console.log("---Running step", steps, "url:", url);
    let queryElement = chooseQuery(config.queries, url);
    if (queryElement && !lastWasSearch) {
      let term = chooseSearchTerm(config.searchTerms);
      console.log("Doing search on", queryElement, "term:", term);
      await driver.findElement(By.css(queryElement)).sendKeys(term + "\n");
      await promiseTimeout(100);
      lastWasSearch = true;
      continue;
    }
    lastWasSearch = false;
    if (url === "about:blank" || random() < config.destinations.frequency) {
      let dest = chooseDestination(config.destinations.urls, seenUrls);
      // Just in case a redirect happens and this exact URL isn't added:
      seenUrls.add(dest);
      await driver.get(dest);
      await promiseTimeout(100);
      continue;
    }
    let anchors = await driver.findElements(By.css("a"));
    let anchor = choose(anchors);
    if (!anchor) {
      console.log("Warning: no anchor found in page", url);
      continue;
    }
    let anchorUrl = await anchor.getAttribute("href");
    if (!anchorUrl || anchorUrl.startsWith("mailto:")) {
      console.log("Chose bad anchor:", anchorUrl);
      continue;
    }
    if (!anchor) {
      console.log("Got no anchor");
      continue;
    }
    try {
      await anchor.click();
    } catch (e) {
      if (e.name === "ElementNotInteractableError") {
        console.log("Could not interact with anchor", anchorUrl);
      } else {
        console.log("Error interacting with anchor:", anchorUrl, e);
      }
      continue;
    }
    promiseTimeout(100);
  }
}

async function main() {
  let names = ["default.json"];
  if (process.env.CONFIG) {
    names.push(process.env.CONFIG);
  }
  let config = await loadConfig(names);
  console.log("config:", config);
  try {
    await walk(config);
  } catch (e) {
    console.log("Error:", e);
    console.log(e.stack);
  }
  console.log("---- closing");
  await closeBrowser(driver);
}

async function loadConfig(names) {
  let configs = [];
  for (let name of names) {
    if (!name.endsWith(".json")) {
      name += ".json";
    }
    if (!fs.existsSync(name)) {
      name = path.join(__dirname, "walk-configs", name);
    }
    let data = fs.readFileSync(name, {encoding: "UTF-8"});
    data = JSON.parse(data);
    if (typeof data.searchTerms === "string") {
      data.searchTerms = data.searchTerms.trim().split(/[\s\n]+/g);
    }
    configs.push(data);
  }
  let result = {
    destinations: {
      urls: [],
      frequency: 0.05
    },
    queries: {},
    searchTerms: []
  };
  for (let config of configs) {
    let newUrls = config.destinations && config.destinations.urls;
    if (!newUrls) {
      newUrls = result.destinations.urls;
    } if (newUrls.includes("*")) {
      let newUrls = result.destinations.urls.concat(newUrls.filter(u => u !== "*"));
    }
    let newSearchTerms = config.searchTerms;
    if (!newSearchTerms) {
      newSearchTerms = config.searchTerms;
    } else if (newSearchTerms.includes("*")) {
      newSearchTerms = result.searchTerms.concat(newSearchTerms.filter(u => u !== "*"));
    }
    Object.assign(result, config);
    result.destinations.urls = newUrls;
    result.searchTerms = newSearchTerms;
  }
  return result;
}

if (require.main === module) {
  main();
}
