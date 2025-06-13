# Algorithmic Trading with Python

Un sistema de trading algorítmico que implementa estrategias de trading automatizadas usando Python.

## Características

- **Descarga de datos históricos** usando yfinance
- **Cálculo de indicadores técnicos** (SMA, RSI, MACD)
- **Generación de señales de compra/venta**
- **Backtesting de estrategias**
- **Visualización de resultados** (valor del portafolio, señales)
- **Monitoreo en tiempo real** con Prometheus y Grafana
- **Automatización** con Airflow y Docker

## Estructura del Proyecto

```
algorithmic-trading-python/
├── src/
│   ├── data/           # Funciones para descarga y procesamiento de datos
│   ├── strategies/     # Implementación de estrategias de trading
│   ├── backtest/       # Sistema de backtesting
│   └── utils/          # Utilidades y helpers
├── tests/
│   ├── unit/          # Tests unitarios
│   └── integration/   # Tests de integración
├── notebooks/         # Análisis exploratorio y visualizaciones
├── airflow/          # DAGs para automatización
├── monitoring/       # Configuración de Prometheus y Grafana
└── docker/          # Configuración de Docker
```

## Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/RanuK12/algorithmic-trading-python.git
cd algorithmic-trading-python
```

2. Crear y activar entorno virtual:
```bash
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate
```

3. Instalar dependencias:
```bash
pip install -r requirements.txt
```

## Uso

### Ejecutar Backtesting

```bash
python -m src.backtest --strategy MovingAverageCrossover --symbol AAPL --start-date 2023-01-01 --end-date 2023-12-31
```

### Ejecutar con Docker

```bash
docker-compose up --build
```

### Monitoreo

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (credenciales por defecto: admin/admin)

## Estrategias Implementadas

### Moving Average Crossover
- Compra cuando la SMA corta cruza por encima de la SMA larga
- Venta cuando la SMA corta cruza por debajo de la SMA larga

### Ejemplo de Resultados

```bash
Resultados para MovingAverageCrossover:
--------------------------------------------------
Ratio de Sharpe: 1.25
Drawdown Máximo: 15.3%
Retorno Total: 23.5%
```

## Tests

Ejecutar los tests unitarios:
```bash
python -m pytest tests/unit/ -v
```

## Contribuir

1. Fork el repositorio
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir un Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## Contacto

RanuK12 - ranucoliemilio@gmail.com

Link del Proyecto: [https://github.com/RanuK12/algorithmic-trading-python](https://github.com/RanuK12/algorithmic-trading-python)