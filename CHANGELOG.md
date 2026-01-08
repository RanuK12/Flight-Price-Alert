# Changelog - Flight Price Finder

## [2.0.0] - 2025-01-08 🚀 MAJOR RELEASE

### 🎉 Complete Application Redesign: Bot → Web Application

#### 🌐 New Web Application
- ✅ Full-featured responsive web app with modern UI/UX
- ✅ Express.js backend with REST API
- ✅ Real-time flight search and price comparison
- ✅ Interactive dashboard with saved routes and alerts
- ✅ Search history and price tracking

#### 📍 Expanded Route Coverage
- **Argentina**: Buenos Aires (AEP-Ezeiza) as primary destination
- **Europe (Budget-Friendly)**: Lisboa (LIS), Berlín (BER)
- **USA (Direct Connections)**: Miami (MIA), Orlando (MCO), Nueva York (JFK)
- **Existing**: Madrid, Barcelona, Roma, Córdoba

#### 🔍 Multi-Source Scraping
- ✅ Skyscanner integration (primary source)
- ✅ Kayak integration (price comparison)
- ✅ Automatic price aggregation across sources
- ✅ Direct booking links from each provider

#### 💾 Enhanced Database
- ✅ Modular SQLite schema (flight_prices, saved_routes, alerts, search_history)
- ✅ Automatic price history tracking
- ✅ Custom alert thresholds per route
- ✅ Search statistics and analytics

#### 🧪 Testing & Quality
- ✅ Comprehensive Jest test suite
- ✅ Scraper validation tests
- ✅ API endpoint tests
- ✅ Database operation tests
- ✅ Demo script for functionality validation

#### 📚 Documentation
- ✅ Complete README with API documentation
- ✅ ARCHITECTURE.md with system design
- ✅ Installation and setup guide
- ✅ Troubleshooting section
- ✅ Developer guide for extending functionality

#### 🛠️ Technical Stack
```
Backend:
├── Node.js + Express.js
├── SQLite3 (local database)
├── Puppeteer + Cheerio (web scraping)
└── CORS + dotenv

Frontend:
├── HTML5 + CSS3 (responsive design)
├── Vanilla JavaScript (no heavy frameworks)
├── Fetch API (REST communication)
└── Mobile-optimized UI

Testing:
├── Jest framework
├── Integration tests
└── End-to-end validation
```

### 🎯 Key Improvements Over v1.0

| Feature | v1.0 (Bot) | v2.0 (App) |
|---------|-----------|-----------|
| Interface | Telegram Only | Web + Optional Bot |
| Sources | Skyscanner | Skyscanner + Kayak |
| Routes | 6 routes | 20+ routes |
| Price Comparison | Single source | Multi-source |
| User Experience | Chat-based | Dashboard UI |
| Mobile Support | Via Telegram | Fully responsive |
| Alerts | Passive notifications | Active dashboard |
| Data Visualization | None | Price trends |
| Booking | Links in messages | Direct integration |

## [1.0.0] - 2024-12-15 (Previous)

### Initial Release
- Telegram bot for flight price monitoring
- Skyscanner web scraping
- SQLite database for price history
- Automatic checks every 15 minutes
- Alert notifications via Telegram
- Spain-Córdoba routes support
├── axios v1.4.0                    (HTTP requests)
└── dotenv v16.0.0                  (Configuración)
```

### 📊 Estadísticas del Refactor

| Métrica | Antes | Después |
|---------|-------|---------|
| Líneas en index.js | 205 | 102 |
| Archivos de desarrollo | 50+ | 18 |
| Complejidad ciclomática | Alta | Baja |
| Documentación | Incompleta | Completa |
| Código tipo IA | Sí | No |

### 🎯 Próximos Pasos (Sugerencias)

- [ ] Agregar más rutas según necesidad
- [ ] Implementar descuentos históricos
- [ ] Dashboard web para visualizar precios
- [ ] Notifications en Discord adicionales
- [ ] Base de datos remota (opcional)

---

**Creado:** 2024
**Autor:** Sistema de Alertas de Vuelos
**Licencia:** MIT
