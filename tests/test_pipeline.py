import unittest
import pandas as pd
import os
import json
from src.extract import extract_data
from src.transform import transform_data
from src.load import load_data


class TestPipeline(unittest.TestCase):
    """Integration tests for the complete ETL pipeline."""

    def setUp(self):
        """Set up test data and directories."""
        # Create test directories
        self.test_dir = 'test_pipeline'
        self.input_dir = os.path.join(self.test_dir, 'input')
        self.output_dir = os.path.join(self.test_dir, 'output')
        os.makedirs(self.input_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)

        # Create test input data
        self.input_data = pd.DataFrame({
            'id': [1, 2, 3, 4, 5],
            'name': ['John', 'Jane', 'Bob', 'Alice', 'Charlie'],
            'age': [30, 25, 35, 28, 32],
            'salary': [50000, 45000, 60000, 55000, 58000],
            'department': ['IT', 'HR', 'IT', 'Finance', 'IT'],
            'hire_date': ['2023-01-01', '2023-02-01', '2023-03-01', '2023-04-01', '2023-05-01']
        })

        # Save input data
        self.input_csv = os.path.join(self.input_dir, 'employees.csv')
        self.input_data.to_csv(self.input_csv, index=False)

    def tearDown(self):
        """Clean up test files and directories."""
        for file in os.listdir(self.input_dir):
            os.remove(os.path.join(self.input_dir, file))
        for file in os.listdir(self.output_dir):
            os.remove(os.path.join(self.output_dir, file))
        os.rmdir(self.input_dir)
        os.rmdir(self.output_dir)
        os.rmdir(self.test_dir)

    def test_complete_pipeline(self):
        """Test a complete ETL pipeline with multiple transformations."""
        # Extract configuration
        extract_config = {
            'type': 'csv',
            'path': self.input_csv
        }

        # Transform configuration
        transform_config = [
            {
                'type': 'clean',
                'params': {
                    'drop_na': True,
                    'drop_duplicates': True
                }
            },
            {
                'type': 'transform_dates',
                'params': {
                    'date_col': 'hire_date'
                }
            },
            {
                'type': 'aggregate',
                'params': {
                    'group_cols': 'department',
                    'agg_cols': 'salary',
                    'agg_funcs': {'salary': ['mean', 'sum', 'count']}
                }
            }
        ]

        # Load configuration
        load_config = {
            'type': 'csv',
            'path': os.path.join(self.output_dir, 'department_stats.csv')
        }

        try:
            # Execute pipeline
            df = extract_data(extract_config)
            df = transform_data(df, transform_config)
            load_data(df, load_config)

            # Verify results
            self.assertTrue(os.path.exists(load_config['path']))
            result_df = pd.read_csv(load_config['path'])
            
            # Check if the result has the expected columns
            expected_columns = ['department', 'salary_mean', 'salary_sum', 'salary_count']
            self.assertEqual(list(result_df.columns), expected_columns)
            
            # Check if the aggregation results are correct
            it_dept = result_df[result_df['department'] == 'IT']
            self.assertEqual(len(it_dept), 1)
            self.assertAlmostEqual(it_dept['salary_mean'].iloc[0], 56000)
            self.assertEqual(it_dept['salary_count'].iloc[0], 3)

        except Exception as e:
            self.fail(f"Pipeline failed with error: {str(e)}")

    def test_pipeline_with_filtering(self):
        """Test ETL pipeline with data filtering."""
        # Extract configuration
        extract_config = {
            'type': 'csv',
            'path': self.input_csv
        }

        # Transform configuration with filtering
        transform_config = [
            {
                'type': 'filter',
                'params': {
                    'conditions': ['age > 30']
                }
            },
            {
                'type': 'aggregate',
                'params': {
                    'group_cols': 'department',
                    'agg_cols': 'salary',
                    'agg_funcs': 'mean'
                }
            }
        ]

        # Load configuration
        load_config = {
            'type': 'json',
            'path': os.path.join(self.output_dir, 'filtered_stats.json')
        }

        try:
            # Execute pipeline
            df = extract_data(extract_config)
            df = transform_data(df, transform_config)
            load_data(df, load_config)

            # Verify results
            self.assertTrue(os.path.exists(load_config['path']))
            result_df = pd.read_json(load_config['path'])
            
            # Check if only employees over 30 are included
            self.assertTrue(all(result_df['salary'] > 0))
            
            # Check if the aggregation results are correct
            it_dept = result_df[result_df['department'] == 'IT']
            self.assertEqual(len(it_dept), 1)
            self.assertAlmostEqual(it_dept['salary'].iloc[0], 59000)  # Average of 60000 and 58000

        except Exception as e:
            self.fail(f"Pipeline failed with error: {str(e)}")

    def test_pipeline_with_normalization(self):
        """Test ETL pipeline with data normalization."""
        # Extract configuration
        extract_config = {
            'type': 'csv',
            'path': self.input_csv
        }

        # Transform configuration with normalization
        transform_config = [
            {
                'type': 'normalize',
                'params': {
                    'columns': 'salary',
                    'method': 'min-max'
                }
            }
        ]

        # Load configuration
        load_config = {
            'type': 'parquet',
            'path': os.path.join(self.output_dir, 'normalized_data.parquet')
        }

        try:
            # Execute pipeline
            df = extract_data(extract_config)
            df = transform_data(df, transform_config)
            load_data(df, load_config)

            # Verify results
            self.assertTrue(os.path.exists(load_config['path']))
            result_df = pd.read_parquet(load_config['path'])
            
            # Check if salary values are normalized between 0 and 1
            self.assertAlmostEqual(result_df['salary'].min(), 0)
            self.assertAlmostEqual(result_df['salary'].max(), 1)

        except Exception as e:
            self.fail(f"Pipeline failed with error: {str(e)}")


if __name__ == '__main__':
    unittest.main() 