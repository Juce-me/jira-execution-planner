import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]

DOCKER_STUB = r'''#!/usr/bin/env bash
set -u
printf 'docker|%s\n' "$*" >> "$RUNNER_LOG"
case "$*" in
  *" compose version") exit "${FAKE_COMPOSE_VERSION_STATUS:-0}" ;;
  *" compose up --help")
    printf '%s\n' "${FAKE_COMPOSE_HELP:---wait --wait-timeout}"
    exit 0
    ;;
  "context show") printf '%s\n' 'default'; exit 0 ;;
  "context inspect "*)
    printf '%s\n' "${FAKE_CONTEXT_ENDPOINT:-unix:///tmp/fake-docker.sock}"
    exit 0
    ;;
  *" info") exit "${FAKE_DOCKER_INFO_STATUS:-0}" ;;
  *" version --format "*)
    printf '%s\n' "${FAKE_DOCKER_VERSION:-29.7.1}"
    exit 0
    ;;
  *" volume ls --format {{.Name}}")
    if [[ "${FAKE_VOLUME_LS_STATUS:-0}" -ne 0 ]]; then exit 1; fi
    if [[ "${FAKE_VOLUME_EXISTS:-0}" -eq 1 ]]; then
      printf '%s\n' 'jira-planning-local-postgres'
    fi
    exit 0
    ;;
  *" volume inspect "*)
    if [[ "$*" == *'com.docker.compose.project'* ]]; then
      if [[ "${FAKE_VOLUME_PROJECT_INSPECT_STATUS:-0}" -ne 0 ]]; then exit 1; fi
      printf '%s\n' "${FAKE_VOLUME_PROJECT:-jira-planning-local}"
    elif [[ "$*" == *'com.docker.compose.volume'* ]]; then
      if [[ "${FAKE_VOLUME_KEY_INSPECT_STATUS:-0}" -ne 0 ]]; then exit 1; fi
      printf '%s\n' "${FAKE_VOLUME_KEY:-postgres-data}"
    fi
    exit 0
    ;;
  *" ps --all --quiet --filter label=com.docker.compose.project=jira-planning-local")
    [[ -n "${FAKE_PROJECT_CONTAINER:-}" ]] && printf '%s\n' 'existing-container'
    exit 0
    ;;
  *" ps --all --quiet --filter name=^/jira-planning-local"*)
    [[ -n "${FAKE_LEGACY_CONTAINER:-}" ]] && printf '%s\n' 'legacy-container'
    exit 0
    ;;
  *" network ls --quiet --filter label=com.docker.compose.project=jira-planning-local")
    [[ -n "${FAKE_PROJECT_NETWORK:-}" ]] && printf '%s\n' 'existing-network'
    exit 0
    ;;
  *" network ls --quiet --filter name=^jira-planning-local_default$")
    [[ "${FAKE_DEFAULT_NETWORK_STATUS:-1}" -eq 0 ]] && printf '%s\n' 'default-network'
    exit 0
    ;;
  *" ps --all --quiet --filter volume=jira-planning-local-postgres")
    [[ -n "${FAKE_VOLUME_USER:-}" ]] && printf '%s\n' 'volume-user'
    exit 0
    ;;
  *" config --quiet") exit "${FAKE_CONFIG_STATUS:-0}" ;;
  *" up --detach --wait --wait-timeout 60 postgres")
    if [[ -n "${FAKE_UP_PID_FILE:-}" ]]; then
      printf '%s\n' "$$" > "$FAKE_UP_PID_FILE"
    fi
    if [[ "${FAKE_UP_SLEEP:-0}" == "1" ]]; then
      trap '' HUP
      trap 'exit 0' INT TERM
      while true; do sleep 1; done
    fi
    exit "${FAKE_UP_STATUS:-0}"
    ;;
  *" logs --no-color --tail 100 postgres") exit 0 ;;
  *" ps --all") exit 0 ;;
  *" down --timeout 10")
    if [[ -n "${FAKE_DOWN_STARTED_FILE:-}" ]]; then
      : > "$FAKE_DOWN_STARTED_FILE"
    fi
    if [[ -n "${FAKE_DOWN_SLEEP:-}" ]]; then sleep "$FAKE_DOWN_SLEEP"; fi
    exit "${FAKE_DOWN_STATUS:-0}"
    ;;
esac
printf 'unexpected docker invocation: %s\n' "$*" >&2
exit 98
'''

