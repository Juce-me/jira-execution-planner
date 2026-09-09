"""Basic-auth/JSON configuration adapter for strict ENG Board reads.

The adapter deliberately has no database imports. It captures the legacy local
configuration and Basic credential generation as immutable, request-local data;
the route continues to own Jira I/O and the shared strict projection/stream.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
import hashlib
import hmac

from backend.auth.jira_auth import AUTH_MODE_BASIC, AuthError, validate_auth_config


class BasicBoardCompatibilityError(RuntimeError):
    def __init__(self, code, status=409):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class BasicAuthoritySnapshot:
    dashboard_payload: dict
    groups_payload: dict
    group: dict
    authority_payload: dict
    credential_version: str


def _credential_version(secret_key, config):
    material = '\0'.join((
        str(config.jira_url or '').strip().rstrip('/'),
        str(config.jira_email or ''),
        str(config.jira_token or ''),
    )).encode('utf-8')
    return hmac.new(secret_key, material, hashlib.sha256).hexdigest()


def _validated_groups(server, dashboard_payload):
    groups = dashboard_payload.get('teamGroups') if isinstance(dashboard_payload, dict) else None
    if not isinstance(groups, dict):
        groups = server.load_groups_config_file(server.resolve_groups_config_path())
    if not groups:
        groups = server.parse_groups_config_env()
    if not groups:
        groups, _warnings = server.build_default_groups_config()
    normalized, errors, _warnings = server.validate_groups_config(groups, allow_empty=True)
    if errors:
        raise BasicBoardCompatibilityError('board_config_invalid')
    return copy.deepcopy(normalized or {})


def capture_authority(server, department_id, secret_key):
    """Capture one Basic/JSON authority snapshot without opening DB storage."""
    auth_config = server.current_auth_config()
    if getattr(auth_config, 'auth_mode', None) != AUTH_MODE_BASIC:
        raise BasicBoardCompatibilityError('board_unavailable')
    try:
        validate_auth_config(auth_config)
    except AuthError as error:
        raise BasicBoardCompatibilityError('board_unavailable') from error

    dashboard_snapshot = server.load_dashboard_config_snapshot(source='jsonfile')
    dashboard = copy.deepcopy(getattr(dashboard_snapshot, 'payload', None) or {})
    groups = _validated_groups(server, dashboard)
    group = next((
        copy.deepcopy(row) for row in groups.get('groups') or ()
        if isinstance(row, dict) and str(row.get('id') or '').strip() == department_id
    ), None)
    if group is None:
        raise BasicBoardCompatibilityError('board_group_not_found', 404)

    credential_version = _credential_version(secret_key, auth_config)
    authority = {
        'auth': {
            'mode': AUTH_MODE_BASIC,
            'siteUrl': str(auth_config.jira_url or '').strip().rstrip('/'),
            'credentialVersion': credential_version,
        },
        'dashboard': {'source': 'legacy_json', 'payload': dashboard},
        'groups': {'source': 'legacy_json', 'payload': groups},
        'departmentId': department_id,
    }
    return BasicAuthoritySnapshot(
        dashboard_payload=dashboard,
        groups_payload=groups,
        group=group,
        authority_payload=authority,
        credential_version=credential_version,
    )
