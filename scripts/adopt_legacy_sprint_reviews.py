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
READ_CHUNK_ISSUES = 500
MAX_TOTAL_COLUMNS = 240  # mirrors the total column limit in sprint_review.apply_schema
MERGE_RULE_VERSION = 'adopt-legacy-sprint-reviews/2-merge'
MERGE_MAX_INSERT_ROWS = 100_000  # per run, columns plus cells plus views over all groups; a larger plan aborts before any lock
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


def _well_formed_group(column):
    """A group column as the app writes it: the legacy shape plus a boolean `archived` and an integer `order`."""
    return (_well_formed(column) and isinstance(column.get('archived'), bool)
            and isinstance(column.get('order'), int) and not isinstance(column.get('order'), bool))


def _read_group_state(session, workspace_id, groups, issue_ids):
    """Per group: schema columns and revision, cell identities on the given issues, and the Sprint ids with a view.

    Plain values only, never ORM entities: the merge re-reads after taking its locks, and an identity-mapped instance
    would keep what was read before them."""
    state = {group: {'exists': False, 'revision': 0, 'columns': [], 'cells': set(), 'view_sprints': []} for group in groups}
    schema_group, malformed = {}, 0
    for schema_id, group, revision, columns in session.execute(select(
            models.WorkspaceGroupReviewSchema.id, models.WorkspaceGroupReviewSchema.group_id,
            models.WorkspaceGroupReviewSchema.schema_revision, models.WorkspaceGroupReviewSchema.columns).where(
            models.WorkspaceGroupReviewSchema.workspace_id == workspace_id,
            models.WorkspaceGroupReviewSchema.group_id.in_(groups))).all():
        columns = deepcopy(columns) if isinstance(columns, list) else None
        malformed += 1 if columns is None else sum(not _well_formed_group(column) for column in columns)
        state[group].update(exists=True, revision=revision, columns=columns or [])
        schema_group[schema_id] = group
    if malformed:
        raise ValueError(f'{malformed} group columns are malformed')
    ids = sorted(issue_ids)
    for start in range(0, len(ids) if schema_group else 0, READ_CHUNK_ISSUES):
        for schema_id, issue_id, kind, column_id in session.execute(select(
                models.GroupReviewCell.schema_id, models.GroupReviewCell.issue_id, models.GroupReviewCell.row_kind,
                models.GroupReviewCell.column_id).where(
                models.GroupReviewCell.schema_id.in_(list(schema_group)),
                models.GroupReviewCell.issue_id.in_(ids[start:start + READ_CHUNK_ISSUES]))).all():
            state[schema_group[schema_id]]['cells'].add((issue_id, kind, column_id))
    for group, sprint in session.execute(select(models.GroupSprintReviewView.group_id, models.GroupSprintReviewView.sprint_id).where(
            models.GroupSprintReviewView.workspace_id == workspace_id,
            models.GroupSprintReviewView.group_id.in_(groups))).all():
        state[group]['view_sprints'].append(sprint)
    for entry in state.values():
        entry['view_sprints'].sort(key=int)
        # A row nothing has written to (revision 0, no columns, no views) counts as absent, so a run that fills it ends it at 1.
        entry['exists'] = entry['exists'] and bool(entry['revision'] or entry['columns'] or entry['view_sprints'])
    return state


def _review_rules(call, *args):
    try:
        return call(*args)
    except sprint_review.ReviewError as error:
        raise ValueError(f'adopted data failed review validation ({error.code})') from None


def _normalize(reviews):
    """Group the legacy columns by key and classify them (archive intent, archived members, cap candidates)."""
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
    return {'reviews': reviews, 'members': members, 'kind_of': kind_of, 'rank_of': rank_of,
            'intent_refs': intent_refs, 'discarded_refs': discarded_refs, 'candidates': candidates}


