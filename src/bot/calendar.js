/**
 * Calendario inline para Telegram — genera un inline_keyboard con
 * una grilla mensual navegable para selección de fechas.
 *
 * Callback data compacto (≤ 64 bytes):
 *   - Selección:   "cal:d:2026-06-15"  (d=depart, r=return)
 *   - Navegación:  "cal:n:d:2026-07"   (n=nav, field, YYYY-MM)
 *
 * @module bot/calendar
 */

'use strict';

const DAYS_HEADER = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * Genera un inline keyboard de calendario para un mes dado.
 *
 * @param {number} year  Año (ej. 2026)
 * @param {number} month Mes 1-indexed (ej. 6 = junio)
 * @param {'d'|'r'} field  'd' = fecha de ida, 'r' = fecha de vuelta
 * @param {{minDate?: string, maxMonthsAhead?: number}} [opts]
 * @returns {{inline_keyboard: import('./keyboards').IKBtn[][]}}
 */
function buildCalendar(year, month, field, opts = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDate = opts.minDate ? new Date(opts.minDate) : today;
  minDate.setHours(0, 0, 0, 0);

  const maxAhead = opts.maxMonthsAhead ?? 12;

  const rows = [];

  // ── Header: ◀️ | Mes Año | ▶️ ──
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const canGoPrev = new Date(prevYear, prevMonth - 1, 28) >= today;
  const limitDate = new Date(today.getFullYear(), today.getMonth() + maxAhead, 1);
  const canGoNext = new Date(nextYear, nextMonth - 1, 1) < limitDate;

  const prevBtn = canGoPrev
    ? { text: '◀️', callback_data: `cal:n:${field}:${prevYear}-${pad(prevMonth)}` }
    : { text: ' ', callback_data: 'cal:noop' };
  const nextBtn = canGoNext
    ? { text: '▶️', callback_data: `cal:n:${field}:${nextYear}-${pad(nextMonth)}` }
    : { text: ' ', callback_data: 'cal:noop' };

  rows.push([
    prevBtn,
    { text: `${MONTH_NAMES[month - 1]} ${year}`, callback_data: 'cal:noop' },
    nextBtn,
  ]);

  // ── Días de la semana ──
  rows.push(DAYS_HEADER.map((d) => ({ text: d, callback_data: 'cal:noop' })));

  // ── Grilla de días ──
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  // getDay() → 0=dom, convertir a lunes=0
  let startDow = (firstDay.getDay() + 6) % 7;

  let currentRow = [];
  // Padding inicial
  for (let i = 0; i < startDow; i++) {
    currentRow.push({ text: ' ', callback_data: 'cal:noop' });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month - 1, day);
    dateObj.setHours(0, 0, 0, 0);
    const iso = `${year}-${pad(month)}-${pad(day)}`;

    if (dateObj < minDate) {
      // Día pasado o antes de minDate → deshabilitado
      currentRow.push({ text: '·', callback_data: 'cal:noop' });
    } else {
      currentRow.push({ text: String(day), callback_data: `cal:${field}:${iso}` });
    }

    if (currentRow.length === 7) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  // Padding final
  if (currentRow.length > 0) {
    while (currentRow.length < 7) {
      currentRow.push({ text: ' ', callback_data: 'cal:noop' });
    }
    rows.push(currentRow);
  }

  // ── Footer: escribir manualmente + cancelar ──
  rows.push([{ text: '✍️ Escribir fecha manualmente', callback_data: `cal:manual:${field}` }]);
  rows.push([{ text: '✖️ Cancelar', callback_data: 'wizard:cancel' }]);

  return { inline_keyboard: rows };
}

/**
 * Parsea un callback_data de calendario y devuelve su tipo y datos.
 * @param {string} data  callback_data completo
 * @returns {{type: 'select'|'nav'|'manual'|'noop', field?: 'd'|'r', date?: string, yearMonth?: string} | null}
 */
function parseCalendarCallback(data) {
  if (!data || !data.startsWith('cal:')) return null;

  const parts = data.split(':');

  // cal:noop
  if (parts[1] === 'noop') return { type: 'noop' };

  // cal:d:2026-06-15 o cal:r:2026-06-15
  if ((parts[1] === 'd' || parts[1] === 'r') && parts[2]) {
    return { type: 'select', field: parts[1], date: parts[2] };
  }

  // cal:n:d:2026-07
  if (parts[1] === 'n' && (parts[2] === 'd' || parts[2] === 'r') && parts[3]) {
    return { type: 'nav', field: parts[2], yearMonth: parts[3] };
  }

  // cal:manual:d o cal:manual:r
  if (parts[1] === 'manual' && (parts[2] === 'd' || parts[2] === 'r')) {
    return { type: 'manual', field: parts[2] };
  }

  return null;
}

/**
 * Devuelve year/month inicial para mostrar el calendario.
 * Si estamos a fin de mes (≤3 días), muestra el siguiente.
 * @param {string} [minDate] ISO date mínima (para return dates)
 * @returns {{year: number, month: number}}
 */
function initialCalendarMonth(minDate) {
  const ref = minDate ? new Date(minDate) : new Date();
  const daysLeft = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate() - ref.getDate();
  if (daysLeft <= 3) {
    // Saltar al mes siguiente
    const next = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    return { year: next.getFullYear(), month: next.getMonth() + 1 };
  }
  return { year: ref.getFullYear(), month: ref.getMonth() + 1 };
}

/** @param {number} n */
function pad(n) { return String(n).padStart(2, '0'); }

module.exports = {
  buildCalendar,
  parseCalendarCallback,
  initialCalendarMonth,
  MONTH_NAMES,
};
