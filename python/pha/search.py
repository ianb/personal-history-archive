"""
See this for SQLite FTS5/full text installation instructions: https://sqlite.org/fts5.html

Or: brew upgrade sqlite3 --with-fts5

Use: `python -m pha.search` to create a fresh index.

Use: `python -m pha.search entities` to create an entity index
"""
import re
from urllib.parse import quote as url_quote
from . import htmltools
from . import domain
from collections.abc import Sequence
import time
import random


def create_index(archive, purge=True):
    """
    Creates an index of all pages, in a SQLite table.

    If `purge` is true, then throw away any past index.
    """
    c = archive.conn.cursor()
    c.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index
        USING FTS5 (
            url UNINDEXED,
            url_words,
            title,
            readable,
            readable_byline,
            readable_excerpt,
            meta_description,
            full_text
        )
    """)
    existing = set()
    if purge:
        c.execute("""
            DELETE FROM search_index;
        """)
    else:
        rows = c.execute("""
            SELECT url FROM search_index
        """)
        for (url,) in rows:
            existing.add(url)
    count = 0
    for history in archive.histories_with_page():
        if history.url in existing:
            continue
        count += 1
        page = history.page
        url_words = " ".join(htmltools.url_words(page.url))
        title = page.title
        readable = page.readable_text
        full_text = page.full_text
        r = page.data.get("readable") or {}
        readable_byline = r.get("byline")
        readable_excerpt = r.get("excerpt")
        meta_description = ""  # FIXME: do this
        c.execute("""
            INSERT INTO search_index
              (url, url_words, title, readable, readable_byline, readable_excerpt, meta_description, full_text)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?)
        """, (page.url, url_words, title, readable, readable_byline, readable_excerpt, meta_description, full_text))
    c.close()
    archive.conn.commit()
    return count


def search(archive, query):
    """
    Searches pages from an archive. Returns a list-like object.
    """
    c = archive.conn.cursor()
    rows = c.execute("""
        SELECT url FROM search_index WHERE search_index MATCH ? ORDER BY rank
    """, (query,))
    urls = [row[0] for row in rows]
    return SearchResult(archive, query, urls)


class SearchResult(Sequence):

    def __init__(self, archive, query, urls):
        self.archive = archive
        self.query = query
        self.urls = urls
        self.fetched_histories = {}

    def __repr__(self):
        return '<SearchResult[] %r: %i results>' % (self.query, len(self.urls))

    def __getitem__(self, i):
        url = self.urls[i]
        history = self.fetched_histories.get(url)
        if history is None:
            history = self.fetched_histories[url] = self.archive.get_history(url)
        return history

    def __len__(self):
        return len(self.urls)


def create_entity_index(archive, purge=True, verbose=False):
    from .summarytools import find_entities
    c = archive.conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS entity_index (
            entity TEXT,
            entity_label TEXT,
            url TEXT REFERENCES page (url) ON DELETE CASCADE,
            selector TEXT
        )
    """)
    if verbose:
        print("Created table")
    existing = set()
    if purge:
        c.execute("""
            DELETE FROM entity_index;
        """)
        if verbose:
            print("Removed any previous entries")
    else:
        rows = c.execute("""
            SELECT DISTINCT url FROM entity_index;
        """)
        for (url,) in rows:
            existing.add(url)
        if verbose:
            print("Left", len(existing), "existing entries")
    c.close()
    archive.conn.commit()
    histories = [h for h in archive.histories_with_page() if h.url not in existing]
    loop_start = time.time()
    for count, history in enumerate(histories):
        start = time.time()
        c = archive.conn.cursor()
        page = history.page
        body = page.lxml.find("body")
        entities = list(find_entities(body))
        if not entities:
            entities = [("no-entity", None, body)]
        for entity, entity_label, element in entities:
            selector = htmltools.element_to_css(element)
            c.execute("""
                INSERT INTO entity_index (entity, entity_label, url, selector)
                VALUES (?, ?, ?, ?)
            """, (entity, entity_label, page.url, selector))
        if verbose:
            print("Indexed %6i/%6i  %s" % (count + 1, len(histories), page.url))
            print("  entities: %i in %i elements" % (len(entities), len(set(el for ent, ent_label, el in entities))))
            print("  time %is; total %s; eta %s" % (
                time.time() - start,
                format_time(time.time() - loop_start),
                format_time((time.time() - loop_start) * len(histories) / (count + 1)),
            ))
            random.shuffle(entities)
            entities_string = ", ".join(["%r:%s" % (ent, ent_label) for ent, ent_label, el in entities])
            print("  entities: %s" % entities_string[:145])
            print()
        c.close()
        archive.conn.commit()
    if verbose:
        print("Inserted a total of", count, "pages")
    return count + 1


