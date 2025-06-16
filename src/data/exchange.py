import ccxt
import pandas as pd
from typing import Dict, List, Optional, Union
from datetime import datetime, timedelta

class CryptoExchange:
    def __init__(self, exchange_id: str, api_key: Optional[str] = None, 
                 api_secret: Optional[str] = None):
        """
        Initialize connection to a cryptocurrency exchange.
        
        Args:
            exchange_id: Exchange identifier (e.g., 'binance', 'kraken')
            api_key: API key for authenticated requests
            api_secret: API secret for authenticated requests
        """
        self.exchange_id = exchange_id
        exchange_class = getattr(ccxt, exchange_id)
        self.exchange = exchange_class({
            'apiKey': api_key,
            'secret': api_secret,
            'enableRateLimit': True
        })
        
    def get_ohlcv(self, symbol: str, timeframe: str = '1h', 
                  since: Optional[datetime] = None, limit: int = 1000) -> pd.DataFrame:
        """
        Fetch OHLCV (Open, High, Low, Close, Volume) data for a symbol.
        
        Args:
            symbol: Trading pair symbol (e.g., 'BTC/USDT')
            timeframe: Candle timeframe (e.g., '1m', '5m', '1h', '1d')
            since: Start time for historical data
            limit: Maximum number of candles to fetch
            
        Returns:
            DataFrame with OHLCV data
        """
        if since:
            since = int(since.timestamp() * 1000)
            
        ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, since, limit)
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        return df
    
    def get_ticker(self, symbol: str) -> Dict:
        """
        Get current ticker information for a symbol.
        
        Args:
            symbol: Trading pair symbol
            
        Returns:
            Dictionary with current market data
        """
        return self.exchange.fetch_ticker(symbol)
    
    def get_order_book(self, symbol: str, limit: int = 20) -> Dict:
        """
        Get current order book for a symbol.
        
        Args:
            symbol: Trading pair symbol
            limit: Number of orders to fetch
            
        Returns:
            Dictionary with order book data
        """
        return self.exchange.fetch_order_book(symbol, limit)
    
    def get_balance(self) -> Dict:
        """
        Get account balance for all assets.
        
        Returns:
            Dictionary with balance information
        """
        return self.exchange.fetch_balance()
    
    def create_order(self, symbol: str, order_type: str, side: str, 
                    amount: float, price: Optional[float] = None) -> Dict:
        """
        Create a new order.
        
        Args:
            symbol: Trading pair symbol
            order_type: Order type ('limit' or 'market')
            side: Order side ('buy' or 'sell')
            amount: Order amount
            price: Order price (required for limit orders)
            
        Returns:
            Dictionary with order information
        """
        return self.exchange.create_order(symbol, order_type, side, amount, price) 