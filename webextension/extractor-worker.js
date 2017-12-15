/* exported FILENAME, extractorWorker */

/* globals Readability, document, console, location, makeStaticHtml */

/** extractor-worker is a content worker that is attached to a page when
    making a shot

    extractData() does the main work
    */

const extractorWorker = (function() { // eslint-disable-line no-unused-vars
  /** Extracts data:
      - Gets the Readability version of the page (`.readable`)
      - Finds images in roughly the preferred order (`.images`)
      */
  let exports = {};

  exports.extractData = function() {
    let start = Date.now();
    let readableDiv;
    let readable;
    if (typeof Readable != "undefined") {
      let result = extractReadable();
      readable = result.readable;
      readableDiv = result.readableDiv;
    }
    var images = findImages([
      {element: document.head, isReadable: false},
      {element: readableDiv, isReadable: true},
      {element: document.body, isReadable: false}]);
    console.info("Image time:", Date.now() - start, "ms");
    var siteName = findSiteName();
    console.info("extractData time:", Date.now() - start, "ms");
    let passwordFields = [];
    for (let el of Array.from(document.querySelectorAll('input[type=password]'))) {
      passwordFields.push(el.name || null);
    }
    return {
      readable,
      images,
      siteName,
      passwordFields
    };
  };

  function extractReadable() {
    // Readability is destructive, so we have to run it on a copy
    var loc = document.location;
    var uri = {
      spec: loc.href,
      host: loc.host,
      prePath: loc.protocol + "//" + loc.host,
      scheme: loc.protocol.substr(0, loc.protocol.indexOf(":")),
      pathBase: loc.protocol + "//" + loc.host + loc.pathname.substr(0, loc.pathname.lastIndexOf("/") + 1)
    };
    let article;
    try {
      article = new Readability(uri, document).parse();
    } catch (e) {
      console.warn("Exception getting readable version:", e);
      console.warn("Traceback:", e.stack);
      article = {error: String(e), errorStack: e.stack};
    }
    return article;
  }

  // Images smaller than either of these sizes are skipped:
  var MIN_IMAGE_WIDTH = 250;
  var MIN_IMAGE_HEIGHT = 200;

  /** Finds images in any of the given elements, avoiding duplicates
      Looks for Open Graph og:image, then img elements, sorting img
      elements by width (largest preferred) */
  function findImages(elements) {
    var images = [];
    var found = {};
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
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i].element;
      if (!el) {
        continue;
      }
      var isReadable = elements[i].isReadable;
      var ogs = el.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']");
      var j;
      for (j = 0; j < ogs.length; j++) {
        var src = ogs[j].getAttribute("content");
        var a = document.createElement("a");
        a.href = src;
        src = a.href;
        if (src.search(/^https?/i) === -1) {
          continue;
        }
        addImage({
          url: src
        });
      }
      var imgs = el.querySelectorAll("img");
      imgs = Array.prototype.slice.call(imgs);
      // Widest images first:
      imgs.sort(function(a, b) {
        if (a.width > b.width) {
          return -1;
        }
        return 1;
      });
      for (j = 0; j < imgs.length; j++) {
        var img = imgs[j];
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
    let json = makeStaticHtml.documentStaticData();
    Object.assign(json, exports.extractData());
    return json;
  };

  return exports;

})();
