"""
Data Loading Module

This module provides functions for loading data into various destinations:
- Databases (PostgreSQL, MySQL, etc.)
- CSV files
- JSON files
- Parquet files

Each function is designed to handle specific destination types
and includes error handling and logging.
"""

import pandas as pd
import json
import os
from typing import Dict, Any, Union
from sqlalchemy import create_engine
import logging

# Configure logger
logger = logging.getLogger(__name__)

def load_data(df: pd.DataFrame, destination: str, **kwargs) -> None:
    """
    Main function to load data into specified destination.
    
    Args:
        df (pd.DataFrame): Data to load
        destination (str): Destination type (db, csv, json, parquet)
        **kwargs: Additional arguments for specific loaders
    """
    logger.info(f"Loading data to {destination}")
    
    if destination == 'db':
        load_to_db(df, **kwargs)
    elif destination == 'csv':
        load_to_csv(df, **kwargs)
    elif destination == 'json':
        load_to_json(df, **kwargs)
    elif destination == 'parquet':
        load_to_parquet(df, **kwargs)
    else:
        raise ValueError(f"Unsupported destination type: {destination}")

def load_to_db(df: pd.DataFrame, connection_string: str, 
               table_name: str, if_exists: str = 'replace') -> None:
    """
    Load data into a database table.
    
    Args:
        df (pd.DataFrame): Data to load
        connection_string (str): Database connection string
        table_name (str): Target table name
        if_exists (str): How to behave if table exists
    """
    try:
        engine = create_engine(connection_string)
        df.to_sql(table_name, engine, if_exists=if_exists, index=False)
        logger.info(f"Successfully loaded data to {table_name}")
    except Exception as e:
        logger.error(f"Error loading data to database: {str(e)}")
        raise

def load_to_csv(df: pd.DataFrame, filepath: str, **kwargs) -> None:
    """
    Load data to a CSV file.
    
    Args:
        df (pd.DataFrame): Data to load
        filepath (str): Path to output file
        **kwargs: Additional arguments for pd.to_csv()
    """
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        df.to_csv(filepath, index=False, **kwargs)
        logger.info(f"Successfully loaded data to {filepath}")
    except Exception as e:
        logger.error(f"Error loading data to CSV: {str(e)}")
        raise

def load_to_json(df: pd.DataFrame, filepath: str, 
                orient: str = 'records', **kwargs) -> None:
    """
    Load data to a JSON file.
    
    Args:
        df (pd.DataFrame): Data to load
        filepath (str): Path to output file
        orient (str): JSON orientation
        **kwargs: Additional arguments for pd.to_json()
    """
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        df.to_json(filepath, orient=orient, **kwargs)
        logger.info(f"Successfully loaded data to {filepath}")
    except Exception as e:
        logger.error(f"Error loading data to JSON: {str(e)}")
        raise

def load_to_parquet(df: pd.DataFrame, filepath: str, **kwargs) -> None:
    """
    Load data to a Parquet file.
    
    Args:
        df (pd.DataFrame): Data to load
        filepath (str): Path to output file
        **kwargs: Additional arguments for pd.to_parquet()
    """
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        df.to_parquet(filepath, index=False, **kwargs)
        logger.info(f"Successfully loaded data to {filepath}")
    except Exception as e:
        logger.error(f"Error loading data to Parquet: {str(e)}")
        raise 