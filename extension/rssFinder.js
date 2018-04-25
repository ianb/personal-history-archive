this.rssFinder = (function () {
  function rssFinder() {
    let contentTypes = [
      "application/rss+xml",
      "application/atom+xml",
      "application/rdf+xml",
      "application/rss",
      "application/atom",
      "application/rdf",
      "text/rss+xml",
      "text/atom+xml",
      "text/rdf+xml",
      "text/rss",
      "text/atom",
      "text/rdf",
    ];
    let selector = contentTypes.map((t) => `link[rel=alternate][type="${t}"]`).join(", ");
    let feeds = document.querySelectorAll(selector);
    if (!feeds.length) {
      return;
    }
    let mainFeedUrl = feeds[0].href;
    let allFeeds = Array.from(feeds).map(el => ({type: el.type, href: el.href, title: el.title}));
    return {
      mainFeedUrl,
      allFeeds,
    };
  }

  return rssFinder;

})();
null;
