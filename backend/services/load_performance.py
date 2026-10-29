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
# eng_board_stream imports this module through jira_client, so the Board search limit is mirrored here and
# tests/test_load_performance.py pins the two together.
MAX_PEAK_CHILD_SEARCHES = 4
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
EPM_KEYS = {'schemaVersion', 'loadId', 'groupId', 'sprintId', 'surface', 'scopeType', 'outcome',
            'durationMs', 'indexMs', 'lanes'}
EPM_LANE_KEYS = {'project', 'name', 'durationMs'}
EPM_GROUP_ID = 'epm'
EPM_TABS = ('active', 'backlog', 'archived')
EPM_MAX_LANES = 200
SCOPE_TYPES = ('all_work', 'component', 'sprint') + EPM_TABS


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
    if payload['scopeType'] not in ('all_work', 'component', 'sprint'):
        raise ValueError('Invalid Board scope')
    if payload['scopeType'] in ('all_work', 'component'):
        if payload['sprintId'] is not None:
            raise ValueError('Cross-sprint Board scope must not fabricate a sprint')
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
    _optional_number(payload, 'peakChildSearches', MAX_PEAK_CHILD_SEARCHES, integer=True)
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


def _validate_epm_load(payload):
    """One EPM board load: whole-load milestones plus one lane (rollup time) per EPM project."""
    if set(payload) != EPM_KEYS or payload.get('schemaVersion') != 1 or payload['groupId'] != EPM_GROUP_ID:
        raise ValueError('Invalid EPM measurement fields')
    try:
        if str(uuid.UUID(payload['loadId'])) != payload['loadId']:
            raise ValueError('Invalid load id')
    except (TypeError, AttributeError):
        raise ValueError('Invalid load id') from None
    if payload['scopeType'] not in EPM_TABS or payload['outcome'] not in ('success', 'error', 'cancelled'):
        raise ValueError('Invalid EPM scope or outcome')
    if payload['sprintId'] is not None:
        _scope(payload['sprintId'])
    _number(payload['durationMs'], 3600000)
    _optional_number(payload, 'indexMs', 3600000, duration_key='durationMs')
    lanes = payload['lanes']
    if not isinstance(lanes, list) or len(lanes) > EPM_MAX_LANES:
        raise ValueError('Invalid EPM lanes')
    projects = set()
    for lane in lanes:
        if not isinstance(lane, dict) or set(lane) != EPM_LANE_KEYS:
            raise ValueError('Invalid EPM lane fields')
        _scope(lane['project'])
        if lane['project'] in projects or not isinstance(lane['name'], str) or len(lane['name']) > 120 \
                or any(ord(character) < 32 for character in lane['name']):
            raise ValueError('Invalid EPM lane project')
        projects.add(lane['project'])
        _number(lane['durationMs'], payload['durationMs'])
    return payload


def validate_load(payload):
    if isinstance(payload, dict) and payload.get('surface') == 'eng_board':
        return _validate_board_load(payload)
    if isinstance(payload, dict) and payload.get('surface') == 'epm':
        return _validate_epm_load(payload)
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
    if row.surface == 'epm':
        return row.outcome == 'success'
    if row.surface == 'eng_board':
        return (row.schema_version == 1 and row.outcome == 'success' and row.completeness == 'complete'
                and row.scope_cohort_digest is not None
                and row.cache_state in ('hit', 'miss', 'mixed')
                and row.peak_child_searches is not None)
    return bool(row.lanes) and all(lane['completeness'] == 'complete' for lane in row.lanes)


def _capped(row):
    if row.surface in ('eng_board', 'epm'):
        return False
    return any(lane['completeness'] == 'capped' for lane in row.lanes)


PHASE_KEYS = ('waitMs', 'indexMs', 'focusedMs', 'restMs')
WEEKLY_BREACH_MS = 4000


def board_phases(row):
    """Split a complete Board load into four phases that add up to its duration.

    `firstFocusedContentMs` is stamped by the browser when the focused column's final frame has painted and
    `focusedCompleteMs` by the server when it emitted that frame, so their difference is what happened before
    the stream started (setup, catalog reads, network) plus the paint. Returns None where that would be negative.
    """
    if row.surface != 'eng_board' or not _complete(row):
        return None
    first, focused_done, index = row.first_content_ms, row.focused_complete_ms, row.index_ms
    if first is None or focused_done is None or index is None:
        return None
    phases = {'waitMs': first - focused_done, 'indexMs': index,
              'focusedMs': focused_done - index, 'restMs': row.duration_ms - first}
    if any(value < 0 for value in phases.values()):
        return None
    return {key: round(value, 2) for key, value in phases.items()}


def _week_start(moment):
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc)
    day = moment.date()
    return day - timedelta(days=day.weekday())


