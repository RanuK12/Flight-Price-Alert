require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');

const { initDatabase } = require('./database/db');
const flightRoutes = require('./routes/flights');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', flightRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Inicializar base de datos y comenzar servidor
async function startServer() {
  try {
    console.log('🛫 Inicializando Flight Price App v2.0...\n');
    
    // Inicializar BD
    const dbReady = await initDatabase();
    if (!dbReady) {
      throw new Error('No se pudo inicializar la base de datos');
    }

    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`\n✅ Servidor ejecutándose en http://localhost:${PORT}`);
      console.log(`📡 API disponible en http://localhost:${PORT}/api`);
      console.log(`🎨 Interfaz en http://localhost:${PORT}\n`);
    });

    // Tareas programadas (opcional)
    // Ejecutar verificación cada hora
    if (process.env.ENABLE_CRON === 'true') {
      cron.schedule('0 * * * *', () => {
        console.log('⏰ Ejecutando verificación programada...');
        // Aquí se ejecutarían búsquedas automáticas si está configurado
      });
    }

  } catch (error) {
    console.error('❌ Error iniciando servidor:', error.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
