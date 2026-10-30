"""Shared per-Team, per-Sprint assignee capacity documents for Planning (#323).

One document belongs to workspace + Sprint + Team. A Sprint without a document reads the
nearest earlier document of the same Team (whole-document inheritance, reads never write).
The first write materialises the inherited people and Capacity into the Sprint's own
document under a row lock, then merges the changes field by field (last write wins).
"""
from copy import deepcopy
from decimal import Decimal
import json
import re
import unicodedata
import uuid

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import DBAPIError

from backend.db import engine as db_engine, models
from backend.services.sprint_review import (
    ReviewError, group_identity, require_review_context, sprint_identity, sprint_order)

MAX_ROWS = 100
MAX_CHANGES = 50
MAX_DOCUMENTS_PER_WORKSPACE = 2000
MAX_NUMBER = Decimal('10000')
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 256 * 1024
# Headroom for what the route adds to a saved document (`capabilities`), so a stored document always reads back.
RESPONSE_RESERVE_BYTES = 1024
LOCK_TIMEOUT = '3s'
CHANGE_KEYS = ('assigneeKey', 'displayName', 'capacity', 'vacations', 'notes', 'removed')
FIELD_KEYS = CHANGE_KEYS[1:]


def _has_control(value):
    return any(unicodedata.category(ch) == 'Cc' for ch in value)


def team_identity(value):
    """Shape and length only; the Team is not verified against Jira."""
    return group_identity(value)


