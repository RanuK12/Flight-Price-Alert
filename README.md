<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Puppeteer-v24-40B5A4?logo=puppeteer&logoColor=white" alt="Puppeteer">
  <img src="https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white" alt="Telegram">
  <img src="https://img.shields.io/badge/Railway-Deploy-0B0D0E?logo=railway&logoColor=white" alt="Railway">
  <img src="https://img.shields.io/github/license/RanuK12/Flight-Price-Alert" alt="License">
</p>

# Flight Price Alert

An automated flight price monitoring system that scrapes Google Flights with Puppeteer, detects deals below configurable thresholds, and sends instant Telegram notifications. Built to track flights between Europe, the USA, and Argentina.

<p align="center">
  <img src="docs/dashboard-preview.png" alt="Web Dashboard" width="720">
</p>

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Monitored Routes](#monitored-routes)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [Usage](#usage)
  - [Web Dashboard](#web-dashboard)
  - [Telegram Alerts](#telegram-alerts)
- [API Reference](#api-reference)
- [Deployment](#deployment)
  - [Railway (Recommended)](#railway-recommended)
  - [Docker / VPS](#docker--vps)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Real-time scraping** — Extracts live prices from Google Flights using headless Puppeteer with stealth mode. No paid API keys required.
- **Smart scheduling** — Runs searches automatically on a cron schedule (default: every 2 hours). Rotates routes and dates each run to maximize coverage.
- **Telegram notifications** — Sends alerts only when a deal is found. No spam. Separate alerts for "near-deal" prices within a secondary range.
- **Anti-detection** — Stealth plugin, randomized user agents, cookie consent handling in multiple languages, and a circuit breaker that pauses after repeated blocks.
- **Multi-source fallback** — Primary: Puppeteer. Optional: SerpApi, Amadeus, Kiwi/Tequila for additional coverage when API keys are provided.
- **Web dashboard** — Search flights manually, view recent deals, monitor status, and browse stats from a dark-themed responsive UI.
- **SQLite persistence** — All searches, deals, and price history are saved locally.
- **One-click deploy** — Pre-configured for Railway with Nixpacks. Also works on any Linux VPS or Docker environment.

---

## How It Works

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│   Scheduler  │────>│  Flight Monitor │────>│   Scrapers   │────>│   Telegram   │
│  (node-cron) │     │  (route picker, │     │  (Puppeteer, │     │  (deal alert │
│              │     │   date rotate)  │     │   SerpApi…)  │     │   only)      │
└──────────────┘     └────────┬────────┘     └──────────────┘     └──────────────┘
                              │
                              v
                     ┌─────────────────┐
                     │     SQLite      │
                     │  (deals, price  │
                     │   history, log) │
                     └─────────────────┘
```

1. The **scheduler** triggers a search run on a cron schedule.
2. The **flight monitor** selects 6 routes and 2 dates per route (12 searches per run), rotating daily to cover the full date range over time.
3. **Puppeteer** opens Google Flights in headless Chrome, handles cookie consent, waits for price data to load, and extracts flight details using aria-label parsing with airline recognition for 40+ carriers.
4. Prices are compared against thresholds. Deals are saved to **SQLite** and sent to **Telegram**.
5. A **web dashboard** provides manual search, deal history, and live monitoring status.

---

## Monitored Routes

### One-Way: Europe → Argentina (threshold: €350)

| Origin | Destination | Route |
|--------|-------------|-------|
| MAD | EZE | Madrid → Buenos Aires |
| BCN | EZE | Barcelona → Buenos Aires |
| FCO | EZE | Rome → Buenos Aires |
| CDG | EZE | Paris → Buenos Aires |
| FRA | EZE | Frankfurt → Buenos Aires |
| AMS | EZE | Amsterdam → Buenos Aires |
| LIS | EZE | Lisbon → Buenos Aires |
| LHR | EZE | London → Buenos Aires |

### One-Way: USA → Argentina (threshold: €200)

| Origin | Destination | Route |
|--------|-------------|-------|
| MIA | EZE | Miami → Buenos Aires |
| JFK | EZE | New York → Buenos Aires |
| MCO | EZE | Orlando → Buenos Aires |

### Round-Trip: Argentina → Europe (threshold: €600)

| Origin | Destination | Route |
|--------|-------------|-------|
| EZE | MAD | Buenos Aires → Madrid |
| EZE | BCN | Buenos Aires → Barcelona |
| EZE | FCO | Buenos Aires → Rome |
| EZE | CDG | Buenos Aires → Paris |
| EZE | LIS | Buenos Aires → Lisbon |
| COR | MAD | Córdoba → Madrid |
| COR | BCN | Córdoba → Barcelona |
| COR | FCO | Córdoba → Rome |

> Round-trip flights between €650 and €800 trigger a separate "near-deal" alert.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Express Server                       │
│                         (port 4000)                         │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  REST API    │  Static UI   │  Scheduler   │  Telegram Bot  │
│  /api/*      │  /public     │  node-cron   │  (send-only)   │
├──────────────┴──────────────┴──────┬───────┴────────────────┤
│                             Services                        │
│  ┌──────────────────┐  ┌───────────────────┐               │
│  │  flightMonitor   │  │    telegram.js     │               │
│  │  - route rotation│  │  - deal reports    │               │
│  │  - date picking  │  │  - near-deal alert │               │
│  │  - thresholds    │  │  - anti-spam       │               │
│  └────────┬─────────┘  └───────────────────┘               │
│           │                                                  │
│  ┌────────v─────────────────────────────────┐               │
│  │              Scraper Chain               │               │
│  │  1. Puppeteer (Google Flights) - primary │               │
│  │  2. SerpApi          - optional          │               │
│  │  3. Amadeus          - optional          │               │
│  │  4. Kiwi/Tequila    - optional          │               │
│  └────────┬─────────────────────────────────┘               │
│           │                                                  │
│  ┌────────v─────────┐                                       │
│  │    SQLite DB      │                                       │
│  │  - deals          │                                       │
│  │  - price_history  │                                       │
│  │  - search_history │                                       │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | File | Description |
|-----------|------|-------------|
| Entry point | `server/app.js` | Express server, auto-starts monitoring |
| Flight monitor | `server/services/flightMonitor.js` | Core search logic, thresholds, scheduling |
| Puppeteer scraper | `server/scrapers/puppeteerGoogleFlights.js` | Headless Chrome scraping with stealth |
| Scraper orchestrator | `server/scrapers/index.js` | Aggregates results from all sources |
| Telegram service | `server/services/telegram.js` | Notification templates, anti-spam |
| API routes | `server/routes/flights.js` | REST endpoints for search, deals, monitoring |
| Database | `server/database/db.js` | SQLite schema, queries, migrations |
| Route config | `server/config/routes.js` | Airport codes, reference prices |

---

## Getting Started

### Prerequisites

- **Node.js** 18 or higher
- **Google Chrome** or **Chromium** installed (auto-detected)
- A **Telegram Bot** token (optional, for notifications)

### Installation

```bash
git clone https://github.com/RanuK12/Flight-Price-Alert.git
cd Flight-Price-Alert
npm install
```

### Configuration

Copy the example environment file and edit it:

```bash
cp .env.example .env
```

**Required variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) | `123456:ABC-DEF...` |
| `TELEGRAM_CHAT_ID` | Your chat ID from [@userinfobot](https://t.me/userinfobot) | `123456789` |

**Optional variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `AUTO_MONITOR` | `true` | Start monitoring on boot |
| `MONITOR_SCHEDULE` | `0 */2 * * *` | Cron expression (default: every 2h) |
| `MONITOR_TIMEZONE` | `Europe/Rome` | Timezone for scheduling |
| `SERPAPI_KEY` | — | SerpApi key for additional Google Flights data |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detected | Path to Chrome/Chromium binary |
| `PUPPETEER_HEADLESS` | `true` | Set to `false` for visible browser (debug) |

```env
# .env
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id
PORT=4000
AUTO_MONITOR=true
MONITOR_TIMEZONE=Europe/Rome
MONITOR_SCHEDULE=0 */2 * * *
```

---

## Usage

```bash
npm start
```

The server starts on `http://localhost:4000`. Monitoring begins automatically — no manual action needed.

### Web Dashboard

Open `http://localhost:4000` in your browser.

<p align="center">
  <img src="docs/dashboard-search.png" alt="Search Interface" width="680">
</p>

The dashboard provides:

- **Flight search** — Pick origin, destination, and date to search Google Flights on demand.
- **Live deals** — View all deals found by the monitor, color-coded by deal quality.
- **Statistics** — Total searches, deals found, success rate.
- **Monitor controls** — Start/stop the scheduler, trigger a manual search run.
- **Route list** — All monitored routes with their current thresholds.

### Telegram Alerts

When the monitor finds a flight below the configured threshold, it sends a formatted Telegram message:

<p align="center">
  <img src="docs/telegram-alert.png" alt="Telegram Alert Example" width="380">
</p>

Alerts include:
- Route and price in EUR
- Airline name
- Departure date
- Direct booking link to Google Flights

> Duplicate alerts are suppressed for 24 hours per route/price combination.

---

## API Reference

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search?origin=MAD&destination=EZE&date=2026-03-28` | Search a single route |
| `GET` | `/api/search/multi?origin=MAD&destination=EZE&dates=2026-03-25,2026-04-01` | Search multiple dates |

### Deals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/deals?limit=20` | Recent deals |
| `GET` | `/api/deals/best` | Top deals by category |
| `GET` | `/api/deals/stats` | Deal statistics |

### Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/monitor/status` | Current monitor state |
| `POST` | `/api/monitor/start` | Start the scheduler |
| `POST` | `/api/monitor/stop` | Stop the scheduler |
| `POST` | `/api/monitor/search` | Trigger an immediate search |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/routes` | All monitored routes |
| `GET` | `/api/telegram/status` | Telegram connection status |
| `POST` | `/api/telegram/test` | Send a test message |

---

## Deployment

### Railway (Recommended)

The project includes `railway.json` and `nixpacks.toml` pre-configured for one-click deployment.

1. Fork this repository.
2. Connect it to [Railway](https://railway.app).
3. Add environment variables (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
4. Deploy.

Railway uses Nixpacks to install `chromium` and `Node.js 18`. The start command auto-detects the Chromium path:

```toml
# nixpacks.toml
[phases.setup]
nixPkgs = ["chromium", "nodejs_18"]

[start]
cmd = "export PUPPETEER_EXECUTABLE_PATH=$(which chromium) && node server/app.js"
```

### Docker / VPS

On any Linux server with Chrome or Chromium installed:

```bash
git clone https://github.com/RanuK12/Flight-Price-Alert.git
cd Flight-Price-Alert
npm install
npm start
```

The scraper auto-detects Chromium in common paths (`/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome-stable`). Override with `PUPPETEER_EXECUTABLE_PATH` if needed.

---

## Project Structure

```
Flight-Price-Alert/
├── server/
│   ├── app.js                          # Express server entry point
│   ├── config/
│   │   └── routes.js                   # Airport codes, reference prices
│   ├── database/
│   │   └── db.js                       # SQLite schema, queries
│   ├── routes/
│   │   └── flights.js                  # REST API endpoints
│   ├── scrapers/
│   │   ├── index.js                    # Scraper orchestrator
│   │   ├── puppeteerGoogleFlights.js   # Headless Chrome scraper (primary)
│   │   ├── googleFlights.js            # SerpApi wrapper (optional)
│   │   ├── amadeus.js                  # Amadeus API (optional)
│   │   └── kiwi.js                     # Kiwi/Tequila API (optional)
│   ├── services/
│   │   ├── flightMonitor.js            # Search logic, thresholds, scheduler
│   │   └── telegram.js                 # Notification templates
│   └── utils/
├── public/
│   ├── index.html                      # Web dashboard (SPA)
│   └── styles.css
├── data/
│   └── flights.db                      # SQLite database (auto-created)
├── docs/                               # Screenshots for README
├── nixpacks.toml                       # Railway / Nixpacks config
├── railway.json                        # Railway deployment config
├── package.json
├── .env.example
└── LICENSE
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-scraper`)
3. Commit your changes (`git commit -m 'feat: add new scraper source'`)
4. Push to the branch (`git push origin feature/new-scraper`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
