#!/usr/bin/env python3
"""Adopt legacy per-Sprint review tables into every configured Department group (#267).

Dry run by default. --apply requires --expected-sha256 with the digest the dry run
printed, refuses before any write when group review rows already exist for the
workspace, and writes every group in one transaction. Legacy rows are never modified.
Output carries counts and column, Sprint and group ids only.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
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
from backend.services import shared_group_config, sprint_review  # noqa: E402

RULE_VERSION = 'adopt-legacy-sprint-reviews/1'
LOCK_TIMEOUT = '5s'
STATEMENT_TIMEOUT = '60s'
INSERT_CHUNK_ROWS = 100
GROUP_TABLES = ('workspace_group_review_schemas', 'group_review_cells', 'group_sprint_review_views')
LEGACY_TABLES = ('workspace_sprint_reviews', 'sprint_review_cells')
REQUIRED_TABLES = ('workspaces', 'workspace_group_configs') + LEGACY_TABLES + GROUP_TABLES
KINDS = ('epic', 'story')


class AdoptionLockTimeout(Exception):
    """A table lock was not granted within LOCK_TIMEOUT."""


def _fingerprint(payload):
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


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


def _before_write(session):
    """Seam between the emptiness check and the inserts; tests use it to stage races."""


def _preflight(session):
    present = set(inspect(session.connection()).get_table_names())
    missing = [name for name in REQUIRED_TABLES if name not in present]
    if missing:
        raise ValueError(f"required tables missing: {', '.join(missing)}")


def _numeric(value):
    try:
        sprint_review.sprint_identity(value)
        return True
    except sprint_review.ReviewError:
        return False


def _legacy(session, workspace_id):
    """Legacy reviews with content, ordered by numeric Sprint id then id, in canonical form."""
    rows = session.scalars(select(models.WorkspaceSprintReview).where(
        models.WorkspaceSprintReview.workspace_id == workspace_id)).all()
    bad = sum(not _numeric(row.sprint_id) for row in rows)
    if bad:
        raise ValueError(f'{bad} legacy Sprint ids are not numeric')
    cells = {}
    for cell in session.scalars(select(models.SprintReviewCell).join(
            models.WorkspaceSprintReview, models.WorkspaceSprintReview.id == models.SprintReviewCell.review_id).where(
            models.WorkspaceSprintReview.workspace_id == workspace_id)).all():
        cells.setdefault(cell.review_id, []).append(cell)
    reviews, skipped = [], 0
    for row in sorted(rows, key=lambda r: (int(r.sprint_id), r.id)):
        own = sorted(cells.get(row.id, []), key=lambda c: (c.issue_id, c.row_kind, c.column_id))
        if not row.columns and not row.layouts and not own:
            skipped += 1
            continue
        reviews.append({'id': row.id, 'sprintId': row.sprint_id, 'schemaRevision': row.schema_revision,
                        'columns': deepcopy(row.columns), 'layouts': deepcopy(row.layouts),
                        'cells': [[row.sprint_id, c.issue_id, c.row_kind, c.column_id, c.value, c.revision] for c in own]})
    return reviews, skipped


def _group_ids(session, workspace_id):
    try:
        config = shared_group_config.current_shared_groups_config(session, SimpleNamespace(workspace_id=workspace_id))
    except (AttributeError, TypeError, ValueError):
        raise ValueError('group catalog is malformed') from None
    groups = config.get('groups')
    if not groups:
        return []
    if not isinstance(groups, list) or any(not isinstance(group, dict) for group in groups):
        raise ValueError('group catalog is malformed')
    ids, bad = set(), 0
    for group in groups:
        try:
            ids.add(sprint_review.group_identity(group.get('id')))
        except sprint_review.ReviewError:
            bad += 1
    if bad:
        raise ValueError(f'{bad} configured group ids are malformed or longer than 128 characters')
    return sorted(ids)


def _well_formed(column):
    if not isinstance(column, dict) or column.get('rowKind') not in KINDS or column.get('type') not in ('number', 'text'):
        return False
    label, identity = column.get('label'), column.get('id')
    try:
        valid_id = isinstance(identity, str) and str(uuid.UUID(identity)) == identity
    except ValueError:
        valid_id = False
    return (valid_id and isinstance(label, str) and bool(label.strip())
            and column.get('archived', False) in (True, False)
            and column.get('aggregation', 'none') in ('sum', 'none'))


def _review_rules(call, *args):
    try:
        return call(*args)
    except sprint_review.ReviewError as error:
        raise ValueError(f'adopted data failed review validation ({error.code})') from None


def _plan(reviews):
    """Apply the design's merge, cell and view rules; returns columns, cells, views and the report."""
    report = []
    members, id_keys, malformed = {}, {}, 0
    for review in reviews:
        if not isinstance(review['columns'], list) or not isinstance(review['layouts'], dict) \
                or set(review['layouts']) - set(KINDS):
            malformed += 1
            continue
        for position, column in enumerate(review['columns']):
            if not _well_formed(column):
                malformed += 1
                continue
            key = (column['rowKind'], column['label'].strip().casefold(), column['type'])
            members.setdefault(key, []).append({
                'id': column['id'], 'ref': (review['id'], column['id']), 'sprint': review['sprintId'],
                'rank': (int(review['sprintId']), position), 'archived': column.get('archived', False) is True,
                'label': column['label'].strip(), 'aggregation': column.get('aggregation', 'none')})
            id_keys.setdefault(column['id'], {}).setdefault(key, set()).add(review['sprintId'])
    if malformed:
        raise ValueError(f'{malformed} legacy reviews or columns are malformed')
    repeated = {identity: keys for identity, keys in id_keys.items() if len(keys) > 1}
    if repeated:
        sprints = sorted({s for keys in repeated.values() for found in keys.values() for s in found}, key=int)
        raise ValueError(f"{len(repeated)} legacy column ids repeat across Sprints under different columns "
                         f"(Sprints {', '.join(sprints)})")

    kind_of = {m['ref']: key[0] for key, group in members.items() for m in group}
    rank_of = {m['ref']: m['rank'] for group in members.values() for m in group}
    intent_refs, discarded_refs, candidates = set(), set(), []
    for key, group in members.items():
        latest = group[-1]  # members are appended in processing order
        if latest['archived']:
            intent_refs.update(m['ref'] for m in group)
            continue
        live = [m for m in group if not m['archived']]
        discarded_refs.update(m['ref'] for m in group if m['archived'])
        candidates.append({'kind': key[0], 'type': key[2], 'id': live[0]['id'], 'label': live[0]['label'],
                           'aggregation': latest['aggregation'] if key[2] == 'number' else 'none',
                           'members': live, 'archived': [m for m in group if m['archived']],
                           'first': live[0]['rank'], 'latest': latest['rank']})
    kept, excluded = [], []
    for kind in KINDS:
        ranked = sorted((c for c in candidates if c['kind'] == kind), key=lambda c: c['latest'], reverse=True)
        kept += ranked[:sprint_review.MAX_ACTIVE_COLUMNS]
        excluded += ranked[sprint_review.MAX_ACTIVE_COLUMNS:]
    kept.sort(key=lambda c: c['first'])
    remap = {m['ref']: c['id'] for c in kept for m in c['members']}
    cap_refs = {m['ref'] for c in excluded for m in c['members']}

    adds = [{'action': 'add', 'column': {'id': c['id'], 'rowKind': c['kind'], 'label': c['label'],
                                         'type': c['type'], 'aggregation': c['aggregation']}} for c in kept]
    _review_rules(sprint_review.validate_schema_changes, adds)
    columns = _review_rules(sprint_review.apply_schema, [], adds)

    winners, dropped = {}, {'conflict': 0, 'archived': 0, 'intent': 0, 'cap': 0, 'orphan': 0}
    for review in reviews:
        for _sprint, issue_id, kind, column_id, value, _revision in review['cells']:
            ref = (review['id'], column_id)
            if ref in remap and kind_of[ref] == kind:
                identity, rank = (issue_id, kind, remap[ref]), rank_of[ref]
                if identity in winners:
                    dropped['conflict'] += 1
                    if rank < winners[identity][0]:
                        continue
                winners[identity] = (rank, value)
            elif ref in discarded_refs:
                dropped['archived'] += 1
            elif ref in intent_refs:
                dropped['intent'] += 1
            elif ref in cap_refs:
                dropped['cap'] += 1
            else:
                dropped['orphan'] += 1
    cells = [(issue_id, kind, column_id, value) for (issue_id, kind, column_id), (_rank, value) in sorted(winners.items())]

    views, cross_kind = [], 0
    for review in reviews:
        changes = []
        for kind in KINDS:
            if kind not in review['layouts']:
                continue
            entry = review['layouts'][kind]
            if not isinstance(entry, dict) or any(not isinstance(entry.get(f, []), list) for f in ('order', 'hidden')):
                raise ValueError('1 legacy layouts are malformed')
            remapped = {}
            for field, extra in (('order', set()), ('hidden', {'key'})):
                out = []
                for identity in entry.get(field, []):
                    ref = (review['id'], identity)
                    if ref in kind_of:
                        if kind_of[ref] != kind:
                            cross_kind += 1
                            continue
                        target = remap.get(ref)
                    else:
                        target = identity if identity in sprint_review.REVIEW_LAYOUT_BUILTINS[kind] | extra else None
                    if target is not None and target not in out:
                        out.append(target)
                remapped[field] = out
            changes.append({'action': 'layout', 'rowKind': kind, **remapped})
        if changes:
            views.append((review['sprintId'], changes))
    if cross_kind:
        raise ValueError(f'{cross_kind} legacy layout ids are not of their layout row kind')
    limit = sprint_review.MAX_GROUP_VIEWS
    skipped_views = [sprint for sprint, _ in views[:-limit]] if len(views) > limit else []
    views = views[-limit:]
    written_views = []
    for sprint, changes in views:
        _review_rules(sprint_review.validate_schema_changes, changes)
        written_views.append((sprint, _review_rules(sprint_review.apply_layouts, {}, columns, changes)))

    count = lambda kind: sum(c['rowKind'] == kind for c in columns)  # noqa: E731
    report.append(f"columns adopted: epic {count('epic')}, story {count('story')}")
    for c in kept:
        if len(c['members']) + len(c['archived']) > 1:
            report.append(f"merged {c['id']}: " + ' '.join(f"{m['id']}@{m['sprint']}" for m in c['members'])
                          + ('; archived ' + ' '.join(f"{m['id']}@{m['sprint']}" for m in c['archived']) if c['archived'] else ''))
    intent_keys = sum(1 for group in members.values() if group[-1]['archived'])
    report.append(f"archive intent: keys {intent_keys}, cells dropped {dropped['intent']}")
    report.append(f"archived members discarded: {len(discarded_refs)}, cells dropped {dropped['archived']}")
    excluded_members = ' '.join(f"{m['id']}@{m['sprint']}" for c in excluded for m in c['members'])
    report.append(f"cap excluded: keys {len(excluded)}, cells dropped {dropped['cap']}; members {excluded_members or 'none'}")
    report.append(f"conflicting cell values dropped: {dropped['conflict']}")
    report.append(f"orphan cells dropped: {dropped['orphan']}")
    report.append(f"views: {len(written_views)} written per group, skipped by cap {len(skipped_views)}"
                  + (f" (Sprints {', '.join(skipped_views)})" if skipped_views else ''))
    rollups = sum(c['rowKind'] == 'story' and c['type'] == 'number' and c['aggregation'] == 'sum' for c in columns)
    report.append(f"derived: story sum rollups {rollups}, epic inherited {count('epic')}")
    return {'columns': columns, 'cells': cells, 'views': written_views, 'report': report}


