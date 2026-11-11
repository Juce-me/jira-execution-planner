"""Fresh PostgreSQL databases for tests, created on the TEST_DATABASE_URL server.

The empty helper creates an empty database; the database-model helper clones an
unseeded schema template. Ordinary fixtures get fresh model schemas within a
process-owned database. Databases use `jep_t_<32 hex>` names. Only two servers are
accepted: the isolated runner's owned throwaway cluster
and the GitHub PostgreSQL job's exact synthetic service. A checkout `.env` or an
operator database is never used.
"""

from __future__ import annotations

import atexit
import os
import uuid
import re
import shlex
import time
from typing import Callable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool


GITHUB_CI_TARGET = "postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_ci"
_MODEL_TEMPLATES = {}
_MODEL_SCHEMA_DATABASES = {}
_MODEL_SCHEMAS = {}
_DROPPED_MODEL_SCHEMAS = set()
_SCHEMA_ADMIN_OPTIONS = "-clock_timeout=1000 -cstatement_timeout=5000"
_FINAL_DATABASE_DROP_OPTIONS = "-clock_timeout=1000 -cstatement_timeout=15000"


def _admin_url() -> URL:
    raw = os.environ.get("TEST_DATABASE_URL", "").strip()
    schema = _MODEL_SCHEMAS.get(raw)
    captured = None
    if schema is not None and schema[0] == os.getpid():
        for key, worker in _MODEL_SCHEMA_DATABASES.items():
            if key[0] == os.getpid() and worker == schema[1]:
                captured = key[1].difference_update_query(["options", "connect_timeout", "application_name"])
                break
    owned = os.environ.get("JEP_ISOLATED_RUNTIME") == "1" and os.environ.get("JEP_TEST_OWNED_CLUSTER") == "1"
    github = os.environ.get("GITHUB_ACTIONS") == "true" and (
        raw == GITHUB_CI_TARGET or captured == make_url(GITHUB_CI_TARGET))
    if not (owned or github):
        raise RuntimeError("Per-test databases require the isolated runner's owned cluster "
                           "(tests/run_isolated_runtime_tests.py) or the GitHub PostgreSQL job.")
    url = captured if captured is not None else (make_url(raw) if raw else None)
    if url is None or url.get_backend_name() != "postgresql":
        raise RuntimeError("TEST_DATABASE_URL must name the PostgreSQL test server.")
    # Exact registered schema URLs reuse their captured stable admin: a private
    # namespace is absent in new DBs, and the worker DB may be finalized first.
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


def fresh_model_database_url(add_cleanup: Callable | None = None) -> str:
    """Clone only model DDL for fixtures requiring a distinct database.

    Migration and historical-schema tests must use ``fresh_database_url`` instead.
    Templates belong to this process and server, never a persistent cross-run cache.
    Callers must not run ``create_all`` again or seed/mutate the source template.
    """
    from backend.db import models

    admin = _admin_url()
    if os.environ.get("JEP_TEST_OWNED_CLUSTER") == "1":
        # A nested fixture may temporarily set TEST_DATABASE_URL to its own DB.
        # Use the owned cluster's stable administrative DB for template lifetime.
        admin = admin.set(database="postgres")
    metadata = models.Base.metadata
    key = (os.getpid(), admin, metadata)
    if key not in _MODEL_TEMPLATES:
        template_name = "jep_t_" + uuid.uuid4().hex
        template_url = admin.set(database=template_name).render_as_string(hide_password=False)
        try:
            _execute_admin(f'CREATE DATABASE "{template_name}"', admin)
            engine = create_engine(template_url, poolclass=NullPool)
            try:
                metadata.create_all(engine)
            finally:
                engine.dispose()
            # No client can seed or change the template. Clones explicitly allow
            # connections and remain distinct writable databases for every test.
            _execute_admin(f'ALTER DATABASE "{template_name}" ALLOW_CONNECTIONS false', admin)
        except BaseException:
            drop_database(template_url, admin)
            raise
        _MODEL_TEMPLATES[key] = template_url
    template_name = make_url(_MODEL_TEMPLATES[key]).database
    name = "jep_t_" + uuid.uuid4().hex
    url = admin.set(database=name).render_as_string(hide_password=False)
    try:
        _execute_admin(f'CREATE DATABASE "{name}" TEMPLATE "{template_name}" ALLOW_CONNECTIONS true', admin)
        if add_cleanup is not None:
            add_cleanup(drop_database, url, admin)
    except BaseException:
        drop_database(url, admin)
        raise
    return url


