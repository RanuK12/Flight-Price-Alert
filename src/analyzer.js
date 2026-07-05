/**
 * Micro herramienta de análisis de precios de vuelos para producto empaquetado.
 * Enfoque minimalista: sin secrets en código, solo lógica pura.
 */

const axios = require('axios');

// Configuración mínima (sin secrets, valores por defecto)
const CONFIG = Object.freeze({
  baseUrl: 'https://test.api.amadeus.com',
  rateLimitRps: 8,
  cacheTtlMs: 21600000, // 6 horas
});

/**
 * Analiza el historial de precios de una ruta específica.
 * @param {string} origin - Código IATA origen (ej: 'JFK')
 * @param {string} destination - Código IATA destino (ej: 'LAX')
 * @param {string} departureDate - Fecha de salida (YYYY-MM-DD)
 * @returns {Promise<Array<{date: string, price: number}>>} Lista de precios históricos
 */
async function analyzePriceHistory(origin, destination, departureDate) {
  if (!origin || !destination || !departureDate) {
    throw new Error('Faltan parámetros: origin, destination, departureDate');
  }

  // Simulación de historial (en producción se conectaría a Amadeus API o DB)
  const mockPrices = generateMockPriceHistory(origin, destination, departureDate);
  
  return mockPrices.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Compara precios entre múltiples rutas.
 * @param {Array<{origin: string, destination: string, date: string}>} routes
 * @returns {Promise<Object>} Resumen comparativo con mejor precio por ruta
 */
async function compareRoutes(routes) {
  if (!routes || !Array.isArray(routes) || routes.length === 0) {
    throw new Error('Debe proporcionar un array de rutas');
  }

  const results = await Promise.all(
    routes.map(async (route) => {
      const history = await analyzePriceHistory(route.origin, route.destination, route.date);
      const minPrice = Math.min(...history.map((p) => p.price));
      const bestDate = history.find((p) => p.price === minPrice)?.date;
      
      return {
        route: `${route.origin} → ${route.destination}`,
        departureDate: route.date,
        minPrice,
        bestDate,
        priceTrend: calculateTrend(history),
      };
    })
  );

  return {
    bestOverall: results.reduce((prev, curr) => (curr.minPrice < prev.minPrice ? curr : prev)),
    routes: results,
  };
}

// Helpers

function generateMockPriceHistory(origin, destination, departureDate) {
  const basePrice = Math.floor(Math.random() * 500) + 100;
  const days = 30;
  const mockData = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(departureDate);
    date.setDate(date.getDate() - i);
    const formattedDate = date.toISOString().split('T')[0];

    // Fluctuación aleatoria (±20%)
    const fluctuation = basePrice * (0.8 + Math.random() * 0.4);
    const price = Math.round(fluctuation);

    mockData.push({ date: formattedDate, price });
  }

  return mockData;
}

function calculateTrend(prices) {
  if (prices.length < 2) return 'stable';

  const first = prices[0].price;
  const last = prices[prices.length - 1].price;
  const change = ((last - first) / first) * 100;

  if (change > 10) return 'rising';
  if (change < -10) return 'falling';
  return 'stable';
}

// Exportar funciones puras para ser usadas en cualquier contexto
module.exports = { analyzePriceHistory, compareRoutes };

// Ejemplo de uso (solo para testing local, no secrets)
if (require.main === module) {
  (async () => {
    try {
      console.log('🔍 Analizando historial de precios...');
      const history = await analyzePriceHistory('JFK', 'LAX', '2024-12-01');
      console.log('Historia de precios:', history);

      console.log('\n⚖️ Comparando rutas...');
      const routes = [
        { origin: 'JFK', destination: 'LAX', date: '2024-12-01' },
        { origin: 'MIA', destination: 'SFO', date: '2024-12-01' },
        { origin: 'EWR', destination: 'ORD', date: '2024-12-01' },
      ];
      const comparison = await compareRoutes(routes);
      console.log('Comparación:', comparison);
    } catch (error) {
      console.error('Error:', error.message);
    }
  })();
}
