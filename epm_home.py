"""Compatibility shim for backend.epm.home."""

import sys
from backend.epm import home as _home

sys.modules[__name__] = _home
