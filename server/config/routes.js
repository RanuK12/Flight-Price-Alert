/**
 * Configuración de Rutas de Vuelo v2.0
 *
 * Rutas activas:
 * 1. MDQ → COR (Mar del Plata → Córdoba) — 19-24 abr, solo ida
 * 2. España → Chicago (MAD/BCN → ORD) — 20-30 jun, solo ida
 * 3. Argentina → Europa (COR/EZE → MAD/BCN/FCO/MXP) — 15 jun - 31 jul, solo ida
 *
 * Precios en USD (Google Flights API devuelve USD)
 */

// ═══════════════════════════════════════════════════════════════
// RUTA 1: Mar del Plata → Córdoba (doméstico Argentina)
// ═══════════════════════════════════════════════════════════════
const ARGENTINA_DOMESTIC = [
  { origin: 'MDQ', destination: 'COR', name: 'Mar del Plata → Córdoba' },
];

// ═══════════════════════════════════════════════════════════════
// RUTA 2: España → Chicago
// ═══════════════════════════════════════════════════════════════
const SPAIN_TO_CHICAGO = [
  { origin: 'MAD', destination: 'ORD', name: 'Madrid → Chicago' },
  { origin: 'BCN', destination: 'ORD', name: 'Barcelona → Chicago' },
];

// ═══════════════════════════════════════════════════════════════
// RUTA 3: Argentina → Italia/España
// ═══════════════════════════════════════════════════════════════
const ARGENTINA_TO_EUROPE = [
  // Desde Buenos Aires
  { origin: 'EZE', destination: 'MAD', name: 'Buenos Aires → Madrid' },
  { origin: 'EZE', destination: 'BCN', name: 'Buenos Aires → Barcelona' },
  { origin: 'EZE', destination: 'FCO', name: 'Buenos Aires → Roma' },
  { origin: 'EZE', destination: 'MXP', name: 'Buenos Aires → Milán' },
  // Desde Córdoba
  { origin: 'COR', destination: 'MAD', name: 'Córdoba → Madrid' },
  { origin: 'COR', destination: 'BCN', name: 'Córdoba → Barcelona' },
  { origin: 'COR', destination: 'FCO', name: 'Córdoba → Roma' },
  { origin: 'COR', destination: 'MXP', name: 'Córdoba → Milán' },
];

/**
 * Precios de referencia (en USD, solo ida)
 *
 * DATOS REALES (marzo 2026, temporada alta jun-jul):
 *
 * MDQ → COR: Doméstico Argentina
 *   - Real: $318-$342 (con escalas)
 *   - Oferta: ≤$250
 *   - Ganga: ≤$180
 *
 * España → Chicago (jun 2026):
 *   - MAD-ORD real: $551 min (Iberia/AA nonstop)
 *   - BCN-ORD real: $561 min (TAP/Turkish conexión)
 *   - Oferta: ≤$480
 *   - Ganga: ≤$380
 *
 * Argentina → España (jun-jul 2026, temporada alta):
 *   - EZE-MAD real: $606 min (ITA conexión), $1099+ directo AR
 *   - EZE-BCN real: $682 min (ITA), $771 (LEVEL)
 *   - Oferta: ≤$700
 *   - Ganga: ≤$550
 *
 * Argentina → Italia (jun-jul 2026):
 *   - EZE-FCO/MXP: estimado $700-850 (conexión)
 *   - Oferta: ≤$750
 *   - Ganga: ≤$600
 *
 * Córdoba → Europa: ~$100-200 más que desde EZE (conexión vía EZE)
 */
