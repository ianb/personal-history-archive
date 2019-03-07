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
import atexit
from .db import Page, Archive, Activity, ActivityLink, Browser, BrowserSession
from . import connlist

message_handlers = {}

active_archive = None
active_browser = None

@atexit.register
def end():
    if active_browser:
        active_browser.connected = False


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
def add_activity_list(archive, *, browserId, sessionId, activityItems):
    sqlBrowserId = Browser.getID(browserId)
    sqlSessionId = BrowserSession.getID(sessionId)
    for activity in activityItems:
        linkInformation = activity.pop("linkInformation", [])
        uuid = activity.pop("id")
        activity["browserID"] = sqlBrowserId
        activity.pop("sessionId", None)
        activity["sessionID"] = sqlSessionId
        activity["sourceID"] = Activity.getID(activity.pop("sourceId", None), default=None)
        activity["initialLoadID"] = Activity.getID(activity.pop("initialLoadId", None), default=None)
        a = Activity.replaceUuid(uuid, **activity)
        log(archive, a)
        ActivityLink.deleteMany(ActivityLink.activity==a)
        for link in linkInformation or []:
            link = ActivityLink(**link)


@addon
def check_page_needed(archive, url):
    return Page.urlExists(url)


@addon
def register_browser(archive, *, browserId, userAgent, devicePixelRatio=1):
    global active_browser
    b = Browser.replaceUuid(browserId, userAgent=userAgent, devicePixelRatio=devicePixelRatio, connected=True)
    active_browser = b


@addon
def register_session(archive, sessionId, browserId, timezoneOffset):
    BrowserSession.replaceUuid(
        sessionId,
        browserID=Browser.getID(browserId),
        timezoneOffset=timezoneOffset,
        startTime=int(time.time() * 1000))


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
    if page.get("activityId"):
        page["activityId"] = Activity.getID(page["activityId"], default=None)
    Page.replaceUuid(
        id,
        url=url,
        activityId=page.get("activityId"),
        timeToFetch=page["timeToFetch"],
        redirectUrl=redirectUrl,
        scrapeData=page,
        )

def substitute_location(path):
    path = path.replace("__prefix__", sys.prefix)
    path = os.path.expanduser(path)
    path = os.path.abspath(path)
    return path

@addon
def set_active_archive(archive, archiveLocation):
    global withheld_log_messages
    archiveLocation = substitute_location(archiveLocation)
    global active_archive
    if active_archive:
        active_archive.close()
    active_archive = Archive(archiveLocation)
    if withheld_log_messages:
        filename = os.path.join(active_archive.path, "addon.log")
        with open(filename, "a") as fp:
            fp.write("\n".join(withheld_log_messages))
        withheld_log_messages = []
    return archiveLocation

set_active_archive.archive_optional = True

@addon
def unset_active_archive(archive):
    global active_archive
    active_archive.close()
    active_archive = None

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
def list_archives(archive):
    return connlist.list_archives()

list_archives.archive_optional = True

withheld_log_messages = []

@addon
def log(archive, *args, level='log', stack=None):
    lines = []
    if stack:
        log_location = stack.splitlines()[0]
        log_location = re.sub(r'moz-extension://[a-f0-9-]+/', '/', log_location)
    else:
        log_location = ""
    lines.append("Log/{: <5} {} {}".format(level, int(time.time() * 1000), log_location))
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
            lines.append("    %s" % line)
    if not args:
        lines.append("    (no arguments)")
    text = "\n".join(lines) + "\n"
    if not archive:
        filename = os.path.join(sys.prefix, "../addon.log")
        withheld_log_messages.append(text)
    else:
        filename = os.path.join(archive.path, "addon.log")
    with open(filename, "a") as fp:
        fp.write(text)

log.archive_optional = True

class LogPrinter:

    def __init__(self):
        self._cache = ""

    def write(self, s):
        sys.stderr.write(s)
        self._cache += s
        if self._cache.endswith("\n") or len(self._cache.splitlines()) > 1:
            log(active_archive, "print: %s" % self._cache.rstrip())
            self._cache = ""

    def flush(self):
        sys.stderr.flush()


def write_page(archive, url, data):
    pages = list(Page.selectBy(url=url, orderBy="-fetched", limit=1))
    if not pages:
        raise Exception("No page found with url %r" % url)
    pages[0].scrapeData = data


def connect():
    print("Running browsing-connector from %s" % __file__, file=sys.stderr)
    sys.stdout = LogPrinter()
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
            # print("Message:", m_name, file=sys.stderr)
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
    sys.__stdout__.buffer.write(encode_message(message))
    sys.__stdout__.buffer.flush()
