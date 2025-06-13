"""
Módulo base para estrategias de trading.
"""

from abc import ABC, abstractmethod
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

class BaseStrategy(ABC):
    """
    Clase base abstracta para todas las estrategias de trading.
    """
    
    def __init__(self):
        """Inicializa la estrategia base."""
        self.name = self.__class__.__name__
    
    @abstractmethod
    def generate_signals(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Genera señales de trading basadas en los datos proporcionados.
        
        Args:
            data (pd.DataFrame): DataFrame con datos de precios
            
        Returns:
            pd.DataFrame: DataFrame con señales de trading
        """
        pass
    
    def plot_results(self, signals: pd.DataFrame) -> None:
        """
        Visualiza los resultados de la estrategia.
        
        Args:
            signals (pd.DataFrame): DataFrame con señales de trading
        """
        plt.figure(figsize=(12, 6))
        
        # Plotear precio
        plt.plot(signals.index, signals['close'], label='Precio', alpha=0.5)
        
        # Plotear señales de compra/venta
        buy_signals = signals[signals['signal'] == 1.0]
        sell_signals = signals[signals['signal'] == -1.0]
        
        plt.scatter(buy_signals.index, buy_signals['close'],
                   marker='^', color='g', label='Compra', alpha=1)
        plt.scatter(sell_signals.index, sell_signals['close'],
                   marker='v', color='r', label='Venta', alpha=1)
        
        plt.title(f'Resultados de la Estrategia: {self.name}')
        plt.xlabel('Fecha')
        plt.ylabel('Precio')
        plt.legend()
        plt.grid(True)
        plt.show()
    
    def calculate_returns(self, signals: pd.DataFrame) -> pd.Series:
        """
        Calcula los retornos de la estrategia.
        
        Args:
            signals (pd.DataFrame): DataFrame con señales de trading
            
        Returns:
            pd.Series: Serie con los retornos
        """
        # Calcular retornos del precio
        price_returns = signals['close'].pct_change()
        
        # Calcular retornos de la estrategia
        strategy_returns = price_returns * signals['signal'].shift(1)
        
        # Eliminar valores NaN
        return strategy_returns.fillna(0)
    
    def calculate_metrics(self, signals: pd.DataFrame) -> dict:
        """
        Calcula métricas de rendimiento de la estrategia.
        
        Args:
            signals (pd.DataFrame): DataFrame con señales de trading
            
        Returns:
            dict: Diccionario con métricas de rendimiento
        """
        returns = self.calculate_returns(signals)
        returns = returns.dropna()
        # Si returns es DataFrame, tomar la primera columna
        if isinstance(returns, pd.DataFrame):
            returns = returns.iloc[:, 0]
        total_return = float((1 + returns).prod() - 1)
        annual_return = float((1 + total_return) ** (252 / len(returns)) - 1)
        sharpe_ratio = float(np.sqrt(252) * returns.mean() / returns.std())
        max_drawdown = float((returns.cumsum() - returns.cumsum().cummax()).min())
        return {
            'total_return': total_return,
            'annual_return': annual_return,
            'sharpe_ratio': sharpe_ratio,
            'max_drawdown': max_drawdown
        } 