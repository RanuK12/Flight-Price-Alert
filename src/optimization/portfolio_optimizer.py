import numpy as np
import pandas as pd
from scipy.optimize import minimize
from typing import Dict, List, Tuple
import plotly.graph_objects as go
from ..data.exchange import CryptoExchange

class PortfolioOptimizer:
    def __init__(self, exchange: CryptoExchange):
        """
        Initialize portfolio optimizer.
        
        Args:
            exchange: Exchange instance
        """
        self.exchange = exchange
        
    def optimize_portfolio(self,
                          symbols: List[str],
                          timeframe: str = '1d',
                          lookback: int = 365,
                          risk_free_rate: float = 0.02) -> Dict:
        """
        Optimize portfolio weights using Modern Portfolio Theory.
        
        Args:
            symbols: List of trading pairs
            timeframe: Candle timeframe
            lookback: Number of days to look back
            risk_free_rate: Risk-free rate
            
        Returns:
            Dictionary with optimization results
        """
        # Get historical data
        returns_data = self._get_returns_data(symbols, timeframe, lookback)
        
        # Calculate mean returns and covariance matrix
        mean_returns = returns_data.mean()
        cov_matrix = returns_data.cov()
        
        # Optimize portfolio
        num_assets = len(symbols)
        args = (mean_returns, cov_matrix, risk_free_rate)
        constraints = ({'type': 'eq', 'fun': lambda x: np.sum(x) - 1})
        bounds = tuple((0, 1) for _ in range(num_assets))
        initial_weights = np.array([1/num_assets] * num_assets)
        
        # Maximize Sharpe ratio
        result = minimize(
            self._negative_sharpe_ratio,
            initial_weights,
            args=args,
            method='SLSQP',
            bounds=bounds,
            constraints=constraints
        )
        
        # Calculate portfolio metrics
        optimal_weights = result.x
        portfolio_return = np.sum(mean_returns * optimal_weights)
        portfolio_volatility = np.sqrt(
            np.dot(optimal_weights.T, np.dot(cov_matrix, optimal_weights))
        )
        sharpe_ratio = (portfolio_return - risk_free_rate) / portfolio_volatility
        
        return {
            'weights': dict(zip(symbols, optimal_weights)),
            'expected_return': portfolio_return,
            'volatility': portfolio_volatility,
            'sharpe_ratio': sharpe_ratio
        }
    
    def generate_efficient_frontier(self,
                                  symbols: List[str],
                                  timeframe: str = '1d',
                                  lookback: int = 365,
                                  num_portfolios: int = 100) -> pd.DataFrame:
        """
        Generate efficient frontier.
        
        Args:
            symbols: List of trading pairs
            timeframe: Candle timeframe
            lookback: Number of days to look back
            num_portfolios: Number of portfolios to generate
            
        Returns:
            DataFrame with efficient frontier data
        """
        # Get historical data
        returns_data = self._get_returns_data(symbols, timeframe, lookback)
        
        # Calculate mean returns and covariance matrix
        mean_returns = returns_data.mean()
        cov_matrix = returns_data.cov()
        
        # Generate random portfolios
        portfolios = []
        for _ in range(num_portfolios):
            weights = np.random.random(len(symbols))
            weights = weights / np.sum(weights)
            
            portfolio_return = np.sum(mean_returns * weights)
            portfolio_volatility = np.sqrt(
                np.dot(weights.T, np.dot(cov_matrix, weights))
            )
            
            portfolios.append({
                'weights': weights,
                'return': portfolio_return,
                'volatility': portfolio_volatility
            })
            
        return pd.DataFrame(portfolios)
    
    def plot_efficient_frontier(self,
                              efficient_frontier: pd.DataFrame,
                              optimal_portfolio: Dict) -> go.Figure:
        """
        Plot efficient frontier.
        
        Args:
            efficient_frontier: DataFrame with efficient frontier data
            optimal_portfolio: Dictionary with optimal portfolio data
            
        Returns:
            Plotly figure
        """
        fig = go.Figure()
        
        # Plot efficient frontier
        fig.add_trace(go.Scatter(
            x=efficient_frontier['volatility'],
            y=efficient_frontier['return'],
            mode='markers',
            name='Random Portfolios',
            marker=dict(
                size=8,
                color=efficient_frontier['return'],
                colorscale='Viridis',
                showscale=True
            )
        ))
        
        # Plot optimal portfolio
        fig.add_trace(go.Scatter(
            x=[optimal_portfolio['volatility']],
            y=[optimal_portfolio['expected_return']],
            mode='markers',
            name='Optimal Portfolio',
            marker=dict(
                size=12,
                color='red',
                symbol='star'
            )
        ))
        
        fig.update_layout(
            title='Efficient Frontier',
            xaxis_title='Portfolio Volatility',
            yaxis_title='Expected Return',
            showlegend=True
        )
        
        return fig
    
    def _get_returns_data(self,
                         symbols: List[str],
                         timeframe: str,
                         lookback: int) -> pd.DataFrame:
        """Get historical returns data for symbols."""
        returns_data = pd.DataFrame()
        
        for symbol in symbols:
            # Get OHLCV data
            ohlcv = self.exchange.get_ohlcv(
                symbol=symbol,
                timeframe=timeframe,
                limit=lookback
            )
            
            # Calculate returns
            returns = ohlcv['close'].pct_change().dropna()
            returns_data[symbol] = returns
            
        return returns_data
    
    def _negative_sharpe_ratio(self,
                              weights: np.ndarray,
                              mean_returns: pd.Series,
                              cov_matrix: pd.DataFrame,
                              risk_free_rate: float) -> float:
        """Calculate negative Sharpe ratio for optimization."""
        portfolio_return = np.sum(mean_returns * weights)
        portfolio_volatility = np.sqrt(
            np.dot(weights.T, np.dot(cov_matrix, weights))
        )
        sharpe_ratio = (portfolio_return - risk_free_rate) / portfolio_volatility
        return -sharpe_ratio 