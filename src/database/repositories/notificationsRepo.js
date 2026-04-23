/**
 * Repo de notificaciones — adaptado a MongoDB (Notification model).
 *
 * @module database/repositories/notificationsRepo
 */

'use strict';

const Notification = require('../models/Notification');

/**
 * Clave de deduplicación. Misma ruta + fecha + precio redondeado a 5
 * se considera la misma oferta.
 * @param {{telegramUserId:number, origin:string, destination:string, departureDate?:string|null, returnDate?:string|null, price:number}} f
 */
function buildDedupKey(f) {
  const bucket = Math.round(f.price / 5) * 5;
  return [
    f.telegramUserId,
    f.origin, f.destination,
    f.departureDate || 'none',
    f.returnDate || 'ow',
    bucket,
  ].join('|');
}

/**
 * ¿Ya se notificó esta oferta hace menos de `withinMs`?
 * @param {string} dedupKey @param {number} [withinMs=12*60*60*1000]
 * @returns {Promise<boolean>}
 */
async function wasNotifiedRecently(dedupKey, withinMs = 12 * 60 * 60 * 1000) {
  const notif = await Notification.findOne({ dedupKey })
    .sort({ sentAt: -1 })
    .lean();
  if (!notif) return false;
  const t = new Date(notif.sentAt).getTime();
  return Date.now() - t < withinMs;
}

/**
 * Inserta una notificación.
 * @param {Object} input
 * @returns {Promise<string>} id insertado
 */
async function insertNotification(input) {
  // Resolver user por telegramUserId si no se provee
  let userId = input.user_id ?? null;
  if (!userId && input.telegram_user_id) {
    const User = require('../models/User');
    const user = await User.findOne({ telegramUserId: input.telegram_user_id }).lean();
    if (user) userId = user._id;
  }

  const notif = await Notification.create({
    user: userId,
    route: input.route_id ?? null,
    origin: input.origin,
    destination: input.destination,
    departureDate: input.departure_date ? new Date(input.departure_date) : null,
    returnDate: input.return_date ? new Date(input.return_date) : null,
    price: input.price,
    currency: input.currency,
    dealLevel: input.deal_level,
    threshold: input.threshold ?? null,
    provider: input.provider ?? '',
    dedupKey: input.dedup_key,
    sentAt: new Date(),
    silent: input.silent ?? false,
  });
  return notif._id.toString();
}

/**
 * Últimas N notificaciones del usuario.
 * @param {number} telegramUserId @param {number} [limit=10]
 * @returns {Promise<Object[]>}
 */
async function listLatestForUser(telegramUserId, limit = 10) {
  // Necesitamos hacer lookup por user. Primero encontrar el userId de Mongo
  const User = require('../models/User');
  const user = await User.findOne({ telegramUserId }).lean();
  if (!user) return [];
  return Notification.find({ user: user._id })
    .sort({ sentAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Stats de ofertas del usuario en las últimas 24h.
 * @param {number} telegramUserId
 */
async function statsLast24h(telegramUserId) {
  const User = require('../models/User');
  const user = await User.findOne({ telegramUserId }).lean();
  if (!user) return { count: 0, min_price: null, steals: 0, greats: 0 };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await Notification.aggregate([
    { $match: { user: user._id, sentAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        min_price: { $min: '$price' },
        steals: { $sum: { $cond: [{ $eq: ['$dealLevel', 'steal'] }, 1, 0] } },
        greats: { $sum: { $cond: [{ $eq: ['$dealLevel', 'great'] }, 1, 0] } },
      },
    },
  ]);

  if (!rows.length) return { count: 0, min_price: null, steals: 0, greats: 0 };
  const r = rows[0];
  return { count: r.count, min_price: r.min_price, steals: r.steals, greats: r.greats };
}

module.exports = {
  buildDedupKey,
  wasNotifiedRecently,
  insertNotification,
  listLatestForUser,
  statsLast24h,
};
