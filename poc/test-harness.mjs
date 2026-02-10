/**
 * poc/test-harness.mjs — Test runner + report generator
 *
 * Runs the Puppeteer PoC for a configurable set of routes,
 * validates results, generates a JSON report, and optionally
 * sends Telegram notifications.
 *
 * Usage:
 *   node poc/test-harness.mjs
 *   HEADLESS=true TEST_ROUTES='[["MAD","EZE","2026-03-28"]]' node poc/test-harness.mjs
 */

import { FlightScraper, DEFAULT_CONFIG } from './scraper.mjs';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env (best-effort) ──
try { require('dotenv').config({ path: join(__dirname, '..', '.env') }); } catch (_) {}

// ── Optional Telegram integration ──
let telegram = null;
try {
  telegram = require('../server/services/telegram');
  telegram.initTelegram();
} catch (e) {
  console.log('ℹ️  Telegram module not available — alerts disabled');
}
const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== 'false' && telegram?.isActive();

// ── Optional DB integration ──
let db = null;
try {
  db = require('../server/database/db');
} catch (e) {
  console.log('ℹ️  Database module not available — DB storage disabled');
}

// ════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ════════════════════════════════════════════════════════════

const TEST_ROUTES = JSON.parse(process.env.TEST_ROUTES || 'null') || [
  ['MAD', 'EZE', '2026-03-28'],
  ['BCN', 'EZE', '2026-04-02'],
  ['MIA', 'EZE', '2026-03-30'],
];

const config = {
  ...DEFAULT_CONFIG,
  headless: process.env.HEADLESS === 'true' ? 'new' : false,
};

// ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  ✈️  Flight Scraper PoC — Test Harness        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🔎 Routes: ${TEST_ROUTES.length} — ${TEST_ROUTES.map(r => r.join('→')).join(', ')}`);
  console.log(`🖥️  Headless: ${config.headless}`);
  console.log(`📡 Telegram: ${SEND_TELEGRAM ? 'ON' : 'OFF'}`);
  console.log('');

  const scraper = new FlightScraper(config);

  try {
    await scraper.init();
    const summary = await scraper.searchAll(TEST_ROUTES);

    // ── Build report ──
    const report = buildReport(summary);

    // ── Save JSON report ──
    const reportFile = join(__dirname, `report_${Date.now()}.json`);
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved: ${reportFile}`);

    // ── Console summary ──
    printSummary(report);

    // ── Telegram notifications ──
    if (SEND_TELEGRAM) {
      await sendTelegramAlerts(report, summary);
    }

    // ── DB integration ──
    if (db) {
      await saveToDb(summary);
    }

    return report;

  } finally {
    await scraper.close();
  }
}

// ════════════════════════════════════════════════════════════
// REPORT BUILDER
// ════════════════════════════════════════════════════════════

function buildReport(summary) {
  const routes = summary.results.map(r => {
    let status = 'error';
    if (r.diagnostics?.blocked) status = 'blocked';
    else if (r.found) status = 'ok';
    else status = 'no-results';

    const prices = r.items.map(i => i.price);
    return {
      route: r.route,
      date: r.date,
      status,
      itemCount: r.items.length,
      minPrice: prices.length > 0 ? Math.min(...prices) : null,
      maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      sampleItems: r.items.slice(0, 3),
      diagnostics: r.diagnostics,
    };
  });

  const ok = routes.filter(r => r.status === 'ok').length;
  const noResults = routes.filter(r => r.status === 'no-results').length;
  const blocked = routes.filter(r => r.status === 'blocked').length;
  const errors = routes.filter(r => r.status === 'error').length;

  return {
    runId: summary.runId,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationMs: summary.durationMs,
    routes,
    summary: { totalRoutes: routes.length, ok, noResults, blocked, errors },
  };
}

// ════════════════════════════════════════════════════════════
// CONSOLE PRINTER
// ════════════════════════════════════════════════════════════

function printSummary(report) {
  const S = report.summary;
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║            📊 TEST REPORT SUMMARY            ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║ Run ID:    ${report.runId}`);
  console.log(`║ Duration:  ${report.durationMs}ms`);
  console.log(`║ Routes:    ${S.totalRoutes}`);
  console.log(`║ ✅ OK:      ${S.ok}`);
  console.log(`║ ⚪ No data: ${S.noResults}`);
  console.log(`║ ⛔ Blocked: ${S.blocked}`);
  console.log(`║ ❌ Errors:  ${S.errors}`);
  console.log('╠══════════════════════════════════════════════╣');

  for (const r of report.routes) {
    const icon = { ok: '✅', 'no-results': '⚪', blocked: '⛔', error: '❌' }[r.status];
    const price = r.minPrice != null ? `€${r.minPrice}–€${r.maxPrice}` : 'N/A';
    console.log(`║ ${icon} ${r.route.padEnd(8)} (${r.date}): ${r.status.padEnd(11)} ${price.padEnd(12)} [${r.itemCount} items]`);
  }

  console.log('╚══════════════════════════════════════════════╝');
}

