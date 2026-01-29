require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDatabase } = require('./database/db');
const flightRoutes = require('./routes/flights');
const { initTelegram } = require('./services/telegram');
const { startMonitoring, getMonitorStatus } = require('./services/flightMonitor');

const app = express();
const PORT = process.env.PORT || 4000;

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

      // Auto-iniciar monitoreo automáticamente en Railway/producción
      // O si AUTO_MONITOR está configurado
      const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
      const autoMonitor = process.env.AUTO_MONITOR !== 'false'; // Por defecto true
      
      if (isProduction || autoMonitor) {
        console.log('🚀 Iniciando monitoreo automático de vuelos...');
        // Buscar cada 2 horas por defecto
        const schedule = process.env.MONITOR_SCHEDULE || '0 */2 * * *';
        const timezone = process.env.MONITOR_TIMEZONE || 'Europe/Rome';
        startMonitoring(schedule, timezone);
        console.log(`⏰ Búsquedas programadas: ${schedule} (${timezone})`);
        console.log('');
        
        // Ejecutar primera búsqueda después de 10 segundos
        setTimeout(() => {
          console.log('🔍 Ejecutando primera búsqueda inicial...');
          const { runFullSearch } = require('./services/flightMonitor');
          runFullSearch().catch(err => console.error('Error en búsqueda inicial:', err.message));
        }, 10000);
      }
    });

  } catch (error) {
    console.error('❌ Error iniciando servidor:', error.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
