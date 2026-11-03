"""Role-aware work reads for the quarterly work configuration (plan Task 4).

One admitted ``WorkConfigurationContext`` names the Jira issue types that play the
planning, grouping-parent, ancestor and optional-ancestor roles.  Everything that
used to hard-code Story/Epic/Initiative resolves the role here instead:

* ``legacy`` keeps the exact captured names/interpretations (text-swap semantics,
  ``issueTypes`` missing/null => Story, explicit [] => unrestricted, Epic Link);
* ``rnd_2027`` uses mapped issue-type ids, Jira ``parent`` only and mapped fields.

``load_planning_work`` is the bounded facade: planning issues, hydrated parents and
ancestors (batched, at most two hops), optional operational children, dependencies
and an explicit completeness verdict.  The module performs no I/O of its own; Jira
search is injected through a transport so production, workers and tests share it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re

from backend.services import eng_board
from backend.services import work_structure as ws
from backend.services.work_structure import MODEL_LEGACY, MODEL_RND_2027, WorkConfigError

# Ancestor/parent hydration is bounded by the stricter of this and the existing
# Board key-batch ceiling (``eng_board.MAX_BATCH_SIZE`` plus the request-byte budget).
PARENT_BATCH_LIMIT = 100
MAX_ANCESTOR_HOPS = 2
PAGE_SIZE = 100
DEFAULT_MAX_PAGES = 101
_TYPE_ID_RE = re.compile(r'[0-9]+')
_CUSTOM_FIELD_RE = re.compile(r'customfield_([0-9]+)')
_SPRINT_ID_RE = re.compile(r'[1-9][0-9]*')


class SearchUnavailable(Exception):
    """A non-fatal Jira search failure (non-200, malformed page); never an auth failure."""


def quote_jql(value):
    text = str(value if value is not None else '').strip()
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'


def custom_field_ref(field_id):
    """``cf[N]`` for a ``customfield_N`` id, else None."""
    match = _CUSTOM_FIELD_RE.fullmatch(str(field_id or ''))
    return f'cf[{match.group(1)}]' if match else None


def _add_clause(jql, clause):
    jql = (jql or '').strip()
    if not clause:
        return jql
    if not jql:
        return clause
    marker = re.search(r'\s+ORDER\s+BY\s+', jql, flags=re.IGNORECASE)
    if marker is None:
        return f'({jql}) AND {clause}' if re.search(r'\bOR\b', jql, flags=re.IGNORECASE) else f'{jql} AND {clause}'
    head, tail = jql[:marker.start()], jql[marker.start():]
    head = f'({head})' if re.search(r'\bOR\b', head, flags=re.IGNORECASE) else head
    return f'{head} AND {clause}{tail}'


class WorkRoles:
    """Read-only role resolution for one admitted context; no Jira I/O, no getters."""

    def __init__(self, context):
        self.context = context
        self.model = context.model
        self.is_legacy = context.model == MODEL_LEGACY
        self.configuration_id = context.configuration_id
        self.quarter = context.quarter
        self._legacy = dict(context.legacy) if context.legacy else {}
        self._hierarchy = dict(context.hierarchy)
        self._fields = {name: dict(value) for name, value in context.fields.items()}

    # --- scope and mapped fields ------------------------------------------------
    @property
    def projects(self):
        return [{'key': str(item['key']), 'type': str(item.get('type') or 'product')}
                for item in self.context.scope['projects']]

    @property
    def project_keys(self):
        return ws.project_keys({'scope': {'projects': self.context.scope['projects']}})

    @property
    def board_id(self):
        return str(self.context.scope['boardId'] or '')

    def field_id(self, name):
        """Mapped field id; an explicit blank is missing, never a default."""
        return str((self._fields.get(name) or {}).get('fieldId') or '')

    @property
    def team_field_id(self):
        return self.field_id('team')

    @property
    def sprint_field_id(self):
        return self.field_id('sprint')

    @property
    def story_points_field_id(self):
        return self.field_id('storyPoints')

    @property
    def project_track_field_id(self):
        return self.field_id('projectTrack')

    @property
    def parent_name_field_id(self):
        return self.field_id('parentName')

    @property
    def delivery_owner_field_id(self):
        return self.field_id('deliveryOwner')

    @property
    def allocation_field_id(self):
        return self.field_id('allocation')

    def flat_admin_settings(self):
        """Old flat key shapes for consumers that still read them (Board capture)."""
        return ws.project_legacy_admin_settings(self.context)

    # --- role type terms ---------------------------------------------------------
    @property
    def legacy_planning_names(self):
        """Captured Legacy planning names, or None once retired (id is then authoritative)."""
        if not self.is_legacy:
            return None
        names = self._legacy.get('legacyIssueTypeNames')
        return None if names is None else [str(item) for item in names]

    def _incomplete(self, path):
        return WorkConfigError('configuration_incomplete', paths=[path], configuration_id=self.configuration_id)

    @staticmethod
    def _valid_type_id(value):
        text = str(value or '').strip()
        return text if _TYPE_ID_RE.fullmatch(text) else ''

    def planning_type_id(self):
        return self._valid_type_id(self._hierarchy.get('planningIssueTypeId'))

    def parent_term(self):
        """``('name', 'Epic')`` (Legacy compatibility) or ``('id', value)``; required."""
        if self.is_legacy and (self._legacy.get('legacyHierarchyModes') or {}).get('parent') == 'compatibility':
            return ('name', 'Epic')
        type_id = self._valid_type_id(self._hierarchy.get('parentIssueTypeId'))
        if not type_id:
            raise self._incomplete('hierarchy.parentIssueTypeId')
        return ('id', type_id)

    def ancestor_term(self):
        """Ancestor role term, or None when cleared (enrichment simply disabled)."""
        if self.is_legacy and (self._legacy.get('legacyHierarchyModes') or {}).get('ancestor') == 'compatibility':
            return ('name', 'Initiative')
        type_id = self._valid_type_id(self._hierarchy.get('ancestorIssueTypeId'))
        return ('id', type_id) if type_id else None

    def optional_ancestor_term(self):
        if self.is_legacy:
            return None
        type_id = self._valid_type_id(self._hierarchy.get('optionalAncestorIssueTypeId'))
        return ('id', type_id) if type_id else None

    @staticmethod
    def term_clause(term, *, negate=False):
        if term is None:
            return ''
        _kind, value = term  # id terms are numeric, name terms are the captured Epic/Initiative literal
        return f"issuetype {'!=' if negate else '='} {value}"

    def parent_clause(self):
        return self.term_clause(self.parent_term())

    def non_parent_clause(self):
        """Lightweight rule: everything that is not the grouping parent."""
        return self.term_clause(self.parent_term(), negate=True)

    def ancestor_clause(self):
        return self.term_clause(self.ancestor_term())

    def planning_clause(self, *, surface='tasks'):
        """Planning-issue type clause for tasks/stats; '' means unrestricted.

        Legacy: missing/null => Story, explicit [] => unrestricted, names exactly as
        the existing surfaces format them.  New model: the mapped planning type id.
        """
        if self.is_legacy:
            names = self.legacy_planning_names
            if names is None:
                type_id = self.planning_type_id()
                if not type_id:
                    raise self._incomplete('hierarchy.planningIssueTypeId')
                return f'issuetype = {type_id}'
            names = [item.strip() for item in names if item.strip()]
            if not names:
                return ''
            if len(names) == 1:
                return f'type = "{names[0]}"'
            return 'type in (' + ', '.join(f'"{item}"' for item in names) + ')'
        type_id = self.planning_type_id()
        if not type_id:
            raise self._incomplete('hierarchy.planningIssueTypeId')
        return f'issuetype = {type_id}'

    def board_planning_type_ids(self, issue_type_catalog):
        """Board eligible planning type ids.

        Legacy keeps ``eng_board.resolve_issue_type_ids`` (key present only while the
        names are captured; ``[]`` => every eligible non-subtask level-zero type).
        """
        names = self.legacy_planning_names
        if self.is_legacy and names is not None:
            return eng_board.resolve_issue_type_ids(issue_type_catalog, names, key_present=True)
        type_id = self.planning_type_id()
        if not type_id:
            raise self._incomplete('hierarchy.planningIssueTypeId')
        return (type_id,)

    # --- relations and field clauses ----------------------------------------------
    @property
    def uses_epic_link(self):
        """Epic Link is only the preserved Story->Epic compatibility relationship."""
        return self.is_legacy and self.parent_term() == ('name', 'Epic')

    def children_clause(self, quoted_keys):
        joined = ','.join(quoted_keys) if not isinstance(quoted_keys, str) else quoted_keys
        if self.uses_epic_link:
            return f'("Epic Link" in ({joined}) OR parent in ({joined}))'
        return f'parent in ({joined})'

    def team_clause(self, team_ids):
        """Team filter; Legacy keeps the literal field name, the new model the mapped field."""
        ids = [str(item).strip() for item in team_ids or [] if str(item).strip()]
        if not ids:
            return ''
        if self.is_legacy:
            ref = '"Team[Team]"'
        else:
            ref = custom_field_ref(self.team_field_id)
            if ref is None:
                raise self._incomplete('fields.team.fieldId')
        if len(ids) == 1:
            return f'{ref} = "{ids[0]}"'
        return f'{ref} in (' + ', '.join(f'"{item}"' for item in ids) + ')'

    def sprint_clause(self, sprint_id):
        if sprint_id in (None, ''):
            return ''
        text = str(sprint_id)
        if _SPRINT_ID_RE.fullmatch(text) is None:
            raise WorkConfigError('sprint_catalog_mismatch')
        if self.is_legacy:
            return f'Sprint = {text}'
        ref = custom_field_ref(self.sprint_field_id)
        if ref is None:
            raise self._incomplete('fields.sprint.fieldId')
        return f'{ref} = {text}'

    @property
    def sprint_ref(self):
        """Sprint field reference for JQL: the literal name for Legacy, ``cf[N]`` for the mapped field."""
        if self.is_legacy:
            return 'Sprint'
        ref = custom_field_ref(self.sprint_field_id)
        if ref is None:
            raise self._incomplete('fields.sprint.fieldId')
        return ref

    def project_clause(self):
        keys = self.project_keys
        if not keys:
            raise self._incomplete('scope.projects')
        return 'project in (' + ', '.join(f'"{key}"' for key in keys) + ')'

    def base_jql(self, env_jql_query=''):
        """``JQL_QUERY`` still overrides the project chips in both eras."""
        if env_jql_query:
            return env_jql_query
        return self.project_clause() + ' ORDER BY created DESC'

    def parent_search_jql(self, scope_clause='', *, terminal_statuses=(), env_jql_query=''):
        """Open grouping-parent discovery (alerts, readiness); never a Story->Epic text swap."""
        jql = _add_clause(env_jql_query or self.project_clause(), self.parent_clause())
        statuses = [str(item).strip() for item in terminal_statuses if str(item).strip()]
        if statuses:
            jql = _add_clause(jql, 'status not in (' + ', '.join(quote_jql(item) for item in statuses) + ')')
        return _add_clause(jql, scope_clause)

    def planning_jql(self, team_ids=(), sprint_id=None, *, env_jql_query='', extra_clauses=(),
                     surface='tasks'):
        jql = self.base_jql(env_jql_query)
        for clause in (self.team_clause(team_ids), self.sprint_clause(sprint_id),
                       self.planning_clause(surface=surface), *extra_clauses):
            jql = _add_clause(jql, clause)
        return jql

    def parent_ref_matches(self, parent):
        """True when an embedded ``parent`` reference is of the grouping-parent role.

        A permission-reduced parent (no issue type) is accepted in the new model, where a
        planning Epic's only parent is the grouping parent; Legacy keeps its name test.
        """
        issue_type = (((parent or {}).get('fields') or {}).get('issuetype') or {})
        kind, value = self.parent_term()
        if kind == 'name':
            return str(issue_type.get('name') or '').lower() == value.lower()
        if not issue_type:
            return not self.is_legacy
        return str(issue_type.get('id') or '') == value

    def epic_key_of(self, issue, epic_link_field_id=None):
        """Strict grouping key as ``fetch_tasks`` derives it: Epic Link, else a role-matching parent."""
        fields = (issue or {}).get('fields') or {}
        if self.uses_epic_link and epic_link_field_id and fields.get(epic_link_field_id):
            return fields.get(epic_link_field_id)
        parent = fields.get('parent')
        if parent and parent.get('key') and self.parent_ref_matches(parent):
            return parent.get('key')
        return None

    def parent_key_of(self, issue, epic_link_field_id=None):
        """Parent grouping key of a planning issue: Epic Link only for Story->Epic."""
        fields = (issue or {}).get('fields') or {}
        if self.uses_epic_link and epic_link_field_id:
            link = fields.get(epic_link_field_id)
            key = link.get('key') if isinstance(link, dict) else link
            if isinstance(key, str) and key.strip():
                return key.strip().upper()
        parent = fields.get('parent')
        key = parent.get('key') if isinstance(parent, dict) else None
        return key.strip().upper() if isinstance(key, str) and key.strip() else ''


# --- request resolution ------------------------------------------------------------

@dataclass(frozen=True, eq=False)
class WorkRequest:
    context: object
    roles: WorkRoles
    sprint: dict | None = None

    @property
    def cache_context(self):
        return self.context


_REVISION_RE = re.compile(r'[0-9]{1,9}')
_ID_RE = re.compile(r'[A-Za-z0-9_-]{1,64}')


def parse_selectors(args):
    """Strict single-valued ``(configurationId, configurationRevision, quarter)``; 400 on malformed."""
    result = {}
    for name, code in (('configurationId', 'invalid_configuration_id'),
                       ('configurationRevision', 'invalid_configuration_id'),
                       ('quarter', 'invalid_quarter')):
        found = args.getlist(name)
        if len(found) > 1:
            raise WorkConfigError(code)
        result[name] = found[0] if found else None
    if result['configurationId'] is not None and _ID_RE.fullmatch(result['configurationId']) is None:
        raise WorkConfigError('invalid_configuration_id')
    if result['configurationRevision'] is not None and _REVISION_RE.fullmatch(result['configurationRevision']) is None:
        raise WorkConfigError('invalid_configuration_id')
    if result['quarter'] is not None:
        ws.parse_quarter(result['quarter'])
    return result['configurationId'], result['configurationRevision'], result['quarter']


def resolve_work_request(args, auth_context, *, needed=(), sprint_id=None, snapshot_loader,
                         db_oauth, sprint_admitter=None, flag_enabled=None):
    """Resolve the viewed quarter to one admitted work request, or None for the Legacy flat path.

    ``None`` keeps unpromoted/flag-off behavior byte-identical.  Promoted + flag on
    requires a ``quarter``; a Sprint id (``sprint_id``) is admitted through its own
    configuration's source via ``sprint_admitter(context, sprint_id) -> row``.
    Raises ``WorkConfigError`` with the exact selector codes.
    """
    configuration_id, revision, quarter = parse_selectors(args)
    present = any(value is not None for value in (configuration_id, revision, quarter))
    if not db_oauth:
        if present:
            raise WorkConfigError('work_configuration_setup_required')
        return None
    flag = ws.work_configurations_enabled() if flag_enabled is None else bool(flag_enabled)
    snapshot = snapshot_loader()
    state = ws.work_configuration_state(snapshot.payload, flag_enabled=flag)
    if not state.promoted:
        if present and not flag:
            raise WorkConfigError('configuration_feature_disabled')
        return None
    if not flag:
        if present:
            raise WorkConfigError('configuration_feature_disabled')
        return None
    if quarter is None:
        raise WorkConfigError('configuration_required')
    try:
        context = ws.resolve_work_configuration(
            snapshot, quarter=quarter, configuration_id=configuration_id, flag_enabled=flag)
    except StopIteration:
        raise WorkConfigError('configuration_required') from None
    entry, _digest = ws.get_effective_configuration(snapshot, context.configuration_id)
    if revision is not None and int(revision) != entry['revision']:
        raise WorkConfigError('configuration_scope_changed')
    missing = [path for path in ws.entry_missing_fields(entry) if not needed or path in needed]
    if missing:
        raise WorkConfigError('configuration_incomplete', paths=missing,
                              configuration_id=context.configuration_id)
    row = None
    if sprint_id not in (None, ''):
        if sprint_admitter is None or _SPRINT_ID_RE.fullmatch(str(sprint_id)) is None:
            raise WorkConfigError('sprint_catalog_mismatch')
        row = sprint_admitter(context, str(sprint_id))
    return WorkRequest(context=context, roles=WorkRoles(context), sprint=row)


# --- bounded search and the facade -------------------------------------------------------

def _normalized_transport(transport):
    if callable(transport) and not hasattr(transport, 'search'):
        return transport, (lambda: None)
    check = getattr(transport, 'check', None) or (lambda: None)
    return transport.search, check


@dataclass
class PlanningWork:
    issues: list = field(default_factory=list)
    parents: dict = field(default_factory=dict)
    ancestors: dict = field(default_factory=dict)
    optional_ancestors: dict = field(default_factory=dict)
    children: dict = field(default_factory=dict)
    dependencies: dict = field(default_factory=dict)
    parent_state: dict = field(default_factory=dict)
    unavailable_parents: set = field(default_factory=set)
    unavailable_ancestors: set = field(default_factory=set)
    complete: bool = True
    incomplete_reasons: list = field(default_factory=list)
    requests: int = 0
    hops: int = 0

    def mark_incomplete(self, reason):
        self.complete = False
        if reason not in self.incomplete_reasons:
            self.incomplete_reasons.append(reason)


def search_all(search, check, jql, fields, *, max_pages=DEFAULT_MAX_PAGES, max_issues=None, work=None,
               page_size=PAGE_SIZE):
    """Page one JQL with nextPageToken/isLast; returns ``(issues, complete)``.

    A ceiling (pages or issues) ends the read as incomplete, never as empty/complete.
    A non-dict/malformed page raises ``SearchUnavailable``.
    """
    issues, seen_keys, seen_tokens = [], set(), set()
    token = None
    for _page in range(max_pages):
        check()
        payload = {'jql': jql, 'fields': list(fields), 'maxResults': page_size}
        if token:
            payload['nextPageToken'] = token
        body = search(payload)
        if work is not None:
            work.requests += 1
        if not isinstance(body, dict) or not isinstance(body.get('issues'), list):
            raise SearchUnavailable('malformed_page')
        for issue in body['issues']:
            key = str((issue or {}).get('key') or '')
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            issues.append(issue)
            if max_issues is not None and len(issues) >= max_issues and not body.get('isLast', True):
                return issues, False
        token = body.get('nextPageToken')
        if body.get('isLast', not token) or not token:
            return issues, True
        if token in seen_tokens:
            raise SearchUnavailable('repeated_token')
        seen_tokens.add(token)
    return issues, False


def _hydrate(search, check, keys, fields, work, *, ceiling_pages):
    """Batch-read ``keys`` (at most ``PARENT_BATCH_LIMIT`` per request); returns (rows, ok)."""
    rows, ok = {}, True
    unique = sorted({str(key).strip().upper() for key in keys if str(key).strip()})
    batches = eng_board.split_epic_batches(
        unique,
        lambda batch: 'key in (' + ','.join(quote_jql(key) for key in batch) + ')',
        tuple(fields),
    )
    for batch in batches:
        if len(batch) > PARENT_BATCH_LIMIT:
            raise AssertionError('ancestor hydration batch exceeds the bound')
        try:
            found, complete = search_all(
                search, check, 'key in (' + ','.join(quote_jql(key) for key in batch) + ')',
                fields, max_pages=ceiling_pages, work=work)
        except SearchUnavailable:
            ok = False
            continue
        for issue in found:
            rows[str(issue['key']).strip().upper()] = issue
        ok = ok and complete
    return rows, ok


def extract_dependencies(issue):
    """Linked keys of one issue's ``issuelinks`` (inward/outward), order preserved."""
    linked = []
    for link in ((issue or {}).get('fields') or {}).get('issuelinks') or []:
        for side in ('outwardIssue', 'inwardIssue'):
            other = (link or {}).get(side)
            key = str((other or {}).get('key') or '').strip()
            if key:
                linked.append({'key': key, 'type': ((link.get('type') or {}).get('name') or ''),
                               'direction': 'outward' if side == 'outwardIssue' else 'inward'})
    return linked


