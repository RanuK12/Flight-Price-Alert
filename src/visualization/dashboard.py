import streamlit as st
import plotly.graph_objects as go
import plotly.express as px
import pandas as pd
import numpy as np
from typing import Dict, List
from datetime import datetime

class TradingDashboard:
    def __init__(self):
        """Initialize trading dashboard."""
        st.set_page_config(
            page_title="Crypto Trading Dashboard",
            page_icon="📈",
            layout="wide"
        )
        
    def render(self, backtest_results: Dict, market_data: pd.DataFrame):
        """
        Render the trading dashboard.
        
        Args:
            backtest_results: Dictionary with backtest results
            market_data: DataFrame with market data
        """
        st.title("Crypto Trading Dashboard")
        
        # Sidebar with key metrics
        self._render_sidebar(backtest_results)
        
        # Main content
        col1, col2 = st.columns(2)
        
        with col1:
            self._render_equity_curve(backtest_results)
            self._render_drawdown_chart(backtest_results)
            
        with col2:
            self._render_trade_distribution(backtest_results)
            self._render_market_data(market_data)
            
        # Additional metrics and charts
        self._render_performance_metrics(backtest_results)
        self._render_trade_list(backtest_results)
        
    def _render_sidebar(self, results: Dict):
        """Render sidebar with key metrics."""
        st.sidebar.header("Key Metrics")
        
        metrics = {
            "Total Return": f"{results['total_return']:.2%}",
            "Annual Return": f"{results['annual_return']:.2%}",
            "Sharpe Ratio": f"{results['sharpe_ratio']:.2f}",
            "Max Drawdown": f"{results['max_drawdown']:.2%}",
            "Win Rate": f"{results['win_rate']:.2%}",
            "Number of Trades": str(results['num_trades'])
        }
        
        for metric, value in metrics.items():
            st.sidebar.metric(metric, value)
            
    def _render_equity_curve(self, results: Dict):
        """Render equity curve chart."""
        st.subheader("Equity Curve")
        
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=results['equity_curve'].index,
            y=results['equity_curve'].values,
            mode='lines',
            name='Portfolio Value'
        ))
        
        fig.update_layout(
            xaxis_title="Date",
            yaxis_title="Portfolio Value",
            hovermode='x unified'
        )
        
        st.plotly_chart(fig, use_container_width=True)
        
    def _render_drawdown_chart(self, results: Dict):
        """Render drawdown chart."""
        st.subheader("Drawdown")
        
        equity_curve = results['equity_curve']
        drawdown = (equity_curve / equity_curve.expanding().max() - 1) * 100
        
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=drawdown.index,
            y=drawdown.values,
            mode='lines',
            fill='tozeroy',
            name='Drawdown',
            line=dict(color='red')
        ))
        
        fig.update_layout(
            xaxis_title="Date",
            yaxis_title="Drawdown (%)",
            hovermode='x unified'
        )
        
        st.plotly_chart(fig, use_container_width=True)
        
    def _render_trade_distribution(self, results: Dict):
        """Render trade distribution chart."""
        st.subheader("Trade Distribution")
        
        trades_df = pd.DataFrame(results['trades'])
        if not trades_df.empty:
            fig = px.histogram(
                trades_df,
                x='price',
                color='type',
                barmode='group',
                title='Trade Price Distribution'
            )
            st.plotly_chart(fig, use_container_width=True)
            
    def _render_market_data(self, market_data: pd.DataFrame):
        """Render market data chart."""
        st.subheader("Market Data")
        
        fig = go.Figure()
        fig.add_trace(go.Candlestick(
            x=market_data.index,
            open=market_data['open'],
            high=market_data['high'],
            low=market_data['low'],
            close=market_data['close'],
            name='OHLC'
        ))
        
        fig.update_layout(
            xaxis_title="Date",
            yaxis_title="Price",
            hovermode='x unified'
        )
        
        st.plotly_chart(fig, use_container_width=True)
        
    def _render_performance_metrics(self, results: Dict):
        """Render detailed performance metrics."""
        st.subheader("Performance Metrics")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.metric("Average Trade", f"${results['avg_trade']:.2f}")
            
        with col2:
            returns = results['equity_curve'].pct_change()
            st.metric("Volatility", f"{returns.std() * np.sqrt(252):.2%}")
            
        with col3:
            st.metric("Profit Factor", 
                     f"{abs(returns[returns > 0].sum() / returns[returns < 0].sum()):.2f}")
            
    def _render_trade_list(self, results: Dict):
        """Render list of trades."""
        st.subheader("Trade History")
        
        trades_df = pd.DataFrame(results['trades'])
        if not trades_df.empty:
            trades_df['time'] = pd.to_datetime(trades_df['time'])
            trades_df['profit'] = trades_df.apply(
                lambda x: x['size'] * x['price'] * (1 if x['type'] == 'sell' else -1),
                axis=1
            )
            
            st.dataframe(
                trades_df.sort_values('time', ascending=False),
                use_container_width=True
            ) 