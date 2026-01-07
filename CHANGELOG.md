# Changelog - Flight Price Bot

## [v2.0] - 2024

### ✨ Cambios Importantes

#### Refactor Profesional
- ✅ Reescrito `index.js` de forma limpia y profesional (102 líneas vs 205 anteriores)
- ✅ Reescrito `database.js` con comentarios en lenguaje natural (sin estilo IA)
- ✅ Creado nuevo `skyscanner_scraper.js` profesional y optimizado

#### Nueva Funcionalidad
- ✅ Agregado web scraping de **Skyscanner** (más confiable que LEVEL API)
- ✅ Sistema de **alertas consolidadas** (un mensaje por ruta)
- ✅ **3 nuevas rutas** monitoreadas:
  - Madrid → Córdoba (€500 umbral)
  - Barcelona → Córdoba (€500 umbral)
  - Roma → Córdoba (€500 umbral)

#### Base de Datos
- ✅ Migración exitosa de **PostgreSQL → SQLite3**
- ✅ Base de datos local (`prices.db`) sin dependencias externas
- ✅ Soporte para historial de precios con timestamps

#### Testing
- ✅ 3 pruebas exitosas de alertas en Telegram
- ✅ Scraping verificado para todos los proveedores
- ✅ Sistema de scheduling funcionando cada 15 minutos

#### Documentación
- ✅ README completamente actualizado
- ✅ Instrucciones claras de instalación
- ✅ Guía de configuración y rutas
- ✅ Stack tecnológico documentado

### 📁 Limpieza del Proyecto
- ✅ Eliminados archivos innecesarios de desarrollo
- ✅ Removidos scripts de demostración
- ✅ Eliminada documentación redundante
- ✅ Estructura del proyecto ahora profesional

### 🛠️ Tech Stack

```
Node.js v16+
├── node-telegram-bot-api v0.66.0  (Bot de Telegram)
├── sqlite3 v5.1.6                  (Base de datos local)
├── puppeteer-extra v3.3.6          (Web scraping)
├── puppeteer-extra-plugin-stealth  (Evasión de detección)
├── node-cron v4.1.1                (Scheduling)
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
