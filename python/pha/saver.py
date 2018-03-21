"""
Implements saving information into the database/files
"""

import os
import stat
import json
import sys
import struct
import time
import pprint
import traceback
from . import Page

message_handlers = {}

def addon(func):
    message_handlers[func.__name__] = func
    return func

@addon
def add_history_list(archive, *, browserId, historyItems):
    for historyId, item in historyItems.items():
        c = archive.conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO history (
              id,
              browser_id,
              url,
              title,
              lastVisitTime,
              visitCount,
              typedCount
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (historyId, browserId, item["url"], item["title"], item["lastVisitTime"], item["visitCount"], item["typedCount"]))
        for visitId, visit in item["visits"].items():
            c.execute("""
                INSERT OR REPLACE INTO visit (
                id,
                history_id,
                visitTime,
                referringVisitId,
                transition
                ) VALUES (?, ?, ?, ?, ?)
            """, (visitId, historyId, visit["visitTime"], visit["referringVisitId"], visit["transition"]))
        archive.conn.commit()
    c = archive.conn.cursor()
    c.execute("""
        UPDATE browser
          SET
            latest = (SELECT MAX(lastvisitTime)
                      FROM history WHERE browser_id = ?),
            oldest = (SELECT MIN(lastvisitTime)
                      FROM history WHERE browser_id = ?)
    """, (browserId, browserId))
    archive.conn.commit()

@addon
def add_activity_list(archive, *, browserId, activityItems):
    for activity in activityItems:
        c = archive.conn.cursor()
        activity["browser_id"] = browserId
        columns = """
            id
            browser_id
            sessionId
            url
            loadTime
            unloadTime
            transitionType
            client_redirect
            server_redirect
            forward_back
            from_address_bar
            sourceId
            initialLoadId
            newTab
            activeCount
            closedReason
            method
            statusCode
            contentType
            hasSetCookie
        """.strip().split()
        for null_default in "sourceId transitionType".split():
            activity.setdefault(null_default, None)
        marks = ["?"] * len(columns)
        values = [activity[column] for column in columns]
        c.execute("""
            INSERT OR REPLACE INTO activity (
              %s
            ) VALUES (%s)
        """ % (", ".join(columns), ", ".join(marks)), values)
    archive.conn.commit()

@addon
def register_browser(archive, *, browserId, userAgent, testing=False, autofetch=False):
    c = archive.conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO browser (id, userAgent, testing, autofetch)
        VALUES (?, ?, ?, ?)
    """, (browserId, userAgent, testing, autofetch))
    c.execute("""
        UPDATE browser
          SET
            newestHistory = (SELECT MAX(lastvisitTime)
                             FROM history WHERE browser_id = ?),
            oldestHistory = (SELECT MIN(lastvisitTime)
                             FROM history WHERE browser_id = ?)
    """, (browserId, browserId))
    archive.conn.commit()

@addon
def register_session(archive, sessionId, browserId):
    c = archive.conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO browser_session (id, browserId, startTime)
        VALUES (?, ?, CURRENT_TIMESTAMP)
    """, (sessionId, browserId))
    archive.conn.commit()

@addon
def get_needed_pages(archive, limit=100):
    c = archive.conn.cursor()
    rows = c.execute("""
        SELECT history.url, fetch_error.error_message FROM history
        LEFT JOIN page
            ON page.url = history.url
        LEFT JOIN fetch_error
            ON fetch_error.url = history.url
        WHERE page.url IS NULL
        ORDER BY fetch_error.url IS NULL DESC, lastVisitTime DESC
        LIMIT ?
    """, (limit,))
    return [{"url": row["url"], "lastError": row["error_message"]} for row in rows]

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
def add_fetch_failure(archive, url, error_message):
    c = archive.conn.cursor()
    c.execute("""
        INSERT OR REPLACE INTO fetch_error (url, error_message)
        VALUES (?, ?)
    """, (url, error_message))
    archive.conn.commit()

@addon
def status(archive, browserId):
    c = archive.conn.cursor()
    c.execute("""
        SELECT
            (SELECT COUNT(*) FROM history) AS history_count,
            (SELECT latest FROM browser WHERE id = ?) AS latest,
            (SELECT oldest FROM browser WHERE id = ?) AS oldest,
            (SELECT COUNT(*) FROM history, page WHERE history.url = page.url) AS fetched_count
    """, (browserId, browserId))
    row = c.fetchone()
    return dict(row)

