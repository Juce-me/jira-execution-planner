"""Per-epic refresh helpers: request validation, rate limiting, response metadata, cache eviction.

Kept out of jira_server.py, which sits at its structure budget.
"""
import os
import re
import threading
import time
from collections import OrderedDict
from contextvars import ContextVar

from backend.jira_client import JiraCircuitBreaker

EPIC_REFRESH_PURPOSE = 'epic-refresh'
EPIC_ALERTS_PURPOSE = 'epic-alerts'
EPIC_SCOPED_PURPOSES = (EPIC_REFRESH_PURPOSE, EPIC_ALERTS_PURPOSE)
# ASCII only: \d and str.isdigit() accept other Unicode digits. \Z rejects a trailing newline.
ISSUE_KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]+-[0-9]+\Z')
_SPRINT_RE = re.compile(r'[0-9]+')

# Own breaker and a short retry budget: a burst of 429s from per-epic clicks must not open the
# dashboard-wide JIRA_SEARCH_CIRCUIT_BREAKER. Same env-driven thresholds as that breaker.
EPIC_REFRESH_CIRCUIT_BREAKER = JiraCircuitBreaker(
    failure_threshold=int(os.getenv('JIRA_CIRCUIT_FAILURE_THRESHOLD', '5')),
    open_seconds=float(os.getenv('JIRA_CIRCUIT_OPEN_SECONDS', '30')),
)
EPIC_REFRESH_MAX_ATTEMPTS = 2
EPIC_REFRESH_TRANSPORT = ContextVar('epic_refresh_transport', default=None)


def parse_epic_keys(raw):
    """Split a comma list into unique, stripped keys, keeping order."""
    keys = []
    for part in str(raw or '').split(','):
        key = part.strip()
        if key and key not in keys:
            keys.append(key)
    return keys


def single_epic_key(args):
    keys = parse_epic_keys(args.get('epicKeys', ''))
    return keys[0] if keys else None


def epic_keys_error(args, single=False):
    """Return an error payload for a malformed epicKeys value or a scoped-purpose request, else None.

    `single=True` (routes that take one epic) also rejects a multi-key list.
    """
    keys = parse_epic_keys(args.get('epicKeys', ''))
    if any(not ISSUE_KEY_RE.match(key) for key in keys):
        return {'error': 'invalid_epic_keys', 'message': 'Epic keys must look like PROJ-123.'}
    purpose = str(args.get('purpose') or '').strip().lower()
    if purpose in EPIC_SCOPED_PURPOSES:
        lane = str(args.get('project') or '').strip().lower()
        sprint = str(args.get('sprint') or '').strip()
        if len(keys) != 1 or not _SPRINT_RE.fullmatch(sprint) or lane not in ('product', 'tech'):
            return {
                'error': 'invalid_epic_refresh',
                'message': 'Epic refresh needs one epic key, a numeric sprint and a project lane.',
            }
    elif single and len(keys) > 1:
        return {'error': 'invalid_epic_keys', 'message': 'Pass exactly one epic key.'}
    return None


def limiter_bucket(purpose, lane, epic_key):
    """Both lanes of one click (and the alert call that follows) must never share a bucket."""
    return f'{purpose}:{lane}:{epic_key}'


class EpicRefreshLimiter:
    """Per user and bucket minimum interval between refreshes. Thread-safe."""

    def __init__(self, min_interval_seconds=8.0, clock=time.monotonic, max_entries=2048):
        self._min = float(min_interval_seconds)
        self._clock = clock
        self._max = int(max_entries)
        self._seen = OrderedDict()
        self._lock = threading.Lock()

    def retry_after(self, scope_key, bucket):
        """Return 0 and record the attempt when allowed, else the whole seconds to wait."""
        now = self._clock()
        key = (str(scope_key), str(bucket))
        with self._lock:
            last = self._seen.get(key)
            if last is not None and now - last < self._min:
                return max(1, int(self._min - (now - last) + 0.999))
            self._seen[key] = now
            self._seen.move_to_end(key)
            while len(self._seen) > self._max:
                self._seen.popitem(last=False)
        return 0


def response_meta(issue_count, max_results, requested_keys, epic_details):
    """Truncation and missing-details flags so the client never infers removals from partial data."""
    return {
        'capped': issue_count >= max_results,
        'epicKeysMissing': [key for key in requested_keys if key not in epic_details],
    }


def evict_scope_entries(cache, lock, key_for_purpose, purposes=('dashboard', 'alerts')):
    """Drop the same scope's cached dashboard and alerts entries so a reload is not stale."""
    with lock:
        for purpose in purposes:
            cache.pop(key_for_purpose(purpose), None)


def epic_refresh_call(active, fn, *args, **kwargs):
    """Run `fn` with the epic-refresh breaker and attempt budget bound when `active`, always unbinding."""
    if not active:
        return fn(*args, **kwargs)
    token = EPIC_REFRESH_TRANSPORT.set({'breaker': EPIC_REFRESH_CIRCUIT_BREAKER, 'max_attempts': EPIC_REFRESH_MAX_ATTEMPTS})
    try:
        return fn(*args, **kwargs)
    finally:
        EPIC_REFRESH_TRANSPORT.reset(token)


def epic_refresh_transport():
    """Breaker and attempt overrides for resilient_jira_get; empty unless inside epic_refresh_call."""
    return EPIC_REFRESH_TRANSPORT.get() or {}
