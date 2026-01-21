# Dockerfile para Flight Deal Bot con Puppeteer
FROM ghcr.io/puppeteer/puppeteer:22.6.0

WORKDIR /app

# Copiar package.json
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar código
COPY . .

# Variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Ejecutar bot
CMD ["node", "bot.js"]
