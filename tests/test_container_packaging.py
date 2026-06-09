import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class ContainerPackagingTests(unittest.TestCase):
    def test_requirements_include_pinned_gunicorn(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf8")

        self.assertRegex(requirements, r"(?m)^gunicorn==\d+\.\d+\.\d+$")

    def test_dockerfile_uses_entrypoint_and_built_frontend(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf8")

        self.assertIn("scripts/docker-entrypoint.sh", dockerfile)
        self.assertIn("frontend/dist", dockerfile)
        self.assertNotIn("python jira_server.py", dockerfile)
        self.assertNotIn("flask run", dockerfile)

    def test_dockerfile_includes_runtime_source_layout(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf8")

        for required in (
            "COPY backend ./backend",
            "COPY planning ./planning",
            "COPY jira_server.py jira-dashboard.html favicon.ico epm-burst.svg ./",
            "RUN python -m pip install --no-cache-dir -e .",
        ):
            self.assertIn(required, dockerfile)

    def test_dockerfile_defaults_to_container_network_bind(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf8")

        self.assertIn("APP_BIND_HOST=0.0.0.0", dockerfile)
        self.assertIn("ALLOW_NETWORK_BIND=true", dockerfile)

    def test_dockerignore_excludes_local_secret_and_cache_files(self):
        ignored = (ROOT / ".dockerignore").read_text(encoding="utf8")

        for pattern in (
            ".env",
            ".oauth-token-store.json",
            "dashboard-config.json",
            "team-catalog.json",
            "sprints_cache.json",
            "stats_cache.json",
            ".git",
            "node_modules",
        ):
            self.assertIn(pattern, ignored)

    def test_entrypoint_runs_optional_migrations_before_preflight(self):
        entrypoint = (ROOT / "scripts" / "docker-entrypoint.sh").read_text(encoding="utf8")

        self.assertLess(entrypoint.index("alembic"), entrypoint.index("check_startup_preflight.py"))
        self.assertIn("exec gunicorn", entrypoint)

    def test_entrypoint_uses_configurable_container_bind_host(self):
        entrypoint = (ROOT / "scripts" / "docker-entrypoint.sh").read_text(encoding="utf8")

        self.assertIn('${APP_BIND_HOST:-0.0.0.0}:${PORT:-5050}', entrypoint)

    def test_container_workflow_builds_image_without_deploying(self):
        workflow = (ROOT / ".github" / "workflows" / "verify-container.yml").read_text(
            encoding="utf8"
        )

        self.assertIn("docker build -t jira-execution-planner:test .", workflow)
        for forbidden in ("docker push", "kubectl", "helm", "ssh ", "scp ", "deploy"):
            self.assertNotIn(forbidden, workflow.lower())
