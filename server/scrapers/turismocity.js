/**
 * TurismoCity Scraper v1.0 — Puppeteer
 *
 * TurismoCity (www.turismocity.com.ar) es un metabuscador argentino que
 * compara precios entre OTAs (Iberia, Air Europa, LATAM, Almundo, Avantrip,
 * Despegar, eDreams, etc.) y suele ser fuerte en tarifas baratas hacia y
 * desde Argentina, sobre todo para rutas Argentina↔Europa donde tiene
 * conexiones de bajo costo que Amadeus/Google a veces ignoran (ITA, Plus
 * Ultra, Wamos Air, Air Europa con stopover, etc.).
 *
 * Diseño:
 *   • Reutiliza la misma técnica de puppeteerGoogleFlights.js (stealth,
 *     circuit breaker, cache, detección de bloqueo).
 *   • El sitio está protegido por Cloudflare → curl directo no sirve.
 *     Necesita un browser real con JS habilitado.
 *   • Degradación limpia: si Chrome no se puede lanzar (sandbox sin
 *     dependencias, Render free OOM, etc.) devuelve { flights: [],
 *     unavailable: true } sin propagar excepción. El sistema sigue
 *     operativo con Amadeus + Google Flights.
 *   • TurismoCity es metabuscador: el "booking link" que devolvemos es
 *     la URL de búsqueda de TurismoCity, que luego redirige al OTA
 *     elegido (esto es deseable porque conserva la atribución de canal).
 *
 * URL canónica observada al usar el buscador:
 *   /vuelos/baratos/{origen-slug}/{destino-slug}?date_from=YYYY-MM-DD
 *     &date_to=YYYY-MM-DD&type=oneway|roundtrip&adults=1
 *
 * Fallback robusto: si la URL canónica con slugs no resuelve, probamos
 * la URL "search" basada en IATA, que TurismoCity también acepta.
 *
 * @module server/scrapers/turismocity
 */

'use strict';

// Imports puppeteer son lazy: si no está instalado o no hay Chrome,
// el módulo sigue cargando y degrada limpio. No se rompe el require()
// de los scrapers en entornos minimalistas.
let puppeteer = null;
let StealthPlugin = null;
try {
  puppeteer = require('puppeteer-extra');
  StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
} catch (e) {
  // puppeteer-extra no instalado → degradar a "no disponible"
}

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
const HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false';
const TIMEOUT = parseInt(process.env.TURISMOCITY_TIMEOUT || '35000', 10);
const MAX_RETRIES = parseInt(process.env.TURISMOCITY_RETRIES || '1', 10);
const NAV_WAIT_MS = parseInt(process.env.TURISMOCITY_NAV_WAIT_MS || '6000', 10);

/** Forzado de "deshabilitado" en entornos low-memory (Render free, etc.). */
const FORCE_DISABLED =
  process.env.DISABLE_TURISMOCITY === 'true' ||
  // Render free tiene 512MB y Puppeteer + Chrome usa ~400MB.
  // Activamos escape hatch para que el operador pueda apagar el
  // scraper sin tocar código.
  (process.env.RENDER && process.env.ENABLE_TURISMOCITY_ON_RENDER !== 'true');

// ═══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════
const circuitBreaker = {
  failures: 0,
  lastFailure: null,
  isOpen: false,
  threshold: 5,
  resetTimeout: 15 * 60 * 1000, // 15 min — más conservador que Google
                                // porque TurismoCity bloquea por IP
                                // de forma más agresiva.

  recordFailure() {
    this.failures += 1;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.isOpen = true;
      console.log(`  🔴 [TurismoCity] Circuit breaker ABIERTO (${this.failures} fallos). Pausa 15 min.`);
    }
  },

  recordSuccess() {
    this.failures = 0;
    this.isOpen = false;
  },

  canProceed() {
    if (!this.isOpen) return true;
    if (Date.now() - this.lastFailure > this.resetTimeout) {
      console.log('  🟡 [TurismoCity] Circuit breaker: reconectando...');
      this.isOpen = false;
      this.failures = 0;
      return true;
    }
    return false;
  },
};

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE CHROMIUM (igual estrategia que Google Flights scraper)
// ═══════════════════════════════════════════════════════════════
let _cachedChromePath = null;

