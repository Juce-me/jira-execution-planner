# Localhost PostgreSQL Runners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated localhost runner that keeps Docker PostgreSQL alive only while the source-checkout Flask app is running, preserves its data across ordinary shutdowns, and adds a least-privilege GitHub Actions runner for the real PostgreSQL locking tests.

**Architecture:** Keep every local/CI implementation under `runners/local/` and `runners/github/`; the only required external entry point is `.github/workflows/verify-postgresql.yml`. The local Bash supervisor owns an exact Compose project, rejects remote or ambiguous Docker state, forces Flask and PostgreSQL to loopback, migrates and preflights before starting Flask, forwards signals, and tears down only resources it owns while retaining the named volume. The GitHub script validates both database targets against one exact synthetic URL before Alembic, and the workflow runs it on a digest-pinned PostgreSQL service with read-only permissions and bounded runtime.

**Tech Stack:** Bash 3.2-compatible shell, Docker Compose v2 with `--wait-timeout`, PostgreSQL 16.15/Alpine 3.24 official image, Python 3.11, Alembic, SQLAlchemy/psycopg, Python `unittest`, GitHub Actions.

**Status:** Implementation is present on `feature/local-postgresql-runners`; Tasks 1-4 plus the daemon-free, live Docker lifecycle/abuse/persistence, production-image, and release-layout Task 5 checks are complete. Final verification remains blocked because the configured-runtime full suite has nine pre-existing EPM configuration failures and no runner commit, push, PR, or real GitHub PostgreSQL run exists. Ordinary local use also requires the documented token-encryption settings that are currently absent from the local `.env`; live verification used an unprinted process-only key without modifying that file.

**Canonical design:** `docs/agents/features/2026-08-27-planned-local-postgresql-runners.md`

---

## Scope And Isolation Contract

Allowed implementation changes:

- Create `runners/local/compose.yaml`.
- Create `runners/local/run.sh`.
- Create `runners/local/README.md`.
- Create `runners/github/run-postgresql-tests.sh`.
- Create `.github/workflows/verify-postgresql.yml`.
- Create `tests/test_postgresql_runner_contract.py`.
- Create `tests/test_local_postgresql_runner.py`.
- Update `README.md` and `INSTALL.md` only with source-checkout runner guidance.
- Update this plan, its design record, and `docs/plans/README.md` for execution status.

Forbidden implementation changes:

- Do not modify `backend/`, `frontend/`, `planning/`, `jira_server.py`, `Dockerfile`, `.dockerignore`, `scripts/docker-entrypoint.sh`, `Makefile`, `.env.example`, or release packaging.
- Do not copy `runners/` into the production image or release archive.
- Do not change `make run`, production migration ownership, Cloud SQL behavior, or standard test dependencies.
- Do not call `backend.db.reset_local`, `docker volume rm`, `docker system prune`, `down -v`, or `down --volumes`.
- Do not add analytics. This developer/CI runner has no user-visible application interaction.

The existing `tests/test_user_view_config_concurrency.py` is a prerequisite owned by the active user-owned EPM work. This plan executes it but must not edit or stage it.

## Audit Closure And Abuse-Case Contract

| Finding | Required control | Required proof |
| --- | --- | --- |
| A hostile `.env` can expose Flask or enable the Werkzeug reloader | Unconditionally export `APP_BIND_HOST=127.0.0.1`, `ALLOW_NETWORK_BIND=false`, `ALLOW_BASIC_AUTH_ON_NETWORK=false`, and `DEBUG_MODE=false`; accept no runner arguments and supervise every child as a process group | Black-box child environment/process-tree assertions plus live socket/bind inspection |
| Ambient Compose settings can adopt another project | Every call uses absolute `--file`, fixed CLI `--project-name`, fixed `--project-directory`, `/dev/null` env file, and `COMPOSE_DISABLE_ENV_FILE=1` | Source guard and hostile `COMPOSE_PROJECT_NAME`/`COMPOSE_FILE` black-box run |
| Two checkouts can stop each other | One fixed machine-wide `/tmp` lock independent of caller-controlled `TMPDIR`; under the lock, fail closed on every pre-existing project/legacy container, project network, exact default network, or retained-volume user; validate retained-volume Compose labels | Concurrent/pre-existing/foreign-volume negative tests; cleanup arms only after ownership |
| Docker can point to a remote daemon | Resolve `DOCKER_HOST` first, matching verified Docker 29.7.1 CLI behavior, then inspect explicit/active `DOCKER_CONTEXT`; permit only a local Unix endpoint and Docker Engine 28+ | Separate remote-host and remote-context negative tests before Compose ownership |
| Cleanup can broaden deletion, orphan descendants, or hide failures | One `EXIT` cleanup, signal handlers terminate/reap the active process group, repeated signals are ignored during teardown, no orphan/volume flags, exact project only, original nonzero status preserved, successful app becomes failure if cleanup fails | Stage-exit, signal 130/143, descendant-death, repeated-signal, lock-removal, cleanup-once, and cleanup-failure tests |
| A superficially local CI URL can redirect Alembic | Require `DATABASE_URL` and `TEST_DATABASE_URL` to exactly equal the synthetic CI URL before the Alembic command | Wrong/mismatched/query URL tests prove fake Python is never invoked |
| Pull-request code can abuse workflow authority | GitHub-hosted Ubuntu only, `pull_request` not `pull_request_target`, read-only contents, no persisted checkout credentials, no secrets/environment/artifacts/deployment, reviewed SHA action pins | Workflow source guards reject every forbidden authority/trigger/string |
| Mutable images/actions undermine reproducibility | Use `postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`, checkout SHA `11d5960a326750d5838078e36cf38b85af677262`, and setup-python SHA `a26af69be951a213d495a4c3e4e4022e16d87065` | Exact digest/SHA assertions and same PostgreSQL digest in local and CI |
| Hangs/log floods/resource exhaustion | 60-second local health wait, bounded 100-line failure log, container CPU/memory/PID/log limits, GitHub 15-minute timeout and per-ref cancellation | Source guards plus intentional startup-failure output inspection |
| Runner files could contaminate deployables | Existing selective Dockerfile/release allowlists stay unchanged | Source guards and final image/archive inspection |

Accepted residual risks are documented in the design: Docker access is host-administrator access; loopback and the known dev password do not isolate same-host processes; the dedicated Postgres role remains superuser inside its private cluster; persistent volumes may contain sensitive encrypted/local state; `SIGKILL`, daemon failure, prune, or Desktop reset bypass normal guarantees; volume disk use is not portably capped; the local app may still call the Jira site in `.env`; pins require reviewed maintenance updates.

## File Map

| File | Responsibility |
| --- | --- |
| `runners/local/compose.yaml` | One digest-pinned, loopback-only, health-checked PostgreSQL service and retained named volume |
| `runners/local/run.sh` | Local Docker ownership validation, lifecycle supervision, migrations, preflight, Flask, signal forwarding, exact cleanup |
| `runners/local/README.md` | Local-only prerequisites, lifecycle, persistence, recovery boundaries, residual risks |
| `runners/github/run-postgresql-tests.sh` | Fail-closed exact CI URL validation followed by Alembic and PostgreSQL-only test modules |
| `.github/workflows/verify-postgresql.yml` | Least-privilege, bounded GitHub-hosted PostgreSQL service job |
| `tests/test_postgresql_runner_contract.py` | Source guards for isolation, safety ordering, pins, permissions, packaging, and docs |
| `tests/test_local_postgresql_runner.py` | Daemon-free process tests using stub Docker/Python executables |
| `README.md`, `INSTALL.md` | Short pointers to the optional source-checkout localhost runner; production guidance remains unchanged |

