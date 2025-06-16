import os
from dotenv import load_dotenv
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
import yfinance as yf
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import ta

# Cargar variables de entorno
load_dotenv()
TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')

# Configuración de logging
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuración de las criptomonedas
CRYPTO_SYMBOLS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "BNB": "BNB-USD",
    "XLM": "XLM-USD",
    "XRP": "XRP-USD",
    "DOGE": "DOGE-USD"
}

# Función para obtener datos históricos
def get_historical_data(symbol, period="3d", interval="1d"):
    try:
        data = yf.download(symbol, period=period, interval=interval)
        return data
    except Exception as e:
        logger.error(f"Error al obtener datos para {symbol}: {str(e)}")
        return None

# Función para calcular indicadores técnicos
def calculate_indicators(df):
    # Asegurarse de que 'Close' es 1D
    close = df['Close']
    if isinstance(close, pd.DataFrame):
        close = close.squeeze()
    # RSI (corregido para períodos cortos)
    if len(close) < 14:
        df['RSI'] = 50  # Valor neutral si no hay suficientes datos
    else:
        df['RSI'] = ta.momentum.RSIIndicator(close).rsi()
    # MACD
    macd = ta.trend.MACD(close)
    df['MACD'] = macd.macd()
    df['MACD_Signal'] = macd.macd_signal()
    # Bollinger Bands
    bollinger = ta.volatility.BollingerBands(close)
    df['BB_Upper'] = bollinger.bollinger_hband()
    df['BB_Lower'] = bollinger.bollinger_lband()
    # Moving Averages (corregido)
    df['SMA_20'] = ta.trend.sma_indicator(close, window=20)
    df['SMA_50'] = ta.trend.sma_indicator(close, window=50)
    return df

# Función para crear gráfico
def create_crypto_chart(df, symbol):
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, 
                       vertical_spacing=0.03, 
                       row_heights=[0.7, 0.3])

    # Gráfico de precios
    fig.add_trace(go.Candlestick(x=df.index,
                                open=df['Open'],
                                high=df['High'],
                                low=df['Low'],
                                close=df['Close'],
                                name='Precio'),
                  row=1, col=1)
    
    # Bollinger Bands
    fig.add_trace(go.Scatter(x=df.index, y=df['BB_Upper'],
                            line=dict(color='rgba(250, 0, 0, 0.3)'),
                            name='BB Superior'),
                  row=1, col=1)
    fig.add_trace(go.Scatter(x=df.index, y=df['BB_Lower'],
                            line=dict(color='rgba(0, 250, 0, 0.3)'),
                            name='BB Inferior'),
                  row=1, col=1)
    
    # Moving Averages
    fig.add_trace(go.Scatter(x=df.index, y=df['SMA_20'],
                            line=dict(color='blue'),
                            name='SMA 20'),
                  row=1, col=1)
    fig.add_trace(go.Scatter(x=df.index, y=df['SMA_50'],
                            line=dict(color='orange'),
                            name='SMA 50'),
                  row=1, col=1)
    
    # MACD
    fig.add_trace(go.Scatter(x=df.index, y=df['MACD'],
                            line=dict(color='blue'),
                            name='MACD'),
                  row=2, col=1)
    fig.add_trace(go.Scatter(x=df.index, y=df['MACD_Signal'],
                            line=dict(color='orange'),
                            name='Señal MACD'),
                  row=2, col=1)
    
    # Actualizar layout
    fig.update_layout(
        title=f'Análisis Técnico - {symbol}',
        yaxis_title='Precio (USD)',
        yaxis2_title='MACD',
        xaxis_rangeslider_visible=False,
        height=800,
        template='plotly_dark'
    )
    
    return fig

# Función para determinar la tendencia
def get_trend(data):
    current_price = data['Close'].iloc[-1].item()
    sma_20 = data['SMA_20'].iloc[-1].item()
    sma_50 = data['SMA_50'].iloc[-1].item()
    if current_price > sma_20 and sma_20 > sma_50:
        return "alcista"
    elif current_price < sma_20 and sma_20 < sma_50:
        return "bajista"
    else:
        return "lateral"

