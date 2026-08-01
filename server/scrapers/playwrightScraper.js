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
      console.log('  🎭 Playwright: launching Chromium...');
      _browser = await chromium.launch({
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
      });
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
// DOM FLIGHT EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract flight data from the Google Flights page DOM.
 * Looks for flight result list items and parses their text content.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{price: number, airline: string, stops: number, totalDuration: number, departureAirport: string, arrivalAirport: string}>>}
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

        // Extract price: look for "714 €" or "€714" or "$714" patterns
        const priceMatch = text.match(/(\d[\d.,]*)\s*€/) || text.match(/€\s*(\d[\d.,]*)/) || text.match(/\$\s*(\d[\d.,]*)/);
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
  let context = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
      extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
    });

    // Set consent cookies
    await context.addCookies(CONSENT_COOKIES);

    page = await context.newPage();

    // Build search URL
    const base = 'https://www.google.com/travel/flights';
    let url;
    if (returnDate) {
      url = `${base}?q=Flights+from+${origin}+to+${destination}+on+${departureDate}+return+${returnDate}&curr=EUR&hl=es`;
    } else {
      url = `${base}?q=Flights+from+${origin}+to+${destination}+on+${departureDate}+one+way&curr=EUR&hl=es`;
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

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
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
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
  closeBrowser,
  isAvailable,
};
