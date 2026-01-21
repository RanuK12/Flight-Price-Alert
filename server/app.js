require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDatabase } = require('./database/db');
const flightRoutes = require('./routes/flights');
const { initTelegram } = require('./services/telegram');
const { startMonitoring, getMonitorStatus } = require('./services/flightMonitor');

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
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    monitor: getMonitorStatus(),
  });
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

// Inicializar y comenzar servidor
async function startServer() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🛫 FLIGHT DEAL FINDER v3.0');
    console.log('='.repeat(60));
    console.log('');
    
    // Inicializar BD
    const dbReady = await initDatabase();
    if (!dbReady) {
      throw new Error('No se pudo inicializar la base de datos');
    }

    // Inicializar Telegram (opcional)
    initTelegram();

    // Iniciar servidor
    app.listen(PORT, () => {
      console.log('');
      console.log(`✅ Servidor ejecutándose en http://localhost:${PORT}`);
      console.log(`📡 API disponible en http://localhost:${PORT}/api`);
      console.log(`🎨 Interfaz en http://localhost:${PORT}`);
      console.log('');
      console.log('📋 ENDPOINTS PRINCIPALES:');
      console.log('   GET  /api/search?origin=MAD&destination=EZE');
      console.log('   GET  /api/deals');
      console.log('   GET  /api/routes');
      console.log('   POST /api/monitor/start');
      console.log('   GET  /api/monitor/status');
      console.log('');
    });

    // Auto-iniciar monitoreo si está configurado
    if (process.env.AUTO_MONITOR === 'true') {
      console.log('🚀 Iniciando monitoreo automático...');
      const schedule = process.env.MONITOR_SCHEDULE || '0 */4 * * *';
      startMonitoring(schedule);
    }

  } catch (error) {
    console.error('❌ Error iniciando servidor:', error.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
