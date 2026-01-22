# Usar imagen oficial de Puppeteer que ya tiene Chrome
FROM ghcr.io/puppeteer/puppeteer:22.6.0

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependencias (sin descargar Chrome, ya está en la imagen)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci --only=production

# Copiar código
COPY . .

# El Chrome está en esta ubicación en la imagen de Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Puerto
EXPOSE 3000

# Ejecutar la aplicación web (no el bot)
CMD ["node", "server/app.js"]
