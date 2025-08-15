# Multi-stage build for Analytics Master Hub Backend
FROM python:3.9-slim as base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Development stage
FROM base as development

# Install development dependencies
RUN pip install --no-cache-dir \
    pytest \
    pytest-asyncio \
    pytest-cov \
    black \
    flake8 \
    mypy \
    pre-commit

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs data uploads

# Set permissions
RUN chmod +x /app/scripts/*.sh || true

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Development command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Production stage
FROM base as production

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs data uploads && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Production command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

# Testing stage
FROM base as testing

# Install testing dependencies
RUN pip install --no-cache-dir \
    pytest \
    pytest-asyncio \
    pytest-cov \
    pytest-mock \
    httpx \
    factory-boy

# Copy application code
COPY . .

# Create test directories
RUN mkdir -p tests/reports

# Run tests
CMD ["pytest", "tests/", "-v", "--cov=app", "--cov-report=html:tests/reports/coverage"]

# Documentation stage
FROM base as documentation

# Install documentation dependencies
RUN pip install --no-cache-dir \
    sphinx \
    sphinx-rtd-theme \
    mkdocs \
    mkdocs-material

# Copy application code
COPY . .

# Build documentation
CMD ["mkdocs", "build", "--site-dir", "/app/docs/build"] 