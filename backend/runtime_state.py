"""Runtime state policy helpers shared by server and services."""

import os


TRUE_VALUES = {"1", "true", "yes"}
FALSE_VALUES = {"0", "false", "no"}


def local_file_state_enabled(environ=None, *, default_environment=None):
    env = os.environ if environ is None else environ
    raw = str(env.get("LOCAL_FILE_STATE_ENABLED") or "").strip().lower()
    if raw in TRUE_VALUES:
        return True
    if raw in FALSE_VALUES:
        return False
    environment = str(env.get("APP_ENVIRONMENT_KEY") or os.environ.get("APP_ENVIRONMENT_KEY") or default_environment or "local").strip().lower()
    return environment in {"local", "dev"}


def scenario_legacy_import_enabled(environ=None, *, default_environment=None):
    env = os.environ if environ is None else environ
    raw = str(env.get("SCENARIO_DRAFT_LEGACY_IMPORT_ENABLED") or "").strip().lower()
    if raw in TRUE_VALUES:
        return True
    if raw in FALSE_VALUES:
        return False
    return local_file_state_enabled(env, default_environment=default_environment)
