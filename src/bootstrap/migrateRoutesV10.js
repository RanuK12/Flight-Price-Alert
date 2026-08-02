/**
 * migrateRoutesV10 — amplía la búsqueda Europa ↔ Argentina con los aeropuertos
 * y el patrón de compra que salen más baratos.
 *
 * ADITIVA: no borra ni modifica ninguna ruta existente. Las alertas que ya
 * configuró Emilio (V9: VCE/FCO/MAD/BCN ↔ EZE/COR) quedan intactas.
 *
 * Qué agrega y por qué, medido con la "Tabla de fechas" de Google el 2026-08-03
 * para la ventana 18 sep / 6 nov, ida y vuelta:
 *
 *   LIS → EZE   €929   ← el más barato
 *   MAD → EZE   €967
 *   MXP → EZE  €1049
 *   FCO → EZE  €1107
 *   BCN → EZE  €1223
 *
 * 1. LISBOA y OPORTO. LIS salió €294 por debajo de BCN, que ya estaba en la
 *    lista. Portugal es la puerta barata a Sudamérica (TAP) y no estaba.
 *
 * 2. LARGO RADIO SEPARADO DEL DOMÉSTICO. Córdoba no tiene vuelos directos a
 *    Europa: todo FCO→COR es en realidad FCO→EZE más un salto interno, vendido
 *    como un billete y con recargo. Los logs del 02-08 lo muestran: FCO→COR
 *    entre €928 y €1879, pero la pierna FCO→COR suelta apareció a €581.
 *    Se agregan las rutas EU→EZE (el tramo caro, donde se gana o se pierde) y
 *    el doméstico EZE→COR por separado.
 *
 *    ATENCIÓN al comprar así: son dos billetes distintos. Si el largo radio se
 *    atrasa, nadie cubre el doméstico. Dejar 4+ horas de margen.
 *
 * MIL (código de ciudad de Milán) NO se usa: probado contra Google, cae en la
 * página genérica de la ciudad y no devuelve resultados. Se usa MXP.
 *
 * @module bootstrap/migrateRoutesV10
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV10');

const TARGET_VERSION = 11;

/** Aeropuertos EU nuevos (los de V9 ya existen y no se tocan). */
const NEW_EU_AIRPORTS = ['LIS', 'OPO'];

/** Todos los EU para las rutas de largo radio contra EZE. */
const ALL_EU_AIRPORTS = ['VCE', 'FCO', 'MXP', 'MAD', 'BCN', 'LIS', 'OPO'];

const OW_THRESHOLD = 400;   // EUR por tramo
const RT_THRESHOLD = 800;   // EUR ida y vuelta
const DOMESTIC_THRESHOLD = 90; // EUR el salto EZE-COR

const OUTBOUND_DATES = [
  '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
  '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
];

const RETURN_DATES = [
  '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10',
];

/**
 * Arma un upsert de ruta. La clave de unicidad es la misma que usa V9, así que
 * si la ruta ya existe no se duplica ni se pisa su configuración.
 */
function upsertOp(user, { origin, destination, outboundDate, returnDate, tripType, threshold, name }) {
  return {
    updateOne: {
      filter: {
        telegramUserId: user.telegramUserId,
        origin,
        destination,
        outboundDate: new Date(outboundDate),
        ...(tripType === 'roundtrip'
          ? { returnDate: new Date(returnDate), tripType: 'roundtrip' }
          : { tripType: 'oneway' }),
      },
      update: {
        $set: {
          user: user._id,
          telegramChatId: user.telegramChatId,
          name,
          returnDate: returnDate ? new Date(returnDate) : null,
          tripType,
          currency: 'EUR',
          priceThreshold: threshold,
          paused: false,
        },
      },
      upsert: true,
    },
  };
}

/**
 * Construye las rutas nuevas para un usuario.
 * @param {any} user
 * @returns {any[]} operaciones de bulkWrite
 */
function buildOps(user) {
  const ops = [];

  // 1. Ida y vuelta EU ↔ EZE para TODOS los aeropuertos EU. EZE es la única
  //    puerta de largo radio de Argentina; es acá donde está el precio real.
  for (const eu of ALL_EU_AIRPORTS) {
    for (const out of OUTBOUND_DATES) {
      for (const ret of RETURN_DATES) {
        ops.push(upsertOp(user, {
          origin: eu, destination: 'EZE',
          outboundDate: out, returnDate: ret,
          tripType: 'roundtrip', threshold: RT_THRESHOLD,
          name: `${eu}↔EZE RT ≤€${RT_THRESHOLD} (${out} / ${ret})`,
        }));
      }
    }
  }

  // 2. Solo ida en los aeropuertos EU nuevos, en las dos direcciones.
  for (const eu of NEW_EU_AIRPORTS) {
    for (const ar of ['EZE', 'COR']) {
      for (const date of OUTBOUND_DATES) {
        ops.push(upsertOp(user, {
          origin: eu, destination: ar, outboundDate: date,
          tripType: 'oneway', threshold: OW_THRESHOLD,
          name: `${eu}→${ar} IDA OW ≤€${OW_THRESHOLD} (15-22 sep 2026)`,
        }));
      }
      for (const date of RETURN_DATES) {
        ops.push(upsertOp(user, {
          origin: ar, destination: eu, outboundDate: date,
          tripType: 'oneway', threshold: OW_THRESHOLD,
          name: `${ar}→${eu} VUELTA OW ≤€${OW_THRESHOLD} (3-10 nov 2026)`,
        }));
      }
    }
  }

  // 3. El salto doméstico EZE↔COR por separado, para poder comparar
  //    "largo radio + doméstico" contra el billete único hasta Córdoba.
  for (const date of OUTBOUND_DATES) {
    ops.push(upsertOp(user, {
      origin: 'EZE', destination: 'COR', outboundDate: date,
      tripType: 'oneway', threshold: DOMESTIC_THRESHOLD,
      name: `EZE→COR doméstico ≤€${DOMESTIC_THRESHOLD} (conexión, 4h+ de margen)`,
    }));
  }
  for (const date of RETURN_DATES) {
    ops.push(upsertOp(user, {
      origin: 'COR', destination: 'EZE', outboundDate: date,
      tripType: 'oneway', threshold: DOMESTIC_THRESHOLD,
      name: `COR→EZE doméstico ≤€${DOMESTIC_THRESHOLD} (conexión, 4h+ de margen)`,
    }));
  }

  return ops;
}

async function migrateOneUser(user) {
  const ops = buildOps(user);
  const CHUNK = 500;
  let upserted = 0;

  for (let i = 0; i < ops.length; i += CHUNK) {
    const result = await Route.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    upserted += result.upsertedCount || 0;
  }

  logger.info('V10 rutas agregadas', {
    userId: user.telegramUserId, propuestas: ops.length, nuevas: upserted,
  });
  return upserted;
}

async function runMigration() {
  const users = await User.find({ routesMigrationVersion: { $lt: TARGET_VERSION } }).lean();
  if (users.length === 0) {
    logger.info('Todos los usuarios ya están en V10, skip');
    return { migrated: 0 };
  }

  let migrated = 0;
  for (const u of users) {
    try {
      await migrateOneUser(u);
      await User.updateOne({ _id: u._id }, { routesMigrationVersion: TARGET_VERSION });
      migrated += 1;
    } catch (err) {
      logger.error('migrateV10 failed for user', err);
    }
  }
  logger.info('migrateV10 completed', { migrated });
  return { migrated };
}

module.exports = { runMigration, buildOps, ALL_EU_AIRPORTS, NEW_EU_AIRPORTS };
