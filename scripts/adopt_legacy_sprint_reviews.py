#!/usr/bin/env python3
"""Adopt legacy per-Sprint review tables into every configured Department group (#267).

Dry run by default. --apply requires --expected-sha256 with the digest the dry run
printed, refuses before any write when group review rows already exist for the
workspace, and writes every group in one transaction. Legacy rows are never modified.
Output carries counts and column, Sprint and group ids only.

--merge adopts into groups that already hold rows. It never overwrites, clears, renames or resurrects anything in a
group: legacy columns claim a group column by id, then by kind, label and type; live cells and views win; a column the
group archived stays archived. The dry run plans read-only; --apply (with its digest) then locks each written group's schema
row, the lock every app save takes first, re-reads everything, re-plans, and writes only if the re-plan's digest equals
the reviewed one. On PostgreSQL it can run while the app serves (SQLite has no row locks, so only the digest re-check
guards it). A second run is a no-op, except that it adds a column again after a label-matched column was renamed in the
group and a Sprint view again after the view row was purged.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
import uuid

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from sqlalchemy import func, insert, inspect, select, text  # noqa: E402
from sqlalchemy.exc import DBAPIError  # noqa: E402

from backend.db import engine as db_engine  # noqa: E402
from backend.db import models  # noqa: E402
from backend.services import review_adoption, shared_group_config, sprint_review  # noqa: E402

RULE_VERSION = 'adopt-legacy-sprint-reviews/1'
LOCK_TIMEOUT = '5s'
STATEMENT_TIMEOUT = '60s'
INSERT_CHUNK_ROWS = 100
READ_CHUNK_ISSUES = review_adoption.READ_CHUNK_ISSUES
MAX_TOTAL_COLUMNS = review_adoption.MAX_TOTAL_COLUMNS
MERGE_RULE_VERSION = 'adopt-legacy-sprint-reviews/2-merge'
MERGE_MAX_INSERT_ROWS = 100_000  # per run, columns plus cells plus views over all groups; a larger plan aborts before any lock
GROUP_TABLES = ('workspace_group_review_schemas', 'group_review_cells', 'group_sprint_review_views')
LEGACY_TABLES = ('workspace_sprint_reviews', 'sprint_review_cells')
REQUIRED_TABLES = ('workspaces', 'workspace_group_configs') + LEGACY_TABLES + GROUP_TABLES
KINDS = review_adoption.KINDS


class AdoptionLockTimeout(Exception):
    """A table lock was not granted within LOCK_TIMEOUT."""


_fingerprint = review_adoption.fingerprint


def _postgresql(session):
    return session.bind.dialect.name == 'postgresql'


def _set_timeouts(session):
    if not _postgresql(session):
        return
    session.execute(text("SELECT set_config('lock_timeout', :value, true)"), {'value': LOCK_TIMEOUT})
    session.execute(text("SELECT set_config('statement_timeout', :value, true)"), {'value': STATEMENT_TIMEOUT})


def _lock_tables(session):
    """Group schema table first (every app writer enters through it), then the other new tables, then legacy."""
    if not _postgresql(session):
        return
    try:
        for table in GROUP_TABLES:
            session.execute(text(f'LOCK TABLE {table} IN EXCLUSIVE MODE'))
        for table in LEGACY_TABLES:
            session.execute(text(f'LOCK TABLE {table} IN SHARE MODE'))
    except DBAPIError as error:
        if getattr(getattr(error, 'orig', None), 'sqlstate', None) == '55P03':
            raise AdoptionLockTimeout() from None
        raise


def _lock_merge(session, workspace_id, groups):
    """Legacy tables in share mode, then each group's schema row through the lock every app writer takes first.

    Returns the locked schema rows by group. The merge takes no table-level lock on the group tables."""
    rows = {}
    try:
        if _postgresql(session):
            for table in LEGACY_TABLES:
                session.execute(text(f'LOCK TABLE {table} IN SHARE MODE'))
        for group in sorted(groups):
            rows[group] = sprint_review._locked_schema(session, SimpleNamespace(workspace_id=workspace_id), group)
    except DBAPIError as error:
        if getattr(getattr(error, 'orig', None), 'sqlstate', None) == '55P03':
            raise AdoptionLockTimeout() from None
        raise
    return rows


def _before_lock():
    """Seam between the read-only plan and the write transaction's locks; tests stage live writes here."""


