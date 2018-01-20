const path = require("path");
const fs = require("fs");
const tmp = require('tmp');
const { execFile } = require("child_process");
const { filenameForUrl } = require("./json-files");
const commandLineArgs = require('command-line-args');
const { getAllPageData } = require("./page-model");
const jobPath = "./jobs/";

if (!fs.existsSync(jobPath)) {
  fs.mkdirSync(jobPath);
}

let optionDefinitions = [
  { name: "verbose", alias: "v", type: Boolean },
  { name: "job", alias: "j", type: String, defaultOption: `generic-${Math.floor(Date.now() / 60000)}` },
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
  process.exit(exitCode);
}).catch(() => {});
