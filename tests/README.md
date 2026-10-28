# Tests

This directory contains automated tests for the Jira Delivery Planner.

## Test Organization

- `test_planning.py` - Unit tests for scheduling logic (dependencies, capacity, priority)
- `test_scheduler_active_sprint_anchor.py` - Regression test for the Active Sprint anchor behavior
- `test_date_parsing.py` - Unit tests for date parsing utilities
- `test_measure_merge_conflicts.py` - Read-only checks of `scripts/measure_merge_conflicts.py` on synthetic repos under `tmp/a0/` (output lines, classes, hunks, `--attrs`, object count unchanged); skips when git is older than 2.43
- `test_epm_home_oauth_parity.py` - Raw-boundary EPM Home/Jira parity oracle (synthetic `tests/fixtures/epm_home_oauth_parity-example-sanitized.json`; Basic and DB user-token modes today, the OAuth candidate runner plugs in through `register_mode`)
- `test_agents_md_learnings.py` - Guards the union-merged docs: duplicate `AGENTS.md` bullets, duplicate plan links in `docs/plans/README.md`, duplicate analytics rows, conflict markers and the anchored `.gitattributes` lines
- `fixtures/` - Test data files (see `fixtures/README.md` for security policy)
- `ui/` - UI/integration tests (Playwright or similar)

## Running Tests

Run the local CI-style verification path:
```bash
make verify
```

`frontend/dist` is not committed. Run `npm run build` first: tests that read the built bundle (`npm run test:frontend:unit`, `tests/ui`, parts of the Python suite) fail or run on a stale bundle without it.

Run all tests:
```bash
python3 -m unittest discover -s tests
```

Run endpoint security tests:
```bash
make test-security
```

Run frontend unit/source-guard tests:
```bash
npm run test:frontend:unit
```

Run Playwright UI tests:
```bash
npm run test:frontend:ui
```

Run specific test file:
```bash
python3 -m unittest tests.test_planning
python3 -m unittest tests.test_date_parsing
```

Run specific test case:
```bash
python3 -m unittest tests.test_planning.PlanningSchedulerTests.test_dependency_ordering
```

## Extraction safety gate

Use the pinned Node 20 runtime for the Scenario/Settings extraction gate and its synthetic controls:

```bash
fnm exec --using 20 bash scripts/extraction_lint/run.sh
fnm exec --using 20 bash scripts/extraction_lint/negative_controls.sh
```

The gate verifies the complete pinned tool dependency set in ignored `tmp/lint`, runs ESLint and recursive hook/component interface checks, and validates the frozen owner manifest's per-file `lineCeiling`s (dashboard exact, owners with 10% headroom), owner registration and the `jira_server.py` ceiling; shrinking a file needs no manifest edit. Controls cover nested contracts, existing-hook conservation, manifest registration and dependency direction, physical shared-helper counting, authorized ownership transfer, and strict nested-caller diagnostics. Strict diagnostics require a caller/getter phase ledger: deferred closures are reported too, and a lint pass alone does not prove invocation timing. No production files are changed by the controls.

The six core tools are `scripts/extraction_lint/eslint.config.mjs`, `check_hook_interfaces.mjs`, `check_move_conservation.mjs`, `tooling_controls.mjs`, `run.sh`, and `negative_controls.sh`; `owner_budgets.json` is the parent-maintained checkpoint inventory. Nothing is added to `package.json`.