## Execution Preflight

- [x] Read `AGENTS.md`, `docs/AGENTS.md`, `docs/plans/AGENTS.md`, this plan, and the canonical design.
- [x] Run `rg --files docs/plans | rg '/GATE-'`; confirm `GATE-05` remains checked on 2026-08-27 unless the calendar date changed. Do not run its Home write probe without all approved inputs.
- [x] Run `git branch --show-current` and `git status --short`. The unrelated user-owned EPM changes originally found on `bugfix/user-owned-epm-config` were committed by the user before the checkout moved to the dedicated runner branch; none were stashed, moved, staged, or committed for this plan.
- [x] After the checkout is safe, obtain authorization to switch or create a dedicated `feature/local-postgresql-runners` branch in this same checkout. Stop on `main` or any unrelated feature branch; do not implement runner commits on the EPM branch and do not create a secondary worktree unless the user explicitly requests one.
- [x] Verify every existing file named by this plan exists, especially `tests/test_user_view_config_concurrency.py`; every runner path above is explicitly a create path.
- [x] Verify the reviewed image digest when refreshing dependencies with `docker buildx imagetools inspect postgres:16-alpine`; do not silently replace the recorded digest.
- [x] Do not use a secondary worktree unless the user explicitly requests one.

### Task 1: Add Failing Runner Contract Tests

**Files:**

- Create: `tests/test_postgresql_runner_contract.py`

- [x] **Step 1: Create the source-contract test module**

Use this complete contract; it intentionally fails while the runner files are absent:

```python
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
POSTGRES_DIGEST = "sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685"
CI_URL = "postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_ci"


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf8")


class LocalRunnerSourceContractTests(unittest.TestCase):
    def test_compose_is_digest_pinned_loopback_only_and_persistent(self):
        source = read("runners/local/compose.yaml")
        self.assertIn(f"postgres:16-alpine@{POSTGRES_DIGEST}", source)
        self.assertIn('"127.0.0.1:5432:5432"', source)
        self.assertNotIn('"5432:5432"', source.replace('"127.0.0.1:5432:5432"', ""))
        self.assertIn("pg_isready -U jep -d jep_local", source)
        self.assertIn("jira-planning-local-postgres", source)
        self.assertIn("/var/lib/postgresql/data", source)
        self.assertIn("mem_limit:", source)
        self.assertIn("pids_limit:", source)
        self.assertIn("max-size:", source)
        for forbidden in (
            "privileged:",
            "network_mode: host",
            "container_name:",
            "devices:",
            "pid: host",
            "ipc: host",
            "/var/run/docker.sock",
        ):
            self.assertNotIn(forbidden, source)
        self.assertIsNone(re.search(
            r"(?m)^\s*-\s*(?:/|\.\.?/|~)[^:]*:/var/lib/postgresql/data\s*$",
            source,
        ))

    def test_local_runner_forces_loopback_and_exact_compose_ownership(self):
        source = read("runners/local/run.sh")
        for required in (
            "APP_BIND_HOST=127.0.0.1",
            "ALLOW_NETWORK_BIND=false",
            "ALLOW_BASIC_AUTH_ON_NETWORK=false",
            "DEBUG_MODE=false",
            "--project-name",
            'readonly project_name="jira-planning-local"',
            'readonly lock_dir="/tmp/jira-planning-local-runner.lock"',
            "--project-directory",
            "--env-file",
            "/dev/null",
            "COMPOSE_DISABLE_ENV_FILE=1",
            '[[ -n "${DOCKER_HOST:-}" ]]',
            '[[ -n "${DOCKER_CONTEXT:-}" ]]',
            "docker context",
            "unix://",
            'label=com.docker.compose.project=${project_name}',
            'volume=${volume_name}',
            "volume ls --format",
            '${project_name}_default',
            "--wait-timeout 60",
            "--tail 100",
            "set -m",
            'kill -TERM -- "-${target_pid}"',
            'kill -KILL -- "-${target_pid}"',
            "sleep 5",
            "trap '' INT TERM",
            "trap cleanup EXIT",
            "handle_signal 130",
            "handle_signal 143",
        ):
            self.assertIn(required, source)
        for forbidden in (
            "--remove-orphans",
            "--volumes",
            "docker volume rm",
            "docker system prune",
            "reset_local",
            "source .env",
            ". .env",
            "set -x",
            "eval ",
            "${TMPDIR",
        ):
            self.assertNotIn(forbidden, source)

    def test_local_lifecycle_order_is_fixed(self):
        source = read("runners/local/run.sh")
        self.assertLess(source.index("cleanup_armed=1"), source.index("up --detach --wait"))
        self.assertLess(source.index("up --detach --wait"), source.index("-m alembic"))
        self.assertLess(source.index("-m alembic"), source.index("check_startup_preflight.py"))
        self.assertLess(source.index("check_startup_preflight.py"), source.index("jira_server.py"))


class GithubRunnerSourceContractTests(unittest.TestCase):
    def test_workflow_is_bounded_and_least_privilege(self):
        workflow = read(".github/workflows/verify-postgresql.yml")
        self.assertIn("pull_request:", workflow)
        self.assertIn("branches: [main]", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("timeout-minutes: 15", workflow)
        self.assertIn("cancel-in-progress: true", workflow)
        self.assertIn(f"postgres:16-alpine@{POSTGRES_DIGEST}", workflow)
        self.assertIn('"127.0.0.1:5432:5432"', workflow)
        self.assertIn('pg_isready -U jep -d jep_ci', workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("actions/checkout@11d5960a326750d5838078e36cf38b85af677262", workflow)
        self.assertIn("actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065", workflow)
        self.assertIn("bash runners/github/run-postgresql-tests.sh", workflow)
        for required in (
            "runs-on: ubuntu-latest",
            "POSTGRES_DB: jep_ci",
            "POSTGRES_USER: jep",
            "POSTGRES_PASSWORD: jep",
            "--health-interval 5s",
            "--health-timeout 5s",
            "--health-retries 12",
            "--memory 2g",
            "--cpus 2",
            "--pids-limit 256",
            "--log-opt max-size=10m",
            "--log-opt max-file=3",
        ):
            self.assertIn(required, workflow)

        lowered = workflow.lower()
        for forbidden in (
            "pull_request_target",
            "workflow_run",
            "self-hosted",
            "secrets.",
            "id-token: write",
            "contents: write",
            "packages: write",
            "environment:",
            "needs:",
            "upload-artifact",
            "docker/login-action",
            "docker push",
            "gh release",
            "release-action",
            "kubectl",
            "helm ",
            "ssh ",
            "scp ",
            "deploy",
        ):
            self.assertNotIn(forbidden, lowered)

        action_refs = re.findall(r"uses:\s+[^@\s]+@([^\s#]+)", workflow)
        self.assertTrue(action_refs)
        self.assertTrue(all(re.fullmatch(r"[0-9a-f]{40}", ref) for ref in action_refs))
        action_names = re.findall(r"uses:\s+([^@\s]+)@", workflow)
        self.assertEqual(action_names, ["actions/checkout", "actions/setup-python"])
        self.assertIsNone(re.search(
            r"(?m)^\s*[a-z][a-z-]*:\s*write\s*$", workflow,
        ))
        self.assertIsNone(re.search(
            r"\$\{\{\s*(?:secrets|vars)\.", workflow,
        ))
        self.assertIn("job.services.postgres.id", workflow)
        self.assertIn("docker inspect --format", workflow)
        self.assertIn("127.0.0.1:5432", workflow)

    def test_ci_target_validation_precedes_alembic_and_tests(self):
        source = read("runners/github/run-postgresql-tests.sh")
        self.assertIn("GITHUB_ACTIONS", source)
        self.assertEqual(source.count(CI_URL), 1)
        validation = source.index('readonly expected_ci_url=')
        alembic = source.index("python -m alembic")
        tests = source.index("python -m unittest")
        self.assertLess(validation, alembic)
        self.assertLess(alembic, tests)
        for name in ("DATABASE_URL", "TEST_DATABASE_URL"):
            self.assertIn(name, source)
        self.assertIn("REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1", source)
        self.assertIn("tests.test_token_refresh_race", source)
        self.assertIn("tests.test_user_view_config_concurrency", source)
        for forbidden in ("set -x", "source .env", "printenv", " env", "reset_local"):
            self.assertNotIn(forbidden, source)

    def _run_ci_guard(self, **values):
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_bin = Path(tmpdir) / "bin"
            fake_bin.mkdir()
            python_log = Path(tmpdir) / "python.log"
            fake_python = fake_bin / "python"
            fake_python.write_text(
                "#!/usr/bin/env bash\n"
                "printf 'python invoked\\n' >> \"$CI_PYTHON_LOG\"\n"
                "exit 99\n",
                encoding="utf8",
            )
            fake_python.chmod(0o755)
            env = os.environ.copy()
            for name in ("GITHUB_ACTIONS", "DATABASE_URL", "TEST_DATABASE_URL"):
                env.pop(name, None)
            env.update({
                "PATH": f"{fake_bin}{os.pathsep}{env.get('PATH', '')}",
                "CI_PYTHON_LOG": str(python_log),
                **values,
            })
            result = subprocess.run(
                ["bash", str(ROOT / "runners/github/run-postgresql-tests.sh")],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            log = python_log.read_text(encoding="utf8") if python_log.exists() else ""
            return result, log

    def test_ci_runner_rejects_missing_database_url_before_python(self):
        result, log = self._run_ci_guard(
            GITHUB_ACTIONS="true", TEST_DATABASE_URL=CI_URL,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, "")
        self.assertNotIn("jep:jep", result.stderr)

    def test_ci_runner_rejects_mismatched_test_url_before_python(self):
        result, log = self._run_ci_guard(
            GITHUB_ACTIONS="true",
            DATABASE_URL=CI_URL,
            TEST_DATABASE_URL="postgresql+psycopg://jep:jep@127.0.0.1:5432/other_ci",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, "")
        self.assertNotIn("jep:jep", result.stderr)

    def test_ci_runner_rejects_mismatched_database_url_before_python(self):
        result, log = self._run_ci_guard(
            GITHUB_ACTIONS="true",
            DATABASE_URL="postgresql+psycopg://jep:jep@127.0.0.1:5432/other_ci",
            TEST_DATABASE_URL=CI_URL,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, "")
        self.assertNotIn("jep:jep", result.stderr)

    def test_ci_runner_rejects_database_query_redirect_before_python(self):
        result, log = self._run_ci_guard(
            GITHUB_ACTIONS="true",
            DATABASE_URL=f"{CI_URL}?host=remote.invalid",
            TEST_DATABASE_URL=CI_URL,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, "")
        self.assertNotIn("jep:jep", result.stderr)

    def test_ci_runner_rejects_non_github_execution_before_python(self):
        result, log = self._run_ci_guard(
            DATABASE_URL=CI_URL, TEST_DATABASE_URL=CI_URL,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(log, "")
        self.assertNotIn("jep:jep", result.stderr)


class RunnerIsolationContractTests(unittest.TestCase):
    def test_deployment_and_release_allowlists_do_not_copy_runners(self):
        dockerfile = read("Dockerfile")
        release = read(".github/workflows/release-latest.yml")
        self.assertNotIn("COPY runners", dockerfile)
        self.assertNotIn("cp -R runners", release)
        self.assertNotIn("runners/", dockerfile)
        self.assertNotIn("runners/", release)
        self.assertIsNone(re.search(r"(?m)^\s*COPY\s+\.\s+\.", dockerfile))
        self.assertIsNone(re.search(r"(?m)^\s*cp\s+-R\s+\.\s", release))

    def test_source_checkout_docs_point_to_the_isolated_runner(self):
        for path in ("README.md", "INSTALL.md"):
            source = read(path)
            self.assertIn("./runners/local/run.sh", source)
            self.assertIn("localhost", source.lower())


if __name__ == "__main__":
    unittest.main()
```

