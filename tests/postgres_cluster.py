"""Owned, throwaway PostgreSQL cluster for isolated tests and browser fixtures.

The cluster lives under a caller-owned directory, listens on 127.0.0.1 only (no
Unix socket: long snapshot paths exceed the socket path limit), uses a random
password and is stopped and removed when the context exits. It never reads the
operator's PostgreSQL environment, service or password files.
"""

from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import time
from typing import Iterator, Mapping, NamedTuple


ADMIN_DATABASE = "postgres"
RUNTIME_DATABASE = "jep_runtime"
USER = "jep_test"
REQUIRED_BINARIES = ("initdb", "pg_ctl", "createdb")


class RuntimeProcessIdentity(NamedTuple):
    pid: int
    parent: int
    group: int
    birth: tuple[int, int]
    uid: int
    name: str


@lru_cache(maxsize=1)
def _darwin_process_reader():
    import ctypes

    class BSDProcessInfo(ctypes.Structure):
        # Darwin's proc_bsdinfo layout for PROC_PIDTBSDINFO in <sys/proc_info.h>.
        _fields_ = [('prefix', ctypes.c_uint32 * 3), ('pid', ctypes.c_uint32),
                    ('parent', ctypes.c_uint32), ('uid', ctypes.c_uint32),
                    ('reserved', ctypes.c_uint32 * 6), ('comm', ctypes.c_char * 16),
                    ('name', ctypes.c_char * 32), ('files', ctypes.c_uint32),
                    ('group', ctypes.c_uint32), ('tail', ctypes.c_uint32 * 4),
                    ('seconds', ctypes.c_uint64), ('micros', ctypes.c_uint64)]

    api = ctypes.CDLL('/usr/lib/libproc.dylib').proc_pidinfo
    api.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    api.restype = ctypes.c_int

    def read(pid):
        info = BSDProcessInfo()
        size = ctypes.sizeof(info)
        if api(pid, 3, 0, ctypes.byref(info), size) != size or info.pid != pid or not info.seconds:
            return None
        return RuntimeProcessIdentity(info.pid, info.parent, info.group, (info.seconds, info.micros),
                                      info.uid, (info.name or info.comm).decode('utf-8', errors='replace'))

    return read


def runtime_process_identity(pid):
    """Read the kernel birth identity on the supported local overlap host."""
    if sys.platform != 'darwin' or isinstance(pid, bool) or not isinstance(pid, int) or pid <= 1:
        return None
    return _darwin_process_reader()(pid)


def report_runtime_ownership(kind, state, *, pid=None, group=None, directory=None, port=None):
    """Append one opt-in event to the existing pilot-owned local ledger."""
    path = os.environ.get('JEP_RUNTIME_OWNERSHIP_LOG')
    if not path:
        return
    stage = os.environ.get('JEP_RUNTIME_OWNERSHIP_STAGE')
    if not Path(path).is_absolute() or stage not in {'backend', 'chromium'}:
        raise OSError('Runtime ownership logging requires an absolute path and a known stage.')
    reporter = os.getpid()
    event = {'kind': kind, 'state': state, 'pid': pid, 'group': group,
             'directory': str(directory) if directory is not None else None, 'port': port,
             'reporter': reporter, 'stage': stage, 'monotonic': time.monotonic()}
    if state == 'started' and pid is not None:
        identity = runtime_process_identity(pid)
        if (identity is None or identity.uid != os.geteuid() or
                (group is not None and (identity.group != group or reporter not in {pid, identity.parent}))):
            raise OSError('Cannot confirm the kernel identity of an owned runtime process.')
        event.update(birth=identity.birth, parent=identity.parent)
    encoded = (json.dumps(event, separators=(',', ':')) + '\n').encode('utf-8')
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        target = os.fstat(descriptor)
        if not stat.S_ISREG(target.st_mode) or target.st_uid != os.getuid():
            raise OSError('Runtime ownership ledger must be a regular file owned by the test user.')
        if os.write(descriptor, encoded) != len(encoded):
            raise OSError('Incomplete runtime ownership event.')
    finally:
        os.close(descriptor)


