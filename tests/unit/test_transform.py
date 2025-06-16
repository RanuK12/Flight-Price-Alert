# Forced change to ensure Git detects the file as modified.

"""
Unit tests for the transform module.
"""

import pytest
import pandas as pd
from src.transform import clean_data, aggregate_data, filter_data, transform_dates, normalize_data

# Sample DataFrame for testing
def sample_df():
    return pd.DataFrame({
        'id': [1, 2, 2, 3, 4],
        'value': [10, 20, 20, None, 40],
        'date': ['2023-01-01', '2023-01-02', '2023-01-02', '2023-01-03', '2023-01-04'],
        'category': ['A', 'B', 'B', 'A', 'C']
    })

def test_clean_data_drop_na():
    # Test dropping rows with missing values.
    df = sample_df()
    cleaned = clean_data(df, drop_na=True)
    assert cleaned.isnull().sum().sum() == 0
    assert len(cleaned) == 4

def test_clean_data_drop_duplicates():
    # Test dropping duplicate rows.
    df = sample_df()
    cleaned = clean_data(df, drop_duplicates=True)
    assert len(cleaned) < len(df)

def test_clean_data_fill_na():
    # Test filling missing values.
    df = sample_df()
    cleaned = clean_data(df, fill_na={'value': 0})
    assert cleaned['value'].isnull().sum() == 0
    assert 0 in cleaned['value'].values

def test_clean_data_rename_cols():
    # Test renaming columns.
    df = sample_df()
    cleaned = clean_data(df, rename_cols={'value': 'amount'})
    assert 'amount' in cleaned.columns

def test_aggregate_data():
    # Test aggregation by group.
    df = sample_df()
    agg = aggregate_data(df, group_cols='category', agg_cols='value', agg_funcs='sum')
    assert 'value' in agg.columns
    assert 'category' in agg.columns

def test_filter_data():
    # Test filtering data with a condition.
    df = sample_df()
    filtered = filter_data(df, conditions="value > 15")
    assert all(filtered['value'] > 15)

def test_transform_dates():
    # Test transforming date column to datetime.
    df = sample_df()
    transformed = transform_dates(df, date_col='date')
    assert pd.api.types.is_datetime64_any_dtype(transformed['date'])

def test_normalize_data_min_max():
    # Test min-max normalization.
    df = sample_df().fillna(0)
    norm = normalize_data(df, columns='value', method='min-max')
    assert norm['value'].min() == 0
    assert norm['value'].max() == 1

def test_normalize_data_z_score():
    # Test z-score normalization.
    df = sample_df().fillna(0)
    norm = normalize_data(df, columns='value', method='z-score')
    # Mean should be close to 0, std close to 1
    assert abs(norm['value'].mean()) < 1e-6
    assert abs(norm['value'].std() - 1) < 1e-6

def test_forced_change():
    """Test to force a significant change in the file."""
    assert True 