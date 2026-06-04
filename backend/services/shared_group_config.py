"""Workspace-shared department group catalog and user visibility helpers."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.auth.db_context import is_db_auth_context
from backend.db import engine as db_engine
from backend.db import models


GROUPS_SOURCE_DB = 'workspace_db'
GROUPS_SOURCE_JSON = 'file'
GROUPS_PAYLOAD_VERSION = 1


class GroupConfigConflict(Exception):
    def __init__(self, current):
        super().__init__('group_config_conflict')
        self.current = current


class InvalidSharedGroupConfig(ValueError):
    def __init__(self, errors, warnings=None):
        self.errors = tuple(errors or ())
        self.warnings = tuple(warnings or ())
        super().__init__('invalid_groups_config')


class InvalidGroupPreferences(ValueError):
    pass


def _group_ids(groups_config):
    return [
        str(group.get('id') or '').strip()
        for group in (groups_config or {}).get('groups') or []
        if str(group.get('id') or '').strip()
    ]


def _empty_groups_config(*, revision=1, source=GROUPS_SOURCE_DB):
    return {
        'version': GROUPS_PAYLOAD_VERSION,
        'groups': [],
        'defaultGroupId': '',
        'configRevision': int(revision or 1),
        'source': source,
    }


def _row_to_groups_config(row):
    payload = dict(row.payload or {})
    payload.setdefault('version', int(row.payload_version or GROUPS_PAYLOAD_VERSION))
    payload.setdefault('groups', [])
    payload.setdefault('defaultGroupId', '')
    payload['configRevision'] = int(row.config_revision or 1)
    payload['source'] = GROUPS_SOURCE_DB
    return payload


def _normalize_shared_payload(payload, validate_groups_config_fn):
    normalized, errors, warnings = validate_groups_config_fn(payload or {}, allow_empty=True)
    if errors:
        raise InvalidSharedGroupConfig(errors, warnings)
    normalized = dict(normalized or {})
    normalized.setdefault('version', GROUPS_PAYLOAD_VERSION)
    normalized.setdefault('groups', [])
    normalized.setdefault('defaultGroupId', '')
    return normalized, list(warnings or [])


def _legacy_team_groups(fallback_payload):
    if not isinstance(fallback_payload, dict):
        return None
    team_groups = fallback_payload.get('teamGroups')
    return team_groups if isinstance(team_groups, dict) else None


def ensure_workspace_group_config(session, context, payload, validate_groups_config_fn):
    existing = session.execute(
        select(models.WorkspaceGroupConfig).where(
            models.WorkspaceGroupConfig.workspace_id == context.workspace_id,
        )
    ).scalars().first()
    if existing is not None:
        return existing

    normalized, _warnings = _normalize_shared_payload(
        payload or _empty_groups_config(),
        validate_groups_config_fn,
    )
    row = models.WorkspaceGroupConfig(
        workspace_id=context.workspace_id,
        payload_version=int(normalized.get('version') or GROUPS_PAYLOAD_VERSION),
        payload=normalized,
        config_revision=1,
        created_by=getattr(context, 'user_id', None),
        updated_by=getattr(context, 'user_id', None),
    )
    session.add(row)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise
    return row


def current_shared_groups_config(session, context):
    row = session.execute(
        select(models.WorkspaceGroupConfig).where(
            models.WorkspaceGroupConfig.workspace_id == context.workspace_id,
        )
    ).scalars().first()
    if row is None:
        return _empty_groups_config()
    return _row_to_groups_config(row)


def load_shared_groups(context, fallback_loader, validate_groups_config_fn, database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.WorkspaceGroupConfig).where(
                models.WorkspaceGroupConfig.workspace_id == context.workspace_id,
            )
        ).scalars().first()
        if row is not None:
            return _row_to_groups_config(row)

        fallback_payload = fallback_loader() if fallback_loader is not None else None
        legacy_config = _legacy_team_groups(fallback_payload)
        try:
            row = ensure_workspace_group_config(
                session,
                context,
                legacy_config or _empty_groups_config(),
                validate_groups_config_fn,
            )
        except IntegrityError as exc:
            raise GroupConfigConflict(current_shared_groups_config(session, context)) from exc
        return _row_to_groups_config(row)


def save_shared_groups(context, payload, base_revision, validate_groups_config_fn, database_url=None):
    try:
        revision = int(base_revision)
    except (TypeError, ValueError) as exc:
        raise InvalidSharedGroupConfig(['baseRevision is required.']) from exc
    if revision < 1:
        raise InvalidSharedGroupConfig(['baseRevision is required.'])

    normalized, warnings = _normalize_shared_payload(payload, validate_groups_config_fn)
    with db_engine.session_scope(database_url) as session:
        statement = (
            update(models.WorkspaceGroupConfig)
            .where(
                models.WorkspaceGroupConfig.workspace_id == context.workspace_id,
                models.WorkspaceGroupConfig.config_revision == revision,
            )
            .values(
                payload=normalized,
                payload_version=int(normalized.get('version') or GROUPS_PAYLOAD_VERSION),
                config_revision=revision + 1,
                updated_by=getattr(context, 'user_id', None),
                updated_at=models._utcnow(),
            )
        )
        result = session.execute(statement)
        if result.rowcount != 1:
            current = current_shared_groups_config(session, context)
            raise GroupConfigConflict(current)
        saved = dict(normalized)
        saved['configRevision'] = revision + 1
        saved['source'] = GROUPS_SOURCE_DB
        if warnings:
            saved['warnings'] = warnings
        return saved


def _dedupe_known_group_ids(values, known_ids):
    known = set(known_ids)
    seen = set()
    normalized = []
    for raw in values or []:
        group_id = str(raw or '').strip()
        if not group_id or group_id in seen or group_id not in known:
            continue
        seen.add(group_id)
        normalized.append(group_id)
    return normalized


def effective_visible_group_ids(groups_config, preferences):
    ids = _group_ids(groups_config)
    if not ids:
        return []
    if preferences and preferences.get('onboardingRequired'):
        return []
    customized = bool((preferences or {}).get('customized'))
    if not customized:
        return ids
    visible = _dedupe_known_group_ids((preferences or {}).get('visibleGroupIds') or [], ids)
    default_group_id = str((groups_config or {}).get('defaultGroupId') or '').strip()
    if default_group_id and default_group_id in ids and default_group_id not in visible:
        visible.insert(0, default_group_id)
    return visible


def _resolve_active_group_id(groups_config, visible_ids, active_group_id):
    active = str(active_group_id or '').strip()
    if active and active in visible_ids:
        return active
    default_group_id = str((groups_config or {}).get('defaultGroupId') or '').strip()
    if default_group_id and default_group_id in visible_ids:
        return default_group_id
    return visible_ids[0] if visible_ids else None


def normalize_group_preferences(payload, groups_config, preference_exists=True, require_first_run=False):
    payload = payload or {}
    ids = _group_ids(groups_config)
    if require_first_run and not preference_exists:
        return {
            'customized': False,
            'preferenceExists': False,
            'onboardingRequired': True,
            'visibleGroupIds': [],
            'activeGroupId': None,
            'effectiveVisibleGroupIds': [],
        }

    visible = _dedupe_known_group_ids(payload.get('visibleGroupIds') or [], ids)
    customized = bool(payload.get('customized', preference_exists))
    preferences = {
        'customized': customized,
        'preferenceExists': bool(preference_exists),
        'onboardingRequired': False,
        'visibleGroupIds': visible,
    }
    effective = effective_visible_group_ids(groups_config, preferences)
    if preference_exists and ids and customized and not visible:
        preferences['onboardingRequired'] = True
        effective = []
    active_group_id = _resolve_active_group_id(groups_config, effective, payload.get('activeGroupId'))
    preferences['activeGroupId'] = active_group_id
    preferences['effectiveVisibleGroupIds'] = effective
    return preferences


def load_group_preferences(context, groups_config, database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.UserGroupPreference).where(
                models.UserGroupPreference.workspace_id == context.workspace_id,
                models.UserGroupPreference.user_id == context.user_id,
            )
        ).scalars().first()
        if row is None:
            return normalize_group_preferences(
                {},
                groups_config,
                preference_exists=False,
                require_first_run=is_first_run_required(context, groups_config, False, database_url=database_url),
            )
        return normalize_group_preferences(
            {
                'visibleGroupIds': row.visible_group_ids or [],
                'activeGroupId': row.active_group_id,
                'customized': row.customized,
            },
            groups_config,
            preference_exists=True,
            require_first_run=False,
        )


def save_group_preferences(context, payload, groups_config, database_url=None):
    preferences = normalize_group_preferences(
        {
            'visibleGroupIds': payload.get('visibleGroupIds') if isinstance(payload, dict) else [],
            'activeGroupId': payload.get('activeGroupId') if isinstance(payload, dict) else None,
            'customized': True,
        },
        groups_config,
        preference_exists=True,
        require_first_run=False,
    )
    if _group_ids(groups_config) and not preferences['effectiveVisibleGroupIds']:
        raise InvalidGroupPreferences('visibleGroupIds must include at least one known group')

    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.UserGroupPreference).where(
                models.UserGroupPreference.workspace_id == context.workspace_id,
                models.UserGroupPreference.user_id == context.user_id,
            )
        ).scalars().first()
        if row is None:
            row = models.UserGroupPreference(
                workspace_id=context.workspace_id,
                user_id=context.user_id,
                payload_version=GROUPS_PAYLOAD_VERSION,
                visible_group_ids=preferences['visibleGroupIds'],
                active_group_id=preferences['activeGroupId'],
                customized=True,
            )
            session.add(row)
        else:
            row.payload_version = GROUPS_PAYLOAD_VERSION
            row.visible_group_ids = preferences['visibleGroupIds']
            row.active_group_id = preferences['activeGroupId']
            row.customized = True
            row.updated_at = models._utcnow()
        session.flush()
    return preferences


def is_first_run_required(context, groups_config, preference_exists, database_url=None):
    del database_url
    return bool(is_db_auth_context(context) and not preference_exists)
