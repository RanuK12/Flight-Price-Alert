# Flight Price Alert — Reglas del Proyecto y Agentes

## Directiva Estricta de Modificación y Autonomía
* **Prohibición de Modificaciones Autónomas**: Ningún agente, bot o proceso automático (incluyendo Ranukita / subagentes) debe realizar cambios o modificaciones en el código fuente, scrapers, modelos, configuraciones de rutas o migraciones de `Flight-Price-Alert` a menos que sea pedido explícita y directamente por Emilio.
* **Preservación del Core Scraper y Rutas**: Las rutas configuradas por el usuario (Alertas Europa ↔ Argentina en septiembre y noviembre) y el motor de scraping son sagrados y no deben ser eliminados, refactorizados o sobreescritos sin autorización explícita.
* **Verificación Obligatoria**: Cualquier cambio aprobado debe mantener pasando la suite completa de tests (`npx jest --forceExit`).
