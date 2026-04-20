/**
 * Seed de rutas (alertas) para el usuario primario de Telegram.
 *
 * Carga en `saved_routes`:
 *   (A) COR↔MDQ — roundtrip 7 días, próximas 2 semanas, solo ofertones.
 *   (B) EZE/COR → MAD/BCN/FCO/MXP — one-way, jun-jul 2026, solo ofertones.
 *
 * El "usuario primario" se toma del primer `TELEGRAM_CHAT_ID` del .env.
 * En chats privados, chat_id === user_id (Telegram).
 *
 * Uso:
 *   node scripts/seed-routes.js
 *   node scripts/seed-routes.js --dry-run     # solo imprime, no escribe
 *   node scripts/seed-routes.js --user=123456 # override del user
 *
 * Es idempotente: usa ON CONFLICT para no duplicar.
 */

'use strict';

/* eslint-disable no-console */

const { config } = require('../src/config');
const { runMigrations } = require('../src/database/migrations');
const routesRepo = require('../src/database/repositories/routesRepo');
const { getThreshold } = require('../src/config/priceThresholds');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const userArg = args.find((a) => a.startsWith('--user='));
const userIdOverride = userArg ? Number(userArg.split('=')[1]) : null;

/** Formatea YYYY-MM-DD. */
function fmt(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Genera pares roundtrip ida→vuelta con N días de diferencia,
 * partiendo todos los días en el rango [start, end).
 *
 * @param {Date} start
 * @param {Date} end
 * @param {number} tripDays
 * @returns {Array<{outbound:string, ret:string}>}
 */
function roundtripPairs(start, end, tripDays) {
  const pairs = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const ret = new Date(cursor);
    ret.setDate(ret.getDate() + tripDays);
    pairs.push({ outbound: fmt(cursor), ret: fmt(ret) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return pairs;
}

/**
 * Genera una muestra de fechas dentro de un rango, priorizando
 * días martes/miércoles (más baratos empíricamente).
 *
 * @param {Date} start
 * @param {Date} end
 * @param {number} maxDates
 * @returns {string[]}
 */
function sampleDates(start, end, maxDates) {
  const preferredDow = new Set([2, 3]); // martes, miércoles
  const preferred = [];
  const others = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    (preferredDow.has(dow) ? preferred : others).push(fmt(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const out = [
    ...preferred.slice(0, Math.ceil(maxDates * 0.6)),
    ...others.slice(0, maxDates),
  ];
  return out.slice(0, maxDates).sort();
}

/** Devuelve el usuario primario (userId, chatId). */
function resolvePrimaryUser() {
  if (userIdOverride) {
    return { userId: userIdOverride, chatId: userIdOverride };
  }
  const first = config.telegram.chatIds[0];
  if (!first) {
    throw new Error('No TELEGRAM_CHAT_ID configured. Set it in .env or pass --user=ID.');
  }
  const id = Number(first);
  if (!Number.isFinite(id)) throw new Error(`Invalid chat id: ${first}`);
  return { userId: id, chatId: id };
}

async function main() {
  console.log('━'.repeat(60));
  console.log(' SEED — alertas personales');
  console.log('━'.repeat(60));

  await runMigrations();

  const { userId, chatId } = resolvePrimaryUser();
  console.log(`User target: user_id=${userId} chat_id=${chatId}`);
  if (DRY) console.log('(dry-run: no se escribirá nada en la DB)');

  // ══════════════════════════════════════════════════════════════
  // (A) COR ↔ MDQ roundtrip 7 días, próximas 2 semanas
  // ══════════════════════════════════════════════════════════════
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() + 1);          // mañana
  const rangeEnd = new Date(today);
  rangeEnd.setDate(rangeEnd.getDate() + 14);             // +14 días

  const corMdq = roundtripPairs(rangeStart, rangeEnd, 7);
  const mdqCor = [...corMdq]; // mismas fechas, ida desde MDQ
  const rtThreshold = getThreshold('COR', 'MDQ', 'roundtrip');

  console.log(`\n[A] COR↔MDQ roundtrip 7d — ${corMdq.length} fechas × 2 sentidos`);
  console.log(`    threshold (steal): EUR ${rtThreshold?.steal}`);

  const bucketA = [];
  for (const { outbound, ret } of corMdq) {
    bucketA.push({
      telegramUserId: userId, telegramChatId: chatId,
      name: `COR→MDQ (RT ${outbound} → ${ret})`,
      origin: 'COR', destination: 'MDQ',
      outboundDate: outbound, returnDate: ret,
      tripType: /** @type {'roundtrip'} */ ('roundtrip'),
      currency: 'EUR',
      priceThreshold: rtThreshold?.steal ?? null,
    });
  }
  for (const { outbound, ret } of mdqCor) {
    bucketA.push({
      telegramUserId: userId, telegramChatId: chatId,
      name: `MDQ→COR (RT ${outbound} → ${ret})`,
      origin: 'MDQ', destination: 'COR',
      outboundDate: outbound, returnDate: ret,
      tripType: /** @type {'roundtrip'} */ ('roundtrip'),
      currency: 'EUR',
      priceThreshold: rtThreshold?.steal ?? null,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // (B) EZE/COR → Europa one-way, jun-jul 2026
  // ══════════════════════════════════════════════════════════════
  const euroStart = new Date('2026-06-01');
  const euroEnd = new Date('2026-07-31');
  const euroDates = sampleDates(euroStart, euroEnd, 10);
  const origins = ['EZE', 'COR'];
  const destinations = ['MAD', 'BCN', 'FCO', 'MXP'];

  console.log(`\n[B] AR→Europa one-way jun-jul — ${origins.length}×${destinations.length} rutas × ${euroDates.length} fechas`);

  const bucketB = [];
  for (const origin of origins) {
    for (const destination of destinations) {
      const th = getThreshold(origin, destination, 'oneway');
      if (!th) {
        console.log(`    [warn] sin threshold: ${origin}-${destination}, skip`);
        continue;
      }
      for (const date of euroDates) {
        bucketB.push({
          telegramUserId: userId, telegramChatId: chatId,
          name: `${origin}→${destination} (${date}) [STEAL ≤ EUR ${th.steal}]`,
          origin, destination,
          outboundDate: date, returnDate: null,
          tripType: /** @type {'oneway'} */ ('oneway'),
          currency: 'EUR',
          priceThreshold: th.steal,
        });
      }
    }
  }

  const all = [...bucketA, ...bucketB];
  console.log(`\nTotal a insertar: ${all.length} rutas`);

  if (DRY) {
    for (const r of all.slice(0, 8)) {
      console.log(
        `  · ${r.origin}→${r.destination} ${r.outboundDate}` +
        `${r.returnDate ? ' / ' + r.returnDate : ''} ≤ EUR ${r.priceThreshold}`,
      );
    }
    if (all.length > 8) console.log(`  ...(+${all.length - 8} más)`);
    console.log('\n✅ dry-run completado');
    process.exit(0);
  }

  let created = 0;
  let errors = 0;
  for (const r of all) {
    try {
      await routesRepo.createRoute(r);
      created += 1;
    } catch (err) {
      errors += 1;
      console.error(`  [err] ${r.origin}-${r.destination} ${r.outboundDate}: ${err.message}`);
    }
  }
  console.log(`\n✅ ${created} rutas insertadas/actualizadas, ${errors} errores`);

  // Mostrar resumen post-seed
  const mine = await routesRepo.listByUser(userId);
  console.log(`\n📋 Total de rutas activas del usuario ${userId}: ${mine.length}`);
  const grouped = mine.reduce((acc, r) => {
    const k = `${r.origin}→${r.destination} (${r.trip_type})`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));
  for (const [k, n] of Object.entries(grouped)) {
    console.log(`   ${k}: ${n} fechas`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥', err);
  process.exit(1);
});
