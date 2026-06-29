/**
 * purge-old-notifications.js — borra del historial las notificaciones con sentAt < cutoff.
 * Uso: node scripts/purge-old-notifications.js [YYYY-MM-DD]   (default: hoy, borra "del día para atrás")
 *
 * @module scripts/purge-old-notifications
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('../src/database/models/Notification');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Falta MONGODB_URI'); process.exit(1);
  }
  // cutoff = inicio del día siguiente a la fecha dada (incluye ese día). Default: incluye hoy.
  const arg = process.argv[2];
  const base = arg ? new Date(arg + 'T00:00:00Z') : new Date();
  const cutoff = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1, 0, 0, 0));

  await mongoose.connect(uri);
  const filter = { sentAt: { $lt: cutoff } };
  const n = await Notification.countDocuments(filter);
  console.log(`Notificaciones con sentAt < ${cutoff.toISOString()}: ${n}`);
  const res = await Notification.deleteMany(filter);
  console.log(`Borradas: ${res.deletedCount}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
