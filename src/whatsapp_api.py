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
        
    Raises:
        WhatsAppAPIError: Si hay un error al enviar el mensaje
    """
    try:
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        
        message = client.messages.create(
            body=message,
            from_=WHATSAPP_FROM,
            to=WHATSAPP_TO
        )
        
        logger.info(f"Mensaje enviado exitosamente. SID: {message.sid}")
        return True
        
    except TwilioRestException as e:
        error_msg = f"Error de Twilio al enviar mensaje: {str(e)}"
        logger.error(error_msg)
        raise WhatsAppAPIError(error_msg)
        
    except Exception as e:
        error_msg = f"Error inesperado al enviar mensaje: {str(e)}"
        logger.error(error_msg)
        raise WhatsAppAPIError(error_msg)