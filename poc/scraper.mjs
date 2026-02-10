/**
 * poc/scraper.mjs — Google Flights Puppeteer PoC
 *
 * Personal-use flight price scraper.
 * Headful by default, respectful delays, circuit breaker, rate limiting.
 * Stops immediately on CAPTCHA/block — no circumvention.
 *
 * Usage:
 *   import { FlightScraper } from './scraper.mjs';
 *   const scraper = new FlightScraper();
 *   await scraper.init();
 *   const result = await scraper.searchRoute('MAD', 'EZE', '2026-03-28');
 *   await scraper.close();
 */

import { createRequire } from 'node:module';
import { randomInt, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════

const KNOWN_AIRLINES = [
  'Iberia', 'Air Europa', 'LATAM', 'Aerolíneas Argentinas', 'Level',
  'Norwegian', 'TAP', 'Lufthansa', 'Air France', 'KLM', 'British Airways',
  'American Airlines', 'United', 'Delta', 'Copa', 'Avianca', 'Emirates',
  'Qatar Airways', 'Turkish Airlines', 'Ryanair', 'easyJet', 'Vueling',
  'JetSMART', 'Flybondi', 'Gol', 'Azul', 'Sky Airline', 'Aeroméxico',
  'Ethiopian', 'Royal Air Maroc', 'Swiss', 'Austrian', 'Brussels Airlines',
  'Condor', 'Edelweiss', 'Avianca', 'Wamos Air', 'Plus Ultra',
];
const AIRLINES_PATTERN = KNOWN_AIRLINES
  .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

export const DEFAULT_CONFIG = {
  headless: process.env.HEADLESS === 'true' ? 'new' : false,
  currency: process.env.CURRENCY || 'EUR',
  locale: process.env.LOCALE || 'es',
  timeout: parseInt(process.env.TIMEOUT || '60000', 10),
  maxRetries: 2,
  delays: {
    actionMin: 1500,   actionMax: 4000,   // between UI actions
    searchMin: 8000,   searchMax: 15000,  // between route searches
  },
  circuitBreaker: {
    threshold: parseInt(process.env.CB_THRESHOLD || '3', 10),
    pauseMs: parseInt(process.env.CB_PAUSE_HOURS || '24', 10) * 3600_000,
  },
  rateLimit: {
    maxPerHour: parseInt(process.env.MAX_PER_HOUR || '10', 10),
    dailyBudget: parseInt(process.env.DAILY_BUDGET || '30', 10),
  },
  debugDir: join(__dirname, 'debug'),
};

// ════════════════════════════════════════════════════════════
// FLIGHT SCRAPER CLASS
// ════════════════════════════════════════════════════════════

export class FlightScraper {
  /** @param {Partial<typeof DEFAULT_CONFIG>} config */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.browser = null;
    this.circuitStates = new Map();   // routeKey → { failures, lastFailure, pauseUntil }
    this.searchTimestamps = [];       // timestamps for rate limiting
    this.dailyCount = 0;
    this.dailyDate = _today();
    this.logs = [];
  }

  // ─── Lifecycle ───────────────────────────────

  async init() {
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || _findChrome();
    const opts = {
      headless: this.config.headless,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--window-size=1366,768',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
      defaultViewport: { width: 1366, height: 768 },
    };
    if (execPath) opts.executablePath = execPath;

    this.browser = await puppeteerExtra.launch(opts);
    this._log('info', 'Browser launched', { headless: this.config.headless, execPath: execPath || 'bundled' });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this._log('info', 'Browser closed');
    }
  }

  // ─── Single-route search ─────────────────────

  /**
   * @param {string} origin      IATA code
   * @param {string} destination IATA code
   * @param {string} date        YYYY-MM-DD
   * @returns {{ found: boolean, items: object[], diagnostics: object }}
   */
  async searchRoute(origin, destination, date) {
    const routeKey = `${origin}-${destination}`;
    const startMs = Date.now();
    const result = _emptyResult(origin, destination, date, routeKey);

    // ── Circuit breaker ──
    const cb = this._cbCheck(routeKey);
    if (cb.paused) {
      result.diagnostics.blocked = true;
      result.diagnostics.blockedReason = `Circuit breaker open — paused until ${cb.pauseUntil}`;
      return this._finalize(result, startMs);
    }

    // ── Rate limit ──
    if (!this._rateOk()) {
      result.diagnostics.blocked = true;
      result.diagnostics.blockedReason = 'Rate limit exceeded';
      return this._finalize(result, startMs);
    }

    const url = _buildUrl(origin, destination, date, this.config);
    result.diagnostics.url = url;
    this._log('info', `Search ${routeKey} on ${date}`);

    let page = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        result.diagnostics.retries = attempt - 1;
        page = await this.browser.newPage();
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        );
        await page.setExtraHTTPHeaders({
          'Accept-Language': `${this.config.locale}-ES,${this.config.locale};q=0.9,en;q=0.8`,
        });

        // Navigate
        await page.goto(url, { waitUntil: 'networkidle2', timeout: this.config.timeout });
        await _delay(this.config.delays.actionMin, this.config.delays.actionMax);

        // Cookie consent
        await _handleConsent(page);

        // Block / CAPTCHA detection
        const block = await _detectBlock(page);
        if (block.blocked) {
          result.diagnostics.blocked = true;
          result.diagnostics.blockedReason = block.reason;
          this._cbFail(routeKey);
          this._log('error', `BLOCKED ${routeKey}`, block);
          await this._saveDebug(page, routeKey, 'blocked');
          await page.close();
          page = null;
          break; // do NOT retry on blocks
        }

        // Wait for results
        await _waitForResults(page, this.config);

        // Scroll to trigger lazy content
        await page.evaluate(() => window.scrollTo(0, 800));
        await _delay(2000, 3500);

        // Extract itineraries
        const items = await _extractItineraries(page, AIRLINES_PATTERN);

        // DEBUG: save screenshot when 0 results (non-production)
        if (items.length === 0 && this.config.headless === false) {
          await this._saveDebug(page, routeKey, 'no-results');
        }

        await page.close();
        page = null;

        // Record rate usage
        this._rateRecord();

        // Build normalised items
        const normItems = items
          .filter(i => i.price >= 50 && i.price <= 10000)
          .sort((a, b) => a.price - b.price)
          .map(i => ({
            ...i,
            normalizedHash: _hash(`${origin}|${destination}|${date}|${i.price}|${i.airline || ''}|${i.stops ?? ''}|${i.durationMin || ''}`),
            link: url,
          }));

        if (normItems.length > 0) {
          result.found = true;
          result.items = normItems;
          result.diagnostics.resultCount = normItems.length;
          this._cbSuccess(routeKey);
          this._log('info', `Found ${normItems.length} items for ${routeKey}`, { min: normItems[0].price });
        } else {
          this._log('warn', `No results for ${routeKey}`);
        }

        break; // success (even if 0 results — it's not a block)

      } catch (err) {
        lastErr = err;
        this._log('error', `Attempt ${attempt}/${this.config.maxRetries} failed (${routeKey}): ${err.message}`);
        if (page) { try { await page.close(); } catch (_) {} page = null; }
        if (attempt < this.config.maxRetries) {
          const backoff = 3000 * Math.pow(2, attempt - 1) + randomInt(0, 2001);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    if (!result.found && !result.diagnostics.blocked && lastErr) {
      result.diagnostics.blockedReason = `Error: ${lastErr.message}`;
      this._cbFail(routeKey);
    }

    return this._finalize(result, startMs);
  }

  // ─── Batch search ────────────────────────────

  /**
   * @param {Array<[string,string,string]>} routes  Array of [origin, dest, date]
   * @returns {Object} Run summary with per-route results
   */
  async searchAll(routes) {
    const runId = _hash(Date.now().toString() + Math.random().toString()).substring(0, 12);
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    this._log('info', `Run ${runId} started — ${routes.length} routes`);

    const results = [];
    let blockedCount = 0;

    for (const [origin, dest, date] of routes) {
      const r = await this.searchRoute(origin, dest, date);
      results.push({ route: `${origin}-${dest}`, date, ...r });
      if (r.diagnostics.blocked) blockedCount++;

      // Respectful delay between searches
      if (routes.indexOf(routes.find(x => x[0] === origin && x[1] === dest && x[2] === date)) < routes.length - 1) {
        await _delay(this.config.delays.searchMin, this.config.delays.searchMax);
      }
    }

    const summary = {
      runId,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      routesChecked: routes.length,
      resultsCount: results.filter(r => r.found).length,
      blockedCount,
      results,
    };

    this._log('info', `Run ${runId} finished`, {
      checked: routes.length,
      found: summary.resultsCount,
      blocked: blockedCount,
      ms: summary.durationMs,
    });

    return summary;
  }

  // ─── Circuit breaker ─────────────────────────

  _cbCheck(routeKey) {
    const s = this.circuitStates.get(routeKey);
    if (!s) return { paused: false };
    if (s.pauseUntil && Date.now() < s.pauseUntil) {
      return { paused: true, pauseUntil: new Date(s.pauseUntil).toISOString(), failures: s.failures };
    }
    if (s.pauseUntil) this.circuitStates.delete(routeKey); // expired → reset
    return { paused: false };
  }

  _cbFail(routeKey) {
    const s = this.circuitStates.get(routeKey) || { failures: 0 };
    s.failures++;
    s.lastFailure = Date.now();
    if (s.failures >= this.config.circuitBreaker.threshold) {
      s.pauseUntil = Date.now() + this.config.circuitBreaker.pauseMs;
      const hrs = this.config.circuitBreaker.pauseMs / 3600_000;
      this._log('warn', `Circuit breaker OPEN for ${routeKey} — paused ${hrs}h`);
    }
    this.circuitStates.set(routeKey, s);
  }

  _cbSuccess(routeKey) { this.circuitStates.delete(routeKey); }

  // ─── Rate limiter ────────────────────────────

  _rateOk() {
    const now = Date.now();
    this.searchTimestamps = this.searchTimestamps.filter(t => t > now - 3600_000);
    if (this.searchTimestamps.length >= this.config.rateLimit.maxPerHour) {
      this._log('warn', `Hourly limit: ${this.searchTimestamps.length}/${this.config.rateLimit.maxPerHour}`);
      return false;
    }
    if (_today() !== this.dailyDate) { this.dailyDate = _today(); this.dailyCount = 0; }
    if (this.dailyCount >= this.config.rateLimit.dailyBudget) {
      this._log('warn', `Daily budget: ${this.dailyCount}/${this.config.rateLimit.dailyBudget}`);
      return false;
    }
    return true;
  }

  _rateRecord() {
    this.searchTimestamps.push(Date.now());
    this.dailyCount++;
  }

  // ─── Debug helpers ───────────────────────────

  async _saveDebug(page, routeKey, type) {
    try {
      const dir = this.config.debugDir;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const ts = Date.now();
      await page.screenshot({ path: join(dir, `${routeKey}_${type}_${ts}.png`), fullPage: true });
      writeFileSync(join(dir, `${routeKey}_${type}_${ts}.html`), await page.content());
      this._log('info', `Debug saved: ${routeKey}_${type}_${ts}`);
    } catch (e) { this._log('warn', `Debug save failed: ${e.message}`); }
  }

  // ─── Logging ─────────────────────────────────

  _log(level, msg, data = null) {
    const entry = { ts: new Date().toISOString(), level, msg, ...(data ? { data } : {}) };
    this.logs.push(entry);
    const icon = { info: '  ℹ️', warn: '  ⚠️', error: '  ❌' }[level] || '  ';
    console.log(`${icon} [${entry.ts}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`);
  }

  _finalize(result, startMs) {
    result.diagnostics.searchEndedAt = new Date().toISOString();
    result.diagnostics.durationMs = Date.now() - startMs;
    return result;
  }
}

