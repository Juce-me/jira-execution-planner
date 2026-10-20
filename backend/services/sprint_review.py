"""Bounded Jira authorization and atomic Department-group custom reviews.

Columns and values belong to a workspace + Department group; views (column order and
hidden columns) belong to a group + Sprint and resolve to the nearest earlier saved view.
The group schema row is the transaction fence for every writer, including first-create
races. Serializing that short database transaction does not reject disjoint cell revisions.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import re
import unicodedata
import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from backend.auth.db_context import is_db_auth_context
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine, models
from backend.services import shared_group_config
from backend.services.eng_board_stream import EngBoardRequestBudget, EngBoardRequestDeadline, EngBoardRequestTransport

MAX_ACTIVE_COLUMNS = 30
MAX_CHANGED_CELLS = 100
MAX_READ_ISSUES = 500
MAX_REQUEST_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
SPRINT_ORDER_WIDTH = 128
MAX_GROUP_VIEWS = 500


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


def row_kind(value):
    if value not in ('epic', 'story'):
        raise ReviewError()
    return value


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


def validate_schema_changes(changes):
    """Stateless shape checks for every schema action, run before Jira authorization.

    State checks (duplicate id, column lookup, reorder set, anchor and layout-id
    membership, limits) stay in apply_schema and apply_layouts, inside the transaction.
    """
    if not isinstance(changes, list) or len(changes) > 120:
        raise ReviewError()
    for change in changes:
        action = change.get('action') if isinstance(change, dict) else None
        if action == 'add':
            _keys(change, ('action', 'column'))
            column = change.get('column')
            _keys(column, ('id', 'rowKind', 'label', 'type', 'aggregation', 'archived', 'order', 'after'))
            _column_id(column.get('id'))
            row_kind(column.get('rowKind'))
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
            row_kind(change.get('rowKind'))
            for field in ('order', 'hidden'):
                if field not in change:
                    raise ReviewError()
                _id_list(change[field], 254)
        elif action == 'reorder':
            _keys(change, ('action', 'rowKind', 'columnIds'))
            row_kind(change.get('rowKind'))
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


def apply_schema(columns, changes):
    """Apply column actions to a schema; changes must have passed validate_schema_changes."""
    result = deepcopy(columns)
    for change in changes:
        action = change['action']
        if action == 'add':
            column = change['column']
            identity, kind, type_name = column['id'], column['rowKind'], column['type']
            after = column.get('after')
            if any(c['id'] == identity for c in result):
                raise ReviewError()
            # An anchor is 'summary', a same-kind built-in or a same-kind group column (archived or added earlier in this request).
            if after is not None and after != 'summary' and after not in REVIEW_LAYOUT_BUILTINS[kind] \
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
    for kind in ('epic', 'story'):
        if sum(c['rowKind'] == kind and not c['archived'] for c in result) > MAX_ACTIVE_COLUMNS:
            raise ReviewError('review_column_limit')
    # Archived definitions remain bounded, retained for saved-value identity.
    if len(result) > 240:
        raise ReviewError('review_schema_limit')
    return result


REVIEW_LAYOUT_BUILTINS = {
    'epic': {'status', 'priority', 'storyPoints', 'accepted', 'team', 'teamsInScope', 'project', 'assignee', 'components', 'capacity', 'projectTrack'},
    'story': {'status', 'priority', 'storyPoints', 'accepted', 'team', 'project', 'epic', 'assignee', 'components', 'capacity', 'projectTrack'},
}


def apply_layouts(layouts, columns, changes):
    """Merge layout actions over a view; changes must have passed validate_schema_changes."""
    result = deepcopy(layouts or {})
    # Derived columns let a view place custom columns of either row kind.
    custom = {c['id'] for c in columns}
    for change in changes:
        if change['action'] != 'layout':
            continue
        kind = change['rowKind']
        allowed = REVIEW_LAYOUT_BUILTINS[kind] | custom
        # Every column but the pinned Summary can be hidden; Key is pinned first, so it hides but is never part of the order.
        if not set(change['order']) <= allowed or not set(change['hidden']) <= allowed | {'key'}:
            raise ReviewError()
        result[kind] = {'order': list(change['order']), 'hidden': list(change['hidden'])}
    return result


def authorize_issues(context, ids, search=None, requested_kinds=None):
    """Authorize numeric immutable IDs through the current user's OAuth Jira search.

    Jira visibility establishes access; configured ENG issue types only classify
    row kinds. No Basic fallback, per-issue fan-out, or saved value establishes
    access. Completion is mandatory.
    """
    require_review_context(context)
    ids = issue_ids(ids)
    if not ids:
        return set()
    story_types = {'story'}
    if search is None:
        from backend.routes import get_jira_server
        server = get_jira_server()
        if server.JIRA_AUTH_MODE != 'atlassian_oauth':
            raise AuthError('auth_required')
        search = server.current_jira_search
        if requested_kinds is not None:
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
                    name = str(issue_type.get('name') or '').casefold()
                    kind = 'epic' if name == 'epic' else 'story' if name in story_types else None
                    hierarchy = issue_type.get('hierarchyLevel')
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


def _schema_query(context, group_id):
    return select(models.WorkspaceGroupReviewSchema).where(
        models.WorkspaceGroupReviewSchema.workspace_id == context.workspace_id,
        models.WorkspaceGroupReviewSchema.group_id == group_id)


def _views(workspace_id, group_id):
    return (models.GroupSprintReviewView.workspace_id == workspace_id,
            models.GroupSprintReviewView.group_id == group_id)


def resolve_view(session, workspace_id, group_id, sprint_id):
    """One <= lookup: the Sprint's own view, else the nearest earlier saved view, else none."""
    row = session.scalars(select(models.GroupSprintReviewView).where(
        *_views(workspace_id, group_id),
        models.GroupSprintReviewView.sprint_order <= sprint_order(sprint_id),
    ).order_by(models.GroupSprintReviewView.sprint_order.desc()).limit(1)).first()
    if row is None:
        return {}, 0, None
    if row.sprint_id == sprint_id:
        return deepcopy(row.layouts), row.view_revision, None
    return deepcopy(row.layouts), 0, {'sprintId': row.sprint_id, 'viewRevision': row.view_revision}