const PRICE_THRESHOLDS = {
  // Doméstico Argentina (USD)
  'MDQ-COR': { typical: 350, deal: 250, steal: 180 },

  // España → Chicago (USD, temporada alta)
  'MAD-ORD': { typical: 600, deal: 480, steal: 380 },
  'BCN-ORD': { typical: 620, deal: 480, steal: 380 },

  // Buenos Aires → España (USD, temporada alta jun-jul)
  'EZE-MAD': { typical: 850, deal: 700, steal: 550 },
  'EZE-BCN': { typical: 800, deal: 700, steal: 550 },

  // Buenos Aires → Italia (USD, temporada alta)
  'EZE-FCO': { typical: 900, deal: 750, steal: 600 },
  'EZE-MXP': { typical: 850, deal: 750, steal: 600 },

  // Córdoba → España (USD, +$100-200 vs EZE)
  'COR-MAD': { typical: 1000, deal: 850, steal: 700 },
  'COR-BCN': { typical: 950, deal: 850, steal: 700 },

  // Córdoba → Italia (USD)
  'COR-FCO': { typical: 1100, deal: 900, steal: 750 },
  'COR-MXP': { typical: 1050, deal: 900, steal: 750 },
};

/**
 * Determina si un precio es una oferta
 */
function analyzePrice(origin, destination, price, tripType = 'oneway') {
  const routeKey = `${origin}-${destination}`;
  const thresholds = PRICE_THRESHOLDS[routeKey];

  if (!thresholds) {
    return {
      isDeal: false,
      dealLevel: null,
      message: 'Sin datos de referencia para esta ruta',
    };
  }

  const typical = thresholds.typical;
  const deal = thresholds.deal;
  const steal = thresholds.steal;

  const savings = typical - price;
  const savingsPercent = Math.round((savings / typical) * 100);

  if (price <= steal) {
    return {
      isDeal: true,
      dealLevel: 'steal',
      emoji: '🔥🔥🔥',
      message: `¡GANGA INCREÍBLE! Ahorras $${savings} (${savingsPercent}% menos que lo normal)`,
      savings, savingsPercent, typical, deal, steal,
    };
  } else if (price <= deal) {
    return {
      isDeal: true,
      dealLevel: 'great',
      emoji: '🔥🔥',
      message: `¡MUY BUENA OFERTA! Ahorras $${savings} (${savingsPercent}% menos)`,
      savings, savingsPercent, typical, deal, steal,
    };
  } else if (price <= typical * 0.85) {
    return {
      isDeal: true,
      dealLevel: 'good',
      emoji: '🔥',
      message: `Buen precio. Ahorras $${savings} (${savingsPercent}% menos)`,
      savings, savingsPercent, typical, deal, steal,
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
      message: `Precio alto. Típico: $${typical}`,
      typical,
    };
  }
}

/**
 * Genera fechas de búsqueda dentro de un rango
 */
function generateDatesInRange(startDate, endDate, options = {}) {
  const { preferredDays = [2, 3], maxDates = 12 } = options;

  const dates = [];
  const preferredDates = [];
  const otherDates = [];

  let current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();

    if (preferredDays.includes(dayOfWeek)) {
      preferredDates.push(dateStr);
    } else {
      otherDates.push(dateStr);
    }

    current.setDate(current.getDate() + 1);
  }

  dates.push(...preferredDates.slice(0, Math.ceil(maxDates * 0.6)));
  dates.push(...otherDates.slice(0, maxDates - dates.length));

  return dates.sort();
}

/**
 * Obtiene todas las rutas para monitorear
 */
function getAllRoutes(type = 'all') {
  switch (type) {
    case 'domestic':
      return ARGENTINA_DOMESTIC;
    case 'spain-chicago':
      return SPAIN_TO_CHICAGO;
    case 'argentina-europe':
      return ARGENTINA_TO_EUROPE;
    case 'all':
    default:
      return [...ARGENTINA_DOMESTIC, ...SPAIN_TO_CHICAGO, ...ARGENTINA_TO_EUROPE];
  }
}

function getRoutesFromOrigin(origin) {
  return getAllRoutes().filter(route => route.origin === origin);
}

function getRoutesToDestination(destination) {
  return getAllRoutes().filter(route => route.destination === destination);
}

module.exports = {
  ARGENTINA_DOMESTIC,
  SPAIN_TO_CHICAGO,
  ARGENTINA_TO_EUROPE,
  PRICE_THRESHOLDS,
  analyzePrice,
  generateDatesInRange,
  getAllRoutes,
  getRoutesFromOrigin,
  getRoutesToDestination,
};
