import ast
import re
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
JIRA_SERVER_PATH = REPO_ROOT / "jira_server.py"
BACKEND_EPM_ROUTES_PATH = REPO_ROOT / "backend" / "routes" / "epm_routes.py"
BACKEND_EPM_PATH = REPO_ROOT / "backend" / "epm"
APP_ROUTE_EPM_PATTERN = re.compile(
    r"@app\.(?:route|get|post|put|patch|delete)\(\s*['\"]\/api\/epm(?:\/|['\"])",
    re.MULTILINE,
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


class BackendRouteSourceGuardTests(unittest.TestCase):
    def test_jira_server_drops_root_epm_routes_after_epm_blueprint_exists(self):
        if not BACKEND_EPM_ROUTES_PATH.exists():
            return

        source = JIRA_SERVER_PATH.read_text(encoding="utf8")
        self.assertEqual(
            APP_ROUTE_EPM_PATTERN.findall(source),
            [],
            "jira_server.py must not retain root @app.route decorators for /api/epm/* after backend/routes/epm_routes.py exists",
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
