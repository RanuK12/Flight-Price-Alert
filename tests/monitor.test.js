/**
 * Tests para verificar la configuración de rutas y el contenido de mensajes.
 *
 * Bugs corregidos que se validan aquí:
 * 1. rotationState en memoria → COR nunca se buscaba tras restart del servidor
 * 2. sendDealsReport ignoraba region='chile_oceania' → SCL→SYD nunca aparecía
 * 3. Umbrales incorrectos en mensajes Telegram (€600/€650-800 vs €800/€800-1050)
 */

const {
  MONITORED_ROUTES,
  buildSearchPlan,
  ROUND_TRIP_THRESHOLD,
  NEAR_DEAL_RT_MIN,
  NEAR_DEAL_RT_MAX,
  ONE_WAY_THRESHOLDS,
} = require('../server/services/flightMonitor');

const {
  buildNearDealMessage,
  buildDealsReportMessage,
} = require('../server/services/telegram');

// ─────────────────────────────────────────────
// CONFIGURACIÓN DE RUTAS
// ─────────────────────────────────────────────
describe('MONITORED_ROUTES — configuración correcta', () => {
  test('incluye rutas desde Buenos Aires (EZE) a Europa', () => {
    const ezeRoutes = MONITORED_ROUTES.filter(r => r.origin === 'EZE');
    expect(ezeRoutes.length).toBeGreaterThanOrEqual(5);
    const destinations = ezeRoutes.map(r => r.destination);
    expect(destinations).toContain('MAD');
    expect(destinations).toContain('BCN');
    expect(destinations).toContain('FCO');
  });

  test('incluye rutas desde Córdoba (COR) a Europa', () => {
    const corRoutes = MONITORED_ROUTES.filter(r => r.origin === 'COR');
    expect(corRoutes.length).toBeGreaterThanOrEqual(5);
    const destinations = corRoutes.map(r => r.destination);
    expect(destinations).toContain('MAD');
    expect(destinations).toContain('BCN');
    expect(destinations).toContain('FCO');
  });

  test('incluye ruta Santiago → Sídney (solo ida)', () => {
    const sclRoute = MONITORED_ROUTES.find(r => r.origin === 'SCL' && r.destination === 'SYD');
    expect(sclRoute).toBeDefined();
    expect(sclRoute.tripType).toBe('oneway');
    expect(sclRoute.region).toBe('chile_oceania');
  });

  test('SCL→SYD tiene fechas de junio 2026', () => {
    const sclRoute = MONITORED_ROUTES.find(r => r.origin === 'SCL');
    expect(sclRoute.dateStart).toBeDefined();
    expect(sclRoute.dateEnd).toBeDefined();
    expect(sclRoute.dateStart).toMatch(/^2026-0[56]-/);
    expect(sclRoute.dateEnd).toMatch(/^2026-06-/);
  });

  test('todas las rutas argentina son ida y vuelta', () => {
    const argRoutes = MONITORED_ROUTES.filter(r => r.region === 'argentina');
    argRoutes.forEach(r => {
      expect(r.tripType).toBe('roundtrip');
    });
  });

  test('la ruta chile_oceania es solo ida', () => {
    const chileRoutes = MONITORED_ROUTES.filter(r => r.region === 'chile_oceania');
    chileRoutes.forEach(r => {
      expect(r.tripType).toBe('oneway');
    });
  });
});

// ─────────────────────────────────────────────
// PLAN DE BÚSQUEDA — Bug 1 corregido
// ─────────────────────────────────────────────
describe('buildSearchPlan() — cubre TODAS las rutas en cada corrida', () => {
  test('el plan incluye rutas EZE', () => {
    const plan = buildSearchPlan();
    const origins = plan.map(r => r.origin);
    expect(origins).toContain('EZE');
  });

  test('el plan incluye rutas COR (antes nunca aparecían por el bug de rotación)', () => {
    const plan = buildSearchPlan();
    const origins = plan.map(r => r.origin);
    expect(origins).toContain('COR');
  });

  test('el plan incluye la ruta SCL→SYD', () => {
    const plan = buildSearchPlan();
    const sclRoute = plan.find(r => r.origin === 'SCL' && r.destination === 'SYD');
    expect(sclRoute).toBeDefined();
  });

  test('el plan es idempotente — el resultado es igual sin importar cuántas veces se llama', () => {
    const plan1 = buildSearchPlan();
    const plan2 = buildSearchPlan();
    const keys1 = plan1.map(r => r.origin + r.destination);
    const keys2 = plan2.map(r => r.origin + r.destination);
    expect(keys1).toEqual(keys2);
  });

  test('el plan contiene las 10 rutas argentina + 1 ruta SCL→SYD = 11 total', () => {
    const plan = buildSearchPlan();
    const argCount = plan.filter(r => r.region === 'argentina').length;
    const chileCount = plan.filter(r => r.region === 'chile_oceania').length;
    expect(argCount).toBe(10);
    expect(chileCount).toBe(1);
    expect(plan.length).toBe(11);
  });

  test('el plan no repite rutas', () => {
    const plan = buildSearchPlan();
    const keys = plan.map(r => r.origin + r.destination);
    const unique = new Set(keys);
    expect(unique.size).toBe(plan.length);
  });
});