def load_planning_work(context, auth_context, quarter, team_ids, purpose, transport, *,
                       sprint_id=None, env_jql_query='', extra_clauses=(), fields=None,
                       epic_link_field_id=None, include_children=False, child_fields=None,
                       max_pages=DEFAULT_MAX_PAGES, max_issues=None):
    """Read the planning issues of one admitted quarter plus their bounded context.

    * planning issues: one paged search (``nextPageToken``/``isLast``) under the page
      ceiling; hitting a ceiling marks the result incomplete, it never reads as empty;
    * parents/ancestors: batched hydration (<= 100 ids, tightened by the request-byte
      budget), at most two hops, no per-issue fan-out; unreadable or failed context
      never erases a readable planning row;
    * optional operational children: one batched search, same budgets.
    ``auth_context`` is passed to the transport only; ``purpose`` labels the read.
    """
    roles = context if isinstance(context, WorkRoles) else WorkRoles(context)
    if quarter is not None and quarter != roles.quarter:
        raise WorkConfigError('configuration_scope_changed', configuration_id=roles.configuration_id)
    search, check = _normalized_transport(transport)
    work = PlanningWork()

    def bound_search(payload):
        return search(payload, auth_context) if _accepts_auth(search) else search(payload)

    base_fields = list(fields or (
        'summary', 'status', 'priority', 'issuetype', 'assignee', 'updated', 'project',
        'parent', 'components', 'labels', 'issuelinks'))
    for name in ('sprint', 'storyPoints', 'team', 'allocation'):
        field_id = roles.field_id(name) if name != 'allocation' or not roles.is_legacy else ''
        if field_id and field_id not in base_fields:
            base_fields.append(field_id)
    if epic_link_field_id and roles.uses_epic_link and epic_link_field_id not in base_fields:
        base_fields.append(epic_link_field_id)

    jql = roles.planning_jql(team_ids, sprint_id, env_jql_query=env_jql_query,
                             extra_clauses=extra_clauses)
    issues, complete = search_all(bound_search, check, jql, base_fields, max_pages=max_pages,
                                  max_issues=max_issues, work=work)
    work.issues = issues
    if not complete:
        work.mark_incomplete('planning_search_ceiling')
    for issue in issues:
        linked = extract_dependencies(issue)
        if linked:
            work.dependencies[str(issue['key'])] = linked

    # Hop 1: grouping parents; hop 2: ancestors (their ``parent`` carries the optional one).
    parent_keys = {}
    for issue in issues:
        key = roles.parent_key_of(issue, epic_link_field_id)
        if key:
            parent_keys[str(issue['key'])] = key
    context_fields = ('summary', 'status', 'issuetype', 'project', 'parent', 'labels') + tuple(
        value for value in (roles.project_track_field_id, roles.allocation_field_id) if value)
    if parent_keys and MAX_ANCESTOR_HOPS >= 1:
        rows, ok = _hydrate(bound_search, check, parent_keys.values(), context_fields, work,
                            ceiling_pages=max_pages)
        work.hops = 1
        work.parents = rows
        if not ok:
            work.mark_incomplete('parent_hydration_incomplete')
        work.unavailable_parents = {key for key in set(parent_keys.values()) if key not in rows}
    for issue_key, parent_key in parent_keys.items():
        work.parent_state[issue_key] = ('unavailable' if parent_key in work.unavailable_parents
                                        else 'readable')
    for issue in issues:
        work.parent_state.setdefault(str(issue['key']), 'none')

    ancestor_keys = set()
    for row in work.parents.values():
        parent = ((row.get('fields') or {}).get('parent') or {})
        key = str(parent.get('key') or '').strip().upper()
        if key:
            ancestor_keys.add(key)
    if ancestor_keys and roles.ancestor_term() is not None and MAX_ANCESTOR_HOPS >= 2:
        rows, ok = _hydrate(bound_search, check, ancestor_keys, context_fields, work,
                            ceiling_pages=max_pages)
        work.hops = 2
        work.ancestors = rows
        if not ok:
            work.mark_incomplete('ancestor_hydration_incomplete')
        work.unavailable_ancestors = {key for key in ancestor_keys if key not in rows}
        optional = {}
        for row in rows.values():
            ref = ((row.get('fields') or {}).get('parent') or {})
            key = str(ref.get('key') or '').strip().upper()
            if key:
                optional[key] = ref
        work.optional_ancestors = optional  # display-only context carried inline; never fetched

    if include_children and issues:
        keys = [str(issue['key']).strip().upper() for issue in issues]
        wanted = tuple(dict.fromkeys(list(child_fields or ('summary', 'status', 'parent', 'issuetype'))
                                     + ([roles.sprint_field_id] if roles.sprint_field_id else [])))
        children_by_parent = {}
        batches = eng_board.split_epic_batches(
            keys, lambda batch: roles.children_clause([quote_jql(key) for key in batch]), wanted)
        for batch in batches:
            try:
                found, complete = search_all(
                    bound_search, check, roles.children_clause([quote_jql(key) for key in batch]),
                    wanted, max_pages=max_pages, work=work)
            except SearchUnavailable:
                work.mark_incomplete('children_unavailable')
                continue
            if not complete:
                work.mark_incomplete('children_incomplete')
            for child in found:
                parent = ((child.get('fields') or {}).get('parent') or {}).get('key')
                children_by_parent.setdefault(str(parent or '').strip().upper(), []).append(child)
        work.children = children_by_parent
    return work


