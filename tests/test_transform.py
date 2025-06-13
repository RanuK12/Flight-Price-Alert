import unittest
import pandas as pd
import numpy as np
from src.transform import (
    clean_data,
    aggregate_data,
    filter_data,
    transform_dates,
    normalize_data,
    transform_data
)


class TestTransform(unittest.TestCase):
    """Test cases for transform module."""

    def setUp(self):
        """Set up test data."""
        self.df = pd.DataFrame({
            'id': [1, 2, 3, 4, 5],
            'category': ['A', 'B', 'A', 'B', 'A'],
            'sales': [100, 200, 150, 250, 300],
            'date': ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'],
            'value': [1.0, 2.0, 3.0, 4.0, 5.0]
        })

    def test_clean_data(self):
        """Test clean_data function."""
        # Test with NA values
        df_with_na = self.df.copy()
        df_with_na.loc[0, 'sales'] = np.nan
        cleaned_df = clean_data(df_with_na, drop_na=True)
        self.assertEqual(len(cleaned_df), 4)

        # Test with duplicates
        df_with_dupes = self.df.copy()
        df_with_dupes = pd.concat([df_with_dupes, df_with_dupes.iloc[0:1]])
        cleaned_df = clean_data(df_with_dupes, drop_duplicates=True)
        self.assertEqual(len(cleaned_df), 5)

        # Test with fill_na
        df_with_na = self.df.copy()
        df_with_na.loc[0, 'sales'] = np.nan
        cleaned_df = clean_data(df_with_na, drop_na=False, fill_na={'sales': 0})
        self.assertEqual(cleaned_df.loc[0, 'sales'], 0)

        # Test with rename_cols
        cleaned_df = clean_data(self.df, rename_cols={'sales': 'revenue'})
        self.assertIn('revenue', cleaned_df.columns)
        self.assertNotIn('sales', cleaned_df.columns)

    def test_aggregate_data(self):
        """Test aggregate_data function."""
        # Test with single group column
        agg_df = aggregate_data(self.df, 'category', 'sales')
        self.assertEqual(len(agg_df), 2)
        self.assertEqual(agg_df.loc[agg_df['category'] == 'A', 'sales'].iloc[0], 550)

        # Test with multiple group columns
        agg_df = aggregate_data(self.df, ['category', 'id'], 'sales')
        self.assertEqual(len(agg_df), 5)

        # Test with multiple aggregation functions
        agg_df = aggregate_data(
            self.df,
            'category',
            'sales',
            agg_funcs={'sales': ['sum', 'mean']}
        )
        self.assertEqual(len(agg_df.columns), 3)

    def test_filter_data(self):
        """Test filter_data function."""
        # Test with single condition
        filtered_df = filter_data(self.df, 'sales > 200')
        self.assertEqual(len(filtered_df), 2)

        # Test with multiple conditions
        filtered_df = filter_data(self.df, ['category == "A"', 'sales > 200'])
        self.assertEqual(len(filtered_df), 1)

    def test_transform_dates(self):
        """Test transform_dates function."""
        # Test with default format
        transformed_df = transform_dates(self.df, 'date')
        self.assertTrue(pd.api.types.is_datetime64_any_dtype(transformed_df['date']))

        # Test with custom format
        df_custom = self.df.copy()
        df_custom['date'] = ['01/01/2024', '02/01/2024', '03/01/2024', '04/01/2024', '05/01/2024']
        transformed_df = transform_dates(df_custom, 'date', format='%d/%m/%Y')
        self.assertTrue(pd.api.types.is_datetime64_any_dtype(transformed_df['date']))

    def test_normalize_data(self):
        """Test normalize_data function."""
        # Test min-max normalization
        normalized_df = normalize_data(self.df, 'value', method='min-max')
        self.assertAlmostEqual(normalized_df['value'].min(), 0)
        self.assertAlmostEqual(normalized_df['value'].max(), 1)

        # Test z-score normalization
        normalized_df = normalize_data(self.df, 'value', method='z-score')
        self.assertAlmostEqual(normalized_df['value'].mean(), 0, places=5)
        self.assertAlmostEqual(normalized_df['value'].std(), 1, places=5)

    def test_transform_data(self):
        """Test transform_data function."""
        transformations = [
            {
                'type': 'clean',
                'params': {
                    'drop_na': True,
                    'drop_duplicates': True
                }
            },
            {
                'type': 'aggregate',
                'params': {
                    'group_cols': 'category',
                    'agg_cols': 'sales',
                    'agg_funcs': 'sum'
                }
            }
        ]

        transformed_df = transform_data(self.df, transformations)
        self.assertEqual(len(transformed_df), 2)
        self.assertEqual(transformed_df.loc[transformed_df['category'] == 'A', 'sales'].iloc[0], 550)


if __name__ == '__main__':
    unittest.main() 