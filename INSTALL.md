# 🛫 Flight Price Finder - Guía de Instalación

Instrucciones completas para instalar y ejecutar la aplicación.

## Requisitos Previos

- **Node.js**: v16.0.0 o superior
- **npm**: v7.0.0 o superior  
- **Git**: Para clonar el repositorio
- **Navegador moderno**: Chrome, Firefox, Safari, Edge

### Verificar versiones instaladas

```bash
node --version
npm --version
git --version
```

Si no tienes Node.js instalado, descargarlo desde: https://nodejs.org/

---

## 1️⃣ Instalación

### Paso 1: Clonar el Repositorio

```bash
git clone https://github.com/RanuK12/Flight-Price-Alert.git
cd Flight-Price-Alert
```

### Paso 2: Instalar Dependencias

```bash
npm install
```

Esto instalará todas las dependencias necesarias (~75 paquetes).

**Tiempo estimado**: 2-5 minutos

> **Nota**: Si hay advertencias sobre vulnerabilidades, es seguro ignorarlas por ahora. Son vulnerabilidades de dependencias opcionales.

### Paso 3: Configurar Variables de Entorno

Copiar el archivo de ejemplo:

```bash
cp .env.example .env
```

Editar `.env` con tus configuraciones:

```env
# Puerto del servidor (por defecto 3000)
PORT=3000

# Entorno de desarrollo
NODE_ENV=development

# Telegram (opcional - dejar vacío si no lo usas)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ENABLE_CRON=false

# Otros parámetros
PRICE_THRESHOLD_EUR=500
SCRAPER_TIMEOUT=45000
MAX_RETRIES=2
CORS_ORIGIN=*
```

---

## 2️⃣ Primeras Pruebas

### Opción A: Ejecutar Demo Script (Recomendado)

```bash
npm run demo
```

Esto ejecutará:
- ✓ Inicialización de base de datos
- ✓ Pruebas de scraping en 3 rutas
- ✓ Validación de guardado en BD
- ✓ Estadísticas de datos

### Opción B: Ejecutar Tests

```bash
npm test
```

Para tests específicos:

```bash
npm run test:scraper
npm run test:api
npm run test:db
```

---

## 3️⃣ Iniciar la Aplicación

```bash
npm start
```

Deberías ver:

```
✅ Base de datos conectada
✅ Esquema de base de datos inicializado

🛫 Inicializando Flight Price App v2.0...

✅ Servidor ejecutándose en http://localhost:3000
📡 API disponible en http://localhost:3000/api
🎨 Interfaz en http://localhost:3000
```

---

## 4️⃣ Acceder a la Aplicación

Abre tu navegador en: **http://localhost:3000**

Verás:
- 🔍 Barra de búsqueda de vuelos
- ✈️ Rutas populares (botones de acceso rápido)
- 📊 Comparación de precios por fuente
- 💾 Alertas guardadas
- 📜 Historial de búsquedas

---

## 🧪 Uso de la API (Avanzado)

### Buscar Vuelos

```bash
curl "http://localhost:3000/api/search?origin=MAD&destination=AEP"
```

Respuesta:
```json
{
  "origin": "MAD",
  "destination": "AEP",
  "minPrice": 480,
  "sources": [...],
  "allFlights": [...]
}
```

### Crear Alerta

```bash
curl -X POST http://localhost:3000/api/alert \
  -H "Content-Type: application/json" \
  -d '{"origin":"MAD","destination":"AEP","threshold":500}'
```

### Ver Alertas

```bash
curl "http://localhost:3000/api/alerts"
```

---

## 🔧 Solución de Problemas

### Puerto 3000 ya en uso

Si tienes otro programa usando el puerto 3000:

**Opción 1**: Usar otro puerto
```env
PORT=3001
```

**Opción 2**: Ver qué usa el puerto
```bash
# Windows
netstat -ano | findstr :3000

# Mac/Linux  
lsof -i :3000
```

### "Módulo no encontrado"

Si ves error como `Cannot find module 'express'`:

```bash
rm -rf node_modules
rm package-lock.json
npm install
```

### Base de datos corrupta

Si tienes errores de BD:

```bash
rm data/flights.db
npm start  # Se recrea automáticamente
```

### Puppeteer no descarga Chromium

```bash
npm install puppeteer-extra --save-dev
```

### La app es muy lenta

- Aumentar `SCRAPER_TIMEOUT` en `.env`
- Reducir cantidad de scrapers activos
- Verificar conexión a internet

---

## 📚 Comandos Disponibles

```bash
npm start          # Inicia el servidor
npm test           # Ejecuta todos los tests
npm run demo       # Ejecuta demo con pruebas
npm run test:scraper  # Tests de scrapers
npm run test:api      # Tests de API
npm run test:db       # Tests de BD
```

---

## 🔌 Integración con Telegram Bot (Opcional)

1. Crear bot con @BotFather en Telegram
2. Obtener token y chat ID
3. Configurar en `.env`:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJ...
TELEGRAM_CHAT_ID=987654321
ENABLE_CRON=true
```

---

## 🌐 Desplegar en Producción

### Opción 1: Heroku

```bash
git push heroku main
```

### Opción 2: DigitalOcean

1. Crear droplet Ubuntu 20.04
2. Instalar Node.js
3. Clonar repositorio
4. `npm install && npm start`

### Opción 3: AWS EC2

Similar a DigitalOcean, con configuración de seguridad adicional.

---

## 📖 Próximos Pasos

- [ ] Explorar la interfaz web
- [ ] Crear alertas para tus rutas favoritas
- [ ] Consultar la documentación de API
- [ ] Extender con nuevas fuentes de scraping
- [ ] Conectar Telegram bot

---

## 💬 Soporte

Si tienes problemas:

1. Verificar los logs en la consola
2. Consultar [Troubleshooting](#-solución-de-problemas) arriba
3. Abrir issue en: https://github.com/RanuK12/Flight-Price-Alert/issues

---

**¡Disfruta buscando vuelos baratos!** ✈️
