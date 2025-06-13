"""
Data Transformation Module

This module provides functions for transforming data:
- Data cleaning (handling missing values, duplicates)
- Data aggregation
- Data filtering
- Date transformations
- Data normalization

Each function is designed to handle specific transformation tasks
and returns a pandas DataFrame with the transformed data.
"""

import pandas as pd
import numpy as np
from typing import Dict, Any, Union, List
import logging

# Configure logger
logger = logging.getLogger(__name__)

def transform_data(df: pd.DataFrame, transformations: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Main function to transform data based on provided configuration.
    
    Args:
        df (pd.DataFrame): Input DataFrame to transform
        transformations (List[Dict[str, Any]]): List of transformation configurations
    
    Returns:
        pd.DataFrame: Transformed DataFrame
    """
    for transform_config in transformations:
        transform_type = transform_config['type']
        params = transform_config.get('params', {})
        
        logger.info(f"Applying transformation: {transform_type}")
        
        if transform_type == 'clean':
            df = clean_data(df, **params)
        elif transform_type == 'aggregate':
            df = aggregate_data(df, **params)
        elif transform_type == 'filter':
            df = filter_data(df, **params)
        elif transform_type == 'transform_dates':
            df = transform_dates(df, **params)
        elif transform_type == 'normalize':
            df = normalize_data(df, **params)
        else:
            raise ValueError(f"Unsupported transformation type: {transform_type}")
    
    return df

def clean_data(df: pd.DataFrame, drop_na: bool = False, 
               drop_duplicates: bool = False, fill_na: Dict = None,
               rename_cols: Dict = None) -> pd.DataFrame:
    """
    Clean data by handling missing values and duplicates.
    
    Args:
        df (pd.DataFrame): Input DataFrame
        drop_na (bool): Whether to drop rows with missing values
        drop_duplicates (bool): Whether to drop duplicate rows
        fill_na (Dict): Dictionary of values to fill missing values
        rename_cols (Dict): Dictionary to rename columns
    
    Returns:
        pd.DataFrame: Cleaned DataFrame
    """
    if drop_na:
        df = df.dropna()
    
    if drop_duplicates:
        df = df.drop_duplicates()
    
    if fill_na:
        df = df.fillna(fill_na)
    
    if rename_cols:
        df = df.rename(columns=rename_cols)
    
    return df

def aggregate_data(df: pd.DataFrame, group_cols: Union[str, List[str]],
                  agg_cols: Union[str, List[str]], 
                  agg_funcs: Union[str, List[str], Dict] = 'sum') -> pd.DataFrame:
    """
    Aggregate data by grouping and applying aggregation functions.
    
    Args:
        df (pd.DataFrame): Input DataFrame
        group_cols (Union[str, List[str]]): Column(s) to group by
        agg_cols (Union[str, List[str]]): Column(s) to aggregate
        agg_funcs (Union[str, List[str], Dict]): Aggregation function(s)
    
    Returns:
        pd.DataFrame: Aggregated DataFrame
    """
    if isinstance(group_cols, str):
        group_cols = [group_cols]
    if isinstance(agg_cols, str):
        agg_cols = [agg_cols]
    
    agg_dict = {col: agg_funcs for col in agg_cols}
    return df.groupby(group_cols).agg(agg_dict).reset_index()

def filter_data(df: pd.DataFrame, conditions: Union[str, List[str]]) -> pd.DataFrame:
    """
    Filter data based on conditions.
    
    Args:
        df (pd.DataFrame): Input DataFrame
        conditions (Union[str, List[str]]): Filter condition(s)
    
    Returns:
        pd.DataFrame: Filtered DataFrame
    """
    if isinstance(conditions, str):
        conditions = [conditions]
    
    for condition in conditions:
        df = df.query(condition)
    
    return df

def transform_dates(df: pd.DataFrame, date_col: str, 
                   format: str = None) -> pd.DataFrame:
    """
    Transform date columns to datetime format.
    
    Args:
        df (pd.DataFrame): Input DataFrame
        date_col (str): Date column to transform
        format (str): Date format string
    
    Returns:
        pd.DataFrame: DataFrame with transformed dates
    """
    if format:
        df[date_col] = pd.to_datetime(df[date_col], format=format)
    else:
        df[date_col] = pd.to_datetime(df[date_col])
    
    return df

def normalize_data(df: pd.DataFrame, columns: Union[str, List[str]],
                  method: str = 'min-max') -> pd.DataFrame:
    """
    Normalize numerical data using specified method.
    
    Args:
        df (pd.DataFrame): Input DataFrame
        columns (Union[str, List[str]]): Column(s) to normalize
        method (str): Normalization method ('min-max' or 'z-score')
    
    Returns:
        pd.DataFrame: DataFrame with normalized columns
    """
    if isinstance(columns, str):
        columns = [columns]
    
    for col in columns:
        if method == 'min-max':
            df[col] = (df[col] - df[col].min()) / (df[col].max() - df[col].min())
        elif method == 'z-score':
            df[col] = (df[col] - df[col].mean()) / df[col].std()
        else:
            raise ValueError(f"Unsupported normalization method: {method}")
    
    return df 