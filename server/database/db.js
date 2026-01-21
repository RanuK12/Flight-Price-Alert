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

    // Tabla de ofertas encontradas (deals)
    await run(`
      CREATE TABLE IF NOT EXISTS deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        price REAL NOT NULL,
        deal_level TEXT,
        outbound_date TEXT,
        return_date TEXT,
        trip_type TEXT DEFAULT 'oneway',
        airline TEXT,
        booking_url TEXT,
        savings REAL,
        savings_percent INTEGER,
        notified INTEGER DEFAULT 0,
        found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(origin, destination, outbound_date, price)
      )
    `);

    console.log('✅ Esquema de base de datos inicializado');
    return true;
  } catch (error) {
    console.error('Error inicializando base de datos:', error.message);
    return false;
  }
}

/**
 * Guarda un precio de vuelo
 */
async function saveFlightPrice(data) {
  const { origin, destination, price, date, airline, source } = data;
  const routeId = `${origin}-${destination}`;
  
  return run(`
    INSERT OR IGNORE INTO flight_prices 
    (route_id, origin, destination, airline, price, source, departure_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [routeId, origin, destination, airline, price, source, date]);
}

/**
 * Guarda una oferta encontrada
 */
async function saveDeal(deal) {
  const {
    origin,
    destination,
    lowestPrice,
    dealLevel,
    outboundDate,
    returnDate,
    tripType,
    bookingUrl,
    savings,
    savingsPercent,
  } = deal;

  const airline = deal.bestFlights?.[0]?.airline || 'Multiple';

  return run(`
    INSERT OR IGNORE INTO deals 
    (origin, destination, price, deal_level, outbound_date, return_date, trip_type, airline, booking_url, savings, savings_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [origin, destination, lowestPrice, dealLevel, outboundDate, returnDate, tripType, airline, bookingUrl, savings || 0, savingsPercent || 0]);
}

/**
 * Obtiene ofertas recientes
 */
async function getRecentDeals(limit = 20) {
  return all(`
    SELECT * FROM deals 
    ORDER BY found_at DESC 
    LIMIT ?
  `, [limit]);
}

/**
 * Obtiene las mejores ofertas por nivel
 */
async function getBestDeals(dealLevel = null, limit = 10) {
  if (dealLevel) {
    return all(`
      SELECT * FROM deals 
      WHERE deal_level = ?
      ORDER BY price ASC 
      LIMIT ?
    `, [dealLevel, limit]);
  }
  
  return all(`
    SELECT * FROM deals 
    WHERE deal_level IN ('steal', 'great')
    ORDER BY 
      CASE deal_level 
        WHEN 'steal' THEN 1 
        WHEN 'great' THEN 2 
        ELSE 3 
      END,
      price ASC
    LIMIT ?
  `, [limit]);
}

/**
 * Estadísticas de ofertas
 */
async function getDealStats() {
  const stats = await get(`
    SELECT 
      COUNT(*) as totalDeals,
      COUNT(CASE WHEN deal_level = 'steal' THEN 1 END) as steals,
      COUNT(CASE WHEN deal_level = 'great' THEN 1 END) as great,
      COUNT(CASE WHEN deal_level = 'good' THEN 1 END) as good,
      MIN(price) as lowestPrice,
      AVG(price) as avgPrice,
      AVG(savings_percent) as avgSavingsPercent
    FROM deals
  `);

  const byRoute = await all(`
    SELECT 
      origin || ' → ' || destination as route,
      COUNT(*) as dealCount,
      MIN(price) as lowestPrice,
      AVG(price) as avgPrice
    FROM deals
    GROUP BY origin, destination
    ORDER BY dealCount DESC
    LIMIT 10
  `);

  return {
    ...stats,
    byRoute,
  };
}

/**
 * Historial de precios para una ruta
 */
async function getPriceHistory(origin, destination, days = 30) {
  return all(`
    SELECT price, departure_date, airline, source, recorded_at
    FROM flight_prices
    WHERE origin = ? AND destination = ?
    AND recorded_at >= datetime('now', '-' || ? || ' days')
    ORDER BY recorded_at DESC
  `, [origin, destination, days]);
}

/**
 * Marca alerta como enviada
 */
async function markAlertSent(dealId) {
  return run(`UPDATE deals SET notified = 1 WHERE id = ?`, [dealId]);
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase,
  saveFlightPrice,
  saveDeal,
  getRecentDeals,
  getBestDeals,
  getDealStats,
  getPriceHistory,
  markAlertSent,
};
