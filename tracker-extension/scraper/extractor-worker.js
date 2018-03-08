/* exported FILENAME, extractorWorker */

/* globals Readability, document, console, location, makeStaticHtml */

/** extractor-worker is a content worker that is attached to a page when
    making a shot

    extractData() does the main work
    */

var extractorWorker = (function() { // eslint-disable-line no-unused-vars
  /** Extracts data:
      - Gets the Readability version of the page (`.readable`)
      - Finds images in roughly the preferred order (`.images`)
      */
  let exports = {};

  exports.extractData = function() {
    let start = Date.now();
    let readableDiv;
    let readable;
    if (typeof Readability != "undefined") {
      let result = extractReadable();
      if (result) {
        readable = result;
      } else {
        readable = null;
      }
    } else {
      console.info("Skipping readability: not installed");
    }
    let images = findImages([
      {element: document.head, isReadable: false},
      {element: readableDiv, isReadable: true},
      {element: document.body, isReadable: false}]);
    console.info("Image time:", Date.now() - start, "ms");
    let siteName = findSiteName();
    console.info("extractData time:", Date.now() - start, "ms");
    return {
      readable,
      images,
      siteName
    };
  };

  function extractReadable() {
    // Readability is destructive, so we have to run it on a copy
    let loc = document.location;
    let uri = {
      spec: loc.href,
      host: loc.host,
      prePath: loc.protocol + "//" + loc.host,
      scheme: loc.protocol.substr(0, loc.protocol.indexOf(":")),
      pathBase: loc.protocol + "//" + loc.host + loc.pathname.substr(0, loc.pathname.lastIndexOf("/") + 1)
    };
    let article;
    let id = makeUuid();
    let index = 1;
    for (let el of document.getElementsByTagName("*")) {
      el.setAttribute("data-tmp-id", `${id}-${index}`);
      index++;
    }
    var documentClone = document.cloneNode(true);
    try {
      article = new Readability(uri, documentClone).parse();
      if (article) {
        let newDiv = document.createElement("div");
        newDiv.innerHTML = article.content;
        for (let el of newDiv.querySelectorAll("*[data-tmp-id]")) {
          let id = el.getAttribute("data-tmp-id");
          let origEl = document.querySelector(`*[data-tmp-id='${id}']`);
          let found = false;
          let parent = origEl.parentNode;
          while (parent) {
            if (parent.getAttribute && parent.getAttribute("data-isreadable")) {
              found = true;
              break;
            }
            parent = parent.parentNode;
          }
          if (!found) {
            origEl.setAttribute("data-isreadable", "1");
          }
        }
      }
    } catch (e) {
      console.warn("Exception getting readable version:", String(e));
      console.warn("Traceback:", e.stack);
      article = {error: String(e), errorStack: e.stack};
    }
    for (let el of document.getElementsByTagName("*")) {
      el.removeAttribute("data-tmp-id");
    }
    return article;
  }

  // Images smaller than either of these sizes are skipped:
  let MIN_IMAGE_WIDTH = 250;
  let MIN_IMAGE_HEIGHT = 200;

  /** Finds images in any of the given elements, avoiding duplicates
      Looks for Open Graph og:image, then img elements, sorting img
      elements by width (largest preferred) */
  function findImages(elements) {
    let images = [];
    let found = {};
    function addImage(imgData) {
      if (!(imgData && imgData.url)) {
        return;
      }
      if (found[imgData.url]) {
        return;
      }
      images.push(imgData);
      found[imgData.url] = true;
    }
    for (let i = 0; i < elements.length; i++) {
      let el = elements[i].element;
      if (!el) {
        continue;
      }
      let isReadable = elements[i].isReadable;
      let ogs = el.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']");
      let j;
      for (j = 0; j < ogs.length; j++) {
        let src = ogs[j].getAttribute("content");
        let a = document.createElement("a");
        a.href = src;
        src = a.href;
        if (src.search(/^https?/i) === -1) {
          continue;
        }
        addImage({
          url: src
        });
      }
      let imgs = el.querySelectorAll("img");
      imgs = Array.prototype.slice.call(imgs);
      // Widest images first:
      imgs.sort(function(a, b) {
        if (a.width > b.width) {
          return -1;
        }
        return 1;
      });
      for (j = 0; j < imgs.length; j++) {
        let img = imgs[j];
        if ((!img.src) || (img.src.search(/^https?/i) === -1)) {
          continue;
        }
        if (img.width >= MIN_IMAGE_WIDTH && img.height >= MIN_IMAGE_HEIGHT) {
          addImage({
            url: img.src,
            dimensions: {x: img.width, y: img.height},
            title: img.getAttribute("title") || null,
            alt: img.getAttribute("alt") || null,
            isReadable
          });
        }
      }
    }
    return images;
  }

  function findSiteName() {
    let el = document.querySelector("meta[property='og:site_name']");
    if (el) {
      return el.getAttribute("content");
    }
    // nytimes.com uses this property:
    el = document.querySelector("meta[name='cre']");
    if (el) {
      return el.getAttribute("content");
    }
    return null;
  }

  exports.documentStaticJson = function() {
    let jsonPromise = Promise.resolve();
    let json = {};
    return jsonPromise.then(() => {
      Object.assign(json, exports.extractData());
      return json;
    }).then(() => {
      return makeStaticHtml.documentStaticData();
      return json;
    }).then((staticJson) => {
      Object.assign(json, staticJson);
      return json;
    }).catch((e) => {
      console.error("Error in documentStaticJson:", e, e.stack);
      throw e;
    });
  };

  return exports;

})();
