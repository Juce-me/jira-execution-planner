"""Adopt legacy per-Sprint review data into Department groups that hold no review rows (#299).

Revision ID: 20261023_0020
Revises: 20261020_0019

Migration 20261020_0019 creates empty group tables and moves no data, so every release that migrates without running
scripts/adopt_legacy_sprint_reviews.py hides each saved review column (MRT033). This revision runs that adoption once
per database, for every workspace with legacy review content and at least one configured Department group.

Scope: a group is adopted only when it holds no review row (no schema row, so no cells or views) at the moment its
schema row is locked. Every other group is left alone and logged; the script's --merge restores it. Legacy tables are
never written. Locks are the ones every app save takes (the group schema row) plus a share lock on the legacy tables,
all held until the upgrade's transaction commits, so the whole run shares one row budget.

Failure policy: any database error fails the upgrade (re-raised with only its SQLSTATE: driver text echoes bound
values), so nothing is stamped and a retry is clean. Only data errors raised while planning a workspace skip that
workspace, with its id and reason in the log. Kill switch: REVIEW_ADOPTION_ON_UPGRADE (unset or true runs, false skips,
anything else fails the upgrade), read from the process environment only.

The review rules below are a frozen snapshot of backend/services/sprint_review.py, so a replay applies the rules this
revision was written with; tests/test_review_adoption_migration.py compares the snapshot with the live rules. This
revision imports no application module except the pure planner. downgrade() is a no-op: adopted rows are additive
and cannot be listed afterwards, and the pre-release backup is the rollback.
"""
from __future__ import annotations

from copy import deepcopy
import logging
import os
import re
from types import SimpleNamespace
import unicodedata
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite

from backend.services.review_adoption import canonical_legacy, fingerprint, group_ids, group_state, normalize, resolve_group

revision = '20261023_0020'
down_revision = '20261020_0019'
branch_labels = None
depends_on = None

MAX_ACTIVE_COLUMNS = 30
MAX_GROUP_VIEWS = 500
SPRINT_ORDER_WIDTH = 128

# ---- Frozen snapshot of the review rules (copied from backend/services/sprint_review.py) ----------------------------

def sprint_order(sprint_id: str) -> str:
    """Left-pad a decimal Sprint id so string order equals numeric order."""
    return sprint_id.rjust(SPRINT_ORDER_WIDTH, '0')


class ReviewError(ValueError):
    def __init__(self, code='invalid_review_request', status=400, **details):
        super().__init__(code)
        self.code, self.status, self.details = code, status, details


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


def row_kind(value):
    if value not in ('epic', 'story'):
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


RULES = SimpleNamespace(
    ReviewError=ReviewError, MAX_ACTIVE_COLUMNS=MAX_ACTIVE_COLUMNS, MAX_GROUP_VIEWS=MAX_GROUP_VIEWS,
    REVIEW_LAYOUT_BUILTINS=REVIEW_LAYOUT_BUILTINS, sprint_order=sprint_order, sprint_identity=sprint_identity,
    group_identity=group_identity, validate_schema_changes=validate_schema_changes, apply_schema=apply_schema,
    apply_layouts=apply_layouts)

# ---- Adoption --------------------------------------------------------------------------------------------------------

LOG = logging.getLogger('review_adoption')  # not under 'alembic.': env.py's fileConfig clears handlers on those children
KILL_SWITCH = 'REVIEW_ADOPTION_ON_UPGRADE'
RUN_BUDGET = 100_000  # rows inserted over the whole run (columns, cells and views, per group), as in the script
INSERT_CHUNK_ROWS = 100
LOCK_TIMEOUT = '5s'
STATEMENT_TIMEOUT = '60s'
LEGACY_TABLES = ('workspace_sprint_reviews', 'sprint_review_cells')
GROUP_TABLES = ('workspace_group_review_schemas', 'group_review_cells', 'group_sprint_review_views')
REQUIRED_TABLES = ('workspaces', 'workspace_group_configs') + LEGACY_TABLES + GROUP_TABLES
PLANNER_ERRORS = (ValueError, KeyError, TypeError, AttributeError)
NOTE = ('-- Legacy review adoption is not rendered offline. Run scripts/adopt_legacy_sprint_reviews.py '
        'after the upgrade (see INSTALL.md).')


class ReviewAdoptionError(RuntimeError):
    """A database error during adoption, carrying only its SQLSTATE."""


# Frozen table definitions, typed as revisions 0017 to 0019 declare them (a Uuid or JSON typed as a string writes
# values the application cannot find).
_metadata = sa.MetaData()
_uuid = sa.Uuid(as_uuid=False)
workspaces = sa.Table('workspaces', _metadata, sa.Column('id', sa.String(36), primary_key=True))
group_configs = sa.Table('workspace_group_configs', _metadata, sa.Column('workspace_id', sa.String(36)),
                         sa.Column('payload', sa.JSON()))
