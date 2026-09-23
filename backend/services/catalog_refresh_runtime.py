"""Bounded refresh execution for persisted workspace catalogs."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
import math
import os
import threading
import time
import uuid

import requests
from sqlalchemy.exc import OperationalError

from backend.auth.jira_auth import AuthError
from backend.jira_client import JiraCircuitBreaker
from backend.services.workspace_catalog_cache import (
    CatalogSnapshot,
    assert_catalog_refresh_actor,
    claim_catalog_refresh,
    finish_catalog_failure,
    load_sprint_catalog,
    load_sprint_team_catalog,
    publish_catalog,
    release_catalog_refresh,
)
from backend.services.sprints import SprintCatalogFetchError
from backend.services.sprint_teams import TeamCatalogFetchError
from backend.services.workspace_catalog_config import (
    build_team_catalog_identity,
    build_team_scope_digest,
)
from backend.services.workspace_dashboard_config import WorkspaceConfigFenceUnavailable


CATALOG_REFRESH_SECONDS = 60.0
CATALOG_REFRESH_WORKERS = 2


class CatalogRefreshDeadline(RuntimeError):
    code = 'refresh_budget_exhausted'

    def __init__(self, phase='catalog_refresh'):
        super().__init__(self.code)
        self.phase = phase


class CatalogCompletionError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class CatalogRefreshLockTimeout(RuntimeError):
    code = 'catalog_refresh_lock_timeout'

    def __init__(self):
        super().__init__(self.code)


@dataclass
class CatalogRefreshBudget:
    expires_at: float
    now_fn: object = time.monotonic
    cancelled: threading.Event = field(default_factory=threading.Event)

    @classmethod
    def start(cls, seconds=CATALOG_REFRESH_SECONDS, *, now_fn=time.monotonic):
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or seconds <= 0:
            raise ValueError('seconds must be positive')
        return cls(float(now_fn()) + float(seconds), now_fn=now_fn)

    def remaining(self, phase='catalog_refresh'):
        value = self.expires_at - float(self.now_fn())
        if self.cancelled.is_set() or value <= 0:
            raise CatalogRefreshDeadline(phase)
        return value

    def check(self, phase='catalog_refresh'):
        self.remaining(phase)

    def cancel(self):
        self.cancelled.set()


class CatalogRefreshObserver:
    _KEYS = frozenset({
        'jiraLogicalRequestCount', 'jiraCatalogCallCount', 'jiraSearchCallCount',
        'jiraPageCount', 'jiraAttemptCount', 'jiraRetryCount',
        'jiraFailureAttemptCount', 'jiraRateLimitCount', 'jiraFastFailCount',
        'jiraRetrySleepMs', 'jiraRetryAfterMs', 'jiraResponseBytes',
        'jiraFailedResponseBytes', 'oauthRefreshCount', 'oauthAttemptCount',
        'oauthRetryCount', 'oauthRateLimitCount',
    })

    def __init__(self):
        self._lock = threading.Lock()
        self._values = {key: 0 for key in self._KEYS}

    def add(self, key, value=1):
        if key not in self._values or isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError('invalid catalog diagnostic counter')
        if not math.isfinite(value) or value < 0:
            raise ValueError('invalid catalog diagnostic counter')
        with self._lock:
            self._values[key] += value

    def snapshot(self):
        with self._lock:
            return dict(self._values)


@dataclass
class CatalogRefreshTransport:
    budget: CatalogRefreshBudget
    observer: CatalogRefreshObserver = field(default_factory=CatalogRefreshObserver)
    breaker: JiraCircuitBreaker = field(
        default_factory=lambda: JiraCircuitBreaker(failure_threshold=5, open_seconds=30),
    )

    def resilient_kwargs(self):
        return {
            'breaker': self.breaker,
            'diagnostic_budget': self.budget,
            'diagnostic_observer': self.observer,
        }


def _as_aware(value):
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _is_catalog_lock_operational_error(error):
    return (
        isinstance(error, OperationalError)
        and str(getattr(getattr(error, 'orig', None), 'sqlstate', '') or '')
        in {'55P03', '57014'}
    )


def _load_snapshot(context, *, kind, config, sprint_id, database_url):
    if kind == 'sprints':
        return load_sprint_catalog(context, config=config, database_url=database_url)
    if kind == 'teams':
        return load_sprint_team_catalog(
            context, sprint_id=sprint_id, config=config, database_url=database_url,
        )
    raise ValueError('kind must be sprints or teams')


def read_catalog_completion(
    context, *, kind, attempt_id, expected_identity, sprint_id=None,
    resolve_config, database_url=None,
):
    """Read one identified attempt without admitting work or contacting Jira."""
    from backend.db import engine as db_engine

    try:
        uuid.UUID(str(attempt_id))
    except (TypeError, ValueError, AttributeError):
        raise CatalogCompletionError('invalid_catalog_completion') from None
    if not str(expected_identity or '').strip():
        raise CatalogCompletionError('invalid_catalog_completion')

    with db_engine.session_scope(database_url) as session:
        assert_catalog_refresh_actor(session, context)
        config = resolve_config(session, context)
    current_identity = (
        config.sprint_identity if kind == 'sprints'
        else build_team_catalog_identity(
            context.workspace_id,
            str(sprint_id or '').strip(),
            build_team_scope_digest(
                board_id=config.board_id, projects=config.projects,
                team_field_id=config.team_field_id, base_jql=config.base_jql,
            ),
        )
    )
    if current_identity != expected_identity:
        raise CatalogCompletionError('catalog_identity_changed')
    snapshot = _load_snapshot(
        context, kind=kind, config=config, sprint_id=sprint_id,
        database_url=database_url,
    )
    if snapshot.refresh_attempt_id != str(attempt_id):
        raise CatalogCompletionError('catalog_refresh_superseded')
    deadline = _as_aware(snapshot.attempt_deadline_at)
    if snapshot.refresh_status == 'pending' and deadline is not None and deadline <= datetime.now(timezone.utc):
        return replace(
            snapshot, refresh_status='failed',
            failure_code='refresh_budget_exhausted',
        )
    return snapshot


class CatalogRefreshRuntime:
    """Two admitted jobs total, with no executor waiting queue."""

    def __init__(
        self, *, fetch_sprints, fetch_teams=None, database_url=None,
        executor_factory=ThreadPoolExecutor,
        budget_factory=CatalogRefreshBudget.start,
    ):
        self._fetch_sprints = fetch_sprints
        self._fetch_teams = fetch_teams
        self._database_url = database_url
        self._budget_factory = budget_factory
        self._admission = threading.BoundedSemaphore(CATALOG_REFRESH_WORKERS)
        self._executor = executor_factory(
            max_workers=CATALOG_REFRESH_WORKERS,
            thread_name_prefix='catalog-refresh',
        )
        self._shutdown = False

    @property
    def has_waiting_queue(self):
        return False

    def shutdown(self, *, wait=False):
        if self._shutdown:
            return
        self._shutdown = True
        shutdown = getattr(self._executor, 'shutdown', None)
        if callable(shutdown):
            shutdown(wait=wait, cancel_futures=True)

    def _failure_code(self, error, *, budget=None):
        if isinstance(error, CatalogRefreshDeadline):
            return error.code
        if (
            isinstance(error, (CatalogRefreshLockTimeout, WorkspaceConfigFenceUnavailable))
            or _is_catalog_lock_operational_error(error)
        ):
            if budget is not None:
                try:
                    budget.check('fence_failure_classification')
                except CatalogRefreshDeadline:
                    return 'refresh_budget_exhausted'
            return 'catalog_refresh_lock_timeout'
        if isinstance(error, TimeoutError):
            return 'refresh_budget_exhausted'
        if isinstance(error, (SprintCatalogFetchError, TeamCatalogFetchError)):
            return error.code
        if isinstance(error, AuthError):
            cause = error.__cause__
            while cause is not None:
                if isinstance(cause, requests.Timeout):
                    return 'oauth_refresh_timeout'
                cause = cause.__cause__
            return 'auth_required'
        return str(getattr(error, 'code', '') or 'jira_unavailable')

    def _execute(self, context, claim, budget, resolve_config, *, propagate_auth):
        transport = CatalogRefreshTransport(budget)
        try:
            budget.check('worker_start')
            if claim.kind == 'sprints':
                payload = self._fetch_sprints(
                    board_id=claim.config.board_id, context=context,
                    diagnostic_transport=transport, budget=budget,
                )
            else:
                if self._fetch_teams is None:
                    raise RuntimeError('team catalog fetcher is unavailable')
                payload = self._fetch_teams(
                    sprint_id=claim.sprint_id, config=claim.config, context=context,
                    diagnostic_transport=transport, budget=budget,
                )
            budget.check('before_publication')
            published = publish_catalog(
                context, claim=claim, payload=payload, budget=budget,
                resolve_config=resolve_config, database_url=self._database_url,
            )
            if not published:
                finish_catalog_failure(
                    context, claim=claim, failure_code='catalog_identity_changed',
                    budget=budget, database_url=self._database_url,
                )
        except Exception as error:
            failure_code = self._failure_code(error, budget=budget)
            try:
                budget.check('failure_cleanup')
                finish_catalog_failure(
                    context, claim=claim, failure_code=failure_code,
                    budget=budget, database_url=self._database_url,
                )
            except Exception:
                pass
            if (
                propagate_auth and isinstance(error, AuthError)
                and failure_code != 'oauth_refresh_timeout'
            ):
                raise
        finally:
            self._admission.release()

    def refresh(
        self, context, *, kind, config, sprint_id=None, background=False,
        resolve_config,
    ):
        budget = self._budget_factory()
        budget.check('admission')
        if self._shutdown or not self._admission.acquire(blocking=False):
            return None
        claim = None
        try:
            owner = str(uuid.uuid4())
            claim = claim_catalog_refresh(
                context, kind=kind, sprint_id=sprint_id,
                expected_config=config, owner=owner, budget=budget,
                resolve_config=resolve_config, nonblocking=background,
                database_url=self._database_url,
            )
            if claim is None:
                self._admission.release()
                return None
            if background:
                try:
                    self._executor.submit(
                        self._execute, context, claim, budget, resolve_config,
                        propagate_auth=False,
                    )
                except Exception:
                    try:
                        release_catalog_refresh(
                            context, claim=claim, budget=budget,
                            database_url=self._database_url,
                        )
                    finally:
                        self._admission.release()
                    return None
                return claim
            self._execute(
                context, claim, budget, resolve_config, propagate_auth=True,
            )
            return claim
        except WorkspaceConfigFenceUnavailable as error:
            if claim is None:
                self._admission.release()
            budget.check('fence_failure_classification')
            raise CatalogRefreshLockTimeout() from error
        except OperationalError as error:
            if claim is None:
                self._admission.release()
            if not _is_catalog_lock_operational_error(error):
                raise
            budget.check('fence_failure_classification')
            raise CatalogRefreshLockTimeout() from error
        except Exception:
            if claim is None:
                self._admission.release()
            raise


_RUNTIME_LOCK = threading.Lock()
_RUNTIME_PID = None
_RUNTIME = None


def get_catalog_refresh_runtime(**kwargs):
    global _RUNTIME, _RUNTIME_PID
    pid = os.getpid()
    with _RUNTIME_LOCK:
        if _RUNTIME is None or _RUNTIME_PID != pid:
            previous = _RUNTIME
            _RUNTIME = CatalogRefreshRuntime(**kwargs)
            _RUNTIME_PID = pid
            if previous is not None:
                previous.shutdown()
        return _RUNTIME


def reset_catalog_refresh_runtime_for_tests():
    global _RUNTIME, _RUNTIME_PID
    with _RUNTIME_LOCK:
        if _RUNTIME is not None:
            _RUNTIME.shutdown(wait=True)
        _RUNTIME = None
        _RUNTIME_PID = None
