FROM ghcr.io/puppeteer/puppeteer:22.6.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

WORKDIR /home/pptruser/app

# Copiar package files primero (mejor caching)
COPY --chown=pptruser:pptruser package.json package-lock.json* ./

# Instalar dependencias
RUN npm ci --omit=dev || npm install --omit=dev

# Copiar código fuente
COPY --chown=pptruser:pptruser . .

# Puerto para health check
EXPOSE 4000

# Ejecutar el servidor (package.json "start": "node server/app.js")
CMD ["node", "server/app.js"]
