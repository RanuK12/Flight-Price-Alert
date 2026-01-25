/**
 * Kayak Scraper REAL
 * 
 * Hace scraping real de Kayak.es para obtener precios de vuelos
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Fechas objetivo
const SEARCH_DATE_START = '2026-03-25';
const SEARCH_DATE_END = '2026-04-15';

function getSearchDate() {
  // Usar fecha fija del rango para consistencia
  return '2026-03-28';
}

function buildKayakUrl(origin, destination, departureDate, returnDate = null) {
  const originCode = origin.toUpperCase();
  const destCode = destination.toUpperCase();
  
  // Formato: kayak.es/flights/MAD-EZE/2026-03-28
  if (returnDate) {
    return `https://www.kayak.es/flights/${originCode}-${destCode}/${departureDate}/${returnDate}?sort=price_a`;
  }
  return `https://www.kayak.es/flights/${originCode}-${destCode}/${departureDate}?sort=price_a`;
}

async function scrapeKayak(origin, destination, returnDate = null) {
  const originCode = origin.toUpperCase();
  const destCode = destination.toUpperCase();
  const departureDate = getSearchDate();
  
  const tripType = returnDate ? 'ida y vuelta' : 'solo ida';
  console.log(`  📡 Kayak REAL: ${originCode} → ${destCode} (${tripType})`);

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

    const url = buildKayakUrl(originCode, destCode, departureDate, returnDate);
    console.log(`  🔗 URL: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Esperar a que carguen los resultados
    await new Promise(res => setTimeout(res, 8000));

    // Scroll para cargar más resultados
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await new Promise(res => setTimeout(res, 1500));
    }

    // Extraer precios reales del DOM
    const flights = await page.evaluate((origin, dest, depDate) => {
      const results = [];
      const pricesSeen = new Set();

      // Selectores de Kayak para precios
      const priceSelectors = [
        '[class*="price-text"]',
        '[class*="price"]',
        '[data-testid*="price"]',
        '.Oihj-bottom-booking-section .Hv20-value',
        '.Hv20-value',
        '.nrc6-price-section',
      ];

      for (const selector of priceSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.innerText || el.textContent || '';
          
          // Buscar patrón de precio €XXX o XXX €
          const priceMatch = text.match(/€\s*(\d{1,4}(?:[.,]\d{2})?)|(\d{1,4}(?:[.,]\d{2})?)\s*€/);
          if (priceMatch) {
            const priceStr = priceMatch[1] || priceMatch[2];
            const price = parseInt(priceStr.replace(/[.,]/g, ''), 10);
            
            // Validar precio razonable (entre 100 y 5000)
            if (price >= 100 && price <= 5000 && !pricesSeen.has(price)) {
              pricesSeen.add(price);
              
              // Buscar aerolínea en el contexto
              let airline = 'Aerolínea';
              const parent = el.closest('[class*="result"]') || el.closest('[class*="card"]') || el.parentElement;
              if (parent) {
                const parentText = parent.innerText || '';
                const airlines = ['Iberia', 'Air Europa', 'LATAM', 'Aerolíneas Argentinas', 'Level', 
                                'TAP', 'Air France', 'Lufthansa', 'KLM', 'Emirates', 'American',
                                'United', 'Delta', 'Copa', 'Avianca'];
                for (const a of airlines) {
                  if (parentText.includes(a)) {
                    airline = a;
                    break;
                  }
                }
              }
              
              results.push({
                price,
                airline,
                origin,
                destination: dest,
                departureDate: depDate,
                source: 'Kayak',
              });
            }
          }
        });
      }

      return results;
    }, originCode, destCode, departureDate);

    await browser.close();

    if (flights.length > 0) {
      // Ordenar por precio y tomar los mejores
      flights.sort((a, b) => a.price - b.price);
      const minPrice = flights[0].price;
      
      console.log(`  ✅ Kayak encontró: €${minPrice} (${flights.length} vuelos)`);
      
      return {
        success: true,
        minPrice,
        flights: flights.slice(0, 10), // Top 10
        url,
      };
    } else {
      console.log(`  ⚠️ Kayak: sin precios encontrados`);
      return { success: false, flights: [], minPrice: null, url };
    }

  } catch (error) {
    if (browser) await browser.close();
    console.log(`  ❌ Kayak error: ${error.message}`);
    return { success: false, error: error.message, flights: [], minPrice: null };
  }
}

module.exports = {
  scrapeKayak,
  buildKayakUrl,
};
