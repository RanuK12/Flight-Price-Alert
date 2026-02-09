/**
 * Google Flights Scraper con Puppeteer
 * 
 * Scraping REAL de precios de vuelos sin necesidad de API keys.
 * Usa Puppeteer con stealth plugin para evitar detección.
 * Incluye circuit breaker para evitar sobrecarga cuando falla repetidamente.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Configuración
const HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false';
const TIMEOUT = parseInt(process.env.PUPPETEER_TIMEOUT || '60000', 10);
const MAX_RETRIES = parseInt(process.env.PUPPETEER_RETRIES || '2', 10);

// ══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER - Pausar scraping cuando falla repetidamente
// ══════════════════════════════════════════════════════════════
const circuitBreaker = {
  failures: 0,
  lastFailure: null,
  isOpen: false,
  threshold: 5,           // Abrir circuit después de 5 fallos consecutivos
  resetTimeout: 10 * 60 * 1000, // Reintentar después de 10 minutos
  
  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.isOpen = true;
      console.log(`  🔴 Circuit breaker ABIERTO (${this.failures} fallos). Pausando 10 min.`);
    }
  },
  
  recordSuccess() {
    this.failures = 0;
    this.isOpen = false;
  },
  
  canProceed() {
    if (!this.isOpen) return true;
    
    // Verificar si pasó el tiempo de reset
    if (Date.now() - this.lastFailure > this.resetTimeout) {
      console.log('  🟡 Circuit breaker: intentando reconexión...');
      this.isOpen = false;
      this.failures = 0;
      return true;
    }
    
    console.log('  🔴 Circuit breaker ABIERTO - saltando scraping');
    return false;
  }
};

// Cache en memoria para evitar búsquedas repetidas (TTL: 2 horas)
const searchCache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 horas

/**
 * Genera URL de Google Flights
 */
function buildGoogleFlightsUrl(origin, destination, departureDate, returnDate = null) {
  // Formato: https://www.google.com/travel/flights?q=Flights%20from%20MAD%20to%20EZE%20on%202026-03-28
  const baseUrl = 'https://www.google.com/travel/flights';
  
  let query = `Flights from ${origin} to ${destination} on ${departureDate}`;
  if (returnDate) {
    query += ` return ${returnDate}`;
  }
  
  return `${baseUrl}?q=${encodeURIComponent(query)}&curr=EUR&hl=es`;
}

/**
 * Parsea precio de texto a número
 */
function parsePrice(priceText) {
  if (!priceText) return null;
  
  // Eliminar todo excepto números y coma/punto
  const cleaned = priceText.replace(/[^\d.,]/g, '');
  
  // Manejar formato europeo (1.234,56) vs americano (1,234.56)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Formato europeo: 1.234,56
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    }
    // Formato americano: 1,234.56
    return parseFloat(cleaned.replace(/,/g, ''));
  } else if (cleaned.includes(',')) {
    // Solo coma - puede ser decimal o miles
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length === 2) {
      // Es decimal: 234,56
      return parseFloat(cleaned.replace(',', '.'));
    }
    // Es miles: 1,234
    return parseFloat(cleaned.replace(',', ''));
  }
  
  return parseFloat(cleaned) || null;
}

/**
 * Extrae información de vuelos del DOM - métodos múltiples
 */