def _build(session, workspace_id):
    reviews, skipped = _legacy(session, workspace_id)
    if not reviews:
        return None
    groups = _group_ids(session, workspace_id)
    if not groups:
        raise ValueError('legacy review rows exist but no Department group is configured; configure one first')
    digest = _fingerprint({'rule': RULE_VERSION, 'workspaceId': workspace_id, 'groups': groups, 'reviews': reviews})
    plan = _plan(reviews)
    legacy_cells = sum(len(review['cells']) for review in reviews)
    plan['report'].insert(0, f'legacy reviews {len(reviews)} (skipped empty {skipped}), legacy cells {legacy_cells}')
    plan['report'].insert(0, f"workspace {workspace_id} groups {len(groups)}: {' '.join(groups)}")
    for group in groups:
        plan['report'].append(f"group {group}: workspace_group_review_schemas=1 group_review_cells={len(plan['cells'])} "
                              f"group_sprint_review_views={len(plan['views'])}")
    plan.update(groups=groups, digest=digest)
    return plan


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
        status = 'nothing to adopt' if not legacy else 'adopted' if counts['schemas'] or counts['views'] else 'pending'
        print(f"workspace {identity} legacy_reviews={legacy} group_schemas={counts['schemas']} "
              f"group_views={counts['views']} status={status}")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace-id')
    parser.add_argument('--list', action='store_true', help='per workspace: legacy and group review rows')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-sha256')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if not args.list and not args.workspace_id:
        raise ValueError('--workspace-id is required')
    if args.apply and not args.expected_sha256:
        raise ValueError('--expected-sha256 is required with --apply')
    if args.expected_sha256 and not args.expected_sha256.startswith('sha256:'):
        raise ValueError('--expected-sha256 must carry the sha256: prefix')
    database_url = db_engine.resolve_database_url(required=True)
    try:
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
                raise ValueError('group review rows already exist for this workspace; no database changes applied')
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
