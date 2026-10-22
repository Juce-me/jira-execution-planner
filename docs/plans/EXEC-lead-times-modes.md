# Lead Times Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| Field | Value |
| --- | --- |
| Date | 2026-10-22 |
| Status | Planned, awaiting operator review; no implementation started |
| Branch | `feature/lead-times-modes` (from `origin/main`) |
| Spec | [SUPPORT-lead-times-modes-design.md](SUPPORT-lead-times-modes-design.md) (operator-approved 2026-10-22; read it first, it wins over this plan on intent) |

**Goal:** Statistics > Lead Times gets a single-select mode (Created, Closed, Last N), each with its own selection control, and loses the Assignee filter.

**Architecture:** `POST /api/stats/epic-cohort` gains `mode`. `created` is today's code path, untouched. `closed` and `last_n` use a new Component-scoped, closed-status query (a new pure module plus one orchestrating function in `jira_server.py`); `last_n` returns a bounded recent window and the client slices N after the filters. Mode and its selections live in the existing per-group stats state, and the share link gains two optional keys at `v=1`.

**Tech Stack:** Flask + `unittest` (`.venv/bin/python`), React 19 + esbuild, `node --test`, Playwright (Chromium; headed Firefox/WebKit only when geometry or glyphs change).

## Global Constraints

- Closed = `Done`, `Killed`, `Incomplete`. `Postponed` is excluded from both closed modes entirely. Created mode is unchanged and keeps `Postponed` terminal with its chip.
- Closed-mode scope: exact Jira Component match (`component in (...)`, no Team clause) on `activeGroupMissingComponents`; only when that list is empty, the Team clause of today's query with no `created` bound. Project scope stays `_cohort_project_scope()`. No `OR key in (<ad hoc>)` widening in the closed modes; Epics that match the scope and are in the ad hoc list are still tagged `capacityType: "ad_hoc"`.
- Last N = after the filters (Project, Exclude, status chips). N options exactly 30, 50, 60; default 30. Server window ceiling 200 (`EPIC_COHORT_LAST_N_WINDOW`). Changing N or any filter never refetches; ties in ordering break by Epic key ascending after terminal date descending.
- Mode values exactly `created`, `closed`, `last_n`; default `created`. An absent `mode` on the server means `created`; a present but invalid `mode` is a 400. The client always sends `mode`.
- Share link keys: `lead` (`closed` | `last_n`; absent = `created`) and `n` (`30` | `50` | `60`, only with `lead=last_n`); version stays `v=1`; `last_n` omits `from`/`to`.
- Heatmap in the closed modes: no `Open` column, no `In Progress` or `Postponed` chip, no Workflow Status card, no Open Epics chart; overflow column `Q+12+` / `M+24+` (budget 12 quarters / 24 months; regular columns `0..B-1`, overflow holds elapsed ≥ B); rows span the earliest to the latest created period of the displayed Epics.
- Jira links: Created mode frozen (only the assignee clause goes); closed modes link `key in (...)` of the Epics the chart lists, hidden above 250 keys (`DEFAULT_MAX_JQL_KEYS`).
- No new CSS classes: reuse `SegmentedControl` with `eng-mode-control`, `StatsRangeControl`, `.stats-control-group`, `.controls-label`, `select.scenario-input`, `.stats-note`, `.cohort-empty`. A new class for an existing control kind is a review-stop (register anything genuinely new in `docs/design-system.md` and the ratchet allowlists).
- Jira search is GET `/rest/api/3/search/jql` (`current_jira_search`), so every JQL is sized by `paged_search_bytes` (MRT031); batch Components with `split_component_batches`; never lengthen a query to filter rows the code already discards.
- Pagination: `nextPageToken` / `isLast`. Synthetic data only in tests; no real Jira keys, names or Component names committed.
- Do not hand-edit `frontend/dist/`; run `npm run build` and commit generated output when `.github/workflows/verify-frontend-build.yml` requires it.
- Commits: only after operator authorization (repo rule); descriptive subject under 72 characters, no agent attribution trailer, commit with the noreply identity via one-shot `-c user.name=... -c user.email=...` flags (the local git config holds a personal address). After every commit run `git show --stat HEAD` and `git status`. Never push before the publication transaction in `AGENTS.md` section 10.

## Review Focus

Inputs the spec implies and no task's happy path covers; each has a pinned test in the owning task.

1. An Epic created many periods before it closed: must land in the overflow column, never vanish from the cells (Task 5, Task 9).
2. A closed-status Epic with no `resolutiondate` whose changelog enrichment is capped or fails: must not be silently dropped; warning shown and excluded from the last-N ranking (Task 2).
3. Epics whose current status is `Postponed` or any open status, even if they once closed: never in a closed-mode set (Task 2).
4. Stale or invalid saved values: saved prefs holding `cohortAssigneeFilter`, an unknown mode, or `N=45`; a link with `lead=foo`, `n=7`, or `lead=last_n` without `n` (Task 6, Task 8).
5. Empty sets: no Components and no Teams, no closed Epics in the window, and filters that remove everything in Last N (Task 2, Task 7).

Also covered: MRT018 long lists (>30 rows, >30 completed Epics) in Task 9; Component names with quotes through `_escape_jql_literal` in Task 2.

## File Map

