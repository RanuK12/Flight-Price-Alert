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
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Aceptar cookies
      try {
        const cookieBtn = await page.$('button[class*="accept"], button[aria-label*="Aceptar"], button[aria-label*="Accept"]');
        if (cookieBtn) {
          await cookieBtn.click();
          await new Promise(res => setTimeout(res, 1000));
        }
      } catch (e) {
        // Sin banner de cookies
      }

      // Scroll múltiple para cargar contenido dinámico
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise(res => setTimeout(res, 1000));
      }

      // Esperar a que cargue el contenido dinámico

      // Esperar a que cargue el contenido dinámico
      await new Promise(res => setTimeout(res, 3000));

      // Extraer precios y enlaces completos
      const flights = await page.evaluate((baseUrl) => {
        const results = [];
        const foundPrices = new Map(); // Usar Map para guardar link junto con precio

        // Estrategia 1: Buscar tarjetas de vuelo con estructura más flexible
        const possibleCards = document.querySelectorAll(
          '[data-testid*="flight"], [class*="FlightCard"], [class*="flight-card"], [class*="result-item"], [class*="CardContainer"], div[role="article"]'
        );

        if (possibleCards.length > 0) {
          possibleCards.forEach((card) => {
            try {
              const text = card.innerText || card.textContent;
              if (text.length > 50 && text.length < 1500) {
                // Buscar múltiples patrones de precio
                const pricePatterns = [
                  text.match(/€\s*(\d+(?:[.,]\d{2})?)/),
                  text.match(/(\d+(?:[.,]\d{2})?)\s*€/),
                  text.match(/EUR\s*(\d+(?:[.,]\d{2})?)/),
                  text.match(/(\d+(?:[.,]\d{2})?)\s*EUR/),
                ];
                
                for (const match of pricePatterns) {
                  if (match) {
                    const price = parseInt(match[1].replace(/[.,]/g, ''), 10);
                    if (price >= 50 && price <= 5000) {
                      // Obtener enlace del vuelo
                      let link = baseUrl;
                      const linkEl = card.querySelector('a[href]');
                      if (linkEl && linkEl.href) {
                        link = linkEl.href.startsWith('http') ? linkEl.href : baseUrl + linkEl.href;
                      }
                      
                      // Extraer aerolínea del texto
                      const airlineMatch = text.match(
                        /(?:Operated by |Airline:|By )?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s+Airlines|Airways)?)/
                      );
                      const airline = airlineMatch ? airlineMatch[1].trim() : 'Skyscanner';
                      
                      if (!foundPrices.has(price)) {
                        foundPrices.set(price, { price, airline, link });
                      }
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Continuar si hay error
            }
          });
        }

        // Convertir Map a array
        let results_array = Array.from(foundPrices.values());

        // Estrategia 2: Si no encontramos tarjetas, buscar filas o items
        if (results_array.length === 0) {
          const rows = document.querySelectorAll(
            'li, tr, [class*="item"], [class*="row"], [class*="option"]'
          );
          
          rows.forEach((row) => {
            const text = row.innerText || row.textContent;
            if (text && text.length > 20 && text.length < 1000) {
              const priceMatch = text.match(/€\s*(\d+(?:[.,]\d{2})?)|(\d+(?:[.,]\d{2})?)\s*€/);
              
              if (priceMatch) {
                const price = parseInt((priceMatch[1] || priceMatch[2]).replace(/[.,]/g, ''), 10);
                if (price >= 50 && price <= 5000 && !foundPrices.has(price)) {
                  let link = baseUrl;
                  const linkEl = row.querySelector('a[href]');
                  if (linkEl && linkEl.href) {
                    link = linkEl.href.startsWith('http') ? linkEl.href : baseUrl + linkEl.href;
                  }
                  
                  foundPrices.set(price, { price, airline: 'Skyscanner', link });
                }
              }
            }
          });
        }

        results_array = Array.from(foundPrices.values());

        // Estrategia 3: Búsqueda agresiva en todos los elementos
        if (results_array.length === 0) {
          const allText = document.body.innerText;
          // Buscar números de 2-4 dígitos seguidos de euro
          const priceMatches = allText.match(/€\s*(\d{2,4}(?:[.,]\d{2})?)/g) || [];
          
          const uniquePrices = new Set();
          priceMatches.forEach(match => {
            const price = parseInt(match.replace(/[^0-9]/g, ''), 10);
            if (price >= 50 && price <= 5000 && !uniquePrices.has(price)) {
              uniquePrices.add(price);
              foundPrices.set(price, { price, airline: 'Skyscanner', link: baseUrl });
            }
          });
        }

        return Array.from(foundPrices.values());
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
