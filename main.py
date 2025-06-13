import os
from dotenv import load_dotenv
from src.extract import extract_data
from src.transform import transform_data
from src.load import load_data


def main():
    """Main ETL pipeline execution."""
    # Load environment variables
    load_dotenv()

    # Example configuration
    config = {
        'source': {
            'type': 'csv',
            'path': 'data/raw/sample_data.csv'
        },
        'transformations': [
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
        ],
        'destination': {
            'type': 'db',
            'params': {
                'table_name': 'sales_by_category',
                'db_url': os.getenv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/etl_db')
            }
        }
    }

    try:
        # Extract
        print("Extracting data...")
        df = extract_data(config['source'])

        # Transform
        print("Transforming data...")
        df = transform_data(df, config['transformations'])

        # Load
        print("Loading data...")
        load_data(df, config['destination'])

        print("ETL pipeline completed successfully!")

    except Exception as e:
        print(f"Error in ETL pipeline: {str(e)}")
        raise


if __name__ == "__main__":
    main() 