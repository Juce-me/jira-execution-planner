"""Bounded operational observations; never Jira issue content or credentials."""

import math
import os
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
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
BOARD_KEYS = {
    'schemaVersion', 'loadId', 'groupId', 'sprintId', 'surface', 'scopeType', 'outcome',
    'durationMs', 'indexMs', 'firstFocusedContentMs', 'focusedCompleteMs',
    'dependencyDurationMs', 'epicCount', 'issueCount', 'payloadBytes', 'jiraRequests',
    'jiraPages', 'jiraRetries', 'completeness', 'cacheState', 'peakChildSearches',
    'scopeCohortDigest',
}


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


def _optional_number(payload, key, maximum, *, integer=False, duration_key=None):
    value = payload.get(key)
    if value is None:
        return
    _number(value, maximum, integer=integer)
    if duration_key and value > payload[duration_key]:
        raise ValueError('Measurement milestone exceeds duration')


def _validate_board_load(payload):
    if set(payload) != BOARD_KEYS or payload.get('schemaVersion') != 1:
        raise ValueError('Invalid Board measurement fields')
    try:
        if str(uuid.UUID(payload['loadId'])) != payload['loadId']:
            raise ValueError('Invalid load id')
    except (TypeError, AttributeError):
        raise ValueError('Invalid load id') from None
    _scope(payload['groupId'])
    if payload['scopeType'] not in ('all_work', 'sprint'):
        raise ValueError('Invalid Board scope')
    if payload['scopeType'] == 'all_work':
        if payload['sprintId'] is not None:
            raise ValueError('All work must not fabricate a sprint')
    else:
        _scope(payload['sprintId'])
    if payload['outcome'] not in ('success', 'error', 'cancelled'):
        raise ValueError('Invalid measurement outcome')
    _number(payload['durationMs'], 3600000)
    for key in ('indexMs', 'firstFocusedContentMs', 'focusedCompleteMs', 'dependencyDurationMs'):
        _optional_number(payload, key, 3600000, duration_key='durationMs')
    for key in ('epicCount', 'issueCount'):
        _optional_number(payload, key, 1000000, integer=True)
    _optional_number(payload, 'payloadBytes', 1000000000, integer=True)
    for key in ('jiraRequests', 'jiraPages', 'jiraRetries'):
        _optional_number(payload, key, 100000, integer=True)
    _optional_number(payload, 'peakChildSearches', 2, integer=True)
    if payload['completeness'] not in ('complete', 'partial'):
        raise ValueError('Invalid Board completeness')
    if payload['cacheState'] not in ('hit', 'miss', 'mixed', 'unknown'):
        raise ValueError('Invalid Board cache state')
    digest = payload['scopeCohortDigest']
    if digest is not None and (not isinstance(digest, str) or len(digest) != 64
                               or any(character not in '0123456789abcdef' for character in digest)):
        raise ValueError('Invalid Board cohort digest')
    if payload['outcome'] == 'success':
        required = ('indexMs', 'firstFocusedContentMs', 'focusedCompleteMs', 'epicCount',
                    'issueCount', 'payloadBytes', 'jiraRequests', 'jiraPages', 'jiraRetries',
                    'peakChildSearches', 'scopeCohortDigest')
        if payload['completeness'] != 'complete' or payload['cacheState'] == 'unknown' \
                or any(payload[key] is None for key in required):
            raise ValueError('Successful Board measurement requires complete diagnostics')
    return payload


