"""Bounded operational observations; never Jira issue content or credentials."""

import math
import os
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError

from backend.db.models import LoadPerformance


RETENTION_DAYS = 30
QUERY_LIMIT = 10000
STAGES = frozenset({'cache', 'collect', 'total', 'jira-search', 'normalize-tasks',
                    'epic-enrichment', 'epic-counts-distribution', 'build-response',
                    'parse-params', 'auth-headers', 'epic-details', 'epic-counts',
                    'epic-distribution', 'dependencies', 'team-names'})
TOP_KEYS = {'loadId', 'groupId', 'sprintId', 'surface', 'outcome', 'durationMs', 'lanes'}
LANE_KEYS = {'project', 'durationMs', 'issueCount', 'epicCount', 'storyCount',
             'payloadBytes', 'cacheState', 'completeness', 'stages',
             'jiraRequests', 'jiraPages', 'jiraRetries'}


def collection_enabled(environ=None):
    env = os.environ if environ is None else environ
    return (str(env.get('APP_PERFORMANCE_DEBUG', 'true')).strip().lower() in {'true', '1', 'yes'}
            and bool(str(env.get('DATABASE_URL', '')).strip()))


def _number(value, maximum, integer=False):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not 0 <= value <= maximum or not math.isfinite(value)
            or (integer and not isinstance(value, int))):
        raise ValueError('Invalid numeric measurement')


