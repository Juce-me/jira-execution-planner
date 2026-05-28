"""EPM configuration defaults and normalization helpers."""

from backend.epm.projects import normalize_epm_sub_goal_keys, normalize_epm_text, normalize_epm_upper_text


DEFAULT_EPM_LABEL_PREFIX = 'rnd_project_'

DEFAULT_EPM_ISSUE_TYPES = {
    'initiative': ['Initiative'],
    'epic': ['Epic'],
    'leaf': ['Story', 'Task', 'Sub-task', 'Subtask', 'Bug'],
}


def normalize_epm_scope(payload):
    scope = payload.get('scope') if isinstance(payload, dict) else {}
    if not isinstance(scope, dict):
        scope = {}
    sub_goal_keys = normalize_epm_sub_goal_keys(scope.get('subGoalKeys'))
    if not sub_goal_keys:
        sub_goal_keys = normalize_epm_sub_goal_keys(scope.get('subGoalKey'))
    return {
        'rootGoalKey': normalize_epm_upper_text(scope.get('rootGoalKey')),
        'subGoalKeys': sub_goal_keys,
    }


def normalize_epm_issue_types(payload):
    types = payload.get('issueTypes') if isinstance(payload, dict) else {}
    if not isinstance(types, dict):
        types = {}
    normalized = {}
    for bucket, defaults in DEFAULT_EPM_ISSUE_TYPES.items():
        values = types.get(bucket)
        if isinstance(values, list):
            cleaned = [normalize_epm_text(value) for value in values]
            cleaned = [value for value in cleaned if value]
        else:
            cleaned = []
        normalized[bucket] = cleaned or list(defaults)
    return normalized


def is_epm_v2_config(payload):
    if not isinstance(payload, dict):
        return False
    if 'version' in payload:
        return payload.get('version') == 2
    return 'labelPrefix' in payload


def normalize_epm_project_row(project_id, row, is_v2=False):
    if not isinstance(row, dict):
        return None
    if is_v2:
        normalized = {
            'id': normalize_epm_text(row.get('id')),
            'name': normalize_epm_text(row.get('name')),
            'label': normalize_epm_text(row.get('label')),
        }
        home_project_id = normalize_epm_text(row.get('homeProjectId'))
        if home_project_id:
            normalized['homeProjectId'] = home_project_id
        return normalized

    home_project_id = normalize_epm_text(row.get('homeProjectId'))
    if home_project_id:
        return {
            'id': home_project_id,
            'homeProjectId': home_project_id,
            'name': normalize_epm_text(row.get('customName')) or normalize_epm_text(row.get('name')),
            'label': normalize_epm_text(row.get('jiraLabel')) or normalize_epm_text(row.get('label')),
        }
    return {
        'id': normalize_epm_text(row.get('id')),
        'name': normalize_epm_text(row.get('customName')) or normalize_epm_text(row.get('name')),
        'label': normalize_epm_text(row.get('jiraLabel')) or normalize_epm_text(row.get('label')),
    }


def normalize_epm_project_output_key(project_id, normalized_row, is_v2=False):
    if is_v2:
        return project_id
    home_project_id = normalize_epm_text(normalized_row.get('homeProjectId'))
    if home_project_id:
        return home_project_id
    return project_id


def normalize_epm_config(payload):
    is_v2 = is_epm_v2_config(payload)
    projects = payload.get('projects') if isinstance(payload, dict) else {}
    normalized_projects = {}
    if isinstance(projects, dict):
        for project_id, row in projects.items():
            normalized_row = normalize_epm_project_row(project_id, row, is_v2=is_v2)
            if normalized_row is None:
                continue
            normalized_projects[normalize_epm_project_output_key(project_id, normalized_row, is_v2=is_v2)] = normalized_row
    label_prefix = (
        normalize_epm_text(payload.get('labelPrefix'))
        if isinstance(payload, dict) and 'labelPrefix' in payload
        else DEFAULT_EPM_LABEL_PREFIX
    )
    return {
        'version': 2,
        'labelPrefix': label_prefix,
        'scope': normalize_epm_scope(payload),
        'issueTypes': normalize_epm_issue_types(payload),
        'projects': normalized_projects,
    }