`scripts/extraction_lint/check_app_metrics.mjs` (run by `run.sh`) prints the `App()` metrics table (names, courier names, bags of 25 or more keys, hook occurrences, ui-prefs keys, canary line counts, `dashboard.js` raw and gzip bytes) and enforces the handle-in-dependency guard over every file in `frontend/src`: a bare unstable handle (a custom `use*()` result that is not memoized) in a `useMemo`/`useCallback`/`useEffect` dependency array, or a handle read that a narrow dependency array omits, fails unless it is in the shrink-only `scripts/extraction_lint/handle_dependency_baseline.json` (each entry carries a reason; an entry that no longer occurs also fails, so delete it when the code is fixed). `tests/test_dashboard_regrowth_guard.js` (in `npm run test:frontend:unit`) compares the `useState(`, `useEffect(`, `useRef(`, `useMemo(`, `useCallback(`, `useReducer(`, `useLayoutEffect(` occurrence counts and the line count of `dashboard.jsx` with the exact ceilings under `dashboard` in `owner_budgets.json` (`lineCeiling`, `hookCeilings`) and names the manifest line to edit; exact on purpose, so adding an App-level hook is a one-line manifest edit in the same PR. `check_move_conservation.mjs` also accepts `--allow-effect-edit <oldDigest>=<newDigest>` for an effect edited in place (same owner and position); an unlisted edit still exits 1 and a relocation still needs `--allow-effect-move`.

For conservation, run `fnm exec --using 20 node tmp/lint/check_move_conservation.mjs --base <revision> <complete-affected-hook-file-set>`. Existing hooks are read at both revisions; explicitly name new/deleted files with `--created-hook <file>` / `--deleted-hook <file>`. Scratch comparisons use `--base-file <dashboard>` plus `--dashboard <current-dashboard>` and `--base-hook <current-hook>=<base-hook>`. Exit 0 means effect order matches, **not** that residual edits are accepted; review every printed statement. Exit 1 means effect-order divergence; exit 2 means parse/coverage/tooling failure. Never treat either nonzero result as an empty successful comparison.

Run the 13 synthetic DOM-helper controls before trusting opt-in captures:

```bash
fnm exec --using 20 npx playwright test tests/ui/dom_parity_helpers.spec.js --browser=chromium
```

`captureDomParity` in `ui/dom_parity_helpers.js` writes only when `JEP_DOM_PARITY_DIR` is set. Use two fresh ignored directories and run every instrumented spec in the extraction plan's DOM parity command, then compare nonempty matching filename lists and `diff -r`. Settings fixtures serve the source bundle; captures include every Settings subsection, a dirty Department draft, conflict/discard states, separate preserved-draft and auth-recovery roots, and first-run selection/saving/guide states. React identity normalization preserves reference relationships and live form values; invalid references or duplicate output labels fail before replacing a capture. Only the documented inactive-tab exceptions and app-owned EPM fetched-time readout are normalized.

Scenario characterization in `ui/scenario_draft_history.spec.js` covers eight timeline states with a visible forward dependency, overlapping same-assignee work, and a nonconflicting bar that Conflicts Only removes and restores. `ui/scenario_draft_collaboration.spec.js` captures mounted presence, advisory-lock, dirty-conflict and blocked-writeback states, and pins Assignee mode after switching groups away and back. Set `JEP_SCENARIO_SCREENSHOT_DIR` to a fresh ignored directory for the headed review; the eight-state screenshot test allows 60 seconds for its repeated visual-settle waits, while ordinary behavior/parity runs retain the default timeout. The inactive `scenario_focus_positions.spec.js` remains untouched and does not load real fixtures.

`frontend_source_helpers.js` reads explicit owner files and recursively collects `.js`, `.jsx`, and `.mjs` sources. Pass an existing positive anchor for negative pins so a move cannot silently empty their scope. `test_auth_isolation_source_guard.js` checks dashboard, Scenario and Settings owners for forbidden local auth behavior and resolves each of the six window keydown handlers within its own file, requiring the terminal auth latch before the first key read. `test_extraction_quirk_pins.js` pins the existing 17 Scenario and 33 Settings analytics calls across dashboard/Scenario/Settings/EPM and the edge-update declaration, layout dependency, and late-assignment order. These checks characterize the current source without changing application behavior.

`ui/app_render_counts.spec.js` (App render counts, a group-snapshot effect execution counter and a `Storage.setItem` spy per interaction, with dependency and Scenario hover) is built on the runtime probe bundle and skips without `JEP_RUNTIME_PROBE=1`; run it with `--workers=4` and check `--list` so it is selected. `ui/group_switch_state_restore.spec.js` restores alert, filter, Tech/Product, selection and dependency state across A to B to A and freezes the 62 saved-preference keys.

