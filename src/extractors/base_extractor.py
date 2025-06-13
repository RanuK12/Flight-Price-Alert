from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import pandas as pd
from pyspark.sql import DataFrame, SparkSession


class BaseExtractor(ABC):
    """Base class for all data extractors."""

    def __init__(self, config: Dict[str, Any]):
        """Initialize the extractor with configuration.

        Args:
            config (Dict[str, Any]): Configuration dictionary for the extractor
        """
        self.config = config
        self.spark = SparkSession.builder.getOrCreate()

    @abstractmethod
    def extract(self) -> Any:
        """Extract data from the source.

        Returns:
            Any: Extracted data in the appropriate format
        """
        pass

    def to_pandas(self, data: Any) -> pd.DataFrame:
        """Convert extracted data to pandas DataFrame.

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
        """Convert extracted data to Spark DataFrame.

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

    def cleanup(self) -> None:
        """Clean up resources used by the extractor."""
        pass 