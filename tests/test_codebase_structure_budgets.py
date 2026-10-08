import argparse
import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

LEGACY_ENTRYPOINT_LINE_BUDGETS = {
    # feature/eng-epic-sort-and-track adds the read-only Project Track custom-field getters
    # (get_project_track_field_config/get_project_track_field_id) and threads the field id
    # into fetch_epic_details_bulk's fields list + parse.
    # bugfix/jira-connect-timeout-retry-budget adds JIRA_HTTP_CONNECT_TIMEOUT_SECONDS and
    # threads a bounded connect_timeout through the resilient_jira_get wrapper.
    # feat/stats-epic-project-track-assignee enriches fetch_cached_excluded_capacity_epic_summaries
    # and build_excluded_capacity_issue_payload with epicProjectTrack and epicAssignee.
    # feature/stats-project-track-quarters adds the bounded epic Project Track phase-duration
    # endpoint: parse_track_transitions + compute_track_phase_durations pure helpers, the
    # ThreadPoolExecutor worker fetch with /changelog pagination, and the
    # get_project_track_phase_durations handler.
    # fix/stats-changelog-dedup adds id-based dedup in _fetch_full_issue_changelog to guard
    # against boundary-record re-inclusion from the paged /changelog endpoint (+10 lines).
    # feat/stats-expose-created-transitions adds created + transitions to _fetch_epic_track_phase
    # return dict so the frontend can compute avg days-to-Committed (+2 lines).
    # docs/eng-priority-edit-mode-plan adds the Epic's own priority to fetch_epic_details_bulk
    # (fields list + shaped name) so the Epic priority menu can omit the Epic's own value (+1 line).
    # bugfix/statistics-consistency-exec adds resolve_epic_cohort_range (bounds Lead Times
    # cohorts by start+end quarter, capped at today) and the half-open end-exclusive JQL
    # derivation in fetch_epic_cohort_data (+10 lines).
    # improvement/auth-unfocused-refresh adds a temporary, anonymized after_request
    # diagnostics hook (jep.static_diagnostics) scoped to document/frontend-dist requests,
    # to identify the real owner of a reported repeated-request burst (+37 lines); remove
    # once the navigation owner is identified, per the hook's own removal-criterion comment.
    # feature/eng-group-board-design adds the Delivery Owner custom-field getters
    # (DELIVERY_OWNER_FIELD_DEFAULT, get_delivery_owner_field_config/get_delivery_owner_field_id,
    # mirroring the Project Track getters including the ConfigStorageError fallback guard) and
    # threads the field id + the epic 'updated' field into fetch_epic_details_bulk's fields
    # list and parsed payload (+19 lines).
    # feature/eng-group-board-design Task 6 imports backend.services.group_board, adds the
    # normalize_group_board wrapper, and threads normalize_group_board_fn through the
    # validate_groups_config wrapper, mirroring normalize_group_team_labels (+6 lines).
    # bugfix/ready-to-close-jql-414 batches the GET-backed child scan at 40 epic keys
    # while retaining its existing global result cap and pagination behavior (+5 lines).
    # bugfix/shared-admin-configuration adds the request-scoped immutable workspace config
    # snapshot, route-owned section save wrapper, DB full-replacement guard, and revision-aware
    # field-config compatibility handlers. Validation and persistence remain extracted (+57).
    # bugfix/user-owned-epm-config Task 2 routes every runtime EPM consumer through one
    # authenticated user's private-view config snapshot, threads its generation into cache
    # dependencies, and scopes post-commit cache invalidation to that user's partition (+46).
    # bugfix/review-multidevice-sessions-plan adds the persistent DB browser-session lifecycle
    # entrypoint wiring for callback creation/replacement, failure-safe legacy-cookie upgrade,
    # sanitized upgrade-failure logging, revocation, logout, and browser-bound CSRF/Scenario
    # context propagation (+24).
    # feature/planning-capacity-editing threads the workspace Capacity snapshot through reads,
    # scenario sizing, verified OAuth scope context, and exact Jira issue mutations (+74).
    # In-app load metrics: gated wrapper and worker observer wiring (+3).
    # improvement/multiple-group-labels final-review round: find_comma_scalar_team_label_errors
    # wrapper for the save-only comma-scalar Team-label guard (+2).
    # Issue #217 preserves immutable Epic ID, own Team and project metadata (+7),
    # and carries Components through the existing bulk metadata read (+1).
    # feature/213-per-epic-refresh: epic-refresh purpose branch, cache skip and eviction (+11).
    # feature/213-per-epic-refresh Task 9: epic-alerts purpose: epic_keys clause, failures list
    # handling, import, the epic-alerts branch and the per-epic enrichment block moved to
    # backend/services/epic_refresh.py (+24 added, -19 removed lines; net +5 over the line above).
    # Merge of origin/main into feature/217-sprint-review-table: both lines above are additive; the merged file is 6487 lines.
    "jira_server.py": 6487,
    # App decomposition ratchets the entrypoint to its exact measured size.
    "frontend/src/dashboard.jsx": 7616,
}


