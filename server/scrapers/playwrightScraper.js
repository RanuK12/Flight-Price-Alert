/**
 * Playwright-based Google Flights scraper.
 *
 * Uses headless Chromium to navigate Google Flights and extract flight data
 * from the rendered DOM. This approach is resilient to Google's internal RPC
 * protocol changes (which broke the direct HTTP POST scraper in Aug 2026).
 *
 * Architecture:
 *   - Single shared browser instance (lazy-initialized)
 *   - Each search opens a new page, extracts data, closes the page
 *   - Pre-set consent cookies to avoid the EU cookie consent gate
 *   - DOM extraction: parse visible flight cards for price, airline, stops, duration
 *
 * @module scrapers/playwrightScraper
 */

'use strict';

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  // Playwright not installed — module exports will be no-ops
  chromium = null;
}

// ═══════════════════════════════════════════════════════════════
// BROWSER POOL
// ═══════════════════════════════════════════════════════════════

let _browser = null;
let _browserLaunchPromise = null;

/**
 * Get or create the shared Chromium browser instance.
 * Deduplicates concurrent launch attempts.
 * @returns {Promise<import('playwright').Browser>}
 */
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;

  if (_browserLaunchPromise) return _browserLaunchPromise;

  _browserLaunchPromise = (async () => {
    try {
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--no-first-run',
        ],
      };
      try {
        _browser = await chromium.launch(launchOptions);
      } catch (launchErr) {
        if (launchErr.message.includes("Executable doesn't exist") || launchErr.message.includes('playwright install')) {
          console.log('  🎭 Playwright: Chromium missing at runtime. Installing Chromium...');
          const { execSync } = require('child_process');
          execSync('npx playwright install chromium', { stdio: 'inherit' });
          _browser = await chromium.launch(launchOptions);
        } else {
          throw launchErr;
        }
      }
      console.log('  🎭 Playwright: Chromium ready');
      return _browser;
    } catch (err) {
      console.error('  🎭 Playwright: launch failed:', err.message);
      throw err;
    } finally {
      _browserLaunchPromise = null;
    }
  })();


  return _browserLaunchPromise;
}

/**
 * Gracefully close the shared browser (for app shutdown).
 */
async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (e) { /* ignore */ }
    _browser = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// GOOGLE FLIGHTS CONSENT COOKIES
// ═══════════════════════════════════════════════════════════════

const CONSENT_COOKIES = [
  { name: 'CONSENT', value: 'YES+cb.20231108-08-p0.es+FX+111', domain: '.google.com', path: '/' },
  { name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVzIAEaBgiA_LyaBg', domain: '.google.com', path: '/' },
];

// ═══════════════════════════════════════════════════════════════
// FINGERPRINT / ANTI-BLOQUEO
// ═══════════════════════════════════════════════════════════════

/**
 * Perfiles de navegador coherentes (UA + plataforma + locale + huso).
 *
 * Antes se usaba un único UA hardcodeado con locale es-ES y timezone
 * Europe/Madrid en TODAS las búsquedas, incluidas las que salen de
 * Argentina. Un contexto nuevo, idéntico y sin historial 40 veces por hora
 * es un patrón fácil de marcar. Cada perfil es internamente consistente:
 * un UA de Mac no debe reportar plataforma Win32.
 */
const BROWSER_PROFILES = [
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    platform: 'Win32',
    viewport: { width: 1440, height: 900 },
  },
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    viewport: { width: 1512, height: 945 },
  },
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    platform: 'Win32',
    viewport: { width: 1366, height: 768 },
  },
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    viewport: { width: 1680, height: 1050 },
  },
];

/** Aeropuertos argentinos: la búsqueda debe parecer originada en AR. */
const AR_AIRPORTS = new Set(['EZE', 'AEP', 'COR', 'MDZ', 'ROS', 'MDQ', 'BRC', 'TUC', 'SLA', 'NQN']);