- [x] **Step 2: Run the new tests and verify red state**

Run:

```bash
.venv/bin/python -m unittest -v tests.test_postgresql_runner_contract
```

Expected: errors for missing `runners/local/compose.yaml`, `runners/local/run.sh`, `runners/github/run-postgresql-tests.sh`, `.github/workflows/verify-postgresql.yml`, and documentation pointers. Existing deployment-isolation assertions pass.

### Task 2: Implement And Black-Box Test The Localhost Runner

**Files:**

- Create: `runners/local/compose.yaml`
- Create: `runners/local/run.sh`
- Create: `tests/test_local_postgresql_runner.py`
- Test: `tests/test_postgresql_runner_contract.py`

- [x] **Step 1: Add daemon-free process tests before the runner implementation**

Create `tests/test_local_postgresql_runner.py` with this complete daemon-free harness:

```python
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


class LocalPostgresqlRunnerProcessTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        base = Path(self.tempdir.name)
        self.repo = base / "repo with spaces"
        self.runner_dir = self.repo / "runners" / "local"
        self.runner_dir.mkdir(parents=True)
        shutil.copy2(ROOT / "runners/local/run.sh", self.runner_dir / "run.sh")
        shutil.copy2(ROOT / "runners/local/compose.yaml", self.runner_dir / "compose.yaml")
        (self.repo / "backend/db").mkdir(parents=True)
        (self.repo / "backend/db/alembic.ini").write_text("[alembic]\n", encoding="utf8")
        (self.repo / "jira_server.py").write_text("# sentinel\n", encoding="utf8")

        python_bin = self.repo / ".venv/bin/python"
        python_bin.parent.mkdir(parents=True)
        self._write_executable(python_bin, PYTHON_STUB)
        fake_bin = base / "fake-bin"
        fake_bin.mkdir()
        self._write_executable(fake_bin / "docker", DOCKER_STUB)

        self.log = base / "runner.log"
        self.child_pid_file = base / "child.pid"
        self.grandchild_pid_file = base / "grandchild.pid"
        self.down_started_file = base / "down-started"
        self.lock_dir = Path("/tmp/jira-planning-local-runner.lock")
        self.env = os.environ.copy()
        self.env.pop("DOCKER_CONTEXT", None)
        self.env.update({
            "PATH": f"{fake_bin}{os.pathsep}{self.env.get('PATH', '')}",
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
        return subprocess.run(
            [str(self.runner_dir / "run.sh"), *arguments],
            cwd=self.repo,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

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
        process = subprocess.Popen(
            [str(self.runner_dir / "run.sh")], cwd=self.repo, env=env,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
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
            process.kill()
            self.fail("Flask stub did not start")
        process.send_signal(sent_signal)
        cleanup_deadline = time.monotonic() + 10
        while time.monotonic() < cleanup_deadline:
            if self.down_started_file.exists():
                break
            time.sleep(0.05)
        else:
            process.kill()
            self.fail("cleanup did not start")
        process.send_signal(signal.SIGINT)
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=8)
        self.assertEqual(process.returncode, expected_status, stderr)
        self._assert_down_once(self._log_text())
        self._assert_pid_exits(self.child_pid_file)
        self._assert_pid_exits(self.grandchild_pid_file)
        self._assert_lock_released()

    def test_sigint_returns_130_kills_child_and_cleans_once(self):
        self._assert_signal(signal.SIGINT, 130)

    def test_sigterm_returns_143_kills_child_and_cleans_once(self):
        self._assert_signal(signal.SIGTERM, 143)

    def test_sigterm_escalates_to_kill_for_ignoring_process_tree(self):
        self._assert_signal(
            signal.SIGTERM, 143, ignore_grandchild_term=True,
        )

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
        first = subprocess.Popen(
            [str(self.runner_dir / "run.sh")], cwd=self.repo, env=first_env,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.lock_dir.exists() and first_log.exists() and "jira_server.py" in first_log.read_text(encoding="utf8"):
                break
            time.sleep(0.05)
        else:
            first.kill()
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
        first.communicate(timeout=5)
        self._assert_down_once(first_log.read_text(encoding="utf8"))
        self._assert_lock_released()

    def test_repeated_signals_during_failed_app_cleanup_preserve_status(self):
        env = self.env.copy()
        env.update({
            "FAKE_APP_STATUS": "43",
            "FAKE_DOWN_STARTED_FILE": str(self.down_started_file),
            "FAKE_DOWN_SLEEP": "0.5",
        })
        process = subprocess.Popen(
            [str(self.runner_dir / "run.sh")], cwd=self.repo, env=env,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.down_started_file.exists():
                break
            time.sleep(0.05)
        else:
            process.kill()
            self.fail("cleanup did not start")
        process.send_signal(signal.SIGINT)
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 43, stderr)
        self._assert_down_once(self._log_text())
        self._assert_lock_released()

    def test_arguments_are_rejected_before_docker_access(self):
        result = self._run("--host", "0.0.0.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("arguments are not supported", result.stderr)
        self.assertEqual(self._log_text(), "")
        self._assert_lock_released()


if __name__ == "__main__":
    unittest.main()
```

