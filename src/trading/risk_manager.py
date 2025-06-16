import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple

class RiskManager:
    def __init__(self, initial_capital: float, max_position_size: float = 0.1,
                 max_drawdown: float = 0.2, stop_loss_pct: float = 0.02,
                 take_profit_pct: float = 0.04, trailing_stop_pct: float = 0.01):
        """
        Initialize the risk manager.
        
        Args:
            initial_capital: Initial trading capital
            max_position_size: Maximum position size as a fraction of capital
            max_drawdown: Maximum allowed drawdown
            stop_loss_pct: Stop loss percentage
            take_profit_pct: Take profit percentage
            trailing_stop_pct: Trailing stop percentage
        """
        self.initial_capital = initial_capital
        self.current_capital = initial_capital
        self.max_position_size = max_position_size
        self.max_drawdown = max_drawdown
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.trailing_stop_pct = trailing_stop_pct
        self.positions = {}
        self.trade_history = []
        
    def calculate_position_size(self, symbol: str, price: float, 
                              volatility: float) -> float:
        """
        Calculate position size based on risk parameters.
        
        Args:
            symbol: Trading pair symbol
            price: Current price
            volatility: Current volatility (ATR)
            
        Returns:
            Position size in base currency
        """
        # Calculate risk per trade
        risk_amount = self.current_capital * self.max_position_size
        
        # Adjust position size based on volatility
        position_size = risk_amount / volatility
        
        # Ensure position size doesn't exceed maximum
        max_position = self.current_capital * self.max_position_size
        position_size = min(position_size, max_position)
        
        return position_size
    
    def update_position(self, symbol: str, price: float, 
                       position_size: float, side: str) -> Dict:
        """
        Update position information and check for stop loss/take profit.
        
        Args:
            symbol: Trading pair symbol
            price: Current price
            position_size: Position size
            side: Position side ('buy' or 'sell')
            
        Returns:
            Dictionary with position update information
        """
        if symbol not in self.positions:
            # New position
            self.positions[symbol] = {
                'size': position_size,
                'entry_price': price,
                'side': side,
                'stop_loss': price * (1 - self.stop_loss_pct) if side == 'buy' 
                           else price * (1 + self.stop_loss_pct),
                'take_profit': price * (1 + self.take_profit_pct) if side == 'buy'
                             else price * (1 - self.take_profit_pct),
                'trailing_stop': price * (1 - self.trailing_stop_pct) if side == 'buy'
                               else price * (1 + self.trailing_stop_pct)
            }
            return {'action': 'open', 'position': self.positions[symbol]}
        
        position = self.positions[symbol]
        
        # Update trailing stop
        if side == 'buy':
            if price > position['entry_price']:
                new_stop = price * (1 - self.trailing_stop_pct)
                if new_stop > position['trailing_stop']:
                    position['trailing_stop'] = new_stop
        else:
            if price < position['entry_price']:
                new_stop = price * (1 + self.trailing_stop_pct)
                if new_stop < position['trailing_stop']:
                    position['trailing_stop'] = new_stop
        
        # Check stop loss and take profit
        if side == 'buy':
            if price <= position['stop_loss'] or price <= position['trailing_stop']:
                return {'action': 'close', 'reason': 'stop_loss', 'position': position}
            if price >= position['take_profit']:
                return {'action': 'close', 'reason': 'take_profit', 'position': position}
        else:
            if price >= position['stop_loss'] or price >= position['trailing_stop']:
                return {'action': 'close', 'reason': 'stop_loss', 'position': position}
            if price <= position['take_profit']:
                return {'action': 'close', 'reason': 'take_profit', 'position': position}
        
        return {'action': 'hold', 'position': position}
    
    def close_position(self, symbol: str, price: float) -> Dict:
        """
        Close a position and update capital.
        
        Args:
            symbol: Trading pair symbol
            price: Current price
            
        Returns:
            Dictionary with trade information
        """
        if symbol not in self.positions:
            return {'error': 'Position not found'}
        
        position = self.positions[symbol]
        pnl = (price - position['entry_price']) * position['size'] if position['side'] == 'buy' \
              else (position['entry_price'] - price) * position['size']
        
        # Update capital
        self.current_capital += pnl
        
        # Record trade
        trade = {
            'symbol': symbol,
            'side': position['side'],
            'entry_price': position['entry_price'],
            'exit_price': price,
            'size': position['size'],
            'pnl': pnl,
            'timestamp': pd.Timestamp.now()
        }
        self.trade_history.append(trade)
        
        # Remove position
        del self.positions[symbol]
        
        return trade
    
    def get_portfolio_metrics(self) -> Dict:
        """
        Calculate portfolio performance metrics.
        
        Returns:
            Dictionary with portfolio metrics
        """
        if not self.trade_history:
            return {
                'total_trades': 0,
                'win_rate': 0,
                'avg_pnl': 0,
                'max_drawdown': 0,
                'sharpe_ratio': 0
            }
        
        trades_df = pd.DataFrame(self.trade_history)
        
        # Calculate metrics
        total_trades = len(trades_df)
        winning_trades = len(trades_df[trades_df['pnl'] > 0])
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        avg_pnl = trades_df['pnl'].mean()
        
        # Calculate drawdown
        cumulative_returns = (1 + trades_df['pnl'] / self.initial_capital).cumprod()
        rolling_max = cumulative_returns.expanding().max()
        drawdowns = (cumulative_returns - rolling_max) / rolling_max
        max_drawdown = drawdowns.min()
        
        # Calculate Sharpe ratio
        returns = trades_df['pnl'] / self.initial_capital
        sharpe_ratio = np.sqrt(252) * returns.mean() / returns.std() if len(returns) > 1 else 0
        
        return {
            'total_trades': total_trades,
            'win_rate': win_rate,
            'avg_pnl': avg_pnl,
            'max_drawdown': max_drawdown,
            'sharpe_ratio': sharpe_ratio
        } 