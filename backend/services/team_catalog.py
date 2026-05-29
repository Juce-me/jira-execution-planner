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
    if not isinstance(raw, dict):
        return {}
    normalize_team_ids_fn = normalize_team_ids_fn or _default_normalize_team_ids
    allowed_ids = set(normalize_team_ids_fn(team_ids or []))
    labels = {}
    for raw_team_id, raw_label in raw.items():
        team_id = str(raw_team_id or '').strip()
        label = str(raw_label or '').strip()
        if not team_id or not label or team_id not in allowed_ids:
            continue
        labels[team_id] = label
    return labels
