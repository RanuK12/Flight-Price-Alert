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

// ═══════════════════════════════════════════════════════════════
// RUTA 4: Italia → Tokio (sep/oct 2026, ~10 días, ida y vuelta)
//
// Precios reales Google Flights (abr 2026):
//   FCO/MXP → TYO sep/oct: mínimo ~$1,030 USD, típico ~$1,350, alto ~$1,700+
// ═══════════════════════════════════════════════════════════════
const ITALY_TO_TOKYO = [
  { origin: 'FCO', destination: 'TYO', name: 'Roma → Tokio' },
  { origin: 'MXP', destination: 'TYO', name: 'Milán → Tokio' },
];

/**
 * Precios de referencia (en USD, solo ida)
 *
 * Niveles de alerta:
 *   steal  = Ofertón (casi imposible, error de tarifa)
 *   deal   = Muy bajo (promo loca)
 *   good   = Normal para abajo (buen precio)
 *   typical = Precio real mínimo de referencia actual
 *
 * MDQ→COR:     steal <$150 | deal $150-$220 | good $220-$270 | típico $318
 * MAD→ORD:     steal <$380 | deal $380-$450 | good $450-$520 | típico $551
 * BCN→ORD:     steal <$350 | deal $350-$430 | good $430-$500 | típico $561
 * EZE→MAD/BCN: steal <$800 | deal $800-$950 | good $950-$1100 | típico $1200+
 * EZE→FCO/MXP: steal <$850 | deal $850-$1000 | good $1000-$1200 | típico $1300+
 * COR→España:  steal <$900 | deal $900-$1100 | good $1100-$1300 | típico $1400+
 * COR→Italia:  steal <$950 | deal $950-$1150 | good $1150-$1350 | típico $1500+
 */
const PRICE_THRESHOLDS = {
  // Doméstico Argentina
  'MDQ-COR': { typical: 318, deal: 220, steal: 150 },

  // España → Chicago
  'MAD-ORD': { typical: 551, deal: 450, steal: 380 },
  'BCN-ORD': { typical: 561, deal: 430, steal: 350 },

  // Buenos Aires → España (temporada alta jun-jul)
  'EZE-MAD': { typical: 1200, deal: 950, steal: 800 },
  'EZE-BCN': { typical: 1200, deal: 950, steal: 800 },

  // Buenos Aires → Italia (temporada alta)
  'EZE-FCO': { typical: 1300, deal: 1000, steal: 850 },
  'EZE-MXP': { typical: 1300, deal: 1000, steal: 850 },

  // Córdoba → España
  'COR-MAD': { typical: 1400, deal: 1100, steal: 900 },
  'COR-BCN': { typical: 1400, deal: 1100, steal: 900 },

  // Córdoba → Italia
  'COR-FCO': { typical: 1500, deal: 1150, steal: 950 },
  'COR-MXP': { typical: 1500, deal: 1150, steal: 950 },

  // Italia → Tokio (ida y vuelta, ~10 días, sep/oct 2026)
  // Datos reales Google Flights abr 2026:
  //   mínimo ~$1,030 | típico ~$1,350 | alto ~$1,700+
  'FCO-TYO': { typical: 1350, deal: 1100, steal: 950 },
  'MXP-TYO': { typical: 1350, deal: 1100, steal: 950 },
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
    case 'italy-tokyo':
      return ITALY_TO_TOKYO;
    case 'all':
    default:
      return [...ARGENTINA_DOMESTIC, ...SPAIN_TO_CHICAGO, ...ARGENTINA_TO_EUROPE, ...ITALY_TO_TOKYO];
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
  ITALY_TO_TOKYO,
  PRICE_THRESHOLDS,
  analyzePrice,
  generateDatesInRange,
  getAllRoutes,
  getRoutesFromOrigin,
  getRoutesToDestination,
};
