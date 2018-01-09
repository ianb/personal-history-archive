const fs = require("fs");
const path = require("path");
const dataPath = path.join(__dirname, "../pages");

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath);
}

function fixedEncodeURIComponent(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16);
  });
}

function filenameForUrl(url) {
  return path.join(dataPath, fixedEncodeURIComponent(url)) + "-page.json";
}

exports.writePage = function(url, pageData) {
  let p = filenameForUrl(p);
  return new Promise((resolve, reject) => {
    fs.writeFile(p, JSON.stringify(pageData), 'UTF-8', (error) => {
      if (error) {
        reject(error);
      }
      resolve();
    });
  });
};

exports.listPageUrls = function() {
  return new Promise((resolve, reject) => {
    fs.readdir(dataPath, (error, files) => {
      if (error) {
        reject(error);
        return;
      }
      let goodFiles = files.filter(
        (p) => p.endsWith("-page.json")
      ).map(
        (p) => decodeURIComponent(p.substr(0, p.length - ("-page.json").length))
      );
      resolve(goodFiles);
    });
  });
};

exports.readPage = function(url) {
  return new Promise((resolve, reject) => {
    fs.readFile(filenameForUrl(url), {encoding: "UTF-8"}, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(JSON.parse(data));
    });
  });
};
