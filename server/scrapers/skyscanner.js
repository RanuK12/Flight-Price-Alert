/**
 * Google Flights Scraper REAL
 * 
 * Hace scraping real de Google Flights para obtener precios de vuelos
 * NO genera precios falsos - solo devuelve lo que encuentra
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Fecha de búsqueda fija para consistencia
const SEARCH_DATE = '2026-03-28';
const RETURN_DATE = '2026-04-11'; // 14 días después

function buildGoogleFlightsUrl(origin, destination, departureDate, returnDate = null) {
  const originCode = origin.toUpperCase();
  const destCode = destination.toUpperCase();
  
  // URL de Google Flights con parámetros
  let url = `https://www.google.com/travel/flights/search?tfs=CBwQAhooEgoyMDI2LTAzLTI4agwIAhIIL20vMGZoN2dyDAgCEggvbS8wMTVmcg`;
  
  // Simplificado: usar URL de búsqueda directa
  if (returnDate) {
    url = `https://www.google.com/travel/flights?q=vuelos+de+${originCode}+a+${destCode}+${departureDate}+vuelta+${returnDate}&curr=EUR&hl=es`;
  } else {
    url = `https://www.google.com/travel/flights?q=vuelos+de+${originCode}+a+${destCode}+${departureDate}+solo+ida&curr=EUR&hl=es`;
  }
  
  return url;
}

async function scrapeGoogleFlights(origin, destination, isRoundTrip = false) {
  const originCode = origin.toUpperCase();
  const destCode = destination.toUpperCase();
  const departureDate = SEARCH_DATE;
  const returnDate = isRoundTrip ? RETURN_DATE : null;
  
  const tripType = isRoundTrip ? 'ida y vuelta' : 'solo ida';
  console.log(`  📡 Google Flights REAL: ${originCode} → ${destCode} (${tripType})`);

  let browser;
  
  try {
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--window-size=1920,1080',
      ],
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    try {
      browser = await puppeteer.launch(launchOptions);
    } catch (launchError) {
      const fs = require('fs');
      const possiblePaths = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
      ].filter(p => { try { return fs.existsSync(p); } catch { return false; } });

      if (possiblePaths.length > 0) {
        launchOptions.executablePath = possiblePaths[0];
        browser = await puppeteer.launch(launchOptions);
      } else {
        throw new Error('No browser found');
      }
    }

    const page = await browser.newPage();
    
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );
    
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setDefaultNavigationTimeout(60000);

    const url = buildGoogleFlightsUrl(originCode, destCode, departureDate, returnDate);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Aceptar cookies de Google si aparecen
    try {
      const acceptBtn = await page.$('button[aria-label*="Aceptar"]');
      if (acceptBtn) {
        await acceptBtn.click();
        await new Promise(res => setTimeout(res, 2000));
      }
    } catch (e) {}

    // Esperar a que carguen los resultados
    await new Promise(res => setTimeout(res, 6000));

    // Scroll para cargar más
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await new Promise(res => setTimeout(res, 1000));
    }

    // Extraer precios reales del DOM
    const flights = await page.evaluate((origin, dest, depDate, retDate, isRT) => {
      const results = [];
      const pricesSeen = new Set();

      // Buscar todos los elementos con precios
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach(el => {
        const text = el.innerText || el.textContent || '';
        
        // Solo procesar elementos pequeños (no contenedores grandes)
        if (text.length > 500) return;
        
        // Buscar patrón de precio €XXX
        const priceMatches = text.match(/€\s*(\d{1,4}(?:[.,]\d{2})?)/g);
        if (priceMatches) {
          for (const match of priceMatches) {
            const priceStr = match.replace(/[€\s]/g, '').replace(',', '.');
            const price = Math.round(parseFloat(priceStr));
            
            // Validar precio razonable
            if (price >= 150 && price <= 3000 && !pricesSeen.has(price)) {
              pricesSeen.add(price);
              
              // Buscar aerolínea cercana
              let airline = 'Aerolínea';
              const parentText = el.parentElement?.innerText || el.innerText || '';
              const airlines = ['Iberia', 'Air Europa', 'LATAM', 'Aerolíneas Argentinas', 'Level', 
                              'TAP', 'Air France', 'Lufthansa', 'KLM', 'Emirates', 'American',
                              'United', 'Delta', 'Copa', 'Avianca', 'Vueling', 'Ryanair'];
              for (const a of airlines) {
                if (parentText.toLowerCase().includes(a.toLowerCase())) {
                  airline = a;
                  break;
                }
              }
              
              results.push({
                price,
                airline,
                origin,
                destination: dest,
                departureDate: depDate,
                returnDate: retDate,
                tripType: isRT ? 'roundtrip' : 'oneway',
                source: 'Google Flights',
              });
            }
          }
        }
      });

      return results;
    }, originCode, destCode, departureDate, returnDate, isRoundTrip);

    await browser.close();

    if (flights.length > 0) {
      // Ordenar por precio
      flights.sort((a, b) => a.price - b.price);
      const minPrice = flights[0].price;
      
      console.log(`  ✅ Google encontró: €${minPrice} (${flights.length} vuelos)`);
      
      return {
        success: true,
        minPrice,
        flights: flights.slice(0, 10),
        url,
      };
    } else {
      console.log(`  ⚠️ Google Flights: sin precios encontrados`);
      // NO devolver precios falsos - devolver vacío
      return { success: false, flights: [], minPrice: null, url };
    }

  } catch (error) {
    if (browser) await browser.close();
    console.log(`  ❌ Google Flights error: ${error.message}`);
    // NO devolver precios falsos
    return { success: false, error: error.message, flights: [], minPrice: null };
  }
}

// Alias para compatibilidad
async function scrapeSkyscanner(origin, destination) {
  return scrapeGoogleFlights(origin, destination, false);
}

module.exports = {
  scrapeGoogleFlights,
  scrapeSkyscanner,
  buildGoogleFlightsUrl,
};
