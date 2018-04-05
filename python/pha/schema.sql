CREATE TABLE IF NOT EXISTS browser (
  id TEXT PRIMARY KEY,
  created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  oldestHistory INT,
  newestHistory INT,
  userAgent TEXT,
  testing BOOLEAN,
  autofetch BOOLEAN,
  devicePixelRatio FLOAT
);

CREATE TABLE IF NOT EXISTS browser_session (
  id TEXT PRIMARY KEY,
  browserId TEXT REFERENCES browser (id) ON DELETE CASCADE,
  startTime INT,
  endTime INT,
  timezoneOffset INT
);

CREATE TABLE IF NOT EXISTS page (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  activityId TEXT REFERENCES activity (id) ON DELETE SET NULL,
  timeToFetch INT,
  redirectUrl TEXT,
  redirectOk BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS fetch_error (
  url TEXT PRIMARY KEY,
  attempted TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  errorMessage TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  browserId TEXT REFERENCES browser (id) ON DELETE CASCADE,
  sessionId TEXT REFERENCES browser_session (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  ogTitle TEXT,
  browserHistoryId TEXT,
  browserVisitId TEXT,
  loadTime INT,
  unloadTime INT,
  transitionType TEXT,
  sourceClickText TEXT,
  sourceClickHref TEXT,
  client_redirect BOOLEAN DEFAULT FALSE,
  server_redirect BOOLEAN DEFAULT FALSE,
  forward_back BOOLEAN DEFAULT FALSE,
  from_address_bar BOOLEAN DEFAULT FALSE,
  sourceId TEXT REFERENCES activity (id) ON DELETE SET NULL,
  browserReferringVisitId TEXT,
  initialLoadId TEXT REFERENCES activity (id) ON DELETE SET NULL,
  newTab BOOLEAN, -- was opened in new tab?
  activeCount INT, -- Count of times it was "activated"
  activeTime INT, -- Millisecond active time
  closedReason TEXT,
  method TEXT, -- HTTP request method
  statusCode INT, -- HTTP status code
  contentType TEXT, -- HTTP Content-Type
  hasSetCookie BOOLEAN, -- has Set-Cookie response header
  hasCookie BOOLEAN, -- has Cookie request header
  copyEvents TEXT, -- Actually JSON
  formControlInteraction INT, -- count of form interactions
  formTextInteraction INT, -- count of form interactions
  isHashChange BOOLEAN,
  maxScroll INT, -- pixel Y location
  documentHeight INT, -- pixel height
  hashPointsToElement BOOLEAN,
  zoomLevel FLOAT, -- 1.0 means 100% zoom
  canonicalUrl TEXT, -- URL
  mainFeedUrl TEXT, -- URL
  allFeeds TEXT -- JSON
);

CREATE TABLE IF NOT EXISTS activity_link (
  activity_id TEXT REFERENCES activity (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  text TEXT NOT NULL,
  rel TEXT,
  target TEXT,
  elementId TEXT
);
