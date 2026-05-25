/**
 * cleanupPoisonedNotifs — auto-limpieza al boot de notifs con precios
 * físicamente imposibles, generadas por bugs históricos del parser de
 * Google Flights (caso clásico: "EZE→FCO US$155 directo" — el parser
 * confundía duración en minutos con precio).
 *
 * Idempotente: se puede correr en cada boot sin riesgo.
 *
 * Estrategia:
 *   • Sólo eliminamos las notifs que el sanityCheck declara `block`,
 *     es decir, precios bajo el HARD FLOOR absoluto (long-haul OW <
 *     250, RT < 350, doméstico < 25). Esos son precios físicamente
 *     imposibles, no pueden ser ofertas reales.
 *   • Las notifs en severidad `quarantine` (precios sospechosos pero
 *     posibles) se marcan con `verificationRequired: true` y NO se
 *     muestran en `/ofertas` ni en el daily report — pero quedan en
 *     la DB para auditoría.
 *   • Saltamos la capa histórica (`skipHistorical: true`) porque la
 *     base actual está envenenada y haría que la mediana sea inválida.
 *
 * Throttling:
 *   • Sólo corre si pasaron >= 24h desde la última corrida (registro
 *     en `bootstrap_state` collection). Evita gastar tiempo de boot
 *     en reinicios frecuentes (Render free reinicia muy seguido).
 *   • Se puede forzar con env var FORCE_CLEANUP_POISONED=true.
 *   • Se puede deshabilitar con SKIP_CLEANUP_POISONED=true.
 *
 * @module bootstrap/cleanupPoisonedNotifs
 */

'use strict';

const mongoose = require('mongoose');
const Notification = require('../database/models/Notification');
const sanity = require('../services/sanityCheck');
const logger = require('../utils/logger').child('cleanup-poisoned');

/** Cooldown entre corridas: 24h. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Modelo de control mínimo para persistir timestamp de la última
 * corrida sin agregar un schema separado.
 */
const stateSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  lastRunAt: { type: Date, required: true },
  meta: { type: Object, default: {} },
}, { collection: 'bootstrap_state' });

const BootstrapState = mongoose.models.BootstrapState
  || mongoose.model('BootstrapState', stateSchema);

/** Indica si el cleanup debe correr (cooldown de 24h). */
async function shouldRun() {
  if (process.env.FORCE_CLEANUP_POISONED === 'true') return true;
  if (process.env.SKIP_CLEANUP_POISONED === 'true') return false;
  const last = await BootstrapState.findOne({ key: 'cleanupPoisonedNotifs' }).lean();
  if (!last) return true;
  return (Date.now() - new Date(last.lastRunAt).getTime()) > COOLDOWN_MS;
}

/**
 * Marca el cleanup como ejecutado, con stats de la corrida.
 * @param {{deleted:number, quarantined:number, kept:number}} stats
 */
async function markRun(stats) {
  await BootstrapState.findOneAndUpdate(
    { key: 'cleanupPoisonedNotifs' },
    { lastRunAt: new Date(), meta: stats },
    { upsert: true },
  );
}

/**
 * Corre la limpieza. Si está en cooldown, retorna sin tocar nada.
 *
 * @returns {Promise<{ran:boolean, deleted:number, quarantined:number, kept:number}>}
 */
async function run() {
  if (!(await shouldRun())) {
    logger.debug('cleanupPoisonedNotifs en cooldown, skip');
    return { ran: false, deleted: 0, quarantined: 0, kept: 0 };
  }

  // Sólo iteramos notifs no marcadas previamente como verificationRequired
  // (las saltamos para evitar reprocesar sin sentido). Las que ya fueron
  // cuarentenadas siguen ocultas del UI sin necesidad de re-evaluarlas.
  const candidates = await Notification.find({
    $or: [
      { verificationRequired: { $exists: false } },
      { verificationRequired: { $ne: true } },
    ],
  }).lean();

  let deleted = 0;
  let quarantined = 0;
  let kept = 0;

  for (const n of candidates) {
    const flight = {
      origin: n.origin,
      destination: n.destination,
      price: n.price,
      currency: n.currency || 'EUR',
      tripType: n.returnDate ? 'roundtrip' : 'oneway',
    };

    let verdict;
    try {
      verdict = await sanity.check(flight, { skipHistorical: true });
    } catch (err) {
      // Si sanity falla, conservamos la notif (failing-open). No
      // queremos borrar datos legítimos por un bug del checker.
      logger.warn('sanityCheck fallo, conservo notif', {
        id: n._id, err: /** @type {Error} */ (err).message,
      });
      kept += 1;
      continue;
    }

    if (verdict.ok) {
      kept += 1;
      continue;
    }

    if (verdict.severity === 'block') {
      // Precio físicamente imposible → eliminar.
      await Notification.deleteOne({ _id: n._id }).catch(() => {});
      deleted += 1;
    } else if (verdict.severity === 'quarantine') {
      // Sospechoso pero no imposible → marcar y no mostrar.
      await Notification.updateOne(
        { _id: n._id },
        { $set: { verificationRequired: true } },
      ).catch(() => {});
      quarantined += 1;
    } else {
      kept += 1;
    }
  }

  await markRun({ deleted, quarantined, kept });

  if (deleted > 0 || quarantined > 0) {
    logger.info('Notifs envenenadas limpiadas', {
      scanned: candidates.length,
      deleted, quarantined, kept,
    });
  } else {
    logger.debug('cleanupPoisonedNotifs: nada que limpiar', {
      scanned: candidates.length, kept,
    });
  }

  return { ran: true, deleted, quarantined, kept };
}

module.exports = { run, shouldRun };
