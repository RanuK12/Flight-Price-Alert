import pandas as pd
import numpy as np
from typing import List, Union, Dict, Optional
from datetime import datetime


def clean_data(df: pd.DataFrame, 
              drop_na: bool = True,
              drop_duplicates: bool = True,
              fill_na: Optional[Dict] = None,
              rename_cols: Optional[Dict] = None) -> pd.DataFrame:
    """Clean and preprocess the data.

    Args:
        df (pd.DataFrame): Input DataFrame
        drop_na (bool, optional): Whether to drop rows with NA values. Defaults to True.
        drop_duplicates (bool, optional): Whether to drop duplicate rows. Defaults to True.
        fill_na (Optional[Dict], optional): Dictionary of column-value pairs for filling NA. Defaults to None.
        rename_cols (Optional[Dict], optional): Dictionary for renaming columns. Defaults to None.

    Returns:
        pd.DataFrame: Cleaned DataFrame
    """
    df = df.copy()

    # Rename columns if specified
    if rename_cols:
        df = df.rename(columns=rename_cols)

    # Fill NA values if specified
    if fill_na:
        df = df.fillna(fill_na)

    # Drop NA values if specified
    if drop_na:
        df = df.dropna()

    # Drop duplicates if specified
    if drop_duplicates:
        df = df.drop_duplicates()

    return df


def aggregate_data(df: pd.DataFrame,
                  group_cols: Union[str, List[str]],
                  agg_cols: Union[str, List[str]],
                  agg_funcs: Union[str, List[str], Dict] = 'sum') -> pd.DataFrame:
    """Aggregate data by grouping columns.

    Args:
        df (pd.DataFrame): Input DataFrame
        group_cols (Union[str, List[str]]): Column(s) to group by
        agg_cols (Union[str, List[str]]): Column(s) to aggregate
        agg_funcs (Union[str, List[str], Dict], optional): Aggregation function(s). Defaults to 'sum'.

    Returns:
        pd.DataFrame: Aggregated DataFrame
    """
    # Convert single values to lists
    if isinstance(group_cols, str):
        group_cols = [group_cols]
    if isinstance(agg_cols, str):
        agg_cols = [agg_cols]

    # Create aggregation dictionary
    if isinstance(agg_funcs, (str, list)):
        agg_dict = {col: agg_funcs for col in agg_cols}
    else:
        agg_dict = agg_funcs

    # Perform aggregation
    return df.groupby(group_cols).agg(agg_dict).reset_index()


def filter_data(df: pd.DataFrame,
               conditions: Union[str, List[str]]) -> pd.DataFrame:
    """Filter data based on conditions.

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


def transform_dates(df: pd.DataFrame,
                   date_cols: Union[str, List[str]],
                   format: Optional[str] = None) -> pd.DataFrame:
    """Transform date columns to datetime format.

    Args:
        df (pd.DataFrame): Input DataFrame
        date_cols (Union[str, List[str]]): Date column(s) to transform
        format (Optional[str], optional): Date format string. Defaults to None.

    Returns:
        pd.DataFrame: DataFrame with transformed dates
    """
    df = df.copy()
    
    if isinstance(date_cols, str):
        date_cols = [date_cols]
    
    for col in date_cols:
        df[col] = pd.to_datetime(df[col], format=format)
    
    return df


def normalize_data(df: pd.DataFrame,
                  cols: Union[str, List[str]],
                  method: str = 'min-max') -> pd.DataFrame:
    """Normalize numerical columns.

    Args:
        df (pd.DataFrame): Input DataFrame
        cols (Union[str, List[str]]): Column(s) to normalize
        method (str, optional): Normalization method ('min-max' or 'z-score'). Defaults to 'min-max'.

    Returns:
        pd.DataFrame: DataFrame with normalized columns
    """
    df = df.copy()
    
    if isinstance(cols, str):
        cols = [cols]
    
    for col in cols:
        if method == 'min-max':
            df[col] = (df[col] - df[col].min()) / (df[col].max() - df[col].min())
        elif method == 'z-score':
            df[col] = (df[col] - df[col].mean()) / df[col].std()
        else:
            raise ValueError(f"Unsupported normalization method: {method}")
    
    return df


def transform_data(df: pd.DataFrame,
                  transformations: List[Dict]) -> pd.DataFrame:
    """Apply a series of transformations to the data.

    Args:
        df (pd.DataFrame): Input DataFrame
        transformations (List[Dict]): List of transformation configurations

    Returns:
        pd.DataFrame: Transformed DataFrame
    """
    for transform in transformations:
        transform_type = transform.get('type', '').lower()
        
        if transform_type == 'clean':
            df = clean_data(df, **transform.get('params', {}))
        elif transform_type == 'aggregate':
            df = aggregate_data(df, **transform.get('params', {}))
        elif transform_type == 'filter':
            df = filter_data(df, **transform.get('params', {}))
        elif transform_type == 'dates':
            df = transform_dates(df, **transform.get('params', {}))
        elif transform_type == 'normalize':
            df = normalize_data(df, **transform.get('params', {}))
        else:
            raise ValueError(f"Unsupported transformation type: {transform_type}")
    
    return df 