def _before_write(session):
    """Seam between the emptiness check and the inserts; tests use it to stage races."""


def _preflight(session):
    present = set(inspect(session.connection()).get_table_names())
    missing = [name for name in REQUIRED_TABLES if name not in present]
    if missing:
        raise ValueError(f"required tables missing: {', '.join(missing)}")




def _legacy(session, workspace_id):
    """Legacy reviews with content, ordered by numeric Sprint id then id, in canonical form."""
    rows = session.scalars(select(models.WorkspaceSprintReview).where(
        models.WorkspaceSprintReview.workspace_id == workspace_id)).all()
    cells = session.scalars(select(models.SprintReviewCell).join(
        models.WorkspaceSprintReview, models.WorkspaceSprintReview.id == models.SprintReviewCell.review_id).where(
        models.WorkspaceSprintReview.workspace_id == workspace_id)).all()
    return review_adoption.canonical_legacy(rows, cells, sprint_review)


def _group_ids(session, workspace_id):
    try:
        config = shared_group_config.current_shared_groups_config(session, SimpleNamespace(workspace_id=workspace_id))
    except (AttributeError, TypeError, ValueError):
        raise ValueError('group catalog is malformed') from None
    return review_adoption.group_ids(config, sprint_review)


_normalize = review_adoption.normalize
_match_group_columns = review_adoption.match_group_columns
_well_formed = review_adoption.well_formed
_well_formed_group = review_adoption.well_formed_group


def _resolve_group(normalized, state=None):
    """The planner with the live review rules: `sprint_review` is passed as the module, so a patch on it applies."""
    return review_adoption.resolve_group(normalized, state, sprint_review)


def _read_group_state(session, workspace_id, groups, issue_ids):
    """Per group: schema columns and revision, cell identities on the given issues, and the Sprint ids with a view.

    Plain values only, never ORM entities: the merge re-reads after taking its locks, and an identity-mapped instance
    would keep what was read before them."""
    schema_rows = [tuple(row) for row in session.execute(select(
        models.WorkspaceGroupReviewSchema.id, models.WorkspaceGroupReviewSchema.group_id,
        models.WorkspaceGroupReviewSchema.schema_revision, models.WorkspaceGroupReviewSchema.columns).where(
        models.WorkspaceGroupReviewSchema.workspace_id == workspace_id,
        models.WorkspaceGroupReviewSchema.group_id.in_(groups))).all()]
    review_adoption.check_schema_rows(schema_rows)
    schema_ids = [row[0] for row in schema_rows]
    ids = sorted(issue_ids)
    cell_rows = []
    for start in range(0, len(ids) if schema_ids else 0, READ_CHUNK_ISSUES):
        cell_rows += [tuple(row) for row in session.execute(select(
            models.GroupReviewCell.schema_id, models.GroupReviewCell.issue_id, models.GroupReviewCell.row_kind,
            models.GroupReviewCell.column_id).where(
            models.GroupReviewCell.schema_id.in_(schema_ids),
            models.GroupReviewCell.issue_id.in_(ids[start:start + READ_CHUNK_ISSUES]))).all()]
    view_rows = [tuple(row) for row in session.execute(select(
        models.GroupSprintReviewView.group_id, models.GroupSprintReviewView.sprint_id).where(
        models.GroupSprintReviewView.workspace_id == workspace_id,
        models.GroupSprintReviewView.group_id.in_(groups))).all()]
    return review_adoption.group_state(groups, schema_rows, cell_rows, view_rows)




