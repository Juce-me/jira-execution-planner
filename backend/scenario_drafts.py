"""Database-backed Scenario Planner draft service."""

from __future__ import annotations

import os
import multiprocessing
import queue
import signal
import threading
import warnings
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from backend.db import engine as db_engine
from backend.db import models
from backend import runtime_state


MEMBERSHIP_SCOPE_KEYS = {
    'members',
    'teamIds',
    'memberUserIds',
    'groupDefinitions',
    'groups',
    'nestedGroups',
}
SUPPORTED_OVERRIDE_FIELDS = {'start', 'end'}
KEEP_SCENARIO_SOURCE_HASH = object()
PRESENCE_TTL_SECONDS = 30
ISSUE_LOCK_TTL_SECONDS = 30
COLLABORATION_WRITE_ATTEMPTS = 2


class ScenarioDraftNotFound(LookupError):
    """Raised when a draft or version is missing from the request workspace."""


class ScenarioDraftValidationError(ValueError):
    """Raised when draft input does not match the scenario draft contract."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ScenarioDraftConflict(RuntimeError):
    """Raised when the caller's base draft revision is stale."""

    def __init__(
        self,
        *,
        reason: str,
        received_base_draft_revision: int | None,
        current_draft_revision: int,
        current_version_number: int,
        active_draft: dict,
        versions: list[dict],
    ):
        super().__init__(reason)
        self.reason = reason
        self.received_base_draft_revision = received_base_draft_revision
        self.current_draft_revision = current_draft_revision
        self.current_version_number = current_version_number
        self.active_draft = active_draft
        self.versions = versions


class ScenarioDraftLockConflict(RuntimeError):
    """Raised when another user holds an active draft resource lock."""

    def __init__(self, active_lock: dict):
        super().__init__('scenario draft resource is locked')
        self.active_lock = active_lock


class ScenarioDraftReloadTimeout(TimeoutError):
    """Raised when synchronous Jira reload exceeds its SLA."""


class ScenarioDraftReloadUnavailable(RuntimeError):
    """Raised when no scenario reload source loader is available."""


def scenario_source_hash(source: dict) -> str:
    return models.scenario_source_hash(source)


def get_active_draft(context, scope_key, legacy_loader=None):
    scope_key = _require_scope_key(scope_key)
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _active_draft_for_scope(session, context, scope_key)
        if draft is None and legacy_loader is not None and _legacy_import_allowed(session, context):
            draft = _import_legacy_scope(session, context, scope_key, legacy_loader)
        return _response(draft, _versions_for_draft(session, draft.id) if draft is not None else [])


def save_draft(context, scope_key, name, overrides, base_draft_revision=None, scope_payload=None):
    scope_key = _require_scope_key(scope_key)
    name = _normalize_name(name)
    overrides = _validate_overrides(overrides)
    scope_payload = _validate_scope_payload(scope_payload)
    try:
        with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
            draft = _active_draft_for_scope(session, context, scope_key)
            if draft is None:
                draft = models.ScenarioDraft(
                    workspace_id=context.workspace_id,
                    scope_key=scope_key,
                    name=name,
                    scope_payload=scope_payload,
                    overrides=overrides,
                    draft_revision=1,
                    created_by=_context_user_id(context),
                    updated_by=_context_user_id(context),
                )
                session.add(draft)
                session.flush()
            else:
                draft = _update_existing_draft(
                    session,
                    context,
                    draft,
                    name=name,
                    overrides=overrides,
                    scope_payload=scope_payload,
                    base_draft_revision=base_draft_revision,
                )

            version = _append_version(session, draft, source='user', change_note='user save')
            _append_event_in_session(
                session,
                context,
                draft,
                event_type='draft.saved',
                payload={'versionNumber': version.version_number},
            )
            session.flush()
            return _response(draft, _versions_for_draft(session, draft.id, pending=version))
    except IntegrityError as exc:
        _raise_conflict_for_scope(context, scope_key, base_draft_revision, exc)


def get_version(context, draft_id, version_number):
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        version = _version_for_number(session, draft.id, version_number)
        if version is None:
            raise ScenarioDraftNotFound('scenario draft version not found')
        return _serialize_version(version)


