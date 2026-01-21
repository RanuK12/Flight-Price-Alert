/**
 * Configuración de Rutas de Vuelo
 * 
 * Define las rutas a monitorear para encontrar ofertas
 */

// Rutas Europa → Argentina
const EUROPE_TO_ARGENTINA = [
  // Desde España
  { origin: 'MAD', destination: 'EZE', name: 'Madrid → Buenos Aires' },
  { origin: 'BCN', destination: 'EZE', name: 'Barcelona → Buenos Aires' },
  
  // Desde Portugal (generalmente más barato)
  { origin: 'LIS', destination: 'EZE', name: 'Lisboa → Buenos Aires' },
  
  // Desde Italia
  { origin: 'FCO', destination: 'EZE', name: 'Roma → Buenos Aires' },
  { origin: 'MXP', destination: 'EZE', name: 'Milán → Buenos Aires' },
  
  // Desde Francia
  { origin: 'CDG', destination: 'EZE', name: 'París → Buenos Aires' },
  
  // Desde Alemania
  { origin: 'FRA', destination: 'EZE', name: 'Frankfurt → Buenos Aires' },
  
  // Desde Países Bajos
  { origin: 'AMS', destination: 'EZE', name: 'Amsterdam → Buenos Aires' },
  
  // Desde Reino Unido
  { origin: 'LHR', destination: 'EZE', name: 'Londres → Buenos Aires' },
];

// Rutas Europa → Estados Unidos
const EUROPE_TO_USA = [
  // A New York
  { origin: 'MAD', destination: 'JFK', name: 'Madrid → New York' },
  { origin: 'BCN', destination: 'JFK', name: 'Barcelona → New York' },
  { origin: 'LIS', destination: 'JFK', name: 'Lisboa → New York' },
  { origin: 'CDG', destination: 'JFK', name: 'París → New York' },
  { origin: 'LHR', destination: 'JFK', name: 'Londres → New York' },
  { origin: 'FRA', destination: 'JFK', name: 'Frankfurt → New York' },
  { origin: 'AMS', destination: 'JFK', name: 'Amsterdam → New York' },
  
  // A Miami (conexión popular)
  { origin: 'MAD', destination: 'MIA', name: 'Madrid → Miami' },
  { origin: 'BCN', destination: 'MIA', name: 'Barcelona → Miami' },
  { origin: 'LIS', destination: 'MIA', name: 'Lisboa → Miami' },
  
  // A Los Angeles
  { origin: 'MAD', destination: 'LAX', name: 'Madrid → Los Angeles' },
  { origin: 'LHR', destination: 'LAX', name: 'Londres → Los Angeles' },
];

/**
 * Precios de referencia actualizados (en EUR)
 * 
 * typical: Precio promedio normal
 * deal: Buena oferta (25-30% menos que típico)
 * steal: Ganga/Error fare (40-50% menos que típico)
 * 
 * Estos precios son para vuelos de IDA
 * Para ida y vuelta, multiplicar por ~1.8
 */
const PRICE_THRESHOLDS = {
  // Europa → Argentina (vuelos de ~12-14 horas)
  'MAD-EZE': { typical: 650, deal: 450, steal: 320, roundTripMultiplier: 1.7 },
  'BCN-EZE': { typical: 680, deal: 470, steal: 340, roundTripMultiplier: 1.7 },
  'LIS-EZE': { typical: 600, deal: 400, steal: 280, roundTripMultiplier: 1.7 },
  'FCO-EZE': { typical: 720, deal: 500, steal: 360, roundTripMultiplier: 1.8 },
  'MXP-EZE': { typical: 700, deal: 480, steal: 350, roundTripMultiplier: 1.8 },
  'CDG-EZE': { typical: 750, deal: 520, steal: 380, roundTripMultiplier: 1.8 },
  'FRA-EZE': { typical: 720, deal: 500, steal: 360, roundTripMultiplier: 1.8 },
  'AMS-EZE': { typical: 700, deal: 480, steal: 340, roundTripMultiplier: 1.8 },
  'LHR-EZE': { typical: 780, deal: 540, steal: 400, roundTripMultiplier: 1.8 },
  
  // Europa → USA (vuelos de ~8-10 horas)
  'MAD-JFK': { typical: 420, deal: 280, steal: 200, roundTripMultiplier: 1.6 },
  'BCN-JFK': { typical: 450, deal: 300, steal: 220, roundTripMultiplier: 1.6 },
  'LIS-JFK': { typical: 400, deal: 260, steal: 180, roundTripMultiplier: 1.6 },
  'CDG-JFK': { typical: 400, deal: 250, steal: 170, roundTripMultiplier: 1.5 },
  'LHR-JFK': { typical: 380, deal: 240, steal: 160, roundTripMultiplier: 1.5 },
  'FRA-JFK': { typical: 420, deal: 280, steal: 200, roundTripMultiplier: 1.6 },
  'AMS-JFK': { typical: 400, deal: 260, steal: 180, roundTripMultiplier: 1.6 },
  'MAD-MIA': { typical: 450, deal: 300, steal: 220, roundTripMultiplier: 1.6 },
  'BCN-MIA': { typical: 480, deal: 320, steal: 240, roundTripMultiplier: 1.6 },
  'LIS-MIA': { typical: 420, deal: 280, steal: 200, roundTripMultiplier: 1.6 },
  'MAD-LAX': { typical: 500, deal: 350, steal: 260, roundTripMultiplier: 1.7 },
  'LHR-LAX': { typical: 450, deal: 300, steal: 220, roundTripMultiplier: 1.6 },
};

