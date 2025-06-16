import os
from dotenv import load_dotenv
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import streamlit as st
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import yfinance as yf
import ta

# Configuración de la página con tema oscuro
st.set_page_config(page_title="Crypto Analysis Dashboard", layout="wide", initial_sidebar_state="expanded")
st.markdown("""
<style>
    .main {
        background-color: #1E1E1E;
        color: #FFFFFF;
    }
    .stButton>button {
        background-color: #4CAF50;
        color: white;
    }
    .stMetric {
        background-color: #2D2D2D;
        border-radius: 5px;
        padding: 10px;
    }
    .stSelectbox {
        background-color: #2D2D2D;
        color: white;
    }
</style>
""", unsafe_allow_html=True)
st.title("Crypto Analysis Dashboard")

# Configuración de las criptomonedas (agregando XLM, XRP y DOGE)
CRYPTO_SYMBOLS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "BNB": "BNB-USD",
    "XLM": "XLM-USD",
    "XRP": "XRP-USD",
    "DOGE": "DOGE-USD"
}

# Función para obtener datos históricos
def get_historical_data(symbol, period="1mo", interval="1d"):
    try:
        data = yf.download(symbol, period=period, interval=interval)
        if data.empty:
            st.error(f"{'No data available for' if language == 'English' else 'No hay datos disponibles para'} {symbol} {'in the selected period' if language == 'English' else 'en el período seleccionado'}.")
            return None
        return data
    except Exception as e:
        st.error(f"{'Error getting data for' if language == 'English' else 'Error al obtener datos para'} {symbol}: {str(e)}")
        return None

# Función para calcular indicadores técnicos
def calculate_indicators(df):
    close = df['Close']
    if isinstance(close, pd.DataFrame):
        close = close.squeeze()

    n_data = len(close)

    # RSI (existing logic, handles short data with a neutral value)
    if n_data < 14:
        df['RSI'] = 50
    else:
        df['RSI'] = ta.momentum.RSIIndicator(close).rsi()

    # Moving Averages with dynamic windows (minimum 2 days for average)
    sma_20_window = min(20, max(2, n_data))
    sma_50_window = min(50, max(2, n_data))
    df['SMA_20'] = ta.trend.sma_indicator(close, window=sma_20_window)
    df['SMA_50'] = ta.trend.sma_indicator(close, window=sma_50_window)

    # Bollinger Bands with dynamic window (minimum 2 days for average)
    bollinger_window = min(20, max(2, n_data))
    bollinger = ta.volatility.BollingerBands(close, window=bollinger_window)
    df['BB_Upper'] = bollinger.bollinger_hband()
    df['BB_Lower'] = bollinger.bollinger_lband()

    # MACD (kept standard as dynamic windows drastically change its meaning)
    # This will still produce NaNs if data is too short for 12, 26, 9 periods.
    macd = ta.trend.MACD(close)
    df['MACD'] = macd.macd()
    df['MACD_Signal'] = macd.macd_signal()

    return df

# Función para determinar la tendencia
def get_trend(data):
    current_price = data['Close'].iloc[-1].item()
    sma_20 = data['SMA_20'].iloc[-1].item()
    sma_50 = data['SMA_50'].iloc[-1].item()
    if current_price > sma_20 and sma_20 > sma_50:
        return "bullish" if language == "English" else "alcista"
    elif current_price < sma_20 and sma_20 < sma_50:
        return "bearish" if language == "English" else "bajista"
    else:
        return "sideways" if language == "English" else "lateral"

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
                                name='Price' if language == 'English' else 'Precio'),
                  row=1, col=1)

    # Bollinger Bands
    if not df['BB_Upper'].isnull().all():
        fig.add_trace(go.Scatter(x=df.index, y=df['BB_Upper'],
                                line=dict(color='rgba(250, 0, 0, 0.3)'),
                                name='Upper BB' if language == 'English' else 'BB Superior'),
                      row=1, col=1)
    if not df['BB_Lower'].isnull().all():
        fig.add_trace(go.Scatter(x=df.index, y=df['BB_Lower'],
                                line=dict(color='rgba(0, 250, 0, 0.3)'),
                                name='Lower BB' if language == 'English' else 'BB Inferior'),
                      row=1, col=1)

    # Moving Averages
    if not df['SMA_20'].isnull().all():
        fig.add_trace(go.Scatter(x=df.index, y=df['SMA_20'],
                                line=dict(color='blue'),
                                name='SMA 20'),
                      row=1, col=1)
    if not df['SMA_50'].isnull().all():
        fig.add_trace(go.Scatter(x=df.index, y=df['SMA_50'],
                                line=dict(color='orange'),
                                name='SMA 50'),
                      row=1, col=1)

    # MACD
    if not df['MACD'].isnull().all():
        fig.add_trace(go.Scatter(x=df.index, y=df['MACD'],
                                line=dict(color='blue'),
                                name='MACD'),
                      row=2, col=1)
    if not df['MACD_Signal'].isnull().all():
        fig.add_trace(go.Scatter(x=df.index, y=df['MACD_Signal'],
                                line=dict(color='orange'),
                                name='MACD Signal' if language == 'English' else 'Señal MACD'),
                      row=2, col=1)

    # Actualizar layout
    fig.update_layout(
        title=f"{'Technical Analysis -' if language == 'English' else 'Análisis Técnico -'} {symbol}",
        yaxis_title='Price (USD)' if language == 'English' else 'Precio (USD)',
        yaxis2_title='MACD',
        xaxis_rangeslider_visible=False,
        height=800,
        template='plotly_dark'
    )

    return fig

