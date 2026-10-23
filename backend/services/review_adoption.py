"""Planning rules for adopting legacy per-Sprint review data into Department groups (#267, #299).

Shared by the operator script and by the 20261023_0020 revision. Everything here is a function of plain data:
no session, no model, no environment, no import from the application. The review validators and caps arrive as an
injected `rules` object (the script passes the live `sprint_review` module, the revision a frozen snapshot), so a
replayed revision applies the rules it was written with.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import uuid

MAX_TOTAL_COLUMNS = 240  # mirrors the total column limit in sprint_review.apply_schema
KINDS = ('epic', 'story')
READ_CHUNK_ISSUES = 500


def fingerprint(payload):
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def review_rules(rules, call, *args):
    try:
        return call(*args)
    except rules.ReviewError as error:
        raise ValueError(f'adopted data failed review validation ({error.code})') from None


def numeric(rules, value):
    try:
        rules.sprint_identity(value)
        return True
    except rules.ReviewError:
        return False


def canonical_legacy(rows, cells, rules):
    """Legacy reviews with content, ordered by numeric Sprint id then id, in canonical form.

    `rows` are legacy review rows (id, sprint_id, schema_revision, columns, layouts) and `cells` legacy cell rows
    (review_id, issue_id, row_kind, column_id, value, revision), as objects with those attributes."""
    bad = sum(not numeric(rules, row.sprint_id) for row in rows)
    if bad:
        raise ValueError(f'{bad} legacy Sprint ids are not numeric')
    by_review = {}
    for cell in cells:
        by_review.setdefault(cell.review_id, []).append(cell)
    reviews, skipped = [], 0
    for row in sorted(rows, key=lambda r: (int(r.sprint_id), r.id)):
        own = sorted(by_review.get(row.id, []), key=lambda c: (c.issue_id, c.row_kind, c.column_id))
        if not row.columns and not row.layouts and not own:
            skipped += 1
            continue
        reviews.append({'id': row.id, 'sprintId': row.sprint_id, 'schemaRevision': row.schema_revision,
                        'columns': deepcopy(row.columns), 'layouts': deepcopy(row.layouts),
                        'cells': [[row.sprint_id, c.issue_id, c.row_kind, c.column_id, c.value, c.revision] for c in own]})
    return reviews, skipped


def group_ids(config, rules):
    """Configured group ids from a shared group catalog dict, sorted; ValueError when the catalog is malformed."""
    groups = config.get('groups')
    if not groups:
        return []
    if not isinstance(groups, list) or any(not isinstance(group, dict) for group in groups):
        raise ValueError('group catalog is malformed')
    ids, bad = set(), 0
    for group in groups:
        try:
            ids.add(rules.group_identity(group.get('id')))
        except rules.ReviewError:
            bad += 1
    if bad:
        raise ValueError(f'{bad} configured group ids are malformed or longer than 128 characters')
    return sorted(ids)


def well_formed(column):
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


def well_formed_group(column):
    """A group column as the app writes it: the legacy shape plus a boolean `archived` and an integer `order`."""
    return (well_formed(column) and isinstance(column.get('archived'), bool)
            and isinstance(column.get('order'), int) and not isinstance(column.get('order'), bool))


def check_schema_rows(schema_rows):
    """ValueError when a group schema row holds malformed columns; rows are (schema_id, group, revision, columns)."""
    malformed = 0
    for _schema_id, _group, _revision, columns in schema_rows:
        malformed += 1 if not isinstance(columns, list) else sum(not well_formed_group(column) for column in columns)
    if malformed:
        raise ValueError(f'{malformed} group columns are malformed')


def group_state(groups, schema_rows, cell_rows, view_rows):
    """Per group: schema columns and revision, cell identities, and the Sprint ids with a view. Plain values only.

    `schema_rows` are (schema_id, group, revision, columns), `cell_rows` (schema_id, issue_id, row_kind, column_id) and
    `view_rows` (group, sprint_id)."""
    state = {group: {'exists': False, 'revision': 0, 'columns': [], 'cells': set(), 'view_sprints': []} for group in groups}
    check_schema_rows(schema_rows)
    schema_group = {}
    for schema_id, group, revision, columns in schema_rows:
        state[group].update(exists=True, revision=revision, columns=deepcopy(columns) if isinstance(columns, list) else [])
        schema_group[schema_id] = group
    for schema_id, issue_id, kind, column_id in cell_rows:
        state[schema_group[schema_id]]['cells'].add((issue_id, kind, column_id))
    for group, sprint in view_rows:
        state[group]['view_sprints'].append(sprint)
    for entry in state.values():
        entry['view_sprints'].sort(key=int)
        # A row nothing has written to (revision 0, no columns, no views) counts as absent, so a run that fills it ends it at 1.
        entry['exists'] = entry['exists'] and bool(entry['revision'] or entry['columns'] or entry['view_sprints'])
    return state


def normalize(reviews):
    """Group the legacy columns by key and classify them (archive intent, archived members, cap candidates)."""
    members, id_keys, malformed = {}, {}, 0
    for review in reviews:
        if not isinstance(review['columns'], list) or not isinstance(review['layouts'], dict) \
                or set(review['layouts']) - set(KINDS):
            malformed += 1
            continue
        for position, column in enumerate(review['columns']):
            if not well_formed(column):
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


def match_group_columns(candidates, group_columns):
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


def resolve_group(normalized, state, rules):
    """Apply the design's merge, cap, cell and view rules; returns columns, cells, views and the report.

    `state` is one group's current columns, revision, cell identities and view Sprint ids (see group_state);
    None means the group is empty and takes the fresh adoption path. `rules` supplies the review validators and caps."""
    reviews, members, candidates = normalized['reviews'], normalized['members'], normalized['candidates']
    kind_of, rank_of = normalized['kind_of'], normalized['rank_of']
    intent_refs, discarded_refs = normalized['intent_refs'], normalized['discarded_refs']
    merge = state is not None
    state = state or {'exists': False, 'revision': 0, 'columns': [], 'cells': set(), 'view_sprints': []}
    group_columns = state['columns']
    matched, skipped = match_group_columns(candidates, group_columns) if merge else ({}, {})
    report = []
    kept, excluded = [], []
    for kind in KINDS:
        active = sum(c['rowKind'] == kind and c.get('archived', False) is not True for c in group_columns)
        slots = max(0, rules.MAX_ACTIVE_COLUMNS - active)
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
    review_rules(rules, rules.validate_schema_changes, adds)
    columns = review_rules(rules, rules.apply_schema, group_columns, adds)
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
                        target = identity if identity in rules.REVIEW_LAYOUT_BUILTINS[kind] | extra else None
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
    slots = max(0, rules.MAX_GROUP_VIEWS - len(state['view_sprints']))
    cut = max(0, len(fresh_views) - slots)
    skipped_views = [sprint for sprint, _ in fresh_views[:cut]]
    written_views = []
    for sprint, changes in fresh_views[cut:]:
        review_rules(rules, rules.validate_schema_changes, changes)
        written_views.append((sprint, review_rules(rules, rules.apply_layouts, {}, columns, changes)))

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
