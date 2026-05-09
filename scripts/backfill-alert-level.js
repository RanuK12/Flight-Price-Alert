#!/usr/bin/env node
/**
 * Backfill one-off: upgrade users stuck on alertMinLevel='steal' to 'good'.
 *
 * Context (may-2026): El default histórico era 'steal', que solo dispara
 * alertas con error-fares (precios ≤ steal threshold). Para un uso diario
 * del bot conviene 'good', que también incluye "buenos precios" (-15% del
 * promedio). Ver `src/config/priceThresholds.js`.
 *
 * Este script:
 *   1. Se conecta a MongoDB Atlas (usa MONGODB_URI del .env).
 *   2. Actualiza TODOS los usuarios cuyo alertMinLevel sigue en 'steal'
 *      al nuevo default 'good'. NO pisa a usuarios que manualmente
 *      cambiaron a 'great' o 'all'.
 *   3. Imprime un resumen.
 *
 * Uso:
 *   node scripts/backfill-alert-level.js
 *
 * Flags:
 *   --dry-run    Solo imprime qué haría, no modifica nada.
 *   --force <L>  Forzar todos los usuarios a un nivel concreto
 *                (ej. --force good, --force great).
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../src/database/models/User');

const DRY_RUN = process.argv.includes('--dry-run');
const forceIdx = process.argv.indexOf('--force');
const FORCE_LEVEL = forceIdx >= 0 ? process.argv[forceIdx + 1] : null;

const VALID_LEVELS = ['steal', 'great', 'good', 'all'];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI no está configurado.');
    process.exit(1);
  }

  if (FORCE_LEVEL && !VALID_LEVELS.includes(FORCE_LEVEL)) {
    console.error(`❌ Nivel inválido: ${FORCE_LEVEL}. Válidos: ${VALID_LEVELS.join(', ')}`);
    process.exit(1);
  }

  console.log('🔌 Conectando a MongoDB...');
  await mongoose.connect(uri);

  const filter = FORCE_LEVEL ? {} : { alertMinLevel: 'steal' };
  const targetLevel = FORCE_LEVEL || 'good';

  const affected = await User.find(filter, { telegramUserId: 1, alertMinLevel: 1 }).lean();
  console.log(`\n📊 Usuarios a actualizar: ${affected.length}`);
  for (const u of affected) {
    console.log(`   - user ${u.telegramUserId}: ${u.alertMinLevel} -> ${targetLevel}`);
  }

  if (affected.length === 0) {
    console.log('✅ Nada que hacer.');
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN: no se aplicaron cambios.');
    await mongoose.disconnect();
    return;
  }

  const result = await User.updateMany(filter, { alertMinLevel: targetLevel });
  console.log(`\n✅ Updated ${result.modifiedCount} usuarios a alertMinLevel='${targetLevel}'`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
