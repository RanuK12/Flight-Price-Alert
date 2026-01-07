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
          await page.waitForTimeout(500);
        }
      } catch (e) {
        // Sin banner de cookies
      }

      // Scroll para cargar contenido lazy
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await page.waitForTimeout(800);

      // Extraer precios
      const flights = await page.evaluate((baseUrl) => {
        const results = [];
        const priceElements = document.querySelectorAll(
          '[class*="price"], [class*="Price"], [data-test-id*="price"]'
        );

        priceElements.forEach((el) => {
          const text = el.textContent?.trim() || '';
          const match = text.match(/€?\s*(\d{1,4})/);
          if (match) {
            const price = parseInt(match[1], 10);
            if (price >= 50 && price <= 5000) {
              results.push({
                price,
                airline: 'Skyscanner',
                link: baseUrl,
              });
            }
          }
        });

        // Eliminar duplicados
        const seen = new Set();
        return results.filter((f) => {
          if (seen.has(f.price)) return false;
          seen.add(f.price);
          return true;
        });
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
