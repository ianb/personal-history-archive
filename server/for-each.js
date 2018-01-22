const path = require("path");
const fs = require("fs");
const tmp = require('tmp');
const { execFile } = require("child_process");
const { filenameForUrl, readAnnotation, writeAnnotation, deleteAnnotation, readPage, writePage } = require("./json-files");
const commandLineArgs = require('command-line-args');
const { getAllPageData, removePageFromDatabase } = require("./page-model");
const jobPath = "./jobs/";

if (!fs.existsSync(jobPath)) {
  fs.mkdirSync(jobPath);
}

let optionDefinitions = [
  { name: "verbose", alias: "v", type: Boolean },
  { name: "job", alias: "j", type: String, defaultOption: `generic-${Math.floor(Date.now() / 60000)}` },
  { name: "exec", alias: "e", type: Boolean, defaultOption: false },
];
let options = commandLineArgs(optionDefinitions, {stopAtFirstUnknown: true});

let command = options._unknown;

let jobFile = path.join(jobPath, options.job + ".json");

let data = {};
if (fs.existsSync(jobFile)) {
  data = JSON.parse(fs.readFileSync(jobFile, {encoding: "UTF-8"}));
  console.info("Logging from", jobFile, "with existing entries:", Object.keys(data).length);
} else {
  console.info("Logging new job to", jobFile);
}

let exitCode = 0;

function substituteEnv(args, env, defaultArg) {
  let usedDefaultArg = false;
  for (let i = 0; i < args.length; i++) {
    for (let key in env) {
      args[i] = args[i].replace("$" + key, env[key]);
    }
    if (args[i] == "{}") {
      args[i] = defaultArg;
    }
    if (args[i].includes(defaultArg)) {
      usedDefaultArg = true;
    }
  }
  if (!usedDefaultArg) {
    args.push(defaultArg);
  }
  return args;
}

function withTempData(data) {
  let buf = Buffer.from(data, "utf8");
  return new Promise((resolve, reject) => {
    tmp.file((error, path, fd, cleanupCallback) => {
      if (error) {
        reject(error);
        return;
      }
      fs.write(fd, buf, (error) => {
        if (error) {
          reject(error);
          return;
        }
        fs.close(fd, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(path);
        });
      });
    });
  });
}

function applyCommands(pageCommands) {
  let promises = [];
  for (let url in pageCommands) {
    let commands = pageCommands[url];
    if (!commands) {
      continue;
    }
    for (let command of commands) {
      promises.push(applyCommand(url, command));
    }
  }
  return Promise.all(promises);
}

function applyCommand(url, command) {
  let c = command.command;
  console.info("Applying", c, "to", url);
  if (c == "annotate") {
    return readAnnotation(url).then((a) => {
      a[command.name] = command.value;
      return writeAnnotation(url, a);
    });
  } else if (c == "remove-annotation") {
    return readAnnotation(url).then((a) => {
      delete a[command.name];
      if (!Object.keys(a).length) {
        return deleteAnnotation(url);
      }
      return writeAnnotation(url, a);
    });
  } else if (c == "set-attr") {
    return readPage(url).then((p) => {
      p[command.name] = p[command.value];
      return writePage(url, p);
    });
  } else if (c == "remove-attr") {
    return readPage(url).then((p) => {
      delete p[command.name];
      return writePage(url, p);
    });
  } else if (c == "remove-page") {
    return removePageFromDatabase(url);
  }
  return Promise.reject(new Error(`Unknown command: ${c}`));
}

getAllPageData().then((pages) => {
  let promise = Promise.resolve();
  for (let page of pages) {
    // console.log("===============================================");
    // console.log("Page:", page);
    if (page.url in data) {
      console.info("Already processed:", page.url);
      continue;
    }
    promise = promise.then(() => {
      return withTempData(JSON.stringify(page));
    }).then((metaPath) => {
      return new Promise((resolve, reject) => {
        let env = Object.assign({}, process.env);
        env.PAGE_URL = page.url;
        env.PAGE_META_FILE = metaPath;
        env.PAGE_JSON_FILE = filenameForUrl(page.url);
        let args = command.slice(1);
        args = substituteEnv(args, env, env.PAGE_JSON_FILE);
        execFile(command[0], args, {env}, (error, stdout, stderr) => {
          if (error) {
            console.error("Error with command:", command[0], args);
            reject(error);
            return;
          }
          if (stderr.length) {
            console.info("stderr for", page.url, ":");
            console.info(stderr);
            console.info("---------------------------------");
          }
          if (stdout.length) {
            let json = JSON.parse(stdout);
            if (!Array.isArray(json)) {
              json = [json];
            }
            data[page.url] = json;
            console.info("Added", json.length, "for URL", page.url);
          } else {
            data[page.url] = null;
          }
          resolve();
        });
      });
    }, (error) => {
      console.error("Error running script on", page.url, ":", error);
      throw error;
    });
  }
  return promise;
}, (error) => {
  console.error("Error getting page data:", error);
  throw error;
}).catch((error) => {
  console.error("Terminating:", error);
  exitCode = 2;
}).then(() => {
  if (Object.keys(data).length) {
    console.info("Writing", Object.keys(data).length, "items to", jobFile);
    fs.writeFileSync(jobFile, JSON.stringify(data, null, "  "), {encoding: "UTF-8"});
  }
}).then(() => {
  if (options.exec) {
    console.info("Applying commands");
    return applyCommands(data);
  }
  console.info("Skipping commands; use -j", options.job, "--exec to apply");
  return true;
}).then((skipped) => {
  if (skipped !== true) {
    console.info("Applied to", Object.keys(data).length, "pages");
  }
}, (error) => {
  console.warn("Error applying commands:", error);
  exitCode = 3;
}).then(() => {
  process.exit(exitCode);
}).catch(() => {});