Run:

```bash
.venv/bin/python -m unittest -v tests.test_local_postgresql_runner
```

Expected: FAIL because `runners/local/run.sh` does not exist.

- [x] **Step 2: Create the exact local Compose service**

Create `runners/local/compose.yaml`:

```yaml
name: jira-planning-local

services:
  postgres:
    image: postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
    environment:
      POSTGRES_DB: jep_local
      POSTGRES_USER: jep
      POSTGRES_PASSWORD: jep
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jep -d jep_local"]
      interval: 2s
      timeout: 5s
      retries: 30
      start_period: 5s
    stop_grace_period: 10s
    mem_limit: 2g
    cpus: 2.0
    pids_limit: 256
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  postgres-data:
    name: jira-planning-local-postgres
```

Do not add a host bind mount, Docker socket, `container_name`, host networking, privileged mode, devices, or an anonymous volume.

- [x] **Step 3: Create the local supervisor**

Create `runners/local/run.sh` using these exact invariants:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly repo_root="$(cd -- "${script_dir}/../.." && pwd -P)"
readonly compose_file="${script_dir}/compose.yaml"
readonly project_name="jira-planning-local"
readonly volume_name="jira-planning-local-postgres"
readonly python_bin="${repo_root}/.venv/bin/python"
readonly lock_dir="/tmp/jira-planning-local-runner.lock"

cleanup_armed=0
cleanup_done=0
lock_owned=0
child_pid=""

fail() {
  printf 'Local PostgreSQL runner: %s\n' "$*" >&2
  exit 1
}

run_child() {
  local child_status
  set -m
  "$@" &
  child_pid=$!
  set +m
  if wait "$child_pid"; then
    child_status=0
  else
    child_status=$?
  fi
  child_pid=""
  return "$child_status"
}

terminate_child_group() {
  local target_pid="${child_pid:-}"
  local killer_pid=""
  [[ -n "$target_pid" ]] || return 0

  kill -TERM -- "-${target_pid}" 2>/dev/null || true
  (
    trap '' INT TERM
    sleep 5
    kill -KILL -- "-${target_pid}" 2>/dev/null || true
  ) &
  killer_pid=$!

  wait "$target_pid" 2>/dev/null || true
  if kill -0 -- "-${target_pid}" 2>/dev/null; then
    wait "$killer_pid" 2>/dev/null || true
  else
    kill "$killer_pid" 2>/dev/null || true
    wait "$killer_pid" 2>/dev/null || true
  fi
  child_pid=""
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT
  trap '' INT TERM

  if [[ "$cleanup_armed" -eq 1 && "$cleanup_done" -eq 0 ]]; then
    cleanup_done=1
    if run_child "${compose[@]}" down --timeout 10; then
      :
    else
      cleanup_status=$?
      printf 'Local PostgreSQL runner: cleanup failed; original status was %s.\n' \
        "$original_status" >&2
    fi
  fi

  if [[ "$lock_owned" -eq 1 ]]; then
    rmdir "$lock_dir" 2>/dev/null || true
    lock_owned=0
  fi
  if [[ "$original_status" -ne 0 ]]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

handle_signal() {
  local signal_status="$1"
  trap '' INT TERM
  terminate_child_group
  exit "$signal_status"
}

[[ "$#" -eq 0 ]] || fail "arguments are not supported."
[[ -x "$python_bin" ]] || fail "missing .venv; run make install first."
[[ -f "${repo_root}/jira_server.py" && -f "${repo_root}/backend/db/alembic.ini" ]] ||
  fail "runner path does not resolve to a source checkout."
command -v docker >/dev/null 2>&1 || fail "Docker is not installed."

if [[ -n "${DOCKER_HOST:-}" ]]; then
  docker_endpoint="$DOCKER_HOST"
elif [[ -n "${DOCKER_CONTEXT:-}" ]]; then
  active_context="$DOCKER_CONTEXT"
  docker_endpoint="$(
    docker context inspect "$active_context" \
      --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null
  )" || fail "unable to inspect the selected Docker context."
else
  active_context="$(docker context show 2>/dev/null)" ||
    fail "unable to read the active Docker context."
  docker_endpoint="$(
    docker context inspect "$active_context" \
      --format '{{ (index .Endpoints "docker").Host }}' 2>/dev/null
  )" || fail "unable to inspect the active Docker context."
fi
case "$docker_endpoint" in
  unix://*) ;;
  *) fail "a local Unix Docker daemon is required; remote contexts are unsupported." ;;
esac

unset DOCKER_HOST DOCKER_CONTEXT
readonly -a docker_cli=(docker --host "$docker_endpoint")
readonly -a compose=(
  "${docker_cli[@]}" compose
  --env-file /dev/null
  --project-directory "$script_dir"
  --project-name "$project_name"
  --file "$compose_file"
)