/**
 * Determina si un precio es una oferta
 */
function analyzePrice(origin, destination, price, tripType = 'oneway') {
  const routeKey = `${origin}-${destination}`;
  const thresholds = PRICE_THRESHOLDS[routeKey];
  
  if (!thresholds) {
    // Si no tenemos datos de referencia, usar heurística
    return {
      isDeal: false,
      dealLevel: null,
      message: 'Sin datos de referencia para esta ruta',
    };
  }

  // Ajustar umbrales para ida y vuelta
  const multiplier = tripType === 'roundtrip' ? thresholds.roundTripMultiplier : 1;
  const typical = thresholds.typical * multiplier;
  const deal = thresholds.deal * multiplier;
  const steal = thresholds.steal * multiplier;

  const savings = typical - price;
  const savingsPercent = Math.round((savings / typical) * 100);

  if (price <= steal) {
    return {
      isDeal: true,
      dealLevel: 'steal',
      emoji: '🔥🔥🔥',
      message: `¡GANGA INCREÍBLE! Ahorras €${savings} (${savingsPercent}% menos que lo normal)`,
      savings,
      savingsPercent,
      typical,
      deal,
      steal,
    };
  } else if (price <= deal) {
    return {
      isDeal: true,
      dealLevel: 'great',
      emoji: '🔥🔥',
      message: `¡MUY BUENA OFERTA! Ahorras €${savings} (${savingsPercent}% menos)`,
      savings,
      savingsPercent,
      typical,
      deal,
      steal,
    };
  } else if (price <= typical * 0.85) {
    return {
      isDeal: true,
      dealLevel: 'good',
      emoji: '🔥',
      message: `Buen precio. Ahorras €${savings} (${savingsPercent}% menos)`,
      savings,
      savingsPercent,
      typical,
      deal,
      steal,
    };
  } else if (price <= typical) {
    return {
      isDeal: false,
      dealLevel: 'normal',
      emoji: '✈️',
      message: 'Precio dentro del rango normal',
      typical,
    };
  } else {
    return {
      isDeal: false,
      dealLevel: 'high',
      emoji: '📈',
      message: `Precio alto. Típico: €${typical}`,
      typical,
    };
  }
}

/**
 * Genera fechas de búsqueda inteligentes
 * - Evita fines de semana (más caros)
 * - Incluye martes y miércoles (típicamente más baratos)
 */
function generateSmartDates(options = {}) {
  const {
    startDaysAhead = 7,
    endDaysAhead = 90,
    preferredDays = [2, 3], // Martes, Miércoles
    maxDates = 10,
  } = options;

  const dates = [];
  const today = new Date();
  const preferredDates = [];
  const otherDates = [];

  for (let i = startDaysAhead; i <= endDaysAhead; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay();
    const dateStr = date.toISOString().split('T')[0];

    if (preferredDays.includes(dayOfWeek)) {
      preferredDates.push(dateStr);
    } else if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      otherDates.push(dateStr);
    }
  }

  // Priorizar fechas preferidas
  dates.push(...preferredDates.slice(0, Math.ceil(maxDates * 0.6)));
  dates.push(...otherDates.slice(0, maxDates - dates.length));

  return dates.sort();
}

/**
 * Obtiene todas las rutas para monitorear
 */
function getAllRoutes(type = 'all') {
  switch (type) {
    case 'argentina':
      return EUROPE_TO_ARGENTINA;
    case 'usa':
      return EUROPE_TO_USA;
    case 'all':
    default:
      return [...EUROPE_TO_ARGENTINA, ...EUROPE_TO_USA];
  }
}

/**
 * Obtiene rutas específicas desde un origen
 */
function getRoutesFromOrigin(origin) {
  return getAllRoutes().filter(route => route.origin === origin);
}

/**
 * Obtiene rutas específicas a un destino
 */
function getRoutesToDestination(destination) {
  return getAllRoutes().filter(route => route.destination === destination);
}

module.exports = {
  EUROPE_TO_ARGENTINA,
  EUROPE_TO_USA,
  PRICE_THRESHOLDS,
  analyzePrice,
  generateSmartDates,
  getAllRoutes,
  getRoutesFromOrigin,
  getRoutesToDestination,
};
