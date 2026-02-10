# ✈️ Flight Scraper PoC

Personal-use Google Flights price monitor built with Puppeteer.
Headful by default, respectful delays, circuit breaker, rate limiting.
**Stops immediately on CAPTCHA/block — zero circumvention.**

---

## 1. System Design Summary

```
┌─────────────────────────────────────────────────────────────┐
│                     test-harness.mjs                        │
│  (configurable routes/dates, report generation, alerts)     │
└──────────┬────────────────────────┬────────────────────┬────┘
           │                        │                    │
     ┌─────▼──────┐         ┌──────▼──────┐      ┌──────▼──────┐
     │  scraper    │         │  telegram   │      │    db.js    │
     │  .mjs       │         │  .js        │      │  (SQLite)   │
     │             │         │             │      │             │
     │ Puppeteer   │         │ 3 templates │      │ prices +    │
     │ + stealth   │         │ • run report│      │ hist. min + │
     │ + circuit   │         │ • hist. low │      │ dedup       │
     │   breaker   │         │ • blocked   │      │             │
     │ + rate limit│         │             │      │             │
     └──────┬──────┘         └─────────────┘      └─────────────┘
            │
     ┌──────▼──────┐
     │ Google      │
     │ Flights     │
     │ (visible UI │
     │  only)      │
     └─────────────┘
```

### Data flow

1. **test-harness** → creates `FlightScraper`, calls `searchAll(routes)`
2. **scraper** → checks circuit breaker & rate limit per route
3. **scraper** → launches Puppeteer, navigates to Google Flights URL
4. **scraper** → detects CAPTCHA/block → if yes: **STOP**, log, return `blocked`
5. **scraper** → waits for results with human-like delays
6. **scraper** → extracts itineraries (4-strategy cascade)
7. **scraper** → returns `{ found, items[], diagnostics }` per route
8. **test-harness** → builds JSON report, prints summary
9. **test-harness** → sends Telegram alerts (only if results or blocks found)
10. **test-harness** → saves prices to DB (optional)

### Config options

| Variable | Default | Description |
|---|---|---|
| `HEADLESS` | `false` | `true` = headless, `false` = headful (recommended) |
| `CURRENCY` | `EUR` | Price currency on Google Flights |
| `LOCALE` | `es` | Google Flights language |
| `TIMEOUT` | `60000` | Page load timeout (ms) |
| `MAX_PER_HOUR` | `10` | Max searches per hour |
| `DAILY_BUDGET` | `30` | Max searches per day |
| `CB_THRESHOLD` | `3` | Consecutive failures to trip circuit breaker |
| `CB_PAUSE_HOURS` | `24` | Hours to pause a route after circuit break |
| `TEST_ROUTES` | built-in | JSON `[["MAD","EZE","2026-03-28"], ...]` |
| `SEND_TELEGRAM` | `true` | Enable/disable Telegram alerts |
| `PUPPETEER_EXECUTABLE_PATH` | auto | Custom Chrome path |

---

## 2. Quick Start

### Prerequisites
```bash
# From project root
npm install puppeteer-extra puppeteer-extra-plugin-stealth
npx puppeteer browsers install chrome
```

### Run the test harness
```bash
# Headful (default — recommended for first run)
node poc/test-harness.mjs

# Headless
HEADLESS=true node poc/test-harness.mjs

# Custom routes
TEST_ROUTES='[["MAD","EZE","2026-03-28"],["FCO","EZE","2026-04-05"]]' node poc/test-harness.mjs

# Without Telegram
SEND_TELEGRAM=false node poc/test-harness.mjs
```

### Expected output
```
╔══════════════════════════════════════════════╗
║  ✈️  Flight Scraper PoC — Test Harness        ║
╚══════════════════════════════════════════════╝
📅 2026-02-10T10:00:00.000Z
🔎 Routes: 3 — MAD→EZE→2026-03-28, BCN→EZE→2026-04-02, MIA→EZE→2026-03-30
🖥️  Headless: false
📡 Telegram: ON

  ℹ️ [10:00:01Z] Browser launched
  ℹ️ [10:00:02Z] Search MAD-EZE on 2026-03-28
  ℹ️ [10:00:25Z] Found 7 items for MAD-EZE {"min": 251}
  ...

╔══════════════════════════════════════════════╗
║            📊 TEST REPORT SUMMARY            ║
╠══════════════════════════════════════════════╣
║ Run ID:    a1b2c3d4e5f6
║ Duration:  85000ms
║ Routes:    3
║ ✅ OK:      2
║ ⚪ No data: 1
║ ⛔ Blocked: 0
║ ❌ Errors:  0
╠══════════════════════════════════════════════╣
║ ✅ MAD-EZE  (2026-03-28): ok          €251–€798    [7 items]
║ ✅ BCN-EZE  (2026-04-02): ok          €280–€650    [5 items]
║ ⚪ MIA-EZE  (2026-03-30): no-results  N/A          [0 items]
╚══════════════════════════════════════════════╝
```

---

## 3. Test Checklist