"${docker_cli[@]}" compose version >/dev/null 2>&1 ||
  fail "Docker Compose v2 is unavailable."
compose_help="$("${docker_cli[@]}" compose up --help 2>&1)" ||
  fail "unable to inspect Docker Compose capabilities."
[[ "$compose_help" == *"--wait-timeout"* ]] ||
  fail "Docker Compose must support up --wait and --wait-timeout."

"${docker_cli[@]}" info >/dev/null 2>&1 ||
  fail "the Docker daemon is unavailable; start Docker and retry."
engine_major="$("${docker_cli[@]}" version --format '{{.Server.Version}}' | cut -d. -f1)"
[[ "$engine_major" =~ ^[0-9]+$ && "$engine_major" -ge 28 ]] ||
  fail "Docker Engine 28 or newer is required for localhost port isolation."

export COMPOSE_DISABLE_ENV_FILE=1
"${compose[@]}" config --quiet || fail "runners/local/compose.yaml is invalid."

trap cleanup EXIT
trap '' INT TERM
if mkdir "$lock_dir" 2>/dev/null; then
  lock_owned=1
else
  trap 'handle_signal 130' INT
  trap 'handle_signal 143' TERM
  fail "another runner is active or a stale runner lock requires inspection: ${lock_dir}"
fi
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

volume_names="$(
  "${docker_cli[@]}" volume ls --format '{{.Name}}'
)" || fail "unable to enumerate runner resources: Docker volumes."
volume_exists=0
while IFS= read -r candidate; do
  if [[ "$candidate" == "$volume_name" ]]; then
    volume_exists=1
    break
  fi
done <<< "$volume_names"

if [[ "$volume_exists" -eq 1 ]]; then
  volume_project="$(
    "${docker_cli[@]}" volume inspect "$volume_name" \
      --format '{{ index .Labels "com.docker.compose.project" }}'
  )" || fail "unable to inspect runner resources: persistent-volume project label."
  volume_key="$(
    "${docker_cli[@]}" volume inspect "$volume_name" \
      --format '{{ index .Labels "com.docker.compose.volume" }}'
  )" || fail "unable to inspect runner resources: persistent-volume key label."
  [[ "$volume_project" == "$project_name" && "$volume_key" == "postgres-data" ]] ||
    fail "runner resources include a persistent volume not owned by this runner."
fi

project_containers="$(
  "${docker_cli[@]}" ps --all --quiet \
    --filter "label=com.docker.compose.project=${project_name}"
)" || fail "unable to inspect project containers."
legacy_containers="$(
  "${docker_cli[@]}" ps --all --quiet \
    --filter "name=^/${project_name}[-_]"
)" || fail "unable to inspect legacy project containers."
project_networks="$(
  "${docker_cli[@]}" network ls --quiet \
    --filter "label=com.docker.compose.project=${project_name}"
)" || fail "unable to inspect project networks."
exact_default_network="$(
  "${docker_cli[@]}" network ls --quiet \
    --filter "name=^${project_name}_default$"
)" || fail "unable to inspect the default project network."
volume_users="$(
  "${docker_cli[@]}" ps --all --quiet --filter "volume=${volume_name}"
)" || fail "unable to inspect persistent-volume users."

[[ -z "$project_containers" && -z "$legacy_containers" &&
   -z "$project_networks" && -z "$exact_default_network" &&
   -z "$volume_users" ]] ||
  fail "runner resources already exist or the retained volume is in use; inspect them before retrying."

export DATABASE_URL="postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_local"
export DATABASE_CONNECTION_MODE=url
export CONFIG_STORAGE_BACKEND=db
export APP_ENVIRONMENT_KEY=local
export APP_BIND_HOST=127.0.0.1
export ALLOW_NETWORK_BIND=false
export ALLOW_BASIC_AUTH_ON_NETWORK=false
export DEBUG_MODE=false

cd "$repo_root"
cleanup_armed=1

if run_child "${compose[@]}" up --detach --wait --wait-timeout 60 postgres; then
  :
else
  startup_status=$?
  printf '%s\n' \
    "Local PostgreSQL runner: PostgreSQL did not become healthy; port 127.0.0.1:5432 may be occupied." >&2
  "${compose[@]}" ps --all >&2 || true
  "${compose[@]}" logs --no-color --tail 100 postgres >&2 || true
  exit "$startup_status"
fi

run_child "$python_bin" -m alembic -c backend/db/alembic.ini upgrade head
run_child "$python_bin" scripts/check_startup_preflight.py
run_child "$python_bin" jira_server.py
```

Make it executable:

```bash
chmod +x runners/local/run.sh
```

- [x] **Step 4: Run focused local tests and static validation**

Run:

```bash
bash -n runners/local/run.sh
.venv/bin/python -m unittest -v \
  tests.test_postgresql_runner_contract.LocalRunnerSourceContractTests \
  tests.test_local_postgresql_runner
docker compose \
  --env-file /dev/null \
  --project-directory runners/local \
  --project-name jira-planning-local \
  --file runners/local/compose.yaml \
  config --quiet
```

Expected: shell syntax, local source guards, all daemon-free process tests, and Compose config pass. No Docker service starts during the Python tests.

- [ ] **Step 5: Commit only the local runner slice if commits are authorized**

```bash
git add runners/local/compose.yaml runners/local/run.sh \
  tests/test_local_postgresql_runner.py tests/test_postgresql_runner_contract.py
git commit -m "Add isolated localhost PostgreSQL runner"
```

If commits are not authorized, do not stage unrelated files and record the verified diff instead.

### Task 3: Implement The Fail-Closed GitHub PostgreSQL Runner

**Files:**

- Create: `runners/github/run-postgresql-tests.sh`
- Create: `.github/workflows/verify-postgresql.yml`
- Test: `tests/test_postgresql_runner_contract.py`
- Existing prerequisite, do not modify: `tests/test_user_view_config_concurrency.py`

- [x] **Step 1: Re-run the already-written GitHub contract tests and verify red state**

```bash
.venv/bin/python -m unittest -v \
  tests.test_postgresql_runner_contract.GithubRunnerSourceContractTests
```

Expected: errors for the absent script/workflow. The five daemon-free guard tests already defined in Task 1 independently prove unsafe Alembic and test targets, query redirection, missing variables, and non-GitHub execution all exit before fake Python can run and without echoing the synthetic password.

- [x] **Step 2: Create the exact GitHub test script**

Create `runners/github/run-postgresql-tests.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly expected_ci_url="postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_ci"

fail() {
  printf 'PostgreSQL CI runner: %s\n' "$*" >&2
  exit 1
}

[[ "$#" -eq 0 ]] || fail "arguments are not supported."
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || fail "this runner is for GitHub Actions only."
[[ "${DATABASE_URL:-}" == "$expected_ci_url" ]] ||
  fail "DATABASE_URL must be the exact synthetic CI target."
[[ "${TEST_DATABASE_URL:-}" == "$expected_ci_url" ]] ||
  fail "TEST_DATABASE_URL must be the exact synthetic CI target."

cd "$repo_root"
export DATABASE_CONNECTION_MODE=url
export REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1

python -m alembic -c backend/db/alembic.ini upgrade head
python -m unittest -v \
  tests.test_db_migrations \
  tests.test_token_refresh_race \
  tests.test_user_view_config_concurrency
