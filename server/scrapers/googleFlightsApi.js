/**
 * Google Flights API Scraper v1.0
 *
 * Calls Google Flights' internal API directly via HTTP POST.
 * Ported from the Python "fli" library (github.com/punitarani/fli).
 *
 * Advantages over Puppeteer:
 *   - No browser needed (faster, less memory)
 *   - Direct structured data (no DOM parsing)
 *   - More reliable results
 *   - Works on servers without Chrome
 *
 * Endpoint:
 *   POST https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults
 */

const axios = require('axios');

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SEARCH_URL =
  'https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults';

const CALENDAR_URL =
  'https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGraph';

const TRIP_TYPE = { ROUND_TRIP: 1, ONE_WAY: 2 };
const SEAT_TYPE = { ECONOMY: 1, PREMIUM_ECONOMY: 2, BUSINESS: 3, FIRST: 4 };
const MAX_STOPS = { ANY: 0, NON_STOP: 1, ONE_STOP: 2, TWO_STOPS: 3 };
const SORT_BY = { NONE: 0, TOP: 1, CHEAPEST: 2, DEPARTURE: 3, ARRIVAL: 4, DURATION: 5 };

const REQUEST_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Origin': 'https://www.google.com',
  'Referer': 'https://www.google.com/travel/flights',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// Rate limiting
let lastRequestTime = 0;
const MIN_DELAY_MS = 150; // ~6 req/sec max

// Circuit breaker
const circuitBreaker = {
  failures: 0,
  lastFailure: null,
  isOpen: false,
  threshold: 8,
  resetTimeout: 5 * 60 * 1000,

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.isOpen = true;
      console.log(`  🔴 API circuit breaker OPEN (${this.failures} failures). Pause 5 min.`);
    }
  },

  recordSuccess() {
    this.failures = Math.max(0, this.failures - 1);
    if (this.failures === 0) this.isOpen = false;
  },

  canProceed() {
    if (!this.isOpen) return true;
    if (Date.now() - this.lastFailure > this.resetTimeout) {
      this.isOpen = false;
      this.failures = 0;
      return true;
    }
    return false;
  },
};

// ═══════════════════════════════════════════════════════════════
// PAYLOAD ENCODING (port of fli's FlightSearchFilters.encode)
// ═══════════════════════════════════════════════════════════════

/**
 * Build the nested filter array for Google Flights API
 */
function buildFiltersArray({
  segments,
  tripType = TRIP_TYPE.ONE_WAY,
  seatType = SEAT_TYPE.ECONOMY,
  adults = 1,
  children = 0,
  infantsOnLap = 0,
  infantsInSeat = 0,
  maxStops = MAX_STOPS.ANY,
  sortBy = SORT_BY.CHEAPEST,
  maxPrice = null,
  currency = 'EUR',
}) {
  const formattedSegments = segments.map(seg => [
    [[[seg.origin, 0]]],       // departure airports
    [[[seg.destination, 0]]],  // arrival airports
    null,                       // time restrictions
    maxStops,                   // stops filter
    null,                       // airlines filter
    null,                       // placeholder
    seg.date,                   // travel date "YYYY-MM-DD"
    null,                       // max duration
    null,                       // selected flights (round-trip)
    null,                       // layover airports
    null,
    null,
    null,                       // layover max duration
    null,                       // emissions
    3,                          // constant
  ]);

  const filters = [
    [],
    [
      null,
      null,
      tripType,
      null,
      [],
      seatType,
      [adults, children, infantsOnLap, infantsInSeat],
      maxPrice ? [null, maxPrice] : null,
      null, null, null, null, null,
      formattedSegments,
      null,
      [currency],           // index 15: currency
      null,
      1,
    ],
    sortBy,
    0,
    0,
    2,
  ];

  return filters;
}

/**
 * Encode filters into the f.req POST body format
 */
