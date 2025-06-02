from datetime import datetime, timedelta
from crypto_api import get_crypto_price
from whatsapp_api import send_whatsapp_message
from config import PRICE_CHANGE_THRESHOLD, CRYPTO_ID
import json
import os

class PriceMonitor:
    def __init__(self):
        self.price_log = []
        self.initial_price = None
        self.load_price_history()

    def load_price_history(self):
        try:
            if os.path.exists('price_history.json'):
                with open('price_history.json', 'r') as f:
                    data = json.load(f)
                    self.price_log = [(datetime.fromisoformat(t), p) for t, p in data['price_log']]
                    self.initial_price = data.get('initial_price')
        except Exception as e:
            print(f"Error cargando historial de precios: {e}")

    def save_price_history(self):
        try:
            data = {
                'price_log': [(t.isoformat(), p) for t, p in self.price_log],
                'initial_price': self.initial_price
            }
            with open('price_history.json', 'w') as f:
                json.dump(data, f)
        except Exception as e:
            print(f"Error guardando historial de precios: {e}")

    def log_price(self, price):
        now = datetime.now()
        self.price_log.append((now, price))
        # Mantener solo las últimas 24 horas de datos
        day_ago = now - timedelta(days=1)
        self.price_log = [(t, p) for t, p in self.price_log if t >= day_ago]
        self.save_price_history()

    def calculate_statistics(self):
        if not self.price_log:
            return None

        prices = [p for _, p in self.price_log]
        return {
            'current': prices[-1],
            'min_24h': min(prices),
            'max_24h': max(prices),
            'avg_24h': sum(prices) / len(prices)
        }

    def generate_alert(self, current_price, stats):
        message = f"Alerta de {CRYPTO_ID.upper()}:\n"
        message += f"Precio actual: ${current_price:,.2f}\n"
        message += f"Máximo 24h: ${stats['max_24h']:,.2f}\n"
        message += f"Mínimo 24h: ${stats['min_24h']:,.2f}\n"
        message += f"Promedio 24h: ${stats['avg_24h']:,.2f}"
        
        send_whatsapp_message(message)

    def monitor_price(self):
        current_price = get_crypto_price(CRYPTO_ID)
        self.log_price(current_price)
        
        if self.initial_price is None:
            self.initial_price = current_price
            return

        stats = self.calculate_statistics()
        if not stats:
            return

        # Calcular cambio porcentual desde la última medición
        last_price = self.price_log[-2][1] if len(self.price_log) > 1 else self.initial_price
        percentage_change = ((current_price - last_price) / last_price) * 100

        if abs(percentage_change) >= PRICE_CHANGE_THRESHOLD:
            self.generate_alert(current_price, stats)

monitor = PriceMonitor()

def monitor_price():
    monitor.monitor_price()

def monitor_initial_price():
    monitor.monitor_price()