def _scope(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid scope')


def validate_load(payload):
    if not isinstance(payload, dict) or set(payload) - {'dependencyDurationMs', 'firstContentMs'} != TOP_KEYS:
        raise ValueError('Invalid measurement fields')
    try:
        if str(uuid.UUID(payload['loadId'])) != payload['loadId']:
            raise ValueError('Invalid load id')
    except (TypeError, AttributeError):
        raise ValueError('Invalid load id') from None
    _scope(payload['groupId'])
    _scope(payload['sprintId'])
    if payload['surface'] != 'eng_sprint' or payload['outcome'] not in ('success', 'error', 'cancelled'):
        raise ValueError('Invalid measurement outcome or surface')
    _number(payload['durationMs'], 3600000)
    if payload.get('firstContentMs') is not None:
        _number(payload['firstContentMs'], payload['durationMs'])
    if payload.get('dependencyDurationMs') is not None:
        _number(payload['dependencyDurationMs'], 3600000)
        if payload['dependencyDurationMs'] > payload['durationMs']:
            raise ValueError('Dependency duration exceeds group duration')
    lanes = payload['lanes']
    if not isinstance(lanes, list) or len(lanes) > 2 or (not lanes and payload['outcome'] == 'success'):
        raise ValueError('Invalid measurement lanes')
    projects = set()
    for lane in lanes:
        if not isinstance(lane, dict) or set(lane) != LANE_KEYS:
            raise ValueError('Invalid lane fields')
        project = lane['project']
        if project not in ('product', 'tech') or project in projects:
            raise ValueError('Invalid lane project')
        projects.add(project)
        _number(lane['durationMs'], 3600000)
        if lane['durationMs'] > payload['durationMs']:
            raise ValueError('Lane duration exceeds group duration')
        for key in ('issueCount', 'epicCount', 'storyCount', 'payloadBytes'):
            _number(lane[key], 1000000000 if key == 'payloadBytes' else 1000000, integer=True)
        if lane['storyCount'] > lane['issueCount']:
            raise ValueError('Invalid issue counts')
        if lane['cacheState'] not in ('hit', 'miss', 'unknown') or lane['completeness'] not in ('complete', 'capped', 'unknown'):
            raise ValueError('Invalid lane state')
        if not isinstance(lane['stages'], dict) or not set(lane['stages']).issubset(STAGES):
            raise ValueError('Invalid stages')
        for duration in lane['stages'].values():
            _number(duration, 3600000)
        for key in ('jiraRequests', 'jiraPages', 'jiraRetries'):
            if lane[key] is not None:
                _number(lane[key], 100000, integer=True)
    if payload['outcome'] == 'success' and projects != {'product', 'tech'}:
        raise ValueError('Successful group load requires both lanes')
    return payload


def record_load(session, workspace_id, payload, *, environment, revision, now=None):
    value = validate_load(payload)
    now = now or datetime.now(timezone.utc)
    session.query(LoadPerformance).filter(
        LoadPerformance.recorded_at < now - timedelta(days=RETENTION_DAYS),
    ).delete(synchronize_session=False)
    if session.get(LoadPerformance, (workspace_id, value['loadId'])):
        return False
    try:
        with session.begin_nested():
            session.add(LoadPerformance(
                workspace_id=workspace_id, load_id=value['loadId'], group_id=value['groupId'],
                sprint_id=value['sprintId'], surface=value['surface'], outcome=value['outcome'],
                duration_ms=value['durationMs'], lanes=value['lanes'], environment=environment[:128],
                dependency_duration_ms=value.get('dependencyDurationMs'),
                first_content_ms=value.get('firstContentMs'),
                revision=revision[:128], recorded_at=now,
            ))
            session.flush()
    except IntegrityError:
        if session.get(LoadPerformance, (workspace_id, value['loadId'])):
            return False
        raise
    return True


def _percentile(values, percentile):
    if not values:
        return None
    values = sorted(values)
    rank = (len(values) - 1) * percentile
    lower = math.floor(rank)
    return round(values[lower] + (values[math.ceil(rank)] - values[lower]) * (rank - lower), 2)


def _complete(row):
    return bool(row.lanes) and all(lane['completeness'] == 'complete' for lane in row.lanes)


def _capped(row):
    return any(lane['completeness'] == 'capped' for lane in row.lanes)


def _summary(rows):
    completed = [row for row in rows if row.outcome == 'success' and not _capped(row)]
    values = [row.duration_ms for row in completed]
    unknown_count = sum(not _complete(row) for row in completed)
    return dict(sampleCount=len(rows), eligibleCount=sum(_complete(row) for row in completed),
                avgMs=round(sum(values) / len(values), 2) if values else None,
                p50Ms=_percentile(values, .5), p95Ms=_percentile(values, .95),
                breachCount=sum(value > 4000 for value in values),
                errorCount=sum(row.outcome == 'error' for row in rows),
                cancelledCount=sum(row.outcome == 'cancelled' for row in rows),
                cappedCount=sum(_capped(row) for row in rows), unknownCount=unknown_count,
                contextual=bool(unknown_count))


def load_report(session, workspace_id, filters=None, *, limit=QUERY_LIMIT, environment=None):
    filters = filters or {}
    if set(filters) - {'groupId', 'sprintId', 'cacheState', 'revision'}:
        raise ValueError('Invalid filters')
    for key, value in filters.items():
        _scope(value)
        if key == 'cacheState' and value not in ('hit', 'miss', 'unknown'):
            raise ValueError('Invalid cache state')
    query = session.query(LoadPerformance).filter(
        LoadPerformance.workspace_id == workspace_id,
        LoadPerformance.recorded_at >= datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS),
    )
    if environment is not None:
        query = query.filter(LoadPerformance.environment == environment)
    options = {}
    options_truncated = False
    for key, column in [('groups', LoadPerformance.group_id), ('sprints', LoadPerformance.sprint_id),
                        ('revisions', LoadPerformance.revision)]:
        choices = query.with_entities(column).distinct().order_by(column).limit(201).all()
        options[key] = [value[0] for value in choices[:200]]
        options_truncated = options_truncated or len(choices) > 200
    for key, column in [('groupId', LoadPerformance.group_id), ('sprintId', LoadPerformance.sprint_id),
                        ('revision', LoadPerformance.revision)]:
        if filters.get(key):
            query = query.filter(column == filters[key])
    rows = query.order_by(LoadPerformance.recorded_at.desc(), LoadPerformance.load_id).limit(limit + 1).all()
    truncated = len(rows) > limit
    rows = rows[:limit]
    if filters.get('cacheState'):
        rows = [row for row in rows if row.lanes and all(lane['cacheState'] == filters['cacheState'] for lane in row.lanes)]
    days = defaultdict(list)
    for row in rows:
        days[row.recorded_at.date().isoformat()].append(row)
    return dict(summary=_summary(rows), trend=[{'date': day, **_summary(days[day])} for day in sorted(days)],
                samples=[dict(loadId=row.load_id, groupId=row.group_id, sprintId=row.sprint_id,
                              surface=row.surface, outcome=row.outcome, durationMs=row.duration_ms,
                              dependencyDurationMs=row.dependency_duration_ms,
                              firstContentMs=row.first_content_ms,
                              lanes=row.lanes, recordedAt=row.recorded_at.replace(tzinfo=timezone.utc).isoformat(),
                              revision=row.revision, environment=row.environment) for row in rows[:200]],
                filters=options, targetMs=2000, sloMs=4000, truncated=truncated, queryLimit=limit,
                samplesTruncated=len(rows) > 200, filterOptionsTruncated=options_truncated,
                retentionDays=RETENTION_DAYS)
