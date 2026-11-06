"""Token-bound CSRF primitives for DB-backed browser mutations.

Outstanding tokens live in PostgreSQL (`backend.auth.csrf_store`); only their
bound SHA-256 hashes are stored, never in the cookie.
"""

from __future__ import annotations

import hashlib


# Obsolete signed-cookie key from the retired cookie-list store; removed on issuance.
CSRF_SESSION_KEY = 'csrf_token_hashes'
MAX_CSRF_TOKENS = 8


def csrf_session_data_for_auth_context(context) -> dict:
    return {
        'db_browser_session_id': str(getattr(context, 'browser_session_id', '') or ''),
        'db_auth_connection_id': str(getattr(context, 'auth_connection_id', '') or ''),
        'account_id': str(getattr(context, 'atlassian_account_id', '') or ''),
    }


def _binding(session_data: dict) -> str:
    return ':'.join([
        str((session_data or {}).get('db_browser_session_id') or ''),
        str((session_data or {}).get('db_auth_connection_id') or ''),
        str((session_data or {}).get('account_id') or ''),
    ])


def csrf_token_hash(token: str, session_data: dict) -> str:
    return hashlib.sha256(f'{token}:{_binding(session_data)}'.encode('utf-8')).hexdigest()