async function extractFlightData(page, debugMode = false) {
  // Método 1: Buscar precios en aria-labels (más confiable)
  let flights = await page.evaluate(() => {
    const results = [];
    
    // Buscar todos los elementos con aria-label que contengan precio
    const allElements = document.querySelectorAll('[aria-label]');
    
    for (const el of allElements) {
      const label = el.getAttribute('aria-label') || '';
      
      // Buscar patrones como "1.234 €" o "€1,234" o "1234 euros"
      const priceMatch = label.match(/(\d{1,3}(?:[.,]\d{3})*)\s*(?:€|euros?)/i) ||
                        label.match(/(?:€|EUR)\s*(\d{1,3}(?:[.,]\d{3})*)/i);
      
      if (priceMatch) {
        results.push({
          priceText: priceMatch[1],
          airline: 'Google Flights',
          source: 'aria-label'
        });
      }
    }
    
    return results;
  });
  
  if (flights.length > 0 && debugMode) {
    console.log(`  📊 Método aria-label: ${flights.length} precios`);
  }
  
  // Método 2: Buscar en el texto de la página directamente
  if (flights.length === 0) {
    flights = await page.evaluate(() => {
      const results = [];
      const bodyText = document.body.innerText || '';
      
      // Regex más amplio para encontrar precios en euros
      const pricePatterns = [
        /(\d{3,4})\s*€/g,                    // 234 € o 1234 €
        /(\d{1,3}\.\d{3})\s*€/g,             // 1.234 €
        /€\s*(\d{3,4})/g,                     // € 1234
        /desde\s+(\d{3,4})\s*€/gi,           // desde 234 €
      ];
      
      const foundPrices = new Set();
      
      for (const pattern of pricePatterns) {
        let match;
        while ((match = pattern.exec(bodyText)) !== null) {
          const priceStr = match[1];
          if (!foundPrices.has(priceStr)) {
            foundPrices.add(priceStr);
            results.push({
              priceText: priceStr,
              airline: 'Google Flights',
              source: 'body-text'
            });
          }
        }
      }
      
      return results;
    });
    
    if (flights.length > 0 && debugMode) {
      console.log(`  📊 Método body-text: ${flights.length} precios`);
    }
  }
  
  // Método 3: Buscar elementos con clases conocidas de Google Flights
  if (flights.length === 0) {
    flights = await page.evaluate(() => {
      const results = [];
      const selectors = [
        '.YMlIz.FpEdX',
        'span[data-gs]',
        '.BVAVmf',
        '.pIav2d',
        '.JMnxgf span',
        '[jscontroller] [data-ved]',
      ];
      
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.innerText || el.textContent || '';
            const match = text.match(/(\d{1,3}(?:[.,]\d{3})*)\s*€/);
            if (match) {
              results.push({
                priceText: match[1],
                airline: 'Google Flights',
                source: 'css-selector'
              });
            }
          }
          if (results.length > 0) break;
        } catch (e) {}
      }
      
      return results;
    });
  }
  
  return flights;
}

/**
 * Espera a que la página cargue completamente
 */
async function waitForFlightResults(page) {
  try {
    // Scroll para cargar contenido dinámico
    await page.evaluate(() => {
      window.scrollTo(0, 500);
    });
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Esperar a que aparezcan resultados
    await Promise.race([
      page.waitForSelector('[data-gs]', { timeout: 15000 }),
      page.waitForSelector('[role="listitem"]', { timeout: 15000 }),
      page.waitForSelector('.YMlIz', { timeout: 15000 }),
      page.waitForFunction(() => {
        const text = document.body.innerText || '';
        return text.includes('€') && text.match(/\d{3,4}\s*€/);
      }, { timeout: 15000 }),
    ]);
    
    // Scroll adicional para asegurar carga
    await page.evaluate(() => {
      window.scrollTo(0, 1000);
    });
    
    await new Promise(r => setTimeout(r, 3000));
    
    return true;
  } catch (e) {
    console.log('  ⏳ Timeout esperando resultados, intentando extraer datos disponibles...');
    await new Promise(r => setTimeout(r, 2000));
    return false;
  }
}

/**
 * Busca vuelos en Google Flights usando Puppeteer
 * 
 * @param {string} origin - Código IATA origen (ej: MAD)
 * @param {string} destination - Código IATA destino (ej: EZE)
 * @param {string} departureDate - Fecha de ida YYYY-MM-DD
 * @param {string} returnDate - Fecha de vuelta (opcional, para ida y vuelta)
 * @returns {Object} Resultado con vuelos encontrados
 */