# Función para generar informe dinámico según el período
def generate_report(data, period):
    current_price = data['Close'].iloc[-1].item()
    sma_20 = data['SMA_20'].iloc[-1].item()
    sma_50 = data['SMA_50'].iloc[-1].item()
    rsi = data['RSI'].iloc[-1].item()
    trend = get_trend(data)

    if language == 'English':
        report = f"""
        **Period Summary ({period}):**
        - Main trend: **{trend.upper()}**
        - Current price: **${current_price:.2f}**
        - RSI: **{rsi:.2f}** ({'Overbought' if rsi > 70 else 'Oversold' if rsi < 30 else 'Neutral'})
        - Daily return: **{data['Close'].pct_change().iloc[-1].item()*100:.2f}%**
        - Daily volatility: **{data['Close'].pct_change().std().item()*100:.2f}%**
        - Average volume: **${data['Volume'].mean().item():,.0f}**

        **Recommendation:**
        """
        if trend == "bullish" and rsi < 70:
            report += "The trend is bullish and RSI is not overbought. This might be a good time to hold or buy."
        elif trend == "bearish":
            report += "The trend is bearish. Be cautious before buying, it might be better to wait for a reversal."
        elif rsi > 70:
            report += "RSI is in overbought territory. There might be a short-term correction."
        elif rsi < 30:
            report += "RSI is in oversold territory. There might be a bounce opportunity."
        else:
            report += "The market is sideways or without a clear trend. Better wait for confirmation."

        report += """
        **What is RSI?**
        RSI (Relative Strength Index) is an indicator that measures the speed and change of price movements. An RSI above 70 indicates that the asset is overbought, while an RSI below 30 indicates that it is oversold. It's a useful tool for identifying potential trend reversals.
        """
    else:
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

# Sidebar para configuración
st.sidebar.header("Language Selection")
language = st.sidebar.selectbox(
    "Choose your language",
    ["English", "Español"]
)

# Mensaje de bienvenida
if language == "English":
    st.markdown("""
    # Welcome to the Crypto Analysis Dashboard
    Select a cryptocurrency and analysis period to begin.
    """)
else:
    st.markdown("""
    # Bienvenido al Dashboard de Análisis de Criptomonedas
    Selecciona una criptomoneda y un período de análisis para comenzar.
    """)

# Sidebar para configuración
st.sidebar.header("Cryptocurrency Selection" if language == "English" else "Selección de Criptomoneda")
selected_crypto = st.sidebar.selectbox(
    "Choose your cryptocurrency" if language == "English" else "Elige tu criptomoneda",
    list(CRYPTO_SYMBOLS.keys())
)

time_period = st.sidebar.selectbox(
    "Analysis period" if language == "English" else "Período de análisis",
    ["1d", "3d", "5d", "15d", "1mo", "3mo", "6mo", "1y"],
    index=1  # Cambiado a 3d
)

