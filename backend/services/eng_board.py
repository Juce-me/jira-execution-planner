"""Pure query, paging, projection, and scope primitives for strict ENG Board reads.

The module performs no I/O. Jira search, cancellation, and progressive page delivery
are injected by callers so the same strict implementation serves production and the
measurement harness.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import json
import math
import re
import threading
from urllib.parse import urlencode

from backend.epm.scope import normalize_epm_sprint_field
from backend.services.group_board import DEFAULT_COLUMN_COLOUR, normalize_group_board


PAGE_SIZE = 100
MAX_PAGES_PER_SEARCH = 101
MAX_PAGES_PER_GENERATION = 2600
MAX_EPICS = 1000
MAX_CHILDREN = 10000
MAX_BATCH_SIZE = 40
MAX_ENCODED_REQUEST_BYTES = 7000
COMPONENT_PAGE_TOKEN_HEADROOM_BYTES = 1024
CUSTOM_FIELD_RE = re.compile(r'^customfield_(\d+)$')

EPIC_FIELDS = (
    'summary', 'status', 'priority', 'assignee', 'updated', 'project',
    'parent',
)
CHILD_BASE_FIELDS = (
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'updated',
    'parent', 'project',
)


def strict_adapter_available(auth_mode, *, database_backed=False):
    """Return the release-gated capability for the current deployment profile."""
    return auth_mode == 'atlassian_oauth' and database_backed is True


class EngBoardError(ValueError):
    def __init__(self, code, *, phase='config', limit='none', observed=None, reason='none'):
        super().__init__(code)
        self.code = code
        self.phase = phase
        self.limit = limit
        self.observed = observed
        self.reason = reason


def canonical_json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def canonical_bytes(value):
    return canonical_json(value).encode('utf-8')


def _quote(value):
    text = str(value)
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'


def _normalized_key(value):
    return str(value or '').strip().upper()


def _normalized_names(values):
    return {str(value or '').strip().casefold() for value in values or () if str(value or '').strip()}


def normalize_projects(selected, *, saved_board_project_key=None):
    """Normalize server-selected projects, or one saved-board location fallback."""
    result = []
    by_key = {}
    for raw in selected or []:
        if isinstance(raw, str):
            key, kind = _normalized_key(raw), 'product'
        elif isinstance(raw, dict):
            key = _normalized_key(raw.get('key'))
            kind = str(raw.get('type') or 'product').strip().lower()
        else:
            raise EngBoardError('board_project_scope_required')
        if not key or kind not in {'product', 'tech', 'other'}:
            raise EngBoardError('board_project_scope_required')
        if key in by_key and by_key[key] != kind:
            raise EngBoardError('board_project_scope_required')
        if key not in by_key:
            by_key[key] = kind
            result.append((key, kind))
    if result:
        return tuple(result)
    fallback = _normalized_key(saved_board_project_key)
    if fallback:
        return ((fallback, 'fallback'),)
    raise EngBoardError('board_project_scope_required')


def normalize_board(raw_board):
    """Return strict runtime Board grammar or the selected-sprint synthetic shape."""
    if raw_board is None:
        return {
            'configured': False,
            'columns': ({'id': 'board-unconfigured', 'name': 'All epics', 'statuses': ()},),
            'doneEpicRetentionDays': None,
        }
    normalized, errors, _warnings = normalize_group_board(raw_board)
    if errors or normalized is None:
        raise EngBoardError('board_config_invalid')
    columns = [
        {**column, 'statuses': tuple(column['statuses'])}
        for column in normalized['columns']
    ]
    columns.insert(len(columns) - 1, {
        'id': 'board-unmapped',
        'name': 'Unmapped',
        'statuses': (),
        'colour': DEFAULT_COLUMN_COLOUR,
        'star': False,
        'min': None,
        'max': None,
    })
    return {
        'configured': True,
        'columns': tuple(columns),
        'doneEpicRetentionDays': normalized['doneEpicRetentionDays'],
    }


def validate_scope_configuration(scope, raw_board, components, *, team_ids=()):
    """Validate the saved Board/Component contract for one Board scope."""
    if scope not in {'all_work', 'component', 'sprint'}:
        raise EngBoardError('invalid_board_scope')
    board = normalize_board(raw_board)
    normalized_components = tuple(dict.fromkeys(
        str(value).strip() for value in components or () if str(value).strip()
    ))
    if scope in {'all_work', 'component'}:
        if not board['configured']:
            raise EngBoardError('board_config_invalid')
        has_teams = any(str(value).strip() for value in team_ids or ())
        if scope == 'component' and not normalized_components:
            raise EngBoardError('board_components_required')
        if scope == 'all_work' and not normalized_components and not has_teams:
            raise EngBoardError('board_components_required')
    return {
        'scope': scope,
        'board': board,
        'components': normalized_components,
    }


def build_scope_cohort_digest(
        key, *, workspace_id, site_id, user_id, department_id,
        shared_config_revisions, shared_config_content, effective_projects,
        project_access, fields, eligible_issue_types, components, teams,
        board, scope, sprint_id):
    """Return the server-keyed operational cohort for captured immutable scope.

    Credential material and rotating auth state are deliberately absent from the
    closed signature, so token rotation cannot split an otherwise equal cohort.
    """
    if not isinstance(key, bytes) or not key:
        raise EngBoardError('board_config_invalid')
    for value in (workspace_id, site_id, user_id, department_id):
        if not str(value or '').strip():
            raise EngBoardError('board_config_invalid')
    if scope not in {'all_work', 'component', 'sprint'}:
        raise EngBoardError('invalid_board_scope')
    if scope != 'sprint' and sprint_id is not None:
        raise EngBoardError('board_config_invalid')
    if scope == 'sprint' and (isinstance(sprint_id, bool) or not isinstance(sprint_id, int) or sprint_id <= 0):
        raise EngBoardError('board_sprint_required')
    captured = {
        'authPartition': {
            'workspaceId': str(workspace_id).strip(),
            'siteId': str(site_id).strip(),
            'userId': str(user_id).strip(),
        },
        'departmentId': str(department_id).strip(),
        'sharedConfigRevisions': shared_config_revisions,
        'sharedConfigContent': shared_config_content,
        'effectiveProjects': effective_projects,
        'projectAccess': project_access,
        'fields': fields,
        'eligibleIssueTypes': eligible_issue_types,
        'components': components,
        'teams': teams,
        'board': board,
        'scope': scope,
        'sprintId': sprint_id,
    }
    try:
        payload = canonical_bytes(captured)
    except (TypeError, ValueError, UnicodeEncodeError) as error:
        raise EngBoardError('board_config_invalid') from error
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


def build_scope_version(key, captured_scope, *, token_version):
    """Return opaque authority identity for one immutable Board request."""
    if not isinstance(key, bytes) or not key or not str(token_version or '').strip():
        raise EngBoardError('board_config_invalid')
    try:
        payload = canonical_bytes({
            'scope': captured_scope,
            'tokenVersion': str(token_version).strip(),
        })
    except (TypeError, ValueError, UnicodeEncodeError) as error:
        raise EngBoardError('board_config_invalid') from error
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


def build_epic_index_jql(projects, components, terminal_statuses, retention_days=28):
    if isinstance(retention_days, bool) or not isinstance(retention_days, int) or not 1 <= retention_days <= 90:
        raise EngBoardError('board_config_invalid')
    project_clause = ','.join(_quote(key) for key, _kind in projects)
    if not project_clause:
        raise EngBoardError('board_project_scope_required')
    clauses = [f'project in ({project_clause})', 'issuetype = Epic']
    components = tuple(dict.fromkeys(str(value).strip() for value in components or () if str(value).strip()))
    if components:
        clauses.append('component in (' + ','.join(_quote(value) for value in components) + ')')
    terminal_statuses = tuple(dict.fromkeys(
        str(value).strip() for value in terminal_statuses or () if str(value).strip()
    ))
    if terminal_statuses:
        statuses = ','.join(_quote(value) for value in terminal_statuses)
        history = ' OR '.join(
            f'status CHANGED TO {_quote(value)} AFTER -{retention_days}d'
            for value in terminal_statuses
        )
        clauses.append(
            f'(status not in ({statuses}) OR (status in ({statuses}) AND (({history}) OR created >= -{retention_days}d)))'
        )
    return ' AND '.join(clauses)


def _field_number(field_id, *, optional=False):
    if optional and not field_id:
        return None
    match = CUSTOM_FIELD_RE.fullmatch(str(field_id or ''))
    if not match:
        raise EngBoardError('board_field_config_invalid')
    return match.group(1)


def validate_custom_field_id(field_id, *, optional=False):
    _field_number(field_id, optional=optional)
    return field_id or None


def resolve_issue_type_ids(catalog, configured_names=None, *, key_present=False):
    if not isinstance(catalog, list):
        raise EngBoardError('board_field_config_invalid', phase='catalog')
    eligible = []
    for row in catalog:
        if not isinstance(row, dict):
            raise EngBoardError('board_field_config_invalid', phase='catalog')
        if not isinstance(row.get('id'), str) or not isinstance(row.get('name'), str):
            raise EngBoardError('board_field_config_invalid', phase='catalog')
        identifier = row['id'].strip()
        name = row['name'].strip()
        if not identifier or not name:
            raise EngBoardError('board_field_config_invalid', phase='catalog')
        hierarchy_level = row.get('hierarchyLevel')
        if isinstance(hierarchy_level, bool) or not isinstance(hierarchy_level, int):
            raise EngBoardError('board_field_config_invalid', phase='catalog')
        subtask = row.get('subtask')
        if not isinstance(subtask, bool):
            raise EngBoardError('board_field_config_invalid', phase='catalog')
        if hierarchy_level == 0 and subtask is False:
            eligible.append((identifier, name))
    names = list(configured_names if key_present else ['Story'])
    if names:
        wanted = {str(value).strip() for value in names if str(value).strip()}
        found_names = {name for _identifier, name in eligible if name in wanted}
        if found_names != wanted:
            raise EngBoardError('board_field_config_invalid', phase='catalog')
        ids = [identifier for identifier, name in eligible if name in wanted]
    else:
        ids = [identifier for identifier, _name in eligible]
    if not ids:
        raise EngBoardError('board_field_config_invalid', phase='catalog')
    return tuple(dict.fromkeys(ids))


def resolve_epic_link_field(field_catalog):
    if not isinstance(field_catalog, list):
        raise EngBoardError('board_field_config_invalid', phase='catalog')
    schema_matches = []
    for row in field_catalog:
        if not isinstance(row, dict):
            continue
        field_id = str(row.get('id') or '')
        schema = row.get('schema') or {}
        if field_id and schema.get('custom') == 'com.pyxis.greenhopper.jira:gh-epic-link':
            schema_matches.append(field_id)
    matches = list(dict.fromkeys(value for value in schema_matches if CUSTOM_FIELD_RE.fullmatch(value)))
    if len(matches) > 1:
        raise EngBoardError('board_field_config_invalid', phase='catalog')
    return matches[0] if matches else None


def build_child_jql(projects, issue_type_ids, epic_keys, *, epic_link_field_id=None,
                    sprint_field_id='customfield_10101', sprint_id=None,
                    team_field_id='customfield_30101', team_ids=()):
    project_clause = ','.join(_quote(key) for key, _kind in projects)
    type_clause = ','.join(_quote(value) for value in issue_type_ids)
    key_clause = ','.join(_quote(_normalized_key(key)) for key in epic_keys)
    if not project_clause or not type_clause or not key_clause:
        raise EngBoardError('board_config_invalid')
    clauses = [f'project in ({project_clause})', f'issuetype in ({type_clause})']
    if epic_link_field_id:
        epic_number = _field_number(epic_link_field_id)
        clauses.append(f'(cf[{epic_number}] in ({key_clause}) OR (cf[{epic_number}] IS EMPTY AND parent in ({key_clause})))')
    else:
        clauses.append(f'parent in ({key_clause})')
    if sprint_id is not None:
        if isinstance(sprint_id, bool) or not isinstance(sprint_id, int) or sprint_id <= 0:
            raise EngBoardError('board_sprint_required')
        sprint_number = _field_number(sprint_field_id)
        clauses.append(f'cf[{sprint_number}] = {sprint_id}')
    if team_ids:
        team_number = _field_number(team_field_id)
        clauses.append(f'cf[{team_number}] in (' + ','.join(_quote(value) for value in team_ids) + ')')
    return ' AND '.join(clauses)


def encoded_search_bytes(jql, fields, next_page_token=None):
    params = {'jql': jql, 'fields': ','.join(fields), 'maxResults': PAGE_SIZE}
    if next_page_token is not None:
        params['nextPageToken'] = next_page_token
    return len(urlencode(params).encode('utf-8'))


def build_team_discovery_jql(projects, issue_type_ids, *, team_ids,
                             team_field_id='customfield_30101'):
    """Discover department work across sprints without requiring Epic ownership."""
    project_clause = ','.join(_quote(key) for key, _kind in projects)
    type_clause = ','.join(_quote(value) for value in issue_type_ids)
    teams = tuple(dict.fromkeys(str(value).strip() for value in team_ids or () if str(value).strip()))
    if not project_clause or not type_clause or not teams:
        raise EngBoardError('board_config_invalid')
    team_number = _field_number(team_field_id)
    return (f'project in ({project_clause}) AND issuetype in ({type_clause}) AND '
            f'cf[{team_number}] in (' + ','.join(_quote(value) for value in teams) + ')')


def discover_team_epics(search, *, projects, issue_type_ids, team_ids, existing_epics,
                        epic_fields, terminal_statuses, retention_days=28,
                        team_field_id='customfield_30101', epic_link_field_id=None,
                        counters=None, cancel_check=lambda: None):
    """Union component Epics with department-story parents under strict budgets.

    The story scan is capped at MAX_CHILDREN, parent searches are key batches,
    and every request shares the generation pager and cancellation/deadline.
    Parent lookup applies the Epic's own status/retention, never story status.
    """
    if not team_ids:
        return list(existing_epics)
    counters = counters or PagerCounters()
    fields = ('parent',) + ((epic_link_field_id,) if epic_link_field_id else ())
    discovery_jql = build_team_discovery_jql(
        projects, issue_type_ids, team_ids=team_ids, team_field_id=team_field_id,
    )
    # Known component parents add no membership. Skip their stories during the
    # discovery scan; hydration still fetches every child of the final union.
    excluded = []
    base_discovery_jql = discovery_jql
    for key in sorted({_normalized_key(row.get('key')) for row in existing_epics} - {''}):
        candidate_keys = excluded + [key]
        clause = ','.join(_quote(value) for value in candidate_keys)
        parent_clause = f'(parent NOT IN ({clause}) OR parent IS EMPTY)'
        if epic_link_field_id:
            field = f'cf[{_field_number(epic_link_field_id)}]'
            parent_clause = f'({field} NOT IN ({clause}) OR ({field} IS EMPTY AND {parent_clause}))'
        candidate = base_discovery_jql + ' AND ' + parent_clause
        # Leave room for the continuation token; never turn this optimization
        # into a new request-size failure for large department indexes.
        if encoded_search_bytes(candidate, fields) > MAX_ENCODED_REQUEST_BYTES - 1024:
            break
        discovery_jql = candidate
        excluded = candidate_keys
    stories = strict_search(
        search, discovery_jql,
        fields, counters=counters, cancel_check=cancel_check, max_unique_keys=MAX_CHILDREN,
    )
    epics = {_normalized_key(row.get('key')): row for row in existing_epics}
    if '' in epics or len(epics) != len(existing_epics):
        raise EngBoardError('board_projection_invalid', phase='index')
    parent_keys = set()
    for story in stories:
        fields = story.get('fields')
        if not isinstance(fields, dict):
            raise EngBoardError('board_projection_invalid', phase='page')
        link = fields.get(epic_link_field_id) if epic_link_field_id else None
        key = _normalized_key(link.get('key') if isinstance(link, dict) else link)
        if not key:
            parent = fields.get('parent')
            if parent is not None and not isinstance(parent, dict):
                raise EngBoardError('board_projection_invalid', phase='page')
            key = _normalized_key((parent or {}).get('key'))
        if key and key not in epics:
            parent_keys.add(key)
    if len(epics) + len(parent_keys) > MAX_EPICS:
        raise EngBoardError('board_scope_too_large', phase='index', limit='unique_keys',
                            observed=len(epics) + len(parent_keys))
    base_jql = build_epic_index_jql(projects, (), terminal_statuses, retention_days)
    def parent_jql(keys):
        return base_jql + ' AND key in (' + ','.join(_quote(key) for key in keys) + ')'
    for batch in split_epic_batches(sorted(parent_keys), parent_jql, epic_fields):
        rows = strict_search(search, parent_jql(batch), epic_fields, counters=counters,
                             cancel_check=cancel_check, max_unique_keys=MAX_EPICS)
        for row in rows:
            key = _normalized_key(row.get('key'))
            if key not in batch:
                raise EngBoardError('board_projection_invalid', phase='page')
            epics[key] = row
    return [epics[key] for key in sorted(epics)]


def split_component_batches(components, build_jql, fields):
    """Split exact Jira Component names without normalizing their case."""
    batches = []
    current = []
    normalized = tuple(dict.fromkeys(
        str(value).strip() for value in components or () if str(value).strip()
    ))
    for component in normalized:
        trial = current + [component]
        if (len(trial) <= MAX_BATCH_SIZE
                and encoded_search_bytes(build_jql(trial), fields)
                <= MAX_ENCODED_REQUEST_BYTES - COMPONENT_PAGE_TOKEN_HEADROOM_BYTES):
            current = trial
            continue
        request_bytes = encoded_search_bytes(build_jql([component]), fields)
        if not current:
            raise EngBoardError('board_scope_too_large', phase='index', limit='url_bytes',
                                observed=request_bytes)
        batches.append(tuple(current))
        current = [component]
        if request_bytes > MAX_ENCODED_REQUEST_BYTES - COMPONENT_PAGE_TOKEN_HEADROOM_BYTES:
            raise EngBoardError('board_scope_too_large', phase='index', limit='url_bytes',
                                observed=request_bytes)
    if current:
        batches.append(tuple(current))
    return tuple(batches)


def iter_component_epic_batches(search, *, projects, components, epic_fields, terminal_statuses,
                                retention_days=28, counters=None, cancel_check=lambda: None):
    """Yield the cumulative Component-owned Epic index after each bounded search."""
    counters = counters or PagerCounters()

    def component_jql(batch):
        return build_epic_index_jql(projects, batch, terminal_statuses, retention_days)

    batches = split_component_batches(components, component_jql, epic_fields)
    epics = {}
    union_budget = UnionKeyBudget(MAX_EPICS)
    for batch_index, batch in enumerate(batches):
        rows = strict_search(
            search, component_jql(batch), epic_fields, counters=counters,
            cancel_check=cancel_check, max_unique_keys=MAX_EPICS, key_budget=union_budget,
        )
        for row in rows:
            key = _normalized_key(row.get('key'))
            if not key:
                raise EngBoardError('board_projection_invalid', phase='index')
            epics[key] = row
        if len(epics) > MAX_EPICS:
            raise EngBoardError('board_scope_too_large', phase='index', limit='unique_keys',
                                observed=len(epics))
        yield [epics[key] for key in sorted(epics)], batch_index == len(batches) - 1


def discover_component_epics(search, **kwargs):
    """Fetch the complete Component-owned Epic index within Jira GET limits."""
    epics = []
    for epics, _complete in iter_component_epic_batches(search, **kwargs):
        pass
    return epics


def split_epic_batches(epic_keys, build_jql, fields):
    batches = []
    current = []
    for raw_key in epic_keys:
        key = _normalized_key(raw_key)
        if not key:
            raise EngBoardError('board_projection_invalid', phase='remaining')
        trial = current + [key]
        if len(trial) <= MAX_BATCH_SIZE and encoded_search_bytes(build_jql(trial), fields) <= MAX_ENCODED_REQUEST_BYTES:
            current = trial
            continue
        if not current:
            raise EngBoardError('board_scope_too_large', phase='remaining', limit='url_bytes', observed=MAX_ENCODED_REQUEST_BYTES + 1)
        batches.append(tuple(current))
        current = [key]
        request_bytes = encoded_search_bytes(build_jql(current), fields)
        if request_bytes > MAX_ENCODED_REQUEST_BYTES:
            raise EngBoardError('board_scope_too_large', phase='remaining', limit='url_bytes', observed=request_bytes)
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

    def claim_request(self, request_bytes, search_page):
        with self.lock:
            if self.pages >= MAX_PAGES_PER_GENERATION:
                raise EngBoardError('board_scope_too_large', phase='index', limit='pages', observed=self.pages + 1)
            self.pages += 1
            self.max_pages_per_search = max(self.max_pages_per_search, search_page)
            self.max_encoded_request_bytes = max(self.max_encoded_request_bytes, request_bytes)


class UniqueKeyBudget:
    """Thread-safe incremental unique-key ceiling shared by concurrent searches."""

    def __init__(self, limit):
        self.limit = int(limit)
        self.keys = set()
        self.lock = threading.RLock()

    def accept(self, keys, *, complete):
        with self.lock:
            if any(key in self.keys for key in keys):
                raise EngBoardError('board_projection_invalid', phase='page')
            observed = len(self.keys) + len(keys)
            if observed > self.limit or (observed == self.limit and not complete):
                raise EngBoardError('board_scope_too_large', phase='index', limit='unique_keys', observed=observed)
            self.keys.update(keys)


class UnionKeyBudget:
    """Incremental ceiling that permits overlap between independent searches."""

    def __init__(self, limit):
        self.limit = int(limit)
        self.keys = set()
        self.lock = threading.RLock()

    def accept(self, keys, *, complete):
        with self.lock:
            additions = set(keys) - self.keys
            observed = len(self.keys) + len(additions)
            if observed > self.limit:
                raise EngBoardError('board_scope_too_large', phase='index', limit='unique_keys',
                                    observed=observed)
            self.keys.update(additions)


def strict_search(search, jql, fields, *, counters=None, cancel_check=lambda: None,
                  on_page=None, on_rows=None, max_unique_keys=None, key_budget=None):
    counters = counters or PagerCounters()
    local_budget = UniqueKeyBudget(max_unique_keys) if max_unique_keys is not None else None
    token = None
    seen_tokens = set()
    seen_keys = set()
    rows = []
    pages = 0
    while True:
        cancel_check()
        if pages >= MAX_PAGES_PER_SEARCH:
            raise EngBoardError('board_scope_too_large', phase='index', limit='pages', observed=pages + 1)
        request_bytes = encoded_search_bytes(jql, fields, token)
        if request_bytes > MAX_ENCODED_REQUEST_BYTES:
            raise EngBoardError('board_scope_too_large', phase='index', limit='url_bytes', observed=request_bytes)
        counters.claim_request(request_bytes, pages + 1)
        body = search({'jql': jql, 'fields': list(fields), 'maxResults': PAGE_SIZE, **({'nextPageToken': token} if token else {})})
        pages += 1
        if not isinstance(body, dict) or not isinstance(body.get('issues'), list) or len(body['issues']) > PAGE_SIZE or not isinstance(body.get('isLast'), bool):
            raise EngBoardError('board_projection_invalid', phase='page')
        page_rows = []
        page_keys = []
        for row in body['issues']:
            if not isinstance(row, dict):
                raise EngBoardError('board_projection_invalid', phase='page')
            key = _normalized_key(row.get('key'))
            if not key or key in seen_keys or key in page_keys:
                raise EngBoardError('board_projection_invalid', phase='page')
            page_keys.append(key)
            page_rows.append(row)
        is_last = body['isLast']
        next_token = body.get('nextPageToken')
        if is_last:
            if next_token:
                raise EngBoardError('board_projection_invalid', phase='page')
        elif not isinstance(next_token, str) or not next_token or next_token in seen_tokens:
            raise EngBoardError('board_projection_invalid', phase='page')
        if not is_last and pages >= MAX_PAGES_PER_SEARCH:
            raise EngBoardError('board_scope_too_large', phase='index', limit='pages', observed=pages + 1)
        for budget in (local_budget, key_budget):
            if budget is not None:
                budget.accept(page_keys, complete=is_last)
        seen_keys.update(page_keys)
        rows.extend(page_rows)
        if on_page is not None:
            # Page callbacks are a progressive-display seam, not an escape hatch
            # for arbitrary Jira fields. The caller receives only normalized,
            # bounded identities after the entire page and its budgets validate.
            on_page(tuple(page_keys))
        if on_rows is not None:
            on_rows(tuple(page_rows))
        if is_last:
            return rows
        seen_tokens.add(next_token)
        token = next_token


def classify_project(fields, project_map, *, fallback_product_projects=(), fallback_tech_projects=()):
    project = fields.get('project') or {}
    key = _normalized_key(project.get('key'))
    kind = dict(project_map).get(key)
    if kind in {'product', 'tech', 'other'}:
        return kind
    if kind != 'fallback':
        return 'other'
    identities = {_normalized_key(project.get('key')).casefold(), str(project.get('name') or '').strip().casefold()}
    if identities.intersection(_normalized_names(fallback_product_projects)):
        return 'product'
    if identities.intersection(_normalized_names(fallback_tech_projects)):
        return 'tech'
    return 'other'


def _text(value, *, nullable=False):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not value:
        raise EngBoardError('board_projection_invalid', phase='shape')
    return value


def _identity(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise EngBoardError('board_projection_invalid', phase='shape')
    return _text(str(value))


def _named(value, *, nullable=False):
    if value is None and nullable:
        return None
    if not isinstance(value, dict):
        raise EngBoardError('board_projection_invalid', phase='shape')
    name = value.get('name') or value.get('title') or value.get('value') or value.get('displayName')
    return {'id': _identity(value.get('id')), 'name': _text(name)}


def _person(value, *, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, list) and nullable:
        people = []
        for item in value:
            person = _person(item, nullable=True)
            if person is not None and person['accountId'] not in {row['accountId'] for row in people}:
                people.append(person)
        return people[0] if len(people) == 1 else None
    if not isinstance(value, dict):
        if nullable:
            return None
        raise EngBoardError('board_projection_invalid', phase='shape')
    avatar_urls = value.get('avatarUrls')
    avatar_url = None
    if isinstance(avatar_urls, dict):
        avatar_url = next((avatar_urls.get(size) for size in ('48x48', '32x32', '24x24', '16x16')
                           if isinstance(avatar_urls.get(size), str) and avatar_urls.get(size)), None)
    account_id = value.get('accountId')
    display_name = value.get('displayName')
    if nullable and (not isinstance(account_id, str) or not account_id
                     or not isinstance(display_name, str) or not display_name):
        return None
    return {'accountId': _text(account_id), 'displayName': _text(display_name), 'avatarUrl': avatar_url}


def _parent(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise EngBoardError('board_projection_invalid', phase='shape')
    fields = value.get('fields') or {}
    if not isinstance(fields, dict):
        raise EngBoardError('board_projection_invalid', phase='shape')
    key = _normalized_key(value.get('key'))
    summary = fields.get('summary')
    issue_type = fields.get('issuetype')
    # Jira can permission-reduce an embedded parent to its key. Parent metadata is
    # optional display context, so omit an incomplete parent instead of rejecting
    # an otherwise valid Epic and terminating the whole Board stream.
    if not key or not isinstance(summary, str) or not summary or not isinstance(issue_type, dict):
        return None
    issue_type_id = issue_type.get('id')
    issue_type_name = issue_type.get('name') or issue_type.get('title') or issue_type.get('value')
    if (isinstance(issue_type_id, bool) or not isinstance(issue_type_id, (str, int))
            or not isinstance(issue_type_name, str) or not issue_type_name):
        return None
    return {
        'key': key,
        'summary': summary,
        'issueType': {'id': str(issue_type_id), 'name': issue_type_name},
    }


def _finite_number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise EngBoardError('board_projection_invalid', phase='shape')
    return value


def _sprint_ids(value):
    if isinstance(value, (str, int)) and not isinstance(value, bool):
        try:
            sprint_id = int(value)
        except (TypeError, ValueError):
            return []
        return [sprint_id] if sprint_id > 0 else []
    return [row['id'] for row in normalize_epm_sprint_field(value) if row['id'] > 0]


def _team(value):
    if value is None:
        return None
    if isinstance(value, list):
        teams = []
        for item in value:
            normalized = _team(item)
            if normalized is not None and normalized['id'] not in {row['id'] for row in teams}:
                teams.append(normalized)
        return teams[0] if len(teams) == 1 else None
    if isinstance(value, dict):
        identity = value.get('id') or value.get('teamId')
        name = (value.get('name') or value.get('title') or value.get('value')
                or value.get('displayName') or value.get('teamName') or identity)
    else:
        return None
    identity = str(identity or '').strip()
    name = str(name or '').strip()
    if not identity or not name:
        return None
    return {'id': identity, 'name': name}


def _project_track(value):
    if value is None:
        return None
    if isinstance(value, list):
        tracks = []
        for item in value:
            normalized = _project_track(item)
            if normalized and normalized not in tracks:
                tracks.append(normalized)
        return tracks[0] if len(tracks) == 1 else None
    if isinstance(value, dict):
        value = value.get('value', value.get('name'))
    return value if isinstance(value, str) and value else None


def _shape_value(reason, projector, *args, **kwargs):
    """Attach a fixed field label to sanitized projection errors."""
    try:
        return projector(*args, **kwargs)
    except EngBoardError as error:
        if error.code == 'board_projection_invalid' and error.phase == 'shape' and error.reason == 'none':
            error.reason = reason
        raise


def project_board(epics, children, *, project_map, columns, epic_link_field_id=None,
                  story_points_field_id='customfield_10004', team_field_id='customfield_30101',
                  sprint_field_id='customfield_10101', project_track_field_id='customfield_35024',
                  delivery_owner_field_id=None, fallback_product_projects=(), fallback_tech_projects=(),
                  require_children=False):
    epic_by_key = {}
    for row in epics:
        key = _normalized_key(row.get('key') if isinstance(row, dict) else None)
        if not key or key in epic_by_key:
            raise EngBoardError('board_projection_invalid', phase='shape', reason='epic.key')
        epic_by_key[key] = row
    status_to_column = {}
    for column in columns:
        for status in column['statuses']:
            status_to_column.setdefault(status, column['id'])
    unmapped_column_id = (
        'board-unconfigured'
        if any(column['id'] == 'board-unconfigured' for column in columns)
        else 'board-unmapped'
    )
    child_map = {key: [] for key in epic_by_key}
    seen_children = set()
    for row in children:
        key = _normalized_key(row.get('key') if isinstance(row, dict) else None)
        if not key or key in seen_children:
            raise EngBoardError('board_projection_invalid', phase='shape', reason='child.key')
        seen_children.add(key)
        fields = row.get('fields') or {}
        if not isinstance(fields, dict):
            raise EngBoardError('board_projection_invalid', phase='shape', reason='child.fields')
        epic_link = fields.get(epic_link_field_id) if epic_link_field_id else None
        epic_key = _normalized_key(epic_link if not isinstance(epic_link, dict) else epic_link.get('key'))
        if not epic_key:
            epic_key = _normalized_key((fields.get('parent') or {}).get('key'))
        if epic_key not in epic_by_key:
            raise EngBoardError('board_projection_invalid', phase='shape', reason='child.parent')
        child_map[epic_key].append({
            'key': key,
            'summary': _shape_value('child.summary', _text, fields.get('summary')),
            'status': _shape_value('child.status', _named, fields.get('status')),
            'priority': _shape_value('child.priority', _named, fields.get('priority'), nullable=True),
            'issueType': _shape_value('child.issue_type', _named, fields.get('issuetype')),
            'assignee': _shape_value('child.assignee', _person, fields.get('assignee'), nullable=True),
            'updated': _shape_value('child.updated', _text, fields.get('updated'), nullable=True),
            'storyPoints': _shape_value('child.story_points', _finite_number, fields.get(story_points_field_id)),
            'team': _shape_value('child.team', _team, fields.get(team_field_id)),
            'sprintIds': _shape_value('child.sprints', _sprint_ids, fields.get(sprint_field_id)),
            'project': _shape_value('child.project', _named, fields.get('project')),
            'epicKey': epic_key,
            'projectClassification': classify_project(
                fields, project_map, fallback_product_projects=fallback_product_projects,
                fallback_tech_projects=fallback_tech_projects,
            ),
        })
    result_epics = []
    for epic_key in sorted(epic_by_key):
        if require_children and not child_map[epic_key]:
            continue
        fields = epic_by_key[epic_key].get('fields') or {}
        if not isinstance(fields, dict):
            raise EngBoardError('board_projection_invalid', phase='shape', reason='epic.fields')
        status = _shape_value('epic.status', _named, fields.get('status'))
        result_epics.append({
            'key': epic_key,
            'summary': _shape_value('epic.summary', _text, fields.get('summary')),
            'status': status,
            'priority': _shape_value('epic.priority', _named, fields.get('priority'), nullable=True),
            'assignee': _shape_value('epic.assignee', _person, fields.get('assignee'), nullable=True),
            'deliveryOwner': _shape_value(
                'epic.delivery_owner', _person, fields.get(delivery_owner_field_id), nullable=True,
            ) if delivery_owner_field_id else None,
            'projectTrack': _shape_value('epic.project_track', _project_track, fields.get(project_track_field_id)),
            'updated': _shape_value('epic.updated', _text, fields.get('updated'), nullable=True),
            'parent': _shape_value('epic.parent', _parent, fields.get('parent')),
            'columnId': status_to_column.get(status['name'], unmapped_column_id),
            'children': sorted(child_map[epic_key], key=lambda item: item['key']),
        })
    projection = {'epics': result_epics}
    canonical_bytes(projection)
    return projection
