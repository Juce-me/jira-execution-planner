"""Validation for user-owned saved view payloads."""

from copy import deepcopy
import re

from backend.auth.token_crypto import SENSITIVE_TOKEN_KEYS
from backend.epm.config import normalize_epm_config
from backend.epm.home import HOME_GRAPHQL_PROBE_SENSITIVE_KEYS, HOME_WRITE_PROBE_SENSITIVE_KEYS


FORBIDDEN_VIEW_PAYLOAD_KEYS = (
    set(SENSITIVE_TOKEN_KEYS)
    | set(HOME_WRITE_PROBE_SENSITIVE_KEYS)
    | set(HOME_GRAPHQL_PROBE_SENSITIVE_KEYS)
    | {
        'authConnections',
        'auth_tokens',
        'authTokens',
        'credential',
        'credential_subject',
        'credentialSubject',
        'credentials',
        'headers',
        'password',
        'secret',
        'private_key',
        'privateKey',
        'service_integration_tokens',
        'serviceIntegrations',
        'serviceIntegrationTokens',
        'teamGroups',
        'teamCatalog',
        'workspaceId',
        'workspace_id',
        'userId',
        'user_id',
        'accountId',
        'cloudId',
        'siteUrl',
    }
)

USER_EPM_SETTINGS_KEYS = frozenset({'version', 'labelPrefix', 'scope', 'issueTypes', 'projects'})
PERSONAL_EPM_KEYS = frozenset({'tab', 'selectedSprint'})


class ViewPayloadValidationError(ValueError):
    def __init__(self, forbidden_paths):
        self.forbidden_paths = tuple(sorted(set(forbidden_paths)))
        super().__init__('saved view payload contains forbidden fields: ' + ', '.join(self.forbidden_paths))


