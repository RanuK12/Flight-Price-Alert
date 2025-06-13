# Cryptocurrency Price Monitor 🤖

A powerful cryptocurrency price monitoring bot that sends real-time alerts via WhatsApp when significant price changes are detected.

## Features ✨

- **Real-time Monitoring**: Continuously tracks cryptocurrency prices using the CoinGecko API
- **WhatsApp Notifications**: Instant alerts sent directly to your WhatsApp
- **Customizable Alerts**: Set your own price change thresholds
- **Multiple Cryptocurrencies**: Monitor any cryptocurrency supported by CoinGecko
- **Configurable Intervals**: Adjust monitoring frequency to your needs
- **Secure**: Environment variables for sensitive credentials
- **Detailed Logging**: Comprehensive logging system for monitoring and debugging

## Prerequisites 📋

- Python 3.8 or higher
- A Twilio account with WhatsApp capabilities
- A CoinGecko API key (optional, but recommended for higher rate limits)

## Installation 🚀

1. Clone the repository:
```bash
git clone https://github.com/RanuK12/cryptocurrency-price-monitor.git
cd cryptocurrency-price-monitor
```

2. Create and activate a virtual environment:
```bash
python -m venv venv
# On Windows
.\venv\Scripts\activate
# On Unix or MacOS
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create a `.env` file in the root directory with your credentials:
```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_TO=whatsapp:+your_phone_number

# Monitoring Configuration
MONITORING_INTERVAL=30
PRICE_CHANGE_THRESHOLD=0.5
CRYPTO_ID=bitcoin

# API Configuration
COINGECKO_API_URL=https://api.coingecko.com/api/v3
```

## Usage 💡

1. Start the bot:
```bash
python src/main.py
```

2. The bot will:
   - Monitor the specified cryptocurrency every 30 minutes (configurable)
   - Send WhatsApp alerts when price changes exceed the threshold
   - Log all activities to `crypto_bot.log`

## Usage Example

You can run a backtest for the Moving Average Crossover strategy on AAPL for 2023 with:

```bash
python -m src.backtest --strategy MovingAverageCrossover --symbol AAPL --start-date 2023-01-01 --end-date 2023-12-31
```

Example output:

```
Resultados para MovingAverageCrossover:
--------------------------------------------------

Ratio de Sharpe: nan
Drawdown Máximo: 0.00%
```

## Configuration Options ⚙️

- `MONITORING_INTERVAL`: Time between checks (in minutes)
- `PRICE_CHANGE_THRESHOLD`: Percentage change that triggers an alert
- `CRYPTO_ID`: The cryptocurrency to monitor (e.g., 'bitcoin', 'ethereum')

## Security 🔒

- All sensitive credentials are stored in the `.env` file
- The `.env` file is ignored by Git to prevent accidental exposure
- API keys and tokens are never hardcoded in the source code

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

## License 📄

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support 💬

If you encounter any issues or have questions, please open an issue in the GitHub repository.

## Acknowledgments 🙏

- [CoinGecko API](https://www.coingecko.com/en/api) for cryptocurrency data
- [Twilio](https://www.twilio.com/) for WhatsApp integration