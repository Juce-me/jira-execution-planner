"""Single-use CSRF tokens stored per DB browser session in PostgreSQL.

Issue and consume each run in their own short transaction that commits before the
route runs, so a concurrent issuance or consumption can neither drop another valid
token nor resurrect a consumed one. Consumption is one atomic DELETE; it locks only
the token row and never `browser_sessions` or `auth_connections`.
"""

from __future__ import annotations

import hashlib
import secrets

from sqlalchemy import delete, func, insert, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.auth.csrf import MAX_CSRF_TOKENS, csrf_session_data_for_auth_context, csrf_token_hash
from backend.auth.db_context import revalidate_db_request_auth_context
from backend.auth.jira_auth import AuthError
from backend.db import models
from backend.db.engine import session_scope


CSRF_LOCK_TIMEOUT_MS = 2000
CSRF_STATEMENT_TIMEOUT_MS = 2000


class CsrfStorageUnavailable(RuntimeError):
    """Token state could not be read or written; the request must not be dispatched."""


def csrf_lock_key(browser_session_id: str) -> int:
    digest = hashlib.sha256(f'browser-csrf:{browser_session_id}'.encode('utf-8')).digest()
    return int.from_bytes(digest[:8], byteorder='big', signed=True)


def _browser_session_id(context) -> str:
    browser_session_id = str(getattr(context, 'browser_session_id', '') or '')
    if not browser_session_id:
        raise CsrfStorageUnavailable('CSRF tokens require a DB browser session.')
    return browser_session_id


def _bound_timeouts(db, budget):
    limits = [CSRF_LOCK_TIMEOUT_MS, CSRF_STATEMENT_TIMEOUT_MS]
    if budget is not None:
        remaining_ms = max(1, int(budget.remaining() * 1000))
        limits = [min(limit, remaining_ms) for limit in limits]
    db.execute(text("SELECT set_config('lock_timeout', :lock, true), set_config('statement_timeout', :statement, true)"),
               {'lock': f'{limits[0]}ms', 'statement': f'{limits[1]}ms'})


def issue_csrf_token(context, *, budget=None) -> str:
    browser_session_id = _browser_session_id(context)
    token = secrets.token_urlsafe(32)
    token_hash = csrf_token_hash(token, csrf_session_data_for_auth_context(context))
    tokens = models.BrowserCsrfToken
    newest = (select(tokens.token_hash).where(tokens.browser_session_id == browser_session_id)
              .order_by(tokens.created_at.desc(), tokens.token_hash.desc()).limit(MAX_CSRF_TOKENS))
    try:
        with session_scope() as db:
            _bound_timeouts(db, budget)
            # Serialize issuers of one browser session so pruning keeps exactly the newest tokens.
            db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': csrf_lock_key(browser_session_id)})
            db.execute(insert(tokens).values(token_hash=token_hash, browser_session_id=browser_session_id,
                                             created_at=func.clock_timestamp()))
            db.execute(delete(tokens).where(tokens.browser_session_id == browser_session_id,
                                            tokens.token_hash.not_in(newest.scalar_subquery())))
    except IntegrityError:
        raise AuthError('auth_required', 'Atlassian authentication is required.') from None
    except SQLAlchemyError:
        raise CsrfStorageUnavailable('CSRF token storage is unavailable.') from None
    return token


def consume_csrf_token(context, token: str | None, *, budget=None) -> bool:
    """True exactly once per issued token; AuthError when the session itself is gone."""
    browser_session_id = _browser_session_id(context)
    if not token:
        return False
    token_hash = csrf_token_hash(str(token), csrf_session_data_for_auth_context(context))
    tokens, sessions = models.BrowserCsrfToken, models.BrowserSession
    connections, users = models.AuthConnection, models.User
    try:
        with session_scope() as db:
            _bound_timeouts(db, budget)
            consumed = db.execute(delete(tokens).where(
                tokens.token_hash == token_hash,
                tokens.browser_session_id == browser_session_id,
                sessions.id == tokens.browser_session_id,
                sessions.user_id == context.user_id,
                sessions.workspace_id == context.workspace_id,
                sessions.auth_connection_id == context.auth_connection_id,
                connections.id == sessions.auth_connection_id,
                connections.status == 'active',
                users.id == sessions.user_id,
                users.status == 'active',
            ).returning(tokens.token_hash)).first()
            if consumed is None:
                # Distinguish a missing/revoked session (sign in again) from a bad token.
                revalidate_db_request_auth_context(context, db_session=db)
                return False
    except SQLAlchemyError:
        raise CsrfStorageUnavailable('CSRF token storage is unavailable.') from None
    return True