def _model_schema_admin_url() -> URL:
    admin = _admin_url()
    allowed = {"options", "connect_timeout", "application_name", "sslmode"}
    if set(admin.query) - allowed:
        raise RuntimeError("Model schema fixture has unsupported connection options.")
    # Validate inherited options before stripping a prior fixture's search_path.
    # Never silently discard redirect/credential options to admit another target.
    try:
        options = shlex.split(str(admin.query.get("options") or ""))
        seen = set()
        while options:
            option = options.pop(0)
            if option == "-c" and options:
                option = options.pop(0)
            elif option.startswith("-c"):
                option = option[2:]
            else:
                raise ValueError
            name, separator, value = option.partition("=")
            if not separator or name in seen:
                raise ValueError
            seen.add(name)
            if name == "search_path":
                if not re.fullmatch(r"[a-z][a-z_]{0,30}_[a-f0-9]{32}", value):
                    raise ValueError
            elif name not in {"lock_timeout", "statement_timeout"} or not value.isdigit() or not 0 < int(value) <= 60000:
                raise ValueError
    except ValueError:
        raise RuntimeError("Model schema fixture has unsupported PostgreSQL options.") from None
    database = "postgres" if os.environ.get("JEP_TEST_OWNED_CLUSTER") == "1" else admin.database
    query = {"connect_timeout": "5", "options": _SCHEMA_ADMIN_OPTIONS}
    if "sslmode" in admin.query:
        query["sslmode"] = admin.query["sslmode"]
    return admin.set(database=database, query=query)


def fresh_model_schema_url(add_cleanup: Callable | None = None) -> str:
    """Fresh model schema for audited sequential ordinary API/service fixtures.

    The process owns one disposable database per admitted server, while each call
    gets new tables/constraints/sequences and a unique URL search_path. Migration,
    database-identity and lock-race fixtures retain their separate database APIs.
    """
    from backend.db import models

    admin = _model_schema_admin_url()
    key = (os.getpid(), admin)
    if key not in _MODEL_SCHEMA_DATABASES:
        name = "jep_t_" + uuid.uuid4().hex
        worker = admin.set(database=name).render_as_string(hide_password=False)
        try:
            _execute_admin(f'CREATE DATABASE "{name}"', admin)
        except BaseException:
            try:
                drop_database(worker, admin)
            except BaseException:
                _MODEL_SCHEMA_DATABASES[key] = worker  # Final cleanup must retry.
                raise
            raise
        _MODEL_SCHEMA_DATABASES[key] = worker
    worker = _MODEL_SCHEMA_DATABASES[key]
    schema = "model_case_" + uuid.uuid4().hex
    url = make_url(worker).difference_update_query(["connect_timeout"]).update_query_dict(
        {"options": "-csearch_path=" + schema, "application_name": schema}).render_as_string(hide_password=False)
    _MODEL_SCHEMAS[url] = (os.getpid(), worker, schema)
    try:
        _execute_admin(f'CREATE SCHEMA "{schema}"', make_url(worker))
        engine = create_engine(url, poolclass=NullPool)
        try:
            # CREATE SCHEMA succeeded without IF NOT EXISTS: this namespace is
            # proven fresh. Recreate real DDL, including FKs/defaults/sequences.
            models.Base.metadata.create_all(engine, checkfirst=False)
        finally:
            engine.dispose()
        if add_cleanup is not None:
            add_cleanup(drop_model_schema, url)
    except BaseException:
        drop_model_schema(url)
        raise
    return url


