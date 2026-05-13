#!/usr/bin/env node
/**
 * cleanup-poisoned-notifs.js — purga del historico de notifs los precios
 * envenenados por bugs previos del parser de Google Flights.
 *
 * Heuristica de envenenamiento (capas, en orden):
 *   1. Hard floor absoluto: long-haul OW < $250, RT < $350, dom AR < $25.
 *      Bloqueado fisicamente. Ejemplo: EZE→MAD a US$155 (era duracion).
 *   2. Threshold floor: si la ruta esta en priceThresholds.js, marca
 *      como envenenada todo precio EUR < 60% del piso "steal".
 *
 * Uso:
 *   node scripts/cleanup-poisoned-notifs.js           # dry-run (default)
 *   node scripts/cleanup-poisoned-notifs.js --apply   # ejecuta el delete
 *
 * Idempotente: ejecutarlo dos veces es seguro.
 *
 * Backup recomendado antes de --apply:
 *   mongodump --uri="$MONGODB_URI" --collection=notifications
 */

'use strict';

require('dotenv').config();

const path = require('path');
const mongoose = require('mongoose');

const Notification = require('../src/database/models/Notification');
const { getThreshold } = require('../src/config/priceThresholds');
const { toEur } = require('../src/utils/currency');
const { check: sanityCheck } = require('../src/services/sanityCheck');

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Falta MONGODB_URI en el entorno (.env)');
    process.exit(1);
  }

  console.log('🔌 Conectando a Mongo…');
  await mongoose.connect(uri);
  console.log('✓ conectado\n');

  const all = await Notification.find({}).lean();
  console.log(`📋 Total de notifs en DB: ${all.length}`);
  console.log(`   Modo: ${APPLY ? '🔥 APPLY (borra)' : '👀 DRY-RUN (solo reporta)'}\n`);

  let toDelete = 0;
  let toQuarantine = 0;
  let kept = 0;
  const samples = [];

  for (const n of all) {
    const flight = {
      origin: n.origin,
      destination: n.destination,
      price: n.price,
      currency: n.currency || 'EUR',
      tripType: n.returnDate ? 'roundtrip' : 'oneway',
    };

    // skipHistorical=true: si lo dejamos en false, el p25 calculado con la
    // misma DB envenenada nos diria que todo es OK. Solo capas 1 y 2.
    const verdict = await sanityCheck(flight, { skipHistorical: true });

    if (verdict.ok) {
      kept++;
      continue;
    }

    if (verdict.severity === 'block') {
      toDelete++;
      if (samples.length < 15) samples.push({ verdict: 'BLOCK', n, reason: verdict.reason });
      if (APPLY) await Notification.deleteOne({ _id: n._id });
    } else if (verdict.severity === 'quarantine') {
      toQuarantine++;
      if (samples.length < 15) samples.push({ verdict: 'QUARANTINE', n, reason: verdict.reason });
      if (APPLY) {
        await Notification.updateOne(
          { _id: n._id },
          { $set: { verificationRequired: true } },
        );
      }
    }
  }

  console.log('━'.repeat(72));
  console.log('Muestras (max 15):');
  for (const s of samples) {
    const dep = s.n.departureDate ? new Date(s.n.departureDate).toISOString().slice(0, 10) : '—';
    const ret = s.n.returnDate ? new Date(s.n.returnDate).toISOString().slice(0, 10) : 'OW';
    console.log(`  [${s.verdict.padEnd(10)}] ${s.n.origin}→${s.n.destination} ${dep}/${ret} ` +
      `${s.n.price}${s.n.currency || 'EUR'} — ${s.reason}`);
  }

  console.log('━'.repeat(72));
  console.log(`Resumen:`);
  console.log(`  ✓ Conservadas:                 ${kept}`);
  console.log(`  ⚠️  A cuarentenar (verifReq=true): ${toQuarantine}${APPLY ? ' — APLICADO' : ''}`);
  console.log(`  🗑  A borrar (precio imposible):  ${toDelete}${APPLY ? ' — APLICADO' : ''}`);
  console.log();

  if (!APPLY && (toDelete + toQuarantine) > 0) {
    console.log('⚠️  Esto fue un dry-run. Para ejecutar:');
    console.log('   node scripts/cleanup-poisoned-notifs.js --apply');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
