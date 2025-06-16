from typing import Dict, Optional, Tuple
import numpy as np
import pandas as pd

class RiskManager:
    def __init__(self, 
                 max_position_size: float = 0.1,  # Maximum position size as fraction of portfolio
                 max_drawdown: float = 0.2,       # Maximum allowed drawdown
                 stop_loss_pct: float = 0.02,     # Stop loss percentage
                 take_profit_pct: float = 0.04,   # Take profit percentage
                 trailing_stop_pct: float = 0.01): # Trailing stop percentage
        """
        Initialize risk management parameters.
        
        Args:
            max_position_size: Maximum position size as fraction of portfolio
            max_drawdown: Maximum allowed drawdown
            stop_loss_pct: Stop loss percentage
            take_profit_pct: Take profit percentage
            trailing_stop_pct: Trailing stop percentage
        """
        self.max_position_size = max_position_size
        self.max_drawdown = max_drawdown
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.trailing_stop_pct = trailing_stop_pct
        
    def calculate_position_size(self, 
                              portfolio_value: float,
                              current_price: float,
                              volatility: float) -> float:
        """
        Calculate optimal position size based on risk parameters.
        
        Args:
            portfolio_value: Current portfolio value
            current_price: Current asset price
            volatility: Asset volatility (standard deviation of returns)
            
        Returns:
            Optimal position size in base currency
        """
        # Kelly Criterion with safety factor
        kelly_fraction = 0.5  # Conservative Kelly
        position_size = portfolio_value * self.max_position_size * kelly_fraction
        
        # Adjust for volatility
        volatility_factor = 1 / (1 + volatility)
        position_size *= volatility_factor
        
        return position_size
    
    def calculate_stop_loss(self, 
                           entry_price: float,
                           position_type: str = 'long') -> float:
        """
        Calculate stop loss price.
        
        Args:
            entry_price: Entry price of the position
            position_type: 'long' or 'short'
            
        Returns:
            Stop loss price
        """
        if position_type == 'long':
            return entry_price * (1 - self.stop_loss_pct)
        else:
            return entry_price * (1 + self.stop_loss_pct)
    
    def calculate_take_profit(self, 
                            entry_price: float,
                            position_type: str = 'long') -> float:
        """
        Calculate take profit price.
        
        Args:
            entry_price: Entry price of the position
            position_type: 'long' or 'short'
            
        Returns:
            Take profit price
        """
        if position_type == 'long':
            return entry_price * (1 + self.take_profit_pct)
        else:
            return entry_price * (1 - self.take_profit_pct)
    
    def update_trailing_stop(self, 
                           current_price: float,
                           highest_price: float,
                           position_type: str = 'long') -> float:
        """
        Update trailing stop price.
        
        Args:
            current_price: Current asset price
            highest_price: Highest price since entry
            position_type: 'long' or 'short'
            
        Returns:
            Updated trailing stop price
        """
        if position_type == 'long':
            return highest_price * (1 - self.trailing_stop_pct)
        else:
            return highest_price * (1 + self.trailing_stop_pct)
    
    def check_margin_call(self, 
                         portfolio_value: float,
                         initial_value: float) -> bool:
        """
        Check if margin call conditions are met.
        
        Args:
            portfolio_value: Current portfolio value
            initial_value: Initial portfolio value
            
        Returns:
            True if margin call conditions are met
        """
        drawdown = (initial_value - portfolio_value) / initial_value
        return drawdown >= self.max_drawdown
    
    def calculate_risk_metrics(self, 
                             returns: pd.Series) -> Dict[str, float]:
        """
        Calculate risk metrics for a strategy.
        
        Args:
            returns: Series of strategy returns
            
        Returns:
            Dictionary with risk metrics
        """
        metrics = {
            'sharpe_ratio': self._calculate_sharpe_ratio(returns),
            'sortino_ratio': self._calculate_sortino_ratio(returns),
            'max_drawdown': self._calculate_max_drawdown(returns),
            'var_95': self._calculate_var(returns, 0.95),
            'cvar_95': self._calculate_cvar(returns, 0.95)
        }
        return metrics
    
    def _calculate_sharpe_ratio(self, returns: pd.Series) -> float:
        """Calculate Sharpe ratio."""
        excess_returns = returns - 0.02/252  # Assuming 2% risk-free rate
        return np.sqrt(252) * excess_returns.mean() / returns.std()
    
    def _calculate_sortino_ratio(self, returns: pd.Series) -> float:
        """Calculate Sortino ratio."""
        excess_returns = returns - 0.02/252
        downside_returns = returns[returns < 0]
        return np.sqrt(252) * excess_returns.mean() / downside_returns.std()
    
    def _calculate_max_drawdown(self, returns: pd.Series) -> float:
        """Calculate maximum drawdown."""
        cumulative_returns = (1 + returns).cumprod()
        rolling_max = cumulative_returns.expanding().max()
        drawdowns = cumulative_returns / rolling_max - 1
        return drawdowns.min()
    
    def _calculate_var(self, returns: pd.Series, confidence: float) -> float:
        """Calculate Value at Risk."""
        return np.percentile(returns, (1 - confidence) * 100)
    
    def _calculate_cvar(self, returns: pd.Series, confidence: float) -> float:
        """Calculate Conditional Value at Risk."""
        var = self._calculate_var(returns, confidence)
        return returns[returns <= var].mean() 