def format_time(seconds):
    if seconds < 60:
        return '%is' % seconds
    minutes = seconds / 60
    if minutes < 60:
        return '%im' % minutes
    hours, minutes = minutes // 60, minutes % 60
    return '%ih%im' % (hours, minutes)


def summarize_entities(archive, most_common=0):
    c = archive.conn.cursor()
    c.execute("""
        SELECT
          (SELECT COUNT(DISTINCT entity) FROM entity_index) AS distinct_entities,
          (SELECT COUNT(*) FROM entity_index) AS total_entities,
          (SELECT COUNT(DISTINCT url) from entity_index) AS distinct_urls,
          (SELECT COUNT(*) FROM entity_index WHERE entity_label = 'PER') AS total_label_per,
          (SELECT COUNT(*) FROM entity_index WHERE entity_label = 'LOC') AS total_label_loc,
          (SELECT COUNT(*) FROM entity_index WHERE entity_label = 'ORG') AS total_label_org,
          (SELECT COUNT(*) FROM entity_index WHERE entity_label = 'MISC') AS total_label_misc,
          (SELECT COUNT(*) FROM entity_index WHERE entity_label IS NULL OR entity_label NOT IN ('PER', 'LOC', 'ORG', 'MISC')) AS total_label_unknown
    """)
    row = c.fetchone()
    result = {
        "distinct_entities": row[0],
        "total_entities": row[1],
        "distinct_urls": row[2],
        "total_labels": {
            "per": row[3],
            "loc": row[4],
            "org": row[5],
            "misc": row[6],
            "unknown": row[7],
        }
    }
    if most_common:
        c.execute("""
            SELECT entity, COUNT(url)
            FROM entity_index
            GROUP BY entity
            ORDER BY COUNT(url) DESC
            LIMIT ?
        """, (most_common,))
        result["most_common_entities"] = m = []
        for row in c:
            m.append((row[0], row[1]))
    return result


def search_entities(archive, entity, entity_label=None, wildcard=False):
    c = archive.conn.cursor()
    entity_arg = (entity,)
    entity_query = 'entity = ?'
    if wildcard:
        entity_query = 'LOWER(entity) LIKE ?'
        entity_arg = ('%' + entity.lower() + '%',)
    if entity_label:
        entity_query += " AND entity_label = ?"
        entity_arg += (entity_label,)
    rows = c.execute("""
        SELECT entity, entity_label, url, selector
        FROM entity_index
        WHERE %s
    """ % entity_query, entity_arg)
    rows = [(row[0], row[1], row[2], row[3]) for row in rows]
    return EntitySearchResult(archive, entity, rows, wildcard=wildcard)


class EntitySearchResult(Sequence):
    def __init__(self, archive, entity, rows, wildcard=False):
        self.archive = archive
        self.entity = entity
        self.wildcard = wildcard
        self.rows = rows
        self.fetched_results = {}

    def __repr__(self):
        return '<EntitySearchResult[] %s%r: %i results>' % ('like ' if self.wildcard else '', self.entity, len(self.rows))

    def __getitem__(self, i):
        if isinstance(i, slice):
            return self.__class__(self.archive, self.entity, self.rows[i], wildcard=self.wildcard)
        row = self.rows[i]
        result = self.fetched_results.get(row)
        if result is None:
            result = self.fetched_results[row] = EntityResult(self.archive, *row)
        return result

    def __len__(self):
        return len(self.rows)


class EntityResult:
    def __init__(self, archive, entity, entity_label, url, selector):
        self.archive = archive
        self.entity = entity
        self.entity_label = entity_label
        self.url = url
        self.selector = selector

    def __repr__(self):
        return '<EntityResult %s %s: %r (%s)>' % (self.url, self.selector, self.entity, self.entity_label)

    @property
    def page(self):
        if not hasattr(self, "_page"):
            self._page = self.archive.get_history(self.url).page
        return self._page

    @property
    def data_url(self):
        from .notebooktools import make_data_url
        url = make_data_url("text/html", self.page.html)
        if re.search(r"^#[^:]+$", self.selector):
            url += "#" + self.selector[1:]
        else:
            url += "#css=" + url_quote(self.selector)
        return url

    @property
    def domain(self):
        return domain(self.url)


if __name__ == "__main__":
    import sys
    arg = sys.argv[1] if sys.argv[1:] else None
    import pha
    archive = pha.Archive.default_location()
    try:
        if arg == "entities" or arg == "entities":
            print(create_entity_index(archive, verbose=True, purge=False), "pages entity indexed")
        else:
            print(create_index(archive), "pages full text indexed")
    except KeyboardInterrupt:
        print(" aborted")