```

Make it executable:

```bash
chmod +x runners/github/run-postgresql-tests.sh
```

- [x] **Step 3: Create the least-privilege workflow**

Create `.github/workflows/verify-postgresql.yml`:

```yaml
name: verify-postgresql

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  postgresql:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
        env:
          POSTGRES_DB: jep_ci
          POSTGRES_USER: jep
          POSTGRES_PASSWORD: jep
        ports:
          - "127.0.0.1:5432:5432"
        options: >-
          --health-cmd "pg_isready -U jep -d jep_ci"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 12
          --memory 2g
          --cpus 2
          --pids-limit 256
          --log-opt max-size=10m
          --log-opt max-file=3

    steps:
      - name: Verify PostgreSQL loopback publication
        env:
          POSTGRES_CONTAINER_ID: ${{ job.services.postgres.id }}
        run: |
          test -n "$POSTGRES_CONTAINER_ID"
          binding="$(docker inspect --format '{{with (index .NetworkSettings.Ports "5432/tcp")}}{{(index . 0).HostIp}}:{{(index . 0).HostPort}}{{end}}' "$POSTGRES_CONTAINER_ID")"
          test "$binding" = "127.0.0.1:5432"

      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5
        with:
          python-version: "3.11"
          cache: pip
          cache-dependency-path: requirements.txt

      - name: Install backend dependencies
        run: python -m pip install --disable-pip-version-check -r requirements.txt

      - name: Verify PostgreSQL migrations and locking
        env:
          DATABASE_CONNECTION_MODE: url
          DATABASE_URL: postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_ci
          TEST_DATABASE_URL: postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_ci
        run: bash runners/github/run-postgresql-tests.sh
```

Do not add a repository environment, secrets, `pull_request_target`, self-hosted runner, artifact upload, deployment, registry login, release permission, or dependency on another workflow.

- [x] **Step 4: Run focused CI runner validation**

```bash
bash -n runners/github/run-postgresql-tests.sh
.venv/bin/python -m unittest -v \
  tests.test_postgresql_runner_contract.GithubRunnerSourceContractTests \
  tests.test_postgresql_runner_contract.RunnerIsolationContractTests
```

Expected: all source and daemon-free negative tests pass. The real migration/locking command remains for a real synthetic PostgreSQL service and must not be faked as completion evidence.

- [ ] **Step 5: Commit only the GitHub runner slice if commits are authorized**

```bash
git add runners/github/run-postgresql-tests.sh \
  .github/workflows/verify-postgresql.yml tests/test_postgresql_runner_contract.py
git commit -m "Verify PostgreSQL locking in GitHub Actions"
```

### Task 4: Document The Source-Checkout-Only Workflow

**Files:**

- Create: `runners/local/README.md`
- Modify: `README.md`
- Modify: `INSTALL.md`
- Test: `tests/test_postgresql_runner_contract.py`

- [x] **Step 1: Write isolated runner documentation**

`runners/local/README.md` must state:

````markdown
# Local PostgreSQL Runner

This source-checkout-only runner starts PostgreSQL in Docker, applies Alembic migrations, runs startup preflight, and then runs Flask from `.venv`. It is localhost-only and is not part of the application image, release archive, or production startup path.

## Run

Prerequisites: Docker Engine 28+ with a local Unix-socket context, Docker Compose with `--wait-timeout`, `.venv`, and a valid local `.env` for the application's auth/encryption settings.

```bash
./runners/local/run.sh
```

Press `Ctrl+C` to stop Flask and remove the runner's PostgreSQL container and network. The `jira-planning-local-postgres` volume remains, so database data survives the next run. Docker prune, Docker Desktop reset, or manual volume deletion can still remove it.

The runner always binds Flask and PostgreSQL to `127.0.0.1`, accepts no overrides, and refuses remote Docker contexts or ambiguous existing runner resources. The `jep`/`jep` database credentials are for this dedicated local container only. Docker access is host-administrator access, and the retained volume can contain sensitive local configuration or encrypted token records.

If a prior process was killed without cleanup, inspect the exact `jira-planning-local` Compose project and the lock path reported by the runner. Do not use broad Docker prune commands or `backend.db.reset_local` as lifecycle cleanup.
````

- [x] **Step 2: Update canonical setup docs without changing production guidance**

In `INSTALL.md`, insert this subsection at the end of `## 2. PostgreSQL`, immediately before `## 3. .env For DB Mode`:

````markdown
### Optional localhost Docker runner (source checkout only)

Source-checkout developers may keep Flask in the local `.venv` while running only PostgreSQL in Docker:

```bash
./runners/local/run.sh
```

This localhost-only runner starts PostgreSQL, waits for health, applies Alembic migrations, runs startup preflight, and then runs Flask. `Ctrl+C` removes its container and network while preserving the named database volume. It is separate from the production image, release archive, and hosted deployment path; see [runners/local/README.md](runners/local/README.md) for prerequisites and safety boundaries.
````

In the README's `Quick test run (TL;DR)` section, replace the existing paragraph beginning `Starting .venv/bin/python jira_server.py does not start PostgreSQL` with:

```markdown
Starting `.venv/bin/python jira_server.py` directly still does not start PostgreSQL, create the database, or run migrations. Source-checkout developers who want a localhost-only PostgreSQL lifecycle may instead run `./runners/local/run.sh`; it keeps Flask in `.venv`, starts only PostgreSQL in Docker, migrates before startup, and removes the container on `Ctrl+C` while retaining its named volume. Production and release startup paths are unchanged. See [INSTALL.md](INSTALL.md) and [the local runner guide](runners/local/README.md).
```

Keep hosted Docker/Cloud SQL sections unchanged.

- [x] **Step 3: Run documentation and isolation tests**

```bash
.venv/bin/python -m unittest -v \
  tests.test_postgresql_runner_contract.RunnerIsolationContractTests
git diff --check -- runners README.md INSTALL.md tests/test_postgresql_runner_contract.py
```

Expected: docs name the exact runner and localhost scope; production Dockerfile/release allowlists remain runner-free; diff check passes.

- [ ] **Step 4: Commit docs only if commits are authorized**

```bash
git add runners/local/README.md README.md INSTALL.md \
  tests/test_postgresql_runner_contract.py
git commit -m "Document localhost PostgreSQL runner"
```

### Task 5: Run Real Lifecycle, PostgreSQL, Abuse, And Regression Gates

**Files:**

- Modify after verified execution: `docs/agents/features/2026-08-27-planned-local-postgresql-runners.md`
- Modify after verified execution: `docs/plans/EXEC-local-postgresql-runners.md`
- Modify index status if accepted/merged: `docs/plans/README.md`

- [x] **Step 1: Run all daemon-free focused checks**

```bash
bash -n runners/local/run.sh runners/github/run-postgresql-tests.sh
.venv/bin/python -m unittest -v \
  tests.test_postgresql_runner_contract \
  tests.test_local_postgresql_runner
docker compose \
  --env-file /dev/null \
  --project-directory runners/local \
  --project-name jira-planning-local \
  --file runners/local/compose.yaml \
  config --quiet
git diff --check
```

Expected: all pass without starting the application or requiring a real database for Python tests.

- [x] **Step 2: Prove the localhost lifecycle with Docker running**

In the runner terminal, resolve the effective endpoint with the same verified precedence as the supervisor, require a local Unix socket, print a shell-escaped assignment for the second terminal, and start the runner with that exact endpoint and a known verification port:

```bash
if [[ -n "${DOCKER_HOST:-}" ]]; then
  runner_docker_endpoint="$DOCKER_HOST"
elif [[ -n "${DOCKER_CONTEXT:-}" ]]; then
  runner_context="$DOCKER_CONTEXT"
  runner_docker_endpoint="$(docker context inspect "$runner_context" --format '{{ (index .Endpoints "docker").Host }}')"
else
  runner_context="$(docker context show)"
  runner_docker_endpoint="$(docker context inspect "$runner_context" --format '{{ (index .Endpoints "docker").Host }}')"
fi
case "$runner_docker_endpoint" in
  unix://*) ;;
  *) printf 'Refusing non-local Docker endpoint.\n' >&2; exit 1 ;;
esac
printf 'Run this assignment in the verification terminal: runner_docker_endpoint=%q\n' \
  "$runner_docker_endpoint"
DOCKER_HOST="$runner_docker_endpoint" DOCKER_CONTEXT= SERVER_PORT=5050 \
  ./runners/local/run.sh
```

Before the app starts, verify Alembic reaches head and preflight passes. In the verification terminal, run the exact assignment printed above, then define pinned Docker command arrays and inspect the application, service, and unique persistence marker:

```bash
case "$runner_docker_endpoint" in
  unix://*) ;;
  *) printf 'Missing local runner_docker_endpoint.\n' >&2; exit 1 ;;
esac
docker_cli=(docker --host "$runner_docker_endpoint")
compose_probe=(
  "${docker_cli[@]}" compose
  --env-file /dev/null
  --project-directory runners/local
  --project-name jira-planning-local
  --file runners/local/compose.yaml
)

curl -fsS http://127.0.0.1:5050/health
lsof -nP -iTCP:5050 -sTCP:LISTEN
container_id="$("${compose_probe[@]}" ps --quiet postgres)"
"${docker_cli[@]}" inspect "$container_id" --format '{{json .NetworkSettings.Ports}}'

probe_table="runner_persistence_probe_$(date +%s)_$$"
[[ "$probe_table" =~ ^[a-z][a-z0-9_]*$ ]]
probe_absent="$(
  "${docker_cli[@]}" exec "$container_id" \
    psql -U jep -d jep_local -v ON_ERROR_STOP=1 -tAc \
    "SELECT to_regclass('public.${probe_table}') IS NULL;"
)"
test "$probe_absent" = "t"
"${docker_cli[@]}" exec "$container_id" \
  psql -U jep -d jep_local -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE ${probe_table} (marker text PRIMARY KEY); INSERT INTO ${probe_table}(marker) VALUES ('local-runner-probe');"
```

Expected: health succeeds; `lsof` reports `127.0.0.1:5050 (LISTEN)` and never `*:5050`, `0.0.0.0:5050`, or `[::]:5050`; PostgreSQL's only published host IP is `127.0.0.1`.

Press `Ctrl+C`; require runner exit 130. Then verify exact teardown and retained data:

```bash
test -z "$("${compose_probe[@]}" ps --all --quiet)"
test -z "$("${docker_cli[@]}" network ls --quiet --filter 'name=^jira-planning-local_default$')"
"${docker_cli[@]}" volume inspect jira-planning-local-postgres >/dev/null
```

Restart in the runner terminal with `DOCKER_HOST="$runner_docker_endpoint" DOCKER_CONTEXT= SERVER_PORT=5050 ./runners/local/run.sh`, resolve `container_id` again in the verification terminal, then verify and remove the marker:

```bash
container_id="$("${compose_probe[@]}" ps --quiet postgres)"
"${docker_cli[@]}" exec "$container_id" \
  psql -U jep -d jep_local -v ON_ERROR_STOP=1 -tAc \
  "SELECT marker FROM ${probe_table} WHERE marker = 'local-runner-probe';" | \
  grep -Fx 'local-runner-probe'
"${docker_cli[@]}" exec "$container_id" \
  psql -U jep -d jep_local -v ON_ERROR_STOP=1 -c \
  "DROP TABLE ${probe_table};"
```

Press `Ctrl+C` again and repeat the exact container/network/volume assertions. Ordinary shutdown must never delete the volume.

- [x] **Step 3: Exercise failure and abuse cases against the real daemon**

The real shared daemon checks are limited to safe, reversible cases:

- `DOCKER_HOST=ssh://invalid.example ./runners/local/run.sh`
- While the first runner is active, run a second with `TMPDIR="$(mktemp -d)"`; require nonzero exit before `compose up` and leave the first healthy.
- Send repeated `SIGINT` to one real run and repeated `SIGTERM` to another; require 130 and 143 respectively, exact cleanup, and no stale `/tmp/jira-planning-local-runner.lock`.
- Occupy port 5432 safely with `python3 -m http.server 5432 --bind 127.0.0.1`, capture its PID, require the runner to fail within the 60-second health bound, then terminate and reap only that captured listener PID.
- Occupy port 5050 the same way, run with `SERVER_PORT=5050`, require Flask startup to fail and PostgreSQL cleanup to complete, then terminate and reap only that captured listener PID.

Use this exact listener helper for each port-collision case so interruption cannot strand it:

```bash
listener_pid=""
cleanup_listener() {
  if [[ -n "$listener_pid" ]]; then
    kill -TERM "$listener_pid" 2>/dev/null || true
    wait "$listener_pid" 2>/dev/null || true
    listener_pid=""
  fi
}
trap cleanup_listener EXIT
trap 'cleanup_listener; exit 130' INT
trap 'cleanup_listener; exit 143' TERM

start_listener() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN | grep -q .; then
    printf 'Port %s is already in use; refusing to adopt that listener.\n' "$port" >&2
    return 1
  fi
  python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 &
  listener_pid=$!
  sleep 1
  kill -0 "$listener_pid"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN
}
```

Run each case separately, changing only `collision_port` and `app_port` as shown:

```bash
collision_port=5432
app_port=5051
start_listener "$collision_port"
set +e
SERVER_PORT="$app_port" ./runners/local/run.sh
runner_status=$?
set -e
cleanup_listener
test "$runner_status" -ne 0

collision_port=5050
app_port=5050
start_listener "$collision_port"
set +e
SERVER_PORT="$app_port" ./runners/local/run.sh
runner_status=$?
set -e
cleanup_listener
test "$runner_status" -ne 0
```

After each case, run the exact container/network/volume assertions from Step 2. Do not run broad cleanup commands.

Foreign-volume labels, mounted-volume use, project/legacy containers, labeled/exact-name networks, unavailable-daemon behavior, and signal escalation are mandatory daemon-free black-box tests in `tests.test_local_postgresql_runner`; do not create those collisions or stop a shared developer daemon. They may be repeated manually only against an explicitly isolated disposable Docker daemon.

- [x] **Step 4: Build and inspect deployables without changing deployment paths**

With Docker available, build the unchanged production Dockerfile and prove the runner directory was not copied:

```bash
docker build --tag jira-planning-runner-isolation-probe .
docker run --rm --network none --read-only --entrypoint sh \
  jira-planning-runner-isolation-probe -c 'test ! -e /app/runners'
```

Create a disposable release-layout probe with the same explicit source allowlist used by `.github/workflows/release-latest.yml`:

