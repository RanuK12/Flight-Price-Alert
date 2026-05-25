#!/usr/bin/env node
/**
 * Smoke test del scraper de TurismoCity.
 *
 * Útil para verificar localmente que el scraper funciona con tu Chrome,
 * y para diagnosticar fallos en producción (Render, Docker).
 *
 * Valida en orden:
 *   1. Carga del módulo sin romper.
 *   2. URL builder correcto para una ruta conocida.
 *   3. parsePrice maneja todos los formatos esperados (ARS/USD/EUR).
 *   4. isAvailable() refleja el estado real del entorno (Chromium o no).
 *   5. Provider wrapper (src/providers/turismocity) responde con shape
 *      `FlightSearchResult` aún en modo degradado.
 *   6. (opcional) Scrape real contra TurismoCity si hay Chrome.
 *
 * Uso:
 *   node scripts/test-turismocity.js                # suite completa
 *   node scripts/test-turismocity.js --skip-network # sólo unit tests
 *   node scripts/test-turismocity.js --route MAD-EZE --date 2026-10-15
 *
 * Si Chrome no se puede lanzar (faltan libs en sandbox/Render free),
 * el provider degrada limpio y devuelve flights: [] con
 * meta.unavailable = true. Eso también se valida.
 */

'use strict';

const path = require('path');

// Stubs mínimos para evitar el error "Missing required env var" de
// src/config cuando el usuario corre este test sin .env real.
process.env.AMADEUS_API_KEY = process.env.AMADEUS_API_KEY || 'test-stub';
process.env.AMADEUS_API_SECRET = process.env.AMADEUS_API_SECRET || 'test-stub';

const SKIP_NETWORK = process.argv.includes('--skip-network');

