"""
Módulo principal para ejecutar backtests desde la línea de comandos.
"""
import argparse
from datetime import datetime
import os

from ..strategies.moving_average import MovingAverageCrossover
from .runner import BacktestRunner

def validate_date(date_str: str) -> str:
    """
    Valida que la fecha tenga el formato correcto (YYYY-MM-DD).
    
    Args:
        date_str: Fecha a validar
        
    Returns:
        Fecha validada
        
    Raises:
        ValueError: Si la fecha no tiene el formato correcto
    """
    try:
        datetime.strptime(date_str, '%Y-%m-%d')
        return date_str
    except ValueError:
        raise ValueError("La fecha debe tener el formato YYYY-MM-DD")

def main():
    """Función principal para ejecutar el backtest."""
    parser = argparse.ArgumentParser(description='Ejecutar backtest de estrategias de trading')
    
    # Argumentos básicos
    parser.add_argument('--strategy', type=str, required=True,
                      help='Nombre de la estrategia a probar')
    parser.add_argument('--symbol', type=str, required=True,
                      help='Símbolo del activo a analizar')
    parser.add_argument('--start-date', type=validate_date, required=True,
                      help='Fecha de inicio (YYYY-MM-DD)')
    parser.add_argument('--end-date', type=validate_date,
                      help='Fecha de fin (YYYY-MM-DD)')
    
    # Parámetros de la estrategia
    parser.add_argument('--short-period', type=int, default=20,
                      help='Período corto para la media móvil')
    parser.add_argument('--long-period', type=int, default=50,
                      help='Período largo para la media móvil')
    
    # Parámetros del backtest
    parser.add_argument('--initial-capital', type=float, default=10000.0,
                      help='Capital inicial para el backtest')
    parser.add_argument('--risk-free-rate', type=float, default=0.02,
                      help='Tasa libre de riesgo anual')
    
    args = parser.parse_args()
    
    # Mapear nombre de estrategia a clase
    strategy_map = {
        'MovingAverageCrossover': MovingAverageCrossover
    }
    
    if args.strategy not in strategy_map:
        raise ValueError(f"Estrategia no soportada: {args.strategy}")
        
    strategy_class = strategy_map[args.strategy]
    
    # Crear runner
    runner = BacktestRunner(
        strategy_class=strategy_class,
        symbol=args.symbol,
        start_date=args.start_date,
        end_date=args.end_date or datetime.now().strftime('%Y-%m-%d'),
        initial_capital=args.initial_capital,
        risk_free_rate=args.risk_free_rate
    )
    
    # Ejecutar backtest
    strategy_params = {
        'short_period': args.short_period,
        'long_period': args.long_period
    }
    
    runner.run(**strategy_params)
    
    # Generar reporte
    results_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'results')
    os.makedirs(results_dir, exist_ok=True)
    
    report_path = os.path.join(
        results_dir,
        f"{args.symbol}_{args.strategy}_{args.start_date}_{args.end_date or 'present'}.png"
    )
    
    runner.plot_results(save_path=report_path)

if __name__ == '__main__':
    main() 