"""
Implements saving information into the database/files
"""

import os
import re
import json
import sys
import struct
import time
import pprint
import traceback
import uuid
from .db import Page, Archive

message_handlers = {}

active_archive = None


def addon(func):
    message_handlers[func.__name__] = func
    return func


@addon
def add_history_list(archive, *, browserId, sessionId, historyItems):
    visits_to_ids = {}
    for history in historyItems.values():
        for visitId, visit in history["visits"].items():
            visits_to_ids[visitId] = visit["activity_id"] = str(uuid.uuid1())
    for historyId, history in historyItems.items():
        c = archive.conn.cursor()
        for visitId, visit in history["visits"].items():
            c.execute("""
                DELETE FROM activity WHERE browserVisitId = ?
            """, (visitId,))
            sourceId = None
            if visit.get("referringVisitId"):
                sourceId = visits_to_ids.get(visit["referringVisitId"])
                if not sourceId:
                    c.execute("""
                        SELECT id FROM activity WHERE browserVisitId = ?
                    """, (visit["referringVisitId"],))
                    row = c.fetchone()
                    if row:
                        sourceId = row.id
            c.execute("""
                INSERT INTO activity (
                    id,
                    title,
                    browserId,
                    sessionId,
                    url,
                    browserHistoryId,
                    browserVisitId,
                    loadTime,
                    transitionType,
                    browserReferringVisitId,
                    sourceId
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                visit["activity_id"],
                history["title"],
                browserId,
                sessionId,
                history["url"],
                historyId,
                visitId,
                visit["visitTime"],
                visit["transition"],
                visit["referringVisitId"],
                sourceId))
        archive.conn.commit()
    c = archive.conn.cursor()
    c.execute("""
        UPDATE browser
          SET
            newestHistory = (SELECT MAX(loadTime)
                             FROM activity WHERE browserId = ? AND browserHistoryId IS NOT NULL),
            oldestHistory = (SELECT MIN(loadTime)
                             FROM activity WHERE browserId = ? AND browserHistoryId IS NOT NULL)
    """, (browserId, browserId))
    archive.conn.commit()


@addon
def add_activity_list(archive, *, browserId, activityItems):
    for activity in activityItems:
        c = archive.conn.cursor()
        columns = """
            id
            browserId
            sessionId
            url
            title
            ogTitle
            loadTime
            unloadTime
            transitionType
            sourceClickText
            sourceClickHref
            client_redirect
            server_redirect
            forward_back
            from_address_bar
            sourceId
            initialLoadId
            newTab
            activeCount
            activeTime
            closedReason
            method
            statusCode
            contentType
            hasSetCookie
            hasCookie
            copyEvents
            formControlInteraction
            formTextInteraction
            isHashChange
            maxScroll
            documentHeight
            hashPointsToElement
            zoomLevel
            canonicalUrl
            mainFeedUrl
            allFeeds
        """.strip().split()
        for null_default in "sourceId transitionType".split():
            activity.setdefault(null_default, None)
        marks = ["?"] * len(columns)
        activity["browserId"] = browserId
        linkInformation = activity["linkInformation"]
        del activity["linkInformation"]
        if activity["copyEvents"]:
            activity["copyEvents"] = json.dumps(activity["copyEvents"])
        else:
            activity["copyEvents"] = None
        if activity["allFeeds"]:
            activity["allFeeds"] = json.dumps(activity["allFeeds"])
        else:
            activity["allFeeds"] = None
        log(archive, activity)
        values = [activity[column] for column in columns]
        unused = set(activity).difference(columns)
        if unused:
            raise Exception("Unused keys in activity submission: {}".format(unused))
        c.execute("""
            INSERT OR REPLACE INTO activity (
              %s
            ) VALUES (%s)
        """ % (", ".join(columns), ", ".join(marks)), values)
        c.execute("""
            DELETE FROM activity_link WHERE activity_id = ?
        """, (activity["id"],))
        for link in linkInformation or []:
            c.execute("""
                INSERT INTO activity_link (
                    url,
                    text,
                    rel,
                    target,
                    elementId
                ) VALUES (?, ?, ?, ?, ?)
            """, (link["url"], link["text"], link.get("rel"), link.get("target"), link.get("elementId")))
    archive.conn.commit()


@addon
def register_browser(archive, *, browserId, userAgent, testing=False, autofetch=False, devicePixelRatio=1):
    c = archive.conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO browser (id, userAgent, testing, autofetch, devicePixelRatio)
        VALUES (?, ?, ?, ?, ?)
    """, (browserId, userAgent, testing, autofetch, devicePixelRatio))
    c.execute("""
        UPDATE browser
          SET
            newestHistory = (SELECT MAX(loadTime)
                             FROM activity WHERE browserId = ? AND browserHistoryId IS NOT NULL),
            oldestHistory = (SELECT MIN(loadTime)
                             FROM activity WHERE browserId = ? AND browserHistoryId IS NOT NULL)
    """, (browserId, browserId))
    archive.conn.commit()