```bash
probe_root="$(mktemp -d)"
case "$probe_root" in
  /tmp/*|/private/tmp/*|/var/folders/*/T/*|/private/var/folders/*/T/*) ;;
  *) printf 'Unexpected temporary path: %s\n' "$probe_root" >&2; exit 1 ;;
esac
cleanup_probe() {
  [[ -n "${probe_root:-}" ]] || return 0
  [[ -d "$probe_root" && "$probe_root" != "/tmp" && "$probe_root" != "/private/tmp" ]] || return 1
  rm -rf -- "$probe_root"
  probe_root=""
}
trap cleanup_probe EXIT
trap 'cleanup_probe; exit 130' INT
trap 'cleanup_probe; exit 143' TERM

release_root="${probe_root}/release-root"
mkdir -p "$release_root"
cp -R backend planning frontend "$release_root/"
rm -rf -- "${release_root}/frontend/src"
find "${release_root}/frontend" -mindepth 1 -maxdepth 1 ! -name dist -exec rm -rf -- {} +
cp jira_server.py jira-dashboard.html requirements.txt pyproject.toml \
  .env.example INSTALL.md README.md LICENSE "$release_root/"
cp -R assets scripts "$release_root/"

test ! -e "${release_root}/runners"
test ! -e "${release_root}/app/runners"
find "$release_root" -mindepth 1 -maxdepth 3 -print | sort

cleanup_probe
trap - EXIT INT TERM
```

Do not edit `.dockerignore`, `Dockerfile`, or the release workflow. Record the production image ID and release-layout file listing as evidence.

- [ ] **Step 5: Run the full regression suite before any push**

```bash
python3 -m unittest discover -s tests
git diff --check
git diff --stat
git status --short
git log --oneline -5
```

Expected: full Python suite passes; only authorized runner/docs/plan changes plus the user's preserved pre-existing changes appear.

- [ ] **Step 6: Get push approval, push the exact implementation commit, and run the real GitHub/PostgreSQL gate**

Wait for explicit user confirmation before pushing and, if the branch has no open PR, before creating one. After that approval:

```bash
set -euo pipefail
current_branch="$(git branch --show-current)"
implementation_sha="$(git rev-parse HEAD)"
git push origin "$current_branch"

pr_lookup="$(
  gh pr list \
    --state open \
    --head "$current_branch" \
    --base main \
    --limit 2 \
    --json number \
    --jq '
      if length == 0 then "absent"
      elif length == 1 then (.[0].number | tostring)
      else "ambiguous"
      end
    '
)" || {
  printf 'Unable to determine existing PR state; refusing to create one.\n' >&2
  exit 1
}

case "$pr_lookup" in
  absent)
    pr_url="$(
      gh pr create \
        --base main \
        --head "$current_branch" \
        --title "Add isolated PostgreSQL runners" \
        --body "Adds source-checkout-only local PostgreSQL lifecycle tooling and a least-privilege PostgreSQL verification workflow."
    )" || exit 1
    pr_number="$(gh pr view "$pr_url" --json number --jq '.number')" || exit 1
    ;;
  ambiguous)
    printf 'Multiple matching open PRs; refusing to continue.\n' >&2
    exit 1
    ;;
  *)
    pr_number="$pr_lookup"
    ;;
esac

pr_head_sha="$(gh pr view "$pr_number" --json headRefOid --jq '.headRefOid')"
test "$pr_head_sha" = "$implementation_sha"

run_id=""
for attempt in {1..30}; do
  run_id="$(
    gh run list \
      --workflow verify-postgresql.yml \
      --event pull_request \
      --branch "$current_branch" \
      --commit "$implementation_sha" \
      --limit 1 \
      --json databaseId \
      --jq '.[0].databaseId'
  )"
  if [[ -n "$run_id" && "$run_id" != "null" ]]; then
    break
  fi
  sleep 2
done
test -n "$run_id"
test "$run_id" != "null"

gh run watch "$run_id" --exit-status
run_head_sha="$(gh run view "$run_id" --json headSha --jq '.headSha')"
test "$run_head_sha" = "$implementation_sha"
gh run view "$run_id" --json headSha,conclusion,jobs,url
```

The PR's `headRefOid` and the selected run's `headSha` must both equal `implementation_sha`; do not accept a run for a newer or older commit. A feature-branch push without an open PR does not trigger this workflow, and `workflow_dispatch` is unavailable until the workflow exists on the default branch, so the PR gate is mandatory for first introduction.

On GitHub, the new workflow must show:

- Alembic `upgrade head` succeeds against `jep_ci`.
- `tests.test_db_migrations`, `tests.test_token_refresh_race`, and `tests.test_user_view_config_concurrency` all run.
- `test_concurrent_refresh_serializes_against_postgresql` is not skipped.
- All six `PostgresUserViewConcurrencyGateTests` run.
- Current expected total is 27 tests with zero skips; if the test inventory changes, report the new exact total and still require zero PostgreSQL-gate skips.
- Cancellation and timeout settings are visible; no secrets, artifacts, deployment, release, or image publication occurs.

Do not claim this gate from static YAML inspection or a SQLite run.

- [ ] **Step 7: Close the artifacts only after all required evidence exists**

Rename the design artifact to `2026-08-27-executed-local-postgresql-runners.md`, set `Status: executed`, and add `Outcome` and `Current Accuracy` with exact test counts, Docker/Compose versions, bind inspection, persistence proof, signal exit codes, and the GitHub workflow URL, `headSha`, job name, conclusion, exact test total, and zero-skip evidence. The recorded `headSha` must match the runner implementation commit. Keep this plan as `EXEC-*` until accepted or merged; then rename it to `DONE-local-postgresql-runners.md` and update `docs/plans/README.md`.

If the Docker daemon or GitHub workflow is unavailable, leave the artifacts active and report the unproved gate instead of claiming completion.

## Review Findings Incorporated

- Localhost lifecycle audit: forced app binding, explicit Compose CLI ownership, signal supervision, exit-status preservation, digest pin, Compose capability check, daemon-free black-box coverage.
- GitHub/PostgreSQL audit: validate both URLs before Alembic, exact synthetic target, read-only bounded workflow, concrete health contract, canonical requirements install, zero-skip real locking gate.
- Misuse/abuse audit: reject remote daemons and ambient Compose overrides, exclusive ownership, narrow cleanup, PR trust boundary, SHA/digest pins, resource/log bounds, packaging source guards, documented residual risks.

## Execution Handoff

Tasks 1-4 are implemented on `feature/local-postgresql-runners` with sequential subagent implementation, specification review, and code-quality review. The daemon-free gate passes with 39 focused tests, Bash 3.2 syntax validation, and Compose configuration validation. Docker Engine 29.7.2 and Compose v5.4.0 passed the live lifecycle, loopback bind, persistence restart, signal 130/143, concurrent-runner, remote-endpoint, port-collision, exact-cleanup, retained-volume, and production-image isolation checks; image `sha256:40d1e329fbc67fd3d8790ca7eadd0f6d9a56222bb28404b6e8452aa61e911a0a` contains no `/app/runners`, and the release-layout probe contains no runner path. The configured-runtime full suite must still be green before push; its latest run executed 1,323 tests with nine failures in pre-existing EPM configuration behavior, zero errors, and seven skips. No implementation commit or GitHub PostgreSQL run exists. Do not mark this plan done, rename artifacts, commit, push, create a PR, or claim the GitHub gate until those conditions are resolved and verified.