def _weekly(rows, now):
    """Median phase times per UTC calendar week (Monday start), for one Board scope at a time."""
    board = [row for row in rows if row.surface == 'eng_board']
    scopes = {row.scope_type for row in board}
    if len(scopes) > 1:
        return dict(scopeType=None, mixedScopes=True, weeks=[])
    by_week = defaultdict(list)
    for row in board:
        by_week[_week_start(row.recorded_at)].append(row)
    weeks = []
    for start in sorted(by_week):
        group = by_week[start]
        measured = [(row, board_phases(row)) for row in group]
        measured = [(row, phases) for row, phases in measured if phases]
        if not measured:
            continue
        loads = [row for row, _phases in measured]
        totals = [row.duration_ms for row in loads]
        weeks.append(dict(
            weekStart=start.isoformat(), loads=len(loads),
            medianMs=_percentile(totals, .5), p95Ms=_percentile(totals, .95),
            phases={key: _percentile([phases[key] for _row, phases in measured], .5) for key in PHASE_KEYS},
            medianJiraRequests=_percentile([row.jira_requests for row in loads if row.jira_requests is not None], .5),
            retries=sum(row.jira_retries or 0 for row in loads),
            medianPayloadBytes=_percentile([row.payload_bytes for row in loads if row.payload_bytes is not None], .5),
            breachCount=sum(value > WEEKLY_BREACH_MS for value in totals),
            errors=sum(row.outcome == 'error' for row in group),
            cancelled=sum(row.outcome == 'cancelled' for row in group),
            partial=start + timedelta(days=7) > now.date()))
    return dict(scopeType=next(iter(scopes)) if scopes and weeks else None, mixedScopes=False, weeks=weeks)


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _lane_dicts(row):
    return [lane for lane in (row.lanes or []) if isinstance(lane, dict)]


def _catch_up_capped(row):
    return any(lane.get('completeness') == 'capped' for lane in _lane_dicts(row))


def catch_up_list_ms(row):
    """Time until both issue lists arrived (the slower lane), or None when a lane failed, was aborted or capped.

    A failed or aborted lane is recorded with no body, so `payloadBytes > 0` separates a list that arrived from one
    that did not; the dependency tail and the load outcome do not matter.
    """
    if row.outcome not in ('success', 'error', 'cancelled') or _catch_up_capped(row):
        return None
    lanes = {lane.get('project'): lane for lane in _lane_dicts(row)}
    if set(lanes) != {'product', 'tech'}:
        return None
    for lane in lanes.values():
        payload_bytes = lane.get('payloadBytes')
        if not _finite(lane.get('durationMs')) or not _finite(payload_bytes) or payload_bytes <= 0:
            return None
    return max(lane['durationMs'] for lane in lanes.values())


def _catch_up_metric(values):
    return dict(avgMs=round(sum(values) / len(values), 2) if values else None,
                medianMs=_percentile(values, .5), p95Ms=_percentile(values, .95))


def _catch_up_weekly(rows, now, truncated=False):
    """Catch Up load times per UTC calendar week: lists loaded (slower lane) and fully loaded (whole group)."""
    by_week = defaultdict(list)
    for row in rows:
        if row.surface == 'eng_sprint':
            by_week[_week_start(row.recorded_at)].append(row)
    window_start = (now - timedelta(days=RETENTION_DAYS)).date()
    weeks = []
    for start in sorted(by_week):
        group = by_week[start]
        full = [row.duration_ms for row in group
                if row.outcome == 'success' and not _catch_up_capped(row) and _finite(row.duration_ms)]
        listed = [(row, catch_up_list_ms(row)) for row in group]
        listed = [(row, value) for row, value in listed if value is not None]
        hits = sum(all(lane.get('cacheState') == 'hit' for lane in _lane_dicts(row)) for row, _value in listed)
        weeks.append(dict(
            weekStart=start.isoformat(), loads=len(full), listLoads=len(listed),
            errors=sum(row.outcome == 'error' for row in group),
            cancelled=sum(row.outcome == 'cancelled' for row in group),
            capped=sum(_catch_up_capped(row) for row in group),
            cacheHitShare=round(hits / len(listed), 2) if listed else None,
            listLoaded=_catch_up_metric([value for _row, value in listed]),
            fullyLoaded=_catch_up_metric(full),
            partial=(start + timedelta(days=7) > now.date() or start <= window_start
                     or (truncated and start == min(by_week)))))
    return dict(weeks=weeks)


def _epm_lanes(row):
    return [lane for lane in _lane_dicts(row) if isinstance(lane.get('project'), str) and _finite(lane.get('durationMs'))]


