from typing import Dict, Optional
import pandas as pd
import numpy as np
from ta.trend import SMAIndicator
from ta.momentum import RSIIndicator
from ta.trend import MACD
from src.strategies.base_strategy import BaseStrategy

class MovingAverageCrossover(BaseStrategy):
    def __init__(self,
                 short_window: int = 20,
                 long_window: int = 50,
                 signal_threshold: float = 0.0):
        """
        Initialize Moving Average Crossover strategy.
        
        Args:
            short_window: Short-term moving average window
            long_window: Long-term moving average window
            signal_threshold: Minimum difference between MAs to generate signal
        """
        super().__init__(
            short_window=short_window,
            long_window=long_window,
            signal_threshold=signal_threshold
        )
        
    def generate_signals(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Generate trading signals based on MA crossover.
        
        Args:
            data: OHLCV data
            
        Returns:
            DataFrame with trading signals (1: buy, -1: sell, 0: hold)
        """
        # Preprocess data
        df = self.preprocess_data(data)
        
        # Calculate moving averages
        short_ma = SMAIndicator(close=df['close'], window=self.params['short_window']).sma_indicator()
        long_ma = SMAIndicator(close=df['close'], window=self.params['long_window']).sma_indicator()
        
        # Calculate MA difference
        ma_diff = short_ma - long_ma
        
        # Initialize signals column
        df['signal'] = 0
        
        # Generate signals based on crossover
        df.loc[(ma_diff.shift(1) <= self.params['signal_threshold']) & 
               (ma_diff > self.params['signal_threshold']), 'signal'] = 1  # Buy signal
        df.loc[(ma_diff.shift(1) >= -self.params['signal_threshold']) & 
               (ma_diff < -self.params['signal_threshold']), 'signal'] = -1  # Sell signal
            
        return df
    
    def calculate_indicators(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate strategy indicators.
        
        Args:
            data: OHLCV data
            
        Returns:
            DataFrame with calculated indicators
        """
        df = self.preprocess_data(data)
        
        # Calculate moving averages
        df['short_ma'] = SMAIndicator(close=df['close'], window=self.params['short_window']).sma_indicator()
        df['long_ma'] = SMAIndicator(close=df['close'], window=self.params['long_window']).sma_indicator()
        
        # Calculate MA difference
        df['ma_diff'] = df['short_ma'] - df['long_ma']
        
        # Calculate additional indicators
        df['rsi'] = RSIIndicator(close=df['close'], window=14).rsi()
        macd = MACD(close=df['close'], window_slow=26, window_fast=12, window_sign=9)
        df['macd'] = macd.macd()
        df['macd_signal'] = macd.macd_signal()
        df['macd_hist'] = macd.macd_diff()
        
        return df
    
    def get_parameters(self) -> Dict:
        """
        Get strategy parameters.
        
        Returns:
            Dictionary with strategy parameters
        """
        return {
            'short_window': self.params['short_window'],
            'long_window': self.params['long_window'],
            'signal_threshold': self.params['signal_threshold']
        }
    
    def set_parameters(self, params: Dict):
        """
        Set strategy parameters.
        
        Args:
            params: Dictionary with strategy parameters
        """
        self.params['short_window'] = params.get('short_window', self.params['short_window'])
        self.params['long_window'] = params.get('long_window', self.params['long_window'])
        self.params['signal_threshold'] = params.get('signal_threshold', self.params['signal_threshold']) 