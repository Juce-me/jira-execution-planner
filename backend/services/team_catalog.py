"""Team catalog and group team-label normalization helpers."""


def _default_normalize_team_ids(team_ids):
    return [str(item or '').strip() for item in (team_ids or []) if str(item or '').strip()]


def normalize_team_catalog(raw):
    catalog = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            team_id = str(item.get('id') or '').strip()
            name = str(item.get('name') or '').strip()
            if not team_id or not name:
                continue
            catalog[team_id] = {'id': team_id, 'name': name}
    elif isinstance(raw, dict):
        for key, value in raw.items():
            if isinstance(value, dict):
                team_id = str(value.get('id') or key or '').strip()
                name = str(value.get('name') or '').strip()
            else:
                team_id = str(key or '').strip()
                name = str(value or '').strip()
            if not team_id or not name:
                continue
            catalog[team_id] = {'id': team_id, 'name': name}
    return catalog


def normalize_team_catalog_meta(raw):
    if not isinstance(raw, dict):
        return {}
    meta = {}
    for key in ('updatedAt', 'sprintId', 'sprintName', 'source', 'resolvedAt'):
        value = raw.get(key)
        if value is None:
            continue
        meta[key] = str(value)
    return meta


def normalize_group_team_labels(raw, team_ids, normalize_team_ids_fn=None):
    """Normalize a Team's Jira label aliases into a canonical mapping.

    Accepts a legacy scalar label or a one-to-three-item array per Team and
    returns `(mapping, errors)`: `mapping` is `Record<TeamId, JiraLabel[]>`
    with blanks dropped and order preserved, and `errors` are label-free
    strings describing per-Team problems (never empty on the happy path).
    """
    if not isinstance(raw, dict):
        return {}, []
    normalize_team_ids_fn = normalize_team_ids_fn or _default_normalize_team_ids
    allowed_ids = set(normalize_team_ids_fn(team_ids or []))
    mapping = {}
    errors = []
    for raw_team_id, raw_value in raw.items():
        team_id = str(raw_team_id or '').strip()
        if not team_id or team_id not in allowed_ids:
            continue

        if isinstance(raw_value, list):
            raw_entries = raw_value
        elif raw_value is None:
            raw_entries = []
        elif isinstance(raw_value, bool):
            raw_entries = [raw_value]
        elif isinstance(raw_value, (int, float)):
            # Legacy scalar shape (e.g. a hand-edited TEAM_GROUPS_JSON label
            # that looks numeric): coerce to its string form. Non-string
            # entries inside an array are still rejected below.
            raw_entries = [str(raw_value).strip()]
        else:
            raw_entries = [raw_value]

        has_invalid_entry = False
        trimmed = []
        for entry in raw_entries:
            if not isinstance(entry, str):
                has_invalid_entry = True
                continue
            value = entry.strip()
            if value:
                trimmed.append(value)

        distinct = []
        seen_lower = set()
        has_duplicate = False
        for value in trimmed:
            key = value.lower()
            if key in seen_lower:
                has_duplicate = True
                continue
            seen_lower.add(key)
            distinct.append(value)

        if has_invalid_entry:
            errors.append(f'Team "{team_id}" has an invalid Jira label.')
        if has_duplicate:
            errors.append(f'Team "{team_id}" has duplicate Jira labels.')
        if len(distinct) > 3:
            errors.append(f'Team "{team_id}" has more than 3 Jira labels.')

        if distinct:
            mapping[team_id] = distinct

    return mapping, errors


def find_comma_scalar_team_labels(raw_team_labels):
    """Return the Team ids in `raw_team_labels` whose raw value is a string
    legacy scalar containing a comma.

    This is a save-time guard, not a read-side concern: a stale pre-deploy
    browser tab normalizes a version-2 alias array with `String(...)`
    (`["a", "b"]` becomes `"a,b"`) and would otherwise persist that joined
    string as a valid-looking legacy scalar. Array values (canonical or
    containing a comma-bearing entry) and non-string scalars are unaffected.
    """
    if not isinstance(raw_team_labels, dict):
        return []
    flagged = []
    for raw_team_id, raw_value in raw_team_labels.items():
        if isinstance(raw_value, str) and ',' in raw_value:
            team_id = str(raw_team_id or '').strip()
            if team_id:
                flagged.append(team_id)
    return flagged


def flatten_group_team_labels(mapping, team_ids, normalize_team_ids_fn=None):
    """Return the ordered, case-insensitively distinct union of aliases.

    Only Teams present in `team_ids` contribute, in that order; within a
    Team its aliases contribute in their stored order.
    """
    normalize_team_ids_fn = normalize_team_ids_fn or _default_normalize_team_ids
    ordered_team_ids = normalize_team_ids_fn(team_ids or [])
    seen_lower = set()
    flattened = []
    for team_id in ordered_team_ids:
        for label in (mapping or {}).get(team_id) or []:
            value = str(label or '').strip()
            if not value:
                continue
            key = value.lower()
            if key in seen_lower:
                continue
            seen_lower.add(key)
            flattened.append(value)
    return flattened