# Obtener y procesar datos
data = get_historical_data(CRYPTO_SYMBOLS[selected_crypto], period=time_period)
if data is not None and not data.empty:
    data = calculate_indicators(data)
    
    # Mensaje de advertencia para períodos cortos
    if time_period in ["1d", "3d", "5d", "15d"]:
        st.warning("Algunos indicadores técnicos (como SMA 20/50, Bandas de Bollinger y MACD) pueden no mostrarse para períodos de análisis cortos debido a la falta de datos suficientes para su cálculo. Se recomienda seleccionar un período de 1 mes o más para un análisis completo de los indicadores." if language == "Español" else "Some technical indicators (like SMA 20/50, Bollinger Bands, and MACD) may not be visible for short analysis periods due to insufficient data for their calculation. It is recommended to select a period of 1 month or more for a complete indicator analysis.")
    
    # Mostrar métricas principales
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("Current Price" if language == "English" else "Precio Actual", 
                 f"${data['Close'].iloc[-1].item():.2f}",
                 f"{data['Close'].pct_change().iloc[-1].item()*100:.2f}%")
    
    with col2:
        st.metric("RSI", 
                 f"{data['RSI'].iloc[-1].item():.2f}")
    
    with col3:
        st.metric("24h Volume" if language == "English" else "Volumen 24h", 
                 f"${data['Volume'].iloc[-1].item():,.0f}")
    
    with col4:
        st.metric("Volatility" if language == "English" else "Volatilidad", 
                 f"{data['Close'].pct_change().std().item()*100:.2f}%")
    
    # Mostrar gráfico
    st.plotly_chart(create_crypto_chart(data, selected_crypto), use_container_width=True)
    
    # Informe dinámico según el período
    st.subheader("Investor Report" if language == "English" else "Informe para el Inversor")
    st.markdown(generate_report(data, time_period))

    # Explicación de las tendencias
    st.subheader("Trend Explanation" if language == "English" else "Explicación de las Tendencias")
    if language == "English":
        st.markdown("""
        **Lines and Trends:**
        - **SMA 20 (blue)**: 20-day moving average. If the price is above, it indicates an upward trend.
        - **SMA 50 (orange)**: 50-day moving average. If the price is above, it indicates a long-term upward trend.
        - **Bollinger Bands**: The upper and lower bands indicate volatility. If the price touches the upper band, it may be overbought.
        - **MACD**: If the blue line crosses above the orange line, it indicates a buy signal.
        """)
    else:
        st.markdown("""
        **Líneas y Tendencias:**
        - **SMA 20 (azul)**: Media móvil de 20 días. Si el precio está por encima, indica tendencia alcista.
        - **SMA 50 (naranja)**: Media móvil de 50 días. Si el precio está por encima, indica tendencia alcista a largo plazo.
        - **Bollinger Bands**: Las bandas superior e inferior indican volatilidad. Si el precio toca la banda superior, puede estar sobrecomprado.
        - **MACD**: Si la línea azul cruza por encima de la naranja, indica una señal de compra.
        """)

    # Indicador de tendencia de mercado
    st.subheader("Market Trend" if language == "English" else "Tendencia de Mercado")
    trend = get_trend(data)
    if trend in ["bullish", "alcista"]:
        st.markdown('<div style="background-color: green; color: white; padding: 10px; border-radius: 5px;">Upward Trend</div>' if language == "English" else '<div style="background-color: green; color: white; padding: 10px; border-radius: 5px;">Tendencia Alcista</div>', unsafe_allow_html=True)
    elif trend in ["bearish", "bajista"]:
        st.markdown('<div style="background-color: red; color: white; padding: 10px; border-radius: 5px;">Downward Trend</div>' if language == "English" else '<div style="background-color: red; color: white; padding: 10px; border-radius: 5px;">Tendencia Bajista</div>', unsafe_allow_html=True)
    else:
        st.markdown('<div style="background-color: orange; color: white; padding: 10px; border-radius: 5px;">Sideways Trend</div>' if language == "English" else '<div style="background-color: orange; color: white; padding: 10px; border-radius: 5px;">Tendencia Lateral</div>', unsafe_allow_html=True)

    # Tabla de datos históricos simplificada
    st.subheader("Historical Data" if language == "English" else "Datos Históricos")
    st.dataframe(data[['Open', 'High', 'Low', 'Close', 'Volume']].tail(10).style.format({
        'Open': '${:.2f}',
        'High': '${:.2f}',
        'Low': '${:.2f}',
        'Close': '${:.2f}',
        'Volume': '{:,.0f}'
    }))
else:
    st.error(f"No data available for {selected_crypto} in the selected period." if language == "English" else f"No hay datos disponibles para {selected_crypto} en el período seleccionado.")

# Integración del bot de Telegram
st.sidebar.header("Telegram Bot" if language == "English" else "Bot de Telegram")
if st.sidebar.button("Start Telegram Bot" if language == "English" else "Iniciar Bot de Telegram"):
    import subprocess
    subprocess.Popen(["python", "telegram_bot.py"])
    st.sidebar.success("Telegram Bot started. Use /help to see available commands." if language == "English" else "Bot de Telegram iniciado. Usa /help para ver los comandos disponibles.")
