/**
 * Migration Script - Old Bot to New App
 * Mantiene compatibilidad con configuración anterior
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

console.log('🛫 Flight Price App v2.0 - New Web Application\n');
console.log('📦 Migrando desde configuración anterior...\n');

// Crear directorio de datos si no existe
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✅ Directorio de datos creado\n');
}

// Iniciar servidor
require('./server/app');
