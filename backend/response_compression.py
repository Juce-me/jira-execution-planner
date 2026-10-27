"""Gzip compression for allowlisted JSON and static responses.

One ``after_request`` handler, registered first in ``create_app`` so that Flask
(which runs these handlers in reverse registration order) calls it last and it
sees the final headers set by Flask-CORS and the security headers.
"""

import gzip
import threading
from collections import OrderedDict

from flask import request

MIN_COMPRESS_BYTES = 1024
GZIP_LEVEL = 6
MAX_MEMOIZED_ASSETS = 32
COMPRESSIBLE_TYPES = frozenset({
    'application/json',
    'text/javascript',
    'application/javascript',
    'text/css',
    'text/html',
    'image/svg+xml',
})
EXCLUDED_PATH_PREFIXES = ('/api/auth/',)
EXCLUDED_PATH_SUFFIXES = ('.map',)
STATIC_ASSET_PREFIX = '/frontend/dist/'
VARY_TOKEN = 'Accept-Encoding'

# (request path, original strong ETag) -> gzip bytes, oldest first. The lock covers the
# lookup and the compression, so concurrent cold requests compress an asset once.
_MEMOIZED_ASSETS = OrderedDict()
_MEMOIZED_ASSETS_LOCK = threading.Lock()


def _merge_vary(response):
    """Add Accept-Encoding to Vary once, across every existing Vary line."""
    lines = response.headers.getlist('Vary')
    tokens = {token.strip().lower() for line in lines for token in line.split(',')}
    if '*' in tokens or VARY_TOKEN.lower() in tokens:
        return
    if not lines:
        response.headers['Vary'] = VARY_TOKEN
        return
    lines[0] = f"{lines[0].rstrip().rstrip(',')}, {VARY_TOKEN}"
    response.headers.setlist('Vary', lines)


def _make_weak(response):
    etag, _is_weak = response.get_etag()
    if etag is not None:
        response.set_etag(etag, weak=True)


def _is_candidate(response):
    """True when the request and response are the kind of thing this module may encode."""
    if request.method not in ('GET', 'HEAD'):
        return False
    path = request.path
    if path.startswith(EXCLUDED_PATH_PREFIXES) or path.endswith(EXCLUDED_PATH_SUFFIXES):
        return False
    if response.mimetype not in COMPRESSIBLE_TYPES:
        return False
    # send_file responses are streamed but direct_passthrough: those are static files and
    # are read once below. Generator responses (NDJSON, SSE, streamed JSON) are never touched.
    if response.is_streamed and not response.direct_passthrough:
        return False
    if response.headers.get('Content-Encoding'):
        return False
    if response.cache_control.no_transform:
        return False
    return request.accept_encodings.quality('gzip') > 0


def _gzip_body(response):
    """Return the gzip bytes of the response body, memoized for static assets."""
    etag = response.headers.get('ETag')
    if request.path.startswith(STATIC_ASSET_PREFIX) and etag:
        key = (request.path, etag)
        with _MEMOIZED_ASSETS_LOCK:
            body = _MEMOIZED_ASSETS.get(key)
            if body is None:
                body = gzip.compress(_read_body(response), compresslevel=GZIP_LEVEL, mtime=0)
                _MEMOIZED_ASSETS[key] = body
                while len(_MEMOIZED_ASSETS) > MAX_MEMOIZED_ASSETS:
                    _MEMOIZED_ASSETS.popitem(last=False)
            return body
    return gzip.compress(_read_body(response), compresslevel=GZIP_LEVEL, mtime=0)


def _read_body(response):
    if response.direct_passthrough:
        response.direct_passthrough = False
    return response.get_data()


def _declared_length(response):
    """Body length without reading a file response; None when it is not declared."""
    if response.direct_passthrough:
        return response.content_length
    return len(response.get_data())


def register_response_compression(flask_app):
    @flask_app.after_request
    def compress_response(response):
        is_static_target = request.path.startswith(STATIC_ASSET_PREFIX) and response.status_code in (200, 304)
        if request.method in ('GET', 'HEAD') and (response.mimetype in COMPRESSIBLE_TYPES or is_static_target):
            _merge_vary(response)

        if response.status_code not in (200, 304) or not _is_candidate(response):
            return response

        length = _declared_length(response)
        if length is None or length < MIN_COMPRESS_BYTES:
            return response

        if response.status_code == 304:
            # A 304 carries the validators of the 200 it stands for.
            _make_weak(response)
            return response

        body = _gzip_body(response)
        # Still the file wrapper when a memoized body made reading it unnecessary.
        close = getattr(response.response, 'close', None)
        response.direct_passthrough = False
        response.set_data(body)
        if close is not None:
            close()
        response.headers['Content-Encoding'] = 'gzip'
        response.headers.pop('Accept-Ranges', None)
        _make_weak(response)
        return response
