"""
Módulo base para estrategias de trading.
"""

from abc import ABC, abstractmethod
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from typing import Optional, Dict, Any

class BaseStrategy(ABC):
    """
    Clase base abstracta para todas las estrategias de trading.
    """
    
    def __init__(self, name: str):
        """
        Inicializa la estrategia base.
        
        Args:
            name: Nombre de la estrategia
        """
        self.name = name
        self.signals = None
        self.positions = None
        self.returns = None
    
    @abstractmethod
    def generate_signals(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Genera señales de trading basadas en los datos.
        
        Args:
            data: DataFrame con datos históricos
            
        Returns:
            DataFrame con señales de trading
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
    
    def calculate_returns(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Calcula los retornos de la estrategia.
        
        Args:
            data: DataFrame con datos históricos
            
        Returns:
            DataFrame con retornos de la estrategia
        """
        if self.signals is None:
            self.signals = self.generate_signals(data)
            
        # Calcular retornos de precios
        price_returns = data['close'].pct_change()
        
        # Calcular retornos de la estrategia
        strategy_returns = self.signals['signal'] * price_returns
        
        # Llenar NaN con 0
        strategy_returns = strategy_returns.fillna(0)
        
        self.returns = strategy_returns
        return strategy_returns
    
    def calculate_metrics(self) -> Dict[str, float]:
        """
        Calcula métricas de rendimiento de la estrategia.
        
        Returns:
            Diccionario con métricas de rendimiento
        """
        if self.returns is None:
            raise ValueError("Primero debes calcular los retornos usando calculate_returns()")
            
        # Calcular métricas
        total_return = (1 + self.returns).prod() - 1
        annual_return = (1 + total_return) ** (252 / len(self.returns)) - 1
        sharpe_ratio = np.sqrt(252) * self.returns.mean() / self.returns.std()
        
        # Calcular drawdown máximo
        cum_returns = (1 + self.returns).cumprod()
        rolling_max = cum_returns.expanding().max()
        drawdowns = cum_returns / rolling_max - 1
        max_drawdown = drawdowns.min()
        
        return {
            'total_return': float(total_return),
            'annual_return': float(annual_return),
            'sharpe_ratio': float(sharpe_ratio),
            'max_drawdown': float(max_drawdown)
        }
    
    def get_positions(self) -> pd.DataFrame:
        """
        Obtiene las posiciones de la estrategia.
        
        Returns:
            DataFrame con posiciones
        """
        if self.signals is None:
            raise ValueError("Primero debes generar señales usando generate_signals()")
            
        self.positions = self.signals['signal'].copy()
        return self.positions 