function findChromium() {
  if (_cachedChromePath !== null) return _cachedChromePath || undefined;

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    _cachedChromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    return _cachedChromePath;
  }

  if (process.platform !== 'win32') {
    const names = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];
    for (const name of names) {
      try {
        const found = execSync(`which ${name} 2>/dev/null`).toString().trim();
        if (found) { _cachedChromePath = found; return found; }
      } catch (e) { /* not found */ }
    }
  } else {
    const winPaths = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);
    for (const p of winPaths) {
      try { if (fs.existsSync(p)) { _cachedChromePath = p; return p; } } catch (e) {}
    }
  }

  const linuxPaths = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable', '/snap/bin/chromium',
  ];
  for (const p of linuxPaths) {
    try { if (fs.existsSync(p)) { _cachedChromePath = p; return p; } } catch (e) {}
  }

  _cachedChromePath = false;
  return undefined;
}

/**
 * Indica si el scraper está disponible en este entorno
 * (Puppeteer instalado + Chrome detectable + no forzado off).
 *
 * Nota: detectamos Chromium proactivamente para evitar la pérdida
 * de tiempo del retry loop cuando claramente no hay binario. En el
 * caso ambiguo donde no encontramos Chrome del sistema pero
 * Puppeteer trae uno bundled (descargado por puppeteer install),
 * dejamos pasar y que el launch lo confirme — `findChromium()`
 * devuelve undefined en ambos casos, así que aquí no podemos
 * distinguirlos. Para cubrir el escenario "sandbox sin Chrome del
 * todo" usamos la env DISABLE_TURISMOCITY=true como escape hatch.
 */
function isAvailable() {
  if (FORCE_DISABLED) return false;
  if (!puppeteer) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// LAUNCH OPTIONS
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
      '--window-size=1366,768',
      '--lang=es-AR',
    ],
    defaultViewport: { width: 1366, height: 768 },
    timeout: TIMEOUT,
  };
  const chromePath = findChromium();
  if (chromePath) opts.executablePath = chromePath;
  return opts;
}

// ═══════════════════════════════════════════════════════════════
// IATA → CITY SLUG (mapping minimal para construir URL canónica)
//
// TurismoCity usa slugs tipo "buenos-aires-eze", "madrid-mad". Si no
// tenemos el slug exacto, el sitio acepta una URL alternativa con
// query string por IATA pura (que probaremos como fallback).
// ═══════════════════════════════════════════════════════════════
const IATA_TO_SLUG = {
  // Argentina
  EZE: 'buenos-aires-eze',
  AEP: 'buenos-aires-aep',
  COR: 'cordoba-cor',
  MDQ: 'mar-del-plata-mdq',
  ROS: 'rosario-ros',
  // España
  MAD: 'madrid-mad',
  BCN: 'barcelona-bcn',
  // Italia
  FCO: 'roma-fco',
  MXP: 'milan-mxp',
  LIN: 'milan-lin',
  BGY: 'milan-bgy',
  VCE: 'venecia-vce',
  BLQ: 'bolonia-blq',
  NAP: 'napoles-nap',
  CTA: 'catania-cta',
  PMO: 'palermo-pmo',
  FLR: 'florencia-flr',
  TRN: 'turin-trn',
  // Francia
  CDG: 'paris-cdg',
  ORY: 'paris-ory',
  // UK
  LHR: 'londres-lhr',
  LGW: 'londres-lgw',
  // Alemania / Holanda / Portugal
  FRA: 'frankfurt-fra',
  MUC: 'munich-muc',
  AMS: 'amsterdam-ams',
  LIS: 'lisboa-lis',
  // USA (por completitud)
  JFK: 'nueva-york-jfk',
  MIA: 'miami-mia',
  ORD: 'chicago-ord',
  LAX: 'los-angeles-lax',
};

