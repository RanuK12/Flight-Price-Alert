import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta

from .strategy import MovingAverageCrossover
from .risk_manager import RiskManager
from ..data.exchange import CryptoExchange

class BacktestEngine:
    def __init__(self, exchange: CryptoExchange, strategy: MovingAverageCrossover,
                 risk_manager: RiskManager):
        """
        Initialize the backtest engine.
        
        Args:
            exchange: CryptoExchange instance
            strategy: Trading strategy instance
            risk_manager: Risk manager instance
        """
        self.exchange = exchange
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.results = None
        
    def run(self, symbol: str, start_date: datetime, end_date: datetime,
            timeframe: str = '1h') -> pd.DataFrame:
        """
        Run backtest for a given symbol and time period.
        
        Args:
            symbol: Trading pair symbol
            start_date: Start date for backtest
            end_date: End date for backtest
            timeframe: Candle timeframe
            
        Returns:
            DataFrame with backtest results
        """
        # Fetch historical data
        data = self.exchange.get_ohlcv(symbol, timeframe, start_date)
        
        # Generate signals
        data = self.strategy.generate_signals(data)
        
        # Calculate position sizes
        data = self.strategy.get_position_size(data, self.risk_manager.initial_capital)
        
        # Calculate stop loss and take profit levels
        data = self.strategy.get_stop_loss_take_profit(data)
        
        # Initialize results
        results = []
        position = None
        
        # Iterate through data
        for i in range(len(data)):
            current_data = data.iloc[i]
            
            if position is None:
                # Check for entry signal
                if current_data['signal'] != 0:
                    position = {
                        'symbol': symbol,
                        'side': 'buy' if current_data['signal'] > 0 else 'sell',
                        'entry_price': current_data['close'],
                        'size': current_data['position_size'],
                        'entry_time': current_data.name,
                        'stop_loss': current_data['stop_loss'],
                        'take_profit': current_data['take_profit']
                    }
            else:
                # Check for exit conditions
                if position['side'] == 'buy':
                    if (current_data['close'] <= position['stop_loss'] or
                        current_data['close'] >= position['take_profit']):
                        # Close position
                        exit_price = current_data['close']
                        pnl = (exit_price - position['entry_price']) * position['size']
                        results.append({
                            'entry_time': position['entry_time'],
                            'exit_time': current_data.name,
                            'side': position['side'],
                            'entry_price': position['entry_price'],
                            'exit_price': exit_price,
                            'size': position['size'],
                            'pnl': pnl,
                            'return_pct': pnl / (position['entry_price'] * position['size'])
                        })
                        position = None
                else:
                    if (current_data['close'] >= position['stop_loss'] or
                        current_data['close'] <= position['take_profit']):
                        # Close position
                        exit_price = current_data['close']
                        pnl = (position['entry_price'] - exit_price) * position['size']
                        results.append({
                            'entry_time': position['entry_time'],
                            'exit_time': current_data.name,
                            'side': position['side'],
                            'entry_price': position['entry_price'],
                            'exit_price': exit_price,
                            'size': position['size'],
                            'pnl': pnl,
                            'return_pct': pnl / (position['entry_price'] * position['size'])
                        })
                        position = None
        
        # Convert results to DataFrame
        self.results = pd.DataFrame(results)
        return self.results
    
    def get_performance_metrics(self) -> Dict:
        """
        Calculate backtest performance metrics.
        
        Returns:
            Dictionary with performance metrics
        """
        if self.results is None or len(self.results) == 0:
            return {
                'total_trades': 0,
                'win_rate': 0,
                'avg_return': 0,
                'max_drawdown': 0,
                'sharpe_ratio': 0,
                'total_return': 0
            }
        
        # Calculate basic metrics
        total_trades = len(self.results)
        winning_trades = len(self.results[self.results['pnl'] > 0])
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        avg_return = self.results['return_pct'].mean()
        total_return = self.results['pnl'].sum()
        
        # Calculate drawdown
        cumulative_returns = (1 + self.results['return_pct']).cumprod()
        rolling_max = cumulative_returns.expanding().max()
        drawdowns = (cumulative_returns - rolling_max) / rolling_max
        max_drawdown = drawdowns.min()
        
        # Calculate Sharpe ratio
        returns = self.results['return_pct']
        sharpe_ratio = np.sqrt(252) * returns.mean() / returns.std() if len(returns) > 1 else 0
        
        return {
            'total_trades': total_trades,
            'win_rate': win_rate,
            'avg_return': avg_return,
            'max_drawdown': max_drawdown,
            'sharpe_ratio': sharpe_ratio,
            'total_return': total_return
        }
    
    def plot_results(self) -> None:
        """
        Plot backtest results.
        """
        if self.results is None or len(self.results) == 0:
            print("No results to plot")
            return
        
        import matplotlib.pyplot as plt
        
        # Plot cumulative returns
        cumulative_returns = (1 + self.results['return_pct']).cumprod()
        plt.figure(figsize=(12, 6))
        plt.plot(cumulative_returns.index, cumulative_returns.values)
        plt.title('Cumulative Returns')
        plt.xlabel('Date')
        plt.ylabel('Cumulative Return')
        plt.grid(True)
        plt.show()
        
        # Plot trade distribution
        plt.figure(figsize=(12, 6))
        plt.hist(self.results['return_pct'], bins=50)
        plt.title('Trade Return Distribution')
        plt.xlabel('Return')
        plt.ylabel('Frequency')
        plt.grid(True)
        plt.show()
        
        # Plot drawdown
        rolling_max = cumulative_returns.expanding().max()
        drawdowns = (cumulative_returns - rolling_max) / rolling_max
        plt.figure(figsize=(12, 6))
        plt.plot(drawdowns.index, drawdowns.values)
        plt.title('Drawdown')
        plt.xlabel('Date')
        plt.ylabel('Drawdown')
        plt.grid(True)
        plt.show() 