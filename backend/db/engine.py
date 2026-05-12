"""SQLAlchemy engine and session helpers."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker


DB_STORAGE_BACKENDS = {'db', 'database', 'postgres', 'postgresql'}

_ENGINES: dict[str, Engine] = {}
_SESSION_FACTORIES: dict[str, sessionmaker[Session]] = {}


class DatabaseConfigurationError(RuntimeError):
    """Raised when database-backed mode is configured unsafely."""


def database_storage_enabled(environ: dict[str, str] | None = None) -> bool:
    env = os.environ if environ is None else environ
    storage_backend = str(env.get('CONFIG_STORAGE_BACKEND') or '').strip().lower()
    return storage_backend in DB_STORAGE_BACKENDS


def resolve_database_url(
    environ: dict[str, str] | None = None,
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


def validate_startup_database_config(environ: dict[str, str] | None = None) -> None:
    resolve_database_url(environ=environ, required=database_storage_enabled(environ))


def get_engine(
    database_url: str | None = None,
    *,
    testing: bool = False,
    environ: dict[str, str] | None = None,
) -> Engine:
    url = (database_url or resolve_database_url(environ=environ, testing=testing, required=True)).strip()
    if not url:
        raise DatabaseConfigurationError('DATABASE_URL is required to create a database engine')
    if url not in _ENGINES:
        _ENGINES[url] = create_engine(url, future=True, pool_pre_ping=True)
    return _ENGINES[url]


def session_factory(
    database_url: str | None = None,
    *,
    testing: bool = False,
    environ: dict[str, str] | None = None,
) -> sessionmaker[Session]:
    url = (database_url or resolve_database_url(environ=environ, testing=testing, required=True)).strip()
    if url not in _SESSION_FACTORIES:
        _SESSION_FACTORIES[url] = sessionmaker(
            bind=get_engine(url),
            future=True,
            expire_on_commit=False,
        )
    return _SESSION_FACTORIES[url]


@contextmanager
def session_scope(
    database_url: str | None = None,
    *,
    testing: bool = False,
    environ: dict[str, str] | None = None,
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
