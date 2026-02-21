/**
 * Google Flights Scraper v2 — Puppeteer
 *
 * Extrae precios reales de Google Flights sin API keys.
 * Compatible con Railway (Nixpacks), Docker y desarrollo local.
 *
 * v2: detección dinámica de Chromium, extracción rica de aria-labels,
 *     consentimiento multi-idioma, detección de bloqueo, circuit breaker.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
const HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false';
const TIMEOUT = parseInt(process.env.PUPPETEER_TIMEOUT || '45000', 10);
const MAX_RETRIES = parseInt(process.env.PUPPETEER_RETRIES || '3', 10);

// ═══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════
const circuitBreaker = {
  failures: 0,
  lastFailure: null,
  isOpen: false,
  threshold: 5,
  resetTimeout: 10 * 60 * 1000, // 10 minutos

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.isOpen = true;
      console.log(`  🔴 Circuit breaker ABIERTO (${this.failures} fallos). Pausa 10 min.`);
    }
  },

  recordSuccess() {
    this.failures = 0;
    this.isOpen = false;
  },

  canProceed() {
    if (!this.isOpen) return true;
    if (Date.now() - this.lastFailure > this.resetTimeout) {
      console.log('  🟡 Circuit breaker: reconectando...');
      this.isOpen = false;
      this.failures = 0;
      return true;
    }
    console.log('  🔴 Circuit breaker abierto — saltando');
    return false;
  },
};

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE CHROMIUM
// ═══════════════════════════════════════════════════════════════
let _cachedChromePath = null;

function findChromium() {
  if (_cachedChromePath !== null) return _cachedChromePath || undefined;

  // 1. Variable de entorno (máxima prioridad)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    _cachedChromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    return _cachedChromePath;
  }

  // 2. Buscar en PATH con `which` (Linux/Mac/Nixpacks/Docker)
  if (process.platform !== 'win32') {
    const names = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];
    for (const name of names) {
      try {
        const found = execSync(`which ${name} 2>/dev/null`).toString().trim();
        if (found) {
          _cachedChromePath = found;
          return found;
        }
      } catch (e) { /* no encontrado */ }
    }
  } else {
    // Windows: buscar con where y rutas comunes
    const winPaths = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);
    for (const p of winPaths) {
      try { if (fs.existsSync(p)) { _cachedChromePath = p; return p; } } catch (e) {}
    }
  }

  // 3. Rutas hardcoded Linux
  const linuxPaths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'];
  for (const p of linuxPaths) {
    try { if (fs.existsSync(p)) { _cachedChromePath = p; return p; } } catch (e) {}
  }

  // 4. Puppeteer bundled (sin path custom)
  _cachedChromePath = false;
  return undefined;
}

// ═══════════════════════════════════════════════════════════════
// OPCIONES DE LAUNCH
// ═══════════════════════════════════════════════════════════════
function getLaunchOptions() {
  const opts = {
    headless: HEADLESS ? 'new' : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--lang=es-ES',
    ],
    defaultViewport: { width: 1920, height: 1080 },
    timeout: TIMEOUT,
  };

  const chromePath = findChromium();
  if (chromePath) {
    opts.executablePath = chromePath;
  }

  return opts;
}

// ═══════════════════════════════════════════════════════════════
// CONSENTIMIENTO COOKIES
// ═══════════════════════════════════════════════════════════════
async function handleConsent(page) {
  try {
    const clicked = await page.evaluate(() => {
      // IDs y selectores conocidos de Google consent
      const selectors = ['#L2AGLb', 'button[jsname="b3VHJd"]', 'button[jsname="higCR"]'];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) { btn.click(); return true; }
      }

      // Por texto en múltiples idiomas
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = (btn.innerText || '').toLowerCase().trim();
        if (
          text.includes('aceptar todo') || text.includes('accept all') ||
          text.includes('accetta tutto') || text.includes('alle akzeptieren') ||
          text.includes('accepter tout') || text === 'aceptar' || text === 'accept' ||
          text === 'acepto' || text.includes('agree')
        ) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) await new Promise(r => setTimeout(r, 2000));
    return clicked;
  } catch (e) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE BLOQUEO
