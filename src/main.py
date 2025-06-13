import schedule
import time
from alerts import monitor_price, monitor_initial_price
from config import MONITORING_INTERVAL
import logging

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

def send_test_message():
    """Envía un mensaje de prueba al iniciar el bot"""
    try:
        message = "🤖 Bot iniciado correctamente\n\n" + \
                 "✅ Monitoreo activo\n" + \
                 "✅ Listo para enviar alertas"
        logger.info(message)
    except Exception as e:
        logger.error(f"Error al enviar mensaje de prueba: {e}")

def main():
    logger.info(f"Iniciando monitoreo cada {MONITORING_INTERVAL} minutos")
    
    # Enviar mensaje de prueba
    send_test_message()
    
    # Programar el monitoreo
    schedule.every(MONITORING_INTERVAL).minutes.do(monitor_price)
    
    # Monitoreo inicial
    monitor_initial_price()
    
    # Mantener el bot corriendo
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == "__main__":
    main()