def _match_group_columns(candidates, group_columns):
    """Resolve each legacy key to at most one group column: by id first, then by label and type.

    A group column is claimed by one key at most, and a group-archived column keeps its archive. Returns the matched
    group column and, for each skipped (group-archived) key, the archived column's id, both by candidate index."""
    by_id = {column['id']: column for column in group_columns}
    position = {column['id']: index for index, column in enumerate(group_columns)}
    matched, skipped, claimed = {}, {}, set()
    ambiguous = mismatched = 0
    for index, candidate in enumerate(candidates):
        found = {by_id[member['id']]['id'] for member in candidate['members'] + candidate['archived'] if member['id'] in by_id}
        if len(found) > 1:
            ambiguous += 1
        elif found:
            column = by_id[found.pop()]
            if (column['rowKind'], column['type']) != (candidate['kind'], candidate['type']):
                mismatched += 1
            elif column.get('archived', False) is True:
                skipped[index] = column['id']
                claimed.add(column['id'])
            else:
                matched[index] = column
                claimed.add(column['id'])
    if ambiguous:
        raise ValueError(f'{ambiguous} legacy columns match more than one group column by id')
    if mismatched:
        raise ValueError(f'{mismatched} legacy column ids match a group column of another kind or type')
    for index, candidate in enumerate(candidates):
        if index in matched or index in skipped:
            continue
        label = candidate['label'].strip().casefold()
        same = [column for column in group_columns if column['id'] not in claimed
                and (column['rowKind'], column['type']) == (candidate['kind'], candidate['type'])
                and column['label'].strip().casefold() == label]
        live = [column for column in same if column.get('archived', False) is not True]
        if live:
            column = min(live, key=lambda c: (c.get('order', 0), position[c['id']]))
            matched[index] = column
            claimed.add(column['id'])
        elif same:
            skipped[index] = min(same, key=lambda c: (c.get('order', 0), position[c['id']]))['id']
    return matched, skipped


