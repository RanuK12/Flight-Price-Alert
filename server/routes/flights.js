const express = require('express');
const crypto = require('crypto');

// Función para generar UUID usando crypto nativo de Node.js
const uuidv4 = () => crypto.randomUUID();

// Nuevos módulos
const { searchGoogleFlights, generateBookingUrl, AIRPORTS, REFERENCE_PRICES } = require('../scrapers/googleFlights');
const { getAllRoutes, analyzePrice, generateSmartDates, PRICE_THRESHOLDS } = require('../config/routes');
const { runFullSearch, quickSearch, startMonitoring, stopMonitoring, getMonitorStatus, getStats } = require('../services/flightMonitor');
const { initTelegram, sendTestMessage, isActive } = require('../services/telegram');
const { get, all, run, getRecentDeals, getBestDeals, getDealStats, getPriceHistory } = require('../database/db');

const router = express.Router();

// ==========================================
// BÚSQUEDA DE VUELOS
// ==========================================

/**
 * GET /api/search - Buscar vuelos con precios reales
 * Query params: origin, destination, date (opcional), tripType (opcional)
 */
router.get('/search', async (req, res) => {
  try {
    const { origin, destination, date, tripType = 'oneway' } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Faltan parámetros requeridos',
        example: '/api/search?origin=MAD&destination=EZE&date=2026-02-15'
      });
    }

    // Usar fecha de hoy + 14 días si no se especifica
    const searchDate = date || generateSmartDates({ maxDates: 1 })[0];

    console.log(`\n🔍 API: Buscando ${origin} → ${destination} (${searchDate})`);

    const result = await searchGoogleFlights(
      origin.toUpperCase(),
      destination.toUpperCase(),
      searchDate,
      null,
      tripType
    );

    if (result.success && result.lowestPrice) {
      // Analizar si es oferta
      const analysis = analyzePrice(origin.toUpperCase(), destination.toUpperCase(), result.lowestPrice, tripType);
      result.analysis = analysis;
      result.bookingUrl = generateBookingUrl(origin.toUpperCase(), destination.toUpperCase(), searchDate);
    }

    // Registrar búsqueda
    try {
      await run(
        'INSERT INTO search_history (origin, destination) VALUES (?, ?)',
        [origin.toUpperCase(), destination.toUpperCase()]
      );
    } catch (e) { /* ignorar */ }

    res.json(result);

  } catch (error) {
    console.error('Error en búsqueda:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/search/multi - Búsqueda en múltiples fechas
 */
router.get('/search/multi', async (req, res) => {
  try {
    const { origin, destination, dates } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Faltan origin o destination'
      });
    }

    // Si no hay fechas, generar automáticamente
    const searchDates = dates 
      ? dates.split(',') 
      : generateSmartDates({ maxDates: 5 });

    const results = [];

    for (const date of searchDates) {
      try {
        const result = await searchGoogleFlights(
          origin.toUpperCase(),
          destination.toUpperCase(),
          date.trim()
        );

        if (result.success) {
          const analysis = analyzePrice(origin.toUpperCase(), destination.toUpperCase(), result.lowestPrice);
          results.push({
            date: date.trim(),
            price: result.lowestPrice,
            ...analysis,
            bookingUrl: generateBookingUrl(origin.toUpperCase(), destination.toUpperCase(), date.trim()),
          });
        }
      } catch (e) {
        console.error(`Error buscando ${date}:`, e.message);
      }

      // Pequeña pausa
      await new Promise(r => setTimeout(r, 500));
    }

    res.json({
      origin: origin.toUpperCase(),
      destination: destination.toUpperCase(),
      results: results.sort((a, b) => a.price - b.price),
      cheapest: results.length > 0 ? results.sort((a, b) => a.price - b.price)[0] : null,
    });

  } catch (error) {
    console.error('Error en búsqueda múltiple:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// OFERTAS (DEALS)
// ==========================================

/**
 * GET /api/deals - Obtener ofertas encontradas
 */
router.get('/deals', async (req, res) => {
  try {
    const { limit = 20, level } = req.query;

    const deals = level 
      ? await getBestDeals(level, parseInt(limit))
      : await getRecentDeals(parseInt(limit));

    res.json({
      deals,
      count: deals.length,
    });

  } catch (error) {
    console.error('Error obteniendo deals:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/deals/best - Mejores ofertas actuales
 */
router.get('/deals/best', async (req, res) => {
  try {
    const steals = await getBestDeals('steal', 5);
    const great = await getBestDeals('great', 10);

    res.json({
      steals,
      greatDeals: great,
      totalBestDeals: steals.length + great.length,
    });

  } catch (error) {
    console.error('Error obteniendo mejores deals:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/deals/stats - Estadísticas de ofertas
 */
router.get('/deals/stats', async (req, res) => {
  try {
    const stats = await getDealStats();
    res.json(stats);

  } catch (error) {
    console.error('Error obteniendo stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// MONITOREO
// ==========================================

/**
 * POST /api/monitor/start - Iniciar monitoreo continuo
 */
router.post('/monitor/start', async (req, res) => {
  try {
    const { schedule = '0 */4 * * *' } = req.body;
    
    const started = startMonitoring(schedule);
    
    res.json({
      success: started,
      message: started 
        ? 'Monitoreo iniciado correctamente' 
        : 'El monitoreo ya estaba activo',
      status: getMonitorStatus(),
    });

  } catch (error) {
    console.error('Error iniciando monitor:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/monitor/stop - Detener monitoreo
 */
router.post('/monitor/stop', (req, res) => {
  const stopped = stopMonitoring();
  
  res.json({
    success: stopped,
    message: 'Monitoreo detenido',
    status: getMonitorStatus(),
  });
});

/**
 * GET /api/monitor/status - Estado del monitoreo
 */
router.get('/monitor/status', (req, res) => {
  res.json(getMonitorStatus());
});

/**
 * POST /api/monitor/search - Ejecutar búsqueda manual
 */
router.post('/monitor/search', async (req, res) => {
  try {
    const { routeType = 'all', notify = true, summary = false } = req.body;

    // Iniciar búsqueda en background
    runFullSearch({
      routeType,
      notifyDeals: notify,
      sendSummary: summary,
    }).catch(err => console.error('Error en búsqueda:', err));

    res.json({
      success: true,
      message: 'Búsqueda iniciada en segundo plano',
      status: getMonitorStatus(),
    });

  } catch (error) {
    console.error('Error ejecutando búsqueda:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTAS Y CONFIGURACIÓN
// ==========================================

/**
 * GET /api/routes - Obtener rutas disponibles
 */
router.get('/routes', (req, res) => {
  const { type = 'all' } = req.query;
  
  const routes = getAllRoutes(type);
  
  res.json({
    routes,
    count: routes.length,
    priceThresholds: PRICE_THRESHOLDS,
  });
});

/**
 * GET /api/airports - Lista de aeropuertos
 */
router.get('/airports', (req, res) => {
  res.json(AIRPORTS);
});

/**
 * GET /api/prices/reference - Precios de referencia
 */
router.get('/prices/reference', (req, res) => {
  res.json(PRICE_THRESHOLDS);
});

// ==========================================
// HISTORIAL
// ==========================================

/**
 * GET /api/history/:origin/:destination - Historial de precios
 */
router.get('/history/:origin/:destination', async (req, res) => {
  try {
    const { origin, destination } = req.params;
    const { days = 30 } = req.query;

    const history = await getPriceHistory(
      origin.toUpperCase(),
      destination.toUpperCase(),
      parseInt(days)
    );

    // Calcular estadísticas
    const prices = history.map(h => h.price);
    const stats = prices.length > 0 ? {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      count: prices.length,
    } : null;

    res.json({
      route: `${origin.toUpperCase()} → ${destination.toUpperCase()}`,
      history,
      stats,
      reference: PRICE_THRESHOLDS[`${origin.toUpperCase()}-${destination.toUpperCase()}`] || null,
    });

  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/search-history - Búsquedas recientes
 */
router.get('/search-history', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const history = await all(
      `SELECT DISTINCT origin, destination, MAX(searched_at) as last_search
       FROM search_history 
       GROUP BY origin, destination 
       ORDER BY last_search DESC 
       LIMIT ?`,
      [parseInt(limit)]
    );

    res.json(history);

  } catch (error) {
    console.error('Error en historial:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TELEGRAM
// ==========================================

/**
 * POST /api/telegram/test - Probar conexión Telegram
 */
router.post('/telegram/test', async (req, res) => {
  try {
    initTelegram();
    
    if (!isActive()) {
      return res.json({
        success: false,
        message: 'Telegram no configurado. Verifica TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID',
      });
    }

    const sent = await sendTestMessage();
    
    res.json({
      success: sent,
      message: sent 
        ? 'Mensaje de prueba enviado correctamente' 
        : 'Error enviando mensaje',
    });

  } catch (error) {
    console.error('Error probando Telegram:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/telegram/status - Estado de Telegram
 */
router.get('/telegram/status', (req, res) => {
  res.json({
    active: isActive(),
    configured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  });
});

// ==========================================
// ALERTAS
// ==========================================

/**
 * POST /api/alerts - Crear alerta de precio
 */
router.post('/alerts', async (req, res) => {
  try {
    const { origin, destination, threshold } = req.body;

    if (!origin || !destination || !threshold) {
      return res.status(400).json({
        error: 'Faltan parámetros: origin, destination, threshold'
      });
    }

    await run(
      `INSERT OR REPLACE INTO saved_routes 
       (origin, destination, price_threshold) 
       VALUES (?, ?, ?)`,
      [origin.toUpperCase(), destination.toUpperCase(), threshold]
    );

    res.json({
      success: true,
      message: `Alerta creada: ${origin} → ${destination} cuando precio < €${threshold}`,
    });

  } catch (error) {
    console.error('Error creando alerta:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/alerts - Listar alertas
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await all(
      'SELECT * FROM saved_routes ORDER BY created_at DESC'
    );
    res.json(alerts);

  } catch (error) {
    console.error('Error obteniendo alertas:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/alerts/:id - Eliminar alerta
 */
router.delete('/alerts/:id', async (req, res) => {
  try {
    await run('DELETE FROM saved_routes WHERE id = ?', [req.params.id]);
    res.json({ success: true });

  } catch (error) {
    console.error('Error eliminando alerta:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ESTADÍSTICAS GENERALES
// ==========================================

/**
 * GET /api/stats - Estadísticas completas
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);

  } catch (error) {
    console.error('Error obteniendo stats:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
