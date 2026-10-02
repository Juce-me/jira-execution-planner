"""Bounded Jira authorization and atomic workspace/Sprint custom reviews.

The schema row is the transaction fence, including first-create races. Serializing
that short database transaction does not reject disjoint cell revisions.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import re
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from backend.auth.db_context import is_db_auth_context
from backend.auth.jira_auth import AuthError
from backend.db import engine as db_engine, models
from backend.services.eng_board_stream import EngBoardRequestBudget, EngBoardRequestDeadline, EngBoardRequestTransport

MAX_ACTIVE_COLUMNS = 30
MAX_CHANGED_CELLS = 100
MAX_READ_ISSUES = 500
MAX_REQUEST_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024


class ReviewError(ValueError):
    def __init__(self, code='invalid_review_request', status=400, **details):
        super().__init__(code)
        self.code, self.status, self.details = code, status, details


def capabilities(context):
    enabled = bool(db_engine.database_storage_enabled() and is_db_auth_context(context)
                   and context.auth_mode == 'atlassian_oauth')
    return {'canRead': enabled, 'canSave': enabled,
            'reason': None if enabled else 'Shared review saving requires database-backed OAuth.'}


def _context(context):
    if context is None or context.auth_mode != 'atlassian_oauth' or not context.user_id or not context.workspace_id:
        raise AuthError('auth_required')
    if not capabilities(context)['canSave']:
        raise ReviewError('review_storage_unavailable', 503)


def sprint_identity(value):
    if not isinstance(value, str) or len(value) > 128 or re.fullmatch(r'[1-9][0-9]*', value) is None:
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


def apply_schema(columns, changes):
    result = deepcopy(columns)
    if not isinstance(changes, list) or len(changes) > 120:
        raise ReviewError()
    for change in changes:
        if not isinstance(change, dict):
            raise ReviewError()
        action = change.get('action')
        if action == 'add':
            _keys(change, ('action', 'column'))
            column = change.get('column')
            _keys(column, ('id', 'rowKind', 'label', 'type', 'aggregation', 'archived', 'order'))
            identity = _column_id(column.get('id'))
            kind = row_kind(column.get('rowKind'))
            type_name = column.get('type')
            if type_name not in ('number', 'text') or any(c['id'] == identity for c in result):
                raise ReviewError()
            aggregation = column.get('aggregation', 'sum' if type_name == 'number' else 'none')
            if aggregation not in ('sum', 'none') or type_name == 'text' and aggregation != 'none' or column.get('archived', False) is not False:
                raise ReviewError()
            result.append({'id': identity, 'rowKind': kind, 'label': _label(column.get('label')),
                           'type': type_name, 'aggregation': aggregation, 'archived': False,
                           'order': sum(c['rowKind'] == kind for c in result)})
        elif action == 'layout':
            continue
        elif action == 'reorder':
            _keys(change, ('action', 'rowKind', 'columnIds'))
            kind = row_kind(change.get('rowKind'))
            ids = change.get('columnIds')
            expected = [c['id'] for c in result if c['rowKind'] == kind and not c['archived']]
            if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids) or len(ids) != len(expected) or set(ids) != set(expected):
                raise ReviewError()
            for column in result:
                if column['id'] in ids:
                    column['order'] = ids.index(column['id'])
        elif action in ('rename', 'archive', 'aggregation'):
            field = {'rename': 'label', 'archive': 'archived', 'aggregation': 'aggregation'}[action]
            _keys(change, ('action', 'columnId', field))
            column = next((c for c in result if c['id'] == change.get('columnId')), None)
            if column is None:
                raise ReviewError()
            value = change.get(field)
            if action == 'rename':
                value = _label(value)
            elif action == 'archive':
                if value is not True:
                    raise ReviewError()
            elif value not in ('sum', 'none') or column['type'] == 'text' and value != 'none':
                raise ReviewError()
            column[field] = value
        else:
            raise ReviewError()
    for kind in ('epic', 'story'):
        if sum(c['rowKind'] == kind and not c['archived'] for c in result) > MAX_ACTIVE_COLUMNS:
            raise ReviewError('review_column_limit')
    # Archived definitions remain bounded, retained for saved-value identity.
    if len(result) > 240:
        raise ReviewError('review_schema_limit')
    return result


REVIEW_LAYOUT_BUILTINS = {
    'epic': {'status', 'priority', 'storyPoints', 'team', 'teamsInScope', 'project', 'assignee', 'components', 'capacity', 'projectTrack'},
    'story': {'status', 'priority', 'storyPoints', 'team', 'project', 'epic', 'assignee', 'components', 'capacity', 'projectTrack'},
}


def apply_layouts(layouts, columns, changes):
    result = deepcopy(layouts or {})
    for change in changes:
        if change.get('action') != 'layout':
            continue
        _keys(change, ('action', 'rowKind', 'order', 'hidden'))
        kind = row_kind(change.get('rowKind'))
        custom = {c['id'] for c in columns if c['rowKind'] == kind}
        allowed = REVIEW_LAYOUT_BUILTINS[kind] | custom
        hideable = {'assignee', 'components', 'project', 'capacity', 'projectTrack'} | custom | ({'team'} if kind == 'epic' else set())
        for field, accepted in (('order', allowed), ('hidden', hideable)):
            ids = change.get(field, [])
            if not isinstance(ids, list) or len(ids) > 254 or any(not isinstance(i, str) for i in ids) or len(ids) != len(set(ids)) or not set(ids) <= accepted:
                raise ReviewError()
        result[kind] = {'order': list(change.get('order', [])), 'hidden': list(change.get('hidden', []))}
    return result


def authorize_issues(context, ids, search=None, requested_kinds=None):
    """Authorize numeric immutable IDs through the current user's OAuth Jira search.

    Jira visibility establishes access; configured ENG issue types only classify
    row kinds. No Basic fallback, per-issue fan-out, or saved value establishes
    access. Completion is mandatory.
    """
    _context(context)
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


def _review_query(context, sprint_id):
    return select(models.WorkspaceSprintReview).where(
        models.WorkspaceSprintReview.workspace_id == context.workspace_id,
        models.WorkspaceSprintReview.sprint_id == sprint_id)


def _schema(row, sprint_id):
    return {'schemaVersion': 1, 'sprintId': sprint_id, 'schemaRevision': row.schema_revision if row else 0,
            'columns': deepcopy(row.columns) if row else [], 'layouts': deepcopy(row.layouts) if row else {}}


def load_review(context, sprint_id, database_url=None):
    sprint_identity(sprint_id)
    caps = capabilities(context)
    if not caps['canRead']:
        return {**_schema(None, sprint_id), 'capabilities': caps}
    _context(context)
    with db_engine.session_scope(database_url) as session:
        row = session.scalar(_review_query(context, sprint_id))
        return {**_schema(row, sprint_id), 'capabilities': caps}


def _cell(cell):
    return {'issueId': cell.issue_id, 'rowKind': cell.row_kind, 'columnId': cell.column_id,
            'value': cell.value, 'revision': cell.revision}


def read_values(context, sprint_id, payload, database_url=None, search=None):
    _context(context)
    sprint_identity(sprint_id)
    _keys(payload, ('issueIds', 'rowKind'))
    ids, kind = issue_ids(payload.get('issueIds')), row_kind(payload.get('rowKind'))
    allowed = authorize_issues(context, ids, search, {identity: {kind} for identity in ids})
    with db_engine.session_scope(database_url) as session:
        row = session.scalar(_review_query(context, sprint_id))
        cells = [] if row is None or not allowed else session.scalars(select(models.SprintReviewCell).where(
            models.SprintReviewCell.review_id == row.id, models.SprintReviewCell.row_kind == kind,
            models.SprintReviewCell.issue_id.in_(allowed)).limit(MAX_RESPONSE_BYTES // 100 + 1)).all()
        if len(cells) > MAX_RESPONSE_BYTES // 100:
            raise ReviewError('review_response_limit', 413)
        return {'cells': [_cell(cell) for cell in cells], 'unavailableIssueIds': [i for i in ids if i not in allowed]}


def _locked_review(session, context, sprint_id):
    dialect = session.bind.dialect.name
    insert = postgres_insert if dialect == 'postgresql' else sqlite_insert if dialect == 'sqlite' else None
    if insert is None:
        raise ReviewError('review_storage_unavailable', 503)
    session.execute(insert(models.WorkspaceSprintReview).values(
        id=str(uuid.uuid4()), workspace_id=context.workspace_id, sprint_id=sprint_id,
        schema_revision=0, columns=[]).on_conflict_do_nothing(index_elements=['workspace_id', 'sprint_id']))
    return session.scalar(_review_query(context, sprint_id).with_for_update())


def save_review(context, sprint_id, payload, database_url=None, search=None):
    _context(context)
    sprint_identity(sprint_id)
    _keys(payload, ('baseSchemaRevision', 'schemaChanges', 'cellChanges'))
    base = revision(payload.get('baseSchemaRevision'))
    schema_changes, changes = payload.get('schemaChanges', []), payload.get('cellChanges', [])
    if not isinstance(schema_changes, list) or not isinstance(changes, list) or len(changes) > MAX_CHANGED_CELLS:
        raise ReviewError()
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
    requested_kinds = {identity: {c['rowKind'] for c in changes if c['issueId'] == identity} for identity in ids}
    allowed = authorize_issues(context, ids, search, requested_kinds)
    if len(allowed) != len(ids):
        raise ReviewError('review_issues_unavailable', 403, unavailableIssueIds=[i for i in ids if i not in allowed])
    with db_engine.session_scope(database_url) as session:
        row = _locked_review(session, context, sprint_id)
        schema_conflict = bool(schema_changes and base != row.schema_revision)
        existing = session.scalars(select(models.SprintReviewCell).where(
            models.SprintReviewCell.review_id == row.id, models.SprintReviewCell.issue_id.in_(ids))).all() if ids else []
        cell_map = {(c.issue_id, c.row_kind, c.column_id): c for c in existing}
        conflicts = []
        for change in changes:
            cell = cell_map.get((change['issueId'], change['rowKind'], change['columnId']))
            if change['baseRevision'] != (cell.revision if cell else 0):
                conflicts.append(_cell(cell) if cell else {**{k: change[k] for k in ('issueId', 'rowKind', 'columnId')}, 'value': None, 'revision': 0})
        if schema_conflict or conflicts:
            raise ReviewError('review_conflict', 409, schemaConflict=schema_conflict,
                              schemaRevision=row.schema_revision, columns=deepcopy(row.columns), cellConflicts=conflicts)
        columns = apply_schema(row.columns, schema_changes)
        layouts = apply_layouts(row.layouts, columns, schema_changes)
        column_map = {c['id']: c for c in columns}
        normalized = []
        for change in changes:
            column = column_map.get(change['columnId'])
            if column is None or column['archived'] or column['rowKind'] != change['rowKind']:
                raise ReviewError('review_conflict', 409, schemaConflict=True, schemaRevision=row.schema_revision,
                                  columns=deepcopy(row.columns), cellConflicts=[])
            normalized.append(normalize_value(change['value'], column))
        if schema_changes:
            row.columns = columns
            row.layouts = layouts
            row.schema_revision += 1
        saved = []
        for change, value in zip(changes, normalized):
            cell = cell_map.get((change['issueId'], change['rowKind'], change['columnId']))
            if cell is None:
                cell = models.SprintReviewCell(review_id=row.id, issue_id=change['issueId'], row_kind=change['rowKind'],
                                              column_id=change['columnId'], value=value, revision=1)
                session.add(cell)
            else:
                cell.value = value
                cell.revision += 1
            saved.append(_cell(cell))
        session.flush()
        return {**_schema(row, sprint_id), 'cells': saved}
