# ✈️ Flight Deal Finder

Buscador inteligente de ofertas de vuelos desde Europa hacia Argentina y Estados Unidos. Monitorea continuamente los precios y te notifica por Telegram cuando encuentra gangas (precios significativamente por debajo de lo habitual).

## 🎯 Características

- **🔍 Búsqueda Real de Vuelos** - Usa Google Flights API (vía SerpApi) para obtener precios reales
- **📊 Detección de Ofertas** - Compara contra precios típicos para detectar gangas
- **📱 Alertas Telegram** - Notificaciones instantáneas cuando se encuentra una oferta
- **🕐 Monitoreo Continuo** - Búsqueda automática cada 4 horas (configurable)
- **💾 Base de Datos** - Guarda historial de precios y ofertas encontradas
- **🌐 Interfaz Web** - Dashboard moderno para búsquedas manuales y gestión

## 🗺️ Rutas Monitoreadas

### Europa → Argentina
- Madrid (MAD) → Buenos Aires (EZE)
- Barcelona (BCN) → Buenos Aires (EZE)
- París (CDG) → Buenos Aires (EZE)
- Roma (FCO) → Buenos Aires (EZE)
- Lisboa (LIS) → Buenos Aires (EZE)
- Frankfurt (FRA) → Buenos Aires (EZE)
- Y más...

### Europa → Estados Unidos
- Madrid (MAD) → New York (JFK), Miami (MIA), Los Angeles (LAX)
- Barcelona (BCN) → New York (JFK), Miami (MIA)
- Londres (LHR) → New York (JFK), Los Angeles (LAX)
- Y más...

## 🚀 Instalación

### 1. Clonar el repositorio
```bash
git clone https://github.com/tu-usuario/flight-deal-finder.git
cd flight-deal-finder
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
```bash
cp .env.example .env
```

Edita el archivo `.env`:
```env
# API de Google Flights (SerpApi)
SERPAPI_KEY=tu_api_key

# Telegram
TELEGRAM_BOT_TOKEN=tu_bot_token
TELEGRAM_CHAT_ID=tu_chat_id

# Iniciar monitor automáticamente
AUTO_MONITOR=true
```

### 4. Iniciar la aplicación
```bash
npm start
```

Accede a `http://localhost:3000`

## 📱 Configurar Telegram

1. **Crear bot:** Habla con [@BotFather](https://t.me/botfather) y crea un nuevo bot
2. **Obtener token:** BotFather te dará el token del bot
3. **Obtener chat_id:** Habla con [@userinfobot](https://t.me/userinfobot) para obtener tu ID
4. **Configurar:** Agrega los valores al archivo `.env`

## 🔑 Obtener API Key de SerpApi

1. Regístrate en [SerpApi.com](https://serpapi.com/)
2. El plan gratuito incluye **250 búsquedas/mes**
3. Copia tu API key y agrégala al `.env`

> **Sin API key:** La aplicación funcionará en **modo simulación** con precios ficticios (útil para pruebas)

## 📊 Niveles de Oferta

| Nivel | Descripción | Notificación |
|-------|-------------|--------------|
| 🔥🔥🔥 GANGA | 30%+ por debajo del precio de oferta | Telegram + Web |
| 🔥🔥 MUY BUENA | Por debajo del precio de oferta | Telegram + Web |
| 🔥 BUENA | Por debajo del precio típico | Solo Web |

## 🖥️ API Endpoints

```
GET  /api/search?origin=MAD&destination=EZE&date=2025-03-15
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

## 🏗️ Estructura del Proyecto

```
flight-deal-finder/
├── server/
│   ├── app.js                 # Servidor Express
│   ├── config/
│   │   └── routes.js          # Rutas y umbrales de precio
│   ├── database/
│   │   └── db.js              # SQLite operations
│   ├── routes/
│   │   └── flights.js         # API endpoints
│   ├── scrapers/
│   │   └── googleFlights.js   # SerpApi integration
│   └── services/
│       ├── flightMonitor.js   # Monitoring service
│       └── telegram.js        # Telegram notifications
├── public/
│   └── index.html             # Web interface
├── data/                      # SQLite database
└── .env                       # Configuration
```

## 🚢 Despliegue en Servidor

### Usando PM2
```bash
npm install -g pm2
pm2 start server/app.js --name flight-finder
pm2 save
pm2 startup
```

### Variables de entorno para producción
```env
AUTO_MONITOR=true
MONITOR_SCHEDULE=0 */4 * * *
```

## 📝 Notas Importantes

- **250 búsquedas/mes gratis** con SerpApi - suficiente para ~6 búsquedas/día
- El monitor busca rutas de forma escalonada para no consumir todas las búsquedas
- Los precios de referencia están calibrados para vuelos en clase económica
- Las fechas de búsqueda se generan automáticamente (próximas 8-12 semanas)

## 🤝 Contribuir

1. Fork el repositorio
2. Crea tu rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Añadir nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

MIT License - ver archivo [LICENSE](LICENSE)
