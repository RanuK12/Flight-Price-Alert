import asyncio
import time
import logging
from typing import Dict, Optional, Any
import pandas as pd
from datetime import datetime, timedelta

from src.data.exchange import CryptoExchange
from src.strategies.base_strategy import BaseStrategy
from src.risk.risk_manager import RiskManager
from src.models.ml_predictor import MLPredictor
from src.utils.telegram_bot import TelegramNotifier

class LiveTrader:
    def __init__(self, exchange: CryptoExchange, strategy: BaseStrategy,
                 risk_manager: RiskManager, ml_predictor: Optional[MLPredictor] = None,
                 telegram_token: Optional[str] = None, telegram_chat_id: Optional[str] = None):
        """
        Initialize live trader.
        
        Args:
            exchange: Exchange instance
            strategy: Trading strategy
            risk_manager: Risk manager
            ml_predictor: Optional ML predictor
            telegram_token: Optional Telegram bot token
            telegram_chat_id: Optional Telegram chat ID
        """
        self.exchange = exchange
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.ml_predictor = ml_predictor
        
        # Setup logging
        logging.basicConfig(
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            level=logging.INFO
        )
        self.logger = logging.getLogger(__name__)
        
        # Initialize Telegram notifier if credentials provided
        self.telegram_bot = None
        if telegram_token and telegram_chat_id:
            self.telegram_bot = TelegramNotifier(telegram_token, telegram_chat_id)
        
        # Initialize state
        self.positions = {}
        self.trades = []
        self.last_portfolio_update = datetime.now()
        
    async def start(self, symbol: str, timeframe: str):
        """
        Start live trading.
        
        Args:
            symbol: Trading pair symbol
            timeframe: Candle timeframe
        """
        self.logger.info(f"Starting live trading for {symbol}")
        
        # Start Telegram bot if available
        if self.telegram_bot:
            await self.telegram_bot.start_bot()
        
        try:
            while True:
                try:
                    # Fetch latest data
                    data = self.exchange.get_ohlcv(
                        symbol=symbol,
                        timeframe=timeframe,
                        limit=100  # Get last 100 candles
                    )
                    
                    # Calculate indicators
                    data = self.strategy.calculate_indicators(data)
                    
                    # Generate signals
                    signals = self.strategy.generate_signals(data)
                    
                    # Get latest signal
                    latest_signal = signals['signal'].iloc[-1]
                    
                    # Get ML prediction if available
                    ml_prediction = None
                    if self.ml_predictor:
                        ml_prediction = self.ml_predictor.predict(data)
                    
                    # Execute trading logic
                    await self._execute_trading_logic(
                        symbol=symbol,
                        signal=latest_signal,
                        ml_prediction=ml_prediction,
                        current_price=data['close'].iloc[-1]
                    )
                    
                    # Update positions
                    await self._update_positions(symbol, data)
                    
                    # Send portfolio update every hour
                    if (datetime.now() - self.last_portfolio_update).seconds >= 3600:
                        await self._send_portfolio_update()
                        self.last_portfolio_update = datetime.now()
                    
                    # Wait for next candle
                    await asyncio.sleep(self._get_sleep_time(timeframe))
                    
                except Exception as e:
                    self.logger.error(f"Error in live trading: {str(e)}")
                    if self.telegram_bot:
                        await self.telegram_bot.send_alert('error', f"Trading error: {str(e)}")
                    time.sleep(self._get_sleep_time(timeframe))
        finally:
            if self.telegram_bot:
                await self.telegram_bot.stop_bot()
    
    async def stop(self):
        """Stop live trading."""
        if self.telegram_bot:
            await self.telegram_bot.stop_bot()
    
    async def _execute_trading_logic(self,
                                   symbol: str,
                                   signal: int,
                                   ml_prediction: Optional[float],
                                   current_price: float):
        """
        Execute trading logic based on signals and predictions.
        
        Args:
            symbol: Trading pair symbol
            signal: Trading signal (-1, 0, 1)
            ml_prediction: Optional ML prediction
            current_price: Current price
        """
        # Check if we have an open position
        if symbol not in self.positions:
            # No position, check for entry
            if signal == 1:  # Buy signal
                # Check ML prediction if available
                if ml_prediction is None or ml_prediction > 0:
                    # Calculate position size
                    position_size = self.risk_manager.calculate_position_size(
                        capital=self.exchange.get_balance()['total']['USDT'],
                        price=current_price
                    )
                    
                    # Place buy order
                    order = self.exchange.create_order(
                        symbol=symbol,
                        order_type='market',
                        side='buy',
                        amount=position_size
                    )
                    
                    # Update position
                    self.positions[symbol] = {
                        'size': position_size,
                        'entry_price': current_price,
                        'stop_loss': current_price * (1 - self.risk_manager.stop_loss_pct),
                        'take_profit': current_price * (1 + self.risk_manager.take_profit_pct),
                        'trailing_stop': current_price * (1 - self.risk_manager.trailing_stop_pct),
                        'order_id': order['id']
                    }
                    
                    # Log trade
                    self.trades.append({
                        'timestamp': datetime.now(),
                        'symbol': symbol,
                        'type': 'buy',
                        'price': current_price,
                        'amount': position_size
                    })
                    
                    # Send notification
                    if self.telegram_bot:
                        await self.telegram_bot.send_alert(
                            'info',
                            f"Opened long position in {symbol} at {current_price:.2f}"
                        )
        
        else:
            # Have position, check for exit
            position = self.positions[symbol]
            if signal == -1:  # Sell signal
                # Check ML prediction if available
                if ml_prediction is None or ml_prediction < 0:
                    # Place sell order
                    order = self.exchange.create_order(
                        symbol=symbol,
                        order_type='market',
                        side='sell',
                        amount=position['size']
                    )
                    
                    # Calculate profit/loss
                    pnl = (current_price - position['entry_price']) / position['entry_price']
                    
                    # Log trade
                    self.trades.append({
                        'timestamp': datetime.now(),
                        'symbol': symbol,
                        'type': 'sell',
                        'price': current_price,
                        'amount': position['size'],
                        'pnl': pnl
                    })
                    
                    # Send notification
                    if self.telegram_bot:
                        await self.telegram_bot.send_alert(
                            'info',
                            f"Closed position in {symbol} at {current_price:.2f} (P/L: {pnl:.2%})"
                        )
                    
                    # Remove position
                    del self.positions[symbol]
    
    async def _update_positions(self, symbol: str, market_data: pd.DataFrame):
        """
        Update open positions.
        
        Args:
            symbol: Trading pair symbol
            market_data: Market data
        """
        if symbol not in self.positions:
            return
            
        current_price = market_data['close'].iloc[-1]
        position = self.positions[symbol]
        
        # Check stop loss
        if current_price <= position['stop_loss']:
            self.logger.info(f"Stop loss triggered for {symbol}")
            if self.telegram_bot:
                await self.telegram_bot.send_alert('warning', f'Stop loss triggered for {symbol}')
            
            # Execute sell order
            order = self.exchange.create_order(
                symbol=symbol,
                type='market',
                side='sell',
                amount=position['size']
            )
            
            # Calculate loss
            loss = (current_price - position['entry_price']) * position['size']
            
            # Log trade
            self.trades.append({
                'timestamp': datetime.now(),
                'symbol': symbol,
                'type': 'sell',
                'price': current_price,
                'amount': position['size'],
                'profit': loss
            })
            
            # Send alert
            if self.telegram_bot:
                await self.telegram_bot.send_trade_alert('sell', symbol, current_price, position['size'], loss)
            
            # Remove position
            del self.positions[symbol]
            return
        
        # Check take profit
        if current_price >= position['take_profit']:
            self.logger.info(f"Take profit triggered for {symbol}")
            if self.telegram_bot:
                await self.telegram_bot.send_alert('success', f'Take profit triggered for {symbol}')
            
            # Execute sell order
            order = self.exchange.create_order(
                symbol=symbol,
                type='market',
                side='sell',
                amount=position['size']
            )
            
            # Calculate profit
            profit = (current_price - position['entry_price']) * position['size']
            
            # Log trade
            self.trades.append({
                'timestamp': datetime.now(),
                'symbol': symbol,
                'type': 'sell',
                'price': current_price,
                'amount': position['size'],
                'profit': profit
            })
            
            # Send alert
            if self.telegram_bot:
                await self.telegram_bot.send_trade_alert('sell', symbol, current_price, position['size'], profit)
            
            # Remove position
            del self.positions[symbol]
            return
        
        # Update trailing stop
        if current_price > position['entry_price']:
            new_trailing_stop = current_price * (1 - self.risk_manager.trailing_stop_pct)
            if new_trailing_stop > position['trailing_stop']:
                position['trailing_stop'] = new_trailing_stop
                self.logger.info(f"Updated trailing stop for {symbol} to {new_trailing_stop}")
    
    async def _send_portfolio_update(self):
        """Send portfolio update via Telegram."""
        if not self.telegram_bot:
            return
            
        # Calculate portfolio value
        portfolio_value = self.exchange.get_balance()['total']['USDT']
        for symbol, position in self.positions.items():
            current_price = self.exchange.get_ticker(symbol)['last']
            portfolio_value += current_price * position['size']
        
        # Calculate daily change
        daily_change = 0.0  # This should be calculated based on historical data
        
        # Prepare positions data
        positions_data = {}
        for symbol, position in self.positions.items():
            current_price = self.exchange.get_ticker(symbol)['last']
            pnl = (current_price - position['entry_price']) / position['entry_price'] * 100
            
            positions_data[symbol] = {
                'size': position['size'],
                'entry_price': position['entry_price'],
                'current_price': current_price,
                'pnl': pnl
            }
        
        # Send update
        await self.telegram_bot.send_portfolio_update(
            portfolio_value=portfolio_value,
            positions=positions_data,
            daily_change=daily_change
        )
    
    def _get_sleep_time(self, timeframe: str) -> int:
        """
        Calculate sleep time in seconds based on timeframe.
        
        Args:
            timeframe: Candle timeframe
            
        Returns:
            Sleep time in seconds
        """
        # Convert timeframe to seconds
        unit = timeframe[-1]
        value = int(timeframe[:-1])
        
        if unit == 'm':
            return value * 60
        elif unit == 'h':
            return value * 3600
        elif unit == 'd':
            return value * 86400
        else:
            return 60  # Default to 1 minute 