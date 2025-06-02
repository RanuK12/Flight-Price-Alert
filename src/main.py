import schedule
import time
from alerts import monitor_price, monitor_initial_price
from config import MONITORING_INTERVAL
import signal
import sys
import logging
from datetime import datetime

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('crypto_bot.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def signal_handler(signum, frame):
    """Manejador de señales para una salida limpia del programa"""
    logger.info("Deteniendo el bot de manera segura...")
    sys.exit(0)

def job():
    """Tarea programada para monitorear el precio"""
    try:
        logger.info("Iniciando monitoreo de precio...")
        monitor_price()
        logger.info("Monitoreo completado exitosamente")
    except Exception as e:
        logger.error(f"Error en el monitoreo: {str(e)}", exc_info=True)

def main():
    """Función principal del bot"""
    logger.info(f"Bot Crypto iniciado - Monitoreando cada {MONITORING_INTERVAL} minutos")
    logger.info(f"Fecha y hora de inicio: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Configurar el manejador de señales para una salida limpia
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        # Monitoreo inicial
        logger.info("Realizando monitoreo inicial...")
        monitor_initial_price()
        
        # Programar el monitoreo periódico
        schedule.every(MONITORING_INTERVAL).minutes.do(job)
        logger.info(f"Monitoreo programado cada {MONITORING_INTERVAL} minutos")
        
        # Bucle principal
        while True:
            schedule.run_pending()
            time.sleep(1)
            
    except Exception as e:
        logger.critical(f"Error crítico en el bot: {str(e)}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()

