import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

# jira_server.py keeps 10% headroom, rounded up to the next ten lines, over its measured size, so a PR
# that grows it modestly needs no edit here. The dashboard and owner ceilings live in
# scripts/extraction_lint/owner_budgets.json.
LEGACY_ENTRYPOINT_LINE_BUDGETS = {
    "jira_server.py": 7300,
}


HOOK_CEILING_NAMES = {"useState", "useEffect", "useRef", "useMemo", "useCallback", "useReducer", "useLayoutEffect"}


def _line_count(path):
    with path.open(encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def validate_owner_budgets(manifest, repo_root=REPO_ROOT):
    """Validate frozen physical-file and checkpoint totals without transfer credit."""
    failures = []
    required = {"schemaVersion", "baseSha", "checkpointId", "sourceRoot", "ownerRoots",
                "exclusions", "dashboard", "modules", "transfer"}
    if not isinstance(manifest, dict) or required - manifest.keys():
        return ["manifest missing required schema fields"]
    if manifest["schemaVersion"] != 1:
        failures.append("unsupported schemaVersion")
    if not isinstance(manifest["baseSha"], str) or not manifest["baseSha"] or not isinstance(manifest["checkpointId"], str) or not manifest["checkpointId"]:
        failures.append("missing checkpoint identity")
    if not isinstance(manifest["exclusions"], dict) or not manifest["exclusions"]:
        failures.append("missing explicit exclusions")
    if not isinstance(manifest["transfer"], dict) or not {"incomingRanges", "scaffoldingAllowance"} <= manifest["transfer"].keys():
        failures.append("missing transfer accounting")
    if not isinstance(manifest["sourceRoot"], str) or not isinstance(manifest["ownerRoots"], list) or not manifest["ownerRoots"] or not all(isinstance(value, str) and value for value in manifest["ownerRoots"]):
        return failures + ["invalid sourceRoot/ownerRoots schema"]
    modules = manifest["modules"]
    if not isinstance(modules, list):
        return failures + ["modules must be an array"]
    ids, paths, physical_paths = set(), set(), set()
    for module in modules:
        if not isinstance(module, dict) or not {"id", "path", "features", "exports", "lineCeiling", "interfaces"} <= module.keys():
            failures.append("module missing required schema fields")
            continue
        name = module["path"]
        if not isinstance(name, str) or not isinstance(module["id"], str):
            failures.append("invalid module ID/path schema")
            continue
        if module["id"] in ids or name in paths:
            failures.append(f"duplicate module ID/path: {name}")
            continue
        ids.add(module["id"])
        paths.add(name)
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts or relative.as_posix() != name:
            failures.append(f"invalid repository-relative path: {name}")
            continue
        file = repo_root / relative
        source_directory = (repo_root / "frontend/src").resolve()
        if (file.suffix not in {".js", ".jsx", ".mjs"}
                or not file.resolve().is_relative_to(source_directory)
                or any(part in {"tests", "__tests__", "dist"} for part in relative.parts)
                or ".test." in file.name or ".spec." in file.name):
            failures.append(f"invalid owner source path: {name}")
            continue
        if file.resolve() in physical_paths:
            failures.append(f"duplicate physical owner file: {name}")
            continue
        physical_paths.add(file.resolve())
        if not file.is_file():
            failures.append(f"missing owner file: {name}")
            continue
        if not isinstance(module["features"], list) or not module["features"] or set(module["features"]) - {"scenario", "settings", "stats", "eng"}:
            failures.append(f"invalid feature membership: {name}")
            continue
        actual = _line_count(file)
        if not isinstance(module["lineCeiling"], int) or isinstance(module["lineCeiling"], bool) or actual > module["lineCeiling"]:
            failures.append(f"{name}: {actual} lines exceeds owner ceiling {module['lineCeiling']}")
    if not manifest["sourceRoot"] or Path(manifest["sourceRoot"]).is_absolute() or ".." in Path(manifest["sourceRoot"]).parts or Path(manifest["sourceRoot"]).as_posix() != manifest["sourceRoot"]:
        return failures + ["invalid sourceRoot path"]
    source_root = repo_root / manifest["sourceRoot"]
    for owner_root in manifest["ownerRoots"]:
        if Path(owner_root).is_absolute() or ".." in Path(owner_root).parts or Path(owner_root).as_posix() != owner_root:
            failures.append(f"invalid owner root: {owner_root}")
            continue
        directory = source_root / owner_root
        if not directory.is_dir():
            failures.append(f"missing owner root: {owner_root}")
            continue
        for file in directory.rglob("*"):
            if file.is_file() and file.suffix in {".js", ".jsx", ".mjs"}:
                relative = file.relative_to(repo_root).as_posix()
                if relative not in paths:
                    failures.append(f"unregistered owner source: {relative}")
    dashboard = manifest["dashboard"]
    if not isinstance(dashboard, dict) or not {"path", "lineCeiling"} <= dashboard.keys():
        return failures + ["dashboard missing required schema fields"]
    if not isinstance(dashboard["path"], str) or not dashboard["path"] or Path(dashboard["path"]).is_absolute() or ".." in Path(dashboard["path"]).parts or Path(dashboard["path"]).as_posix() != dashboard["path"]:
        return failures + ["invalid dashboard path"]
    file = repo_root / dashboard["path"]
    if not file.is_file():
        return failures + ["missing dashboard file"]
    actual = _line_count(file)
    ceiling = dashboard["lineCeiling"]
    if not isinstance(ceiling, int) or isinstance(ceiling, bool) or actual > ceiling:
        failures.append(f"{dashboard['path']}: {actual} lines exceeds ceiling {ceiling}")
    # Hook-count ceilings are exact occurrence counts enforced by tests/test_dashboard_regrowth_guard.js; only the shape is checked here.
    hook_ceilings = dashboard.get("hookCeilings")
    if hook_ceilings is not None:
        if not isinstance(hook_ceilings, dict) or set(hook_ceilings) != HOOK_CEILING_NAMES:
            failures.append(f"dashboard hookCeilings must name exactly {sorted(HOOK_CEILING_NAMES)}")
        else:
            failures.extend(f"dashboard hookCeilings.{name} must be a non-negative integer" for name, value in hook_ceilings.items()
                            if not isinstance(value, int) or isinstance(value, bool) or value < 0)
    return failures


class CodebaseStructureBudgetTests(unittest.TestCase):
    def test_extraction_owner_checkpoint(self):
        manifest = json.loads((REPO_ROOT / "scripts/extraction_lint/owner_budgets.json").read_text())
        self.assertEqual(validate_owner_budgets(manifest), [])

    def test_legacy_entrypoints_do_not_grow(self):
        failures = []
        for relative_path, budget in LEGACY_ENTRYPOINT_LINE_BUDGETS.items():
            path = REPO_ROOT / relative_path
            actual = _line_count(path)
            if actual > budget:
                failures.append(f"{relative_path}: {actual} lines exceeds budget {budget}")

        self.assertEqual(failures, [])


class OwnerBudgetValidatorTests(unittest.TestCase):
    """The validator against a temporary repo tree: ceilings fail when exceeded, nothing else needs a manifest edit."""

    DASHBOARD = "frontend/src/dashboard.jsx"
    OWNER = "frontend/src/scenario/useOwner.js"

    def setUp(self):
        scratch = REPO_ROOT / "tmp" / "a2"
        scratch.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(dir=scratch))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def _write(self, relative, lines):
        file = self.root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("".join(f"// line {index}\n" for index in range(lines)))

    def _manifest(self, dashboard_ceiling=10, owner_ceiling=10):
        return {
            "schemaVersion": 1, "baseSha": "synthetic", "checkpointId": "synthetic",
            "sourceRoot": "frontend/src", "ownerRoots": ["scenario"],
            "exclusions": {"generated": ["frontend/dist"]},
            "dashboard": {"path": self.DASHBOARD, "lineCeiling": dashboard_ceiling},
            "modules": [{"id": "scenario.useOwner", "path": self.OWNER, "features": ["scenario"],
                         "exports": ["useOwner"], "lineCeiling": owner_ceiling, "interfaces": []}],
            "transfer": {"incomingRanges": [], "scaffoldingAllowance": 0},
        }

    def _validate(self, manifest):
        return validate_owner_budgets(manifest, self.root)

    def test_dashboard_one_line_over_ceiling_fails_naming_the_file(self):
        self._write(self.DASHBOARD, 11)
        self._write(self.OWNER, 5)
        self.assertEqual(self._validate(self._manifest()), [f"{self.DASHBOARD}: 11 lines exceeds ceiling 10"])

    def test_dashboard_shrink_passes_without_manifest_edit(self):
        self._write(self.DASHBOARD, 10)
        self._write(self.OWNER, 5)
        self.assertEqual(self._validate(self._manifest(dashboard_ceiling=20)), [])

    def test_dashboard_hook_ceilings_shape_is_validated(self):
        self._write(self.DASHBOARD, 5)
        self._write(self.OWNER, 5)
        manifest = self._manifest()
        manifest["dashboard"]["hookCeilings"] = {name: 1 for name in HOOK_CEILING_NAMES}
        self.assertEqual(self._validate(manifest), [])
        manifest["dashboard"]["hookCeilings"]["useState"] = -1
        self.assertEqual(self._validate(manifest), ["dashboard hookCeilings.useState must be a non-negative integer"])
        del manifest["dashboard"]["hookCeilings"]["useRef"]
        self.assertIn("dashboard hookCeilings must name exactly", self._validate(manifest)[0])

    def test_owner_at_ceiling_passes_and_one_over_fails_naming_the_file(self):
        self._write(self.DASHBOARD, 5)
        self._write(self.OWNER, 10)
        self.assertEqual(self._validate(self._manifest()), [])
        self._write(self.OWNER, 11)
        failures = self._validate(self._manifest())
        self.assertEqual(len(failures), 1)
        self.assertIn(self.OWNER, failures[0])
        self.assertIn("exceeds owner ceiling 10", failures[0])

    def test_owner_ceiling_of_ten_fails_for_a_longer_file(self):
        self._write(self.DASHBOARD, 5)
        self._write(self.OWNER, 40)
        failures = self._validate(self._manifest(owner_ceiling=10))
        self.assertEqual(len(failures), 1)
        self.assertIn("40 lines exceeds owner ceiling 10", failures[0])

    def test_unregistered_owner_source_fails(self):
        self._write(self.DASHBOARD, 5)
        self._write(self.OWNER, 5)
        self._write("frontend/src/scenario/extra.js", 3)
        self.assertEqual(self._validate(self._manifest()),
                         ["unregistered owner source: frontend/src/scenario/extra.js"])

    def test_manifest_cli_exits_zero_for_a_valid_tree(self):
        self._write(self.DASHBOARD, 5)
        self._write(self.OWNER, 5)
        manifest = self.root / "owner_budgets.json"
        manifest.write_text(json.dumps(self._manifest()))
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve()), "--manifest", str(manifest), "--repo-root", str(self.root)],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("owner budgets: 0 problems", result.stdout)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    args, remaining = parser.parse_known_args()
    if args.manifest:
        failures = validate_owner_budgets(json.loads(Path(args.manifest).read_text()), args.repo_root)
        for failure in failures:
            print(failure)
        print(f"owner budgets: {len(failures)} problems")
        raise SystemExit(bool(failures))
    unittest.main(argv=[__file__, *remaining])
