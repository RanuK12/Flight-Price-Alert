/**
 * Turismocity Scraper — extrae vuelos baratos de turismocity.com.ar
 *
 * Turismocity es un metabuscador argentino que compara precios de
 * múltiples agencias (Almundo, Despegar, Avantrip, etc.) y aerolíneas.
 * Bloquea requests HTTP directos (403), requiere Puppeteer.
 *
 * URL pattern: https://www.turismocity.com.ar/vuelos/{ORIGIN}-{DEST}/{DATE_OUT}/{DATE_IN}/1/0/0/E
 *   - ORIGIN/DEST: códigos IATA de 3 letras
 *   - DATE_OUT/DATE_IN: YYYY-MM-DD
 *   - 1/0/0: adults/children/infants
 *   - E: Economy (P=Premium, B=Business, F=First)
 *
 * @module scrapers/turismocity
 */

'use strict';

const TURISMOCITY_BASE = 'https://www.turismocity.com.ar';
const SEARCH_TIMEOUT_MS = 45000; // Turismocity tarda en cargar resultados (~20-30s)
const RESULTS_WAIT_MS = 25000;   // Espera a que carguen los resultados async

/**
 * Construye la URL de búsqueda de Turismocity.
 */
function buildSearchUrl(origin, destination, departureDate, returnDate = null) {
  if (returnDate) {
    return `${TURISMOCITY_BASE}/vuelos/${origin}-${destination}/${departureDate}/${returnDate}/1/0/0/E`;
  }
  return `${TURISMOCITY_BASE}/vuelos/${origin}-${destination}/${departureDate}/1/0/0/E`;
}

/**
 * Scrape vuelos de Turismocity usando Puppeteer.
 *
 * @param {string} origin - Código IATA (ej: "BUE", "EZE", "COR")
 * @param {string} destination - Código IATA (ej: "MAD", "BCN", "ROM")
 * @param {string} departureDate - YYYY-MM-DD
 * @param {string|null} returnDate - YYYY-MM-DD o null para solo ida
 * @returns {Promise<{success: boolean, flights: Array, minPrice: number|null, searchUrl: string, error?: string}>}
 */
async function scrapeTurismocity(origin, destination, departureDate, returnDate = null) {
  const searchUrl = buildSearchUrl(origin, destination, departureDate, returnDate);
  console.log(`  🌐 Turismocity: ${origin}→${destination} ${departureDate}${returnDate ? ' ↩' + returnDate : ''}`);

  let browser = null;
  try {
    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1366,768',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // Bloquear recursos pesados para acelerar
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS });

    // Turismocity carga resultados asincrónicamente. Esperar a que aparezcan.
    try {
      await page.waitForSelector('.result-item, .flight-result, .itinerary-result, [class*="result"]', {
        timeout: RESULTS_WAIT_MS,
      });
    } catch {
      // Si no aparece el selector específico, esperar un tiempo fijo
      await new Promise(r => setTimeout(r, 15000));
    }

    // Extraer vuelos del DOM
    const flights = await page.evaluate((depDate, retDate, orig, dest) => {
      const results = [];

      // Turismocity usa varias estructuras posibles. Intentar múltiples selectores.
      const priceElements = document.querySelectorAll(
        '[class*="price"], [class*="precio"], [data-price], .result-price, .flight-price'
      );

      // Buscar también en el JSON-LD o data attributes
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data['@type'] === 'Flight' || data.offers) {
            const price = data.offers?.price || data.price;
            if (price) {
              results.push({
                price: parseFloat(price),
                currency: data.offers?.priceCurrency || 'ARS',
                airline: data.provider?.name || data.airline?.name || 'Unknown',
                stops: 0,
                departureDate: depDate,
                returnDate: retDate,
                origin: orig,
                destination: dest,
                source: 'turismocity',
              });
            }
          }
        } catch {}
      }

      // Fallback: parsear elementos del DOM con precios
      const allElements = document.querySelectorAll(
        '.result-item, .flight-result, [class*="itinerary"], [class*="flight-card"], [class*="result-card"]'
      );

      for (const el of allElements) {
        try {
          // Buscar precio dentro del elemento
          const priceEl = el.querySelector(
            '[class*="price"], [class*="precio"], [class*="amount"], [class*="fare"]'
          );
          if (!priceEl) continue;

          const priceText = priceEl.textContent.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
          const price = parseFloat(priceText);
          if (!price || price < 10) continue;

          // Buscar aerolínea
          const airlineEl = el.querySelector(
            '[class*="airline"], [class*="carrier"], [class*="aerolinea"], img[alt]'
          );
          const airline = airlineEl?.textContent?.trim() || airlineEl?.getAttribute('alt') || 'Unknown';

          // Buscar escalas
          const stopsEl = el.querySelector('[class*="stop"], [class*="escala"], [class*="scale"]');
          const stopsText = stopsEl?.textContent || '';
          let stops = 0;
          if (/directo|nonstop|non-stop/i.test(stopsText)) stops = 0;
          else if (/1\s*(escala|stop|parada)/i.test(stopsText)) stops = 1;
          else if (/2\s*(escala|stop|parada)/i.test(stopsText)) stops = 2;

          // Buscar duración
          const durationEl = el.querySelector('[class*="duration"], [class*="duracion"], [class*="time"]');
          const duration = durationEl?.textContent?.trim() || null;

          // Detectar moneda (ARS por default en .com.ar)
          const fullPriceText = priceEl.textContent;
          let currency = 'ARS';
          if (/USD|\$\s*U/i.test(fullPriceText)) currency = 'USD';
          else if (/EUR|€/i.test(fullPriceText)) currency = 'EUR';

          results.push({
            price,
            currency,
            airline: airline.substring(0, 50),
            stops,
            duration,
            departureDate: depDate,
            returnDate: retDate,
            origin: orig,
            destination: dest,
            source: 'turismocity',
          });
        } catch {}
      }

      // Si no encontramos resultados con selectores específicos,
      // intentar extraer cualquier precio visible en la página
      if (results.length === 0) {
        const body = document.body.innerText;
        const priceMatches = body.match(/\$\s*[\d.]+/g);
        if (priceMatches && priceMatches.length > 0) {
          // Tomar los primeros 10 precios como candidatos
          for (const match of priceMatches.slice(0, 10)) {
            const price = parseFloat(match.replace(/[^\d.]/g, '').replace(/\.(?=.*\.)/g, ''));
            if (price > 1000 && price < 10000000) { // Rango razonable para vuelos en ARS
              results.push({
                price,
                currency: 'ARS',
                airline: 'Unknown',
                stops: 0,
                departureDate: depDate,
                returnDate: retDate,
                origin: orig,
                destination: dest,
                source: 'turismocity',
              });
            }
          }
        }
      }

      return results;
    }, departureDate, returnDate, origin, destination);

    await browser.close();
    browser = null;

    // Deduplicar por precio+aerolínea
    const seen = new Set();
    const unique = flights.filter(f => {
      const key = `${f.airline}-${Math.round(f.price)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a, b) => a.price - b.price);

    const minPrice = unique.length > 0 ? unique[0].price : null;
    console.log(`  ✅ Turismocity: ${unique.length} vuelos encontrados${minPrice ? `, min $${minPrice}` : ''}`);

    return {
      success: unique.length > 0,
      flights: unique,
      minPrice,
      searchUrl,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(`  ❌ Turismocity error: ${err.message}`);
    return {
      success: false,
      flights: [],
      minPrice: null,
      searchUrl,
      error: err.message,
    };
  }
}

module.exports = { scrapeTurismocity, buildSearchUrl };
