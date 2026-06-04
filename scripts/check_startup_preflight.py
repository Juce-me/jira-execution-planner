#!/usr/bin/env python3
"""Check local startup prerequisites before launching Flask."""

from __future__ import annotations

import os
import ssl
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dependency install failure path
    load_dotenv = None

from backend.auth.jira_auth import (  # noqa: E402
    AUTH_MODE_ATLASSIAN_OAUTH,
    AUTH_MODE_BASIC,
    AuthConfig,
    AuthError,
    validate_auth_config,
)
from backend.auth.key_provider import KeyProviderConfigurationError, key_provider_from_env  # noqa: E402
from backend.config.repository import ConfigStorageError, selected_config_storage_backend, validate_config_storage_startup  # noqa: E402
from backend.db import engine as db_engine  # noqa: E402


TRUE_VALUES = {"1", "true", "yes"}
OAUTH_TOKEN_STORE_MIN_TTL_SECONDS = 900


class PreflightError(RuntimeError):
    """Raised for preflight failures with safe user-facing messages."""


def _env_flag(env: dict[str, str], name: str) -> bool:
    return str(env.get(name) or "").strip().lower() in TRUE_VALUES


def _auth_config_from_env(env: dict[str, str]) -> AuthConfig:
    return AuthConfig(
        auth_mode=str(env.get("JIRA_AUTH_MODE") or AUTH_MODE_BASIC).strip() or AUTH_MODE_BASIC,
        jira_url=str(env.get("JIRA_URL") or "").strip(),
        jira_email=str(env.get("JIRA_EMAIL") or "").strip(),
        jira_token=str(env.get("JIRA_TOKEN") or "").strip(),
        client_id=str(env.get("ATLASSIAN_CLIENT_ID") or "").strip(),
        client_secret=str(env.get("ATLASSIAN_CLIENT_SECRET") or "").strip(),
        redirect_uri=str(env.get("ATLASSIAN_REDIRECT_URI") or "").strip(),
        scopes=str(env.get("ATLASSIAN_SCOPES") or AuthConfig.scopes).strip(),
        flask_secret_key=str(env.get("FLASK_SECRET_KEY") or "").strip(),
    )


def _check_runtime(env: dict[str, str]) -> str:
    if sys.version_info < (3, 10):
        raise PreflightError("Python 3.10+ is required.")
    openssl_version = getattr(ssl, "OPENSSL_VERSION", "")
    if "LibreSSL" in openssl_version:
        raise PreflightError("Python must be linked against OpenSSL 1.1.1+, not LibreSSL.")
    if getattr(ssl, "OPENSSL_VERSION_INFO", (0, 0, 0)) < (1, 1, 1):
        raise PreflightError("Python must be linked against OpenSSL 1.1.1+.")
    return f"Python {sys.version_info.major}.{sys.version_info.minor} with {openssl_version}"


def _check_auth_config(env: dict[str, str]) -> str:
    config = _auth_config_from_env(env)
    try:
        validate_auth_config(config)
    except AuthError as error:
        raise PreflightError(error.message) from error
    return config.auth_mode


def _check_oauth_local_token_store(env: dict[str, str]) -> str:
    config = _auth_config_from_env(env)
    if config.auth_mode != AUTH_MODE_ATLASSIAN_OAUTH:
        return "not required for basic auth"
    if db_engine.database_storage_enabled(env):
        if _env_flag(env, "OAUTH_LOCAL_TOKEN_STORE_ALLOWED"):
            host = str(env.get("APP_BIND_HOST") or "127.0.0.1").strip() or "127.0.0.1"
            environment = str(env.get("APP_ENVIRONMENT_KEY") or "local").strip().lower()
            if host not in {"127.0.0.1", "localhost", "::1"} or environment not in {"local", "dev"}:
                raise PreflightError("DB/OAuth hosted mode must not enable OAUTH_LOCAL_TOKEN_STORE_ALLOWED.")
        return "not required for db oauth"
    environment = str(env.get("APP_ENVIRONMENT_KEY") or "local").strip().lower()
    if environment not in {"local", "dev"} or not _env_flag(env, "OAUTH_LOCAL_TOKEN_STORE_ALLOWED"):
        raise PreflightError(
            "Atlassian OAuth local testing requires APP_ENVIRONMENT_KEY=local or dev and "
            "OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true."
        )
    try:
        ttl_seconds = int(str(env.get("OAUTH_TOKEN_STORE_TTL_SECONDS") or "2592000").strip())
    except ValueError as exc:
        raise PreflightError("OAUTH_TOKEN_STORE_TTL_SECONDS must be an integer.") from exc
    if ttl_seconds < OAUTH_TOKEN_STORE_MIN_TTL_SECONDS:
        raise PreflightError(
            f"OAUTH_TOKEN_STORE_TTL_SECONDS must be at least {OAUTH_TOKEN_STORE_MIN_TTL_SECONDS} seconds."
        )
    return "local OAuth token store allowed"


