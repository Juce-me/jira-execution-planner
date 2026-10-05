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
    # feature/eng-epic-sort-and-track adds the epic Sort dropdown wiring (engEpicSort state,
    # analytics handler, sorted epicGroups, EngView props) and the title-row priority chevron
    # plus Product Track indicator in renderEpicBlock.
    # feat/stats-project-track-tab adds the Project Track stats sub-tab: filter bar (shared
    # sprint range, capacity-side/mode SegmentedControls, exclusion toggles), mode title, and
    # thin wiring for the totals/per-sprint/breakdown charts memoized off excludedCapacityIssues.
    # feat/stats-project-track-phase adds the Epic-mode-only time-in-phase section:
    # imports ProjectTrackPhaseChart + projectTrackPhaseStats helpers, adds fetch state +
    # cache ref, useEffect with abort/cache, memoized epic key set + summary, and
    # renders the section with loading/error/truncated states (Epic mode only).
    # feat/stats-project-track-analytics wires stats_action/chart_action/filter_changed
    # calls into the Capacity side, Mode, and exclusion-toggle handlers (+27 lines).
    # docs/jira-oauth-planning-status-transitions wires the ENG Catch Up/Planning status-pill
    # transition UI: instantiates useEngStatusTransitions, threads statusTransition* props into
    # renderEpicBlock + IssueCard + PlanningActionBar, adds the Settings-modal gate, and the
    # transition-success refresh (task lists + per-story subtask refetch). Menu/state logic
    # lives in StatusTransitionMenu.jsx + the eng hook/utils, so only wiring lands here (+137).
    # docs/eng-priority-edit-mode-plan wires the ENG priority icon edit UI. Menu/state/API logic
    # lives in dedicated eng/issues modules, so dashboard growth is wiring only, itemized:
    # Task 4 (+46) instantiates useEngPriorityTransitions and threads the PriorityTransitionMenu +
    # priority props through renderEpicBlock and IssueCard; Task 5 (+15) imports
    # applyLocalPriorityUpdate and the onApplyLocalPriority/onPrioritySuccessRefresh callbacks; the
    # final-review fix (+7) adds the epicOwnPriority normalization + currentPriorityLabel prop so the
    # Epic menu omits the Epic's OWN priority while the icon still shows the derived child priority
    # (+68 total over main's 15866).
    # feature/eng-targeted-task-updates replaces Catch Up scope refetches with one shared local
    # issue-field patch callback, per-key pending sets, and mutation scope key (+19).
    # bugfix/priority-change-drops-single-team-filter extracts teamOptions construction into
    # the pure buildTeamOptionsForScope helper in teamSelectionUtils.mjs (configured group
    # teams stay authoritative across a Planning task refetch instead of being scanned from
    # fetched capacityTasks), and adds in-session retention of task-derived team display
    # names in the teamOptions memo so a configured team keeps its visible name when a
    # refresh drops its issues without any new initial-load request (+14 over the 15951
    # extraction result). The integrated Statistics controls extraction and Lead Times
    # compaction remain below this existing ceiling.
    # feature/eng-project-track-write-switch wires the Project Track write control into
    # renderEpicBlock: imports ProjectTrackTransitionMenu + useEngProjectTrackTransitions +
    # getProjectTrackLabel, instantiates the hook alongside useEngPriorityTransitions (no
    # success-refresh callback by design), adds closeProjectTrackControl to the group-change
    # cleanup effect, and replaces the passive indicator with the always-rendered
    # interactive/passive branch for real Epics (+35 over the 15965 ceiling).
    # Header dropdown query inputs add Group, Teams, and Sprint filtering while preserving
    # the existing shared main/compact control surface (+101 over the 16000 ceiling).
    # improvement/personal-group-star adds source-aware personal-favorite wiring, canonical
    # preference snapshot application, and stale group-scope clearing. First-run sprint
    # recovery waits for department onboarding, separates sprint errors from task errors,
    # routes Retry back to sprint discovery, deduplicates concurrent Retry requests, and
    # queues required forced refreshes behind active discovery.
    # bugfix/shared-admin-configuration wires one atomic shared snapshot/revision into the
    # existing Settings drafts, threads sequential compare-and-swap saves, and renders conflict
    # plus safe auth-recovery actions. Pure conflict copy/rebase logic stays extracted (+113).
    # feature/user-onboarding-tour adds the first-run Configure-your-own state and suppresses
    # personal favorite validation while the mandatory group editor is active (+8).
    # Task 5 wires the extracted onboarding controller, replay props, stable target attributes,
    # and the single portal mount; tour state and persistence behavior remain extracted (+55).
    # The replay focus fix adds one stable Settings-opener ref and passes it to the tour (+3).
    # bugfix/user-owned-epm-config Task 4 replaces workspace EPM draft/save wiring with the
    # private-view contract while preserving unified Settings save behavior (+36). Task 5
    # integrates the terminal global authentication gate across existing async consumers,
    # keyboard handlers, Scenario polling/SSE, and removes feature-local recovery UI (+43).
    # feature/user-onboarding-tour-improvements wires the first-run create/duplicate guide,
    # verified shared-then-private save recovery, dashboard readiness/preview lifecycle, and
    # Settings-header replay through the legacy composition root. State machines, menus, and
    # coachmark behavior remain extracted in dedicated modules (+634).
    # The contextual onboarding follow-up adds launcher observation and requested-module wiring
    # while keeping the module state machine and coachmark behavior extracted (+2).
    # Screen-scoped onboarding Task 4 replaces the boolean compatibility write with canonical
    # module completion/reset wrappers and merges both returned preference fields (+6).
    # Task 4 review correction derives the current real surface before auto-starting Catch Up
    # and passes the same value to the controller and tour without programmatic navigation (+6).
    # Catch Up re-entry imports the canonical ENG onboarding-surface predicate (+1).
    # Surface interruption passes the controller's non-persisting close callback to the tour (+1).
    # Mobile start eligibility adds one stable viewport callback and passes it to the controller (+2).
    # Contextual module launch eligibility now shares the resolved bootstrap/server-error guard (+6).
    # bugfix/multidevice-sessions-continuation adds per-tab auth-resume capture/restore,
    # staged Planning hydration, and terminal bootstrap-safe recovery wiring (+250).
    # feature/planning-capacity-editing adds the Capacity config lifecycle, one-at-a-time
    # team card editor, mapping re-verification/conflict recovery, local-OAuth fallback,
    # and scoped empty-state refresh while retaining global auth/config flows (+71).
    # bugfix/team-cache-persistence adds sprint-aware empty-cache hydration/readiness state,
    # stale-load protection, and persistence gating before Department editing unlocks (+74).
    # Merge resolution retains contextual onboarding wiring alongside both changes (+75).
    # In-app metrics: generation/dependency lifecycle and admin panel wiring (+27).
    # ENG shared Sprint selector availability separates selection/readiness, adds semantic
    # listbox interaction, explicit blocked-scope scheduling and Settings save/read fencing,
    # plus cache-bypassing Project Track range synchronization on explicit Sprint commitment (+557).
    # Connection recovery keeps only orchestration wiring here; controller, notice, and
    # Scenario restoration behavior live in extracted modules (+15 after merging main).
    # docs/plans/EXEC-multiple-group-labels.md adds the bounded multi-chip Team-label alias
    # editor, oversized-Department alert-scope notice state, and the alias-aware
    # missingLabelEpics/normalizedActiveGroupTeamLabels predicates (+96, +1 after merging
    # main's fixed-height Board page).
    # Unconfigured-workspace gate: config-read wiring, ENG fetch/render gates, and the notice;
    # gate state, admin auto-open, and the notice live in extracted settings modules; the
    # Access tab is shown only to tool admins so it never requests the user directory (+17).
    # docs/plans/EXEC-project-track-board-column-strips.md wires the Team-mode Board-column split
    # memo into the two Project Track charts; the model lives in stats/projectTrackStats.js (+6).
    # Issue #217 adds Planning table orchestration, scope guard and shared editor wiring;
    # explicit Capacity/Project Track columns reuse existing controllers (+5).
    # docs/plans/EXEC-planning-review-table-chrome-217.md: the Planned Teams Effort strip toggle
    # (state, saved preference, collapsed class and the button header) is a one-time exception
    # approved for this plan only (+9); the next step is the dashboard.jsx refactor, not more growth.
    # feature/213-per-epic-refresh Task 6a mounts the per-epic refresh in Catch Up: imports (+2),
    # refs (+1), loadEpicRefresh destructure (+1), load-epoch bump (+1), recent-edit record (+1),
    # useEpicRefresh call (+23), EpicRefreshButton mount (+3), isLeaving (+1), status region (+1).
    # The controller, merge rules and hook live in frontend/src/eng/ (+34).
    # feature/213-per-epic-refresh Task 6b guards the dependency, alert-cohort and subtask
    # effects for the per-epic refresh: merge import (+1), invalidateStorySubtasks destructure
    # (+1), one-shot dependency skip in fetchDependencies (+1) and its disarm effect (+1),
    # refreshEpicDependencies and markDependencySignature (+23), alert cohort token (+9),
    # loadEpicRefresh wrapper that arms the skip before the merge commits (+16), and the
    # clearAggregateSources/afterApply wiring (+9, +52 in total). The skip's signature-and-epoch
    # check lives in frontend/src/eng/epicRefreshDependencySkip.js so a discarded refresh cannot
    # swallow a later department fetch (+3).
    # feature/213-per-epic-refresh Task 13 enables the refresh in Planning: the isEpicRefreshMode
    # gate (+1) and the capacity scope pin that keeps a refresh from refiring /api/capacity (+4).
    # feature/213-per-epic-refresh Task 13b re-checks only the edited epic after inline status and
    # priority edits: alert cohort settle listener helpers (+2), the invalidateAlertsAfterEdit
    # picker with its comment (+5) and a hook-call line split (+1); the scheduler, resolver and
    # call selection live in frontend/src/eng/ (+8). Review fixes: an all-already-in-status edit
    # skips the invalidation (+1) and the epic priority edit patches the readiness snapshot
    # locally for readiness-only epics (+1).
    # Merge of origin/main into feature/213-per-epic-refresh: main alone is 18203 lines (its budget
    # was 18213); this branch adds 104 over main's actual count (34 + 52 + 3 + 5 + 8 + 2, itemized
    # above), so the merged file is 18307 and main's 10 lines of slack are consumed.
    # Merge of origin/main into feature/217-sprint-review-table: main's 18307 plus this branch's Planning table lines (+9 Planned Teams Effort strip, the rest as itemized above); the merged file is 18434 lines.
    # Issue #220 SC2 R5 ratchets to the validated planner-hook checkpoint.
    # Issue #220 SC4 R5 ratchets to the validated ScenarioView checkpoint (the Scenario JSX moved out).
    "frontend/src/dashboard.jsx": 13884,
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
    totals = {"scenario": 0, "settings": 0, "uniqueOwners": 0}
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
        if file.resolve() in physical_paths:
            failures.append(f"duplicate physical owner file: {name}")
            continue
        physical_paths.add(file.resolve())
        if not file.is_file():
            failures.append(f"missing owner file: {name}")
            continue
        if not isinstance(module["features"], list) or not module["features"] or set(module["features"]) - {"scenario", "settings"}:
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
