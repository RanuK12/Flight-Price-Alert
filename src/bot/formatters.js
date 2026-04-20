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
 */
function welcome(userName) {
  const name = userName ? `, <b>${esc(userName)}</b>` : '';
  return (
    `✈️ <b>Flight Deal Bot v4.0</b>\n\n` +
    `Hola${name} 👋 Soy tu asistente de ofertas de vuelos.\n\n` +
    `🔎 <b>Buscar</b> — búsqueda en tiempo real con Amadeus\n` +
    `📋 <b>Mis alertas</b> — rutas que estoy monitoreando\n` +
    `➕ <b>Nueva alerta</b> — agregar ruta con precio objetivo\n` +
    `💡 <b>Inspirarme</b> — destinos baratos desde tu origen\n` +
    `📄 <b>Informe PDF</b> — resumen diario\n` +
    `⚙️ <b>Configuración</b> — modo de búsqueda, alertas, moneda\n\n` +
    `Usá los botones o los comandos: /buscar /nueva_alerta /mis_alertas`
  );
}

/** Render de una ruta guardada. */
/**
 * @param {import('../database/repositories/routesRepo').SavedRoute} r
 */
function routeLine(r) {
  const stateIcon = r.paused ? '⏸️' : '🟢';
  const dateStr = r.return_date
    ? `${date(r.outbound_date)} → ${date(r.return_date)}`
    : date(r.outbound_date);
  const threshold = r.price_threshold
    ? ` · alerta ≤ ${price(r.price_threshold, r.currency)}`
    : '';
  const name = r.name ? ` <i>${esc(r.name)}</i>` : '';
  return (
    `${stateIcon} <b>${esc(r.origin)} → ${esc(r.destination)}</b>${name}\n` +
    `   ${esc(dateStr)} · ${esc(r.trip_type)}${threshold}`
  );
}

/** Mensaje de "modo de búsqueda actual". */
function searchModeInfo(mode) {
  const descriptions = {
    hybrid:
      '<b>🔀 Modo Híbrido</b>\nUsa Amadeus para respuestas rápidas y precisas. ' +
      'Si falla o no alcanza la cuota, cae al scraper. <i>Recomendado.</i>',
    amadeus:
      '<b>🎯 Solo Amadeus</b>\nPrecios oficiales con taxes incluidos y confirmación ' +
      'de disponibilidad. Más lento si hay mucho tráfico. Gasta cuota mensual.',
    scraper:
      '<b>🌐 Solo Scraper</b>\nMotor Google Flights. Más cobertura de LCC (Flybondi, ' +
      'JetSmart, Ryanair) pero precios a veces sin taxes. No gasta cuota Amadeus.',
  };
  return descriptions[mode] || descriptions.hybrid;
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
};
