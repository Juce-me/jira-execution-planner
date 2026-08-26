"""Revisioned workspace administrator configuration and team-catalog storage."""

from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.config.shared_config import (
    ADMIN_CONFIG_SECTIONS,
    legacy_fallback_matches_workspace,
    normalize_workspace_admin_payload,
)
from backend.db import engine as db_engine
from backend.db import models


@dataclass(frozen=True)
class WorkspaceConfigSnapshot:
    payload: dict
    config_revision: int
    source: str


class WorkspaceConfigConflict(Exception):
    def __init__(self, current, section):
        super().__init__('workspace_config_conflict')
        self.current = current
        self.section = section


class TeamCatalogConflict(Exception):
    pass


def _snapshot(row):
    return WorkspaceConfigSnapshot(
        payload=deepcopy(row.payload or {}),
        config_revision=int(row.config_revision or 0),
        source='workspace_db',
    )


def _current(session, workspace_id):
    return session.execute(
        select(models.WorkspaceDashboardConfig).where(
            models.WorkspaceDashboardConfig.workspace_id == workspace_id,
        )
    ).scalars().first()


def _fallback_snapshot(context, fallback_loader, legacy_site_url):
    if fallback_loader is None or not legacy_fallback_matches_workspace(context, legacy_site_url):
        return WorkspaceConfigSnapshot({}, 0, 'empty')
    raw = fallback_loader()
    if raw is None:
        return WorkspaceConfigSnapshot({}, 0, 'empty')
    payload = normalize_workspace_admin_payload(raw, allow_legacy_excluded_fields=True)
    return WorkspaceConfigSnapshot(payload, 0, 'legacy_json')


def load_workspace_config(context, *, fallback_loader=None, legacy_site_url='', database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = _current(session, context.workspace_id)
        if row is not None:
            return _snapshot(row)
    return _fallback_snapshot(context, fallback_loader, legacy_site_url)


def _revision(value):
    if isinstance(value, bool):
        raise ValueError('baseRevision must be a non-negative integer')
    try:
        value = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError('baseRevision must be a non-negative integer') from error
    if value < 0:
        raise ValueError('baseRevision must be a non-negative integer')
    return value


def update_workspace_config_section(
    context,
    section,
    value,
    base_revision,
    *,
    fallback_loader=None,
    legacy_site_url='',
    database_url=None,
):
    if section not in ADMIN_CONFIG_SECTIONS:
        raise ValueError('unsupported workspace configuration section')
    revision = _revision(base_revision)
    normalized_value = normalize_workspace_admin_payload({section: value})[section]
    with db_engine.session_scope(database_url) as session:
        row = _current(session, context.workspace_id)
        if row is None:
            if revision != 0:
                raise WorkspaceConfigConflict(WorkspaceConfigSnapshot({}, 0, 'empty'), section)
            baseline = _fallback_snapshot(context, fallback_loader, legacy_site_url)
            payload = deepcopy(baseline.payload)
            payload[section] = normalized_value
            row = models.WorkspaceDashboardConfig(
                workspace_id=context.workspace_id,
                payload_version=int(payload.get('version') or 1),
                payload=payload,
                config_revision=1,
                created_by=getattr(context, 'user_id', None),
                updated_by=getattr(context, 'user_id', None),
            )
            session.add(row)
            try:
                session.flush()
            except IntegrityError:
                session.rollback()
                with db_engine.session_scope(database_url) as fresh:
                    current = _current(fresh, context.workspace_id)
                    raise WorkspaceConfigConflict(_snapshot(current), section)
            next_revision = 1
        else:
            payload = deepcopy(row.payload or {})
            payload[section] = normalized_value
            statement = (
                update(models.WorkspaceDashboardConfig)
                .where(
                    models.WorkspaceDashboardConfig.workspace_id == context.workspace_id,
                    models.WorkspaceDashboardConfig.config_revision == revision,
                )
                .values(
                    payload=payload,
                    payload_version=int(payload.get('version') or row.payload_version or 1),
                    config_revision=revision + 1,
                    updated_by=getattr(context, 'user_id', None),
                    updated_at=models._utcnow(),
                )
            )
            if session.execute(statement).rowcount != 1:
                current = _current(session, context.workspace_id)
                raise WorkspaceConfigConflict(_snapshot(current), section)
            next_revision = revision + 1
        session.add(models.AuditEvent(
            workspace_id=context.workspace_id,
            actor_user_id=getattr(context, 'user_id', None),
            event_type='workspace_dashboard_config_updated',
            event_metadata={'section': section, 'revision': next_revision},
        ))
        session.flush()
        return WorkspaceConfigSnapshot(payload, next_revision, 'workspace_db')


def load_workspace_team_catalog(context, *, database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.WorkspaceTeamCatalog).where(
                models.WorkspaceTeamCatalog.workspace_id == context.workspace_id,
            )
        ).scalars().first()
        return deepcopy(row.payload or {}) if row is not None else {'catalog': {}, 'meta': {}}


def save_workspace_team_catalog(context, payload, *, merge=False, database_url=None):
    incoming = deepcopy(payload or {})
    for _attempt in range(3):
        with db_engine.session_scope(database_url) as session:
            row = session.execute(
                select(models.WorkspaceTeamCatalog).where(
                    models.WorkspaceTeamCatalog.workspace_id == context.workspace_id,
                )
            ).scalars().first()
            if row is None:
                saved = incoming
                candidate = models.WorkspaceTeamCatalog(
                    workspace_id=context.workspace_id,
                    payload=saved,
                    config_revision=1,
                    updated_by=getattr(context, 'user_id', None),
                )
                session.add(candidate)
                try:
                    session.flush()
                    return deepcopy(saved)
                except IntegrityError:
                    session.rollback()
                    continue
            revision = int(row.config_revision or 1)
            saved = deepcopy(incoming)
            if merge:
                existing = deepcopy(row.payload or {'catalog': {}, 'meta': {}})
                saved['catalog'] = {**(existing.get('catalog') or {}), **(incoming.get('catalog') or {})}
            result = session.execute(
                update(models.WorkspaceTeamCatalog)
                .where(
                    models.WorkspaceTeamCatalog.workspace_id == context.workspace_id,
                    models.WorkspaceTeamCatalog.config_revision == revision,
                )
                .values(
                    payload=saved,
                    config_revision=revision + 1,
                    updated_by=getattr(context, 'user_id', None),
                    updated_at=models._utcnow(),
                )
            )
            if result.rowcount == 1:
                return deepcopy(saved)
    raise TeamCatalogConflict('team_catalog_conflict')
