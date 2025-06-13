from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException
from config import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, WHATSAPP_FROM, WHATSAPP_TO
import logging

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class WhatsAppAPIError(Exception):
    """Excepción personalizada para errores de la API de WhatsApp"""
    pass

def send_whatsapp_message(message: str) -> bool:
    """
    Envía un mensaje de WhatsApp usando Twilio.
    
    Args:
        message (str): Mensaje a enviar
        
    Returns:
        bool: True si el mensaje se envió correctamente, False en caso contrario
    """
    try:
        # Crear cliente de Twilio
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        
        # Enviar mensaje
        message = client.messages.create(
            from_=WHATSAPP_FROM,
            body=message,
            to=WHATSAPP_TO
        )
        
        logger.info(f"Mensaje enviado exitosamente. SID: {message.sid}")
        return True
        
    except Exception as e:
        logger.error(f"Error al enviar mensaje: {str(e)}")
        return False