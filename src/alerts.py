from datetime import datetime, timedelta
from crypto_api import get_crypto_price
from config import PRICE_CHANGE_THRESHOLD, CRYPTO_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, WHATSAPP_FROM, WHATSAPP_TO
import json
import os
import logging
from twilio.rest import Client

logger = logging.getLogger(__name__)

class PriceMonitor:
    def __init__(self):
        self.price_log = []
        self.initial_price = None
        self.load_price_history()
        self.twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        logger.info("PriceMonitor inicializado")

    def load_price_history(self):
        try:
            if os.path.exists('price_history.json'):
                with open('price_history.json', 'r') as f:
                    data = json.load(f)
                    self.price_log = [(datetime.fromisoformat(t), p) for t, p in data['price_log']]
                    self.initial_price = data.get('initial_price')
                    logger.info(f"Historial de precios cargado: {len(self.price_log)} registros")
        except Exception as e:
            logger.error(f"Error cargando historial de precios: {e}")

    def save_price_history(self):
        try:
            data = {
                'price_log': [(t.isoformat(), p) for t, p in self.price_log],
                'initial_price': self.initial_price
            }
            with open('price_history.json', 'w') as f:
                json.dump(data, f)
            logger.debug("Historial de precios guardado")
        except Exception as e:
            logger.error(f"Error guardando historial de precios: {e}")

    def log_price(self, price):
        now = datetime.now()
        self.price_log.append((now, price))
        # Mantener solo las últimas 24 horas de datos
        day_ago = now - timedelta(days=1)
        self.price_log = [(t, p) for t, p in self.price_log if t >= day_ago]
        self.save_price_history()
        logger.info(f"Precio registrado: ${price:,.2f}")

    def calculate_statistics(self):
        if not self.price_log:
            return None

        prices = [p for _, p in self.price_log]
        stats = {
            'current': prices[-1],
            'min_24h': min(prices),
            'max_24h': max(prices),
            'avg_24h': sum(prices) / len(prices)
        }
        logger.debug(f"Estadísticas calculadas: {stats}")
        return stats

    def send_whatsapp_message(self, message):
        try:
            logger.info(f"Intentando enviar mensaje de WhatsApp a {WHATSAPP_TO}")
            logger.info(f"Usando credenciales - Account SID: {TWILIO_ACCOUNT_SID[:5]}...")
            
            message = self.twilio_client.messages.create(
                from_=WHATSAPP_FROM,
                body=message,
                to=WHATSAPP_TO
            )
            logger.info(f"Mensaje de WhatsApp enviado correctamente. SID: {message.sid}")
        except Exception as e:
            logger.error(f"Error enviando mensaje de WhatsApp: {str(e)}")
            logger.error(f"Tipo de error: {type(e).__name__}")
            import traceback
            logger.error(f"Traceback completo: {traceback.format_exc()}")

    def generate_alert(self, current_price, stats):
        message = f"🚨 Alerta de {CRYPTO_ID.upper()}:\n\n"
        message += f"💰 Precio actual: ${current_price:,.2f}\n"
        message += f"📈 Máximo 24h: ${stats['max_24h']:,.2f}\n"
        message += f"📉 Mínimo 24h: ${stats['min_24h']:,.2f}\n"
        message += f"📊 Promedio 24h: ${stats['avg_24h']:,.2f}"
        
        logger.info(message)
        self.send_whatsapp_message(message)

    def monitor_price(self):
        try:
            current_price = get_crypto_price(CRYPTO_ID)
            logger.info(f"Precio actual de {CRYPTO_ID}: ${current_price:,.2f}")
            
            self.log_price(current_price)
            
            if self.initial_price is None:
                self.initial_price = current_price
                logger.info(f"Precio inicial establecido: ${current_price:,.2f}")
                # Forzar una alerta inicial para prueba
                stats = self.calculate_statistics()
                if stats:
                    self.generate_alert(current_price, stats)
                return

            stats = self.calculate_statistics()
            if not stats:
                return

            # Calcular cambio porcentual desde la última medición
            last_price = self.price_log[-2][1] if len(self.price_log) > 1 else self.initial_price
            percentage_change = ((current_price - last_price) / last_price) * 100
            logger.info(f"Cambio porcentual: {percentage_change:.2f}%")

            if abs(percentage_change) >= PRICE_CHANGE_THRESHOLD:
                logger.info(f"Cambio significativo detectado: {percentage_change:.2f}%")
                self.generate_alert(current_price, stats)
            else:
                logger.debug(f"Cambio no significativo: {percentage_change:.2f}%")
                
        except Exception as e:
            logger.error(f"Error en monitor_price: {e}")

monitor = PriceMonitor()

def monitor_price():
    monitor.monitor_price()

def monitor_initial_price():
    monitor.monitor_price()
