"""
Módulo para ejecutar backtests de estrategias de trading.
"""
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from typing import Dict, Any, Type
from datetime import datetime
import os

from ..data.fetcher import DataFetcher
from ..strategies.base import BaseStrategy
from ..analysis.report import TradingReport
from .risk_metrics import calculate_risk_metrics

class BacktestRunner:
    """Clase para ejecutar backtests de estrategias de trading."""
    
    def __init__(self, strategy_class: Type[BaseStrategy], symbol: str,
                 start_date: str, end_date: str, initial_capital: float = 10000.0,
                 risk_free_rate: float = 0.02):
        """
        Inicializa el runner de backtest.
        
        Args:
            strategy_class: Clase de la estrategia a probar
            symbol: Símbolo del activo a analizar
            start_date: Fecha de inicio del backtest (YYYY-MM-DD)
            end_date: Fecha de fin del backtest (YYYY-MM-DD)
            initial_capital: Capital inicial para el backtest
            risk_free_rate: Tasa libre de riesgo anual
        """
        self.strategy_class = strategy_class
        self.symbol = symbol
        self.start_date = start_date
        self.end_date = end_date
        self.initial_capital = initial_capital
        self.risk_free_rate = risk_free_rate
        
        self.data_fetcher = DataFetcher()
        self.results = None
        
    def run(self, **strategy_params) -> Dict[str, Any]:
        """
        Ejecuta el backtest de la estrategia.
        
        Args:
            **strategy_params: Parámetros específicos de la estrategia
            
        Returns:
            Diccionario con los resultados del backtest
        """
        # Obtener datos históricos
        data = self.data_fetcher.get_historical_data(
            self.symbol, self.start_date, self.end_date
        )
        
        # Inicializar estrategia
        strategy = self.strategy_class(**strategy_params)
        
        # Generar señales
        signals = strategy.generate_signals(data)
        
        # Calcular retornos
        signals['Returns'] = signals['Close'].pct_change()
        
        # Calcular valor del portafolio
        signals['Position'] = signals['Signal'].shift(1)
        signals['Strategy_Returns'] = signals['Position'] * signals['Returns']
        signals['Portfolio_Value'] = (1 + signals['Strategy_Returns']).cumprod() * self.initial_capital
        
        # Calcular métricas de riesgo
        returns = signals['Strategy_Returns'].dropna()
        metrics = calculate_risk_metrics(returns, self.risk_free_rate)
        
        # Guardar resultados
        self.results = {
            'data': signals,
            'returns': returns,
            'metrics': metrics
        }
        
        return self.results
    
    def plot_results(self, save_path: str = None) -> None:
        """
        Genera y muestra/guarda las gráficas de resultados.
        
        Args:
            save_path: Ruta donde guardar las gráficas (opcional)
        """
        if self.results is None:
            raise ValueError("Debe ejecutar el backtest antes de generar gráficas")
            
        # Crear generador de reportes
        report = TradingReport(self.results, self.symbol)
        
        # Generar y guardar reporte
        if save_path:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            report.generate_report(save_path)
        else:
            report.generate_report()
            
        # Imprimir resumen del análisis
        print(report.generate_analysis_summary())
        
    def print_results(self) -> None:
        """Imprime un resumen de los resultados del backtest."""
        if self.results is None:
            raise ValueError("Debe ejecutar el backtest antes de imprimir resultados")
            
        # Crear generador de reportes
        report = TradingReport(self.results, self.symbol)
        
        # Imprimir resumen del análisis
        print(report.generate_analysis_summary()) 