"""User-owned Atlassian API token helpers for Home/Townsquare writes."""

from __future__ import annotations

import base64
from datetime import datetime, timezone

from sqlalchemy import select

from backend.auth.token_crypto import encrypt_token
from backend.db import models
from backend.epm import home as epm_home


HOME_USER_TOKEN_PROVIDER = 'atlassian_user_api_token'
HOME_USER_TOKEN_CAPABILITY = 'home_townsquare_graphql'


class UserApiTokenError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def _utcnow():
    return datetime.now(timezone.utc)


def _iso(value):
    if value is None:
        return None
    return value.isoformat().replace('+00:00', 'Z')


def _basic_auth_header(email: str, api_token: str) -> str:
    encoded = base64.b64encode(f'{email}:{api_token}'.encode('utf-8')).decode('ascii')
    return f'Basic {encoded}'


def fetch_jira_myself_with_basic_auth(site_url: str, email: str, api_token: str, *, http_get):
    normalized_site = str(site_url or '').strip().rstrip('/')
    if not normalized_site:
        raise UserApiTokenError('jira_site_required', 'Jira site is required to validate this credential.')
    response = http_get(
        f'{normalized_site}/rest/api/3/myself',
        headers={
            'Accept': 'application/json',
            'Authorization': _basic_auth_header(email, api_token),
        },
        timeout=20,
    )
    if response.status_code in {401, 403}:
        raise UserApiTokenError('credential_not_authorized', 'The supplied Atlassian API token was rejected by Jira.')
    if response.status_code != 200:
        raise UserApiTokenError('credential_validation_failed', 'The supplied Atlassian API token could not be validated.')
    try:
        payload = response.json()
    except ValueError as exc:
        raise UserApiTokenError('credential_validation_failed', 'Jira returned an invalid credential validation response.') from exc
    if not isinstance(payload, dict):
        raise UserApiTokenError('credential_validation_failed', 'Jira returned an invalid credential validation response.')
    return payload


def probe_home_basic_credential(email: str, api_token: str, *, cloud_id: str) -> bool:
    try:
        client = epm_home.HomeGraphQLClient(email, api_token)
        client.execute(
            epm_home.QUERY_GOALS_SEARCH,
            {
                'containerId': epm_home._container_id_from_cloud(cloud_id),
                'first': 1,
            },
        )
        return True
    except (epm_home.HomeAuthenticationError, epm_home.HomeGraphQLError, epm_home.HomeRateLimitError, RuntimeError):
        return False


def home_token_connection_for_context(session, context):
    statement = select(models.AuthConnection).where(
        models.AuthConnection.user_id == context.user_id,
        models.AuthConnection.workspace_id == context.workspace_id,
        models.AuthConnection.provider == HOME_USER_TOKEN_PROVIDER,
    )
    if context.cloud_id:
        statement = statement.where(models.AuthConnection.cloud_id == context.cloud_id)
    else:
        statement = statement.where(models.AuthConnection.site_url == context.site_url)
    return session.execute(statement).scalars().first()


def home_token_summary(connection):
    if connection is None or connection.status == 'revoked':
        return {'connected': False}
    return {
        'connected': True,
        'provider': connection.provider,
        'credentialSubject': connection.credential_subject,
        'status': connection.status,
        'lastValidatedAt': _iso(connection.last_validated_at),
        'needsReconnect': connection.status != 'active',
    }


def _replace_api_token(session, *, connection, api_token, key_provider):
    session.query(models.AuthToken).filter(
        models.AuthToken.connection_id == connection.id,
        models.AuthToken.revoked_at.is_(None),
    ).delete(synchronize_session=False)
    envelope = encrypt_token(
        api_token,
        workspace_id=connection.workspace_id,
        auth_connection_id=connection.id,
        token_kind='api_token',
        key_provider=key_provider,
    )
    session.add(models.AuthToken(
        connection_id=connection.id,
        token_kind='api_token',
        algorithm=envelope.algorithm,
        ciphertext=envelope.ciphertext,
        nonce=envelope.nonce,
        wrapped_dek=envelope.wrapped_dek,
        key_id=envelope.key_id,
        aad_hash=envelope.aad_hash,
        rotated_at=_utcnow(),
    ))


def connect_home_user_api_token(
    session,
    *,
    context,
    email: str,
    api_token: str,
    key_provider,
    http_get,
):
    email = str(email or '').strip()
    api_token = str(api_token or '')
    if not email:
        raise UserApiTokenError('credential_email_required', 'Email is required to connect an Atlassian API token.')
    if not api_token:
        raise UserApiTokenError('credential_api_token_required', 'API token is required.')

    myself = fetch_jira_myself_with_basic_auth(
        context.site_url,
        email,
        api_token,
        http_get=http_get,
    )
    if str(myself.get('accountId') or '') != str(context.atlassian_account_id or ''):
        raise UserApiTokenError(
            'credential_subject_mismatch',
            'The supplied Atlassian API token belongs to a different Atlassian account.',
        )
    if not probe_home_basic_credential(email, api_token, cloud_id=context.cloud_id):
        raise UserApiTokenError(
            'home_credential_not_authorized',
            'The supplied Atlassian API token is not authorized for Jira Home.',
        )

    connection = home_token_connection_for_context(session, context)
    if connection is None:
        connection = models.AuthConnection(
            user_id=context.user_id,
            workspace_id=context.workspace_id,
            provider=HOME_USER_TOKEN_PROVIDER,
            token_version=1,
        )
        session.add(connection)
    else:
        connection.token_version = int(connection.token_version or 0) + 1
    connection.site_url = context.site_url
    connection.cloud_id = context.cloud_id or None
    connection.credential_subject = email
    connection.capabilities = [HOME_USER_TOKEN_CAPABILITY]
    connection.status = 'active'
    connection.last_validated_at = _utcnow()
    session.flush()

    _replace_api_token(
        session,
        connection=connection,
        api_token=api_token,
        key_provider=key_provider,
    )
    session.add(models.audit_event(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        auth_connection_id=connection.id,
        event_type='user_api_token_connected',
        metadata={
            'provider': HOME_USER_TOKEN_PROVIDER,
            'credentialSubject': email,
            'capabilities': [HOME_USER_TOKEN_CAPABILITY],
        },
    ))
    session.flush()
    return connection


def revoke_home_user_api_token(session, *, context):
    connection = home_token_connection_for_context(session, context)
    if connection is None or connection.status == 'revoked':
        return None
    session.query(models.AuthToken).filter(
        models.AuthToken.connection_id == connection.id,
        models.AuthToken.revoked_at.is_(None),
    ).delete(synchronize_session=False)
    connection.status = 'revoked'
    connection.token_version = int(connection.token_version or 0) + 1
    session.add(models.audit_event(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        auth_connection_id=connection.id,
        event_type='user_api_token_revoked',
        metadata={'provider': HOME_USER_TOKEN_PROVIDER},
    ))
    session.flush()
    return connection