Create: `backend/services/epic_cohort_closed.py` (pure closed-mode query building, selection and ranking; no I/O).
Modify (backend): `jira_server.py` (route, request parsing, cache key, `fetch_closed_epic_cohort_data`, extraction of the shared normalizer), `tests/test_epic_cohort_api.py`, `tests/test_oauth_stats_routes.py`, `tests/test_codebase_structure_budgets.py` only if its own ceiling for `jira_server.py` must be re-pinned (Task 10).
Create (backend tests): `tests/test_epic_cohort_closed.py`.
Modify (frontend): `frontend/src/cohort/cohortUtils.js`, `frontend/src/cohort/CohortGrid.jsx`, `frontend/src/cohort/LeadTimesEpicCharts.jsx`, `frontend/src/stats/StatsPanel.jsx`, `frontend/src/stats/useStatsData.js`, `frontend/src/stats/useStatsState.js`, `frontend/src/stats/statsGroupState.js`, `frontend/src/dashboard.jsx` (state wiring, saved prefs, StatsPanel props, share-apply setters, `statsQueryScope`), `frontend/src/jiraExportUtils.mjs`, `frontend/src/shareView/{viewDefaults,codec,captureState,resolver,applyController}.js`.
Modify (frontend tests): `tests/test_stats_utils.js`, `tests/test_use_stats_data.js`, `tests/test_use_stats_state.js`, `tests/test_stats_group_state.js`, `tests/test_stats_panel.js`, `tests/test_jira_export_utils.js`, `tests/test_share_view_{codec,capture_state,resolver,apply_controller,apply_hook}.js`, `tests/test_cohort_grid_source_guards.js`, `tests/test_stats_controls_source_guards.js`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/ui/shareable_view_links.spec.js`, `tests/ui/dashboard_data_freshness.spec.js`.
Modify (registry and docs): `scripts/extraction_lint/owner_budgets.json`, `docs/features/statistics.md`, `docs/features/shareable-view-links.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, this plan's Execution status.
Generated: `frontend/dist/*` via `npm run build`.

Every named file was confirmed to exist on 2026-10-22 except the Create entries. Re-check with `ls` in Task 0.

## Execution status

| Task | Status | Evidence |
| --- | --- | --- |
| 0 Baseline | not started | |
| 1 Jira probe gate | not started | |
| 2 Closed-mode backend | not started | |
| 3 Route contract | not started | |
| 4 Cohort data model | not started | |
| 5 Heatmap model | not started | |
| 6 State and fetching | not started | |
| 7 Panel UI | not started | |
| 8 Jira links | not started | |
| 9 Share links | not started | |
| 10 Browser coverage | not started | |
| 11 Registry, docs, final gate | not started | |

---

### Task 0: Baseline and preconditions

**Files:** none changed.

- [ ] **Step 1: Branch and tree.** Run `git branch --show-current` (expect `feature/lead-times-modes`), `git fetch origin`, `git log --oneline origin/main..HEAD` (expect only design/plan documentation commits or none), `git status --short` (expect only the two design/plan docs and the plans README entry). Any other change: stop and ask.
- [ ] **Step 2: Read the governing instructions.** Root `AGENTS.md`, `docs/plans/AGENTS.md`, `docs/AGENTS.md`, `docs/design-system.md`, postmortems MRT018, MRT020, MRT021, MRT031, and `backend/security/CONFIGURATION_OWNERSHIP.md`. Note in Execution status that they were read.
- [ ] **Step 3: Baselines** (record pass counts in Execution status):
  - `.venv/bin/python -m unittest tests.test_epic_cohort_api tests.test_oauth_stats_routes tests.test_codebase_structure_budgets`
  - `node --test tests/test_*.js`
  - `npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Lead Times|Statistics subviews" --browser=chromium`
  Expected: all green. A pre-existing failure: stop, explain cause, user impact, reproducibility and a remedy before asking to accept it (repo rule).
- [ ] **Step 4: Confirm the search transport and batching helper.** Read `current_jira_search` (`jira_server.py:729`, GET) and `split_component_batches` / `paged_search_bytes` / `EngBoardError` in `backend/services/eng_board.py`; confirm they import into `jira_server.py` without a cycle (`.venv/bin/python -c "from backend.services import eng_board"`).

### Task 1: Jira probe gate (read-only, numbers only)

**Files:** none changed; results go into this task's Execution status line only as counts.

Why: the closed query relies on `resolutiondate is EMPTY` and `ORDER BY resolutiondate DESC` behaving as assumed, and on the count of closed Epics without `resolutiondate` being small enough for the changelog enrichment cap (200).

