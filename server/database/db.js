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

    // Cache de respuestas de búsqueda (para ahorrar requests de SerpApi)
    await run(`
      CREATE TABLE IF NOT EXISTS flight_search_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        UNIQUE(provider, cache_key)
      )
    `);

    // Uso diario por provider (control de presupuesto)
    await run(`
      CREATE TABLE IF NOT EXISTS provider_daily_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        usage_date TEXT NOT NULL, -- YYYY-MM-DD en timezone objetivo
        used INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, usage_date)
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
 * Cache helpers
 */
async function getCachedResponse(provider, cacheKey) {
  const row = await get(
    `SELECT response_json, expires_at FROM flight_search_cache WHERE provider = ? AND cache_key = ?`,
    [provider, cacheKey]
  );
  if (!row) return null;

  // Validar expiración
  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  if (isNaN(expiresAt.getTime()) || expiresAt <= now) {
    // limpiar cache vencida
    try {
      await run(`DELETE FROM flight_search_cache WHERE provider = ? AND cache_key = ?`, [provider, cacheKey]);
    } catch (e) { /* ignore */ }
    return null;
  }

  try {
    return JSON.parse(row.response_json);
  } catch {
    return null;
  }
}

async function setCachedResponse(provider, cacheKey, responseObj, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const responseJson = JSON.stringify(responseObj);

  return run(
    `INSERT OR REPLACE INTO flight_search_cache (provider, cache_key, response_json, created_at, expires_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [provider, cacheKey, responseJson, expiresAt.toISOString()]
  );
}

/**
 * Provider usage helpers
 */
async function getProviderUsage(provider, usageDate) {
  const row = await get(
    `SELECT used FROM provider_daily_usage WHERE provider = ? AND usage_date = ?`,
    [provider, usageDate]
  );
  return row?.used ?? 0;
}

async function incrementProviderUsage(provider, usageDate, by = 1) {
  await run(
    `INSERT INTO provider_daily_usage (provider, usage_date, used, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(provider, usage_date)
     DO UPDATE SET used = used + ?, updated_at = CURRENT_TIMESTAMP`,
    [provider, usageDate, by, by]
  );
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

/**
 * Obtiene el precio mínimo histórico para una ruta
 */
async function getHistoricalMinPrice(origin, destination, tripType = 'oneway') {
  const row = await get(`
    SELECT MIN(price) as minPrice, recorded_at
    FROM flight_prices
    WHERE origin = ? AND destination = ?
  `, [origin, destination]);
  
  return row?.minPrice || null;
}

/**
 * Detecta si un precio es un nuevo mínimo histórico
 */
async function isNewHistoricalLow(origin, destination, currentPrice, tripType = 'oneway') {
  const historicalMin = await getHistoricalMinPrice(origin, destination, tripType);
  
  if (historicalMin === null) {
    // Primera vez que vemos esta ruta
    return { isNewLow: true, previousMin: null, improvement: null };
  }
  
  if (currentPrice < historicalMin) {
    const improvement = historicalMin - currentPrice;
    const improvementPercent = Math.round((improvement / historicalMin) * 100);
    return { 
      isNewLow: true, 
      previousMin: historicalMin, 
      improvement,
      improvementPercent,
    };
  }
  
  return { isNewLow: false, previousMin: historicalMin };
}

/**
 * Verifica si ya se envió alerta para este precio/ruta recientemente
 * Evita spam de alertas cuando el precio es similar
 */
async function wasRecentlyAlerted(origin, destination, price, hoursWindow = 24) {
  const row = await get(`
    SELECT id, price FROM deals
    WHERE origin = ? AND destination = ?
    AND notified = 1
    AND found_at >= datetime('now', '-' || ? || ' hours')
    ORDER BY found_at DESC
    LIMIT 1
  `, [origin, destination, hoursWindow]);
  
  if (!row) return false;
  
  // Si el precio es muy similar (±5%), no alertar de nuevo
  const priceDiff = Math.abs(row.price - price) / row.price;
  return priceDiff < 0.05;
}

/**
 * Guarda precio y devuelve análisis
 */
async function savePriceWithAnalysis(origin, destination, price, airline, source, departureDate, tripType = 'oneway') {
  // Guardar el precio
  await saveFlightPrice(origin, destination, price, airline, source, null, departureDate);
  
  // Analizar
  const historicalAnalysis = await isNewHistoricalLow(origin, destination, price, tripType);
  const recentlyAlerted = await wasRecentlyAlerted(origin, destination, price);
  
  return {
    price,
    origin,
    destination,
    airline,
    source,
    departureDate,
    tripType,
    ...historicalAnalysis,
    shouldAlert: historicalAnalysis.isNewLow && !recentlyAlerted,
    recentlyAlerted,
  };
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
  getCachedResponse,
  setCachedResponse,
  getProviderUsage,
  incrementProviderUsage,
  // Nuevas funciones para detección de mínimos
  getHistoricalMinPrice,
  isNewHistoricalLow,
  wasRecentlyAlerted,
  savePriceWithAnalysis,
};
