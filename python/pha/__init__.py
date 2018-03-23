import os
import sqlite3
import json
import hashlib
import re
import base64
from cgi import escape as html_escape
from urllib.parse import quote as url_quote
from urllib.parse import urlparse, parse_qs
from . import htmltools
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

class Archive:
    def __init__(self, path):
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
        return '<Archive at %r %i/%i fetched, %i errored>' % (self.path, self.fetched_count, self.activity_count, self.error_count)

    @classmethod
    def default_location(cls):
        location = os.path.abspath(os.path.join(os.path.abspath(__file__), "../../../"))
        return cls(location)

    base_activity_sql = """
        SELECT
            browser.userAgent,
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
            activity.initialLoadId,
            activity.newTab,
            activity.activeCount,
            activity.closedReason,
            activity.method,
            activity.statusCode,
            activity.contentType,
            activity.hasSetCookie,
            page.fetched IS NOT NULL AS page_fetched
        FROM activity, browser
    """

    def update_status(self):
        c = self.conn.cursor()
        c.execute("""
            SELECT
                (SELECT COUNT(*) FROM activity) AS activity_count,
                (SELECT COUNT(*) page) AS fetched_count,
                (SELECT COUNT(*) fetch_error) AS error_count
        """)
        (self.activity_count, self.fetched_count, self.error_count) = c.fetchone()

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


class Activity:
    def __init__(self, archive, from_row):
        self.archive = archive
        self._update_from_row(from_row)

    def __repr__(self):
        return '<Activity %s %s>' % (self.id, self.url)

    @property
    def domain(self):
        return domain(self.url)

    @property
    def query(self):
        return query(self.url)

    def _update_from_row(self, row):
        self.userAgent = row.userAgent
        self.id = row.activity_id
        self.browserId = row.browserId
        self.sessionId = row.sessionId
        self.url = row.url
        self.browserHistoryId = row.browserHistoryId
        self.browserActivityId = row.browserActivityId
        self.loadTime = row.loadTime
        self.unloadTime = row.unloadTime
        self.transitionType = row.transitionType
        self.client_redirect = row.client_redirect
        self.server_redirect = row.server_redirect
        self.forward_back = row.forward_back
        self.from_address_bar = row.from_address_bar
        self.sourceId = row.sourceId
        self.initialLoadId = row.initialLoadId
        self.newTab = row.newTab
        self.activeCount = row.activeCount
        self.closedReason = row.closedReason
        self.method = row.method
        self.statusCode = row.statusCode
        self.contentType = row.contentType
        self.hasSetCookie = row.hasSetCookie
        self.has_page = row.page_fetched and os.path.exists(Page.json_filename(self.archive, self.url))

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


class Page:
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
        rows = c.execute("""
            SELECT fetched, not_logged_in, timeToFetch, redirectUrl, redirectOk
            FROM page
            WHERE url = ?
        """, (self.url,))
        if not rows:
            raise KeyError("No page with URL %s" % self.url)
        (self.fetched, self.not_logged_in, self.timeToFetch, self.redirectUrl, self.redirectOk) = list(rows)[0]
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
    ## FIXME: whitelist a couple query string parameters, like ?q (query) and ?p (in some articles)
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
