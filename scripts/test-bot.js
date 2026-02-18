// Test script para verificar que el bot funciona correctamente

require('dotenv').config();
const { scrapeSkyscanner } = require('../skyscanner_scraper');
const { initDb, insertPrice, getLastPrice } = require('../database');

async function testBot() {
  console.log('🧪 Iniciando tests del Flight Price Alert Bot...\n');

  // Test 1: Verificar base de datos
  console.log('📊 Test 1: Inicializando base de datos SQLite...');
  try {
    const dbReady = await initDb();
    if (dbReady) {
      console.log('✅ Base de datos lista\n');
    } else {
      console.error('❌ Error inicializando base de datos\n');
      return;
    }
  } catch (error) {
    console.error('❌ Error:', error.message, '\n');
    return;
  }

  // Test 2: Guardar un precio de prueba
  console.log('💾 Test 2: Guardando precio de prueba...');
  try {
    await insertPrice('MAD-COR', '2025-01-07', 450);
    console.log('✅ Precio guardado (MAD-COR: €450)\n');
  } catch (error) {
    console.error('❌ Error:', error.message, '\n');
    return;
  }

  // Test 3: Recuperar el precio
  console.log('🔍 Test 3: Recuperando precio almacenado...');
  try {
    const price = await getLastPrice('MAD-COR', '2025-01-07');
    if (price) {
      console.log(`✅ Precio recuperado: €${price}\n`);
    } else {
      console.warn('⚠️ No se encontró el precio\n');
    }
  } catch (error) {
    console.error('❌ Error:', error.message, '\n');
    return;
  }

  // Test 4: Web Scraping de Skyscanner
  console.log('🕷️ Test 4: Probando web scraping de Skyscanner...');
  console.log('📍 Buscando precios: Madrid → Córdoba\n');
  
  try {
    const { url, minPrice, flights } = await scrapeSkyscanner('MAD', 'COR');
    
    console.log(`✅ Scraping completado`);
    console.log(`   URL: ${url}`);
    console.log(`   Precio mínimo: ${minPrice ? `€${minPrice}` : 'No encontrado'}`);
    console.log(`   Vuelos encontrados: ${flights.length}\n`);

    if (minPrice && minPrice < 500) {
      console.log('🎉 ¡ALERTA! Precio bajo encontrado: €' + minPrice);
    } else if (minPrice) {
      console.log(`ℹ️ Precio por encima del umbral (€${minPrice} > €500)`);
    }
  } catch (error) {
    console.error('❌ Error en scraping:', error.message, '\n');
  }

  console.log('\n✅ Tests completados');
  process.exit(0);
}

testBot().catch(error => {
  console.error('❌ Error fatal:', error.message);
  process.exit(1);
});