def _epm_weekly(rows, now, truncated=False, project_id=None):
    """EPM load times per UTC week: Home project list arrived, and rollup loaded (one project's, or the whole load)."""
    by_week = defaultdict(list)
    for row in rows:
        if row.surface == 'epm':
            by_week[_week_start(row.recorded_at)].append(row)
    window_start = (now - timedelta(days=RETENTION_DAYS)).date()
    weeks = []
    for start in sorted(by_week):
        group = by_week[start]
        listed = [row.index_ms for row in group if _finite(row.index_ms)]
        rolled = []
        for row in group:
            if row.outcome != 'success' or not _finite(row.duration_ms):
                continue
            if project_id is None:
                rolled.append(row.duration_ms)
            else:
                rolled.extend(lane['durationMs'] for lane in _epm_lanes(row) if lane['project'] == project_id)
        weeks.append(dict(
            weekStart=start.isoformat(), loads=len(rolled), listLoads=len(listed),
            errors=sum(row.outcome == 'error' for row in group),
            cancelled=sum(row.outcome == 'cancelled' for row in group),
            projectsListed=_catch_up_metric(listed), rollupLoaded=_catch_up_metric(rolled),
            partial=(start + timedelta(days=7) > now.date() or start <= window_start
                     or (truncated and start == min(by_week)))))
    return dict(weeks=weeks)


def _epm_projects(rows, project_id=None):
    """Per-project rollup time across successful EPM loads, slowest p95 first."""
    times, names = defaultdict(list), {}
    for row in sorted((row for row in rows if row.surface == 'epm' and row.outcome == 'success'),
                      key=lambda row: row.recorded_at):
        for lane in _epm_lanes(row):
            if project_id is None or lane['project'] == project_id:
                times[lane['project']].append(lane['durationMs'])
                names[lane['project']] = lane.get('name') or lane['project']
    table = [dict(projectId=project, name=names[project], loads=len(values), **_catch_up_metric(values))
             for project, values in times.items()]
    table.sort(key=lambda entry: (-entry['p95Ms'], entry['projectId']))
    return table[:EPM_MAX_LANES]


def _cohort_key(row):
    if row.surface == 'epm':
        return (row.surface, row.scope_type, None, row.revision, None)
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


def load_report(session, workspace_id, filters=None, *, limit=QUERY_LIMIT, environment=None, now=None):
    filters = filters or {}
    now = now or datetime.now(timezone.utc)
    if set(filters) - {'groupId', 'sprintId', 'surface', 'scopeType', 'cacheState', 'revision',
                       'scopeCohortDigest', 'projectId'}:
        raise ValueError('Invalid filters')
    for key, value in filters.items():
        _scope(value)
        if key == 'cacheState' and value not in ('hit', 'miss', 'mixed', 'unknown'):
            raise ValueError('Invalid cache state')
        if key == 'surface' and value not in ('eng_sprint', 'eng_board', 'epm'):
            raise ValueError('Invalid surface')
        if key == 'scopeType' and value not in SCOPE_TYPES:
            raise ValueError('Invalid scope type')
        if key == 'scopeCohortDigest' and (len(value) != 64
                                           or any(character not in '0123456789abcdef' for character in value)):
            raise ValueError('Invalid cohort digest')
    query = session.query(LoadPerformance).filter(
        LoadPerformance.workspace_id == workspace_id,
        LoadPerformance.recorded_at >= now - timedelta(days=RETENTION_DAYS),
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
    project_filter = filters.get('projectId')
    # Lane-level predicates live inside JSON: scan the bounded report window, then apply them.
    scan_limit = limit if (not cache_filter or board_cache_filtered) and not project_filter else QUERY_LIMIT
    rows = ordered.limit(scan_limit + 1).all()
    source_truncated = len(rows) > scan_limit
    rows = rows[:scan_limit]
    if cache_filter and not board_cache_filtered:
        rows = [row for row in rows if (
            row.cache_state == cache_filter if row.surface == 'eng_board'
            else row.surface != 'epm' and row.lanes and all(lane['cacheState'] == cache_filter for lane in row.lanes)
        )]
    lane_names = {}
    for row in rows:
        for lane in (_epm_lanes(row) if row.surface == 'epm' else []):
            lane_names.setdefault(lane['project'], lane.get('name') or lane['project'])
    options['projects'] = [dict(id=project, name=lane_names[project]) for project in sorted(lane_names)[:200]]
    if project_filter:
        rows = [row for row in rows if row.surface == 'epm'
                and any(lane['project'] == project_filter for lane in _epm_lanes(row))]
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
    return dict(summary=summary, trend=trend, weekly=_weekly(rows, now),
                catchUpWeekly=_catch_up_weekly(rows, now, truncated),
                epmWeekly=_epm_weekly(rows, now, truncated, project_filter),
                epmProjects=_epm_projects(rows, project_filter),
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
                              scopeCohortDigest=row.scope_cohort_digest, phases=board_phases(row),
                              lanes=row.lanes, recordedAt=row.recorded_at.replace(tzinfo=timezone.utc).isoformat(),
                              revision=row.revision, environment=row.environment) for row in rows[:200]],
                filters=options, targetMs=2000, sloMs=4000, truncated=truncated, queryLimit=limit,
                samplesTruncated=len(rows) > 200, filterOptionsTruncated=options_truncated,
                retentionDays=RETENTION_DAYS)
