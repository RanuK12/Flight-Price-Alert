"""
Implementación de la estrategia de cruce de medias móviles.
"""

import pandas as pd
import numpy as np
from .base import BaseStrategy

class MovingAverageCrossover(BaseStrategy):
    """
    Estrategia de trading basada en el cruce de medias móviles.
    
    Esta estrategia genera señales de compra cuando la media móvil corta
    cruza por encima de la media móvil larga, y señales de venta cuando
    cruza por debajo.
    """
    
    def __init__(self, short_window: int = 20, long_window: int = 50):
        """
        Inicializa la estrategia de cruce de medias móviles.
        
        Args:
            short_window (int): Ventana para la media móvil corta
            long_window (int): Ventana para la media móvil larga
        """
        super().__init__()
        self.short_window = short_window
        self.long_window = long_window
    
    def generate_signals(self, data: pd.DataFrame) -> pd.DataFrame:
        """
        Genera señales de trading basadas en el cruce de medias móviles.
        
        Args:
            data (pd.DataFrame): DataFrame con datos de precios
            
        Returns:
            pd.DataFrame: DataFrame con señales de trading
        """
        signals = data.copy()
        
        # Calcular medias móviles
        signals['short_mavg'] = data['close'].rolling(window=self.short_window).mean()
        signals['long_mavg'] = data['close'].rolling(window=self.long_window).mean()
        
        # Generar señales
        signals['signal'] = 0.0
        signals.iloc[self.long_window:, signals.columns.get_loc('signal')] = np.where(
            signals['short_mavg'][self.long_window:] > signals['long_mavg'][self.long_window:],
            1.0, 0.0
        )
        
        # Generar señales de trading
        signals['positions'] = signals['signal'].diff()
        
        return signals
    
    def plot_results(self, signals: pd.DataFrame) -> None:
        """
        Visualiza los resultados de la estrategia incluyendo las medias móviles.
        
        Args:
            signals (pd.DataFrame): DataFrame con señales de trading
        """
        plt.figure(figsize=(12, 6))
        
        # Plotear precio y medias móviles
        plt.plot(signals.index, signals['close'], label='Precio', alpha=0.5)
        plt.plot(signals.index, signals['short_mavg'], label=f'MA {self.short_window}', alpha=0.7)
        plt.plot(signals.index, signals['long_mavg'], label=f'MA {self.long_window}', alpha=0.7)
        
        # Plotear señales de compra/venta
        buy_signals = signals[signals['positions'] == 1.0]
        sell_signals = signals[signals['positions'] == -1.0]
        
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