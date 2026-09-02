"""Workspace-shared department group catalog and user visibility helpers."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.auth.db_context import is_db_auth_context
from backend.db import engine as db_engine
from backend.db import models


GROUPS_SOURCE_DB = 'workspace_db'
GROUPS_SOURCE_JSON = 'file'
GROUPS_PAYLOAD_VERSION = 1
ONBOARDING_MODULE_IDS = (
    'catch-up',
    'configuration',
    'planning',
    'board',
    'statistics',
)


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


class OnboardingPreferencesUnavailable(ValueError):
    pass


class GroupSelectionRequired(ValueError):
    pass


class OnboardingStorageUnavailable(RuntimeError):
    pass


class InvalidOnboardingModule(ValueError):
    pass


def normalize_completed_onboarding_modules(values):
    requested = {
        value
        for value in (values or [])
        if isinstance(value, str)
    }
    return [
        module_id
        for module_id in ONBOARDING_MODULE_IDS
        if module_id in requested
    ]


def all_onboarding_modules_complete(values):
    return normalize_completed_onboarding_modules(values) == list(ONBOARDING_MODULE_IDS)


def _onboarding_preference_payload(values):
    completed_modules = normalize_completed_onboarding_modules(values)
    return {
        'completedOnboardingModules': completed_modules,
        'onboardingDone': all_onboarding_modules_complete(completed_modules),
    }


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


def _row_to_groups_config(row, validate_groups_config_fn=None):
    payload = dict(row.payload or {})
    payload.setdefault('version', int(row.payload_version or GROUPS_PAYLOAD_VERSION))
    payload.setdefault('groups', [])
    payload.setdefault('defaultGroupId', '')
    if validate_groups_config_fn is not None:
        payload, _warnings = _normalize_shared_payload(payload, validate_groups_config_fn)
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


def current_shared_groups_config(session, context, validate_groups_config_fn=None):
    row = session.execute(
        select(models.WorkspaceGroupConfig).where(
            models.WorkspaceGroupConfig.workspace_id == context.workspace_id,
        )
    ).scalars().first()
    if row is None:
        return _empty_groups_config()
    return _row_to_groups_config(row, validate_groups_config_fn)


def load_shared_groups(context, fallback_loader, validate_groups_config_fn, database_url=None):
    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.WorkspaceGroupConfig).where(
                models.WorkspaceGroupConfig.workspace_id == context.workspace_id,
            )
        ).scalars().first()
        if row is not None:
            return _row_to_groups_config(row, validate_groups_config_fn)

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
            raise GroupConfigConflict(current_shared_groups_config(session, context, validate_groups_config_fn)) from exc
        return _row_to_groups_config(row, validate_groups_config_fn)


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
            current = current_shared_groups_config(session, context, validate_groups_config_fn)
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


def _uses_personal_preferences(groups_config):
    return str((groups_config or {}).get('source') or '') == GROUPS_SOURCE_DB


def _group_has_teams(group):
    return bool([
        str(team_id or '').strip()
        for team_id in (group or {}).get('teamIds') or []
        if str(team_id or '').strip()
    ])


def _group_by_id(groups_config, group_id):
    normalized_id = str(group_id or '').strip()
    return next((
        group
        for group in (groups_config or {}).get('groups') or []
        if str(group.get('id') or '').strip() == normalized_id
    ), None)


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
    if not _uses_personal_preferences(groups_config):
        default_group_id = str((groups_config or {}).get('defaultGroupId') or '').strip()
        if default_group_id and default_group_id in ids and default_group_id not in visible:
            visible.insert(0, default_group_id)
    return visible


def _resolve_active_group_id(groups_config, visible_ids, active_group_id):
    active = str(active_group_id or '').strip()
    if _uses_personal_preferences(groups_config):
        group = _group_by_id(groups_config, active)
        if active and active in visible_ids and _group_has_teams(group):
            return active
        return None
    if active and active in visible_ids:
        return active
    default_group_id = str((groups_config or {}).get('defaultGroupId') or '').strip()
    if default_group_id and default_group_id in visible_ids:
        return default_group_id
    return visible_ids[0] if visible_ids else None


def normalize_group_preferences(payload, groups_config, preference_exists=True, require_first_run=False):
    payload = payload or {}
    ids = _group_ids(groups_config)
    completed_onboarding_modules = (
        normalize_completed_onboarding_modules(payload.get('completedOnboardingModules'))
        if _uses_personal_preferences(groups_config)
        else list(ONBOARDING_MODULE_IDS)
    )
    onboarding = _onboarding_preference_payload(completed_onboarding_modules)
    if require_first_run and not preference_exists:
        return {
            'customized': False,
            'preferenceExists': False,
            'onboardingRequired': True,
            **onboarding,
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
        **onboarding,
        'visibleGroupIds': visible,
    }
    effective = effective_visible_group_ids(groups_config, preferences)
    if preference_exists and ids and customized and not visible:
        preferences['onboardingRequired'] = True
        effective = []
    active_group_id = _resolve_active_group_id(groups_config, effective, payload.get('activeGroupId'))
    if _uses_personal_preferences(groups_config) and preference_exists and not active_group_id:
        preferences['onboardingRequired'] = True
        effective = []
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
                'completedOnboardingModules': row.onboarding_completed_modules,
            },
            groups_config,
            preference_exists=True,
            require_first_run=False,
        )


def _validate_raw_group_preferences(payload, groups_config, preference_exists):
    if not isinstance(payload, dict):
        raise InvalidGroupPreferences('group preferences must be an object')
    visible_ids = payload.get('visibleGroupIds')
    favorite_group_id = payload.get('activeGroupId')
    if not isinstance(visible_ids, list) or not all(isinstance(value, str) for value in visible_ids):
        raise InvalidGroupPreferences('visibleGroupIds must be an array of group ids')
    if not isinstance(favorite_group_id, str) or not favorite_group_id.strip():
        raise InvalidGroupPreferences('activeGroupId must be a group id')

    normalized_visible_ids = [value.strip() for value in visible_ids]
    if any(not value for value in normalized_visible_ids) or len(set(normalized_visible_ids)) != len(normalized_visible_ids):
        raise InvalidGroupPreferences('visibleGroupIds must contain distinct non-empty group ids')
    known_ids = set(_group_ids(groups_config))
    if set(normalized_visible_ids) - known_ids:
        raise InvalidGroupPreferences('visibleGroupIds contains an unknown group')

    normalized_favorite_id = favorite_group_id.strip()
    if not preference_exists:
        if len(normalized_visible_ids) != 1 or normalized_favorite_id != normalized_visible_ids[0]:
            raise InvalidGroupPreferences('first run must select exactly one personal favorite group')
    elif normalized_favorite_id not in normalized_visible_ids:
        raise InvalidGroupPreferences('personal favorite group must remain visible')

    favorite_group = _group_by_id(groups_config, normalized_favorite_id)
    if favorite_group is None:
        raise InvalidGroupPreferences('personal favorite group must be a known group')
    if not _group_has_teams(favorite_group):
        raise InvalidGroupPreferences('personal favorite group must have at least one configured team')

    return {
        'visibleGroupIds': normalized_visible_ids,
        'activeGroupId': normalized_favorite_id,
        'customized': True,
    }


def _normalized_saved_preferences(payload, groups_config, completed_onboarding_modules=None):
    return normalize_group_preferences(
        {
            **payload,
            'completedOnboardingModules': completed_onboarding_modules or [],
        },
        groups_config,
        preference_exists=True,
        require_first_run=False,
    )


def _apply_group_preferences(row, preferences):
    row.payload_version = GROUPS_PAYLOAD_VERSION
    row.visible_group_ids = preferences['visibleGroupIds']
    row.active_group_id = preferences['activeGroupId']
    row.customized = True
    row.updated_at = models._utcnow()


def save_group_preferences(context, payload, groups_config, database_url=None):
    insert_race_error = None

    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.UserGroupPreference).where(
                models.UserGroupPreference.workspace_id == context.workspace_id,
                models.UserGroupPreference.user_id == context.user_id,
            )
        ).scalars().first()
        was_insert = row is None
        validated = _validate_raw_group_preferences(payload, groups_config, not was_insert)
        preferences = _normalized_saved_preferences(
            validated,
            groups_config,
            completed_onboarding_modules=(
                [] if was_insert else row.onboarding_completed_modules
            ),
        )
        if was_insert:
            row = models.UserGroupPreference(
                workspace_id=context.workspace_id,
                user_id=context.user_id,
                payload_version=GROUPS_PAYLOAD_VERSION,
                visible_group_ids=preferences['visibleGroupIds'],
                active_group_id=preferences['activeGroupId'],
                customized=True,
                onboarding_done=False,
                onboarding_completed_modules=[],
            )
            session.add(row)
        else:
            _apply_group_preferences(row, preferences)
        try:
            session.flush()
        except IntegrityError as error:
            if not was_insert:
                raise
            insert_race_error = error
            session.rollback()
    if insert_race_error is None:
        return preferences

    with db_engine.session_scope(database_url) as session:
        row = session.execute(
            select(models.UserGroupPreference).where(
                models.UserGroupPreference.workspace_id == context.workspace_id,
                models.UserGroupPreference.user_id == context.user_id,
            )
        ).scalars().first()
        if row is None:
            raise insert_race_error
        validated = _validate_raw_group_preferences(payload, groups_config, True)
        preferences = _normalized_saved_preferences(
            validated,
            groups_config,
            completed_onboarding_modules=row.onboarding_completed_modules,
        )
        _apply_group_preferences(row, preferences)
        session.flush()
    return preferences


def complete_onboarding_module(context, module_id, database_url=None) -> dict:
    if module_id not in ONBOARDING_MODULE_IDS:
        raise InvalidOnboardingModule('invalid_onboarding_module')
    if not is_db_auth_context(context):
        raise OnboardingPreferencesUnavailable('onboarding_db_required')

    try:
        with db_engine.session_scope(database_url) as session:
            row = session.execute(
                select(models.UserGroupPreference).where(
                    models.UserGroupPreference.workspace_id == context.workspace_id,
                    models.UserGroupPreference.user_id == context.user_id,
                ).with_for_update()
            ).scalars().first()
            if row is None:
                raise GroupSelectionRequired('personal group selection required')

            completed_modules = normalize_completed_onboarding_modules([
                *(row.onboarding_completed_modules or []),
                module_id,
            ])
            onboarding = _onboarding_preference_payload(completed_modules)
            row.onboarding_completed_modules = completed_modules
            row.onboarding_done = onboarding['onboardingDone']
            row.updated_at = models._utcnow()
            session.flush()
            return onboarding
    except SQLAlchemyError as error:
        raise OnboardingStorageUnavailable('onboarding_storage_unavailable') from error


def set_onboarding_done(context, done: bool, database_url=None) -> dict:
    if not is_db_auth_context(context):
        raise OnboardingPreferencesUnavailable('onboarding_db_required')

    try:
        with db_engine.session_scope(database_url) as session:
            row = session.execute(
                select(models.UserGroupPreference).where(
                    models.UserGroupPreference.workspace_id == context.workspace_id,
                    models.UserGroupPreference.user_id == context.user_id,
                ).with_for_update()
            ).scalars().first()
            if row is None:
                raise GroupSelectionRequired('personal group selection required')

            completed_modules = list(ONBOARDING_MODULE_IDS) if done else []
            onboarding = _onboarding_preference_payload(completed_modules)
            row.onboarding_completed_modules = completed_modules
            row.onboarding_done = onboarding['onboardingDone']
            row.updated_at = models._utcnow()
            session.flush()
            return onboarding
    except SQLAlchemyError as error:
        raise OnboardingStorageUnavailable('onboarding_storage_unavailable') from error


def is_first_run_required(context, groups_config, preference_exists, database_url=None):
    del database_url
    return bool(is_db_auth_context(context) and not preference_exists)
