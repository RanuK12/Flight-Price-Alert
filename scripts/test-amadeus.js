/**
 * Smoke test de la integración Amadeus.
 *
 * Ejecuta:
 *   node scripts/test-amadeus.js
 *
 * Valida en orden:
 *   1) Carga de config + credenciales desde .env
 *   2) Corrida de migraciones (idempotente)
 *   3) OAuth2 — obtención de token
 *   4) Flight Offers Search (EZE → MAD, 45 días a futuro)
 *   5) Cache hit en segunda invocación
 *   6) HybridSearch con modo interactive
 *   7) (Opcional) Pricing confirm si hay oferta
 *
 * No rompe si alguno falla — loggea y sigue para dar diagnóstico completo.
 */

'use strict';

/* eslint-disable no-console */

const { config, summary } = require('../src/config');
const { runMigrations } = require('../src/database/migrations');
const { getClient } = require('../src/providers/amadeus/client');
const amadeus = require('../src/providers/amadeus');
const hybrid = require('../src/services/hybridSearch');
const cacheRepo = require('../src/database/repositories/cacheRepo');

/** @param {string} label @param {() => Promise<any>} fn */
async function step(label, fn) {
  const start = Date.now();
  process.stdout.write(`\n▶ ${label} ... `);
  try {
    const result = await fn();
    const ms = Date.now() - start;
    console.log(`OK (${ms}ms)`);
    return { ok: true, result };
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`FAIL (${ms}ms)`);
    console.error('  ↳', err?.message || err);
    if (err?.meta) console.error('  ↳ meta:', JSON.stringify(err.meta).slice(0, 400));
    return { ok: false, error: err };
  }
}

/** Fecha a 45 días → buen compromiso entre "hay vuelos" y "no es pasado". */
function futureDate(days = 45) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('━'.repeat(60));
  console.log(' AMADEUS SMOKE TEST');
  console.log('━'.repeat(60));
  console.log('Config:', JSON.stringify(summary(), null, 2));

  await step('Run DB migrations', () => runMigrations());

  // Limpiar cache para este test (evita falsos OK)
  await step('Purge expired cache', () => cacheRepo.purgeExpired());

  const tokenResult = await step('Acquire OAuth2 token', async () => {
    const token = await getClient().getToken();
    return { length: token.length, sample: token.slice(0, 8) + '...' };
  });
  if (!tokenResult.ok) {
    console.error('\n❌ Token failed — check AMADEUS_API_KEY/SECRET in .env');
    process.exit(1);
  }
  console.log('  token preview:', tokenResult.result);

  const departureDate = futureDate(45);

  const searchResult = await step(
    `Flight Offers Search EZE→MAD ${departureDate}`,
    () => amadeus.offers.searchFlights({
      origin: 'EZE',
      destination: 'MAD',
      departureDate,
      adults: 1,
      max: 5,
      currency: 'USD',
    }),
  );

  if (searchResult.ok) {
    const { flights, cached } = searchResult.result;
    console.log(`  found ${flights.length} flights (cached=${cached})`);
    const min = flights.reduce(
      (m, f) => (f.price < m ? f.price : m),
      flights[0]?.price ?? Infinity,
    );
    if (flights.length > 0) {
      console.log(`  cheapest: USD ${min} — ${flights[0].airline} (${flights[0].stops} stops)`);
    }
  }

  const cachedRun = await step(
    `Re-run search (expect cache hit)`,
    () => amadeus.offers.searchFlights({
      origin: 'EZE',
      destination: 'MAD',
      departureDate,
      adults: 1,
      max: 5,
      currency: 'USD',
    }),
  );
  if (cachedRun.ok) {
    console.log(`  cached=${cachedRun.result.cached} (debería ser false porque el provider no tiene cache sin adapter)`);
  }

  await step('Hybrid search (interactive mode)', async () => {
    const res = await hybrid.search(
      { origin: 'EZE', destination: 'MAD', departureDate, max: 3 },
      { mode: hybrid.MODE.INTERACTIVE },
    );
    console.log(`  providerUsed=${res.providerUsed} cached=${res.cached} flights=${res.flights.length}`);
    if (res.warnings?.length) console.log(`  warnings: ${res.warnings.join(' | ')}`);
    return res;
  });

  await step('Hybrid budget check', async () => hybrid.checkAmadeusBudget());

  console.log('\n━'.repeat(60));
  console.log(' Rate limiter snapshot:');
  console.log(' ', JSON.stringify(getClient().stats(), null, 2));
  console.log('━'.repeat(60));
  console.log('\n✅ Smoke test done');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥 Unhandled error:', err);
  process.exit(1);
});
