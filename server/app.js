require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const { initDatabase } = require('./database/db');
const flightRoutes = require('./routes/flights');
const { initTelegram } = require('./services/telegram');
const { startMonitoring, getMonitorStatus } = require('./services/flightMonitor');
const { generateAndSendDailyReport } = require('./services/dailyReport');
const cron = require('node-cron');

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

// Diagnóstico (sin exponer secretos)
app.get('/debug', (req, res) => {
  res.json({
    telegramToken: process.env.TELEGRAM_BOT_TOKEN ? `✅ (${process.env.TELEGRAM_BOT_TOKEN.substring(0,10)}...)` : '❌ NO CONFIGURADO',
    telegramChatId: process.env.TELEGRAM_CHAT_ID ? `✅ (${process.env.TELEGRAM_CHAT_ID})` : '❌ NO CONFIGURADO',
    port: process.env.PORT || '4000 (default)',
    nodeEnv: process.env.NODE_ENV || 'not set',
    render: process.env.RENDER ? '✅ Render detectado' : 'no',
    chromium: process.env.PUPPETEER_EXECUTABLE_PATH || 'auto-detect',
    uptime: `${Math.floor(process.uptime())}s`,
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
    console.log('🛫 FLIGHT DEAL FINDER v5.1');
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

      // Auto-iniciar monitoreo en producción (Render / Railway / Docker)
      const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT || process.env.RENDER;
      const autoMonitor = process.env.AUTO_MONITOR !== 'false'; // Por defecto true
      
      if (isProduction || autoMonitor) {
        console.log('🚀 Iniciando monitoreo automático de vuelos...');
        // Buscar cada 30 minutos
        const schedule = process.env.MONITOR_SCHEDULE || '*/30 * * * *';
        const timezone = process.env.MONITOR_TIMEZONE || 'America/Argentina/Buenos_Aires';
        startMonitoring(schedule, timezone);
        console.log(`⏰ Búsquedas programadas: ${schedule} (${timezone})`);
        console.log('');
        
        // Informe diario PDF — cada día a las 21:00 (hora Argentina)
        const reportSchedule = process.env.REPORT_SCHEDULE || '0 21 * * *';
        cron.schedule(reportSchedule, async () => {
          console.log('\n📄 Generando informe diario PDF...');
          try {
            await generateAndSendDailyReport();
          } catch (err) {
            console.error('Error generando informe PDF:', err.message);
          }
        }, { scheduled: true, timezone });
        console.log(`📄 Informe diario PDF: ${reportSchedule} (${timezone})`);

        // Ejecutar primera búsqueda después de 15 segundos
        setTimeout(async () => {
          console.log('');
          console.log('🔍 Ejecutando primera búsqueda inicial...');
          console.log(`⏰ ${new Date().toLocaleString('es-ES')}`);
          try {
            const { runFullSearch } = require('./services/flightMonitor');
            await runFullSearch();
            console.log('✅ Primera búsqueda completada');
          } catch (err) {
            console.error('❌ Error en búsqueda inicial:', err.message);
            console.error(err.stack);
          }
        }, 15000);

        // ═══════════ KEEP-ALIVE SELF-PING ═══════════
        // Railway/Render free tier sleeps after inactivity.
        // Self-ping every 10 minutes to prevent sleep.
        const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/health`
          : process.env.RENDER_EXTERNAL_URL
            ? `${process.env.RENDER_EXTERNAL_URL}/health`
            : null;

        if (selfUrl) {
          const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
          setInterval(() => {
            http.get(selfUrl.replace('https://', 'http://'), () => {}).on('error', () => {});
            // Also try https via axios if available
            try {
              const axios = require('axios');
              axios.get(selfUrl, { timeout: 5000 }).catch(() => {});
            } catch (e) {}
          }, PING_INTERVAL);
          console.log(`🏓 Keep-alive ping: ${selfUrl} cada 10 min`);
        } else {
          // Fallback: ping localhost
          setInterval(() => {
            http.get(`http://localhost:${PORT}/health`, () => {}).on('error', () => {});
          }, 10 * 60 * 1000);
          console.log(`🏓 Keep-alive ping: localhost:${PORT} cada 10 min`);
        }
      }
    });

  } catch (error) {
    console.error('❌ Error iniciando servidor:', error.message);
    process.exit(1);
  }
}

// Handle uncaught errors to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled rejection:', err);
});

startServer();

module.exports = app;
