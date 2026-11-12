"""Bounded Jira authorization and atomic Department-group custom reviews.

Columns and values belong to a workspace + Department group + namespace; views (column order and
hidden columns) belong to a group + Sprint + namespace. A namespace is the NULL Legacy namespace
(configuration_id None: Epic parent, Story child, numeric Sprint-id inheritance) or one quarterly
configuration id (Initiative parent, Epic child, inheritance by stamped quarter ordinal within that
namespace only). Nothing is ever copied or inherited across namespaces.

The NULL-Legacy schema row of the group is the common transaction fence for every writer: it is
locked first (created if absent), then the selected namespace row. Serializing that short database
transaction does not reject disjoint cell revisions, and it makes the cross-namespace caps and
first-create races safe.
"""
from copy import deepcopy
from contextlib import ExitStack, nullcontext
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import time
from decimal import Decimal, InvalidOperation
import re
import unicodedata
import uuid

from sqlalchemy import event, func, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert

from backend.auth.db_context import is_db_auth_context
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine, models
from backend.services import shared_group_config, planning_inclusion, workspace_dashboard_config
from backend.services.eng_board_stream import EngBoardRequestBudget, EngBoardRequestDeadline, EngBoardRequestTransport

MAX_ACTIVE_COLUMNS = 30
MAX_CHANGED_CELLS = 100
MAX_READ_ISSUES = 500
MAX_REQUEST_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
SPRINT_ORDER_WIDTH = 128
MAX_GROUP_VIEWS = 500
MAX_GROUP_DEFINITIONS = 240
LEGACY_KINDS = ('epic', 'story')
CONFIGURATION_KINDS = ('epic', 'initiative')


def sprint_order(sprint_id: str) -> str:
    """Left-pad a decimal Sprint id so string order equals numeric order."""
    return sprint_id.rjust(SPRINT_ORDER_WIDTH, '0')


class ReviewError(ValueError):
    def __init__(self, code='invalid_review_request', status=400, **details):
        super().__init__(code)
        self.code, self.status, self.details = code, status, details


def capabilities(context):
    enabled = bool(db_engine.database_storage_enabled() and is_db_auth_context(context)
                   and context.auth_mode == 'atlassian_oauth')
    return {'canRead': enabled, 'canSave': enabled,
            'reason': None if enabled else 'Shared review saving requires database-backed OAuth.'}


def require_review_context(context):
    """Authentication and storage capability, checked before any request body is parsed."""
    if context is None or context.auth_mode != 'atlassian_oauth' or not context.user_id or not context.workspace_id:
        raise AuthError('auth_required')
    if not capabilities(context)['canSave']:
        raise ReviewError('review_storage_unavailable', 503)


def sprint_identity(value):
    if not isinstance(value, str) or len(value) > 128 or re.fullmatch(r'[1-9][0-9]*', value) is None:
        raise ReviewError()
    return value


def group_identity(value):
    """A Department group id selector: 1-128 chars, already stripped, no control characters."""
    if (not isinstance(value, str) or not 1 <= len(value) <= 128 or value != value.strip()
            or any(unicodedata.category(ch) == 'Cc' for ch in value)):
        raise ReviewError()
    return value


def issue_ids(values, limit=MAX_READ_ISSUES):
    if not isinstance(values, list) or len(values) > limit:
        raise ReviewError()
    if any(not isinstance(value, str) or len(value) > 128 or re.fullmatch(r'[1-9][0-9]*', value) is None for value in values):
        raise ReviewError()
    if len(set(values)) != len(values):
        raise ReviewError()
    return values


def namespace_kinds(configuration_id=None):
    return LEGACY_KINDS if configuration_id is None else CONFIGURATION_KINDS


def row_kind(value, kinds=LEGACY_KINDS):
    if value not in kinds:
        raise ReviewError()
    return value


def quarter_ordinal_for(year, quarter):
    """Authoritative saved-view ordinal for a configuration quarter: (year-1)*4+(quarter-1)."""
    for value in (year, quarter):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ReviewError()
    if year < 1 or not 1 <= quarter <= 4:
        raise ReviewError()
    return (year - 1) * 4 + (quarter - 1)


def namespace_identity(configuration_id=None, quarter_ordinal=None):
    """Validate a (configuration_id, quarter_ordinal) pair; Legacy (None) never carries an ordinal."""
    if configuration_id is None:
        if quarter_ordinal is not None:
            raise ReviewError()
        return None, None
    group_identity(configuration_id)
    if quarter_ordinal is not None and (isinstance(quarter_ordinal, bool) or not isinstance(quarter_ordinal, int)
                                        or not 0 <= quarter_ordinal <= 2147483646):
        raise ReviewError()
    return configuration_id, quarter_ordinal


