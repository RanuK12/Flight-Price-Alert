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

#### AAPL (2023)
![AAPL Backtest Results](docs/images/MovingAverageCrossover_AAPL_2023-01-01_2023-12-31.png)

```
Results for MovingAverageCrossover:
--------------------------------------------------
Period: 2023-01-01 to 2023-12-31
Initial Capital: $100,000.00
Final Capital: $122,034.39
Total Return: 22.03%
Annual Return: 22.23%
Sharpe Ratio: 1.15
Maximum Drawdown: -15.62%
```

#### MSFT (2023)
![MSFT Backtest Results](docs/images/MovingAverageCrossover_MSFT_2023-01-01_2023-12-31.png)

```
Results for MovingAverageCrossover:
--------------------------------------------------
Period: 2023-01-01 to 2023-12-31
Initial Capital: $100,000.00
Final Capital: $137,173.44
Total Return: 37.17%
Annual Return: 37.52%
Sharpe Ratio: 1.47
Maximum Drawdown: -15.77%
```

#### GOOGL (2023)
![GOOGL Backtest Results](docs/images/MovingAverageCrossover_GOOGL_2023-01-01_2023-12-31.png)

```
Results for MovingAverageCrossover:
--------------------------------------------------
Period: 2023-01-01 to 2023-12-31
Initial Capital: $100,000.00
Final Capital: $78,350.04
Total Return: -21.65%
Annual Return: -21.80%
Sharpe Ratio: -0.70
Maximum Drawdown: -33.48%
```

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