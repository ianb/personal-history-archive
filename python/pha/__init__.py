import os
import sqlite3
import json
import hashlib
import re
from cgi import escape as html_escape
from urllib.parse import quote as url_quote
from urllib.parse import urlparse
lxml = None

www_regex = re.compile(r"^www[0-9]*\.")

def domain(url):
    d = urlparse(url).hostname
    match = www_regex.search(d)
    if match:
        d = d[match.end():]
    return d

class Archive:
    def __init__(self, path):
        self.path = path
        self.sqlite_path = os.path.join(path, 'history.sqlite')
        self.conn = sqlite3.connect(self.sqlite_path)
        self.pages_path = os.path.join(path, 'pages')

    def __repr__(self):
        return '<Archive at %r>' % self.path

    @classmethod
    def default_location(cls):
        location = os.path.abspath(os.path.join(os.path.abspath(__file__), "../../../"))
        return cls(location)

    def histories(self):
        c = self.conn.cursor()
        rows = c.execute("""
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
              page.fetched IS NULL AS page_fetched
            FROM history, visit, browser
            LEFT JOIN page ON page.url = history.url
            WHERE history.id = visit.history_id
              AND browser.id = history.browser_id
            ORDER BY visit.visitTime DESC
        """)
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
              page.fetched AS page_fetched
            FROM history, visit, browser, page
            WHERE history.url = page.url
              AND history.id = visit.history_id
              AND browser.id = history.browser_id
            ORDER BY visit.visitTime DESC
        """)
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
            if history.has_page:
                result.append(history)
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
                ORDER BY visit.visitTime DESC
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
        return """<!DOCTYPE html>\n%(html_tag)%(head_tag)s<base href="%(base)s"><meta charset="UTF-8">%(head)s</head>%(body_tag)s%(body)s</body></html>""" % {
            "html_tag": make_tag("html", self.data["htmlAttrs"]),
            "head_tag": make_tag("head", self.data["headAttrs"]),
            "base": html_escape(self.url, quote=True),
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


def make_tag(tagname, attrs):
    return '<%s%s>' % (tagname, ' '.join(
        '%s="%s"' % (name, html_escape(value, quote=True)) for name, value in attrs))


def sub_resources(s, resources):
    for name in resources:
        if resources[name].get("url"):
            s = s.replace(name, resources[name]["url"])
    return s


class Visit:
    def __init__(self, history):
        self.history = history


if __name__ == "__main__":
    import sys
    archive = Archive.default_location()
    history = History(archive, sys.argv[1])
    page = history.page
    print("History:", history, history.visits)
    print("Page:", page)
    print("HTML:\n", page.html)
