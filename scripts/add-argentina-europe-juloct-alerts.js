#!/usr/bin/env node
/**
 * Crea alertas ROUNDTRIP Argentina → Europa, salidas julio-octubre 2026,
 * estadía ~15 días, threshold € 850. Idempotente: usa el upsert de
 * routesRepo.createRoute, por lo que correrlo N veces no duplica.
 *
 * Pedido del usuario: "Otra alerta ida y vuelta de Argentina a Europa,
 *   abajo de 850 euros la alerta, para julio/agosto/septiembre/octubre,
 *   más o menos 15 días."
 *
 * Cobertura por defecto:
 *   • Orígenes AR (los que tienen vuelos directos o conexión razonable
 *     a Europa con Aerolíneas, Air Europa, Iberia, LATAM, ITA):
 *       EZE Buenos Aires-Ezeiza, COR Córdoba.
 *   • Destinos europeos:
 *       MAD Madrid, BCN Barcelona, FCO Roma, MXP Milán,
 *       CDG París, AMS Ámsterdam, LIS Lisboa.
 *   • Fechas de salida: día 1 y 15 de cada mes jul-oct → 8 fechas
 *     (2026-07-01, 07-15, 08-01, 08-15, 09-01, 09-15, 10-01, 10-15).
 *   • Fecha de vuelta: 15 días después de la salida (configurable
 *     con --return-offset).
 *
 * Total default: 2 × 7 × 8 = 112 rutas roundtrip.
 *
 * Uso:
 *   node scripts/add-argentina-europe-juloct-alerts.js
 *
 * Flags:
 *   --dry-run             No escribe. Solo imprime el plan.
 *   --user <id>           Override del telegramUserId.
 *   --threshold <eur>     Override del threshold (default: 850).
 *   --return-offset <n>   Días de estadía (default: 15).
 *   --dates <list>        CSV YYYY-MM-DD (override de fechas de salida).
 *   --origins <list>      CSV IATA orígenes AR (default: EZE,COR).
 *   --dests <list>        CSV IATA destinos europeos (default ver arriba).
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
const THRESHOLD = Number(flag('--threshold', 850));
const RETURN_OFFSET_DAYS = Number(flag('--return-offset', 15));
const DEFAULT_DATES = [
  '2026-07-01', '2026-07-15',
  '2026-08-01', '2026-08-15',
  '2026-09-01', '2026-09-15',
  '2026-10-01', '2026-10-15',
];
const DATES = flag('--dates', DEFAULT_DATES.join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);
const ORIGINS = flag('--origins', 'EZE,COR')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const DESTS = flag('--dests', 'MAD,BCN,FCO,MXP,CDG,AMS,LIS')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

/**
 * Suma N días a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD.
 */
function addDaysISO(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

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
  console.log(` Nueva alerta: Argentina ↔ Europa, jul-oct 2026, ≤ €${THRESHOLD}`);
  console.log(` (ida y vuelta, estadía ${RETURN_OFFSET_DAYS} días)`);
  console.log('━'.repeat(60));
  console.log(` Usuario:    ${userId}`);
  console.log(` Salidas:    ${DATES.join(', ')}`);
  console.log(` Orígenes:   ${ORIGINS.join(', ')}`);
  console.log(` Destinos:   ${DESTS.join(', ')}`);
  console.log(` Total:      ${ORIGINS.length * DESTS.length * DATES.length} rutas`);
  console.log('━'.repeat(60));

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — no se aplican cambios.\n');
    for (const origin of ORIGINS) {
      for (const dest of DESTS) {
        for (const date of DATES) {
          const ret = addDaysISO(date, RETURN_OFFSET_DAYS);
          console.log(`   ${origin} → ${dest}  ${date} → ${ret}  ≤ €${THRESHOLD}`);
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
        const returnDate = addDaysISO(date, RETURN_OFFSET_DAYS);
        try {
          await routesRepo.createRoute({
            telegramUserId: userId,
            telegramChatId: userId,
            name: `${origin} ↔ ${dest} (${date} → ${returnDate}) ≤ €${THRESHOLD}`,
            origin,
            destination: dest,
            outboundDate: date,
            returnDate,
            tripType: 'roundtrip',
            currency: 'EUR',
            priceThreshold: THRESHOLD,
          });
          created += 1;
        } catch (err) {
          errors += 1;
          console.warn(`   ⚠️  ${origin}↔${dest} ${date} falló:`, err.message);
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