def _assignee_key(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or value != value.strip() or _has_control(value):
        raise ReviewError()
    return value


def _display_name(value):
    if not isinstance(value, str) or len(value) > 200 or _has_control(value):
        raise ReviewError()
    return value


def _number(value):
    """Story Points as a JSON string: 0 to 10000, at most two decimals; stored trimmed ('10.25', '5')."""
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 16 or re.fullmatch(r'\d+(?:\.\d{1,2})?', value) is None:
        raise ReviewError()
    number = Decimal(value)
    if number > MAX_NUMBER:
        raise ReviewError()
    text_value = format(number, 'f')
    return text_value.rstrip('0').rstrip('.') if '.' in text_value else text_value


def _note(value):
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 500 or _has_control(value):
        raise ReviewError()
    return value


def validate_changes(changes):
    """Stateless shape checks, run before any lock or write."""
    if not isinstance(changes, list) or len(changes) > MAX_CHANGES:
        raise ReviewError()
    seen, result = set(), []
    for change in changes:
        if not isinstance(change, dict) or set(change) - set(CHANGE_KEYS) or 'assigneeKey' not in change:
            raise ReviewError()
        key = _assignee_key(change['assigneeKey'])
        if key in seen:
            raise ReviewError()
        seen.add(key)
        clean = {'assigneeKey': key}
        if 'displayName' in change:
            clean['displayName'] = _display_name(change['displayName'])
        for field in ('capacity', 'vacations'):
            if field in change:
                clean[field] = _number(change[field])
        if 'notes' in change:
            clean['notes'] = _note(change['notes'])
        if 'removed' in change:
            if not isinstance(change['removed'], bool):
                raise ReviewError()
            clean['removed'] = change['removed']
        result.append(clean)
    return result


def _new_row(key):
    return {'assigneeKey': key, 'displayName': '', 'capacity': None, 'vacations': None, 'notes': None, 'removed': False}


def _inherit(rows):
    """What a new Sprint takes from its source: non-removed people and Capacity only."""
    return [{**_new_row(row['assigneeKey']), 'displayName': row.get('displayName', ''), 'capacity': row.get('capacity')}
            for row in rows if not row.get('removed')]


def merge_changes(rows, changes):
    """Per-field last write wins: an absent field is unchanged, null clears. Returns a new list."""
    result = deepcopy(rows)
    index = {row['assigneeKey']: row for row in result}
    for change in changes:
        row = index.get(change['assigneeKey'])
        if row is None:
            if set(change) == {'assigneeKey'}:
                continue
            row = _new_row(change['assigneeKey'])
            result.append(row)
            index[row['assigneeKey']] = row
        for field in FIELD_KEYS:
            if field in change:
                row[field] = change[field]
    if len(result) > MAX_ROWS:
        raise ReviewError('assignee_capacity_row_limit')
    return result


def _scope(workspace_id, team_id):
    return (models.PlanningTeamSprintCapacity.workspace_id == workspace_id,
            models.PlanningTeamSprintCapacity.team_id == team_id)


def _nearest(session, workspace_id, sprint_id, team_id):
    """One <= lookup: the Sprint's own document, else the nearest earlier one, else none."""
    return session.scalars(select(models.PlanningTeamSprintCapacity).where(
        *_scope(workspace_id, team_id),
        models.PlanningTeamSprintCapacity.sprint_order <= sprint_order(sprint_id),
    ).order_by(models.PlanningTeamSprintCapacity.sprint_order.desc()).limit(1)).first()


def _document(sprint_id, team_id, row):
    """Serialise a lookup result; an earlier Sprint's document comes back as `inherited`."""
    if row is not None and row.sprint_id == sprint_id:
        return {'teamId': team_id, 'sprintId': sprint_id, 'revision': row.revision, 'rows': deepcopy(row.rows), 'inherited': None}
    inherited = None if row is None else {'fromSprintId': row.sprint_id, 'rows': _inherit(row.rows)}
    return {'teamId': team_id, 'sprintId': sprint_id, 'revision': 0, 'rows': [], 'inherited': inherited}


def get_document(context, sprint_id, team_id, database_url=None):
    require_review_context(context)
    sprint_identity(sprint_id)
    team_identity(team_id)
    with db_engine.session_scope(database_url) as session:
        return _document(sprint_id, team_id, _nearest(session, context.workspace_id, sprint_id, team_id))


def _require_readable(document):
    """Write-time size guard: a document whose response would exceed the read limit is never stored."""
    encoded = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(encoded) + RESPONSE_RESERVE_BYTES > MAX_RESPONSE_BYTES:
        raise ReviewError('review_response_limit', 413)


def _unavailable(error):
    code = getattr(getattr(error, 'orig', None), 'sqlstate', None)
    return code in {'55P03', '57014'}


def apply_changes(context, sprint_id, team_id, changes, database_url=None):
    require_review_context(context)
    sprint_identity(sprint_id)
    team_identity(team_id)
    changes = validate_changes(changes)
    try:
        with db_engine.session_scope(database_url) as session:
            return _apply(session, context, sprint_id, team_id, changes)
    except DBAPIError as error:
        if _unavailable(error):
            raise ReviewError('assignee_capacity_busy', 503) from None
        raise


def _apply(session, context, sprint_id, team_id, changes):
    workspace_id = context.workspace_id
    # An empty or no-op request creates no document and takes no lock.
    seen = _nearest(session, workspace_id, sprint_id, team_id)
    own = seen is not None and seen.sprint_id == sprint_id
    base = seen.rows if own else _inherit(seen.rows) if seen is not None else []
    if not changes or merge_changes(base, changes) == base:
        return _document(sprint_id, team_id, seen)
    dialect = session.bind.dialect.name
    insert = postgres_insert if dialect == 'postgresql' else sqlite_insert if dialect == 'sqlite' else None
    if insert is None:
        raise ReviewError('review_storage_unavailable', 503)
    if dialect == 'postgresql':
        session.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
    if not own and session.scalar(select(func.count()).select_from(models.PlanningTeamSprintCapacity).where(
            models.PlanningTeamSprintCapacity.workspace_id == workspace_id)) >= MAX_DOCUMENTS_PER_WORKSPACE:
        raise ReviewError('assignee_capacity_document_limit')
    inserted = session.execute(insert(models.PlanningTeamSprintCapacity).values(
        id=str(uuid.uuid4()), workspace_id=workspace_id, sprint_id=sprint_id, sprint_order=sprint_order(sprint_id),
        team_id=team_id, rows=[], revision=1, created_at=models._utcnow(), updated_at=models._utcnow(),
    ).on_conflict_do_nothing(index_elements=['workspace_id', 'sprint_id', 'team_id'])).rowcount == 1
    row = session.scalar(select(models.PlanningTeamSprintCapacity).where(
        *_scope(workspace_id, team_id), models.PlanningTeamSprintCapacity.sprint_id == sprint_id).with_for_update())
    if inserted:
        # First writer: the source is read again under the lock, so a concurrent first write cannot slip between.
        source = session.scalars(select(models.PlanningTeamSprintCapacity).where(
            *_scope(workspace_id, team_id), models.PlanningTeamSprintCapacity.sprint_order < sprint_order(sprint_id),
        ).order_by(models.PlanningTeamSprintCapacity.sprint_order.desc()).limit(1)).first()
        current = _inherit(source.rows) if source is not None else []
    else:
        current = deepcopy(row.rows)
    merged = merge_changes(current, changes)
    if not inserted:
        if merged == current:
            return _document(sprint_id, team_id, row)
        row.revision += 1
    _require_readable({'teamId': team_id, 'sprintId': sprint_id, 'revision': row.revision, 'rows': merged, 'inherited': None})
    row.rows = merged
    session.flush()
    return _document(sprint_id, team_id, row)
