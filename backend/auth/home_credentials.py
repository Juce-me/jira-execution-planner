"""Home/Townsquare credential resolution for DB-backed auth."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select

from backend.auth.jira_auth import AuthError
from backend.auth.key_provider import key_provider_from_env
from backend.auth.token_crypto import decrypt_token
from backend.db import engine as db_engine
from backend.db import models


READ_EPM_METADATA = 'read_metadata'
READ_METADATA = READ_EPM_METADATA
WRITE_AS_USER = 'write_as_user'


@dataclass(frozen=True)
class HomeCredential:
    credential_type: str
    provider: str
    email: str
    api_token: str = field(repr=False)
    workspace_id: str = ''
    site_url: str = ''
    cloud_id: str = ''
    cache_key: tuple = field(default_factory=tuple)


def _token_envelope(token):
    return {
        'algorithm': token.algorithm,
        'ciphertext': token.ciphertext,
        'nonce': token.nonce,
        'wrapped_dek': token.wrapped_dek,
        'key_id': token.key_id,
        'aad_hash': token.aad_hash,
    }


def _active_service_token(session, integration_id):
    return session.execute(
        select(models.ServiceIntegrationToken)
        .where(
            models.ServiceIntegrationToken.service_integration_id == integration_id,
            models.ServiceIntegrationToken.token_kind == 'api_token',
            models.ServiceIntegrationToken.revoked_at.is_(None),
        )
    ).scalars().first()


def _active_auth_token(session, connection_id):
    return session.execute(
        select(models.AuthToken)
        .where(
            models.AuthToken.connection_id == connection_id,
            models.AuthToken.token_kind == 'api_token',
            models.AuthToken.revoked_at.is_(None),
        )
    ).scalars().first()


def _require_active_user_and_oauth(session, context):
    user = session.get(models.User, context.user_id)
    if user is None or user.status != 'active':
        raise AuthError('account_disabled', 'Your account is disabled.')
    oauth_connection = session.get(models.AuthConnection, context.auth_connection_id)
    if (
        oauth_connection is None
        or oauth_connection.provider != 'atlassian_oauth'
        or oauth_connection.workspace_id != context.workspace_id
        or oauth_connection.user_id != context.user_id
        or oauth_connection.status != 'active'
    ):
        raise AuthError('auth_connection_revoked', 'Your Jira connection needs to be reconnected.')
    return user, oauth_connection


def _resolve_service_credential(session, context, key_provider):
    integration = session.execute(
        select(models.ServiceIntegration).where(
            models.ServiceIntegration.workspace_id == context.workspace_id,
            models.ServiceIntegration.provider == 'home_townsquare_basic',
            models.ServiceIntegration.status == 'active',
        )
    ).scalars().first()
    if integration is None:
        raise AuthError('home_service_credential_required', 'Home/Townsquare service credentials are required.')
    token = _active_service_token(session, integration.id)
    if token is None:
        raise AuthError('home_service_credential_required', 'Home/Townsquare service credentials are required.')
    return HomeCredential(
        credential_type='service',
        provider=integration.provider,
        email=integration.credential_subject,
        api_token=decrypt_token(
            _token_envelope(token),
            workspace_id=context.workspace_id,
            service_integration_id=integration.id,
            token_kind='api_token',
            key_provider=key_provider,
        ),
        workspace_id=context.workspace_id,
        site_url=context.site_url,
        cloud_id=context.cloud_id,
        cache_key=(context.workspace_id, integration.id, int(integration.token_version or 0)),
    )


def _user_token_connection(session, context):
    statement = select(models.AuthConnection).where(
        models.AuthConnection.user_id == context.user_id,
        models.AuthConnection.workspace_id == context.workspace_id,
        models.AuthConnection.provider == 'atlassian_user_api_token',
    )
    if context.cloud_id:
        statement = statement.where(models.AuthConnection.cloud_id == context.cloud_id)
    else:
        statement = statement.where(models.AuthConnection.site_url == context.site_url)
    return session.execute(statement).scalars().first()


def _resolve_user_credential(session, context, key_provider, *, missing_message):
    connection = _user_token_connection(session, context)
    if connection is None:
        raise AuthError('home_user_token_required', missing_message)
    if connection.status != 'active':
        raise AuthError('auth_connection_revoked', 'Your Jira Home token connection needs to be reconnected.')
    if 'home_townsquare_graphql' not in (connection.capabilities or []):
        raise AuthError('home_user_token_required', missing_message)
    token = _active_auth_token(session, connection.id)
    if token is None:
        raise AuthError('home_user_token_required', missing_message)
    return HomeCredential(
        credential_type='user',
        provider=connection.provider,
        email=connection.credential_subject,
        api_token=decrypt_token(
            _token_envelope(token),
            workspace_id=context.workspace_id,
            auth_connection_id=connection.id,
            token_kind='api_token',
            key_provider=key_provider,
        ),
        workspace_id=context.workspace_id,
        site_url=context.site_url,
        cloud_id=context.cloud_id,
        cache_key=(context.workspace_id, context.user_id, connection.id, int(connection.token_version or 0)),
    )


def resolve_home_credential(context, purpose, *, database_url: str | None = None, key_provider=None):
    if purpose not in {READ_EPM_METADATA, WRITE_AS_USER}:
        raise ValueError('Unsupported Home credential purpose.')
    key_provider = key_provider or key_provider_from_env()
    with db_engine.session_factory(database_url)() as session:
        _require_active_user_and_oauth(session, context)
        if purpose == READ_EPM_METADATA:
            return _resolve_user_credential(
                session,
                context,
                key_provider,
                missing_message='Connect your Atlassian API token to load EPM Home projects.',
            )
        return _resolve_user_credential(
            session,
            context,
            key_provider,
            missing_message='Connect your Atlassian API token to edit Jira Home as yourself.',
        )
