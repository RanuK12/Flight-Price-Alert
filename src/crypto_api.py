import requests
from config import COINGECKO_API_URL
import time
from typing import Optional

class CryptoAPIError(Exception):
    """Excepción personalizada para errores de la API de criptomonedas"""
    pass

def get_crypto_price(crypto_id: str) -> Optional[float]:
    """
    Obtiene el precio actual de una criptomoneda.
    
    Args:
        crypto_id (str): ID de la criptomoneda (ej: 'bitcoin')
    
    Returns:
        float: Precio actual de la criptomoneda
        
    Raises:
        CryptoAPIError: Si hay un error al obtener el precio
    """
    max_retries = 3
    retry_delay = 2  # segundos
    
    for attempt in range(max_retries):
        try:
            response = requests.get(
                f"{COINGECKO_API_URL}/simple/price",
                params={
                    "ids": crypto_id,
                    "vs_currencies": "usd"
                },
                timeout=10
            )
            response.raise_for_status()
            
            data = response.json()
            if crypto_id not in data:
                raise CryptoAPIError(f"Criptomoneda '{crypto_id}' no encontrada")
                
            price = data[crypto_id]["usd"]
            if not isinstance(price, (int, float)) or price <= 0:
                raise CryptoAPIError(f"Precio inválido recibido para {crypto_id}")
                
            return price
            
        except requests.exceptions.RequestException as e:
            if attempt == max_retries - 1:
                raise CryptoAPIError(f"Error al conectar con la API: {str(e)}")
            time.sleep(retry_delay)
            
        except (KeyError, ValueError) as e:
            raise CryptoAPIError(f"Error al procesar la respuesta de la API: {str(e)}")
            
    return None
