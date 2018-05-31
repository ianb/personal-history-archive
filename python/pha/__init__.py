import os
import sqlite3
import json
import hashlib
import re
from cgi import escape as html_escape
from urllib.parse import quote as url_quote
from urllib.parse import urlparse, parse_qs
import feedparser
from collections import defaultdict
from collections.abc import Mapping
lxml = None

www_regex = re.compile(r"^www[0-9]*\.")
markup_regex = re.compile(r"<.*?>", re.S)

with open(os.path.abspath(os.path.join(__file__, "../schema.sql"))) as fp:
    schema_sql = fp.read()

STANDARD_SCRIPT = '''\
<script>
window.addEventListener("load", function () {
  var element;
  var match = /css=([^&=]+)/.exec(location.hash);
  if (match) {
    var selector = decodeURIComponent(match[1]);
    element = document.querySelector(selector);
    if (!element) {
      console.warn("No element found matching:", selector);
    } else {
      element.scrollIntoView();
    }
  } else if (location.hash) {
    element = document.getElementById(location.hash.substr(1));
  }
  if (element) {
    element.style.outline = "1px dotted rgba(1.0, 0, 0, 0.5)";
  }
});
</script>'''


def domain(url):
    d = urlparse(url).hostname
    match = www_regex.search(d)
    if match:
        d = d[match.end():]
    return d.lower()


def query(url):
    return parse_qs(urlparse(url).query)


class URLMixin:
    @property
    def domain(self):
        return domain(self.url)

    @property
    def query(self):
        return query(self.url)

    @property
    def is_homepage(self):
        p = urlparse(self.url)
        return p.path == "" or p.path == "/"


