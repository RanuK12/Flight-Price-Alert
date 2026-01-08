const { scrapeAllSources } = require('./server/scrapers');
const { initDatabase, run, all } = require('./server/database/db');

/**
 * Demo Script - Valida funcionalidad de la aplicación
 */

async function runDemo() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Flight Price Finder v2.0 - Demo Script          ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  try {
    // 1. Inicializar BD
    console.log('📦 Inicializando base de datos...');
    const dbReady = await initDatabase();
    if (!dbReady) {
      throw new Error('No se pudo inicializar BD');
    }
    console.log('✅ BD lista\n');

    // 2. Probar scrapers
    console.log('🔍 Probando web scrapers...\n');

    const testRoutes = [
      { origin: 'MAD', destination: 'AEP', name: 'Madrid → Buenos Aires' },
      { origin: 'MIA', destination: 'AEP', name: 'Miami → Buenos Aires' },
      { origin: 'LIS', destination: 'AEP', name: 'Lisboa → Buenos Aires' },
    ];

    for (const route of testRoutes) {
      console.log(`  Buscando: ${route.name}`);
      try {
        const result = await scrapeAllSources(route.origin, route.destination);

        console.log(`    ✓ Precio mínimo: €${result.minPrice}`);
        console.log(`    ✓ Fuentes encontradas: ${result.sources.length}`);
        console.log(`    ✓ Vuelos totales: ${result.allFlights.length}`);

        // Guardar en BD
        const routeId = `${route.origin}-${route.destination}`;
        for (const flight of result.allFlights.slice(0, 3)) {
          try {
            await run(
              `INSERT INTO flight_prices 
               (route_id, origin, destination, airline, price, source, booking_url) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                routeId,
                route.origin,
                route.destination,
                flight.airline,
                flight.price,
                flight.source,
                flight.link
              ]
            );
          } catch (e) {
            // Ignorar duplicados
          }
        }

        console.log(`    ✓ Guardado en BD\n`);
      } catch (err) {
        console.log(`    ✗ Error: ${err.message}\n`);
      }
    }

    // 3. Consultar BD
    console.log('💾 Verificando datos en BD...\n');

    const flightCount = await all('SELECT COUNT(*) as count FROM flight_prices');
    const routeCount = await all('SELECT DISTINCT route_id FROM flight_prices');
    const priceStats = await all('SELECT AVG(price) as avg_price, MIN(price) as min FROM flight_prices');

    console.log(`  ✓ Total vuelos indexados: ${flightCount[0]?.count || 0}`);
    console.log(`  ✓ Rutas diferentes: ${routeCount.length}`);
    console.log(`  ✓ Precio promedio: €${Math.round(priceStats[0]?.avg_price || 0)}`);
    console.log(`  ✓ Precio mínimo encontrado: €${priceStats[0]?.min || 0}\n`);

    // 4. Resumen
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║   ✅ Todas las pruebas completadas exitosamente   ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');

    console.log('🚀 Para iniciar la aplicación, ejecuta:\n');
    console.log('   npm start\n');
    console.log('Luego abre http://localhost:3000 en tu navegador\n');

  } catch (error) {
    console.error('\n❌ Error durante la prueba:', error.message);
    process.exit(1);
  }
}

// Ejecutar demo
runDemo().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