def _accepts_auth(search):
    try:
        import inspect
        parameters = inspect.signature(search).parameters
    except (TypeError, ValueError):
        return False
    return len(parameters) >= 2 or any(p.kind == p.VAR_POSITIONAL for p in parameters.values())


def resolve_allocation(work, issue, allocation_field_id):
    """Allocation metadata: readable Epic override, else Initiative, else Objective.

    Returns ``(state, value)``: ``'value'``, ``'none'`` (nothing set anywhere readable) or
    ``'unavailable'`` — a blank Epic whose Initiative cannot be read is unavailable, never
    an authoritative Objective fallback.
    """
    if not allocation_field_id:
        return 'none', None
    issue_key = str(issue.get('key'))
    value = (issue.get('fields') or {}).get(allocation_field_id)
    if value not in (None, '', []):
        return 'value', value
    parent_key = (((issue.get('fields') or {}).get('parent') or {}).get('key') or '').strip().upper()
    if not parent_key:
        return 'none', None
    if work.parent_state.get(issue_key) == 'unavailable' or parent_key not in work.parents:
        return 'unavailable', None
    parent = work.parents[parent_key]
    value = (parent.get('fields') or {}).get(allocation_field_id)
    if value not in (None, '', []):
        return 'value', value
    ancestor_key = (((parent.get('fields') or {}).get('parent') or {}).get('key') or '').strip().upper()
    if not ancestor_key:
        return 'none', None
    ancestor = work.ancestors.get(ancestor_key)
    if ancestor is None:
        return 'unavailable', None
    value = (ancestor.get('fields') or {}).get(allocation_field_id)
    return ('value', value) if value not in (None, '', []) else ('none', None)


