"""
Módulo para realizar backtesting de estrategias de trading.
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any, Union, Optional
from datetime import datetime
import matplotlib.pyplot as plt
from src.strategies.base import BaseStrategy
from src.data.fetcher import DataFetcher

class BacktestRunner:
    """
    Clase para realizar backtesting de estrategias de trading.
    """
    
    def __init__(
        self,
        strategies: List[BaseStrategy],
        symbols: List[str],
        start_date: Union[str, datetime],
        end_date: Optional[Union[str, datetime]] = None,
        initial_capital: float = 100000.0
    ):
        """
        Inicializa el runner de backtesting.
        
        Args:
            strategies (List[BaseStrategy]): Lista de estrategias a probar
            symbols (List[str]): Lista de símbolos a analizar
            start_date (Union[str, datetime]): Fecha de inicio
            end_date (Optional[Union[str, datetime]]): Fecha de fin (opcional)
            initial_capital (float): Capital inicial para el backtesting
        """
        self.strategies = strategies
        self.symbols = symbols
        self.start_date = start_date
        self.end_date = end_date
        self.initial_capital = initial_capital
        self.data_fetcher = DataFetcher()
    
    def run(self) -> Dict[str, Dict[str, Any]]:
        """
        Ejecuta el backtesting para todas las estrategias y símbolos.
        
        Returns:
            Dict[str, Dict[str, Any]]: Resultados del backtesting
        """
        results = {}
        
        for strategy in self.strategies:
            strategy_results = {}
            
            for symbol in self.symbols:
                # Obtener datos
                data = self.data_fetcher.get_historical_data(
                    symbol, self.start_date, self.end_date
                )
                
                # Generar señales
                signals = strategy.generate_signals(data)
                
                # Calcular métricas
                metrics = strategy.calculate_metrics(signals)
                
                # Calcular retornos
                returns = strategy.calculate_returns(signals)
                
                # Calcular equity curve
                equity_curve = (1 + returns).cumprod() * self.initial_capital
                
                strategy_results[symbol] = {
                    'metrics': metrics,
                    'returns': returns,
                    'equity_curve': equity_curve,
                    'signals': signals
                }
            
            results[strategy.name] = strategy_results
        
        return results
    
    def plot_comparison(self, results: Dict[str, Dict[str, Any]]) -> None:
        """
        Visualiza la comparación de resultados entre estrategias.
        
        Args:
            results (Dict[str, Dict[str, Any]]): Resultados del backtesting
        """
        plt.figure(figsize=(12, 6))
        
        for strategy_name, strategy_results in results.items():
            # Calcular equity curve promedio
            equity_curves = []
            for symbol_results in strategy_results.values():
                equity_curves.append(symbol_results['equity_curve'])
            
            avg_equity = pd.concat(equity_curves, axis=1).mean(axis=1)
            plt.plot(avg_equity.index, avg_equity.values,
                    label=strategy_name, alpha=0.7)
        
        plt.title('Comparación de Estrategias')
        plt.xlabel('Fecha')
        plt.ylabel('Capital')
        plt.legend()
        plt.grid(True)
        plt.show()
    
    def print_results(self, results: Dict[str, Dict[str, Any]]) -> None:
        """
        Imprime los resultados del backtesting.
        
        Args:
            results (Dict[str, Dict[str, Any]]): Resultados del backtesting
        """
        for strategy_name, strategy_results in results.items():
            print(f"\nResultados para {strategy_name}:")
            print("-" * 50)
            
            for symbol, result in strategy_results.items():
                print(f"\nSímbolo: {symbol}")
                metrics = result['metrics']
                
                print(f"Retorno Total: {float(metrics['total_return']):.2%}")
                print(f"Retorno Anual: {float(metrics['annual_return']):.2%}")
                print(f"Ratio de Sharpe: {float(metrics['sharpe_ratio']):.2f}")
                print(f"Drawdown Máximo: {float(metrics['max_drawdown']):.2%}") 