# Función para generar informe dinámico según el período
def generate_report(data, period):
    current_price = data['Close'].iloc[-1].item()
    sma_20 = data['SMA_20'].iloc[-1].item()
    sma_50 = data['SMA_50'].iloc[-1].item()
    rsi = data['RSI'].iloc[-1].item()
    trend = get_trend(data)

    report = f"""
    **Resumen del período {period}:**
    - Tendencia principal: **{trend.upper()}**
    - Precio actual: **${current_price:.2f}**
    - RSI: **{rsi:.2f}** ({'Sobrecomprado' if rsi > 70 else 'Sobrevendido' if rsi < 30 else 'Neutral'})
    - Retorno diario: **{data['Close'].pct_change().iloc[-1].item()*100:.2f}%**
    - Volatilidad diaria: **{data['Close'].pct_change().std().item()*100:.2f}%**
    - Volumen promedio: **${data['Volume'].mean().item():,.0f}**

    **Recomendación:**
    """
    if trend == "alcista" and rsi < 70:
        report += "La tendencia es alcista y el RSI no está sobrecomprado. Puede ser un buen momento para mantener o comprar."
    elif trend == "bajista":
        report += "La tendencia es bajista. Precaución antes de comprar, podría ser mejor esperar una reversión."
    elif rsi > 70:
        report += "El RSI está en zona de sobrecompra. Puede haber una corrección a corto plazo."
    elif rsi < 30:
        report += "El RSI está en zona de sobreventa. Puede haber una oportunidad de rebote."
    else:
        report += "El mercado está lateral o sin una tendencia clara. Mejor esperar confirmación."

    report += """
    **¿Qué es el RSI?**
    El RSI (Índice de Fuerza Relativa) es un indicador que mide la velocidad y el cambio de los movimientos de precios. Un RSI por encima de 70 indica que el activo está sobrecomprado, mientras que un RSI por debajo de 30 indica que está sobrevendido. Es una herramienta útil para identificar posibles reversiones de tendencia.
    """
    return report

# Comando /start
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("¡Bienvenido al Bot de Análisis de Criptomonedas! Usa /help para ver los comandos disponibles.")

# Comando /help
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("""
    Comandos disponibles:
    /start - Iniciar el bot
    /help - Mostrar ayuda
    /analyze <criptomoneda> - Analizar una criptomoneda (ej: /analyze BTC)
    /list - Listar criptomonedas disponibles
    """)

# Comando /analyze
async def analyze(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Por favor, especifica una criptomoneda. Ejemplo: /analyze BTC")
        return

    symbol = context.args[0].upper()
    if symbol not in CRYPTO_SYMBOLS:
        await update.message.reply_text(f"Criptomoneda no válida. Usa /list para ver las disponibles.")
        return

    data = get_historical_data(CRYPTO_SYMBOLS[symbol], period="3d")
    if data is not None and not data.empty:
        data = calculate_indicators(data)
        report = generate_report(data, "3d")
        await update.message.reply_text(report)
    else:
        await update.message.reply_text(f"No hay datos disponibles para {symbol} en el período seleccionado.")

# Comando /list
async def list_cryptos(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cryptos = ", ".join(CRYPTO_SYMBOLS.keys())
    await update.message.reply_text(f"Criptomonedas disponibles: {cryptos}")

# Función principal
def main():
    if not TELEGRAM_TOKEN:
        logger.error("No se encontró el token de Telegram. Asegúrate de que esté configurado en el archivo .env.")
        return

    application = Application.builder().token(TELEGRAM_TOKEN).build()

    # Agregar comandos
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("analyze", analyze))
    application.add_handler(CommandHandler("list", list_cryptos))

    # Iniciar el bot
    application.run_polling()

if __name__ == "__main__":
    main() 