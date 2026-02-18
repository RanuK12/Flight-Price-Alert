@echo off
REM Final Project Validation Script
REM Verifica que toda la aplicación está lista para usar

setlocal enabledelayedexpansion

cd /d "%~dp0.."

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  Flight Price Finder v2.0 - Validación Completa           ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

set ERRORS=0
set WARNINGS=0

echo 📋 Validando estructura del proyecto...
echo.

REM Check critical files
if exist "server\app.js" (
    echo ✓ server/app.js
) else (
    echo ✗ FALTA: server/app.js
    set /a ERRORS+=1
)

if exist "public\index.html" (
    echo ✓ public/index.html
) else (
    echo ✗ FALTA: public/index.html
    set /a ERRORS+=1
)

if exist "server\database\db.js" (
    echo ✓ server/database/db.js
) else (
    echo ✗ FALTA: server/database/db.js
    set /a ERRORS+=1
)

if exist "server\scrapers\index.js" (
    echo ✓ server/scrapers/index.js
) else (
    echo ✗ FALTA: server/scrapers/index.js
    set /a ERRORS+=1
)

if exist "server\routes\flights.js" (
    echo ✓ server/routes/flights.js
) else (
    echo ✗ FALTA: server/routes/flights.js
    set /a ERRORS+=1
)

if exist "package.json" (
    echo ✓ package.json
) else (
    echo ✗ FALTA: package.json
    set /a ERRORS+=1
)

if exist "README.md" (
    echo ✓ README.md
) else (
    echo ✗ FALTA: README.md
    set /a ERRORS+=1
)

echo.
echo 📦 Validando dependencias...
echo.

if exist "node_modules" (
    echo ✓ node_modules existe
    REM Contar paquetes
    for /d %%i in (node_modules\*) do set /a COUNT+=1
    echo   !COUNT! paquetes instalados
) else (
    echo ⚠ node_modules NO encontrado (ejecutar: npm install)
    set /a WARNINGS+=1
)

echo.
echo 🧪 Validando sintaxis JavaScript...
echo.

node -c server/app.js >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo ✓ server/app.js
) else (
    echo ✗ Error de sintaxis: server/app.js
    set /a ERRORS+=1
)

node -c server/database/db.js >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo ✓ server/database/db.js
) else (
    echo ✗ Error de sintaxis: server/database/db.js
    set /a ERRORS+=1
)

node -c server/scrapers/index.js >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo ✓ server/scrapers/index.js
) else (
    echo ✗ Error de sintaxis: server/scrapers/index.js
    set /a ERRORS+=1
)

node -c public/app.js >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo ✓ public/app.js
) else (
    echo ✗ Error de sintaxis: public/app.js
    set /a ERRORS+=1
)

echo.
echo 📄 Validando documentación...
echo.

if exist "ARCHITECTURE.md" (
    echo ✓ ARCHITECTURE.md
) else (
    echo ⚠ ARCHITECTURE.md no encontrado
    set /a WARNINGS+=1
)

if exist "INSTALL.md" (
    echo ✓ INSTALL.md
) else (
    echo ⚠ INSTALL.md no encontrado
    set /a WARNINGS+=1
)

if exist "CHANGELOG.md" (
    echo ✓ CHANGELOG.md
) else (
    echo ⚠ CHANGELOG.md no encontrado
    set /a WARNINGS+=1
)

echo.
echo 🧪 Validando archivos de test...
echo.

if exist "tests\scraper.test.js" (
    echo ✓ tests/scraper.test.js
) else (
    echo ⚠ tests/scraper.test.js no encontrado
    set /a WARNINGS+=1
)

if exist "tests\database.test.js" (
    echo ✓ tests/database.test.js
) else (
    echo ⚠ tests/database.test.js no encontrado
    set /a WARNINGS+=1
)

echo.
echo ════════════════════════════════════════════════════════════
echo.

if !ERRORS! equ 0 (
    echo ✅ VALIDACIÓN EXITOSA
    echo.
    echo Errores encontrados: !ERRORS!
    echo Advertencias: !WARNINGS!
    echo.
    echo 🚀 La aplicación está lista para ejecutar:
    echo.
    echo    npm install   (si no lo hiciste ya)
    echo    npm start     (para iniciar el servidor)
    echo    npm test      (para ejecutar tests)
    echo.
    echo 📱 Luego accede a: http://localhost:3000
) else (
    echo ❌ VALIDACIÓN FALLIDA
    echo.
    echo Errores encontrados: !ERRORS!
    echo Advertencias: !WARNINGS!
    echo.
    echo Por favor, soluciona los errores arriba antes de continuar.
)

echo.
echo ════════════════════════════════════════════════════════════
echo.
