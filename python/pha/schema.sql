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
  newTab BOOLEAN,
  activeCount INT,
  closedReason TEXT,
  method TEXT,
  statusCode INT,
  contentType TEXT,
  hasSetCookie BOOLEAN,
  hasCookie BOOLEAN,
  copyEvents TEXT, -- Actually JSON
  formControlInteraction INT,
  formTextInteraction INT
);
