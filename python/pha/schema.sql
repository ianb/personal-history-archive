CREATE TABLE IF NOT EXISTS browser (
  id TEXT PRIMARY KEY,
  created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  oldestHistory INT,
  newestHistory INT,
  userAgent TEXT,
  testing BOOLEAN,
  autofetch BOOLEAN
);

CREATE TABLE IF NOT EXISTS browser_session (
  id TEXT PRIMARY KEY,
  browserId TEXT REFERENCES browser (id) ON DELETE CASCADE,
  startTime INT,
  endTime
);

CREATE TABLE IF NOT EXISTS history (
  id TEXT UNIQUE PRIMARY KEY,
  browser_id TEXT REFERENCES browser (id) ON DELETE CASCADE,
  url TEXT,
  title TEXT,
  lastVisitTime TIMESTAMP,
  visitCount INT NOT NULL DEFAULT 0,
  typedCount INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visit (
  id TEXT UNIQUE PRIMARY KEY,
  history_id TEXT REFERENCES history (id) ON DELETE CASCADE,
  visitTime TIMESTAMP,
  referringVisitId TEXT REFERENCES visit (id),
  transition TEXT
);

CREATE TABLE IF NOT EXISTS page (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- NULL means we don't know:
  not_logged_in BOOLEAN DEFAULT NULL,
  timeToFetch INT,
  redirectUrl TEXT,
  redirectOk BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS fetch_error (
  url TEXT PRIMARY KEY,
  attempted TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  browser_id TEXT REFERENCES browser (id) ON DELETE CASCADE,
  sessionId TEXT REFERENCES browser_session (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  loadTime INT,
  unloadTime INT,
  transitionType TEXT,
  client_redirect BOOLEAN DEFAULT FALSE,
  server_redirect BOOLEAN DEFAULT FALSE,
  forward_back BOOLEAN DEFAULT FALSE,
  from_address_bar BOOLEAN DEFAULT FALSE,
  sourceId TEXT REFERENCES activity (id) ON DELETE SET NULL,
  initialLoadId TEXT REFERENCES activity (id) ON DELETE SET NULL,
  newTab BOOLEAN DEFAULT FALSE,
  activeCount INT,
  closedReason TEXT,
  method TEXT,
  statusCode INT,
  contentType TEXT,
  hasSetCookie BOOLEAN
);
