/**
 * cleanup-past-routes.js
 *
 * Elimina de MongoDB todas las rutas cuyo outboundDate ya pasó.
 * Ejecutar con: node scripts/cleanup-past-routes.js
 *
 * Seguro de correr múltiples veces (idempotente).
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no configurado');
  process.exit(1);
}

const Route = require('../src/database/models/Route');

async function cleanup() {
  console.log('🔗 Conectando a MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Conectado\n');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Contar rutas totales
  const total = await Route.countDocuments();
  console.log(`📊 Rutas totales en DB: ${total}`);

  // Rutas con outboundDate en el pasado
  const pastRoutes = await Route.find({
    outboundDate: { $ne: null, $lt: today },
  }).lean();

  console.log(`📅 Rutas con fecha pasada (${pastRoutes.length}):`);
  for (const r of pastRoutes) {
    const dateStr = r.outboundDate?.toISOString?.().split('T')[0] || '?';
    console.log(`   ❌ ${r.origin}→${r.destination} ${dateStr} (${r.name || 'sin nombre'})`);
  }

  // Eliminar
  if (pastRoutes.length > 0) {
    const result = await Route.deleteMany({
      outboundDate: { $ne: null, $lt: today },
    });
    console.log(`\n🧹 Eliminadas: ${result.deletedCount} rutas vencidas`);
  } else {
    console.log('\n✅ No hay rutas vencidas que limpiar');
  }

  // Contar rutas restantes
  const remaining = await Route.countDocuments();
  const active = await Route.countDocuments({ paused: false });
  console.log(`\n📊 Estado final: ${remaining} rutas totales (${active} activas)`);

  // Pausar rutas cuyo outboundDate es hoy (ya no sirve buscar para hoy)
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  const todayRoutes = await Route.updateMany(
    { outboundDate: { $gte: today, $lte: todayEnd }, paused: false },
    { paused: true }
  );
  if (todayRoutes.modifiedCount > 0) {
    console.log(`⏸️ Pausadas ${todayRoutes.modifiedCount} rutas de hoy (ya no se pueden buscar)`);
  }

  // Eliminar rutas duplicadas (mismo usuario + misma ruta + misma fecha)
  const duplicates = await Route.aggregate([
    {
      $group: {
        _id: {
          userId: '$telegramUserId',
          origin: '$origin',
          dest: '$destination',
          date: '$outboundDate',
        },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let dedupCount = 0;
  for (const dup of duplicates) {
    // Keep first, delete rest
    const toDelete = dup.ids.slice(1);
    await Route.deleteMany({ _id: { $in: toDelete } });
    dedupCount += toDelete.length;
  }
  if (dedupCount > 0) {
    console.log(`🔄 Eliminadas ${dedupCount} rutas duplicadas`);
  }

  const finalCount = await Route.countDocuments();
  const finalActive = await Route.countDocuments({ paused: false });
  console.log(`\n✅ Limpieza completada: ${finalCount} rutas finales (${finalActive} activas)`);

  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
