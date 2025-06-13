# ETL BigData Pipeline

A robust and scalable ETL (Extract, Transform, Load) pipeline for processing big data using Python.

## Features

- Extract data from multiple sources (CSV, JSON, API, SQL databases)
- Transform data with various operations (cleaning, aggregation, filtering, date transformation, normalization)
- Load data to multiple destinations (databases, CSV, JSON, Parquet files)
- Comprehensive test suite with unit and integration tests
- Docker and Docker Compose support for easy deployment
- Monitoring with Prometheus and Grafana
- Airflow integration for workflow orchestration

## Project Structure

```
etl-bigdata-pipeline/
├── data/
│   ├── raw/          # Raw input data
│   ├── processed/    # Intermediate processed data
│   └── final/        # Final output data
├── src/
│   ├── extract.py    # Data extraction functions
│   ├── transform.py  # Data transformation functions
│   └── load.py       # Data loading functions
├── tests/
│   ├── unit/         # Unit tests
│   └── integration/  # Integration tests
├── airflow/
│   └── dags/         # Airflow DAGs
├── Dockerfile        # Docker configuration
├── docker-compose.yml # Docker Compose configuration
├── requirements.txt  # Python dependencies
├── pytest.ini       # Pytest configuration
├── prometheus.yml   # Prometheus configuration
└── README.md        # Project documentation
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/etl-bigdata-pipeline.git
cd etl-bigdata-pipeline
```

2. Create and activate a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Copy the example environment file and configure it:
```bash
cp .env.example .env
# Edit .env with your configuration
```

## Usage

### Running the Pipeline

1. Using Python directly:
```bash
python main.py
```

2. Using Docker:
```bash
docker-compose up --build
```

### Running Tests

```bash
pytest
```

### Monitoring

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (default credentials: admin/admin)

## Development

### Adding New Features

1. Create a new branch:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes and add tests
3. Run tests to ensure everything works:
```bash
pytest
```

4. Submit a pull request

### Code Style

This project follows PEP 8 style guide. Use `black` for code formatting:

```bash
black .
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contact

Your Name - your.email@example.com

Project Link: https://github.com/yourusername/etl-bigdata-pipeline