class Archive:
    def __init__(self, path):
        if not os.path.exists(path):
            raise Exception("Could not find path %s" % path)
        self.path = path
        self.sqlite_path = os.path.join(path, 'history.sqlite')
        self.conn = sqlite3.connect(self.sqlite_path)
        self.conn.row_factory = sqlite3.Row
        c = self.conn.cursor()
        c.executescript(schema_sql)
        c.close()
        self.conn.commit()
        self.pages_path = os.path.join(path, 'pages')
        if not os.path.exists(self.pages_path):
            os.makedirs(self.pages_path)
        self.update_status()

    def __repr__(self):
        return '<Archive at %r %i activities, %i/%i URLs fetched, %i errored>' % (self.path, self.activity_count, self.fetched_count, self.activity_url_count, self.error_count)

    @classmethod
    def default_location(cls):
        location = os.path.abspath(os.path.join(os.path.abspath(__file__), "../../../data"))
        if os.environ.get("PHA_DATA"):
            location = os.environ["PHA_DATA"]
        return cls(location)

    base_activity_sql = """
        SELECT
            browser.userAgent AS userAgent,
            activity.id AS activity_id,
            activity.browserId,
            activity.sessionId,
            activity.url,
            activity.browserHistoryId,
            activity.browserVisitId,
            activity.loadTime,
            activity.unloadTime,
            activity.transitionType,
            activity.client_redirect,
            activity.server_redirect,
            activity.forward_back,
            activity.from_address_bar,
            activity.sourceId,
            activity.browserReferringVisitId,
            activity.initialLoadId,
            activity.newTab,
            activity.activeCount,
            activity.activeTime,
            activity.closedReason,
            activity.method,
            activity.statusCode,
            activity.contentType,
            activity.hasSetCookie,
            activity.hasCookie,
            activity.copyEvents,
            activity.formControlInteraction,
            activity.formTextInteraction,
            activity.isHashChange,
            activity.maxScroll,
            activity.documentHeight,
            activity.hashPointsToElement,
            activity.zoomLevel,
            activity.canonicalUrl,
            activity.mainFeedUrl,
            activity.allFeeds,
            page.fetched IS NOT NULL AS page_fetched
        FROM activity, browser
    """

    def update_status(self):
        c = self.conn.cursor()
        c.execute("""
            SELECT
                (SELECT COUNT(*) FROM activity) AS activity_count,
                (SELECT COUNT(DISTINCT url) FROM activity) AS activity_url_count,
                (SELECT COUNT(*) FROM page) AS fetched_count,
                (SELECT COUNT(*) FROM fetch_error) AS error_count
        """)
        (self.activity_count, self.activity_url_count, self.fetched_count, self.error_count) = c.fetchone()

    def activity(self, *, extra_query=None, extra_args=(), order_by=None):
        order_by = order_by or 'activity.loadTime DESC'
        c = self.conn.cursor()
        rows = c.execute("""
            %s
            LEFT JOIN page ON page.url = activity.url
            WHERE browser.id = activity.browserId
              %s
            ORDER BY %s
        """ % (self.base_activity_sql, extra_query or "", order_by), extra_args)
        rows = list(rows)
        return [Activity(self, row) for row in rows]

    def get_activity_by_url(self, *, like, order_by=None):
        return self.activity(extra_query="AND activity.url LIKE ?", extra_args=(like,), order_by=order_by)

    def activity_with_page(self):
        c = self.conn.cursor()
        rows = c.execute("""
            %s, page
            WHERE activity.url = page.url
              AND browser.id = activity.browserId
            ORDER BY activity.loadTime DESC
        """ % self.base_activity_sql)
        return [Activity(self, row) for row in rows]

    def get_activity_sourceId_in(self, sourceIds):
        c = self.conn.cursor()
        rows = c.execute("""
            %s
            LEFT JOIN page ON page.url = activity.url
            WHERE browser.id = activity.browserId
              AND activity.sourceId IN (%s)
            ORDER BY activity.loadTime DESC
        """ % (self.base_activity_sql, ", ".join(["?"] * len(sourceIds))),
        sourceIds)
        return [Activity(self, row) for row in rows]

    def get_activity(self, url):
        c = self.conn.cursor()
        rows = c.execute("""
            %s
            LEFT JOIN page ON page.url = activity.url
            WHERE browser.id = activity.browserId
              AND activity.url = ?
        """ % self.base_activity_sql, (url,))
        return Activity(self, rows.fetchone())

    def sample_activity_with_page(self, number, unique_url=True, unique_domain=False):
        c = self.conn.cursor()
        rows = c.execute("""
            %s, page
            WHERE activity.url = page.url
              AND browser.id = activity.browserId
            ORDER BY RANDOM()
        """ % self.base_activity_sql)
        result = []
        seen_domains = set()
        seen_url_patterns = set()
        rows = rows.fetchall()
        for row in rows:
            if len(result) >= number:
                return result
            activity = Activity(self, row)
            activity_url_pattern = strip_url_to_pattern(row.url)
            activity_domain = activity.domain
            if not activity.has_page:
                # Catches a missing JSON file or other reason the page isn't really here
                continue
            if unique_url and activity_url_pattern in seen_url_patterns:
                continue
            if unique_domain and activity_domain in seen_domains:
                continue
            seen_url_patterns.add(activity_url_pattern)
            seen_domains.add(activity_domain)
            result.append(activity)
        return result

    def get_activity_by_source(self, sourceId):
        return self.activity(extra_query="AND activity.sourceId = ?", extra_args=(sourceId,))

    def set_all_activity_from_sources(self, sources):
        """
        Sets the .following attribute on all Activity in sources
        """
        followings = self.get_activity_sourceId_in([s.id for s in sources])
        for source in sources:
            source._following = [a for a in followings if a.sourceId == source.id]


class Activity(URLMixin):
    def __init__(self, archive, from_row):
        self.archive = archive
        self._following = None
        self.url = None
        self._update_from_row(from_row)

    def __repr__(self):
        return '<Activity %s %s>' % (self.id, self.url)

    @property
    def following(self):
        if self._following is None:
            self.archive.set_all_activity_from_sources([self])
        return self._following

    def _update_from_row(self, row):
        attrs = """
        userAgent browserId sessionId url browserHistoryId browserVisitId loadTime unloadTime
        transitionType client_redirect server_redirect forward_back from_address_bar sourceId
        browserReferringVisitId initialLoadId newTab activeCount closedReason method statusCode
        contentType hasSetCookie hasCookie formControlInteraction formTextInteraction
        isHashChange maxScroll documentHeight hashPointsToElement zoomLevel canonicalUrl
        mainFeedUrl
        """.split()
        for attr in attrs:
            setattr(self, attr, row[attr])
        self.id = row["activity_id"]
        if row["copyEvents"]:
            self.copyEvents = json.loads(row["copyEvents"])
        else:
            self.copyEvents = None
        if row["allFeeds"]:
            self.allFeeds = json.loads(row["allFeeds"])
        else:
            self.allFeeds = None
        self.has_page = row["page_fetched"] and os.path.exists(Page.json_filename(self.archive, self.url))

    @property
    def page(self):
        if hasattr(self, "_page"):
            return self._page
        if not os.path.exists(Page.json_filename(self.archive, self.url)):
            return None
        self._page = Page(self.archive, self.url)
        return self._page

    def next_activity(self):
        return self.archive.get_activity_by_source(self.id)


