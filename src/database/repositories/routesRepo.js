/**
 * Routes repository — CRUD sobre MongoDB (Route model).
 *
 * @module database/repositories/routesRepo
 */

'use strict';

const Route = require('../models/Route');
const User = require('../models/User');

/**
 * @typedef {Object} CreateRouteInput
 * @property {number} telegramUserId
 * @property {number} telegramChatId
 * @property {string} origin
 * @property {string} destination
 * @property {string|null} [outboundDate]
 * @property {string|null} [returnDate]
 * @property {'oneway'|'roundtrip'} [tripType]
 * @property {string} [currency]
 * @property {number} [priceThreshold]
 * @property {string} [name]
 */

/** @param {CreateRouteInput} input @returns {Promise<import('mongoose').Document>} */
async function createRoute(input) {
  const user = await User.findOneAndUpdate(
    { telegramUserId: input.telegramUserId },
    { telegramChatId: input.telegramChatId },
    { upsert: true, new: true }
  );

  const tripType = input.tripType || (input.returnDate ? 'roundtrip' : 'oneway');

  const route = await Route.findOneAndUpdate(
    {
      telegramUserId: input.telegramUserId,
      origin: input.origin.toUpperCase(),
      destination: input.destination.toUpperCase(),
      outboundDate: input.outboundDate ? new Date(input.outboundDate) : null,
    },
    {
      user: user._id,
      telegramChatId: input.telegramChatId,
      name: input.name || undefined,
      returnDate: input.returnDate ? new Date(input.returnDate) : null,
      tripType,
      currency: input.currency || 'USD',
      priceThreshold: input.priceThreshold ?? null,
      paused: false,
    },
    { upsert: true, new: true }
  );

  return route;
}

/** @param {number} telegramUserId @returns {Promise<import('mongoose').Document[]>} */
async function listByUser(telegramUserId) {
  return Route.find({ telegramUserId }).sort({ paused: 1, createdAt: -1 }).lean();
}

/** @param {string} id @returns {Promise<import('mongoose').Document|null>} */
async function findById(id) {
  return Route.findById(id).lean();
}

/**
 * Ruta accesible por el usuario (ownership check).
 * @param {string} id @param {number} telegramUserId
 */
async function findByIdForUser(id, telegramUserId) {
  return Route.findOne({ _id: id, telegramUserId }).lean();
}

/**
 * Pausar / reanudar.
 * @param {string} id @param {number} telegramUserId @param {boolean} paused
 */
async function setPaused(id, telegramUserId, paused) {
  const result = await Route.updateOne(
    { _id: id, telegramUserId },
    { paused }
  );
  return result.modifiedCount > 0;
}

/**
 * Elimina la ruta (sólo si es del usuario).
 * @param {string} id @param {number} telegramUserId
 */
async function deleteRoute(id, telegramUserId) {
  const result = await Route.deleteOne({ _id: id, telegramUserId });
  return result.deletedCount > 0;
}

/**
 * Todas las rutas activas (para el monitoreo de fondo cron).
 * @returns {Promise<import('mongoose').Document[]>}
 */
async function listAllActive() {
  return Route.find({ paused: false }).lean();
}

module.exports = {
  createRoute,
  listByUser,
  findById,
  findByIdForUser,
  setPaused,
  deleteRoute,
  listAllActive,
};
