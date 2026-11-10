"""Pure normalization and validation of the supported application profile.

Only selectors and explicitly detected retired CLI requests belong here. Existing
credential, cookie, network-bind and database validators retain their own checks;
unused legacy environment fields do not select an authentication/storage mode.
"""

from __future__ import annotations


AUTH_MODE_ATLASSIAN_OAUTH = 'atlassian_oauth'
CONFIG_STORAGE_BACKEND_DB = 'db'
DB_STORAGE_BACKENDS = frozenset({'db', 'database', 'postgres', 'postgresql'})


class RuntimeProfileError(ValueError):
    """A supported-profile error safe to display without selector/CLI values."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _normalize_selector(value: str | None, default: str) -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise RuntimeProfileError(
            'runtime_profile_invalid',
            'Authentication and storage selectors must be strings.',
        )
    return value.strip().lower() or default


def normalize_runtime_profile(
    auth_mode: str | None = None,
    storage_backend: str | None = None,
) -> tuple[str, str]:
    """Apply common defaults/aliases without promoting unsupported selectors."""
    auth = _normalize_selector(auth_mode, AUTH_MODE_ATLASSIAN_OAUTH)
    storage = _normalize_selector(storage_backend, CONFIG_STORAGE_BACKEND_DB)
    if storage in DB_STORAGE_BACKENDS:
        storage = CONFIG_STORAGE_BACKEND_DB
    return auth, storage


def validate_supported_runtime_profile(
    auth_mode: str | None = None,
    storage_backend: str | None = None,
    *,
    explicit_legacy_cli_options=(),
) -> None:
    """Require DB OAuth, rejecting explicit retired CLI usage without echoing it.

    Callers detect retired credential flags before normal argument parsing can
    include their values in an error. Pass detected flags here, including flags
    whose supplied value is empty. Do not pass unrelated supported CLI options.
    """
    auth, storage = normalize_runtime_profile(auth_mode, storage_backend)
    for _option in explicit_legacy_cli_options:
        raise RuntimeProfileError(
            'runtime_legacy_cli_unsupported',
            'Credential CLI options are no longer supported. Configure DB-backed Atlassian OAuth.',
        )
    if auth != AUTH_MODE_ATLASSIAN_OAUTH:
        raise RuntimeProfileError(
            'runtime_auth_unsupported',
            'DB-backed Atlassian OAuth is required. Configure JIRA_AUTH_MODE=atlassian_oauth.',
        )
    if storage != CONFIG_STORAGE_BACKEND_DB:
        raise RuntimeProfileError(
            'runtime_storage_unsupported',
            'DB-backed Atlassian OAuth is required. Configure CONFIG_STORAGE_BACKEND=db.',
        )