def _line_count(path):
    with path.open(encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def validate_owner_budgets(manifest, repo_root=REPO_ROOT):
    """Validate frozen physical-file and checkpoint totals without transfer credit."""
    failures = []
    required = {"schemaVersion", "baseSha", "checkpointId", "sourceRoot", "ownerRoots",
                "exclusions", "dashboard", "modules", "aggregates", "transfer"}
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
    if not isinstance(manifest["aggregates"], dict):
        return failures + ["invalid aggregates schema"]
    modules = manifest["modules"]
    if not isinstance(modules, list):
        return failures + ["modules must be an array"]
    ids, paths, physical_paths = set(), set(), set()
    totals = {"scenario": 0, "settings": 0, "stats": 0, "eng": 0, "uniqueOwners": 0}
    for module in modules:
        if not isinstance(module, dict) or not {"id", "path", "features", "exports", "lineCount", "lineCeiling", "interfaces"} <= module.keys():
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
        if actual != module["lineCount"]:
            failures.append(f"{name}: measured lineCount {module['lineCount']} differs from actual {actual}")
        totals["uniqueOwners"] += actual
        for feature in set(module["features"]):
            totals[feature] += actual
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
    if not isinstance(dashboard, dict) or not {"path", "lineCount", "lineCeiling"} <= dashboard.keys():
        return failures + ["dashboard missing required schema fields"]
    if not isinstance(dashboard["path"], str) or not dashboard["path"] or Path(dashboard["path"]).is_absolute() or ".." in Path(dashboard["path"]).parts or Path(dashboard["path"]).as_posix() != dashboard["path"]:
        return failures + ["invalid dashboard path"]
    file = repo_root / dashboard["path"]
    if not file.is_file():
        return failures + ["missing dashboard file"]
    actual = _line_count(file)
    if actual != dashboard["lineCount"]:
        failures.append("dashboard measured lineCount differs from actual")
    if not isinstance(dashboard["lineCeiling"], int) or actual > dashboard["lineCeiling"]:
        failures.append("dashboard exceeds ceiling")
    totals["appPlusOwners"] = actual + totals["uniqueOwners"]
    for name, actual in totals.items():
        budget = manifest["aggregates"].get(name)
        if not isinstance(budget, dict) or not {"measured", "ceiling"} <= budget.keys():
            failures.append(f"missing aggregate: {name}")
            continue
        if budget["measured"] != actual:
            failures.append(f"{name}: measured aggregate {budget['measured']} differs from unique actual {actual}")
        if not isinstance(budget["ceiling"], int) or actual > budget["ceiling"]:
            failures.append(f"{name}: {actual} exceeds aggregate ceiling {budget['ceiling']}")
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
