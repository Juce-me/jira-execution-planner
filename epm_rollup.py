"""Compatibility shim for backend.epm.rollup."""

import sys
from backend.epm import rollup as _rollup

sys.modules[__name__] = _rollup