def revision(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 2147483646:
        raise ReviewError()
    return value


def _keys(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ReviewError()


def _column_id(value):
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ReviewError() from None
    return value


def _label(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80:
        raise ReviewError()
    return value.strip()


def normalize_value(value, column):
    if value is None:
        return None
    if column['type'] == 'text':
        if not isinstance(value, str) or len(value) > 500:
            raise ReviewError()
        return value
    if not isinstance(value, str) or len(value) > 32 or re.fullmatch(r'-?\d+(?:\.\d)?', value) is None:
        raise ReviewError()
    try:
        number = Decimal(value)
        if abs(number) > Decimal('999999999.999'):
            raise ReviewError()
        # Input allows one decimal place; the canonical stored form keeps three so earlier values stay readable.
        return format(number.quantize(Decimal('0.001')) if number else Decimal('0.000'), 'f')
    except InvalidOperation:
        raise ReviewError() from None


def _id_list(ids, limit):
    if not isinstance(ids, list) or len(ids) > limit or any(not isinstance(i, str) for i in ids) or len(ids) != len(set(ids)):
        raise ReviewError()


def validate_schema_changes(changes, configuration_id=None):
    """Stateless shape checks for every schema action, run before Jira authorization.

    State checks (duplicate id, column lookup, reorder set, anchor and layout-id
    membership, limits) stay in apply_schema and apply_layouts, inside the transaction.
    """
    if not isinstance(changes, list) or len(changes) > 120:
        raise ReviewError()
    kinds = namespace_kinds(configuration_id)
    for change in changes:
        action = change.get('action') if isinstance(change, dict) else None
        if action == 'add':
            _keys(change, ('action', 'column'))
            column = change.get('column')
            _keys(column, ('id', 'rowKind', 'label', 'type', 'aggregation', 'archived', 'order', 'after'))
            _column_id(column.get('id'))
            row_kind(column.get('rowKind'), kinds)
            _label(column.get('label'))
            type_name = column.get('type')
            aggregation = column.get('aggregation', 'sum' if type_name == 'number' else 'none')
            after = column.get('after')
            if type_name not in ('number', 'text') or aggregation not in ('sum', 'none') or type_name == 'text' and aggregation != 'none' or column.get('archived', False) is not False:
                raise ReviewError()
            if after is not None and (not isinstance(after, str) or not 1 <= len(after) <= 64):
                raise ReviewError()
        elif action == 'layout':
            _keys(change, ('action', 'rowKind', 'order', 'hidden'))
            row_kind(change.get('rowKind'), kinds)
            for field in ('order', 'hidden'):
                if field not in change:
                    raise ReviewError()
                _id_list(change[field], 254)
        elif action == 'reorder':
            _keys(change, ('action', 'rowKind', 'columnIds'))
            row_kind(change.get('rowKind'), kinds)
            _id_list(change.get('columnIds'), 240)
        elif action in ('rename', 'archive', 'aggregation'):
            field = {'rename': 'label', 'archive': 'archived', 'aggregation': 'aggregation'}[action]
            _keys(change, ('action', 'columnId', field))
            _column_id(change.get('columnId'))
            value = change.get(field)
            if action == 'rename':
                _label(value)
            elif action == 'archive':
                if value is not True:
                    raise ReviewError()
            elif value not in ('sum', 'none'):
                raise ReviewError()
        else:
            raise ReviewError()


def apply_schema(columns, changes, configuration_id=None, other_definitions=0):
    """Apply column actions to a schema; changes must have passed validate_schema_changes.

    `other_definitions` counts the group's definitions in other namespaces: the 240 total is per group."""
    result = deepcopy(columns)
    builtins = layout_builtins(configuration_id)
    for change in changes:
        action = change['action']
        if action == 'add':
            column = change['column']
            identity, kind, type_name = column['id'], column['rowKind'], column['type']
            after = column.get('after')
            if any(c['id'] == identity for c in result):
                raise ReviewError()
            # An anchor is 'summary', a same-kind built-in or a same-kind group column (archived or added earlier in this request).
            if after is not None and after != 'summary' and after not in builtins[kind] \
                    and not any(c['id'] == after and c['rowKind'] == kind for c in result):
                raise ReviewError()
            result.append({'id': identity, 'rowKind': kind, 'label': column['label'].strip(),
                           'type': type_name, 'aggregation': column.get('aggregation', 'sum' if type_name == 'number' else 'none'),
                           'archived': False, 'order': sum(c['rowKind'] == kind for c in result), 'after': after})
        elif action == 'layout':
            continue
        elif action == 'reorder':
            kind, ids = change['rowKind'], change['columnIds']
            expected = [c['id'] for c in result if c['rowKind'] == kind and not c['archived']]
            if len(ids) != len(expected) or set(ids) != set(expected):
                raise ReviewError()
            for column in result:
                if column['id'] in ids:
                    column['order'] = ids.index(column['id'])
        else:
            field = {'rename': 'label', 'archive': 'archived', 'aggregation': 'aggregation'}[action]
            column = next((c for c in result if c['id'] == change['columnId']), None)
            if column is None:
                raise ReviewError()
            value = change[field]
            if action == 'rename':
                value = value.strip()
            elif action == 'aggregation' and column['type'] == 'text' and value != 'none':
                raise ReviewError()
            column[field] = value
    for kind in namespace_kinds(configuration_id):
        if sum(c['rowKind'] == kind and not c['archived'] for c in result) > MAX_ACTIVE_COLUMNS:
            raise ReviewError('review_column_limit')
    # Archived definitions remain bounded, retained for saved-value identity; the total spans every namespace.
    if len(result) + other_definitions > MAX_GROUP_DEFINITIONS:
        raise ReviewError('review_schema_limit')
    return result


REVIEW_LAYOUT_BUILTINS = {
    'epic': {'status', 'priority', 'storyPoints', 'accepted', 'team', 'teamsInScope', 'project', 'assignee', 'deliveryOwner', 'components', 'capacity', 'projectTrack'},
    'story': {'status', 'priority', 'storyPoints', 'accepted', 'team', 'project', 'epic', 'assignee', 'deliveryOwner', 'components', 'capacity', 'projectTrack'},
}


CONFIGURATION_LAYOUT_BUILTINS = {
    'initiative': {'status', 'priority', 'storyPoints', 'accepted', 'team', 'teamsInScope', 'project', 'assignee', 'deliveryOwner', 'components', 'capacity', 'projectTrack'},
    'epic': {'status', 'priority', 'storyPoints', 'accepted', 'team', 'project', 'initiative', 'assignee', 'deliveryOwner', 'components', 'capacity', 'projectTrack'},
}


def layout_builtins(configuration_id=None):
    """Allowed builtin ids per native kind: Legacy epic->parent/story->child, configuration initiative->parent/epic->child."""
    return REVIEW_LAYOUT_BUILTINS if configuration_id is None else CONFIGURATION_LAYOUT_BUILTINS


def apply_layouts(layouts, columns, changes, configuration_id=None):
    """Merge layout actions over a view; changes must have passed validate_schema_changes."""
    result = deepcopy(layouts or {})
    # Derived columns let a view place custom columns of either row kind.
    custom = {c['id'] for c in columns}
    for change in changes:
        if change['action'] != 'layout':
            continue
        kind = change['rowKind']
        allowed = layout_builtins(configuration_id)[kind] | custom
        # Every column but the pinned Summary can be hidden; Key is pinned first, so it hides but is never part of the order.
        if not set(change['order']) <= allowed or not set(change['hidden']) <= allowed | {'key'}:
            raise ReviewError()
        result[kind] = {'order': list(change['order']), 'hidden': list(change['hidden'])}
    return result


def authorize_issues(context, ids, search=None, requested_kinds=None, type_map=None):
    """Authorize numeric immutable IDs through the current user's OAuth Jira search.

    Jira visibility establishes access; configured ENG issue types only classify
    row kinds. No Basic fallback, per-issue fan-out, or saved value establishes
    access. Completion is mandatory.

    `type_map` (new-model namespaces) maps a review kind to its mapped (issue type id, expected hierarchy
    level), for example {'epic': ('10001', 1), 'initiative': ('10002', 2)}; an issue is admitted only when its
    type id and level both equal the requested kind's mapping. Without it the Legacy name/level rules apply.
    """
    require_review_context(context)
    ids = issue_ids(ids)
    if type_map is not None:
        if requested_kinds is None or not isinstance(type_map, dict) or any(
                kind not in CONFIGURATION_KINDS + ('story',) or not isinstance(rule, (tuple, list)) or len(rule) != 2
                or not isinstance(rule[0], str) or not rule[0] or isinstance(rule[1], bool) or not isinstance(rule[1], int)
                for kind, rule in type_map.items()):
            raise ReviewError()
    if not ids:
        return set()
    story_types = {'story'}
    if search is None:
        from backend.routes import get_jira_server
        server = get_jira_server()
        if server.JIRA_AUTH_MODE != 'atlassian_oauth':
            raise AuthError('auth_required')
        search = server.current_jira_search
        if requested_kinds is not None and type_map is None:
            story_types = {str(name).casefold() for name in server.get_configured_issue_types()} - {'epic'}
    transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(15))
    found, pages = set(), 0
    batches, batch, query_size = [], [], 0
    for identity in ids:
        if batch and (len(batch) >= 100 or query_size + len(identity) + 1 > 3000):
            batches.append(batch)
            batch, query_size = [], 0
        batch.append(identity)
        query_size += len(identity) + 1
    if batch:
        batches.append(batch)
    try:
        for batch in batches:
            token, seen = None, set()
            while True:
                transport.budget.check()
                if pages >= 10:
                    raise ReviewError('review_authorization_incomplete', 503)
                payload = {'jql': 'id in (' + ','.join(batch) + ')', 'fields': ['issuetype'], 'maxResults': 100}
                if token:
                    payload['nextPageToken'] = token
                response = search(payload, context=context, timeout=transport.budget.remaining(), diagnostic_transport=transport)
                pages += 1
                transport.budget.check()
                if response.status_code == 401:
                    raise AuthError('auth_required')
                if response.status_code != 200:
                    raise ReviewError('review_authorization_unavailable', 503)
                data = response.json()
                if not isinstance(data, dict) or not isinstance(data.get('issues'), list) or not isinstance(data.get('isLast'), bool):
                    raise ReviewError('review_authorization_incomplete', 503)
                for issue in data['issues']:
                    if not isinstance(issue, dict) or str(issue.get('id', '')) not in batch:
                        raise ReviewError('review_authorization_incomplete', 503)
                    issue_type = (issue.get('fields') or {}).get('issuetype') or {}
                    if not isinstance(issue_type, dict):
                        raise ReviewError('review_authorization_incomplete', 503)
                    hierarchy = issue_type.get('hierarchyLevel')
                    if type_map is not None:
                        kind = next((k for k, (type_id, _level) in type_map.items()
                                     if str(issue_type.get('id') or '') == type_id), None)
                        matching_level = kind is not None and hierarchy == type_map[kind][1]
                    else:
                        name = str(issue_type.get('name') or '').casefold()
                        kind = 'epic' if name == 'epic' else 'story' if name in story_types else None
                        matching_level = hierarchy is None or hierarchy == (1 if kind == 'epic' else 0)
                    if kind and matching_level and not issue_type.get('subtask', False) and (requested_kinds is None or requested_kinds.get(str(issue['id'])) == {kind}):
                        found.add(str(issue['id']))
                if data['isLast']:
                    break
                token = data.get('nextPageToken')
                if not isinstance(token, str) or not token or token in seen:
                    raise ReviewError('review_authorization_incomplete', 503)
                seen.add(token)
    except EngBoardRequestDeadline:
        raise ReviewError('review_authorization_incomplete', 503) from None
    return found


def ensure_group_configured(context, group_id, database_url=None):
    """PATCH-only membership check against the shared Department group catalog (read-only)."""
    try:
        with db_engine.session_scope(database_url) as session:
            config = shared_group_config.current_shared_groups_config(session, context)
    except (AttributeError, TypeError, ValueError):
        raise ReviewError('review_unavailable', 503) from None
    groups = config.get('groups')
    if not groups:
        raise ReviewError('review_group_unknown')
    if not isinstance(groups, list) or any(not isinstance(group, dict) for group in groups):
        raise ReviewError('review_unavailable', 503)
    if group_id not in {str(group.get('id') or '').strip() for group in groups}:
        raise ReviewError('review_group_unknown')


def _namespace(column, configuration_id):
    return column.is_(None) if configuration_id is None else column == configuration_id


def _schema_query(context, group_id, configuration_id=None):
    return select(models.WorkspaceGroupReviewSchema).where(
        models.WorkspaceGroupReviewSchema.workspace_id == context.workspace_id,
        models.WorkspaceGroupReviewSchema.group_id == group_id,
        _namespace(models.WorkspaceGroupReviewSchema.configuration_id, configuration_id))


def _views(workspace_id, group_id, configuration_id=None):
    """Views of one namespace; pass `False` for the whole group (caps count every namespace)."""
    base = (models.GroupSprintReviewView.workspace_id == workspace_id,
            models.GroupSprintReviewView.group_id == group_id)
    if configuration_id is False:
        return base
    return base + (_namespace(models.GroupSprintReviewView.configuration_id, configuration_id),)


def resolve_view(session, workspace_id, group_id, sprint_id, configuration_id=None, quarter_ordinal=None):
    """The Sprint's own view, else the nearest earlier saved view of the same namespace, else none.

    Legacy: nearest earlier by numeric Sprint id. Configuration: an exact Sprint view always reads; otherwise
    only views stamped with a strictly earlier quarter ordinal inherit, and only when the requested ordinal is
    resolved. An unresolved ordinal is an exact historical read: no inheritance, never inferred from ids."""
    where = _views(workspace_id, group_id, configuration_id)
    if configuration_id is None:
        row = session.scalars(select(models.GroupSprintReviewView).where(
            *where, models.GroupSprintReviewView.sprint_order <= sprint_order(sprint_id),
        ).order_by(models.GroupSprintReviewView.sprint_order.desc()).limit(1)).first()
    else:
        row = session.scalar(select(models.GroupSprintReviewView).where(
            *where, models.GroupSprintReviewView.sprint_id == sprint_id))
        if row is None and quarter_ordinal is not None:
            row = session.scalars(select(models.GroupSprintReviewView).where(
                *where, models.GroupSprintReviewView.quarter_ordinal.is_not(None),
                models.GroupSprintReviewView.quarter_ordinal < quarter_ordinal,
            ).order_by(models.GroupSprintReviewView.quarter_ordinal.desc(),
                       models.GroupSprintReviewView.sprint_order.desc()).limit(1)).first()
    if row is None:
        return {}, 0, None
    if row.sprint_id == sprint_id:
        return deepcopy(row.layouts), row.view_revision, None
    return deepcopy(row.layouts), 0, {'sprintId': row.sprint_id, 'viewRevision': row.view_revision}


def _base(row, sprint_id, group_id, configuration_id=None, quarter_ordinal=None):
    base = {'schemaVersion': 1, 'sprintId': sprint_id, 'groupId': group_id,
            'columns': deepcopy(row.columns) if row else [], 'schemaRevision': row.schema_revision if row else 0}
    if configuration_id is not None:
        base.update(configurationId=configuration_id, quarterOrdinal=quarter_ordinal)
    return base


def load_review(context, sprint_id, group_id, database_url=None, configuration_id=None, quarter_ordinal=None):
    sprint_identity(sprint_id)
    group_identity(group_id)
    configuration_id, quarter_ordinal = namespace_identity(configuration_id, quarter_ordinal)
    caps = capabilities(context)
    if not caps['canRead']:
        return {**_base(None, sprint_id, group_id, configuration_id, quarter_ordinal), 'viewRevision': 0, 'layouts': {},
                'inheritedFrom': None, 'capabilities': caps}
    require_review_context(context)
    with db_engine.session_scope(database_url) as session:
        row = session.scalar(_schema_query(context, group_id, configuration_id))
        layouts, view_revision, inherited_from = resolve_view(
            session, context.workspace_id, group_id, sprint_id, configuration_id, quarter_ordinal)
        return {**_base(row, sprint_id, group_id, configuration_id, quarter_ordinal), 'viewRevision': view_revision,
                'layouts': layouts, 'inheritedFrom': inherited_from, 'capabilities': caps}


def _cell(cell):
    return {'issueId': cell.issue_id, 'rowKind': cell.row_kind, 'columnId': cell.column_id,
            'value': cell.value, 'revision': cell.revision}


def read_values(context, sprint_id, payload, database_url=None, search=None, configuration_id=None, type_map=None, *, planning_admission=None, deadline=None):
    if isinstance(payload, dict) and payload.get("includePlan") is True:
        return _read_planning_values(context, sprint_id, payload, database_url, search, planning_admission, deadline)
    require_review_context(context)
    sprint_identity(sprint_id)
    configuration_id, _ordinal = namespace_identity(configuration_id)
    _keys(payload, ('groupId', 'issueIds', 'rowKind'))
    group_id = group_identity(payload.get('groupId'))
    ids, kind = issue_ids(payload.get('issueIds')), row_kind(payload.get('rowKind'), namespace_kinds(configuration_id))
    allowed = authorize_issues(context, ids, search, {identity: {kind} for identity in ids}, type_map)
    with db_engine.session_scope(database_url) as session:
        row = session.scalar(_schema_query(context, group_id, configuration_id))
        # Group-wide accumulation: only active columns' cells are read back.
        active = [c['id'] for c in row.columns if c['rowKind'] == kind and not c['archived']] if row else []
        cells = [] if not active or not allowed else session.scalars(select(models.GroupReviewCell).where(
            models.GroupReviewCell.schema_id == row.id, models.GroupReviewCell.row_kind == kind,
            models.GroupReviewCell.column_id.in_(active),
            models.GroupReviewCell.issue_id.in_(allowed)).limit(MAX_RESPONSE_BYTES // 100 + 1)).all()
        if len(cells) > MAX_RESPONSE_BYTES // 100:
            raise ReviewError('review_response_limit', 413)
        return {'cells': [_cell(cell) for cell in cells], 'unavailableIssueIds': [i for i in ids if i not in allowed]}


def _ensure_schema_row(session, context, group_id, configuration_id):
    if session.bind.dialect.name != 'postgresql':
        raise ReviewError('review_storage_unavailable', 503)
    # No conflict target: the unique arbiters are partial indexes (NULL Legacy and non-null configuration).
    session.execute(postgres_insert(models.WorkspaceGroupReviewSchema).values(
        id=str(uuid.uuid4()), workspace_id=context.workspace_id, group_id=group_id, configuration_id=configuration_id,
        schema_revision=0, columns=[]).on_conflict_do_nothing())
    return session.scalar(_schema_query(context, group_id, configuration_id).with_for_update())


def _locked_schema(session, context, group_id, configuration_id=None):
    """Lock order: the group's NULL-Legacy schema row (the common fence, created if absent), then the namespace row."""
    fence = _ensure_schema_row(session, context, group_id, None)
    if configuration_id is None:
        return fence
    return _ensure_schema_row(session, context, group_id, configuration_id)


def _conflict(row, schema_conflict, view_conflict, cell_conflicts):
    return ReviewError('review_conflict', 409, schemaConflict=schema_conflict, viewConflict=view_conflict,
                       cellConflicts=cell_conflicts, columns=deepcopy(row.columns), schemaRevision=row.schema_revision)


def save_review(context, sprint_id, payload, database_url=None, search=None, configuration_id=None,
                quarter_ordinal=None, type_map=None, *, planning_admission=None, prepare_response=None, deadline=None,
                _session=None, _row=None):
    if isinstance(payload, dict) and payload.get("version") == 2:
        return _save_planning_review(context, sprint_id, payload, database_url, search,
                                     planning_admission, prepare_response, deadline)
    require_review_context(context)
    sprint_identity(sprint_id)
    configuration_id, quarter_ordinal = namespace_identity(configuration_id, quarter_ordinal)
    kinds = namespace_kinds(configuration_id)
    _keys(payload, ('groupId', 'baseSchemaRevision', 'baseViewRevision', 'schemaChanges', 'cellChanges'))
    group_id = group_identity(payload.get('groupId'))
    base = revision(payload.get('baseSchemaRevision'))
    base_view = revision(payload.get('baseViewRevision', 0))
    schema_changes, changes = payload.get('schemaChanges', []), payload.get('cellChanges', [])
    if not isinstance(schema_changes, list) or not isinstance(changes, list) or len(changes) > MAX_CHANGED_CELLS:
        raise ReviewError()
    validate_schema_changes(schema_changes, configuration_id)
    identities, ids = set(), []
    for change in changes:
        _keys(change, ('issueId', 'rowKind', 'columnId', 'value', 'baseRevision'))
        issue_ids([change.get('issueId')])
        row_kind(change.get('rowKind'), kinds)
        _column_id(change.get('columnId'))
        revision(change.get('baseRevision'))
        if 'value' not in change:
            raise ReviewError()
        identity = (change['issueId'], change['rowKind'], change['columnId'])
        if identity in identities:
            raise ReviewError()
        identities.add(identity)
        if change['issueId'] not in ids:
            ids.append(change['issueId'])
    layout_actions = any(change['action'] == 'layout' for change in schema_changes)
    column_actions = any(change['action'] != 'layout' for change in schema_changes)
    if layout_actions and configuration_id is not None and quarter_ordinal is None:
        # A saved configuration view carries its authoritative ordinal; without one nothing is stamped.
        raise ReviewError('review_quarter_unresolved')
    if _session is None:
        ensure_group_configured(context, group_id, database_url)
    requested_kinds = {identity: {c['rowKind'] for c in changes if c['issueId'] == identity} for identity in ids}
    allowed = authorize_issues(context, ids, search, requested_kinds, type_map) if _session is None else set(ids)
    if len(allowed) != len(ids):
        raise ReviewError('review_issues_unavailable', 403, unavailableIssueIds=[i for i in ids if i not in allowed])
    with (db_engine.session_scope(database_url) if _session is None else nullcontext(_session)) as session:
        if not schema_changes and not changes:
            # An empty request creates no row and takes no lock.
            return {**_base(session.scalar(_schema_query(context, group_id, configuration_id)), sprint_id, group_id,
                            configuration_id, quarter_ordinal), 'cells': []}
        # (1) lock the fence row then the namespace row; (2) select the Sprint's view row for a layout action.
        row = _row if _row is not None else _locked_schema(session, context, group_id, configuration_id)
        view = session.scalar(select(models.GroupSprintReviewView).where(
            *_views(context.workspace_id, group_id, configuration_id),
            models.GroupSprintReviewView.sprint_id == sprint_id)) if layout_actions else None
        # (3) one conflict predicate at the first 409 site.
        schema_conflict = bool(column_actions and base != row.schema_revision)
        view_conflict = bool(layout_actions and base_view != (view.view_revision if view else 0))
        existing = session.scalars(select(models.GroupReviewCell).where(
            models.GroupReviewCell.schema_id == row.id, models.GroupReviewCell.issue_id.in_(ids))).all() if ids else []
        cell_map = {(c.issue_id, c.row_kind, c.column_id): c for c in existing}
        conflicts = []
        for change in changes:
            cell = cell_map.get((change['issueId'], change['rowKind'], change['columnId']))
            if change['baseRevision'] != (cell.revision if cell else 0):
                conflicts.append(_cell(cell) if cell else {**{k: change[k] for k in ('issueId', 'rowKind', 'columnId')}, 'value': None, 'revision': 0})
        if schema_conflict or view_conflict or conflicts:
            raise _conflict(row, schema_conflict, view_conflict, conflicts)
        # (4) column actions, layouts against the post-action columns, then cell normalization.
        other_definitions = sum(len(columns) for columns in session.scalars(select(models.WorkspaceGroupReviewSchema.columns).where(
            models.WorkspaceGroupReviewSchema.workspace_id == context.workspace_id,
            models.WorkspaceGroupReviewSchema.group_id == group_id,
            models.WorkspaceGroupReviewSchema.id != row.id)).all()) if any(c['action'] == 'add' for c in schema_changes) else 0
        columns = apply_schema(row.columns, schema_changes, configuration_id, other_definitions)
        layouts = apply_layouts(view.layouts if view else {}, columns, schema_changes, configuration_id) if layout_actions else None
        column_map = {c['id']: c for c in columns}
        normalized = []
        for change in changes:
            column = column_map.get(change['columnId'])
            if column is None or column['archived'] or column['rowKind'] != change['rowKind']:
                raise _conflict(row, True, False, [])
            normalized.append(normalize_value(change['value'], column))
        # (5) the view cap, on the insert path only; it counts every namespace of the group.
        if layout_actions and view is None and session.scalar(
                select(func.count()).select_from(models.GroupSprintReviewView).where(
                    *_views(context.workspace_id, group_id, False))) >= MAX_GROUP_VIEWS:
            raise ReviewError('review_view_limit')
        # (6) write.
        if column_actions:
            row.columns = columns
            row.schema_revision += 1
        if layout_actions:
            if view is None:
                view = models.GroupSprintReviewView(workspace_id=context.workspace_id, group_id=group_id, sprint_id=sprint_id,
                                                    sprint_order=sprint_order(sprint_id), configuration_id=configuration_id,
                                                    quarter_ordinal=quarter_ordinal, layouts=layouts, view_revision=1)
                session.add(view)
            else:
                view.layouts = layouts
                view.view_revision += 1
                if configuration_id is not None:
                    view.quarter_ordinal = quarter_ordinal
        saved = []
        for change, value in zip(changes, normalized):
            cell = cell_map.get((change['issueId'], change['rowKind'], change['columnId']))
            if cell is None:
                cell = models.GroupReviewCell(schema_id=row.id, issue_id=change['issueId'], row_kind=change['rowKind'],
                                              column_id=change['columnId'], value=value, revision=1)
                session.add(cell)
            else:
                cell.value = value
                cell.revision += 1
            saved.append(_cell(cell))
        session.flush()
        result = {**_base(row, sprint_id, group_id, configuration_id, quarter_ordinal), 'cells': saved}
        if layout_actions:
            result.update(layouts=deepcopy(layouts), viewRevision=view.view_revision, inheritedFrom=None)
        return result


@dataclass(frozen=True)
class PlanningAdmission:
    """Captured authority; revalidate uses the caller's fenced transaction, never Jira."""
    scope_proof: str
    candidate_jql: str
    child_kind: str
    configuration_id: object
    quarter_ordinal: object
    type_map: object
    group_revision: int
    group_payload: dict
    revalidate: object
    source_proof: object = None
    review_story_types: tuple = ('story',)


class PlanningDeadline:
    def __init__(self, seconds=30, clock=time.monotonic):
        self.clock, self.expires = clock, clock() + seconds

    def remaining(self, *_args):
        remaining = self.expires - self.clock()
        if remaining <= 0:
            raise ReviewError('planning_deadline_exceeded', 503, noCommit=True)
        return remaining

    def bind(self, session, stack):
        """Refresh driver limits for every execution, including flush and commit work."""
        connection = session.connection()
        def before(_conn, cursor, _statement, _parameters, _context, _many):
            remaining = self.remaining()
            lock_ms = max(1, int(min(5, remaining) * 1000))
            statement_ms = max(1, int(min(10, remaining) * 1000))
            cursor.execute("SET LOCAL lock_timeout = '" + str(lock_ms) + "ms'")
            cursor.execute("SET LOCAL statement_timeout = '" + str(statement_ms) + "ms'")
        event.listen(connection, 'before_cursor_execute', before)
        stack.callback(event.remove, connection, 'before_cursor_execute', before)
        self.remaining()


def _encode_acknowledgement(payload):
    try:
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    except (TypeError, ValueError, UnicodeError):
        raise ReviewError('review_response_unavailable', 503, noCommit=True) from None
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise ReviewError('review_response_limit', 413, noCommit=True)
    return encoded


def _operation_scope(context, sprint_id, group_id, configuration_id):
    return {'workspaceId': context.workspace_id, 'groupId': group_id,
            'configurationId': configuration_id, 'sprintId': sprint_id}


def _syntactic_namespace(payload):
    stamp = payload.get('configuration')
    if 'configuration' not in payload:
        return None
    from backend.services import work_write_scope, work_structure
    parsed = work_write_scope.parse_stamp(stamp)
    return None if parsed['id'] == work_structure.LEGACY_ID else parsed['id']


def load_save_operation(context, sprint_id, group_id, operation_id, namespace=None, database_url=None):
    require_review_context(context)
    sprint_identity(sprint_id)
    group_identity(group_id)
    namespace_identity(namespace)
    identity = planning_inclusion.operation_identity(operation_id, datetime.now(timezone.utc))
    scope = _operation_scope(context, sprint_id, group_id, namespace)
    with db_engine.session_scope(database_url) as session:
        receipt = planning_inclusion.find_operation(session, context.workspace_id, context.user_id,
            identity.operation_id, scope=scope)
        return planning_inclusion.operation_metadata(receipt) if receipt else {
            'operationId': operation_id, 'status': 'unknown',
            'expired': identity.expires_at <= datetime.now(timezone.utc)}


def _authorization_batches(ids):
    batch, size = [], 0
    for identity in ids:
        if batch and (len(batch) == 100 or size + len(identity) + 1 > 3000):
            yield batch
            batch, size = [], 0
        batch.append(identity)
        size += len(identity) + 1
    if batch:
        yield batch


def _authorize_planning(context, ids, review_changes, inclusion_changes, admission, search, deadline, *, projection=False):
    """One union budget; visibility is distinct from the two role policies."""
    from backend.services.planning_scope import planning_candidate_intersection_jql
    if search is None:
        from backend.routes import get_jira_server
        search = get_jira_server().current_jira_search
    review_kinds = {i: {c['rowKind'] for c in review_changes if c['issueId'] == i} for i in ids}
    additions = {c['issueId'] for c in inclusion_changes if c['included']}
    found, review_allowed, candidates, pages = set(), set(), set(), 0
    budget = EngBoardRequestBudget.start(min(15, deadline.remaining()))
    transport = EngBoardRequestTransport(budget=budget)
    def collect(batch, candidate=False):
        nonlocal pages
        token, seen = None, set()
        while True:
            deadline.remaining()
            budget.check()
            if pages >= 10:
                raise ReviewError('review_authorization_incomplete', 503)
            try:
                jql = planning_candidate_intersection_jql(batch, admission.candidate_jql) if candidate else 'id in (' + ','.join(batch) + ')'
            except ValueError:
                raise ReviewError('planning_scope_unavailable', 503, noCommit=True) from None
            payload = {'jql': jql, 'fields': ['issuetype'], 'maxResults': 100}
            if token:
                payload['nextPageToken'] = token
            response = search(payload, context=context, timeout=min(budget.remaining(), deadline.remaining()), diagnostic_transport=transport)
            pages += 1
            budget.check()
            deadline.remaining()
            if response.status_code == 401:
                raise AuthError('auth_required')
            if response.status_code != 200:
                raise ReviewError('review_authorization_unavailable', 503)
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get('issues'), list) or type(data.get('isLast')) is not bool:
                raise ReviewError('review_authorization_incomplete', 503)
            for issue in data['issues']:
                identity = str(issue.get('id', '')) if isinstance(issue, dict) else ''
                if identity not in batch:
                    raise ReviewError('review_authorization_incomplete', 503)
                rule = (issue.get('fields') or {}).get('issuetype') or {}
                if not isinstance(rule, dict):
                    raise ReviewError('review_authorization_incomplete', 503)
                if candidate:
                    # Legacy JQL owns its unrestricted/custom-name semantics. Mapped roles additionally
                    # require the exact configured planning type and hierarchy, independently of cells.
                    mapping = (admission.type_map or {}).get(admission.child_kind)
                    if mapping is None or (str(rule.get('id') or '') == mapping[0]
                            and rule.get('hierarchyLevel') == mapping[1] and not rule.get('subtask', False)):
                        candidates.add(identity)
                    continue
                found.add(identity)
                level = rule.get('hierarchyLevel')
                if admission.type_map:
                    kind = next((k for k, (t, h) in admission.type_map.items()
                                 if str(rule.get('id') or '') == t and level == h), None)
                else:
                    types = {str(n).casefold() for n in admission.review_story_types} - {'epic'}
                    name = str(rule.get('name') or '').casefold()
                    kind = 'epic' if name == 'epic' else 'story' if name in types else None
                    if level is not None and level != (1 if kind == 'epic' else 0):
                        kind = None
                if kind and not rule.get('subtask', False) and review_kinds.get(identity) == {kind}:
                    review_allowed.add(identity)
            if data['isLast']:
                break
            token = data.get('nextPageToken')
            if not isinstance(token, str) or not token or token in seen:
                raise ReviewError('review_authorization_incomplete', 503)
            seen.add(token)
    try:
        for batch in _authorization_batches(ids):
            collect(batch)
        for batch in _authorization_batches(sorted(additions)):
            collect(batch, True)
    except EngBoardRequestDeadline:
        raise ReviewError('review_authorization_incomplete', 503) from None
    unavailable = (set(ids) - found) | ({c['issueId'] for c in review_changes} - review_allowed) | (additions - candidates)
    if projection:
        return found, review_allowed, candidates
    if unavailable:
        raise ReviewError('review_issues_unavailable', 403, unavailableIssueIds=sorted(unavailable))
    return candidates


def _replay_acknowledgement(receipt, context, search, deadline):
    ack = deepcopy(receipt.acknowledgement)
    ids = sorted({c['issueId'] for key in ('cells', 'inclusionChanges') for c in ack.get(key, [])})
    if ids:
        admission = PlanningAdmission('', '', 'story', None, None, None, 0, {}, lambda session: None)
        try:
            _authorize_planning(context, ids, [], [], admission, search, deadline)
        except ReviewError:
            return {**planning_inclusion.operation_metadata(receipt), 'reloadRequired': True}
    return {**ack, 'status': 'committed'}


def _save_planning_review(context, sprint_id, payload, database_url, search, admission_loader, prepare_response, deadline):
    require_review_context(context)
    deadline = deadline or PlanningDeadline()
    sprint_identity(sprint_id)
    group_id = group_identity(payload.get('groupId'))
    configuration_id = _syntactic_namespace(payload)
    scope = _operation_scope(context, sprint_id, group_id, configuration_id)
    identity = planning_inclusion.operation_identity(payload.get('operationId'), datetime.now(timezone.utc))
    digest = planning_inclusion.canonical_request_hash(payload, scope)
    # Outcome proof survives configuration/source/visibility changes.
    with ExitStack() as lookup_stack, db_engine.session_scope(database_url) as session:
        deadline.bind(session, lookup_stack)
        receipt = planning_inclusion.find_operation(session, context.workspace_id, context.user_id,
            identity.operation_id, scope=scope, request_hash=digest)
        if receipt:
            result = _replay_acknowledgement(receipt, context, search, deadline)
            if prepare_response:
                return prepare_response(result)
            return result
    planning_inclusion.require_unexpired_operation(identity, datetime.now(timezone.utc))
    if admission_loader is None:
        raise ReviewError('planning_admission_unavailable', 503, noCommit=True)
    admission = admission_loader()
    deadline.remaining()
    if admission.configuration_id != configuration_id or admission.scope_proof != payload['baseScopeProof']:
        raise ReviewError('configuration_scope_changed', 409, noCommit=True)
    legacy_payload = {k: payload[k] for k in ('groupId', 'baseSchemaRevision', 'baseViewRevision', 'schemaChanges', 'cellChanges') if k in payload}
    validate_schema_changes(legacy_payload.get('schemaChanges', []), configuration_id)
    changes = legacy_payload.get('cellChanges', [])
    if not isinstance(changes, list) or len(changes) > MAX_CHANGED_CELLS:
        raise ReviewError()
    # Stateless cell validation happens before any Jira call.
    identities = set()
    for change in changes:
        _keys(change, ('issueId', 'rowKind', 'columnId', 'value', 'baseRevision'))
        issue_ids([change.get('issueId')])
        row_kind(change.get('rowKind'), namespace_kinds(configuration_id))
        _column_id(change.get('columnId'))
        revision(change.get('baseRevision'))
        key = (change['issueId'], change['rowKind'], change['columnId'])
        if key in identities or 'value' not in change:
            raise ReviewError()
        identities.add(key)
    inclusion_changes = planning_inclusion.normalize_inclusion_changes(payload.get('inclusionChanges', []))
    ids = sorted({c['issueId'] for c in changes + inclusion_changes})
    issue_ids(ids)
    _authorize_planning(context, ids, changes, inclusion_changes, admission, search, deadline)
    with ExitStack() as stack:
        with db_engine.session_scope(database_url) as session:
            deadline.bind(session, stack)
            workspace_dashboard_config.acquire_workspace_config_fence(session, context.workspace_id, budget=deadline)
            group = session.scalar(select(models.WorkspaceGroupConfig).where(
                models.WorkspaceGroupConfig.workspace_id == context.workspace_id).with_for_update().execution_options(populate_existing=True))
            row = _locked_schema(session, context, group_id, configuration_id)
            receipt = planning_inclusion.find_operation(session, context.workspace_id, context.user_id,
                identity.operation_id, scope=scope, request_hash=digest)
            if receipt:
                result = {**deepcopy(receipt.acknowledgement), 'status': 'committed'}
                return prepare_response(result) if prepare_response else result
            if group is None or group.config_revision != admission.group_revision or group.payload != admission.group_payload:
                raise ReviewError('configuration_scope_changed', 409, noCommit=True)
            planning_inclusion.require_unexpired_operation(identity, datetime.now(timezone.utc))
            deadline.remaining()
            admission.revalidate(session)
            plan, created = planning_inclusion.initialize_plan(session, row.id, sprint_id, payload['initializePlan'])
            session.flush()
            # Acquire all row locks before entering the process catalog guard.
            entries = {entry.issue_id: entry for entry in session.scalars(select(models.GroupSprintPlanEntry).where(
                models.GroupSprintPlanEntry.plan_id == plan.id,
                models.GroupSprintPlanEntry.issue_id.in_([c['issueId'] for c in inclusion_changes]))
                .with_for_update().execution_options(populate_existing=True)).all()}
            missing_removals = [c['issueId'] for c in inclusion_changes if not c['included'] and c['issueId'] not in entries]
            if missing_removals:
                raise ReviewError('review_issues_unavailable', 403, unavailableIssueIds=missing_removals)
            planning_inclusion.require_operation_capacity(session, plan.id, context.workspace_id, context.user_id, datetime.now(timezone.utc))
            if admission.source_proof is not None:
                from backend.services.workspace_catalog_cache import SCOPED_SPRINT_CATALOGS, ScopedSprintCatalogBusy
                try:
                    matches = stack.enter_context(SCOPED_SPRINT_CATALOGS.proof_guard(
                        admission.source_proof, timeout=min(5, deadline.remaining())))
                except ScopedSprintCatalogBusy:
                    raise ReviewError('planning_catalog_busy', 503, noCommit=True) from None
                if not matches:
                    raise ReviewError('configuration_scope_changed', 409, noCommit=True)
            result = save_review(context, sprint_id, legacy_payload, database_url, search,
                configuration_id=configuration_id, quarter_ordinal=admission.quarter_ordinal,
                type_map=admission.type_map, _session=session, _row=row)
            confirmed = planning_inclusion.apply_inclusion_changes(session, plan, inclusion_changes,
                newly_initialized=created, locked_entries=entries)
            result.update(operationId=identity.operation_id, plan={'exists': True, 'revision': plan.revision}, inclusionChanges=confirmed)
            deadline.remaining()
            prepared = prepare_response(result) if prepare_response else result
            _encode_acknowledgement(result)
            planning_inclusion.record_operation(session, plan, context.workspace_id, context.user_id,
                identity, digest, result, datetime.now(timezone.utc))
            session.flush()
            deadline.remaining()
            return prepared


def load_planning_metadata(context, sprint_id, group_id, admission, database_url=None):
    with db_engine.session_scope(database_url) as session:
        schema = session.scalar(_schema_query(context, group_id, admission.configuration_id))
        projection = planning_inclusion.load_inclusion_projection(session, schema.id, sprint_id, []) if schema else {'plan': {'exists': False, 'revision': 0}}
        return {'plan': projection['plan'], 'scopeProof': admission.scope_proof,
                'planCapabilities': {'canRead': True, 'canSave': True, 'reason': None}}


def _read_planning_values(context, sprint_id, payload, database_url, search, admission_loader, deadline):
    require_review_context(context)
    deadline = deadline or PlanningDeadline()
    sprint_identity(sprint_id)
    _keys(payload, ('groupId', 'issueIds', 'rowKind', 'includePlan', 'expectedPlanRevision', 'expectedScopeProof', 'configuration'))
    group_id = group_identity(payload.get('groupId'))
    ids = issue_ids(payload.get('issueIds'))
    expected = revision(payload.get('expectedPlanRevision'))
    if not isinstance(payload.get('expectedScopeProof'), str) or admission_loader is None:
        raise ReviewError()
    admission = admission_loader()
    kind = row_kind(payload.get('rowKind'), namespace_kinds(admission.configuration_id))
    if payload['expectedScopeProof'] != admission.scope_proof:
        raise ReviewError('plan_projection_changed', 409)
    _visible, cell_allowed, candidates = _authorize_planning(context, ids,
        [{'issueId': i, 'rowKind': kind} for i in ids],
        [{'issueId': i, 'included': True} for i in ids], admission, search, deadline, projection=True)
    allowed = [i for i in ids if i in candidates]
    with db_engine.session_scope(database_url) as session:
        schema = session.scalar(_schema_query(context, group_id, admission.configuration_id))
        projection = planning_inclusion.load_inclusion_projection(session, schema.id, sprint_id, allowed, expected) if schema else {
            'plan': {'exists': False, 'revision': 0},
            'planEntries': [{'issueId': i, 'included': False, 'revision': 0} for i in allowed]}
        if projection['plan']['revision'] != expected:
            raise ReviewError('plan_projection_changed', 409)
        active = [c['id'] for c in schema.columns if c['rowKind'] == kind and not c['archived']] if schema else []
        cells = session.scalars(select(models.GroupReviewCell).where(
            models.GroupReviewCell.schema_id == schema.id, models.GroupReviewCell.row_kind == kind,
            models.GroupReviewCell.column_id.in_(active), models.GroupReviewCell.issue_id.in_(cell_allowed))
            .limit(MAX_RESPONSE_BYTES // 100 + 1)).all() if active and cell_allowed else []
        if len(cells) > MAX_RESPONSE_BYTES // 100:
            raise ReviewError('review_response_limit', 413)
        return {'cells': [_cell(c) for c in cells], 'planEntries': projection['planEntries'],
                'planRevision': projection['plan']['revision'], 'scopeProof': admission.scope_proof,
                'unavailableIssueIds': [i for i in ids if i not in candidates]}
