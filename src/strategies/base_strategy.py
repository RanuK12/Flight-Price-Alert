from abc import ABC, abstractmethod
import pandas as pd
from typing import Dict, Any, Optional

class BaseStrategy(ABC):
    """Base class for all trading strategies."""
    
    def __init__(self, **kwargs):
        """Initialize strategy with parameters."""
        self.params = kwargs
    
    @abstractmethod
    def generate_signals(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Generate trading signals based on the strategy logic.
        
        Args:
            data: DataFrame with OHLCV data
            
        Returns:
            DataFrame with trading signals
        """
        pass
    
    @abstractmethod
    def calculate_indicators(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate technical indicators used by the strategy.
        
        Args:
            data: DataFrame with OHLCV data
            
        Returns:
            DataFrame with calculated indicators
        """
        pass
    
    def update_parameters(self, **kwargs) -> None:
        """
        Update strategy parameters.
        
        Args:
            **kwargs: New parameter values
        """
        self.params.update(kwargs)
    
    def get_parameters(self) -> Dict[str, Any]:
        """
        Get current strategy parameters.
        
        Returns:
            Dictionary with parameter names and values
        """
        return self.params.copy()
    
    def validate_data(self, data: pd.DataFrame) -> bool:
        """
        Validate input data has required columns.
        
        Args:
            data: DataFrame to validate
            
        Returns:
            True if data is valid, False otherwise
        """
        required_columns = ['open', 'high', 'low', 'close', 'volume']
        return all(col in data.columns for col in required_columns)
    
    def preprocess_data(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Preprocess data before strategy execution.
        
        Args:
            data: Raw OHLCV data
            
        Returns:
            Preprocessed DataFrame
        """
        if not self.validate_data(data):
            raise ValueError("Input data missing required columns")
        
        # Make a copy to avoid modifying original data
        df = data.copy()
        
        # Ensure index is datetime
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)
        
        # Sort by index
        df = df.sort_index()
        
        # Remove any duplicate indices
        df = df[~df.index.duplicated(keep='first')]
        
        return df 