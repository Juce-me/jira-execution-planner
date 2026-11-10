"""Owned, throwaway PostgreSQL cluster for isolated tests and browser fixtures.

The cluster lives under a caller-owned directory, listens on 127.0.0.1 only (no
Unix socket: long snapshot paths exceed the socket path limit), uses a random
password and is stopped and removed when the context exits. It never reads the
operator's PostgreSQL environment, service or password files.
"""

from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
from typing import Iterator, Mapping


ADMIN_DATABASE = "postgres"
RUNTIME_DATABASE = "jep_runtime"
USER = "jep_test"
REQUIRED_BINARIES = ("initdb", "pg_ctl", "createdb")


class ClusterError(RuntimeError):
    """The owned test cluster could not be provisioned."""


def postgres_bin_dir(environ: Mapping[str, str] | None = None) -> Path:
    env = os.environ if environ is None else environ
    candidates = []
    if env.get("JEP_TEST_PG_BIN"):
        candidates.append(Path(env["JEP_TEST_PG_BIN"]))
    found = shutil.which("initdb", path=env.get("PATH") or None)
    if found:
        candidates.append(Path(found).parent)
    pg_config = shutil.which("pg_config", path=env.get("PATH") or None)
    if pg_config:
        result = subprocess.run([pg_config, "--bindir"], capture_output=True, text=True,
                                env={"PATH": "/usr/bin:/bin"})
        if result.returncode == 0 and result.stdout.strip():
            candidates.append(Path(result.stdout.strip()))
    for candidate in candidates:
        if all((candidate / name).is_file() for name in REQUIRED_BINARIES):
            return candidate.resolve()
    raise ClusterError("PostgreSQL server binaries (initdb, pg_ctl, createdb) are required; "
                       "put them on PATH or set JEP_TEST_PG_BIN.")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _run(bin_dir: Path, args: list[str], *, password: str | None = None) -> subprocess.CompletedProcess:
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "LC_ALL": "C", "LANG": "C"}
    if password is not None:
        env["PGPASSWORD"] = password
    return subprocess.run([str(bin_dir / args[0]), *args[1:]], capture_output=True, text=True, env=env)


@contextmanager
def owned_cluster(base: Path, environ: Mapping[str, str] | None = None) -> Iterator[dict]:
    bin_dir = postgres_bin_dir(environ)
    base = Path(base)
    base.mkdir(parents=True, exist_ok=False)
    data = base / "data"
    password = secrets.token_hex(24)
    password_file = base / "initdb-password"
    descriptor = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(password)
    try:
        result = _run(bin_dir, ["initdb", "-D", str(data), "-U", USER, "--auth=scram-sha-256",
                                f"--pwfile={password_file}", "--no-sync", "--no-instructions",
                                "-E", "UTF8", "--locale=C"])
    finally:
        password_file.unlink(missing_ok=True)
    if result.returncode:
        shutil.rmtree(base, ignore_errors=True)
        raise ClusterError("initdb failed for the owned test cluster.")
    started, port = False, 0
    try:
        for _attempt in range(3):
            port = _free_port()
            (data / "postgresql.auto.conf").write_text("\n".join((
                "listen_addresses = '127.0.0.1'",
                f"port = {port}",
                "unix_socket_directories = ''",
                "fsync = off",
                "synchronous_commit = off",
                "full_page_writes = off",
                "max_connections = 300",
                "",
            )), encoding="utf-8")
            result = _run(bin_dir, ["pg_ctl", "-D", str(data), "-l", str(base / "server.log"),
                                    "-w", "-t", "60", "start"])
            if result.returncode == 0:
                started = True
                break
            if (data / "postmaster.pid").exists():  # a postmaster that started but timed out
                _run(bin_dir, ["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "-t", "60", "stop"])
        if not started:
            raise ClusterError("The owned test cluster did not start.")
        result = _run(bin_dir, ["createdb", "-h", "127.0.0.1", "-p", str(port), "-U", USER,
                                RUNTIME_DATABASE], password=password)
        if result.returncode:
            raise ClusterError("The owned test cluster could not create its runtime database.")
        yield {"host": "127.0.0.1", "port": port, "user": USER, "password": password,
               "adminDatabase": ADMIN_DATABASE, "runtimeDatabase": RUNTIME_DATABASE,
               "binDir": str(bin_dir)}
    finally:
        if started:
            _run(bin_dir, ["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "-t", "60", "stop"])
        shutil.rmtree(base, ignore_errors=True)


def cluster_url(cluster: Mapping, database: str) -> str:
    return (f"postgresql+psycopg://{cluster['user']}:{cluster['password']}"
            f"@{cluster['host']}:{cluster['port']}/{database}")
