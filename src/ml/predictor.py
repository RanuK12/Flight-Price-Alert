import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from sklearn.preprocessing import MinMaxScaler
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.optimizers import Adam

class MLPredictor:
    def __init__(self, model_type: str = 'lstm', sequence_length: int = 60):
        """
        Initialize the machine learning predictor.
        
        Args:
            model_type: Type of model ('lstm', 'rf', or 'gb')
            sequence_length: Length of input sequences for LSTM
        """
        self.model_type = model_type
        self.sequence_length = sequence_length
        self.scaler = MinMaxScaler()
        self.model = None
        
    def prepare_data(self, data: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare data for model training/prediction.
        
        Args:
            data: DataFrame with OHLCV data
            
        Returns:
            Tuple of (X, y) arrays
        """
        # Calculate technical indicators
        df = data.copy()
        
        # Moving averages
        df['sma_20'] = df['close'].rolling(window=20).mean()
        df['sma_50'] = df['close'].rolling(window=50).mean()
        
        # RSI
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # MACD
        exp1 = df['close'].ewm(span=12, adjust=False).mean()
        exp2 = df['close'].ewm(span=26, adjust=False).mean()
        df['macd'] = exp1 - exp2
        df['signal'] = df['macd'].ewm(span=9, adjust=False).mean()
        
        # Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=20).mean()
        df['bb_std'] = df['close'].rolling(window=20).std()
        df['bb_upper'] = df['bb_middle'] + 2 * df['bb_std']
        df['bb_lower'] = df['bb_middle'] - 2 * df['bb_std']
        
        # Drop NaN values
        df = df.dropna()
        
        # Prepare features
        features = ['open', 'high', 'low', 'close', 'volume', 'sma_20', 'sma_50',
                   'rsi', 'macd', 'signal', 'bb_middle', 'bb_upper', 'bb_lower']
        
        # Scale features
        scaled_data = self.scaler.fit_transform(df[features])
        
        if self.model_type == 'lstm':
            X, y = [], []
            for i in range(self.sequence_length, len(scaled_data)):
                X.append(scaled_data[i-self.sequence_length:i])
                y.append(scaled_data[i, 3])  # Predict close price
            return np.array(X), np.array(y)
        else:
            X = scaled_data[:-1]
            y = scaled_data[1:, 3]  # Predict next close price
            return X, y
    
    def build_model(self, input_shape: Tuple[int, int]):
        """
        Build the machine learning model.
        
        Args:
            input_shape: Shape of input data
        """
        if self.model_type == 'lstm':
            model = Sequential([
                LSTM(units=50, return_sequences=True, input_shape=input_shape),
                Dropout(0.2),
                LSTM(units=50, return_sequences=False),
                Dropout(0.2),
                Dense(units=1)
            ])
            model.compile(optimizer=Adam(learning_rate=0.001),
                        loss='mean_squared_error')
            
        elif self.model_type == 'rf':
            model = RandomForestRegressor(n_estimators=100, random_state=42)
            
        elif self.model_type == 'gb':
            model = GradientBoostingRegressor(n_estimators=100, random_state=42)
            
        else:
            raise ValueError(f"Unknown model type: {self.model_type}")
        
        self.model = model
    
    def train(self, data: pd.DataFrame):
        """
        Train the model on historical data.
        
        Args:
            data: DataFrame with OHLCV data
        """
        X, y = self.prepare_data(data)
        
        if self.model is None:
            if self.model_type == 'lstm':
                self.build_model((X.shape[1], X.shape[2]))
            else:
                self.build_model(None)
        
        if self.model_type == 'lstm':
            self.model.fit(X, y, epochs=50, batch_size=32, validation_split=0.1)
        else:
            self.model.fit(X, y)
    
    def predict(self, data: pd.DataFrame) -> np.ndarray:
        """
        Make predictions using the trained model.
        
        Args:
            data: DataFrame with OHLCV data
            
        Returns:
            Array of predictions
        """
        X, _ = self.prepare_data(data)
        
        if self.model_type == 'lstm':
            predictions = self.model.predict(X)
        else:
            predictions = self.model.predict(X)
        
        # Inverse transform predictions
        dummy = np.zeros((len(predictions), self.scaler.n_features_in_))
        dummy[:, 3] = predictions  # Close price is at index 3
        predictions = self.scaler.inverse_transform(dummy)[:, 3]
        
        return predictions
    
    def evaluate(self, data: pd.DataFrame) -> Dict:
        """
        Evaluate model performance.
        
        Args:
            data: DataFrame with OHLCV data
            
        Returns:
            Dictionary with evaluation metrics
        """
        X, y = self.prepare_data(data)
        
        if self.model_type == 'lstm':
            predictions = self.model.predict(X)
        else:
            predictions = self.model.predict(X)
        
        # Calculate metrics
        mse = np.mean((y - predictions) ** 2)
        rmse = np.sqrt(mse)
        mae = np.mean(np.abs(y - predictions))
        
        # Calculate directional accuracy
        actual_direction = np.diff(y)
        pred_direction = np.diff(predictions)
        directional_accuracy = np.mean((actual_direction * pred_direction) > 0)
        
        return {
            'mse': mse,
            'rmse': rmse,
            'mae': mae,
            'directional_accuracy': directional_accuracy
        } 