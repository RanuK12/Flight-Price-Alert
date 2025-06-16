import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple

class MovingAverageCrossover:
    def __init__(self, short_window: int = 20, long_window: int = 50, 
                 signal_threshold: float = 0.02):
        """
        Initialize the Moving Average Crossover strategy.
        
        Args:
            short_window: Short-term moving average window
            long_window: Long-term moving average window
            signal_threshold: Minimum price change threshold for signals
        """
        self.short_window = short_window
        self.long_window = long_window
        self.signal_threshold = signal_threshold
        
    def generate_signals(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Generate trading signals based on moving average crossover.
        
        Args:
            data: DataFrame with OHLCV data
            
        Returns:
            DataFrame with signals (1 for buy, -1 for sell, 0 for hold)
        """
        df = data.copy()
        
        # Calculate moving averages
        df['short_ma'] = df['close'].rolling(window=self.short_window).mean()
        df['long_ma'] = df['close'].rolling(window=self.long_window).mean()
        
        # Calculate crossover signals
        df['signal'] = 0
        df.loc[df['short_ma'] > df['long_ma'], 'signal'] = 1
        df.loc[df['short_ma'] < df['long_ma'], 'signal'] = -1
        
        # Apply signal threshold
        price_change = df['close'].pct_change()
        df.loc[abs(price_change) < self.signal_threshold, 'signal'] = 0
        
        return df
    
    def get_position_size(self, data: pd.DataFrame, capital: float, 
                         risk_per_trade: float = 0.02) -> pd.DataFrame:
        """
        Calculate position sizes based on risk management.
        
        Args:
            data: DataFrame with signals
            capital: Available capital
            risk_per_trade: Maximum risk per trade as a percentage
            
        Returns:
            DataFrame with position sizes
        """
        df = data.copy()
        
        # Calculate ATR for volatility
        df['tr'] = np.maximum(
            df['high'] - df['low'],
            np.maximum(
                abs(df['high'] - df['close'].shift(1)),
                abs(df['low'] - df['close'].shift(1))
            )
        )
        df['atr'] = df['tr'].rolling(window=14).mean()
        
        # Calculate position size based on risk
        df['position_size'] = 0.0
        risk_amount = capital * risk_per_trade
        
        # Only calculate position size for active signals
        active_signals = df['signal'] != 0
        df.loc[active_signals, 'position_size'] = risk_amount / df.loc[active_signals, 'atr']
        
        # Normalize position size to available capital
        max_position = capital * 0.1  # Maximum 10% of capital per position
        df['position_size'] = df['position_size'].clip(upper=max_position)
        
        return df
    
    def get_stop_loss_take_profit(self, data: pd.DataFrame, 
                                 stop_loss_pct: float = 0.02,
                                 take_profit_pct: float = 0.04) -> pd.DataFrame:
        """
        Calculate stop loss and take profit levels.
        
        Args:
            data: DataFrame with signals and position sizes
            stop_loss_pct: Stop loss percentage
            take_profit_pct: Take profit percentage
            
        Returns:
            DataFrame with stop loss and take profit levels
        """
        df = data.copy()
        
        # Calculate stop loss and take profit levels
        df['stop_loss'] = df['close'] * (1 - stop_loss_pct)
        df['take_profit'] = df['close'] * (1 + take_profit_pct)
        
        return df 