# ✈️ Flight Price Alert (Flight Deal Finder)

Personal flight deal tracker for **Europe ↔ Argentina**, plus **USA ↔ Argentina**. It checks prices on a schedule and sends Telegram alerts when something looks like a real deal.

This project is built to be **API-first** (SerpApi Google Flights), so it runs reliably on Railway without depending on brittle browser scraping.

## 🎯 Features

- **Real flight prices (API-first)**: Google Flights via SerpApi (`engine=google_flights`)
- **Deal detection**: combines SerpApi `price_insights` with route reference thresholds
- **Telegram alerts**: instant notifications
- **Budget-aware monitoring**: optimized for SerpApi Free plan (250 searches/month)
- **SQLite storage**: price history + simple deal tracking
- **Web dashboard**: manual searches + stats

## 🗺️ Monitored routes (current focus)

- **Europe → Argentina (one-way)**: MAD/BCN/FCO/CDG/FRA/AMS/LIS/LHR → EZE
- **Argentina → Europe (roundtrip)**: EZE/COR → MAD/BCN/FCO/CDG/LIS
- **USA → Argentina (one-way)**: MIA/JFK/MCO → EZE

## 📅 Date range

Current monitoring window is **2026-03-25 → 2026-04-08**. Dates are **rotated** inside this range so we don’t burn the monthly budget repeating the same exact combinations.

## 🚀 Quickstart

### 1) Clone

```bash
git clone https://github.com/RanuK12/Flight-Price-Alert.git
cd Flight-Price-Alert
```

### 2) Install

```bash
npm install
```

### 3) Configure env

Create a `.env` file in the project root:

```env
# --- SerpApi (Google Flights) ---
SERPAPI_KEY=your_serpapi_key

# Budget guard (Free plan: 250/month ≈ 8/day)
SERPAPI_DAILY_BUDGET=8

# Cache TTL (hours) to avoid wasting searches
SERPAPI_CACHE_TTL_HOURS=12

# Monitoring
AUTO_MONITOR=true
MONITOR_TIMEZONE=Europe/Rome
MONITOR_SCHEDULE=15 8,15,22 * * *
MONITOR_RUN_BUDGET_MORNING=3
MONITOR_RUN_BUDGET_AFTERNOON=3
MONITOR_RUN_BUDGET_NIGHT=2

# Telegram (optional)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 4) Run

```bash
npm start
```

Open `http://localhost:3000`

## ⏰ Monitoring schedule (Italy timezone)

Default schedule is optimized for **8 searches/day**:

- 08:15 → 3 searches
- 15:15 → 3 searches
- 22:15 → 2 searches

Each run prioritizes:

1) **Europe → Argentina (one-way)**  
2) **Argentina → Europe (roundtrip)**  
3) **USA → Argentina (one-way)** (only when there’s budget left in the afternoon window)

## 🧠 Budget + cache (how we make 250/month work)

- **Daily budget guard**: tracked in SQLite (`provider_daily_usage`) and enforced in `server/scrapers/googleFlights.js`
- **Cache-first**: SerpApi responses are cached with TTL in SQLite (`flight_search_cache`) so repeated checks don’t consume extra searches

## 🖥️ API endpoints

```
GET  /api/search?origin=MAD&destination=EZE&date=2026-03-28&tripType=oneway
GET  /api/deals?limit=10
GET  /api/deals/stats
GET  /api/routes?type=argentina|usa|all
GET  /api/monitor/status
POST /api/monitor/start
POST /api/monitor/stop
POST /api/monitor/search
GET  /api/telegram/status
POST /api/telegram/test
```

## 📌 Notes

- SerpApi Free plan: **250 searches/month** (non-commercial). This repo is tuned for ~**8/day**.
- If `SERPAPI_KEY` is missing, the app may fall back to simulation (useful for dev, not for real deals).

## 📄 License

MIT License — see [LICENSE](LICENSE)