class Page(URLMixin):
    def __init__(self, archive, url):
        self.archive = archive
        self.url = url
        self.fetch()

    def __repr__(self):
        return '<Page %s ~%ikb>' % (
            self.url, (len(self.data["head"]) + len(self.data["body"])) / 1000)

    @property
    def domain(self):
        return domain(self.url)

    @property
    def title(self):
        # FIXME: consider using self.data["opengraph"]["title"]
        return self.data["docTitle"]

    @property
    def og_title(self):
        return self.data.get("openGraph", {}).get("title")

    @property
    def og_image(self):
        image = self.data.get("openGraph", {}).get("image")
        if isinstance(image, list):
            image = image[0]
        return image

    @classmethod
    def json_filename(cls, archive, url):
        return os.path.join(archive.pages_path, cls.generate_base_filename(url) + "-page.json")

    @classmethod
    def annotation_filename(cls, archive, url):
        return os.path.join(archive.pages_path, cls.generate_base_filename(url) + "-annotation.json")

    @classmethod
    def generate_base_filename(cls, url):
        name = url_quote(url, '')
        if len(name) > 200:
            name = "%s-%s-trunc" % (name[:100], hashlib.sha1(url.encode('ascii')).hexdigest())
        return name

    def fetch(self):
        c = self.archive.conn.cursor()
        row = c.execute("""
            SELECT fetched, activityId, timeToFetch, redirectUrl, redirectOk
            FROM page
            WHERE url = ?
        """, (self.url,)).fetchone()
        if not row:
            raise KeyError("No page with URL %s" % self.url)
        self.fetched = row["fetched"]
        self.activityId = row["activityId"]
        self.timeToFetch = row["timeToFetch"]
        self.redirectUrl = row["redirectUrl"]
        self.redirectOk = row["redirectOk"]
        filename = self.json_filename(self.archive, self.url)
        with open(filename) as fp:
            self.data = json.load(fp)
        annotation_filename = self.annotation_filename(self.archive, self.url)
        if os.path.exists(annotation_filename):
            with open(annotation_filename) as fp:
                self.annotations = json.load(fp)
        else:
            self.annotations = {}

    @property
    def html(self):
        body = sub_resources(self.data["body"], self.data["resources"])
        head = sub_resources(self.data["head"], self.data["resources"])
        return """<!DOCTYPE html>\n%(html_tag)s%(head_tag)s<base href="%(base)s"><meta charset="UTF-8">%(standard_script)s%(head)s</head>%(body_tag)s%(body)s</body></html>""" % {
            "html_tag": make_tag("html", self.data["htmlAttrs"]),
            "head_tag": make_tag("head", self.data["headAttrs"]),
            "base": html_escape(self.url, quote=True),
            "standard_script": STANDARD_SCRIPT,
            "head": head,
            "body_tag": make_tag("body", self.data["bodyAttrs"]),
            "body": body,
        }

    @property
    def lxml(self):
        global lxml
        if lxml is None:
            import lxml.html
        return lxml.html.document_fromstring(self.html, base_url=self.url)

    style_regex = re.compile(r'<style[^>]*>.*?</style>', re.IGNORECASE | re.DOTALL)

    @property
    def full_text(self):
        body = self.data["body"]
        body = self.style_regex.sub('', body)
        body = sub_resources(body, self.data["resources"])
        # FIXME: make this work:
        # body = htmltools.insert_links_into_text(body)
        # FIXME: would be nice to preserve paragraphs
        # FIXME: remove <style> tags
        body = markup_regex.sub(" ", body)
        return " ".join(body.split())

    @property
    def readable_text(self):
        return (self.data.get("readable") or {}).get("textContent", "")

    @property
    def readable_html(self):
        if not self.data.get("readable") or not self.data["readable"].get("content"):
            return None
        readable = self.data["readable"]
        byline = ""
        if readable.get("byline"):
            byline = '<h2>%s</h2>' % html_escape(readable["byline"])
        excerpt = ""
        if readable.get("excerpt"):
            excerpt = '<blockquote>%s</blockquote>' % html_escape(readable["excerpt"])
        html = '''<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>%(title)s</title>
    <base href="%(base)s">
  </head>
  <body>
    <h1>%(title)s</h1>
    %(byline)s
    %(excerpt)s
    <div class="content">%(content)s</div>
  </body>
</html>
''' % dict(
            title=html_escape(readable.get("title") or self.title),
            base=html_escape(self.url, quote=True),
            byline=byline,
            excerpt=excerpt,
            content=readable["content"],
        )
        return html

    def display_page(self, *, readable=False):
        from .notebooktools import display_html
        html = None
        if readable:
            html = self.readable_html
        if not html:
            html = self.html
        display_html(html, title=self.title, link=self.url, link_title=self.domain)

    @property
    def feeds(self):
        feeds = self.data.get("feeds")
        if not feeds:
            return []
        return [Feed(self, f) for f in feeds]

    @property
    def fetched_feeds(self):
        feeds = self.data.get("feeds") or []
        return [Feed(self, f) for f in feeds if f.get("body")]

    @property
    def error_feeds(self):
        feeds = self.data.get("feeds") or []
        return [Feed(self, f) for f in feeds if f.get("error")]


