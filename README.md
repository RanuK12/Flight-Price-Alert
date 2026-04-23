# Flight Price Alert Bot v5.0

Telegram bot that monitors flight prices and alerts users when deals drop below their thresholds.

## Stack

- **Runtime:** Node.js 20 + Express
- **Database:** MongoDB Atlas (primary) / SQLite (fallback)
- **Scraper:** Puppeteer + Google Flights API direct
- **Bot:** `node-telegram-bot-api` with polling
- **Deploy:** Render (free tier, dockerized)

## Features

- **Inline calendar** for date picking in `/buscar` and `/nueva_alerta`
- **Paginated dashboard** (`/mis_alertas`) — one alert per page with pause/resume/delete
- **Silent push notifications** — sound only when price crosses below threshold for the first time
- **Rate-limited background monitoring** — max 35 routes/pass, 2s delay between routes, 10s pause every 5 routes
- **Non-blocking scraper** — hard timeout (30s) so health checks never block
- **Self-ping keep-alive** — hits `/health` every 10 min to prevent Render free-tier sleep

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
TELEGRAM_BOT_TOKEN=...
MONGODB_URI=...
AMADEUS_API_KEY=...
AMADEUS_API_SECRET=...
SCRAPER_TIMEOUT_MS=30000
```

## Run Locally

```bash
npm install
npm run dev
```

## Deploy

Push to Render. Set `TELEGRAM_POLLING=true` and `MONGODB_URI` in environment variables.

## License

MIT
