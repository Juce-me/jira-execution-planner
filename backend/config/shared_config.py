"""Ownership and validation boundary for workspace and private configuration."""

from __future__ import annotations

from copy import deepcopy
from urllib.parse import urlsplit

from backend.epm.config import normalize_epm_config


ADMIN_CONFIG_SECTIONS = frozenset({
    'version', 'projects', 'board', 'capacity', 'sprintField',
    'storyPointsField', 'parentNameField', 'teamField', 'projectTrackField',
    'deliveryOwnerField', 'statsPriorityWeights', 'issueTypes', 'epm',
})
PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS = ADMIN_CONFIG_SECTIONS - {'version', 'epm'}
SHARED_EPM_KEYS = frozenset({'version', 'labelPrefix', 'scope', 'issueTypes', 'projects'})
PERSONAL_EPM_KEYS = frozenset({'tab', 'selectedSprint'})
LEGACY_EXCLUDED_TOP_LEVEL_SECTIONS = frozenset({'filters', 'eng', 'teamGroups', 'teamCatalog'})


def _raise(path, message='unsupported configuration field'):
    raise ValueError(f'{message}: {path}')


def _require_dict(value, path):
    if not isinstance(value, dict):
        _raise(path, 'configuration field must be an object')
    return value


def _reject_unknown(value, allowed, path):
    unknown = set(value) - set(allowed)
    if unknown:
        _raise(f"{path}.{sorted(unknown)[0]}")


def _text(value):
    return str(value or '').strip()


def _require_optional_text(value, path):
    if value is not None and not isinstance(value, str):
        _raise(path, 'configuration field must be a string')
    return _text(value)


def _field_config(value, path):
    value = _require_dict(value, path)
    _reject_unknown(value, {'fieldId', 'fieldName'}, path)
    return {
        'fieldId': _require_optional_text(value.get('fieldId'), f'{path}.fieldId'),
        'fieldName': _require_optional_text(value.get('fieldName'), f'{path}.fieldName'),
    }


def _normalize_epm(value):
    value = _require_dict(value, 'epm')
    _reject_unknown(value, SHARED_EPM_KEYS, 'epm')
    if 'version' in value and value.get('version') not in (2, None):
        _raise('epm.version', 'unsupported EPM version')
    if 'labelPrefix' in value:
        _require_optional_text(value.get('labelPrefix'), 'epm.labelPrefix')
    scope = value.get('scope', {})
    _require_dict(scope, 'epm.scope')
    _reject_unknown(scope, {'rootGoalKey', 'subGoalKey', 'subGoalKeys'}, 'epm.scope')
    _require_optional_text(scope.get('rootGoalKey'), 'epm.scope.rootGoalKey')
    _require_optional_text(scope.get('subGoalKey'), 'epm.scope.subGoalKey')
    if 'subGoalKeys' in scope:
        sub_goal_keys = scope.get('subGoalKeys')
        if not isinstance(sub_goal_keys, list) or not all(isinstance(item, str) for item in sub_goal_keys):
            _raise('epm.scope.subGoalKeys', 'configuration field must be a string array')
    issue_types = value.get('issueTypes', {})
    _require_dict(issue_types, 'epm.issueTypes')
    _reject_unknown(issue_types, {'initiative', 'epic', 'leaf'}, 'epm.issueTypes')
    for key, values in issue_types.items():
        if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
            _raise(f'epm.issueTypes.{key}', 'configuration field must be a string array')
    projects = value.get('projects', {})
    _require_dict(projects, 'epm.projects')
    for project_id, row in projects.items():
        _require_dict(row, f'epm.projects.{project_id}')
        _reject_unknown(
            row,
            {'id', 'name', 'label', 'homeProjectId', 'customName', 'jiraLabel'},
            f'epm.projects.{project_id}',
        )
        for key in ('id', 'name', 'label', 'homeProjectId', 'customName', 'jiraLabel'):
            if key in row:
                _require_optional_text(row.get(key), f'epm.projects.{project_id}.{key}')
    return normalize_epm_config(value)


