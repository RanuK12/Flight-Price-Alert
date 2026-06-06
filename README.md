# Flight Price Alert Bot v7.0

Telegram bot + web app que monitorea precios de vuelos全年全年 (todo el año) Argentina ↔ Europa y alerta cuando aparecen ofertas baratas.

## Descripción

Bot híbrido que combina scraping en tiempo real (Google Flights, Skyscanner) con Amadeus API y alertas vía Telegram. **30 destinos en Europa, 5 orígenes en Argentina**, monitoreo continuo de 12 meses rolling con 4 fechas/mes por ruta.

## Stack

- **Runtime:** Node.js 20 + Express
- **Database:** MongoDB Atlas (primary) / SQLite (fallback local)
- **Scraper:** Puppeteer + Google Flights API direct + Amadeus API
- **Bot:** `node-telegram-bot-api` con polling
- **Testing:** Jest
- **Deploy:** Render (free tier, dockerizado)

## Estructura de carpetas

```
Flight-Price-Alert/
├── src/app.js                 ← entrypoint moderno (v7)
├── src/bootstrap/
│   ├── migrateRoutesV7.js     ← v7: 30 EU dest, rolling 12mo dates
│   └── ...                    ← v2-v6 legacy migrations
├── server/
│   └── app.js                 ← servidor legacy (compatibilidad)
├── public/
│   ├── index.html             ← dashboard web
│   ├── app.js                 ← frontend vanilla JS
│   └── styles.css             ← estilos
├── tests/
│   ├── parser.regression.test.js
│   └── sanityCheck.test.js
├── scripts/
│   ├── demo.js                ← demo rápido
│   ├── seed-routes.js         ← seed de rutas
│   ├── backfill-alert-level.js
│   ├── cleanup-poisoned-notifs.js
│   ├── canary-google-flights.js
│   └── test-*.js              ← tests auxiliares
├── data/
│   └── flights.db             ← SQLite local (auto-generada)
├── docs/
│   ├── README.md
│   └── RUNBOOK.md
├── Dockerfile
├── render.yaml                ← config de deploy en Render
├── nixpacks.toml
├── package.json
├── .env.example
└── (docs internos: ARCHITECTURE.md, INSTALL.md, PROJECT_SUMMARY.md, DEBUG_FIX_SUMMARY.md)
```

## Features

- **Inline calendar** para elegir fechas en `/buscar` y `/nueva_alerta`
- **Paginated dashboard** (`/mis_alertas`) — una alerta por página con pause/resume/delete
- **Silent push notifications** — suena solo cuando el precio cruza el umbral por primera vez
- **Rate-limited background monitoring** — máx 60 rutas/paso, 2s delay entre rutas, 10s pausa cada 5 rutas
- **Non-blocking scraper** — hard timeout (30s) para que los health checks nunca bloqueen
- **Self-ping keep-alive** — golpea `/health` cada 10 min para prevenir sleep de Render free-tier

## Cómo correrlo localmente

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus tokens (Telegram, MongoDB, Amadeus)

# 3. Modo desarrollo
npm run dev
# o
npm start
```

La app corre en `http://localhost:3000`. El dashboard web está en `/` y la API en `/api`.

### Tests

```bash
npm test                      # todos los tests
npm run test:scraper          # tests de scrapers
npm run test:api              # tests de API
npm run test:db               # tests de base de datos
```

## Deploy

### Render (recomendado)

✅ **Estrategia global AR↔EU v7.0 activa** (rolling 12 meses). 30 destinos EU, 5 orígenes AR, 4 fechas/mes.

Umbrales:
- AR → EU solo ida: ≤ €500
- EU → AR solo ida: ≤ €400
- Roundtrip AR ↔ EU: ≤ €800

1. Conectar repo a Render
2. Setear variables de entorno en dashboard:
   - `TELEGRAM_POLLING=true`
   - `MONGODB_URI=...`
   - `TELEGRAM_BOT_TOKEN=...`
3. Render auto-deploy en cada push

### Docker local

```bash
docker build -t flight-price-alert .
docker run -p 3000:3000 --env-file .env flight-price-alert
```

## Estado actual

- ✅ Bot Telegram operativo (comandos `/buscar`, `/nueva_alerta`, `/mis_alertas`)
- ✅ Dashboard web funcional
- ✅ Scrapers de Skyscanner y Amadeus activos
- ✅ **v7.0**: 30 destinos EU, 5 orígenes AR, fechas rolling 12 meses
- ⚠️ Google Flights API cambió su formato de respuesta (ver `DEBUG_FIX_SUMMARY.md`).
- 🔄 Pendiente: normalizar responses entre providers (Amadeus / Google / Skyscanner)

## Environment Variables

Copiar `.env.example` a `.env` y completar:

```bash
TELEGRAM_BOT_TOKEN=...
MONGODB_URI=...
AMADEUS_API_KEY=...
AMADEUS_API_SECRET=...
SCRAPER_TIMEOUT_MS=30000
```

## License

MIT — © 2026 Ranuk IT Solutions | ranuk.dev
