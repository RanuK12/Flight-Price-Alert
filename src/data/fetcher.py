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
        self.coingecko_base_url = "https://api.coingecko.com/api/v3"
        self.binance_base_url = "https://api.binance.com/api/v3"
        self.binance_supported = ['PEPE', 'DOGE', 'SHIB', 'BNB', 'SOL', 'ADA', 'XRP', 'AVAX', 'MATIC', 'LTC', 'BCH', 'LINK', 'UNI', 'CAKE', 'SAND', 'APE', 'GMT', 'OP', 'ARB', '1000SATS', 'FLOKI', 'WIF']
        self.supported_cryptos = {
            'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'DOT', 'UNI', 'LINK',
            'SOL', 'MATIC', 'LTC', 'AVAX', 'SHIB', 'PEPE', 'FLOKI', 'BONK'
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
            
        # Check if symbol is a cryptocurrency
        if self._is_crypto(symbol):
            # Si es BTC o ETH, usar CoinGecko, si es PEPE u otro, usar Binance
            if symbol.upper() in ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'USDC', 'ADA', 'AVAX', 'DOGE']:
                return self._get_crypto_data(symbol, start_date, end_date, interval)
            elif symbol.upper() in self.binance_supported:
                return self._get_binance_data(symbol, start_date, end_date)
            else:
                print(f"Crypto symbol {symbol} not supported by Binance or CoinGecko.")
                return pd.DataFrame()
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
    
    def _get_crypto_data(
        self,
        symbol: str,
        start_date: datetime,
        end_date: datetime,
        interval: str
    ) -> pd.DataFrame:
        """
        Download historical data for a cryptocurrency using CoinGecko API.
        
        Args:
            symbol: Cryptocurrency symbol
            start_date: Start date
            end_date: End date
            interval: Data interval
            
        Returns:
            DataFrame with historical data
        """
        # Convert interval to CoinGecko format
        interval_map = {
            '1d': 'daily',
            '1h': 'hourly',
            '1w': 'weekly',
            '1m': 'monthly'
        }
        cg_interval = interval_map.get(interval, 'daily')
        
        # Convert dates to Unix timestamps
        start_timestamp = int(start_date.timestamp())
        end_timestamp = int(end_date.timestamp())
        
        # Get data from CoinGecko
        url = f"{self.coingecko_base_url}/coins/{symbol.lower()}/market_chart/range"
        params = {
            'vs_currency': 'usd',
            'from': start_timestamp,
            'to': end_timestamp
        }
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            # Convert to DataFrame
            df = pd.DataFrame(data['prices'], columns=['timestamp', 'close'])
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)
            
            # Add other columns
            df['open'] = df['close'].shift(1)
            df['high'] = df['close']
            df['low'] = df['close']
            df['volume'] = 0  # CoinGecko doesn't provide volume in this endpoint
            
            # Forward fill missing values
            df.fillna(method='ffill', inplace=True)
            
            # Resample to desired interval
            if interval != '1d':
                df = df.resample(interval).agg({
                    'open': 'first',
                    'high': 'max',
                    'low': 'min',
                    'close': 'last',
                    'volume': 'sum'
                })
            
            # Rename columns to lowercase
            df.columns = [col.lower() for col in df.columns]
            
            return df
            
        except requests.exceptions.RequestException as e:
            print(f"Error fetching data for {symbol}: {e}")
            return pd.DataFrame()
    
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
            data = yf.download(
                symbol,
                start=start_date,
                end=end_date,
                interval=interval
            )
            
            # Rename columns to lowercase
            data.columns = [col.lower() for col in data.columns]
            
            return data
            
        except Exception as e:
            print(f"Error downloading data for {symbol}: {e}")
            return pd.DataFrame()

    def _get_binance_data(self, symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
        """
        Download historical data for a cryptocurrency using Binance API.
        """
        # Convertir fechas a timestamps
        start_ts = int(start_date.timestamp() * 1000)
        end_ts = int(end_date.timestamp() * 1000)
        
        # Construir URL para la API de Binance
        url = f"{self.binance_base_url}/klines"
        params = {
            'symbol': f"{symbol}USDT",
            'interval': '1d',
            'startTime': start_ts,
            'endTime': end_ts,
            'limit': 1000
        }
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            # Convertir datos a DataFrame
            df = pd.DataFrame(data, columns=[
                'timestamp', 'Open', 'High', 'Low', 'Close', 'Volume',
                'close_time', 'quote_volume', 'trades', 'taker_buy_base',
                'taker_buy_quote', 'ignore'
            ])
            
            # Convertir tipos de datos
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            for col in ['Open', 'High', 'Low', 'Close', 'Volume']:
                df[col] = pd.to_numeric(df[col])
                
            # Establecer timestamp como índice
            df.set_index('timestamp', inplace=True)
            
            # Seleccionar columnas necesarias
            df = df[['Open', 'High', 'Low', 'Close', 'Volume']]
            
            return df
            
        except requests.exceptions.RequestException as e:
            raise Exception(f"Error al obtener datos de Binance: {str(e)}") 