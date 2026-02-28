/**
 * Informe Diario PDF v1.0
 *
 * Genera un PDF con todos los precios encontrados (vuelos, trenes, buses),
 * recomendaciones y comparativas. Se envía por Telegram una vez al día.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { all } = require('../database/db');
const { sendMessage } = require('./telegram');

const TelegramBot = require('node-telegram-bot-api');

// Directorio para PDFs temporales
const PDF_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Genera el informe diario PDF y lo envía por Telegram
 */
async function generateAndSendDailyReport() {
  console.log('\n📄 Generando informe diario PDF...');

  // 1. Obtener datos de las últimas 24h
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

  // 2. Agrupar por ruta
  const routes = groupByRoute(prices);

  // 3. Generar PDF
  const filename = `informe-${new Date().toISOString().split('T')[0]}.pdf`;
  const filepath = path.join(PDF_DIR, filename);

  // Asegurar que el directorio existe
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }

  await createPDF(filepath, routes, prices);

  console.log(`  ✅ PDF generado: ${filepath}`);

  // 4. Enviar por Telegram
  await sendPDFToTelegram(filepath, routes);

  // 5. Limpiar PDFs antiguos (>3 días)
  cleanOldPDFs();

  return filepath;
}

/**
 * Agrupa precios por ruta
 */
function groupByRoute(prices) {
  const groups = {};
  for (const p of prices) {
    const key = `${p.origin}→${p.destination}`;
    if (!groups[key]) {
      groups[key] = {
        origin: p.origin,
        destination: p.destination,
        routeName: key,
        prices: [],
      };
    }
    groups[key].prices.push(p);
  }
  return Object.values(groups);
}

/**
 * Detecta si es vuelo, tren o bus según el campo airline/source
 */
function detectMode(entry) {
  const airline = (entry.airline || '').toLowerCase();
  const source = (entry.source || '').toLowerCase();
  if (airline.includes('flixbus') || airline.includes('bus')) return 'bus';
  if (airline.includes('train') || airline.includes('tren')) return 'train';
  if (source.includes('flixbus') || source.includes('transit')) return 'bus';
  return 'flight';
}

function modeEmoji(mode) {
  if (mode === 'bus') return '🚌';
  if (mode === 'train') return '🚂';
  return '✈️';
}

function modeLabel(mode) {
  if (mode === 'bus') return 'Autobús';
  if (mode === 'train') return 'Tren';
  return 'Vuelo';
}

/**
 * Crea el PDF con el informe
 */
