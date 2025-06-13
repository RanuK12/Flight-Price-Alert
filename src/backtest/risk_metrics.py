"""
Módulo para calcular métricas de riesgo y desempeño de estrategias de trading.
"""
import numpy as np
import pandas as pd
from typing import Dict

def calculate_risk_metrics(returns: pd.Series, risk_free_rate: float = 0.02) -> Dict[str, float]:
    """
    Calcula métricas de riesgo y desempeño para una serie de retornos.
    
    Args:
        returns: Serie de retornos de la estrategia
        risk_free_rate: Tasa libre de riesgo anual
        
    Returns:
        Diccionario con métricas calculadas
    """
    metrics = {}
    returns = returns.dropna()
    
    # Retornos
    metrics['total_return'] = (1 + returns).prod() - 1
    metrics['annual_return'] = (1 + metrics['total_return']) ** (252 / len(returns)) - 1 if len(returns) > 0 else 0
    metrics['volatility'] = returns.std() * np.sqrt(252)
    
    # Sharpe y Sortino
    if returns.std() != 0:
        metrics['sharpe_ratio'] = (returns.mean() * 252 - risk_free_rate) / (returns.std() * np.sqrt(252))
    else:
        metrics['sharpe_ratio'] = np.nan
    downside_returns = returns[returns < 0]
    if downside_returns.std() != 0:
        metrics['sortino_ratio'] = (returns.mean() * 252 - risk_free_rate) / (downside_returns.std() * np.sqrt(252))
    else:
        metrics['sortino_ratio'] = np.nan
    
    # Drawdown
    cumulative = (1 + returns).cumprod()
    highwater = cumulative.cummax()
    drawdown = (cumulative - highwater) / highwater
    metrics['max_drawdown'] = drawdown.min()
    if metrics['max_drawdown'] != 0:
        metrics['calmar_ratio'] = metrics['annual_return'] / abs(metrics['max_drawdown'])
    else:
        metrics['calmar_ratio'] = np.nan
    
    # VaR y Expected Shortfall
    metrics['var_95'] = np.percentile(returns, 5)
    metrics['expected_shortfall_95'] = returns[returns <= metrics['var_95']].mean() if len(returns[returns <= metrics['var_95']]) > 0 else np.nan
    
    # Estadísticas de trading
    trades = returns[returns != 0]
    metrics['num_trades'] = len(trades)
    wins = trades[trades > 0]
    losses = trades[trades < 0]
    metrics['win_rate'] = len(wins) / len(trades) if len(trades) > 0 else 0
    metrics['avg_win'] = wins.mean() if len(wins) > 0 else 0
    metrics['avg_loss'] = losses.mean() if len(losses) > 0 else 0
    metrics['avg_win_loss_ratio'] = abs(metrics['avg_win'] / metrics['avg_loss']) if metrics['avg_loss'] != 0 else np.nan
    metrics['profit_factor'] = wins.sum() / abs(losses.sum()) if losses.sum() != 0 else np.nan
    
    return metrics 