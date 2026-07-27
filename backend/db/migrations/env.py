from __future__ import annotations

from logging.config import fileConfig
from pathlib import Path
import sys

from alembic import context
from sqlalchemy import pool


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.db import engine as db_engine  # noqa: E402
from backend.db.cloud_sql import (  # noqa: E402
    CloudSqlConfigurationError,
    CloudSqlIamConfig,
)
from backend.db.models import Base  # noqa: E402


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    configured = str(config.get_main_option('sqlalchemy.url') or '').strip()
    if configured:
        return configured
    return db_engine.resolve_database_url(required=True)


def run_migrations_offline() -> None:
    database_url = _database_url()
    if (
        db_engine.resolve_database_connection_mode()
        == db_engine.DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM
    ):
        cloud_sql_config = None
        configuration_error = None
        try:
            cloud_sql_config = CloudSqlIamConfig.from_database_url(database_url)
        except CloudSqlConfigurationError as error:
            configuration_error = str(error)
        if cloud_sql_config is None:
            raise db_engine.DatabaseConfigurationError(configuration_error)
        database_url = cloud_sql_config.safe_url

    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={'paramstyle': 'named'},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = db_engine.create_database_engine(
        _database_url(),
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
