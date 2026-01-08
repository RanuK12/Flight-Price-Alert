@echo off
REM Script de prueba rápida de la app
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo Testing Flight Price App...
echo.

REM Probar que los archivos principales existen
if not exist "server\app.js" (
    echo ERROR: server\app.js no encontrado
    exit /b 1
)

if not exist "public\index.html" (
    echo ERROR: public\index.html no encontrado
    exit /b 1
)

if not exist "server\database\db.js" (
    echo ERROR: server\database\db.js no encontrado
    exit /b 1
)

echo [OK] Estructura de archivos validada
echo.

REM Probar la sintaxis de Node
echo Validando sintaxis de archivos JavaScript...
node -c server/app.js 2>nul
if !errorlevel! equ 0 (
    echo [OK] server/app.js - Sintaxis correcta
) else (
    echo [ERROR] Sintaxis inválida en server/app.js
    exit /b 1
)

node -c server/database/db.js 2>nul
if !errorlevel! equ 0 (
    echo [OK] server/database/db.js - Sintaxis correcta
) else (
    echo [ERROR] Sintaxis inválida en server/database/db.js
    exit /b 1
)

node -c server/scrapers/index.js 2>nul
if !errorlevel! equ 0 (
    echo [OK] server/scrapers/index.js - Sintaxis correcta
) else (
    echo [ERROR] Sintaxis inválida en server/scrapers/index.js
    exit /b 1
)

node -c public/app.js 2>nul
if !errorlevel! equ 0 (
    echo [OK] public/app.js - Sintaxis correcta
) else (
    echo [ERROR] Sintaxis inválida en public/app.js
    exit /b 1
)

echo.
echo All checks passed! ^-v^-
echo.
echo To start the application, run: npm start
echo Then open http://localhost:3000 in your browser
echo.
