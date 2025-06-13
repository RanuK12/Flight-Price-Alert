from twilio.rest import Client
import os
from dotenv import load_dotenv
import logging

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('whatsapp_test.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Cargar variables de entorno
load_dotenv()

# Obtener credenciales
account_sid = os.getenv('TWILIO_ACCOUNT_SID')
auth_token = os.getenv('TWILIO_AUTH_TOKEN')
whatsapp_from = os.getenv('WHATSAPP_FROM')
whatsapp_to = os.getenv('WHATSAPP_TO')

def test_whatsapp():
    try:
        logger.info("Iniciando prueba de WhatsApp")
        logger.info(f"Account SID: {account_sid}")
        logger.info(f"From: {whatsapp_from}")
        logger.info(f"To: {whatsapp_to}")
        
        # Crear cliente de Twilio
        client = Client(account_sid, auth_token)
        
        # Enviar mensaje de prueba
        message = client.messages.create(
            from_=whatsapp_from,
            body="🚨 Mensaje de prueba del Bot Crypto\n\nEste es un mensaje de prueba para verificar la configuración de WhatsApp.",
            to=whatsapp_to
        )
        
        logger.info(f"Mensaje enviado correctamente. SID: {message.sid}")
        return True
        
    except Exception as e:
        logger.error(f"Error en la prueba: {str(e)}")
        logger.error(f"Tipo de error: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback completo: {traceback.format_exc()}")
        return False

if __name__ == "__main__":
    test_whatsapp() 