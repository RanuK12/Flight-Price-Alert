"""
Módulo para generar informes detallados de análisis de trading.
"""
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Dict, Any
from datetime import datetime
import os

class TradingReport:
    """Clase para generar informes detallados de análisis de trading."""
    
    def __init__(self, results: Dict[str, Any], symbol: str):
        """
        Inicializa el generador de informes.
        
        Args:
            results: Diccionario con los resultados del backtest
            symbol: Símbolo del activo analizado
        """
        self.results = results
        self.symbol = symbol
        self.metrics = results['metrics']
        self.data = results['data']
        self.returns = results['returns']
        
        # Configuración de estilo para las gráficas
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")
        
    def generate_report(self, save_path: str = None) -> None:
        """
        Genera un informe completo con gráficas y métricas.
        
        Args:
            save_path: Ruta donde guardar el informe (opcional)
        """
        # Crear figura con subplots
        fig = plt.figure(figsize=(20, 15))
        gs = fig.add_gridspec(3, 2)
        
        # Gráfica de precio y valor del portafolio
        ax1 = fig.add_subplot(gs[0, :])
        self._plot_price_and_portfolio(ax1)
        
        # Distribución de retornos
        ax2 = fig.add_subplot(gs[1, 0])
        self._plot_returns_distribution(ax2)
        
        # Drawdown
        ax3 = fig.add_subplot(gs[1, 1])
        self._plot_drawdown(ax3)
        
        # Métricas móviles
        ax4 = fig.add_subplot(gs[2, 0])
        self._plot_rolling_metrics(ax4)
        
        # Señales de trading
        ax5 = fig.add_subplot(gs[2, 1])
        self._plot_trading_signals(ax5)
        
        plt.tight_layout()
        
        if save_path:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
        else:
            plt.show()
            
    def _plot_price_and_portfolio(self, ax: plt.Axes) -> None:
        """Plotea el precio del activo y el valor del portafolio."""
        ax.plot(self.data.index, self.data['Close'], label='Precio', alpha=0.7)
        ax.plot(self.data.index, self.data['Portfolio_Value'], 
                label='Valor Portafolio', alpha=0.7)
        ax.set_title(f'Precio y Valor del Portafolio - {self.symbol}')
        ax.set_xlabel('Fecha')
        ax.set_ylabel('Valor')
        ax.legend()
        ax.grid(True)
        
    def _plot_returns_distribution(self, ax: plt.Axes) -> None:
        """Plotea la distribución de retornos."""
        sns.histplot(self.returns, kde=True, ax=ax)
        ax.axvline(x=0, color='r', linestyle='--', alpha=0.5)
        ax.set_title('Distribución de Retornos')
        ax.set_xlabel('Retorno')
        ax.set_ylabel('Frecuencia')
        
    def _plot_drawdown(self, ax: plt.Axes) -> None:
        """Plotea el drawdown del portafolio."""
        portfolio_value = self.data['Portfolio_Value']
        rolling_max = portfolio_value.expanding().max()
        drawdown = (portfolio_value - rolling_max) / rolling_max * 100
        
        ax.fill_between(drawdown.index, drawdown, 0, color='red', alpha=0.3)
        ax.set_title('Drawdown del Portafolio')
        ax.set_xlabel('Fecha')
        ax.set_ylabel('Drawdown (%)')
        ax.grid(True)
        
    def _plot_rolling_metrics(self, ax: plt.Axes) -> None:
        """Plotea métricas móviles (Sharpe y Volatilidad)."""
        returns = self.returns
        rolling_sharpe = returns.rolling(window=30).mean() / returns.rolling(window=30).std() * np.sqrt(252)
        rolling_vol = returns.rolling(window=30).std() * np.sqrt(252) * 100
        
        ax.plot(rolling_sharpe.index, rolling_sharpe, label='Sharpe Ratio', alpha=0.7)
        ax.plot(rolling_vol.index, rolling_vol, label='Volatilidad (%)', alpha=0.7)
        ax.set_title('Métricas Móviles')
        ax.set_xlabel('Fecha')
        ax.set_ylabel('Valor')
        ax.legend()
        ax.grid(True)
        
    def _plot_trading_signals(self, ax: plt.Axes) -> None:
        """Plotea las señales de trading."""
        ax.plot(self.data.index, self.data['Close'], label='Precio', alpha=0.7)
        
        # Marcar señales de compra
        buy_signals = self.data[self.data['Signal'] == 1.0]
        ax.scatter(buy_signals.index, buy_signals['Close'], 
                  marker='^', color='g', label='Compra', alpha=0.7)
        
        # Marcar señales de venta
        sell_signals = self.data[self.data['Signal'] == -1.0]
        ax.scatter(sell_signals.index, sell_signals['Close'], 
                  marker='v', color='r', label='Venta', alpha=0.7)
        
        ax.set_title('Señales de Trading')
        ax.set_xlabel('Fecha')
        ax.set_ylabel('Precio')
        ax.legend()
        ax.grid(True)
        
    def generate_analysis_summary(self) -> str:
        """
        Genera un resumen textual del análisis.
        
        Returns:
            str: Resumen del análisis
        """
        summary = f"""
Análisis de Trading - {self.symbol}
{'='*50}

1. Rendimiento General:
   - Retorno Total: {self.metrics['total_return']:.2%}
   - Retorno Anualizado: {self.metrics['annual_return']:.2%}
   - Ratio de Sharpe: {self.metrics['sharpe_ratio']:.2f}
   - Ratio de Sortino: {self.metrics['sortino_ratio']:.2f}

2. Actividad de Trading:
   - Número de Operaciones: {self.metrics['num_trades']}
   - Tasa de Éxito: {self.metrics['win_rate']:.2%}
   - Factor de Beneficio: {self.metrics['profit_factor']:.2f}
   - Ratio Promedio Ganancia/Pérdida: {self.metrics['avg_win_loss_ratio']:.2f}

3. Análisis de Riesgo:
   - Volatilidad Anual: {self.metrics['volatility']:.2%}
   - Máximo Drawdown: {self.metrics['max_drawdown']:.2%}
   - Ratio de Calmar: {self.metrics['calmar_ratio']:.2f}
   - VaR (95%): {self.metrics['var_95']:.2%}
   - Expected Shortfall (95%): {self.metrics['expected_shortfall_95']:.2%}

4. Evaluación de la Estrategia:
   - La estrategia muestra un rendimiento {'positivo' if self.metrics['total_return'] > 0 else 'negativo'}
   - El ratio de Sharpe indica un rendimiento {'aceptable' if self.metrics['sharpe_ratio'] > 1 else 'bajo'} ajustado al riesgo
   - La tasa de éxito de {self.metrics['win_rate']:.2%} sugiere una {'buena' if self.metrics['win_rate'] > 0.5 else 'baja'} precisión en las señales
   - El factor de beneficio de {self.metrics['profit_factor']:.2f} indica una {'buena' if self.metrics['profit_factor'] > 1.5 else 'modesta'} eficiencia en la gestión del riesgo

5. Análisis de Mercado:
   - El período analizado muestra una volatilidad {'alta' if self.metrics['volatility'] > 0.3 else 'moderada'}
   - El máximo drawdown de {self.metrics['max_drawdown']:.2%} indica un riesgo {'significativo' if self.metrics['max_drawdown'] < -0.2 else 'moderado'}
   - El VaR sugiere que las pérdidas máximas esperadas en un día son de {self.metrics['var_95']:.2%}

6. Recomendaciones:
   - {'Considerar ajustar los parámetros de la estrategia para mejorar el rendimiento' if self.metrics['sharpe_ratio'] < 1 else 'La estrategia muestra un buen balance entre riesgo y retorno'}
   - {'Implementar stop-loss más estrictos para reducir el drawdown máximo' if self.metrics['max_drawdown'] < -0.2 else 'El control de riesgo actual parece adecuado'}
   - {'Evaluar la posibilidad de aumentar el tamaño de las posiciones' if self.metrics['win_rate'] > 0.6 else 'Mantener el tamaño de posición actual'}
"""
        return summary 