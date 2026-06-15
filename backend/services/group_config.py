"""Team group configuration parsing and validation helpers."""

import json


def _noop(*_args, **_kwargs):
    return None


def parse_groups_config_env(raw, log_warning_fn=None):
    log_warning_fn = log_warning_fn or _noop
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception as exc:
        log_warning_fn(f'Failed to parse TEAM_GROUPS_JSON: {exc}')
        return None


def validate_groups_config(
    payload,
    *,
    allow_empty=False,
    groups_config_version,
    groups_max_teams,
    normalize_team_ids_fn,
    normalize_epic_keys_fn,
    normalize_group_team_labels_fn,
):
    errors = []
    warnings = []
    if not isinstance(payload, dict):
        errors.append('Config must be an object.')
        return None, errors, warnings

    groups_raw = payload.get('groups')
    if not isinstance(groups_raw, list):
        errors.append('groups must be a list.')
        return None, errors, warnings

    normalized_groups = []
    seen_ids = set()
    seen_names = set()
    for idx, group in enumerate(groups_raw):
        if not isinstance(group, dict):
            errors.append(f'Group at index {idx} must be an object.')
            continue
        group_id = str(group.get('id') or '').strip()
        name = str(group.get('name') or '').strip()
        if not group_id:
            errors.append(f'Group at index {idx} is missing id.')
            continue
        if not name:
            errors.append(f'Group "{group_id}" is missing name.')
            continue
        if group_id.lower() in seen_ids:
            errors.append(f'Duplicate group id "{group_id}".')
            continue
        if name.lower() in seen_names:
            errors.append(f'Duplicate group name "{name}".')
            continue
        seen_ids.add(group_id.lower())
        seen_names.add(name.lower())

        team_ids = normalize_team_ids_fn(group.get('teamIds') or [])
        if not team_ids and not allow_empty:
            errors.append(f'Group "{name}" must include at least one team.')
        if len(team_ids) > groups_max_teams:
            errors.append(f'Group "{name}" exceeds {groups_max_teams} teams.')
        raw_components = group.get('missingInfoComponents')
        if isinstance(raw_components, list):
            missing_info_components = [str(c).strip() for c in raw_components if str(c).strip()]
        elif isinstance(raw_components, str) and raw_components.strip():
            missing_info_components = [raw_components.strip()]
        else:
            old_single = str(group.get('missingInfoComponent') or '').strip()
            missing_info_components = [old_single] if old_single else []
        raw_excluded_epics = group.get('excludedCapacityEpics')
        if isinstance(raw_excluded_epics, list):
            excluded_capacity_epics = normalize_epic_keys_fn(raw_excluded_epics)
        elif isinstance(raw_excluded_epics, str) and raw_excluded_epics.strip():
            excluded_capacity_epics = normalize_epic_keys_fn([raw_excluded_epics.strip()])
        else:
            excluded_capacity_epics = []
        team_labels = normalize_group_team_labels_fn(group.get('teamLabels') or {}, team_ids)
        normalized_groups.append({
            'id': group_id,
            'name': name,
            'teamIds': team_ids,
            'missingInfoComponents': missing_info_components,
            'excludedCapacityEpics': excluded_capacity_epics,
            'teamLabels': team_labels
        })

    default_group_id = str(payload.get('defaultGroupId') or '').strip()
    if default_group_id:
        if default_group_id not in {g['id'] for g in normalized_groups}:
            errors.append('defaultGroupId must reference an existing group.')

    normalized = {
        'version': payload.get('version') or groups_config_version,
        'groups': normalized_groups,
        'defaultGroupId': default_group_id,
    }
    return normalized, errors, warnings


def build_default_groups_config(
    *,
    base_jql,
    missing_info_component,
    groups_config_version,
    groups_max_teams,
    normalize_team_ids_fn,
    extract_team_ids_from_jql_fn,
):
    warnings = []
    team_ids = normalize_team_ids_fn(extract_team_ids_from_jql_fn(base_jql))
    if len(team_ids) > groups_max_teams:
        warnings.append(f'Found more than {groups_max_teams} teams in JQL_QUERY; truncated to first {groups_max_teams}.')
        team_ids = team_ids[:groups_max_teams]
    if not team_ids:
        warnings.append('No teams found in JQL_QUERY. Default group is empty; add teams manually.')

    config = {
        'version': groups_config_version,
        'groups': [{
            'id': 'default',
            'name': 'Default',
            'teamIds': team_ids,
            'missingInfoComponents': [missing_info_component] if missing_info_component else [],
            'excludedCapacityEpics': []
        }],
        'defaultGroupId': 'default',
    }
    return config, warnings


def build_epic_alert_scope_clause(scope_team_ids=None, scope_team_labels=None, normalize_team_ids_fn=None):
    normalize_team_ids_fn = normalize_team_ids_fn or (lambda values: [str(value or '').strip() for value in values or [] if str(value or '').strip()])
    clauses = []
    team_ids = normalize_team_ids_fn(scope_team_ids or [])
    labels = []
    seen_labels = set()
    for label in scope_team_labels or []:
        value = str(label or '').strip()
        if value and value.lower() not in seen_labels:
            seen_labels.add(value.lower())
            labels.append(value)
    if team_ids:
        quoted = ', '.join(f'"{team_id}"' for team_id in team_ids)
        clauses.append(f'"Team[Team]" in ({quoted})' if len(team_ids) > 1 else f'"Team[Team]" = "{team_ids[0]}"')
    if labels:
        quoted = ', '.join(f'"{label}"' for label in labels)
        clauses.append(f'labels in ({quoted})' if len(labels) > 1 else f'labels = "{labels[0]}"')
    return f'({" OR ".join(clauses)})' if len(clauses) > 1 else (clauses[0] if clauses else '')


def resolve_group_team_label_values(config, group_id, team_ids, normalize_team_ids_fn):
    if not group_id or not team_ids:
        return []
    groups = (((config or {}).get('teamGroups') or {}).get('groups') or [])
    group = next((item for item in groups if str(item.get('id') or '').strip() == group_id), None)
    if not group:
        return []
    team_id_set = set(normalize_team_ids_fn(team_ids))
    return [
        str(label or '').strip()
        for team_id, label in (group.get('teamLabels') or {}).items()
        if str(team_id or '').strip() in team_id_set and str(label or '').strip()
    ]