class Feed:

    def __init__(self, page, feedInfo):
        self.page = page
        self.feedInfo = feedInfo
        self._parsed = None

    def __repr__(self):
        if self.errored:
            return '<Feed (errored) %s on %s>' % (self.url, self.page.url)
        return '<Feed %s on %s>' % (self.url, self.page.url)

    @property
    def errored(self):
        return bool(self.feedInfo.get("error"))

    @property
    def url(self):
        return self.feedInfo["url"]

    @property
    def domain(self):
        return domain(self.url)

    @property
    def body(self):
        return self.feedInfo["body"]

    @property
    def contentType(self):
        return self.feedInfo.get("contentType")

    @property
    def fetchTime(self):
        return self.feedInfo["fetchTime"]

    @property
    def parsed(self):
        if not self._parsed:
            self._parsed = feedparser.parse(self.body, response_headers={"Content-Location": self.url})
        return self._parsed

    @property
    def entries(self):
        return [FeedEntry(self, e) for e in self.parsed.entries]


class FeedEntry(URLMixin):

    def __init__(self, feed, entry):
        self.feed = feed
        self.parsed = entry

    def __repr__(self):
        return '<FeedEntry %s %r>' % (self.url, self.title)

    @property
    def url(self):
        return self.parsed.get("link")

    @property
    def link(self):
        return self.parsed.get("link")

    @property
    def title(self):
        return self.parsed.get("title")

    @property
    def html_content(self):
        global lxml
        if lxml is None:
            import lxml.html
        for c in self.parsed.get("content", []):
            if not c.get("value"):
                continue
            if c["type"] == "text/html":
                ## FIXME: add URL base
                el = lxml.html.fragment_fromstring(
                    c["value"],
                    base_url=c.get("base"),
                    create_parent='div')
                if len(el) == 1 and not el.text:
                    el = el[0]
                return el
        return None

    @property
    def text_content(self):
        for c in self.parsed.get("content", []):
            if not c.get("value"):
                continue
            if c["type"] == "text/plain":
                return c["value"]
        return None

    @property
    def force_text_content(self):
        text = self.text_content
        if text:
            return text
        html = self.html_content
        if html is not None:
            return html.text_content()
        return ""

    def get(self, key, *args):
        return self.parsed.get(key, *args)

    @property
    def tags(self):
        return [t["term"] for t in self.get("tags", [])]

    ## FIXME: add something about enclosures