// ═══════════════════════════════════════════════════════════════
async function detectBlock(page) {
  const url = page.url();
  if (url.includes('/sorry') || url.includes('recaptcha') || url.includes('ServiceLogin')) {
    return { blocked: true, reason: `redirect: ${url}` };
  }

  try {
    const hasBlock = await page.evaluate(() => {
      const text = (document.body?.innerText || '').substring(0, 2000).toLowerCase();
      return /unusual traffic|captcha|robot|automated|verificar que no eres|verifica di non essere/.test(text);
    });
    if (hasBlock) return { blocked: true, reason: 'captcha/block text detected' };
  } catch (e) {}

  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════
// MAPEO IATA → NOMBRE DE CIUDAD (para URLs de Google Flights)
// ═══════════════════════════════════════════════════════════════
const IATA_TO_CITY = {
  // Argentina
  'EZE': 'Buenos Aires',
  'COR': 'Cordoba Argentina',
  // Chile
  'SCL': 'Santiago Chile',
  // Europa
  'MAD': 'Madrid',
  'BCN': 'Barcelona',
  'FCO': 'Rome',
  'CDG': 'Paris',
  'LIS': 'Lisbon',
  'FRA': 'Frankfurt',
  'AMS': 'Amsterdam',
  'LHR': 'London',
  'MUC': 'Munich',
  'ZRH': 'Zurich',
  'BRU': 'Brussels',
  'VIE': 'Vienna',
  // Italia
  'VCE': 'Venice',
  // Oceanía
  'SYD': 'Sydney',
  'MEL': 'Melbourne',
  'AKL': 'Auckland',
};

// ═══════════════════════════════════════════════════════════════
// URL
// ═══════════════════════════════════════════════════════════════
function buildGoogleFlightsUrl(origin, destination, departureDate, returnDate = null) {
  // Usar nombres de ciudad para que Google Flights interprete correctamente
  // (evita confusiones como COR = Córdoba España vs Argentina)
  const originCity = IATA_TO_CITY[origin] || origin;
  const destCity = IATA_TO_CITY[destination] || destination;

  if (returnDate) {
    const query = `Flights from ${originCity} to ${destCity} on ${departureDate} return ${returnDate}`;
    return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&curr=EUR&hl=es`;
  }
  // Solo ida: agregar "one way" para forzar precio de solo ida
  const query = `Flights from ${originCity} to ${destCity} on ${departureDate} one way`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&curr=EUR&hl=es`;
}

// ═══════════════════════════════════════════════════════════════
// PARSE PRECIO
// ═══════════════════════════════════════════════════════════════
function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.,]/g, '');

  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Formato europeo (1.234,56) vs americano (1,234.56)
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    }
    return parseFloat(cleaned.replace(/,/g, ''));
  } else if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length <= 2) {
      return parseFloat(cleaned.replace(',', '.'));
    }
    return parseFloat(cleaned.replace(',', ''));
  }

  return parseFloat(cleaned) || null;
}

