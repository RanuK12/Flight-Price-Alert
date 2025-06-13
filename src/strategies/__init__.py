"""
Módulo de estrategias de trading.
"""

from .base import BaseStrategy
from .moving_average import MovingAverageCrossover

__all__ = ['BaseStrategy', 'MovingAverageCrossover'] 