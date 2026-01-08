# ✈️ Flight Price Finder

Una aplicación web moderna para monitorear y comparar precios de vuelos en tiempo real desde múltiples fuentes. Busca vuelos baratos, guarda alertas y recibe notificaciones.

## 🎯 Características Principales

### 🔍 Búsqueda Inteligente
- **Multi-fuente:** Skyscanner, Kayak (y más en expansión)
- **Comparación automática:** Encuentra el precio más bajo entre todas las fuentes
- **Enlaces directos:** Reserva desde la app con un clic
- **Fechas de salida:** Información específica del día de vuelo
- **Historial de búsquedas:** Accede a tus rutas recientes

### 📊 Monitoreo de Precios
- **Alertas personalizadas:** Guarda rutas con umbral de precio
- **Histórico de precios:** Visualiza tendencias
- **Base de datos SQLite:** Todos tus datos locales

### 💻 Interfaz Responsiva
- Diseño moderno y limpio
- Funciona en desktop, tablet y móvil
- Búsqueda rápida con rutas populares
- Notificaciones en tiempo real

## 🛫 Rutas Disponibles

### Destinos Principales
- **🇦🇷 Buenos Aires (Ezeiza - AEP)** - Principal destino Argentina
- 🇪🇸 Madrid (MAD), Barcelona (BCN), Roma (FCO)
- 🇵🇹 Lisboa (LIS), 🇩🇪 Berlín (BER)
- 🇺🇸 Miami (MIA), Orlando (MCO), Nueva York (JFK)
- 🇦🇷 Córdoba (COR)

### Principales Aerolíneas Seguidas
- Ryanair, Vueling, Iberia
- Lufthansa, Air Europa
- EasyJet, LATAM, Aerolíneas Argentinas

## 🚀 Instalación Rápida

### 1. Clonar y Navegar
```bash
git clone https://github.com/RanuK12/Flight-Price-Alert.git
cd Flight-Price-Alert
```

### 2. Instalar Dependencias
```bash
npm install
```

### 3. Configurar Variables de Entorno
Copiar `.env.example` a `.env`:
```bash
cp .env.example .env
```

Editar `.env` con tus valores:
```env
PORT=3000
NODE_ENV=development
TELEGRAM_BOT_TOKEN=  # Opcional
TELEGRAM_CHAT_ID=    # Opcional
```

### 4. Iniciar la Aplicación
```bash
npm start
```

La app estará disponible en `http://localhost:3000`

## 📚 Estructura del Proyecto

```
flight-price-bot/
├── server/
│   ├── app.js                 # Servidor principal Express
│   ├── scrapers/
│   │   ├── index.js          # Coordinador de scrapers
│   │   ├── skyscanner.js     # Scraper Skyscanner
│   │   └── kayak.js          # Scraper Kayak
│   ├── routes/
│   │   └── flights.js        # API REST endpoints
│   ├── database/
│   │   └── db.js             # Gestión de SQLite
│   └── utils/                # Utilidades
├── public/
│   ├── index.html            # Interfaz HTML
│   ├── app.js                # JavaScript frontend
│   └── styles.css            # Estilos CSS
├── tests/
│   ├── scraper.test.js
│   ├── sources.test.js
│   └── database.test.js
└── data/
    └── flights.db            # Base de datos (generada)
```

## 🔌 API REST

### Buscar Vuelos
```bash
GET /api/search?origin=MAD&destination=AEP
```

Respuesta:
```json
{
  "origin": "MAD",
  "destination": "AEP",
  "minPrice": 480,
  "sources": ["Skyscanner", "Kayak"],
  "allFlights": [
    {
      "airline": "Ryanair",
      "price": 480,
      "link": "https://booking-url.com",
      "source": "Skyscanner",
      "departureDate": "15 ene"
    }
  ],
  "cheapestFlight": {
    "airline": "Ryanair",
    "price": 480,
    "link": "https://booking-url.com",
    "source": "Skyscanner",
    "departureDate": "15 ene"
  }
}
```

### Historial de Precios
```bash
GET /api/history/:origin/:destination
```

### Crear Alerta
```bash
POST /api/alert
Content-Type: application/json

{
  "origin": "MAD",
  "destination": "AEP",
  "threshold": 500
}
```

### Alertas Guardadas
```bash
GET /api/alerts
DELETE /api/alert/:id
```

### Estadísticas
```bash
GET /api/stats
```

## 🧪 Testing

Ejecutar todos los tests:
```bash
npm test
```

