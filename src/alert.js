/**
 * Sistema de alertas minimalista para precios de vuelos.
 * Envía notificaciones por Telegram cuando los precios bajan.
 */

// Mock de alertas - en producción se conectaría a Telegram Bot API
const MOCK_NOTIFICATIONS = [];

/**
 * Configura una alerta para una ruta específica.
 * @param {string} route - Ruta (ej: 'JFK→LAX')
 * @param {number} thresholdPrice - Precio umbral para disparar la alerta
 * @param {string} chatId - ID del chat de Telegram
 * @returns {Object} Confirmación de alerta configurada
 */
function setupAlert(route, thresholdPrice, chatId) {
  if (!route || typeof thresholdPrice !== 'number' || !chatId) {
    throw new Error('Parámetros inválidos para setupAlert');
  }

  const alert = {
    id: `alert_${Date.now()}`,
    route,
    thresholdPrice,
    chatId,
    createdAt: new Date().toISOString(),
    active: true,
  };

  MOCK_NOTIFICATIONS.push(alert);
  return { success: true, alert };
}

/**
 * Verifica si algún precio histórico cumple con la alerta.
 * @param {string} route - Ruta a verificar
 * @param {number} currentPrice - Precio actual a comparar
 * @returns {Promise<Array<Object>>} Alertas disparadas
 */
async function checkAlerts(route, currentPrice) {
  if (!route || typeof currentPrice !== 'number') {
    throw new Error('Parámetros inválidos para checkAlerts');
  }

  const triggered = MOCK_NOTIFICATIONS
    .filter((a) => a.route === route && a.thresholdPrice >= currentPrice && a.active)
    .map((a) => ({ alertId: a.id, notifiedAt: new Date().toISOString(), message: `⚠️ ¡Precio bajo en ${a.route}! (${currentPrice} USD)` }));

  return triggered;
}

/**
 * Desactiva una alerta.
 * @param {string} alertId - ID de la alerta a desactivar
 * @returns {Object} Confirmación
 */
function disableAlert(alertId) {
  const alert = MOCK_NOTIFICATIONS.find((a) => a.id === alertId);
  if (!alert) throw new Error('Alerta no encontrada');

  alert.active = false;
  return { success: true, alert };
}

module.exports = { setupAlert, checkAlerts, disableAlert };

// Ejemplo de uso (mock)
if (require.main === module) {
  console.log('🔔 Configurando alertas...');
  const alert1 = setupAlert('JFK→LAX', 250, '123456789');
  console.log('Alerta configurada:', alert1);

  console.log('\n🔍 Verificando alertas...');
  (async () => {
    const triggered = await checkAlerts('JFK→LAX', 240);
    console.log('Alertas disparadas:', triggered);
  })();
}
