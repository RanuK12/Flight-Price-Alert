# Algorithmic Trading System

A system for backtesting algorithmic trading strategies.

## Features

- Historical stock data download using yfinance
- Trading strategy implementation (Moving Average Crossover)
- Backtesting system with performance metrics
- Results visualization

## Requirements

- Python 3.8+
- Dependencies listed in `requirements.txt`

## Installation

1. Clone the repository:
```bash
git clone https://github.com/RanuK12/cryptocurrency-price-monitor.git
cd cryptocurrency-price-monitor
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

### Running Backtesting

To run a backtesting of a strategy:

```bash
python -m src.backtest --strategy MovingAverageCrossover --symbol AAPL --start-date 2023-01-01 --end-date 2023-12-31 --initial-capital 100000 --plot --save-plot
```

Parameters:
- `--strategy`: Strategy name to test
- `--symbol`: Stock symbol
- `--start-date`: Start date (YYYY-MM-DD)
- `--end-date`: End date (YYYY-MM-DD)
- `--initial-capital`: Initial capital for backtesting
- `--plot`: Show results plots
- `--save-plot`: Save results plots to file

### Results Examples

#### PEPE (2024-05-01 a 2025-06-13)
![PEPE Backtest Results](results/PEPE_MovingAverageCrossover_2024-05-01_2025-06-13.png)

```
Resultados para MovingAverageCrossover:
--------------------------------------------------
Periodo: 2024-05-01 a 2025-06-13
Retorno Total: -54.86%
Retorno Anualizado: -38.89%
Sharpe Ratio: 0.03
Sortino Ratio: 0.05
Máximo Drawdown: -78.56%
Volatilidad Anual: 105.91%
Número de Operaciones: 377
Tasa de Éxito: 46.15%
Factor de Beneficio: 1.01
Ratio Promedio Ganancia/Pérdida: 1.18
VaR (95%): -9.99%
Expected Shortfall (95%): -13.29%
```

**Objective Analysis for Investors:**

The backtest for PEPE using a Moving Average Crossover strategy over the period 2024-05-01 to 2025-06-13 shows a significant negative performance (-54.86% total return, -38.89% annualized). The strategy executed 377 trades with a win rate of 46.15% and a profit factor of 1.01, indicating that gains barely offset losses. The Sharpe and Sortino ratios are very low, suggesting poor risk-adjusted returns. The maximum drawdown is extremely high (-78.56%), and annualized volatility is also very high (105.91%), reflecting a highly risky and unstable market environment for this asset.

**Investor takeaway:**
- PEPE, during this period, exhibited high volatility and deep drawdowns, making it a very risky asset for trend-following strategies like the Moving Average Crossover.
- The strategy did not provide consistent or reliable profits, and the risk of large losses was substantial.
- Investors should be cautious with PEPE and consider more robust risk management or alternative strategies if considering exposure to this asset.

#### BTC (2024-05-01 a 2025-06-13)
![BTC Backtest Results](results/BTC_MovingAverageCrossover_2024-05-01_2025-06-13.png)

```
Análisis de Trading - BTC
==================================================

1. Rendimiento General:
   - Retorno Total: -27.87%
   - Retorno Anualizado: -18.32%
   - Ratio de Sharpe: -0.37
   - Ratio de Sortino: -0.50

2. Actividad de Trading:
   - Número de Operaciones: 378
   - Tasa de Éxito: 49.21%
   - Factor de Beneficio: 0.94
   - Ratio Promedio Ganancia/Pérdida: 0.97

3. Análisis de Riesgo:
   - Volatilidad Anual: 39.22%
   - Máximo Drawdown: -55.93%
   - Ratio de Calmar: -0.33
   - VaR (95%): -3.98%
   - Expected Shortfall (95%): -5.74%

4. Evaluación de la Estrategia:
   - La estrategia muestra un rendimiento negativo
   - El ratio de Sharpe indica un rendimiento bajo ajustado al riesgo
   - La tasa de éxito de 49.21% sugiere una baja precisión en las señales
   - El factor de beneficio de 0.94 indica una modesta eficiencia en la gestión del riesgo

   - El período analizado muestra una volatilidad alta
   - El máximo drawdown de -55.93% indica un riesgo significativo
   - El VaR sugiere que las pérdidas máximas esperadas en un día son de -3.98%

6. Recomendaciones:
   - Considerar ajustar los parámetros de la estrategia para mejorar el rendimiento
   - Implementar stop-loss más estrictos para reducir el drawdown máximo
   - Mantener el tamaño de posición actual

#### DOGE (2024-05-01 a 2025-06-13)
![DOGE Backtest Results](results/DOGE_MovingAverageCrossover_2024-05-01_2025-06-13.png)

```
Análisis de Trading - DOGE
==================================================

1. Rendimiento General:
   - Retorno Total: 220.98%
   - Retorno Anualizado: 105.87%
   - Ratio de Sharpe: 1.27
   - Ratio de Sortino: 2.20

2. Actividad de Trading:
   - Número de Operaciones: 378
   - Tasa de Éxito: 51.85%
   - Factor de Beneficio: 1.27
   - Ratio Promedio Ganancia/Pérdida: 1.18

3. Análisis de Riesgo:
   - Volatilidad Anual: 79.13%
   - Máximo Drawdown: -57.00%
   - Ratio de Calmar: 1.86
   - VaR (95%): -7.17%
   - Expected Shortfall (95%): -9.51%

4. Evaluación de la Estrategia:
   - La estrategia muestra un rendimiento positivo
   - El ratio de Sharpe indica un rendimiento aceptable ajustado al riesgo
   - La tasa de Éxito de 51.85% sugiere una buena precisión en las señales

5. Análisis de Mercado:
   - El período analizado muestra una volatilidad alta
   - El máximo drawdown de -57.00% indica un riesgo significativo
   - El VaR sugiere que las pérdidas máximas esperadas en un día son de -7.17%

6. Recomendaciones:
   - La estrategia muestra un buen balance entre riesgo y retorno
   - Implementar stop-loss más estrictos para reducir el drawdown máximo
   - Mantener el tamaño de posición actual

## Implemented Strategies

### Moving Average Crossover
- Buy when short SMA crosses above long SMA
- Sell when short SMA crosses below long SMA
- Default parameters:
  - Short SMA: 20 periods
  - Long SMA: 50 periods

## Project Structure

```
src/
├── data/
│   └── fetcher.py      # Historical data download
├── strategies/
│   ├── base.py         # Base strategy class
│   └── moving_average.py # Moving average crossover strategy
└── backtest/
    ├── runner.py       # Backtesting system
    └── __main__.py     # Main script
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

RanuK12 - [@RanuK12](https://github.com/RanuK12)

Project Link: [https://github.com/RanuK12/cryptocurrency-price-monitor](https://github.com/RanuK12/cryptocurrency-price-monitor)