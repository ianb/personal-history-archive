import os
import sqlite3
import json
import hashlib
from cgi import escape as html_escape
from urllib.parse import quote as url_quote

class Archive:
    def __init__(self, path):
        self.path = path
        self.sqlite_path = os.path.join(path, 'history.sqlite')
        self.conn = sqlite3.connect(self.sqlite_path)
        self.pages_path = os.path.join(path, 'pages')


class History:
    def __init__(self, archive, url):
        self.archive = archive
        self.url = url
        self.fetch()

    def fetch(self):
        c = self.archive.conn.cursor()
        self.visits = {}
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
              page.fetched IS NULL AS page_fetched
            FROM history, visit, browser
            LEFT JOIN page ON page.url = history.url
            WHERE history.url = ?
              AND history.id = visit.history_id
              AND browser.id = history.browser_id
            ORDER BY visit.visitTime DESC
        """, (self.url,))
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
            self.has_page = page_fetched
        c.close()

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
            name = name[:100] + hashlib.sha1(name.encode('ascii')).hexdigest()
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


def make_tag(tagname, attrs):
    return '<%s%s>' % (tagname, ' '.join(
        '%s="%s"' % (name, html_escape(value, quote=True)) for name, value in attrs))


def sub_resources(s, resources):
    for name in resources:
        s = s.replace(name, resources[name]["url"])
    return s


class Visit:
    def __init__(self, history):
        self.history = history


if __name__ == "__main__":
    import sys
    location = os.path.abspath(os.path.join(os.path.abspath(__file__), "../../../"))
    print(location)
    archive = Archive(location)
    history = History(archive, sys.argv[1])
    page = history.page
    print("History:", history, history.visits)
    print("Page:", page)
    print("HTML:\n", page.html)