def drop_model_schema(url: str) -> None:
    """Bounded cleanup of an exact schema allocated by this process.

    Checked-out transactions holding schema objects cause a visible timeout; this
    function never terminates another connection. Final worker cleanup owns the
    only FORCE drop, and retains the failure even if it removes the worker DB.
    """
    if (os.getpid(), url) in _DROPPED_MODEL_SCHEMAS:
        return
    record = _MODEL_SCHEMAS.get(url)
    if record is None or record[0] != os.getpid():
        raise RuntimeError("Model schema is not owned by this process.")
    _, worker, schema = record
    from backend.db import engine as db_engine
    db_engine.dispose_engines()
    engine = create_engine(make_url(worker), isolation_level="AUTOCOMMIT", poolclass=NullPool)
    try:
        with engine.connect() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            # A session-level advisory lock can survive without holding a table
            # lock, so DROP SCHEMA alone does not prove fixture connections ended.
            # Allow only a bounded drain after closing pooled connections; never
            # terminate another connection at per-case cleanup.
            deadline = time.monotonic() + 1
            while connection.execute(text('''
                SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database() AND application_name = :schema
                      AND pid <> pg_backend_pid())
            '''), {"schema": schema}).scalar_one():
                if time.monotonic() >= deadline:
                    raise RuntimeError("Model schema has active fixture connections after cleanup.")
                time.sleep(0.01)
    finally:
        engine.dispose()
    del _MODEL_SCHEMAS[url]
    _DROPPED_MODEL_SCHEMAS.add((os.getpid(), url))


def cleanup_model_fixtures() -> None:
    """Remove this process's schemas, worker DBs and old model templates.

    Retry failed schema drops first, then FORCE-drop only registered owned worker
    DBs to remove residual connections/resources. Any cleanup failure still makes
    the gate fail, even when the final database drop succeeds.
    """
    failure = None
    for url, record in list(_MODEL_SCHEMAS.items()):
        if record[0] != os.getpid():
            continue
        try:
            drop_model_schema(url)
        except Exception as error:
            failure = error if failure is None else failure
    for key, worker in list(_MODEL_SCHEMA_DATABASES.items()):
        if key[0] != os.getpid():
            continue
        try:
            # DROP DATABASE waits for a checkpoint after many schema lifecycles.
            # Bound that final owned operation separately from per-case DDL.
            admin = key[1].update_query_dict({"options": _FINAL_DATABASE_DROP_OPTIONS})
            drop_database(worker, admin)
        except Exception as error:
            failure = error if failure is None else failure
        else:
            del _MODEL_SCHEMA_DATABASES[key]
            for url, record in list(_MODEL_SCHEMAS.items()):
                if record[0] == os.getpid() and record[1] == worker:
                    del _MODEL_SCHEMAS[url]
                    _DROPPED_MODEL_SCHEMAS.add((os.getpid(), url))
    try:
        cleanup_model_templates()
    except Exception as error:
        failure = error if failure is None else failure
    if failure is not None:
        raise failure


def cleanup_model_templates() -> None:
    """Drop this process's templates using captured targets; failures propagate.

    The isolated test runner calls this before reporting success. The atexit
    fallback supports ordinary unittest entry points; cluster teardown remains
    the final cleanup if a process is forcibly interrupted.
    """
    failure = None
    for key, url in list(_MODEL_TEMPLATES.items()):
        if key[0] != os.getpid():
            continue  # A forked child must never drop its parent's template.
        try:
            drop_database(url, key[1])
        except Exception as error:
            failure = error if failure is None else failure
        else:
            del _MODEL_TEMPLATES[key]
    if failure is not None:
        raise failure


def drop_database(url: str, admin: URL | None = None) -> None:
    name = make_url(url).database or ""
    if not re.fullmatch(r"jep_t_[0-9a-f]{32}", name):
        raise RuntimeError("Only per-test databases may be dropped.")
    from backend.db import engine as db_engine
    db_engine.dispose_engines()
    _execute_admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)', admin)


atexit.register(cleanup_model_templates)
atexit.register(cleanup_model_fixtures)
