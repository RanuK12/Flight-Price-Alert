/**
 * Formateadores de mensajes HTML para Telegram.
 *
 * Convención: todos los textos devuelven HTML válido para
 * `parse_mode: 'HTML'` y escapan contenido dinámico.
 *
 * @module bot/formatters
 */

'use strict';

/**
 * Escapa caracteres HTML reservados por Telegram.
 * @param {unknown} s
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formatea un precio con currency.
 * @param {number} price @param {string} [currency='EUR']
 */
function price(price, currency = 'EUR') {
  const rounded = Math.round(price * 100) / 100;
  const sym = { EUR: '€', USD: 'US$', ARS: 'AR$' }[currency] || (currency + ' ');
  return `${sym}${rounded.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

/**
 * Formatea una fecha YYYY-MM-DD a "dom 26 abr".
 * @param {string|null|undefined} iso
 */
function date(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return iso; }
}

/**
 * Formatea duración ISO ("PT14H30M") → "14h 30m".
 * @param {string|undefined} iso
 */
function duration(iso) {
  if (!iso) return '';
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!m) return '';
  const h = m[1] ? `${m[1]}h ` : '';
  const min = m[2] ? `${m[2]}m` : '';
  return `${h}${min}`.trim();
}

/** Escalas: 0 → "directo". */
function stopsLabel(stops) {
  if (!stops) return 'directo';
  if (stops === 1) return '1 escala';
  return `${stops} escalas`;
}

/**
 * Render de una oferta en una card HTML.
 * @param {import('../providers/base').Flight} f
 * @param {{level?: string, badge?: string}} [opts]
 */
function flightCard(f, opts = {}) {
  const badge = opts.badge || '';
  const level = opts.level ? ` · <i>${esc(levelLabel(opts.level))}</i>` : '';
  const dateStr = f.returnDate ? `${date(f.departureDate)} → ${date(f.returnDate)}` : date(f.departureDate);
  const dur = duration(f.duration);
  const stops = stopsLabel(f.stops);
  const pieces = [
    `${badge ? badge + ' ' : ''}<b>${price(f.price, f.currency)}</b>${level}`,
    `${esc(f.origin)} → ${esc(f.destination)} · ${esc(dateStr)}`,
    `${esc(f.airline)} · ${stops}${dur ? ` · ${esc(dur)}` : ''}`,
  ];
  return pieces.join('\n');
}

/** Etiquetas legibles para levels. */
function levelLabel(level) {
  return ({
    steal: '🚨 OFERTÓN',
    great: '🔥 muy buena',
    good: '✅ buen precio',
    normal: 'normal',
    high: 'alto',
  }[level]) || level;
}

/**
 * Mensaje de bienvenida.
 * @param {string} [userName]
 * @param {Object} [stats] - {activeRoutes, lastCheck, totalDeals}
 */
function welcome(userName, stats) {
  const name = userName ? `, <b>${esc(userName)}</b>` : '';
  let statusLine = '';
  if (stats) {
    const parts = [];
    if (stats.activeRoutes != null) parts.push(`📋 ${stats.activeRoutes} rutas activas`);
    if (stats.lastCheck) parts.push(`🕐 Última búsqueda: ${stats.lastCheck}`);
    if (stats.totalDeals != null) parts.push(`🔔 ${stats.totalDeals} ofertas enviadas`);
    if (parts.length) statusLine = '\n' + parts.join(' · ');
  }
  return (
    `✈️ <b>Flight Deal Bot v5.0</b>${statusLine}\n\n` +
    `Hola${name} 👋 Monitoreo de precios de vuelos en tiempo real.\n\n` +
    `🔎 <b>Buscar</b> — búsqueda en tiempo real (Amadeus + scraper)\n` +
    `📋 <b>Mis alertas</b> — rutas que estoy monitoreando\n` +
    `🔔 <b>Últimas ofertas</b> — notificaciones recientes\n` +
    `➕ <b>Nueva alerta</b> — agregar ruta con precio objetivo\n` +
    `💡 <b>Inspirarme</b> — destinos baratos desde tu origen\n` +
    `📄 <b>Informe diario</b> — resumen + PDF\n` +
    `⚙️ <b>Configuración</b> — modo de búsqueda, alertas, moneda\n\n` +
    `Comandos: /buscar /nueva_alerta /mis_alertas /ofertas /inspirar /informe`
  );
}

/** Render de una ruta guardada. */
/**
 * @param {import('../database/repositories/routesRepo').SavedRoute} r
 */
function routeLine(r) {
  if (!r) return '⚠️ Ruta no disponible';
  const stateIcon = r.paused ? '⏸️' : '🟢';
  // Compatibilidad MongoDB (camelCase) y SQLite legacy (snake_case)
  const outboundDate = r.outboundDate || r.outbound_date;
  const returnDate = r.returnDate || r.return_date;
  const priceThreshold = r.priceThreshold ?? r.price_threshold;
  const tripType = r.tripType || r.trip_type;
  const currency = r.currency || 'EUR';

  const dateStr = returnDate
    ? `${date(outboundDate)} → ${date(returnDate)}`
    : date(outboundDate);
  const threshold = priceThreshold
    ? ` · alerta ≤ ${price(priceThreshold, currency)}`
    : '';
  const name = r.name ? ` <i>${esc(r.name)}</i>` : '';
  return (
    `${stateIcon} <b>${esc(r.origin)} → ${esc(r.destination)}</b>${name}\n` +
    `   ${esc(dateStr)} · ${esc(tripType)}${threshold}`
  );
}

/** Mensaje de "modo de búsqueda actual". */
function searchModeInfo(mode) {
  const descriptions = {
    hybrid:
      '<b>🔀 Modo Híbrido</b>\nAmadeus para búsquedas interactivas (precio oficial + ' +
      'booking URL). Scraper para el cron de fondo (cero costo Amadeus). Si se ' +
      'agota la cuota diaria, cae a scraper automáticamente. <i>Recomendado.</i>',
    amadeus:
      '<b>🎯 Solo Amadeus</b>\nPrecios oficiales con taxes incluidos y confirmación ' +
      'de disponibilidad. Consume cuota diaria/mensual — si se agota, falla.',
    scraper:
      '<b>🌐 Solo Scraper</b>\nGoogle Flights. Más cobertura de LCC (Flybondi, ' +
      'JetSmart, Ryanair), precios a veces sin taxes. Cero consumo Amadeus.',
  };
  return descriptions[mode] || descriptions.hybrid;
}

// ═══════════════════════════════════════════════════════════════
// TABLA DE PRECIOS (ida x vuelta)
// ═══════════════════════════════════════════════════════════════

/** Meses abreviados para las cabeceras de la tabla. */
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-09-17" → 17 (día del mes). */
function dayOf(iso) {
  return Number(String(iso).slice(8, 10));
}

/** "2026-09-17" → "sep". */
function monthOf(iso) {
  return MONTHS_SHORT[Number(String(iso).slice(5, 7)) - 1] || '';
}

/**
 * Tabla monoespaciada de precios ida x vuelta, como la "Tabla de fechas" de
 * Google pero dentro de Telegram.
 *
 * Va en un bloque `<pre>`: Telegram lo renderiza en monoespaciado y con
 * scroll horizontal propio, así que en el celular la tabla se desliza en
 * lugar de romper el mensaje.
 *
 * Se muestran sólo las N filas de ida más baratas: una grilla de 8x8 no se
 * lee en un teléfono y lo que importa es dónde está el mínimo. La celda más
 * barata va marcada con «».
 *
 * @param {Array<{departureDate: string, returnDate: string, price: number}>} cells
 * @param {{title?: string, maxRows?: number, threshold?: number|null}} [opts]
 * @returns {string} HTML listo para Telegram, o '' si no hay datos
 */
function priceGrid(cells, opts = {}) {
  const rows = Array.isArray(cells) ? cells.filter(c => Number.isFinite(c?.price)) : [];
  if (!rows.length) return '';

  const maxRows = opts.maxRows ?? 6;

  // Mejor precio por fecha de ida, para elegir qué filas mostrar.
  const bestByDeparture = new Map();
  for (const c of rows) {
    const prev = bestByDeparture.get(c.departureDate);
    if (prev === undefined || c.price < prev) bestByDeparture.set(c.departureDate, c.price);
  }
  const departures = [...bestByDeparture.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, maxRows)
    .map(([d]) => d)
    .sort();

  const shown = new Set(departures);
  const returns = [...new Set(rows.filter(c => shown.has(c.departureDate)).map(c => c.returnDate))].sort();
  if (!returns.length) return '';

  const byCombo = new Map(rows.map(c => [`${c.departureDate}|${c.returnDate}`, c.price]));
  const min = Math.min(...rows.map(c => c.price));

  // Ancho de columna: el precio más largo, más el hueco del marcador.
  const width = Math.max(4, ...rows.map(c => String(c.price).length)) + 2;
  const pad = (s) => String(s).padStart(width);

  const lines = [];
  lines.push(pad('').slice(0, 3) + returns.map(r => pad(dayOf(r))).join(''));

  for (const dep of departures) {
    const cellsOfRow = returns.map((ret) => {
      const value = byCombo.get(`${dep}|${ret}`);
      if (value === undefined) return pad('·');
      return pad(value === min ? `«${value}` : value);
    });
    lines.push(String(dayOf(dep)).padStart(3) + cellsOfRow.join(''));
  }

  const depMonth = monthOf(departures[0]);
  const retMonth = monthOf(returns[0]);
  const header = opts.title ? `<b>${esc(opts.title)}</b>\n` : '';
  const axes = `<i>filas: ida (${depMonth}) · columnas: vuelta (${retMonth})</i>\n`;
  const footer = opts.threshold
    ? `\n🎯 Tu umbral: ${price(opts.threshold, 'EUR')} · mejor visto: <b>${price(min, 'EUR')}</b>` +
      (min <= opts.threshold ? ' ✅' : ` (faltan ${price(min - opts.threshold, 'EUR')})`)
    : `\nMejor visto: <b>${price(min, 'EUR')}</b>`;

  return `${header}${axes}<pre>${esc(lines.join('\n'))}</pre>${footer}`;
}

module.exports = {
  esc,
  price,
  date,
  duration,
  stopsLabel,
  flightCard,
  welcome,
  routeLine,
  searchModeInfo,
  levelLabel,
  priceGrid,
};
