"""SQLAlchemy models for database-backed auth state."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from backend.auth.token_crypto import redact_token_material


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def scenario_source_hash(source: dict) -> str:
    canonical = _canonical_scenario_source(source or {})
    payload = json.dumps(canonical, sort_keys=True, separators=(',', ':'))
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


def _canonical_scenario_source(source: dict) -> dict:
    canonical = {}
    for key in ['config', 'filters', 'issues', 'dependencies', 'sprintBoundaries', 'sprint_boundaries']:
        if key in source:
            canonical[key] = _canonical_scenario_value(key, source[key])
    return canonical


def _canonical_scenario_value(key: str, value: Any) -> Any:
    if key == 'issues' and isinstance(value, list):
        return sorted(
            (_canonical_scenario_value('', item) for item in value),
            key=lambda item: str(item.get('key') or '') if isinstance(item, dict) else '',
        )
    if key == 'dependencies' and isinstance(value, list):
        return sorted(
            (_canonical_scenario_value('', item) for item in value),
            key=lambda item: (
                str(item.get('from') or '') if isinstance(item, dict) else '',
                str(item.get('to') or '') if isinstance(item, dict) else '',
                str(item.get('type') or '') if isinstance(item, dict) else '',
            ),
        )
    if isinstance(value, dict):
        omitted_keys = {'auth', 'session', 'user'}
        return {
            item_key: _canonical_scenario_value(item_key, value[item_key])
            for item_key in sorted(value)
            if item_key not in omitted_keys
        }
    if isinstance(value, list):
        return [_canonical_scenario_value('', item) for item in value]
    return value


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = 'users'
    __table_args__ = (
        UniqueConstraint('external_provider', 'external_subject', name='uq_users_external_identity'),
        CheckConstraint("account_type in ('user', 'admin')", name='ck_users_account_type'),
        CheckConstraint("status in ('active', 'disabled', 'deleted')", name='ck_users_status'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    external_provider: Mapped[str] = mapped_column(String(64), nullable=False)
    external_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255))
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    account_type: Mapped[str] = mapped_column(String(32), nullable=False, default='user')
    status: Mapped[str] = mapped_column(String(32), nullable=False, default='active')
    created_by: Mapped[str] = mapped_column(String(255), nullable=False, default='system')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class Workspace(Base):
    __tablename__ = 'workspaces'
    __table_args__ = (
        Index(
            'uq_workspaces_environment_cloud',
            'environment_key',
            'jira_cloud_id',
            unique=True,
            sqlite_where=text('jira_cloud_id IS NOT NULL'),
            postgresql_where=text('jira_cloud_id IS NOT NULL'),
        ),
        Index(
            'uq_workspaces_environment_site',
            'environment_key',
            'jira_site_url',
            unique=True,
            sqlite_where=text('jira_site_url IS NOT NULL'),
            postgresql_where=text('jira_site_url IS NOT NULL'),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    environment_key: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    jira_site_url: Mapped[Optional[str]] = mapped_column(String(512))
    jira_cloud_id: Mapped[Optional[str]] = mapped_column(String(255))
    created_by: Mapped[str] = mapped_column(String(255), nullable=False, default='system')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class ViewConfig(Base):
    __tablename__ = 'view_configs'
    __table_args__ = (
        CheckConstraint("view_type in ('eng', 'epm', 'mixed')", name='ck_view_configs_type'),
        CheckConstraint("mode_policy in ('configuration')", name='ck_view_configs_mode_policy'),
        CheckConstraint("visibility in ('private')", name='ck_view_configs_visibility'),
        Index('ix_view_configs_owner_workspace', 'workspace_id', 'owner_user_id'),
        Index(
            'uq_view_configs_active_default',
            'workspace_id',
            'owner_user_id',
            unique=True,
            sqlite_where=text('is_default = 1 AND archived_at IS NULL'),
            postgresql_where=text('is_default IS TRUE AND archived_at IS NULL'),
        ),
        Index(
            'uq_view_configs_import_source',
            'workspace_id',
            'owner_user_id',
            'source_path',
            'source_hash',
            unique=True,
            sqlite_where=text('source_path IS NOT NULL AND source_hash IS NOT NULL'),
            postgresql_where=text('source_path IS NOT NULL AND source_hash IS NOT NULL'),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    view_type: Mapped[str] = mapped_column(String(32), nullable=False)
    mode_policy: Mapped[str] = mapped_column(String(32), nullable=False, default='configuration')
    payload_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    visibility: Mapped[str] = mapped_column(String(32), nullable=False, default='private')
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_path: Mapped[Optional[str]] = mapped_column(String(1024))
    source_hash: Mapped[Optional[str]] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class ViewConfigVersion(Base):
    __tablename__ = 'view_config_versions'
    __table_args__ = (
        UniqueConstraint('view_config_id', 'version_number', name='uq_view_config_versions_number'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    view_config_id: Mapped[str] = mapped_column(ForeignKey('view_configs.id', ondelete='CASCADE'), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    change_note: Mapped[Optional[str]] = mapped_column(String(255))


class ScenarioDraft(Base):
    __tablename__ = 'scenario_drafts'
    __table_args__ = (
        Index(
            'uq_scenario_drafts_active_scope',
            'workspace_id',
            'scope_key',
            unique=True,
            sqlite_where=text('archived_at IS NULL'),
            postgresql_where=text('archived_at IS NULL'),
        ),
        Index('ix_scenario_drafts_workspace_updated', 'workspace_id', 'updated_at'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    scope_key: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    scope_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    scenario_source_hash: Mapped[Optional[str]] = mapped_column(String(128))
    overrides: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class ScenarioDraftVersion(Base):
    __tablename__ = 'scenario_draft_versions'
    __table_args__ = (
        UniqueConstraint('scenario_draft_id', 'version_number', name='uq_scenario_draft_versions_number'),
        CheckConstraint(
            "source in ('user', 'legacy_json', 'rollback', 'reload_from_jira')",
            name='ck_scenario_draft_versions_source',
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scenario_draft_id: Mapped[str] = mapped_column(ForeignKey('scenario_drafts.id', ondelete='CASCADE'), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    scope_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    scenario_source_hash: Mapped[Optional[str]] = mapped_column(String(128))
    overrides: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    change_note: Mapped[Optional[str]] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(32), nullable=False)


class ScenarioDraftEvent(Base):
    __tablename__ = 'scenario_draft_events'
    __table_args__ = (
        UniqueConstraint('scenario_draft_id', 'event_number', name='uq_scenario_draft_events_number'),
        Index('ix_scenario_draft_events_draft_created', 'scenario_draft_id', 'created_at'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scenario_draft_id: Mapped[str] = mapped_column(ForeignKey('scenario_drafts.id', ondelete='CASCADE'), nullable=False)
    event_number: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class ScenarioDraftPresence(Base):
    __tablename__ = 'scenario_draft_presence'
    __table_args__ = (
        UniqueConstraint('scenario_draft_id', 'user_id', name='uq_scenario_draft_presence_user'),
        Index('ix_scenario_draft_presence_seen', 'scenario_draft_id', 'last_seen_at'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scenario_draft_id: Mapped[str] = mapped_column(ForeignKey('scenario_drafts.id', ondelete='CASCADE'), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    cursor_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class ScenarioDraftLock(Base):
    __tablename__ = 'scenario_draft_locks'
    __table_args__ = (
        UniqueConstraint(
            'scenario_draft_id',
            'resource_type',
            'resource_id',
            name='uq_scenario_draft_locks_resource',
        ),
        Index('ix_scenario_draft_locks_expires', 'scenario_draft_id', 'expires_at'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scenario_draft_id: Mapped[str] = mapped_column(ForeignKey('scenario_drafts.id', ondelete='CASCADE'), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(255), nullable=False)
    holder_user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    holder_display_name: Mapped[Optional[str]] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class AuthConnection(Base):
    __tablename__ = 'auth_connections'
    __table_args__ = (
        CheckConstraint(
            "provider in ('atlassian_oauth', 'jira_basic', 'atlassian_user_api_token', 'confluence_oauth')",
            name='ck_auth_connections_provider',
        ),
        CheckConstraint("status in ('active', 'expired', 'revoked', 'error')", name='ck_auth_connections_status'),
        Index(
            'uq_auth_connections_current_cloud',
            'user_id',
            'workspace_id',
            'provider',
            'cloud_id',
            unique=True,
            sqlite_where=text('cloud_id IS NOT NULL'),
            postgresql_where=text('cloud_id IS NOT NULL'),
        ),
        Index(
            'uq_auth_connections_current_site',
            'user_id',
            'workspace_id',
            'provider',
            'site_url',
            unique=True,
            sqlite_where=text('site_url IS NOT NULL'),
            postgresql_where=text('site_url IS NOT NULL'),
        ),
        Index(
            'uq_auth_connections_user_api_token_cloud',
            'user_id',
            'workspace_id',
            'cloud_id',
            unique=True,
            sqlite_where=text("provider = 'atlassian_user_api_token' AND cloud_id IS NOT NULL AND status != 'revoked'"),
            postgresql_where=text("provider = 'atlassian_user_api_token' AND cloud_id IS NOT NULL AND status != 'revoked'"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    site_url: Mapped[Optional[str]] = mapped_column(String(512))
    cloud_id: Mapped[Optional[str]] = mapped_column(String(255))
    credential_subject: Mapped[Optional[str]] = mapped_column(String(255))
    capabilities: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default=text("'[]'"))
    scopes: Mapped[Optional[list]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default='active')
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class AuthToken(Base):
    __tablename__ = 'auth_tokens'
    __table_args__ = (
        CheckConstraint("token_kind in ('access_token', 'refresh_token', 'api_token')", name='ck_auth_tokens_kind'),
        Index(
            'uq_auth_tokens_active_kind',
            'connection_id',
            'token_kind',
            unique=True,
            sqlite_where=text('revoked_at IS NULL'),
            postgresql_where=text('revoked_at IS NULL'),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    connection_id: Mapped[str] = mapped_column(ForeignKey('auth_connections.id', ondelete='CASCADE'), nullable=False)
    token_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(64), nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    nonce: Mapped[str] = mapped_column(String(255), nullable=False)
    wrapped_dek: Mapped[str] = mapped_column(Text, nullable=False)
    key_id: Mapped[str] = mapped_column(String(255), nullable=False)
    aad_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    rotated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class ServiceIntegration(Base):
    __tablename__ = 'service_integrations'
    __table_args__ = (
        CheckConstraint("provider in ('jira_basic', 'home_townsquare_basic')", name='ck_service_integrations_provider'),
        CheckConstraint(
            "status in ('active', 'disabled', 'expired', 'revoked', 'error')",
            name='ck_service_integrations_status',
        ),
        Index(
            'uq_service_integrations_active_provider',
            'workspace_id',
            'provider',
            unique=True,
            sqlite_where=text("status = 'active'"),
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    credential_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default='active')
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_validated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    updated_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class ServiceIntegrationToken(Base):
    __tablename__ = 'service_integration_tokens'
    __table_args__ = (
        CheckConstraint("token_kind in ('api_token')", name='ck_service_integration_tokens_kind'),
        Index(
            'uq_service_integration_tokens_active_kind',
            'service_integration_id',
            'token_kind',
            unique=True,
            sqlite_where=text('revoked_at IS NULL'),
            postgresql_where=text('revoked_at IS NULL'),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    service_integration_id: Mapped[str] = mapped_column(ForeignKey('service_integrations.id', ondelete='CASCADE'), nullable=False)
    token_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(64), nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    nonce: Mapped[str] = mapped_column(String(255), nullable=False)
    wrapped_dek: Mapped[str] = mapped_column(Text, nullable=False)
    key_id: Mapped[str] = mapped_column(String(255), nullable=False)
    aad_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    rotated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class JiraProjectAccess(Base):
    __tablename__ = 'jira_project_access'
    __table_args__ = (
        UniqueConstraint(
            'connection_id',
            'workspace_id',
            'project_key',
            'project_type',
            name='uq_jira_project_access_project',
        ),
        CheckConstraint("project_type in ('product', 'tech', 'other')", name='ck_jira_project_access_type'),
        CheckConstraint("status in ('accessible', 'inaccessible', 'unknown')", name='ck_jira_project_access_status'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    connection_id: Mapped[str] = mapped_column(ForeignKey('auth_connections.id', ondelete='CASCADE'), nullable=False)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    project_key: Mapped[str] = mapped_column(String(64), nullable=False)
    project_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default='unknown')
    error_code: Mapped[Optional[str]] = mapped_column(String(128))
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class AuditEvent(Base):
    __tablename__ = 'audit_events'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False)
    actor_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    target_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('users.id', ondelete='SET NULL'))
    auth_connection_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey('auth_connections.id', ondelete='SET NULL'))
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    event_metadata: Mapped[Optional[dict]] = mapped_column('metadata', JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


def _strip_callback_query(value: str) -> str:
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc or not parsed.query:
        return value
    if 'callback' not in parsed.path.lower():
        return value
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))


def redact_audit_metadata(metadata):
    redacted = redact_token_material(metadata or {})
    return _redact_audit_urls(redacted)


def _redact_audit_urls(value):
    if isinstance(value, dict):
        return {
            key: _strip_callback_query(item) if isinstance(item, str) else _redact_audit_urls(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_audit_urls(item) for item in value]
    return value


def audit_event(
    *,
    workspace_id: str,
    event_type: str,
    metadata: dict | None = None,
    actor_user_id: str | None = None,
    target_user_id: str | None = None,
    auth_connection_id: str | None = None,
) -> AuditEvent:
    return AuditEvent(
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        auth_connection_id=auth_connection_id,
        event_type=event_type,
        event_metadata=redact_audit_metadata(metadata),
    )
