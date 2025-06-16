from typing import Dict, List, Optional, Union
import pandas as pd
import numpy as np
from datetime import datetime
from ..risk.risk_manager import RiskManager

class BacktestEngine:
    def __init__(self,
                 initial_capital: float = 100000.0,
                 commission: float = 0.001,  # 0.1% commission
                 slippage: float = 0.0005,   # 0.05% slippage
                 risk_manager: Optional[RiskManager] = None):
        """
        Initialize backtesting engine.
        
        Args:
            initial_capital: Initial capital for backtesting
            commission: Trading commission as decimal
            slippage: Slippage as decimal
            risk_manager: Risk manager instance
        """
        self.initial_capital = initial_capital
        self.commission = commission
        self.slippage = slippage
        self.risk_manager = risk_manager or RiskManager()
        
        self.positions = []
        self.trades = []
        self.equity_curve = []
        
    def run(self,
            data: pd.DataFrame,
            strategy,
            params: Optional[Dict] = None) -> Dict:
        """
        Run backtest with given strategy and parameters.
        
        Args:
            data: OHLCV data
            strategy: Strategy class instance
            params: Strategy parameters
            
        Returns:
            Dictionary with backtest results
        """
        self.reset()
        self.data = data
        self.strategy = strategy
        self.params = params or {}
        
        # Initialize portfolio
        portfolio = {
            'cash': self.initial_capital,
            'positions': {},
            'equity': self.initial_capital
        }
        
        # Run strategy on each bar
        for i in range(len(data)):
            current_bar = data.iloc[i]
            signals = self.strategy.generate_signals(data.iloc[:i+1], self.params)
            
            if signals:
                self._execute_trades(signals, current_bar, portfolio)
            
            self._update_portfolio(portfolio, current_bar)
            self.equity_curve.append(portfolio['equity'])
        
        return self._calculate_results()
    
    def _execute_trades(self,
                       signals: Dict,
                       current_bar: pd.Series,
                       portfolio: Dict):
        """Execute trades based on signals."""
        for symbol, signal in signals.items():
            if signal == 0:  # No action
                continue
                
            current_price = current_bar['close']
            position_size = self.risk_manager.calculate_position_size(
                portfolio['equity'],
                current_price,
                current_bar['close'].pct_change().std()
            )
            
            # Apply slippage
            execution_price = current_price * (1 + self.slippage if signal > 0 else 1 - self.slippage)
            
            # Calculate commission
            commission = position_size * execution_price * self.commission
            
            if signal > 0:  # Buy
                if portfolio['cash'] >= position_size * execution_price + commission:
                    portfolio['cash'] -= position_size * execution_price + commission
                    portfolio['positions'][symbol] = {
                        'size': position_size,
                        'entry_price': execution_price,
                        'entry_time': current_bar.name
                    }
                    self.trades.append({
                        'time': current_bar.name,
                        'symbol': symbol,
                        'type': 'buy',
                        'price': execution_price,
                        'size': position_size,
                        'commission': commission
                    })
                    
            else:  # Sell
                if symbol in portfolio['positions']:
                    position = portfolio['positions'][symbol]
                    portfolio['cash'] += position['size'] * execution_price - commission
                    del portfolio['positions'][symbol]
                    self.trades.append({
                        'time': current_bar.name,
                        'symbol': symbol,
                        'type': 'sell',
                        'price': execution_price,
                        'size': position['size'],
                        'commission': commission
                    })
    
    def _update_portfolio(self,
                         portfolio: Dict,
                         current_bar: pd.Series):
        """Update portfolio value based on current prices."""
        portfolio['equity'] = portfolio['cash']
        for symbol, position in portfolio['positions'].items():
            portfolio['equity'] += position['size'] * current_bar['close']
    
    def _calculate_results(self) -> Dict:
        """Calculate backtest performance metrics."""
        equity_curve = pd.Series(self.equity_curve, index=self.data.index)
        returns = equity_curve.pct_change().dropna()
        
        # Calculate metrics
        total_return = (equity_curve[-1] / self.initial_capital) - 1
        annual_return = (1 + total_return) ** (252 / len(returns)) - 1
        sharpe_ratio = np.sqrt(252) * returns.mean() / returns.std()
        max_drawdown = (equity_curve / equity_curve.expanding().max() - 1).min()
        
        # Calculate trade statistics
        trades_df = pd.DataFrame(self.trades)
        if not trades_df.empty:
            win_rate = len(trades_df[trades_df['type'] == 'sell']) / len(trades_df)
            avg_trade = trades_df['price'].mean()
        else:
            win_rate = 0
            avg_trade = 0
        
        return {
            'total_return': total_return,
            'annual_return': annual_return,
            'sharpe_ratio': sharpe_ratio,
            'max_drawdown': max_drawdown,
            'win_rate': win_rate,
            'avg_trade': avg_trade,
            'num_trades': len(self.trades),
            'equity_curve': equity_curve,
            'trades': self.trades
        }
    
    def reset(self):
        """Reset backtest state."""
        self.positions = []
        self.trades = []
        self.equity_curve = [] 