"""
Estrategia de trading basada en cruce de medias móviles.
"""

import pandas as pd
import numpy as np
from .base import BaseStrategy

class MovingAverageCrossover(BaseStrategy):
    """
    Estrategia de trading que genera señales basadas en el cruce de dos medias móviles.
    
    La estrategia genera una señal de compra cuando la media móvil corta cruza por encima
    de la media móvil larga, y una señal de venta cuando cruza por debajo.
    """
    
    def __init__(self, short_period: int = 20, long_period: int = 50):
        """
        Inicializa la estrategia de cruce de medias móviles.
        
        Args:
            short_period: Período para la media móvil corta
            long_period: Período para la media móvil larga
        """
        self.short_period = short_period
        self.long_period = long_period
        
    def generate_signals(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Genera señales de trading basadas en el cruce de medias móviles.
        
        Args:
            data: DataFrame con datos históricos de precios
            
        Returns:
            DataFrame con las señales generadas
        """
        # Calcular medias móviles
        data['Short_MA'] = data['Close'].rolling(window=self.short_period).mean()
        data['Long_MA'] = data['Close'].rolling(window=self.long_period).mean()
        
        # Generar señales
        data['Signal'] = 0.0
        data.loc[data['Short_MA'] > data['Long_MA'], 'Signal'] = 1.0  # Señal de compra
        data.loc[data['Short_MA'] < data['Long_MA'], 'Signal'] = -1.0  # Señal de venta
        
        # Eliminar columnas innecesarias
        data = data[['Open', 'High', 'Low', 'Close', 'Volume', 'Signal']]
        
        return data
    
    def plot_results(self, signals: pd.DataFrame) -> None:
        """
        Visualiza los resultados de la estrategia incluyendo las medias móviles.
        
        Args:
            signals (pd.DataFrame): DataFrame con señales de trading
        """
        plt.figure(figsize=(12, 6))
        
        # Plotear precio y medias móviles
        plt.plot(signals.index, signals['Close'], label='Precio', alpha=0.5)
        plt.plot(signals.index, signals['Short_MA'], label=f'MA {self.short_period}', alpha=0.7)
        plt.plot(signals.index, signals['Long_MA'], label=f'MA {self.long_period}', alpha=0.7)
        
        # Plotear señales de compra/venta
        buy_signals = signals[signals['Signal'] == 1.0]
        sell_signals = signals[signals['Signal'] == -1.0]
        
        plt.scatter(buy_signals.index, buy_signals['Close'],
                   marker='^', color='g', label='Compra', alpha=1)
        plt.scatter(sell_signals.index, sell_signals['Close'],
                   marker='v', color='r', label='Venta', alpha=1)
        
        plt.title(f'Resultados de la Estrategia: {self.name}')
        plt.xlabel('Fecha')
        plt.ylabel('Precio')
        plt.legend()
        plt.grid(True)
        plt.show() 