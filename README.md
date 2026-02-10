# Flight Price Alert

Monitor de precios de vuelos entre Europa, USA y Argentina con alertas por Telegram.

Busca ofertas reales en Google Flights usando Puppeteer y envía notificaciones cuando encuentra precios por debajo de los umbrales configurados.

## Qué hace

- Monitorea rutas Europa → Argentina, USA → Argentina (solo ida) y Argentina → Europa (ida y vuelta)
- Ejecuta búsquedas automáticas 3 veces al día (configurable)
- Envía alertas por Telegram solo cuando encuentra ofertas reales
- Alerta separada para vuelos ida+vuelta que están "casi en oferta" (€650–€800)
- Guarda historial de precios en SQLite
- Dashboard web con búsquedas manuales y estadísticas

## Rutas monitoreadas

**Solo ida Europa → Argentina (máx €350)**
Madrid, Barcelona, Roma, París, Frankfurt, Amsterdam, Lisboa, Londres → Buenos Aires

**Solo ida USA → Argentina (máx €200)**
Miami, Nueva York, Orlando → Buenos Aires

**Ida y vuelta Argentina → Europa (máx €600)**
Buenos Aires (EZE) → Madrid, Barcelona, Roma, París, Lisboa
Córdoba (COR) → Madrid, Barcelona, Roma

Además, si un vuelo ida+vuelta está entre €650 y €800, llega una alerta aparte como "casi oferta".

## Fechas de búsqueda

Ventana actual: **25 marzo – 8 abril 2026**. Las fechas rotan automáticamente para no repetir las mismas combinaciones.

## Instalación

```bash
git clone https://github.com/RanuK12/Flight-Price-Alert.git
cd Flight-Price-Alert
npm install
```

## Configuración

Crear un archivo `.env` en la raíz del proyecto:

```env
# Telegram
TELEGRAM_BOT_TOKEN=tu_token
TELEGRAM_CHAT_ID=tu_chat_id

# Monitoreo
AUTO_MONITOR=true
MONITOR_TIMEZONE=Europe/Rome
MONITOR_SCHEDULE=15 8,15,22 * * *

# SerpApi (opcional, para Google Flights API)
SERPAPI_KEY=tu_key
SERPAPI_DAILY_BUDGET=8
SERPAPI_CACHE_TTL_HOURS=12
```

## Uso

```bash
npm start
```

Abre `http://localhost:4000` para el dashboard.

El monitor arranca automáticamente y ejecuta búsquedas a las 08:15, 15:15 y 22:15 (hora Italia). Solo envía mensajes a Telegram cuando encuentra algo.

## Endpoints

```
GET  /api/search?origin=MAD&destination=EZE
GET  /api/deals
GET  /api/routes
GET  /api/monitor/status
POST /api/monitor/start
POST /api/monitor/stop
```

## PoC (Puppeteer)

En la carpeta `poc/` hay un scraper independiente basado en Puppeteer para Google Flights. Incluye test harness, schema de Postgres y su propia documentación.

```bash
node poc/test-harness.mjs
```

## Estructura

```
server/
  services/
    flightMonitor.js    # lógica principal de búsqueda y umbrales
    telegram.js         # plantillas de notificación
  scrapers/             # scrapers (Puppeteer, SerpApi)
  database/             # SQLite
  config/               # rutas y configuración
poc/                    # PoC con Puppeteer + test harness
```

## Licencia

MIT
