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
BACKEND_SECURITY_GUARDS_PATH = REPO_ROOT / "backend" / "security" / "guards.py"
BACKEND_EPM_PATH = REPO_ROOT / "backend" / "epm"
BACKEND_EPM_HOME_PATH = BACKEND_EPM_PATH / "home.py"
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


if __name__ == "__main__":
    unittest.main()