class ActivityPool:
    """Represents a bunch of activities, and the relations between them.

    This can be expensive to instantiate, but helps make it easier to evaluate interrelations
    """

    def __init__(self, archive, activities):
        self.archive = archive
        self.activities = activities
        self.pages = []
        self._urls = None
        self.activities_by_id = {}
        self.activities_by_url = defaultdict(set)
        for a in self.activities:
            self.activities_by_id[a.id] = a
            self.activities_by_url[a.url].add(a)
        self.page_by_url = {}
        self.pages_with_feeds = []
        for a in self.activities:
            p = a.page
            if p:
                self.page_by_url[p.url] = p
                self.pages.append(p)
        self.feeds_by_url = {}
        self.feed_entry_by_subject_url = {}
        self.feed_entries_without_link = []
        for p in self.page_by_url.values():
            if p.feeds:
                self.pages_with_feeds.append(p)
            for feed in p.feeds:
                if feed.errored:
                    continue
                # FIXME: make sure the feed hasn't updated, if it was fetched at the same URL more than once
                self.feeds_by_url[feed.url] = feed
                for entry in feed.entries:
                    link = entry.get("link")
                    if link:
                        self.feed_entry_by_subject_url[link] = entry
                    else:
                        self.feed_entries_without_link.append((entry, feed))
        self.link_to_url = defaultdict(set)
        cur = archive.conn.cursor()
        cur.execute("""
        SELECT activity_id, url, text, rel, target, elementId
        FROM activity_link
        """)
        for row in cur.fetchall():
            a = self.activities_by_id.get(row["activity_id"])
            if not a:
                continue
            if not hasattr(a, "links"):
                a.links = {}
            link = ActivityLink(a, row["url"], row["text"], row["rel"], row["target"], row["elementId"])
            a.links[link.url] = link
            if link.url in self.activities_by_url:
                self.link_to_url[link.url].add(link)
        self.urls = ActivityPoolURLs(self)
        self._domains = None

    @property
    def domains(self):
        if self._domains is None:
            self._domains = {}
            for url in self.activities_by_url:
                d = domain(url)
                self._domains.setdefault(d, {})[url] = URLPool(url, self)
        return self._domains

    @property
    def feeds(self):
        return self.feeds_by_url.values()

    @property
    def feed_entries(self):
        return self.feed_entry_by_subject_url.values()


class ActivityLink:
    def __init__(self, activity, url, text, rel, target, elementId):
        self.activity = activity
        self.url = url
        self.text = text
        self.rel = rel
        self.target = target
        self.elementId = elementId


class URLPool(URLMixin):

    def __init__(self, url, activity_pool):
        self.url = url
        self.activity_pool = activity_pool
        self.activities = activity_pool.activities_by_url[url]
        self.page = activity_pool.page_by_url.get(url)
        self.feed_entry = activity_pool.feed_entry_by_subject_url.get(url)
        self.backlinks = activity_pool.link_to_url.get(url, set())


class ActivityPoolURLs(Mapping):

    def __init__(self, activity_pool):
        self.activity_pool = activity_pool
        self._instantiated = {}

    def __getitem__(self, key):
        if key in self._instantiated:
            return self._instantiated[key]
        if key not in self.activity_pool.activities_by_url:
            raise KeyError
        result = self._instantiated[key] = URLPool(key, self.activity_pool)
        return result

    def __iter__(self):
        return iter(self.activity_pool.activities_by_url)

    def __len__(self):
        return len(self.activity_pool.activities_by_url)


def make_tag(tagname, attrs):
    return '<%s%s>' % (tagname, ''.join(
        ' %s="%s"' % (name, html_escape(value, quote=True)) for name, value in attrs))


def sub_resources(s, resources):
    for name in resources:
        if resources[name].get("url"):
            s = s.replace(name, resources[name]["url"])
    return s


def strip_url_to_pattern(url):
    """Makes a URL into a string that represents its shape or pattern

    E.g., https://www.foo.com/article/1 turns to foo.com/C/#
    """
    # FIXME: whitelist a couple query string parameters, like ?q (query) and ?p (in some articles)
    d = domain(url)
    path = urlparse(url).path
    path = re.sub(r'/+', '/', path)
    path = path.strip('/')
    if not path:
        return d
    parts = path.split('/')
    s = d
    for part in parts:
        if re.search(r'^[0-9]+$', part):
            s += '/#'
        else:
            s += '/C'
    return s
