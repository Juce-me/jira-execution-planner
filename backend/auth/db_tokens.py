"""Database token write helpers for the OAuth cutover."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from backend.auth.jira_auth import (
    AuthError,
    is_oauth_token_expired,
    normalize_site_url,
    request_oauth_refresh_token,
)
from backend.auth.token_crypto import decrypt_token, encrypt_token
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


def _scope_list(token_data, fallback_scopes: str = '') -> list[str]:
    raw = (token_data or {}).get('scope') or fallback_scopes or ''
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


def _token_envelope(token):
    return {
        'algorithm': token.algorithm,
        'ciphertext': token.ciphertext,
        'nonce': token.nonce,
        'wrapped_dek': token.wrapped_dek,
        'key_id': token.key_id,
        'aad_hash': token.aad_hash,
    }


def _active_token(session, *, connection_id, token_kind):
    return session.execute(
        select(models.AuthToken)
        .where(
            models.AuthToken.connection_id == connection_id,
            models.AuthToken.token_kind == token_kind,
            models.AuthToken.revoked_at.is_(None),
        )
    ).scalars().first()


def _decrypt_token_row(token, *, workspace_id, connection_id, key_provider):
    return decrypt_token(
        _token_envelope(token),
        workspace_id=workspace_id,
        auth_connection_id=connection_id,
        token_kind=token.token_kind,
        key_provider=key_provider,
    )


def _connection_for_update(session, connection_id):
    return session.execute(
        select(models.AuthConnection)
        .where(models.AuthConnection.id == connection_id)
        .with_for_update()
    ).scalars().first()


def _delete_usable_tokens(session, connection_id):
    session.query(models.AuthToken).filter(
        models.AuthToken.connection_id == connection_id,
        models.AuthToken.revoked_at.is_(None),
    ).delete(synchronize_session=False)


def _revoke_for_refresh_reuse(session, *, connection, cause):
    _delete_usable_tokens(session, connection.id)
    connection.status = 'revoked'
    connection.token_version = int(connection.token_version or 0) + 1
    session.add(models.audit_event(
        workspace_id=connection.workspace_id,
        auth_connection_id=connection.id,
        event_type='connection_revoked',
        metadata={'cause': cause},
    ))
    session.flush()
    raise AuthError('auth_connection_revoked', 'Your Jira connection needs to be reconnected.')


def _expires_at_timestamp(expires_at):
    if expires_at is None:
        return 0
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return int(expires_at.timestamp())


def _session_payload(connection, workspace, access_token):
    return {
        'access_token': access_token,
        'expires_at': _expires_at_timestamp(connection.expires_at),
        'scope': ' '.join(connection.scopes or []),
        'cloudid': connection.cloud_id or '',
        'site_url': connection.site_url or workspace.jira_site_url or '',
        'db_user_id': connection.user_id,
        'db_workspace_id': connection.workspace_id,
        'db_auth_connection_id': connection.id,
        'db_token_version': str(connection.token_version),
    }


def refresh_db_oauth_token(session, *, connection_id, config, key_provider, http_post):
    connection = _connection_for_update(session, connection_id)
    if connection is None or connection.status != 'active':
        raise AuthError('auth_connection_revoked', 'Your Jira connection needs to be reconnected.')
    workspace = session.get(models.Workspace, connection.workspace_id)
    access_row = _active_token(session, connection_id=connection.id, token_kind='access_token')
    if workspace is not None and access_row is not None:
        session_data = _session_payload(
            connection,
            workspace,
            _decrypt_token_row(
                access_row,
                workspace_id=workspace.id,
                connection_id=connection.id,
                key_provider=key_provider,
            ),
        )
        if not is_oauth_token_expired(session_data):
            return session_data
    refresh_row = _active_token(session, connection_id=connection.id, token_kind='refresh_token')
    if workspace is None or refresh_row is None:
        _revoke_for_refresh_reuse(session, connection=connection, cause='missing_refresh_token')

    refresh_token = _decrypt_token_row(
        refresh_row,
        workspace_id=workspace.id,
        connection_id=connection.id,
        key_provider=key_provider,
    )
    try:
        token_data = request_oauth_refresh_token(config, refresh_token, http_post=http_post)
    except AuthError as error:
        if error.code == 'refresh_reuse_detected':
            _revoke_for_refresh_reuse(session, connection=connection, cause='refresh_reuse_detected')
        raise

    expires_at = _expires_at(token_data)
    if not token_data.get('access_token') or expires_at is None:
        raise AuthError('auth_required', 'Atlassian authentication is required.')

    connection.expires_at = expires_at
    connection.status = 'active'
    connection.token_version = int(connection.token_version or 0) + 1
    if token_data.get('scope'):
        connection.scopes = _scope_list(token_data)
    connection.last_validated_at = datetime.now(timezone.utc)
    _replace_token(
        session,
        connection=connection,
        workspace=workspace,
        token_kind='access_token',
        plaintext=token_data.get('access_token') or '',
        key_provider=key_provider,
    )
    if token_data.get('refresh_token'):
        _replace_token(
            session,
            connection=connection,
            workspace=workspace,
            token_kind='refresh_token',
            plaintext=token_data.get('refresh_token') or '',
            key_provider=key_provider,
        )
    session.flush()
    return _session_payload(connection, workspace, token_data.get('access_token') or '')


def db_oauth_session_data(session, context, *, config, key_provider, http_post):
    connection = session.get(models.AuthConnection, context.auth_connection_id)
    if connection is None or connection.status != 'active':
        raise AuthError('auth_connection_revoked', 'Your Jira connection needs to be reconnected.')
    workspace = session.get(models.Workspace, connection.workspace_id)
    access_row = _active_token(session, connection_id=connection.id, token_kind='access_token')
    if workspace is None or access_row is None:
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    session_data = _session_payload(
        connection,
        workspace,
        _decrypt_token_row(
            access_row,
            workspace_id=workspace.id,
            connection_id=connection.id,
            key_provider=key_provider,
        ),
    )
    if is_oauth_token_expired(session_data):
        return refresh_db_oauth_token(
            session,
            connection_id=connection.id,
            config=config,
            key_provider=key_provider,
            http_post=http_post,
        )
    return session_data


def store_oauth_callback_tokens(
    session,
    *,
    token_data,
    resource,
    user_profile,
    environment_key,
    configured_jira_url,
    key_provider,
    requested_scopes='',
) -> StoredOAuthConnection:
    user = _upsert_user(session, user_profile)
    workspace = _upsert_workspace(
        session,
        environment_key=environment_key,
        resource=resource,
        configured_jira_url=configured_jira_url,
    )
    token_data_for_connection = dict(token_data or {})
    if requested_scopes and not token_data_for_connection.get('scope'):
        token_data_for_connection['scope'] = requested_scopes
    connection = _upsert_connection(session, user=user, workspace=workspace, resource=resource, token_data=token_data_for_connection)
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