def _normalize_key(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


_FORBIDDEN_NORMALIZED_KEYS = {_normalize_key(key) for key in FORBIDDEN_VIEW_PAYLOAD_KEYS}
_FORBIDDEN_ROOT_CAPACITY_KEYS = {'capacity', 'capacityconfig'}


def _path(parent, key):
    return f'{parent}.{key}' if parent else str(key)


def _looks_like_raw_graphql_operation(value):
    if not isinstance(value, dict):
        return False
    keys = {_normalize_key(key) for key in value}
    if any('graphql' in key for key in keys):
        return True
    return 'query' in keys and ('variables' in keys or 'operationname' in keys)


def _collect_forbidden_paths(value, parent_path=''):
    forbidden = []
    if isinstance(value, dict):
        if _looks_like_raw_graphql_operation(value):
            forbidden.append(parent_path or '<root>')
        for key, item in value.items():
            item_path = _path(parent_path, key)
            if _normalize_key(key) in _FORBIDDEN_NORMALIZED_KEYS:
                forbidden.append(item_path)
                continue
            forbidden.extend(_collect_forbidden_paths(item, item_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            forbidden.extend(_collect_forbidden_paths(item, f'{parent_path}[{index}]'))
    return forbidden


def validate_user_view_payload(payload):
    if not isinstance(payload, dict):
        raise ViewPayloadValidationError(['<root>'])
    forbidden_paths = _collect_forbidden_paths(payload)
    for key in payload:
        if _normalize_key(key) in _FORBIDDEN_ROOT_CAPACITY_KEYS:
            forbidden_paths.append(str(key))
    if forbidden_paths:
        raise ViewPayloadValidationError(forbidden_paths)
    return payload


def sanitize_user_view_payload(value):
    """Return a response-safe copy using the same forbidden-key semantics as validation."""
    if isinstance(value, dict):
        if _looks_like_raw_graphql_operation(value):
            return {}
        return {
            key: sanitize_user_view_payload(item)
            for key, item in value.items()
            if _normalize_key(key) not in _FORBIDDEN_NORMALIZED_KEYS
        }
    if isinstance(value, list):
        return [sanitize_user_view_payload(item) for item in value]
    if isinstance(value, str) and any(marker in value.lower() for marker in ('bearer ', 'basic ')):
        return '[redacted]'
    return value


def _invalid(path):
    raise ViewPayloadValidationError([path])


def _reject_unknown(value, allowed, path):
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        _invalid(f'{path}.{unknown[0]}')


def _require_text(value, path, *, nonempty=False):
    if not isinstance(value, str):
        _invalid(path)
    normalized = value.strip()
    if nonempty and not normalized:
        _invalid(path)
    return normalized


def normalize_epm_settings_payload(payload):
    """Validate and canonicalize the exact user-owned EPM settings object."""
    if not isinstance(payload, dict):
        _invalid('epm')
    _reject_unknown(payload, USER_EPM_SETTINGS_KEYS, 'epm')
    if set(payload) != set(USER_EPM_SETTINGS_KEYS) or payload.get('version') != 2:
        _invalid('epm')
    _require_text(payload.get('labelPrefix'), 'epm.labelPrefix')

    scope = payload.get('scope')
    if not isinstance(scope, dict):
        _invalid('epm.scope')
    _reject_unknown(scope, {'rootGoalKey', 'subGoalKeys'}, 'epm.scope')
    if set(scope) != {'rootGoalKey', 'subGoalKeys'}:
        _invalid('epm.scope')
    _require_text(scope.get('rootGoalKey'), 'epm.scope.rootGoalKey')
    sub_goal_keys = scope.get('subGoalKeys')
    if not isinstance(sub_goal_keys, list):
        _invalid('epm.scope.subGoalKeys')
    for index, value in enumerate(sub_goal_keys):
        _require_text(value, f'epm.scope.subGoalKeys[{index}]', nonempty=True)

    issue_types = payload.get('issueTypes')
    if not isinstance(issue_types, dict):
        _invalid('epm.issueTypes')
    buckets = {'initiative', 'epic', 'leaf'}
    _reject_unknown(issue_types, buckets, 'epm.issueTypes')
    if set(issue_types) != buckets:
        _invalid('epm.issueTypes')
    for bucket in sorted(buckets):
        values = issue_types.get(bucket)
        if not isinstance(values, list):
            _invalid(f'epm.issueTypes.{bucket}')
        for index, value in enumerate(values):
            _require_text(value, f'epm.issueTypes.{bucket}[{index}]', nonempty=True)

    projects = payload.get('projects')
    if not isinstance(projects, dict):
        _invalid('epm.projects')
    for project_id, row in projects.items():
        if not isinstance(project_id, str) or not project_id.strip():
            _invalid('epm.projects')
        path = f'epm.projects.{project_id}'
        if not isinstance(row, dict):
            _invalid(path)
        _reject_unknown(row, {'id', 'name', 'label', 'homeProjectId'}, path)
        if not {'id', 'name', 'label'}.issubset(row):
            _invalid(path)
        _require_text(row.get('id'), f'{path}.id', nonempty=True)
        _require_text(row.get('name'), f'{path}.name')
        _require_text(row.get('label'), f'{path}.label')
        if 'homeProjectId' in row:
            home_project_id = row.get('homeProjectId')
            if home_project_id is not None:
                _require_text(home_project_id, f'{path}.homeProjectId', nonempty=True)

    return normalize_epm_config(payload)


def normalize_user_view_payload(payload):
    """Validate a private view and normalize its optional EPM settings section."""
    validate_user_view_payload(payload)
    result = deepcopy(payload)
    epm = result.get('epm')
    if epm is None:
        return result
    if not isinstance(epm, dict):
        _invalid('epm')
    _reject_unknown(epm, USER_EPM_SETTINGS_KEYS | PERSONAL_EPM_KEYS, 'epm')
    settings = {key: epm[key] for key in USER_EPM_SETTINGS_KEYS if key in epm}
    personal = {key: deepcopy(epm[key]) for key in PERSONAL_EPM_KEYS if key in epm}
    for key, value in personal.items():
        _require_text(value, f'epm.{key}')
    if settings:
        settings = normalize_epm_settings_payload(settings)
    result['epm'] = {**settings, **personal}
    return result
