"""Compatibility shim for backend.epm.scope."""

import sys
from backend.epm import scope as _scope

sys.modules[__name__] = _scope
