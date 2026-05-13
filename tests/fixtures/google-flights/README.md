# Fixtures de Google Flights (regression corpus)

Cada fixture es una **respuesta cruda** del endpoint `/GetShoppingResults`
de Google Flights tal como llega al `parseFlightsResponse` (incluye el
prefijo XSSI `)]}'`).

## Estructura de archivo

- `<YYYY-MM-DD>_<origin>-<destination>_<ow|rt>.txt`
  Donde la fecha es la **del scrape** (no la de partida), y el sufijo
  indica oneway/roundtrip.

## Como capturar nuevas fixtures (manual)

En `server/scrapers/googleFlightsApi.js`, dentro de `searchFlightsApi`,
hay una variable `response.data`. Loggearla con:

```js
if (process.env.SAVE_FIXTURES === 'true') {
  const fs = require('fs');
  const fname = `tests/fixtures/google-flights/${new Date().toISOString().slice(0,10)}_${origin}-${destination}_${returnDate ? 'rt' : 'ow'}.txt`;
  fs.writeFileSync(fname, response.data);
}
```

y correr una vez con `SAVE_FIXTURES=true`.

## Sintetica vs real

Los tests del corpus comprueban **estructura + invariantes**, no precios
exactos. Por lo tanto sirve tanto una fixture real como una sintetica
(siempre que respete la estructura wrb.fr observada en logs).

`synthetic_eze-mxp_ow.txt` es una fixture sintetica que reproduce el
caso EZE→MXP del 2026-05-13 (Turkish $811, Lufthansa $843, etc.) y
ademas incluye un item ENVENENADO (precio 155 = duracion en min) para
comprobar que el parser lo descarta.