def _build(session, workspace_id):
    reviews, skipped = _legacy(session, workspace_id)
    if not reviews:
        return None
    groups = _group_ids(session, workspace_id)
    if not groups:
        raise ValueError('legacy review rows exist but no Department group is configured; configure one first')
    digest = _fingerprint({'rule': RULE_VERSION, 'workspaceId': workspace_id, 'groups': groups, 'reviews': reviews})
    plan = _resolve_group(_normalize(reviews))
    legacy_cells = sum(len(review['cells']) for review in reviews)
    plan['report'].insert(0, f'legacy reviews {len(reviews)} (skipped empty {skipped}), legacy cells {legacy_cells}')
    plan['report'].insert(0, f"workspace {workspace_id} groups {len(groups)}: {' '.join(groups)}")
    for group in groups:
        plan['report'].append(f"group {group}: workspace_group_review_schemas=1 group_review_cells={len(plan['cells'])} "
                              f"group_sprint_review_views={len(plan['views'])}")
    plan.update(groups=groups, digest=digest)
    return plan


def _build_merge(session, workspace_id, only_groups):
    """Plan the merge for every selected group against its current rows; None when there is no legacy data."""
    reviews, skipped = _legacy(session, workspace_id)
    if not reviews:
        return None
    configured = _group_ids(session, workspace_id)
    if not configured:
        raise ValueError('legacy review rows exist but no Department group is configured; configure one first')
    groups = configured
    if only_groups:
        unknown = sorted(set(only_groups) - set(configured))
        if unknown:
            raise ValueError(f"unknown group ids: {', '.join(unknown)}")
        groups = sorted(set(only_groups))
    normalized = _normalize(reviews)
    state = _read_group_state(session, workspace_id, groups, {cell[1] for review in reviews for cell in review['cells']})
    plans = {group: _resolve_group(normalized, state[group]) for group in groups}
    size = sum(len(result['added']) + len(result['cells']) + len(result['views']) for result in plans.values())
    if size > MERGE_MAX_INSERT_ROWS:
        raise ValueError(f'the plan would insert {size} rows, above the {MERGE_MAX_INSERT_ROWS} ceiling; '
                         'merge the groups separately with --group; no database changes applied')
    # What gets written is what the digest covers. A group with nothing to insert contributes only that fact, so an
    # edit there cannot invalidate it; for a written group `revision` carries the base revision it was planned from.
    digest = _fingerprint({
        'rule': MERGE_RULE_VERSION, 'workspaceId': workspace_id, 'groups': groups, 'reviews': reviews,
        'plans': {group: {'empty': True} if result['empty'] else {
            'matched': result['matched'], 'added': result['added'], 'cells': result['cells'],
            'views': result['views'], 'revision': result['revision']} for group, result in plans.items()}})
    legacy_cells = sum(len(review['cells']) for review in reviews)
    report = [f"workspace {workspace_id} groups {len(groups)}: {' '.join(groups)}",
              f'legacy reviews {len(reviews)} (skipped empty {skipped}), legacy cells {legacy_cells}']
    for group in groups:
        report += [f'group {group}: {line}' for line in plans[group]['report']]
    writing = sum(not result['empty'] for result in plans.values())
    report.append(f'merge plan: {writing} of {len(groups)} groups would write')
    return {'groups': groups, 'plans': plans, 'digest': digest, 'report': report,
            'empty': all(result['empty'] for result in plans.values())}


def _group_row_counts(session, workspace_id):
    schema_ids = select(models.WorkspaceGroupReviewSchema.id).where(
        models.WorkspaceGroupReviewSchema.workspace_id == workspace_id)
    return {
        'schemas': session.scalar(select(func.count()).select_from(schema_ids.subquery())),
        'cells': session.scalar(select(func.count()).select_from(models.GroupReviewCell).where(
            models.GroupReviewCell.schema_id.in_(schema_ids))),
        'views': session.scalar(select(func.count()).select_from(models.GroupSprintReviewView).where(
            models.GroupSprintReviewView.workspace_id == workspace_id)),
    }


