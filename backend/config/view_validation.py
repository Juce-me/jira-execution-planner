"""Validation for user-owned saved view payloads."""

import re

from backend.auth.token_crypto import SENSITIVE_TOKEN_KEYS
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
        'service_integration_tokens',
        'serviceIntegrations',
        'serviceIntegrationTokens',
        'teamGroups',
    }
)


class ViewPayloadValidationError(ValueError):
    def __init__(self, forbidden_paths):
        self.forbidden_paths = tuple(sorted(set(forbidden_paths)))
        super().__init__('saved view payload contains forbidden fields: ' + ', '.join(self.forbidden_paths))


def _normalize_key(value):
    return re.sub(r'[^a-z0-9]', '', str(value or '').lower())


_FORBIDDEN_NORMALIZED_KEYS = {_normalize_key(key) for key in FORBIDDEN_VIEW_PAYLOAD_KEYS}


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
    if forbidden_paths:
        raise ViewPayloadValidationError(forbidden_paths)
    return payload