@addon
def log(archive, *args, level='log'):
    filename = os.path.join(archive.path, "addon.log")
    with open(filename, "a") as fp:
        print("Log/{: <5} {}".format(level, int(time.time() * 1000)), file=fp)
        if len(str(args)) < 70:
            args = (args,)
        for arg in args:
            s = pprint.pformat(arg, compact=True)
            s = s.splitlines()
            for line in s:
                print("   ", line, file=fp)
        if not args:
            print("    (no arguments)", file=fp)

def write_page(archive, url, data):
    filename = Page.json_filename(archive, url)
    with open(filename, "wb") as fp:
        fp.write(json.dumps(data).encode("UTF-8"))

def run_saver(storage_directory=None):
    from . import Archive
    if not storage_directory:
        archive = Archive.default_location()
    else:
        archive = Archive(storage_directory)
    while True:
        m_name = "(unknown)"
        try:
            message = get_message()
            m_name = "%(name)s(%(args)%(kwargs))" % dict(
                name=message["name"],
                args=", ".join(json.dumps(s) for s in message.get("args", [])),
                kwargs=", ".join("%s=%s" % (name, json.dumps(value)) for name, value in message.get("kwargs", {}).items()),
            )
            print("Message:", m_name, file=sys.stderr)
            handler = message_handlers.get(message["name"])
            if not handler:
                print("Error: got unexpected message name: %r" % message["name"], file=sys.stderr)
                continue
            result = handler(archive, *message.get("args", ()), **message.get("kwargs", {}))
            send_message({"id": message["id"], "result": result})
        except Exception as e:
            tb = traceback.format_exc()
            log(archive, "Error processing message %s(): %s" % (m_name, e), tb, level='error')
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

def install_json_command():
    import argparse
    default_location = os.path.abspath(os.path.join(os.path.abspath(__file__), "../../../"))
    script_location = os.path.expanduser("~/.pha-starter.py")
    parser = argparse.ArgumentParser()
    parser.add_argument("storage_directory", help="Location for storing the database and files", default=default_location)
    parser.add_argument("--script-location", "-s", help="Location to keep the connection script", default=script_location)
    parser.add_argument("--native-name", help="Name this will be registered for", default="pha.saver")
    args = parser.parse_args()
    print("Using the storage directory", args.storage_directory)
    print("Writing a connector script to", args.script_location)
    install_json_file(args.storage_directory, args.script_location, args.native_name)

def install_json_file(storage_directory, script_location, native_name):
    # FIXME: support Windows
    manifest_path = os.path.abspath(os.path.join(__file__, "../../../tracker-extension/manifest.json"))
    script_location = os.path.abspath(script_location)
    with open(manifest_path) as fp:
        manifest = json.load(fp)
    manifest_id = manifest["applications"]["gecko"]["id"]
    with open(script_location, "w") as fp:
        # This script should support a Windows .BAT file
        fp.write("""\
#!%s
storage_directory = %r
from pha.saver import run_saver
run_saver(storage_directory)
""" % (sys.executable, os.path.abspath(storage_directory)))
    st = os.stat(script_location)
    os.chmod(script_location, st.st_mode | stat.S_IEXEC)
    native_manifest = {
        "name": native_name,
        "description": "Saves information from the personal-history-archive extension",
        "path": script_location,
        "type": "stdio",
        "allowed_extensions": [manifest_id]
    }
    if sys.platform == "darwin":
        filename = os.path.expanduser("~/Library/Application Support/Mozilla/NativeMessagingHosts/%s.json" % native_name)
    elif sys.platform.startswith("linux"):
        filename = os.path.expanduser("~/.mozilla/native-messaging-hosts/%s.json" % native_name)
    else:
        raise Exception("Not a supported platform")
    dir = os.path.dirname(filename)
    if not os.path.exists(dir):
        os.makedirs(dir)
    with open(filename, "wb") as fp:
        fp.write(json.dumps(native_manifest, indent=2).encode("UTF-8"))

if __name__ == "__main__":
    install_json_command()
