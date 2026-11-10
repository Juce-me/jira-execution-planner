"""Pre-import guards installed only in an owned synthetic test checkout."""

import importlib.abc
import importlib.machinery
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys


try:
    config = json.loads(Path(__file__).with_name("isolation.json").read_text())
    child_environment = json.loads(Path(__file__).with_name("environment.json").read_text())
except (OSError, ValueError, TypeError):
    raise SystemExit("Isolated-test startup configuration is invalid.") from None
snapshot = Path(config["snapshot"]).resolve()
original = Path(config["original"]).resolve()
bootstrap = Path(__file__).resolve().parent
private_names = {
    "dashboard-config.json", "team-groups.json", "team-catalog.json", "teams.json",
    "sprints_cache.json", "stats_cache.json", "scenario-overrides.json",
    ".netrc", "_netrc", ".pgpass", "pgpass.conf", ".pg_service.conf", "pg_service.conf",
    "application_default_credentials.json",
    ".oauth-token-store.json", ".oauth-token-store.json.tmp",
}


def owned(path):
    return path.is_relative_to(snapshot)


def network_target(host, port):
    # Fixtures register a concrete owned listener after binding an ephemeral port.
    # Re-read only this synthetic registry so newly started fixtures are visible.
    current = json.loads(bootstrap.joinpath("isolation.json").read_text())
    endpoints = current.get("fixtureEndpoints", [])
    endpoints += [current["postgres"]] if current.get("postgres") else []
    return any(host == item["host"] and int(port or 0) == item["port"] for item in endpoints)


def audit(event, args):
    if event == "open" and args and isinstance(args[0], (str, bytes, os.PathLike)):
        path = Path(os.fsdecode(args[0])).resolve()
        credential = (path.name.startswith(".env") or path.name in private_names
                      or ("token" in path.name.lower() and path.suffix == ".json")
                      or {".aws", ".ssh", ".secrets", "secrets"}.intersection(path.parts)
                      or any(path.parts[index:index + 2] == (".config", "gcloud") for index in range(len(path.parts))))
        original_source = path.is_relative_to(original) and not owned(path) and (
            path.name == "jira_server.py" or any(part in {"backend", "tests", "planning"} for part in path.relative_to(original).parts[:-1])
        )
        if not owned(path) and (credential or original_source):
            raise PermissionError("Live credential/source access is forbidden in isolated tests.")
    if event == "sqlite3.connect":  # sqlite-refusal-check
        raise PermissionError("SQLite is retired; tests use the owned PostgreSQL cluster.")
    if event in {"socket.connect", "socket.getaddrinfo"}:
        address = args[1] if event == "socket.connect" else args[:2]
        if isinstance(address, tuple):
            host, port = address[:2]
            # Loopback name resolution is harmless; the subsequent connect still
            # requires a registered endpoint. External DNS is denied by default.
            allowed = event == "socket.getaddrinfo" and host in {"127.0.0.1", "localhost", "::1", None}
            allowed = allowed or network_target(host, port)
            if not allowed:
                raise PermissionError("Non-fixture networking is forbidden in isolated tests.")
        elif isinstance(address, str):
            raise PermissionError("Unix socket connections require a fixture-specific allowance.")


def postgres_target(parameters):
    target = config.get("postgres")
    if not target:
        raise PermissionError("PostgreSQL networking requires an approved disposable test target.")
    allowed = {"host", "port", "dbname", "user", "password", "options", "connect_timeout", "application_name", "sslmode"}
    if set(parameters) - allowed:
        raise PermissionError("PostgreSQL test connection has unsupported credential/file options.")
    # An owned throwaway cluster admits its admin/runtime databases and per-test
    # `jep_t_<hex>` databases; a descriptor target admits only its one database.
    owned_cluster = target.get("owned") is True
    names = ("host", "user", "password") if owned_cluster else ("host", "dbname", "user", "password")
    if any(str(parameters.get(name, "")) != str(target[name]) for name in names):
        raise PermissionError("PostgreSQL test connection does not match its approved target.")
    if owned_cluster and not re.fullmatch(r"postgres|jep_runtime|jep_t_[0-9a-f]{32}", str(parameters.get("dbname", ""))):
        raise PermissionError("PostgreSQL test database is outside the owned cluster namespace.")
    if str(parameters.get("port", "5432")) != str(target["port"]):
        raise PermissionError("PostgreSQL test connection does not match its approved target.")
    options = shlex.split(str(parameters.get("options") or ""))
    settings = {}
    while options:
        option = options.pop(0)
        if option == "-c" and options:
            option = options.pop(0)
        elif option.startswith("-c"):
            option = option[2:]
        else:
            raise PermissionError("PostgreSQL test connection has unsupported options.")
        name, separator, value = option.partition("=")
        if not separator or name in settings or name not in {"search_path", "statement_timeout", "lock_timeout"}:
            raise PermissionError("PostgreSQL test connection has unsupported options.")
        settings[name] = value
    schema = settings.get("search_path")
    if schema is not None:
        approved = schema == target.get("schema")
        approved = approved or (target.get("schemaPrefix") == "review_race_"
                                and bool(re.fullmatch(r"review_race_[a-f0-9]{32}", schema)))
        approved = approved or (owned_cluster and bool(re.fullmatch(r"[a-z][a-z_]{0,30}_[a-f0-9]{32}", schema)))
        if not approved:
            raise PermissionError("PostgreSQL test schema is outside its approved namespace.")
    # Unscoped administrative connections are allowed only to the explicitly
    # disposable database so the named race suite can create/drop its own schema.
    for name in ("statement_timeout", "lock_timeout"):
        if name in settings and (not settings[name].isdigit() or not 0 < int(settings[name]) <= 60000):
            raise PermissionError("PostgreSQL test wait bounds are invalid.")


