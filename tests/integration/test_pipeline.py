import os
import pytest
from pyspark.sql import SparkSession

from src.extractors.base_extractor import BaseExtractor
from src.transformers.base_transformer import BaseTransformer
from src.loaders.base_loader import BaseLoader
from src.utils.config import load_config
from src.utils.logger import get_default_logger


class TestExtractor(BaseExtractor):
    """Test implementation of BaseExtractor."""

    def extract(self):
        """Return test data."""
        return self.spark.createDataFrame(
            [(1, "test", 100), (2, "data", 200)], ["id", "value", "amount"]
        )


class TestTransformer(BaseTransformer):
    """Test implementation of BaseTransformer."""

    def transform(self, data):
        """Transform test data."""
        return data.withColumn("amount_doubled", data.amount * 2)


class TestLoader(BaseLoader):
    """Test implementation of BaseLoader."""

    def load(self, data):
        """Save test data to a temporary file."""
        output_path = os.path.join(self.config["data"]["processed_path"], "test_output.parquet")
        data.write.parquet(output_path, mode="overwrite")


@pytest.fixture
def spark():
    """Create a SparkSession for testing."""
    return SparkSession.builder.master("local[1]").appName("test").getOrCreate()


@pytest.fixture
def config():
    """Load test configuration."""
    return load_config()


@pytest.fixture
def logger():
    """Create a test logger."""
    return get_default_logger()


@pytest.fixture
def extractor(spark, config):
    """Create a test extractor instance."""
    return TestExtractor(config)


@pytest.fixture
def transformer(spark, config):
    """Create a test transformer instance."""
    return TestTransformer(config)


@pytest.fixture
def loader(spark, config):
    """Create a test loader instance."""
    return TestLoader(config)


def test_full_pipeline(extractor, transformer, loader, config, logger):
    """Test the complete ETL pipeline."""
    try:
        # Extract
        logger.info("Starting data extraction")
        data = extractor.extract()
        assert data.count() == 2
        assert "amount" in data.columns

        # Transform
        logger.info("Starting data transformation")
        transformed_data = transformer.transform(data)
        assert transformed_data.count() == 2
        assert "amount_doubled" in transformed_data.columns
        assert transformed_data.select("amount_doubled").first()[0] == 200

        # Load
        logger.info("Starting data loading")
        loader.load(transformed_data)
        output_path = os.path.join(config["data"]["processed_path"], "test_output.parquet")
        assert os.path.exists(output_path)

        # Verify loaded data
        loaded_data = spark.read.parquet(output_path)
        assert loaded_data.count() == 2
        assert "amount_doubled" in loaded_data.columns
        assert loaded_data.select("amount_doubled").first()[0] == 200

        logger.info("Pipeline test completed successfully")

    except Exception as e:
        logger.error(f"Pipeline test failed: {str(e)}")
        raise

    finally:
        # Cleanup
        if os.path.exists(output_path):
            import shutil
            shutil.rmtree(output_path) 