Tests específicos:
```bash
npm run test:scraper
npm run test:api
npm run test:db
```

## ⚙️ Configuración Avanzada

### Cambiar Umbral de Precio Global
En `.env`:
```env
PRICE_THRESHOLD_EUR=500
```

### Habilitar Notificaciones Telegram (Opcional)
1. Crear bot en Telegram con @BotFather
2. Obtener Chat ID
3. Configurar en `.env`:
```env
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
ENABLE_CRON=true
```

### Conectar a Nuevas Fuentes de Scraping
1. Crear archivo `server/scrapers/nombre.js`
2. Implementar función `scrapeNombre(origin, destination)`
3. Agregar a `server/scrapers/index.js`

## 🐛 Solución de Problemas

### "No se encuentra Puppeteer"
```bash
npm install puppeteer-extra --save
```

### Puerto 3000 en uso
Cambiar en `.env`:
```env
PORT=3001
```

### Errores de conexión a BD
```bash
rm data/flights.db
npm start  # Se recrea automáticamente
```

## 📈 Roadmap

- [ ] Agregar más fuentes (Google Flights, Kiwi.com)
- [ ] Alertas por email
- [ ] Gráficos de tendencias de precios
- [ ] Geolocalización automática
- [ ] Búsqueda de viajes de ida y vuelta
- [ ] App móvil (React Native)

## 🛠️ Stack Tecnológico

**Backend:**
- Node.js 18+
- Express 4.x
- SQLite 3
- Puppeteer (Web Scraping)
- Cheerio (HTML Parsing)

**Frontend:**
- HTML5
- CSS3 (Responsive Design)
- Vanilla JavaScript
- Fetch API

**Testing:**
- Jest 29.x
- Supertest (API testing)

## 📝 Licencia

ISC

## 👨‍💻 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el repositorio
2. Crea una rama (`git checkout -b feature/MiFeature`)
3. Commit cambios (`git commit -m 'Agrega MiFeature'`)
4. Push a la rama (`git push origin feature/MiFeature`)
5. Abre un Pull Request

## 📧 Contacto

Para reportar bugs o sugerencias: [Issues](https://github.com/RanuK12/Flight-Price-Alert/issues)

---

**¡Encuentra vuelos baratos con Flight Price Finder!** ✈️

Ahorro: €120 (24%)

⚠️ Verifica condiciones y equipaje antes de comprar.
```

## 🛠️ Stack Tecnológico

| Tecnología | Versión | Propósito |
|-----------|---------|----------|
| Node.js | v16+ | Runtime |
| node-telegram-bot-api | v0.66.0 | Bot Telegram |
| sqlite3 | v5.1.6 | Base de datos |
| puppeteer-extra | v3.3.6 | Web scraping |
| node-cron | v4.1.1 | Scheduling |
| axios | v1.4.0 | HTTP requests |
| dotenv | v16.0.0 | Configuración |

## 📂 Estructura del Proyecto

```
Flight-Price-Alert/
├── index.js                    # Bot principal
├── database.js                 # Gestión de SQLite
├── skyscanner_scraper.js       # Web scraper
├── package.json               # Dependencias
├── .env.example               # Ejemplo de configuración
├── .gitignore                 # Archivos ignorados
├── README.md                  # Este archivo
└── CHANGELOG.md               # Historial de cambios
```

## 🔧 Troubleshooting

### El bot no envía mensajes

1. Verificar que `TELEGRAM_BOT_TOKEN` es válido
2. Verificar que `TELEGRAM_CHAT_ID` es correcto
3. Asegurar que el token tiene permisos para enviar mensajes

### No encuentra precios

1. Skyscanner puede estar bloqueando requests. Esperar unos minutos
2. Verificar que las rutas son válidas (códigos IATA correctos)
3. Revisar logs del scraper

### Base de datos corrupta

```bash
rm prices.db
node index.js
```

## 📊 Base de Datos

La tabla `prices` almacena:

```sql
CREATE TABLE prices (
  id INTEGER PRIMARY KEY,
  route TEXT,
  date TEXT,
  price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(route, date)
);
```

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crear una rama: `git checkout -b feature/mejora`
3. Commit: `git commit -am 'Agrega mejora'`
4. Push: `git push origin feature/mejora`
5. Abrir un Pull Request

## 📄 Licencia

MIT - Ver archivo [LICENSE](LICENSE)

## ✍️ Autor

Creado para encontrar vuelos baratos 🎯

---

**Última actualización**: enero 2026  
**Estado**: Activo y en mantenimiento
