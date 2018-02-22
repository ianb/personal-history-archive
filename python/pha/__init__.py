import os
import sqlite3
import json
import hashlib
import re
import base64
from cgi import escape as html_escape
from urllib.parse import quote as url_quote
from urllib.parse import urlparse
from . import htmltools
lxml = None

www_regex = re.compile(r"^www[0-9]*\.")
markup_regex = re.compile(r"<.*?>", re.S)

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

class Archive:
    def __init__(self, path):
        self.path = path
        self.sqlite_path = os.path.join(path, 'history.sqlite')
        self.conn = sqlite3.connect(self.sqlite_path)
        self.pages_path = os.path.join(path, 'pages')
        self.update_status()

    def __repr__(self):
        return '<Archive at %r %i/%i fetched, %i errored>' % (self.path, self.fetched_count, self.history_count, self.error_count)

    @classmethod
    def default_location(cls):
        location = os.path.abspath(os.path.join(os.path.abspath(__file__), "../../../"))
        return cls(location)

    base_history_sql = """
        SELECT
            history.url,
            history.id AS history_id,
            history.browser_id,
            browser.user_agent,
            history.title,
            history.lastVisitTime,
            history.visitCount,
            visit.id AS visit_id,
            visit.visitTime,
            visit.referringVisitId,
            visit.transition,
            page.fetched IS NOT NULL AS page_fetched
        FROM history, visit, browser
    """

    def update_status(self):
        c = self.conn.cursor()
        c.execute("""
            SELECT
                (SELECT COUNT(*) FROM history) AS history_count,
                (SELECT COUNT(*) FROM history, page WHERE history.url = page.url) AS fetched_count,
                (SELECT COUNT(*) FROM history, fetch_error WHERE history.url = fetch_error.url) AS error_count
        """)
        (self.history_count, self.fetched_count, self.error_count) = c.fetchone()

    def histories(self):
        c = self.conn.cursor()
        rows = c.execute("""
            %s
            LEFT JOIN page ON page.url = history.url
            WHERE history.id = visit.history_id
              AND browser.id = history.browser_id
            ORDER BY visit.visitTime DESC
        """ % self.base_history_sql)
        result = []
        histories = {}
        for row in rows:
            url = row[0]
            if url in histories:
                visit = histories[url].visits[row[8]] = Visit(histories[url])
                visit.visitTime = row[9]
                visit.referringVisitId = row[10]
                visit.transition = row[11]
                continue
            from_row = row[1:]
            history = histories[url] = History(self, url, from_row=from_row)
            result.append(history)
        return result

    def histories_with_page(self):
        c = self.conn.cursor()
        rows = c.execute("""
            %s, page
            WHERE history.url = page.url
              AND history.id = visit.history_id
              AND browser.id = history.browser_id
            ORDER BY visit.visitTime DESC
        """ % self.base_history_sql)
        result = []
        histories = {}
        rows = rows.fetchall()
        for row in rows:
            url = row[0]
            if url not in histories:
                from_row = row[1:]
                history = histories[url] = History(self, url, from_row=from_row)
                if history.has_page:
                    result.append(history)
            visit = histories[url].visits[row[8]] = Visit(histories[url])
            visit.visitTime = row[9]
            visit.referringVisitId = row[10]
            visit.transition = row[11]
        return result

    def get_history(self, url):
        c = self.conn.cursor()
        rows = c.execute("""
            %s, page
            WHERE history.url = page.url
              AND history.id = visit.history_id
              AND browser.id = history.browser_id
              AND history.url = ?
        """ % self.base_history_sql, (url,))
        history = None
        for row in rows:
            url = row[0]
            if history is None:
                from_row = row[1:]
                history = History(self, url, from_row=from_row)
            visit = history.visits[row[8]] = Visit(history)
            visit.visitTime = row[9]
            visit.referringVisitId = row[10]
            visit.transition = row[11]
        return history

    def sample_histories_with_page(self, number, unique_url=True, unique_domain=False):
        c = self.conn.cursor()
        rows = c.execute("""
            %s, page
            WHERE history.url = page.url
              AND history.id = visit.history_id
              AND browser.id = history.browser_id
            ORDER BY RANDOM()
        """ % self.base_history_sql)
        result = []
        histories = {}
        seen_domains = set()
        seen_url_patterns = set()
        rows = rows.fetchall()
        for row in rows:
            url = row[0]
            if url not in histories:
                if len(result) >= number:
                    return result
                from_row = row[1:]
                history = histories[url] = History(self, url, from_row=from_row)
                history_url_pattern = strip_url_to_pattern(url)
                history_domain = history.domain
                if not history.has_page:
                    continue
                if unique_url and history_url_pattern in seen_url_patterns:
                    continue
                if unique_domain and history_domain in seen_domains:
                    continue
                seen_url_patterns.add(history_url_pattern)
                seen_domains.add(history_domain)
                result.append(history)
            visit = histories[url].visits[row[8]] = Visit(histories[url])
            visit.visitTime = row[9]
            visit.referringVisitId = row[10]
            visit.transition = row[11]
        return result


class History:
    def __init__(self, archive, url, from_row=None):
        self.archive = archive
        self.url = url
        self.fetch(from_row)

    def __repr__(self):
        return '<History %s #visits=%i>' % (self.url, len(self.visits))

    @property
    def domain(self):
        return domain(self.url)

    def fetch(self, from_row=None):
        self.visits = {}
        if not from_row:
            c = self.archive.conn.cursor()
            rows = c.execute("""
                SELECT
                  history.id AS history_id,
                  history.browser_id,
                  browser.user_agent,
                  history.title,
                  history.lastVisitTime,
                  history.visitCount,
                  visit.id AS visit_id,
                  visit.visitTime,
                  visit.referringVisitId,
                  visit.transition,
                  page.fetched AS page_fetched
                FROM history, visit, browser
                LEFT JOIN page ON page.url = history.url
                WHERE history.url = ?
                  AND history.id = visit.history_id
                  AND browser.id = history.browser_id
            """, (self.url,))
        else:
            rows = [from_row]
        for (history_id, browser_id, user_agent, title, lastVisitTime, visitCount, visit_id, visitTime, referringVisitId, transition, page_fetched) in rows:
            self.id = id
            self.browser_id = browser_id
            self.title = title
            self.lastVisitTime = lastVisitTime
            self.visitCount = visitCount
            visit = self.visits.get(visit_id)
            if not visit:
                visit = self.visits[visit_id] = Visit(self)
            visit.visitTime = visitTime
            visit.referringVisitId = referringVisitId
            visit.transition = transition
            self.has_page = page_fetched and os.path.exists(Page.json_filename(self.archive, self.url))

    @property
    def page(self):
        if hasattr(self, "_page"):
            return self._page
        if not os.path.exists(Page.json_filename(self.archive, self.url)):
            return None
        self._page = Page(self.archive, self.url, self)
        return self._page


class Page:
    def __init__(self, archive, url, history=None):
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


class Visit:
    def __init__(self, history):
        self.history = history
