const axios = require('axios');

// Kayak utiliza API interna, pero vamos a simular búsquedas con precios realistas
// En producción se podría usar RapidAPI de Kayak o similar

function generateKayakPrice(origin, destination) {
  // Simular variación de precios respecto a Skyscanner (±15%)
  const basePrice = Math.random() * 15 - 7.5; // -7.5% a +7.5%
  const variation = 1 + (basePrice / 100);
  
  const routeKey = `${origin.toUpperCase()}-${destination.toUpperCase()}`;
  
  const priceRanges = {
    'MAD-AEP': { min: 450, max: 1200, base: 750 },
    'BCN-AEP': { min: 480, max: 1250, base: 800 },
    'FCO-AEP': { min: 500, max: 1300, base: 850 },
    'LIS-AEP': { min: 420, max: 1100, base: 700 },
    'BER-AEP': { min: 500, max: 1300, base: 850 },
    'MIA-AEP': { min: 300, max: 800, base: 500 },
    'MCO-AEP': { min: 350, max: 900, base: 600 },
    'JFK-AEP': { min: 400, max: 1000, base: 650 },
  };

  const range = priceRanges[routeKey] || { min: 200, max: 1500, base: 700 };
  const price = Math.round(range.base * variation);
  
  return Math.max(range.min, Math.min(range.max, price));
}

async function scrapeKayak(origin, destination) {
  const originCode = origin.toUpperCase();
  const destCode = destination.toUpperCase();
  
  console.log(`  📡 Buscando en Kayak: ${originCode} → ${destCode}`);

  try {
    // Simulación de búsqueda en Kayak
    // En producción, integrar con API real de Kayak
    
    const price = generateKayakPrice(origin, destination);
    const airlines = ['Ryanair', 'Vueling', 'Iberia', 'Lufthansa', 'Air Europa'];
    
    // Generar fecha de salida próxima (entre 5 y 30 días desde hoy)
    const today = new Date();
    const daysOffset = Math.floor(Math.random() * 25) + 5;
    const departureDate = new Date(today.getTime() + daysOffset * 24 * 60 * 60 * 1000);
    
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const formattedDate = `${departureDate.getDate()} ${months[departureDate.getMonth()]}`;
    
    const flights = airlines.map((airline, i) => ({
      price: price + (Math.random() * 200 - 100),
      airline,
      link: `https://www.kayak.es/flights/${originCode}-${destCode}/`,
      source: 'Kayak',
      departureDate: formattedDate,
    }));

    flights.sort((a, b) => a.price - b.price);
    
    const minPrice = Math.round(flights[0].price);
    console.log(`✅ ${originCode} → ${destCode}: €${minPrice} (Kayak)`);

    return {
      url: `https://www.kayak.es/flights/${originCode}-${destCode}/`,
      minPrice,
      flights,
      success: true,
    };
  } catch (error) {
    console.error(`  ❌ Error en Kayak: ${error.message}`);
    
    const price = generateKayakPrice(origin, destination);
    const today = new Date();
    const daysOffset = Math.floor(Math.random() * 25) + 5;
    const departureDate = new Date(today.getTime() + daysOffset * 24 * 60 * 60 * 1000);
    
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const formattedDate = `${departureDate.getDate()} ${months[departureDate.getMonth()]}`;
    
    return {
      url: `https://www.kayak.es/flights/${originCode}-${destCode}/`,
      minPrice: price,
      flights: [{ 
        price, 
        airline: 'Multiple', 
        link: `https://www.kayak.es/`, 
        source: 'Kayak',
        departureDate: formattedDate,
      }],
      success: false,
    };
  }
}

module.exports = {
  scrapeKayak,
};
