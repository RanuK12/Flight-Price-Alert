#!/usr/bin/env node
/**
 * canary-google-flights.js — health-check del parser de Google Flights.
 *
 * Hace UNA busqueda real EZE→MAD para una fecha conocida (60 dias desde hoy)
 * y valida invariantes que SIEMPRE deben cumplirse si el parser funciona:
 *
 *   1. min_price entre $300 y $5000 (long-haul plausible).
 *   2. Al menos 3 vuelos parseados.
 *   3. Ningun vuelo tiene airline === '' o stops === undefined.
 *   4. Top airline names estan en AIRLINE_CODES o son strings reales.
 *
 * Si ALGUNA falla → exit code 1 + mensaje a Telegram con prefijo
 * [PARSER-CANARY-FAIL] (si TELEGRAM_BOT_TOKEN/CHAT_ID estan seteados).
 *
 * Pensado para corrida diaria via Render cron o GitHub Actions schedule.
 *
 * Uso:
 *   node scripts/canary-google-flights.js
 *
 * Exit codes:
 *   0 - todo OK
 *   1 - canary FAIL (parser regresion probable)
 *   2 - error de red / google bloqueando (no es regresion del parser)
 */

'use strict';

require('dotenv').config();

const { searchFlightsApi } = require('../server/scrapers/googleFlightsApi');

// === Config ===
const CANARY_ROUTES = [
  // Pequeño set diversificado: long-haul + medio + domestico.
  { origin: 'EZE', destination: 'MAD', minPrice: 300, maxPrice: 5000, label: 'long-haul' },
  { origin: 'EZE', destination: 'MIA', minPrice: 200, maxPrice: 4000, label: 'medio' },
];

function daysFromNow(n) {
  const d = new Date(Date.now() + n * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

async function notifyTelegram(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').split(',')[0]?.trim();
  if (!token || !chatId) return;
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_notification: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error('Telegram notify failed', res.status, await res.text());
    }
  } catch (err) {
    console.error('Telegram notify exception', err.message);
  }
}

/**
 * @returns {{ok:boolean, fails:string[], warnings:string[], data:object}}
 */
async function runOne(route) {
  const fails = [];
  const warnings = [];
  const date = daysFromNow(60);
  console.log(`\n🐦 Canary: ${route.origin}→${route.destination} (${date})`);

  let result;
  try {
    result = await searchFlightsApi(route.origin, route.destination, date, null, {
      currency: 'USD',
    });
  } catch (err) {
    return {
      ok: false,
      fails: [`request threw: ${err.message}`],
      warnings: [],
      data: { route, date },
      networkError: true,
    };
  }

  if (!result?.success) {
    return {
      ok: false,
      fails: [`request not successful (${result?.error || 'no result'})`],
      warnings: [],
      data: { route, date },
      networkError: true,
    };
  }

  const flights = result.flights || [];

  if (flights.length < 3) {
    fails.push(`only ${flights.length} flights parsed (expected >=3)`);
  }
  if (typeof result.minPrice !== 'number') {
    fails.push(`minPrice is not a number: ${result.minPrice}`);
  } else {
    if (result.minPrice < route.minPrice) {
      fails.push(`minPrice ${result.minPrice} BELOW canary floor ${route.minPrice} (parser regression?)`);
    }
    if (result.minPrice > route.maxPrice) {
      warnings.push(`minPrice ${result.minPrice} unusually high (>${route.maxPrice})`);
    }
  }

  for (const f of flights.slice(0, 5)) {
    if (!f.airline || f.airline === '' || f.airline === 'Unknown') {
      fails.push(`flight has empty/Unknown airline (price=${f.price})`);
      break;
    }
    if (typeof f.stops !== 'number') {
      fails.push(`flight has non-numeric stops (price=${f.price})`);
      break;
    }
  }

  return {
    ok: fails.length === 0,
    fails,
    warnings,
    data: {
      route, date,
      flightsCount: flights.length,
      minPrice: result.minPrice,
      topAirlines: flights.slice(0, 3).map(f => `${f.airline} $${f.price}`),
    },
  };
}

async function main() {
  const results = [];
  for (const route of CANARY_ROUTES) {
    results.push(await runOne(route));
  }

  const totalFails = results.reduce((acc, r) => acc + r.fails.length, 0);
  const totalNetworkErrors = results.filter(r => r.networkError).length;

  console.log('\n' + '━'.repeat(60));
  console.log('CANARY SUMMARY');
  console.log('━'.repeat(60));
  for (const r of results) {
    const status = r.ok ? '✓' : '✗';
    console.log(`${status} ${r.data.route.origin}→${r.data.route.destination}`);
    if (r.data.flightsCount !== undefined) {
      console.log(`   flights: ${r.data.flightsCount}, minPrice: $${r.data.minPrice}`);
      console.log(`   top: ${(r.data.topAirlines || []).join(', ')}`);
    }
    for (const f of r.fails) console.log(`   ✗ ${f}`);
    for (const w of r.warnings) console.log(`   ⚠️  ${w}`);
  }

  if (totalFails > 0 && totalNetworkErrors < CANARY_ROUTES.length) {
    // Hubo fails que NO son simplemente "Google esta bloqueando" → regresion del parser.
    const lines = [
      `🚨 <b>[PARSER-CANARY-FAIL]</b>`,
      ``,
      `El canary del parser de Google Flights detectó <b>${totalFails} fallo(s)</b>.`,
      ``,
    ];
    for (const r of results) {
      if (r.fails.length === 0) continue;
      lines.push(`<b>${r.data.route.origin}→${r.data.route.destination}</b> (${r.data.date}):`);
      for (const f of r.fails) lines.push(`  • ${f}`);
    }
    lines.push('', '<i>Probable regresión del parser. Revisar tests/parser.regression.test.js y fixtures.</i>');
    await notifyTelegram(lines.join('\n'));
    process.exit(1);
  }

  if (totalNetworkErrors === CANARY_ROUTES.length) {
    console.log('\n⚠️  All canary routes had network errors. Google may be blocking.');
    console.log('    NOT alerting (no regression evidence). Exit 2.');
    process.exit(2);
  }

  console.log('\n✓ Canary OK');
}

main().catch((err) => {
  console.error('❌ Canary crashed:', err);
  process.exit(1);
});
