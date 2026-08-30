"""Ownership and validation boundary for workspace and private configuration."""

from __future__ import annotations

from copy import deepcopy
from urllib.parse import urlsplit

from backend.config.view_validation import (
    PERSONAL_EPM_KEYS,
    USER_EPM_SETTINGS_KEYS,
    sanitize_user_view_payload,
)

ADMIN_CONFIG_SECTIONS = frozenset({
    'version', 'projects', 'board', 'capacity', 'sprintField',
    'storyPointsField', 'parentNameField', 'teamField', 'projectTrackField',
    'deliveryOwnerField', 'statsPriorityWeights', 'issueTypes',
})
PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS = ADMIN_CONFIG_SECTIONS - {'version'}
LEGACY_EXCLUDED_TOP_LEVEL_SECTIONS = frozenset({'filters', 'eng', 'epm', 'teamGroups', 'teamCatalog'})


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
    return payload


def sanitize_private_view_payload(payload):
    """Strip shared ownership fields and recursively remove forbidden response data."""
    return sanitize_user_view_payload(strip_shared_sections_from_private_view(payload))


def validate_private_view_ownership(payload, *, validate_sensitive=True):
    from backend.config.view_validation import (
        ViewPayloadValidationError,
        _collect_forbidden_paths,
        normalize_user_view_payload,
    )
    if not isinstance(payload, dict):
        raise ViewPayloadValidationError(['<root>'])
    paths = []
    if validate_sensitive:
        paths.extend(_collect_forbidden_paths(payload))
    paths.extend(key for key in payload if key in PRIVATE_FORBIDDEN_TOP_LEVEL_SECTIONS)
    if paths:
        raise ViewPayloadValidationError(paths)
    return normalize_user_view_payload(payload)


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
