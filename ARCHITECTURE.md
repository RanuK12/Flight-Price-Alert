/**
 * FLIGHT PRICE FINDER v2.0
 * 
 * Arquitectura de la Aplicación
 * ============================
 * 
 * Esta es una aplicación web moderna construida con:
 * - Backend: Node.js + Express (API REST)
 * - Frontend: HTML5 + CSS3 + Vanilla JavaScript
 * - Base de datos: SQLite 3
 * - Web Scraping: Puppeteer + Cheerio
 * 
 * ESTRUCTURA DE CARPETAS
 * ======================
 * 
 * flight-price-bot/
 * ├── server/                    # Backend
 * │   ├── app.js                # Punto de entrada del servidor Express
 * │   ├── scrapers/             # Módulos de web scraping
 * │   │   ├── index.js         # Coordinador de scrapers
 * │   │   ├── skyscanner.js    # Scraper de Skyscanner
 * │   │   └── kayak.js         # Scraper de Kayak
 * │   ├── routes/               # Rutas API REST
 * │   │   └── flights.js       # Endpoints de búsqueda y alertas
 * │   ├── database/             # Capa de base de datos
 * │   │   └── db.js            # Gestión de SQLite
 * │   └── utils/                # Utilidades
 * │       └── routes.js        # Configuración de aeropuertos
 * ├── public/                   # Frontend
 * │   ├── index.html           # Página principal
 * │   ├── app.js               # Lógica JavaScript
 * │   └── styles.css           # Estilos
 * ├── tests/                    # Tests automatizados
 * │   ├── scraper.test.js
 * │   ├── sources.test.js
 * │   └── database.test.js
 * ├── data/                     # Datos locales (generado)
 * │   └── flights.db           # Base de datos SQLite
 * ├── package.json             # Dependencias y scripts
 * ├── jest.config.js           # Configuración de tests
 * ├── index.js                 # Script de inicio (compatibilidad)
 * └── .env                      # Configuración (no en Git)
 * 
 * 
 * CÓMO FUNCIONA
 * =============
 * 
 * 1. BÚSQUEDA DE VUELOS
 *    ├─ Usuario busca: "MAD → AEP"
 *    ├─ Frontend envía GET /api/search?origin=MAD&destination=AEP
 *    ├─ Backend coordina scrapers (Skyscanner, Kayak, etc.)
 *    ├─ Scrapers extraen precios en tiempo real
 *    ├─ Datos se guardan en SQLite
 *    ├─ Se consolida resultado (precio mínimo, links, etc.)
 *    └─ Frontend muestra resultados con opciones de reserva
 * 
 * 2. ALMACENAMIENTO
 *    ├─ Cada búsqueda se guarda en search_history
 *    ├─ Precios se guardan en flight_prices
 *    ├─ Usuario puede crear alertas con umbral
 *    └─ Alertas se guardan en saved_routes
 * 
 * 3. INTERFAZ
 *    ├─ Responsive design (mobile, tablet, desktop)
 *    ├─ Búsqueda rápida con rutas populares
 *    ├─ Comparación de precios por fuente
 *    ├─ Enlaces directos para reservar
 *    └─ Historial de búsquedas recientes
 * 
 * 
 * RUTAS CONFIGURADAS
 * ===================
 * 
 * DESTINO PRINCIPAL (Argentina):
 *   - AEP: Buenos Aires (Ezeiza) - Principal destino
 *   - COR: Córdoba - Alternativa regional
 * 
 * CIUDADES ECONÓMICAS DESDE EUROPA:
 *   - MAD: Madrid, España
 *   - BCN: Barcelona, España
 *   - FCO: Roma, Italia
 *   - LIS: Lisboa, Portugal (☆ MÁS ECONÓMICO)
 *   - BER: Berlín, Alemania (☆ MÁS ECONÓMICO)
 * 
 * CIUDADES ECONÓMICAS DESDE USA:
 *   - MIA: Miami, Florida (☆ MEJOR CONEXIÓN)
 *   - MCO: Orlando, Florida (☆ MÁS ECONÓMICO)
 *   - JFK: Nueva York, New York
 * 
 * 
 * CÓMO EJECUTAR
 * =============
 * 
 * Instalación inicial:
 *   $ npm install
 * 
 * Iniciar servidor de desarrollo:
 *   $ npm start
 *   → Abre http://localhost:3000
 * 
 * Ejecutar tests:
 *   $ npm test
 * 
 * Tests específicos:
 *   $ npm run test:scraper
 *   $ npm run test:api
 *   $ npm run test:db
 * 
 * 
 * ENDPOINTS API
 * =============
 * 
 * GET /api/search?origin=MAD&destination=AEP
 *   Busca vuelos. Retorna precios, aerolíneas, links.
 *   Respuesta: { origin, destination, minPrice, sources[], allFlights[] }
 * 
 * GET /api/history/:origin/:destination
 *   Obtiene historial de precios guardados.
 *   Respuesta: { route, history[], count }
 * 
 * GET /api/search-history?limit=20
 *   Obtiene búsquedas recientes.
 *   Respuesta: Array de { origin, destination, last_search }
 * 
 * POST /api/alert
 *   Crea alerta de precio.
 *   Body: { origin, destination, threshold }
 * 
 * GET /api/alerts
 *   Lista todas las alertas guardadas.
 * 
 * DELETE /api/alert/:id
 *   Elimina una alerta.
 * 
 * GET /api/stats
 *   Estadísticas de uso.
 *   Respuesta: { totalSearches, totalFlightsIndexed, avgPrice, minPriceFound }
 * 
 * 
 * AGREGANDO NUEVAS FUENTES DE SCRAPING
 * =====================================
 * 
 * 1. Crear archivo server/scrapers/nueva-fuente.js
 * 
 * 2. Implementar función:
 *    async function scrapeNuevaFuente(origin, destination) {
 *      // Lógica de scraping
 *      return {
 *        url: '...',
 *        minPrice: 450,
 *        flights: [{
 *          price: 450,
 *          airline: 'Airline Name',
 *          link: 'https://...',
 *          source: 'NuevaFuente'
 *        }],
 *        success: true
 *      };
 *    }
 * 
 * 3. Agregar a server/scrapers/index.js:
 *    const { scrapeNuevaFuente } = require('./nueva-fuente');
 *    
 *    // En scrapeAllSources():
 *    const nuevaResult = await scrapeNuevaFuente(origin, destination);
 *    results.sources.push({...});
 *    results.allFlights.push(...);
 * 
 * 4. ¡Listo! La nueva fuente se integra automáticamente
 * 
 * 
 * PROBLEMAS COMUNES
 * =================
 * 
 * "Conexión rechazada a localhost:3000"
 *   → Verificar que npm start esté ejecutándose
 *   → Cambiar PORT en .env si 3000 está en uso
 * 
 * "Error: Base de datos bloqueada"
 *   → Reiniciar servidor
 *   → Eliminar data/flights.db y déjalo recrearse
 * 
 * "Puppeteer timeout"
 *   → Conexión lenta a internet
 *   → Aumentar SCRAPER_TIMEOUT en .env
 *   → Algunos sitios bloquean scraping
 * 
 * "No se encuentra cheerio/puppeteer"
 *   → Ejecutar: npm install puppeteer-extra cheerio
 * 
 * 
 * NOTAS DE DESARROLLO
 * ===================
 * 
 * - El código intenta ser legible y mantenible
 * - Se usan nombres descriptivos para variables
 * - Cada módulo tiene una responsabilidad clara
 * - Los tests sirven para validar funcionalidad
 * - El frontend es vanilla JS (sin frameworks pesados)
 * - La BD usa SQLite por simplicidad (sin dependencias externas)
 * 
 * 
 * LICENCIA
 * ========
 * ISC
 * 
 */
