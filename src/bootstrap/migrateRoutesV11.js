/**
 * migrateRoutesV11 — configuración pedida por Emilio el 2026-08-03.
 *
 * QUÉ PIDIÓ, TEXTUAL:
 *   "necesito vuelos desde europa a argentina, en ese umbral de ida abajo de
 *    los 480, desde cualquier punto, de italia de roma, venecia, y milan, en
 *    españa madrid y barcelona, y el resto te lo dejo para ti a tu criterio.
 *    Y roadtrip ida y vuelta tiene que ser igual pero abajo de 800 el total"
 *   "reconfigura las rutas para no tener tantas y hacer un buen trabajo"
 *
 * ESTA MIGRACIÓN REEMPLAZA la configuración Europa↔Argentina anterior (V9/V10).
 * Es la única que borra rutas, y lo hace porque Emilio pidió explícitamente
 * reconfigurar; el resto del sistema las trata como intocables
 * (ver .agents/AGENTS.md).
 *
 * DE 640 RUTAS A 108
 *
 * El problema no era la cantidad de aeropuertos sino el modelo: hacía falta
 * una ruta por combinación de fechas, o sea 8 idas x 8 vueltas = 64 rutas por
 * par de aeropuertos. Con la "Tabla de fechas" de Google esas 64 se leen en 4
 * cargas de página (services/gridScan), así que ahora hay UNA ruta por par que
 * cubre toda la ventana y alerta con la combinación concreta más barata.
 *
 *   ida y vuelta:  6 EU x 2 AR = 12 rutas ventana (antes 768)
 *   solo ida:      6 EU x 2 AR x 8 fechas = 96 rutas (Google no da grilla
 *                  para solo ida: necesita fecha de vuelta)
 *
 * AEROPUERTOS
 *
 * Italia FCO/VCE/MXP y España MAD/BCN los pidió Emilio. LIS lo agrego por
 * criterio propio: medido el 2026-08-03 con la grilla, ida y vuelta a EZE,
 *
 *   LIS  €929   ← el más barato de todos
 *   MAD  €967
 *   MXP €1049
 *   FCO €1107
 *   BCN €1223
 *   VCE €1350   (de los logs de producción)
 *
 * Lisboa es la puerta barata a Sudamérica (hub de TAP) y estaba afuera. OPO
 * queda afuera a propósito: no lo medí y el pedido fue tener MENOS rutas.
 *
 * @module bootstrap/migrateRoutesV11
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV11');

const TARGET_VERSION = 12;

/** Aeropuertos europeos. Los 5 primeros los pidió Emilio; LIS es criterio propio. */
const EU_AIRPORTS = ['FCO', 'VCE', 'MXP', 'MAD', 'BCN', 'LIS'];

/** Destinos en Argentina. EZE es la puerta de largo radio; COR a veces sale más barato. */
const AR_AIRPORTS = ['EZE', 'COR'];

/** Umbrales pedidos el 2026-08-03. La ida sube de €400 a €480. */
const OW_THRESHOLD = 480;
const RT_THRESHOLD = 800;

/** Ventana de ida: 15 al 22 de septiembre de 2026. */
const OUTBOUND_FROM = '2026-09-15';
const OUTBOUND_TO = '2026-09-22';

/** Ventana de vuelta: 3 al 10 de noviembre de 2026. */
const RETURN_FROM = '2026-11-03';
const RETURN_TO = '2026-11-10';

