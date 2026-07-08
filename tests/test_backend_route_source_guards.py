import ast
import re
import sys
import types
from pathlib import Path
import unittest
from unittest.mock import patch

from tests.auth_mode_test_utils import force_basic_auth_mode


REPO_ROOT = Path(__file__).resolve().parents[1]
JIRA_SERVER_PATH = REPO_ROOT / "jira_server.py"
BACKEND_EPM_ROUTES_PATH = REPO_ROOT / "backend" / "routes" / "epm_routes.py"
BACKEND_ENG_ROUTES_PATH = REPO_ROOT / "backend" / "routes" / "eng_routes.py"
BACKEND_SETTINGS_ROUTES_PATH = REPO_ROOT / "backend" / "routes" / "settings_routes.py"
BACKEND_ROUTE_GROUPS = {
    "scenario": (REPO_ROOT / "backend" / "routes" / "scenario_routes.py", ("/api/scenario", "/api/scenario/overrides")),
    "stats": (REPO_ROOT / "backend" / "routes" / "stats_routes.py", ("/api/stats", "/api/stats/burnout", "/api/stats/epic-cohort", "/api/stats/excluded-capacity-source")),
    "capacity": (REPO_ROOT / "backend" / "routes" / "capacity_routes.py", ("/api/capacity", "/api/planned-capacity")),
    "export": (REPO_ROOT / "backend" / "routes" / "export_routes.py", ("/api/export-excel",)),
    "diagnostic": (REPO_ROOT / "backend" / "routes" / "diagnostic_routes.py", ("/api/test",)),
    "dev": (REPO_ROOT / "backend" / "routes" / "dev_routes.py", ("/api/debug-fields", "/api/tasks-fields")),
}
FRONTEND_SRC_PATH = REPO_ROOT / "frontend" / "src"
# Matches the bare `/api/stats` endpoint when it appears as a complete quoted
# string literal: preceded by a quote/backtick or the end of a `${...}`
# template interpolation, and immediately closed by a quote/backtick. This
# deliberately does NOT match sub-routes such as `/api/stats/burnout` (a path
# char follows `stats`) nor the import-path string `./api/statsApi.js` (no
# leading slash before `api`).
BARE_STATS_ENDPOINT_PATTERN = re.compile(r"(?<=['\"`}])/api/stats['\"`]")
BACKEND_SECURITY_GUARDS_PATH = REPO_ROOT / "backend" / "security" / "guards.py"
BACKEND_SECURITY_POLICY_PATH = REPO_ROOT / "backend" / "security" / "policy.py"
BACKEND_EPM_PATH = REPO_ROOT / "backend" / "epm"
BACKEND_EPM_HOME_PATH = BACKEND_EPM_PATH / "home.py"
BACKEND_JIRA_ISSUE_TRANSITIONS_PATH = REPO_ROOT / "backend" / "services" / "jira_issue_transitions.py"
APP_ROUTE_EPM_PATTERN = re.compile(
    r"@app\.(?:route|get|post|put|patch|delete)\(\s*['\"]\/api\/epm(?:\/|['\"])",
    re.MULTILINE,
)
ENG_ROUTE_PATHS = (
    "/api/dependencies",
    "/api/issues/lookup",
    "/api/issues/subtasks",
    "/api/missing-info",
    "/api/tasks",
    "/api/tasks-with-team-name",
    "/api/teams",
    "/api/teams/resolve",
    "/api/teams/all",
    "/api/backlog-epics",
)
SETTINGS_ROUTE_PATHS = (
    "/api/config",
    "/api/version",
    "/api/groups-config",
    "/api/team-catalog",
    "/api/projects",
    "/api/components",
    "/api/epics/search",
    "/api/jira/labels",
    "/api/projects/selected",
    "/api/capacity/config",
    "/api/board-config",
    "/api/sprint-field/config",
    "/api/story-points-field/config",
    "/api/parent-name-field/config",
    "/api/team-field/config",
    "/api/stats/priority-weights-config",
    "/api/issue-types",
    "/api/issue-types/config",
    "/api/fields",
    "/api/boards",
    "/api/sprints",
)
class FakeJiraResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


def app_route_pattern(route_paths):
    alternatives = "|".join(re.escape(path) for path in route_paths)
    return re.compile(
        r"@app\.(?:route|get|post|put|patch|delete)\(\s*['\"](?:"
        + alternatives
        + r")(?:['\"]|/|<)",
        re.MULTILINE,
    )


