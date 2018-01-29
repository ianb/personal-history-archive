"""
See this for SQLite FTS5/full text installation instructions: https://sqlite.org/fts5.html

Or: brew upgrade sqlite3 --with-fts5
"""
from . import htmltools

def create_index(archive, purge=True):
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
    for history in archive.histories_with_page():
        if history.url in existing:
            continue
        page = history.page
        url_words = " ".join(htmltools.url_words(page.url))
        title = page.title
        readable = page.readable_text
        full_text = page.full_text
        r = page.data.get("readable") or {}
        readable_byline = r.get("byline")
        readable_excerpt = r.get("excerpt")
        meta_description = "" # FIXME: do this
        c.execute("""
            INSERT INTO search_index 
              (url, url_words, title, readable, readable_byline, readable_excerpt, meta_description, full_text)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?)
        """, (page.url, url_words, title, readable, readable_byline, readable_excerpt, meta_description, full_text))
    c.close()
    archive.conn.commit()

if __name__ == "__main__":
    import sys
    path = sys.argv[1] if sys.argv[1:] else None
    import pha 
    if path:
        archive = pha.Archive(path)
    else:
        archive = pha.Archive.default_location()
    create_index(archive)
