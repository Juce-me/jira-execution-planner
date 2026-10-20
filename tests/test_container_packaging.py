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
            "COPY jira_server.py jira-dashboard.html ./",
            "COPY assets ./assets",
            "RUN python -m pip install --no-cache-dir -e .",
        ):
            self.assertIn(required, dockerfile)

    def test_dockerfile_copies_the_review_adoption_script_for_one_off_jobs(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf8")

        self.assertIn(
            "COPY scripts/check_startup_preflight.py scripts/docker-entrypoint.sh scripts/adopt_legacy_sprint_reviews.py ./scripts/",
            dockerfile,
        )

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

    EXPECTED_ACCESS_LOG_FORMAT = '%(h)s %(t)s "%(m)s %(U)r %(H)s" %(s)s %(b)s "%(a)s"'

    def entrypoint_access_log_format(self):
        entrypoint = (ROOT / "scripts" / "docker-entrypoint.sh").read_text(encoding="utf8")
        match = re.search(r"--access-logformat '([^']*)'", entrypoint)
        self.assertIsNotNone(match, "the entrypoint must pass a single-quoted --access-logformat to gunicorn")
        return match.group(1)

    def render_access_log_line(self, raw_uri, path_info, query_string=""):
        """Render one line with gunicorn's own atoms() and SafeAtoms, as gunicorn's access log does."""
        from datetime import timedelta
        from types import SimpleNamespace

        from gunicorn.glogging import Logger, SafeAtoms

        referer = "https://planner.example/?v=1&mode=board&find=secret-text"
        environ = {
            "REMOTE_ADDR": "10.0.0.7",
            "REQUEST_METHOD": "GET",
            "RAW_URI": raw_uri,
            "SERVER_PROTOCOL": "HTTP/1.1",
            "PATH_INFO": path_info,
            "QUERY_STRING": query_string,
            "HTTP_REFERER": referer,
            "HTTP_USER_AGENT": "unit-test",
        }
        response = SimpleNamespace(status="200 OK", sent=512, headers=[])
        request = SimpleNamespace(headers=[("Referer", referer)])
        # A mistyped atom renders as "-" instead of failing, so the tests compare the rendered text.
        atoms = Logger.__new__(Logger).atoms(response, request, environ, timedelta(milliseconds=5))
        return self.entrypoint_access_log_format() % SafeAtoms(atoms)

    def test_entrypoint_access_log_format_matches_the_expected_format(self):
        self.assertEqual(self.entrypoint_access_log_format(), self.EXPECTED_ACCESS_LOG_FORMAT)

    def test_entrypoint_access_log_format_has_no_query_referer_or_raw_client_atoms(self):
        access_format = self.entrypoint_access_log_format()

        for atom, reason in (
            ("%(r)s", "the request line carries the query string"),
            ("%(q)s", "the query string"),
            ("%(f)s", "the Referer carries the full link URL"),
            ("%(l)s", "dropped together with the user name"),
            ("%(u)s", "the Basic-auth user name is client-controlled and can hold a newline"),
            ("%(U)s", "the decoded path is client-controlled and can hold a newline"),
        ):
            with self.subTest(atom=atom):
                self.assertNotIn(atom, access_format, reason)
        self.assertIn("%(U)r", access_format)  # repr escapes a decoded newline

    def test_entrypoint_access_log_line_has_the_path_but_no_query_or_referer(self):
        line = self.render_access_log_line(
            raw_uri="/api/auth/status?v=1&mode=board&find=secret-text",
            path_info="/api/auth/status",
            query_string="v=1&mode=board&find=secret-text",
        )

        self.assertRegex(line, r"""^10\.0\.0\.7 \[[^\]]+\] "GET '/api/auth/status' HTTP/1\.1" 200 512 "unit-test"$""")
        self.assertNotIn("secret-text", line)

    def test_entrypoint_access_log_line_stays_one_line_for_a_decoded_newline_in_the_path(self):
        from gunicorn import util

        raw_uri = "/%0A10.0.0.9%20-%20%5B14/Oct/2026%5D%20%22GET%20/admin%22%20200%20-"
        path_info = util.unquote_to_wsgi_str(raw_uri)  # how gunicorn derives PATH_INFO
        self.assertIn("\n", path_info)

        line = self.render_access_log_line(raw_uri=raw_uri, path_info=path_info)

        self.assertEqual(len(line.splitlines()), 1)
        self.assertIn("'/\\n10.0.0.9 - [14/Oct/2026]", line)

    def test_container_workflow_builds_image_without_deploying(self):
        workflow = (ROOT / ".github" / "workflows" / "verify-container.yml").read_text(
            encoding="utf8"
        )

        self.assertIn("docker build -t jira-execution-planner:test .", workflow)
        for forbidden in ("docker push", "kubectl", "helm", "ssh ", "scp ", "deploy"):
            self.assertNotIn(forbidden, workflow.lower())
