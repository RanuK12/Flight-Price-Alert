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
python -m src.backtest --strategy MovingAverageCrossover --symbol BTC --start-date 2024-05-01 --end-date 2025-06-13 --short-period 10 --long-period 30 --plot --save-plot
```

Parameters:
- `--strategy`: Strategy name to test
- `--symbol`: Cryptocurrency symbol
- `--start-date`: Start date (YYYY-MM-DD)
- `--end-date`: End date (YYYY-MM-DD)
- `--short-period`: Short period for moving average
- `--long-period`: Long period for moving average
- `--plot`: Show results plots
- `--save-plot`: Save results plots to file

### Results Examples

#### PEPE (2024-05-01 to 2025-06-13)
![PEPE Backtest Results](results/PEPE_MovingAverageCrossover_2024-05-01_2025-06-13.png)

```
Trading Analysis - PEPE
==================================================

1. Overall Performance:
   - Total Return: -54.86%
   - Annualized Return: -38.89%
   - Sharpe Ratio: 0.03
   - Sortino Ratio: 0.05

2. Trading Activity:
   - Number of Trades: 377
   - Success Rate: 46.15%
   - Profit Factor: 1.01
   - Average Gain/Loss Ratio: 1.18

3. Risk Analysis:
   - Annual Volatility: 105.91%
   - Maximum Drawdown: -78.56%
   - Calmar Ratio: -0.49
   - VaR (95%): -9.99%
   - Expected Shortfall (95%): -13.29%

4. Strategy Evaluation:
   - The strategy shows negative performance
   - Sharpe ratio indicates poor risk-adjusted returns
   - Success rate of 46.15% suggests low signal accuracy
   - Profit factor of 1.01 indicates barely offsetting losses

5. Market Analysis:
   - The analyzed period shows high volatility
   - Maximum drawdown of -78.56% indicates significant risk
   - VaR suggests maximum expected daily losses of -9.99%

6. Recommendations:
   - Consider adjusting strategy parameters to improve performance
   - Implement stricter stop-losses to reduce maximum drawdown
   - Maintain current position sizing
```

#### BTC (2024-05-01 to 2025-06-13)
![BTC Backtest Results](results/BTC_MovingAverageCrossover_2024-05-01_2025-06-13.png)

```
Trading Analysis - BTC
==================================================

1. Overall Performance:
   - Total Return: -27.87%
   - Annualized Return: -18.32%
   - Sharpe Ratio: -0.37
   - Sortino Ratio: -0.50

2. Trading Activity:
   - Number of Trades: 378
   - Success Rate: 49.21%
   - Profit Factor: 0.94
   - Average Gain/Loss Ratio: 0.97

3. Risk Analysis:
   - Annual Volatility: 39.22%
   - Maximum Drawdown: -55.93%
   - Calmar Ratio: -0.33
   - VaR (95%): -3.98%
   - Expected Shortfall (95%): -5.74%

4. Strategy Evaluation:
   - The strategy shows negative performance
   - Sharpe ratio indicates poor risk-adjusted returns
   - Success rate of 49.21% suggests low signal accuracy
   - Profit factor of 0.94 indicates modest risk management efficiency

5. Market Analysis:
   - The analyzed period shows high volatility
   - Maximum drawdown of -55.93% indicates significant risk
   - VaR suggests maximum expected daily losses of -3.98%

6. Recommendations:
   - Consider adjusting strategy parameters to improve performance
   - Implement stricter stop-losses to reduce maximum drawdown
   - Maintain current position sizing
```

#### DOGE (2024-05-01 to 2025-06-13)
![DOGE Backtest Results](results/DOGE_MovingAverageCrossover_2024-05-01_2025-06-13.png)

```
Trading Analysis - DOGE
==================================================

1. Overall Performance:
   - Total Return: 220.98%
   - Annualized Return: 105.87%
   - Sharpe Ratio: 1.27
   - Sortino Ratio: 2.20

2. Trading Activity:
   - Number of Trades: 378
   - Success Rate: 51.85%
   - Profit Factor: 1.27
   - Average Gain/Loss Ratio: 1.18

3. Risk Analysis:
   - Annual Volatility: 79.13%
   - Maximum Drawdown: -57.00%
   - Calmar Ratio: 1.86
   - VaR (95%): -7.17%
   - Expected Shortfall (95%): -9.51%

4. Strategy Evaluation:
   - The strategy shows positive performance
   - Sharpe ratio indicates acceptable risk-adjusted returns
   - Success rate of 51.85% suggests good signal accuracy

5. Market Analysis:
   - The analyzed period shows high volatility
   - Maximum drawdown of -57.00% indicates significant risk
   - VaR suggests maximum expected daily losses of -7.17%

6. Recommendations:
   - The strategy shows a good balance between risk and return
   - Implement stricter stop-losses to reduce maximum drawdown
   - Maintain current position sizing
```

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