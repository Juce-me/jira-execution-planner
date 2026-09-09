"""Diagnostic adapters over the production ENG Board strict core.

Measurement-only cache and campaign helpers remain here. Query, paging, scope,
classification, and projection behavior delegate to ``eng_board`` so the
diagnostic cannot drift into a second implementation.
"""

from collections import OrderedDict
import hashlib
import hmac

from backend.services import eng_board as strict_core


PAGE_SIZE = strict_core.PAGE_SIZE
MAX_PAGES_PER_SEARCH = strict_core.MAX_PAGES_PER_SEARCH
MAX_PAGES_PER_SAMPLE = strict_core.MAX_PAGES_PER_GENERATION
MAX_EPICS = strict_core.MAX_EPICS
MAX_CHILDREN = strict_core.MAX_CHILDREN
MAX_BATCH_SIZE = strict_core.MAX_BATCH_SIZE
MAX_ENCODED_REQUEST_BYTES = strict_core.MAX_ENCODED_REQUEST_BYTES
MAX_CANDIDATE_CACHE_BYTES = 32 * 1024 * 1024
MAX_METADATA_CACHE_BYTES = 2 * 1024 * 1024
CUSTOM_FIELD_RE = strict_core.CUSTOM_FIELD_RE
EPIC_FIELDS = strict_core.EPIC_FIELDS
CHILD_BASE_FIELDS = strict_core.CHILD_BASE_FIELDS
PagerCounters = strict_core.PagerCounters
UniqueKeyBudget = strict_core.UniqueKeyBudget
canonical_json = strict_core.canonical_json
canonical_bytes = strict_core.canonical_bytes


class MeasurementCoreError(ValueError):
    def __init__(self, code, *, phase='config', limit='none', observed=None):
        super().__init__(code)
        self.code = code
        self.phase = phase
        self.limit = limit
        self.observed = observed


_ERROR_CODES = {
    'board_project_scope_required': 'measurement_project_scope_required',
    'board_config_invalid': 'measurement_board_invalid',
    'board_field_config_invalid': 'measurement_field_config_invalid',
    'board_sprint_required': 'measurement_field_config_invalid',
    'board_scope_too_large': 'measurement_scope_too_large',
    'board_projection_invalid': 'measurement_projection_invalid',
}


def _call(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except strict_core.EngBoardError as error:
        raise MeasurementCoreError(
            _ERROR_CODES.get(error.code, error.code), phase=error.phase,
            limit=error.limit, observed=error.observed,
        ) from error


def private_digest(key, value):
    return hmac.new(key, canonical_bytes(value), hashlib.sha256).digest()


def normalize_projects(selected, *, saved_board_project_key=None):
    return _call(strict_core.normalize_projects, selected, saved_board_project_key=saved_board_project_key)


def normalize_measurement_board(raw_board):
    board = _call(strict_core.normalize_board, raw_board)
    if not board['configured']:
        raise MeasurementCoreError('measurement_board_invalid')
    return {'columns': board['columns'], 'doneEpicRetentionDays': board['doneEpicRetentionDays']}


def configured_components(group):
    return tuple(dict.fromkeys(
        str(value).strip() for value in (group or {}).get('missingInfoComponents') or [] if str(value).strip()
    ))


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
        normalize_measurement_board((group or {}).get('board'))
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
    return _call(strict_core.build_epic_index_jql, projects, components, terminal_statuses, retention_days)


def validate_custom_field_id(field_id, *, optional=False):
    return _call(strict_core.validate_custom_field_id, field_id, optional=optional)


def resolve_issue_type_ids(catalog, configured_names=None, *, key_present=False):
    return _call(strict_core.resolve_issue_type_ids, catalog, configured_names, key_present=key_present)


def resolve_epic_link_field(field_catalog):
    return _call(strict_core.resolve_epic_link_field, field_catalog)


def build_child_jql(projects, issue_type_ids, epic_keys, **kwargs):
    return _call(strict_core.build_child_jql, projects, issue_type_ids, epic_keys, **kwargs)


def encoded_search_bytes(jql, fields, next_page_token=None):
    return strict_core.encoded_search_bytes(jql, fields, next_page_token)


def split_epic_batches(epic_keys, build_jql, fields):
    return _call(strict_core.split_epic_batches, epic_keys, build_jql, fields)


def strict_search(search, jql, fields, **kwargs):
    return _call(strict_core.strict_search, search, jql, fields, **kwargs)


def classify_project(fields, project_map, **kwargs):
    return strict_core.classify_project(fields, project_map, **kwargs)


def project_board(epics, children, **kwargs):
    return _call(strict_core.project_board, epics, children, **kwargs)


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
            raise MeasurementCoreError(
                'measurement_scope_too_large', phase='cache',
                limit='candidate_cache_bytes', observed=size,
            )
        self._drop(key)
        self._entries[key] = (self.now_fn(), value, size)
        self.total_bytes += size
        while len(self._entries) > self.max_entries or self.total_bytes > self.max_bytes:
            self._drop(next(iter(self._entries)))
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
