# Algorithmic Trading Dashboard

## Overview
A comprehensive cryptocurrency analysis and trading dashboard that combines real-time market data analysis with automated trading signals. The platform provides both a web interface and Telegram bot integration for flexible access to market insights.

## Features

### Multi-language Support
- English and Spanish interfaces
- Dynamic content translation
- User-friendly language selection

### Real-time Market Analysis
- Live cryptocurrency price tracking
- Technical indicators calculation
- Trend analysis and predictions

### Supported Cryptocurrencies
Currently tracking:
- Bitcoin (BTC)
- Ethereum (ETH)
- Binance Coin (BNB)
- Stellar (XLM)
- Ripple (XRP)
- Dogecoin (DOGE)

### Technical Indicators
- RSI (Relative Strength Index)
- MACD (Moving Average Convergence Divergence)
- Bollinger Bands
- Moving Averages (20 and 50 periods)

### Data Sources
- Market data: Yahoo Finance API
- Real-time updates: WebSocket connections
- Historical data: Historical API endpoints

## Architecture

### Frontend
- Built with Streamlit for interactive web interface
- Responsive design with dark theme
- Real-time data visualization using Plotly

### Backend
- Python-based data processing
- Asynchronous data fetching
- Efficient data storage and caching

### Telegram Integration
- Real-time market alerts
- Custom command interface
- Automated analysis reports

## Installation

1. Clone the repository:
```bash
git clone https://github.com/RanuK12/algorithmic-trading-python.git
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run the application:
```bash
python -m streamlit run main.py
```

## Usage

### Web Dashboard
1. Select your preferred language
2. Choose a cryptocurrency
3. Set analysis period
4. View real-time analysis and charts

### Telegram Bot
1. Start the bot with `/start`
2. Use `/help` for available commands
3. Analyze cryptocurrencies with `/analyze <symbol>`
4. List available cryptocurrencies with `/list`

## Development

### Project Structure
```
etl-bigdata-pipeline/
├── main.py              # Main application
├── telegram_bot.py      # Telegram bot implementation
├── requirements.txt     # Project dependencies
└── .env                # Environment configuration
```

### Technologies Used
- Python 3.8+
- Streamlit
- Plotly
- python-telegram-bot
- yfinance
- pandas
- numpy

## Contributing
1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License
This project is licensed under the MIT License - see the LICENSE file for details.

## Contact
For any questions or suggestions, please open an issue in the repository.