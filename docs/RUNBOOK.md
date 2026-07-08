# RUNBOOK — Post-merge de PR #6 (fix false-positive alerts)

Este documento describe los pasos manuales que el operador debe ejecutar
**después** de mergear la PR #6 (`fix/false-positive-alerts`) a `main`.

Todos los comandos asumen:

- Repositorio: `RanuK12/Flight-Price-Alert`.
- Shell: bash/zsh en la máquina del operador, con `.env` local cargado
  o las variables exportadas.
- Acceso a:
  - MongoDB Atlas (cadena en `MONGODB_URI`).
  - El bot de Telegram del proyecto.
  - Render dashboard del servicio.

---

## 3.1 — Verificación del deploy automático de Render

Después de que `main` reciba la PR, Render dispara un build y redeploy
automático. Para confirmar que el proceso está corriendo con el código
nuevo:

1. Entrar al dashboard del servicio en Render → pestaña **Logs**.
2. Buscar estas dos líneas (en orden, cerca del arranque):

   ```
   [app] Booting Flight Deal Bot v5.0
   [app] MongoDB connected (primary storage)
   ```

   La primera confirma que el proceso arrancó. La segunda confirma
   conexión a Mongo.

3. Confirmar que el **commit SHA** que aparece en el panel superior de
   Render coincide con el head de `main` en GitHub (merge commit de
   la PR #6, `e53f5b3` o posterior).

4. Buscar al menos una de estas dos líneas, que **solo emite el código
   nuevo** y funciona como "fingerprint" del deploy:

   - `[notifier] Sanity check failed, skip notify` — cualquier
     tick del alert engine con una oferta envenenada la emite.
   - `[dailyReport] DailyReport: filtered out poisoned notifs` —
     cualquier corrida del reporte diario con al menos una notif
     envenenada la emite.

   Si ninguna aparece en ~30 minutos **y** la DB tiene notifs
   envenenadas (ver 3.3), probablemente Render está sirviendo código
   viejo o el deploy falló. En ese caso: **Manual Deploy → Clear
   build cache & deploy**.

---

## 3.2 — Backup de notificaciones antes del cleanup

**Obligatorio antes de correr 3.3 con `--apply`**. El cleanup borra
documentos; no hay undo.

```bash
# 1. Exportar URI desde el entorno (o usar la del dashboard Atlas).
#    Debe ser la URI completa con credenciales y ?authSource=admin.
export MONGODB_URI='mongodb+srv://<TU_USUARIO>:<TU_PASSWORD>@CLUSTER.mongodb.net/flightdeals?retryWrites=true&w=majority'

# 2. Crear directorio de backup con timestamp.
BACKUP_DIR="backups/notifications-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 3. Dump de la collection notifications.
mongodump \
  --uri="$MONGODB_URI" \
  --collection=notifications \
  --out="$BACKUP_DIR"

# 4. Verificar tamaño.
ls -lh "$BACKUP_DIR"/*/notifications.bson
```

**Dónde guardarlo:** mantener el directorio `backups/` fuera del repo
(ya está en `.gitignore` si existe; si no, agregalo). Subir el tarball
a un bucket / Google Drive privado si el backup es crítico. Retener al
menos 30 días.

Para restaurar (solo en caso de emergencia):

```bash
mongorestore \
  --uri="$MONGODB_URI" \
  --nsInclude='flightdeals.notifications' \
  --drop \
  "$BACKUP_DIR"
```

> `--drop` elimina la collection actual antes de restaurar. Usar con
> cuidado.

---

## 3.3 — Cleanup de notifs envenenadas

El script usa `sanityCheck` en modo `skipHistorical=true` (capas 1 y 2
solamente: hard-floor absoluto + thresholds de rutas conocidas). Es
idempotente: correrlo dos veces es seguro.

### 3.3.1 — Dry-run (obligatorio primero)

```bash
npm run cleanup:poisoned-notifs
# equivalente a: node scripts/cleanup-poisoned-notifs.js
```

Salida esperada (ejemplo):

```
📋 Total de notifs en DB: 1234
   Modo: 👀 DRY-RUN (solo reporta)

────────────────────────────────────────────────────────────────────────
Muestras (max 15):
  [BLOCK     ] EZE→MAD 2026-05-13/OW 155USD — hard_floor_longhaul_ow(<250)
  [QUARANTINE] EZE→MAD 2026-07-01/OW 380EUR — threshold_floor(<60% steal)
  ...
Resumen:
  ✓ Conservadas:                 1100
  ⚠️  A cuarentenar (verifReq=true): 98
  🗑  A borrar (precio imposible):  36
```

### 3.3.2 — Interpretación de las muestras

- **`[BLOCK]`** → capa 1 (hard floor absoluto). Son los bugs del
  parser (EZE→MAD a US$155 = duración 155 min interpretada como
  precio). **Se borran** con `--apply`.
- **`[QUARANTINE]`** → capa 2 (threshold de ruta). Precio sospechoso
  pero físicamente posible (ej: error fare real). **No se borran**;
  se marcan `verificationRequired=true` para que el siguiente tick
  del alert engine las re-valide con Amadeus antes de notificar.

Si en las muestras aparece algún `BLOCK` que visualmente parece un
error-fare real y no un bug del parser, **detenerse** y revisar
`src/services/sanityCheck.js` (capa 1) antes de aplicar. Documentar
el caso como "known issue" al final de este RUNBOOK.

### 3.3.3 — Aplicar

```bash
node scripts/cleanup-poisoned-notifs.js --apply
```

### 3.3.4 — Verificación post-cleanup

```bash
# Antes (guardalo antes del --apply).
mongosh "$MONGODB_URI" --quiet --eval "db.notifications.countDocuments({})"

# Después (mismo comando).
mongosh "$MONGODB_URI" --quiet --eval "db.notifications.countDocuments({})"

# Cuántas quedaron en cuarentena.
mongosh "$MONGODB_URI" --quiet --eval \
  "db.notifications.countDocuments({ verificationRequired: true })"
```

El delta entre el "antes" y el "después" debe coincidir con la
columna `A borrar` del dry-run (±1 o 2 por inserciones concurrentes
del alert engine).

---

## 3.4 — Smoke test del bot post-deploy

En Telegram, contra el bot de producción (no el de dev):

### 3.4.1 — `/informe`

Enviar `/informe` y esperar el PDF o mensaje-resumen del día.

**Chequeos manuales:**

- Rutas long-haul (EZE↔MAD, EZE↔BCN, EZE↔FCO, EZE↔MXP, etc.) tienen
  precios **> US$400** one-way y **> US$600** roundtrip. Si ves algo
  por debajo, algo se escapó del cleanup.
- Ningún vuelo aparece con airline vacío, `Unknown`, ni con `directo`
  cuando evidentemente es con escala.

### 3.4.2 — `/buscar EZE MAD`

O el flujo interactivo `/buscar` → EZE → MAD → fecha +60 días.

**Chequeos manuales:**

- Los 3-5 resultados mostrados tienen aerolíneas legibles
  (`Iberia`, `Lufthansa`, `Turkish Airlines`, `LATAM`, etc.).
- **NO** aparece `Unknown · directo` en ningún resultado (ese era
  el síntoma del bug viejo).
- Los precios están en rango plausible (ver 3.4.1).

Si alguno de estos checks falla, **no rollear** — abrir un issue con
screenshot y la fecha/hora exacta. El parser tiene fallbacks; un
resultado aislado raro no es regresión.

---

## 3.5 — Qué hacer si el canary falla

El workflow de GitHub Actions `.github/workflows/canary.yml` corre
todos los días a las 12:00 UTC (09:00 AR). Si detecta regresión,
el script ya te manda un Telegram con prefijo `[PARSER-CANARY-FAIL]`
y el workflow queda rojo.

### 3.5.1 — Encontrar el run

1. Ir a `https://github.com/RanuK12/Flight-Price-Alert/actions`.
2. Click en **Parser Canary** en la barra lateral.
3. Abrir el run rojo más reciente. Abrir el step **Run canary** y
   revisar la salida del bloque `CANARY SUMMARY`.
4. Los fails vienen etiquetados por ruta, ej:
   ```
   ✗ EZE→MAD
      flights: 12, minPrice: $155
      ✗ minPrice 155 BELOW canary floor 300 (parser regression?)
   ```

### 3.5.2 — Capturar fixture nueva

En local, con `.env` cargado:

```bash
# 1. Editar TEMPORALMENTE server/scrapers/googleFlightsApi.js y
#    agregar el bloque de captura dentro de searchFlightsApi, justo
#    después de obtener response.data. Ver:
#    tests/fixtures/google-flights/README.md ("Como capturar nuevas
#    fixtures (manual)").
#
#    if (process.env.SAVE_FIXTURES === 'true') {
#      const fs = require('fs');
#      const fname = `tests/fixtures/google-flights/${new Date().toISOString().slice(0,10)}_${origin}-${destination}_${returnDate ? 'rt' : 'ow'}.txt`;
#      fs.writeFileSync(fname, response.data);
#    }

# 2. Re-correr la ruta que falló (ej: EZE→MAD) con el flag.
SAVE_FIXTURES=true node scripts/canary-google-flights.js

# 3. Confirmar que apareció el archivo.
ls -l tests/fixtures/google-flights/
```

### 3.5.3 — Agregar la fixture al corpus de regression

1. Revisar el `.txt` capturado: debe empezar con `)]}'` y tener un
   JSON parseable por `parseFlightsResponse`.
2. Agregarlo al repo: `git add tests/fixtures/google-flights/*.txt`.
3. Si el archivo reproduce una **regresión** (precio envenenado,
   airline vacío, etc.), agregar un nuevo caso en
   `tests/parser.regression.test.js` que cargue la fixture y
   verifique el invariante roto. El test debe fallar con el parser
   actual y pasar con el fix.
4. **Revertir** el bloque `SAVE_FIXTURES` en
   `server/scrapers/googleFlightsApi.js` antes de commitear.
5. PR separada con título `test: add fixture for <caso>`.

---

## 3.6 — Cómo desactivar el sanityCheck en emergencia

> **Estado actual:** no existe un kill-switch. El código de
> `src/services/sanityCheck.js`, `src/bot/notifier.js` y
> `src/services/dailyReport.js` quedó sellado en PR #6 y no tiene
> env var de bypass.

### 3.6.1 — Si una regla está bloqueando ofertas legítimas AHORA

Opciones, en orden de menor a mayor riesgo:

1. **Ajustar threshold, no desactivar.** Si el falso-negativo viene
   de la capa 2 (threshold de ruta), editar
   `src/config/priceThresholds.js`, bajar el `steal` de la ruta
   afectada, commitear y deployar. Toma ~5 minutos.

2. **Forzar `verificationRequired=false` en las notifs afectadas.**
   Si solo un puñado quedó en cuarentena y las revisaste a mano:
   ```bash
   mongosh "$MONGODB_URI" --eval \
     'db.notifications.updateMany(
        { origin: "EZE", destination: "MAD", price: { $gte: 300, $lte: 400 }, verificationRequired: true },
        { $set: { verificationRequired: false } }
      )'
   ```

3. **Kill-switch vía env var (propuesta — requiere PR aparte).**
   Sugerencia de implementación para un PR futuro:

   - En `src/services/sanityCheck.js`, al inicio de `check()`:
     ```js
     if (process.env.SANITY_CHECK_DISABLED === 'true') {
       return { ok: true, severity: 'pass', reason: 'disabled-by-env' };
     }
     ```
   - Loggear con nivel `warn` en el boot si la flag está encendida.
   - En Render: Settings → Environment → agregar
     `SANITY_CHECK_DISABLED=true`. Redeploy automático.
   - **Siempre combinar con un issue abierto** para rastrear cuándo
     se vuelve a encender.

   Este punto **no está implementado**. Si alguna vez necesitás el
   kill-switch, abrir un PR minúsculo con el snippet de arriba.

### 3.6.2 — NUNCA

- No borrar ni editar `src/services/sanityCheck.js` en producción
  sin un PR revisado.
- No correr `cleanup-poisoned-notifs.js --apply` con `sanityCheck`
  "relajado" (perderías la heurística que identifica las notifs
  envenenadas).

---

## Known issues

_Rellenar aquí cualquier cosa rara que aparezca durante la operación
y no esté cubierta arriba. Formato:_

- **YYYY-MM-DD** — _descripción corta_ — _workaround o
  link a issue_.

---

## Apéndice — comandos rápidos

```bash
# Correr suite de tests localmente
npx jest --silent --forceExit

# Correr canary manualmente (requiere .env con MONGODB_URI y, opcional,
# TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID para que alerte).
node scripts/canary-google-flights.js

# Forzar run del workflow de canary desde GitHub sin esperar al cron:
# Actions → Parser Canary → Run workflow → main.

# Cleanup dry-run
npm run cleanup:poisoned-notifs

# Cleanup apply
node scripts/cleanup-poisoned-notifs.js --apply
```
