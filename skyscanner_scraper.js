const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

function buildSkyscannerUrl(origin, destination) {
  return `https://www.skyscanner.es/transporte/vuelos/${origin.toLowerCase()}/${destination.toLowerCase()}/`;
}

async function scrapeSkyscanner(origin, destination, maxRetries = 2) {
  const url = buildSkyscannerUrl(origin, destination);
  let browser;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1200,800',
        ],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Aceptar cookies si existen
      try {
        const cookieBtn = await page.$('button[class*="accept"], button[title*="Aceptar"]');
        if (cookieBtn) {
          await cookieBtn.click();
          await new Promise(res => setTimeout(res, 500));
        }
      } catch (e) {
        // Sin banner de cookies
      }

      // Scroll para cargar contenido lazy
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await new Promise(res => setTimeout(res, 800));

      // Extraer precios
      const flights = await page.evaluate((baseUrl) => {
        const results = [];
        
        // Múltiples estrategias de búsqueda de precios
        const pricePatterns = [
          // Buscar en data attributes
          document.querySelectorAll('[data-test-id*="price"], [data-test*="price"]'),
          // Buscar por clases comunes
          document.querySelectorAll('[class*="price"]'),
          // Buscar span con números grandes
          document.querySelectorAll('span, div'),
        ];

        const foundPrices = new Set();

        for (const elements of pricePatterns) {
          elements.forEach((el) => {
            const text = el.textContent?.trim() || '';
            // Buscar patrones de precios: €número o número€
            const matches = text.match(/€\s*(\d{2,4})|(\d{2,4})\s*€/g);
            if (matches) {
              matches.forEach(match => {
                const price = parseInt(match.replace(/[^0-9]/g, ''), 10);
                if (price >= 50 && price <= 5000 && !foundPrices.has(price)) {
                  foundPrices.add(price);
                  results.push({
                    price,
                    airline: 'Skyscanner',
                    link: baseUrl,
                  });
                }
              });
            }
          });
        }

        // Si no encontramos precios, buscar en el texto completo
        if (results.length === 0) {
          const fullText = document.body.innerText;
          const priceMatches = fullText.match(/€\s*(\d{2,4})|(\d{2,4})\s*EUR/gi);
          if (priceMatches) {
            priceMatches.forEach(match => {
              const price = parseInt(match.replace(/[^0-9]/g, ''), 10);
              if (price >= 50 && price <= 5000 && !foundPrices.has(price)) {
                foundPrices.add(price);
                results.push({
                  price,
                  airline: 'Skyscanner',
                  link: baseUrl,
                });
              }
            });
          }
        }

        return results;
      }, url);

      const minPrice = flights.length > 0
        ? Math.min(...flights.map(f => f.price))
        : null;

      if (minPrice) {
        console.log(`✅ ${origin} → ${destination}: €${minPrice}`);
      } else {
        console.log(`❌ ${origin} → ${destination}: Sin precios`);
      }

      await browser.close();
      return { url, minPrice, flights };
    } catch (error) {
      if (browser) {
        await browser.close();
      }
      attempt += 1;
      console.error(`Error en intento ${attempt}: ${error.message}`);

      if (attempt >= maxRetries) {
        return { url, minPrice: null, flights: [] };
      }

      await new Promise(res => setTimeout(res, 2000 + Math.random() * 1000));
    }
  }

  return { url, minPrice: null, flights: [] };
}

module.exports = {
  buildSkyscannerUrl,
  scrapeSkyscanner,
};
