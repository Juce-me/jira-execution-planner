"""Run backend tests in a synthetic source checkout, without inheriting app settings.

Usage: python tests/run_isolated_runtime_tests.py [--include new/source.py] tests.test_name
Browser fixtures may reuse prepare_snapshot() and synthetic_environment().
This isolates accidental fixture I/O; it is not a sandbox for untrusted test code.
PostgreSQL is the only database: by default the runner provisions an owned
throwaway cluster (tests/postgres_cluster.py); --postgres uses an approved
disposable-target descriptor instead. SQLite connections are refused. The PostgreSQL
driver guards cover the application's ordinary driver entrypoints. They do not
constrain arbitrary native code or non-Python programs.
"""

from __future__ import annotations

import argparse
import base64
from contextlib import ExitStack, contextmanager
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = "tests/isolated_runtime_sitecustomize.py"
RUNNER = "tests/run_isolated_runtime_tests.py"
CHILD_RUNNER = "tests/runtime_test_runner.py"
PRIVATE_NAMES = {
    "dashboard-config.json", "team-groups.json", "team-catalog.json", "teams.json",
    "sprints_cache.json", "stats_cache.json", "scenario-overrides.json",
    ".netrc", "_netrc", ".pgpass", "pgpass.conf", ".pg_service.conf", "pg_service.conf",
    "application_default_credentials.json",
    ".oauth-token-store.json", ".oauth-token-store.json.tmp",
}
PRIVATE_PARTS = {".git", ".aws", ".ssh", ".agents", ".codex", ".secrets", "secrets"}


class IsolationError(RuntimeError):
    """A synthetic test run cannot be prepared safely."""


@contextmanager
def runtime_directory(parent, *, prefix):
    """Clean snapshots unless owned PostgreSQL shutdown requires preserving data."""
    directory = Path(tempfile.mkdtemp(prefix=prefix, dir=parent))
    try:
        yield directory
    except BaseException as error:
        if not getattr(error, 'preserve_directory', False):
            shutil.rmtree(directory)
        raise
    else:
        shutil.rmtree(directory)


def allowed_source(relative):
    path = Path(relative)
    return (
        not path.is_absolute() and ".." not in path.parts
        and not PRIVATE_PARTS.intersection(path.parts)
        and not any(path.parts[index:index + 2] == (".config", "gcloud") for index in range(len(path.parts)))
        and not (path.name.startswith(".env") and path.name != ".env.example")
        and not ("token" in path.name.lower() and path.suffix == ".json")
        and path.name not in PRIVATE_NAMES
    )


def tracked_sources(repo):
    result = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-z"], capture_output=True,
        check=False, env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1",
                          "GIT_CONFIG_GLOBAL": os.devnull},
    )
    if result.returncode:
        raise IsolationError("Cannot enumerate tracked test source.")
    return [name for name in result.stdout.decode().split("\0") if name]