legacy_reviews = sa.Table(
    'workspace_sprint_reviews', _metadata, sa.Column('id', _uuid, primary_key=True), sa.Column('workspace_id', sa.String(36)),
    sa.Column('sprint_id', sa.String(128)), sa.Column('schema_revision', sa.Integer()), sa.Column('columns', sa.JSON()),
    sa.Column('layouts', sa.JSON()))
legacy_cells = sa.Table(
    'sprint_review_cells', _metadata, sa.Column('id', _uuid, primary_key=True), sa.Column('review_id', _uuid),
    sa.Column('issue_id', sa.String(128)), sa.Column('row_kind', sa.String(8)), sa.Column('column_id', sa.String(36)),
    sa.Column('value', sa.String(500)), sa.Column('revision', sa.Integer()))
group_schemas = sa.Table(
    'workspace_group_review_schemas', _metadata, sa.Column('id', _uuid, primary_key=True),
    sa.Column('workspace_id', sa.String(36)), sa.Column('group_id', sa.String(128)),
    sa.Column('schema_revision', sa.Integer()), sa.Column('columns', sa.JSON()))
group_cells = sa.Table(
    'group_review_cells', _metadata, sa.Column('id', _uuid, primary_key=True), sa.Column('schema_id', _uuid),
    sa.Column('issue_id', sa.String(128)), sa.Column('row_kind', sa.String(8)), sa.Column('column_id', sa.String(36)),
    sa.Column('value', sa.String(500)), sa.Column('revision', sa.Integer()))
group_views = sa.Table(
    'group_sprint_review_views', _metadata, sa.Column('id', _uuid, primary_key=True),
    sa.Column('workspace_id', sa.String(36)), sa.Column('group_id', sa.String(128)), sa.Column('sprint_id', sa.String(128)),
    sa.Column('sprint_order', sa.String(128)), sa.Column('layouts', sa.JSON()), sa.Column('view_revision', sa.Integer()))


def _guarded(call, *args):
    """Run database work; a database error is re-raised with only its SQLSTATE, outside the handler so nothing chains.

    Driver messages echo bound parameters (cell values, labels), and Alembic prints a traceback."""
    code = None
    try:
        return call(*args)
    except sa.exc.SQLAlchemyError as error:
        original = getattr(error, 'orig', None)
        code = (getattr(original, 'sqlstate', None) or getattr(original, 'pgcode', None)
                or type(original if original is not None else error).__name__)
    raise ReviewAdoptionError(f'review adoption failed: database error {code}')


def _postgresql(connection):
    return connection.dialect.name == 'postgresql'


def _require_tables(connection):
    present = set(sa.inspect(connection).get_table_names())
    missing = [name for name in REQUIRED_TABLES if name not in present]
    if missing:
        raise ReviewAdoptionError(f"required tables missing: {', '.join(missing)}")


def _set_timeouts(connection):
    """Transaction-local lock and statement timeouts; returns what to restore (PostgreSQL only)."""
    if not _postgresql(connection):
        return None
    saved = {name: connection.execute(sa.text('SELECT current_setting(:name)'), {'name': name}).scalar()
             for name in ('lock_timeout', 'statement_timeout')}
    connection.execute(sa.text("SELECT set_config('lock_timeout', :value, true)"), {'value': LOCK_TIMEOUT})
    connection.execute(sa.text("SELECT set_config('statement_timeout', :value, true)"), {'value': STATEMENT_TIMEOUT})
    return saved


def _restore_timeouts(connection, saved):
    for name, value in (saved or {}).items():
        connection.execute(sa.text('SELECT set_config(:name, :value, true)'), {'name': name, 'value': value})


def _lock_legacy(connection):
    if _postgresql(connection):
        for table in LEGACY_TABLES:
            connection.execute(sa.text(f'LOCK TABLE {table} IN SHARE MODE'))


def _has_legacy_rows(connection):
    return connection.execute(sa.select(sa.literal(1)).select_from(legacy_reviews).limit(1)).first() is not None


def _legacy_workspaces(connection):
    return list(connection.execute(sa.select(legacy_reviews.c.workspace_id).distinct()
                                   .order_by(legacy_reviews.c.workspace_id)).scalars())


def _legacy_cell_count(connection, workspace_id):
    return connection.execute(
        sa.select(sa.func.count()).select_from(legacy_cells.join(legacy_reviews, legacy_reviews.c.id == legacy_cells.c.review_id))
        .where(legacy_reviews.c.workspace_id == workspace_id)).scalar()