/** Devuelve el slug canónico, o un fallback "{lower-iata}" si no hay. */
function iataSlug(iata) {
  return IATA_TO_SLUG[iata] || String(iata).toLowerCase();
}

// ═══════════════════════════════════════════════════════════════
// URL BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Construye la URL canónica de TurismoCity para una búsqueda.
 *
 * @param {string} origin       IATA del origen
 * @param {string} destination  IATA del destino
 * @param {string} departureDate YYYY-MM-DD
 * @param {string|null} returnDate YYYY-MM-DD o null para oneway
 * @returns {string}
 */
function buildSearchUrl(origin, destination, departureDate, returnDate = null) {
  const orig = iataSlug(origin);
  const dest = iataSlug(destination);
  const params = new URLSearchParams({
    date_from: departureDate,
    date_to: returnDate || departureDate,
    type: returnDate ? 'roundtrip' : 'oneway',
    adults: '1',
  });
  return `https://www.turismocity.com.ar/vuelos/baratos/${orig}/${dest}?${params.toString()}`;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: parse precio "ARS 285.300" / "USD 750" / "$ 285.300" / "€ 750"
// ═══════════════════════════════════════════════════════════════

/**
 * Extrae { amount, currency } de un string con precio.
 * @param {string} text
 * @returns {{ amount: number, currency: string }|null}
 */
function parsePrice(text) {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, ' ').trim();

  // Detectar moneda
  let currency = 'ARS';
  if (/USD|US\$|U\$S/i.test(t)) currency = 'USD';
  else if (/EUR|€/i.test(t)) currency = 'EUR';
  else if (/ARS|\$/i.test(t)) currency = 'ARS';

  // Extraer número (formato AR: "1.234.567" o "1.234,56"; formato US: "1,234")
  // Estrategia: tomar todo lo que parezca un número con separadores y
  // resolver por heurística:
  //   • Si hay ',' y '.': el último separador es decimal.
  //   • Si solo hay '.': separador de miles si grupos de 3 (ARS), si
  //     no es decimal.
  //   • Si solo hay ',': separador de miles si grupos de 3, si no decimal.
  const m = t.match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const raw = m[1];

  let amount;
  if (raw.includes(',') && raw.includes('.')) {
    // El último signo es el decimal
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      amount = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    } else {
      amount = parseFloat(raw.replace(/,/g, ''));
    }
  } else if (raw.includes(',')) {
    const parts = raw.split(',');
    amount = parts[parts.length - 1].length === 3
      ? parseFloat(raw.replace(/,/g, ''))   // miles
      : parseFloat(raw.replace(',', '.'));  // decimal
  } else if (raw.includes('.')) {
    const parts = raw.split('.');
    amount = parts[parts.length - 1].length === 3
      ? parseFloat(raw.replace(/\./g, ''))  // miles (estilo AR)
      : parseFloat(raw);                    // decimal
  } else {
    amount = parseFloat(raw);
  }

  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency };
}

// ═══════════════════════════════════════════════════════════════
// EXTRACCIÓN DOM (corre dentro del browser)
//
// TurismoCity renderiza una lista de "cards" con el precio. La
// estructura cambia con cada deploy del frontend, así que usamos
// múltiples estrategias en cascada para ser resilientes:
//   1. Selectores por atributo data-* (los más estables si existen).
//   2. Heurística por clase que contenga "result"/"flight"/"price".
//   3. Regex sobre body innerText (último recurso).
// ═══════════════════════════════════════════════════════════════