class BackendRouteSourceGuardTests(unittest.TestCase):
    def setUp(self):
        import jira_server

        force_basic_auth_mode(self, jira_server)

    def test_route_server_resolver_prefers_live_main_jira_server(self):
        from backend.routes import get_jira_server

        main_module = types.ModuleType("__main__")
        main_module.__file__ = str(JIRA_SERVER_PATH)
        named_module = types.ModuleType("jira_server")
        named_module.__file__ = str(JIRA_SERVER_PATH)

        with patch.dict(sys.modules, {"__main__": main_module, "jira_server": named_module}):
            self.assertIs(get_jira_server(), main_module)

    def test_package_7d_route_blueprint_modules_exist(self):
        missing = [
            str(path.relative_to(REPO_ROOT))
            for path in (BACKEND_EPM_ROUTES_PATH, BACKEND_ENG_ROUTES_PATH, BACKEND_SETTINGS_ROUTES_PATH)
            if not path.exists()
        ]
        self.assertEqual(missing, [], "Package 7D route blueprint modules must exist")

    def test_jira_server_drops_root_epm_routes_after_epm_blueprint_exists(self):
        if not BACKEND_EPM_ROUTES_PATH.exists():
            return

        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        self.assertEqual(
            APP_ROUTE_EPM_PATTERN.findall(source),
            [],
            "jira_server.py must not retain root @app.route decorators for /api/epm/* after backend/routes/epm_routes.py exists",
        )

    def test_jira_server_drops_root_eng_routes_after_eng_blueprint_exists(self):
        if not BACKEND_ENG_ROUTES_PATH.exists():
            return

        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        self.assertEqual(
            app_route_pattern(ENG_ROUTE_PATHS).findall(source),
            [],
            "jira_server.py must not retain root @app.route decorators for ENG task/team/dependency routes after backend/routes/eng_routes.py exists",
        )

    def test_jira_server_drops_root_settings_routes_after_settings_blueprint_exists(self):
        if not BACKEND_SETTINGS_ROUTES_PATH.exists():
            return

        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        self.assertEqual(
            app_route_pattern(SETTINGS_ROUTE_PATHS).findall(source),
            [],
            "jira_server.py must not retain root @app.route decorators for settings/config/catalog routes after backend/routes/settings_routes.py exists",
        )

    def test_jira_server_drops_moved_root_api_route_decorators_after_blueprints_exist(self):
        source = JIRA_SERVER_PATH.read_text(encoding="utf8")

        failures = {}
        for group_name, (module_path, route_paths) in BACKEND_ROUTE_GROUPS.items():
            if not module_path.exists():
                continue
            matches = app_route_pattern(route_paths).findall(source)
            if matches:
                failures[group_name] = matches

        self.assertEqual(failures, {})

    def test_frontend_does_not_call_legacy_bare_api_stats_endpoint(self):
        """Task 7.1: the legacy bare ``GET /api/stats`` route in
        ``backend/routes/stats_routes.py`` has no current frontend caller. The
        live frontend only requests the sub-routes (``/api/stats/burnout``,
        ``/api/stats/epic-cohort``, ``/api/stats/excluded-capacity-source``,
        ``/api/stats/priority-weights-config``). Because nothing calls the bare
        endpoint, its behavior is intentionally left unchanged (no Ad Hoc
        capacity reclassification applied to ``/api/stats``). This guard fails
        if the frontend is ever wired to call the bare endpoint, which would
        flip the audit to the 7.2 path."""
        # Sanity-check the guard regex: it must catch a bare caller while
        # ignoring the sub-routes and the statsApi.js import path. Without this
        # the test could pass trivially even if the pattern were broken.
        self.assertTrue(
            BARE_STATS_ENDPOINT_PATTERN.search("fetch(`${backendUrl}/api/stats`, opts)"),
            "guard must detect a bare /api/stats template-literal caller",
        )
        self.assertTrue(
            BARE_STATS_ENDPOINT_PATTERN.search("fetch('/api/stats')"),
            "guard must detect a bare '/api/stats' string caller",
        )
        for allowed in (
            "fetch(`${backendUrl}/api/stats/burnout`)",
            "fetch(`${backendUrl}/api/stats/excluded-capacity-source`)",
            "} from './api/statsApi.js';",
        ):
            self.assertIsNone(
                BARE_STATS_ENDPOINT_PATTERN.search(allowed),
                f"guard must not flag allowed reference: {allowed!r}",
            )

        offenders = []
        for source_file in sorted(FRONTEND_SRC_PATH.rglob("*.js")) + sorted(
            FRONTEND_SRC_PATH.rglob("*.jsx")
        ):
            source = source_file.read_text(encoding="utf8")
            if BARE_STATS_ENDPOINT_PATTERN.search(source):
                offenders.append(str(source_file.relative_to(REPO_ROOT)))

        self.assertEqual(
            offenders,
            [],
            "Frontend must not call the legacy bare /api/stats endpoint; only "
            "/api/stats/<subpath> sub-routes are allowed. Found bare callers in: "
            + ", ".join(offenders),
        )

    def test_central_security_guard_owns_oauth_and_csrf_policy(self):
        if not BACKEND_SECURITY_GUARDS_PATH.exists():
            return

        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        forbidden = [
            "def require_oauth_unsafe_method_header",
            "def require_db_admin_csrf_token",
            "def reject_unmigrated_oauth_routes",
            "def reject_stale_oauth_scope_api_sessions",
            "def require_oauth_shared_config_admin",
            "OAUTH_READY_API_PATHS = {",
            "OAUTH_SHARED_CONFIG_WRITE_PATHS = {",
        ]

        present = [pattern for pattern in forbidden if pattern in source]
        self.assertEqual(
            present,
            [],
            "jira_server.py must delegate OAuth readiness, CSRF, and admin write policy to backend/security/guards.py",
        )

    def test_only_dashboard_entry_redirect_remains_as_jira_server_before_request(self):
        if not BACKEND_SECURITY_GUARDS_PATH.exists():
            return

        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        before_request_functions = re.findall(
            r"@app\.before_request\s+def\s+([A-Za-z0-9_]+)\(",
            source,
            flags=re.MULTILINE,
        )

        self.assertEqual(before_request_functions, ["redirect_unauthenticated_oauth_dashboard_entry"])

    def test_root_epm_helpers_do_not_return_after_backend_epm_package_exists(self):
        if not BACKEND_EPM_PATH.exists():
            return

        root_epm_files = sorted(REPO_ROOT.glob("epm_*.py"))
        self.assertEqual(
            [path.name for path in root_epm_files],
            [],
            "root epm_*.py compatibility modules must not return after backend/epm/ exists",
        )

    def test_home_project_worker_fanout_preserves_explicit_context(self):
        if not BACKEND_EPM_HOME_PATH.exists():
            return

        source = BACKEND_EPM_HOME_PATH.read_text(encoding="utf8")
        self.assertIn("def fetch_projects_for_goal(client: HomeGraphQLClient, goal_id: str, context=None)", source)
        self.assertIn("_fetch_or_build_home_project_record(client, row, context=context)", source)
        self.assertIn("executor.map(lambda row:", source)

    def test_epm_aggregate_route_forwards_rollup_headers_and_params(self):
        if not BACKEND_EPM_ROUTES_PATH.exists():
            return

        import jira_server

        payload = {"projects": [], "duplicates": {}, "truncated": False, "fallback": True}
        headers = {"Server-Timing": "home-projects;dur=1, epm-rollups;dur=2, total;dur=3"}

        with jira_server.app.test_client() as client, \
             patch.object(jira_server, "build_all_epm_projects_rollup", return_value=(payload, 200, headers)) as mock_rollup:
            response = client.get("/api/epm/projects/rollup/all?tab=active&sprint=42")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), payload)
        self.assertEqual(response.headers.get("Server-Timing"), headers["Server-Timing"])
        mock_rollup.assert_called_once_with("active", "42", sub_goal_keys=[])

    def test_moved_eng_task_route_delegates_to_shared_fetcher(self):
        if not BACKEND_ENG_ROUTES_PATH.exists():
            return

        route_source = BACKEND_ENG_ROUTES_PATH.read_text(encoding="utf8")

        self.assertIn("def get_tasks_with_team_name():", route_source)
        self.assertIn("return fetch_tasks(include_team_name=True)", route_source)

    def test_eng_task_endpoint_reports_server_timing_header(self):
        import jira_server

        issue = {
            "id": "10001",
            "key": "PROD-1",
            "fields": {
                "summary": "Synthetic task",
                "status": {"name": "To Do"},
                "priority": {"name": "Major"},
                "issuetype": {"name": "Story"},
                "assignee": {"displayName": "Synthetic Owner"},
                "updated": "2026-05-01T00:00:00.000+0000",
                "customfield_sp": 3,
                "customfield_sprint": [{"id": 42, "name": "Sprint 42"}],
                "customfield_epic": "PROD-EPIC",
                "customfield_team": {"id": "team-alpha", "name": "Alpha Team"},
                "parent": {},
                "project": {"key": "PROD", "name": "Product"},
            },
        }

        with jira_server.app.test_client() as client, \
             patch.object(jira_server, "TASKS_CACHE", {}), \
             patch.object(jira_server, "JQL_QUERY_TEMPLATE", ""), \
             patch.object(jira_server, "build_base_jql", return_value='project = "PROD"'), \
             patch.object(jira_server, "get_selected_projects_typed", return_value=[]), \
             patch.object(jira_server, "get_configured_issue_types", return_value=[]), \
             patch.object(jira_server, "resolve_team_field_id", return_value="customfield_team"), \
             patch.object(jira_server, "resolve_epic_link_field_id", return_value="customfield_epic"), \
             patch.object(jira_server, "get_sprint_field_id", return_value="customfield_sprint"), \
             patch.object(jira_server, "get_story_points_field_id", return_value="customfield_sp"), \
             patch.object(jira_server, "jira_search_request", return_value=FakeJiraResponse({
                 "issues": [issue],
                 "names": {
                     "customfield_team": "Team[Team]",
                     "customfield_epic": "Epic Link",
                     "customfield_sprint": "Sprint",
                     "customfield_sp": "Story Points",
                 },
                 "total": 1,
                 "isLast": True,
             })), \
             patch.object(jira_server, "fetch_epic_details_bulk", return_value={}), \
             patch.object(jira_server, "fetch_epics_for_empty_alert", return_value=[]), \
             patch.object(jira_server, "fetch_story_counts_for_epics", return_value={}), \
             patch.object(jira_server, "fetch_story_distribution_for_epics", return_value={}):
            response = client.get("/api/tasks-with-team-name?sprint=42&project=product&refresh=true")

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        server_timing = response.headers.get("Server-Timing", "")
        self.assertIn("jira-search;dur=", server_timing)
        self.assertIn("normalize-tasks;dur=", server_timing)
        self.assertIn("epic-enrichment;dur=", server_timing)
        self.assertIn("build-response;dur=", server_timing)

    def test_eng_routes_registers_both_issue_transition_routes(self):
        source = BACKEND_ENG_ROUTES_PATH.read_text(encoding="utf8")
        self.assertIn("@bp.route('/api/issues/transitions/options', methods=['POST'])", source)
        self.assertIn("@bp.route('/api/issues/transitions', methods=['POST'])", source)

    def test_issue_transition_routes_do_not_call_build_jira_headers(self):
        source = BACKEND_ENG_ROUTES_PATH.read_text(encoding="utf8")
        self.assertNotIn("build_jira_headers(", source)

    def test_jira_issue_transitions_service_has_no_forbidden_imports_or_calls(self):
        # Parse actual import statements (not the module's own docstring prose,
        # which names these same forbidden dependencies to document their
        # absence) so the guard cannot false-positive on the file describing
        # its own constraints.
        source = BACKEND_JIRA_ISSUE_TRANSITIONS_PATH.read_text(encoding="utf8")
        tree = ast.parse(source)
        imported_modules = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_modules.append(node.module)

        forbidden_modules = [
            name for name in imported_modules
            if name == "requests" or name.startswith("backend.epm") or "service_integration" in name
        ]
        self.assertEqual(
            forbidden_modules,
            [],
            "backend/services/jira_issue_transitions.py must stay dependency-injected and avoid direct Jira/Home credential helpers",
        )
        self.assertNotIn(
            "build_jira_headers(",
            source,
            "backend/services/jira_issue_transitions.py must not call build_jira_headers()",
        )

    def test_security_policy_has_exact_issue_transition_endpoint_policies(self):
        source = BACKEND_SECURITY_POLICY_PATH.read_text(encoding="utf8")
        self.assertIn(
            'EndpointPolicy("jira-issue-transition-options", "/api/issues/transitions/options", frozenset({"POST"}), "authenticated_read"),',
            source,
        )
        self.assertIn(
            'EndpointPolicy("jira-issue-transitions-write", "/api/issues/transitions", frozenset({"POST"}), "user_write"),',
            source,
        )


if __name__ == "__main__":
    unittest.main()
