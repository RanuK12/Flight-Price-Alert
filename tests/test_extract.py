import unittest
import pandas as pd
import os
import json
from src.extract import extract_data


class TestExtract(unittest.TestCase):
    """Test cases for extract module."""

    def setUp(self):
        """Set up test data and files."""
        # Create test CSV file
        self.csv_data = pd.DataFrame({
            'id': [1, 2, 3],
            'name': ['John', 'Jane', 'Bob'],
            'age': [30, 25, 35]
        })
        self.csv_path = 'test_data.csv'
        self.csv_data.to_csv(self.csv_path, index=False)

        # Create test JSON file
        self.json_data = [
            {'id': 1, 'name': 'John', 'age': 30},
            {'id': 2, 'name': 'Jane', 'age': 25},
            {'id': 3, 'name': 'Bob', 'age': 35}
        ]
        self.json_path = 'test_data.json'
        with open(self.json_path, 'w') as f:
            json.dump(self.json_data, f)

    def tearDown(self):
        """Clean up test files."""
        if os.path.exists(self.csv_path):
            os.remove(self.csv_path)
        if os.path.exists(self.json_path):
            os.remove(self.json_path)

    def test_extract_csv(self):
        """Test extracting data from CSV file."""
        config = {
            'type': 'csv',
            'path': self.csv_path
        }
        df = extract_data(config)
        self.assertIsInstance(df, pd.DataFrame)
        self.assertEqual(len(df), 3)
        self.assertEqual(list(df.columns), ['id', 'name', 'age'])

    def test_extract_json(self):
        """Test extracting data from JSON file."""
        config = {
            'type': 'json',
            'path': self.json_path
        }
        df = extract_data(config)
        self.assertIsInstance(df, pd.DataFrame)
        self.assertEqual(len(df), 3)
        self.assertEqual(list(df.columns), ['id', 'name', 'age'])

    def test_extract_api(self):
        """Test extracting data from API."""
        config = {
            'type': 'api',
            'url': 'https://jsonplaceholder.typicode.com/users',
            'params': {'_limit': 3}
        }
        df = extract_data(config)
        self.assertIsInstance(df, pd.DataFrame)
        self.assertEqual(len(df), 3)
        self.assertIn('id', df.columns)
        self.assertIn('name', df.columns)

    def test_extract_sql(self):
        """Test extracting data from SQL database."""
        # This test requires a database connection
        # You might want to mock the database connection or use a test database
        pass

    def test_invalid_source_type(self):
        """Test handling of invalid source type."""
        config = {
            'type': 'invalid_type',
            'path': 'dummy_path'
        }
        with self.assertRaises(ValueError):
            extract_data(config)

    def test_missing_file(self):
        """Test handling of missing file."""
        config = {
            'type': 'csv',
            'path': 'nonexistent_file.csv'
        }
        with self.assertRaises(FileNotFoundError):
            extract_data(config)


if __name__ == '__main__':
    unittest.main() 