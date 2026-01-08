const { scrapeAllSources } = require('../../server/scrapers');

describe('Multi-Source Scraper', () => {
    jest.setTimeout(60000);

    test('scrapeAllSources debe retornar resultados de múltiples fuentes', async () => {
        const result = await scrapeAllSources('MAD', 'AEP');

        expect(result).toHaveProperty('origin');
        expect(result).toHaveProperty('destination');
        expect(result).toHaveProperty('minPrice');
        expect(result).toHaveProperty('sources');
        expect(result).toHaveProperty('allFlights');

        expect(result.origin).toBe('MAD');
        expect(result.destination).toBe('AEP');
    });

    test('scrapeAllSources debe agregar múltiples fuentes', async () => {
        const result = await scrapeAllSources('BCN', 'AEP');

        expect(Array.isArray(result.sources)).toBe(true);
        expect(result.sources.length).toBeGreaterThan(0);

        // Verificar que tenemos Skyscanner y Kayak
        const sourceNames = result.sources.map(s => s.name);
        expect(sourceNames).toContain('Skyscanner');
        expect(sourceNames).toContain('Kayak');
    });

    test('scrapeAllSources debe consolidar vuelos únicos', async () => {
        const result = await scrapeAllSources('LIS', 'AEP');

        expect(Array.isArray(result.allFlights)).toBe(true);
        
        // Verificar que no hay duplicados exactos
        const seen = new Set();
        result.allFlights.forEach(flight => {
            const key = `${flight.airline}-${flight.price}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
        });
    });

    test('scrapeAllSources debe encontrar vuelos con precios realistas', async () => {
        const result = await scrapeAllSources('MIA', 'AEP');

        expect(result.minPrice).toBeGreaterThan(0);
        expect(result.minPrice).toBeLessThan(5000);

        if (result.cheapestFlight) {
            expect(result.cheapestFlight.price).toBe(result.minPrice);
        }
    });
});
