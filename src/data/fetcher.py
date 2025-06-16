"""
Data fetching module for stocks and cryptocurrencies.
"""
import pandas as pd
import yfinance as yf
from typing import Union, List, Optional
from datetime import datetime, timedelta
import requests
import time

class DataFetcher:
    """
    Class for downloading historical price data.
    """
    
    def __init__(self):
        """Initialize the data fetcher."""
        self.coingecko_base_url = "https://api.coingecko.com/api/v3" # Keep for reference, but won't be used for now
        self.binance_base_url = "https://api.binance.com/api/v3"
        # Actualizamos la lista de criptomonedas soportadas para usar solo Binance
        self.supported_cryptos = {
            'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'UNI', 'LINK',
            'SOL', 'MATIC', 'LTC', 'AVAX', 'SHIB', 'PEPE', 'FLOKI', 'BONK',
            'USDT', 'USDC' # Añadidas algunas de las que antes iban por CoinGecko
        }
        
    def get_historical_data(
        self,
        symbol: str,
        start_date: Union[str, datetime],
        end_date: Optional[Union[str, datetime]] = None,
        interval: str = '1d'
    ) -> pd.DataFrame:
        """
        Download historical data for a single symbol.
        
        Args:
            symbol: Stock or cryptocurrency symbol
            start_date: Start date
            end_date: End date (optional)
            interval: Data interval (default: '1d')
            
        Returns:
            DataFrame with historical data
        """
        # Convert dates to datetime
        if isinstance(start_date, str):
            start_date = datetime.strptime(start_date, '%Y-%m-%d')
        if isinstance(end_date, str):
            end_date = datetime.strptime(end_date, '%Y-%m-%d')
        elif end_date is None:
            end_date = datetime.now()
            
        # Check if symbol is a cryptocurrency and use Binance
        if self._is_crypto(symbol):
            return self._get_binance_data(symbol, start_date, end_date) # Siempre usar Binance para cryptos soportadas
        else:
            return self._get_stock_data(symbol, start_date, end_date, interval)
    
    def get_multiple_symbols(
        self,
        symbols: List[str],
        start_date: Union[str, datetime],
        end_date: Optional[Union[str, datetime]] = None,
        interval: str = '1d'
    ) -> dict:
        """
        Download historical data for multiple symbols.
        
        Args:
            symbols: List of stock or cryptocurrency symbols
            start_date: Start date
            end_date: End date (optional)
            interval: Data interval (default: '1d')
            
        Returns:
            Dictionary with DataFrames for each symbol
        """
        data = {}
        for symbol in symbols:
            data[symbol] = self.get_historical_data(
                symbol, start_date, end_date, interval
            )
        return data
    
    def _is_crypto(self, symbol: str) -> bool:
        """
        Check if a symbol is a cryptocurrency.
        
        Args:
            symbol: Symbol to check
            
        Returns:
            True if symbol is a cryptocurrency, False otherwise
        """
        return symbol.upper() in self.supported_cryptos
    
    # Se elimina _get_crypto_data ya que ahora todas las cryptos soportadas irán por Binance

    def _get_stock_data(
        self,
        symbol: str,
        start_date: datetime,
        end_date: datetime,
        interval: str
    ) -> pd.DataFrame:
        """
        Download historical data for a stock using yfinance.
        
        Args:
            symbol: Stock symbol
            start_date: Start date
            end_date: End date
            interval: Data interval
            
        Returns:
            DataFrame with historical data
        """
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(start=start_date, end=end_date, interval=interval, auto_adjust=True)
            if df.empty:
                print(f"No historical data found for {symbol} with yfinance.")
                return pd.DataFrame()
            df.index.name = 'Date' # Asegurar que el índice se llame 'Date'
            return df
        except Exception as e:
            print(f"Error fetching stock data for {symbol}: {e}")
            return pd.DataFrame()

    def _get_binance_data(self, symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """
        Download historical cryptocurrency data from Binance.
        
        Args:
            symbol: Cryptocurrency symbol
            start_date: Start date
            end_date: End date
            
        Returns:
            DataFrame with historical data
        """
        symbol = symbol.upper() + 'USDT'  # BTC -> BTCUSDT
        klines_url = f"{self.binance_base_url}/klines"
        
        # Convert datetime to milliseconds timestamp for Binance API
        start_ts = int(start_date.timestamp() * 1000)
        end_ts = int(end_date.timestamp() * 1000)
        
        params = {
            'symbol': symbol,
            'interval': '1d',  # Binance API uses '1d' for daily
            'startTime': start_ts,
            'endTime': end_ts,
            'limit': 1000 # Max limit per request
        }
        
        all_data = []
        while True:
            try:
                response = requests.get(klines_url, params=params)
                response.raise_for_status()
                data = response.json()
                
                if not data:
                    break
                    
                all_data.extend(data)
                
                # Update start_ts for the next request
                params['startTime'] = data[-1][0] + 1 # Last timestamp + 1 ms
                time.sleep(0.1) # Be kind to the API
                
            except requests.exceptions.RequestException as e:
                print(f"Error fetching data from Binance for {symbol}: {e}")
                return pd.DataFrame()
        
        if not all_data:
            print(f"No historical data found for {symbol} on Binance.")
            return pd.DataFrame()

        # Process the raw data
        df = pd.DataFrame(all_data, columns=[
            'Open time', 'Open', 'High', 'Low', 'Close', 'Volume', 
            'Close time', 'Quote asset volume', 'Number of trades',
            'Taker buy base asset volume', 'Taker buy quote asset volume', 'Ignore'
        ])
        
        df['Open time'] = pd.to_datetime(df['Open time'], unit='ms')
        df.set_index('Open time', inplace=True)
        
        # Ensure correct column types
        numeric_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col])
            
        # Select and rename relevant columns with initial capital letters
        df = df[['Open', 'High', 'Low', 'Close', 'Volume']]
        
        return df