def sum_story_points(rows, story_points_field_id):
    """The existing parser oracle: null/''/non-numeric are skipped (``parseFloat(x || 0)``, NaN skipped).

    Source values are left untouched; ``None`` stays distinguishable from 0 in the rows.
    """
    total = 0.0
    for row in rows:
        value = (row.get('fields') or {}).get(story_points_field_id)
        if isinstance(value, bool) or value in (None, ''):
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number == number and number not in (float('inf'), float('-inf')):
            total += number
    return total


# --- Component Board admission (new model: Components live on Epic leaves) ---------------

@dataclass
class ComponentCohort:
    leaves: dict = field(default_factory=dict)          # leaf key -> raw row (matching only)
    leaves_by_parent: dict = field(default_factory=dict)
    parents: dict = field(default_factory=dict)         # admitted parent key -> raw row
    inaccessible_parents: set = field(default_factory=set)
    complete: bool = True

    def parent_keys(self):
        return sorted(self.parents)


def build_leaf_component_jql(roles, components, *, team_ids=(), terminal_clause=''):
    """Leaf (planning) discovery by Component under the selected configuration's projects.

    Membership is decided here, on the Epic leaves; the parent type clause and the
    parents' own Components never take part.  Team filtering belongs to the leaves.
    """
    clean = tuple(dict.fromkeys(str(item).strip() for item in components or () if str(item).strip()))
    if not clean:
        raise WorkConfigError('configuration_incomplete', paths=['components'])
    type_id = roles.planning_type_id()
    if not type_id:
        raise roles._incomplete('hierarchy.planningIssueTypeId')
    jql = _add_clause(roles.project_clause(), f'issuetype = {type_id}')
    jql = _add_clause(jql, 'component in (' + ','.join(quote_jql(item) for item in clean) + ')')
    jql = _add_clause(jql, roles.team_clause(team_ids))
    return _add_clause(jql, terminal_clause)