def validate_load(payload):
    if isinstance(payload, dict) and payload.get('surface') == 'eng_board':
        return _validate_board_load(payload)
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
                duration_ms=value['durationMs'], lanes=value.get('lanes', []), environment=environment[:128],
                dependency_duration_ms=value.get('dependencyDurationMs'),
                first_content_ms=value.get('firstContentMs', value.get('firstFocusedContentMs')),
                schema_version=value.get('schemaVersion'), scope_type=value.get('scopeType'),
                focused_complete_ms=value.get('focusedCompleteMs'), index_ms=value.get('indexMs'),
                epic_count=value.get('epicCount'), issue_count=value.get('issueCount'),
                payload_bytes=value.get('payloadBytes'), jira_requests=value.get('jiraRequests'),
                jira_pages=value.get('jiraPages'), jira_retries=value.get('jiraRetries'),
                completeness=value.get('completeness'), cache_state=value.get('cacheState'),
                peak_child_searches=value.get('peakChildSearches'),
                scope_cohort_digest=value.get('scopeCohortDigest'),
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
    if row.surface == 'eng_board':
        return (row.schema_version == 1 and row.outcome == 'success' and row.completeness == 'complete'
                and row.scope_cohort_digest is not None
                and row.cache_state in ('hit', 'miss', 'mixed')
                and row.peak_child_searches is not None)
    return bool(row.lanes) and all(lane['completeness'] == 'complete' for lane in row.lanes)


def _capped(row):
    if row.surface == 'eng_board':
        return False
    return any(lane['completeness'] == 'capped' for lane in row.lanes)


def _cohort_key(row):
    if row.surface == 'eng_board':
        return (row.surface, row.scope_type, row.cache_state, row.revision, row.scope_cohort_digest)
    lane_cache = tuple(sorted(lane.get('cacheState', 'unknown') for lane in (row.lanes or [])))
    return (row.surface, None, lane_cache, row.revision, None)


def _summary(rows):
    completed = [row for row in rows if row.outcome == 'success' and not _capped(row)]
    surfaces = {row.surface for row in completed}
    metric_rows = ([row for row in completed if _complete(row)]
                   if surfaces == {'eng_board'} else completed)
    mixed_cohorts = (len(surfaces) > 1
                     or len({_cohort_key(row) for row in metric_rows}) > 1)
    values = [] if mixed_cohorts else [row.duration_ms for row in metric_rows]
    first_content_values = ([] if mixed_cohorts else
                            [row.first_content_ms for row in metric_rows
                             if row.first_content_ms is not None])
    unknown_count = sum(not _complete(row) for row in completed)
    return dict(sampleCount=len(rows), eligibleCount=sum(_complete(row) for row in completed),
                avgMs=round(sum(values) / len(values), 2) if values else None,
                p50Ms=_percentile(values, .5), p95Ms=_percentile(values, .95),
                p50FirstContentMs=_percentile(first_content_values, .5),
                p95FirstContentMs=_percentile(first_content_values, .95),
                breachCount=sum(value > 4000 for value in values),
                errorCount=sum(row.outcome == 'error' for row in rows),
                cancelledCount=sum(row.outcome == 'cancelled' for row in rows),
                cappedCount=sum(_capped(row) for row in rows), unknownCount=unknown_count,
                contextual=bool(unknown_count or mixed_cohorts), mixedCohorts=mixed_cohorts)