def rollback_to_version(context, draft_id, target_version_number, base_draft_revision):
    try:
        with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
            draft = _draft_for_id(session, context, draft_id)
            if draft is None:
                raise ScenarioDraftNotFound('scenario draft not found')
            target = _version_for_number(session, draft.id, target_version_number)
            if target is None:
                raise ScenarioDraftNotFound('scenario draft version not found')
            draft = _update_existing_draft(
                session,
                context,
                draft,
                name=target.name,
                overrides=deepcopy(target.overrides or {}),
                scope_payload=deepcopy(target.scope_payload or {}),
                scenario_source_hash=target.scenario_source_hash,
                base_draft_revision=base_draft_revision,
            )

            version = _append_version(
                session,
                draft,
                source='rollback',
                change_note=f'rollback to version {int(target_version_number)}',
            )
            _append_event_in_session(
                session,
                context,
                draft,
                event_type='draft.rolled_back',
                payload={
                    'targetVersionNumber': int(target_version_number),
                    'versionNumber': version.version_number,
                },
            )
            session.flush()
            return _response(draft, _versions_for_draft(session, draft.id, pending=version))
    except IntegrityError as exc:
        _raise_conflict_for_draft_id(context, draft_id, base_draft_revision, exc)


def append_event(context, draft_id, *, event_type, draft_revision, payload):
    event_type = _require_text(event_type, 'event_type')
    payload = _validate_json_object(payload, 'payload')
    last_error = None
    for _ in range(COLLABORATION_WRITE_ATTEMPTS):
        try:
            with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
                draft = _draft_for_id(session, context, draft_id, for_update=True)
                if draft is None:
                    raise ScenarioDraftNotFound('scenario draft not found')
                event = models.ScenarioDraftEvent(
                    scenario_draft_id=draft.id,
                    event_number=_next_event_number(session, draft.id),
                    event_type=event_type,
                    draft_revision=int(draft.draft_revision or 0),
                    payload=payload,
                    created_by=_context_user_id(context),
                )
                session.add(event)
                session.flush()
                return _serialize_event(event)
        except IntegrityError as exc:
            last_error = exc
    raise ScenarioDraftValidationError(
        'scenario_draft_event_number_conflict',
        'could not allocate scenario draft event number',
    ) from last_error


def get_events_after(context, draft_id, *, after_event_number):
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        statement = (
            select(models.ScenarioDraftEvent)
            .where(
                models.ScenarioDraftEvent.scenario_draft_id == draft.id,
                models.ScenarioDraftEvent.event_number > int(after_event_number or 0),
            )
            .order_by(models.ScenarioDraftEvent.event_number.asc())
        )
        return [_serialize_event(event) for event in session.execute(statement).scalars().all()]


def get_events_page(context, draft_id, *, since_event_number, limit=100):
    since = _coerce_non_negative_int(since_event_number, 'since')
    page_limit = min(max(int(limit or 100), 1), 100)
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        statement = (
            select(models.ScenarioDraftEvent)
            .where(
                models.ScenarioDraftEvent.scenario_draft_id == draft.id,
                models.ScenarioDraftEvent.event_number > since,
            )
            .order_by(models.ScenarioDraftEvent.event_number.asc())
            .limit(page_limit + 1)
        )
        loaded = list(session.execute(statement).scalars().all())
        events = [_serialize_event(event) for event in loaded[:page_limit]]
        next_since = events[-1]['eventNumber'] if events else since
        return {
            'events': events,
            'nextSince': next_since,
            'isLast': len(loaded) <= page_limit,
        }


def upsert_presence(context, draft_id, *, display_name, cursor_payload, mode, now=None):
    now = _normalize_datetime(now or _utcnow())
    user_id = _require_user_id(context)
    cursor_payload = _validate_json_object(cursor_payload, 'cursor_payload')
    mode = _require_text(mode, 'mode')
    last_error = None
    for _ in range(COLLABORATION_WRITE_ATTEMPTS):
        try:
            with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
                draft = _draft_for_id(session, context, draft_id)
                if draft is None:
                    raise ScenarioDraftNotFound('scenario draft not found')
                presence = _presence_for_user(session, draft.id, user_id)
                if presence is None:
                    presence = models.ScenarioDraftPresence(
                        scenario_draft_id=draft.id,
                        user_id=user_id,
                        display_name=display_name,
                        cursor_payload=cursor_payload,
                        mode=mode,
                        last_seen_at=now,
                    )
                    session.add(presence)
                else:
                    presence.display_name = display_name
                    presence.cursor_payload = cursor_payload
                    presence.mode = mode
                    presence.last_seen_at = now
                session.flush()
                return _serialize_presence(presence)
        except IntegrityError as exc:
            last_error = exc
    raise ScenarioDraftValidationError(
        'scenario_draft_presence_conflict',
        'could not update scenario draft presence',
    ) from last_error


def get_active_presence(context, draft_id, *, now=None):
    now = _normalize_datetime(now or _utcnow())
    cutoff = now - timedelta(seconds=PRESENCE_TTL_SECONDS)
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        statement = (
            select(models.ScenarioDraftPresence)
            .where(
                models.ScenarioDraftPresence.scenario_draft_id == draft.id,
                models.ScenarioDraftPresence.last_seen_at > cutoff,
            )
            .order_by(models.ScenarioDraftPresence.display_name.asc(), models.ScenarioDraftPresence.user_id.asc())
        )
        return [_serialize_presence(presence) for presence in session.execute(statement).scalars().all()]


def acquire_lock(context, draft_id, *, resource_type, resource_id, holder_display_name, now=None):
    now = _normalize_datetime(now or _utcnow())
    user_id = _require_user_id(context)
    normalized_resource_type = _require_text(resource_type, 'resource_type')
    normalized_resource_id = _require_text(resource_id, 'resource_id')
    expires_at = now + timedelta(seconds=ISSUE_LOCK_TTL_SECONDS)
    last_error = None
    for _ in range(COLLABORATION_WRITE_ATTEMPTS):
        try:
            with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
                draft = _draft_for_id(session, context, draft_id)
                if draft is None:
                    raise ScenarioDraftNotFound('scenario draft not found')
                lock = _lock_for_resource(
                    session,
                    draft.id,
                    resource_type=normalized_resource_type,
                    resource_id=normalized_resource_id,
                )
                if lock is not None and _lock_is_active(lock, now) and lock.holder_user_id != user_id:
                    raise ScenarioDraftLockConflict(_serialize_lock(lock))
                if lock is None:
                    lock = models.ScenarioDraftLock(
                        scenario_draft_id=draft.id,
                        resource_type=normalized_resource_type,
                        resource_id=normalized_resource_id,
                        holder_user_id=user_id,
                        holder_display_name=holder_display_name,
                        expires_at=expires_at,
                        updated_at=now,
                    )
                    session.add(lock)
                else:
                    lock.holder_user_id = user_id
                    lock.holder_display_name = holder_display_name
                    lock.expires_at = expires_at
                    lock.updated_at = now
                session.flush()
                return _serialize_lock(lock)
        except IntegrityError as exc:
            last_error = exc
    raise ScenarioDraftValidationError(
        'scenario_draft_lock_conflict',
        'could not update scenario draft lock',
    ) from last_error


def release_lock(context, draft_id, *, resource_type, resource_id):
    user_id = _require_user_id(context)
    normalized_resource_type = _require_text(resource_type, 'resource_type')
    normalized_resource_id = _require_text(resource_id, 'resource_id')
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        lock = _lock_for_resource(
            session,
            draft.id,
            resource_type=normalized_resource_type,
            resource_id=normalized_resource_id,
        )
        if lock is not None and lock.holder_user_id != user_id and _lock_is_active(lock, _utcnow()):
            raise ScenarioDraftLockConflict(_serialize_lock(lock))
        if lock is not None and lock.holder_user_id == user_id:
            session.delete(lock)
            session.flush()
            return {'released': True}
        session.flush()
        return {'released': False, 'activeLock': _serialize_lock(lock) if lock is not None else None}


def reload_from_jira(context, draft_id, *, base_draft_revision, source_loader=None, timeout_seconds=20):
    if source_loader is None:
        raise ScenarioDraftReloadUnavailable('scenario reload source loader is not configured')
    timeout_seconds = int(timeout_seconds or 20)
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        _raise_if_stale(session, draft, base_draft_revision)
        draft_snapshot = _serialize_draft(
            draft,
            current_version_number=_current_version_number(_versions_for_draft(session, draft.id)),
        )

    source = _run_reload_source_loader(
        source_loader,
        context,
        draft_snapshot,
        timeout_seconds=timeout_seconds,
    )
    source = _validate_json_object(source, 'source')

    try:
        with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
            draft = _draft_for_id(session, context, draft_id, for_update=True)
            if draft is None:
                raise ScenarioDraftNotFound('scenario draft not found')
            draft = _update_existing_draft(
                session,
                context,
                draft,
                name=draft.name,
                overrides=deepcopy(draft.overrides or {}),
                scope_payload=deepcopy(draft.scope_payload or {}),
                scenario_source_hash=scenario_source_hash(source),
                base_draft_revision=base_draft_revision,
            )
            session.query(models.ScenarioDraftLock).filter_by(scenario_draft_id=draft.id).delete()
            version = _append_version(
                session,
                draft,
                source='reload_from_jira',
                change_note='reload from Jira',
            )
            _append_event_in_session(
                session,
                context,
                draft,
                event_type='draft.reloaded_from_jira',
                payload={'versionNumber': version.version_number},
            )
            session.flush()
            return _response(draft, _versions_for_draft(session, draft.id, pending=version))
    except IntegrityError as exc:
        _raise_conflict_for_draft_id(context, draft_id, base_draft_revision, exc)


def _run_reload_source_loader(source_loader, context, draft_snapshot, *, timeout_seconds):
    if threading.current_thread() is not threading.main_thread() or not hasattr(signal, 'setitimer'):
        return _run_reload_source_loader_in_process(
            source_loader,
            context,
            draft_snapshot,
            timeout_seconds=timeout_seconds,
        )

    def timeout_handler(signum, frame):
        raise TimeoutError('scenario reload exceeded the synchronous SLA')

    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, 0)
    try:
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.setitimer(signal.ITIMER_REAL, float(timeout_seconds))
        return source_loader(context, draft_snapshot, timeout_seconds)
    except TimeoutError as exc:
        raise ScenarioDraftReloadTimeout('scenario reload exceeded the synchronous SLA') from exc
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            signal.setitimer(signal.ITIMER_REAL, previous_timer[0], previous_timer[1])


def _run_reload_source_loader_in_process(source_loader, context, draft_snapshot, *, timeout_seconds):
    try:
        mp_context = multiprocessing.get_context('fork')
    except ValueError as exc:
        raise ScenarioDraftReloadUnavailable(
            'scenario reload timeout requires a fork-capable multiprocessing context',
        ) from exc
    result_queue = mp_context.Queue(maxsize=1)
    process = mp_context.Process(
        target=_reload_source_loader_process_target,
        args=(result_queue, source_loader, context, draft_snapshot, timeout_seconds),
    )
    with warnings.catch_warnings():
        warnings.filterwarnings(
            'ignore',
            message='This process .* is multi-threaded, use of fork\\(\\) may lead to deadlocks in the child\\.',
            category=DeprecationWarning,
        )
        process.start()
    process.join(float(timeout_seconds))
    if process.is_alive():
        process.terminate()
        process.join(1)
        if process.is_alive():
            process.kill()
            process.join()
        raise ScenarioDraftReloadTimeout('scenario reload exceeded the synchronous SLA')
    try:
        status, payload = result_queue.get_nowait()
    except queue.Empty as exc:
        if process.exitcode:
            raise ScenarioDraftReloadUnavailable('scenario reload source loader failed') from exc
        raise ScenarioDraftReloadTimeout('scenario reload exceeded the synchronous SLA') from exc
    if status == 'ok':
        return payload
    if status == 'timeout':
        raise ScenarioDraftReloadTimeout('scenario reload exceeded the synchronous SLA')
    raise ScenarioDraftReloadUnavailable(str(payload or 'scenario reload source loader failed'))


def _reload_source_loader_process_target(result_queue, source_loader, context, draft_snapshot, timeout_seconds):
    try:
        result_queue.put(('ok', source_loader(context, draft_snapshot, timeout_seconds)))
    except TimeoutError:
        result_queue.put(('timeout', None))
    except Exception as exc:
        result_queue.put(('error', str(exc)))


def preview_writeback(context, draft_id):
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        return {
            'ok': True,
            'dryRun': True,
            'draftId': draft.id,
            'draftRevision': int(draft.draft_revision or 0),
            'changes': [],
        }


def block_writeback(context, draft_id):
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found')
    raise ScenarioDraftValidationError(
        'jira_writeback_gate_blocked',
        'Scenario draft Jira write-back is blocked by the migration gate.',
    )


def _database_url(context):
    return getattr(context, 'database_url', None)


def _testing(context):
    return bool(getattr(context, 'testing', False))


def _context_user_id(context):
    return getattr(context, 'user_id', None)


def _require_scope_key(scope_key):
    normalized = str(scope_key or '').strip()
    if not normalized:
        raise ScenarioDraftValidationError('scenario_scope_key_required', 'scope_key is required')
    return normalized


def _require_user_id(context):
    user_id = _context_user_id(context)
    if not user_id:
        raise ScenarioDraftValidationError('scenario_user_required', 'user_id is required')
    return user_id


def _require_text(value, field_name):
    normalized = str(value or '').strip()
    if not normalized:
        raise ScenarioDraftValidationError(f'scenario_{field_name}_required', f'{field_name} is required')
    return normalized


def _validate_json_object(value, field_name):
    payload = {} if value is None else deepcopy(value)
    if not isinstance(payload, dict):
        raise ScenarioDraftValidationError(f'scenario_{field_name}_invalid', f'{field_name} must be an object')
    return payload


def _normalize_name(name):
    normalized = str(name or '').strip()
    return normalized or 'Scenario draft'


def _validate_scope_payload(scope_payload):
    if scope_payload is None:
        payload = {}
    else:
        payload = deepcopy(scope_payload)
    if not isinstance(payload, dict):
        raise ScenarioDraftValidationError('scenario_scope_payload_invalid', 'scope_payload must be an object')
    _reject_membership_scope(payload)
    return payload


def _update_existing_draft(
    session,
    context,
    draft,
    *,
    name,
    overrides,
    scope_payload,
    base_draft_revision,
    scenario_source_hash=KEEP_SCENARIO_SOURCE_HASH,
):
    if base_draft_revision != draft.draft_revision:
        _raise_if_stale(session, draft, base_draft_revision)
    next_draft_revision = int(draft.draft_revision or 0) + 1
    next_scenario_source_hash = (
        draft.scenario_source_hash
        if scenario_source_hash is KEEP_SCENARIO_SOURCE_HASH
        else scenario_source_hash
    )
    result = session.execute(
        update(models.ScenarioDraft)
        .where(
            models.ScenarioDraft.id == draft.id,
            models.ScenarioDraft.workspace_id == context.workspace_id,
            models.ScenarioDraft.archived_at.is_(None),
            models.ScenarioDraft.draft_revision == base_draft_revision,
        )
        .values(
            name=name,
            scope_payload=scope_payload,
            scenario_source_hash=next_scenario_source_hash,
            overrides=overrides,
            draft_revision=next_draft_revision,
            updated_by=_context_user_id(context),
            updated_at=_utcnow(),
        )
    )
    if result.rowcount != 1:
        current = _draft_for_id(session, context, draft.id)
        if current is None:
            raise ScenarioDraftNotFound('scenario draft not found')
        _raise_if_stale(session, current, base_draft_revision)
    return _draft_for_id(session, context, draft.id)


