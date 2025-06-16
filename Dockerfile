# Usar una imagen base de Python
FROM python:3.8-slim

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar los archivos de requisitos
COPY requirements.txt .

# Instalar las dependencias
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código fuente
COPY src/ src/
COPY tests/ tests/

# Establecer variables de entorno
ENV PYTHONPATH=/app

# Comando por defecto
CMD ["python", "src/backtest.py"] 