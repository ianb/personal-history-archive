const fs = require("fs");
const path = require("path");
const dataPath = path.join(__dirname, "../pages");
const sha1 = require('sha1');

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath);
}

function fixedEncodeURIComponent(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return '%' + c.charCodeAt(0).toString(16);
  });
}

function filenameForUrl(url) {
  let base = fixedEncodeURIComponent(url);
  if (base.length > 200) {
    base = `${base.substr(0, 100)}-${sha1(url)}-trunc`;
  }
  return path.join(dataPath, base + "-page.json");
}

function annotationFilenameForUrl(url) {
  let base = fixedEncodeURIComponent(url);
  if (base.length > 200) {
    base = `${base.substr(0, 100)}-${sha1(url)}-trunc`;
  }
  return path.join(dataPath, base + "-annotation.json");
}

exports.filenameForUrl = filenameForUrl;
exports.annotationFilenameForUrl = annotationFilenameForUrl;

exports.writePage = function(url, pageData) {
  let p = filenameForUrl(url);
  return new Promise((resolve, reject) => {
    fs.writeFile(p, JSON.stringify(pageData), 'UTF-8', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

exports.writeAnnotation = function(url, data) {
  let p = annotationFilenameForUrl(url);
  return new Promise((resolve, reject) => {
    fs.writeFile(p, JSON.stringify(data), 'UTF-8', (error) => {
      if (error) {
        reject(error);
        return;
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
        (p) => p.endsWith("-page.json") && !p.endsWith("-trunc-page.json")
      ).map(
        (p) => decodeURIComponent(p.substr(0, p.length - ("-page.json").length))
      );
      let hardFilePromises = files.filter(
        (p) => p.endsWith("-trunc-page.json")
      ).map(
        (p) => getUrlFromFile(p)
      );
      if (hardFilePromises.length) {
        Promise.all(hardFilePromises).then((result) => {
          for (let url of result) {
            goodFiles.push(url);
          }
          resolve(goodFiles);
        }).catch(reject);
      } else {
        resolve(goodFiles);
      }
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

exports.readAnnotation = function(url) {
  return new Promise((resolve, reject) => {
    fs.exists(annotationFilenameForUrl(url), (exists) => {
      if (!exists) {
        resolve({});
        return;
      }
      fs.readFile(annotationFilenameForUrl(url), {encoding: "UTF-8"}, (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(JSON.parse(data));
      });
    });
  });
};

function getUrlFromFile(basename) {
  let p = path.join(dataPath, basename);
  return new Promise((resolve, reject) => {
    fs.readFile(p, {encoding: "UTF-8"}, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(JSON.parse(data).url);
    });
  });
}

exports.deletePage = function(url) {
  return new Promise((resolve, reject) => {
    fs.unlink(filenameForUrl(url), (error) => {
      if (error && error.code !== 'ENOENT') {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

exports.deleteAnnotation = function(url) {
  let filename = annotationFilenameForUrl(url);
  return new Promise((resolve, reject) => {
    fs.exists(filename, (exists) => {
      if (!exists) {
        resolve();
        return;
      }
      fs.unlink(filename, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
};

exports.pageExists = function(url) {
  return new Promise((resolve, reject) => {
    fs.exists(filenameForUrl(url), (exists) => {
      resolve(exists);
    });
  });
};