def _insert(session, model, rows):
    """Plain multi-row INSERTs (never insert-do-nothing), chunked under parameter limits."""
    for start in range(0, len(rows), INSERT_CHUNK_ROWS):
        session.execute(insert(model).values(rows[start:start + INSERT_CHUNK_ROWS]))


def _write(session, workspace_id, plan):
    for group in plan['groups']:
        schema_id = str(uuid.uuid4())
        _insert(session, models.WorkspaceGroupReviewSchema, [{
            'id': schema_id, 'workspace_id': workspace_id, 'group_id': group,
            'schema_revision': 1, 'columns': deepcopy(plan['columns'])}])
        _insert(session, models.GroupReviewCell, [{
            'id': str(uuid.uuid4()), 'schema_id': schema_id, 'issue_id': issue_id, 'row_kind': kind,
            'column_id': column_id, 'value': value, 'revision': 1} for issue_id, kind, column_id, value in plan['cells']])
        _insert(session, models.GroupSprintReviewView, [{
            'id': str(uuid.uuid4()), 'workspace_id': workspace_id, 'group_id': group, 'sprint_id': sprint,
            'sprint_order': sprint_review.sprint_order(sprint), 'layouts': deepcopy(layouts), 'view_revision': 1}
            for sprint, layouts in plan['views']])


def _write_merge(session, workspace_id, plan, rows):
    """Write each group whose plan has something to insert, into its locked schema row; returns how many."""
    written = 0
    for group in plan['groups']:
        result = plan['plans'][group]
        if result['empty']:
            continue
        row = rows[group]
        if result['added'] or result['revision'] != row.schema_revision:
            row.columns = deepcopy(result['columns'])
            row.schema_revision = result['revision']
        _insert(session, models.GroupReviewCell, [{
            'id': str(uuid.uuid4()), 'schema_id': row.id, 'issue_id': issue_id, 'row_kind': kind,
            'column_id': column_id, 'value': value, 'revision': 1} for issue_id, kind, column_id, value in result['cells']])
        _insert(session, models.GroupSprintReviewView, [{
            'id': str(uuid.uuid4()), 'workspace_id': workspace_id, 'group_id': group, 'sprint_id': sprint,
            'sprint_order': sprint_review.sprint_order(sprint), 'layouts': deepcopy(layouts), 'view_revision': 1}
            for sprint, layouts in result['views']])
        written += 1
    return written


def _merge(args, database_url):
    """--merge: plan read-only, then lock, re-read and re-plan, and write only what the reviewed digest covers."""
    try:
        only = sorted({sprint_review.group_identity(group) for group in args.group or []})
    except sprint_review.ReviewError:
        raise ValueError('--group needs valid group ids') from None
    with db_engine.session_scope(database_url) as session:
        _set_timeouts(session)
        _preflight(session)
        plan = _build_merge(session, args.workspace_id, only)
    if plan is None:
        print('no legacy review data; nothing to adopt')
        return 0
    for line in plan['report']:
        print(line)
    print(plan['digest'])
    if not args.apply:
        print('dry-run only; no database changes applied')
        return 0
    if args.expected_sha256 != plan['digest']:
        raise ValueError('digest mismatch; no database changes applied')
    if plan['empty']:
        print('nothing to merge; no database changes applied')
        return 0
    _before_lock()
    with db_engine.session_scope(database_url) as session:
        _set_timeouts(session)
        rows = _lock_merge(session, args.workspace_id, [g for g in plan['groups'] if not plan['plans'][g]['empty']])
        # A new session: nothing from the read-only plan is reused, and all state below is read after every lock.
        again = _build_merge(session, args.workspace_id, only)
        if again is None or again['digest'] != args.expected_sha256:
            raise ValueError('digest mismatch; the data changed since the dry run; no database changes applied')
        _before_write(session)
        written = _write_merge(session, args.workspace_id, again, rows)
    print(f"applied: {written} groups written, {len(plan['groups']) - written} unchanged")
    return 0


