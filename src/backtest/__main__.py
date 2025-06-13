"""
Script principal para ejecutar backtesting de estrategias de trading.
"""

import argparse
from datetime import datetime
from src.strategies.moving_average import MovingAverageCrossover
from src.backtest.runner import BacktestRunner

def parse_args():
    """Parsea los argumentos de línea de comandos."""
    parser = argparse.ArgumentParser(description='Backtesting de estrategias de trading')
    
    parser.add_argument('--strategy', type=str, required=True,
                      help='Nombre de la estrategia a probar')
    parser.add_argument('--symbol', type=str, required=True,
                      help='Símbolo del activo a analizar')
    parser.add_argument('--start-date', type=str, required=True,
                      help='Fecha de inicio (YYYY-MM-DD)')
    parser.add_argument('--end-date', type=str,
                      help='Fecha de fin (YYYY-MM-DD)')
    parser.add_argument('--capital', type=float, default=100000.0,
                      help='Capital inicial para el backtesting')
    
    return parser.parse_args()

def main():
    """Función principal."""
    args = parse_args()
    
    # Convertir fechas
    start_date = datetime.strptime(args.start_date, '%Y-%m-%d')
    end_date = datetime.strptime(args.end_date, '%Y-%m-%d') if args.end_date else None
    
    # Crear estrategia
    if args.strategy == 'MovingAverageCrossover':
        strategy = MovingAverageCrossover()
    else:
        raise ValueError(f'Estrategia no soportada: {args.strategy}')
    
    # Crear runner
    runner = BacktestRunner(
        strategies=[strategy],
        symbols=[args.symbol],
        start_date=start_date,
        end_date=end_date,
        initial_capital=args.capital
    )
    
    # Ejecutar backtesting
    results = runner.run()
    
    # Mostrar resultados
    runner.print_results(results)
    runner.plot_comparison(results)

if __name__ == '__main__':
    main() 