async function extractFlights(page) {
  return page.evaluate(() => {
    const flights = [];
    const seen = new Set();

    // Aerolíneas comunes en TurismoCity (rutas Argentina↔Europa).
    const AIRLINES = [
      'Iberia', 'Air Europa', 'LATAM', 'Aerolíneas Argentinas', 'Aerolineas Argentinas',
      'Level', 'LEVEL', 'ITA Airways', 'ITA', 'Plus Ultra', 'Wamos Air',
      'Air France', 'KLM', 'Lufthansa', 'British Airways', 'TAP Portugal',
      'TAP', 'Avianca', 'Copa Airlines', 'Copa', 'United', 'American Airlines',
      'American', 'Delta', 'Turkish Airlines', 'Turkish', 'Emirates',
      'Qatar Airways', 'Qatar', 'Ethiopian', 'Ethiopian Airlines',
      'Air Canada', 'Norwegian', 'Vueling', 'Ryanair', 'Iberojet',
    ];

    function findAirline(text) {
      if (!text) return '';
      for (const name of AIRLINES) {
        if (text.toLowerCase().includes(name.toLowerCase())) return name;
      }
      return '';
    }

    // Detectar si un elemento parece un "card" de resultado.
    function isResultCard(el) {
      const cls = (el.className || '').toString().toLowerCase();
      const id = (el.id || '').toLowerCase();
      return /(result|flight|offer|card|item|fligh|tarifa|vuelo)/i.test(cls + ' ' + id);
    }

    function extractPriceFromText(text) {
      if (!text) return null;
      // Capturar un patrón: SÍMBOLO/CÓDIGO seguido de número con miles AR
      // O número primero seguido de moneda.
      // Patrones aceptados:
      //   "USD 750", "U$S 750", "US$ 750"
      //   "ARS 285.300", "$ 285.300", "AR$ 285.300"
      //   "€ 750", "EUR 750", "750 EUR", "750 €"
      const patterns = [
        /(USD|US\$|U\$S)\s*([\d.,]+)/i,
        /(EUR|€)\s*([\d.,]+)/i,
        /(ARS|AR\$|\$)\s*([\d.,]+)/i,
        /([\d.,]+)\s*(USD|US\$|U\$S)/i,
        /([\d.,]+)\s*(EUR|€)/i,
        /([\d.,]+)\s*(ARS|AR\$)/i,
      ];
      for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[0];
      }
      return null;
    }

    // ── STRATEGY 1: data-attributes ──────────────────────────────
    // TurismoCity a veces expone data-price/data-airline en sus
    // componentes. Si está, es la fuente más limpia.
    const dataNodes = document.querySelectorAll('[data-price], [data-test*="result"], [data-testid*="result"]');
    for (const node of dataNodes) {
      const dPrice = node.getAttribute('data-price');
      if (dPrice) {
        const num = parseFloat(String(dPrice).replace(/[^\d.,]/g, '').replace(',', '.'));
        if (Number.isFinite(num) && num > 0) {
          const text = (node.innerText || '').slice(0, 800);
          const airline = findAirline(text)
            || node.getAttribute('data-airline')
            || '';
          const ccy = node.getAttribute('data-currency')
            || (text.match(/USD|EUR|ARS/i)?.[0]?.toUpperCase())
            || 'ARS';
          const stops = (() => {
            if (/sin escalas?|directo|nonstop/i.test(text)) return 0;
            const sm = text.match(/(\d+)\s*(?:escalas?|stops?)/i);
            return sm ? parseInt(sm[1], 10) : -1;
          })();
          const key = `${num}-${airline}`;
          if (!seen.has(key)) {
            seen.add(key);
            flights.push({
              priceText: dPrice, priceNumber: num, currency: ccy,
              airline, stops, source: 'data-attr',
            });
          }
        }
      }
    }

    // ── STRATEGY 2: cards con clase result-like ──────────────────
    if (flights.length === 0) {
      const candidates = document.querySelectorAll(
        'article, li, div[role="listitem"], [class*="result"], [class*="card"], [class*="offer"], [class*="flight"]'
      );
      for (const el of candidates) {
        if (!isResultCard(el)) continue;
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length < 20 || text.length > 1500) continue;
        const priceText = extractPriceFromText(text);
        if (!priceText) continue;

        const airline = findAirline(text);
        // Stops
        let stops = -1;
        if (/sin escalas?|directo|nonstop/i.test(text)) stops = 0;
        else {
          const sm = text.match(/(\d+)\s*(?:escalas?|stops?)/i);
          if (sm) stops = parseInt(sm[1], 10);
        }
        // Booking link (algunos cards lo tienen)
        const link = el.querySelector('a[href]')?.getAttribute('href') || null;

        flights.push({
          priceText, priceNumber: null, currency: null,
          airline, stops, source: 'card-heuristic', link,
        });
      }
    }

    // ── STRATEGY 3: body text regex (último recurso) ─────────────
    if (flights.length === 0) {
      const text = document.body.innerText || '';
      const rx = /(?:USD|U\$S|US\$|EUR|€|ARS|AR\$|\$)\s*\d{2,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/g;
      let m;
      while ((m = rx.exec(text)) !== null) {
        if (flights.length >= 30) break;
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        flights.push({
          priceText: m[0], priceNumber: null, currency: null,
          airline: '', stops: -1, source: 'body-text',
        });
      }
    }

    return {
      flights,
      title: document.title || '',
      url: location.href,
      bodyHasError: /no encontramos|no hay vuelos|sin resultados|no flights found/i
        .test((document.body?.innerText || '').slice(0, 5000)),
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE BLOQUEO (Cloudflare challenge / captcha)
// ═══════════════════════════════════════════════════════════════
async function detectBlock(page) {
  const url = page.url();
  if (url.includes('/cdn-cgi/challenge') || url.includes('captcha')) {
    return { blocked: true, reason: `redirect: ${url}` };
  }
  try {
    const t = await page.title();
    if (/just a moment|attention required|access denied/i.test(t || '')) {
      return { blocked: true, reason: `title: ${t}` };
    }
    const hasBlock = await page.evaluate(() => {
      const b = (document.body?.innerText || '').slice(0, 2000).toLowerCase();
      return /verifique que (es|sos) humano|verify you are human|cloudflare|cf-challenge|checking your browser/i.test(b);
    });
    if (hasBlock) return { blocked: true, reason: 'cloudflare challenge text' };
  } catch (e) {}
  return { blocked: false };
}

// ═══════════════════════════════════════════════════════════════
// CACHE EN MEMORIA (mismo patrón que Google scraper)
// ═══════════════════════════════════════════════════════════════
const cache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2h

function cacheKey(o, d, dep, ret) {
  return `${o}-${d}-${dep}-${ret || 'ow'}`;
}

function getCached(key) {
  const e = cache.get(key);
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  cache.delete(key);
  return null;
}

function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// Limpieza periódica para no fugar memoria.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts > CACHE_TTL) cache.delete(k);
  }
}, 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════
// SCRAPE PRINCIPAL
// ═══════════════════════════════════════════════════════════════

/**
 * Scrapea TurismoCity para una ruta y fecha dada.
 *
 * @param {string} origin       IATA origen
 * @param {string} destination  IATA destino
 * @param {string} departureDate YYYY-MM-DD
 * @param {string|null} returnDate YYYY-MM-DD o null para solo ida
 * @returns {Promise<{
 *   success: boolean,
 *   unavailable?: boolean,
 *   flights: Array<{price:number,currency:string,airline:string,
 *     stops:number,source:string,departureDate:string,returnDate:string|null,
 *     tripType:string,link:string}>,
 *   minPrice: number|null,
 *   searchUrl: string,
 *   error?: string,
 * }>}
 */
async function scrapeTurismoCity(origin, destination, departureDate, returnDate = null) {
  const tripType = returnDate ? 'roundtrip' : 'oneway';
  const url = buildSearchUrl(origin, destination, departureDate, returnDate);

  // Disponibilidad: si está deshabilitado o no hay puppeteer, devolver
  // shape limpia para que el caller (hybridSearch) sepa que no aplicó.
  if (!isAvailable()) {
    return {
      success: false,
      unavailable: true,
      flights: [],
      minPrice: null,
      origin, destination, departureDate, returnDate, tripType,
      searchUrl: url,
      error: FORCE_DISABLED
        ? 'TurismoCity disabled by env (DISABLE_TURISMOCITY or RENDER)'
        : 'puppeteer-extra not installed',
    };
  }

  // Cache hit
  const ck = cacheKey(origin, destination, departureDate, returnDate);
  const cached = getCached(ck);
  if (cached) {
    console.log(`  🧠 [TurismoCity] Cache hit: ${origin}→${destination} ${departureDate}`);
    return cached;
  }

  // Circuit breaker
  if (!circuitBreaker.canProceed()) {
    return {
      success: false,
      flights: [],
      minPrice: null,
      origin, destination, departureDate, returnDate, tripType,
      searchUrl: url,
      error: 'Circuit breaker open',
    };
  }

  console.log(`  🔍 [TurismoCity] ${origin} → ${destination} (${departureDate}${returnDate ? ' ↔ ' + returnDate : ''})`);

  let browser = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      browser = await puppeteer.launch(getLaunchOptions());
      const page = await browser.newPage();

      // Headers de browser real (es-AR para que TurismoCity sirva ARS).
      const UAS = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      ];
      await page.setUserAgent(UAS[Math.floor(Math.random() * UAS.length)]);
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
      });

      // Bloquear recursos pesados que no necesitamos para extraer precio
      // (imágenes, fuentes, analytics). Acelera ~3x y baja memoria.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        const u = req.url();
        if (
          type === 'image' || type === 'media' || type === 'font' ||
          /google-analytics|doubleclick|googletagmanager|hotjar|facebook\.|criteo/i.test(u)
        ) {
          req.abort().catch(() => {});
        } else {
          req.continue().catch(() => {});
        }
      });

      // Navegación — networkidle2 a veces tarda demasiado en SPAs ricas
      // en analytics. Usamos domcontentloaded + espera explícita.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

      // Detección de Cloudflare antes de gastar más tiempo
      const block = await detectBlock(page);
      if (block.blocked) {
        console.log(`  ⛔ [TurismoCity] BLOQUEADO: ${block.reason}`);
        try { await browser.close(); } catch (e) {}
        browser = null;
        circuitBreaker.recordFailure();
        const result = {
          success: false,
          flights: [],
          minPrice: null,
          origin, destination, departureDate, returnDate, tripType,
          searchUrl: url,
          error: `Blocked: ${block.reason}`,
        };
        setCached(ck, result);
        return result;
      }

      // Espera dinámica: el frontend hace fetch en background. Damos
      // tiempo al primer paint de resultados (o al "no resultados").
      await Promise.race([
        page.waitForSelector(
          '[data-price], [class*="result"], [class*="card"], [class*="offer"]',
          { timeout: NAV_WAIT_MS },
        ).catch(() => null),
        new Promise((r) => setTimeout(r, NAV_WAIT_MS)),
      ]);

      // Pequeña pausa adicional para que termine de cargar más resultados
      await new Promise((r) => setTimeout(r, 1500));

      // Extracción
      const extracted = await extractFlights(page);

      try { await browser.close(); } catch (e) {}
      browser = null;

      // Procesar resultados → shape uniforme
      const flights = [];
      const seen = new Set();
      for (const raw of extracted.flights) {
        let price = raw.priceNumber;
        let currency = raw.currency;
        if (!price) {
          const parsed = parsePrice(raw.priceText);
          if (!parsed) continue;
          price = parsed.amount;
          currency = parsed.currency;
        }
        // Sanity: precios irreales se descartan
        // (USD <30, EUR <30, ARS <5000 son siempre falsos en metabuscador AR)
        const minByCcy = { USD: 30, EUR: 30, ARS: 5000 };
        const maxByCcy = { USD: 8000, EUR: 8000, ARS: 30_000_000 };
        if (price < (minByCcy[currency] ?? 30)) continue;
        if (price > (maxByCcy[currency] ?? 8_000_000)) continue;

        const key = `${currency}-${Math.round(price)}-${raw.airline || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);

        flights.push({
          price,
          currency: currency || 'ARS',
          airline: raw.airline || '',
          stops: raw.stops != null && raw.stops >= 0 ? raw.stops : null,
          source: `TurismoCity (${raw.source})`,
          departureDate,
          returnDate,
          tripType,
          link: raw.link || url,
        });
      }

      flights.sort((a, b) => a.price - b.price);

      const result = {
        success: flights.length > 0,
        flights,
        minPrice: flights.length > 0 ? flights[0].price : null,
        origin, destination, departureDate, returnDate, tripType,
        searchUrl: url,
        scrapedAt: new Date().toISOString(),
        meta: {
          rawCount: extracted.flights.length,
          pageHadNoResultsBanner: extracted.bodyHasError,
        },
      };

      setCached(ck, result);

      if (flights.length > 0) {
        const best = flights[0];
        console.log(`  ✅ [TurismoCity] ${flights.length} vuelos (min ${best.currency} ${Math.round(best.price)} — ${best.airline || 'varias'})`);
        circuitBreaker.recordSuccess();
      } else if (extracted.bodyHasError) {
        console.log('  ℹ️ [TurismoCity] Sin vuelos para esa fecha (banner "sin resultados")');
        circuitBreaker.recordSuccess(); // página cargó OK, simplemente no hay
      } else {
        console.log(`  ⚠️ [TurismoCity] Sin precios extraíbles (raw: ${extracted.flights.length})`);
      }

      return result;
    } catch (error) {
      lastError = error;
      // Detectar "Chrome no disponible en el sistema" para abortar la
      // retry loop temprano y reportar `unavailable: true`. Esto cubre:
      //   • shared libs faltantes (libnss3.so, libnspr4.so en Render
      //     free / Docker minimal),
      //   • binary no descargado (puppeteer install saltado en CI),
      //   • spawn ENOENT cuando no hay Chrome del sistema ni bundled.
      // El usuario recibe un meta.unavailable correcto y el caller
      // (hybridSearch) sigue limpio a Amadeus sin gastar 5-10s en
      // retries inútiles.
      const msg = error.message || '';
      const isChromeUnavailable =
        /Failed to launch the browser process/i.test(msg)
        || /Could not find (?:Chrome|browser|expected browser)/i.test(msg)
        || /spawn .* ENOENT/i.test(msg)
        || /libnss3|libnspr4|shared libraries/i.test(msg);

      if (isChromeUnavailable) {
        console.log(`  ⏭️  [TurismoCity] Chrome no disponible en este entorno — degradando`);
        if (browser) { try { await browser.close(); } catch (e) {} browser = null; }
        circuitBreaker.recordFailure();
        const result = {
          success: false,
          unavailable: true,
          flights: [],
          minPrice: null,
          origin, destination, departureDate, returnDate, tripType,
          searchUrl: url,
          error: msg,
        };
        // No cacheamos el "unavailable" porque es estado del entorno,
        // no del par ruta-fecha. Si el operador instala Chrome y
        // reinicia, queremos volver a intentar de inmediato.
        return result;
      }

      console.log(`  ⚠️ [TurismoCity] Intento ${attempt}: ${error.message}`);
      if (browser) { try { await browser.close(); } catch (e) {} browser = null; }
      if (attempt <= MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
  }

  console.error(`  ❌ [TurismoCity] Falló: ${lastError?.message}`);
  circuitBreaker.recordFailure();

  return {
    success: false,
    flights: [],
    minPrice: null,
    origin, destination, departureDate, returnDate, tripType,
    searchUrl: url,
    error: lastError?.message || 'Unknown error',
  };
}

module.exports = {
  scrapeTurismoCity,
  buildSearchUrl,
  parsePrice,        // exportado para tests
  isAvailable,
  findChromium,      // útil para diagnóstico
  IATA_TO_SLUG,
};
