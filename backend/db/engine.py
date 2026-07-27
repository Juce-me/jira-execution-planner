"""SQLAlchemy engine and session helpers."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from contextlib import contextmanager
from typing import Any, Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import Pool

from backend.db.cloud_sql import (
    CloudSqlConfigurationError,
    CloudSqlIamConfig,
    IamLoginTokenProvider,
    build_psycopg_creator,
)


DB_STORAGE_BACKENDS = {'db', 'database', 'postgres', 'postgresql'}
DATABASE_CONNECTION_MODE_URL = "url"
DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM = "cloud_sql_iam"
DATABASE_CONNECTION_MODES = {
    DATABASE_CONNECTION_MODE_URL,
    DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM,
}

_ENGINES: dict[tuple[str, str], Engine] = {}
_SESSION_FACTORIES: dict[tuple[str, str], sessionmaker[Session]] = {}


class DatabaseConfigurationError(RuntimeError):
    """Raised when database-backed mode is configured unsafely."""


def database_storage_enabled(environ: Mapping[str, str] | None = None) -> bool:
    env = os.environ if environ is None else environ
    storage_backend = str(env.get('CONFIG_STORAGE_BACKEND') or '').strip().lower()
    return storage_backend in DB_STORAGE_BACKENDS


def resolve_database_url(
    environ: Mapping[str, str] | None = None,
    *,
    testing: bool = False,
    required: bool | None = None,
) -> str:
    env = os.environ if environ is None else environ
    test_url = str(env.get('TEST_DATABASE_URL') or '').strip()
    database_url = str(env.get('DATABASE_URL') or '').strip()
    resolved = test_url if testing and test_url else database_url
    must_exist = database_storage_enabled(env) if required is None else required
    if must_exist and not resolved:
        key = 'TEST_DATABASE_URL or DATABASE_URL' if testing else 'DATABASE_URL'
        raise DatabaseConfigurationError(f'{key} is required when CONFIG_STORAGE_BACKEND=db')
    return resolved


def resolve_database_connection_mode(
    environ: Mapping[str, str] | None = None,
) -> str:
    env = os.environ if environ is None else environ
    mode = str(
        env.get("DATABASE_CONNECTION_MODE") or DATABASE_CONNECTION_MODE_URL
    ).strip().lower()
    if mode not in DATABASE_CONNECTION_MODES:
        raise DatabaseConfigurationError(
            "DATABASE_CONNECTION_MODE must be url or cloud_sql_iam."
        )
    return mode


def _validated_cloud_sql_config(database_url: str) -> CloudSqlIamConfig:
    try:
        return CloudSqlIamConfig.from_database_url(database_url)
    except CloudSqlConfigurationError as error:
        raise DatabaseConfigurationError(str(error)) from None


def _engine_cache_key(
    database_url: str,
    environ: Mapping[str, str] | None,
) -> tuple[str, str]:
    mode = resolve_database_connection_mode(environ)
    if mode == DATABASE_CONNECTION_MODE_URL:
        return mode, database_url
    return mode, _validated_cloud_sql_config(database_url).cache_key


def create_database_engine(
    database_url: str,
    *,
    environ: Mapping[str, str] | None = None,
    poolclass: type[Pool] | None = None,
    token_provider_factory: Callable[[], IamLoginTokenProvider] | None = None,
    psycopg_connect: Callable[..., object] | None = None,
) -> Engine:
    mode = resolve_database_connection_mode(environ)
    engine_kwargs: dict[str, Any] = {
        "future": True,
        "pool_pre_ping": True,
    }
    if poolclass is not None:
        engine_kwargs["poolclass"] = poolclass
    if mode == DATABASE_CONNECTION_MODE_URL:
        return create_engine(database_url, **engine_kwargs)

    config = _validated_cloud_sql_config(database_url)
    provider_factory = (
        IamLoginTokenProvider.from_adc
        if token_provider_factory is None
        else token_provider_factory
    )
    token_provider = provider_factory()
    creator = build_psycopg_creator(
        config,
        token_provider,
        connect_fn=psycopg_connect,
    )
    return create_engine(
        config.safe_url,
        creator=creator,
        **engine_kwargs,
    )


def validate_startup_database_config(
    environ: Mapping[str, str] | None = None,
) -> str:
    env = os.environ if environ is None else environ
    url = resolve_database_url(
        environ=env,
        required=database_storage_enabled(env),
    )
    mode = resolve_database_connection_mode(env)
    if url and mode == DATABASE_CONNECTION_MODE_CLOUD_SQL_IAM:
        _validated_cloud_sql_config(url)
    return mode


def get_engine(
    database_url: str | None = None,
    *,
    testing: bool = False,
    environ: Mapping[str, str] | None = None,
) -> Engine:
    url = (
        database_url
        or resolve_database_url(environ=environ, testing=testing, required=True)
    ).strip()
    if not url:
        raise DatabaseConfigurationError('DATABASE_URL is required to create a database engine')
    key = _engine_cache_key(url, environ)
    if key not in _ENGINES:
        _ENGINES[key] = create_database_engine(url, environ=environ)
    return _ENGINES[key]


def session_factory(
    database_url: str | None = None,
    *,
    testing: bool = False,
    environ: Mapping[str, str] | None = None,
) -> sessionmaker[Session]:
    url = (
        database_url
        or resolve_database_url(environ=environ, testing=testing, required=True)
    ).strip()
    key = _engine_cache_key(url, environ)
    if key not in _SESSION_FACTORIES:
        _SESSION_FACTORIES[key] = sessionmaker(
            bind=get_engine(url, environ=environ),
            future=True,
            expire_on_commit=False,
        )
    return _SESSION_FACTORIES[key]


@contextmanager
def session_scope(
    database_url: str | None = None,
    *,
    testing: bool = False,
    environ: Mapping[str, str] | None = None,
) -> Iterator[Session]:
    factory = session_factory(database_url, testing=testing, environ=environ)
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def require_postgresql_refresh_locking(database_url: str) -> None:
    backend = make_url(database_url).get_backend_name()
    if backend == 'sqlite':
        raise DatabaseConfigurationError(
            'SQLite cannot prove PostgreSQL advisory-lock or SELECT FOR UPDATE refresh locking semantics.'
        )
    if backend != 'postgresql':
        raise DatabaseConfigurationError('PostgreSQL is required for refresh-race locking tests.')


def dispose_engines() -> None:
    for engine in _ENGINES.values():
        engine.dispose()
    _ENGINES.clear()
    _SESSION_FACTORIES.clear()
