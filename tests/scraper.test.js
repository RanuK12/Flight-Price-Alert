const { scrapeSkyscanner, normalizeAirportCode } = require('../../server/scrapers/skyscanner');

describe('Skyscanner Scraper', () => {
    jest.setTimeout(30000);

    test('normalizeAirportCode debe convertir nombres a códigos', () => {
        expect(normalizeAirportCode('madrid')).toBe('MAD');
        expect(normalizeAirportCode('barcelona')).toBe('BCN');
        expect(normalizeAirportCode('buenos aires')).toBe('AEP');
        expect(normalizeAirportCode('MAD')).toBe('MAD');
    });

    test('normalizeAirportCode debe retornar uppercase para códigos desconocidos', () => {
        expect(normalizeAirportCode('ABC')).toBe('ABC');
    });

    test('scrapeSkyscanner debe retornar estructura de datos correcta', async () => {
        const result = await scrapeSkyscanner('MAD', 'AEP');

        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('minPrice');
        expect(result).toHaveProperty('flights');
        expect(result).toHaveProperty('success');

        expect(typeof result.minPrice).toBe('number');
        expect(Array.isArray(result.flights)).toBe(true);
        expect(result.minPrice > 0).toBe(true);
    });

    test('scrapeSkyscanner debe retornar vuelos con datos completos', async () => {
        const result = await scrapeSkyscanner('BCN', 'AEP');

        if (result.flights.length > 0) {
            const flight = result.flights[0];
            expect(flight).toHaveProperty('price');
            expect(flight).toHaveProperty('airline');
            expect(flight).toHaveProperty('link');
            expect(flight).toHaveProperty('source');
            
            expect(typeof flight.price).toBe('number');
            expect(flight.price > 0).toBe(true);
        }
    });

    test('scrapeSkyscanner debe manejar rutas con precios realistas', async () => {
        const result = await scrapeSkyscanner('MIA', 'AEP');

        // MIA a AEP debería ser más barato que Europa a AEP
        expect(result.minPrice).toBeGreaterThan(0);
        expect(result.minPrice).toBeLessThan(2000);
    });
});
