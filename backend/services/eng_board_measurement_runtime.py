"""Guarded, process-local runtime for the ENG Board diagnostic campaign.

This module deliberately imports neither Flask nor the measurement core.  It is
inert until ``CampaignRegistry.begin`` acquires the exclusive diagnostic lease.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import math
import secrets
import threading
import time

from backend.jira_client import JiraCircuitBreaker


SCHEMA_VERSION = 2
DEADLINE_MODE = 'cooperative'
STEP_SECONDS = 30.0
CAMPAIGN_TTL_SECONDS = 1800.0

ROUND_PROFILE_ORDER = (
    ('legacy_selected_sprint', 'candidate_selected_sprint', 'candidate_all_work', 'candidate_team_fallback_selected_sprint'),
    ('candidate_selected_sprint', 'candidate_all_work', 'candidate_team_fallback_selected_sprint', 'legacy_selected_sprint'),
    ('candidate_all_work', 'candidate_team_fallback_selected_sprint', 'legacy_selected_sprint', 'candidate_selected_sprint'),
    ('candidate_team_fallback_selected_sprint', 'legacy_selected_sprint', 'candidate_selected_sprint', 'candidate_all_work'),
    ('legacy_selected_sprint', 'candidate_team_fallback_selected_sprint', 'candidate_all_work', 'candidate_selected_sprint'),
)


def _build_step_table():
    rows = []
    for round_number, profiles in enumerate(ROUND_PROFILE_ORDER, 1):
        for profile in profiles:
            for cache_intent in ('refresh', 'reuse'):
                rows.append({
                    'step': len(rows),
                    'round': round_number,
                    'profile': profile,
                    'cacheIntent': cache_intent,
                    'kind': 'legacy' if profile == 'legacy_selected_sprint' else 'candidate',
                })
    return tuple(rows)


STEP_TABLE = _build_step_table()


class MeasurementRuntimeError(RuntimeError):
    def __init__(self, code, *, phase='preflight', status=409, limit='none', observed_bucket='unknown', observed=None):
        super().__init__(code)
        self.code = code
        self.phase = phase
        self.status = status
        self.limit = limit
        self.observed_bucket = observed_bucket
        self.observed = observed


class MeasurementDeadlineExceeded(MeasurementRuntimeError):
    def __init__(self, phase='body'):
        super().__init__('measurement_deadline_exceeded', phase=phase, status=504, limit='deadline')


@dataclass
class CooperativeBudget:
    expires_at: float
    cancelled: threading.Event = field(default_factory=threading.Event)
    now_fn: object = time.monotonic

    @classmethod
    def start(cls, seconds=STEP_SECONDS, *, now_fn=time.monotonic):
        return cls(float(now_fn()) + float(seconds), now_fn=now_fn)

    def remaining(self, phase='body'):
        value = self.expires_at - float(self.now_fn())
        if self.cancelled.is_set() or value <= 0:
            raise MeasurementDeadlineExceeded(phase)
        return value

    def check(self, phase='body'):
        self.remaining(phase)

    def cancel(self):
        self.cancelled.set()


COUNTER_KEYS = (
    'jiraLogicalRequestCount', 'jiraCatalogCallCount', 'jiraSearchCallCount',
    'jiraPageCount', 'jiraAttemptCount', 'jiraRetryCount',
    'jiraFailureAttemptCount', 'jiraRateLimitCount', 'jiraFastFailCount',
    'jiraRetrySleepMs', 'jiraRetryAfterMs', 'jiraResponseBytes',
    'jiraFailedResponseBytes', 'oauthRefreshCount', 'oauthAttemptCount',
    'oauthRetryCount', 'oauthRateLimitCount',
)


class DiagnosticObserver:
    def __init__(self):
        self._lock = threading.RLock()
        self._counters = {key: 0 for key in COUNTER_KEYS}

    def add(self, key, value=1):
        if key not in self._counters or isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError('invalid diagnostic counter')
        if not math.isfinite(value) or value < 0:
            raise ValueError('invalid diagnostic counter')
        with self._lock:
            self._counters[key] += value

    def snapshot(self):
        with self._lock:
            return dict(self._counters)


@dataclass
class DiagnosticJiraTransport:
    budget: CooperativeBudget
    observer: DiagnosticObserver = field(default_factory=DiagnosticObserver)
    breaker: JiraCircuitBreaker = field(default_factory=lambda: JiraCircuitBreaker(failure_threshold=5, open_seconds=30.0))

    def resilient_kwargs(self):
        return {
            'breaker': self.breaker,
            'diagnostic_budget': self.budget,
            'diagnostic_observer': self.observer,
        }


_BOUND_TRANSPORT = ContextVar('eng_board_measurement_transport', default=None)


def current_diagnostic_transport():
    return _BOUND_TRANSPORT.get()


@contextmanager
def bind_diagnostic_transport(transport):
    token = _BOUND_TRANSPORT.set(transport)
    try:
        yield transport
    finally:
        _BOUND_TRANSPORT.reset(token)


def owner_key(context):
    return (
        str(getattr(context, 'workspace_id', '') or ''),
        str(getattr(context, 'user_id', '') or ''),
        str(getattr(context, 'auth_connection_id', '') or ''),
        str(getattr(context, 'browser_session_id', '') or ''),
        str(getattr(context, 'token_version', '') or ''),
    )


@dataclass
class Campaign:
    campaign_id: str
    owner: tuple
    snapshot: object
    component_group: dict
    team_group: dict
    sprint_id: int
    transport: DiagnosticJiraTransport
    created_at: float
    expires_at: float
    next_step: int = 0
    reserved_step: int | None = None
    candidate_started: bool = False
    candidate_complete: bool = False
    legacy_started: set = field(default_factory=set)
    legacy_parts: set = field(default_factory=set)
    cancelled: bool = False
    ended: bool = False
    inflight: int = 0
    private: dict = field(default_factory=dict)


class CampaignRegistry:
    def __init__(self, *, now_fn=time.monotonic, ttl_seconds=CAMPAIGN_TTL_SECONDS):
        self.now_fn = now_fn
        self.ttl_seconds = float(ttl_seconds)
        self._lock = threading.RLock()
        self._publication_lock = threading.RLock()
        self._campaign = None
        self._sweeper_stop = None
        self._sweeper = None

    def _touch(self, campaign):
        campaign.expires_at = float(self.now_fn()) + self.ttl_seconds

    def _expire_locked(self):
        campaign = self._campaign
        if campaign is None or campaign.ended:
            return
        if float(self.now_fn()) < campaign.expires_at:
            return
        campaign.cancelled = True
        campaign.transport.budget.cancel()
        if campaign.inflight == 0:
            self._destroy_locked(campaign)

    def sweep(self):
        with self._publication_lock:
            with self._lock:
                self._expire_locked()

    def _start_sweeper_locked(self):
        if self._sweeper is not None and self._sweeper.is_alive():
            return
        stop = threading.Event()
        self._sweeper_stop = stop

        def run():
            while not stop.wait(30.0):
                self.sweep()

        self._sweeper = threading.Thread(target=run, name='eng-board-measurement-sweeper', daemon=True)
        self._sweeper.start()

    def _destroy_locked(self, campaign):
        if self._campaign is campaign:
            campaign.private.clear()
            campaign.ended = True
            self._campaign = None
            if self._sweeper_stop is not None:
                self._sweeper_stop.set()
            self._sweeper = None
            self._sweeper_stop = None

    def begin(self, context, snapshot, component_group, team_group, sprint_id):
        with self._lock:
            self._expire_locked()
            if self._campaign is not None:
                raise MeasurementRuntimeError('measurement_campaign_busy', status=409)
            try:
                sprint_value = int(sprint_id)
            except (TypeError, ValueError) as exc:
                raise MeasurementRuntimeError('measurement_sprint_required', status=400) from exc
            if isinstance(sprint_id, bool) or sprint_value <= 0:
                raise MeasurementRuntimeError('measurement_sprint_required', status=400)
            now = float(self.now_fn())
            budget = CooperativeBudget.start(STEP_SECONDS, now_fn=self.now_fn)
            campaign = Campaign('', owner_key(context), snapshot, dict(component_group), dict(team_group), sprint_value,
                                DiagnosticJiraTransport(budget), now, now + self.ttl_seconds)
            self._campaign = campaign
            self._start_sweeper_locked()
            return campaign

    def publish_begin(self, campaign):
        with self._lock:
            if self._campaign is not campaign or campaign.cancelled:
                raise MeasurementRuntimeError('measurement_campaign_expired')
            campaign.campaign_id = secrets.token_urlsafe(32)
            self._touch(campaign)
            return campaign

    def fail_begin(self, campaign):
        with self._lock:
            if self._campaign is campaign:
                campaign.cancelled = True
                campaign.transport.budget.cancel()
                if campaign.inflight == 0:
                    self._destroy_locked(campaign)

    def get(self, context, campaign_id, *, allow_expired=False):
        with self._lock:
            before = self._campaign
            self._expire_locked()
            campaign = self._campaign
            if before is not None and campaign is None and before.campaign_id == campaign_id:
                raise MeasurementRuntimeError('measurement_campaign_expired')
            if campaign is None or campaign.campaign_id != campaign_id or campaign.owner != owner_key(context):
                if allow_expired:
                    return None
                raise MeasurementRuntimeError('invalid_measurement_scope', status=404)
            if campaign.cancelled and allow_expired:
                return campaign
            if campaign.cancelled:
                raise MeasurementRuntimeError('measurement_campaign_expired')
            return campaign

    def reserve(self, context, campaign_id, step):
        campaign = self.get(context, campaign_id)
        with self._lock:
            if isinstance(step, bool) or not isinstance(step, int) or step != campaign.next_step or campaign.reserved_step is not None:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400, phase='reserve')
            campaign.reserved_step = step
            campaign.candidate_started = False
            campaign.candidate_complete = False
            campaign.legacy_started.clear()
            campaign.legacy_parts.clear()
            campaign.transport = DiagnosticJiraTransport(CooperativeBudget.start(STEP_SECONDS, now_fn=self.now_fn))
            self._touch(campaign)
            return campaign, STEP_TABLE[step]

    def validate_legacy_request(self, context, campaign_id, step, query):
        campaign = self.get(context, campaign_id)
        with self._lock:
            self._require_reserved(campaign, step, 'legacy')
            row = STEP_TABLE[step]
            lane = str(query.get('project') or '').strip().lower()
            team_ids = ','.join(str(value).strip() for value in campaign.component_group.get('teamIds') or [] if str(value).strip())
            label_map = campaign.component_group.get('teamLabels') or {}
            label_values = ((label_map.get(team_id) for team_id in team_ids.split(',')) if isinstance(label_map, dict) else label_map)
            team_labels = ','.join(str(value).strip() for value in label_values if str(value).strip())
            expected = {
                'sprint': str(campaign.sprint_id),
                'team': 'all',
                'groupId': str(campaign.component_group.get('id') or ''),
                'teamIds': team_ids,
                'teamLabels': team_labels,
                'project': lane,
                'purpose': 'dashboard',
                'refresh': 'true' if row['cacheIntent'] == 'refresh' else 'false',
            }
            allowed = set(expected) | {'timestamp'}
            if set(query) - allowed or lane not in {'product', 'tech'}:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            if any(str(query.get(key) or '') != value for key, value in expected.items()):
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            timestamp = query.get('timestamp')
            if timestamp is not None and (not str(timestamp).isdigit() or len(str(timestamp)) > 16):
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            if lane in campaign.legacy_started or lane in campaign.legacy_parts:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            campaign.legacy_started.add(lane)
            return campaign, lane

    def start_candidate(self, campaign, step):
        with self._lock:
            self._require_reserved(campaign, step, 'candidate')
            if campaign.candidate_started or campaign.candidate_complete:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            campaign.candidate_started = True

    @contextmanager
    def inflight(self, campaign):
        with self._lock:
            campaign.inflight += 1
        try:
            yield
        finally:
            with self._lock:
                campaign.inflight -= 1
                if campaign.cancelled and campaign.inflight == 0:
                    self._destroy_locked(campaign)

    def mark_candidate_complete(self, campaign, step):
        with self._lock:
            self._require_reserved(campaign, step, 'candidate')
            campaign.candidate_complete = True

    def mark_legacy_complete(self, campaign, step, lane):
        if lane not in {'product', 'tech'}:
            raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
        with self._lock:
            self._require_reserved(campaign, step, 'legacy')
            if lane in campaign.legacy_parts:
                raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
            campaign.legacy_parts.add(lane)

    def _require_reserved(self, campaign, step, kind=None):
        if self._campaign is not campaign or campaign.cancelled or campaign.reserved_step != step:
            raise MeasurementRuntimeError('invalid_measurement_scope', status=400)
        row = STEP_TABLE[step]
        if kind is not None and row['kind'] != kind:
            raise MeasurementRuntimeError('invalid_measurement_scope', status=400)

    def finish(self, context, campaign_id, step):
        campaign = self.get(context, campaign_id)
        with self._publication_lock:
            with self._lock:
                self._require_reserved(campaign, step)
                row = STEP_TABLE[step]
                complete = campaign.candidate_complete if row['kind'] == 'candidate' else campaign.legacy_parts == {'product', 'tech'}
                if not complete:
                    raise MeasurementRuntimeError('invalid_measurement_scope', status=400, phase='finish')
                campaign.reserved_step = None
                campaign.next_step += 1
                self._touch(campaign)
                return campaign.transport.observer.snapshot(), campaign.next_step

    def publication_check(self, campaign, step):
        with self._publication_lock:
            with self._lock:
                self._require_reserved(campaign, step)
                campaign.transport.budget.check('finish')
                return True

    @contextmanager
    def publication(self, campaign, step):
        with self._publication_lock:
            with self._lock:
                self._require_reserved(campaign, step)
                campaign.transport.budget.check('finish')
            yield

    def end(self, context, campaign_id):
        campaign = self.get(context, campaign_id)
        with self._publication_lock:
            with self._lock:
                if campaign.next_step != len(STEP_TABLE) or campaign.reserved_step is not None:
                    raise MeasurementRuntimeError('invalid_measurement_scope', status=400, phase='cleanup')
                self._destroy_locked(campaign)

    def abort(self, context, campaign_id):
        campaign = self.get(context, campaign_id, allow_expired=True)
        if campaign is None:
            return
        with self._publication_lock:
            with self._lock:
                campaign.cancelled = True
                campaign.transport.budget.cancel()
                if campaign.inflight == 0:
                    self._destroy_locked(campaign)

    def active(self):
        with self._lock:
            self._expire_locked()
            return self._campaign


CAMPAIGNS = CampaignRegistry()
