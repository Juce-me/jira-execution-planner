"""Token-bound CSRF helpers for DB-backed browser mutations."""

from __future__ import annotations

import hashlib
import secrets


CSRF_SESSION_KEY = 'csrf_token_hashes'
MAX_CSRF_TOKENS = 8


def _binding(session_id: str, session_data: dict) -> str:
    return ':'.join([
        str(session_id or ''),
        str((session_data or {}).get('db_auth_connection_id') or ''),
        str((session_data or {}).get('db_token_version') or ''),
        str((session_data or {}).get('account_id') or ''),
    ])


def _token_hash(token: str, binding: str) -> str:
    return hashlib.sha256(f'{token}:{binding}'.encode('utf-8')).hexdigest()


def issue_csrf_token(flask_session, session_data: dict) -> str:
    session_id = flask_session.get('atlassian_oauth_session_id') or ''
    token = secrets.token_urlsafe(32)
    hashes = list(flask_session.get(CSRF_SESSION_KEY) or [])
    hashes.append(_token_hash(token, _binding(session_id, session_data)))
    flask_session[CSRF_SESSION_KEY] = hashes[-MAX_CSRF_TOKENS:]
    return token


def bind_csrf_token(flask_session, token: str, session_data: dict) -> None:
    session_id = flask_session.get('atlassian_oauth_session_id') or ''
    token_hash = _token_hash(token, _binding(session_id, session_data))
    hashes = list(flask_session.get(CSRF_SESSION_KEY) or [])
    if token_hash not in hashes:
        hashes.append(token_hash)
    flask_session[CSRF_SESSION_KEY] = hashes[-MAX_CSRF_TOKENS:]


def validate_csrf_token(flask_session, session_data: dict, token: str | None) -> bool:
    if not token:
        return False
    session_id = flask_session.get('atlassian_oauth_session_id') or ''
    expected = _token_hash(str(token), _binding(session_id, session_data))
    hashes = list(flask_session.get(CSRF_SESSION_KEY) or [])
    if expected not in hashes:
        return False
    hashes.remove(expected)
    flask_session[CSRF_SESSION_KEY] = hashes
    return True