def prepare_snapshot(repo, destination, *, include_new=(), include_frontend=True):
    """Copy tracked working-tree source and individually reviewed new source files.

    Never copy arbitrary untracked directories. The destination must be new and
    owned by the caller; callers should remove it after their server/tests stop.
    """
    repo, destination = Path(repo).resolve(), Path(destination).resolve()
    if destination.exists():
        raise IsolationError("Snapshot destination must not exist.")
    additions = {RUNNER, BOOTSTRAP, CHILD_RUNNER, *include_new}
    if any(not allowed_source(name) for name in additions):
        raise IsolationError("New-source allowlist contains a forbidden path.")
    files = set(tracked_sources(repo)) | additions
    for name in additions:
        candidate = repo / name
        if not candidate.is_file() or candidate.is_symlink():
            raise IsolationError("An allowlisted new source file is absent or a symlink.")
    destination.mkdir(parents=True)
    for name in sorted(files):
        if not allowed_source(name):
            continue
        source = repo / name
        validate_source_path(repo, source)
        if source.is_symlink():
            # Instruction aliases are safe only when they target this checkout.
            resolved = source.resolve()
            if not resolved.is_relative_to(repo) or not allowed_source(resolved.relative_to(repo)):
                raise IsolationError("Tracked source symlink escapes the approved checkout.")
        if not source.is_file():
            continue  # Working-tree deletions must remain deleted in the snapshot.
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(source.stat().st_mode & 0o777)
        source_mtime = source.stat().st_mtime_ns
        os.utime(target, ns=(source_mtime, source_mtime))
    if include_frontend and (repo / "frontend/dist").is_dir():
        validate_source_path(repo, repo / "frontend/dist", allow_leaf_symlink=False)
        for source_input in (repo / "package-lock.json", repo / "frontend/src"):
            if source_input.exists():
                validate_source_path(repo, source_input, allow_leaf_symlink=False)
        inputs = [repo / "package-lock.json", *(repo / "frontend/src").rglob("*")]
        newest_source = max((p.stat().st_mtime for p in inputs if p.is_file()), default=0)
        build = list((repo / "frontend/dist").rglob("*"))
        outputs = [p for p in build if p.is_file()]
        for output in build:
            validate_source_path(repo, output, allow_leaf_symlink=False)
        if not outputs or any(p.is_symlink() for p in build):
            raise IsolationError("Frontend test build is empty or contains symlinks.")
        if any(p.stat().st_mtime < newest_source for p in outputs):
            raise IsolationError("Rebuild frontend output from the working-tree source before testing.")
        shutil.copytree(repo / "frontend/dist", destination / "frontend/dist", dirs_exist_ok=True)
    private = destination / "tmp/isolated-runtime"
    private.mkdir(parents=True)
    (private / "home").mkdir()
    bootstrap = private / "bootstrap"
    bootstrap.mkdir()
    shutil.copyfile(destination / BOOTSTRAP, bootstrap / "sitecustomize.py")
    (bootstrap / "isolation.json").write_text(json.dumps({
        "snapshot": str(destination), "original": str(repo), "postgres": None,
        "fixtureEndpoints": [],
    }), encoding="utf-8")
    (destination / ".env").write_text("# Synthetic runtime-test checkout; no operator configuration.\n", encoding="utf-8")
    return destination


def validate_source_path(repo, source, *, allow_leaf_symlink=True):
    relative = source.relative_to(repo)
    current = repo
    for part in relative.parts[:-1]:
        current /= part
        if current.is_symlink():
            raise IsolationError("Source ancestor symlinks are not copied into tests.")
    if not source.resolve().is_relative_to(repo) or (source.is_symlink() and not allow_leaf_symlink):
        raise IsolationError("Source/build path escapes the approved checkout.")


def register_fixture_endpoint(snapshot, host, port):
    """Register a fixture's already-owned loopback listener before making requests."""
    if host not in {"127.0.0.1", "localhost", "::1"} or not isinstance(port, int) or not 0 < port < 65536:
        raise IsolationError("Fixture networking requires a concrete owned loopback endpoint.")
    config_path = Path(snapshot) / "tmp/isolated-runtime/bootstrap/isolation.json"
    config = json.loads(config_path.read_text())
    endpoints = config.setdefault("fixtureEndpoints", [])
    endpoint = {"host": host, "port": port}
    if endpoint not in endpoints:
        endpoints.append(endpoint)
    config_path.write_text(json.dumps(config), encoding="utf-8")


def approved_postgres(path):
    """Read only the operator-selected disposable-target descriptor, never .env."""
    if not path:
        raise IsolationError("PostgreSQL mode requires an explicit disposable-target descriptor.")
    path = Path(path).absolute()
    # Validate metadata before reading: a harmless alias must not redirect this
    # explicit descriptor input into an operator credential file.
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            raise IsolationError("PostgreSQL descriptor must use a direct canonical file path.")
    path = path.resolve()
    private_directory = {".aws", ".ssh", ".secrets", "secrets"}.intersection(path.parts)
    gcloud_directory = any(path.parts[index:index + 2] == (".config", "gcloud") for index in range(len(path.parts)))
    if (path.name.startswith(".env") or path.name in PRIVATE_NAMES or private_directory or gcloud_directory
            or ("token" in path.name.lower() and path.suffix == ".json")):
        raise IsolationError("Use a separate approved test-target descriptor.")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("url"), str):
            raise ValueError
        parsed = urlsplit(data["url"])
        port = parsed.port
        hostname = parsed.hostname
    except (OSError, ValueError, KeyError, TypeError):
        raise IsolationError("Invalid PostgreSQL test-target descriptor.") from None
    schema = data.get("schema")
    race_prefix = data.get("schemaPrefix")
    valid_schema = bool(schema and re.fullmatch(r"test_[a-z0-9_]+", str(schema)))
    valid_race = race_prefix == "review_race_" and not schema
    if (data.get("approvedDisposable") is not True or not (valid_schema or valid_race)
            or parsed.scheme not in {"postgresql", "postgresql+psycopg"}
            or not hostname or not parsed.path.strip("/") or (port is not None and not 0 < port < 65536)
            or not parsed.username or not parsed.password or parsed.query or parsed.fragment
            or (race_prefix is not None and race_prefix != "review_race_")):
        raise IsolationError("PostgreSQL descriptor must approve one disposable target and an owned test schema.")
    return data, parsed


