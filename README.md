# 🛫 Flight Price Alert Bot

Bot automatizado para monitorear precios de vuelos y enviar alertas por Telegram cuando encuentras ofertas baratas.

## ✨ Características

- ✅ **Monitoreo automático** cada 15 minutos
- ✅ **Web scraping** de Skyscanner en tiempo real
- ✅ **Alertas por Telegram** consolidadas
- ✅ **Base de datos SQLite** para historial
- ✅ **Código profesional** y mantenible
- ✅ **Fácil configuración** con variables de entorno

## 🛣️ Rutas Monitoreadas

| Origen | Destino | Umbral |
|--------|---------|--------|
| MAD | COR | €500 |
| BCN | COR | €500 |
| FCO | COR | €500 |

## 🚀 Instalación Rápida

### 1. Clonar el repositorio

```bash
git clone https://github.com/RanuK12/Flight-Price-Alert.git
cd Flight-Price-Alert
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crear archivo `.env`:

```env
TELEGRAM_BOT_TOKEN=tu_token_aqui
TELEGRAM_CHAT_ID=tu_chat_id_aqui
PRICE_THRESHOLD=500
```

### 4. Ejecutar el bot

```bash
node index.js
```

El bot iniciará y verificará precios automáticamente cada 15 minutos.

## ⚙️ Configuración

### Cambiar rutas monitoreadas

Editar `index.js` y modificar el array `routes`:

```javascript
const routes = [
  { origin: 'MAD', destination: 'COR', name: 'Madrid → Córdoba' },
  { origin: 'BCN', destination: 'COR', name: 'Barcelona → Córdoba' },
  { origin: 'FCO', destination: 'COR', name: 'Roma → Córdoba' },
];
```

### Cambiar umbral de precio

En `.env`:
```env
PRICE_THRESHOLD=500  # Cambiar a tu valor deseado en EUR
```

### Cambiar frecuencia de verificación

En `index.js`, modificar la expresión cron:

```javascript
// Cada 15 minutos (actual)
cron.schedule('*/15 * * * *', () => { checkPrices(); });

// Cada 30 minutos
cron.schedule('*/30 * * * *', () => { checkPrices(); });

// Cada hora
cron.schedule('0 * * * *', () => { checkPrices(); });
```

## 📱 Formato de Alertas

Cuando se encuentra un vuelo barato:

```
✈️ ALERTA DE VUELO BARATO

Ruta: Madrid → Córdoba
Precio: €380 EUR
Umbral: €500 EUR
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
