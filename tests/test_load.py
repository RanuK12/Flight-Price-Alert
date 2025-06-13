import unittest
import pandas as pd
import os
import json
from src.load import load_data


class TestLoad(unittest.TestCase):
    """Test cases for load module."""

    def setUp(self):
        """Set up test data."""
        self.df = pd.DataFrame({
            'id': [1, 2, 3],
            'name': ['John', 'Jane', 'Bob'],
            'age': [30, 25, 35]
        })
        self.test_dir = 'test_output'
        if not os.path.exists(self.test_dir):
            os.makedirs(self.test_dir)

    def tearDown(self):
        """Clean up test files and directories."""
        for file in os.listdir(self.test_dir):
            os.remove(os.path.join(self.test_dir, file))
        os.rmdir(self.test_dir)

    def test_load_csv(self):
        """Test loading data to CSV file."""
        config = {
            'type': 'csv',
            'path': os.path.join(self.test_dir, 'output.csv')
        }
        load_data(self.df, config)
        self.assertTrue(os.path.exists(config['path']))
        loaded_df = pd.read_csv(config['path'])
        pd.testing.assert_frame_equal(self.df, loaded_df)

    def test_load_json(self):
        """Test loading data to JSON file."""
        config = {
            'type': 'json',
            'path': os.path.join(self.test_dir, 'output.json')
        }
        load_data(self.df, config)
        self.assertTrue(os.path.exists(config['path']))
        loaded_df = pd.read_json(config['path'])
        pd.testing.assert_frame_equal(self.df, loaded_df)

    def test_load_parquet(self):
        """Test loading data to Parquet file."""
        config = {
            'type': 'parquet',
            'path': os.path.join(self.test_dir, 'output.parquet')
        }
        load_data(self.df, config)
        self.assertTrue(os.path.exists(config['path']))
        loaded_df = pd.read_parquet(config['path'])
        pd.testing.assert_frame_equal(self.df, loaded_df)

    def test_load_db(self):
        """Test loading data to database."""
        # This test requires a database connection
        # You might want to mock the database connection or use a test database
        pass

    def test_invalid_destination_type(self):
        """Test handling of invalid destination type."""
        config = {
            'type': 'invalid_type',
            'path': 'dummy_path'
        }
        with self.assertRaises(ValueError):
            load_data(self.df, config)

    def test_create_directory(self):
        """Test creating directory if it doesn't exist."""
        new_dir = os.path.join(self.test_dir, 'subdir')
        config = {
            'type': 'csv',
            'path': os.path.join(new_dir, 'output.csv')
        }
        load_data(self.df, config)
        self.assertTrue(os.path.exists(new_dir))
        self.assertTrue(os.path.exists(config['path']))

    def test_overwrite_existing_file(self):
        """Test overwriting existing file."""
        config = {
            'type': 'csv',
            'path': os.path.join(self.test_dir, 'output.csv')
        }
        # First load
        load_data(self.df, config)
        # Modify dataframe
        modified_df = self.df.copy()
        modified_df.loc[0, 'age'] = 31
        # Second load (should overwrite)
        load_data(modified_df, config)
        loaded_df = pd.read_csv(config['path'])
        pd.testing.assert_frame_equal(modified_df, loaded_df)


if __name__ == '__main__':
    unittest.main() 