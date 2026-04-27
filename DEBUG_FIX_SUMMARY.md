# Fix: "Inner data is not a string" - Google Flights API

## 🚨 DIAGNÓSTICO

### Problema
Los logs muestran consistentemente:
- `"⚠️ API: Inner data is not a string"`
- `"⚠️ API: No flights parsed from response"`
- 35 rutas chequeadas, 0 vuelos encontrados, 0 errores HTTP

### Causa Raíz
Google Flights cambió el formato de su respuesta. El código original asumía que `parsed[0][2]` era SIEMPRE un string que necesitaba JSON.parse(), pero ahora puede ser:
1. **String**: `"\"2025-06-15\""` → requiere `JSON.parse()`
2. **Objeto/Array directo**: `["2025-06-15", ...]` → ya es usable
3. **Null/undefined**: estructura cambió

El código fallaba silenciosamente al hacer `typeof innerJsonStr !== 'string'` → `return []`.

## 🔧 SOLUCIÓN IMPLEMENTADA

### 1. `parseFlightsResponse()` reescrita
- **Parsing seguro**: maneja string u objeto directamente
- **Múltiples índices**: prueba [2], [3], [0] en el payload
- **Validación de tipos**: verifica antes de usuar
- **Logging estructurado**: debug por niveles

### 2. Feature Flag: `DEBUG_RESPONSE`
```js
const DEBUG_RESPONSE = process.env.GOOGLE_FLIGHTS_DEBUG === 'true';
```

Para activar en Render, agregar variable de entorno:
```
GOOGLE_FLIGHTS_DEBUG=true
```

### 3. Logging mejorado
- Distingue "sin resultados" vs "error de parseo"
- Logs conditional con `DEBUG_RESPONSE`
- Traza tipos de datos en cada paso

## 🧪 TESTING EN PRODUCCIÓN

### Sin debug (default)
```js
// Comportamiento normal, sin logs extra
```

### Con debug activo
```bash
# En Render: agregar GOOGLE_FLIGHTS_debug=true
# Verás logs como:
🔍 DEBUG: innerData type: array
🔍 DEBUG: innerData (array): [["Aerolineas", ...]]
🔍 DEBUG: Raw flights from parser: 3
```

## 📋 CHECKLIST DE VERIFICACIÓN

1. [ ] El bot vuelve a devolver vuelos
2. [ ] Los logs muestran `✅ API: N vuelos` en lugar de `⚠️ API: No flights`
3. [ ] Si persiste el problema, activar `GOOGLE_FLIGHTS_DEBUG=true`
4. [ ] Revertir debug una vez establecido

## 🏗 ARQUITECTURA DETECTADA

### Problemas de arquitectura identificados en el código original:
1. **Acoplamiento a formato específico**: asumía estructura fija de Google
2. **Falta de normalización entre proveedores**: Google vs Amadeus vs otros
3. **Validación frágil**: `typeof x !== 'string'` sin fallback
4. **Logs ruidosos**: o muy escuetos, sin término medio

### Mejoras aplicadas:
1. **Parsing políglota**: soporta múltiples formatos
2. **Feature flag de debugging**: activable/removible sin deploy
3. **Logs condicionales**: solo si `DEBUG_RESPONSE`
4. **Validación robusta**: verifica tipo antes de operar

## 📦 ARCHIVOS MODIFICADOS

- `server/scrapers/googleFlightsApi.js` → `parseFlightsResponse()` y `DEBUG_RESPONSE`

## 🔄 PRÓXIMOS PASOS SUGERIDOS

1. **Deploy a Render** y monitorear logs
2. **Si funciona**: el bot volverá a enviar vuelos
3. **Si falla**: activar `GOOGLE_FLIGHTS_DEBUG=true` para ver respuesta cruda
4. **Largo plazo**: normalizar responses entre providers (Amadeus/Google/Skyscanner)
