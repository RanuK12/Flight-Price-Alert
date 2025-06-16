import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from typing import Dict, List, Tuple, Optional

class MLPredictor:
    def __init__(self, model_type: str = 'lstm'):
        """
        Initialize ML predictor.
        
        Args:
            model_type: Type of model ('lstm', 'rf', or 'gbm')
        """
        self.model_type = model_type
        self.scaler = StandardScaler()
        self.model = None
        
    def prepare_features(self, 
                        data: pd.DataFrame,
                        lookback: int = 60) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare features for ML model.
        
        Args:
            data: OHLCV data
            lookback: Number of periods to look back
            
        Returns:
            Tuple of (X, y) arrays
        """
        # Calculate technical indicators
        df = data.copy()
        df['returns'] = df['close'].pct_change()
        df['volatility'] = df['returns'].rolling(window=20).std()
        df['rsi'] = self._calculate_rsi(df['close'])
        df['macd'] = self._calculate_macd(df['close'])
        
        # Create features
        features = ['close', 'volume', 'returns', 'volatility', 'rsi', 'macd']
        X = df[features].values
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Create sequences
        X_seq, y_seq = [], []
        for i in range(lookback, len(X_scaled)):
            X_seq.append(X_scaled[i-lookback:i])
            y_seq.append(X_scaled[i, 0])  # Predict next close price
            
        return np.array(X_seq), np.array(y_seq)
    
    def build_model(self, input_shape: Tuple[int, int]):
        """
        Build ML model.
        
        Args:
            input_shape: Shape of input data
        """
        if self.model_type == 'lstm':
            self.model = Sequential([
                LSTM(50, return_sequences=True, input_shape=input_shape),
                Dropout(0.2),
                LSTM(50, return_sequences=False),
                Dropout(0.2),
                Dense(25),
                Dense(1)
            ])
            self.model.compile(optimizer='adam', loss='mse')
            
        elif self.model_type == 'rf':
            self.model = RandomForestRegressor(
                n_estimators=100,
                max_depth=10,
                random_state=42
            )
            
        elif self.model_type == 'gbm':
            self.model = GradientBoostingRegressor(
                n_estimators=100,
                max_depth=5,
                random_state=42
            )
    
    def train(self, 
              data: pd.DataFrame,
              lookback: int = 60,
              test_size: float = 0.2) -> Dict[str, float]:
        """
        Train ML model.
        
        Args:
            data: OHLCV data
            lookback: Number of periods to look back
            test_size: Proportion of data to use for testing
            
        Returns:
            Dictionary with training metrics
        """
        # Prepare data
        X, y = self.prepare_features(data, lookback)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, shuffle=False
        )
        
        # Build and train model
        if self.model_type == 'lstm':
            self.build_model((X_train.shape[1], X_train.shape[2]))
            history = self.model.fit(
                X_train, y_train,
                epochs=50,
                batch_size=32,
                validation_data=(X_test, y_test),
                verbose=0
            )
            metrics = {
                'train_loss': history.history['loss'][-1],
                'val_loss': history.history['val_loss'][-1]
            }
        else:
            self.build_model(None)
            X_train_2d = X_train.reshape(X_train.shape[0], -1)
            X_test_2d = X_test.reshape(X_test.shape[0], -1)
            self.model.fit(X_train_2d, y_train)
            metrics = {
                'train_score': self.model.score(X_train_2d, y_train),
                'test_score': self.model.score(X_test_2d, y_test)
            }
            
        return metrics
    
    def predict(self, 
                data: pd.DataFrame,
                lookback: int = 60) -> np.ndarray:
        """
        Make predictions.
        
        Args:
            data: OHLCV data
            lookback: Number of periods to look back
            
        Returns:
            Array of predictions
        """
        X, _ = self.prepare_features(data, lookback)
        
        if self.model_type == 'lstm':
            predictions = self.model.predict(X)
        else:
            X_2d = X.reshape(X.shape[0], -1)
            predictions = self.model.predict(X_2d)
            
        # Inverse transform predictions
        predictions = self.scaler.inverse_transform(
            np.concatenate([predictions, np.zeros((len(predictions), 5))], axis=1)
        )[:, 0]
        
        return predictions
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI indicator."""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def _calculate_macd(self, prices: pd.Series) -> pd.Series:
        """Calculate MACD indicator."""
        exp1 = prices.ewm(span=12, adjust=False).mean()
        exp2 = prices.ewm(span=26, adjust=False).mean()
        return exp1 - exp2 