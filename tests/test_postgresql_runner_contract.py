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
        compose_up = 'run_child "${compose[@]}" up --detach --wait --wait-timeout 60 postgres'
        migration = 'run_child "$python_bin" -m alembic -c backend/db/alembic.ini upgrade head'
        preflight = 'run_child "$python_bin" scripts/check_startup_preflight.py'
        flask = 'run_child "$python_bin" jira_server.py'
        self.assertLess(source.index("cleanup_armed=1"), source.index(compose_up))
        self.assertLess(source.index(compose_up), source.index(migration))
        self.assertLess(source.index(migration), source.index(preflight))
        self.assertLess(source.index(preflight), source.index(flask))


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
        unittest_command = re.search(
            r"(?m)^python -m unittest -v \\\n"
            r"(?P<module_lines>(?:^.*\\\n)*^.*$)",
            source,
        )
        self.assertIsNotNone(unittest_command)
        modules = [
            line.removesuffix("\\").strip()
            for line in unittest_command.group("module_lines").splitlines()
        ]
        self.assertEqual(modules, [
            "tests.test_db_migrations",
            "tests.test_token_refresh_race",
            "tests.test_user_view_config_concurrency",
        ])
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
    RUNNER_GUIDE_URL = (
        "https://github.com/Juce-me/jira-execution-planner/blob/main/"
        "runners/local/README.md"
    )

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
            self.assertIn(self.RUNNER_GUIDE_URL, source)
            self.assertNotIn("](runners/local/README.md)", source)

    def test_install_explains_runner_as_an_alternative_automated_path(self):
        source = read("INSTALL.md")
        runner_section = source.index(
            "### Optional localhost Docker runner (source checkout only)"
        )
        env_section = source.index("## 3. `.env` For DB Mode")

        self.assertLess(runner_section, env_section)
        self.assertIn(
            "Choose exactly one PostgreSQL setup: native PostgreSQL or the "
            "optional localhost Docker runner.",
            source,
        )
        self.assertIn("Do not run both", source)
        self.assertIn("complete section 3", source)
        self.assertIn(
            "replaces the manual migration, startup preflight, and Flask "
            "launch steps in sections 4 and 5",
            source,
        )

    def test_local_guide_documents_narrow_stale_lock_recovery(self):
        source = read("runners/local/README.md")
        self.assertIn("no runner process is active", source)
        self.assertIn(
            "no exact `jira-planning-local` Compose project, container, "
            "network, or volume user is active",
            source,
        )
        self.assertIn(
            "rmdir /tmp/jira-planning-local-runner.lock",
            source,
        )
        self.assertIn("Do not use broad Docker prune commands", source)
        self.assertIn(
            "`backend.db.reset_local` as lifecycle cleanup",
            source,
        )


if __name__ == "__main__":
    unittest.main()
