"""Workspace service-integration credential helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from backend.auth.token_crypto import encrypt_token
from backend.db import models


SERVICE_INTEGRATION_PROVIDERS = {'jira_basic', 'home_townsquare_basic'}
_SUMMARY_CACHE: dict[tuple[str, int], dict] = {}


def _utcnow():
    return datetime.now(timezone.utc)


def _iso(value):
    if value is None:
        return None
    return value.isoformat().replace('+00:00', 'Z')


def invalidate_service_integration_cache(service_integration_id: str | None = None) -> None:
    if service_integration_id is None:
        _SUMMARY_CACHE.clear()
        return
    for key in list(_SUMMARY_CACHE):
        if key[0] == service_integration_id:
            del _SUMMARY_CACHE[key]


def _replace_service_token(session, *, integration, api_token, key_provider):
    session.query(models.ServiceIntegrationToken).filter(
        models.ServiceIntegrationToken.service_integration_id == integration.id,
        models.ServiceIntegrationToken.revoked_at.is_(None),
    ).delete(synchronize_session=False)
    envelope = encrypt_token(
        api_token,
        workspace_id=integration.workspace_id,
        service_integration_id=integration.id,
        token_kind='api_token',
        key_provider=key_provider,
    )
    session.add(models.ServiceIntegrationToken(
        service_integration_id=integration.id,
        token_kind='api_token',
        algorithm=envelope.algorithm,
        ciphertext=envelope.ciphertext,
        nonce=envelope.nonce,
        wrapped_dek=envelope.wrapped_dek,
        key_id=envelope.key_id,
        aad_hash=envelope.aad_hash,
        rotated_at=_utcnow(),
    ))


def seed_service_integration(
    session,
    *,
    workspace_id: str,
    provider: str,
    credential_subject: str,
    api_token: str,
    actor_user_id: str | None,
    key_provider,
):
    provider = str(provider or '').strip()
    credential_subject = str(credential_subject or '').strip()
    if provider not in SERVICE_INTEGRATION_PROVIDERS:
        raise ValueError('Unsupported service integration provider.')
    if not credential_subject:
        raise ValueError('credential_subject is required.')
    if not api_token:
        raise ValueError('api_token is required.')

    integration = session.execute(
        select(models.ServiceIntegration).where(
            models.ServiceIntegration.workspace_id == workspace_id,
            models.ServiceIntegration.provider == provider,
            models.ServiceIntegration.status == 'active',
        )
    ).scalars().first()
    if integration is None:
        integration = models.ServiceIntegration(
            workspace_id=workspace_id,
            provider=provider,
            credential_subject=credential_subject,
            status='active',
            token_version=1,
            created_by=actor_user_id,
            updated_by=actor_user_id,
        )
        session.add(integration)
        session.flush()
    else:
        integration.credential_subject = credential_subject
        integration.status = 'active'
        integration.token_version = int(integration.token_version or 0) + 1
        integration.updated_by = actor_user_id
    integration.last_validated_at = _utcnow()
    _replace_service_token(
        session,
        integration=integration,
        api_token=api_token,
        key_provider=key_provider,
    )
    session.add(models.audit_event(
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        event_type='service_integration_seeded',
        metadata={'provider': provider, 'credential_subject': credential_subject},
    ))
    session.flush()
    invalidate_service_integration_cache(integration.id)
    return integration


def _summary(integration):
    return {
        'id': integration.id,
        'workspaceId': integration.workspace_id,
        'provider': integration.provider,
        'credentialSubject': integration.credential_subject,
        'status': integration.status,
        'tokenVersion': int(integration.token_version or 0),
        'lastValidatedAt': _iso(integration.last_validated_at),
        'expiresAt': _iso(integration.expires_at),
        'createdBy': integration.created_by,
        'updatedBy': integration.updated_by,
        'createdAt': _iso(integration.created_at),
        'updatedAt': _iso(integration.updated_at),
    }


def get_service_integration_summary(session, service_integration_id: str):
    integration = session.get(models.ServiceIntegration, service_integration_id)
    if integration is None:
        return None
    key = (integration.id, int(integration.token_version or 0))
    cached = _SUMMARY_CACHE.get(key)
    if cached is not None:
        return dict(cached)
    for existing in list(_SUMMARY_CACHE):
        if existing[0] == integration.id:
            del _SUMMARY_CACHE[existing]
    summary = _summary(integration)
    _SUMMARY_CACHE[key] = dict(summary)
    return summary


def list_service_integration_summaries(session, workspace_id: str) -> list[dict]:
    integrations = session.execute(
        select(models.ServiceIntegration)
        .where(models.ServiceIntegration.workspace_id == workspace_id)
        .order_by(models.ServiceIntegration.provider)
    ).scalars().all()
    return [get_service_integration_summary(session, integration.id) for integration in integrations]