function encodePayload(filters) {
  const filtersJson = JSON.stringify(filters);
  const wrapped = JSON.stringify([null, filtersJson]);
  return `f.req=${encodeURIComponent(wrapped)}`;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE PARSING (port of fli's response parser)
// ═══════════════════════════════════════════════════════════════

/**
 * Parse raw Google Flights API response into flight results
 */
function parseFlightsResponse(responseText) {
  // Strip XSSI prefix ")]}" and parse
  const cleaned = responseText.replace(/^\)\]\}'[\s\n]*/, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.log('  ⚠️ API: Failed to parse outer JSON');
    return [];
  }

  // Navigate to inner JSON string: parsed[0][2]
  let innerJsonStr;
  try {
    innerJsonStr = parsed[0][2];
    if (typeof innerJsonStr !== 'string') {
      console.log('  ⚠️ API: Inner data is not a string');
      return [];
    }
  } catch (e) {
    console.log('  ⚠️ API: Cannot access parsed[0][2]');
    return [];
  }

  let data;
  try {
    data = JSON.parse(innerJsonStr);
  } catch (e) {
    console.log('  ⚠️ API: Failed to parse inner JSON');
    return [];
  }

  // Flight results in data[2] (best flights) and data[3] (other flights)
  const flights = [];

  for (const idx of [2, 3]) {
    try {
      const section = data[idx];
      if (!Array.isArray(section) || !Array.isArray(section[0])) continue;

      for (const item of section[0]) {
        const flight = parseFlightItem(item);
        if (flight) flights.push(flight);
      }
    } catch (e) {
      // Section not available
    }
  }

  return flights;
}

/**
 * Parse a single flight result item from the API response
 */
