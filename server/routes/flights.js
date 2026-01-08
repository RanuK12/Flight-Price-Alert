const express = require('express');
const { scrapeAllSources } = require('../scrapers');
const { db, get, all, run } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// GET /api/search - Buscar vuelos
router.get('/search', async (req, res) => {
  try {
    const { origin, destination } = req.query;

    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Falta origin o destination',
        example: '/api/search?origin=MAD&destination=AEP'
      });
    }

    // Registrar búsqueda
    try {
      await run(
        'INSERT INTO search_history (origin, destination) VALUES (?, ?)',
        [origin.toUpperCase(), destination.toUpperCase()]
      );
    } catch (e) {
      // Ignorar errores de historial
    }

    const results = await scrapeAllSources(origin, destination);

    // Guardar resultados en BD
    const routeId = `${origin.toUpperCase()}-${destination.toUpperCase()}`;
    
    for (const flight of results.allFlights.slice(0, 10)) {
      try {
        await run(
          `INSERT INTO flight_prices 
           (route_id, origin, destination, airline, price, source, booking_url, departure_date, recorded_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            routeId,
            origin.toUpperCase(),
            destination.toUpperCase(),
            flight.airline,
            flight.price,
            flight.source,
            flight.link,
            flight.departureDate || null
          ]
        );
      } catch (e) {
        // Ignorar duplicados
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error en búsqueda:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/history/:origin/:destination - Historial de precios
router.get('/history/:origin/:destination', async (req, res) => {
  try {
    const { origin, destination } = req.params;
    const routeId = `${origin.toUpperCase()}-${destination.toUpperCase()}`;

    const history = await all(
      `SELECT * FROM flight_prices 
       WHERE route_id = ? 
       ORDER BY recorded_at DESC 
       LIMIT 100`,
      [routeId]
    );

    res.json({
      route: routeId,
      history,
      count: history.length,
    });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/search-history - Búsquedas recientes
router.get('/search-history', async (req, res) => {
  try {
    const limit = req.query.limit || 20;

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
    console.error('Error en historial de búsquedas:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/alert - Crear alerta de precio
router.post('/alert', async (req, res) => {
  try {
    const { origin, destination, threshold } = req.body;

    if (!origin || !destination || !threshold) {
      return res.status(400).json({
        error: 'Falta origin, destination o threshold'
      });
    }

    const alertId = uuidv4();
    
    await run(
      `INSERT OR REPLACE INTO saved_routes 
       (origin, destination, price_threshold) 
       VALUES (?, ?, ?)`,
      [origin.toUpperCase(), destination.toUpperCase(), threshold]
    );

    res.json({
      success: true,
      alertId,
      message: `Alerta creada para ${origin} → ${destination} con umbral €${threshold}`,
    });
  } catch (error) {
    console.error('Error creando alerta:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/alerts - Listar alertas guardadas
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

// DELETE /api/alert/:id - Eliminar alerta
router.delete('/alert/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await run(
      'DELETE FROM saved_routes WHERE id = ?',
      [id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Alerta no encontrada' });
    }

    res.json({ success: true, message: 'Alerta eliminada' });
  } catch (error) {
    console.error('Error eliminando alerta:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stats - Estadísticas
router.get('/stats', async (req, res) => {
  try {
    const totalSearches = await get(
      'SELECT COUNT(*) as count FROM search_history'
    );

    const totalFlights = await get(
      'SELECT COUNT(*) as count FROM flight_prices'
    );

    const avgPrice = await get(
      'SELECT AVG(price) as avg FROM flight_prices WHERE price > 0'
    );

    const minPrice = await get(
      'SELECT MIN(price) as min FROM flight_prices WHERE price > 0'
    );

    res.json({
      totalSearches: totalSearches?.count || 0,
      totalFlightsIndexed: totalFlights?.count || 0,
      avgPrice: Math.round(avgPrice?.avg || 0),
      minPriceFound: minPrice?.min || 0,
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