`test_dashboard_save_trigger_parity.js` parses `dashboard.jsx` with espree (installed on first use into the gitignored `tmp/lint`, the same pin as the lint runner) and checks that the ui-prefs save effect and the `groupStateSnapshot` memo list every reactive value they read, with a negative control per real dependency; `ui/dashboard_save_trigger_parity.spec.js` is its browser counterpart (a lone alerts-panel toggle across A to B to A, a lone Project Track capacity-side change across reload). Both fail on the pre-fix base.

The opt-in `Scenario runtime-work baseline` test in `ui/scenario_draft_history.spec.js` reuses the eight timeline states and reads copied existing counters through an in-memory esbuild adapter after the unique `const perfStateLastRef = useRef({});` anchor. Run it alone with `--grep 'Scenario runtime-work baseline$' --browser=chromium --workers=1`. Set `JEP_EXTRACTION_PERF_DIR` to a new directory under ignored `tmp/`, `JEP_EXTRACTION_PERF_SOURCE_SHA` to the exact independently verified 40-character source revision, and `JEP_EXTRACTION_PERF_COMMAND` to the recorded invocation; optionally set `JEP_EXTRACTION_PERF_SOURCE_ROOT` to a repo-relative archived revision directory (default `.`). Verify that directory's source against the named revision before running. The probe records source digests, fixture/runtime/browser details, eleven ordered cumulative/delta samples and timestamped API requests; it rejects duplicate output and keeps normal polling/presence timers active. Compare two fresh runs at each revision, explaining timer/frame-coalescing variation from raw samples. Counts cover instrumented work, not all component renders/DOM reads, CPU duration or latency. An ordinary full UI run skips this separately required opt-in measurement.

## Test Categories

### Unit Tests
Fast, isolated tests for individual functions/modules:
- `test_planning.py`
- `test_date_parsing.py`

### Integration Tests
Tests that use fixtures or test multiple components:
- `test_scheduler_active_sprint_anchor.py` (uses the sanitized fixture when local real data is absent)

### UI Tests
Browser-based tests (Playwright):
- `ui/*.spec.js` (requires Playwright setup and the local app target used by the spec)

### Source Guard Tests
Node tests that keep extracted frontend ownership boundaries from regressing:
- `test_*_source_guards.js`
- focused frontend utility tests such as `test_stats_utils.js`, `test_epm_project_utils.js`, and `test_scenario_lane_utils.js`

## Security Guidelines

**IMPORTANT**: Some tests use real Jira data and must be kept LOCAL ONLY.

Tests marked with "LOCAL ONLY" comments:
- Use fixtures containing real issue keys, team names, and project data
- Should never be committed to public repositories
- Are blocked by `.gitignore` in the fixtures directory

See `fixtures/README.md` for detailed security policy.

## Writing Tests

When adding new tests:

1. **Use unittest framework** (matches existing tests)
2. **Name test files** `test_*.py`
3. **Name test classes** `Test*` or `*Tests`
4. **Name test methods** `test_*`
5. **Add docstrings** explaining what the test verifies
6. **Keep tests focused** - one concept per test method

Example:
```python
import unittest
from planning.scheduler import schedule_issues

class TestMyFeature(unittest.TestCase):
    """Tests for my new feature."""

    def test_basic_behavior(self):
        """Verify basic functionality works as expected."""
        result = my_function(input_data)
        self.assertEqual(result, expected_value)
```

## Test Data Guidelines

- **Synthetic data** (fake issue keys, generic names): Can be committed
- **Real Jira data**: Must stay local, use fixtures with `.gitignore`
- **Sanitized data**: Create `-sanitized` versions for sharing
- See `fixtures/README.md` for details

## Questions?

See `AGENTS.md` for project structure and guidelines.