function getFlag(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${msg}`);
  } else {
    fail += 1;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

function header(title) {
  console.log('\n' + '─'.repeat(60));
  console.log(' ' + title);
  console.log('─'.repeat(60));
}

async function main() {
  header('1. Carga del módulo scraper');
  let scraper;
  try {
    scraper = require(path.resolve(__dirname, '..', 'server/scrapers/turismocity.js'));
    assert(typeof scraper.scrapeTurismoCity === 'function', 'exporta scrapeTurismoCity');
    assert(typeof scraper.buildSearchUrl === 'function', 'exporta buildSearchUrl');
    assert(typeof scraper.parsePrice === 'function', 'exporta parsePrice');
    assert(typeof scraper.isAvailable === 'function', 'exporta isAvailable');
    assert(scraper.IATA_TO_SLUG && scraper.IATA_TO_SLUG.MAD === 'madrid-mad',
      'IATA_TO_SLUG mapping correcto (MAD → madrid-mad)');
  } catch (err) {
    assert(false, `require scraper falló: ${err.message}`);
    return finish();
  }

  header('2. URL builder');
  const u1 = scraper.buildSearchUrl('MAD', 'EZE', '2026-10-15', null);
  assert(
    u1.includes('madrid-mad/buenos-aires-eze') &&
      u1.includes('date_from=2026-10-15') &&
      u1.includes('type=oneway'),
    `oneway URL: ${u1}`,
  );

  const u2 = scraper.buildSearchUrl('EZE', 'MAD', '2026-07-15', '2026-07-30');
  assert(
    u2.includes('buenos-aires-eze/madrid-mad') &&
      u2.includes('date_from=2026-07-15') &&
      u2.includes('date_to=2026-07-30') &&
      u2.includes('type=roundtrip'),
    `roundtrip URL: ${u2}`,
  );

  const u3 = scraper.buildSearchUrl('XYZ', 'ABC', '2026-01-01');
  assert(u3.includes('xyz/abc'),
    'fallback de slug usa IATA en minúscula para destinos desconocidos');

  header('3. parsePrice — ARS / USD / EUR');
  const cases = [
    { in: 'ARS 285.300', want: { amount: 285300, currency: 'ARS' } },
    { in: '$ 285.300',   want: { amount: 285300, currency: 'ARS' } },
    { in: 'USD 750',     want: { amount: 750,    currency: 'USD' } },
    { in: 'U$S 1.234',   want: { amount: 1234,   currency: 'USD' } },
    { in: '€ 750',       want: { amount: 750,    currency: 'EUR' } },
    { in: 'EUR 1.234,56',want: { amount: 1234.56,currency: 'EUR' } },
    { in: '750 €',       want: { amount: 750,    currency: 'EUR' } },
    { in: '1,234 USD',   want: { amount: 1234,   currency: 'USD' } },
  ];
  for (const c of cases) {
    const got = scraper.parsePrice(c.in);
    const ok = got && got.currency === c.want.currency
      && Math.abs(got.amount - c.want.amount) < 0.01;
    assert(ok, `parsePrice("${c.in}") → ${JSON.stringify(got)}`);
  }

  header('4. isAvailable — refleja entorno');
  const available = scraper.isAvailable();
  console.log(`  ℹ️ isAvailable() = ${available}`);
  console.log(`  ℹ️ findChromium() = ${scraper.findChromium() || '(ninguno — usaría bundled de Puppeteer)'}`);
  assert(typeof available === 'boolean', 'isAvailable devuelve boolean');

  header('5. Provider wrapper carga y responde shape correcta');
  let provider;
  try {
    provider = require(path.resolve(__dirname, '..', 'src/providers/turismocity'));
    assert(typeof provider.search === 'function', 'provider exporta search()');
    assert(typeof provider.TurismoCityProvider === 'function',
      'provider exporta clase TurismoCityProvider');
  } catch (err) {
    assert(false, `require provider falló: ${err.message}`);
    return finish();
  }

  // Llamar provider.search() y verificar shape, esté disponible o no.
  const route = (getFlag('--route', 'MAD-EZE') || 'MAD-EZE').split('-');
  const departureDate = getFlag('--date', '2026-10-15');

  if (SKIP_NETWORK) {
    console.log('  ℹ️ --skip-network → no se llama provider.search()');
  } else {
    console.log(`  ℹ️ Llamando provider.search({ ${route[0]} → ${route[1]}, ${departureDate} })...`);
    try {
      const t0 = Date.now();
      const result = await Promise.race([
        provider.search({
          origin: route[0], destination: route[1],
          departureDate, currency: 'EUR',
        }),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('test-timeout-50s')),
          50_000,
        )),
      ]);
      const elapsed = Date.now() - t0;

      assert(result && Array.isArray(result.flights),
        `result.flights es array (${result?.flights?.length} vuelos, ${elapsed}ms)`);
      assert(result.source === 'turismocity', `source='turismocity'`);
      assert(result.meta && typeof result.meta.count === 'number',
        'meta.count es número');

      if (result.meta?.unavailable) {
        console.log(`  ℹ️ Scraper degradado (${result.meta.reason}) — esto es OK en sandbox sin Chrome`);
      } else if (result.flights.length > 0) {
        const cheapest = result.flights[0];
        console.log(`  💰 Más barato: ${cheapest.currency} ${cheapest.price} (${cheapest.airline || 'sin nombre'})`);
        assert(typeof cheapest.price === 'number' && cheapest.price > 0,
          'precio > 0 en el primer flight');
        assert(cheapest.bookingUrl && cheapest.bookingUrl.startsWith('http'),
          'bookingUrl es URL válida');
      } else {
        console.log('  ℹ️ Scraper retornó 0 flights (Cloudflare bloqueó o Chrome no se pudo lanzar)');
      }
    } catch (err) {
      console.log(`  ⚠️ provider.search() lanzó ${err.message} — el contrato es no-throw`);
      fail += 1;
      failures.push(`provider.search lanzó: ${err.message}`);
    }
  }

  finish();
}

function finish() {
  console.log('\n' + '═'.repeat(60));
  console.log(` Resultado: ${pass} ok, ${fail} fail`);
  console.log('═'.repeat(60));
  if (fail > 0) {
    console.log('\nFallos:');
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
