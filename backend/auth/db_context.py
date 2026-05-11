"""Database-backed request auth context resolution."""

from __future__ import annotations

import time
from datetime import datetime

from sqlalchemy import select

from backend.auth.context import ProjectAccessSnapshot, RequestAuthContext
from backend.auth.jira_auth import AUTH_MODE_ATLASSIAN_OAUTH, AuthError, missing_oauth_scopes
from backend.db import engine as db_engine
from backend.db import models


STATUS_CACHE_TTL_SECONDS = 30
_STATUS_CACHE: dict[tuple[str, str, str], tuple[float, str, str]] = {}


def invalidate_auth_status_cache(user_id: str | None = None, auth_connection_id: str | None = None) -> None:
    if not user_id and not auth_connection_id:
        _STATUS_CACHE.clear()
        return
    for key in list(_STATUS_CACHE):
        key_user_id, key_connection_id, _ = key
        if user_id and key_user_id != user_id:
            continue
        if auth_connection_id and key_connection_id != auth_connection_id:
            continue
        _STATUS_CACHE.pop(key, None)


def is_db_auth_context(context) -> bool:
    connection_id = str(getattr(context, 'auth_connection_id', '') or '')
    return bool(connection_id) and not connection_id.startswith('local-')


def _status_for(user, connection, now: float) -> tuple[str, str]:
    cache_key = (user.id, connection.id, str(connection.token_version))
    cached = _STATUS_CACHE.get(cache_key)
    if cached and cached[0] > now:
        return cached[1], cached[2]
    user_status = str(user.status or '')
    connection_status = str(connection.status or '')
    _STATUS_CACHE[cache_key] = (now + STATUS_CACHE_TTL_SECONDS, user_status, connection_status)
    return user_status, connection_status


def _find_connection(session, session_data):
    connection_id = str((session_data or {}).get('db_auth_connection_id') or '').strip()
    if connection_id:
        return session.get(models.AuthConnection, connection_id)

    account_id = str((session_data or {}).get('account_id') or '').strip()
    cloud_id = str((session_data or {}).get('cloudid') or '').strip()
    site_url = str((session_data or {}).get('site_url') or '').strip().rstrip('/')
    if not account_id:
        return None
    statement = (
        select(models.AuthConnection)
        .join(models.User, models.User.id == models.AuthConnection.user_id)
        .where(
            models.User.external_provider == 'atlassian',
            models.User.external_subject == account_id,
            models.AuthConnection.provider == 'atlassian_oauth',
        )
    )
    if cloud_id:
        statement = statement.where(models.AuthConnection.cloud_id == cloud_id)
    elif site_url:
        statement = statement.where(models.AuthConnection.site_url == site_url)
    else:
        return None
    return session.execute(statement).scalars().first()


def _project_access(session, connection) -> tuple[ProjectAccessSnapshot, ...]:
    rows = session.execute(
        select(models.JiraProjectAccess)
        .where(models.JiraProjectAccess.connection_id == connection.id)
        .order_by(models.JiraProjectAccess.project_type, models.JiraProjectAccess.project_key)
    ).scalars().all()
    snapshots = []
    for row in rows:
        checked_at = row.checked_at.isoformat() if isinstance(row.checked_at, datetime) else ''
        snapshots.append(ProjectAccessSnapshot(
            project_key=row.project_key,
            project_type=row.project_type,
            status=row.status,
            checked_at=checked_at,
        ))
    return tuple(snapshots)


def resolve_db_request_auth_context(
    session_data,
    *,
    database_url: str | None = None,
    required_scopes: str = '',
    now: float | None = None,
) -> RequestAuthContext:
    current_time = time.time() if now is None else now
    with db_engine.session_factory(database_url)() as session:
        connection = _find_connection(session, session_data)
        if connection is None:
            raise AuthError('auth_required', 'Atlassian authentication is required.')
        user = session.get(models.User, connection.user_id)
        workspace = session.get(models.Workspace, connection.workspace_id)
        if user is None or workspace is None:
            raise AuthError('auth_required', 'Atlassian authentication is required.')

        user_status, connection_status = _status_for(user, connection, current_time)
        if user_status != 'active':
            raise AuthError('account_disabled', 'Your account is disabled.')
        if connection_status != 'active':
            raise AuthError('auth_connection_revoked', 'Your Jira connection needs to be reconnected.')

        session_token_version = str((session_data or {}).get('db_token_version') or '')
        if session_token_version and session_token_version != str(connection.token_version):
            raise AuthError('auth_connection_stale', 'Your Jira connection changed. Reconnect to continue.')
        if missing_oauth_scopes({'scope': ' '.join(connection.scopes or [])}, required_scopes):
            raise AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')

        return RequestAuthContext(
            auth_mode=AUTH_MODE_ATLASSIAN_OAUTH,
            user_id=user.id,
            stable_subject=user.external_subject,
            atlassian_account_id=user.external_subject,
            workspace_id=workspace.id,
            auth_connection_id=connection.id,
            cloud_id=connection.cloud_id or '',
            site_url=connection.site_url or workspace.jira_site_url or '',
            token_version=str(connection.token_version),
            account_status=user_status,
            is_admin=user.account_type == 'admin',
            project_access=_project_access(session, connection),
        )
