"""
Módulo de Extracción de Datos

Este módulo proporciona funciones para extraer datos de diferentes fuentes:
- Archivos CSV
- Archivos JSON
- APIs REST
- Bases de datos SQL

Cada función está diseñada para manejar un tipo específico de fuente de datos
y devuelve un DataFrame de pandas con los datos extraídos.
"""

import pandas as pd
import json
import requests
from sqlalchemy import create_engine
from typing import Dict, Any, Union, List
import logging

# Configuración del logger
logger = logging.getLogger(__name__)

def extract_data(config: Dict[str, Any]) -> pd.DataFrame:
    """
    Función principal para extraer datos basada en la configuración proporcionada.
    
    Args:
        config (Dict[str, Any]): Diccionario de configuración que especifica:
            - type: Tipo de fuente ('csv', 'json', 'api', 'sql')
            - path/url: Ruta o URL de la fuente de datos
            - params: Parámetros adicionales específicos de la fuente
    
    Returns:
        pd.DataFrame: DataFrame con los datos extraídos
    
    Raises:
        ValueError: Si el tipo de fuente no es soportado
        FileNotFoundError: Si el archivo no existe
        Exception: Para otros errores durante la extracción
    """
    source_type = config.get('type', '').lower()
    
    try:
        if source_type == 'csv':
            return _extract_csv(config)
        elif source_type == 'json':
            return _extract_json(config)
        elif source_type == 'api':
            return _extract_api(config)
        elif source_type == 'sql':
            return _extract_sql(config)
        else:
            raise ValueError(f"Tipo de fuente no soportado: {source_type}")
    except Exception as e:
        logger.error(f"Error extrayendo datos: {str(e)}")
        raise

def _extract_csv(config: Dict[str, Any]) -> pd.DataFrame:
    """
    Extrae datos de un archivo CSV.
    
    Args:
        config (Dict[str, Any]): Configuración que incluye:
            - path: Ruta al archivo CSV
            - sep: Separador (opcional, default=',')
            - encoding: Codificación del archivo (opcional)
    
    Returns:
        pd.DataFrame: DataFrame con los datos del CSV
    """
    path = config['path']
    sep = config.get('sep', ',')
    encoding = config.get('encoding', 'utf-8')
    
    logger.info(f"Extrayendo datos de CSV: {path}")
    return pd.read_csv(path, sep=sep, encoding=encoding)

def _extract_json(config: Dict[str, Any]) -> pd.DataFrame:
    """
    Extrae datos de un archivo JSON.
    
    Args:
        config (Dict[str, Any]): Configuración que incluye:
            - path: Ruta al archivo JSON
            - encoding: Codificación del archivo (opcional)
    
    Returns:
        pd.DataFrame: DataFrame con los datos del JSON
    """
    path = config['path']
    encoding = config.get('encoding', 'utf-8')
    
    logger.info(f"Extrayendo datos de JSON: {path}")
    with open(path, 'r', encoding=encoding) as f:
        data = json.load(f)
    return pd.DataFrame(data['data'])

def _extract_api(config: Dict[str, Any]) -> pd.DataFrame:
    """
    Extrae datos de una API REST.
    
    Args:
        config (Dict[str, Any]): Configuración que incluye:
            - url: URL de la API
            - method: Método HTTP (opcional, default='GET')
            - params: Parámetros de la consulta (opcional)
            - headers: Headers HTTP (opcional)
    
    Returns:
        pd.DataFrame: DataFrame con los datos de la API
    """
    url = config['url']
    method = config.get('method', 'GET')
    params = config.get('params', {})
    headers = config.get('headers', {})
    
    logger.info(f"Extrayendo datos de API: {url}")
    response = requests.request(method, url, params=params, headers=headers)
    response.raise_for_status()
    return pd.DataFrame(response.json()['data'])

def _extract_sql(config: Dict[str, Any]) -> pd.DataFrame:
    """
    Extrae datos de una base de datos SQL.
    
    Args:
        config (Dict[str, Any]): Configuración que incluye:
            - connection_string: String de conexión a la base de datos
            - query: Consulta SQL a ejecutar
            - params: Parámetros de la consulta (opcional)
    
    Returns:
        pd.DataFrame: DataFrame con los resultados de la consulta
    """
    connection_string = config['connection_string']
    query = config['query']
    params = config.get('params', {})
    
    logger.info(f"Extrayendo datos de SQL: {query}")
    engine = create_engine(connection_string)
    return pd.read_sql(query, engine, params=params) 