def _read_legacy(connection, workspace_id):
    rows = [SimpleNamespace(**row) for row in connection.execute(
        sa.select(legacy_reviews).where(legacy_reviews.c.workspace_id == workspace_id)).mappings()]
    cells = [SimpleNamespace(**row) for row in connection.execute(
        sa.select(legacy_cells).select_from(legacy_cells.join(legacy_reviews, legacy_reviews.c.id == legacy_cells.c.review_id))
        .where(legacy_reviews.c.workspace_id == workspace_id)).mappings()]
    return rows, cells


def _read_catalog(connection, workspace_id):
    return connection.execute(sa.select(group_configs.c.payload).where(group_configs.c.workspace_id == workspace_id)).scalar()


def _read_group_rows(connection, workspace_id, groups):
    schema_rows = [tuple(row) for row in connection.execute(sa.select(
        group_schemas.c.id, group_schemas.c.group_id, group_schemas.c.schema_revision, group_schemas.c.columns).where(
        group_schemas.c.workspace_id == workspace_id, group_schemas.c.group_id.in_(groups)))]
    view_rows = [tuple(row) for row in connection.execute(sa.select(group_views.c.group_id, group_views.c.sprint_id).where(
        group_views.c.workspace_id == workspace_id, group_views.c.group_id.in_(groups)))]
    return schema_rows, view_rows


def _locked_schema(connection, workspace_id, group):
    """The lock every app save takes first: insert-do-nothing on (workspace, group), then the row FOR UPDATE."""
    insert = postgresql.insert if connection.dialect.name == 'postgresql' else sqlite.insert
    connection.execute(insert(group_schemas).values(
        id=str(uuid.uuid4()), workspace_id=workspace_id, group_id=group, schema_revision=0, columns=[],
    ).on_conflict_do_nothing(index_elements=['workspace_id', 'group_id']))
    return connection.execute(sa.select(group_schemas.c.id, group_schemas.c.schema_revision, group_schemas.c.columns).where(
        group_schemas.c.workspace_id == workspace_id, group_schemas.c.group_id == group).with_for_update()).one()


def _insert(connection, table, rows):
    for start in range(0, len(rows), INSERT_CHUNK_ROWS):
        connection.execute(sa.insert(table), rows[start:start + INSERT_CHUNK_ROWS])


def _write_group(connection, workspace_id, group, plan):
    """Lock the group's schema row, re-check that it is still empty, and write the plan; False when it now holds rows."""
    row = _locked_schema(connection, workspace_id, group)
    views = connection.execute(sa.select(sa.func.count()).select_from(group_views).where(
        group_views.c.workspace_id == workspace_id, group_views.c.group_id == group)).scalar()
    if row.schema_revision or row.columns or views:
        return False
    if plan['added'] or plan['revision'] != row.schema_revision:
        updated = connection.execute(sa.update(group_schemas).where(
            group_schemas.c.id == row.id, group_schemas.c.schema_revision == row.schema_revision).values(
            columns=deepcopy(plan['columns']), schema_revision=plan['revision']))
        if updated.rowcount != 1:
            raise ReviewAdoptionError('review adoption failed: group schema row changed under its lock')
    _insert(connection, group_cells, [{
        'id': str(uuid.uuid4()), 'schema_id': row.id, 'issue_id': issue_id, 'row_kind': kind, 'column_id': column_id,
        'value': value, 'revision': 1} for issue_id, kind, column_id, value in plan['cells']])
    _insert(connection, group_views, [{
        'id': str(uuid.uuid4()), 'workspace_id': workspace_id, 'group_id': group, 'sprint_id': sprint,
        'sprint_order': sprint_order(sprint), 'layouts': deepcopy(layouts), 'view_revision': 1}
        for sprint, layouts in plan['views']])
    return True


def _groups_config(payload):
    try:
        config = dict(payload or {})
    except (TypeError, ValueError, AttributeError):
        raise ValueError('group catalog is malformed') from None
    config.setdefault('groups', [])
    return config


def _reason(error):
    # Planner messages are counts and ids; anything else is reported by type only.
    return str(error)[:160] if type(error) is ValueError else type(error).__name__


def _skip(summary, workspace_id, reason):
    summary['skipped'][workspace_id] = reason
    LOG.warning('review adoption: workspace %s skipped: %s', workspace_id, reason)


