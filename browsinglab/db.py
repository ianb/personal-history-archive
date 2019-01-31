import os
from sqlobject import (
    sqlhub, SQLObject, connectionForURI,
    StringCol, DateTimeCol, FloatCol, IntCol, ForeignKey, BoolCol, JSONCol,
)
from .urlcol import URLCol
from . import connlist

conn_init = False


class Archive:
    """
    Represents one archive. It exists in some location on disk
    """
    def __init__(self, path):
        global conn_init
        if conn_init:
            raise Exception("Two archives can't yet coexist")
        if not os.path.exists(path):
            os.makedirs(path)
        connlist.add_location(path)
        self.path = path
        self.sqlite_path = os.path.join(path, 'history.sqlite')
        conn_init = True
        sqlhub.processConnection = connectionForURI('sqlite:%s/history.sqlite' % self.path)

    @property
    def title(self):
        title_path = os.path.join(self.path, "title.txt")
        if os.path.exists(title_path):
            with open(title_path) as fp:
                return fp.read().strip() or None
        return None

    @title.setter
    def set_title(self, value):
        title_path = os.path.join(self.path, "title.txt")
        if value:
            with open(title_path, "w") as fp:
                fp.write(value)
        elif os.path.exists(title_path):
            os.unlink(title_path)

    def close(self):
        global conn_init
        conn_init = False
        if sqlhub.processConnection:
            sqlhub.processConnection.close()
        sqlhub.processConnection = None
        self.path = None
        self.sqlite_path = None


class Browser(SQLObject):
    uuid = StringCol()
    created = DateTimeCol(default=DateTimeCol.now)
    userAgent = StringCol()
    devicePixelRatio = FloatCol()
    connected = BoolCol(default=False, notNone=True)


class BrowserSession(SQLObject):
    uuid = StringCol()
    browserId = ForeignKey('Browser')
    startTime = IntCol()
    endTime = IntCol()
    timezoneOffset = IntCol()


class Page(SQLObject):
    uuid = StringCol()
    url = URLCol(notNone=True)
    fetched = DateTimeCol(default=DateTimeCol.now)
    activityId = ForeignKey('Activity')
    timeToFetch = IntCol()
    redirectUrl = URLCol()
    redirectOk = BoolCol(default=False, notNone=True)
    scrapeData = JSONCol()


class Activity(SQLObject):
    uuid = StringCol()
    browserId = ForeignKey('Browser')
    sessionId = ForeignKey('Session')
    url = URLCol(notNone=True)
    title = StringCol()
    ogTitle = StringCol()
    loadTime = IntCol()
    unloadTime = IntCol()
    transitionType = StringCol()
    sourceClickText = StringCol()
    sourceClickHref = StringCol() # FIXME: URL
    clientRedirect = BoolCol(default=False, notNone=True)
    serverRedirect = BoolCol(default=False, notNone=True)
    forwardBack = BoolCol(default=False, notNone=True)
    fromAddressBar = BoolCol(default=False, notNone=True)
    sourceId = ForeignKey('Activity')
    browserReferringVisitId = StringCol()
    initialLoadId = ForeignKey('Activity')
    newTab = BoolCol()  # was opened in new tab?
    activeCount = IntCol()  # Count of times it was "activated"
    activeTime = IntCol()  # Millisecond active time
    closedReason = StringCol()
    method = StringCol()  # HTTP request method
    statusCode = IntCol()  # HTTP status code
    contentType = StringCol()  # HTTP Content-Type
    hasSetCookie = BoolCol()  # has Set-Cookie response header
    hasCookie = BoolCol()  # has Cookie request header
    copyEvents = JSONCol()
    formControlInteraction = IntCol()  # count of form interactions
    formTextInteraction = IntCol()  # count of form interactions
    isHashChange = BoolCol()
    maxScroll = IntCol()  # pixel Y location
    documentHeight = IntCol()  # pixel height
    hashPointsToElement = BoolCol()
    zoomLevel = FloatCol()  # 1.0 means 100% zoom
    canonicalUrl = URLCol()  # URL
    mainFeedUrl = URLCol()  # URL
    allFeeds = JSONCol()


class ActivityLink(SQLObject):
    activityId = ForeignKey('Activity')
    url = URLCol(notNone=True)
    text = StringCol(notNone=True)
    rel = StringCol()
    target = StringCol()
    elementId = StringCol()
