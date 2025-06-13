import pandas as pd
from typing import Union, Optional
import json
import requests
from sqlalchemy import create_engine, text


def extract_csv(path: str, **kwargs) -> pd.DataFrame:
    """Extract data from a CSV file.

    Args:
        path (str): Path to the CSV file
        **kwargs: Additional arguments to pass to pd.read_csv

    Returns:
        pd.DataFrame: Extracted data
    """
    return pd.read_csv(path, **kwargs)


def extract_json(path: str, **kwargs) -> pd.DataFrame:
    """Extract data from a JSON file.

    Args:
        path (str): Path to the JSON file
        **kwargs: Additional arguments to pass to pd.read_json

    Returns:
        pd.DataFrame: Extracted data
    """
    return pd.read_json(path, **kwargs)


def extract_api(url: str, params: Optional[dict] = None, **kwargs) -> pd.DataFrame:
    """Extract data from an API endpoint.

    Args:
        url (str): API endpoint URL
        params (Optional[dict]): Query parameters
        **kwargs: Additional arguments to pass to requests.get

    Returns:
        pd.DataFrame: Extracted data
    """
    response = requests.get(url, params=params, **kwargs)
    response.raise_for_status()
    return pd.DataFrame(response.json())


def extract_sql(query: str, db_url: str, **kwargs) -> pd.DataFrame:
    """Extract data from a SQL database.

    Args:
        query (str): SQL query to execute
        db_url (str): Database connection URL
        **kwargs: Additional arguments to pass to pd.read_sql

    Returns:
        pd.DataFrame: Extracted data
    """
    engine = create_engine(db_url)
    return pd.read_sql(query, engine, **kwargs)


def extract_data(source: Union[str, dict], **kwargs) -> pd.DataFrame:
    """Extract data from various sources.

    Args:
        source (Union[str, dict]): Source configuration or path
        **kwargs: Additional arguments for the specific extractor

    Returns:
        pd.DataFrame: Extracted data
    """
    if isinstance(source, str):
        # If source is a string, assume it's a file path
        if source.endswith('.csv'):
            return extract_csv(source, **kwargs)
        elif source.endswith('.json'):
            return extract_json(source, **kwargs)
        else:
            raise ValueError(f"Unsupported file format: {source}")
    
    elif isinstance(source, dict):
        # If source is a dict, it should contain source configuration
        source_type = source.get('type', '').lower()
        
        if source_type == 'csv':
            return extract_csv(source['path'], **kwargs)
        elif source_type == 'json':
            return extract_json(source['path'], **kwargs)
        elif source_type == 'api':
            return extract_api(source['url'], source.get('params'), **kwargs)
        elif source_type == 'sql':
            return extract_sql(source['query'], source['db_url'], **kwargs)
        else:
            raise ValueError(f"Unsupported source type: {source_type}")
    
    else:
        raise ValueError("Source must be either a string (file path) or a dictionary (source configuration)") 