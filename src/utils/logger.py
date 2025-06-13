import logging
import os
from datetime import datetime
from typing import Optional

from pythonjsonlogger import jsonlogger


def setup_logger(
    name: str,
    log_level: str = "INFO",
    log_file: Optional[str] = None,
    json_format: bool = True,
) -> logging.Logger:
    """Set up a logger with the specified configuration.

    Args:
        name (str): Name of the logger
        log_level (str, optional): Logging level. Defaults to "INFO".
        log_file (Optional[str], optional): Path to log file. Defaults to None.
        json_format (bool, optional): Whether to use JSON format. Defaults to True.

    Returns:
        logging.Logger: Configured logger instance
    """
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, log_level.upper()))

    # Create formatters
    if json_format:
        formatter = jsonlogger.JsonFormatter(
            "%(asctime)s %(name)s %(levelname)s %(message)s"
        )
    else:
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )

    # Add console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # Add file handler if log_file is specified
    if log_file:
        # Create logs directory if it doesn't exist
        log_dir = os.path.dirname(log_file)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir)

        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    return logger


def get_default_logger() -> logging.Logger:
    """Get a default logger instance.

    Returns:
        logging.Logger: Default logger instance
    """
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(log_dir, f"pipeline_{timestamp}.log")

    return setup_logger(
        name="etl_pipeline",
        log_level="INFO",
        log_file=log_file,
        json_format=True,
    ) 