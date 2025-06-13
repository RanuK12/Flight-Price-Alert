import os
from typing import Any, Dict, Optional

from dotenv import load_dotenv


def load_config(env_file: Optional[str] = None) -> Dict[str, Any]:
    """Load configuration from environment variables and .env file.

    Args:
        env_file (Optional[str], optional): Path to .env file. Defaults to None.

    Returns:
        Dict[str, Any]: Configuration dictionary
    """
    # Load environment variables from .env file if specified
    if env_file and os.path.exists(env_file):
        load_dotenv(env_file)
    else:
        # Try to load from default .env file
        load_dotenv()

    config = {
        # Airflow Configuration
        "airflow": {
            "home": os.getenv("AIRFLOW_HOME", "./airflow"),
            "load_examples": os.getenv("AIRFLOW__CORE__LOAD_EXAMPLES", "False").lower() == "true",
            "executor": os.getenv("AIRFLOW__CORE__EXECUTOR", "LocalExecutor"),
            "sql_alchemy_conn": os.getenv(
                "AIRFLOW__CORE__SQL_ALCHEMY_CONN",
                "postgresql+psycopg2://airflow:airflow@localhost:5432/airflow",
            ),
            "fernet_key": os.getenv("AIRFLOW__CORE__FERNET_KEY", ""),
        },
        # Database Configuration
        "postgres": {
            "host": os.getenv("POSTGRES_HOST", "localhost"),
            "port": int(os.getenv("POSTGRES_PORT", "5432")),
            "db": os.getenv("POSTGRES_DB", ""),
            "user": os.getenv("POSTGRES_USER", ""),
            "password": os.getenv("POSTGRES_PASSWORD", ""),
        },
        "mongodb": {
            "uri": os.getenv("MONGODB_URI", "mongodb://localhost:27017/"),
            "db": os.getenv("MONGODB_DB", ""),
        },
        "mysql": {
            "host": os.getenv("MYSQL_HOST", "localhost"),
            "port": int(os.getenv("MYSQL_PORT", "3306")),
            "db": os.getenv("MYSQL_DB", ""),
            "user": os.getenv("MYSQL_USER", ""),
            "password": os.getenv("MYSQL_PASSWORD", ""),
        },
        # API Configuration
        "api": {
            "key": os.getenv("API_KEY", ""),
            "secret": os.getenv("API_SECRET", ""),
            "base_url": os.getenv("API_BASE_URL", ""),
        },
        # Data Storage Configuration
        "data": {
            "raw_path": os.getenv("RAW_DATA_PATH", "./data/raw"),
            "processed_path": os.getenv("PROCESSED_DATA_PATH", "./data/processed"),
            "final_path": os.getenv("FINAL_DATA_PATH", "./data/final"),
        },
        # Logging Configuration
        "logging": {
            "level": os.getenv("LOG_LEVEL", "INFO"),
            "file": os.getenv("LOG_FILE", "./logs/pipeline.log"),
        },
        # Monitoring Configuration
        "monitoring": {
            "prometheus_port": int(os.getenv("PROMETHEUS_PORT", "9090")),
            "grafana_port": int(os.getenv("GRAFANA_PORT", "3000")),
        },
        # Spark Configuration
        "spark": {
            "master": os.getenv("SPARK_MASTER", "local[*]"),
            "driver_memory": os.getenv("SPARK_DRIVER_MEMORY", "4g"),
            "executor_memory": os.getenv("SPARK_EXECUTOR_MEMORY", "2g"),
            "executor_cores": int(os.getenv("SPARK_EXECUTOR_CORES", "2")),
        },
        # Email Configuration
        "email": {
            "smtp_server": os.getenv("SMTP_SERVER", ""),
            "smtp_port": int(os.getenv("SMTP_PORT", "587")),
            "smtp_user": os.getenv("SMTP_USER", ""),
            "smtp_password": os.getenv("SMTP_PASSWORD", ""),
            "notification_email": os.getenv("NOTIFICATION_EMAIL", ""),
        },
    }

    return config


def get_config_value(config: Dict[str, Any], key_path: str, default: Any = None) -> Any:
    """Get a configuration value using dot notation.

    Args:
        config (Dict[str, Any]): Configuration dictionary
        key_path (str): Path to the configuration value (e.g., "postgres.host")
        default (Any, optional): Default value if key is not found. Defaults to None.

    Returns:
        Any: Configuration value
    """
    keys = key_path.split(".")
    value = config

    for key in keys:
        if isinstance(value, dict) and key in value:
            value = value[key]
        else:
            return default

    return value 