async function scrapeGoogleFlights(origin, destination, departureDate, returnDate = null) {
  const tripType = returnDate ? 'roundtrip' : 'oneway';
  const cacheKey = `${origin}-${destination}-${departureDate}-${returnDate || 'oneway'}`;
  
  // Verificar caché
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    console.log(`  🧠 Cache hit: ${origin}→${destination}`);
    return cached.data;
  }
  
  // ══════════════════════════════════════════════════════════════
  // CIRCUIT BREAKER CHECK - Si hay muchos fallos, pausar
  // ══════════════════════════════════════════════════════════════
  if (!circuitBreaker.canProceed()) {
    return {
      success: false,
      flights: [],
      minPrice: null,
      origin,
      destination,
      departureDate,
      returnDate,
      tripType,
      error: 'Circuit breaker open - too many failures',
      searchUrl: buildGoogleFlightsUrl(origin, destination, departureDate, returnDate),
    };
  }
  
  const url = buildGoogleFlightsUrl(origin, destination, departureDate, returnDate);
  console.log(`  🔍 Scraping: ${origin} → ${destination} (${departureDate}${returnDate ? ' ↔ ' + returnDate : ''})`);
  
  let browser = null;
  let lastError = null;
  
  // Detectar path del navegador según entorno
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || 
                         (require('fs').existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) ||
                         (require('fs').existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined) ||
                         (require('fs').existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : undefined);
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const launchOptions = {
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
        ],
        defaultViewport: { width: 1920, height: 1080 },
      };
      
      // Usar executablePath solo si está definido
      if (executablePath) {
        launchOptions.executablePath = executablePath;
        if (attempt === 1) console.log(`  🖥️ Usando: ${executablePath}`);
      }
      
      browser = await puppeteer.launch(launchOptions);
      
      const page = await browser.newPage();
      
      // Configurar user agent realista
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Configurar idioma y moneda
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      });
      
      // Navegar a Google Flights
      await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      
      // Aceptar cookies si aparece el diálogo
      try {
        const acceptButton = await page.$('[aria-label*="Aceptar"]') || await page.$('button[id*="accept"]');
        if (acceptButton) {
          await acceptButton.click();
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) {
        // Ignorar si no hay diálogo de cookies
      }
      
      // Esperar resultados
      await waitForFlightResults(page);
      
      // Extraer datos (con debug si no es producción)
      const debugMode = process.env.NODE_ENV !== 'production';
      const rawFlights = await extractFlightData(page, debugMode);
      
      // Si no encontramos vuelos y estamos en modo debug, guardar screenshot
      if (rawFlights.length === 0 && debugMode) {
        const fs = require('fs');
        const path = require('path');
        const debugDir = path.join(process.cwd(), 'debug');
        
        try {
          if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true });
          }
          
          const screenshotPath = path.join(debugDir, `gf_${origin}_${destination}_${Date.now()}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(`  📸 Screenshot guardado: ${screenshotPath}`);
          
          // También guardar el HTML para análisis
          const html = await page.content();
          const htmlPath = path.join(debugDir, `gf_${origin}_${destination}_${Date.now()}.html`);
          fs.writeFileSync(htmlPath, html);
          console.log(`  📄 HTML guardado: ${htmlPath}`);
        } catch (e) {
          console.log(`  ⚠️ No se pudo guardar debug: ${e.message}`);
        }
      }
      
      await browser.close();
      browser = null;
      
      // Procesar y deduplicar vuelos
      const flights = [];
      const seenPrices = new Set();
      
      for (const raw of rawFlights) {
        const price = parsePrice(raw.priceText);
        if (price && price > 50 && price < 10000 && !seenPrices.has(price)) {
          seenPrices.add(price);
          flights.push({
            price,
            airline: raw.airline,
            source: 'Google Flights',
            departureDate,
            returnDate,
            tripType,
            link: url,
          });
        }
      }
      
      // Ordenar por precio
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
      
      // Guardar en caché
      searchCache.set(cacheKey, { data: result, timestamp: Date.now() });
      
      if (flights.length > 0) {
        console.log(`  ✅ ${flights.length} precios encontrados (min: €${result.minPrice})`);
        circuitBreaker.recordSuccess(); // ✅ Reset circuit breaker on success
      } else {
        console.log(`  ⚠️ Sin precios encontrados`);
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      console.log(`  ⚠️ Intento ${attempt}/${MAX_RETRIES} fallido: ${error.message}`);
      
      if (browser) {
        try { await browser.close(); } catch (e) {}
        browser = null;
      }
      
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000 * attempt)); // Backoff exponencial
      }
    }
  }
  
  // Todos los intentos fallaron
  console.error(`  ❌ Error scraping ${origin}-${destination}: ${lastError?.message}`);
  circuitBreaker.recordFailure(); // ❌ Incrementar contador de fallos
  
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
    searchUrl: url,
  };
}

/**
 * Limpia la caché expirada
 */
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of searchCache) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}

// Limpiar caché cada hora
setInterval(cleanCache, 60 * 60 * 1000);

module.exports = {
  scrapeGoogleFlights,
  buildGoogleFlightsUrl,
  parsePrice,
  cleanCache,
};
