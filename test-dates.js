#!/usr/bin/env node

/**
 * Test de Fechas de Vuelo
 * Verifica que los datos de salida se muestren correctamente
 */

const BASE_URL = 'http://localhost:3000';

async function testDates() {
  console.log('🧪 Iniciando test de fechas de vuelo...\n');

  try {
    // Test 1: Búsqueda Madrid → Buenos Aires
    console.log('📍 Test 1: Búsqueda MAD → AEP');
    
    let response1;
    try {
      response1 = await fetch(`${BASE_URL}/api/search?origin=MAD&destination=AEP`);
    } catch (e) {
      console.log('⚠️  Esperando a que el servidor esté listo...');
      await new Promise(r => setTimeout(r, 2000));
      response1 = await fetch(`${BASE_URL}/api/search?origin=MAD&destination=AEP`);
    }
    
    const data1 = await response1.json();

    if (data1.cheapestFlight) {
      console.log(`  ✅ Vuelo encontrado: ${data1.cheapestFlight.airline}`);
      console.log(`  💰 Precio: €${data1.cheapestFlight.price}`);
      console.log(`  📅 Fecha salida: ${data1.cheapestFlight.departureDate || 'No disponible'}`);
      console.log(`  🔗 Fuente: ${data1.cheapestFlight.source}`);
      
      // Verificar que tienen fecha todos los vuelos
      if (data1.allFlights && data1.allFlights.length > 0) {
        console.log(`\n  📋 Verificando ${data1.allFlights.length} vuelos:`);
        const flightsWithDate = data1.allFlights.filter(f => f.departureDate).length;
        console.log(`  ${flightsWithDate}/${data1.allFlights.length} vuelos tienen fecha`);
        
        if (flightsWithDate > 0) {
          console.log(`  Ejemplos de fechas encontradas:`);
          data1.allFlights.slice(0, 3).forEach((f, i) => {
            if (f.departureDate) {
              console.log(`    ${i + 1}. ${f.airline}: 📅 ${f.departureDate}`);
            }
          });
        }
      }
    }

    // Test 2: Búsqueda Barcelona → Miami
    console.log('\n📍 Test 2: Búsqueda BCN → MIA');
    const response2 = await fetch(`${BASE_URL}/api/search?origin=BCN&destination=MIA`);
    const data2 = await response2.json();

    if (data2.cheapestFlight) {
      console.log(`  ✅ Vuelo encontrado: ${data2.cheapestFlight.airline}`);
      console.log(`  💰 Precio: €${data2.cheapestFlight.price}`);
      console.log(`  📅 Fecha salida: ${data2.cheapestFlight.departureDate || 'No disponible'}`);
    }

    // Test 3: Verificar estructura de respuesta
    console.log('\n📍 Test 3: Estructura de respuesta API');
    const requiredFields = ['origin', 'destination', 'minPrice', 'cheapestFlight', 'allFlights'];
    const requiredFlightFields = ['airline', 'price', 'departureDate', 'source', 'link'];
    
    let structureValid = true;
    for (const field of requiredFields) {
      if (data1[field] !== undefined) {
        console.log(`  ✅ Campo "${field}" presente`);
      } else {
        console.log(`  ❌ Campo "${field}" faltante`);
        structureValid = false;
      }
    }

    if (data1.cheapestFlight) {
      console.log('\n  Validando campos de vuelo:');
      for (const field of requiredFlightFields) {
        if (data1.cheapestFlight[field] !== undefined) {
          console.log(`    ✅ ${field}`);
        } else {
          console.log(`    ⚠️  ${field} - No disponible`);
        }
      }
    }

    console.log('\n✨ Test completado exitosamente\n');
  } catch (error) {
    console.error('❌ Error en test:', error.message);
    process.exit(1);
  }
}

testDates();
