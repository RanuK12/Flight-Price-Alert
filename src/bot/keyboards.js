/**
 * Inline keyboards reutilizables para node-telegram-bot-api.
 *
 * Convenciones de callback_data:
 *   - Max 64 bytes (limitación Telegram)
 *   - Formato: "ns:action:arg1:arg2"
 *     ej: "route:pause:42", "search:mode:amadeus", "wizard:cancel"
 *
 * @module bot/keyboards
 */

'use strict';

/** @typedef {{text:string, callback_data?:string, url?:string}} IKBtn */
/** @typedef {{inline_keyboard: IKBtn[][]}} InlineKeyboard */

/**
 * Menú principal (/start).
 * @returns {InlineKeyboard}
 */
function mainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '🔎 Buscar vuelo', callback_data: 'menu:buscar' },
        { text: '➕ Nueva alerta', callback_data: 'menu:nueva_alerta' },
      ],
      [
        { text: '📋 Mis alertas', callback_data: 'menu:mis_alertas' },
        { text: '🔔 Últimas ofertas', callback_data: 'menu:ofertas' },
      ],
      [
        { text: '💡 Inspirarme', callback_data: 'menu:inspirar' },
        { text: '📄 Informe diario', callback_data: 'menu:informe' },
      ],
      [
        { text: '⚙️ Configuración', callback_data: 'menu:config' },
      ],
    ],
  };
}

/**
 * Selector de modo de búsqueda.
 * @param {'hybrid'|'amadeus'|'scraper'} current
 * @returns {InlineKeyboard}
 */
function searchModeMenu(current) {
  /** @param {string} mode @param {string} label */
  const mark = (mode, label) => (mode === current ? `✅ ${label}` : label);
  return {
    inline_keyboard: [
      [{ text: mark('hybrid', '🔀 Híbrido (recomendado)'), callback_data: 'config:mode:hybrid' }],
      [{ text: mark('amadeus', '🎯 Solo Amadeus (más preciso)'), callback_data: 'config:mode:amadeus' }],
      [{ text: mark('scraper', '🌐 Solo Scraper (más cobertura)'), callback_data: 'config:mode:scraper' }],
      [{ text: '⬅️ Volver', callback_data: 'menu:config' }],
    ],
  };
}

/**
 * Selector de nivel mínimo de alerta.
 * @param {'steal'|'great'|'good'|'all'} current
 * @returns {InlineKeyboard}
 */
function alertLevelMenu(current) {
  /** @param {string} lvl @param {string} label */
  const mark = (lvl, label) => (lvl === current ? `✅ ${label}` : label);
  return {
    inline_keyboard: [
      [{ text: mark('steal', '🚨 Solo ofertones (steal)'), callback_data: 'config:level:steal' }],
      [{ text: mark('great', '🔥 Muy buenas o mejores'), callback_data: 'config:level:great' }],
      [{ text: mark('good', '✅ Buenas o mejores'), callback_data: 'config:level:good' }],
      [{ text: mark('all', '📢 Todas'), callback_data: 'config:level:all' }],
      [{ text: '⬅️ Volver', callback_data: 'menu:config' }],
    ],
  };
}

/** Menú de Configuración. */
function configMenu() {
  return {
    inline_keyboard: [
      [{ text: '🔀 Modo de búsqueda', callback_data: 'menu:config:mode' }],
      [{ text: '🚨 Nivel de alertas', callback_data: 'menu:config:level' }],
      [{ text: '💱 Moneda', callback_data: 'menu:config:currency' }],
      [{ text: '⬅️ Menú principal', callback_data: 'menu:main' }],
    ],
  };
}

/**
 * Selector de moneda.
 * @param {string} current
 */
function currencyMenu(current) {
  /** @param {string} cur */
  const mark = (cur) => (cur === current ? `✅ ${cur}` : cur);
  return {
    inline_keyboard: [
      [
        { text: mark('EUR'), callback_data: 'config:currency:EUR' },
        { text: mark('USD'), callback_data: 'config:currency:USD' },
      ],
      [{ text: '⬅️ Volver', callback_data: 'menu:config' }],
    ],
  };
}

/**
 * Tarjeta de ruta con botones pause/delete/resume.
 * @param {{id:number, paused:0|1}} route
 */
function routeCard(route) {
  const toggleBtn = route.paused
    ? { text: '▶️ Reanudar', callback_data: `route:resume:${route.id}` }
    : { text: '⏸️ Pausar', callback_data: `route:pause:${route.id}` };
  return {
    inline_keyboard: [[toggleBtn, { text: '❌ Eliminar', callback_data: `route:delete:${route.id}` }]],
  };
}

/** Botones para confirmar acción destructiva (ej. eliminar ruta). */
/**
 * @param {string} confirmData
 * @param {string} [cancelData='wizard:cancel']
 */
function confirmCancel(confirmData, cancelData = 'wizard:cancel') {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirmar', callback_data: confirmData },
        { text: '✖️ Cancelar', callback_data: cancelData },
      ],
    ],
  };
}

/** Solo "Cancelar" (para cerrar wizards). */
function cancelOnly() {
  return {
    inline_keyboard: [[{ text: '✖️ Cancelar', callback_data: 'wizard:cancel' }]],
  };
}

/**
 * Teclado de tipo de viaje (oneway/roundtrip).
 * @returns {InlineKeyboard}
 */
function tripTypeMenu() {
  return {
    inline_keyboard: [
      [
        { text: '➡️ Solo ida', callback_data: 'wizard:trip:oneway' },
        { text: '🔄 Ida y vuelta', callback_data: 'wizard:trip:roundtrip' },
      ],
      [{ text: '✖️ Cancelar', callback_data: 'wizard:cancel' }],
    ],
  };
}

/**
 * Teclado con orígenes/destinos frecuentes para elegir rápido.
 * @param {string} ns namespace del callback (ej. 'wizard:origin')
 * @param {string[]} iataList
 */
function iataQuickPicks(ns, iataList) {
  const rows = [];
  for (let i = 0; i < iataList.length; i += 3) {
    rows.push(iataList.slice(i, i + 3).map((code) => ({
      text: code,
      callback_data: `${ns}:${code}`,
    })));
  }
  rows.push([{ text: '✍️ Escribir otro', callback_data: `${ns}:_custom` }]);
  rows.push([{ text: '✖️ Cancelar', callback_data: 'wizard:cancel' }]);
  return { inline_keyboard: rows };
}

/** Botón único "Volver al menú". */
function backToMain() {
  return {
    inline_keyboard: [[{ text: '🏠 Menú principal', callback_data: 'menu:main' }]],
  };
}

module.exports = {
  mainMenu,
  searchModeMenu,
  alertLevelMenu,
  configMenu,
  currencyMenu,
  routeCard,
  confirmCancel,
  cancelOnly,
  tripTypeMenu,
  iataQuickPicks,
  backToMain,
};