function parseFlightItem(item) {
  try {
    const flightInfo = item[0];
    if (!flightInfo) return null;

    // Price: item[1][0][last element]
    let price = null;
    try {
      const priceArr = item[1][0];
      price = priceArr[priceArr.length - 1];
      if (typeof price !== 'number' || price <= 0) return null;
    } catch (e) {
      return null;
    }

    // Legs (segments of the flight)
    const legs = flightInfo[2];
    if (!Array.isArray(legs) || legs.length === 0) return null;

    const stops = legs.length - 1;

    // Total duration: flightInfo[9]
    const totalDuration = flightInfo[9] || null;

    // Parse first and last leg for departure/arrival info
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];

    // Departure info from first leg
    const depAirport = safeGet(firstLeg, 3, '');
    const depTime = formatTime(safeGet(firstLeg, 8));
    const depDate = formatDate(safeGet(firstLeg, 20));

    // Arrival info from last leg
    const arrAirport = safeGet(lastLeg, 6, '');
    const arrTime = formatTime(safeGet(lastLeg, 10));
    const arrDate = formatDate(safeGet(lastLeg, 21));

    // Airline from first leg: leg[22] = [code, number, null, name]
    const airlineCode = safeGet(firstLeg, 22, 0) || '';
    const airlineName = safeGet(firstLeg, 22, 3) || '';
    const flightNumber = safeGet(firstLeg, 22, 1) || '';

    // Collect all airlines for multi-carrier flights
    const airlines = new Set();
    for (const leg of legs) {
      const name = safeGet(leg, 22, 3) || safeGet(leg, 22, 0);
      if (name) airlines.add(name);
    }

    // Build leg details
    const legDetails = legs.map(leg => ({
      depAirport: safeGet(leg, 3) || '',
      depAirportName: safeGet(leg, 4) || '',
      arrAirport: safeGet(leg, 6) || '',
      arrAirportName: safeGet(leg, 5) || '',
      depTime: formatTime(safeGet(leg, 8)),
      arrTime: formatTime(safeGet(leg, 10)),
      duration: safeGet(leg, 11) || null,
      airline: safeGet(leg, 22, 3) || safeGet(leg, 22, 0) || '',
      airlineCode: safeGet(leg, 22, 0) || '',
      flightNumber: `${safeGet(leg, 22, 0) || ''}${safeGet(leg, 22, 1) || ''}`,
      aircraft: safeGet(leg, 17) || '',
    }));

    return {
      price,
      airline: airlineName || AIRLINE_CODES[airlineCode] || airlineCode,
      airlineCode,
      flightNumber: `${airlineCode}${flightNumber}`,
      stops,
      totalDuration,
      departureAirport: depAirport,
      arrivalAirport: arrAirport,
      departureTime: depTime,
      arrivalTime: arrTime,
      departureDate: depDate,
      arrivalDate: arrDate,
      airlines: [...airlines],
      legs: legDetails,
      source: 'Google Flights API',
    };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR / DATE SEARCH
// ═══════════════════════════════════════════════════════════════

/**
 * Search for cheapest prices across a date range
 */
async function searchDateRange(origin, destination, dateFrom, dateTo, options = {}) {
  const {
    tripType = TRIP_TYPE.ONE_WAY,
    seatType = SEAT_TYPE.ECONOMY,
    adults = 1,
    maxStops = MAX_STOPS.ANY,
  } = options;

  if (!circuitBreaker.canProceed()) {
    return { success: false, dates: [], error: 'Circuit breaker open' };
  }

  // Build calendar search payload
  const segment = {
    origin,
    destination,
    date: dateFrom,
  };

  const filters = buildFiltersArray({
    segments: [segment],
    tripType,
    seatType,
    adults,
    maxStops,
    sortBy: SORT_BY.CHEAPEST,
    currency: 'EUR',
  });

  const payload = encodePayload(filters);

  try {
    await rateLimit();
    const response = await axios.post(CALENDAR_URL, payload, {
      headers: REQUEST_HEADERS,
      timeout: 15000,
    });

    const cleaned = response.data.replace(/^\)\]\}'[\s\n]*/, '');
    const parsed = JSON.parse(cleaned);
    const innerStr = parsed[0][2];
    const data = JSON.parse(innerStr);

    // Date-price entries are in the last element
    const dateEntries = data[data.length - 1];
    if (!Array.isArray(dateEntries)) return { success: false, dates: [] };

    const results = [];
    for (const entry of dateEntries) {
      try {
        const date = entry[0];
        const price = entry[2]?.[0]?.[1];
        if (date && price && typeof price === 'number') {
          // Filter to requested date range
          if (date >= dateFrom && date <= dateTo) {
            results.push({ date, price });
          }
        }
      } catch (e) { /* skip malformed entry */ }
    }

    circuitBreaker.recordSuccess();
    return { success: true, dates: results.sort((a, b) => a.price - b.price) };
  } catch (e) {
    circuitBreaker.recordFailure();
    return { success: false, dates: [], error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN SEARCH FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Search for flights on a specific date
 *
 * @param {string} origin - IATA airport code
 * @param {string} destination - IATA airport code
 * @param {string} departureDate - "YYYY-MM-DD"
 * @param {string|null} returnDate - "YYYY-MM-DD" or null for one-way
 * @param {object} options - Additional search options
 * @returns {object} Search results with flights array
 */
async function searchFlightsApi(origin, destination, departureDate, returnDate = null, options = {}) {
  const {
    seatType = SEAT_TYPE.ECONOMY,
    adults = 1,
    maxStops = MAX_STOPS.ANY,
    sortBy = SORT_BY.CHEAPEST,
    currency = 'EUR',
  } = options;

  const tripType = returnDate ? TRIP_TYPE.ROUND_TRIP : TRIP_TYPE.ONE_WAY;
  const cacheKey = `api-${origin}-${destination}-${departureDate}-${returnDate || 'ow'}`;

  // Cache check
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`  🧠 API cache: ${origin}→${destination} ${departureDate}`);
    return cached;
  }

  // Circuit breaker
  if (!circuitBreaker.canProceed()) {
    return { success: false, flights: [], minPrice: null, error: 'Circuit breaker open' };
  }

  console.log(`  🌐 API: ${origin} → ${destination} (${departureDate}${returnDate ? ' ↔ ' + returnDate : ''})`);

  const segments = [{ origin, destination, date: departureDate }];
  if (returnDate) {
    segments.push({ origin: destination, destination: origin, date: returnDate });
  }

  const filters = buildFiltersArray({
    segments,
    tripType,
    seatType,
    adults,
    maxStops,
    sortBy,
    currency,
  });

  const payload = encodePayload(filters);

  try {
    await rateLimit();

    const response = await axios.post(SEARCH_URL, payload, {
      headers: {
        ...REQUEST_HEADERS,
        'Cookie': `CONSENT=YES+; NID=${generateNid()}`,
      },
      timeout: 15000,
      validateStatus: s => s < 500,
    });

    if (response.status !== 200) {
      console.log(`  ⚠️ API HTTP ${response.status}`);
      circuitBreaker.recordFailure();
      return { success: false, flights: [], minPrice: null, error: `HTTP ${response.status}` };
    }

    const flights = parseFlightsResponse(response.data);

    // Filter valid prices and sort
    const validFlights = flights
      .filter(f => f.price >= 10 && f.price <= 15000)
      .sort((a, b) => a.price - b.price);

    // Add search metadata to each flight
    const enrichedFlights = validFlights.map(f => ({
      ...f,
      departureDate,
      returnDate,
      tripType: returnDate ? 'roundtrip' : 'oneway',
      link: buildGoogleFlightsUrl(origin, destination, departureDate, returnDate),
    }));

    const result = {
      success: enrichedFlights.length > 0,
      flights: enrichedFlights,
      minPrice: enrichedFlights.length > 0 ? enrichedFlights[0].price : null,
      origin,
      destination,
      departureDate,
      returnDate,
      tripType: returnDate ? 'roundtrip' : 'oneway',
      searchUrl: buildGoogleFlightsUrl(origin, destination, departureDate, returnDate),
      scrapedAt: new Date().toISOString(),
    };

    if (enrichedFlights.length > 0) {
      const best = enrichedFlights[0];
      const stopTag = best.stops === 0 ? 'directo' : `${best.stops} escala(s)`;
      console.log(`  ✅ API: ${enrichedFlights.length} vuelos (min $${result.minPrice} — ${best.airline}, ${stopTag})`);
      circuitBreaker.recordSuccess();
    } else {
      console.log(`  ⚠️ API: No flights parsed from response`);
    }

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    const msg = error.response ? `HTTP ${error.response.status}` : error.message;
    console.log(`  ❌ API error: ${msg}`);
    circuitBreaker.recordFailure();
    return {
      success: false,
      flights: [],
      minPrice: null,
      origin,
      destination,
      departureDate,
      returnDate,
      error: msg,
      searchUrl: buildGoogleFlightsUrl(origin, destination, departureDate, returnDate),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function safeGet(obj, ...path) {
  let current = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function formatTime(timeArr) {
  if (!Array.isArray(timeArr) || timeArr.length < 2) return null;
  const h = String(timeArr[0]).padStart(2, '0');
  const m = String(timeArr[1]).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDate(dateArr) {
  if (!Array.isArray(dateArr) || dateArr.length < 3) return null;
  const y = dateArr[0];
  const m = String(dateArr[1]).padStart(2, '0');
  const d = String(dateArr[2]).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function generateNid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nid = '';
  for (let i = 0; i < 172; i++) {
    nid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nid;
}

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

function buildGoogleFlightsUrl(origin, destination, departureDate, returnDate = null) {
  const base = 'https://www.google.com/travel/flights';
  if (returnDate) {
    return `${base}?q=Flights+from+${origin}+to+${destination}+on+${departureDate}+return+${returnDate}&curr=EUR&hl=es`;
  }
  return `${base}?q=Flights+from+${origin}+to+${destination}+on+${departureDate}+one+way&curr=EUR&hl=es`;
}

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

const cache = new Map();
const CACHE_TTL = 90 * 60 * 1000; // 90 min

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
}, 30 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════
// AIRLINE CODES → NAMES
// ═══════════════════════════════════════════════════════════════

const AIRLINE_CODES = {
  'AA': 'American Airlines', 'UA': 'United Airlines', 'DL': 'Delta',
  'IB': 'Iberia', 'LA': 'LATAM', 'AR': 'Aerolíneas Argentinas',
  'UX': 'Air Europa', 'VY': 'Vueling', 'AF': 'Air France',
  'KL': 'KLM', 'LH': 'Lufthansa', 'LX': 'SWISS',
  'TP': 'TAP Portugal', 'BA': 'British Airways', 'AZ': 'ITA Airways',
  'AV': 'Avianca', 'CM': 'Copa Airlines', 'B6': 'JetBlue',
  'TK': 'Turkish Airlines', 'EK': 'Emirates', 'QR': 'Qatar Airways',
  'ET': 'Ethiopian Airlines', 'AM': 'Aeroméxico', 'AD': 'Azul',
  'G3': 'GOL', 'DE': 'Condor', 'WK': 'Edelweiss',
  'EW': 'Eurowings', 'W6': 'Wizz Air', 'FR': 'Ryanair',
  'U2': 'easyJet', 'PM': 'Plus Ultra', 'WJ': 'JetSMART',
  'FO': 'Flybondi', 'H2': 'Sky Airline', 'AC': 'Air Canada',
  'AT': 'Royal Air Maroc', 'EB': 'Wamos Air', '5M': 'World2Fly',
  'I2': 'Iberojet', 'EI': 'Aer Lingus', 'QF': 'Qantas',
  'NZ': 'Air New Zealand', 'SQ': 'Singapore Airlines', 'CX': 'Cathay Pacific',
  'MH': 'Malaysia Airlines', 'FJ': 'Fiji Airways', 'VA': 'Virgin Australia',
  'KE': 'Korean Air', 'NH': 'ANA', 'JL': 'Japan Airlines',
  'LO': 'LOT Polish', 'SK': 'SAS', 'AY': 'Finnair',
  'OS': 'Austrian', 'SN': 'Brussels Airlines', 'MS': 'EgyptAir',
  'RG': 'VARIG', 'JJ': 'LATAM Brasil', 'SA': 'South African Airways',
  'WS': 'WestJet', 'NK': 'Spirit Airlines', 'F9': 'Frontier Airlines',
  'AS': 'Alaska Airlines', 'SY': 'Sun Country', 'HA': 'Hawaiian Airlines',
};

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  searchFlightsApi,
  searchDateRange,
  buildGoogleFlightsUrl,
  TRIP_TYPE,
  SEAT_TYPE,
  MAX_STOPS,
  SORT_BY,
  AIRLINE_CODES,
};
