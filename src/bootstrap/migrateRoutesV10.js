/**
 * migrateRoutesV10 — Agrega alertas adicionales por pedido del usuario:
 *
 * 1. Mantiene todas las alertas existentes de V9 (ida y vuelta)
 * 2. Agrega nuevas alertas específicas:
 *    • SOLO IDA (outbound 15-22 sep 2026, vuelta 3-10 nov 2026) ≤ €350
 *    • SOLO IDA (outbound 22-29 sep 2026, vuelta 3-10 nov 2026) ≤ €350
 *    • IDA Y VUELTA (Roundtrip outbound 22-29 sep 2026 & return 3-10 nov 2026) ≤ €700
 *
 * Aeropuertos EU: Venecia (VCE), Roma (FCO), Madrid (MAD), Barcelona (BCN)
 * Aeropuertos AR: Ezeiza (EZE), Córdoba (COR)
 *
 * @module bootstrap/migrateRoutesV10
 */

'use strict';

const User = require('../database/models/User');
const Route = require('../database/models/Route');
const logger = require('../utils/logger').child('migrateV10');

const TARGET_VERSION = 11;

const EU_AIRPORTS = ['VCE', 'FCO', 'MAD', 'BCN'];
const AR_AIRPORTS = ['EZE', 'COR'];

const OW_THRESHOLD_NEW = 350; // EUR per leg - nuevo umbral más bajo
const RT_THRESHOLD_NEW = 700; // EUR total roundtrip - nuevo umbral más bajo

// Fechas Ida 1: 15 sep al 22 sep 2026 (ya existentes en V9)
const OUTBOUND_DATES_1 = [
  '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
  '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
];

// Fechas Ida 2: 22 sep al 29 sep 2026 (nuevas)
const OUTBOUND_DATES_2 = [
  '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25',
  '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29',
];

// Fechas Vuelta: 3 nov al 10 nov 2026
const RETURN_DATES = [
  '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10',
];

/**
 * Crea alertas para todas las combinaciones de origen-destino
 */
async function createRoutesForDates(euOrigins, arDestinations, outboundDates, returnDates, isRoundTrip, threshold) {
  const routes = [];
  
  for (const origin of euOrigins) {
    for (const destination of arDestinations) {
      for (const outboundDate of outboundDates) {
        if (isRoundTrip) {
          for (const returnDate of returnDates) {
            routes.push({
              origin,
              destination,
              outboundDate,
              returnDate,
              threshold,
              active: true,
              type: isRoundTrip ? 'roundtrip' : 'oneway',
              createdAt: new Date(),
              updatedAt: new Date()
            });
          }
        } else {
          routes.push({
            origin,
            destination,
            outboundDate,
            returnDate: null,
            threshold,
            active: true,
            type: 'oneway',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }
    }
  }
  
  return routes;
}

/**
 * Ejecuta la migración
 */
async function runMigration() {
  logger.info(`Iniciando migración a versión ${TARGET_VERSION}`);
  
  try {
    // Verificar si ya se ejecutó esta migración
    const existingRoutes = await Route.find({}).limit(1);
    if (existingRoutes.length > 0 && existingRoutes[0].version >= TARGET_VERSION) {
      logger.info(`Migración V${TARGET_VERSION} ya ejecutada. Saltando.`);
      return;
    }
    
    // Obtener todos los usuarios existentes
    const users = await User.find({});
    logger.info(`Encontrados ${users.length} usuarios para procesar`);
    
    // Crear las nuevas alertas con umbrales más bajos
    const newRoutes = [];
    
    // Alertas SOLO IDA con umbral €350 (primera semana de septiembre)
    const onewayRoutes1 = await createRoutesForDates(
      EU_AIRPORTS, 
      AR_AIRPORTS, 
      OUTBOUND_DATES_1, 
      RETURN_DATES, 
      false, 
      OW_THRESHOLD_NEW
    );
    newRoutes.push(...onewayRoutes1);
    
    // Alertas SOLO IDA con umbral €350 (segunda semana de septiembre)
    const onewayRoutes2 = await createRoutesForDates(
      EU_AIRPORTS, 
      AR_AIRPORTS, 
      OUTBOUND_DATES_2, 
      RETURN_DATES, 
      false, 
      OW_THRESHOLD_NEW
    );
    newRoutes.push(...onewayRoutes2);
    
    // Alertas IDA Y VUELTA con umbral €700 (segunda semana de septiembre)
    const roundtripRoutes2 = await createRoutesForDates(
      EU_AIRPORTS, 
      AR_AIRPORTS, 
      OUTBOUND_DATES_2, 
      RETURN_DATES, 
      true, 
      RT_THRESHOLD_NEW
    );
    newRoutes.push(...roundtripRoutes2);
    
    logger.info(`Creando ${newRoutes.length} nuevas rutas con umbrales mejorados`);
    
    // Insertar todas las nuevas rutas de una vez
    if (newRoutes.length > 0) {
      await Route.insertMany(newRoutes);
      logger.info(`${newRoutes.length} rutas insertadas exitosamente`);
    }
    
    // Actualizar la versión de las rutas existentes
    await Route.updateMany({}, { $set: { version: TARGET_VERSION } });
    
    logger.info(`Migración a versión ${TARGET_VERSION} completada exitosamente`);
    
  } catch (error) {
    logger.error(`Error en migración V${TARGET_VERSION}:`, error);
    throw error;
  }
}

// Exportar para ejecución manual si es necesario
if (require.main === module) {
  runMigration()
    .then(() => {
      logger.info('Migración completada');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migración fallida:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };