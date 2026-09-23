"""Transactional persistence for workspace Sprint and Sprint-Team catalogs."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
import uuid

from sqlalchemy import select, text

from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine
from backend.db import models
from backend.services.workspace_catalog_config import (
    EffectiveCatalogConfig,
    build_team_catalog_identity,
    build_team_scope_digest,
)
from backend.services.workspace_dashboard_config import (
    acquire_workspace_config_fence,
    merge_workspace_team_catalog_in_session,
)


@dataclass(frozen=True)
class CatalogSnapshot:
    identity: str | None
    payload: list | None
    validated_at: datetime | None
    next_refresh_at: datetime | None
    catalog_version: str | None
    refresh_attempt_id: str | None
    attempt_identity: str | None
    attempt_config_digest: str | None
    attempt_scope_digest: str | None
    attempt_deadline_at: datetime | None
    refresh_status: str
    failure_code: str | None
    last_failure_at: datetime | None
    retry_at: datetime | None
    refresh_lease_owner: str | None
    refresh_lease_until: datetime | None


@dataclass(frozen=True)
class RefreshClaim:
    owner: str
    identity: str
    config: EffectiveCatalogConfig
    kind: str
    sprint_id: str | None
    attempt_id: str
    attempt_deadline_at: datetime
    lease_until: datetime


def _now():
    return datetime.now(timezone.utc)


def _remaining(budget, phase='catalog_storage'):
    method = getattr(budget, 'remaining', None)
    if callable(method):
        try:
            value = method(phase)
        except TypeError:
            value = method()
    else:
        value = float(budget)
    return max(0.0, float(value))


def _db_now(session):
    if session.bind.dialect.name == 'postgresql':
        return session.execute(text('SELECT clock_timestamp()')).scalar_one()
    return _now()


def _snapshot(row, *, identity, payload_attr, matches=True):
    if row is None:
        return CatalogSnapshot(
            identity=identity, payload=None, validated_at=None, next_refresh_at=None,
            catalog_version=None,
            refresh_attempt_id=None, attempt_identity=None, attempt_config_digest=None,
            attempt_scope_digest=None, attempt_deadline_at=None, refresh_status='idle',
            failure_code=None, last_failure_at=None, retry_at=None,
            refresh_lease_owner=None, refresh_lease_until=None,
        )
    payload = deepcopy(getattr(row, payload_attr)) if matches and row.validated_at is not None else None
    attempt_matches = row.attempt_identity == identity
    return CatalogSnapshot(
        identity=identity, payload=payload, validated_at=row.validated_at if matches else None,
        next_refresh_at=getattr(row, 'next_refresh_at', None) if matches else None,
        catalog_version=row.catalog_version if matches else None,
        refresh_attempt_id=row.refresh_attempt_id if attempt_matches else None,
        attempt_identity=row.attempt_identity if attempt_matches else None,
        attempt_config_digest=row.attempt_config_digest if attempt_matches else None,
        attempt_scope_digest=getattr(row, 'attempt_scope_digest', None) if attempt_matches else None,
        attempt_deadline_at=row.attempt_deadline_at if attempt_matches else None,
        refresh_status=row.refresh_status if attempt_matches else 'idle',
        failure_code=row.failure_code if attempt_matches else None,
        last_failure_at=row.last_failure_at if attempt_matches else None,
        retry_at=row.retry_at if attempt_matches else None,
        refresh_lease_owner=row.refresh_lease_owner if attempt_matches else None,
        refresh_lease_until=row.refresh_lease_until if attempt_matches else None,
    )


def load_sprint_catalog(context, *, config, database_url=None):
    identity = config.sprint_identity
    if identity is None:
        return _snapshot(None, identity=None, payload_attr='sprints')
    with db_engine.session_scope(database_url) as session:
        assert_catalog_refresh_actor(session, context)
        row = session.execute(select(models.WorkspaceSprintCatalog).where(
            models.WorkspaceSprintCatalog.workspace_id == context.workspace_id,
            models.WorkspaceSprintCatalog.board_id == config.board_id,
        )).scalars().first()
        return _snapshot(row, identity=identity, payload_attr='sprints')


def _scope_digest(config):
    return build_team_scope_digest(
        board_id=config.board_id, projects=config.projects,
        team_field_id=config.team_field_id, base_jql=config.base_jql,
    )


def _normalized_sprint_id(value):
    raw = str(value or '').strip()
    if re.fullmatch(r'[1-9][0-9]*', raw) is None:
        raise ValueError('Team catalog requires a positive decimal sprint_id')
    return raw


def load_sprint_team_catalog(context, *, sprint_id, config, database_url=None):
    sprint_key = _normalized_sprint_id(sprint_id)
    scope_digest = _scope_digest(config)
    identity = build_team_catalog_identity(context.workspace_id, sprint_key, scope_digest)
    with db_engine.session_scope(database_url) as session:
        assert_catalog_refresh_actor(session, context)
        row = session.execute(select(models.WorkspaceSprintTeamCatalog).where(
            models.WorkspaceSprintTeamCatalog.workspace_id == context.workspace_id,
            models.WorkspaceSprintTeamCatalog.sprint_id == sprint_key,
        )).scalars().first()
        matches = bool(row is not None and row.scope_digest == scope_digest)
        return _snapshot(row, identity=identity, payload_attr='teams', matches=matches)


def assert_catalog_refresh_actor(session, context, *, budget=None, lock_for_publication=False):
    if budget is not None:
        _remaining(budget, 'actor_validation')
    lock = session.bind.dialect.name == 'postgresql'
    user_query = select(models.User).where(
        models.User.id == context.user_id, models.User.status == 'active',
        models.User.external_subject == context.atlassian_account_id,
    )
    if lock:
        user_query = user_query.with_for_update(read=True)
    if session.execute(user_query).scalars().first() is None:
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    if budget is not None:
        _remaining(budget, 'actor_validation')
    connection_query = select(models.AuthConnection).where(
        models.AuthConnection.id == context.auth_connection_id,
        models.AuthConnection.user_id == context.user_id,
        models.AuthConnection.workspace_id == context.workspace_id,
        models.AuthConnection.provider == 'atlassian_oauth',
        models.AuthConnection.status == 'active',
        models.AuthConnection.scope_provenance == 'provider',
    )
    if lock:
        connection_query = connection_query.with_for_update(read=True)
    connection = session.execute(connection_query).scalars().first()
    if connection is None:
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    if budget is not None:
        _remaining(budget, 'actor_validation')
    workspace_query = select(models.Workspace).where(
        models.Workspace.id == context.workspace_id,
    )
    if lock:
        workspace_query = workspace_query.with_for_update(read=True)
    workspace = session.execute(workspace_query).scalars().first()
    if workspace is None:
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    if budget is not None:
        _remaining(budget, 'actor_validation')
    context_site_url = str(context.site_url or '').rstrip('/').lower()
    connection_site_url = str(connection.site_url or '').rstrip('/').lower()
    workspace_site_url = str(workspace.jira_site_url or '').rstrip('/').lower()
    bound_site_url = connection_site_url or workspace_site_url
    context_cloud_id = str(context.cloud_id or '')
    if (
        str(connection.cloud_id or '') != context_cloud_id
        or bound_site_url != context_site_url
        or workspace.jira_cloud_id is not None
        and str(workspace.jira_cloud_id) != context_cloud_id
        or workspace.jira_site_url is not None
        and workspace_site_url != context_site_url
        or not getattr(context, 'granted_scopes_verified', False)
    ):
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    granted = set(getattr(context, 'granted_scopes', ()) or ())
    if not granted or not granted.issubset(set(connection.scopes or [])):
        raise AuthError('auth_required', 'Atlassian authentication is required.')
    if getattr(context, 'browser_session_id', ''):
        browser_query = select(models.BrowserSession).where(
            models.BrowserSession.id == context.browser_session_id,
            models.BrowserSession.user_id == context.user_id,
            models.BrowserSession.workspace_id == context.workspace_id,
            models.BrowserSession.auth_connection_id == context.auth_connection_id,
        )
        if lock and lock_for_publication:
            browser_query = browser_query.with_for_update(read=True)
        if session.execute(browser_query).scalars().first() is None:
            raise AuthError('auth_required', 'Atlassian authentication is required.')
    if budget is not None:
        _remaining(budget, 'actor_validation')


def _validate_kind(kind, sprint_id):
    if kind not in {'sprints', 'teams'}:
        raise ValueError('kind must be sprints or teams')
    if kind == 'sprints' and sprint_id is not None:
        raise ValueError('Sprint catalog forbids sprint_id')
    if kind == 'teams' and not str(sprint_id or '').strip():
        raise ValueError('Team catalog requires sprint_id')


def _row_for_claim(session, context, kind, key):
    model = models.WorkspaceSprintCatalog if kind == 'sprints' else models.WorkspaceSprintTeamCatalog
    field = model.board_id if kind == 'sprints' else model.sprint_id
    query = select(model).where(model.workspace_id == context.workspace_id, field == key)
    if session.bind.dialect.name == 'postgresql':
        query = query.with_for_update()
    return session.execute(query).scalars().first()


def claim_catalog_refresh(
    context, *, kind, sprint_id=None, expected_config, owner, budget,
    resolve_config, nonblocking=False, database_url=None,
):
    _validate_kind(kind, sprint_id)
    normalized_sprint_id = _normalized_sprint_id(sprint_id) if kind == 'teams' else None
    scope_digest = _scope_digest(expected_config) if kind == 'teams' else None
    identity = (
        expected_config.sprint_identity if kind == 'sprints'
        else build_team_catalog_identity(context.workspace_id, normalized_sprint_id, scope_digest)
    )
    row_key = expected_config.board_id if kind == 'sprints' else normalized_sprint_id
    if not identity:
        return None
    with db_engine.session_scope(database_url) as session:
        _remaining(budget, 'claim_fence')
        if not acquire_workspace_config_fence(
            session, context.workspace_id, budget=budget, nonblocking=nonblocking,
        ):
            return None
        assert_catalog_refresh_actor(session, context, budget=budget)
        _remaining(budget, 'claim_config')
        current = resolve_config(session, context)
        if current.workspace_id != expected_config.workspace_id or current.config_digest != expected_config.config_digest:
            return None
        row = _row_for_claim(session, context, kind, row_key)
        now = _db_now(session)
        if row is not None and row.refresh_lease_owner is not None:
            lease = row.refresh_lease_until
            if lease is not None and lease.tzinfo is None:
                lease = lease.replace(tzinfo=timezone.utc)
            if lease is not None and lease > now:
                return None
        attempt_id = str(owner)
        uuid.UUID(attempt_id)
        seconds = _remaining(budget, 'claim_deadline')
        if seconds <= 0:
            return None
        attempt_deadline = now + timedelta(seconds=seconds)
        lease_until = now + timedelta(seconds=120)
        if row is None:
            if kind == 'sprints':
                row = models.WorkspaceSprintCatalog(
                    workspace_id=context.workspace_id, board_id=row_key, sprints=[],
                    updated_by=context.user_id,
                )
            else:
                row = models.WorkspaceSprintTeamCatalog(
                    workspace_id=context.workspace_id, sprint_id=row_key,
                    sprint_name='', teams=[], updated_by=context.user_id,
                )
            session.add(row)
        row.refresh_attempt_id = attempt_id
        row.attempt_identity = identity
        row.attempt_config_digest = current.config_digest
        if kind == 'teams':
            row.attempt_scope_digest = _scope_digest(current)
        row.attempt_deadline_at = attempt_deadline
        row.refresh_status = 'pending'
        row.failure_code = row.last_failure_at = row.retry_at = None
        row.refresh_lease_owner = attempt_id
        row.refresh_lease_until = lease_until
        session.flush()
        return RefreshClaim(
            owner=attempt_id, identity=identity, config=expected_config, kind=kind,
            sprint_id=normalized_sprint_id,
            attempt_id=attempt_id, attempt_deadline_at=attempt_deadline,
            lease_until=lease_until,
        )


def _owned(row, claim):
    return bool(
        row is not None and row.refresh_status == 'pending'
        and row.refresh_lease_owner == claim.owner
        and row.refresh_attempt_id == claim.attempt_id
        and row.attempt_identity == claim.identity
    )


def publish_catalog(context, *, claim, payload, budget, resolve_config, database_url=None):
    with db_engine.session_scope(database_url) as session:
        _remaining(budget, 'publication_fence')
        acquire_workspace_config_fence(session, context.workspace_id, budget=budget)
        assert_catalog_refresh_actor(session, context, budget=budget, lock_for_publication=True)
        _remaining(budget, 'publication_config')
        current = resolve_config(session, context)
        if current.workspace_id != claim.config.workspace_id or current.config_digest != claim.config.config_digest:
            return False
        sprint_name = None
        if claim.kind == 'teams':
            sprint = _row_for_claim(session, context, 'sprints', current.board_id)
            sprint_item = next((
                item for item in (sprint.sprints or [])
                if isinstance(item, dict) and str(item.get('id')) == claim.sprint_id
            ), None) if sprint is not None and sprint.validated_at is not None else None
            sprint_name = str((sprint_item or {}).get('name') or '').strip()
            if sprint_item is None or not sprint_name:
                row = _row_for_claim(session, context, 'teams', claim.sprint_id)
                now = _db_now(session)
                lease = row.refresh_lease_until if row is not None else None
                attempt_deadline = row.attempt_deadline_at if row is not None else None
                if lease is not None and lease.tzinfo is None:
                    lease = lease.replace(tzinfo=timezone.utc)
                if attempt_deadline is not None and attempt_deadline.tzinfo is None:
                    attempt_deadline = attempt_deadline.replace(tzinfo=timezone.utc)
                if (
                    _owned(row, claim)
                    and lease is not None and lease > now
                    and attempt_deadline is not None and attempt_deadline > now
                    and _remaining(budget, 'failure_cleanup') > 0
                ):
                    row.refresh_status = 'failed'
                    row.failure_code = 'catalog_identity_changed'
                    row.last_failure_at = now
                    row.retry_at = now + timedelta(seconds=300)
                    row.refresh_lease_owner = row.refresh_lease_until = None
                    session.flush()
                return False
        row_key = current.board_id if claim.kind == 'sprints' else claim.sprint_id
        row = _row_for_claim(session, context, claim.kind, row_key)
        now = _db_now(session)
        deadline = row.refresh_lease_until if row is not None else None
        attempt_deadline = row.attempt_deadline_at if row is not None else None
        if deadline is not None and deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if attempt_deadline is not None and attempt_deadline.tzinfo is None:
            attempt_deadline = attempt_deadline.replace(tzinfo=timezone.utc)
        if (
            not _owned(row, claim) or deadline is None or deadline <= now
            or attempt_deadline is None or attempt_deadline <= now
            or _remaining(budget, 'publication') <= 0
        ):
            return False
        if claim.kind == 'sprints':
            row.sprints = deepcopy(payload or [])
            row.next_refresh_at = now + timedelta(hours=24)
        else:
            raw_teams = deepcopy(list(payload or []))
            issue_names = getattr(payload, 'issue_names', None)
            if issue_names is not None:
                directory_query = select(models.WorkspaceTeamCatalog).where(
                    models.WorkspaceTeamCatalog.workspace_id == context.workspace_id,
                )
                if session.bind.dialect.name == 'postgresql':
                    directory_query = directory_query.with_for_update()
                directory_row = session.execute(directory_query).scalars().first()
                latest_catalog = (
                    (directory_row.payload or {}).get('catalog') or {}
                    if directory_row is not None else {}
                )
                resolved = []
                for item in raw_teams:
                    if not isinstance(item, dict):
                        continue
                    team_id = str(item.get('id') or '').strip()
                    if not team_id:
                        continue
                    latest = latest_catalog.get(team_id)
                    latest_name = (
                        str(latest.get('name') or '').strip()
                        if isinstance(latest, dict) else ''
                    )
                    name = str(issue_names.get(team_id) or '').strip() or latest_name or team_id
                    resolved.append({'id': team_id, 'name': name})
                row.teams = sorted(
                    resolved, key=lambda item: (item['name'].casefold(), item['id']),
                )
                directory = {
                    team_id: {'id': team_id, 'name': str(name).strip()}
                    for team_id, name in issue_names.items()
                    if str(team_id).strip() and str(name).strip()
                }
            else:
                row.teams = raw_teams
                directory = {
                    str(item.get('id')): {'id': str(item.get('id')), 'name': str(item.get('name') or '').strip()}
                    for item in raw_teams if isinstance(item, dict) and item.get('id') and str(item.get('name') or '').strip()
                }
            row.sprint_name = sprint_name
            row.scope_digest = _scope_digest(current)
            if directory:
                merge_workspace_team_catalog_in_session(
                    session, context, {'catalog': directory, 'meta': {}}, merge=True,
                )
        row.validated_at = now
        row.catalog_version = str(uuid.uuid4())
        row.updated_by = context.user_id
        row.updated_at = now
        row.refresh_status = 'completed'
        row.failure_code = row.last_failure_at = row.retry_at = None
        row.refresh_lease_owner = row.refresh_lease_until = None
        session.flush()
        if _remaining(budget, 'publication_commit') <= 0:
            raise TimeoutError('catalog publication budget expired')
        return True


def _finish(context, *, claim, budget, failure_code=None, database_url=None):
    with db_engine.session_scope(database_url) as session:
        _remaining(budget, 'failure_fence')
        acquire_workspace_config_fence(session, context.workspace_id, budget=budget)
        row_key = claim.config.board_id if claim.kind == 'sprints' else claim.sprint_id
        row = _row_for_claim(session, context, claim.kind, row_key)
        if not _owned(row, claim):
            return False
        now = _db_now(session)
        lease = row.refresh_lease_until
        attempt_deadline = row.attempt_deadline_at
        for name, value in (('lease', lease), ('attempt', attempt_deadline)):
            if value is not None and value.tzinfo is None:
                if name == 'lease':
                    lease = value.replace(tzinfo=timezone.utc)
                else:
                    attempt_deadline = value.replace(tzinfo=timezone.utc)
        if (
            lease is None or lease <= now or attempt_deadline is None or attempt_deadline <= now
            or _remaining(budget, 'failure_cleanup') <= 0
        ):
            return False
        if failure_code:
            row.refresh_status = 'failed'
            row.failure_code = failure_code
            row.last_failure_at = now
            row.retry_at = now + timedelta(seconds=300)
        else:
            row.refresh_status = 'failed'
            row.failure_code = 'catalog_runtime_unavailable'
            row.last_failure_at = now
            row.retry_at = now + timedelta(seconds=300)
        row.refresh_lease_owner = row.refresh_lease_until = None
        session.flush()
        return True


def finish_catalog_failure(context, *, claim, failure_code, budget, database_url=None):
    return _finish(
        context, claim=claim, failure_code=failure_code, budget=budget,
        database_url=database_url,
    )


def release_catalog_refresh(context, *, claim, budget, database_url=None):
    return _finish(context, claim=claim, budget=budget, database_url=database_url)
