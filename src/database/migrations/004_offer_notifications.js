/**
 * Migración 004: historial de notificaciones de oferta.
 *
 * Cada vez que el alertEngine dispara una notificación de precio bajo,
 * la guardamos acá para:
 *   · Deduplicar (no notificar dos veces la misma oferta en <12h).
 *   · Exponerla en el bot con "🔔 Últimas ofertas".
 *
 * @module database/migrations/004
 */

'use strict';

const { run } = require('../db');

const id = 4;
const name = 'offer_notifications';

async function up() {
  await run(`
    CREATE TABLE IF NOT EXISTS offer_notifications (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id INTEGER NOT NULL,
      telegram_chat_id INTEGER NOT NULL,
      route_id         INTEGER,
      origin           TEXT NOT NULL,
      destination      TEXT NOT NULL,
      trip_type        TEXT NOT NULL,
      departure_date   TEXT,
      return_date      TEXT,
      airline          TEXT,
      stops            INTEGER,
      price            REAL NOT NULL,
      currency         TEXT NOT NULL,
      deal_level       TEXT NOT NULL,
      threshold        REAL,
      provider         TEXT,
      booking_url      TEXT,
      dedup_key        TEXT NOT NULL,
      sent_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Un dedup_key por (user, ruta, fecha, precio redondeado) evita
  // duplicados en pocas horas. No es UNIQUE para permitir repetir pasado X tiempo.
  await run(`
    CREATE INDEX IF NOT EXISTS idx_offer_notifications_user_sent
      ON offer_notifications (telegram_user_id, sent_at DESC)
  `);
  await run(`
    CREATE INDEX IF NOT EXISTS idx_offer_notifications_dedup
      ON offer_notifications (dedup_key, sent_at DESC)
  `);
}

module.exports = { id, name, up };
