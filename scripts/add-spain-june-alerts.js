#!/usr/bin/env node
/**
 * Crea alertas one-way Argentina → España (MAD, BCN),
 * fechas 7-10 jun 2026, threshold € 550. Idempotente: usa el upsert de
 * routesRepo.createRoute, por lo que correrlo N veces no duplica.
 *
 * Orígenes: EZE (Buenos Aires-Ezeiza) y COR (Córdoba).
 * Destinos: MAD (Madrid-Barajas) y BCN (Barcelona-El Prat).
 *
 * El `priceThreshold` de cada ruta se usa en el alertEngine como
 * override del level: si el scraper encuentra un vuelo ≤ €550, la ruta
 * se promueve a level='great' y se dispara la alerta aun si el par
 * origen-destino no está tabulado en priceThresholds.js con ese piso.
 *
 * Uso:
 *   node scripts/add-spain-june-alerts.js
 *
 * Flags:
 *   --dry-run          No escribe. Solo imprime el plan.
 *   --user <id>        Override del telegramUserId (default: TELEGRAM_CHAT_ID[0]).
 *   --threshold <eur>  Override del threshold (default: 550).
 *   --dates <list>     CSV YYYY-MM-DD (default: 2026-06-07,2026-06-08,2026-06-09,2026-06-10).
 *   --origins <list>   CSV IATA (default: EZE,COR).
 *   --dests <list>     CSV IATA (default: MAD,BCN).
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { config } = require('../src/config');
const routesRepo = require('../src/database/repositories/routesRepo');
const userPrefsRepo = require('../src/database/repositories/userPrefsRepo');

function flag(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1];
}

const DRY_RUN = process.argv.includes('--dry-run');
const USER_OVERRIDE = flag('--user', null);
const THRESHOLD = Number(flag('--threshold', 550));
const DATES = flag(
  '--dates',
  '2026-06-07,2026-06-08,2026-06-09,2026-06-10',
).split(',').map((s) => s.trim()).filter(Boolean);
const ORIGINS = flag('--origins', 'EZE,COR')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const DESTS = flag(
  '--dests',
  'MAD,BCN',
).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI no está configurado.');
    process.exit(1);
  }

  const userId = USER_OVERRIDE
    ? Number(USER_OVERRIDE)
    : Number(config.telegram.chatIds[0]);

  if (!Number.isFinite(userId)) {
    console.error('❌ telegramUserId inválido. Pasá --user <id> o configurá TELEGRAM_CHAT_ID.');
    process.exit(1);
  }

  console.log('━'.repeat(60));
  console.log(' Nueva alerta: Argentina → España, jun 7-10, ≤ €' + THRESHOLD);
  console.log('━'.repeat(60));
  console.log(` Usuario:  ${userId}`);
  console.log(` Fechas:   ${DATES.join(', ')}`);
  console.log(` Orígenes: ${ORIGINS.join(', ')}`);
  console.log(` Destinos: ${DESTS.join(', ')}`);
  console.log(` Total:    ${ORIGINS.length * DESTS.length * DATES.length} rutas`);
  console.log('━'.repeat(60));

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — no se aplican cambios.\n');
    for (const origin of ORIGINS) {
      for (const dest of DESTS) {
        for (const date of DATES) {
          console.log(`   ${origin} → ${dest}  ${date}  ≤ €${THRESHOLD}`);
        }
      }
    }
    return;
  }

  console.log('\n🔌 Conectando a MongoDB...');
  await mongoose.connect(uri);

  // Asegurar que el user existe con defaults razonables.
  await userPrefsRepo.getOrCreate(userId, userId);

  let created = 0;
  let errors = 0;
  for (const origin of ORIGINS) {
    for (const dest of DESTS) {
      for (const date of DATES) {
        try {
          await routesRepo.createRoute({
            telegramUserId: userId,
            telegramChatId: userId,
            name: `${origin} → ${dest} (${date}) ≤ €${THRESHOLD}`,
            origin,
            destination: dest,
            outboundDate: date,
            returnDate: null,
            tripType: 'oneway',
            currency: 'EUR',
            priceThreshold: THRESHOLD,
          });
          created += 1;
        } catch (err) {
          errors += 1;
          console.warn(`   ⚠️  ${origin}→${dest} ${date} falló:`, err.message);
        }
      }
    }
  }

  console.log(`\n✅ Upsert completo: ${created} rutas procesadas, ${errors} errores.`);
  console.log('   (el upsert es idempotente: si ya existían, se actualizó el threshold.)');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
