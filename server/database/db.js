const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../data', 'flights.db');

// Crear directorio de datos si no existe
const fs = require('fs');
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar base de datos:', err.message);
  } else {
    console.log('✅ Base de datos conectada');
  }
});

const run = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
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

const all = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

async function initDatabase() {
  try {
    // Tabla de precios registrados
    await run(`
      CREATE TABLE IF NOT EXISTS flight_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        airline TEXT,
        price REAL NOT NULL,
        source TEXT,
        booking_url TEXT,
        departure_date TEXT,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(route_id, airline, departure_date, recorded_at)
      )
    `);

    // Tabla de rutas guardadas por el usuario
    await run(`
      CREATE TABLE IF NOT EXISTS saved_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        price_threshold REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(origin, destination)
      )
    `);

    // Tabla de alertas enviadas
    await run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT NOT NULL,
        price REAL,
        message TEXT,
        sent_to_telegram INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de búsquedas recientes
    await run(`
      CREATE TABLE IF NOT EXISTS search_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Esquema de base de datos inicializado');
    return true;
  } catch (error) {
    console.error('Error inicializando base de datos:', error.message);
    return false;
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase,
};
