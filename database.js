const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'prices.sqlite');
let dbInstance;

function ensureDatabase() {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  dbInstance = new sqlite3.Database(DB_PATH);
  dbInstance.serialize(() => {
    dbInstance.run(
      `CREATE TABLE IF NOT EXISTS prices (
        route TEXT NOT NULL,
        date TEXT NOT NULL,
        price REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (route, date)
      )`
    );
  });
  return dbInstance;
}

function insertPrice(route, date, price) {
  const db = ensureDatabase();
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO prices (route, date, price, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(route, date) DO UPDATE SET
         price = excluded.price,
         created_at = CURRENT_TIMESTAMP`,
      [route, date, price],
      function callback(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ id: this.lastID, changes: this.changes });
      }
    );
  });
}

function closeDatabase() {
  if (!dbInstance) return Promise.resolve();
  return new Promise((resolve, reject) => {
    dbInstance.close(err => {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = {
  insertPrice,
  closeDatabase,
  ensureDatabase
};
