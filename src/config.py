import os
from dotenv import load_dotenv

load_dotenv()

# Configuración de API
COINGECKO_API_URL = os.getenv("COINGECKO_API_URL", "https://api.coingecko.com/api/v3")

# Configuración de Twilio
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
WHATSAPP_FROM = os.getenv("WHATSAPP_FROM")
WHATSAPP_TO = os.getenv("WHATSAPP_TO")

# Configuración de Monitoreo
MONITORING_INTERVAL = int(os.getenv("MONITORING_INTERVAL", "30"))  # Intervalo en minutos
PRICE_CHANGE_THRESHOLD = float(os.getenv("PRICE_CHANGE_THRESHOLD", "0.5"))  # Porcentaje de cambio
CRYPTO_ID = os.getenv("CRYPTO_ID", "bitcoin")  # Criptomoneda a monitorear

# Validación de configuración
def validate_config():
    required_vars = [
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "WHATSAPP_FROM",
        "WHATSAPP_TO"
    ]
    
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        raise ValueError(f"Faltan las siguientes variables de entorno: {', '.join(missing_vars)}")

# Validar la configuración al importar el módulo
validate_config()
