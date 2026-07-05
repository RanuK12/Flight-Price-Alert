/**
 * Comparador de rutas de vuelo - parte de la micro herramienta.
 * Funciones puras para comparar precios entre múltiples rutas.
 */

const { analyzePriceHistory } = require('./analyzer');

/**
 * Compara precios entre múltiples rutas y devuelve el mejor precio encontrado.
 * @param {Array<{origin: string, destination: string, date: string}>} routes
 * @returns {Promise<Object>} Resumen con mejor ruta y detalles
 */
async function compareRoutes(routes) {
  if (!routes || !Array.isArray(routes) || routes.length === 0) {
    throw new Error('Debe proporcionar un array de rutas válidas');
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

function calculateTrend(prices) {
  if (prices.length < 2) return 'stable';

  const first = prices[0].price;
  const last = prices[prices.length - 1].price;
  const change = ((last - first) / first) * 100;

  if (change > 10) return 'rising';
  if (change < -10) return 'falling';
  return 'stable';
}

module.exports = { compareRoutes };