// ════════════════════════════════════════════════════════════
// TELEGRAM ALERTS
// ════════════════════════════════════════════════════════════

async function sendTelegramAlerts(report, summary) {
  if (!telegram) return;

  try {
    // a) Search run report
    if (telegram.sendSearchRunReport) {
      const topDeals = summary.results
        .filter(r => r.found)
        .flatMap(r => r.items.map(i => ({ origin: r.route.split('-')[0], destination: r.route.split('-')[1], ...i })))
        .sort((a, b) => a.price - b.price)
        .slice(0, 5);

      await telegram.sendSearchRunReport({
        runId: report.runId,
        searchTs: new Date().toLocaleString('es-ES'),
        routesChecked: report.summary.totalRoutes,
        resultsCount: report.summary.ok,
        blockedCount: report.summary.blocked,
        durationMs: report.durationMs,
        topDeals,
      });
      console.log('📡 Telegram: search run report sent');
    }

    // b) Blocked alerts
    if (telegram.sendBlockedAlert) {
      for (const r of report.routes.filter(r => r.status === 'blocked')) {
        const [origin, dest] = r.route.split('-');
        await telegram.sendBlockedAlert({
          origin,
          destination: dest,
          searchTs: new Date().toLocaleString('es-ES'),
          diagnostics: r.diagnostics?.blockedReason || 'Unknown',
          pauseHours: Math.round((DEFAULT_CONFIG.circuitBreaker.pauseMs || 86400000) / 3600000),
        });
      }
    }

    // c) Historical low detection (requires DB)
    if (db && telegram.sendHistoricalLowAlert) {
      for (const r of report.routes.filter(r => r.status === 'ok' && r.minPrice)) {
        const [origin, dest] = r.route.split('-');
        try {
          const analysis = await db.isNewHistoricalLow(origin, dest, r.minPrice);
          if (analysis.isNewLow) {
            await telegram.sendHistoricalLowAlert({
              origin,
              destination: dest,
              price: r.minPrice,
              currency: 'EUR',
              previousMin: analysis.previousMin,
              pctChange: analysis.improvementPercent || null,
              departureDate: r.date,
              airline: r.sampleItems[0]?.airline,
              tripType: 'oneway',
              link: r.diagnostics?.url,
            });
            console.log(`📡 Telegram: historical low alert sent for ${r.route} (€${r.minPrice})`);
          }
        } catch (e) {
          console.log(`⚠️ Historical low check failed for ${r.route}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error(`❌ Telegram alert error: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════
// DB STORAGE
// ════════════════════════════════════════════════════════════

async function saveToDb(summary) {
  if (!db?.saveFlightPrice) return;

  let saved = 0;
  for (const r of summary.results) {
    if (!r.found) continue;
    const [origin, dest] = r.route.split('-');
    for (const item of r.items.slice(0, 5)) { // save top 5 per route
      try {
        await db.saveFlightPrice({
          origin,
          destination: dest,
          price: item.price,
          airline: item.airline || 'Unknown',
          source: 'puppeteer-poc',
          date: r.date,
        });
        saved++;
      } catch (_) {}
    }
  }
  if (saved > 0) console.log(`💾 Saved ${saved} prices to DB`);
}

// ════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════

main().catch(err => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});