class ClusterError(RuntimeError):
    """The owned test cluster could not be provisioned."""

    def __init__(self, message, *, preserve_directory=False):
        super().__init__(message)
        self.preserve_directory = preserve_directory


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


def _owned_postmaster(data: Path, expected_port: int):
    pid_file = data / 'postmaster.pid'
    try:
        if pid_file.is_symlink() or not pid_file.is_file():
            return None
        with pid_file.open(encoding='utf-8') as handle:
            pid = int(handle.readline().strip())
            directory = Path(handle.readline().strip())
            handle.readline()  # PostgreSQL's start timestamp.
            port = int(handle.readline().strip())
    except (OSError, ValueError):
        return None
    if pid > 1 and directory.is_absolute() and directory == data.resolve() and 0 < port == expected_port <= 65535:
        return pid, port
    return None


@contextmanager
def owned_cluster(base: Path, environ: Mapping[str, str] | None = None) -> Iterator[dict]:
    bin_dir = postgres_bin_dir(environ)
    base = Path(base)
    base.mkdir(parents=True, exist_ok=False)
    data = base / "data"
    observe = bool(os.environ.get('JEP_RUNTIME_OWNERSHIP_LOG'))
    identity = None

    def report_cluster(state):
        if observe:
            pid, bound_port = identity if identity is not None else (None, None)
            report_runtime_ownership('postgres', state, pid=pid, directory=base.resolve(), port=bound_port)

    def observe_start(port):
        nonlocal identity
        if observe:
            observed = _owned_postmaster(data, port)
            if observed is not None and observed != identity:
                identity = observed
                report_cluster('started')

    def report_removed():
        if observe:
            report_cluster('failed' if base.exists() else 'stopped')

    try:
        report_cluster('allocated')
    except OSError:
        base.rmdir()
        raise
    password = secrets.token_hex(24)
    password_file = base / "initdb-password"
    descriptor = os.open(password_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(password)
    try:
        try:
            result = _run(bin_dir, ["initdb", "-D", str(data), "-U", USER, "--auth=scram-sha-256",
                                    f"--pwfile={password_file}", "--no-sync", "--no-instructions",
                                    "-E", "UTF8", "--locale=C"])
        finally:
            password_file.unlink(missing_ok=True)
    except BaseException:
        if observe:
            # Nothing has reached pg_ctl, so this allocation has no postmaster.
            shutil.rmtree(base, ignore_errors=True)
            report_removed()
        raise
    if result.returncode:
        shutil.rmtree(base, ignore_errors=True)
        report_removed()
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
            observe_start(port)
            if result.returncode == 0:
                started = True
                break
            report_cluster('failed')
            if (data / "postmaster.pid").exists():  # a postmaster that started but timed out
                stopped = _run(bin_dir, ["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "-t", "60", "stop"])
                if identity is not None:
                    report_cluster('failed' if stopped.returncode else 'stopped')
                    if not stopped.returncode:
                        identity = None
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
        # pg_ctl may start the postmaster before an interrupt records success.
        try:
            observe_start(port)
        finally:
            if started or (data / 'postmaster.pid').exists():
                message = 'The owned test cluster could not be stopped; its directory was preserved.'
                try:
                    stopped = _run(bin_dir, ["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "-t", "60", "stop"])
                    if stopped.returncode:
                        raise ClusterError(message, preserve_directory=True)
                except BaseException as cause:
                    try:
                        report_cluster('failed')
                    finally:
                        raise ClusterError(message, preserve_directory=True) from cause
            shutil.rmtree(base, ignore_errors=True)
            report_removed()


def cluster_url(cluster: Mapping, database: str) -> str:
    return (f"postgresql+psycopg://{cluster['user']}:{cluster['password']}"
            f"@{cluster['host']}:{cluster['port']}/{database}")