def approved_node(path):
    """Use an explicit pinned tool path, never the operator's process settings."""
    if path is None:
        return None
    binary = Path(path).resolve()
    if not binary.is_file():
        raise IsolationError("An explicit Node 20 executable is required.")
    try:
        result = subprocess.run([str(binary), "--version"], capture_output=True, text=True,
                                timeout=5, env={"PATH": str(binary.parent)})
    except (OSError, subprocess.TimeoutExpired):
        raise IsolationError("The selected Node executable is unavailable.") from None
    if result.returncode or not re.fullmatch(r"v20\.\d+\.\d+\s*", result.stdout):
        raise IsolationError("Runtime tests require the pinned Node 20 toolchain.")
    return binary


def synthetic_environment(snapshot, *, postgres=None, cluster=None, node=None):
    snapshot = Path(snapshot).resolve()
    private = snapshot / "tmp/isolated-runtime"
    if postgres and cluster:
        raise IsolationError("Use either an approved descriptor or the owned cluster, not both.")
    database_url = test_database_url = ""
    if cluster:
        server = f"postgresql+psycopg://{cluster['user']}:{cluster['password']}@{cluster['host']}:{cluster['port']}/"
        database_url = server + cluster["runtimeDatabase"]
        test_database_url = server + cluster["adminDatabase"]
    env = {
        "PATH": str(Path(sys.executable).parent) + ":/usr/bin:/bin",
        "HOME": str(private / "home"), "TMPDIR": str(private),
        "PYTHONPATH": str(private / "bootstrap") + os.pathsep + str(snapshot),
        "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
        "JEP_ISOLATED_RUNTIME": "1", "JEP_TEST_PYTHON": sys.executable,
        "JIRA_AUTH_MODE": "atlassian_oauth", "CONFIG_STORAGE_BACKEND": "db",
        "JIRA_URL": "https://example.atlassian.net", "APP_ENVIRONMENT_KEY": "local",
        "APP_BIND_HOST": "127.0.0.1", "APP_ALLOWED_ORIGINS": "http://127.0.0.1:5050",
        "ATLASSIAN_CLIENT_ID": "synthetic-client", "ATLASSIAN_CLIENT_SECRET": "synthetic-secret",
        "ATLASSIAN_REDIRECT_URI": "http://127.0.0.1:5050/api/auth/atlassian/callback",
        "FLASK_SECRET_KEY": "synthetic-test-signing-key",
        "TOKEN_ENCRYPTION_MASTER_KEY_B64": base64.b64encode(bytes(range(32))).decode(),
        "TOKEN_ENCRYPTION_KEY_SOURCE": "env", "TOKEN_ENCRYPTION_KEY_ID": "synthetic-key",
        "DATABASE_URL": database_url, "TEST_DATABASE_URL": test_database_url,
        "GA4_ENABLED": "false", "ANALYTICS_ENABLED": "false",
    }
    if node is not None:
        env["PATH"] = str(Path(node).parent) + os.pathsep + env["PATH"]
    if cluster:
        env.update({"JEP_TEST_PG_BIN": cluster["binDir"], "JEP_TEST_OWNED_CLUSTER": "1",
                    "REQUIRE_POSTGRES_REVIEW_CONCURRENCY": "1",
                    "REQUIRE_POSTGRES_CATALOG_CONCURRENCY": "1", "REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY": "1"})
        config_path = private / "bootstrap/isolation.json"
        config = json.loads(config_path.read_text())
        config["postgres"] = {
            "host": cluster["host"], "port": cluster["port"], "dbname": cluster["adminDatabase"],
            "user": cluster["user"], "password": cluster["password"], "owned": True,
            "schema": None, "schemaPrefix": None,
        }
        config_path.write_text(json.dumps(config), encoding="utf-8")
    if postgres:
        data, parsed = postgres
        env.update({"DATABASE_URL": data["url"], "TEST_DATABASE_URL": data["url"],
                    "REQUIRE_POSTGRES_REVIEW_CONCURRENCY": "1"})
        if data.get("schema"):
            env["PGOPTIONS"] = "-c search_path=" + data["schema"]
        config_path = private / "bootstrap/isolation.json"
        config = json.loads(config_path.read_text())
        config["postgres"] = {
            "host": parsed.hostname, "port": parsed.port or 5432,
            "dbname": unquote(parsed.path.lstrip("/")), "user": unquote(parsed.username),
            "password": unquote(parsed.password), "schema": data.get("schema"),
            "schemaPrefix": data.get("schemaPrefix"),
        }
        config_path.write_text(json.dumps(config), encoding="utf-8")
    (private / "bootstrap/environment.json").write_text(json.dumps(env), encoding="utf-8")
    return env


