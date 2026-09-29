"""Revisioned workspace administrator configuration and team-catalog storage."""

from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy
import hashlib
import json

from sqlalchemy import Text, cast, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError

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


class WorkspaceConfigFenceUnavailable(RuntimeError):
    pass


def workspace_config_fence_key(workspace_id):
    raw = b'workspace-catalog-config-v1\0' + str(workspace_id).encode('utf-8')
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], 'big', signed=True)


def _remaining_milliseconds(budget):
    if budget is None:
        return 5000
    method = getattr(budget, 'remaining', None)
    if callable(method):
        try:
            remaining = method('workspace_config_fence')
        except TypeError:
            remaining = method()
    else:
        remaining = float(budget)
    if remaining <= 0:
        raise WorkspaceConfigFenceUnavailable('config_storage_unavailable')
    return max(1, min(5000, int(remaining * 1000)))


def acquire_workspace_config_fence(session, workspace_id, *, budget=None, nonblocking=False):
    if session.bind.dialect.name != 'postgresql':
        return True
    try:
        if nonblocking:
            return bool(session.execute(
                text('SELECT pg_try_advisory_xact_lock(:lock_key)'),
                {'lock_key': workspace_config_fence_key(workspace_id)},
            ).scalar())
        milliseconds = _remaining_milliseconds(budget)
        timeout_value = f'{milliseconds}ms'
        session.execute(
            text("SELECT set_config('lock_timeout', :timeout_value, true)"),
            {'timeout_value': timeout_value},
        )
        session.execute(
            text("SELECT set_config('statement_timeout', :timeout_value, true)"),
            {'timeout_value': timeout_value},
        )
        session.execute(
            text('SELECT pg_advisory_xact_lock(:lock_key)'),
            {'lock_key': workspace_config_fence_key(workspace_id)},
        )
        return True
    except DBAPIError as error:
        code = getattr(getattr(error, 'orig', None), 'sqlstate', None)
        if code in {'55P03', '57014'}:
            raise WorkspaceConfigFenceUnavailable('config_storage_unavailable') from None
        raise


def _decoded_payload(raw_payload):
    try:
        raw = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
    except (TypeError, ValueError):
        raw = {}
    payload = deepcopy(raw) if isinstance(raw, dict) else {}
    payload.pop('epm', None)
    return payload


def _snapshot(row):
    return WorkspaceConfigSnapshot(
        payload=_decoded_payload(row[0]),
        config_revision=int(row[1] or 0),
        source='workspace_db',
    )


def _current(session, workspace_id):
    return session.execute(
        select(
            cast(models.WorkspaceDashboardConfig.payload, Text),
            models.WorkspaceDashboardConfig.config_revision,
            models.WorkspaceDashboardConfig.payload_version,
        ).where(
            models.WorkspaceDashboardConfig.workspace_id == workspace_id,
        )
    ).first()


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
        return load_workspace_config_in_session(
            session, context, fallback_loader=fallback_loader, legacy_site_url=legacy_site_url,
        )


def load_workspace_config_in_session(
    session, context, *, fallback_loader=None, legacy_site_url='',
):
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
        acquire_workspace_config_fence(session, context.workspace_id)
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
            payload = _decoded_payload(row[0])
            payload[section] = normalized_value
            statement = (
                update(models.WorkspaceDashboardConfig)
                .where(
                    models.WorkspaceDashboardConfig.workspace_id == context.workspace_id,
                    models.WorkspaceDashboardConfig.config_revision == revision,
                )
                .values(
                    payload=payload,
                    payload_version=int(payload.get('version') or row[2] or 1),
                    config_revision=revision + 1,
                    updated_by=getattr(context, 'user_id', None),
                    updated_at=models._utcnow(),
                )
            )
            result = session.execute(statement.execution_options(synchronize_session=False))
            if result.rowcount != 1:
                session.expire_all()
                current = _current(session, context.workspace_id)
                raise WorkspaceConfigConflict(_snapshot(current), section)
            next_revision = revision + 1
        session.add(models.audit_event(
            workspace_id=context.workspace_id,
            actor_user_id=getattr(context, 'user_id', None),
            event_type='workspace_dashboard_config_updated',
            metadata={'section': section, 'revision': next_revision},
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
            acquire_workspace_config_fence(session, context.workspace_id)
            try:
                return merge_workspace_team_catalog_in_session(
                    session, context, incoming, merge=merge,
                )
            except (IntegrityError, TeamCatalogConflict):
                session.rollback()
                continue
    raise TeamCatalogConflict('team_catalog_conflict')


def merge_workspace_team_catalog_in_session(session, context, payload, *, merge):
    incoming = deepcopy(payload or {})
    nonblank_catalog = {
        key: {**value, 'name': str(value.get('name') or '').strip()}
        for key, value in (incoming.get('catalog') or {}).items()
        if isinstance(value, dict) and str(value.get('name') or '').strip()
    }
    incoming['catalog'] = nonblank_catalog
    row = session.execute(
        select(models.WorkspaceTeamCatalog).where(
            models.WorkspaceTeamCatalog.workspace_id == context.workspace_id,
        )
    ).scalars().first()
    if row is None:
        saved = incoming
        session.add(models.WorkspaceTeamCatalog(
            workspace_id=context.workspace_id, payload=saved, config_revision=1,
            updated_by=getattr(context, 'user_id', None),
        ))
        session.flush()
        return deepcopy(saved)
    revision = int(row.config_revision or 1)
    saved = deepcopy(incoming)
    if merge:
        existing = deepcopy(row.payload or {'catalog': {}, 'meta': {}})
        deltas = {
            key: value for key, value in (incoming.get('catalog') or {}).items()
            if isinstance(value, dict) and str(value.get('name') or '').strip()
        }
        saved = existing
        saved['catalog'] = {**(existing.get('catalog') or {}), **deltas}
        if incoming.get('meta'):
            saved['meta'] = {**(existing.get('meta') or {}), **incoming['meta']}
    result = session.execute(
        update(models.WorkspaceTeamCatalog)
        .where(
            models.WorkspaceTeamCatalog.workspace_id == context.workspace_id,
            models.WorkspaceTeamCatalog.config_revision == revision,
        )
        .values(
            payload=saved, config_revision=revision + 1,
            updated_by=getattr(context, 'user_id', None), updated_at=models._utcnow(),
        )
    )
    if result.rowcount != 1:
        raise TeamCatalogConflict('team_catalog_conflict')
    session.flush()
    return deepcopy(saved)
