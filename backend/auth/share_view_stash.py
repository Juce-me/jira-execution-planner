"""Carry a shareable-view query through the login hop in the signed session cookie."""

import re
import time
from contextlib import suppress

from flask import after_this_request, current_app

SHARE_VIEW_STASH_KEY = 'pending_share_view'
SHARE_VIEW_MAX_QUERY_BYTES = 1536
SHARE_VIEW_TTL_SECONDS = 900
SHARE_VIEW_MAX_COOKIE_BYTES = 3300
# Must equal "pattern" in tests/fixtures/share-view-query-corpus-example-sanitized.json.
SHARE_VIEW_QUERY_PATTERN = (
    r'v=[1-9][0-9]{0,2}'
    r'(?:&[A-Za-z][A-Za-z0-9]{0,15}='
    r'(?:[A-Za-z0-9_.~:,-]|%(?![01][0-9A-Fa-f]|7[Ff])[0-9A-Fa-f]{2})*){0,40}'
)
_SHARE_VIEW_QUERY_RE = re.compile(SHARE_VIEW_QUERY_PATTERN)


def _is_valid_query(query):
    # fullmatch, never `$`: Python's `$` also accepts a trailing newline.
    return (
        isinstance(query, str)
        and len(query) <= SHARE_VIEW_MAX_QUERY_BYTES
        and query.isascii()
        and _SHARE_VIEW_QUERY_RE.fullmatch(query) is not None
    )


def _no_store(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


def stash_share_view_query(request, session, *, now=None):
    """Hold a validated GET query in the session until the login hop completes. Never raises."""
    try:
        raw = request.query_string
        if request.method != 'GET' or not raw.isascii():
            return
        query = raw.decode('ascii')
        if not _is_valid_query(query):
            return
        session[SHARE_VIEW_STASH_KEY] = {'q': query, 't': int(time.time() if now is None else now)}
        serializer = current_app.session_interface.get_signing_serializer(current_app)
        if len(serializer.dumps(dict(session))) > SHARE_VIEW_MAX_COOKIE_BYTES:
            session.pop(SHARE_VIEW_STASH_KEY, None)
            return
        after_this_request(_no_store)
    except Exception:
        with suppress(Exception):
            session.pop(SHARE_VIEW_STASH_KEY, None)


def pop_share_view_target(session, *, now=None):
    """Pop the stash and return '/?<query>' when it is valid and fresh, else '/'. Never raises."""
    try:
        stored = session.pop(SHARE_VIEW_STASH_KEY, None)
        age = (time.time() if now is None else now) - stored['t']
        if 0 <= age <= SHARE_VIEW_TTL_SECONDS and _is_valid_query(stored['q']):
            return '/?' + stored['q']
    except Exception:
        pass
    return '/'


def clear_share_view_stash(session):
    session.pop(SHARE_VIEW_STASH_KEY, None)
