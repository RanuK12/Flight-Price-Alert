from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import pandas as pd
from pyspark.sql import DataFrame, SparkSession


class BaseLoader(ABC):
    """Base class for all data loaders."""

    def __init__(self, config: Dict[str, Any]):
        """Initialize the loader with configuration.

        Args:
            config (Dict[str, Any]): Configuration dictionary for the loader
        """
        self.config = config
        self.spark = SparkSession.builder.getOrCreate()

    @abstractmethod
    def load(self, data: Any) -> None:
        """Load data to the destination.

        Args:
            data (Any): Data to load
        """
        pass

    def to_pandas(self, data: Any) -> pd.DataFrame:
        """Convert data to pandas DataFrame.

        Args:
            data (Any): Data to convert

        Returns:
            pd.DataFrame: Converted data as pandas DataFrame
        """
        if isinstance(data, DataFrame):
            return data.toPandas()
        elif isinstance(data, pd.DataFrame):
            return data
        else:
            raise ValueError(f"Unsupported data type: {type(data)}")

    def to_spark(self, data: Any) -> DataFrame:
        """Convert data to Spark DataFrame.

        Args:
            data (Any): Data to convert

        Returns:
            DataFrame: Converted data as Spark DataFrame
        """
        if isinstance(data, DataFrame):
            return data
        elif isinstance(data, pd.DataFrame):
            return self.spark.createDataFrame(data)
        else:
            raise ValueError(f"Unsupported data type: {type(data)}")

    def validate_config(self, required_keys: List[str]) -> None:
        """Validate that all required configuration keys are present.

        Args:
            required_keys (List[str]): List of required configuration keys

        Raises:
            ValueError: If any required key is missing
        """
        missing_keys = [key for key in required_keys if key not in self.config]
        if missing_keys:
            raise ValueError(f"Missing required configuration keys: {missing_keys}")

    def validate_data(self, data: Any, required_columns: List[str]) -> None:
        """Validate that the data contains all required columns.

        Args:
            data (Any): Data to validate
            required_columns (List[str]): List of required column names

        Raises:
            ValueError: If any required column is missing
        """
        if isinstance(data, (DataFrame, pd.DataFrame)):
            missing_columns = [col for col in required_columns if col not in data.columns]
            if missing_columns:
                raise ValueError(f"Missing required columns: {missing_columns}")
        else:
            raise ValueError(f"Unsupported data type: {type(data)}")

    def cleanup(self) -> None:
        """Clean up resources used by the loader."""
        pass 