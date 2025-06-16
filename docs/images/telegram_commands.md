# Telegram Bot Commands

## Basic Commands
- `/start` - Initialize the bot and get welcome message
- `/help` - Show all available commands
- `/list` - List all supported cryptocurrencies

## Analysis Commands
- `/analyze <symbol>` - Get technical analysis for a cryptocurrency
  Example: `/analyze BTC`
- `/trend <symbol>` - Get trend analysis and predictions
  Example: `/trend ETH`
- `/volume <symbol>` - Check volume analysis
  Example: `/volume BNB`

## Alert Commands
- `/alert <symbol> <price>` - Set price alert
  Example: `/alert BTC 50000`
- `/alerts` - List all active alerts
- `/delete_alert <id>` - Delete a specific alert

## Market Commands
- `/price <symbol>` - Get current price
  Example: `/price XRP`
- `/market` - Get overall market status
- `/news` - Get latest crypto news

## Settings
- `/language <en/es>` - Change bot language
- `/notifications <on/off>` - Toggle notifications
- `/timezone <zone>` - Set your timezone

## Example Responses

### Price Alert
```
🚨 Price Alert: BTC
Current Price: $48,500
Target Price: $50,000
Difference: +3.09%
```

### Technical Analysis
```
📊 Technical Analysis: ETH
RSI: 65.4 (Neutral)
MACD: Bullish
Trend: Upward
Support: $2,800
Resistance: $3,200
```

### Market Status
```
🌍 Market Status
BTC: $48,500 (+2.5%)
ETH: $3,000 (+1.8%)
BNB: $320 (-0.5%)
Market Cap: $2.1T
24h Volume: $85B
``` 