/** Fechas ISO entre dos extremos, inclusive. */
function datesBetween(fromIso, toIso) {
  const out = [];
  const cur = new Date(`${fromIso}T00:00:00.000Z`);
  const end = new Date(`${toIso}T00:00:00.000Z`);
  while (cur <= end) {
    out.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

const OUTBOUND_DATES = datesBetween(OUTBOUND_FROM, OUTBOUND_TO);

/**
 * Borra la configuración Europa↔Argentina anterior.
 *
 * Acotado a los pares de aeropuertos que maneja esta migración: si Emilio creó
 * una alerta a mano para otro destino desde el bot, no se toca.
 *
 * @param {any} user
 * @returns {Promise<number>}
 */
async function purgePreviousConfig(user) {
  const managed = [...EU_AIRPORTS, ...AR_AIRPORTS,
    // Aeropuertos que usaban V9/V10 y ya no están en la lista.
    'OPO'];

  const result = await Route.deleteMany({
    telegramUserId: user.telegramUserId,
    origin: { $in: managed },
    destination: { $in: managed },
  });
  return result.deletedCount || 0;
}

/**
 * Rutas nuevas para un usuario.
 * @param {any} user
 * @returns {any[]} operaciones de bulkWrite
 */
function buildOps(user) {
  const ops = [];

  // 1. IDA Y VUELTA — una ruta ventana por par de aeropuertos.
  //    Cubre las 64 combinaciones de fechas; el barrido por grilla encuentra
  //    la más barata y esa es la que se alerta, con fechas concretas.
  for (const origin of EU_AIRPORTS) {
    for (const destination of AR_AIRPORTS) {
      ops.push({
        updateOne: {
          filter: {
            telegramUserId: user.telegramUserId,
            origin, destination, tripType: 'roundtrip',
            outboundDate: new Date(OUTBOUND_FROM),
          },
          update: {
            $set: {
              user: user._id,
              telegramChatId: user.telegramChatId,
              name: `${origin}↔${destination} ida y vuelta ≤€${RT_THRESHOLD}`,
              tripType: 'roundtrip',
              outboundDate: new Date(OUTBOUND_FROM),
              outboundDateEnd: new Date(OUTBOUND_TO),
              returnDate: new Date(RETURN_FROM),
              returnDateEnd: new Date(RETURN_TO),
              currency: 'EUR',
              priceThreshold: RT_THRESHOLD,
              paused: false,
            },
          },
          upsert: true,
        },
      });
    }
  }

  // 2. SOLO IDA Europa → Argentina, una ruta por fecha.
  //    Sin ventana porque la "Tabla de fechas" de Google exige fecha de vuelta:
  //    para solo ida no hay grilla que leer.
  for (const origin of EU_AIRPORTS) {
    for (const destination of AR_AIRPORTS) {
      for (const date of OUTBOUND_DATES) {
        ops.push({
          updateOne: {
            filter: {
              telegramUserId: user.telegramUserId,
              origin, destination, tripType: 'oneway',
              outboundDate: new Date(date),
            },
            update: {
              $set: {
                user: user._id,
                telegramChatId: user.telegramChatId,
                name: `${origin}→${destination} solo ida ≤€${OW_THRESHOLD}`,
                tripType: 'oneway',
                outboundDate: new Date(date),
                outboundDateEnd: null,
                returnDate: null,
                returnDateEnd: null,
                currency: 'EUR',
                priceThreshold: OW_THRESHOLD,
                paused: false,
              },
            },
            upsert: true,
          },
        });
      }
    }
  }

  return ops;
}

async function migrateOneUser(user) {
  const deleted = await purgePreviousConfig(user);
  const ops = buildOps(user);

  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const result = await Route.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    upserted += result.upsertedCount || 0;
  }

  logger.info('V11 configuración aplicada', {
    userId: user.telegramUserId,
    borradas: deleted,
    creadas: upserted,
    total: ops.length,
  });
  return { deleted, upserted };
}

async function runMigration() {
  const users = await User.find({ routesMigrationVersion: { $lt: TARGET_VERSION } }).lean();
  if (users.length === 0) {
    logger.info('Todos los usuarios ya están en V11, skip');
    return { migrated: 0 };
  }

  let migrated = 0;
  for (const u of users) {
    try {
      await migrateOneUser(u);
      await User.updateOne({ _id: u._id }, { routesMigrationVersion: TARGET_VERSION });
      migrated += 1;
    } catch (err) {
      logger.error('migrateV11 failed for user', err);
    }
  }
  logger.info('migrateV11 completed', { migrated });
  return { migrated };
}

module.exports = {
  runMigration,
  buildOps,
  datesBetween,
  EU_AIRPORTS,
  AR_AIRPORTS,
  OW_THRESHOLD,
  RT_THRESHOLD,
};