### Before running
- [ ] Chrome installed: `npx puppeteer browsers install chrome`
- [ ] No VPN/proxy active (may trigger blocks)
- [ ] Dates are in the future
- [ ] `.env` file has `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (optional)

### Run the PoC
```bash
node poc/test-harness.mjs
```

### Interpret results
| Status | Meaning | Action |
|---|---|---|
| `ok` | Prices found | Check `minPrice` and `sampleItems` |
| `no-results` | Page loaded, no prices | DOM may have changed — check debug screenshot |
| `blocked` | CAPTCHA/anti-bot detected | **STOP.** Review manually |
| `error` | Transient failure | May retry — check logs |

### Confirm you're not blocked
1. Open the URL from `diagnostics.url` in a normal browser
2. If normal results → the PoC extraction needs selector updates
3. If CAPTCHA → temporarily blocked — wait 1-24h

### If blocked (manual steps ONLY)
1. **Stop all automated scraping immediately**
2. Open Google Flights manually in a normal browser
3. Complete any CAPTCHA/verification manually
4. Wait at least 1 hour before retrying
5. Reduce search frequency: lower `DAILY_BUDGET`, increase delays

---

## 4. Telegram Message Templates

### a) Search Run Report (after each execution)
```
🚀 Monitor de Vuelos — Search Report
🗓️ Fecha: {{search_ts}}
🔎 Rutas chequeadas: {{routes_checked}}
✅ Resultados encontrados: {{results_count}}
⚠️ Bloqueos/Captchas: {{blocked_count}}
⏱️ Duración total: {{duration_ms}} ms
ID Run: {{run_id}}
```

### b) New Historical Low (only when confirmed new minimum)
```
🔥 NUEVO MÍNIMO HISTÓRICO detected!
✈️ Ruta: {{origin}} → {{destination}}
📅 Fechas: {{date_from}} — {{date_to}}
💶 Precio actual: {{price}} {{currency}}
📉 Mínimo previo: {{prev_min}} {{currency}} ({{pct_change}}%)
⏱️ Detectado: {{search_ts}}
🔗 Reserva: {{booking_url}}
📌 Nota: datos extraídos por Puppeteer (personal use).
```

### c) Blocked / CAPTCHA Alert (immediate, pauses route)
```
⛔️ SEARCH BLOCKED / CAPTCHA
Ruta: {{origin}} → {{destination}}
Hora: {{search_ts}}
Diagnóstico: {{diagnostics}}
Acción: Pausando búsquedas para esta ruta por {{pause_hours}} horas.
Revisa manualmente.
```

---

## 5. DB Schema

See `poc/schema.sql` for full Postgres DDL including:
- `search_runs` — one row per execution
- `itineraries` — normalized results with `normalized_hash` for dedup
- `alert_history` — idempotency (same deal not alerted twice)
- Functions: `get_historical_min()`, `is_new_historical_low()`, `upsert_itinerary()`, `was_already_alerted()`

The current system uses SQLite (`server/database/db.js`) — the Postgres schema is the migration target.

---

## 6. Robustness Rules

| Feature | Implementation |
|---|---|
| **Human-like delays** | `randomInt(1500, 4000)` ms between actions; `randomInt(8000, 15000)` between searches |
| **Circuit breaker** | 3 consecutive failures → pause route 24h (configurable) |
| **Rate limiting** | 10/hour, 30/day (configurable) |
| **Retry policy** | 2 attempts with exponential backoff (`3s × 2^n + jitter`) |
| **Block detection** | CAPTCHA iframe, "unusual traffic" patterns, redirect detection |
| **On block** | STOP immediately. Log + screenshot + Telegram alert. No bypass. |
| **Deduplication** | `normalized_hash = sha256(origin|dest|date|price|airline|stops|duration)` |
| **Idempotent alerts** | Check `wasRecentlyAlerted()` (±5% window, 24h) before sending |
| **Debug artifacts** | Screenshot + HTML saved on block or 0-results (debug dir) |

---

## 7. Security & Ethics

⚠️ **This tool is strictly for personal, low-frequency use.**

- **Respect Google's Terms of Service.** This automates visible UI interactions only.
- **Do NOT scale** to high frequency, commercial use, or multiple concurrent sessions.
- **Move to an official API** (Amadeus, Kiwi, Google QPX) as soon as possible.
- **If blocked or CAPTCHAed**, the system **stops automatically** — no circumvention.
- **Rate limits are enforced** (default: 10/hour, 30/day).
- **Headful mode** (default) is more transparent and less likely to trigger detection.
- All extracted data is for **personal price monitoring** only.
- **No authentication bypass, token extraction, or cookie theft** is performed.
- If Google changes their page structure or blocks scraping, **accept it** and use alternatives.

---

## 8. File Structure

```
poc/
├── scraper.mjs         # Core Puppeteer scraper (FlightScraper class)
├── test-harness.mjs    # Test runner + report + Telegram/DB integration
├── schema.sql          # Postgres DDL (migration target)
├── README.md           # This file
└── debug/              # Auto-created: screenshots + HTML on errors
```
