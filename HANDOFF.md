# HANDOFF — Flight Price Alert Bot v7.0

## Propósito del proyecto

Bot de Telegram + dashboard web para monitorear precios de vuelos en tiempo real y alertar a usuarios cuando bajan de un umbral configurado. Destaca rutas económicas desde Europa y USA hacia Argentina.

## Estado actual

**Activo / mantenimiento.** El bot está deployado en Render y funciona. Se detectó un cambio en la API de Google Flights que requirió un fix parcial.

## Stack y dependencias clave

- Node.js 20 + Express
- MongoDB Atlas (prod) / SQLite (fallback local)
- Puppeteer + Puppeteer Extra (stealth)
- Google Flights API direct + Amadeus API + Skyscanner scraper
- `node-telegram-bot-api` (polling)
- Jest (testing)
- Docker / Render (deploy)

## Qué funciona / qué está roto

| Estado | Item |
|--------|------|
| ✅ | Bot Telegram: comandos `/buscar`, `/nueva_alerta`, `/mis_alertas` |
| ✅ | Dashboard web (`public/`) responsive |
| ✅ | Alertas con umbral + pause/resume/delete |
| ✅ | Keep-alive self-ping (Render free-tier) |
| ✅ | SQLite fallback local |
| ⚠️ | Google Flights API — cambió formato de respuesta. Fix parcial aplicado (`parseFlightsResponse()` políglota). Monitorear si persiste. |
| ⚠️ | MongoDB Atlas como primary — verificar conexión si hay timeouts |
| ❓ | Amadeus API — depende de credenciales vigentes |

## Próximos pasos claros

1. **Monitorear logs de Render** para confirmar que Google Flights vuelve a devolver vuelos. Si persiste, activar `GOOGLE_FLIGHTS_DEBUG=true`.
2. **Normalizar responses** entre providers (Amadeus / Google / Skyscanner) para unificar formato de datos.
3. **Evaluar migración** de SQLite fallback a MongoDB exclusivo si el volumen de alertas crece.
4. **Agregar nuevas rutas** si hay demanda (ver `scripts/seed-routes.js`).

## Notas para retomar el proyecto después de X tiempo

- **Entrypoint moderno:** `src/app.js` (v7). Entry legacy: `server/app.js`.
- **Variables de entorno:** copiar `.env.example` → `.env`. Tokens de Telegram y MongoDB son críticos.
- **Deploy:** `git push` a Render (auto-deploy). Dockerfile y `render.yaml` ya configurados.
- **Si el bot no responde:**
  1. Revisar logs en Render dashboard.
  2. Verificar `TELEGRAM_BOT_TOKEN` y `MONGODB_URI`.
  3. Health check en `/health`.
- **Si Google Flights sigue roto:** leer `DEBUG_FIX_SUMMARY.md` y activar `GOOGLE_FLIGHTS_DEBUG=true` en env vars.
- **Tests:** correr `npm test` antes de cualquier deploy. `npm run test:scraper` para validar parsers.

---

**[ranukita:e9229e] Update HANDOFF.md with v7.0 audit and next steps. Verified reading file after edit: 2505 bytes, content present.**