PYTHON_STUB = r'''#!/usr/bin/env bash
set -u
printf 'python|%s|bind=%s|network=%s|basic=%s|debug=%s\n' \
  "$*" "${APP_BIND_HOST:-}" "${ALLOW_NETWORK_BIND:-}" \
  "${ALLOW_BASIC_AUTH_ON_NETWORK:-}" "${DEBUG_MODE:-}" >> "$RUNNER_LOG"
case "$*" in
  *"-m alembic"*) exit "${FAKE_MIGRATION_STATUS:-0}" ;;
  *"check_startup_preflight.py"*) exit "${FAKE_PREFLIGHT_STATUS:-0}" ;;
  *"jira_server.py"*)
    printf '%s\n' "$$" > "$FAKE_CHILD_PID_FILE"
    if [[ "${FAKE_APP_GRANDCHILD:-0}" == "1" ]]; then
      (
        if [[ "${FAKE_GRANDCHILD_IGNORE_TERM:-0}" == "1" ]]; then
          trap '' INT TERM
        else
          trap 'exit 0' INT TERM
        fi
        while true; do sleep 1; done
      ) &
      printf '%s\n' "$!" > "$FAKE_GRANDCHILD_PID_FILE"
    fi
    if [[ "${FAKE_APP_SLEEP:-0}" == "1" ]]; then
      if [[ "${FAKE_APP_IGNORE_TERM:-0}" == "1" ]]; then
        trap '' INT TERM
      else
        trap 'exit 0' INT TERM
      fi
      while true; do sleep 1; done
    fi
    exit "${FAKE_APP_STATUS:-0}"
    ;;
esac
exit 97
'''

MKDIR_STUB = r'''#!/usr/bin/env bash
set -u
if [[ "$1" == "$FAKE_LOCK_DIR" ]]; then
  : > "$FAKE_LOCK_STARTED_FILE"
  while [[ ! -e "$FAKE_LOCK_RELEASE_FILE" ]]; do sleep 0.05; done
fi
exec /bin/mkdir "$@"
'''


class LocalPostgresqlRunnerProcessTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        base = Path(self.tempdir.name)
        self.repo = base / "repo with spaces"
        self.runner_dir = self.repo / "runners" / "local"
        self.runner_dir.mkdir(parents=True)
        self.lock_dir = base / "runner.lock"
        shutil.copy2(ROOT / "runners/local/run.sh", self.runner_dir / "run.sh")
        shutil.copy2(ROOT / "runners/local/compose.yaml", self.runner_dir / "compose.yaml")
        runner_path = self.runner_dir / "run.sh"
        runner_source = runner_path.read_text(encoding="utf8")
        production_lock = 'readonly lock_dir="/tmp/jira-planning-local-runner.lock"'
        if runner_source.count(production_lock) != 1:
            raise AssertionError("production lock declaration changed")
        runner_path.write_text(
            runner_source.replace(
                production_lock,
                f'readonly lock_dir="{self.lock_dir}"',
                1,
            ),
            encoding="utf8",
        )
        (self.repo / "backend/db").mkdir(parents=True)
        (self.repo / "backend/db/alembic.ini").write_text("[alembic]\n", encoding="utf8")
        (self.repo / "jira_server.py").write_text("# sentinel\n", encoding="utf8")

        python_bin = self.repo / ".venv/bin/python"
        python_bin.parent.mkdir(parents=True)
        self._write_executable(python_bin, PYTHON_STUB)
        self.fake_bin = base / "fake-bin"
        self.fake_bin.mkdir()
        self._write_executable(self.fake_bin / "docker", DOCKER_STUB)

        self.log = base / "runner.log"
        self.child_pid_file = base / "child.pid"
        self.grandchild_pid_file = base / "grandchild.pid"
        self.down_started_file = base / "down-started"
        self.env = os.environ.copy()
        self.env.pop("DOCKER_CONTEXT", None)
        self.env.update({
            "PATH": f"{self.fake_bin}{os.pathsep}{self.env.get('PATH', '')}",
            "RUNNER_LOG": str(self.log),
            "FAKE_CHILD_PID_FILE": str(self.child_pid_file),
            "FAKE_GRANDCHILD_PID_FILE": str(self.grandchild_pid_file),
            "TMPDIR": str(base),
            "DOCKER_HOST": "unix:///tmp/fake-docker.sock",
            "COMPOSE_PROJECT_NAME": "hostile-project",
            "COMPOSE_FILE": "/tmp/hostile-compose.yaml",
            "APP_BIND_HOST": "0.0.0.0",
            "ALLOW_NETWORK_BIND": "true",
            "ALLOW_BASIC_AUTH_ON_NETWORK": "true",
            "DEBUG_MODE": "true",
        })

    @staticmethod
    def _write_executable(path, source):
        path.write_text(source, encoding="utf8")
        path.chmod(0o755)

    def _run(self, *arguments, **overrides):
        self.log.write_text("", encoding="utf8")
        env = self.env.copy()
        env.update({key: str(value) for key, value in overrides.items()})
        process = self._start_process(
            *arguments,
            env=env,
        )
        try:
            stdout, stderr = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            self._cleanup_process(process)
            raise
        return subprocess.CompletedProcess(
            [str(self.runner_dir / "run.sh"), *arguments],
            process.returncode,
            stdout,
            stderr,
        )

    def _start_process(self, *arguments, env=None, extra_pid_files=()):
        process = subprocess.Popen(
            [str(self.runner_dir / "run.sh"), *arguments],
            cwd=self.repo,
            env=self.env.copy() if env is None else env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.addCleanup(
            self._cleanup_process,
            process,
            tuple(extra_pid_files),
        )
        return process

    def _cleanup_process(self, process, extra_pid_files=()):
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        else:
            process.wait(timeout=2)

        pid_files = (
            self.child_pid_file,
            self.grandchild_pid_file,
            *tuple(extra_pid_files),
        )
        for pid_file in pid_files:
            if not pid_file.exists():
                continue
            pid = int(pid_file.read_text(encoding="utf8"))
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                try:
                    os.killpg(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.05)
            else:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for stream in (process.stdout, process.stderr):
            if stream is not None and not stream.closed:
                stream.close()
        try:
            self.lock_dir.rmdir()
        except FileNotFoundError:
            pass

    @staticmethod
    def _wait_for(path, message):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if path.exists():
                return
            time.sleep(0.05)
        raise AssertionError(message)

    def _instrument_child_launch(self, started_file, release_file):
        runner_path = self.runner_dir / "run.sh"
        source = runner_path.read_text(encoding="utf8")
        launch = '  "$@" &\n  child_pid=$!'
        instrumented = (
            '  "$@" &\n'
            '  : > "$FAKE_CHILD_LAUNCH_STARTED_FILE"\n'
            '  while [[ ! -e "$FAKE_CHILD_LAUNCH_RELEASE_FILE" ]]; do sleep 0.05; done\n'
            '  child_pid=$!'
        )
        if source.count(launch) != 1:
            raise AssertionError("child launch sequence changed")
        runner_path.write_text(source.replace(launch, instrumented, 1), encoding="utf8")
        self.env["FAKE_CHILD_LAUNCH_STARTED_FILE"] = str(started_file)
        self.env["FAKE_CHILD_LAUNCH_RELEASE_FILE"] = str(release_file)

    def _log_text(self):
        return self.log.read_text(encoding="utf8") if self.log.exists() else ""

    def _assert_down_once(self, log):
        self.assertEqual(log.count(" down --timeout 10"), 1)
        self.assertNotIn("--remove-orphans", log)
        self.assertNotIn("--volumes", log)

    def _assert_lock_released(self):
        self.assertFalse(self.lock_dir.exists(), f"stale lock: {self.lock_dir}")

    def _assert_pid_exits(self, pid_file):
        pid = int(pid_file.read_text(encoding="utf8"))
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.05)
        self.fail(f"process {pid} from {pid_file} survived")

    def test_success_order_forces_loopback_and_cleans_once(self):
        result = self._run()
        log = self._log_text()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(log.index(" up --detach --wait"), log.index("python|-m alembic"))
        self.assertLess(log.index("python|-m alembic"), log.index("check_startup_preflight.py"))
        self.assertLess(log.index("check_startup_preflight.py"), log.index("jira_server.py"))
        self.assertLess(log.index("jira_server.py"), log.index(" down --timeout 10"))
        self.assertIn("bind=127.0.0.1|network=false|basic=false|debug=false", log)
        for line in log.splitlines():
            if " --file " in line:
                self.assertIn("--project-name jira-planning-local", line)
                self.assertIn(str(self.runner_dir / "compose.yaml"), line)
        self._assert_down_once(log)
        self._assert_lock_released()

    def test_compose_failure_retains_17_and_prints_bounded_diagnostics(self):
        result = self._run(FAKE_UP_STATUS=17)
        log = self._log_text()
        self.assertEqual(result.returncode, 17)
        self.assertIn("--tail 100", log)
        self.assertNotIn("python|", log)
        self._assert_down_once(log)
        self._assert_lock_released()

    def test_migration_failure_retains_41_and_skips_preflight_and_app(self):
        result = self._run(FAKE_MIGRATION_STATUS=41)
        log = self._log_text()
        self.assertEqual(result.returncode, 41)
        self.assertNotIn("check_startup_preflight.py", log)
        self.assertNotIn("jira_server.py", log)
        self._assert_down_once(log)
        self._assert_lock_released()

    def test_preflight_failure_retains_42_and_skips_app(self):
        result = self._run(FAKE_PREFLIGHT_STATUS=42)
        log = self._log_text()
        self.assertEqual(result.returncode, 42)
        self.assertNotIn("jira_server.py", log)
        self._assert_down_once(log)
        self._assert_lock_released()

    def test_app_failure_retains_43_when_cleanup_returns_44(self):
        result = self._run(FAKE_APP_STATUS=43, FAKE_DOWN_STATUS=44)
        self.assertEqual(result.returncode, 43)
        self.assertIn("cleanup failed", result.stderr)
        self._assert_down_once(self._log_text())
        self._assert_lock_released()

    def test_success_becomes_failure_when_cleanup_returns_44(self):
        result = self._run(FAKE_DOWN_STATUS=44)
        self.assertEqual(result.returncode, 44)
        self._assert_down_once(self._log_text())
        self._assert_lock_released()

    def _assert_signal(
        self, sent_signal, expected_status,
        ignore_app_term=False, ignore_grandchild_term=False,
    ):
        self.log.write_text("", encoding="utf8")
        env = self.env.copy()
        env["FAKE_APP_SLEEP"] = "1"
        env["FAKE_APP_GRANDCHILD"] = "1"
        env["FAKE_APP_IGNORE_TERM"] = "1" if ignore_app_term else "0"
        env["FAKE_GRANDCHILD_IGNORE_TERM"] = "1" if ignore_grandchild_term else "0"
        env["FAKE_DOWN_STARTED_FILE"] = str(self.down_started_file)
        env["FAKE_DOWN_SLEEP"] = "0.5"
        process = self._start_process(env=env)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if (
                    "jira_server.py" in self._log_text()
                    and self.child_pid_file.exists()
                    and self.grandchild_pid_file.exists()
                ):
                    break
                time.sleep(0.05)
            else:
                self.fail("Flask stub did not start")
            process.send_signal(sent_signal)
            cleanup_deadline = time.monotonic() + 10
            while time.monotonic() < cleanup_deadline:
                if self.down_started_file.exists():
                    break
                time.sleep(0.05)
            else:
                self.fail("cleanup did not start")
            process.send_signal(signal.SIGINT)
            process.send_signal(signal.SIGTERM)
            _, stderr = process.communicate(timeout=8)
            self.assertEqual(process.returncode, expected_status, stderr)
            self._assert_down_once(self._log_text())
            self._assert_pid_exits(self.child_pid_file)
            self._assert_pid_exits(self.grandchild_pid_file)
            self._assert_lock_released()
        finally:
            self._cleanup_process(process)

    def test_sigint_returns_130_kills_child_and_cleans_once(self):
        self._assert_signal(signal.SIGINT, 130)

    def test_sigterm_returns_143_kills_child_and_cleans_once(self):
        self._assert_signal(signal.SIGTERM, 143)

    def test_sigterm_escalates_to_kill_for_ignoring_process_tree(self):
        self._assert_signal(
            signal.SIGTERM, 143, ignore_grandchild_term=True,
        )

    def test_sigterm_during_lock_acquisition_is_serviced_after_ownership(self):
        lock_started = self.log.parent / "lock-started"
        lock_release = self.log.parent / "lock-release"
        self._write_executable(self.fake_bin / "mkdir", MKDIR_STUB)
        env = self.env.copy()
        env.update({
            "FAKE_LOCK_DIR": str(self.lock_dir),
            "FAKE_LOCK_STARTED_FILE": str(lock_started),
            "FAKE_LOCK_RELEASE_FILE": str(lock_release),
        })
        process = self._start_process(env=env)
        try:
            self._wait_for(lock_started, "runner did not enter lock acquisition")
            process.send_signal(signal.SIGTERM)
            lock_release.touch()
            _, stderr = process.communicate(timeout=8)
            self.assertEqual(process.returncode, 143, stderr)
            self.assertNotIn(" up --detach --wait", self._log_text())
            self._assert_lock_released()
        finally:
            self._cleanup_process(process)

    def test_sigint_during_child_launch_is_serviced_after_pid_publication(self):
        launch_started = self.log.parent / "child-launch-started"
        launch_release = self.log.parent / "child-launch-release"
        up_pid_file = self.log.parent / "up.pid"
        self._instrument_child_launch(launch_started, launch_release)
        env = self.env.copy()
        env.update({
            "FAKE_UP_PID_FILE": str(up_pid_file),
            "FAKE_UP_SLEEP": "1",
        })
        process = self._start_process(
            env=env,
            extra_pid_files=(up_pid_file,),
        )
        try:
            self._wait_for(launch_started, "runner did not enter child launch window")
            self._wait_for(up_pid_file, "compose child did not start")
            process.send_signal(signal.SIGINT)
            launch_release.touch()
            _, stderr = process.communicate(timeout=8)
            self.assertEqual(process.returncode, 130, stderr)
            self._assert_pid_exits(up_pid_file)
            self._assert_down_once(self._log_text())
            self._assert_lock_released()
        finally:
            self._cleanup_process(process, extra_pid_files=(up_pid_file,))

    def test_registered_cleanup_kills_extra_group_after_wrapper_timeout(self):
        launch_started = self.log.parent / "cleanup-launch-started"
        launch_release = self.log.parent / "cleanup-launch-release"
        up_pid_file = self.log.parent / "cleanup-up.pid"
        self._instrument_child_launch(launch_started, launch_release)
        env = self.env.copy()
        env.update({
            "FAKE_UP_PID_FILE": str(up_pid_file),
            "FAKE_UP_SLEEP": "1",
        })
        process = self._start_process(
            env=env,
            extra_pid_files=(up_pid_file,),
        )
        try:
            self._wait_for(launch_started, "runner did not enter child launch window")
            self._wait_for(up_pid_file, "compose child did not start")
            self._cleanup_process(process, extra_pid_files=(up_pid_file,))
            self._assert_pid_exits(up_pid_file)
            self._assert_lock_released()
        finally:
            launch_release.touch()
            self._cleanup_process(process, extra_pid_files=(up_pid_file,))

    def test_missing_venv_fails_without_docker_mutation(self):
        python_bin = self.repo / ".venv/bin/python"
        python_bin.unlink()
        result = self._run()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing .venv", result.stderr)
        self.assertNotIn(" up --detach --wait", self._log_text())
        self.assertNotIn(" down --timeout 10", self._log_text())
        self._assert_lock_released()

    def test_missing_compose_fails_without_mutation(self):
        result = self._run(FAKE_COMPOSE_VERSION_STATUS=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Compose v2 is unavailable", result.stderr)
        self.assertNotIn(" up --detach --wait", self._log_text())
        self.assertNotIn(" down --timeout 10", self._log_text())
        self._assert_lock_released()

    def test_missing_wait_timeout_fails_without_mutation(self):
        result = self._run(FAKE_COMPOSE_HELP="--detach")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--wait-timeout", result.stderr)
        self.assertNotIn(" up --detach --wait", self._log_text())
        self.assertNotIn(" down --timeout 10", self._log_text())
        self._assert_lock_released()

    def test_unavailable_daemon_fails_without_mutation(self):
        result = self._run(FAKE_DOCKER_INFO_STATUS=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("daemon is unavailable", result.stderr)
        self.assertNotIn(" up --detach --wait", self._log_text())
        self.assertNotIn(" down --timeout 10", self._log_text())
        self._assert_lock_released()

    def test_engine_27_fails_without_mutation(self):
        result = self._run(FAKE_DOCKER_VERSION="27.5.1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Engine 28 or newer", result.stderr)
        self.assertNotIn(" up --detach --wait", self._log_text())
        self.assertNotIn(" down --timeout 10", self._log_text())
        self._assert_lock_released()

    def test_invalid_compose_config_fails_without_mutation(self):
        result = self._run(FAKE_CONFIG_STATUS=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("compose.yaml is invalid", result.stderr)
        self.assertNotIn(" up --detach --wait", self._log_text())
        self.assertNotIn(" down --timeout 10", self._log_text())
        self._assert_lock_released()

    def test_remote_docker_endpoint_fails_before_compose_up(self):
        result = self._run(DOCKER_HOST="ssh://remote.invalid")
        log = self._log_text()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("remote contexts are unsupported", result.stderr)
        self.assertNotIn(" up --detach --wait", log)
        self.assertNotIn(" down --timeout 10", log)
        self._assert_lock_released()

    def test_remote_docker_context_fails_before_compose_config(self):
        result = self._run(
            DOCKER_HOST="",
            DOCKER_CONTEXT="remote-context",
            FAKE_CONTEXT_ENDPOINT="ssh://remote.invalid",
        )
        log = self._log_text()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("remote contexts are unsupported", result.stderr)
        self.assertNotIn(" config --quiet", log)
        self.assertNotIn(" up --detach --wait", log)
        self.assertNotIn(" down --timeout 10", log)
        self._assert_lock_released()

    def test_each_foreign_resource_fails_without_mutation(self):
        cases = (
            {"FAKE_PROJECT_CONTAINER": "1"},
            {"FAKE_LEGACY_CONTAINER": "1"},
            {"FAKE_PROJECT_NETWORK": "1"},
            {"FAKE_DEFAULT_NETWORK_STATUS": "0"},
            {"FAKE_VOLUME_USER": "1"},
            {"FAKE_VOLUME_EXISTS": "1", "FAKE_VOLUME_PROJECT": "foreign"},
            {"FAKE_VOLUME_EXISTS": "1", "FAKE_VOLUME_KEY": "foreign"},
            {"FAKE_VOLUME_EXISTS": "1", "FAKE_VOLUME_PROJECT_INSPECT_STATUS": "1"},
            {"FAKE_VOLUME_EXISTS": "1", "FAKE_VOLUME_KEY_INSPECT_STATUS": "1"},
        )
        for values in cases:
            with self.subTest(values=values):
                result = self._run(**values)
                log = self._log_text()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("runner resources", result.stderr)
                self.assertNotIn(" up --detach --wait", log)
                self.assertNotIn(" down --timeout 10", log)
                self._assert_lock_released()

    def test_volume_enumeration_failure_fails_without_mutation(self):
        result = self._run(FAKE_VOLUME_LS_STATUS=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("enumerate runner resources", result.stderr)
        self.assertNotIn(" up --detach --wait", self._log_text())
        self.assertNotIn(" down --timeout 10", self._log_text())
        self._assert_lock_released()

    def test_second_checkout_with_different_tmpdir_cannot_mutate(self):
        first_log = self.log.parent / "first.log"
        first_env = self.env.copy()
        first_env.update({
            "RUNNER_LOG": str(first_log),
            "FAKE_APP_SLEEP": "1",
            "TMPDIR": str(self.log.parent / "tmp-one"),
        })
        first = self._start_process(env=first_env)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if self.lock_dir.exists() and first_log.exists() and "jira_server.py" in first_log.read_text(encoding="utf8"):
                    break
                time.sleep(0.05)
            else:
                self.fail("first runner did not acquire the lock")

            second_log = self.log.parent / "second.log"
            second = self._run(
                RUNNER_LOG=second_log,
                TMPDIR=self.log.parent / "tmp-two",
            )
            second_output = second_log.read_text(encoding="utf8")
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("another runner is active", second.stderr)
            self.assertNotIn(" up --detach --wait", second_output)
            self.assertNotIn(" down --timeout 10", second_output)

            first.send_signal(signal.SIGTERM)
            first.communicate(timeout=8)
            self._assert_down_once(first_log.read_text(encoding="utf8"))
            self._assert_lock_released()
        finally:
            self._cleanup_process(first)

    def test_repeated_signals_during_failed_app_cleanup_preserve_status(self):
        env = self.env.copy()
        env.update({
            "FAKE_APP_STATUS": "43",
            "FAKE_DOWN_STARTED_FILE": str(self.down_started_file),
            "FAKE_DOWN_SLEEP": "0.5",
        })
        process = self._start_process(env=env)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if self.down_started_file.exists():
                    break
                time.sleep(0.05)
            else:
                self.fail("cleanup did not start")
            process.send_signal(signal.SIGINT)
            process.send_signal(signal.SIGTERM)
            _, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 43, stderr)
            self._assert_down_once(self._log_text())
            self._assert_lock_released()
        finally:
            self._cleanup_process(process)

    def test_arguments_are_rejected_before_docker_access(self):
        result = self._run("--host", "0.0.0.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("arguments are not supported", result.stderr)
        self.assertEqual(self._log_text(), "")
        self._assert_lock_released()


if __name__ == "__main__":
    unittest.main()
