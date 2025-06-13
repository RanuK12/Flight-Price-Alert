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

## Ejemplos de Tests

A continuación se muestra un ejemplo de la ejecución de los tests unitarios:

```bash
$ python -m pytest tests/unit/ -v
========================================= test session starts ==========================================
platform win32 -- Python 3.13.3, pytest-8.4.0, pluggy-1.6.0
cachedir: .pytest_cache
rootdir: C:\Users\emilio\Desktop\Oficina Ranuk
plugins: mock-3.14.1
collected 16 items

tests/unit/test_extract.py::test_extract_csv PASSED                                               [  6%]
tests/unit/test_extract.py::test_extract_json PASSED                                              [ 12%]
tests/unit/test_extract.py::test_extract_api PASSED                                               [ 18%]
tests/unit/test_extract.py::test_extract_sql PASSED                                               [ 25%]
tests/unit/test_extract.py::test_extract_data_invalid_source PASSED                               [ 31%]
tests/unit/test_extract.py::test_cleanup PASSED                                                   [ 37%]
tests/unit/test_transform.py::test_clean_data_drop_na PASSED                                      [ 43%]
tests/unit/test_transform.py::test_clean_data_drop_duplicates PASSED                              [ 50%]
tests/unit/test_transform.py::test_clean_data_fill_na PASSED                                      [ 56%]
tests/unit/test_transform.py::test_clean_data_rename_cols PASSED                                  [ 62%]
tests/unit/test_transform.py::test_aggregate_data PASSED                                          [ 68%]
tests/unit/test_transform.py::test_filter_data PASSED                                             [ 75%]
tests/unit/test_transform.py::test_transform_dates PASSED                                         [ 81%]
tests/unit/test_transform.py::test_normalize_data_min_max PASSED                                  [ 87%]
tests/unit/test_transform.py::test_normalize_data_z_score PASSED                                  [ 93%]
tests/unit/test_transform.py::test_forced_change PASSED                                           [100%]

========================================== 16 passed in 2.04s ==========================================
```