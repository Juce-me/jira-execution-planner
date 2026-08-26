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


def _field_config(value, path):
    value = _require_dict(value, path)
    _reject_unknown(value, {'fieldId', 'fieldName'}, path)
    return {'fieldId': _text(value.get('fieldId')), 'fieldName': _text(value.get('fieldName'))}


def _normalize_epm(value):
    value = _require_dict(value, 'epm')
    _reject_unknown(value, SHARED_EPM_KEYS, 'epm')
    if 'version' in value and value.get('version') not in (2, None):
        _raise('epm.version', 'unsupported EPM version')
    scope = value.get('scope', {})
    _require_dict(scope, 'epm.scope')
    _reject_unknown(scope, {'rootGoalKey', 'subGoalKey', 'subGoalKeys'}, 'epm.scope')
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
            if not isinstance(selected, list) or not all(isinstance(item, str) for item in selected):
                _raise('projects.selected', 'configuration field must be a string array')
            result[section] = {'selected': [_text(item) for item in selected if _text(item)]}
        elif section == 'board':
            value = _require_dict(value, section)
            _reject_unknown(value, {'boardId', 'boardName'}, section)
            board_id = _text(value.get('boardId'))
            if board_id and not board_id.isdigit():
                _raise('board.boardId', 'boardId must be numeric')
            result[section] = {'boardId': board_id, 'boardName': _text(value.get('boardName'))}
        elif section == 'capacity':
            value = _require_dict(value, section)
            _reject_unknown(value, {'project', 'fieldId', 'fieldName'}, section)
            result[section] = {key: _text(value.get(key)) for key in ('project', 'fieldId', 'fieldName')}
        elif section in {'sprintField', 'storyPointsField', 'parentNameField', 'teamField', 'projectTrackField', 'deliveryOwnerField'}:
            result[section] = _field_config(value, section)
        elif section == 'statsPriorityWeights':
            if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
                _raise(section, 'configuration field must be an array of objects')
            result[section] = deepcopy(value)
        elif section == 'issueTypes':
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                _raise(section, 'configuration field must be a string array')
            result[section] = [_text(item) for item in value if _text(item)]
        elif section == 'epm':
            result[section] = _normalize_epm(value)
    return result


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
