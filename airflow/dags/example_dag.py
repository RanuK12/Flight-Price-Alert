from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator

from src.extractors.base_extractor import BaseExtractor
from src.transformers.base_transformer import BaseTransformer
from src.loaders.base_loader import BaseLoader
from src.utils.config import load_config
from src.utils.logger import get_default_logger

# Load configuration and setup logger
config = load_config()
logger = get_default_logger()

# Define default arguments
default_args = {
    "owner": "airflow",
    "depends_on_past": False,
    "email": [config["email"]["notification_email"]],
    "email_on_failure": True,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

# Define the DAG
dag = DAG(
    "example_etl_pipeline",
    default_args=default_args,
    description="Example ETL pipeline using Airflow",
    schedule_interval=timedelta(days=1),
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=["example", "etl"],
)


def extract_data(**context):
    """Extract data from source."""
    logger.info("Starting data extraction")
    # Initialize your extractor here
    # extractor = YourExtractor(config)
    # data = extractor.extract()
    logger.info("Data extraction completed")


def transform_data(**context):
    """Transform extracted data."""
    logger.info("Starting data transformation")
    # Initialize your transformer here
    # transformer = YourTransformer(config)
    # transformed_data = transformer.transform(data)
    logger.info("Data transformation completed")


def load_data(**context):
    """Load transformed data to destination."""
    logger.info("Starting data loading")
    # Initialize your loader here
    # loader = YourLoader(config)
    # loader.load(transformed_data)
    logger.info("Data loading completed")


# Define tasks
extract_task = PythonOperator(
    task_id="extract_data",
    python_callable=extract_data,
    provide_context=True,
    dag=dag,
)

transform_task = PythonOperator(
    task_id="transform_data",
    python_callable=transform_data,
    provide_context=True,
    dag=dag,
)

load_task = PythonOperator(
    task_id="load_data",
    python_callable=load_data,
    provide_context=True,
    dag=dag,
)

# Define task dependencies
extract_task >> transform_task >> load_task 