def _check_config_storage(env: dict[str, str]) -> str:
    try:
        return selected_config_storage_backend(env)
    except ConfigStorageError as error:
        raise PreflightError(str(error)) from error


def _check_database_url(env: dict[str, str]) -> str:
    if not db_engine.database_storage_enabled(env):
        return "not required for jsonfile config storage"
    try:
        db_engine.resolve_database_url(environ=env, required=True)
    except db_engine.DatabaseConfigurationError as error:
        raise PreflightError(str(error)) from error
    return "configured"


def _check_token_encryption(env: dict[str, str]) -> str:
    if not db_engine.database_storage_enabled(env):
        return "not required for jsonfile config storage"
    try:
        provider = key_provider_from_env(env)
        probe_dek = bytes(range(32))
        wrapped = provider.wrap_key(probe_dek, b"startup-preflight")
        if provider.unwrap_key(wrapped, b"startup-preflight") != probe_dek:
            raise PreflightError("Token encryption key probe failed.")
    except KeyProviderConfigurationError as error:
        raise PreflightError(str(error)) from error
    return f"key id {provider.primary_key_id()}"


def _check_migrations(env: dict[str, str]) -> str:
    if selected_config_storage_backend(env) != "db":
        return "not required for jsonfile config storage"
    try:
        validate_config_storage_startup(env)
    except ConfigStorageError as error:
        raise PreflightError(str(error)) from error
    except Exception as exc:
        raise PreflightError("Database is unavailable or migrations are not at head.") from exc
    return "at head"


def _check_network_bind(env: dict[str, str]) -> str:
    host = str(env.get("APP_BIND_HOST") or "127.0.0.1").strip() or "127.0.0.1"
    if host in {"127.0.0.1", "localhost", "::1"}:
        return host
    auth_mode = _auth_config_from_env(env).auth_mode
    if not _env_flag(env, "ALLOW_NETWORK_BIND"):
        raise PreflightError("Network bind requires ALLOW_NETWORK_BIND=true.")
    if auth_mode == AUTH_MODE_BASIC:
        environment = str(env.get("APP_ENVIRONMENT_KEY") or "local").strip().lower()
        if not _env_flag(env, "ALLOW_BASIC_AUTH_ON_NETWORK") or environment != "local":
            raise PreflightError(
                "Basic auth network bind requires ALLOW_BASIC_AUTH_ON_NETWORK=true and APP_ENVIRONMENT_KEY=local."
            )
    if auth_mode == AUTH_MODE_ATLASSIAN_OAUTH:
        if not _env_flag(env, "SESSION_COOKIE_SECURE"):
            raise PreflightError("OAuth network bind requires SESSION_COOKIE_SECURE=true.")
        origins = [origin.strip() for origin in str(env.get("APP_ALLOWED_ORIGINS") or "").split(",") if origin.strip()]
        if not origins or "*" in origins:
            raise PreflightError("OAuth network bind requires explicit APP_ALLOWED_ORIGINS without *.")
        if not str(env.get("FLASK_SECRET_KEY") or "").strip():
            raise PreflightError("OAuth network bind requires FLASK_SECRET_KEY.")
        if _env_flag(env, "OAUTH_LOCAL_TOKEN_STORE_ALLOWED"):
            raise PreflightError("Local OAuth token storage cannot be used with network bind.")
    return host


CHECKS = (
    ("runtime", _check_runtime),
    ("auth_config", _check_auth_config),
    ("oauth_local_token_store", _check_oauth_local_token_store),
    ("config_storage", _check_config_storage),
    ("database_url", _check_database_url),
    ("token_encryption", _check_token_encryption),
    ("migrations", _check_migrations),
    ("network_bind", _check_network_bind),
)


def run_preflight(env: dict[str, str]) -> int:
    failed = False
    for name, check in CHECKS:
        try:
            detail = check(env)
        except PreflightError as error:
            failed = True
            print(f"FAIL {name}: {error}")
        else:
            print(f"PASS {name}: {detail}")
    return 1 if failed else 0


def main() -> int:
    if load_dotenv is not None:
        load_dotenv(REPO_ROOT / ".env")
    return run_preflight(os.environ)


if __name__ == "__main__":
    raise SystemExit(main())