function createPDF(filepath, routes, allPrices) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: 'Informe Diario de Precios - Flight Deal Finder',
        Author: 'Flight Deal Finder Bot',
      },
    });

    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 100; // margins
    const today = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // ═══════════ PORTADA ═══════════
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text('Informe Diario de Precios', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(14).font('Helvetica').fillColor('#555');
    doc.text(today, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#888');
    doc.text('Vuelos, Trenes y Autobuses', { align: 'center' });
    doc.moveDown(1.5);

    // Línea decorativa
    doc.strokeColor('#1a237e').lineWidth(2);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(1);

    // ═══════════ RESUMEN EJECUTIVO ═══════════
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text('Resumen Ejecutivo');
    doc.moveDown(0.5);

    // Encontrar las mejores opciones
    const bestByRoute = {};
    for (const route of routes) {
      const best = route.prices[0]; // ya ordenado por precio
      bestByRoute[route.routeName] = best;
    }

    doc.fontSize(10).font('Helvetica').fillColor('#333');
    doc.text(`Total de opciones encontradas: ${allPrices.length}`, { continued: false });
    doc.text(`Rutas analizadas: ${routes.length}`);
    doc.moveDown(0.8);

    // Tabla resumen de mejores precios
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#2e7d32');
    doc.text('Mejores Precios por Ruta');
    doc.moveDown(0.4);

    for (const route of routes) {
      const best = route.prices[0];
      const mode = detectMode(best);
      const emoji = modeLabel(mode);
      const dateStr = best.departure_date ? formatDateES(best.departure_date) : 'N/A';

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333');
      doc.text(`${route.routeName}`, { continued: true });
      doc.font('Helvetica').fillColor('#666');
      doc.text(`  (${emoji})`, { continued: false });

      doc.fontSize(10).font('Helvetica').fillColor('#333');
      doc.text(`   Mejor precio: €${best.price} — ${best.airline || 'N/A'} — ${dateStr}`, { indent: 15 });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.5);
    doc.strokeColor('#ccc').lineWidth(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(1);

    // ═══════════ DETALLE POR RUTA ═══════════
    for (const route of routes) {
      // Check if we need a new page
      if (doc.y > doc.page.height - 200) {
        doc.addPage();
      }

      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a237e');
      doc.text(`${route.routeName}`);
      doc.moveDown(0.3);

      // Separar por modo de transporte
      const byMode = { flight: [], bus: [], train: [] };
      for (const p of route.prices) {
        const mode = detectMode(p);
        if (!byMode[mode]) byMode[mode] = [];
        byMode[mode].push(p);
      }

      for (const [mode, entries] of Object.entries(byMode)) {
        if (entries.length === 0) continue;

        doc.fontSize(11).font('Helvetica-Bold').fillColor('#555');
        doc.text(`${modeEmoji(mode)} ${modeLabel(mode)} (${entries.length} opciones)`);
        doc.moveDown(0.2);

        // Encabezado de tabla
        const colX = [65, 200, 340, 440];
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#666');
        doc.text('Precio', colX[0], doc.y, { continued: false });

        const headerY = doc.y - 11;
        doc.text('Operador', colX[1], headerY);
        doc.text('Fecha', colX[2], headerY);
        doc.text('Fuente', colX[3], headerY);
        doc.moveDown(0.2);

        // Línea bajo encabezado
        doc.strokeColor('#ddd').lineWidth(0.5);
        doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).stroke();
        doc.moveDown(0.1);

        // Filas (máximo 8 por modo)
        const shown = entries.slice(0, 8);
        for (let i = 0; i < shown.length; i++) {
          const p = shown[i];
          const dateStr = p.departure_date ? formatDateES(p.departure_date) : 'N/A';
          const isBest = i === 0;

          if (doc.y > doc.page.height - 80) {
            doc.addPage();
          }

          doc.fontSize(9).font(isBest ? 'Helvetica-Bold' : 'Helvetica');
          doc.fillColor(isBest ? '#2e7d32' : '#333');
          doc.text(`€${p.price}${isBest ? ' ★' : ''}`, colX[0], doc.y, { continued: false });

          const rowY = doc.y - 11;
          doc.fillColor('#333').font('Helvetica');
          doc.text(truncate(p.airline || 'N/A', 22), colX[1], rowY);
          doc.text(dateStr, colX[2], rowY);
          doc.text(truncate(p.source || 'N/A', 16), colX[3], rowY);
          doc.moveDown(0.1);
        }

        if (entries.length > 8) {
          doc.fontSize(8).font('Helvetica').fillColor('#999');
          doc.text(`   +${entries.length - 8} opciones más...`);
        }

        doc.moveDown(0.5);
      }

      // Recomendación para la ruta
      const cheapest = route.prices[0];
      const cheapestMode = detectMode(cheapest);

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1565c0');
      doc.text(`💡 Recomendación: ${modeLabel(cheapestMode)} a €${cheapest.price}`, { indent: 10 });
      if (cheapest.airline) {
        doc.fontSize(9).font('Helvetica').fillColor('#666');
        doc.text(`   con ${cheapest.airline} — ${formatDateES(cheapest.departure_date || '')}`, { indent: 10 });
      }

      doc.moveDown(0.5);
      doc.strokeColor('#eee').lineWidth(0.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
      doc.moveDown(0.8);
    }

    // ═══════════ COMPARATIVA GENERAL ═══════════
    if (doc.y > doc.page.height - 250) {
      doc.addPage();
    }

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a237e');
    doc.text('Comparativa: Opciones Más Económicas');
    doc.moveDown(0.5);

    // Ordenar todas las opciones por precio
    const allSorted = [...allPrices].sort((a, b) => a.price - b.price);
    const top10 = allSorted.slice(0, 10);

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#666');
    const compColX = [60, 190, 310, 390, 470];
    doc.text('Ruta', compColX[0], doc.y);
    const compHeaderY = doc.y - 11;
    doc.text('Precio', compColX[1], compHeaderY);
    doc.text('Operador', compColX[2], compHeaderY);
    doc.text('Tipo', compColX[3], compHeaderY);
    doc.text('Fecha', compColX[4], compHeaderY);
    doc.moveDown(0.3);

    doc.strokeColor('#1a237e').lineWidth(0.5);
    doc.moveTo(55, doc.y).lineTo(doc.page.width - 55, doc.y).stroke();
    doc.moveDown(0.2);

    for (let i = 0; i < top10.length; i++) {
      const p = top10[i];
      const mode = detectMode(p);
      const routeStr = `${p.origin}→${p.destination}`;
      const dateStr = p.departure_date ? formatDateES(p.departure_date) : '';

      doc.fontSize(9).font(i < 3 ? 'Helvetica-Bold' : 'Helvetica');
      doc.fillColor(i === 0 ? '#2e7d32' : '#333');
      doc.text(`${i + 1}. ${routeStr}`, compColX[0], doc.y);

      const rowY = doc.y - 11;
      doc.text(`€${p.price}`, compColX[1], rowY);
      doc.font('Helvetica').fillColor('#333');
      doc.text(truncate(p.airline || 'N/A', 14), compColX[2], rowY);
      doc.text(modeLabel(mode), compColX[3], rowY);
      doc.text(dateStr, compColX[4], rowY);
      doc.moveDown(0.15);
    }

    // ═══════════ PIE DE PÁGINA ═══════════
    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('#aaa');
    doc.text(`Generado automáticamente por Flight Deal Finder v5.0 — ${new Date().toLocaleString('es-ES')}`, { align: 'center' });
    doc.text('Los precios pueden variar. Verificar antes de comprar.', { align: 'center' });

    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * Envía el PDF por Telegram
 */
async function sendPDFToTelegram(filepath, routes) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('  📱 [Telegram disabled] PDF generado pero no enviado');
    return false;
  }

  try {
    const bot = new TelegramBot(token, { polling: false });

    // Enviar resumen de texto primero
    let caption = `📄 <b>Informe Diario de Precios</b>\n`;
    caption += `📅 ${new Date().toLocaleDateString('es-ES')}\n\n`;

    for (const route of routes) {
      const best = route.prices[0];
      const mode = detectMode(best);
      caption += `${modeEmoji(mode)} <b>${route.routeName}</b>: €${best.price}`;
      if (best.airline) caption += ` (${best.airline})`;
      caption += `\n`;
    }

    caption += `\n📊 ${routes.reduce((sum, r) => sum + r.prices.length, 0)} opciones analizadas`;

    await bot.sendDocument(chatId, filepath, {
      caption,
      parse_mode: 'HTML',
    });

    console.log('  📱 PDF enviado por Telegram');
    return true;
  } catch (err) {
    console.error(`  ❌ Error enviando PDF por Telegram: ${err.message}`);
    // Fallback: enviar solo el resumen como texto
    await sendMessage(`📄 Informe diario generado pero no se pudo enviar el PDF: ${err.message}`);
    return false;
  }
}

/**
 * Limpia PDFs antiguos (>3 días)
 */
function cleanOldPDFs() {
  try {
    const files = fs.readdirSync(PDF_DIR).filter(f => f.startsWith('informe-') && f.endsWith('.pdf'));
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filepath = path.join(PDF_DIR, file);
      const stat = fs.statSync(filepath);
      if (stat.mtimeMs < threeDaysAgo) {
        fs.unlinkSync(filepath);
        console.log(`  🗑️ PDF antiguo eliminado: ${file}`);
      }
    }
  } catch (err) {
    // No crítico
  }
}

// ═══════════ HELPERS ═══════════

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