def load_report(session, workspace_id, filters=None, *, limit=QUERY_LIMIT, environment=None):
    filters = filters or {}
    if set(filters) - {'groupId', 'sprintId', 'surface', 'scopeType', 'cacheState', 'revision',
                       'scopeCohortDigest'}:
        raise ValueError('Invalid filters')
    for key, value in filters.items():
        _scope(value)
        if key == 'cacheState' and value not in ('hit', 'miss', 'mixed', 'unknown'):
            raise ValueError('Invalid cache state')
        if key == 'surface' and value not in ('eng_sprint', 'eng_board'):
            raise ValueError('Invalid surface')
        if key == 'scopeType' and value not in ('all_work', 'sprint'):
            raise ValueError('Invalid scope type')
        if key == 'scopeCohortDigest' and (len(value) != 64
                                           or any(character not in '0123456789abcdef' for character in value)):
            raise ValueError('Invalid cohort digest')
    query = session.query(LoadPerformance).filter(
        LoadPerformance.workspace_id == workspace_id,
        LoadPerformance.recorded_at >= datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS),
    )
    if environment is not None:
        query = query.filter(LoadPerformance.environment == environment)
    options = {}
    options_truncated = False
    for key, column in [('groups', LoadPerformance.group_id), ('sprints', LoadPerformance.sprint_id),
                        ('surfaces', LoadPerformance.surface), ('scopeTypes', LoadPerformance.scope_type),
                        ('cacheStates', LoadPerformance.cache_state),
                        ('revisions', LoadPerformance.revision),
                        ('scopeCohortDigests', LoadPerformance.scope_cohort_digest)]:
        choices = query.with_entities(column).distinct().order_by(column).limit(201).all()
        options[key] = [value[0] for value in choices[:200] if value[0] is not None]
        options_truncated = options_truncated or len(choices) > 200
    for key, column in [('groupId', LoadPerformance.group_id), ('sprintId', LoadPerformance.sprint_id),
                        ('surface', LoadPerformance.surface), ('scopeType', LoadPerformance.scope_type),
                        ('revision', LoadPerformance.revision),
                        ('scopeCohortDigest', LoadPerformance.scope_cohort_digest)]:
        if filters.get(key):
            query = query.filter(column == filters[key])
    cache_filter = filters.get('cacheState')
    board_cache_filtered = cache_filter and filters.get('surface') == 'eng_board'
    if board_cache_filtered:
        query = query.filter(LoadPerformance.cache_state == cache_filter)
    elif cache_filter:
        # Exclude nonmatching Board rows in SQL. Legacy lane cache lives inside
        # JSON, so scan the bounded report window before applying its all-lanes
        # predicate; applying the user-visible limit first loses valid rows.
        query = query.filter(or_(LoadPerformance.surface != 'eng_board',
                                 LoadPerformance.cache_state == cache_filter))
    ordered = query.order_by(LoadPerformance.recorded_at.desc(), LoadPerformance.load_id)
    scan_limit = limit if not cache_filter or board_cache_filtered else QUERY_LIMIT
    rows = ordered.limit(scan_limit + 1).all()
    source_truncated = len(rows) > scan_limit
    rows = rows[:scan_limit]
    if cache_filter and not board_cache_filtered:
        rows = [row for row in rows if (
            row.cache_state == cache_filter if row.surface == 'eng_board'
            else row.lanes and all(lane['cacheState'] == cache_filter for lane in row.lanes)
        )]
    truncated = source_truncated or len(rows) > limit
    rows = rows[:limit]
    days = defaultdict(list)
    for row in rows:
        days[row.recorded_at.date().isoformat()].append(row)
    summary = _summary(rows)
    trend = [{'date': day, **_summary(days[day])} for day in sorted(days)]
    if summary['mixedCohorts']:
        for day in trend:
            day.update(avgMs=None, p50Ms=None, p95Ms=None, p50FirstContentMs=None,
                       p95FirstContentMs=None, breachCount=0, contextual=True, mixedCohorts=True)
    return dict(summary=summary, trend=trend,
                samples=[dict(loadId=row.load_id, groupId=row.group_id, sprintId=row.sprint_id,
                              surface=row.surface, outcome=row.outcome, durationMs=row.duration_ms,
                              dependencyDurationMs=row.dependency_duration_ms,
                              firstContentMs=row.first_content_ms,
                              schemaVersion=row.schema_version, scopeType=row.scope_type,
                              indexMs=row.index_ms, firstFocusedContentMs=row.first_content_ms,
                              focusedCompleteMs=row.focused_complete_ms,
                              epicCount=row.epic_count, issueCount=row.issue_count,
                              payloadBytes=row.payload_bytes, jiraRequests=row.jira_requests,
                              jiraPages=row.jira_pages, jiraRetries=row.jira_retries,
                              completeness=row.completeness, cacheState=row.cache_state,
                              peakChildSearches=row.peak_child_searches,
                              scopeCohortDigest=row.scope_cohort_digest,
                              lanes=row.lanes, recordedAt=row.recorded_at.replace(tzinfo=timezone.utc).isoformat(),
                              revision=row.revision, environment=row.environment) for row in rows[:200]],
                filters=options, targetMs=2000, sloMs=4000, truncated=truncated, queryLimit=limit,
                samplesTruncated=len(rows) > 200, filterOptionsTruncated=options_truncated,
                retentionDays=RETENTION_DAYS)
