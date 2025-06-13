"""
Unit tests for the extract module.
"""

import pytest
import pandas as pd
import os
from src.extract import extract_data, _extract_csv, _extract_json, _extract_api, _extract_sql
import json

# Test data
TEST_CSV = "tests/data/test.csv"
TEST_JSON = "tests/data/test.json"
TEST_API_URL = "https://api.example.com/data"
TEST_DB_CONN = "postgresql://user:pass@localhost:5432/testdb"

@pytest.fixture
def sample_csv():
    """Create a sample CSV file for testing."""
    df = pd.DataFrame({
        'id': [1, 2, 3],
        'name': ['John', 'Jane', 'Bob'],
        'age': [30, 25, 35]
    })
    os.makedirs(os.path.dirname(TEST_CSV), exist_ok=True)
    df.to_csv(TEST_CSV, index=False)
    return TEST_CSV

@pytest.fixture
def sample_json():
    """Create a sample JSON file for testing."""
    data = {
        'data': [
            {'id': 1, 'name': 'John', 'age': 30},
            {'id': 2, 'name': 'Jane', 'age': 25},
            {'id': 3, 'name': 'Bob', 'age': 35}
        ]
    }
    os.makedirs(os.path.dirname(TEST_JSON), exist_ok=True)
    with open(TEST_JSON, 'w') as f:
        json.dump(data, f)
    return TEST_JSON

def test_extract_csv(sample_csv):
    """Test CSV extraction."""
    config = {'path': sample_csv}
    df = _extract_csv(config)
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 3
    assert list(df.columns) == ['id', 'name', 'age']

def test_extract_json(sample_json):
    """Test JSON extraction."""
    config = {'path': sample_json}
    df = _extract_json(config)
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 3
    assert list(df.columns) == ['id', 'name', 'age']

def test_extract_api(mocker):
    """Test API extraction."""
    mock_response = mocker.Mock()
    mock_response.json.return_value = {
        'data': [
            {'id': 1, 'name': 'John', 'age': 30},
            {'id': 2, 'name': 'Jane', 'age': 25}
        ]
    }
    mocker.patch('requests.request', return_value=mock_response)
    
    config = {'url': TEST_API_URL}
    df = _extract_api(config)
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 2
    assert list(df.columns) == ['id', 'name', 'age']

def test_extract_sql(mocker):
    """Test SQL extraction."""
    mock_engine = mocker.Mock()
    mock_df = pd.DataFrame({
        'id': [1, 2],
        'name': ['John', 'Jane'],
        'age': [30, 25]
    })
    mocker.patch('sqlalchemy.create_engine', return_value=mock_engine)
    mocker.patch('pandas.read_sql', return_value=mock_df)
    
    config = {'connection_string': TEST_DB_CONN, 'query': "SELECT * FROM users"}
    df = _extract_sql(config)
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 2
    assert list(df.columns) == ['id', 'name', 'age']

def test_extract_data_invalid_source():
    """Test extraction with invalid source."""
    config = {'type': 'invalid_source'}
    with pytest.raises(ValueError):
        extract_data(config)

def test_cleanup(sample_csv, sample_json):
    """Clean up test files."""
    os.remove(sample_csv)
    os.remove(sample_json) 