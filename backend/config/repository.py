"""Configuration storage backend selection."""

from __future__ import annotations

import os
from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory

from backend.config.db_repository import DbConfigRepository
from backend.config.json_repository import JsonConfigRepository
from backend.db import engine as db_engine


REPO_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI = REPO_ROOT / 'backend' / 'db' / 'alembic.ini'


class ConfigStorageError(RuntimeError):
    """Raised when config storage backend selection is invalid."""


def selected_config_storage_backend(environ=None):
    env = os.environ if environ is None else environ
    backend = str(env.get('CONFIG_STORAGE_BACKEND') or 'jsonfile').strip().lower()
    if backend in {'', 'jsonfile'}:
        return 'jsonfile'
    if backend == 'db':
        return 'db'
    raise ConfigStorageError('CONFIG_STORAGE_BACKEND must be jsonfile or db')


def config_storage_db_enabled(environ=None):
    return selected_config_storage_backend(environ) == 'db'


def _migration_config(database_url):
    config = Config(str(ALEMBIC_INI))
    config.set_main_option('sqlalchemy.url', database_url)
    config.set_main_option('script_location', str(REPO_ROOT / 'backend' / 'db' / 'migrations'))
    return config


def _migrations_at_head(database_url):
    config = _migration_config(database_url)
    script = ScriptDirectory.from_config(config)
    expected_heads = set(script.get_heads())
    engine = db_engine.get_engine(database_url)
    with engine.connect() as connection:
        current_heads = set(MigrationContext.configure(connection).get_current_heads())
    return current_heads == expected_heads


def validate_config_storage_startup(environ=None):
    env = os.environ if environ is None else environ
    if selected_config_storage_backend(env) != 'db':
        return
    try:
        database_url = db_engine.resolve_database_url(environ=env, required=True)
    except db_engine.DatabaseConfigurationError as error:
        raise ConfigStorageError(str(error))
    if not _migrations_at_head(database_url):
        raise ConfigStorageError('CONFIG_STORAGE_BACKEND=db requires database migrations at head')


def json_repository(*, dashboard_path, groups_path, load_groups_config_file_fn, log_warning_fn=None):
    return JsonConfigRepository(
        dashboard_path=dashboard_path,
        groups_path=groups_path,
        load_groups_config_file_fn=load_groups_config_file_fn,
        log_warning_fn=log_warning_fn,
    )


def db_repository(*, database_url=None):
    return DbConfigRepository(database_url=database_url)


def resolve_effective_view_config(context, *, view_config_id=None, database_url=None):
    return db_repository(database_url=database_url).resolve_effective_view_config(
        context,
        view_config_id=view_config_id,
    )
