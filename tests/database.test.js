const { initDatabase, run, get, all } = require('../../server/database/db');

describe('Database Operations', () => {
    beforeAll(async () => {
        // Inicializar BD de prueba
        await initDatabase();
    });

    test('initDatabase debe crear tablas correctamente', async () => {
        const result = await initDatabase();
        expect(result).toBe(true);
    });

    test('run debe ejecutar queries INSERT correctamente', async () => {
        const result = await run(
            'INSERT INTO search_history (origin, destination) VALUES (?, ?)',
            ['TEST_MAD', 'TEST_AEP']
        );

        expect(result).toHaveProperty('lastID');
        expect(result.lastID).toBeGreaterThan(0);
    });

    test('get debe retornar una fila única', async () => {
        await run(
            'INSERT INTO search_history (origin, destination) VALUES (?, ?)',
            ['QUERY_TEST', 'DEST_TEST']
        );

        const result = await get(
            'SELECT * FROM search_history WHERE origin = ?',
            ['QUERY_TEST']
        );

        expect(result).toBeDefined();
        expect(result.origin).toBe('QUERY_TEST');
    });

    test('all debe retornar múltiples filas', async () => {
        // Agregar algunos registros
        for (let i = 0; i < 3; i++) {
            await run(
                'INSERT INTO search_history (origin, destination) VALUES (?, ?)',
                [`MULTI_${i}`, `DEST_${i}`]
            );
        }

        const results = await all('SELECT * FROM search_history LIMIT 10');

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
    });

    test('flight_prices debe guardar vuelos correctamente', async () => {
        await run(
            `INSERT INTO flight_prices 
             (route_id, origin, destination, airline, price, source, booking_url) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['TEST-ROUTE', 'TEST', 'DEST', 'TestAirline', 450, 'Skyscanner', 'https://example.com']
        );

        const result = await get(
            'SELECT * FROM flight_prices WHERE route_id = ?',
            ['TEST-ROUTE']
        );

        expect(result).toBeDefined();
        expect(result.price).toBe(450);
        expect(result.airline).toBe('TestAirline');
    });

    test('saved_routes debe guardar alertas', async () => {
        await run(
            'INSERT INTO saved_routes (origin, destination, price_threshold) VALUES (?, ?, ?)',
            ['ALERT_TEST', 'ALERT_DEST', 500]
        );

        const result = await get(
            'SELECT * FROM saved_routes WHERE origin = ?',
            ['ALERT_TEST']
        );

        expect(result).toBeDefined();
        expect(result.price_threshold).toBe(500);
    });
});