def admit_component_cohort(roles, search, check, components, *, team_ids=(), leaf_fields=('parent',),
                           parent_fields=eng_board.EPIC_FIELDS, parent_index_jql=None,
                           counters=None, key_budget=None, max_pages=eng_board.MAX_PAGES_PER_SEARCH):
    """Discover matching leaves, then batch-hydrate and admit their parents.

    ``parent_index_jql(keys)`` builds the parent-level JQL (project, parent type id, the
    Board terminal/retention rule) restricted to ``keys``.  Parents that cannot be read
    stay in ``inaccessible_parents``; their leaves are kept in ``leaves`` so a caller can
    render the orphan treatment instead of dropping them.  An incomplete read sets
    ``complete=False`` — it must never be treated as empty or ready-to-close.
    """
    cohort = ComponentCohort()
    batches = eng_board.split_component_batches(
        components, lambda batch: build_leaf_component_jql(roles, batch, team_ids=team_ids), leaf_fields)
    for batch in batches:
        jql = build_leaf_component_jql(roles, batch, team_ids=team_ids)
        rows = eng_board.strict_search(
            search, jql, tuple(leaf_fields), counters=counters, cancel_check=check,
            max_unique_keys=eng_board.MAX_CHILDREN, key_budget=key_budget)
        for row in rows:
            key = eng_board._normalized_key(row.get('key'))
            cohort.leaves[key] = row
    for key, row in cohort.leaves.items():
        parent_key = roles.parent_key_of(row)
        cohort.leaves_by_parent.setdefault(parent_key, []).append(key)
    parent_keys = sorted(key for key in cohort.leaves_by_parent if key)
    build = parent_index_jql or (lambda keys: 'key in (' + ','.join(quote_jql(key) for key in keys) + ')')
    for batch in eng_board.split_epic_batches(parent_keys, build, tuple(parent_fields)):
        rows = eng_board.strict_search(
            search, build(batch), tuple(parent_fields), counters=counters, cancel_check=check,
            max_unique_keys=eng_board.MAX_EPICS)
        for row in rows:
            key = eng_board._normalized_key(row.get('key'))
            if key in batch:
                cohort.parents[key] = row
    cohort.inaccessible_parents = {key for key in parent_keys if key not in cohort.parents}
    return cohort