def load_cluster_module():
    """Load the owned-cluster helper from this checkout without importing the tests package."""
    spec = importlib.util.spec_from_file_location("jep_postgres_cluster", ROOT / "tests/postgres_cluster.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_output(value, postgres=None):
    if postgres:
        # libpq/SQLAlchemy diagnostics can independently expose host/user/database
        # or encoded DSN fragments. Report only fixed-format test summaries.
        lines = [line for line in value.splitlines() if re.fullmatch(
            r"Ran \d+ tests? in [\d.]+s|OK(?: \(skipped=\d+\))?|FAILED \([a-z=, 0-9]+\)"
            r"|JEP_TEST_TIMING (?:module=[A-Za-z_][A-Za-z0-9_.]* tests=\d+|test=[A-Za-z_][A-Za-z0-9_.]*|phase=discovery) seconds=\d+\.\d{3}"
            r"|JEP_TEST_PROGRESS module=[A-Za-z_][A-Za-z0-9_.]* tests=\d+ seconds=\d+\.\d{3}"
            r"|JEP_TEST_INVENTORY tests=\d+"
            r"|Model database (?:template|fixture) cleanup failed\.", line)]
        return "\n".join(lines) + ("\n" if lines else "")
    return re.sub(r"postgres(?:ql)?(?:\+[a-z0-9]+)?://[^\s\"']+", "[test database]", value)


def run_test_process(command, snapshot, env, postgres=None):
    """Own the test process group until it exits, including on interruption."""
    with subprocess.Popen(command, cwd=snapshot, env=env, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, start_new_session=True) as child:
        try:
            if postgres:
                output, _ = child.communicate()
                print(safe_output(output, postgres), end='', flush=True)
            else:
                for line in child.stdout:
                    print(safe_output(line), end='', flush=True)
                child.wait()
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            finally:
                # The leader may exit before a test's subprocess. Kill any
                # remaining members of this group before cluster teardown.
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
            raise
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            return child.returncode
        # A successful leader does not make abandoned background tests safe.
        # Dispose its owned process group before the caller stops PostgreSQL.
        print('Isolated runtime test child left background processes.', file=sys.stderr)
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return 1


def reviewed_test_modules(repo, include_new=(), selectors=()):
    repo = Path(repo).resolve()
    additions = set(map(str, include_new))

    def reviewed_file(name, *, new=False):
        if not allowed_source(name):
            return False
        source = repo / name
        validate_source_path(repo, source, allow_leaf_symlink=not new)
        if source.is_symlink() and not allowed_source(source.resolve().relative_to(repo)):
            raise IsolationError('Tracked test source symlink targets a forbidden path.')
        return source.is_file()

    if any(not reviewed_file(name, new=True) for name in additions):
        raise IsolationError('A reviewed include is forbidden, missing or a symlink.')
    sources = set(tracked_sources(repo)) | additions
    modules = set()
    for name in sources:
        path = Path(name)
        if (not path.parts or path.parts[0] != 'tests' or not path.name.startswith('test_')
                or path.suffix != '.py' or not reviewed_file(name)):
            continue
        package = path.parent
        while package != Path('.'):
            initializer = (package / '__init__.py').as_posix()
            if initializer not in sources or not reviewed_file(initializer):
                break
            if package == Path('tests'):
                modules.add('.'.join(path.with_suffix('').parts))
                break
            package = package.parent
    selected = list(selectors) if selectors else sorted(modules)
    if not selected or len(set(selected)) != len(selected) or any(name not in modules for name in selected):
        raise IsolationError('Parallel selectors must be unique reviewed test modules; use one worker for cases.')
    return selected


def load_shard_module():
    spec = importlib.util.spec_from_file_location('isolated_runtime_shards', ROOT / 'tests/runtime_shards.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include", action="append", default=[], metavar="NEW_SOURCE")
    parser.add_argument("--postgres", action="store_true")
    parser.add_argument("--postgres-config", type=Path)
    parser.add_argument("--node", type=Path, help="Explicit Node 20 executable for suites using frontend tools")
    parser.add_argument("--timings", action="store_true", help="Report sanitized phase and test-case timings")
    parser.add_argument("--workers", type=int, default=1, choices=range(1, 9), metavar="1..8")
    parser.add_argument("modules", nargs="*")
    args = parser.parse_args(argv)
    started = time.perf_counter()
    phases = {}
    try:
        pg = approved_postgres(args.postgres_config) if args.postgres else None
        node = approved_node(args.node)
        if args.postgres_config and not args.postgres:
            raise IsolationError("A PostgreSQL descriptor requires --postgres.")
        if args.workers > 1:
            if pg:
                raise IsolationError('Parallel workers require separately owned clusters, not an external descriptor.')
            modules = reviewed_test_modules(ROOT, args.include, args.modules)
            report = load_shard_module().run_shards(ROOT, modules, workers=args.workers,
                                                   include_new=args.include, node=node, timings=args.timings)
            return report['status']
        scratch = ROOT / "tmp"
        scratch.mkdir(exist_ok=True)
        with runtime_directory(scratch, prefix="isolated-runtime-") as temporary:
            phase_started = time.perf_counter()
            snapshot = prepare_snapshot(ROOT, Path(temporary) / "checkout", include_new=args.include)
            phases['snapshot'] = time.perf_counter() - phase_started
            with ExitStack() as stack:
                def interrupt(_signal, _frame):
                    raise KeyboardInterrupt

                # SIGTERM unwinds the stack so the owned cluster is always stopped and removed.
                stack.callback(signal.signal, signal.SIGTERM, signal.signal(signal.SIGTERM, interrupt))
                cluster = None
                phase_started = time.perf_counter()
                if not pg:
                    clusters = load_cluster_module()
                    try:
                        cluster = stack.enter_context(clusters.owned_cluster(snapshot / "tmp/isolated-runtime/postgres"))
                    except clusters.ClusterError as error:
                        refused = IsolationError(str(error))
                        refused.preserve_directory = getattr(error, 'preserve_directory', False)
                        raise refused from None
                phases['cluster'] = time.perf_counter() - phase_started
                env = synthetic_environment(snapshot, postgres=pg, cluster=cluster, node=node)
                command = [sys.executable, "-s", "-m", "tests.runtime_test_runner"]
                if args.timings:
                    command.append('--timings')
                command.extend(args.modules)
                phase_started = time.perf_counter()
                status = run_test_process(command, snapshot, env, pg)
                phases['child'] = time.perf_counter() - phase_started
            if pg and status:
                print("PostgreSQL test failed; connection diagnostics withheld.", file=sys.stderr)
            return status
    except IsolationError as error:
        print("Isolated runtime tests refused: " + str(error), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print('Isolated runtime tests interrupted; owned resources cleaned up.', file=sys.stderr)
        return 130
    except RuntimeError as error:
        if not getattr(error, 'preserve_directory', False):
            raise
        print('Isolated runtime cleanup failed; owned directory preserved.', file=sys.stderr)
        return 2
    finally:
        if args.timings:
            total = time.perf_counter() - started
            for name, seconds in phases.items():
                print(f'JEP_RUNTIME_PHASE phase={name} seconds={seconds:.3f}', flush=True)
            remainder = max(0, total - sum(phases.values()))
            print(f'JEP_RUNTIME_PHASE phase=preparation-and-cleanup seconds={remainder:.3f}', flush=True)
            print(f'JEP_RUNTIME_PHASE phase=total seconds={total:.3f}', flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
