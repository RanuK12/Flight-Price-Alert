import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
import asyncio
from typing import Optional, Dict, Any
import plotly.graph_objects as go
import io
import base64

class TelegramNotifier:
    def __init__(self, token: str, chat_id: str):
        """
        Initialize Telegram bot.
        
        Args:
            token: Telegram bot token
            chat_id: Telegram chat ID
        """
        self.token = token
        self.chat_id = chat_id
        self.application = None
        self.logger = logging.getLogger(__name__)
        
    async def start_bot(self):
        """Start the Telegram bot."""
        try:
            self.application = Application.builder().token(self.token).build()
            
            # Add handlers
            self.application.add_handler(CommandHandler("start", self.start_command))
            self.application.add_handler(CommandHandler("help", self.help_command))
            self.application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.handle_message))
            
            # Start the bot
            await self.application.initialize()
            await self.application.start()
            await self.application.run_polling()
            
        except Exception as e:
            self.logger.error(f"Error starting Telegram bot: {str(e)}")
            raise
    
    async def start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /start command."""
        await update.message.reply_text(
            "Welcome to the Trading Bot! Use /help to see available commands."
        )
    
    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /help command."""
        help_text = """
Available commands:
/start - Start the bot
/help - Show this help message
/status - Show current trading status
/balance - Show current balance
/positions - Show open positions
        """
        await update.message.reply_text(help_text)
    
    async def handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle incoming messages."""
        await update.message.reply_text(
            "I can only process commands. Use /help to see available commands."
        )
    
    async def send_alert(self, alert_type: str, message: str):
        """
        Send alert message to Telegram.
        
        Args:
            alert_type: Type of alert ('info', 'warning', 'error')
            message: Alert message
        """
        if not self.application:
            self.logger.warning("Telegram bot not initialized")
            return
            
        try:
            emoji = {
                'info': 'ℹ️',
                'warning': '⚠️',
                'error': '❌'
            }.get(alert_type, '')
            
            formatted_message = f"{emoji} {message}"
            await self.application.bot.send_message(
                chat_id=self.chat_id,
                text=formatted_message
            )
        except Exception as e:
            self.logger.error(f"Error sending Telegram alert: {str(e)}")
    
    async def send_message(self, message: str):
        """
        Send regular message to Telegram.
        
        Args:
            message: Message to send
        """
        if not self.application:
            self.logger.warning("Telegram bot not initialized")
            return
            
        try:
            await self.application.bot.send_message(
                chat_id=self.chat_id,
                text=message
            )
        except Exception as e:
            self.logger.error(f"Error sending Telegram message: {str(e)}")
    
    async def send_chart(self, fig: go.Figure, caption: str):
        """
        Send chart to Telegram.
        
        Args:
            fig: Plotly figure
            caption: Chart caption
        """
        if not self.application:
            self.logger.warning("Telegram bot not initialized")
            return
            
        try:
            # Convert figure to image
            img_bytes = fig.to_image(format="png")
            
            # Send image
            await self.application.bot.send_photo(
                chat_id=self.chat_id,
                photo=img_bytes,
                caption=caption
            )
        except Exception as e:
            self.logger.error(f"Error sending Telegram chart: {str(e)}")
    
    async def stop_bot(self):
        """Stop the Telegram bot."""
        if self.application:
            await self.application.stop()
            await self.application.shutdown() 