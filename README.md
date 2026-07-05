# Flight Price Alert - Micro Herramienta de Análisis de Precios de Vuelos

Una micro-herramienta minimalista para analizar y comparar precios de vuelos, diseñada para ser vendida como producto empaquetado (productized service).

## 📦 ¿Qué incluye?

- **Análisis de historial de precios**: Registra y analiza la evolución de precios de rutas específicas.
- **Comparación en tiempo real entre rutas**: Compara precios entre diferentes aeropuertos/orígenes/destinos.
- **Alertas por email/Telegram**: Notificaciones cuando el precio cae por debajo de un umbral configurado.

## 🚀 Uso rápido

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/RanuK12/Flight-Price-Alert.git
   cd Flight-Price-Alert
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Configurar `.env` (copiar de `.env.example`):
   ```bash
   cp .env.example .env
   # Editar .env con tus credenciales
   ```

4. Ejecutar el analizador:
   ```bash
   node src/analyzer.js
   ```

## 🛠️ Tecnologías

- Node.js
- Express (API minima)
- Amadeus API (para datos reales)
- MongoDB (historial de precios)
- Telegram Bot (alertas)

## 📊 Estructura del proyecto

```
Flight-Price-Alert/
├── src/
│   ├── analyzer.js       # Lógica de análisis de precios
│   ├── scraper.js        # Scraper para historial
│   ├── comparator.js     # Comparador de rutas
│   └── alert.js          # Gestión de alertas
├── public/
│   ├── index.html        # Landing mínima
│   └── assets/           # CSS/JS estáticos
├── .env.example          # Ejemplo de configuración
└── README.md             # Este archivo
```

## 💰 Modelo de negocio (productized service)

### Opciones de paquete

| Paquete | Precio (USD) | Incluye |
|---------|--------------|---------|
| **Básico** | $99 | Análisis histórico de 1 ruta + 1 alerta |
| **Recomendado** | $199 | Comparativa entre 3 rutas + historial + 5 alertas |
| **Premium** | $499 | Comparativa entre 10 rutas + historial completo + alertas ilimitadas + reporte mensual |

### Ventajas competitivas

- **Precio fijo por resultado**: Sin sorpresas, sin "por hora".
- **Enfoque en valor**: Ahorro real para el cliente (ej: encontrar $300 de diferencia en un vuelo).
- **Recurrente**: Opción de retainer mensual ($49/mes) para seguimiento de rutas.

### Stack reutilizado

- Usa el scraper existente de Amadeus (API propia).
- Landing mínima ya incluida en `public/`.
- Sistema de alertas con Telegram (chatbot simple).

## 🔒 Seguridad

- **SECRETS eliminados**: `.env` no se commitea (`.gitignore` incluido).
- **API Key protegida**: Todas las claves se configuran en entorno, no en código.
- **Rate limiting**: Configurado para Amadeus (8 RPS, presupuesto mensual de $2000).

## 📄 Documentación para venta

- [ARCHITECTURE.md](ARCHITECTURE.md) – Detalles técnicos para compradores técnicos.
- [HANDOFF.md](HANDOFF.md) – Guía de handoff para clientes.
- [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) – Resumen ejecutivo para propuestas.

## 🚀 Próximos pasos (opcionales)

- [ ] Desplegar en Render (plantilla incluida en `render.yaml`).
- [ ] Crear landing page en Next.js para captación.
- [ ] Automatizar generación de PDFs de reportes.
- [ ] Integrar con Stripe para pagos recurrentes.

---

📌 **Nota**: Este es un MVP minimalista para validar demanda. Ideal para vender como servicio empaquetado sin necesidad de construir una plataforma compleja.
