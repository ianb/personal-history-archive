const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database("./history.sqlite", () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser (
      id TEXT PRIMARY KEY,
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      latest INT,
      oldest INT,
      user_agent TEXT
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
      url TEXT PRIMARY KEY,
      fetched TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      -- NULL means we don't know:
      not_logged_in BOOLEAN DEFAULT NULL,
      timeToFetch INT,
      redirectUrl TEXT
    );
  `);
});

exports.db = db;

exports.dbRun = function(sql, ...params) {
  return dbSomething('run', sql, ...params);
};

exports.dbGet = function(sql, ...params) {
  return dbSomething('get', sql, ...params);
};

exports.dbAll = function(sql, ...params) {
  return dbSomething('all', sql, ...params);
};

function dbSomething(command, sql, ...params) {
  return new Promise((resolve, reject) => {
    db[command](sql, ...params, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