def normalize_workspace_admin_payload(payload, *, allow_legacy_excluded_fields=False):
    """Validate and canonicalize one complete workspace administrator payload."""
    payload = _require_dict(payload, '<root>')
    from backend.config.view_validation import _collect_forbidden_paths
    sensitive_candidate = payload
    if allow_legacy_excluded_fields:
        sensitive_candidate = {
            key: value for key, value in payload.items()
            if key not in LEGACY_EXCLUDED_TOP_LEVEL_SECTIONS
        }
    forbidden = _collect_forbidden_paths(sensitive_candidate)
    if forbidden:
        _raise(forbidden[0], 'forbidden configuration field')
    allowed = set(ADMIN_CONFIG_SECTIONS)
    if allow_legacy_excluded_fields:
        allowed.update(LEGACY_EXCLUDED_TOP_LEVEL_SECTIONS)
    _reject_unknown(payload, allowed, '<root>')
    result = {}
    for section, value in payload.items():
        if section in LEGACY_EXCLUDED_TOP_LEVEL_SECTIONS:
            continue
        if section == 'version':
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                _raise('version', 'configuration version must be a positive integer')
            result[section] = value
        elif section == 'projects':
            value = _require_dict(value, section)
            _reject_unknown(value, {'selected'}, section)
            selected = value.get('selected', [])
            if not isinstance(selected, list):
                _raise('projects.selected', 'configuration field must be an array')
            normalized_selected = []
            for item in selected:
                if isinstance(item, str) and _text(item):
                    normalized_selected.append({'key': _text(item), 'type': 'product'})
                elif isinstance(item, dict):
                    _reject_unknown(item, {'key', 'type'}, 'projects.selected')
                    key = _require_optional_text(item.get('key'), 'projects.selected.key')
                    if key:
                        normalized_selected.append({
                            'key': key,
                            'type': _require_optional_text(item.get('type'), 'projects.selected.type') or 'product',
                        })
                else:
                    _raise('projects.selected', 'configuration project entries must be strings or objects')
            result[section] = {'selected': normalized_selected}
        elif section == 'board':
            value = _require_dict(value, section)
            _reject_unknown(value, {'boardId', 'boardName'}, section)
            raw_board_id = value.get('boardId')
            if raw_board_id is not None and (
                isinstance(raw_board_id, bool) or not isinstance(raw_board_id, (str, int))
            ):
                _raise('board.boardId', 'boardId must be numeric')
            board_id = _text(value.get('boardId'))
            if board_id and not board_id.isdigit():
                _raise('board.boardId', 'boardId must be numeric')
            result[section] = {
                'boardId': board_id,
                'boardName': _require_optional_text(value.get('boardName'), 'board.boardName'),
            }
        elif section == 'capacity':
            value = _require_dict(value, section)
            _reject_unknown(value, {'project', 'fieldId', 'fieldName'}, section)
            result[section] = {
                key: _require_optional_text(value.get(key), f'{section}.{key}')
                for key in ('project', 'fieldId', 'fieldName')
            }
        elif section in {'sprintField', 'storyPointsField', 'parentNameField', 'teamField', 'projectTrackField', 'deliveryOwnerField'}:
            result[section] = _field_config(value, section)
        elif section == 'statsPriorityWeights':
            if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
                _raise(section, 'configuration field must be an array of objects')
            for index, item in enumerate(value):
                _reject_unknown(item, {'priority', 'weight'}, f'{section}[{index}]')
            result[section] = deepcopy(value)
        elif section == 'issueTypes':
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                _raise(section, 'configuration field must be a string array')
            result[section] = [_text(item) for item in value if _text(item)]
        elif section == 'epm':
            result[section] = _normalize_epm(value)
    return result


def normalize_shared_admin_section(section, value):
    """Validate raw route input and canonicalize one shared administrator section."""
    if section not in ADMIN_CONFIG_SECTIONS:
        raise ValueError('unsupported workspace configuration section')
    return normalize_workspace_admin_payload({section: value})[section]


def strip_shared_sections_from_private_view(payload):
    payload = deepcopy(payload) if isinstance(payload, dict) else {}
    for key in PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS:
        payload.pop(key, None)
    epm = payload.get('epm')
    if isinstance(epm, dict):
        personal = {key: deepcopy(epm[key]) for key in PERSONAL_EPM_KEYS if key in epm}
        if personal:
            payload['epm'] = personal
        else:
            payload.pop('epm', None)
    else:
        payload.pop('epm', None)
    return payload


def validate_private_view_ownership(payload, *, validate_sensitive=True):
    from backend.config.view_validation import ViewPayloadValidationError, _collect_forbidden_paths
    if not isinstance(payload, dict):
        raise ViewPayloadValidationError(['<root>'])
    paths = []
    if validate_sensitive:
        paths.extend(_collect_forbidden_paths(payload))
    paths.extend(key for key in payload if key in PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS)
    epm = payload.get('epm')
    if epm is not None:
        if not isinstance(epm, dict):
            paths.append('epm')
        else:
            paths.extend(f'epm.{key}' for key in epm if key not in PERSONAL_EPM_KEYS)
    if paths:
        raise ViewPayloadValidationError(paths)
    return payload


def _normalized_site(value):
    value = _text(value)
    if not value:
        return None
    parsed = urlsplit(value)
    if parsed.scheme.lower() not in {'http', 'https'} or not parsed.hostname:
        return None
    port = f':{parsed.port}' if parsed.port else ''
    path = parsed.path.rstrip('/')
    return parsed.scheme.lower(), f'{parsed.hostname.lower()}{port}', path


def legacy_fallback_matches_workspace(context, legacy_site_url):
    return bool(
        _normalized_site(getattr(context, 'site_url', ''))
        and _normalized_site(getattr(context, 'site_url', '')) == _normalized_site(legacy_site_url)
    )
