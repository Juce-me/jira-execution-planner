"""Fresh PostgreSQL databases for tests, created on the TEST_DATABASE_URL server.

Each call creates an empty database named `jep_t_<32 hex>` and registers a forced
drop. Only two servers are accepted: the isolated runner's owned throwaway cluster
and the GitHub PostgreSQL job's exact synthetic service. A checkout `.env` or an
operator database is never used.
"""

from __future__ import annotations

import os
import uuid
import re
from typing import Callable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool


GITHUB_CI_TARGET = "postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_ci"


def _admin_url() -> URL:
    raw = os.environ.get("TEST_DATABASE_URL", "").strip()
    owned = os.environ.get("JEP_ISOLATED_RUNTIME") == "1" and os.environ.get("JEP_TEST_OWNED_CLUSTER") == "1"
    github = os.environ.get("GITHUB_ACTIONS") == "true" and raw == GITHUB_CI_TARGET
    if not (owned or github):
        raise RuntimeError("Per-test databases require the isolated runner's owned cluster "
                           "(tests/run_isolated_runtime_tests.py) or the GitHub PostgreSQL job.")
    url = make_url(raw) if raw else None
    if url is None or url.get_backend_name() != "postgresql":
        raise RuntimeError("TEST_DATABASE_URL must name the PostgreSQL test server.")
    return url.set(drivername="postgresql+psycopg")


def _execute_admin(statement: str, admin: URL | None = None) -> None:
    engine = create_engine(admin or _admin_url(), isolation_level="AUTOCOMMIT", poolclass=NullPool)
    try:
        with engine.connect() as connection:
            connection.execute(text(statement))
    finally:
        engine.dispose()


def owned_cluster_for_nested_snapshot() -> dict:
    """The runner's owned cluster, so a nested isolated snapshot admits it through its own guard."""
    if os.environ.get("JEP_TEST_OWNED_CLUSTER") != "1":
        raise RuntimeError("Nested snapshots need the isolated runner's owned cluster.")
    url = _admin_url()
    return {"host": url.host, "port": url.port, "user": url.username, "password": url.password,
            "adminDatabase": url.database, "runtimeDatabase": "jep_runtime",
            "binDir": os.environ.get("JEP_TEST_PG_BIN", "")}


def fresh_database_url(add_cleanup: Callable | None = None) -> str:
    """Create an empty database; `add_cleanup` (e.g. `self.addCleanup`) drops it."""
    admin = _admin_url()
    name = "jep_t_" + uuid.uuid4().hex
    _execute_admin(f'CREATE DATABASE "{name}"', admin)
    url = admin.set(database=name).render_as_string(hide_password=False)
    if add_cleanup is not None:
        # Bind the server captured now: a test may later point TEST_DATABASE_URL at this database.
        add_cleanup(drop_database, url, admin)
    return url


def drop_database(url: str, admin: URL | None = None) -> None:
    name = make_url(url).database or ""
    if not re.fullmatch(r"jep_t_[0-9a-f]{32}", name):
        raise RuntimeError("Only per-test databases may be dropped.")
    from backend.db import engine as db_engine
    db_engine.dispose_engines()
    _execute_admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)', admin)