- [ ] **Step 1: Probe with the Basic-auth service credentials in the local `.env.backup_basic`** (never through the app's OAuth store, which prunes the local store). Using the real Department Component scope, run these searches through `/rest/api/3/search/jql` and record **counts and yes/no only**; save no keys, names or payloads, delete any scratch output:
  1. Parse check: `issuetype = Epic AND component in (<scope>) AND status in ("Done","Killed","Incomplete") AND resolutiondate is EMPTY` returns without a JQL error. Record the count (call it U).
  2. `... AND resolutiondate is not EMPTY ORDER BY resolutiondate DESC` returns rows whose `resolutiondate` is non-increasing across the first page (yes/no).
  3. The count of `... AND resolutiondate >= "<quarter start>" AND resolutiondate < "<next quarter start>"` for one recent quarter (call it R).
- [ ] **Step 2: Decision rule.** If U ≤ 200 proceed with Task 2 as written. If U > 200, **stop**: the unresolved pass would be truncated by `EPIC_COHORT_ENRICH_MAX_ISSUES` and the closed modes would silently miss Epics. Report U and R to the operator; the plan needs an amendment (candidate: bound the unresolved pass with `status CHANGED TO ... DURING`, not designed here). If check 1 fails to parse or check 2 is "no", stop and report.
- [ ] **Step 3: Record** `U`, `R`, and the two yes/no results in Execution status (counts only, no identifiers).

### Task 2: Closed-mode query, selection and fetch

**Files:**
- Create: `backend/services/epic_cohort_closed.py`, `tests/test_epic_cohort_closed.py`
- Modify: `jira_server.py` (`fetch_epic_cohort_data` at ~5124: extract the shared tail; add `fetch_closed_epic_cohort_data`), `tests/test_epic_cohort_api.py`

**Interfaces:**
- Produces, in `backend/services/epic_cohort_closed.py`:
  - `CLOSED_EPIC_STATUSES = ('Done', 'Killed', 'Incomplete')`
  - `LAST_N_WINDOW_DEFAULT = 200`
  - `class EpicCohortScopeError(ValueError)`
  - `build_closed_epic_jqls(project_clause: str, scope_clause: str, *, mode: str, start_date: date | None, end_date: date | None) -> dict[str, str]` returning `{'resolved': jql, 'unresolved': jql}`. Both start `issuetype = Epic AND project in (...)` plus the scope clause plus `status in ("Done","Killed","Incomplete")`. `resolved` adds `resolutiondate >= "<start>" AND resolutiondate < "<end+1>"` for `closed`, and `resolutiondate is not EMPTY ... ORDER BY resolutiondate DESC` for `last_n`. `unresolved` adds `resolutiondate is EMPTY` and no window or order.
  - `component_scope_clauses(component_names: Sequence[str], build_jql: Callable[[Sequence[str]], str], fields: Sequence[str]) -> list[tuple[str, ...]]`: Component batches via `eng_board.split_component_batches`; raises `EpicCohortScopeError` when a single Component cannot fit.
  - `select_closed_epics(issues: list[dict], *, mode: str, start_date: date | None, end_date: date | None, ceiling: int) -> tuple[list[dict], bool]`: from normalized Epics (the shape `fetch_epic_cohort_data` emits), drops any Epic whose `status` is not in `CLOSED_EPIC_STATUSES` or whose `terminalDate` is missing, keeps `closed` Epics with `start_date <= terminalDate <= end_date`, or for `last_n` sorts by `terminalDate` descending then `key` ascending and keeps `ceiling`; returns `(kept, trimmed)` where `trimmed` is true when the ceiling dropped any.
- Produces, in `jira_server.py`:
  - `EPIC_COHORT_LAST_N_WINDOW = int(os.getenv('EPIC_COHORT_LAST_N_WINDOW', '200'))`
  - `fetch_closed_epic_cohort_data(mode, start_date, end_date, headers, team_field_id, team_ids=None, component_names=None, context=None, ad_hoc_capacity_epics=None) -> tuple[dict | None, response | None]` (same return contract as `fetch_epic_cohort_data`). Payload: `{'range': {'startDate','endDate'} | None, 'issues': [...], 'meta': {'warnings': [...], 'truncated': bool, 'paginationMode': 'nextPageToken/isLast', 'mode': str, 'scope': 'components' | 'teams', 'windowCeiling': int | None, 'windowFull': bool | None}}`. `range` is the closed window for `closed` and `None` for `last_n`. Issue objects have exactly the fields `fetch_epic_cohort_data` emits today.
  - `_normalize_cohort_issues(all_issues, headers, team_field_id, ad_hoc_key_set, context, warnings) -> tuple[list[dict], bool]`: the changelog enrichment and normalization tail extracted from `fetch_epic_cohort_data`; returns `(normalized_issues, truncated)`.

- [ ] **Step 1: Characterize Created output before touching it.** In `tests/test_epic_cohort_api.py` add `test_created_mode_output_is_unchanged_golden` to `TestEpicCohortFetch`: a fixed synthetic page of six Epics (Done with and without `resolutiondate` needing changelog enrichment, Killed, Postponed, open `In Progress`, an ad hoc key) fed through `fetch_epic_cohort_data` with `jira_search_request` and `current_jira_get` patched; assert the exact normalized `issues` list and `meta`. Run it: expected PASS on current code (it pins today's behavior).
- [ ] **Step 2: Extract `_normalize_cohort_issues`** from `fetch_epic_cohort_data` with no behavior change; call it from there. Re-run Step 1's test and the whole `tests.test_epic_cohort_api` module: PASS.
- [ ] **Step 3: Write failing unit tests in `tests/test_epic_cohort_closed.py`:**
  - `test_closed_jqls_use_closed_statuses_only`: neither JQL contains `Postponed`; both contain `status in ("Done","Killed","Incomplete")`.
  - `test_closed_window_jql_bounds_are_inclusive_exclusive`: `end_date=2026-03-31` yields `resolutiondate < "2026-04-01"`.
  - `test_last_n_resolved_jql_orders_desc_and_unresolved_has_no_order`.
  - `test_select_closed_epics_excludes_postponed_and_open_statuses` (Review Focus 3).
  - `test_select_closed_epics_closed_window_post_filter_uses_terminal_date`: an Epic returned by the resolved pass but whose computed `terminalDate` falls outside the window is dropped; an unresolved-pass Epic whose changelog date is inside the window is kept.
  - `test_select_last_n_orders_by_terminal_date_desc_then_key_asc` and `test_select_last_n_reports_trimmed_when_over_ceiling`.
  - `test_component_scope_clauses_batches_under_byte_budget` and `test_component_scope_clauses_raises_for_unfittable_component`.
  Run `.venv/bin/python -m unittest tests.test_epic_cohort_closed`; expected FAIL (module missing).
- [ ] **Step 4: Implement `backend/services/epic_cohort_closed.py`** to the interfaces above (pure functions; JQL literals escaped with the same rule as `_escape_jql_literal`). Re-run: PASS.
- [ ] **Step 5: Write failing fetch tests in `tests/test_epic_cohort_api.py` (`TestEpicCohortClosedFetch`)** with `jira_search_request` patched to return pages keyed by JQL substring and `_cohort_project_scope` patched:
  - `test_closed_mode_with_components_uses_component_clause_only`: the issued JQL contains `component in (` and no `Team[Team]`; `meta.scope == 'components'`.
  - `test_closed_mode_without_components_falls_back_to_team_clause`: no components, team ids given: JQL contains the Team clause and no `created >=`; `meta.scope == 'teams'`.
  - `test_closed_mode_merges_resolved_and_unresolved_passes_and_dedupes_by_key`.
  - `test_closed_mode_unresolved_enrichment_cap_sets_truncated_and_warning_and_excludes_from_ranking` (Review Focus 2): `EPIC_COHORT_ENRICH_MAX_ISSUES` patched to 1 with two unresolved Epics; the second has no `terminalDate`, is absent from `issues`, and `meta.truncated` is true with a warning string.
  - `test_last_n_window_ceiling_sets_window_full`: resolved pass returns more than the ceiling (ceiling patched to 2); `meta.windowFull is True`, `len(issues) == 2`; with fewer rows `windowFull is False`.
  - `test_closed_mode_tags_ad_hoc_epics_without_widening_scope`: ad hoc key matching the scope is tagged `capacityType == 'ad_hoc'`; the JQL contains no `key in (`.
  - `test_closed_mode_component_with_quote_is_escaped`.
  - `test_closed_mode_empty_scope_returns_empty_issues` (no components, no teams: project-scoped, zero results; payload valid, `issues == []`).
  Run: expected FAIL (function missing).
- [ ] **Step 6: Implement `fetch_closed_epic_cohort_data`** in `jira_server.py`: build the scope (Components via `component_scope_clauses` and `build_missing_info_scope_clause([], batch)`, else `build_missing_info_scope_clause(team_ids, [])`); for each batch run the `resolved` and `unresolved` searches with a local paging helper that stops after `max_pages=80` pages or, for the `last_n` resolved pass, after `EPIC_COHORT_LAST_N_WINDOW + 1` rows (the extra row proves `windowFull`); merge by key; call `_normalize_cohort_issues`; call `select_closed_epics`; assemble the payload. Map `EpicCohortScopeError` to a raised error the route turns into a 400 (Task 3). Run `tests.test_epic_cohort_api` and `tests.test_epic_cohort_closed`: PASS.
- [ ] **Step 7: Checkpoint** (commit only if authorized): `feat: add closed-epic cohort query for Lead Times modes`.

### Task 3: Route contract, validation and caching

**Files:** Modify `jira_server.py` (`get_epic_cohort_stats` ~5853, `_build_epic_cohort_cache_key` ~1230), `tests/test_epic_cohort_api.py`, `tests/test_oauth_stats_routes.py`.

**Interfaces:**
- Produces `parse_epic_cohort_request(payload: dict, reference_date: date | None = None) -> dict` with keys `mode`, `startQuarter`, `endQuarter`, `startDate`, `endDate` (dates are `None` for `last_n`); raises `ValueError(message)` using today's messages for the quarter cases.
- Produces `_build_epic_cohort_cache_key(start_quarter, end_quarter, team_ids, projects, components=None, ad_hoc_epics=None, mode='created') -> str`: for `mode='created'` the string is byte-identical to today's; otherwise it is prefixed `closed::` or `last_n::` (for `last_n` the quarter segments are empty).
- Consumes `fetch_closed_epic_cohort_data` (Task 2).

- [ ] **Step 1: Write failing tests** in `tests/test_epic_cohort_api.py`:
  - `TestEpicCohortHelpers.test_cache_key_created_mode_is_unchanged` (compare against the literal string for a fixed input) and `test_cache_key_differs_per_mode`.
  - `TestEpicCohortEndpoint.test_mode_defaults_to_created_and_calls_created_fetch` (patch both fetchers; `fetch_epic_cohort_data` called once, closed fetcher not called).
  - `test_closed_mode_calls_closed_fetch_with_resolved_window`.
  - `test_last_n_mode_calls_closed_fetch_without_quarters`.
  - `test_invalid_mode_requests_return_400_before_jira_access` with subTests: `mode: 'bogus'` → `mode must be created, closed or last_n`; `last_n` with `startQuarter` → `last_n does not take startQuarter or endQuarter`; `closed` without quarters → `startQuarter and endQuarter are required`; `closed` with `endQuarter` after the current quarter → `endQuarter cannot be after the current quarter`; assert `resolve_team_field_id` is never called.
  - `test_scope_too_large_returns_400` (closed fetcher raising `EpicCohortScopeError` → 400 with `error`).
  - `test_closed_mode_response_is_cached_per_mode` (second identical request does not call the fetcher; a different mode does).
  In `tests/test_oauth_stats_routes.py` extend `test_epic_cohort_post_is_oauth_ready` with a `closed` body, and keep the `X-Requested-With` negative test passing for the new modes.
  Run both modules: expected FAIL.
- [ ] **Step 2: Implement** `parse_epic_cohort_request`, the cache-key change and the route branching. `components` and `adHocCapacityEpics` parsing is unchanged. Created path calls `fetch_epic_cohort_data` exactly as today. Run `tests.test_epic_cohort_api`, `tests.test_oauth_stats_routes`, `tests.test_epic_cohort_closed`: PASS.
- [ ] **Step 3: Checkpoint:** `feat: accept Lead Times mode on the epic-cohort route`.

### Task 4: Cohort data model (frontend, pure)

**Files:** Modify `frontend/src/cohort/cohortUtils.js`, `tests/test_stats_utils.js`.

**Interfaces (produces):**
- `export const LEAD_TIMES_MODES = Object.freeze(['created', 'closed', 'last_n'])`
- `export const LEAD_TIMES_LAST_N_OPTIONS = Object.freeze([30, 50, 60])`
- `export function resolveLeadTimesMode(value): 'created' | 'closed' | 'last_n'` (anything else → `'created'`)
- `export function resolveLeadTimesLastN(value): 30 | 50 | 60` (accepts numbers and numeric strings; anything else → `30`)
- `export function buildCohortRequest({ mode, startQuarter, endQuarter, teamIds, components, adHocCapacityEpics }): object` → always `{ mode, teamIds, components, adHocCapacityEpics, refresh: false }`, plus `startQuarter`/`endQuarter` for `created` and `closed` only.
- `export function selectLastClosedEpics(issues, count): object[]` (terminal date descending, key ascending, first `count`; issues without `terminalDate` are skipped).
- `export function createdRangeOf(issues): { startDate: string, endDate: string } | null` (min and max `createdDate`, ISO strings; `null` for no dated issues).
- `filterCohortIssues(issues, filters)` loses `assigneeKey`; `deriveAssigneeOptions` is deleted (and its import in `useStatsData.js` in Task 6).

- [ ] **Step 1: Write failing tests** in `tests/test_stats_utils.js`: `resolveLeadTimesMode` fallbacks (`undefined`, `'foo'`, `'closed'`); `resolveLeadTimesLastN` (`'50'` → 50, `45` → 30, `undefined` → 30); `buildCohortRequest` shapes for all three modes (no quarters in `last_n`); `selectLastClosedEpics` ordering, tie-break by key, count larger than the set, and skipping undated; `createdRangeOf` (mixed dates, empty → `null`); `filterCohortIssues` ignores any `assigneeKey` passed. Run `node --test tests/test_stats_utils.js`: expected FAIL.
- [ ] **Step 2: Implement** the exports above and the removals. Update the existing `tests/test_stats_utils.js` cases that referenced `deriveAssigneeOptions` / `assigneeKey` to the new contract. Run: PASS.
- [ ] **Step 3: Checkpoint:** `feat: add Lead Times mode helpers to the cohort model`.

### Task 5: Heatmap model: overflow column and Open column

**Files:** Modify `frontend/src/cohort/cohortUtils.js` (`buildCohortGridModel`), `frontend/src/cohort/CohortGrid.jsx`, `tests/test_stats_utils.js`, `tests/test_cohort_grid_source_guards.js`.

**Interfaces:**
- `buildCohortGridModel(issues, options)` gains `options.overflowColumn` (boolean, default `false`). When true and the budget is `B` (`options.maxColumns`), regular columns are indices `0..B-1`, elapsed ≥ `B` accumulates into one extra column at index `B` with `label` `Q+B+` / `M+B+`, `key` `elapsedLabel(B, groupBy) + '+'`, and `overflow: true`; the column exists only when at least one Epic overflows. With `overflowColumn` false the model is byte-identical to today's. Per-cell `samples` and `statusCounts` accumulate across all overflowed elapsed values.
- `CohortGrid` gains prop `showOpen` (default `true`); when false it renders neither the `Open` header cell nor the `Open` row cells.

- [ ] **Step 1: Write failing tests** (Review Focus 1): quarter budget 12, an Epic created `2022Q1` and closed `2026Q3` with `overflowColumn: true` lands in the `Q+12+` column and still counts in `totalCreated`; the same input with `overflowColumn: false` produces today's model (cell omitted, `totalCreated` counted); month budget 24 labels `M+24+`; no overflow column when nothing overflows; two Epics with different overflowed elapsed values sum in one cell. Source guard: `CohortGrid.jsx` renders the `Open` header only behind `showOpen`. Run `node --test tests/test_stats_utils.js tests/test_cohort_grid_source_guards.js`: expected FAIL.
- [ ] **Step 2: Implement** and run the same command: PASS.
- [ ] **Step 3: Checkpoint:** `feat: add overflow column and optional Open column to the cohort heatmap`.

### Task 6: State, persistence and fetching

**Files:** Modify `frontend/src/stats/useStatsState.js`, `frontend/src/stats/statsGroupState.js`, `frontend/src/stats/useStatsData.js`, `frontend/src/dashboard.jsx`, `tests/test_use_stats_state.js`, `tests/test_stats_group_state.js`, `tests/test_use_stats_data.js`, `tests/test_stats_controls_source_guards.js`.

**Interfaces:**
- New state (hook values, group-state fields and setters follow the existing `cohortX` / `setCohortX` naming): `cohortMode` (`resolveLeadTimesMode`, default `'created'`), `cohortClosedStartQuarter` and `cohortClosedEndQuarter` (default `getCurrentQuarterLabel()`), `cohortLastN` (`resolveLeadTimesLastN`, default 30). `cohortAssigneeFilter` and its setter are removed everywhere. Saved prefs use the same key names as the state; a stale `cohortAssigneeFilter` key in saved prefs is ignored (never read).
- `useStatsDerivedB` returns, in addition to today's values: `cohortMode`-dependent `cohortStatusControls` (created: today's five; closed modes: `done`, `killed`, `incomplete` only), `cohortDisplayedIssues` (filtered, then `selectLastClosedEpics(filtered, cohortLastN)` only for `last_n`), and `cohortLastNShortfall: { shown: number, requested: number, ceiling: number } | null` (non-null only for `last_n` when `shown < requested` and `data.meta.windowFull === true`). `cohortSummary`, grid, bars, average and median all read `cohortDisplayedIssues`. The grid model uses `{ overflowColumn: mode !== 'created', rangeStartDate/rangeEndDate: mode === 'created' ? data.range : createdRangeOf(displayed) }`.
- `cohortQueryKey` = `${mode}::${startQuarter}::${endQuarter}::${teamsAndComponentsSignature}::${adHocSignature}`, where for `last_n` the two quarter segments are empty; N is not part of the key. Both the explicit read and the #251 automatic read call `buildCohortRequest` with the same arguments; `last_n` needs no quarters, so the "Start and end quarter are required" guard applies to `created` and `closed` only.

- [ ] **Step 1: Write failing tests:**
  - `tests/test_stats_group_state.js`: update the frozen field list (add the four, drop the assignee), `buildDefaultStatsGroupState` defaults and saved-prefs resolution (`cohortMode: 'bogus'` → `'created'`, `cohortLastN: 45` → 30, stale `cohortAssigneeFilter` ignored), snapshot/apply round trip with all four fields (Review Focus 4).
  - `tests/test_use_stats_state.js`: initial values from saved prefs and defaults.
  - `tests/test_use_stats_data.js`: per mode, the request body passed to `requestEpicCohortStats` (explicit read and automatic read produce deep-equal bodies); `last_n` fetches once and changing `cohortLastN` or a filter does not refetch; changing `cohortMode` back to a seen mode is a cache hit; `cohortLastNShortfall` appears only under the stated condition; `cohortDisplayedIssues` equals the first N after filters.
  - `tests/test_stats_controls_source_guards.js`: no remaining `cohortAssigneeFilter` / `deriveAssigneeOptions` in `frontend/src`.
  Run `node --test tests/test_stats_group_state.js tests/test_use_stats_state.js tests/test_use_stats_data.js tests/test_stats_controls_source_guards.js`: expected FAIL.
- [ ] **Step 2: Implement** in the files above. In `dashboard.jsx` update: the hook destructuring (~850), `snapshotStatsGroupState` and `applyStatsGroupState` argument lists (~2715, ~2774), both saved-prefs write sites and dependency lists (~2836 and ~3214/3270), the `useStatsDerived*` argument lists (~4190-4223), `shareViewOptions` setters (~5588: add `setCohortMode`, `setCohortClosedStartQuarter`, `setCohortClosedEndQuarter`, `setCohortLastN`), `statsQueryScope` (~5993: add `cohortMode` and the active range pair), and the `StatsPanel` props (~6872). Run the same command: PASS.
- [ ] **Step 3: Checkpoint:** `feat: add Lead Times mode state and request wiring`.

### Task 7: Panel UI

**Files:** Modify `frontend/src/stats/StatsPanel.jsx` (Lead Times block ~764), `frontend/src/cohort/LeadTimesEpicCharts.jsx`, `tests/test_stats_panel.js`, `tests/ui/codebase_structure_smoke.spec.js`.

Layout contract (all with existing classes): in `.cohort-controls`, first a `.stats-control-group` with `.controls-label` "Mode" and `SegmentedControl` (`className="eng-mode-control"`, `ariaLabel="Lead Times mode"`, options `Created` / `Closed` / `Last N`); then exactly one selection control:
- `created`: `StatsRangeControl` with `idPrefix="lead-times-quarter"`, `kindLabel="Created quarter"` (props otherwise as today);
- `closed`: `StatsRangeControl` with `idPrefix="lead-times-closed-quarter"`, `kindLabel="Closed quarter"`, wired to the closed pair with the same last-control-wins reconciliation as Created;
- `last_n`: `.stats-control-group` with `.controls-label` "Number of epics" and a `select.scenario-input` (`aria-label="Number of epics"`, options 30/50/60).
Then Group By, Project, Exclude as today. The Assignee group is deleted. Every mode-changing or selection-changing handler calls `setCohortSelectedRow(null)`.

- [ ] **Step 1: Write failing tests.** `tests/test_stats_panel.js` (source/render level, following its existing style): the mode control exists with the three labels; the Assignee control is gone; the Number-of-epics select only in `last_n`; the Workflow Status card and Open chart render only when `cohortMode === 'created'`; `CohortGrid` receives `showOpen={cohortMode === 'created'}`. Playwright in `tests/ui/codebase_structure_smoke.spec.js` (extend the `/api/stats/epic-cohort` mock at ~1040 to echo the request `mode` into `meta.mode` and to serve `options.cohortClosedIssues` for the closed modes), new cases after `Lead Times caps long epic lists...`:
  - `Lead Times mode switch swaps exactly one selection control without shifting the others`: for each mode assert the one visible selection control, the shared classes (`eng-mode-control` on the mode and Group By controls) and element-level geometry on the text-bearing elements (label `getBoundingClientRect().right` inside its group and clear of the next control, `scrollWidth <= clientWidth`), and that Group By / Project / Exclude keep the same `left` across modes.
  - `Lead Times closed modes hide open-work parts`: absent `In Progress` and `Postponed` chips, the `Open` column header, Workflow Status heading and `Open Epics` section; present in Created.
  - `Lead Times Last N slices after filters without refetching`: with 12 closed Epics, N=30, a chip toggle and an N change produce no further `/api/stats/epic-cohort` call; the "Showing X of N" note appears only when `meta.windowFull` is true and fewer than N remain.
  - `Lead Times closed modes show the scope note and empty state`: `meta.scope === 'components'` shows `Scope: Components`; `'teams'` shows `Scope: Teams (no Components configured)`; an empty set shows `No closed epics in this scope.` (`cohort-empty`).
  Run `node --test tests/test_stats_panel.js` and `npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Lead Times" --browser=chromium`: expected FAIL.
- [ ] **Step 2: Implement.** Scope and shortfall notes use `.stats-note` only. Completed Epics chart description by mode: `created` keeps today's exact text (existing smoke assertions pin it); `closed`: `Closed within the selected Lead Times quarter range (Done, Killed or Incomplete), with lead time shown.`; `last_n`: `The most recently closed epics that pass the current filters, with lead time shown.` The Open Epics section is not rendered outside `created`. `LeadTimesEpicCharts` loses its assignee prop and gains `cohortMode`. Run Step 1's commands: PASS; also re-run the existing Lead Times smoke cases: PASS.
- [ ] **Step 3: Visual check (repo rule).** Start a worktree-safe server on a port other than 5050, open Statistics > Lead Times in each mode with synthetic data, take screenshots and look at them: mode control, the one swapped control, header rows, no clipped label. Delete the screenshots afterwards unless they are synthetic PR assets. Wait for CSS transitions to settle before capturing.
- [ ] **Step 4: Checkpoint:** `feat: add the Lead Times mode control and per-mode selections`.

### Task 8: Jira links

**Files:** Modify `frontend/src/jiraExportUtils.mjs`, `frontend/src/cohort/LeadTimesEpicCharts.jsx`, `tests/test_jira_export_utils.js`, `tests/test_jira_export_source_guards.js`.

**Interfaces:**
- `buildJiraCohortIssueSearchUrl` loses `assigneeKey` (everything else unchanged).
- Produces `buildJiraClosedEpicsSearchUrl(jiraUrl: string, keys: string[], maxKeys?: number = DEFAULT_MAX_JQL_KEYS): string` → `buildJiraIssueSearchUrl(jiraUrl, keys)` when `1 <= normalized key count <= maxKeys`, otherwise `''`.

- [ ] **Step 1: Write failing tests:** the Created builders still produce their existing URLs minus assignee; `buildJiraClosedEpicsSearchUrl` returns a `key in (...)` URL for 3 keys, `''` for 0 keys and for 251 keys; a source guard that `LeadTimesEpicCharts.jsx` uses `buildJiraClosedEpicsSearchUrl` for non-`created` modes with `cohortCompletedBars` keys and keeps `buildJiraCohortIssueSearchUrl` for `created`. Run `node --test tests/test_jira_export_utils.js tests/test_jira_export_source_guards.js`: expected FAIL.
- [ ] **Step 2: Implement.** In closed modes the "Open all completed epics in Jira" button is hidden when the helper returns `''`. Run: PASS. Then `npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Lead Times" --browser=chromium`: PASS (add one assertion that the closed-mode link's JQL contains exactly the keys listed in the chart).
- [ ] **Step 3: Checkpoint:** `feat: link closed-mode Lead Times charts to their listed Epics`.

### Task 9: Share links

**Files:** Modify `frontend/src/shareView/{viewDefaults,codec,captureState,resolver,applyController}.js`, `tests/test_share_view_{codec,capture_state,resolver,apply_controller,apply_hook}.js`, `tests/ui/shareable_view_links.spec.js`, `docs/features/shareable-view-links.md`.

**Interfaces:**
- `ShareViewState` gains optional `lead` (`'closed' | 'last_n'`) and `n` (`30 | 50 | 60`). `SHARE_VIEW_QUERY_KEYS` gains `'lead'`, `'n'` (after `to`); `SHARE_VIEW_KEYS_BY_MODE.statistics` and `SHARE_VIEW_STATS_KEYS_BY_VIEW.cohort` gain both; `SHARE_VIEW_DEFAULTS.lead = 'created'`. Version stays `1`.
- Encoding: `created` → no `lead`, `from`/`to` as today; `closed` → `lead=closed` plus `from`/`to` (the closed range); `last_n` → `lead=last_n&n=<N>` and `encodeRange` returns `undefined` so `from`/`to` are omitted; `n` is never written without `lead=last_n`.
- Decoding: `lead` accepts only `closed` and `last_n` (other tokens invalid, reported under the existing `mode` notice category); `n` accepts only `30`, `50`, `60`.
- Resolving/applying: `closed` validates `from`/`to` with the existing 16-quarter window rule; `last_n` skips range validation; `lead=last_n` without a valid `n` resolves to `n=30` and reports; an invalid `lead` resolves to Created with its default quarter range and reports. `writeRange` for `cohort` calls `setCohortMode`, then the setters of the active mode only (`setCohortStartQuarter`/`setCohortEndQuarter` for created, the closed pair for closed, `setCohortLastN` for last_n).
- Capture: `buildShareViewState` reads `snapshot.cohortMode`, the active range pair and `snapshot.cohortLastN` from the group snapshot.

- [ ] **Step 1: Write failing tests:** codec round trips for all three modes and a legacy link without `lead` (decodes as Created, no report); `last_n` writes no `from`/`to`; invalid `lead`/`n` values (`lead=foo`, `n=7`, `lead=last_n` without `n`) fall back and report (Review Focus 4); `n` ignored without `lead=last_n`; encoder output stays within `SHARE_VIEW_MAX_QUERY`; capture state per mode; resolver per mode; apply controller sets exactly the active mode's setters; `tests/ui/shareable_view_links.spec.js`: copy a link in each mode and open it in a fresh page, asserting the recipient lands in that mode with the same selection. Run `node --test tests/test_share_view_*.js`: expected FAIL.
- [ ] **Step 2: Implement.** Run `node --test tests/test_share_view_*.js` and `npx playwright test tests/ui/shareable_view_links.spec.js --browser=chromium`: PASS.
- [ ] **Step 3: Document** in `docs/features/shareable-view-links.md`: the two keys, the per-mode carrying rule, and the accepted cost that a tab on an older build opens a closed-mode link as Created until it reloads.
- [ ] **Step 4: Checkpoint:** `feat: carry the Lead Times mode in shared links`.

### Task 10: Browser coverage for the dangerous claims

**Files:** Modify `tests/ui/codebase_structure_smoke.spec.js`, `tests/ui/dashboard_data_freshness.spec.js`.

- [ ] **Step 1: Write the tests** (they should pass against Tasks 4-9; any failure is a defect to fix in the owning task, not a test to weaken):
  - `Lead Times closed modes keep long-lived Epics and long lists inside the panel` (MRT018, Review Focus 1): 40 closed Epics with creation dates five years back, month Group By; the overflow column `M+24+` carries them, the heatmap row count exceeds 30, `.stats-view.open` keeps `overflow: visible`, the Completed Epics list shows load more, and the panel's bottom edge is below its last row.
  - `Lead Times Postponed epics never appear in closed modes` (Review Focus 3): the mock returns a `Postponed` Epic mixed in; it is absent from the heatmap counts and the Completed list.
  - `Lead Times request shape per mode`: the POST bodies contain `mode` and, for `last_n`, no quarters; the Created body still matches the existing `toMatchObject` assertions.
  - In `tests/ui/dashboard_data_freshness.spec.js`: the automatic return refresh in `closed` and `last_n` sends the same body as the explicit read and reuses one request per mode (extend the existing `/api/stats/epic-cohort` case at ~770).
- [ ] **Step 2: Run** `npx playwright test tests/ui/codebase_structure_smoke.spec.js tests/ui/dashboard_data_freshness.spec.js tests/ui/shareable_view_links.spec.js --browser=chromium`: PASS. Run the Lead Times cases headed in Firefox and WebKit (`--headed --browser=firefox`, then `webkit`) because the control bar geometry changed; record results.
- [ ] **Step 3: Checkpoint:** `test: cover Lead Times closed modes end to end`.

### Task 11: Registry, documentation and the final gate

**Files:** Modify `scripts/extraction_lint/owner_budgets.json`, `docs/features/statistics.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, this plan; regenerate `frontend/dist/*`.

- [ ] **Step 1: Docs.**
  - `docs/features/statistics.md`: rewrite the Lead Times section (modes, per-mode controls, closed definition and the Postponed exclusion, Last N after filters with the ceiling, the closed-mode scope and fallback, hidden parts, overflow column, Assignee removed) and the "Scope and Filtering" and "Lead Time Definition" lines that name the created range; keep the `Created mode unchanged` statement.
  - `docs/ontology.md`: update the **Lead Times** entry (aliases, new symbols: `buildCohortRequest`, `selectLastClosedEpics`, `createdRangeOf`, `fetch_closed_epic_cohort_data`, `backend/services/epic_cohort_closed.py`, tests) with today's verification date; confirm every named path and symbol resolves with `rg`.
  - `docs/README_ANALYTICS.md`: add an allowlist row for the Lead Times mode and per-mode selection controls (no event: trigger none, `event_type=none`, `event_name=none`, `feature_name=statistics`, typed params none; the closed-mode Jira links reuse `external_link_opened` with `link_type=jira_issue_list`, `issue_kind=epic`, `source_surface=lead_times`; the GA4 runbook is unchanged). If the operator prefers an event, that is a separate decision (design A9).
  - `docs/plans/README.md`: update the design entry and add this plan under Current Stats Work.
- [ ] **Step 2: Extraction lint and structure budgets.** Run `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` and the extraction lint (`JEP_TEST_PYTHON=<path to a venv python> fnm exec --using 20 bash scripts/extraction_lint/run.sh`; expected exit 0, 0 enforced problems). Re-sync `owner_budgets.json` deliberately for the registered modules this plan changed (`StatsPanel.jsx`, `useStatsData.js`, `useStatsState.js`, `statsGroupState.js`, plus `lineCount`/ceilings if the structure test names them): bump `sourceDigest` only after confirming from the diff that no bag member, forwarded input, prop or count changed beyond the intended ones; touch `memberNames`, `rationale` and counts only where members truly changed. Never re-sort the manifest, never golf unrelated lines to hold a ceiling.
- [ ] **Step 3: Build.** `npm run build`; commit the regenerated `frontend/dist` only if the post-build diff is non-empty and the workflow requires it; confirm two builds are byte-identical.
- [ ] **Step 4: Full verification (repository gate).** `.venv/bin/python -m unittest discover -s tests` (include `test_initiative_extraction` and `test_codebase_structure_budgets`), `node --test tests/test_*.js`, then the full `npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes; rerun load-sensitive specs alone before calling a failure real), the headed Firefox and WebKit Lead Times runs from Task 10, and a startup check: `.venv/bin/python jira_server.py` on a non-5050 port when run from a worktree, `curl http://localhost:<port>/api/test`, no Python warning before the banner. Record every command and its summary line in Execution status.
- [ ] **Step 5: Operator acceptance (live, read-only).** Ask the operator to open each mode against the real app themself and confirm the numbers look right; take and save no screenshots of live data. If the operator reports a mismatch, treat it as the Task 1 assumptions failing and re-open that gate.
- [ ] **Step 6: Close out.** Update this plan's Execution status with commits, divergences and results; keep `EXEC-` until accepted or merged, then rename to `DONE-` with the top status note per `docs/plans/AGENTS.md`. Run the repository's publication transaction (`AGENTS.md` section 10) only when the operator asks for a push or PR.