// ═══════════════════════════════════════════════════════════════
// EXTRACCIÓN DE VUELOS (v2 — aria-label + fallbacks)
// ═══════════════════════════════════════════════════════════════
async function extractFlights(page) {
  return page.evaluate(() => {
    const flights = [];
    const seen = new Set();

    // ── Aerolíneas conocidas ──
    const AIRLINES = [
      'Iberia', 'LATAM', 'Air Europa', 'Aerolíneas Argentinas', 'Aerolineas Argentinas',
      'Level', 'LEVEL', 'Vueling', 'Norwegian', 'Air France', 'KLM', 'Lufthansa',
      'SWISS', 'Swiss International', 'TAP Portugal', 'TAP', 'British Airways',
      'ITA Airways', 'ITA', 'Avianca', 'Copa Airlines', 'Copa',
      'American Airlines', 'American', 'United Airlines', 'United',
      'Delta Air Lines', 'Delta', 'JetBlue', 'Turkish Airlines', 'Turkish',
      'Emirates', 'Qatar Airways', 'Qatar', 'Ethiopian Airlines', 'Ethiopian',
      'Aeroméxico', 'Aeromexico', 'Azul', 'GOL', 'Condor', 'Edelweiss',
      'Eurowings', 'Wizz Air', 'Ryanair', 'easyJet', 'Plus Ultra',
      'JetSMART', 'Jetsmart', 'Flybondi', 'Sky Airline', 'Air Canada',
      'Royal Air Maroc', 'Wamos Air', 'World2Fly', 'Iberojet',
      'Air Italy', 'Privilege Style', 'Alitalia', 'Aer Lingus',
      'Qantas', 'Air New Zealand', 'Singapore Airlines', 'Cathay Pacific',
      'Malaysia Airlines', 'Fiji Airways', 'Virgin Australia', 'Korean Air',
    ];

    function findAirline(text) {
      for (const name of AIRLINES) {
        if (text.includes(name)) return name;
      }
      return '';
    }

    // ── Helper: extraer precio completo de un texto ──
    // Soporta formatos: "1057 euros", "1.057 €", "€ 1,057", "356€"
    function extractPrice(text) {
      // Formato con separador de miles: 1.057 €, 1,057 €
      const withSep = text.match(/(\d{1,3}[.,]\d{3})\s*(?:€|euros?)/i) ||
                      text.match(/(?:€)\s*(\d{1,3}[.,]\d{3})/i);
      if (withSep) {
        return { str: withSep[1], num: parseInt(withSep[1].replace(/\D/g, '')) };
      }
      // Formato sin separador: 1057 euros, 356 €, 290€
      const plain = text.match(/(\d{3,5})\s*(?:€|euros?)/i) ||
                    text.match(/(?:€)\s*(\d{3,5})/i);
      if (plain) {
        return { str: plain[1], num: parseInt(plain[1]) };
      }
      return null;
    }

    // ── STRATEGY 1: aria-label con role="link" (resultados de vuelos) ──
    // Solo elementos DIV con role="link" contienen datos reales de vuelos
    const labeled = document.querySelectorAll('div[role="link"][aria-label]');
    for (const el of labeled) {
      const label = el.getAttribute('aria-label') || '';

      // Solo procesar labels que parecen resultados de vuelos reales
      // Deben tener hora (XX:XX) y duración (Xh) como mínimo
      if (!/\d{1,2}:\d{2}/.test(label)) continue;
      if (!/\d+\s*h/.test(label)) continue;

      // Extraer precio
      const priceData = extractPrice(label);
      if (!priceData || priceData.num < 80 || priceData.num > 15000) continue;

      // Detectar si el precio es de ida y vuelta o solo ida
      const isRoundTripPrice = /ida y vuelta|round.?trip|precio total/i.test(label);

      const airline = findAirline(label);
      const dedupeKey = `${priceData.num}-${airline}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Escalas
      let stops = -1;
      if (/sin escalas?|nonstop|directo|direct/i.test(label)) {
        stops = 0;
      } else {
        const sm = label.match(/(\d+)\s*(?:escalas?|stops?|paradas?)/i);
        if (sm) stops = parseInt(sm[1]);
      }

      // Horarios
      const times = label.match(/(\d{1,2}:\d{2})/g);

      // Duración
      const dm = label.match(/(\d+)\s*h\s*(?:(\d+)\s*min)?/);
      const durationMin = dm ? parseInt(dm[1]) * 60 + (parseInt(dm[2]) || 0) : null;

      flights.push({
        priceText: priceData.str,
        price: priceData.num,
        airline: airline || '',
        stops,
        departureTime: times?.[0] || null,
        arrivalTime: times?.[1] || null,
        durationMin,
        isRoundTripPrice,
        source: 'aria-label',
      });
    }

    // ── STRATEGY 2: list items con precio (fallback) ──
    if (flights.length === 0) {
      const items = document.querySelectorAll('li, [role="listitem"]');
      for (const item of items) {
        const text = item.innerText || '';
        const priceData = extractPrice(text);
        if (!priceData || priceData.num < 80 || priceData.num > 15000) continue;

        if (seen.has(String(priceData.num))) continue;
        seen.add(String(priceData.num));

        flights.push({
          priceText: priceData.str,
          price: priceData.num,
          airline: findAirline(text),
          isRoundTripPrice: /ida y vuelta|round.?trip/i.test(text),
          source: 'list-item',
        });
      }
    }

    // ── STRATEGY 3: spans/divs con precio exacto (fallback) ──
    if (flights.length === 0) {
      const els = document.querySelectorAll('span, div');
      for (const el of els) {
        const text = (el.textContent || '').trim();
        if (text.length > 40) continue;
        // Matchear "1.057 €" o "356 €" pero completo
        const pm = text.match(/^(\d{1,3}(?:[.,]\d{3})*)\s*€/) ||
                   text.match(/^(\d{3,5})\s*€/);
        if (!pm) continue;

        const num = parseInt(pm[1].replace(/\D/g, ''));
        if (num < 80 || num > 15000) continue;
        if (seen.has(String(num))) continue;
        seen.add(String(num));

        const parent = el.closest('[data-ved]') || el.parentElement?.parentElement;
        const parentText = parent?.innerText || '';

        flights.push({
          priceText: pm[1],
          price: num,
          airline: findAirline(parentText),
          isRoundTripPrice: /ida y vuelta|round.?trip/i.test(parentText),
          source: 'span-exact',
        });
      }
    }

    // ── STRATEGY 4: body text regex (último recurso) ──
    if (flights.length === 0) {
      const text = document.body.innerText || '';
      // Buscar precios con separador de miles o sin él (3-5 dígitos)
      const priceRegex = /(\d{1,3}[.,]\d{3}|\d{3,5})\s*€/g;
      let m;
      while ((m = priceRegex.exec(text)) !== null) {
        const num = parseInt(m[1].replace(/\D/g, ''));
        if (num < 80 || num > 15000) continue;
        if (!seen.has(String(num))) {
          seen.add(String(num));
          flights.push({
            priceText: m[1],
            price: num,
            airline: '',
            isRoundTripPrice: false,
            source: 'body-text',
          });
        }
      }
    }

    return flights;
  });
}

// ═══════════════════════════════════════════════════════════════
// ESPERA DE RESULTADOS
// ═══════════════════════════════════════════════════════════════
async function waitForResults(page) {
  try {
    // Scroll para activar lazy loading
    await page.evaluate(() => window.scrollTo(0, 500));
    await new Promise(r => setTimeout(r, 1500));

    await Promise.race([
      page.waitForSelector('[data-gs]', { timeout: 15000 }),
      page.waitForSelector('[role="listitem"]', { timeout: 15000 }),
      page.waitForFunction(
        () => (document.body.innerText || '').match(/\d{3,4}\s*€/),
        { timeout: 15000 },
      ),
    ]);

    // Scroll adicional para cargar más resultados
    await page.evaluate(() => window.scrollTo(0, 1200));
    await new Promise(r => setTimeout(r, 2500));

    return true;
  } catch (e) {
    await new Promise(r => setTimeout(r, 2000));
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════
const cache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 horas

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function cleanCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
}

setInterval(cleanCache, 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════
// SCRAPE UNA RUTA
// ═══════════════════════════════════════════════════════════════
async function scrapeGoogleFlights(origin, destination, departureDate, returnDate = null) {
  const tripType = returnDate ? 'roundtrip' : 'oneway';
  const cacheKey = `${origin}-${destination}-${departureDate}-${returnDate || 'ow'}`;

  // Cache
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`  🧠 Puppeteer cache: ${origin}→${destination} ${departureDate}`);
    return cached;
  }

  // Circuit breaker
  if (!circuitBreaker.canProceed()) {
    return { success: false, flights: [], minPrice: null, error: 'Circuit breaker open' };
  }

  const url = buildGoogleFlightsUrl(origin, destination, departureDate, returnDate);
  console.log(`  🔍 Scraping: ${origin} → ${destination} (${departureDate}${returnDate ? ' ↔ ' + returnDate : ''})`);

  // Log chrome path only once
  const chromePath = findChromium();
  if (chromePath) {
    console.log(`  🖥️ Chrome: ${chromePath}`);
  } else {
    console.log('  🖥️ Chrome: Puppeteer bundled');
  }

  let browser = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      browser = await puppeteer.launch(getLaunchOptions());
      const page = await browser.newPage();

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      );
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9' });

      // Navegar
      await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

      // Consentimiento cookies
      await handleConsent(page);

      // Detección de bloqueo
      const block = await detectBlock(page);
      if (block.blocked) {
        console.log(`  ⛔ BLOQUEADO: ${block.reason}`);
        await browser.close();
        circuitBreaker.recordFailure();
        return { success: false, flights: [], minPrice: null, error: `Blocked: ${block.reason}`, searchUrl: url };
      }

      // Esperar resultados
      await waitForResults(page);

      // Extraer
      const rawFlights = await extractFlights(page);

      // Debug: screenshot si no hay resultados
      if (rawFlights.length === 0 && process.env.NODE_ENV !== 'production') {
        try {
          const debugDir = path.join(process.cwd(), 'debug');
          if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
          await page.screenshot({
            path: path.join(debugDir, `gf_${origin}_${destination}_${Date.now()}.png`),
            fullPage: true,
          });
          console.log('  📸 Debug screenshot guardado');
        } catch (e) {}
      }

      await browser.close();
      browser = null;

      // Procesar resultados
      const flights = [];
      const seenKeys = new Set();

      for (const raw of rawFlights) {
        // Usar el precio ya parseado en la extracción, o parsear el texto
        const price = raw.price || parsePrice(raw.priceText);
        if (!price || price < 80 || price > 15000) continue;

        const key = `${price}-${raw.airline || ''}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        // Si Google muestra precio de ida+vuelta pero buscamos solo ida,
        // marcar para que el monitor sepa que es precio RT
        const detectedTripType = raw.isRoundTripPrice ? 'roundtrip' : tripType;

        flights.push({
          price,
          airline: raw.airline || '',
          stops: raw.stops != null && raw.stops >= 0 ? raw.stops : null,
          departureTime: raw.departureTime || null,
          arrivalTime: raw.arrivalTime || null,
          durationMin: raw.durationMin || null,
          source: `Google Flights (${raw.source})`,
          departureDate,
          returnDate,
          tripType: detectedTripType,
          isRoundTripPrice: !!raw.isRoundTripPrice,
          link: url,
        });
      }

      flights.sort((a, b) => a.price - b.price);

      const result = {
        success: flights.length > 0,
        flights,
        minPrice: flights.length > 0 ? flights[0].price : null,
        origin,
        destination,
        departureDate,
        returnDate,
        tripType,
        searchUrl: url,
        scrapedAt: new Date().toISOString(),
      };

      setCache(cacheKey, result);

      if (flights.length > 0) {
        const best = flights[0];
        const airTag = best.airline || 'varias';
        const stopTag = best.stops != null ? (best.stops === 0 ? 'directo' : best.stops + ' escala(s)') : '';
        console.log(`  ✅ ${flights.length} vuelos (min €${result.minPrice} — ${airTag}${stopTag ? ', ' + stopTag : ''})`);
        circuitBreaker.recordSuccess();
      } else {
        console.log(`  ⚠️ Sin precios${rawFlights.length > 0 ? ` (raw: ${rawFlights.length})` : ''}`);
      }

      return result;

    } catch (error) {
      lastError = error;
      console.log(`  ⚠️ Intento ${attempt}/${MAX_RETRIES}: ${error.message}`);
      if (browser) { try { await browser.close(); } catch (e) {} browser = null; }
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }

  console.error(`  ❌ Todos los intentos fallidos: ${lastError?.message}`);
  circuitBreaker.recordFailure();

  return {
    success: false,
    flights: [],
    minPrice: null,
    origin,
    destination,
    departureDate,
    returnDate,
    tripType,
    error: lastError?.message || 'Unknown error',
    searchUrl: buildGoogleFlightsUrl(origin, destination, departureDate, returnDate),
  };
}

module.exports = {
  scrapeGoogleFlights,
  buildGoogleFlightsUrl,
  parsePrice,
  cleanCache,
  findChromium,
};
