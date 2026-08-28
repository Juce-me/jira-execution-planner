"""Serialized mutations for one user's private views within one workspace."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from types import MappingProxyType
from typing import Callable, Mapping

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.config.shared_config import sanitize_private_view_payload, validate_private_view_ownership
from backend.config.view_validation import normalize_epm_settings_payload
from backend.db import engine as db_engine
from backend.db import models
from backend.epm.config import normalize_epm_config


_UNSET = object()
MAX_MUTATION_ATTEMPTS = 3
RETRYABLE_UNIQUE_CONSTRAINTS = frozenset({
    'uq_view_configs_active_default',
    'uq_view_config_versions_number',
})
RETRYABLE_SQLITE_UNIQUE_MESSAGES = (
    'unique constraint failed: view_configs.workspace_id, view_configs.owner_user_id',
    'unique constraint failed: view_config_versions.view_config_id, view_config_versions.version_number',
)


class UserViewConfigNotFound(LookupError):
    pass


class UserViewConfigStorageError(RuntimeError):
    pass


class UserViewConfigConflict(Exception):
    def __init__(self, current):
        super().__init__('view_config_conflict')
        self.current = current


@dataclass(frozen=True)
class UserViewMutationResult:
    view_config_id: str
    workspace_id: str
    name: str
    view_type: str
    view: Mapping
    is_default: bool
    created_at: datetime | None
    updated_at: datetime | None
    archived_at: datetime | None
    version_number: int
    before_effective_epm: Mapping
    after_effective_epm: Mapping
    effective_epm_changed: bool

    def as_view_dict(self):
        return {
            'id': self.view_config_id,
            'viewConfigId': self.view_config_id,
            'workspaceId': self.workspace_id,
            'name': self.name,
            'viewType': self.view_type,
            'view': _thaw(self.view),
            'isDefault': self.is_default,
            'createdAt': _iso(self.created_at),
            'updatedAt': _iso(self.updated_at),
            'archivedAt': _iso(self.archived_at),
            'versionNumber': self.version_number,
        }


def _iso(value):
    if value is None:
        return None
    return value.isoformat().replace('+00:00', 'Z')


def _freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value):
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


def _active_statement(context):
    return select(models.ViewConfig).where(
        models.ViewConfig.workspace_id == context.workspace_id,
        models.ViewConfig.owner_user_id == context.user_id,
        models.ViewConfig.visibility == 'private',
        models.ViewConfig.archived_at.is_(None),
    )


def _locked(statement, dialect_name):
    return statement.with_for_update() if dialect_name == 'postgresql' else statement


def _default_view(session, context, dialect_name):
    return session.execute(_locked(
        _active_statement(context).where(models.ViewConfig.is_default.is_(True)).order_by(
            models.ViewConfig.created_at.asc(),
        ),
        dialect_name,
    )).scalars().first()


def _selected_view(session, context, view_config_id, dialect_name):
    return session.execute(_locked(
        _active_statement(context).where(models.ViewConfig.id == view_config_id),
        dialect_name,
    )).scalars().first()


def _scope_lock_key(context):
    digest = hashlib.sha256(f'{context.workspace_id}\0{context.user_id}'.encode('utf-8')).digest()
    return int.from_bytes(digest[:8], byteorder='big', signed=True)


def _begin_serialized(session, context):
    dialect_name = session.get_bind().dialect.name
    if dialect_name == 'sqlite':
        session.execute(text('BEGIN IMMEDIATE'))
    elif dialect_name == 'postgresql':
        session.execute(
            text('SELECT pg_advisory_xact_lock(:lock_key)'),
            {'lock_key': _scope_lock_key(context)},
        )
    else:
        raise UserViewConfigStorageError('unsupported private-view storage dialect')
    return dialect_name


def _latest_version(session, view_id):
    value = session.execute(select(func.max(models.ViewConfigVersion.version_number)).where(
        models.ViewConfigVersion.view_config_id == view_id,
    )).scalar_one()
    return int(value or 0)


def _effective_epm(session, context, dialect_name):
    default = _default_view(session, context, dialect_name)
    if default is None:
        return normalize_epm_config({})
    epm = default.payload.get('epm') if isinstance(default.payload, dict) else {}
    settings = {
        key: deepcopy(epm[key])
        for key in ('version', 'labelPrefix', 'scope', 'issueTypes', 'projects')
        if isinstance(epm, dict) and key in epm
    }
    return normalize_epm_config(settings)


def _infer_view_type(payload):
    has_eng = bool(payload.get('eng') or payload.get('filters') or payload.get('projects'))
    has_epm = bool(payload.get('epm'))
    if has_eng and has_epm:
        return 'mixed'
    if has_epm:
        return 'epm'
    return 'eng'


def _append_version(session, view, context, change_note):
    version_number = _latest_version(session, view.id) + 1
    session.add(models.ViewConfigVersion(
        view_config_id=view.id,
        version_number=version_number,
        payload=deepcopy(view.payload or {}),
        created_by=context.user_id,
        change_note=change_note,
    ))
    session.flush()
    return version_number


def _result(session, view, context, dialect_name, before_epm, version_number):
    after_epm = _effective_epm(session, context, dialect_name)
    return UserViewMutationResult(
        view_config_id=view.id,
        workspace_id=view.workspace_id,
        name=view.name,
        view_type=view.view_type,
        view=_freeze(_sanitized_payload(view.payload)),
        is_default=bool(view.is_default),
        created_at=view.created_at,
        updated_at=view.updated_at,
        archived_at=view.archived_at,
        version_number=version_number,
        before_effective_epm=_freeze(deepcopy(before_epm)),
        after_effective_epm=_freeze(deepcopy(after_epm)),
        effective_epm_changed=before_epm != after_epm,
    )


def _sanitized_payload(payload):
    return sanitize_private_view_payload(deepcopy(payload or {}))


def _run_mutation_once(context, database_url, operation, before_commit=None):
    with db_engine.session_scope(database_url) as session:
        dialect_name = _begin_serialized(session, context)
        before_epm = _effective_epm(session, context, dialect_name)
        view, version_number = operation(session, dialect_name)
        session.flush()
        result = _result(session, view, context, dialect_name, before_epm, version_number)
        if before_commit is not None:
            before_commit()
        return result


def _is_retryable_integrity_error(error):
    original = getattr(error, 'orig', None)
    diagnostic = getattr(original, 'diag', None)
    constraint_name = getattr(diagnostic, 'constraint_name', None)
    if constraint_name in RETRYABLE_UNIQUE_CONSTRAINTS:
        return True
    message = str(original or error).strip().lower()
    return any(candidate in message for candidate in RETRYABLE_SQLITE_UNIQUE_MESSAGES)


def _run_transaction(context, database_url, operation, *, post_commit=None, before_commit=None):
    for attempt in range(MAX_MUTATION_ATTEMPTS):
        try:
            result = _run_mutation_once(context, database_url, operation, before_commit)
            break
        except IntegrityError as error:
            if not _is_retryable_integrity_error(error):
                raise UserViewConfigStorageError('private view storage unavailable') from error
            if attempt + 1 == MAX_MUTATION_ATTEMPTS:
                raise UserViewConfigStorageError('private view mutation retry exhausted') from error
        except SQLAlchemyError as error:
            raise UserViewConfigStorageError('private view storage unavailable') from error
    if result.effective_epm_changed and post_commit is not None:
        post_commit(result)
    return result


def create_user_view(
    context,
    *,
    name,
    view_type,
    payload,
    is_default=False,
    database_url=None,
    post_commit: Callable[[UserViewMutationResult], None] | None = None,
    _before_commit=None,
):
    payload = validate_private_view_ownership(payload)
    if view_type not in {'eng', 'epm', 'mixed'}:
        raise ValueError('viewType must be eng, epm, or mixed')

    def operation(session, dialect_name):
        if is_default:
            for existing in session.execute(_locked(
                _active_statement(context).where(models.ViewConfig.is_default.is_(True)), dialect_name,
            )).scalars().all():
                existing.is_default = False
            session.flush()
        view = models.ViewConfig(
            workspace_id=context.workspace_id,
            owner_user_id=context.user_id,
            name=(str(name or 'Saved view').strip() or 'Saved view')[:255],
            view_type=view_type,
            payload_version=int(payload.get('version') or 1),
            payload=deepcopy(payload),
            visibility='private',
            is_default=bool(is_default),
        )
        session.add(view)
        session.flush()
        return view, _append_version(session, view, context, 'user create')

    return _run_transaction(
        context, database_url, operation, post_commit=post_commit, before_commit=_before_commit,
    )


def mutate_user_view(
    context,
    view_config_id,
    *,
    name=_UNSET,
    view_type=_UNSET,
    payload=_UNSET,
    base_version=None,
    is_default=_UNSET,
    archive=False,
    database_url=None,
    post_commit: Callable[[UserViewMutationResult], None] | None = None,
    _before_commit=None,
):
    if payload is not _UNSET:
        payload = validate_private_view_ownership(payload)
        if base_version is None or isinstance(base_version, bool):
            raise ValueError('baseVersion is required for payload replacement')
        try:
            base_version = int(base_version)
        except (TypeError, ValueError) as error:
            raise ValueError('baseVersion must be a non-negative integer') from error
        if base_version < 0:
            raise ValueError('baseVersion must be a non-negative integer')
    if view_type is not _UNSET and view_type not in {'eng', 'epm', 'mixed'}:
        raise ValueError('viewType must be eng, epm, or mixed')

    def operation(session, dialect_name):
        view = _selected_view(session, context, view_config_id, dialect_name)
        if view is None:
            raise UserViewConfigNotFound('view config not found')
        current_version = _latest_version(session, view.id)
        if payload is not _UNSET and current_version != base_version:
            current = _result(
                session, view, context, dialect_name,
                _effective_epm(session, context, dialect_name), current_version,
            )
            raise UserViewConfigConflict(current)
        if name is not _UNSET:
            normalized_name = str(name or '').strip()
            if normalized_name:
                view.name = normalized_name[:255]
        if payload is not _UNSET:
            view.payload = deepcopy(payload)
            view.payload_version = int(payload.get('version') or view.payload_version or 1)
            view.view_type = view_type if view_type is not _UNSET else _infer_view_type(payload)
        elif view_type is not _UNSET:
            view.view_type = view_type
        if archive:
            view.archived_at = datetime.now(timezone.utc)
            view.is_default = False
        elif is_default is not _UNSET:
            make_default = bool(is_default)
            if make_default:
                for existing in session.execute(_locked(
                    _active_statement(context).where(
                        models.ViewConfig.is_default.is_(True),
                        models.ViewConfig.id != view.id,
                    ),
                    dialect_name,
                )).scalars().all():
                    existing.is_default = False
                session.flush()
            view.is_default = make_default
        session.flush()
        return view, _append_version(session, view, context, 'user update')

    return _run_transaction(
        context, database_url, operation, post_commit=post_commit, before_commit=_before_commit,
    )


def save_user_epm_config(
    context,
    payload,
    *,
    database_url=None,
    post_commit: Callable[[UserViewMutationResult], None] | None = None,
    _before_commit=None,
):
    normalized = normalize_epm_settings_payload(payload)

    def operation(session, dialect_name):
        view = _default_view(session, context, dialect_name)
        if view is None:
            view = models.ViewConfig(
                workspace_id=context.workspace_id,
                owner_user_id=context.user_id,
                name='Default view',
                view_type='epm',
                payload_version=1,
                payload={},
                visibility='private',
                is_default=True,
            )
            session.add(view)
            session.flush()
        current_payload = deepcopy(view.payload or {})
        current_epm = deepcopy(current_payload.get('epm') or {}) if isinstance(current_payload.get('epm'), dict) else {}
        personal = {key: current_epm[key] for key in ('tab', 'selectedSprint') if key in current_epm}
        current_payload['epm'] = {**deepcopy(normalized), **personal}
        view.payload = current_payload
        view.view_type = _infer_view_type(current_payload)
        session.flush()
        return view, _append_version(session, view, context, 'user EPM update')

    return _run_transaction(
        context, database_url, operation, post_commit=post_commit, before_commit=_before_commit,
    )


def save_imported_user_view(
    context,
    payload,
    *,
    source_path,
    source_hash,
    database_url=None,
    post_commit: Callable[[UserViewMutationResult], None] | None = None,
    _before_commit=None,
):
    """Replace the default private view through the same serialized import boundary."""
    normalized = validate_private_view_ownership(payload)

    def operation(session, dialect_name):
        view = _default_view(session, context, dialect_name)
        if view is None:
            view = models.ViewConfig(
                workspace_id=context.workspace_id,
                owner_user_id=context.user_id,
                name='Default view',
                view_type=_infer_view_type(normalized),
                payload_version=int(normalized.get('version') or 1),
                payload=deepcopy(normalized),
                visibility='private',
                is_default=True,
            )
            session.add(view)
            session.flush()
        else:
            view.view_type = _infer_view_type(normalized)
            view.payload_version = int(normalized.get('version') or view.payload_version or 1)
            view.payload = deepcopy(normalized)
        view.source_path = str(source_path)
        view.source_hash = str(source_hash)
        session.flush()
        return view, _append_version(session, view, context, 'legacy json import')

    return _run_transaction(
        context, database_url, operation, post_commit=post_commit, before_commit=_before_commit,
    )


def load_user_epm_config(context, *, database_url=None):
    try:
        with db_engine.session_scope(database_url) as session:
            dialect_name = session.get_bind().dialect.name
            return _effective_epm(session, context, dialect_name)
    except SQLAlchemyError as error:
        raise UserViewConfigStorageError('user EPM read failed') from error