def _adopt_workspace(connection, workspace_id, remaining, summary):
    """Plan and adopt one workspace; returns the rows it inserted."""
    cells = _guarded(_legacy_cell_count, connection, workspace_id)
    if cells > remaining:
        _skip(summary, workspace_id, f'{cells} legacy cells exceed the remaining run budget of {remaining} rows')
        return 0
    rows, legacy = _guarded(_read_legacy, connection, workspace_id)
    payload = _guarded(_read_catalog, connection, workspace_id)
    try:
        reviews, _skipped_empty = canonical_legacy(rows, legacy, RULES)
        if not reviews:
            return 0
        groups = group_ids(_groups_config(payload), RULES)
        if not groups:
            _skip(summary, workspace_id, 'legacy review rows exist but no Department group is configured')
            return 0
        schema_rows, view_rows = _guarded(_read_group_rows, connection, workspace_id, groups)
        state = group_state(groups, schema_rows, [], view_rows)
        normalized = normalize(reviews)
        fresh = [group for group in groups if not state[group]['exists']]
        plans = {group: resolve_group(normalized, state[group], RULES) for group in fresh}
    except PLANNER_ERRORS as error:
        _skip(summary, workspace_id, _reason(error))
        return 0
    holding = [group for group in groups if group not in fresh]
    for group in holding:
        LOG.warning('review adoption: workspace %s group %s holds review rows; left for the script (--merge)',
                    workspace_id, group)
    if holding:
        summary['groups_with_rows'][workspace_id] = holding
    writing = [group for group in fresh if not plans[group]['empty']]
    size = sum(len(plans[g]['added']) + len(plans[g]['cells']) + len(plans[g]['views']) for g in writing)
    if size > remaining:
        _skip(summary, workspace_id, f'the plan inserts {size} rows, above the remaining run budget of {remaining} rows')
        return 0
    adopted = []
    for group in sorted(writing):
        if _guarded(_write_group, connection, workspace_id, group, plans[group]):
            adopted.append(group)
        else:
            summary['groups_with_rows'].setdefault(workspace_id, []).append(group)
            LOG.warning('review adoption: workspace %s group %s gained review rows meanwhile; left for the script',
                        workspace_id, group)
    if not adopted:
        return 0
    written = sum(len(plans[g]['added']) + len(plans[g]['cells']) + len(plans[g]['views']) for g in adopted)
    summary['adopted'][workspace_id] = adopted
    LOG.warning('review adoption: workspace %s adopted groups %s, inserted %d rows, legacy %s; %s', workspace_id,
                ' '.join(adopted), written, fingerprint({'workspaceId': workspace_id, 'reviews': reviews}),
                ' | '.join(plans[adopted[0]]['report']))
    return written


def adopt_all(connection, budget=RUN_BUDGET):
    """Adopt every workspace's legacy review data into its empty groups on `connection`; returns a summary."""
    summary = {'legacy_workspaces': 0, 'adopted': {}, 'skipped': {}, 'groups_with_rows': {}, 'rows': 0}
    _guarded(_require_tables, connection)
    if not _guarded(_has_legacy_rows, connection):
        return summary
    saved = _guarded(_set_timeouts, connection)
    _guarded(_lock_legacy, connection)
    workspace_ids = _guarded(_legacy_workspaces, connection)
    summary['legacy_workspaces'] = len(workspace_ids)
    remaining = budget
    for workspace_id in workspace_ids:
        written = _adopt_workspace(connection, workspace_id, remaining, summary)
        remaining -= written
        summary['rows'] += written
    _guarded(_restore_timeouts, connection, saved)
    return summary


def _enabled(environ):
    value = environ.get(KILL_SWITCH)
    if value is None:
        return True
    text = value.strip().lower()
    if text in ('true', 'false'):
        return text == 'true'
    raise ValueError(f'{KILL_SWITCH} must be true or false, not {value!r}')


def _count_legacy_workspaces(connection):
    if not sa.inspect(connection).has_table('workspace_sprint_reviews'):
        return 0
    return len(_legacy_workspaces(connection))


def upgrade():
    context = op.get_context()
    if context.as_sql:
        context.impl.static_output(NOTE)
        return
    connection = op.get_bind()
    if not _enabled(os.environ):
        count = _guarded(_count_legacy_workspaces, connection)
        LOG.warning('review adoption disabled by %s=false: %d workspace(s) hold legacy review rows; run '
                    'scripts/adopt_legacy_sprint_reviews.py to adopt them', KILL_SWITCH, count)
        return
    summary = adopt_all(connection)
    if summary['legacy_workspaces']:
        LOG.warning('review adoption: %d workspace(s) hold legacy review rows; adopted %d, skipped %d, inserted %d rows',
                    summary['legacy_workspaces'], len(summary['adopted']), len(summary['skipped']), summary['rows'])


def downgrade():
    """No-op: adopted rows are additive and cannot be listed afterwards; the pre-release backup is the rollback."""
