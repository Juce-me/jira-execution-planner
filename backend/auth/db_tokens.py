"""Database token write helpers for the OAuth cutover."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from backend.auth.jira_auth import normalize_site_url
from backend.auth.token_crypto import encrypt_token
from backend.db import models


@dataclass(frozen=True)
class StoredOAuthConnection:
    user_id: str
    workspace_id: str
    connection_id: str
    token_version: int
    session_metadata: dict[str, str]


def _expires_at(token_data) -> datetime | None:
    try:
        expires_in = int((token_data or {}).get('expires_in') or 0)
    except (TypeError, ValueError):
        return None
    if expires_in <= 0:
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=expires_in)


def _scope_list(token_data) -> list[str]:
    raw = (token_data or {}).get('scope') or ''
    if isinstance(raw, str):
        return [scope for scope in raw.split() if scope]
    return [str(scope).strip() for scope in raw or [] if str(scope).strip()]


def _upsert_user(session, user_profile):
    account_id = str((user_profile or {}).get('account_id') or '').strip()
    user = session.execute(
        select(models.User).where(
            models.User.external_provider == 'atlassian',
            models.User.external_subject == account_id,
        )
    ).scalars().first()
    if user is None:
        user = models.User(
            external_provider='atlassian',
            external_subject=account_id,
            account_type='user',
            status='active',
            created_by='oauth',
        )
        session.add(user)
    user.email = (user_profile or {}).get('email')
    user.display_name = (user_profile or {}).get('display_name') or (user_profile or {}).get('name')
    user.last_seen_at = datetime.now(timezone.utc)
    session.flush()
    return user


def _upsert_workspace(session, *, environment_key, resource, configured_jira_url):
    cloud_id = str((resource or {}).get('id') or '').strip()
    site_url = normalize_site_url((resource or {}).get('url') or configured_jira_url)
    statement = select(models.Workspace).where(models.Workspace.environment_key == environment_key)
    if cloud_id:
        statement = statement.where(models.Workspace.jira_cloud_id == cloud_id)
    else:
        statement = statement.where(models.Workspace.jira_site_url == site_url)
    workspace = session.execute(statement).scalars().first()
    if workspace is None:
        workspace = models.Workspace(
            environment_key=environment_key,
            name=(resource or {}).get('name') or site_url or cloud_id,
            jira_site_url=site_url,
            jira_cloud_id=cloud_id or None,
            created_by='oauth',
        )
        session.add(workspace)
    else:
        workspace.name = (resource or {}).get('name') or workspace.name
        workspace.jira_site_url = site_url or workspace.jira_site_url
        workspace.jira_cloud_id = cloud_id or workspace.jira_cloud_id
    session.flush()
    return workspace


def _upsert_connection(session, *, user, workspace, resource, token_data):
    cloud_id = str((resource or {}).get('id') or '').strip()
    site_url = normalize_site_url((resource or {}).get('url') or workspace.jira_site_url)
    statement = select(models.AuthConnection).where(
        models.AuthConnection.user_id == user.id,
        models.AuthConnection.workspace_id == workspace.id,
        models.AuthConnection.provider == 'atlassian_oauth',
    )
    if cloud_id:
        statement = statement.where(models.AuthConnection.cloud_id == cloud_id)
    else:
        statement = statement.where(models.AuthConnection.site_url == site_url)
    connection = session.execute(statement).scalars().first()
    if connection is None:
        connection = models.AuthConnection(
            user_id=user.id,
            workspace_id=workspace.id,
            provider='atlassian_oauth',
            token_version=1,
        )
        session.add(connection)
    else:
        connection.token_version = int(connection.token_version or 0) + 1
    connection.site_url = site_url
    connection.cloud_id = cloud_id or None
    connection.scopes = _scope_list(token_data)
    connection.status = 'active'
    connection.expires_at = _expires_at(token_data)
    connection.last_validated_at = datetime.now(timezone.utc)
    session.flush()
    return connection


def _replace_token(session, *, connection, workspace, token_kind, plaintext, key_provider):
    session.query(models.AuthToken).filter(
        models.AuthToken.connection_id == connection.id,
        models.AuthToken.token_kind == token_kind,
    ).delete(synchronize_session=False)
    envelope = encrypt_token(
        plaintext,
        workspace_id=workspace.id,
        auth_connection_id=connection.id,
        token_kind=token_kind,
        key_provider=key_provider,
    )
    session.add(models.AuthToken(
        connection_id=connection.id,
        token_kind=token_kind,
        algorithm=envelope.algorithm,
        ciphertext=envelope.ciphertext,
        nonce=envelope.nonce,
        wrapped_dek=envelope.wrapped_dek,
        key_id=envelope.key_id,
        aad_hash=envelope.aad_hash,
        expires_at=connection.expires_at if token_kind == 'access_token' else None,
        rotated_at=datetime.now(timezone.utc),
    ))


def store_oauth_callback_tokens(
    session,
    *,
    token_data,
    resource,
    user_profile,
    environment_key,
    configured_jira_url,
    key_provider,
) -> StoredOAuthConnection:
    user = _upsert_user(session, user_profile)
    workspace = _upsert_workspace(
        session,
        environment_key=environment_key,
        resource=resource,
        configured_jira_url=configured_jira_url,
    )
    connection = _upsert_connection(session, user=user, workspace=workspace, resource=resource, token_data=token_data)
    _replace_token(
        session,
        connection=connection,
        workspace=workspace,
        token_kind='access_token',
        plaintext=(token_data or {}).get('access_token') or '',
        key_provider=key_provider,
    )
    _replace_token(
        session,
        connection=connection,
        workspace=workspace,
        token_kind='refresh_token',
        plaintext=(token_data or {}).get('refresh_token') or '',
        key_provider=key_provider,
    )
    session.flush()
    metadata = {
        'db_user_id': user.id,
        'db_workspace_id': workspace.id,
        'db_auth_connection_id': connection.id,
        'db_token_version': str(connection.token_version),
    }
    return StoredOAuthConnection(
        user_id=user.id,
        workspace_id=workspace.id,
        connection_id=connection.id,
        token_version=connection.token_version,
        session_metadata=metadata,
    )