def orphan_parent_shell(parent_key):
    """Synthetic shell for a leaf whose parent is unreadable: key only, no Jira metadata."""
    return {
        'key': parent_key,
        'fields': {'summary': parent_key, 'status': {'id': 'unavailable', 'name': 'Unavailable'},
                   'priority': None, 'assignee': None, 'updated': None, 'parent': None},
    }


# --- readiness and alert derivations (accepted new-model dispositions) --------------------

_ALERT_DISCOVERY_EXCLUDED = ('Done', 'Killed', 'Incomplete')
_READINESS_DISCOVERY_EXCLUDED = ('Done', 'Killed', 'Incomplete', 'Postponed')
_NON_ACTIONABLE = frozenset({'blocked', 'done', 'killed', 'incomplete'})


def discovery_excluded_statuses(*, readiness):
    """Initiative discovery excludes terminal statuses before the 2,000/101-page ceiling."""
    return _READINESS_DISCOVERY_EXCLUDED if readiness else _ALERT_DISCOVERY_EXCLUDED


def _status_name(row):
    return str((((row or {}).get('fields') or {}).get('status') or {}).get('name') or '').strip().lower()


def derive_parent_alert_state(children, *, selected_sprint_id, sprint_field_id, complete):
    """Empty / ready-to-close / postponed / waiting from fully read Epic children.

    ``children`` are every Epic child of one Initiative across quarters (future ones
    included).  Returns ``None`` when ``complete`` is false: a partial source must never
    yield a missing-child or closure requirement.
    """
    if not complete:
        return None
    selected = str(selected_sprint_id or '')
    open_children, selected_children, future_only = [], [], []
    for child in children:
        status = _status_name(child)
        terminal = status in {'done', 'killed', 'incomplete'}
        raw = ((child.get('fields') or {}).get(sprint_field_id) if sprint_field_id else None)
        sprint_ids = {str(item.get('id')) if isinstance(item, dict) else str(item)
                      for item in (raw if isinstance(raw, list) else ([raw] if raw else []))}
        if not terminal:
            open_children.append(child)
        if selected and selected in sprint_ids:
            selected_children.append(child)
        elif not terminal and sprint_ids and selected not in sprint_ids:
            future_only.append(child)
    actionable = [child for child in selected_children if _status_name(child) not in _NON_ACTIONABLE]
    return {
        'empty': not selected_children,
        'readyToClose': bool(children) and not open_children,
        'postponed': bool(open_children) and not selected_children and len(future_only) == len(open_children),
        'waiting': bool(selected_children) and not actionable,
    }