// ─────────────────────────────────────────────
// UMBRALES — Bug 3 corregido
// ─────────────────────────────────────────────
describe('Umbrales de precios', () => {
  test('umbral ida y vuelta Argentina→Europa es €800', () => {
    expect(ROUND_TRIP_THRESHOLD).toBe(800);
  });

  test('umbral "casi oferta" empieza en €800', () => {
    expect(NEAR_DEAL_RT_MIN).toBe(800);
  });

  test('umbral "casi oferta" termina en €1050', () => {
    expect(NEAR_DEAL_RT_MAX).toBe(1050);
  });

  test('umbral solo ida Chile→Oceanía es €700', () => {
    expect(ONE_WAY_THRESHOLDS.chileToOceania).toBe(700);
  });
});

// ─────────────────────────────────────────────
// MENSAJES TELEGRAM — Bugs 2 y 3 corregidos
// ─────────────────────────────────────────────
describe('buildNearDealMessage() — contenido correcto', () => {
  const sampleNearDeals = [
    { origin: 'EZE', destination: 'MAD', price: 920, airline: 'Iberia', departureDate: '2026-03-24', returnDate: '2026-04-07' },
    { origin: 'COR', destination: 'BCN', price: 850, airline: 'Level', departureDate: '2026-03-26', returnDate: '2026-04-07' },
  ];

  test('muestra rango €800-€1050 (no €650-€800 del código viejo)', () => {
    const msg = buildNearDealMessage(sampleNearDeals);
    expect(msg).toContain('€800-€1050');
    expect(msg).not.toContain('€650-€800');
  });

  test('muestra umbral de oferta ≤€800 (no ≤€600 del código viejo)', () => {
    const msg = buildNearDealMessage(sampleNearDeals);
    expect(msg).toContain('≤€800');
    expect(msg).not.toContain('≤€600');
  });

  test('muestra deals de Buenos Aires (EZE)', () => {
    const msg = buildNearDealMessage(sampleNearDeals);
    expect(msg).toContain('Buenos Aires (EZE)');
    expect(msg).toContain('920');
  });

  test('muestra deals de Córdoba (COR)', () => {
    const msg = buildNearDealMessage(sampleNearDeals);
    expect(msg).toContain('Córdoba (COR)');
    expect(msg).toContain('850');
  });

  test('devuelve null si no hay deals', () => {
    expect(buildNearDealMessage([])).toBeNull();
    expect(buildNearDealMessage(null)).toBeNull();
  });
});

describe('buildDealsReportMessage() — sección chile_oceania (Bug 2 corregido)', () => {
  test('incluye deals de chile_oceania en el mensaje', () => {
    const oneWayDeals = [
      {
        origin: 'SCL',
        destination: 'SYD',
        routeName: 'Santiago → Sídney',
        region: 'chile_oceania',
        price: 650,
        airline: 'LATAM',
        departureDate: '2026-06-10',
      },
    ];

    const msg = buildDealsReportMessage(oneWayDeals, []);
    expect(msg).toContain('Chile → Oceanía');
    expect(msg).toContain('Santiago → Sídney');
    expect(msg).toContain('650');
    expect(msg).toContain('LATAM');
  });

  test('no muestra sección Chile si no hay deals chile_oceania', () => {
    const roundTripDeals = [
      {
        origin: 'EZE',
        destination: 'MAD',
        routeName: 'Buenos Aires → Madrid',
        region: 'argentina',
        price: 750,
        airline: 'Iberia',
        departureDate: '2026-03-24',
        returnDate: '2026-04-07',
      },
    ];

    const msg = buildDealsReportMessage([], roundTripDeals);
    expect(msg).not.toContain('Chile → Oceanía');
  });

  test('muestra deals de EZE y COR en secciones separadas', () => {
    const roundTripDeals = [
      { origin: 'EZE', destination: 'MAD', routeName: 'Buenos Aires → Madrid', region: 'argentina', price: 700, airline: 'Iberia', departureDate: '2026-03-24' },
      { origin: 'COR', destination: 'FCO', routeName: 'Córdoba → Roma', region: 'argentina', price: 780, airline: 'Ethiopian', departureDate: '2026-03-26' },
    ];

    const msg = buildDealsReportMessage([], roundTripDeals);
    expect(msg).toContain('Buenos Aires (EZE)');
    expect(msg).toContain('Córdoba (COR)');
  });

  test('fecha del encabezado es correcta (20 mar - 7 abr, no 25 mar - 15 abr)', () => {
    const roundTripDeals = [
      { origin: 'EZE', destination: 'MAD', routeName: 'Buenos Aires → Madrid', region: 'argentina', price: 750, airline: 'Iberia', departureDate: '2026-03-24' },
    ];

    const msg = buildDealsReportMessage([], roundTripDeals);
    expect(msg).toContain('20 mar - 7 abr 2026');
    expect(msg).not.toContain('25 mar - 15 abr');
  });

  test('devuelve null si no hay deals', () => {
    expect(buildDealsReportMessage([], [])).toBeNull();
  });

  test('muestra umbral correcto ≤ €800 para ida y vuelta', () => {
    const roundTripDeals = [
      { origin: 'EZE', destination: 'MAD', routeName: 'Buenos Aires → Madrid', region: 'argentina', price: 750, airline: 'Iberia', departureDate: '2026-03-24' },
    ];

    const msg = buildDealsReportMessage([], roundTripDeals);
    expect(msg).toContain('€800');
    expect(msg).not.toContain('€600 oferta');
  });
});