@addon
def register_session(archive, sessionId, browserId, timezoneOffset):
    c = archive.conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO browser_session (id, browserId, startTime, timezoneOffset)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    """, (sessionId, browserId, timezoneOffset))
    archive.conn.commit()


@addon
def get_needed_pages(archive, limit=100):
    c = archive.conn.cursor()
    rows = c.execute("""
        SELECT history.url, fetch_error.errorMessage FROM history
        LEFT JOIN page
            ON page.url = history.url
        LEFT JOIN fetch_error
            ON fetch_error.url = history.url
        WHERE page.url IS NULL
        ORDER BY fetch_error.url IS NULL DESC, lastVisitTime DESC
        LIMIT ?
    """, (limit,))
    return [{"url": row["url"], "lastError": row["errorMessage"]} for row in rows]


@addon
def check_page_needed(archive, url):
    c = archive.conn.cursor()
    c.execute("""
        SELECT COUNT(*) AS counter FROM page WHERE page.url = ?
    """, (url,))
    return not c.fetchone()[0]


@addon
def add_fetched_page(archive, id, url, page):
    redirectUrl = page["url"].split("#")[0]
    origUrl = url.split("#")[0]
    page["originalUrl"] = url
    if redirectUrl == origUrl:
        redirectUrl = None
    else:
        redirectUrl = page["url"]
    if redirectUrl:
        # Removes the YouTube start time we add
        redirectUrl = redirectUrl.replace("&start=86400", "")
    c = archive.conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO page (id, url, activityId, fetched, redirectUrl, timeToFetch)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    """, (id, url, page.get("activityId"), redirectUrl, page["timeToFetch"]))
    c.execute("""
        DELETE FROM fetch_error
        WHERE url = ?
    """, (url,))
    archive.conn.commit()
    write_page(archive, url, page)


@addon
def add_fetch_failure(archive, url, errorMessage):
    c = archive.conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO fetch_error (url, errorMessage)
        VALUES (?, ?)
    """, (url, errorMessage))
    archive.conn.commit()


@addon
def status(archive, browserId):
    c = archive.conn.cursor()
    c.execute("""
        SELECT
            (SELECT COUNT(*) FROM activity) AS activity_count,
            (SELECT newestHistory FROM browser WHERE id = ?) AS latest,
            (SELECT oldestHistory FROM browser WHERE id = ?) AS oldest,
            (SELECT COUNT(*) FROM page) AS fetched_count
    """, (browserId, browserId))
    row = c.fetchone()
    return dict(row)


@addon
def set_active_archive(archive, archiveLocation):
    global active_archive
    if archive:
        archive.close()
    active_archive = Archive(archiveLocation)

set_active_archive.archive_optional = True


@addon
def get_archive_info(archive):
    if not archive:
        return None
    return {"path": archive.path, "title": archive.title}

get_archive_info.archive_optional = True


@addon
def set_archive_title(archive, title):
    archive.title = title


@addon
def log(archive, *args, level='log', stack=None):
    filename = os.path.join(archive.path, "addon.log")
    with open(filename, "a") as fp:
        if stack:
            log_location = stack.splitlines()[0]
            log_location = re.sub(r'moz-extension://[a-f0-9-]+/', '/', log_location)
        else:
            log_location = ""
        print("Log/{: <5} {} {}".format(level, int(time.time() * 1000), log_location), file=fp)
        if len(str(args)) < 70 and len(args) > 1:
            args = (args,)
        for arg in args:
            if isinstance(arg, str):
                s = arg
            else:
                s = pprint.pformat(arg, compact=True)
                if isinstance(arg, tuple):
                    s = s[1:-1]
            s = s.splitlines()
            for line in s:
                print("   ", line, file=fp)
        if not args:
            print("    (no arguments)", file=fp)
        print(file=fp)


def write_page(archive, url, data):
    pages = list(Page.selectBy(url=url, orderBy="-fetched", limit=1))
    if not pages:
        raise Exception("No page found with url %r" % url)
    pages[0].scrapeData = data


def run_saver():
    while True:
        m_name = "(unknown)"
        try:
            message = get_message()
            m_name = "%(name)s(%(args)s%(kwargs)s)" % dict(
                name=message["name"],
                args=", ".join(json.dumps(s) for s in message.get("args", [])),
                kwargs=", ".join("%s=%s" % (name, json.dumps(value)) for name, value in message.get("kwargs", {}).items()),
            )
            if len(m_name) > 100:
                m_name = m_name[:60] + " ... " + m_name[-10:]
            print("Message:", m_name, file=sys.stderr)
            handler = message_handlers.get(message["name"])
            if not handler:
                print("Error: got unexpected message name: %r" % message["name"], file=sys.stderr)
                continue
            if active_archive is None and not getattr(handler, "archive_optional", False):
                raise Exception("Attempted to send message before setting archive: %s()" % m_name)
            result = handler(active_archive, *message.get("args", ()), **message.get("kwargs", {}))
            send_message({"id": message["id"], "result": result})
        except Exception as e:
            tb = traceback.format_exc()
            log(active_archive, "Error processing message %s(): %s" % (m_name, e), tb, level='s_err')
            send_message({"id": message["id"], "error": str(e), "traceback": tb})


def get_message():
    length = sys.stdin.buffer.read(4)
    if len(length) == 0:
        sys.exit(0)
    length = struct.unpack('@I', length)[0]
    message = sys.stdin.buffer.read(length).decode('utf-8')
    message = json.loads(message)
    return message


def encode_message(message):
    content = json.dumps(message).encode('utf-8')
    length = struct.pack('@I', len(content))
    return length + content


def send_message(message):
    sys.stdout.buffer.write(encode_message(message))
    sys.stdout.buffer.flush()