def _merge_status(session, workspace_id):
    """needs-merge when a merge would still insert something, adopted when not, error when it cannot be planned."""
    try:
        plan = _build_merge(session, workspace_id, None)
    except (ValueError, KeyError, TypeError):  # a data-shape failure in one workspace must not stop the survey
        return 'error'
    return 'adopted' if plan is None or plan['empty'] else 'needs-merge'


def _list(session, workspace_id=None):
    query = select(models.Workspace.id).order_by(models.Workspace.id)
    if workspace_id:
        query = query.where(models.Workspace.id == workspace_id)
    for identity in session.scalars(query).all():
        rows = session.scalars(select(models.WorkspaceSprintReview).where(
            models.WorkspaceSprintReview.workspace_id == identity)).all()
        with_cells = set(session.scalars(select(models.SprintReviewCell.review_id).where(
            models.SprintReviewCell.review_id.in_([row.id for row in rows]))).all()) if rows else set()
        legacy = sum(1 for row in rows if row.columns or row.layouts or row.id in with_cells)
        counts = _group_row_counts(session, identity)
        status = ('nothing to adopt' if not legacy else _merge_status(session, identity) if counts['schemas'] or counts['views']
                  else 'pending')
        print(f"workspace {identity} legacy_reviews={legacy} group_schemas={counts['schemas']} "
              f"group_views={counts['views']} status={status}")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace-id')
    parser.add_argument('--list', action='store_true', help='per workspace: legacy and group review rows')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-sha256')
    parser.add_argument('--merge', action='store_true',
                        help='adopt into groups that already hold rows, without overwriting them')
    parser.add_argument('--group', action='append', help='with --merge, limit to this configured group id (repeatable)')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if not args.list and not args.workspace_id:
        raise ValueError('--workspace-id is required')
    if args.apply and not args.expected_sha256:
        raise ValueError('--expected-sha256 is required with --apply')
    if args.expected_sha256 and not args.expected_sha256.startswith('sha256:'):
        raise ValueError('--expected-sha256 must carry the sha256: prefix')
    if args.list and (args.merge or args.group):
        raise ValueError('--list does not take --merge or --group')
    if args.group and not args.merge:
        raise ValueError('--group requires --merge')
    database_url = db_engine.resolve_database_url(required=True)
    try:
        if args.merge and not args.list:
            return _merge(args, database_url)
        with db_engine.session_scope(database_url) as session:
            _set_timeouts(session)
            _preflight(session)
            if args.list:
                _list(session, args.workspace_id)
                return 0
            if args.apply:
                _lock_tables(session)
            # Recomputed inside the locked transaction, so --apply never acts on a stale dry run.
            plan = _build(session, args.workspace_id)
            if plan is None:
                print('no legacy review data; nothing to adopt')
                return 0
            for line in plan['report']:
                print(line)
            print(plan['digest'])
            if not args.apply:
                print('dry-run only; no database changes applied')
                return 0
            if args.expected_sha256 != plan['digest']:
                raise ValueError('digest mismatch; no database changes applied')
            if any(_group_row_counts(session, args.workspace_id).values()):
                raise ValueError('group review rows already exist for this workspace; re-run with --merge to adopt '
                                 'the legacy data without replacing them; no database changes applied')
            _before_write(session)
            _write(session, args.workspace_id, plan)
            print(f"applied: {len(plan['groups'])} groups")
    except AdoptionLockTimeout:
        print('lock timeout; no database changes applied', file=sys.stderr)
        return 2
    except DBAPIError as error:
        # Driver messages echo bound parameters; report only the error class or SQLSTATE.
        code = getattr(getattr(error, 'orig', None), 'sqlstate', None) or type(error).__name__
        raise ValueError(f'adoption aborted by the database ({code}); no database changes applied') from None
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
