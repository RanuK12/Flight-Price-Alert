import yfinance as yf
import pandas as pd
from typing import Optional, Union
from datetime import datetime

class DataFetcher:
    """
    Clase para obtener datos históricos de activos financieros usando yfinance.
    """
    def get_historical_data(self, symbol: str, start: Union[str, datetime], end: Optional[Union[str, datetime]] = None) -> pd.DataFrame:
        """
        Descarga datos históricos de un símbolo usando yfinance.
        Args:
            symbol (str): Símbolo del activo (por ejemplo, 'AAPL')
            start (str o datetime): Fecha de inicio
            end (str o datetime, opcional): Fecha de fin
        Returns:
            pd.DataFrame: DataFrame con columnas ['open', 'high', 'low', 'close', 'volume']
        """
        df = yf.download(symbol, start=start, end=end, auto_adjust=True)
        df = df.rename(columns={
            'Open': 'open',
            'High': 'high',
            'Low': 'low',
            'Close': 'close',
            'Volume': 'volume'
        })
        return df[['open', 'high', 'low', 'close', 'volume']] 