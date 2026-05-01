import ast
import re
import sys
import types
from pathlib import Path
import unittest
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
JIRA_SERVER_PATH = REPO_ROOT / "jira_server.py"
BACKEND_EPM_ROUTES_PATH = REPO_ROOT / "backend" / "routes" / "epm_routes.py"
BACKEND_ENG_ROUTES_PATH = REPO_ROOT / "backend" / "routes" / "eng_routes.py"
BACKEND_SETTINGS_ROUTES_PATH = REPO_ROOT / "backend" / "routes" / "settings_routes.py"
BACKEND_EPM_PATH = REPO_ROOT / "backend" / "epm"
APP_ROUTE_EPM_PATTERN = re.compile(
    r"@app\.(?:route|get|post|put|patch|delete)\(\s*['\"]\/api\/epm(?:\/|['\"])",
    re.MULTILINE,
)
ENG_ROUTE_PATHS = (
    "/api/dependencies",
    "/api/issues/lookup",
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
APPROVED_ROOT_EPM_SHIMS = {
    "epm_home.py",
    "epm_scope.py",
    "epm_rollup.py",
}


def top_level_definitions(source):
    tree = ast.parse(source)
    return [
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    ]


def app_route_pattern(route_paths):
    alternatives = "|".join(re.escape(path) for path in route_paths)
    return re.compile(
        r"@app\.(?:route|get|post|put|patch|delete)\(\s*['\"](?:"
        + alternatives
        + r")(?:['\"]|/|<)",
        re.MULTILINE,
    )


class BackendRouteSourceGuardTests(unittest.TestCase):
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

    def test_root_epm_helpers_become_import_shims_after_backend_epm_package_exists(self):
        if not BACKEND_EPM_PATH.exists():
            return

        root_epm_files = sorted(REPO_ROOT.glob("epm_*.py"))
        unexpected_helpers = [
            path.name for path in root_epm_files
            if path.name not in APPROVED_ROOT_EPM_SHIMS
        ]
        self.assertEqual(
            unexpected_helpers,
            [],
            "new root epm_*.py helpers are not allowed after backend/epm/ exists",
        )

        real_definition_files = []
        non_backend_import_files = []
        for path in root_epm_files:
            source = path.read_text(encoding="utf8")
            definitions = top_level_definitions(source)
            if definitions:
                real_definition_files.append(f"{path.name}: {', '.join(definitions)}")
            if "backend.epm." not in source:
                non_backend_import_files.append(path.name)

        self.assertEqual(
            real_definition_files,
            [],
            "approved root EPM shims must not keep real def/class definitions after backend/epm/ exists",
        )
        self.assertEqual(
            non_backend_import_files,
            [],
            "approved root EPM shims must import or alias backend.epm.* after backend/epm/ exists",
        )


if __name__ == "__main__":
    unittest.main()
