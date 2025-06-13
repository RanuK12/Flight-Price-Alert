import pandas as pd
from sqlalchemy import create_engine, text
from typing import Optional, Union, Dict
import json
import os


def load_to_db(df: pd.DataFrame,
              table_name: str,
              db_url: str,
              if_exists: str = 'replace',
              schema: Optional[str] = None,
              **kwargs) -> None:
    """Load data to a database table.

    Args:
        df (pd.DataFrame): Data to load
        table_name (str): Target table name
        db_url (str): Database connection URL
        if_exists (str, optional): How to behave if table exists. Defaults to 'replace'.
        schema (Optional[str], optional): Database schema. Defaults to None.
        **kwargs: Additional arguments to pass to pd.to_sql
    """
    engine = create_engine(db_url)
    
    if schema:
        table_name = f"{schema}.{table_name}"
    
    df.to_sql(table_name, engine, if_exists=if_exists, **kwargs)


def load_to_csv(df: pd.DataFrame,
               path: str,
               **kwargs) -> None:
    """Load data to a CSV file.

    Args:
        df (pd.DataFrame): Data to load
        path (str): Output file path
        **kwargs: Additional arguments to pass to pd.to_csv
    """
    # Create directory if it doesn't exist
    os.makedirs(os.path.dirname(path), exist_ok=True)
    
    df.to_csv(path, **kwargs)


def load_to_json(df: pd.DataFrame,
                path: str,
                orient: str = 'records',
                **kwargs) -> None:
    """Load data to a JSON file.

    Args:
        df (pd.DataFrame): Data to load
        path (str): Output file path
        orient (str, optional): JSON orientation. Defaults to 'records'.
        **kwargs: Additional arguments to pass to pd.to_json
    """
    # Create directory if it doesn't exist
    os.makedirs(os.path.dirname(path), exist_ok=True)
    
    df.to_json(path, orient=orient, **kwargs)


def load_to_parquet(df: pd.DataFrame,
                   path: str,
                   **kwargs) -> None:
    """Load data to a Parquet file.

    Args:
        df (pd.DataFrame): Data to load
        path (str): Output file path
        **kwargs: Additional arguments to pass to pd.to_parquet
    """
    # Create directory if it doesn't exist
    os.makedirs(os.path.dirname(path), exist_ok=True)
    
    df.to_parquet(path, **kwargs)


def load_data(df: pd.DataFrame,
             destination: Union[str, Dict],
             **kwargs) -> None:
    """Load data to various destinations.

    Args:
        df (pd.DataFrame): Data to load
        destination (Union[str, Dict]): Destination configuration or path
        **kwargs: Additional arguments for the specific loader
    """
    if isinstance(destination, str):
        # If destination is a string, determine type from extension
        if destination.endswith('.csv'):
            load_to_csv(df, destination, **kwargs)
        elif destination.endswith('.json'):
            load_to_json(df, destination, **kwargs)
        elif destination.endswith('.parquet'):
            load_to_parquet(df, destination, **kwargs)
        else:
            raise ValueError(f"Unsupported file format: {destination}")
    
    elif isinstance(destination, dict):
        # If destination is a dict, it should contain destination configuration
        dest_type = destination.get('type', '').lower()
        
        if dest_type == 'db':
            load_to_db(df, **destination.get('params', {}), **kwargs)
        elif dest_type == 'csv':
            load_to_csv(df, **destination.get('params', {}), **kwargs)
        elif dest_type == 'json':
            load_to_json(df, **destination.get('params', {}), **kwargs)
        elif dest_type == 'parquet':
            load_to_parquet(df, **destination.get('params', {}), **kwargs)
        else:
            raise ValueError(f"Unsupported destination type: {dest_type}")
    
    else:
        raise ValueError("Destination must be either a string (file path) or a dictionary (destination configuration)") 