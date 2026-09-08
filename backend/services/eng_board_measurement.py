"""Pure ENG Board diagnostic query, paging, projection, and cache primitives.

The module contains no Flask, requests, credential, filesystem, or legacy-task
imports.  Application I/O is injected by the development-only route adapter.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import hashlib
import hmac
import json
import math
import re
import threading
from urllib.parse import urlencode


PAGE_SIZE = 100
MAX_PAGES_PER_SEARCH = 101
MAX_PAGES_PER_SAMPLE = 2600
MAX_EPICS = 1000
MAX_CHILDREN = 10000
MAX_BATCH_SIZE = 40
MAX_ENCODED_REQUEST_BYTES = 7000
MAX_CANDIDATE_CACHE_BYTES = 32 * 1024 * 1024
MAX_METADATA_CACHE_BYTES = 2 * 1024 * 1024
CUSTOM_FIELD_RE = re.compile(r'^customfield_(\d+)$')

EPIC_FIELDS = (
    'summary', 'status', 'priority', 'assignee', 'updated', 'project',
    'parent',
)
CHILD_BASE_FIELDS = (
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'updated',
    'parent', 'project',
)


class MeasurementCoreError(ValueError):
    def __init__(self, code, *, phase='config', limit='none', observed=None):
        super().__init__(code)
        self.code = code
        self.phase = phase
        self.limit = limit
        self.observed = observed


def canonical_json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def canonical_bytes(value):
    return canonical_json(value).encode('utf-8')


def private_digest(key, value):
    return hmac.new(key, canonical_bytes(value), hashlib.sha256).digest()


def _quote(value):
    text = str(value)
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'


def _normalized_key(value):
    return str(value or '').strip().upper()


def normalize_projects(selected):
    result = []
    by_key = {}
    for raw in selected or []:
        if isinstance(raw, str):
            key, kind = _normalized_key(raw), 'product'
        elif isinstance(raw, dict):
            key = _normalized_key(raw.get('key'))
            kind = str(raw.get('type') or 'product').strip().lower()
        else:
            raise MeasurementCoreError('measurement_project_scope_required')
        if not key or kind not in {'product', 'tech', 'other'}:
            raise MeasurementCoreError('measurement_project_scope_required')
        if kind == 'other':
            raise MeasurementCoreError('measurement_project_scope_required')
        if key in by_key and by_key[key] != kind:
            raise MeasurementCoreError('measurement_project_scope_required')
        if key not in by_key:
            by_key[key] = kind
            result.append({'key': key, 'type': kind})
    if not result:
        raise MeasurementCoreError('measurement_project_scope_required')
    return tuple((row['key'], row['type']) for row in result)


def normalize_measurement_board(raw_board):
    if not isinstance(raw_board, dict):
        raise MeasurementCoreError('measurement_board_invalid')
    raw_columns = raw_board.get('columns')
    if not isinstance(raw_columns, list) or not raw_columns:
        raise MeasurementCoreError('measurement_board_invalid')
    retention_present = 'doneEpicRetentionDays' in raw_board
    raw_retention = raw_board.get('doneEpicRetentionDays', 28)
    if isinstance(raw_retention, bool) or not isinstance(raw_retention, int) or raw_retention != 28:
        raise MeasurementCoreError('measurement_board_invalid')
    columns = []
    seen_ids = set()
    seen_statuses = set()
    for raw in raw_columns:
        if not isinstance(raw, dict):
            raise MeasurementCoreError('measurement_board_invalid')
        column_id = str(raw.get('id') or '').strip()
        statuses = tuple(str(item).strip() for item in raw.get('statuses') or [] if str(item).strip())
        if not column_id or column_id in seen_ids or len(set(statuses)) != len(statuses) or seen_statuses.intersection(statuses):
            raise MeasurementCoreError('measurement_board_invalid')
        seen_ids.add(column_id)
        seen_statuses.update(statuses)
        columns.append({
            'id': column_id,
            'name': str(raw.get('name') or '').strip(),
            'statuses': statuses,
            'star': bool(raw.get('star')),
        })
    if not retention_present:
        done_index = next((i for i, column in enumerate(columns) if 'Done' in column['statuses']), None)
        if done_index is not None and done_index != len(columns) - 1:
            columns.append(columns.pop(done_index))
    if not columns[-1]['statuses']:
        raise MeasurementCoreError('measurement_board_invalid')
    return {'columns': tuple(columns), 'doneEpicRetentionDays': 28}


def configured_components(group):
    components = tuple(dict.fromkeys(
        str(value).strip() for value in (group or {}).get('missingInfoComponents') or [] if str(value).strip()
    ))
    return components


def configured_teams(group):
    values = (group or {}).get('teamIds')
    if values is None:
        values = (group or {}).get('teams')
    result = []
    for raw in values or []:
        value = str(raw.get('id') if isinstance(raw, dict) else raw or '').strip()
        if value and value not in result:
            result.append(value)
    return tuple(result)


def profile_eligibility(group, dashboard_payload):
    try:
        projects = normalize_projects(((dashboard_payload or {}).get('projects') or {}).get('selected'))
        board = normalize_measurement_board((group or {}).get('board'))
    except MeasurementCoreError:
        return ()
    if not {'product', 'tech'}.issubset({kind for _key, kind in projects}):
        return ()
    components = configured_components(group)
    if components:
        return ('candidate_selected_sprint', 'candidate_all_work')
    if configured_teams(group):
        return ('candidate_team_fallback_selected_sprint',)
    return ()


def build_epic_index_jql(projects, components, terminal_statuses, retention_days=28):
    project_clause = ','.join(_quote(key) for key, _kind in projects)
    clauses = [f'project in ({project_clause})', 'issuetype = Epic']
    if components:
        clauses.append('component in (' + ','.join(_quote(value) for value in components) + ')')
    terminal_statuses = tuple(terminal_statuses or ())
    if terminal_statuses:
        statuses = ','.join(_quote(value) for value in terminal_statuses)
        history = ' OR '.join(
            f'status CHANGED TO {_quote(value)} AFTER -{int(retention_days)}d'
            for value in terminal_statuses
        )
        clauses.append(
            f'(status not in ({statuses}) OR (status in ({statuses}) AND (({history}) OR created >= -{int(retention_days)}d)))'
        )
    return ' AND '.join(clauses)


def _field_number(field_id, *, optional=False):
    if optional and not field_id:
        return None
    match = CUSTOM_FIELD_RE.fullmatch(str(field_id or ''))
    if not match:
        raise MeasurementCoreError('measurement_field_config_invalid')
    return match.group(1)


def validate_custom_field_id(field_id, *, optional=False):
    _field_number(field_id, optional=optional)
    return field_id or None


def resolve_issue_type_ids(catalog, configured_names=None, *, key_present=False):
    if not isinstance(catalog, list):
        raise MeasurementCoreError('measurement_field_config_invalid', phase='catalog')
    eligible = []
    for row in catalog:
        if not isinstance(row, dict) or isinstance(row.get('subtask'), str):
            continue
        if row.get('hierarchyLevel') == 0 and row.get('subtask') is False and str(row.get('id') or '').strip():
            eligible.append((str(row['id']), str(row.get('name') or '')))
    names = list(configured_names if key_present else ['Story'])
    if names:
        wanted = {str(value).strip() for value in names if str(value).strip()}
        found_names = {name for _identifier, name in eligible if name in wanted}
        if found_names != wanted:
            raise MeasurementCoreError('measurement_field_config_invalid', phase='catalog')
        ids = [identifier for identifier, name in eligible if name in wanted]
    else:
        ids = [identifier for identifier, _name in eligible]
    if not ids:
        raise MeasurementCoreError('measurement_field_config_invalid', phase='catalog')
    return tuple(dict.fromkeys(ids))


def resolve_epic_link_field(field_catalog):
    if not isinstance(field_catalog, list):
        raise MeasurementCoreError('measurement_field_config_invalid', phase='catalog')
    schema_matches = []
    name_matches = []
    for row in field_catalog:
        if not isinstance(row, dict):
            continue
        field_id = str(row.get('id') or '')
        schema = row.get('schema') or {}
        if field_id and (schema.get('custom') == 'com.pyxis.greenhopper.jira:gh-epic-link' or schema.get('customId') == 10014):
            schema_matches.append(field_id)
        if str(row.get('name') or '').strip() == 'Epic Link':
            name_matches.append(field_id)
    matches = schema_matches or name_matches
    matches = list(dict.fromkeys(value for value in matches if CUSTOM_FIELD_RE.fullmatch(value)))
    if len(matches) > 1:
        raise MeasurementCoreError('measurement_field_config_invalid', phase='catalog')
    return matches[0] if matches else None


def build_child_jql(projects, issue_type_ids, epic_keys, *, epic_link_field_id=None,
                    sprint_field_id='customfield_10101', sprint_id=None,
                    team_field_id='customfield_30101', team_ids=()):
    project_clause = ','.join(_quote(key) for key, _kind in projects)
    type_clause = ','.join(_quote(value) for value in issue_type_ids)
    key_clause = ','.join(_quote(_normalized_key(key)) for key in epic_keys)
    clauses = [f'project in ({project_clause})', f'issuetype in ({type_clause})']
    if epic_link_field_id:
        epic_number = _field_number(epic_link_field_id)
        clauses.append(f'(cf[{epic_number}] in ({key_clause}) OR (cf[{epic_number}] IS EMPTY AND parent in ({key_clause})))')
    else:
        clauses.append(f'parent in ({key_clause})')
    if sprint_id is not None:
        sprint_number = _field_number(sprint_field_id)
        clauses.append(f'cf[{sprint_number}] = {int(sprint_id)}')
    if team_ids:
        team_number = _field_number(team_field_id)
        clauses.append(f'cf[{team_number}] in (' + ','.join(_quote(value) for value in team_ids) + ')')
    return ' AND '.join(clauses)


def encoded_search_bytes(jql, fields, next_page_token=None):
    params = {'jql': jql, 'fields': ','.join(fields), 'maxResults': PAGE_SIZE}
    if next_page_token is not None:
        params['nextPageToken'] = next_page_token
    return len(urlencode(params).encode('utf-8'))


def split_epic_batches(epic_keys, build_jql, fields):
    batches = []
    current = []
    for key in epic_keys:
        trial = current + [key]
        if len(trial) <= MAX_BATCH_SIZE and encoded_search_bytes(build_jql(trial), fields) <= MAX_ENCODED_REQUEST_BYTES:
            current = trial
            continue
        if not current:
            raise MeasurementCoreError('measurement_scope_too_large', phase='remaining', limit='url_bytes', observed=MAX_ENCODED_REQUEST_BYTES + 1)
        batches.append(tuple(current))
        current = [key]
        if encoded_search_bytes(build_jql(current), fields) > MAX_ENCODED_REQUEST_BYTES:
            raise MeasurementCoreError('measurement_scope_too_large', phase='remaining', limit='url_bytes', observed=MAX_ENCODED_REQUEST_BYTES + 1)
    if current:
        batches.append(tuple(current))
    return tuple(batches)


@dataclass
class PagerCounters:
    pages: int = 0
    max_pages_per_search: int = 0
    max_encoded_request_bytes: int = 0
    lock: object = None

    def __post_init__(self):
        if self.lock is None:
            self.lock = threading.RLock()


def strict_search(search, jql, fields, *, counters=None, cancel_check=lambda: None):
    counters = counters or PagerCounters()
    token = None
    seen_tokens = set()
    seen_keys = set()
    rows = []
    pages = 0
    while True:
        cancel_check()
        request_bytes = encoded_search_bytes(jql, fields, token)
        with counters.lock:
            counters.max_encoded_request_bytes = max(counters.max_encoded_request_bytes, request_bytes)
        if request_bytes > MAX_ENCODED_REQUEST_BYTES:
            raise MeasurementCoreError('measurement_scope_too_large', phase='index', limit='url_bytes', observed=request_bytes)
        body = search({'jql': jql, 'fields': list(fields), 'maxResults': PAGE_SIZE, **({'nextPageToken': token} if token else {})})
        pages += 1
        with counters.lock:
            counters.pages += 1
            counters.max_pages_per_search = max(counters.max_pages_per_search, pages)
            total_pages = counters.pages
        if pages > MAX_PAGES_PER_SEARCH or total_pages > MAX_PAGES_PER_SAMPLE:
            raise MeasurementCoreError('measurement_scope_too_large', phase='index', limit='pages', observed=total_pages)
        if not isinstance(body, dict) or not isinstance(body.get('issues'), list) or len(body['issues']) > PAGE_SIZE or not isinstance(body.get('isLast'), bool):
            raise MeasurementCoreError('measurement_projection_invalid', phase='index')
        for row in body['issues']:
            if not isinstance(row, dict):
                raise MeasurementCoreError('measurement_projection_invalid', phase='index')
            key = _normalized_key(row.get('key'))
            if not key or key in seen_keys:
                raise MeasurementCoreError('measurement_projection_invalid', phase='index')
            seen_keys.add(key)
            rows.append(row)
        if body['isLast']:
            if body.get('nextPageToken'):
                raise MeasurementCoreError('measurement_projection_invalid', phase='index')
            return rows
        next_token = body.get('nextPageToken')
        if not isinstance(next_token, str) or not next_token or next_token in seen_tokens:
            raise MeasurementCoreError('measurement_projection_invalid', phase='index')
        seen_tokens.add(next_token)
        token = next_token


def classify_project(fields, project_map):
    project = fields.get('project') or {}
    return dict(project_map).get(_normalized_key(project.get('key')), 'other')


def _display_value(value):
    if isinstance(value, dict):
        return {key: _display_value(value[key]) for key in sorted(value) if key in {'id', 'key', 'name', 'displayName', 'value', 'summary', 'hierarchyLevel'}}
    if isinstance(value, list):
        return [_display_value(item) for item in value]
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise MeasurementCoreError('measurement_projection_invalid', phase='shape')


def project_board(epics, children, *, project_map, columns, epic_link_field_id=None,
                  story_points_field_id='customfield_10004', team_field_id='customfield_30101',
                  sprint_field_id='customfield_10101', project_track_field_id='customfield_35024',
                  delivery_owner_field_id=None):
    epic_by_key = {_normalized_key(row.get('key')): row for row in epics}
    status_to_column = {}
    for column in columns:
        for status in column['statuses']:
            status_to_column[status] = column['id']
    result_epics = []
    child_map = {key: [] for key in epic_by_key}
    seen_children = set()
    for row in children:
        key = _normalized_key(row.get('key'))
        if not key or key in seen_children:
            raise MeasurementCoreError('measurement_projection_invalid', phase='shape')
        seen_children.add(key)
        fields = row.get('fields') or {}
        epic_link = fields.get(epic_link_field_id) if epic_link_field_id else None
        epic_key = _normalized_key(epic_link if not isinstance(epic_link, dict) else epic_link.get('key'))
        if not epic_key:
            parent = fields.get('parent') or {}
            epic_key = _normalized_key(parent.get('key'))
        if epic_key not in epic_by_key:
            raise MeasurementCoreError('measurement_projection_invalid', phase='shape')
        child_map[epic_key].append({
            'key': key,
            'summary': _display_value(fields.get('summary')),
            'status': _display_value(fields.get('status')),
            'priority': _display_value(fields.get('priority')),
            'issueType': _display_value(fields.get('issuetype')),
            'assignee': _display_value(fields.get('assignee')),
            'updated': _display_value(fields.get('updated')),
            'storyPoints': _display_value(fields.get(story_points_field_id)),
            'team': _display_value(fields.get(team_field_id)),
            'sprint': _display_value(fields.get(sprint_field_id)),
            'project': _display_value(fields.get('project')),
            'parent': _display_value(fields.get('parent')),
            'epicKey': epic_key,
            'projectClassification': classify_project(fields, project_map),
        })
    for epic_key in sorted(epic_by_key):
        fields = epic_by_key[epic_key].get('fields') or {}
        status = (fields.get('status') or {}).get('name') if isinstance(fields.get('status'), dict) else fields.get('status')
        result_epics.append({
            'key': epic_key,
            'summary': _display_value(fields.get('summary')),
            'status': _display_value(fields.get('status')),
            'priority': _display_value(fields.get('priority')),
            'assignee': _display_value(fields.get('assignee')),
            'deliveryOwner': _display_value(fields.get(delivery_owner_field_id)) if delivery_owner_field_id else None,
            'projectTrack': _display_value(fields.get(project_track_field_id)),
            'updated': _display_value(fields.get('updated')),
            'project': _display_value(fields.get('project')),
            'initiative': _display_value(fields.get('parent')),
            'columnId': status_to_column.get(status, 'unmapped'),
            'children': sorted(child_map[epic_key], key=lambda item: item['key']),
        })
    projection = {'epics': result_epics}
    canonical_bytes(projection)
    return projection


class BoundedLru:
    def __init__(self, *, max_entries, max_bytes, ttl_seconds, now_fn):
        self.max_entries = int(max_entries)
        self.max_bytes = int(max_bytes)
        self.ttl_seconds = float(ttl_seconds)
        self.now_fn = now_fn
        self._entries = OrderedDict()
        self.total_bytes = 0

    def get(self, key):
        row = self._entries.get(key)
        if row is None:
            return None
        if self.now_fn() - row[0] >= self.ttl_seconds:
            self._drop(key)
            return None
        self._entries.move_to_end(key)
        return row[1]

    def put(self, key, value, *, size_value=None):
        size = len(canonical_bytes(value if size_value is None else size_value))
        if size > self.max_bytes:
            raise MeasurementCoreError('measurement_scope_too_large', phase='cache', limit='candidate_cache_bytes', observed=size)
        self._drop(key)
        self._entries[key] = (self.now_fn(), value, size)
        self.total_bytes += size
        while len(self._entries) > self.max_entries or self.total_bytes > self.max_bytes:
            old_key = next(iter(self._entries))
            self._drop(old_key)
        return size

    def _drop(self, key):
        row = self._entries.pop(key, None)
        if row is not None:
            self.total_bytes -= row[2]

    def clear(self):
        self._entries.clear()
        self.total_bytes = 0


def representative_campaign(document):
    rounds = document.get('rounds') or []
    if len(rounds) != 5:
        return False
    for round_row in rounds:
        cold_candidates = [sample for sample in round_row.get('samples') or []
                           if sample.get('profile', '').startswith('candidate_') and sample.get('cacheIntent') == 'refresh']
        if not cold_candidates:
            return False
        exercised = False
        concurrent = False
        for sample in cold_candidates:
            metrics = sample.get('metrics') or {}
            required = ('candidateEpicCount', 'epicCount', 'childCount', 'bootstrapChildCount', 'productChildCount', 'techChildCount')
            if any((metrics.get(key) or 0) < 1 for key in required):
                return False
            exercised = exercised or (metrics.get('maxPagesPerSearch', 0) >= 2 or metrics.get('maxBatchesPerColumn', 0) >= 2)
            concurrent = concurrent or metrics.get('maxConcurrency') == 2
            if sample.get('profile') == 'candidate_all_work' and (
                metrics.get('terminalEpicCount', 0) < 1 or metrics.get('unmappedEpicCount', 0) < 1
            ):
                return False
        if not exercised or not concurrent:
            return False
    return True