def _reject_membership_scope(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key in MEMBERSHIP_SCOPE_KEYS:
                raise ScenarioDraftValidationError(
                    'scenario_scope_membership_not_allowed',
                    f'scope_payload may not include membership field {key}',
                )
            _reject_membership_scope(child)
    elif isinstance(value, list):
        for child in value:
            _reject_membership_scope(child)


def _validate_overrides(overrides):
    if not isinstance(overrides, dict):
        raise ScenarioDraftValidationError('scenario_overrides_invalid', 'overrides must be an object')
    normalized = deepcopy(overrides)
    for issue_key, fields in normalized.items():
        if not isinstance(issue_key, str) or not issue_key:
            raise ScenarioDraftValidationError('scenario_overrides_invalid', 'override keys must be issue keys')
        if not isinstance(fields, dict):
            raise ScenarioDraftValidationError('scenario_overrides_invalid', 'override values must be objects')
        unsupported = set(fields) - SUPPORTED_OVERRIDE_FIELDS
        if unsupported:
            raise ScenarioDraftValidationError(
                'scenario_overrides_invalid',
                f'unsupported scenario override fields: {", ".join(sorted(unsupported))}',
            )
    return normalized


def _active_draft_for_scope(session, context, scope_key):
    statement = (
        select(models.ScenarioDraft)
        .where(
            models.ScenarioDraft.workspace_id == context.workspace_id,
            models.ScenarioDraft.scope_key == scope_key,
            models.ScenarioDraft.archived_at.is_(None),
        )
        .order_by(models.ScenarioDraft.created_at.asc())
    )
    return session.execute(statement).scalars().first()


def _draft_for_id(session, context, draft_id, *, for_update=False):
    statement = (
        select(models.ScenarioDraft)
        .where(
            models.ScenarioDraft.id == draft_id,
            models.ScenarioDraft.workspace_id == context.workspace_id,
            models.ScenarioDraft.archived_at.is_(None),
        )
    )
    if for_update:
        statement = statement.with_for_update()
    return session.execute(statement).scalars().first()


def _version_for_number(session, draft_id, version_number):
    statement = (
        select(models.ScenarioDraftVersion)
        .where(
            models.ScenarioDraftVersion.scenario_draft_id == draft_id,
            models.ScenarioDraftVersion.version_number == int(version_number),
        )
    )
    return session.execute(statement).scalars().first()


def _versions_for_draft(session, draft_id, pending=None):
    statement = (
        select(models.ScenarioDraftVersion)
        .where(models.ScenarioDraftVersion.scenario_draft_id == draft_id)
        .order_by(models.ScenarioDraftVersion.version_number.asc())
    )
    versions = list(session.execute(statement).scalars().all())
    if pending is not None and pending not in versions:
        versions.append(pending)
        versions.sort(key=lambda version: int(version.version_number or 0))
    return versions


def _next_version_number(session, draft_id):
    statement = select(func.max(models.ScenarioDraftVersion.version_number)).where(
        models.ScenarioDraftVersion.scenario_draft_id == draft_id,
    )
    current = session.execute(statement).scalar_one()
    return int(current or 0) + 1


def _next_event_number(session, draft_id):
    statement = select(func.max(models.ScenarioDraftEvent.event_number)).where(
        models.ScenarioDraftEvent.scenario_draft_id == draft_id,
    )
    current = session.execute(statement).scalar_one()
    return int(current or 0) + 1


def _append_event_in_session(session, context, draft, *, event_type, payload):
    event = models.ScenarioDraftEvent(
        scenario_draft_id=draft.id,
        event_number=_next_event_number(session, draft.id),
        event_type=event_type,
        draft_revision=int(draft.draft_revision or 0),
        payload=_validate_json_object(payload, 'payload'),
        created_by=_context_user_id(context),
    )
    session.add(event)
    return event


def _coerce_non_negative_int(value, field_name):
    if value is None or value == '':
        return 0
    if isinstance(value, bool):
        raise ScenarioDraftValidationError(f'scenario_{field_name}_invalid', f'{field_name} must be a non-negative integer')
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
    else:
        raise ScenarioDraftValidationError(f'scenario_{field_name}_invalid', f'{field_name} must be a non-negative integer')
    if parsed < 0:
        raise ScenarioDraftValidationError(f'scenario_{field_name}_invalid', f'{field_name} must be a non-negative integer')
    return parsed


def _presence_for_user(session, draft_id, user_id):
    statement = (
        select(models.ScenarioDraftPresence)
        .where(
            models.ScenarioDraftPresence.scenario_draft_id == draft_id,
            models.ScenarioDraftPresence.user_id == user_id,
        )
    )
    return session.execute(statement).scalars().first()


def _lock_for_resource(session, draft_id, *, resource_type, resource_id):
    statement = (
        select(models.ScenarioDraftLock)
        .where(
            models.ScenarioDraftLock.scenario_draft_id == draft_id,
            models.ScenarioDraftLock.resource_type == resource_type,
            models.ScenarioDraftLock.resource_id == resource_id,
        )
    )
    return session.execute(statement).scalars().first()


def _lock_is_active(lock, now):
    return _normalize_datetime(lock.expires_at) > _normalize_datetime(now)


def _append_version(session, draft, *, source, change_note=None):
    version = models.ScenarioDraftVersion(
        scenario_draft_id=draft.id,
        version_number=_next_version_number(session, draft.id),
        draft_revision=int(draft.draft_revision or 1),
        name=draft.name,
        scope_payload=deepcopy(draft.scope_payload or {}),
        scenario_source_hash=draft.scenario_source_hash,
        overrides=deepcopy(draft.overrides or {}),
        created_by=draft.updated_by,
        change_note=change_note,
        source=source,
    )
    session.add(version)
    return version


def _raise_if_stale(session, draft, base_draft_revision):
    if base_draft_revision == draft.draft_revision:
        return
    versions = _versions_for_draft(session, draft.id)
    current_version_number = max([int(version.version_number or 0) for version in versions] or [0])
    raise ScenarioDraftConflict(
        reason='stale_base_draft_revision',
        received_base_draft_revision=base_draft_revision,
        current_draft_revision=int(draft.draft_revision or 0),
        current_version_number=current_version_number,
        active_draft=_serialize_draft(draft, current_version_number=current_version_number),
        versions=[_serialize_version(version) for version in versions],
    )


def _raise_conflict_for_scope(context, scope_key, base_draft_revision, original_error):
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _active_draft_for_scope(session, context, scope_key)
        if draft is None:
            raise ScenarioDraftConflict(
                reason='stale_base_draft_revision',
                received_base_draft_revision=base_draft_revision,
                current_draft_revision=0,
                current_version_number=0,
                active_draft={},
                versions=[],
            ) from original_error
        try:
            _raise_if_stale(session, draft, base_draft_revision)
        except ScenarioDraftConflict as conflict:
            raise conflict from original_error
        versions = _versions_for_draft(session, draft.id)
        raise ScenarioDraftConflict(
            reason='stale_base_draft_revision',
            received_base_draft_revision=base_draft_revision,
            current_draft_revision=int(draft.draft_revision or 0),
            current_version_number=_current_version_number(versions),
            active_draft=_serialize_draft(draft, current_version_number=_current_version_number(versions)),
            versions=[_serialize_version(version) for version in versions],
        ) from original_error


def _raise_conflict_for_draft_id(context, draft_id, base_draft_revision, original_error):
    with db_engine.session_scope(_database_url(context), testing=_testing(context)) as session:
        draft = _draft_for_id(session, context, draft_id)
        if draft is None:
            raise ScenarioDraftNotFound('scenario draft not found') from original_error
        try:
            _raise_if_stale(session, draft, base_draft_revision)
        except ScenarioDraftConflict as conflict:
            raise conflict from original_error
        versions = _versions_for_draft(session, draft.id)
        raise ScenarioDraftConflict(
            reason='stale_base_draft_revision',
            received_base_draft_revision=base_draft_revision,
            current_draft_revision=int(draft.draft_revision or 0),
            current_version_number=_current_version_number(versions),
            active_draft=_serialize_draft(draft, current_version_number=_current_version_number(versions)),
            versions=[_serialize_version(version) for version in versions],
        ) from original_error


def _response(draft, versions):
    return {
        'storage': 'db',
        'activeDraft': _serialize_draft(draft, current_version_number=_current_version_number(versions))
        if draft is not None
        else None,
        'versions': [_serialize_version(version) for version in versions],
    }


def _current_version_number(versions):
    return max([int(version.version_number or 0) for version in versions] or [0])


def _serialize_draft(draft, *, current_version_number):
    return {
        'draftId': draft.id,
        'workspaceId': draft.workspace_id,
        'scopeKey': draft.scope_key,
        'name': draft.name,
        'scopePayload': deepcopy(draft.scope_payload or {}),
        'scenarioSourceHash': draft.scenario_source_hash,
        'overrides': deepcopy(draft.overrides or {}),
        'draftRevision': int(draft.draft_revision or 0),
        'versionNumber': int(current_version_number or 0),
        'updatedAt': _serialize_datetime(draft.updated_at),
        'updatedBy': draft.updated_by,
        'storage': 'db',
    }


def _serialize_version(version):
    return {
        'versionId': version.id,
        'draftId': version.scenario_draft_id,
        'versionNumber': int(version.version_number or 0),
        'draftRevision': int(version.draft_revision or 0),
        'name': version.name,
        'scopePayload': deepcopy(version.scope_payload or {}),
        'scenarioSourceHash': version.scenario_source_hash,
        'overrides': deepcopy(version.overrides or {}),
        'overrideCount': len(version.overrides or {}),
        'source': version.source,
        'changeNote': version.change_note,
        'createdAt': _serialize_datetime(version.created_at),
        'createdBy': version.created_by,
        'storage': 'db',
    }


def _serialize_event(event):
    return {
        'eventId': event.id,
        'draftId': event.scenario_draft_id,
        'eventNumber': int(event.event_number or 0),
        'eventType': event.event_type,
        'draftRevision': int(event.draft_revision or 0),
        'payload': deepcopy(event.payload or {}),
        'createdBy': event.created_by,
        'createdAt': _serialize_datetime(event.created_at),
    }


def _serialize_presence(presence):
    return {
        'presenceId': presence.id,
        'draftId': presence.scenario_draft_id,
        'userId': presence.user_id,
        'displayName': presence.display_name,
        'cursorPayload': deepcopy(presence.cursor_payload or {}),
        'mode': presence.mode,
        'lastSeenAt': _serialize_datetime(presence.last_seen_at),
    }


def _serialize_lock(lock):
    return {
        'lockId': lock.id,
        'draftId': lock.scenario_draft_id,
        'resourceType': lock.resource_type,
        'resourceId': lock.resource_id,
        'holderUserId': lock.holder_user_id,
        'holderDisplayName': lock.holder_display_name,
        'expiresAt': _serialize_datetime(lock.expires_at),
        'updatedAt': _serialize_datetime(lock.updated_at),
    }


def _utcnow():
    return datetime.now(timezone.utc)


def _normalize_datetime(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _serialize_datetime(value):
    if value is None:
        return None
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return str(value)


def _legacy_import_allowed(session, context):
    env = getattr(context, 'environ', None) or os.environ
    if not _scenario_legacy_import_enabled(env):
        return False
    explicit_workspace = str(env.get('SCENARIO_DRAFT_LEGACY_IMPORT_WORKSPACE_ID') or '').strip()
    if explicit_workspace:
        return explicit_workspace == context.workspace_id
    workspace_count = session.execute(select(func.count()).select_from(models.Workspace)).scalar_one()
    return int(workspace_count or 0) == 1


def _scenario_legacy_import_enabled(env):
    return runtime_state.scenario_legacy_import_enabled(env)


def _import_legacy_scope(session, context, scope_key, legacy_loader):
    data = legacy_loader() or {}
    entry = data.get('scenarios', {}).get(scope_key)
    if not isinstance(entry, dict):
        return None
    overrides = _validate_overrides(entry.get('overrides') or {})
    if 'scope_payload' in entry:
        raw_scope_payload = entry.get('scope_payload')
    elif 'scopePayload' in entry:
        raw_scope_payload = entry.get('scopePayload')
    else:
        raw_scope_payload = None
    scope_payload = _validate_scope_payload(raw_scope_payload)
    draft = models.ScenarioDraft(
        workspace_id=context.workspace_id,
        scope_key=scope_key,
        name=_normalize_name(entry.get('name')),
        scope_payload=scope_payload,
        scenario_source_hash=entry.get('scenario_source_hash') or entry.get('scenarioSourceHash'),
        overrides=overrides,
        draft_revision=1,
        created_by=_context_user_id(context),
        updated_by=_context_user_id(context),
    )
    session.add(draft)
    session.flush()
    _append_version(session, draft, source='legacy_json')
    session.flush()
    return draft