def guard_postgres_module(module):
    parser = module.conninfo.conninfo_to_dict if module.__name__ == "psycopg" else module.extensions.parse_dsn

    def wrap(original_connect):
        def connect(conninfo="", **kwargs):
            if not config.get("postgres"):
                postgres_target({})
            try:
                parameters = parser(conninfo)
                # SQLAlchemy's psycopg dialect supplies its in-memory adapter
                # map as a driver context, not as a libpq connection option.
                # Validate that one typed argument separately and still pass
                # every actual connection option through the target guard.
                if 'context' in kwargs:
                    if module.__name__ != 'psycopg' or not isinstance(kwargs['context'], module.adapt.AdaptersMap):
                        raise PermissionError('PostgreSQL adapter context is invalid.')
                    parameters.update({name: value for name, value in kwargs.items() if name != 'context'})
                else:
                    parameters.update(kwargs)
                postgres_target(parameters)
            except Exception:
                raise PermissionError("PostgreSQL test connection is not approved.") from None
            return original_connect(conninfo, **kwargs)
        return connect

    module.connect = wrap(module.connect)
    if module.__name__ == "psycopg":
        for name in ("Connection", "AsyncConnection"):
            connection = getattr(module, name)
            guarded = wrap(connection.connect)
            connection.connect = classmethod(lambda cls, *args, _guarded=guarded, **kwargs: _guarded(*args, **kwargs))


class PostgresLoader(importlib.abc.Loader):
    def __init__(self, delegate):
        self.delegate = delegate

    def create_module(self, spec):
        return self.delegate.create_module(spec) if hasattr(self.delegate, "create_module") else None

    def exec_module(self, module):
        self.delegate.exec_module(module)
        guard_postgres_module(module)


class SourceBoundary(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in {"psycopg", "psycopg2"}:
            spec = importlib.machinery.PathFinder.find_spec(fullname, path)
            if spec is not None and spec.loader is not None:
                spec.loader = PostgresLoader(spec.loader)
            return spec
        if fullname.split(".", 1)[0] not in {"jira_server", "backend", "tests", "planning"}:
            return None
        search = [str(snapshot)] if path is None else path
        spec = importlib.machinery.PathFinder.find_spec(fullname, search)
        if spec is None or (spec.origin and spec.origin != "namespace" and not owned(Path(spec.origin).resolve())):
            raise ImportError("Application/test imports must resolve inside the synthetic checkout.")
        return spec


sys.addaudithook(audit)
sys.meta_path.insert(0, SourceBoundary())
for module_name, module in list(sys.modules.items()):
    if module_name.split(".", 1)[0] in {"jira_server", "backend", "tests", "planning"}:
        origin = getattr(module, "__file__", None)
        if origin and not owned(Path(origin).resolve()):
            raise SystemExit("Application/test module was imported outside the synthetic checkout.")
    if module_name in {"psycopg", "psycopg2"}:
        guard_postgres_module(module)
original_popen = subprocess.Popen.__init__


def guarded_popen(self, args, *positional, **kwargs):
    # Fixtures can supply a clear/custom environment, but cannot accidentally drop
    # the pre-import guards from a new Python interpreter launched through Popen.
    env = dict(kwargs["env"]) if kwargs.get("env") is not None else dict(child_environment)
    child_bootstrap, child_snapshot = bootstrap, snapshot
    # Runner regression tests deliberately create a second owned snapshot. Keep
    # that more-specific boundary instead of replacing it with the outer one.
    candidate = Path(env.get("PYTHONPATH", "").split(os.pathsep)[0]).resolve()
    if env.get("JEP_ISOLATED_RUNTIME") == "1" and owned(candidate) and candidate != bootstrap:
        nested_path = candidate / "isolation.json"
        if nested_path.is_file():
            nested = json.loads(nested_path.read_text())
            nested_snapshot = Path(nested["snapshot"]).resolve()
            if owned(nested_snapshot) and candidate.is_relative_to(nested_snapshot):
                child_bootstrap, child_snapshot = candidate, nested_snapshot
    env["PYTHONPATH"] = str(child_bootstrap) + os.pathsep + str(child_snapshot)
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["JEP_ISOLATED_RUNTIME"] = "1"
    env["HOME"] = str(child_snapshot / "tmp/isolated-runtime/home")
    env["TMPDIR"] = str(child_snapshot / "tmp/isolated-runtime")
    kwargs["env"] = env
    if isinstance(args, (list, tuple)) and args and "python" in Path(str(args[0])).name:
        if any(value in {"-I", "-S", "-E"} for value in args[1:]):
            raise PermissionError("Python child cannot disable isolated-test startup guards.")
    return original_popen(self, args, *positional, **kwargs)


subprocess.Popen.__init__ = guarded_popen
