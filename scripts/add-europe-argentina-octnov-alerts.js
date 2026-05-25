#!/usr/bin/env node
/**
 * Crea alertas one-way Europa → Argentina, octubre y noviembre 2026,
 * threshold € 350. Idempotente: usa el upsert de routesRepo.createRoute,
 * por lo que correrlo N veces no duplica.
 *
 * Pedido del usuario: "Alertas de Europa a Argentina para octubre/noviembre,
 *   solo ida, abajo de 350 euros."
 *
 * Cobertura por defecto:
 *   • Orígenes europeos (hubs principales con vuelos directos a AR):
 *       MAD Madrid, BCN Barcelona, FCO Roma, MXP Milán,
 *       CDG París, LHR Londres, FRA Frankfurt, AMS Ámsterdam, LIS Lisboa.
 *   • Destinos AR:
 *       EZE Buenos Aires-Ezeiza, AEP Buenos Aires-Aeroparque (vuelos
 *       internacionales de cabotaje regional), COR Córdoba.
 *   • Fechas de salida: cada 10 días dentro de oct-nov para tener
 *     buena cobertura sin sobrecargar el cron de monitoreo:
 *       2026-10-01, 2026-10-11, 2026-10-21, 2026-10-31,
 *       2026-11-10, 2026-11-20, 2026-11-30.
 *
 * Eso son 9×3×7 = 189 rutas (193 con AEP filtradas). Sólo se crean para
 * el usuario configurado en TELEGRAM_CHAT_ID o el que pase por --user.
 *
 * Uso:
 *   node scripts/add-europe-argentina-octnov-alerts.js
 *
 * Flags:
 *   --dry-run          No escribe. Solo imprime el plan.
 *   --user <id>        Override del telegramUserId (default: TELEGRAM_CHAT_ID[0]).
 *   --threshold <eur>  Override del threshold (default: 350).
 *   --dates <list>     CSV YYYY-MM-DD (override de las fechas default).
 *   --origins <list>   CSV IATA orígenes europeos (default: ver arriba).
 *   --dests <list>     CSV IATA destinos AR (default: EZE,AEP,COR).
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
const THRESHOLD = Number(flag('--threshold', 350));
const DEFAULT_DATES = [
  '2026-10-01', '2026-10-11', '2026-10-21', '2026-10-31',
  '2026-11-10', '2026-11-20', '2026-11-30',
];
const DATES = flag('--dates', DEFAULT_DATES.join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);
const ORIGINS = flag(
  '--origins',
  'MAD,BCN,FCO,MXP,CDG,LHR,FRA,AMS,LIS',
).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const DESTS = flag('--dests', 'EZE,AEP,COR')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri && !DRY_RUN) {
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
  console.log(' Nueva alerta: Europa → Argentina, oct-nov 2026, ≤ €' + THRESHOLD);
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
  console.log('   (idempotente: si ya existían, se actualizó el threshold.)');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