def _base(row, sprint_id, group_id):
    return {'schemaVersion': 1, 'sprintId': sprint_id, 'groupId': group_id,
            'columns': deepcopy(row.columns) if row else [], 'schemaRevision': row.schema_revision if row else 0}


def load_review(context, sprint_id, group_id, database_url=None):
    sprint_identity(sprint_id)
    group_identity(group_id)
    caps = capabilities(context)
    if not caps['canRead']:
        return {**_base(None, sprint_id, group_id), 'viewRevision': 0, 'layouts': {}, 'inheritedFrom': None, 'capabilities': caps}
    require_review_context(context)
    with db_engine.session_scope(database_url) as session:
        row = session.scalar(_schema_query(context, group_id))
        layouts, view_revision, inherited_from = resolve_view(session, context.workspace_id, group_id, sprint_id)
        return {**_base(row, sprint_id, group_id), 'viewRevision': view_revision, 'layouts': layouts,
                'inheritedFrom': inherited_from, 'capabilities': caps}


def _cell(cell):
    return {'issueId': cell.issue_id, 'rowKind': cell.row_kind, 'columnId': cell.column_id,
            'value': cell.value, 'revision': cell.revision}


def read_values(context, sprint_id, payload, database_url=None, search=None):
    require_review_context(context)
    sprint_identity(sprint_id)
    _keys(payload, ('groupId', 'issueIds', 'rowKind'))
    group_id = group_identity(payload.get('groupId'))
    ids, kind = issue_ids(payload.get('issueIds')), row_kind(payload.get('rowKind'))
    allowed = authorize_issues(context, ids, search, {identity: {kind} for identity in ids})
    with db_engine.session_scope(database_url) as session:
        row = session.scalar(_schema_query(context, group_id))
        # Group-wide accumulation: only active columns' cells are read back.
        active = [c['id'] for c in row.columns if c['rowKind'] == kind and not c['archived']] if row else []
        cells = [] if not active or not allowed else session.scalars(select(models.GroupReviewCell).where(
            models.GroupReviewCell.schema_id == row.id, models.GroupReviewCell.row_kind == kind,
            models.GroupReviewCell.column_id.in_(active),
            models.GroupReviewCell.issue_id.in_(allowed)).limit(MAX_RESPONSE_BYTES // 100 + 1)).all()
        if len(cells) > MAX_RESPONSE_BYTES // 100:
            raise ReviewError('review_response_limit', 413)
        return {'cells': [_cell(cell) for cell in cells], 'unavailableIssueIds': [i for i in ids if i not in allowed]}


def _locked_schema(session, context, group_id):
    dialect = session.bind.dialect.name
    insert = postgres_insert if dialect == 'postgresql' else sqlite_insert if dialect == 'sqlite' else None
    if insert is None:
        raise ReviewError('review_storage_unavailable', 503)
    session.execute(insert(models.WorkspaceGroupReviewSchema).values(
        id=str(uuid.uuid4()), workspace_id=context.workspace_id, group_id=group_id,
        schema_revision=0, columns=[]).on_conflict_do_nothing(index_elements=['workspace_id', 'group_id']))
    return session.scalar(_schema_query(context, group_id).with_for_update())


def _conflict(row, schema_conflict, view_conflict, cell_conflicts):
    return ReviewError('review_conflict', 409, schemaConflict=schema_conflict, viewConflict=view_conflict,
                       cellConflicts=cell_conflicts, columns=deepcopy(row.columns), schemaRevision=row.schema_revision)


def save_review(context, sprint_id, payload, database_url=None, search=None):
    require_review_context(context)
    sprint_identity(sprint_id)
    _keys(payload, ('groupId', 'baseSchemaRevision', 'baseViewRevision', 'schemaChanges', 'cellChanges'))
    group_id = group_identity(payload.get('groupId'))
    base = revision(payload.get('baseSchemaRevision'))
    base_view = revision(payload.get('baseViewRevision', 0))
    schema_changes, changes = payload.get('schemaChanges', []), payload.get('cellChanges', [])
    if not isinstance(schema_changes, list) or not isinstance(changes, list) or len(changes) > MAX_CHANGED_CELLS:
        raise ReviewError()
    validate_schema_changes(schema_changes)
    identities, ids = set(), []
    for change in changes:
        _keys(change, ('issueId', 'rowKind', 'columnId', 'value', 'baseRevision'))
        issue_ids([change.get('issueId')])
        row_kind(change.get('rowKind'))
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
    ensure_group_configured(context, group_id, database_url)
    requested_kinds = {identity: {c['rowKind'] for c in changes if c['issueId'] == identity} for identity in ids}
    allowed = authorize_issues(context, ids, search, requested_kinds)
    if len(allowed) != len(ids):
        raise ReviewError('review_issues_unavailable', 403, unavailableIssueIds=[i for i in ids if i not in allowed])
    layout_actions = any(change['action'] == 'layout' for change in schema_changes)
    column_actions = any(change['action'] != 'layout' for change in schema_changes)
    with db_engine.session_scope(database_url) as session:
        if not schema_changes and not changes:
            # An empty request creates no row and takes no lock.
            return {**_base(session.scalar(_schema_query(context, group_id)), sprint_id, group_id), 'cells': []}
        # (1) lock the schema row; (2) select the Sprint's view row for a layout action.
        row = _locked_schema(session, context, group_id)
        view = session.scalar(select(models.GroupSprintReviewView).where(
            *_views(context.workspace_id, group_id),
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
        columns = apply_schema(row.columns, schema_changes)
        layouts = apply_layouts(view.layouts if view else {}, columns, schema_changes) if layout_actions else None
        column_map = {c['id']: c for c in columns}
        normalized = []
        for change in changes:
            column = column_map.get(change['columnId'])
            if column is None or column['archived'] or column['rowKind'] != change['rowKind']:
                raise _conflict(row, True, False, [])
            normalized.append(normalize_value(change['value'], column))
        # (5) the view cap, on the insert path only.
        if layout_actions and view is None and session.scalar(
                select(func.count()).select_from(models.GroupSprintReviewView).where(
                    *_views(context.workspace_id, group_id))) >= MAX_GROUP_VIEWS:
            raise ReviewError('review_view_limit')
        # (6) write.
        if column_actions:
            row.columns = columns
            row.schema_revision += 1
        if layout_actions:
            if view is None:
                view = models.GroupSprintReviewView(workspace_id=context.workspace_id, group_id=group_id, sprint_id=sprint_id,
                                                    sprint_order=sprint_order(sprint_id), layouts=layouts, view_revision=1)
                session.add(view)
            else:
                view.layouts = layouts
                view.view_revision += 1
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
        result = {**_base(row, sprint_id, group_id), 'cells': saved}
        if layout_actions:
            result.update(layouts=deepcopy(layouts), viewRevision=view.view_revision, inheritedFrom=None)
        return result