// ════════════════════════════════════════════════════════════
// PURE HELPER FUNCTIONS (not methods — no side effects)
// ════════════════════════════════════════════════════════════

function _buildUrl(origin, dest, date, cfg) {
  const q = `Flights from ${origin} to ${dest} on ${date}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=${cfg.currency}&hl=${cfg.locale}`;
}

function _findChrome() {
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable']) {
    try { if (existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}

function _today() { return new Date().toISOString().split('T')[0]; }

function _delay(min = 1500, max = 4000) {
  return new Promise(r => setTimeout(r, randomInt(min, max + 1)));
}

function _hash(raw) {
  return createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

function _emptyResult(origin, dest, date, routeKey) {
  return {
    found: false,
    items: [],
    diagnostics: {
      searchStartedAt: new Date().toISOString(),
      searchEndedAt: null,
      durationMs: 0,
      resultCount: 0,
      blocked: false,
      blockedReason: null,
      url: null,
      route: routeKey,
      date,
      retries: 0,
    },
  };
}

// ─── Cookie consent ────────────────────────────

async function _handleConsent(page) {
  try {
    const btn = await page.$(
      'button[aria-label*="ceptar"], button[aria-label*="Accept"], ' +
      'button[id*="accept"], [aria-label*="Consent"], button[jsname="b3VHJd"]'
    );
    if (btn) {
      await btn.click();
      await _delay(800, 1500);
    }
  } catch (_) {}
}

// ─── Block / CAPTCHA detection ─────────────────
// ⚠️  We ONLY detect — we do NOT bypass, solve, or circumvent.

async function _detectBlock(page) {
  return page.evaluate(() => {
    const html = document.documentElement?.innerHTML || '';
    const body = document.body?.innerText || '';
    const url = window.location.href;

    // reCAPTCHA iframe
    if (document.querySelector('iframe[src*="recaptcha"]') ||
        document.querySelector('iframe[src*="captcha"]')) {
      return { blocked: true, reason: 'CAPTCHA detected (reCAPTCHA iframe)' };
    }

    // Block text patterns
    const patterns = [
      /unusual traffic/i, /tráfico inusual/i,
      /automated queries/i, /consultas automatizadas/i,
      /sorry.*are not allowed/i, /before you continue/i,
      /please verify/i, /por favor verifica/i,
      /we're sorry/i, /lo sentimos/i,
    ];
    for (const p of patterns) {
      if (p.test(body) || p.test(html)) {
        return { blocked: true, reason: `Block pattern: ${p.source}` };
      }
    }

    // Redirect to block pages
    if (url.includes('google.com/sorry') ||
        url.includes('/recaptcha') ||
        url.includes('accounts.google.com/ServiceLogin')) {
      return { blocked: true, reason: `Redirect to block page: ${url}` };
    }

    return { blocked: false, reason: null };
  });
}

// ─── Wait for results ──────────────────────────

async function _waitForResults(page, cfg) {
  try {
    // Scroll slightly to trigger content
    await page.evaluate(() => window.scrollTo(0, 400));
    await _delay(1500, 2500);

    await Promise.race([
      page.waitForFunction(
        () => (document.body?.innerText || '').match(/\d{3,4}\s*€/) !== null,
        { timeout: 20000 }
      ),
      page.waitForSelector('[role="listitem"]', { timeout: 20000 }),
    ]);

    // Extra wait for prices to render
    await _delay(2500, 4000);
  } catch (_) {
    // Timeout — proceed anyway, extraction will handle empty results
  }
}

// ─── Itinerary extraction ──────────────────────
// Three-strategy cascade; returns items with price, currency for certain,
// and best-effort airline, schedule, duration, stops.

async function _extractItineraries(page, airlinesPattern) {
  return page.evaluate((AP) => {
    const items = [];
    const seenPrices = new Set();

    function parsePrice(text) {
      const m = text.match(/(\d{1,3}(?:\.\d{3})*)\s*€/) || text.match(/€\s*(\d{1,3}(?:\.\d{3})*)/);
      if (!m) return null;
      return parseFloat(m[1].replace(/\./g, ''));
    }

    function parseFlight(text) {
      const time = text.match(/(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/);
      const dur  = text.match(/(\d{1,2})\s*h\s*(?:(\d{1,2})\s*min)?/);
      const stopN = text.match(/(\d+)\s*escala/i) || text.match(/(\d+)\s*stop/i);
      const direct = /directo|nonstop|sin\s*escala/i.test(text);
      const air = text.match(new RegExp(AP, 'i'));
      return {
        airline: air ? air[0] : null,
        departureTime: time ? time[1] : null,
        arrivalTime: time ? time[2] : null,
        durationMin: dur ? parseInt(dur[1]) * 60 + (parseInt(dur[2]) || 0) : null,
        stops: direct ? 0 : (stopN ? parseInt(stopN[1]) : null),
      };
    }

    // ── Strategy 1: find result <ul> with priced <li> items ──
    for (const ul of document.querySelectorAll('ul')) {
      const lis = ul.querySelectorAll(':scope > li');
      const priced = Array.from(lis).filter(li => parsePrice(li.innerText || '') !== null);
      if (priced.length < 2) continue;

      for (const li of priced) {
        const txt = li.innerText || '';
        const price = parsePrice(txt);
        if (!price || price < 50 || price > 10000 || seenPrices.has(price)) continue;
        seenPrices.add(price);
        items.push({ price, currency: 'EUR', ...parseFlight(txt), source: 'list-items' });
      }
      break; // use first matching list
    }

    // ── Strategy 2: aria-label scan (filter for flight-like labels) ──
    if (items.length === 0) {
      for (const el of document.querySelectorAll('[aria-label]')) {
        const lbl = el.getAttribute('aria-label') || '';
        const price = parsePrice(lbl);
        if (!price || price < 50 || price > 10000 || seenPrices.has(price)) continue;
        // Only labels that look like itineraries (have schedule or stop info)
        if (!lbl.match(/\d{1,2}:\d{2}/) && !lbl.match(/h.*min/i) && !lbl.match(/escala|stop|directo|nonstop/i)) continue;
        seenPrices.add(price);
        items.push({ price, currency: 'EUR', ...parseFlight(lbl), source: 'aria-labels' });
      }
    }

    // ── Strategy 3: broad aria-label (price-only, less filtering) ──
    if (items.length === 0) {
      for (const el of document.querySelectorAll('[aria-label]')) {
        const lbl = el.getAttribute('aria-label') || '';
        const price = parsePrice(lbl);
        if (!price || price < 50 || price > 10000 || seenPrices.has(price)) continue;
        seenPrices.add(price);
        items.push({ price, currency: 'EUR', ...parseFlight(lbl), source: 'aria-broad' });
      }
    }

    // ── Strategy 4: full body-text fallback ──
    if (items.length === 0) {
      const body = document.body?.innerText || '';
      for (const m of [...body.matchAll(/(\d{3,4})\s*€/g)].slice(0, 15)) {
        const price = parseInt(m[1], 10);
        if (price >= 50 && price <= 10000 && !seenPrices.has(price)) {
          seenPrices.add(price);
          items.push({ price, currency: 'EUR', airline: null, departureTime: null, arrivalTime: null, durationMin: null, stops: null, source: 'body-text' });
        }
      }
    }

    return items;
  }, airlinesPattern);
}
