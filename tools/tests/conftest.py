"""Pytest bootstrap: make tools/polymarket.py importable as ``polymarket``."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