def _resolve_group(normalized, state=None):
    """Apply the design's merge, cap, cell and view rules; returns columns, cells, views and the report.

    `state` is one group's current columns, revision, cell identities and view Sprint ids (see _read_group_state);
    without it the group is empty, which is the fresh adoption path."""
    reviews, members, candidates = normalized['reviews'], normalized['members'], normalized['candidates']
    kind_of, rank_of = normalized['kind_of'], normalized['rank_of']
    intent_refs, discarded_refs = normalized['intent_refs'], normalized['discarded_refs']
    merge = state is not None
    state = state or {'exists': False, 'revision': 0, 'columns': [], 'cells': set(), 'view_sprints': []}
    group_columns = state['columns']
    matched, skipped = _match_group_columns(candidates, group_columns) if merge else ({}, {})
    report = []
    kept, excluded = [], []
    for kind in KINDS:
        active = sum(c['rowKind'] == kind and c.get('archived', False) is not True for c in group_columns)
        slots = max(0, sprint_review.MAX_ACTIVE_COLUMNS - active)
        ranked = sorted((c for i, c in enumerate(candidates) if c['kind'] == kind and i not in matched and i not in skipped),
                        key=lambda c: c['latest'], reverse=True)
        kept += ranked[:slots]
        excluded += ranked[slots:]
    room = max(0, MAX_TOTAL_COLUMNS - len(group_columns))
    if len(kept) > room:
        ranked = sorted(kept, key=lambda c: c['latest'], reverse=True)
        kept, excluded = ranked[:room], excluded + ranked[room:]
    kept.sort(key=lambda c: c['first'])
    remap = {m['ref']: c['id'] for c in kept for m in c['members']}
    remap.update({m['ref']: column['id'] for index, column in matched.items() for m in candidates[index]['members']})
    cap_refs = {m['ref'] for c in excluded for m in c['members']}
    skipped_refs = {m['ref'] for index in skipped for m in candidates[index]['members']}

    adds = [{'action': 'add', 'column': {'id': c['id'], 'rowKind': c['kind'], 'label': c['label'],
                                         'type': c['type'], 'aggregation': c['aggregation']}} for c in kept]
    _review_rules(sprint_review.validate_schema_changes, adds)
    columns = _review_rules(sprint_review.apply_schema, group_columns, adds)
    added = columns[len(group_columns):]

    winners, dropped = {}, {'conflict': 0, 'archived': 0, 'intent': 0, 'cap': 0, 'orphan': 0, 'group_archived': 0}
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
            elif ref in skipped_refs:
                dropped['group_archived'] += 1
            else:
                dropped['orphan'] += 1
    cells = [(issue_id, kind, column_id, value) for (issue_id, kind, column_id), (_rank, value) in sorted(winners.items())]
    live_cells = sum((issue_id, kind, column_id) in state['cells'] for issue_id, kind, column_id, _value in cells)
    cells = [cell for cell in cells if cell[:3] not in state['cells']]

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
    # A live view wins whole; the rest take the free slots, highest Sprint order first (views[-0:] would be the whole list).
    live_views = set(state['view_sprints'])
    fresh_views = [(sprint, changes) for sprint, changes in views if sprint not in live_views]
    slots = max(0, sprint_review.MAX_GROUP_VIEWS - len(state['view_sprints']))
    cut = max(0, len(fresh_views) - slots)
    skipped_views = [sprint for sprint, _ in fresh_views[:cut]]
    written_views = []
    for sprint, changes in fresh_views[cut:]:
        _review_rules(sprint_review.validate_schema_changes, changes)
        written_views.append((sprint, _review_rules(sprint_review.apply_layouts, {}, columns, changes)))

    count = lambda kind: sum(c['rowKind'] == kind for c in added)  # noqa: E731
    rollups = sum(c['rowKind'] == 'story' and c['type'] == 'number' and c['aggregation'] == 'sum' for c in added)
    merged = []
    for c in kept:
        if len(c['members']) + len(c['archived']) > 1:
            merged.append(f"merged {c['id']}: " + ' '.join(f"{m['id']}@{m['sprint']}" for m in c['members'])
                          + ('; archived ' + ' '.join(f"{m['id']}@{m['sprint']}" for m in c['archived']) if c['archived'] else ''))
    intent_keys = sum(1 for group in members.values() if group[-1]['archived'])
    excluded_members = ' '.join(f"{m['id']}@{m['sprint']}" for c in excluded for m in c['members'])
    revision = state['revision'] + (1 if added else 0) if state['exists'] else 1
    if not merge:
        report.append(f"columns adopted: epic {count('epic')}, story {count('story')}")
        report += merged
        report.append(f"archive intent: keys {intent_keys}, cells dropped {dropped['intent']}")
        report.append(f"archived members discarded: {len(discarded_refs)}, cells dropped {dropped['archived']}")
        report.append(f"cap excluded: keys {len(excluded)}, cells dropped {dropped['cap']}; members {excluded_members or 'none'}")
        report.append(f"conflicting cell values dropped: {dropped['conflict']}")
        report.append(f"orphan cells dropped: {dropped['orphan']}")
        report.append(f"views: {len(written_views)} written per group, skipped by cap {len(skipped_views)}"
                      + (f" (Sprints {', '.join(skipped_views)})" if skipped_views else ''))
        report.append(f"derived: story sum rollups {rollups}, epic inherited {count('epic')}")
    else:
        report.append(f"columns matched: {len(matched)}")
        report += [f"matched {candidates[index]['id']} -> {column['id']}" for index, column in sorted(matched.items())]
        report.append(f"columns added: epic {count('epic')}, story {count('story')}")
        report += merged
        report.append(f"group-archived keys skipped: {len(skipped)}, cells dropped {dropped['group_archived']}")
        report += [f"skipped {candidates[index]['id']} -> {archived_id}" for index, archived_id in sorted(skipped.items())]
        report.append(f"archive intent: keys {intent_keys}, cells dropped {dropped['intent']}")
        report.append(f"archived members discarded: {len(discarded_refs)}, cells dropped {dropped['archived']}")
        report.append(f"cap excluded: keys {len(excluded)}, cells dropped {dropped['cap']}; members {excluded_members or 'none'}")
        report.append(f"cells: inserted {len(cells)}, skipped as live {live_cells}")
        report.append(f"conflicting cell values dropped: {dropped['conflict']}")
        report.append(f"orphan cells dropped: {dropped['orphan']}")
        report.append(f"views: inserted {len(written_views)}, skipped as live {len(views) - len(fresh_views)}, "
                      f"skipped by cap {len(skipped_views)}" + (f" (Sprints {', '.join(skipped_views)})" if skipped_views else '')
                      + f", slots left {max(0, slots - len(written_views))}")
        boundaries = sorted(live_views | {sprint for sprint, _ in written_views}, key=int)
        for sprint, _layouts in written_views:
            following = next((b for b in boundaries if int(b) > int(sprint)), None)
            report.append(f"view {sprint} governs Sprint ids [{sprint}, {following or 'open'})")
        report.append(f"schema revision: {state['revision']} -> {revision}" if added else 'schema revision: unchanged')
        report.append(f"derived: story sum rollups {rollups}, epic inherited {count('epic')}")
    return {'columns': columns, 'added': added, 'cells': cells, 'views': written_views, 'report': report,
            'matched': sorted((candidates[index]['id'], column['id']) for index, column in matched.items()),
            'revision': revision, 'empty': not (added or cells or written_views)}


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