/** Locale/huso segun el origen de la busqueda, para que la huella sea coherente. */
function localeForOrigin(origin) {
  if (AR_AIRPORTS.has(String(origin || '').toUpperCase())) {
    return { locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' };
  }
  return { locale: 'es-ES', timezoneId: 'Europe/Madrid' };
}

/**
 * Script inyectado antes de cualquier JS de la página. Tapa los marcadores
 * clásicos de automatización que Chromium headless deja expuestos.
 * `navigator.webdriver === true` es el más viejo y el más chequeado.
 */
function stealthInit(platform) {
  return `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(platform)} });
    Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    window.chrome = window.chrome || { runtime: {} };
    const origQuery = navigator.permissions && navigator.permissions.query;
    if (origQuery) {
      navigator.permissions.query = (p) => (
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery.call(navigator.permissions, p)
      );
    }
  `;
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT POOL
// ═══════════════════════════════════════════════════════════════

/**
 * Contextos reutilizables por locale. Crear y destruir el contexto en cada
 * búsqueda significa presentarse siempre como un perfil recién nacido, sin
 * cookies ni historial. Reutilizarlo deja que Google acumule las cookies
 * normales de una sesión, que es lo que hace un humano.
 *
 * Se recicla cada RECYCLE_AFTER usos para no acumular estado indefinidamente
 * ni quedarse pegado a una huella si esa huella empieza a ser bloqueada.
 * @type {Map<string, {context: any, uses: number}>}
 */
const _contexts = new Map();
const RECYCLE_AFTER = 25;

/**
 * Devuelve un contexto listo para usar (con cookies de consentimiento y
 * stealth ya aplicados) para el locale que corresponda al origen.
 * @param {string} origin
 * @returns {Promise<any>}
 */
async function getContext(origin) {
  const { locale, timezoneId } = localeForOrigin(origin);
  const entry = _contexts.get(locale);

  if (entry && entry.uses < RECYCLE_AFTER) {
    entry.uses += 1;
    return entry.context;
  }
  if (entry) {
    await entry.context.close().catch(() => {});
    _contexts.delete(locale);
  }

  const browser = await getBrowser();
  const profile = BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
  const context = await browser.newContext({
    userAgent: profile.userAgent,
    locale,
    timezoneId,
    viewport: profile.viewport,
    extraHTTPHeaders: { 'Accept-Language': `${locale},es;q=0.9,en;q=0.8` },
  });
  await context.addCookies(CONSENT_COOKIES);
  await context.addInitScript(stealthInit(profile.platform));

  _contexts.set(locale, { context, uses: 1 });
  return context;
}

/** Cierra los contextos cacheados (shutdown / recovery). */
async function closeContexts() {
  for (const [, entry] of _contexts) {
    await entry.context.close().catch(() => {});
  }
  _contexts.clear();
}

// ═══════════════════════════════════════════════════════════════
// DOM FLIGHT EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract flight data from the Google Flights page DOM.
 * Looks for flight result list items and parses their text content.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{price: number, currency: string, airline: string, stops: number, totalDuration: number, departureAirport: string, arrivalAirport: string}>>}
 */
async function extractFlightsFromDOM(page) {
  return page.evaluate(() => {
    const flights = [];

    // Google Flights uses list items with [data-gs] or class pIav2d for flight cards
    // Also try: .Rk10dc (result list items), ul[class*="Rk10dc"] > li
    const cards = document.querySelectorAll('li[data-gs], .pIav2d, ul.Rk10dc > li');

    for (const card of cards) {
      try {
        const text = card.textContent || '';

        // Extract price: look for "714 €" or "€714" or "$714" patterns.
        // La moneda sale del símbolo que matcheó. La URL pide curr=EUR, pero
        // Google no siempre lo respeta; etiquetar mal la moneda hace que
        // toEur() aplique una conversión que no corresponde (los precios EUR
        // se reportaban como USD y quedaban 8% por debajo del real).
        let currency = 'EUR';
        let priceMatch = text.match(/(\d[\d.,]*)\s*€/) || text.match(/€\s*(\d[\d.,]*)/);
        if (!priceMatch) {
          priceMatch = text.match(/\$\s*(\d[\d.,]*)/);
          if (priceMatch) currency = 'USD';
        }
        if (!priceMatch) continue;
        const price = parseInt(priceMatch[1].replace(/[.,]/g, ''), 10);
        if (isNaN(price) || price < 50 || price > 15000) continue;

        // Extract airline name
        let airline = 'Unknown';
        // Try spans with specific class for airline name
        const airlineEl = card.querySelector('.sSHqwe, .h1fkLb, [data-test-id="airline-name"]');
        if (airlineEl) {
          airline = airlineEl.textContent.trim();
        } else {
          // Fallback: try to find airline names in the text
          const knownAirlines = [
            'Iberia', 'Air Europa', 'LATAM', 'Avianca', 'Turkish Airlines',
            'ITA Airways', 'Aerolíneas Argentinas', 'KLM', 'Lufthansa', 'Air France',
            'British Airways', 'Copa Airlines', 'Emirates', 'Qatar Airways',
            'Ethiopian Airlines', 'Aeroméxico', 'TAP Portugal', 'SWISS',
            'Austrian', 'Brussels Airlines', 'Finnair', 'SAS', 'LOT Polish',
            'American Airlines', 'United Airlines', 'Delta', 'Vueling',
            'Condor', 'Edelweiss', 'Plus Ultra', 'World2Fly', 'Air Canada',
            'BoA', 'JetSMART', 'Flybondi', 'Sky Airline',
          ];
          for (const a of knownAirlines) {
            if (text.includes(a)) { airline = a; break; }
          }
        }

        // Extract stops
        let stops = 0;
        if (/directo/i.test(text) || /nonstop/i.test(text)) {
          stops = 0;
        } else {
          const stopsMatch = text.match(/(\d+)\s*escala/i) || text.match(/(\d+)\s*stop/i);
          if (stopsMatch) stops = parseInt(stopsMatch[1], 10);
        }

        // Extract duration: "12 h 20 min" or "32 h 55 min"
        let totalDuration = 0;
        const durMatch = text.match(/(\d+)\s*h\s*(\d+)?\s*min/i);
        if (durMatch) {
          totalDuration = parseInt(durMatch[1], 10) * 60 + (parseInt(durMatch[2], 10) || 0);
        }

        // Extract airports from text
        let departureAirport = '';
        let arrivalAirport = '';
        const airportMatch = text.match(/([A-Z]{3})(?:Aeropuerto|Airport)/g);
        if (airportMatch && airportMatch.length >= 2) {
          departureAirport = airportMatch[0].slice(0, 3);
          arrivalAirport = airportMatch[1].slice(0, 3);
        }

        flights.push({
          price,
          currency,
          airline,
          stops,
          totalDuration,
          departureAirport,
          arrivalAirport,
          source: 'Google Flights (Playwright)',
        });
      } catch (e) {
        // Skip malformed cards
      }
    }

    // Deduplicate by price+airline
    const seen = new Set();
    return flights.filter(f => {
      const key = `${f.price}-${f.airline}-${f.stops}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN SEARCH FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Search Google Flights using Playwright headless browser.
 *
 * @param {string} origin - IATA origin airport code
 * @param {string} destination - IATA destination airport code
 * @param {string} departureDate - "YYYY-MM-DD"
 * @param {string|null} returnDate - "YYYY-MM-DD" or null for one-way
 * @returns {Promise<{success: boolean, flights: Array, minPrice: number|null}>}
 */
async function searchWithPlaywright(origin, destination, departureDate, returnDate = null) {
  if (!chromium) {
    return { success: false, flights: [], minPrice: null, error: 'Playwright not installed' };
  }

  let page = null;
  try {
    const context = await getContext(origin);
    page = await context.newPage();

    const url = buildSearchUrl(origin, destination, departureDate, returnDate);

    // 30s: en Render Free el goto de 20s expiraba en casi todas las pasadas.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for flight results to render (up to 12s)
    try {
      await page.waitForSelector('li[data-gs], .pIav2d, ul.Rk10dc > li', { timeout: 12000 });
    } catch (e) {
      // No results selector found — might be empty or page structure changed
    }

    // Extra time for lazy-loaded results
    await page.waitForTimeout(2000);

    const flights = await extractFlightsFromDOM(page);

    return {
      success: flights.length > 0,
      flights: flights.sort((a, b) => a.price - b.price),
      minPrice: flights.length > 0 ? flights[0].price : null,
    };
  } catch (err) {
    console.error(`  🎭 Playwright search error: ${err.message}`);
    return { success: false, flights: [], minPrice: null, error: err.message };
  } finally {
    // Se cierra la página, NO el contexto: las cookies de sesión se reusan.
    if (page) await page.close().catch(() => {});
  }
}

/**
 * URL de búsqueda de Google Flights.
 * @param {string} origin @param {string} destination
 * @param {string} departureDate @param {string|null} returnDate
 * @returns {string}
 */
function buildSearchUrl(origin, destination, departureDate, returnDate = null) {
  const base = 'https://www.google.com/travel/flights';
  const q = returnDate
    ? `Flights+from+${origin}+to+${destination}+on+${departureDate}+return+${returnDate}`
    : `Flights+from+${origin}+to+${destination}+on+${departureDate}+one+way`;
  return `${base}?q=${q}&curr=EUR&hl=es`;
}

// ═══════════════════════════════════════════════════════════════
// DATE GRID (tabla de fechas)
// ═══════════════════════════════════════════════════════════════

/** Selector de las tarjetas de vuelo: la grilla recién existe con resultados. */
const RESULTS_SELECTOR = 'li[data-gs], .pIav2d, ul.Rk10dc > li';

/**
 * Localiza el botón "Tabla de fechas", esperando a que aparezca.
 *
 * Por TEXTO y no por `jsname`: los atributos ofuscados de Google rotan (una
 * corrida con `jsname="KqtnKd"` funcionó y la siguiente no encontró nada),
 * mientras que la etiqueta visible es lo último que cambian. Se prueban los
 * dos idiomas por si Google ignora el `hl=es`.
 *
 * Con espera activa porque el botón solo se renderiza cuando terminaron de
 * llegar los resultados, y ese tiempo varía mucho entre corridas.
 *
 * @param {import('playwright').Page} page
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<any|null>} locator del botón, o null si nunca apareció
 */
async function findGridButton(page, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const deadline = Date.now() + timeoutMs;

  const candidates = () => [
    page.getByRole('button', { name: /tabla de fechas/i }),
    page.getByRole('button', { name: /date grid/i }),
    page.locator('button[jsname="KqtnKd"]'),
  ];

  while (Date.now() < deadline) {
    for (const locator of candidates()) {
      const button = locator.first();
      if (await button.isVisible().catch(() => false)) return button;
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

/**
 * Lee la "Tabla de fechas" de Google Flights: una grilla de 7 fechas de ida
 * x 7 de vuelta con el precio de cada combinación, que Google calcula de una
 * sola vez.
 *
 * Esto reemplaza 49 búsquedas individuales por una sola carga de página.
 *
 * El parseo es por GEOMETRÍA, no por selectores: las clases CSS de Google
 * están ofuscadas y rotan, pero la posición en pantalla no. La columna de un
 * precio es la cabecera de fecha alineada en X y la fila la alineada en Y,
 * que es exactamente como lo lee una persona.
 *
 * @param {string} origin
 * @param {string} destination
 * @param {string} departureDate - "YYYY-MM-DD", queda al centro de la grilla
 * @param {string} returnDate - "YYYY-MM-DD", queda al centro de la grilla
 * @returns {Promise<{success: boolean, cells: Array<{departureDate: string, returnDate: string, price: number, currency: string}>, minPrice: number|null, error?: string}>}
 */
async function searchDateGrid(origin, destination, departureDate, returnDate) {
  if (!chromium) {
    return { success: false, cells: [], minPrice: null, error: 'Playwright not installed' };
  }
  if (!returnDate) {
    return { success: false, cells: [], minPrice: null, error: 'date grid requires a return date' };
  }

  let page = null;
  try {
    const context = await getContext(origin);
    page = await context.newPage();

    const url = buildSearchUrl(origin, destination, departureDate, returnDate);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // La barra con "Tabla de fechas" solo se renderiza una vez que llegaron
    // los resultados: sin esta espera la página sigue en "Cargando resultados"
    // y el botón no existe todavía.
    await page.waitForSelector(RESULTS_SELECTOR, { timeout: 25000 })
      .catch(() => { /* seguimos: el botón puede estar igual */ });

    const gridButton = await findGridButton(page);
    if (!gridButton) {
      return { success: false, cells: [], minPrice: null, error: 'grid button not found' };
    }
    await gridButton.click();

    // La grilla se puebla por lotes: esperar un tiempo fijo devuelve tablas a
    // medio llenar (se vio una corrida con 11 celdas de 49). Esperamos a que
    // la cuenta de precios deje de crecer, con techo por si nunca estabiliza.
    await waitForGridToSettle(page);

    const raw = await page.evaluate(extractGridFromDOM);
    if (raw.error) {
      return { success: false, cells: [], minPrice: null, error: raw.error };
    }

    const cells = resolveGridCells(raw, departureDate, returnDate);
    const minPrice = cells.length ? Math.min(...cells.map(c => c.price)) : null;

    if (cells.length) {
      console.log(`  📅 Grid: ${origin}→${destination} ${cells.length} combinaciones (min €${minPrice})`);
    } else {
      console.log(`  📅 Grid: ${origin}→${destination} sin celdas parseables`);
    }

    return { success: cells.length > 0, cells, minPrice };
  } catch (err) {
    console.error(`  📅 Grid error: ${err.message}`);
    return { success: false, cells: [], minPrice: null, error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * Espera a que la grilla termine de poblarse: cuenta los precios visibles
 * cada 800ms y corta cuando el número se repite dos veces seguidas.
 *
 * @param {import('playwright').Page} page
 * @param {{maxMs?: number}} [opts]
 * @returns {Promise<number>} cantidad de precios al estabilizarse
 */
async function waitForGridToSettle(page, opts = {}) {
  const maxMs = opts.maxMs ?? 16000;
  const started = Date.now();
  let previous = -1;
  let stable = 0;

  while (Date.now() - started < maxMs) {
    await page.waitForTimeout(800);
    const count = await page
      .evaluate(() => (document.body.innerText.match(/\d[\d.\s]*\s*€/g) || []).length)
      .catch(() => previous);

    if (count === previous && count > 0) {
      stable += 1;
      if (stable >= 2) return count;
    } else {
      stable = 0;
    }
    previous = count;
  }
  return previous;
}

/**
 * Corre DENTRO de la página. Devuelve precios y cabeceras con sus coordenadas
 * en pantalla, sin interpretarlas (la conversión a fechas se hace en Node,
 * donde es testeable).
 *
 * @returns {{prices: Array<{price:number,x:number,y:number}>, heads: Array<{day:number,month:number,x:number,y:number}>, error?: string}}
 */
function extractGridFromDOM() {
  const MONTHS = {
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
    jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
  };

  // El diálogo del grid es el elemento más chico que contiene las dos
  // cabeceras de eje ("Salida" arriba, "Vuelta" al costado) y precios.
  const isGrid = (el) => {
    const t = el.textContent || '';
    return t.includes('Salida') && t.includes('Vuelta') && t.includes('€');
  };
  let dialog = null;
  for (const el of document.querySelectorAll('div')) {
    if (isGrid(el)) { dialog = el; break; }
  }
  if (!dialog) return { prices: [], heads: [], error: 'grid dialog not found' };
  // Descender al contenedor más específico que sigue cumpliendo.
  for (let depth = 0; depth < 40; depth++) {
    const inner = [...dialog.children].find(isGrid);
    if (!inner) break;
    dialog = inner;
  }

  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
  };

  const prices = [];
  const heads = [];
  for (const el of dialog.querySelectorAll('*')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();

    const pm = t.match(/^([\d.\s]+)\s*€$/);
    if (pm) {
      const val = parseInt(pm[1].replace(/[.\s]/g, ''), 10);
      const c = center(el);
      if (Number.isFinite(val) && val >= 50 && c.w > 0) prices.push({ price: val, x: c.x, y: c.y });
      continue;
    }

    const hm = t.match(/^(\d{1,2})\s+([a-záéíóúñ]+)\.?$/i);
    if (hm) {
      const mon = MONTHS[hm[2].toLowerCase().replace('.', '')];
      const c = center(el);
      if (mon && c.w > 0) heads.push({ day: parseInt(hm[1], 10), month: mon, x: c.x, y: c.y });
    }
  }

  return { prices, heads };
}

/**
 * Convierte precios+cabeceras posicionales en celdas con fechas.
 *
 * Las cabeceras de IDA comparten Y (fila superior) y las de VUELTA comparten
 * X (columna lateral). Separarlas así evita depender del layout exacto.
 * El año no está en el DOM (Google muestra "17 sept"), se infiere de las
 * fechas pedidas contemplando el salto de año.
 *
 * @param {{prices: Array, heads: Array}} raw
 * @param {string} departureDate - "YYYY-MM-DD" pedida (centro de la grilla)
 * @param {string} returnDate - "YYYY-MM-DD" pedida
 * @returns {Array<{departureDate: string, returnDate: string, price: number, currency: string}>}
 */
function resolveGridCells(raw, departureDate, returnDate) {
  const { prices = [], heads = [] } = raw || {};
  if (!prices.length || !heads.length) return [];

  // Moda de Y y de X: la fila y la columna de cabeceras.
  const modeOf = (values) => {
    const counts = new Map();
    for (const v of values) {
      const k = Math.round(v);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = null; let bestN = 0;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    return { value: best, count: bestN };
  };

  const rowY = modeOf(heads.map(h => h.y));
  const colX = modeOf(heads.map(h => h.x));
  const near = (a, b) => Math.abs(a - b) <= 4;

  const depHeads = heads.filter(h => near(h.y, rowY.value));
  const retHeads = heads.filter(h => near(h.x, colX.value));
  if (depHeads.length < 2 || retHeads.length < 2) return [];

  const depYear = yearResolver(departureDate);
  const retYear = yearResolver(returnDate);

  // Empareja una coordenada con la cabecera más cercana, exigiendo que esté
  // dentro de media celda: si no, la celda no pertenece a la grilla.
  const nearest = (value, list, key) => {
    let best = null; let bestD = Infinity;
    for (const h of list) {
      const d = Math.abs(h[key] - value);
      if (d < bestD) { bestD = d; best = h; }
    }
    return { head: best, distance: bestD };
  };

  const spacing = (list, key) => {
    const sorted = [...list].map(h => h[key]).sort((a, b) => a - b);
    let min = Infinity;
    for (let i = 1; i < sorted.length; i++) min = Math.min(min, sorted[i] - sorted[i - 1]);
    return Number.isFinite(min) ? min : 60;
  };
  // 0.35 de la separación entre cabeceras. En los datos reales el precio cae
  // exactamente sobre su columna (desvío 0 en X) y ~10px sobre su fila (de 47
  // de separación, 0.21). Con 0.6 un precio a mitad de camino entre dos
  // columnas se asignaba igual a una de las dos, inventando una celda.
  const CELL_TOLERANCE = 0.35;
  const maxDx = spacing(depHeads, 'x') * CELL_TOLERANCE;
  const maxDy = spacing(retHeads, 'y') * CELL_TOLERANCE;

  const cells = [];
  const seen = new Set();
  for (const p of prices) {
    const col = nearest(p.x, depHeads, 'x');
    const row = nearest(p.y, retHeads, 'y');
    if (!col.head || !row.head) continue;
    if (col.distance > maxDx || row.distance > maxDy) continue;

    const dep = depYear(col.head);
    const ret = retYear(row.head);
    if (!dep || !ret || ret < dep) continue;

    const key = `${dep}|${ret}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ departureDate: dep, returnDate: ret, price: p.price, currency: 'EUR' });
  }

  return cells.sort((a, b) => a.price - b.price);
}

/**
 * Devuelve una función que le pone año a un {day, month} usando la fecha
 * pedida como referencia. Contempla el salto de año: si pedís algo en enero
 * y la grilla muestra diciembre, ese diciembre es del año anterior.
 *
 * @param {string} isoDate - "YYYY-MM-DD"
 * @returns {(head: {day:number, month:number}) => string|null}
 */
function yearResolver(isoDate) {
  const [y, m] = String(isoDate).split('-').map(Number);
  if (!y || !m) return () => null;
  return (head) => {
    let year = y;
    if (m === 12 && head.month === 1) year = y + 1;
    else if (m === 1 && head.month === 12) year = y - 1;
    const dd = String(head.day).padStart(2, '0');
    const mm = String(head.month).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  };
}

/**
 * Check whether Playwright is available (installed and browser launchable).
 * @returns {boolean}
 */
function isAvailable() {
  return !!chromium;
}

module.exports = {
  searchWithPlaywright,
  searchDateGrid,
  closeBrowser,
  closeContexts,
  isAvailable,
  // Exportados para tests: la resolución posicional es pura y testeable sin
  // navegador (ver tests/dateGrid.test.js).
  resolveGridCells,
  yearResolver,
};
