/**
 * Informe Diario PDF v2.0
 *
 * Genera un PDF profesional con precios encontrados, estadísticas,
 * tendencias y recomendaciones. Se envía por Telegram una vez al día.
 *
 * Precios en USD (Google Flights API).
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { all } = require('../database/db');
const { sendMessage } = require('./telegram');
const TelegramBot = require('node-telegram-bot-api');

const PDF_DIR = path.join(__dirname, '..', '..', 'data');

// ═══════════════════════════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════════════════════════
const COLORS = {
  primary: '#0D47A1',
  secondary: '#1565C0',
  accent: '#00C853',
  warning: '#FF6D00',
  danger: '#D50000',
  text: '#212121',
  textLight: '#616161',
  textMuted: '#9E9E9E',
  bg: '#F5F5F5',
  border: '#E0E0E0',
  white: '#FFFFFF',
  deal: '#2E7D32',
  steal: '#D50000',
};

// Route display names
const ROUTE_NAMES = {
  'MDQ': 'Mar del Plata',
  'COR': 'Córdoba',
  'MAD': 'Madrid',
  'BCN': 'Barcelona',
  'ORD': 'Chicago',
  'EZE': 'Buenos Aires',
  'FCO': 'Roma',
  'MXP': 'Milán',
};

// Thresholds (must match routes config)
const THRESHOLDS = {
  'MDQ-COR': 250,
  'MAD-ORD': 480, 'BCN-ORD': 480,
  'EZE-MAD': 700, 'EZE-BCN': 700, 'EZE-FCO': 750, 'EZE-MXP': 750,
  'COR-MAD': 850, 'COR-BCN': 850, 'COR-FCO': 900, 'COR-MXP': 900,
};

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function generateAndSendDailyReport() {
  console.log('\n📄 Generando informe diario PDF...');

  const prices = await all(`
    SELECT origin, destination, airline, price, source, departure_date, recorded_at
    FROM flight_prices
    WHERE recorded_at >= datetime('now', '-24 hours')
    ORDER BY origin, destination, departure_date, price ASC
  `);

  if (!prices || prices.length === 0) {
    console.log('  ⚠️ Sin datos en las últimas 24h — no se genera PDF');
    return null;
  }

  const routes = groupByRoute(prices);
  const filename = `informe-${new Date().toISOString().split('T')[0]}.pdf`;
  const filepath = path.join(PDF_DIR, filename);

  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  await createPDF(filepath, routes, prices);
  console.log(`  ✅ PDF generado: ${filepath}`);

  await sendPDFToTelegram(filepath, routes);
  cleanOldPDFs();

  return filepath;
}

// ═══════════════════════════════════════════════════════════════
// GROUP DATA
// ═══════════════════════════════════════════════════════════════

function groupByRoute(prices) {
  const groups = {};
  for (const p of prices) {
    const key = `${p.origin}-${p.destination}`;
    if (!groups[key]) {
      groups[key] = {
        origin: p.origin,
        destination: p.destination,
        routeKey: key,
        routeName: `${ROUTE_NAMES[p.origin] || p.origin} → ${ROUTE_NAMES[p.destination] || p.destination}`,
        prices: [],
        threshold: THRESHOLDS[key] || null,
      };
    }
    groups[key].prices.push(p);
  }
  return Object.values(groups);
}

// ═══════════════════════════════════════════════════════════════
// PDF GENERATION
// ═══════════════════════════════════════════════════════════════

function createPDF(filepath, routes, allPrices) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 45, right: 45 },
      info: {
        Title: 'Flight Deal Finder — Informe Diario',
        Author: 'Flight Deal Finder Bot v7.0',
      },
    });

    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const pw = doc.page.width - 90; // page width minus margins
    const today = new Date().toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // ═══════════ HEADER BAR ═══════════
    doc.rect(0, 0, doc.page.width, 85).fill(COLORS.primary);

    doc.fontSize(22).font('Helvetica-Bold').fillColor(COLORS.white);
    doc.text('Flight Deal Finder', 45, 18, { width: pw });
    doc.fontSize(11).font('Helvetica').fillColor('#90CAF5');
    doc.text(`Informe Diario — ${today}`, 45, 45, { width: pw });
    doc.fontSize(9).fillColor('#64B5F6');
    doc.text(`${allPrices.length} precios analizados · ${routes.length} rutas monitoreadas`, 45, 62, { width: pw });

    doc.y = 100;

    // ═══════════ QUICK STATS ═══════════
    const stats = computeStats(routes, allPrices);

    drawStatBox(doc, 45, doc.y, pw / 3 - 8, 'Mejor Precio', `$${stats.bestPrice}`, stats.bestRoute, COLORS.deal);
    drawStatBox(doc, 45 + pw / 3 + 4, doc.y, pw / 3 - 8, 'Ofertas Encontradas', `${stats.dealsCount}`, 'bajo el umbral', COLORS.accent);
    drawStatBox(doc, 45 + (pw / 3 + 4) * 2, doc.y, pw / 3 - 8, 'Promedio', `$${stats.avgPrice}`, 'todas las rutas', COLORS.secondary);

    doc.y += 70;
    doc.moveDown(0.5);

    // ═══════════ RESUMEN POR RUTA ═══════════
    drawSectionHeader(doc, 'Resumen por Ruta');

    // Table header
    const cols = [45, 195, 280, 355, 430];
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.textLight);
    doc.text('RUTA', cols[0], doc.y);
    const hy = doc.y - 9;
    doc.text('MEJOR', cols[1], hy);
    doc.text('AEROLÍNEA', cols[2], hy);
    doc.text('UMBRAL', cols[3], hy);
    doc.text('ESTADO', cols[4], hy);
    doc.moveDown(0.3);

    doc.strokeColor(COLORS.border).lineWidth(0.5);
    doc.moveTo(45, doc.y).lineTo(45 + pw, doc.y).stroke();
    doc.moveDown(0.2);

    for (const route of routes) {
      if (doc.y > doc.page.height - 80) doc.addPage();

      const best = route.prices[0];
      const isDeal = route.threshold && best.price <= route.threshold;
      const statusColor = isDeal ? COLORS.deal : COLORS.textLight;
      const statusText = isDeal ? 'OFERTA' : 'Normal';

      doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.text);
      doc.text(route.routeName, cols[0], doc.y, { width: 145 });
      const ry = doc.y - 11;

      doc.font('Helvetica').fillColor(isDeal ? COLORS.deal : COLORS.text);
      doc.text(`$${best.price}`, cols[1], ry);

      doc.fillColor(COLORS.text);
      doc.text(truncate(best.airline || 'N/A', 15), cols[2], ry);

      doc.fillColor(COLORS.textMuted);
      doc.text(route.threshold ? `≤$${route.threshold}` : '—', cols[3], ry);

      // Status badge
      doc.fontSize(7).font('Helvetica-Bold').fillColor(statusColor);
      doc.text(statusText, cols[4], ry + 1);

      doc.moveDown(0.25);
    }

    doc.moveDown(1);

    // ═══════════ DETALLE POR RUTA ═══════════
    for (const route of routes) {
      if (doc.y > doc.page.height - 180) doc.addPage();

      // Route header with colored left border
      const routeY = doc.y;
      const isDealRoute = route.threshold && route.prices[0].price <= route.threshold;
      doc.rect(45, routeY, 4, 18).fill(isDealRoute ? COLORS.deal : COLORS.secondary);

      doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.text);
      doc.text(route.routeName, 55, routeY + 2);

      if (route.threshold) {
        doc.fontSize(8).font('Helvetica').fillColor(COLORS.textMuted);
        doc.text(`Umbral: ≤$${route.threshold}`, 55 + doc.widthOfString(route.routeName, { fontSize: 12 }) + 15, routeY + 4);
      }

      doc.y = routeY + 25;

      // Mini table of prices
      const detCols = [60, 150, 280, 380];
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(COLORS.textLight);
      doc.text('PRECIO', detCols[0], doc.y);
      const dhy = doc.y - 8;
      doc.text('AEROLÍNEA', detCols[1], dhy);
      doc.text('FECHA', detCols[2], dhy);
      doc.text('FUENTE', detCols[3], dhy);
      doc.moveDown(0.15);

      // Rows (max 6)
      const shown = route.prices.slice(0, 6);
      for (let i = 0; i < shown.length; i++) {
        const p = shown[i];
        const isBest = i === 0;
        const dateStr = p.departure_date ? formatDateES(p.departure_date) : 'N/A';

        if (doc.y > doc.page.height - 60) doc.addPage();

        // Alternate row background
        if (i % 2 === 0) {
          doc.rect(55, doc.y - 2, pw - 15, 12).fill('#FAFAFA');
        }

        doc.fontSize(8.5).font(isBest ? 'Helvetica-Bold' : 'Helvetica');
        doc.fillColor(isBest ? COLORS.deal : COLORS.text);
        doc.text(`$${p.price}${isBest ? ' ★' : ''}`, detCols[0], doc.y);
        const pry = doc.y - 10;
        doc.fillColor(COLORS.text).font('Helvetica');
        doc.text(truncate(p.airline || 'N/A', 22), detCols[1], pry);
        doc.text(dateStr, detCols[2], pry);
        doc.fillColor(COLORS.textMuted).fontSize(7.5);
        doc.text(truncate(p.source || 'N/A', 18), detCols[3], pry);
        doc.moveDown(0.08);
      }

      if (route.prices.length > 6) {
        doc.fontSize(7).font('Helvetica').fillColor(COLORS.textMuted);
        doc.text(`  +${route.prices.length - 6} más...`, 60);
      }

      doc.moveDown(0.8);
    }

    // ═══════════ TOP 10 GLOBAL ═══════════
    if (doc.y > doc.page.height - 250) doc.addPage();

    drawSectionHeader(doc, 'Top 10 — Mejores Precios Globales');

    const allSorted = [...allPrices].sort((a, b) => a.price - b.price);
    const top10 = allSorted.slice(0, 10);

    for (let i = 0; i < top10.length; i++) {
      const p = top10[i];
      const routeStr = `${ROUTE_NAMES[p.origin] || p.origin} → ${ROUTE_NAMES[p.destination] || p.destination}`;
      const dateStr = p.departure_date ? formatDateES(p.departure_date) : '';

      if (doc.y > doc.page.height - 50) doc.addPage();

      // Medal colors for top 3
      const medalColors = [COLORS.deal, COLORS.secondary, '#FF8F00'];
      const color = i < 3 ? medalColors[i] : COLORS.text;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

      doc.fontSize(9).font(i < 3 ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
      doc.text(`${medal}  $${p.price}  —  ${routeStr}  —  ${truncate(p.airline || '', 18)}  —  ${dateStr}`, 50);
      doc.moveDown(0.15);
    }

    // ═══════════ FOOTER ═══════════
    doc.moveDown(2);
    doc.strokeColor(COLORS.border).lineWidth(0.5);
    doc.moveTo(45, doc.y).lineTo(45 + pw, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(7).font('Helvetica').fillColor(COLORS.textMuted);
    doc.text(
      `Flight Deal Finder v7.0 — Generado ${new Date().toLocaleString('es-ES')} — Precios en USD — Los precios pueden variar`,
      { align: 'center' }
    );

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════
// PDF DRAWING HELPERS
// ═══════════════════════════════════════════════════════════════

function drawSectionHeader(doc, title) {
  doc.fontSize(13).font('Helvetica-Bold').fillColor(COLORS.primary);
  doc.text(title);
  doc.moveDown(0.1);
  doc.strokeColor(COLORS.primary).lineWidth(1.5);
  doc.moveTo(45, doc.y).lineTo(45 + doc.widthOfString(title, { fontSize: 13 }), doc.y).stroke();
  doc.moveDown(0.5);
}

function drawStatBox(doc, x, y, width, label, value, subtitle, color) {
  const height = 55;
  // Box background
  doc.rect(x, y, width, height).fill('#F8F9FA');
  // Left accent
  doc.rect(x, y, 3, height).fill(color);

  doc.fontSize(7.5).font('Helvetica').fillColor(COLORS.textMuted);
  doc.text(label.toUpperCase(), x + 12, y + 8, { width: width - 20 });

  doc.fontSize(18).font('Helvetica-Bold').fillColor(color);
  doc.text(value, x + 12, y + 20, { width: width - 20 });

  doc.fontSize(7).font('Helvetica').fillColor(COLORS.textLight);
  doc.text(subtitle, x + 12, y + 42, { width: width - 20 });
}

function computeStats(routes, allPrices) {
  const sorted = [...allPrices].sort((a, b) => a.price - b.price);
  const best = sorted[0] || {};
  const avg = allPrices.length > 0
    ? Math.round(allPrices.reduce((s, p) => s + p.price, 0) / allPrices.length)
    : 0;

  let dealsCount = 0;
  for (const route of routes) {
    if (route.threshold) {
      dealsCount += route.prices.filter(p => p.price <= route.threshold).length;
    }
  }

  return {
    bestPrice: best.price || 0,
    bestRoute: `${ROUTE_NAMES[best.origin] || best.origin || '?'} → ${ROUTE_NAMES[best.destination] || best.destination || '?'}`,
    avgPrice: avg,
    dealsCount,
  };
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM
// ═══════════════════════════════════════════════════════════════

async function sendPDFToTelegram(filepath, routes) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '')
    .split(',').map(id => id.trim()).filter(id => id);

  if (!token || chatIds.length === 0) {
    console.log('  📱 [Telegram disabled] PDF generado pero no enviado');
    return false;
  }

  try {
    const bot = new TelegramBot(token, { polling: false });

    let caption = `📄 <b>Informe Diario de Precios</b>\n`;
    caption += `📅 ${new Date().toLocaleDateString('es-ES')}\n\n`;

    for (const route of routes) {
      const best = route.prices[0];
      const isDeal = route.threshold && best.price <= route.threshold;
      const dealTag = isDeal ? ' 🔥' : '';
      caption += `✈️ <b>${route.routeName}</b>: $${best.price}${dealTag}`;
      if (best.airline) caption += ` (${best.airline})`;
      caption += `\n`;
    }

    caption += `\n📊 ${routes.reduce((sum, r) => sum + r.prices.length, 0)} opciones analizadas`;

    for (const chatId of chatIds) {
      try {
        await bot.sendDocument(chatId, filepath, { caption, parse_mode: 'HTML' });
      } catch (err) {
        console.error(`  ❌ Error Telegram (${chatId}): ${err.message}`);
      }
    }

    console.log('  📱 PDF enviado por Telegram');
    return true;
  } catch (err) {
    console.error(`  ❌ Error enviando PDF: ${err.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function cleanOldPDFs() {
  try {
    const files = fs.readdirSync(PDF_DIR).filter(f => f.startsWith('informe-') && f.endsWith('.pdf'));
    const threeDaysAgo = Date.now() - 3 * 86400000;
    for (const file of files) {
      const filepath = path.join(PDF_DIR, file);
      const stat = fs.statSync(filepath);
      if (stat.mtimeMs < threeDaysAgo) {
        fs.unlinkSync(filepath);
      }
    }
  } catch (err) { /* non-critical */ }
}

function formatDateES(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const days = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
  } catch {
    return dateStr;
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
}

module.exports = {
  generateAndSendDailyReport,
};
