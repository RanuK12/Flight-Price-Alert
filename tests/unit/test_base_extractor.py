import pytest
from pyspark.sql import DataFrame, SparkSession

from src.extractors.base_extractor import BaseExtractor


class TestExtractor(BaseExtractor):
    """Test implementation of BaseExtractor."""

    def extract(self):
        """Return test data."""
        return self.spark.createDataFrame([(1, "test"), (2, "data")], ["id", "value"])


@pytest.fixture
def spark():
    """Create a SparkSession for testing."""
    return SparkSession.builder.master("local[1]").appName("test").getOrCreate()


@pytest.fixture
def extractor(spark):
    """Create a test extractor instance."""
    return TestExtractor({"test": "config"})


def test_extractor_initialization(extractor):
    """Test extractor initialization."""
    assert extractor.config == {"test": "config"}
    assert isinstance(extractor.spark, SparkSession)


def test_extract_method(extractor):
    """Test extract method."""
    data = extractor.extract()
    assert isinstance(data, DataFrame)
    assert data.count() == 2
    assert data.columns == ["id", "value"]


def test_to_pandas_conversion(extractor):
    """Test conversion to pandas DataFrame."""
    data = extractor.extract()
    pandas_df = extractor.to_pandas(data)
    assert pandas_df.shape == (2, 2)
    assert list(pandas_df.columns) == ["id", "value"]


def test_to_spark_conversion(extractor):
    """Test conversion to Spark DataFrame."""
    import pandas as pd

    pandas_df = pd.DataFrame({"id": [1, 2], "value": ["test", "data"]})
    spark_df = extractor.to_spark(pandas_df)
    assert isinstance(spark_df, DataFrame)
    assert spark_df.count() == 2
    assert spark_df.columns == ["id", "value"]


def test_validate_config():
    """Test configuration validation."""
    extractor = TestExtractor({"required_key": "value"})
    extractor.validate_config(["required_key"])  # Should not raise an exception

    with pytest.raises(ValueError):
        extractor.validate_config(["missing_key"])


def test_cleanup(extractor):
    """Test cleanup method."""
    extractor.cleanup()  # Should not raise an exception 