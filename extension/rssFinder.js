this.rssFinder = (function() {

  const urlPatterns = [
    /^\/feeds?$/,
    /^\/feeds?\/[a-zA-Z0-9]+$/,
    /\.xml$/,
    /\/feed\/?$/,
    /$\/(rss|atom)/,
    /\/rss\//,
    /[./]rss2?$/,
    // Business Insider:
    /rss.*\.cms$/,
    // The Philly Inquirer and others:
    /rss\.html$/,
    // Seattle PI:
    /collectionRss/,
  ];

  const domainPatterns = [
    /^feeds\./,
    // USA Today:
    /^rss(feeds)?\./,
    /^feeds[0-9]?\.feedburner\.com/,
  ];

  const queryStringPatterns = [
    // Miami Herald:
    /getXmlFeed/,
    /rssfeed/,
    // Sun Times:
    /template=rss/,
    // St Louis Post-Dispatch:
    /f=rss/,
    /feed=rss/,
  ];

  // FIXME: use these
  const hintPatterns = [
    /^https?:\/\/add.my.yahoo.com\/rss\?url=([^&]+)/,
    /^https?:\/\/feedly.com\/#subscription\/feed\/(.*)/,
    /https?:\/\/reader.aol.com\/#subscription\/(.*)/,
  ];

  function isMaybeRssLink(url) {
    let urlObj = new URL(url);
    for (let pat of urlPatterns) {
      if (pat.test(urlObj.pathname)) {
        return true;
      }
    }
    for (let pat of domainPatterns) {
      if (pat.test(urlObj.hostname)) {
        return true;
      }
    }
    for (let pat of queryStringPatterns) {
      if (pat.test(urlObj.search)) {
        return true;
      }
    }
    return false;
  }

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
      return null;
    }
    let mainFeedUrl = feeds[0].href;
    let allFeeds = Array.from(feeds).map(el => ({type: el.type, href: el.href, title: el.title}));
    let speculativeFeedLinks = Array.from(document.querySelectorAll("a[href]"));
    speculativeFeedLinks = speculativeFeedLinks.filter(a => a.href && isMaybeRssLink(a.href));
    speculativeFeedLinks = speculativeFeedLinks.map(a => {
      return {
        href: a.href,
        anchorText: a.textContent.substr(0, 100),
      };
    });
    // Never keep more than 40 links, just in case:
    speculativeFeedLinks.splice(40);
    if (!speculativeFeedLinks.length) {
      speculativeFeedLinks = undefined;
    }
    return {
      mainFeedUrl,
      allFeeds,
      speculativeFeedLinks,
    };
  }

  return rssFinder;

})();
null;
