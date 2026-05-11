"""Reset a local/test database for DB auth development.

Useful local commands:

    alembic -c backend/db/alembic.ini upgrade head
    alembic -c backend/db/alembic.ini downgrade base
    python3 -m backend.db.reset_local
"""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from backend.db.engine import DatabaseConfigurationError, resolve_database_url


SAFE_ENVIRONMENT_KEYS = {'local', 'dev', 'test'}
SAFE_POSTGRES_HOSTS = {'localhost', '127.0.0.1', '::1'}


def _environment_key() -> str:
    return str(os.getenv('APP_ENVIRONMENT_KEY') or 'local').strip().lower()


def _database_name_is_local(name: str | None) -> bool:
    normalized = str(name or '').strip().lower()
    return bool(normalized) and any(marker in normalized for marker in ('local', 'test', 'dev'))


def reset_local_database(database_url: str | None = None) -> None:
    url = database_url or resolve_database_url(required=True)
    parsed = make_url(url)
    environment_key = _environment_key()
    if environment_key not in SAFE_ENVIRONMENT_KEYS:
        raise DatabaseConfigurationError('Refusing to reset a database outside local/dev/test.')

    if parsed.get_backend_name() == 'sqlite':
        database = parsed.database or ''
        if database in {'', ':memory:'}:
            return
        path = Path(database)
        if not path.name.endswith(('.db', '.sqlite', '.sqlite3')):
            raise DatabaseConfigurationError('Refusing to remove an SQLite file without a local DB extension.')
        path.unlink(missing_ok=True)
        return

    if parsed.get_backend_name() != 'postgresql':
        raise DatabaseConfigurationError('Only local PostgreSQL and SQLite reset are supported.')
    if parsed.host not in SAFE_POSTGRES_HOSTS or not _database_name_is_local(parsed.database):
        raise DatabaseConfigurationError('Refusing to reset a PostgreSQL database that is not clearly local/test.')

    engine = create_engine(url, future=True, isolation_level='AUTOCOMMIT')
    try:
        with engine.connect() as connection:
            connection.execute(text('DROP SCHEMA IF EXISTS public CASCADE'))
            connection.execute(text('CREATE SCHEMA public'))
            connection.execute(text('GRANT ALL ON SCHEMA public TO public'))
    finally:
        engine.dispose()


def main() -> int:
    reset_local_database()
    print('Local database reset complete.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
