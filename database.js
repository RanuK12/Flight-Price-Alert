const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'prices.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error conectando a base de datos:', err.message);
  }
});

const run = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const get = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

async function initDb() {
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route TEXT,
        date TEXT,
        price REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(route, date)
      )
    `);
    return true;
  } catch (error) {
    console.error('Error inicializando DB:', error.message);
    return false;
  }
}

async function insertPrice(route, date, price) {
  try {
    await run(
      `INSERT OR REPLACE INTO prices (route, date, price) VALUES (?, ?, ?)`,
      [route, date, price]
    );
  } catch (error) {
    console.error('Error guardando precio:', error.message);
  }
}

async function getLastPrice(route, date) {
  try {
    const result = await get(
      `SELECT price FROM prices WHERE route = ? AND date = ? LIMIT 1`,
      [route, date]
    );
    return result ? result.price : null;
  } catch (error) {
    console.error('Error obteniendo precio anterior:', error.message);
    return null;
  }
}

module.exports = {
  initDb,
  insertPrice,
  getLastPrice,
  db,
};
