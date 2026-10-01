# Per-Epic Refresh With Glare Implementation Plan (Issue #213)

> **Status:** Executed on branch `feature/213-per-epic-refresh` on 2026-09-30 and 2026-10-01 (plan commits `688ce0bc`..`4e558e46`, baseline `8ca112e4`, task commits listed in the Execution Status table, `origin/main` merged in `b34bc893`, bundle rebuilt in `ab836b1a`); awaiting review and merge, kept as `EXEC-*` until accepted or merged. Planned from baseline `main` at `3622ba22`; reviewed on 2026-09-30 by five subagents (two of them executed the plan's code) and revised; Task 13b amended after its own plan review on 2026-10-01. Approved design: `docs/agents/features/2026-09-29-executed-per-epic-refresh-with-glare.md` (read it first; this plan implements it and does not restate its rationale).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hover-revealed button on each ENG epic header (Catch Up, then Planning) refreshes that one epic's stories and epic info from Jira under the user's own token, patches the view in place, re-checks that epic's alerts only, and plays a subtle amber glare on the cards that changed.

**Architecture:** One new backend purpose (`purpose=epic-refresh` on `GET /api/tasks-with-team-name`) returns the epic's stories and details without the empty-epic scan. A pure merge/diff module decides what changed. A testable controller owns guards, races, per-lane semantics and feedback; a thin hook and an `EpicRefreshButton` mount it in `renderEpicBlock`. Alerts are refreshed per epic in three slices (A client-derived, B epic-scoped alert object and Ready to Close, C missing-info, backlog and Stories Required) through `epicKeys` variants of existing routes.

**Tech Stack:** Python 3.10+ / Flask / unittest; React 19 ES modules; Node 20 `node --test`; Playwright; esbuild; CSS.

## Global Constraints

Every task's requirements include this section. Values are copied from the approved design; review round 1 (2026-09-30, five reviewers, two of which executed the plan's code) corrected the items marked (R1).

- Manual only: no polling, no background requests, nothing persisted (no `localStorage`, private view or shared config).
- Scope: Catch Up and Planning; Planning is enabled last (Task 13). The alerts panel exists only in Catch Up; a Planning refresh issues zero alert requests.
- Button placement (user-approved, 2026-09-30): absolutely positioned over the epic header's upper-right corner, `position:absolute; top:4px; right:6px`, inside the sticky `.epic-header`. It may cover the end of the right-most item while shown. It causes no layout change. At 760 px and below, `.epic-header:has(> .epic-refresh-button) .epic-title-row` gets `padding-right:32px` so the Planning stat toggle is never covered; the selector is scoped so the EPM and settings-preview headers are untouched (R1).
- Reveal: opacity-hidden and `pointer-events:none` until hover or focus within the header; always visible under `@media (hover:none)`; forced visible while busy or in error. Busy uses `aria-disabled="true"` and `aria-busy="true"`, never `disabled`. In tests the header must be hovered before the button is clicked (R1).
- Progress mark: the EPM burst (`epm-burst.svg`, classes `.loading-mark-spinner` and `.loading-mark-signature`) in a new `LoadingMark` at 16 px; shown at least 400 ms; rotation stops under `prefers-reduced-motion`. `LoadingState` and `tests/test_epm_view_source_guards.js` stay untouched.
- No whole-screen loading state; no flip of `loading`, `productTasksLoading` or `techTasksLoading`. A refresh that fails with an HTTP response (any `err.status`) never calls the global connection-failure handler; only a real network outage does (R1).
- No wipes: values are replaced in place. A card that enters uses `task-appear` then glints; a card that leaves stays rendered until the dissolve finishes (exactly `is-removing`, `task-remove-dissolve`, 0.24 s) and is then dropped (R1).
- Glare (specimen variant A): amber edge, 1800 ms, peak opacity 0.5 (`--glare-peak`, 0.8 on killed and incomplete cards), ring 1.5 px, beam width 22, sweep down the page (`delay = 0.4 ms per px below the sticky stack`); under reduced motion a static border tint for at least 900 ms, for the card ring **and** the header sweep (R1). Skipped on `is-dimmed` cards. Cap 8 cards, mounted and in viewport only, never for the user's own edits (last 10 s), the global Refresh or the initial load. Mechanism: the `data-glare` attribute (React owns `className`), a `::before` ring on `.task-item` (`::after` is taken), no `overflow:hidden`.
- No `rearmCatchUpAlerts`, `loadGroupTasks` or `applyLocalEngIssueField` in any refresh code path. `tests/test_dashboard_alert_source_guards.js` pins the exact count of `rearmCatchUpAlerts` call sites and regexes that slice the dependencies effect and the alert cohort statements; it must stay green without edits to the guard, with one exception: Task 13b deliberately lowers the `onAlertDataInvalidated: rearmCatchUpAlerts` count from 2 to 0 in the same commit as the code change (the `rearmCatchUpAlerts();` count stays 3).
- Failure copy is fixed text; never show `details`, `jql_used` or `err.message`.
- Every request after a click carries `epicKeys=<that key>` (or is on the explicit allowlist: `POST /api/dependencies` with that epic's story keys, and subtask reloads for that epic's open panels).
- Credential policy: Jira reads use only the signed-in user's OAuth context (local Basic identity only in local mode); no Jira writes, no service-account or API-token credentials, no Home/Townsquare calls in any refresh path; negative tests patch the named write and credential symbols to raise (R1).
- Jira pagination: enhanced search uses `nextPageToken`/`isLast`; new queries reuse the existing loops and stay short (one epic key per call).
- Analytics: the new action follows the two-trigger GTM contract (`trigger=userevent`, `event_type=event`), no `has_*` params, no bulk custom-dimension registration, `GA4_ENABLED` gating unchanged.
- Budgets (`tests/test_codebase_structure_budgets.py`): `jira_server.py` 6463, `frontend/src/dashboard.jsx` 18213 (actual 18198). The orchestrator owns every edit to that file: tasks report their new line counts, the orchestrator ratchets at the end of the wave with an itemized comment in the existing style (R1).
- Accepted limitation: a story moved out of the epic appears in its new epic only after that epic, or a department-wide Refresh, is refreshed. Merging is by story key so a moved story is never duplicated.
- Environment: Python via `.venv/bin/python` with the CI env `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile` (Makefile `PYTHON_TEST_ENV`); Node 20 via `fnm exec --using 20`; run `npm ci` before `npm run build`; Playwright per spec with `--workers=1 --reporter=line`. `frontend/dist` is committed once, in Task 14. A task that runs a Playwright spec builds, runs, then restores with `git checkout -- frontend/dist`; only one task builds at a time; `git status --short frontend/dist` must be empty before every commit and every unit run (`tests/test_scenario_draft_history_source_guards.js` fails on a dirty dist with clean source) (R1).
- Git: branch `feature/213-per-epic-refresh`; commit subjects at most 72 characters; no agent or tool attribution anywhere (no `Co-Authored-By`, no "Generated with" footers, in commits or PR text); subagents never push or open a PR; publication follows the AGENTS.md publication transaction and needs explicit user confirmation.

## Execution Protocol (subagent-driven)

- The session already runs in a worktree; do not create another (repo rule). Parallel tasks in the same wave run in this one tree on **disjoint files** (see the Touch Matrix) and only one task builds `frontend/dist` at a time.
- Subagents do **not** commit. After a task's spec-compliance review and code-quality review both pass and the orchestrator has re-run the task's verification itself, the orchestrator stages only that task's files and commits, then reads `git show --stat HEAD` and `git status` (Gate A) before the next commit.
- Every subagent prompt includes: the task text; the Global Constraints; the named "Read first" ranges; the exact files it may touch; the verification commands; the instruction to read the AGENTS.md chain (root `AGENTS.md`, `docs/AGENTS.md`, `docs/plans/AGENTS.md`) and the relevant `docs/ontology.md` entries before editing; the postmortems to honor (MRT009 sticky layering, MRT016 causal order and named files, MRT019 no removals from partial fetches, MRT020 and MRT021 control reuse and explicit constraints, MRT023 alert gating, MRT025 publication, MRT028 header constraints, MRT029 alert reuse, MRT031 GET size); and "no attribution trailers, no push".
- Waves: T0 inline; Wave 1 = T1, T2, T3, T4 in parallel; Wave 2 = T5, T6a, T6b, T7 sequentially; Wave 3 = T8 in parallel with T9, then T10 after T9; Wave 4 = T11 then T12; Wave 5 = T13 then T13b; Final = T14. A failing review sends the task back to a fresh subagent with the reviewer's findings.
- After two failed attempts on the same task, stop and ask the user (AGENTS.md).
- Line numbers in "Read first" are approximate (tree at `3622ba22`); locate by symbol. Prefer the symbol.

## Baseline (filled by Task 0, step 5)

| Suite | Command | Recorded result |
|---|---|---|
| Python | `make test` | 2006 tests, OK (skipped=25), 122 s (Python 3.14, recorded 2026-09-30) |
| Security | `make test-security` | 81 tests, OK, 1.3 s |
| Node unit | `fnm exec --using 20 npm run test:frontend:unit` | 1524 pass, 0 fail, 0 skipped |
| Playwright, every spec, one at a time | Task 0 step 5 loop, output kept in `tmp/baseline-ui.txt` | all 52 specs ran; the failures match issue #210 exactly (`eng_priority_transitions` 1 failed, 8 passed; `planning_selection_defaults` 1 failed, 22 passed; `load_performance` 2 failed, 7 passed); every other spec passed (skips: `eng_group_board_card` 1, `epm_settings_visual_states` 2); `frontend/dist` clean before and after. Base is `3622ba22` plus the four plan commits; `main` has since gained #212 (repairs these UI specs) and #215 |

## Execution Status (updated by the orchestrator after each wave)

| Task | Status | Commit | Notes |
|---|---|---|---|
| T0 | done | `8ca112e4` | baseline recorded above |
| T1 | done | `d0678a26`, `bb18e35d` | `jira_server.py` 6463 to 6474, budget ratcheted. Step 11 resolved by the user as "implement now": epic-refresh searches use their own circuit breaker and 2 attempts (`bb18e35d`, net +0 lines in `jira_server.py`). Finding: `resilient_jira_get` does not honor `Retry-After` on the non-diagnostic path (the design assumed it did); epic-refresh backs off 0.5 s to 3 s exponentially and the server minimum interval still applies |
| T2 | done | `4aff8c42` | divergence: `patchEpicScopeEntries` takes `assignee` whenever the fetched epic carries the key (`'assignee' in fetchedEpic`), not `?? entry.assignee`; an unassigned epic (`assignee: null`) would otherwise keep a stale assignee in `*EpicsInScope` |
| T3 | done | `b8c3c7af` | divergences: button selectors are `.epic-header button.epic-refresh-button` (beats the global `button:hover`); reduced-motion tint is a held tint (`epic-refresh-tint` 1200 ms, peak held about 960 ms), not a fade pulse; `.task-item.is-dimmed[data-glare]::before` is hidden in CSS |
| T4 | done | `b60a5b28` | |
| T5 | done | `cd5b99b8` | review fix: focus rescue also runs after the dissolve drop; drop timers come from the updater's own merge result |
| T6a | done | `676b8b9f` | `dashboard.jsx` 18213 to 18232 (itemized in the budgets file); status region is a sibling before `<EngView>` (the alerts panel is a Catch-Up-only EngView prop) |
| T6b | done | `da156974` | split in two parts after two stalled attempts (subtask hook; dashboard wiring); `dashboard.jsx` to 18287. Divergence: the one-shot dependency skip is armed in a `loadEpicRefresh` wrapper, not in `afterApply`, because the merge's `flushSync` flushes the dependencies effect first; the skip is tagged with the load epoch (`epicRefreshDependencySkip.js`) so a discarded refresh cannot swallow a later department fetch |
| hook fix | done | `3d3199e5` | found by the Playwright spec: focus on a leaving card's x button, and the scroll anchor now uses the non-sticky epic block top |
| T7 | done | `866f7e55` | `tests/ui/eng_epic_refresh.spec.js`, 51 cases pass (also `--repeat-each=2`); neighbour specs match the Task 0 baseline (only the known #210 failures) |
| T8 | done | `e7b88b6a` | alert update runs inside the hook's `apply` (before `afterApply`), so `dashboard.jsx` stays at 18287; ghost filter acts at requirement creation in `engWorkHierarchy.js` (Catch Up and Planning) |
| T9 | done | `3faf5212` | `jira_server.py` 6474 to 6479; one `epic-alerts` call costs 5 searches (1 scope, 1 counts, 3 distribution) on the epic-refresh breaker; real `failures.append` sites are mutation-tested |
| T10 | done | `b454c3c5` | `epicKeys` on missing-info (cache key extended only when present, new `refresh`), backlog-epics and story-readiness (own in-flight key, never the department snapshot); `/api/dependencies` accepts body `refresh` and rejects malformed keys with 400 |
| T11 | done | `559f6cb5` | `recheckEpicAlerts(epicKey, calls, { alertVersion })` runs both lanes through capturing setters; Ready to Close entries and story copies are deleted only when the same lane's `epic-alerts` call succeeded with an empty list (MRT019; the server answers 200 with empty data when its epic search fails) |
| T12 | done | `afd893eb` | `fetchEpicReadiness`/`fetchEpicMissingInfo`/`fetchEpicBacklog`; `useStoryReadiness.mergeEpic` never blanks the snapshot; an absent `initiative` key in refreshed epic details counts as cleared. Known limitation: a Backlog entry is deleted only on an ok-empty `epic-alerts` answer, so an epic that stays in scope but stops being a backlog epic keeps its Backlog alert until the next full load (the server cannot signal a failed search). Planning Stories Required ghosts are corrected only by the client rule and the cleared-field patch; Task 13 decides whether Planning needs the per-epic readiness call |
| T13 | done | `4f14924f` | Planning enabled. The 2-frame capacity hold became a pin that lasts until the capacity scope changes or a department load bumps the load epoch; a team crossing zero Story Points shows no capacity value (rise) or loses its card (drop) until then. Flagged for the requester's decision, see the Task 13 Outcome |
| T13b | done | `86b284d6` | amended first (`b79ad303`) after its plan review: the requester kept "invalidate in every ENG mode" (Catch Up: scoped per-epic re-check for status edits, none for priority; Planning and Board: the request-free cohort invalidation as before), per-epic coalescing with one 429 retry, a cohort-settle notification, a specified key-to-epic resolver, guard updates; requester decisions after review: a local readiness-snapshot patch for a readiness-only epic's priority edit, and no invalidation for an edit whose results were all already in that state |
| merge | done | `b34bc893` | `origin/main` (#212, #215, #216, #218) merged into the branch; one `docs/ontology.md` conflict resolved; `dashboard.jsx` budget re-ratcheted to 18307 |
| docs | done | `deff2433` | ontology entry, `eng-workflows.md`, README, design artifact renamed to `executed` with Outcome and Current Accuracy |
| dist | done | `ab836b1a` | `npm ci` then `npm run build`; a second build leaves no diff and the source map holds no ancestor-checkout paths |

## Endpoint Contract Matrix

All routes are per-user `authenticated_read` (or the existing POST) with the signed-in user's OAuth context; Basic mode is local-only. Workspace boundary: the limiter scope is `workspace_id:user_id`; caches stay partitioned through `build_jira_home_process_cache_key` (workspace, connection, `token_version`, project access); no cross-user entry is ever read.

| Route | Method, CSRF | Request | Success body | Error bodies | Required tests |
|---|---|---|---|---|---|
| `/api/tasks-with-team-name` `purpose=epic-refresh` | GET; no CSRF, no `X-Requested-With` | `sprint` digits, `project` `product` or `tech`, `epicKeys` exactly one matching `^[A-Z][A-Z0-9_]+-[0-9]+\Z`, group team scope, optional `refresh` | issues (slim shape), `epics` (details for the key), `epicsInScope: []`, `capped`, `epicKeysMissing` | 400 `invalid_epic_refresh`; 400 `invalid_epic_keys`; 401 existing lock payload; 403 `missing_project_access` per lane; 429 `epic_refresh_rate_limited` `{retryAfterSeconds}` plus `Retry-After`; 500/502/503 existing | Task 1 (validation, scan skipped, details by key, capped, missing details, cache skip and eviction, limiter per lane, OAuth, unauthenticated 401, read-only symbols) |
| same, `purpose=epic-alerts` (Task 9) | GET; none | same as above | `{epicsInScope: [<enriched epic>] or []}`, no `issues` | same; 500 on any Jira failure (never "epic out of scope") | Task 9 |
| same, `purpose=ready-to-close` (existing) | GET; none | existing; `epicKeys` gets the format check | existing | existing; 400 `invalid_epic_keys` | Task 1 (format check), existing suites |
| `/api/missing-info` (Task 10) | GET; none | `sprint`, existing params, `epicKeys` (one), `refresh` | existing shape scoped to the epic | 400 `invalid_epic_keys` | Task 10 |
| `/api/backlog-epics` (Task 10) | GET; none | existing params, `epicKeys` (one) | existing shape scoped to the epic | 400 | Task 10 |
| `/api/eng/story-readiness` (Task 10) | GET; none | existing params, `epicKeys` (one) | existing shape scoped to the epic; never cached as the department snapshot | 400 | Task 10 |
| `/api/dependencies` | POST; `X-Requested-With` in OAuth mode (existing) | JSON body `{keys, refresh}` (story keys; `refresh` is a body field) | existing | 400 on a bad key | Task 10 |

No new route: no `ENDPOINT_POLICIES` entry is added; `make test-security` still runs.

## State-Machine Checklist (per epic)

States: `idle` → `busy` → `idle` (applied or unchanged) | `idle` (discarded) | `error` (shown until the next interaction).
- Click ignored, with no UI change, while busy, in cooldown (10 s per scope and epic), at 2 in flight, or blocked by a guard: `loading`, `productTasksLoading`, `techTasksLoading`, `manualRefreshDisabled`, `!tasksFetched`, stale sprint, alert cohort in flight, `boardScopeRequested`, wrong mode, or an interaction on that epic (status, priority or Project Track menu open, or an active inline editor).
- Global Refresh, scope change or sprint change during `busy`: result discarded, no state change, no announcement, no analytics.
- Lane `ok`: applied. Lane `denied` (403): untouched, silent. Lane `failed` or `rate_limited`: untouched, `error`. Lane `auth_required` (401): result discarded, the existing sign-in lock owns the UI. All lanes `ignored`: discarded. Lane `capped` or details missing: no removals inferred.
- Pending, leaving, editor-active or changed-since-click keys (stories and the epic's own header entry): kept as held.
- User-removed cards: never re-added.
- Apply is atomic per epic and uses functional updaters, so two epics finishing in the same tick do not overwrite each other.

## Shared Interfaces (exact names used across tasks)

Backend (`backend/services/epic_refresh.py`, Task 1; Task 9 adds two functions): `EPIC_REFRESH_PURPOSE = 'epic-refresh'`, `EPIC_ALERTS_PURPOSE = 'epic-alerts'`, `EPIC_SCOPED_PURPOSES = (EPIC_REFRESH_PURPOSE, EPIC_ALERTS_PURPOSE)`, `ISSUE_KEY_RE`, `parse_epic_keys(raw) -> list[str]`, `single_epic_key(args) -> str | None`, `epic_keys_error(args, single=False) -> dict | None`, `limiter_bucket(purpose, lane, epic_key) -> str`, `class EpicRefreshLimiter(min_interval_seconds=8.0, clock=time.monotonic, max_entries=2048)` (thread-safe) with `retry_after(scope_key, bucket) -> int`, `response_meta(issue_count, max_results, requested_keys, epic_details) -> dict`, `evict_scope_entries(cache, lock, key_for_purpose, purposes=('dashboard','alerts'))`. Task 9 adds `apply_epic_enrichment(epics, counts, distribution)` and `fetch_epic_alert_bundle(...)`.

Frontend pure modules:
- `frontend/src/eng/epicRefreshPatch.js` (Task 2): `STORY_DISPLAYED_FIELDS`, `EPIC_DISPLAYED_FIELDS`, `normalizeStory`, `diffStory(held, fetched) -> {changedFields, silent, equal}`, `mergeEpicStories({held, fetched, epicKey, laneApplied, capped, detailsMissing, protectedKeys, clickSnapshot, userRemovedKeys}) -> {items, changedKeys, silentKeys, addedKeys, removedKeys, keptKeys, changedFieldsByKey, changed}`, `normalizeEpic`, `diffEpic(held, fetched) -> {changedFields, silent, equal}`, `patchEpicScopeEntries(list, epicKey, fetchedEpic) -> list`, `patchStoryCopies(list, fetchedByKey) -> list`.
- `frontend/src/eng/epicRefreshGlare.js` (Task 3): `GLARE_CAP`, `selectGlareKeys({changedKeys, rects, viewport, suppressed, cap})`, `glareDelayMs(rectTop, viewportTop)`, `playGlare(element, delayMs)`.
- `frontend/src/eng/epicRefreshController.js` (Task 5): `EPIC_REFRESH`, `EPIC_REFRESH_RESULT`, `createEpicRefreshController(deps) -> { refresh(epicKey) }` where `deps.apply(update)` returns a promise of `{ hiddenCount }` and `update = { epicKey, changedKeys, silentKeys, addedKeys, removedKeys, changedFieldsByKey, fetchedStories, mergeInputs, epicDetailsPatch, epicChanged, epicSilent }`.
- `frontend/src/eng/epicRefreshAlerts.js` (Tasks 8, 11, 12): `recomputeMissingPlanningInfo`, `shouldHideReadinessGhost`, `mergeEpicScopeEntries`, `mergeReadinessEpic`, `alertCallsFor`.

Frontend components and hooks: `frontend/src/ui/LoadingMark.jsx` (default export `LoadingMark({ size='xs', className='' })`), `frontend/src/ui/EpicRefreshButton.jsx` (default export `EpicRefreshButton({ epicKey, epicName, state, onRefresh, errorLabel })`), `frontend/src/issues/IssueCard.jsx` (exports `REMOVE_FADE_MS`; new prop `isLeaving`), `frontend/src/eng/useEpicRefresh.js` (returns `{ epicStates, leavingKeys, announcement, announcementId, refreshEpic, recheckEpicAlerts, recheckAlertsForEdit }`; Tasks 11 and 12 add `recheckEpicAlerts(epicKey, calls)`, Task 13b adds `recheckAlertsForEdit({ keys, field })`).

Loader (Task 5): `useEngSprintData` returns `loadEpicRefresh({ epicKey, shouldApplyResult, signal }) -> Promise<{ product: Lane, tech: Lane }>` with `Lane = { status: 'ok'|'denied'|'failed'|'rate_limited'|'auth_required'|'ignored', items?: issue[], meta?: { epics, capped, epicKeysMissing } }`. `ENG_TASK_LOAD_OUTCOME` gains `LANE_DENIED: 'lane_denied'` and `RATE_LIMITED: 'rate_limited'`.

Analytics (Task 4): event `epic_refresh_action`; `buildEpicRefreshAnalyticsParams({ result, sourceSurface, changedCount })`; `trackEpicRefreshAction`; API surface `epic_refresh`; `fetchEngTasks` gains optional `apiSurface` and `featureName`; `fetchEpicRefresh(backendUrl, { project, sprint, sprintName, groupId, teamIds, teamLabels, epicKey, signal })` is a thin wrapper over it.

## File Map

Create: `backend/services/epic_refresh.py`, `tests/test_epic_refresh_service.py`, `tests/test_epic_refresh_purpose.py`, `frontend/src/eng/epicRefreshPatch.js`, `frontend/src/eng/epicRefreshGlare.js`, `frontend/src/eng/epicRefreshController.js`, `frontend/src/eng/epicRefreshAlerts.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/ui/LoadingMark.jsx`, `frontend/src/ui/EpicRefreshButton.jsx`, `tests/test_epic_refresh_patch.js`, `tests/test_epic_refresh_glare.js`, `tests/test_epic_refresh_controller.js`, `tests/test_epic_refresh_alerts.js`, `tests/test_epic_refresh_source_guards.js`, `tests/ui/eng_epic_refresh.spec.js`. Added during execution: `frontend/src/eng/epicRefreshEditRecheck.js` (Task 13b scheduler and key resolver), `frontend/src/eng/epicRefreshDependencySkip.js` (Task 6b), `tests/test_epic_refresh_breaker.py` (Task 1 step 11), `tests/test_epic_refresh_edit_recheck.js`, `tests/test_epic_refresh_dependency_skip.js`.
Modify: `jira_server.py`, `backend/routes/eng_routes.py`, `tests/test_codebase_structure_budgets.py` (orchestrator only), `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/useStoryReadiness.js` (Task 12), `frontend/src/eng/engWorkHierarchy.js` (Tasks 8 and 12, ghost rows), `frontend/src/issues/useStorySubtasks.js`, `frontend/src/api/engApi.js`, `frontend/src/issues/IssueCard.jsx`, `frontend/src/dashboard.jsx`, `frontend/src/styles/eng/{epics,issues,loading}.css`, `frontend/src/analytics/{events,analytics,dashboardAnalytics}.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `tests/test_story_subtasks.js`, `tests/test_create_stories_alert.py`, `tests/test_oauth_eng_routes.py`, `tests/test_story_readiness.py`, `tests/test_oauth_cache_isolation.py`, `tests/test_story_readiness_api.js`, `tests/test_dashboard_alert_source_guards.js` (Task 13b, deliberate count change), `frontend/src/eng/useEngStatusTransitions.js` and `frontend/src/eng/useEngPriorityTransitions.js` (Task 13b, pass the affected keys), `docs/README_ANALYTICS.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`, `docs/plans/GATE-05-*.md` (date and result fields only, Task 0), `docs/ontology.md`, `docs/features/eng-workflows.md`, `docs/features/alerts.md`, `README.md`, `docs/plans/README.md`, the design artifact (rename at the end), this plan. Also modified during execution: `tests/test_planning_action_source_guards.js` and `tests/ui/eng_alert_loading_order.spec.js` (Task 13b, deliberate contract change), `tests/test_story_readiness_api.js`, `docs/features/eng-workflows.md`.
Generate only with `npm run build` (Task 14): `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`.

## Touch Matrix (hot files; same-wave overlaps are forbidden)

| File | Tasks, in order |
|---|---|
| `frontend/src/dashboard.jsx` | T6a, T6b, T8, T11, T12, T13, T13b (never two in one wave) |
| `frontend/src/eng/useEpicRefresh.js` | T5, T6b, T8, T11, T12, T13b |
| `frontend/src/api/engApi.js` | T4, T6b, T11, T12 |
| `frontend/src/eng/useEngSprintData.js` | T5, T11, T12 |
| `frontend/src/styles/eng/epics.css` | T3, T6a |
| `jira_server.py` | T1, T9 (T10 does not touch it) |
| `backend/services/epic_refresh.py` | T1, T9 (T10 adds nothing; `single_epic_key` lives in T1) |
| `backend/routes/eng_routes.py` | T1, T10 |
| `tests/test_create_stories_alert.py` | T9 then T10 (sequential) |
| `tests/test_codebase_structure_budgets.py` | orchestrator only, end of each wave |

---

## Task 0: Setup and baseline (inline, no reviewer pair)

**Files:** Modify `docs/plans/README.md` (already indexed), `docs/plans/GATE-05-*.md` (date and result fields only), `docs/ontology.md` (only if Step 4b finds drift), this plan (baseline table). No source changes.

- [x] **Step 1: Issue, branch, design and plan commit (already done)**

Done in commit `688ce0bc` (branch renamed to `feature/213-per-epic-refresh`, design and plan committed, plan indexed in `docs/plans/README.md`). Re-confirm:

```bash
gh issue view 213 --json number,state,title
git branch --show-current
git log --oneline -3
```
Expected: issue 213 `OPEN`; branch `feature/213-per-epic-refresh`; the plan commit below `main`'s head. Do not rename or recommit.

- [x] **Step 2: Gate sweep (AGENTS.md session start for plan execution)**

```bash
rg --files docs/plans | rg '/GATE-'
```
Open each file printed (only `GATE-05-*` exists; it concerns Home/Townsquare writes and is unrelated). Update its `Checked on` date and `Last result` field as its Startup Check requires, keep `Status` as `Blocked` unless its command prints the documented `PASS`, and never paste token material.

- [x] **Step 3: Environment**

```bash
python3 --version
python3 -c 'import ssl; print(ssl.OPENSSL_VERSION)'
ls .venv >/dev/null 2>&1 || python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt && .venv/bin/python -m pip install -e .
fnm exec --using 20 node --version
fnm exec --using 20 npm ci
.venv/bin/python scripts/check_startup_preflight.py
```
Expected: Python 3.10 or newer linked to OpenSSL 1.1.1 or newer (not LibreSSL); Node `v20.x`. Record the preflight result (it can fail in a worktree that has no local `.env`; note the reason, do not fix the environment).

- [x] **Step 4: A clean build leaves dist unchanged**

```bash
fnm exec --using 20 npm run build && git diff --exit-code frontend/dist
```
Expected: exit 0. If it differs, stop and ask the user.

- [x] **Step 4b: Consult the ontology (AGENTS.md section 1)**

Read the `ENG inline issue edits and alert invalidation` and `ENG Story Readiness` sections of `docs/ontology.md` (the first was added on 2026-09-30 and records the current inline-edit to alert-reload connection, which the first draft of this plan missed). Verify every cited path and symbol still resolves:

```bash
for sym in rearmCatchUpAlerts catchUpAlertVersionRef applyLocalEngIssueField invalidateEngIssueFieldSources onAlertDataInvalidated patchEngIssueList clear_jira_issue_status_caches; do printf "%-34s" $sym; rg -l -F "$sym" frontend/src backend | tr '\n' ' '; echo; done
```
Note any drift in this plan's Outcome; correct the ontology entry before any task relies on it. Subagent prompts for Tasks 6a, 6b, 8, 11, 12, 13b quote these entries.

- [x] **Step 5: Record the baseline, every spec**

```bash
mkdir -p tmp
make test 2>&1 | tail -6
make test-security 2>&1 | tail -6
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -14
for f in tests/ui/*.spec.js; do echo "== $f"; fnm exec --using 20 npx playwright test "$f" --workers=1 --reporter=line 2>&1 | tail -4; done | tee tmp/baseline-ui.txt
git status --short frontend/dist
```
Write the Python, security and Node counts and the per-spec pass, fail and skip results into the Baseline table (per-spec rows may be summarized, with the full output kept in `tmp/baseline-ui.txt`, which is gitignored). Known failures from #210 are expected; any other failure is a baseline defect to report to the user before continuing. `frontend/dist` must be clean afterwards (`git checkout -- frontend/dist` if a spec left it changed).

- [ ] **Step 6: Commit the baseline record**

```bash
git add docs/plans/EXEC-per-epic-refresh-213.md docs/plans/GATE-05-*.md
git commit -m "Record baseline for per-epic refresh"
git show --stat HEAD && git status --short
```
Expected: only the plan and the gate file in the commit; no attribution trailer.

---

## Task 1: Backend core — `purpose=epic-refresh`

**Files:**
- Create: `backend/services/epic_refresh.py`, `tests/test_epic_refresh_service.py`, `tests/test_epic_refresh_purpose.py`
- Modify: `backend/routes/eng_routes.py` (guard near `get_tasks` and `get_tasks_with_team_name`; add `epic_refresh` to the existing `from backend.services import ...` line), `jira_server.py` (`fetch_tasks`)

**Interfaces:**
- Produces: the Shared Interfaces backend block; the endpoint contract rows for `epic-refresh`, `epic-alerts` validation and the format check on `ready-to-close`.
- Consumes: `fetch_epic_details_bulk(epic_keys, headers, epic_name_field)`, `build_tasks_cache_key(sprint, group_id, project_filter, team_ids, team_label_values, include_team_name, use_template, purpose='dashboard', epic_keys=None, sprint_name='')`, `build_jira_home_process_cache_key(auth_context, raw_key)`, `TASKS_CACHE`, `_cache_lock`, `jira_home_partitioned_process_cache_enabled`, `_eng_auth_error_response`, `AuthError`.

**Read first:** `jira_server.py` `fetch_tasks` (parameter parsing, the `lightweight_ready_to_close` line, the cache read condition, the enrichment block `if lightweight_ready_to_close:`, `max_results = 250`, `data['epics'] = epic_details`, `publish_result`), `backend/routes/eng_routes.py` (how `request`, `jsonify` and `current_request_auth_context` reach the module: they are bound by `bind_server_globals` in a `before_request`; `_eng_auth_error_response`; `get_tasks`; `get_tasks_with_team_name`), `tests/test_create_stories_alert.py` (scaffolding: `force_basic_auth_mode`, `_mock_response`, the ready-to-close test), `tests/test_oauth_eng_routes.py` (how an OAuth context is built for a route test), `backend/auth/cache_policy.py` (`build_jira_home_process_cache_key` returns the raw key in Basic mode, a tuple in OAuth mode).

- [ ] **Step 1: Write the failing service tests**

Create `tests/test_epic_refresh_service.py`:

```python
import threading
import unittest

from backend.services import epic_refresh


class EpicKeysErrorTests(unittest.TestCase):
    def test_accepts_one_valid_key_for_both_scoped_purposes(self):
        for purpose in ('epic-refresh', 'epic-alerts'):
            args = {'purpose': purpose, 'sprint': '123', 'project': 'product', 'epicKeys': 'EPIC-1'}
            self.assertIsNone(epic_refresh.epic_keys_error(args), purpose)

    def test_scoped_purposes_require_one_key_digit_sprint_and_lane(self):
        base = {'sprint': '123', 'project': 'tech', 'epicKeys': 'EPIC-1'}
        for purpose in ('epic-refresh', 'epic-alerts'):
            for patch in (
                {'epicKeys': ''}, {'epicKeys': 'EPIC-1,EPIC-2'}, {'sprint': ''}, {'sprint': '12a'},
                {'project': 'all'}, {'project': ''},
            ):
                args = {**base, 'purpose': purpose, **patch}
                self.assertEqual(epic_refresh.epic_keys_error(args)['error'], 'invalid_epic_refresh', (purpose, patch))

    def test_rejects_injection_shaped_keys_for_any_purpose(self):
        hostile = [
            'X) OR project is not EMPTY OR issueKey in (Y',
            'EPIC-1"', "EPIC-1'", 'EPIC-1\nORDER BY created', 'epic-1', 'EPIC-', 'EPIC-1 ORDER BY key',
        ]
        for purpose in ('', 'dashboard', 'ready-to-close', 'epic-refresh', 'epic-alerts'):
            for key in hostile:
                args = {'purpose': purpose, 'sprint': '1', 'project': 'product', 'epicKeys': key}
                self.assertEqual(epic_refresh.epic_keys_error(args)['error'], 'invalid_epic_keys', (purpose, key))

    def test_rejects_non_ascii_digits_in_key_and_sprint(self):
        base = {'purpose': 'epic-refresh', 'sprint': '123', 'project': 'product', 'epicKeys': 'EPIC-1'}
        self.assertEqual(epic_refresh.epic_keys_error({**base, 'epicKeys': 'EPIC-١'})['error'], 'invalid_epic_keys')
        for sprint in ('١٢', '²'):
            self.assertEqual(epic_refresh.epic_keys_error({**base, 'sprint': sprint})['error'], 'invalid_epic_refresh', sprint)

    def test_legacy_purposes_keep_multi_key_lists(self):
        keys = ','.join(f'EPIC-{i}' for i in range(1, 60))
        self.assertIsNone(epic_refresh.epic_keys_error({'purpose': 'ready-to-close', 'epicKeys': keys}))

    def test_single_flag_rejects_more_than_one_key_for_other_routes(self):
        self.assertIsNone(epic_refresh.epic_keys_error({'epicKeys': 'EPIC-1'}, single=True))
        self.assertIsNone(epic_refresh.epic_keys_error({}, single=True))
        self.assertEqual(epic_refresh.epic_keys_error({'epicKeys': 'EPIC-1,EPIC-2'}, single=True)['error'], 'invalid_epic_keys')

    def test_single_epic_key(self):
        self.assertEqual(epic_refresh.single_epic_key({'epicKeys': ' EPIC-7 ,EPIC-8'}), 'EPIC-7')
        self.assertIsNone(epic_refresh.single_epic_key({}))


class LimiterTests(unittest.TestCase):
    def test_first_call_allowed_then_blocked_until_interval(self):
        clock = [100.0]
        limiter = epic_refresh.EpicRefreshLimiter(min_interval_seconds=8, clock=lambda: clock[0])
        self.assertEqual(limiter.retry_after('u1', 'b1'), 0)
        clock[0] = 103.0
        self.assertEqual(limiter.retry_after('u1', 'b1'), 5)
        self.assertEqual(limiter.retry_after('u2', 'b1'), 0)
        self.assertEqual(limiter.retry_after('u1', 'b2'), 0)
        clock[0] = 108.5
        self.assertEqual(limiter.retry_after('u1', 'b1'), 0)

    def test_buckets_separate_lane_and_purpose(self):
        a = epic_refresh.limiter_bucket('epic-refresh', 'product', 'EPIC-1')
        self.assertNotEqual(a, epic_refresh.limiter_bucket('epic-refresh', 'tech', 'EPIC-1'))
        self.assertNotEqual(a, epic_refresh.limiter_bucket('epic-alerts', 'product', 'EPIC-1'))
        self.assertNotEqual(a, epic_refresh.limiter_bucket('epic-refresh', 'product', 'EPIC-2'))

    def test_table_is_bounded(self):
        limiter = epic_refresh.EpicRefreshLimiter(max_entries=3, clock=lambda: 1.0)
        for index in range(10):
            limiter.retry_after('u', f'b{index}')
        self.assertLessEqual(len(limiter._seen), 3)

    def test_concurrent_callers_get_exactly_one_pass(self):
        limiter = epic_refresh.EpicRefreshLimiter(min_interval_seconds=60, clock=lambda: 5.0)
        results = []
        def call():
            results.append(limiter.retry_after('u', 'b'))
        threads = [threading.Thread(target=call) for _ in range(16)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count(0), 1)
        self.assertEqual(len(results), 16)


class ResponseMetaTests(unittest.TestCase):
    def test_capped_and_missing_details(self):
        meta = epic_refresh.response_meta(250, 250, ['EPIC-1', 'EPIC-2'], {'EPIC-1': {}})
        self.assertEqual(meta, {'capped': True, 'epicKeysMissing': ['EPIC-2']})
        meta = epic_refresh.response_meta(3, 250, ['EPIC-1'], {'EPIC-1': {}})
        self.assertEqual(meta, {'capped': False, 'epicKeysMissing': []})


class EvictTests(unittest.TestCase):
    def test_evicts_only_named_purposes(self):
        cache = {'dashboard-key': 1, 'alerts-key': 2, 'epic-refresh-key': 3, 'other': 4}
        keys = {'dashboard': 'dashboard-key', 'alerts': 'alerts-key'}
        epic_refresh.evict_scope_entries(cache, threading.Lock(), lambda purpose: keys[purpose])
        self.assertEqual(cache, {'epic-refresh-key': 3, 'other': 4})


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_service -v
```
Expected: `ModuleNotFoundError` for `backend.services.epic_refresh`.

- [ ] **Step 3: Write the service**

Create `backend/services/epic_refresh.py`:

```python
"""Per-epic refresh helpers: request validation, rate limiting, response metadata, cache eviction.

Kept out of jira_server.py, which sits at its structure budget.
"""
import re
import threading
import time
from collections import OrderedDict

EPIC_REFRESH_PURPOSE = 'epic-refresh'
EPIC_ALERTS_PURPOSE = 'epic-alerts'
EPIC_SCOPED_PURPOSES = (EPIC_REFRESH_PURPOSE, EPIC_ALERTS_PURPOSE)
# ASCII only: \d and str.isdigit() accept other Unicode digits. \Z rejects a trailing newline.
ISSUE_KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]+-[0-9]+\Z')
_SPRINT_RE = re.compile(r'[0-9]+')


def parse_epic_keys(raw):
    """Split a comma list into unique, stripped keys, keeping order."""
    keys = []
    for part in str(raw or '').split(','):
        key = part.strip()
        if key and key not in keys:
            keys.append(key)
    return keys


def single_epic_key(args):
    keys = parse_epic_keys(args.get('epicKeys', ''))
    return keys[0] if keys else None


def epic_keys_error(args, single=False):
    """Return an error payload for a malformed epicKeys value or a scoped-purpose request, else None.

    `single=True` (routes that take one epic) also rejects a multi-key list.
    """
    keys = parse_epic_keys(args.get('epicKeys', ''))
    if any(not ISSUE_KEY_RE.match(key) for key in keys):
        return {'error': 'invalid_epic_keys', 'message': 'Epic keys must look like PROJ-123.'}
    purpose = str(args.get('purpose') or '').strip().lower()
    if purpose in EPIC_SCOPED_PURPOSES:
        lane = str(args.get('project') or '').strip().lower()
        sprint = str(args.get('sprint') or '').strip()
        if len(keys) != 1 or not _SPRINT_RE.fullmatch(sprint) or lane not in ('product', 'tech'):
            return {
                'error': 'invalid_epic_refresh',
                'message': 'Epic refresh needs one epic key, a numeric sprint and a project lane.',
            }
    elif single and len(keys) > 1:
        return {'error': 'invalid_epic_keys', 'message': 'Pass exactly one epic key.'}
    return None


def limiter_bucket(purpose, lane, epic_key):
    """Both lanes of one click (and the alert call that follows) must never share a bucket."""
    return f'{purpose}:{lane}:{epic_key}'


class EpicRefreshLimiter:
    """Per user and bucket minimum interval between refreshes. Thread-safe."""

    def __init__(self, min_interval_seconds=8.0, clock=time.monotonic, max_entries=2048):
        self._min = float(min_interval_seconds)
        self._clock = clock
        self._max = int(max_entries)
        self._seen = OrderedDict()
        self._lock = threading.Lock()

    def retry_after(self, scope_key, bucket):
        """Return 0 and record the attempt when allowed, else the whole seconds to wait."""
        now = self._clock()
        key = (str(scope_key), str(bucket))
        with self._lock:
            last = self._seen.get(key)
            if last is not None and now - last < self._min:
                return max(1, int(self._min - (now - last) + 0.999))
            self._seen[key] = now
            self._seen.move_to_end(key)
            while len(self._seen) > self._max:
                self._seen.popitem(last=False)
        return 0


def response_meta(issue_count, max_results, requested_keys, epic_details):
    """Truncation and missing-details flags so the client never infers removals from partial data."""
    return {
        'capped': issue_count >= max_results,
        'epicKeysMissing': [key for key in requested_keys if key not in epic_details],
    }


def evict_scope_entries(cache, lock, key_for_purpose, purposes=('dashboard', 'alerts')):
    """Drop the same scope's cached dashboard and alerts entries so a reload is not stale."""
    with lock:
        for purpose in purposes:
            cache.pop(key_for_purpose(purpose), None)
```

- [ ] **Step 4: Run the service tests and confirm they pass**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_service -v
```
Expected: all tests `ok`.

- [ ] **Step 5: Write the failing route tests**

Create `tests/test_epic_refresh_purpose.py` (scaffolding and patch list follow `tests/test_create_stories_alert.py`; adapt a patch target only if its name differs in the tree, and keep every assertion):

```python
import time
import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

from tests.auth_mode_test_utils import force_basic_auth_mode

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc

REAL = object()


def _mock_response(status_code, payload=None):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload if payload is not None else {}
    return response


def _issue(key, epic='EPIC-1'):
    return {'id': key, 'key': key, 'fields': {
        'summary': f'Story {key}', 'status': {'name': 'To Do'}, 'priority': {'name': 'Medium'},
        'issuetype': {'name': 'Story'}, 'updated': '2026-09-30T10:00:00.000+0000',
        'customfield_10004': 3, 'customfield_epic_link': epic,
        'customfield_sprint': [{'id': 123, 'name': '2026Q3'}],
    }}


def _page(issues, last=True, token=None):
    body = {'issues': issues, 'names': {'customfield_epic_link': 'Epic Link', 'customfield_sprint': 'Sprint'},
            'total': len(issues), 'isLast': last}
    if token:
        body['nextPageToken'] = token
    return _mock_response(200, body)


def _routing_search(payload):
    if str(payload.get('jql', '')).startswith('issueKey in'):
        return _mock_response(200, {'issues': [{'key': 'EPIC-1', 'fields': {
            'summary': 'Epic', 'status': {'name': 'In Progress'}, 'priority': {'name': 'High'},
            'updated': '2026-09-30T10:00:00.000+0000'}}], 'isLast': True})
    return _page([_issue('S-1')])


def _key(purpose, lane='product', epic_keys=None):
    return jira_server.build_tasks_cache_key('123', 'default', lane, [], [], True, False, purpose, epic_keys, sprint_name='')


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class EpicRefreshPurposeTests(unittest.TestCase):
    def setUp(self):
        from backend.routes import eng_routes
        from backend.services import epic_refresh
        force_basic_auth_mode(self, jira_server)
        jira_server.app.testing = True
        self.client = jira_server.app.test_client()
        jira_server.TASKS_CACHE.clear()
        self.eng_routes = eng_routes
        self.epic_refresh = epic_refresh
        # The route guard keeps a module-level limiter; give every test a fresh, non-blocking one.
        eng_routes._EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter(min_interval_seconds=0)

    def _get(self, query, search, details=None):
        with ExitStack() as stack:
            for target, value in (
                ('build_base_jql', 'project = TEST'), ('get_selected_projects_typed', []),
                ('get_configured_issue_types', ['Story']), ('resolve_team_field_id', 'customfield_team'),
                ('resolve_epic_link_field_id', 'customfield_epic_link'), ('get_sprint_field_id', 'customfield_sprint'),
                ('get_project_track_field_id', 'customfield_track'), ('get_delivery_owner_field_id', ''),
            ):
                stack.enter_context(patch.object(jira_server, target, return_value=value))
            stack.enter_context(patch.object(jira_server, 'jira_search_request', search))
            details_mock = None
            if details is not REAL:
                details_mock = stack.enter_context(patch.object(
                    jira_server, 'fetch_epic_details_bulk', Mock(return_value=details if details is not None else {})))
            scan = stack.enter_context(patch.object(jira_server, 'fetch_epics_for_empty_alert', Mock(return_value=[])))
            response = self.client.get('/api/tasks-with-team-name?' + query)
        return response, details_mock, scan

    def test_missing_or_malformed_arguments_return_400_without_a_jira_call(self):
        search = Mock()
        for query in (
            'purpose=epic-refresh&project=product&sprint=123',
            'purpose=epic-refresh&project=product&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=product&sprint=abc&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=all&sprint=123&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1,EPIC-2',
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1%22%20OR%20project%20is%20not%20EMPTY',
            'purpose=epic-alerts&project=product&sprint=123',
            'purpose=epic-alerts&project=product&sprint=123&epicKeys=EPIC-1,EPIC-2',
            'purpose=ready-to-close&project=product&epicKeys=X)%20OR%20issueKey%20in%20(Y',
        ):
            response, _details, _scan = self._get(query, search)
            self.assertEqual(response.status_code, 400, query)
            self.assertIn(response.get_json()['error'], ('invalid_epic_refresh', 'invalid_epic_keys'))
        search.assert_not_called()

    def test_skips_the_empty_epic_scan_and_fetches_details_for_the_requested_key(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        details = {'EPIC-1': {'key': 'EPIC-1', 'summary': 'Epic', 'status': 'In Progress'}}
        response, details_mock, scan = self._get(
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1&refresh=true', search, details)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        scan.assert_not_called()
        self.assertEqual(details_mock.call_args.args[0], ['EPIC-1'])
        body = response.get_json()
        self.assertEqual(body['epics'], details)
        self.assertEqual(body['epicsInScope'], [])
        self.assertIs(body['capped'], False)
        self.assertEqual(body['epicKeysMissing'], [])
        story_jql = search.call_args_list[0].args[0]['jql']
        self.assertIn('Sprint = 123', story_jql)
        self.assertIn('"Epic Link" in ("EPIC-1")', story_jql)
        self.assertIn('parent in ("EPIC-1")', story_jql)

    def test_epic_with_no_stories_still_returns_its_details(self):
        search = Mock(side_effect=[_page([])])
        details = {'EPIC-1': {'key': 'EPIC-1', 'summary': 'Empty epic', 'status': 'In Progress'}}
        response, _d, _s = self._get('purpose=epic-refresh&project=tech&sprint=123&epicKeys=EPIC-1', search, details)
        body = response.get_json()
        self.assertEqual(body['issues'], [])
        self.assertEqual(body['epics'], details)
        self.assertEqual(body['epicKeysMissing'], [])

    def test_missing_details_are_reported_not_hidden(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, {})
        self.assertEqual(response.get_json()['epicKeysMissing'], ['EPIC-1'])

    def test_capped_flag_when_250_rows_come_back(self):
        pages = [
            _page([_issue(f'S-{i}') for i in range(100)], last=False, token='t1'),
            _page([_issue(f'S-{i}') for i in range(100, 200)], last=False, token='t2'),
            _page([_issue(f'S-{i}') for i in range(200, 250)], last=True),
        ]
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1',
                                     Mock(side_effect=pages), {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual(len(response.get_json()['issues']), 250)
        self.assertIs(response.get_json()['capped'], True)

    def test_never_reads_or_writes_the_tasks_cache(self):
        stale_key = _key('epic-refresh', 'product', ['EPIC-1'])
        jira_server.TASKS_CACHE[stale_key] = {'timestamp': time.time(), 'data': {'issues': [{'key': 'STALE'}]}}
        before = dict(jira_server.TASKS_CACHE)
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search,
                                     {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual([issue['key'] for issue in response.get_json()['issues']], ['S-1'])
        self.assertEqual(jira_server.TASKS_CACHE, before)

    def test_success_evicts_only_the_same_lane_dashboard_and_alerts_entries(self):
        now = time.time()
        for purpose, lane in (('dashboard', 'product'), ('alerts', 'product'), ('dashboard', 'tech')):
            jira_server.TASKS_CACHE[_key(purpose, lane)] = {'timestamp': now, 'data': {'issues': []}}
        search = Mock(side_effect=[_page([_issue('S-1')])])
        self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertNotIn(_key('dashboard', 'product'), jira_server.TASKS_CACHE)
        self.assertNotIn(_key('alerts', 'product'), jira_server.TASKS_CACHE)
        self.assertIn(_key('dashboard', 'tech'), jira_server.TASKS_CACHE)

    def test_rate_limit_returns_429_with_retry_after(self):
        self.eng_routes._EPIC_REFRESH_LIMITER = self.epic_refresh.EpicRefreshLimiter(min_interval_seconds=8)
        search = Mock(side_effect=[_page([]), _page([])])
        query = 'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9'
        first, _d, _s = self._get(query, search, {'EPIC-9': {'key': 'EPIC-9'}})
        second, _d, _s = self._get(query, search, {'EPIC-9': {'key': 'EPIC-9'}})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.get_json()['error'], 'epic_refresh_rate_limited')
        self.assertGreaterEqual(second.get_json()['retryAfterSeconds'], 1)
        self.assertEqual(second.headers.get('Retry-After'), str(second.get_json()['retryAfterSeconds']))
        self.assertEqual(search.call_count, 1)

    def test_both_lanes_of_one_click_do_not_rate_limit_each_other(self):
        self.eng_routes._EPIC_REFRESH_LIMITER = self.epic_refresh.EpicRefreshLimiter(min_interval_seconds=8)
        search = Mock(side_effect=[_page([]), _page([]), _page([])])
        details = {'EPIC-9': {'key': 'EPIC-9'}}
        product, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9', search, details)
        tech, _d, _s = self._get('purpose=epic-refresh&project=tech&sprint=123&epicKeys=EPIC-9', search, details)
        again, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9', search, details)
        self.assertEqual((product.status_code, tech.status_code, again.status_code), (200, 200, 429))

    def test_default_purpose_still_runs_the_empty_epic_scan(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, scan = self._get('project=product&sprint=123&epicKeys=EPIC-1', search, {})
        self.assertEqual(response.status_code, 200)
        scan.assert_called_once()

    def test_one_lane_call_costs_exactly_two_searches(self):
        search = Mock(side_effect=_routing_search)
        response, _d, scan = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, REAL)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(search.call_count, 2)  # one story page, one epic-details search
        scan.assert_not_called()
        self.assertEqual(list(response.get_json()['epics']), ['EPIC-1'])

    def test_refresh_uses_no_jira_write_path(self):
        # Name the real write symbols: find them with
        #   rg "def current_jira_request|requests\.(put|post|delete)" jira_server.py backend/jira_client.py
        #   rg "^def (update|transition|set|apply)" backend/services/jira_issue_*.py
        search = Mock(side_effect=[_page([_issue('S-1')])])
        boom = Mock(side_effect=AssertionError('a Jira write path was touched'))
        with patch.object(jira_server, 'current_jira_request', boom):
            response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search,
                                         {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual(response.status_code, 200)
        boom.assert_not_called()


if __name__ == '__main__':
    unittest.main()
```
Then extend the same file with three tests whose scaffolding comes from `tests/test_oauth_eng_routes.py` (read how it builds an OAuth context and patches `current_request_auth_context`; copy that approach, do not invent one):
1. **OAuth mode:** with a per-user OAuth context, `purpose=epic-refresh` returns 200, every cache key involved is the partitioned tuple form, the dashboard and alerts entries of **that** user and lane are evicted while another user's entries with the same raw key survive, and no `TASKS_CACHE` entry is written.
2. **Unauthenticated OAuth:** with no session the route returns 401 through the existing auth-required payload (the guard's `AuthError` handling), never 500.
3. **Credentials:** in OAuth mode patch `backend.auth.user_api_tokens._basic_auth_header` and `backend.auth.jira_auth.jira_request` (verify both names with `rg`) to raise, and assert the request succeeds using only the per-user context.

- [ ] **Step 6: Run and confirm failures**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_purpose -v
```
Expected: FAIL (400s not returned, scan still called, meta missing).

- [ ] **Step 7: Implement the route guard in `eng_routes.py`**

Add `epic_refresh` to the existing `from backend.services import eng_board, shared_group_config` line (no mid-file import), then at module level:

```python
_EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter()


def _epic_refresh_guard():
    """400 for malformed epicKeys or scoped-purpose requests; 429 when refreshed too often."""
    error = epic_refresh.epic_keys_error(request.args)
    if error:
        return jsonify(error), 400
    purpose = str(request.args.get('purpose') or '').strip().lower()
    if purpose in epic_refresh.EPIC_SCOPED_PURPOSES:
        try:
            context = current_request_auth_context()
        except AuthError as auth_error:
            return _eng_auth_error_response(auth_error)
        scope = f"{getattr(context, 'workspace_id', '')}:{getattr(context, 'user_id', '') or 'local'}"
        lane = str(request.args.get('project') or '').strip().lower()
        bucket = epic_refresh.limiter_bucket(purpose, lane, epic_refresh.single_epic_key(request.args))
        wait = _EPIC_REFRESH_LIMITER.retry_after(scope, bucket)
        if wait:
            response = jsonify({'error': 'epic_refresh_rate_limited', 'retryAfterSeconds': wait})
            response.headers['Retry-After'] = str(wait)
            return response, 429
    return None
```
(`request`, `jsonify` and `current_request_auth_context` come from the same late-bound globals the neighbouring handlers use; `_eng_auth_error_response` and `AuthError` already exist in the module.) Then in both route functions call the guard first:

```python
@bp.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Fetch tasks from Jira API."""
    guarded = _epic_refresh_guard()
    if guarded:
        return guarded
    return fetch_tasks(include_team_name=False)


@bp.route('/api/tasks-with-team-name', methods=['GET'])
def get_tasks_with_team_name():
    """Fetch tasks with team name derived from Jira Team field."""
    guarded = _epic_refresh_guard()
    if guarded:
        return guarded
    return fetch_tasks(include_team_name=True)
```
Validation is the injection fix: the key regex admits only ASCII letters, digits, underscore and one hyphen, so the unquoted `issueKey in (...)` in `fetch_epic_details_bulk` and the quoted epic clause cannot be broken out of. Do not change `fetch_epic_details_bulk` quoting (other callers pin its form).

- [ ] **Step 8: Implement the `fetch_tasks` branch in `jira_server.py`**

Five small edits (measured growth: +11 lines, 6463 to 6474):

1. Next to the other service imports add `from backend.services.epic_refresh import EPIC_REFRESH_PURPOSE, evict_scope_entries, response_meta as epic_refresh_meta`. After `lightweight_ready_to_close = request_purpose == 'ready-to-close'` add `is_epic_refresh = request_purpose == EPIC_REFRESH_PURPOSE`.
2. Cache read: extend the condition `if cache_enabled and not force_refresh and cached_entry and ...` with `and not is_epic_refresh`.
3. In the enrichment block change `if lightweight_ready_to_close:` to:

```python
        if is_epic_refresh:
            epic_details = fetch_epic_details_bulk(epic_keys_filter, headers, epic_name_field)
            epics_in_scope = []
        elif lightweight_ready_to_close:
```
   and leave the rest of the block untouched. Run inline: do not place this in the Basic `ThreadPoolExecutor` (`fetch_epic_details_bulk` reads config getters that need the request context).
4. Right after `data['epics'] = epic_details` add:

```python
        if is_epic_refresh:
            data.update(epic_refresh_meta(len(slim_issues), max_results, epic_keys_filter, epic_details))
```
5. In `publish_result`: change `if cache_enabled:` to `if cache_enabled and not is_epic_refresh:` and, before `response = jsonify(data)`, add:

```python
            if cache_enabled and is_epic_refresh:
                evict_scope_entries(TASKS_CACHE, _cache_lock, lambda purpose: build_jira_home_process_cache_key(
                    auth_context, build_tasks_cache_key(sprint, group_id, project_filter, team_ids, team_label_values,
                                                        include_team_name, use_template, purpose, None, sprint_name=sprint_name)))
```

- [ ] **Step 9: Report the line count; the orchestrator ratchets the budget**

```bash
wc -l jira_server.py
```
Report the number (expected 6474). The subagent does not edit `tests/test_codebase_structure_budgets.py`; the orchestrator raises the `"jira_server.py"` value and adds the comment `# feature/213-per-epic-refresh: epic-refresh purpose branch, cache skip and eviction (+11).` before the verification below.

- [ ] **Step 10: Verify**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_service tests.test_epic_refresh_purpose tests.test_create_stories_alert tests.test_oauth_eng_routes tests.test_burnout_stats_api tests.test_initiative_extraction tests.test_codebase_structure_budgets -v 2>&1 | tail -25
make test-security 2>&1 | tail -6
```
Expected: all pass (the budgets test passes once the orchestrator has ratcheted).

- [ ] **Step 11: Breaker isolation decision checkpoint**

Read `backend/jira_client.py` `resilient_jira_get`, `current_jira_get` (it accepts a `diagnostic_transport`) and `backend/services/eng_board_stream.py` (`EngBoardRequestTransport` owns a per-instance breaker). If a low-risk way exists to give only `epic-refresh` searches a small attempt budget that honors `Retry-After` and records failures on a breaker other than `JIRA_SEARCH_CIRCUIT_BREAKER`, implement it with a test that repeated 429s leave the global breaker state unchanged. If none is cheap, change nothing and write one sentence in this plan's Outcome section: "breaker isolation deferred; the server minimum interval and the client in-flight cap stand in." Do not stretch the change.

- [ ] **Step 12: Report for commit**

Files: `backend/services/epic_refresh.py`, `tests/test_epic_refresh_service.py`, `tests/test_epic_refresh_purpose.py`, `backend/routes/eng_routes.py`, `jira_server.py`, plus `tests/test_codebase_structure_budgets.py` (orchestrator). Message: `Add epic-refresh purpose with validation and rate limit`.

---

## Task 2: Pure diff and merge module

**Files:**
- Create: `frontend/src/eng/epicRefreshPatch.js`, `tests/test_epic_refresh_patch.js`

**Interfaces:**
- Produces: the `epicRefreshPatch.js` block in Shared Interfaces. Consumed by Task 5 (controller), Task 8 (alerts A).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_epic_refresh_patch.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffEpic, diffStory, mergeEpicStories, normalizeStory, patchEpicScopeEntries, patchStoryCopies } from '../frontend/src/eng/epicRefreshPatch.js';

const story = (key, fields = {}) => ({
    key,
    id: key,
    fields: {
        summary: `Story ${key}`,
        status: { name: 'To Do' },
        priority: { name: 'Medium' },
        issuetype: { name: 'Story' },
        assignee: { accountId: 'a1', displayName: 'Ana' },
        updated: '2026-09-30T10:00:00.000+0000',
        customfield_10004: 3,
        teamId: 't1',
        epicKey: 'EPIC-1',
        customfield_10101: [{ id: 7 }],
        ...fields,
    },
});
const base = {
    epicKey: 'EPIC-1', laneApplied: true, capped: false, detailsMissing: false,
    protectedKeys: new Set(), clickSnapshot: new Map(), userRemovedKeys: new Set(),
};

test('a comment-only change (updated differs, displayed fields equal) is silent', () => {
    const diff = diffStory(story('S-1'), story('S-1', { updated: '2026-09-30T11:00:00.000+0000' }));
    assert.deepEqual(diff.changedFields, []);
    assert.equal(diff.silent, true);
    assert.equal(diff.equal, false);
});

test('an identical item is equal', () => {
    assert.equal(diffStory(story('S-1'), story('S-1')).equal, true);
});

test('status, priority, summary and issuetype changes are reported by field', () => {
    const diff = diffStory(story('S-1'), story('S-1', { status: { name: 'Done' }, summary: 'New', priority: { name: 'High' }, issuetype: { name: 'Task' } }));
    assert.deepEqual(diff.changedFields.sort(), ['issuetype', 'priority', 'status', 'summary']);
});

test('Story Points null, undefined and 0 are equal; 0 and 3 differ', () => {
    assert.equal(diffStory(story('S-1', { customfield_10004: null }), story('S-1', { customfield_10004: 0 })).equal, true);
    assert.equal(diffStory(story('S-1', { customfield_10004: undefined }), story('S-1', { customfield_10004: 0 })).equal, true);
    assert.deepEqual(diffStory(story('S-1', { customfield_10004: 0 }), story('S-1', { customfield_10004: 3 })).changedFields, ['storyPoints']);
});

test('assignee falls back to display name and ignores unrelated person fields', () => {
    const a = story('S-1', { assignee: { displayName: 'Ana' } });
    const b = story('S-1', { assignee: { displayName: 'Ana', avatar: 'x' } });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { assignee: { displayName: 'Bo' } })).changedFields, ['assignee']);
});

test('sprint compares as an id-sorted list', () => {
    const a = story('S-1', { customfield_10101: [{ id: 2 }, { id: 1 }] });
    const b = story('S-1', { customfield_10101: [{ id: 1 }, { id: 2 }] });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { customfield_10101: [{ id: 3 }] })).changedFields, ['sprint']);
});

test('subtaskSummary compares by content, not key order', () => {
    const a = story('S-1', { subtaskSummary: { total: 2, done: 1 } });
    const b = story('S-1', { subtaskSummary: { done: 1, total: 2 } });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { subtaskSummary: { total: 2, done: 2 } })).changedFields, ['subtaskSummary']);
});

test('normalizeStory is total on an empty issue', () => {
    assert.equal(normalizeStory({}).storyPoints, 0);
    assert.equal(normalizeStory(undefined).status, '');
});

test('merge keeps the held array identity when nothing changed', () => {
    const held = [story('S-1'), story('S-2')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2')] });
    assert.equal(result.items, held);
    assert.equal(result.changed, false);
});

test('merge replaces only the changed item and keeps other identities', () => {
    const held = [story('S-1'), story('S-2')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2', { status: { name: 'Done' } })] });
    assert.equal(result.items[0], held[0]);
    assert.notEqual(result.items[1], held[1]);
    assert.deepEqual(result.changedKeys, ['S-2']);
    assert.equal(result.changed, true);
});

test('a silent-only update replaces the item but reports it as silent', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { updated: '2026-09-30T12:00:00.000+0000' })] });
    assert.deepEqual(result.silentKeys, ['S-1']);
    assert.deepEqual(result.changedKeys, []);
});

test('a fetched story that is not held is added; a user-removed one is not', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2'), story('S-3')], userRemovedKeys: new Set(['S-3']) });
    assert.deepEqual(result.addedKeys, ['S-2']);
    assert.deepEqual(result.items.map(i => i.key), ['S-1', 'S-2']);
});

test('a held story of this epic missing from a complete lane is removed', () => {
    const held = [story('S-1'), story('S-2'), story('S-9', { epicKey: 'EPIC-2' })];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1')] });
    assert.deepEqual(result.removedKeys, ['S-2']);
    assert.deepEqual(result.items.map(i => i.key), ['S-1', 'S-9']);
});

test('no removal when the lane is capped or the epic details are missing', () => {
    const held = [story('S-1'), story('S-2')];
    assert.equal(mergeEpicStories({ ...base, held, fetched: [story('S-1')], capped: true }).removedKeys.length, 0);
    assert.equal(mergeEpicStories({ ...base, held, fetched: [story('S-1')], detailsMissing: true }).removedKeys.length, 0);
});

test('a lane that did not apply leaves the list untouched', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [], laneApplied: false });
    assert.equal(result.items, held);
    assert.equal(result.changed, false);
});

test('protected keys and keys edited since the click are kept as held', () => {
    const held = [story('S-1', { status: { name: 'Done' } }), story('S-2', { status: { name: 'In Progress' } })];
    const clickSnapshot = new Map([['S-2', story('S-2', { status: { name: 'To Do' } })]]);
    const result = mergeEpicStories({
        ...base, held, clickSnapshot, protectedKeys: new Set(['S-1']),
        fetched: [story('S-1'), story('S-2')],
    });
    assert.deepEqual(result.keptKeys.sort(), ['S-1', 'S-2']);
    assert.equal(result.items[0], held[0]);
    assert.equal(result.items[1], held[1]);
});

test('a story moved into this epic replaces the copy held under another epic (no duplicate)', () => {
    const held = [story('S-1', { epicKey: 'EPIC-2' })];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { epicKey: 'EPIC-1' })] });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].fields.epicKey, 'EPIC-1');
    assert.deepEqual(result.changedKeys, ['S-1']);
});

test('epic diff normalizes status and priority shapes and ignores updated-only changes as silent', () => {
    const held = { key: 'EPIC-1', summary: 'E', status: 'In Progress', priority: 'High', projectTrack: 'Committed', assignee: { accountId: 'a1' }, updated: '1' };
    assert.equal(diffEpic(held, { ...held, status: { name: 'In Progress' }, priority: { name: 'High' } }).equal, true);
    const silent = diffEpic(held, { ...held, updated: '2' });
    assert.equal(silent.silent, true);
    assert.deepEqual(diffEpic(held, { ...held, status: 'Done', initiative: { key: 'INIT-1', summary: 'I' } }).changedFields.sort(), ['initiative', 'status']);
    assert.equal(diffEpic(held, undefined).equal, true);
});

test('merge reports the changed fields per key', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { status: { name: 'Done' }, customfield_10004: 5 })] });
    assert.deepEqual(result.changedFieldsByKey['S-1'].slice().sort(), ['status', 'storyPoints']);
});

test('two merges applied one after the other keep both epics updates (functional-updater semantics)', () => {
    const held = [story('A-1', { epicKey: 'EPIC-1' }), story('B-1', { epicKey: 'EPIC-2' })];
    const afterFirst = mergeEpicStories({ ...base, epicKey: 'EPIC-1', held, fetched: [story('A-1', { epicKey: 'EPIC-1', status: { name: 'Done' } })] }).items;
    const afterSecond = mergeEpicStories({ ...base, epicKey: 'EPIC-2', held: afterFirst, fetched: [story('B-1', { epicKey: 'EPIC-2', status: { name: 'Done' } })] }).items;
    assert.deepEqual(afterSecond.map(item => item.fields.status.name), ['Done', 'Done']);
});

test('patchEpicScopeEntries updates only the matching epic-shaped entry and keeps identity when equal', () => {
    const list = [
        { key: 'EPIC-1', summary: 'E', status: { name: 'In Progress' }, assignee: { accountId: 'a1' } },
        { key: 'EPIC-2', summary: 'F', status: { name: 'To Do' } },
    ];
    assert.equal(patchEpicScopeEntries(list, 'EPIC-1', { key: 'EPIC-1', summary: 'E', status: 'In Progress', assignee: { accountId: 'a1' } }), list);
    const next = patchEpicScopeEntries(list, 'EPIC-1', { key: 'EPIC-1', summary: 'E2', status: 'Done', assignee: { accountId: 'a1' } });
    assert.equal(next[0].status.name, 'Done');
    assert.equal(next[0].summary, 'E2');
    assert.equal(next[1], list[1]);
    assert.equal(patchEpicScopeEntries(list, 'EPIC-1', undefined), list);
});

test('patchStoryCopies patches only keys present in both and keeps identity when equal', () => {
    const lightweight = { key: 'S-1', fields: { status: { name: 'To Do' }, epicKey: 'EPIC-1' } };
    const list = [lightweight, { key: 'S-9', fields: { status: { name: 'To Do' } } }];
    assert.equal(patchStoryCopies(list, new Map([['S-1', story('S-1', { status: { name: 'To Do' } })]])), list);
    const next = patchStoryCopies(list, new Map([['S-1', story('S-1', { status: { name: 'Done' } })]]));
    assert.equal(next[0].fields.status.name, 'Done');
    assert.equal(Object.keys(next[0].fields).sort().join(','), 'epicKey,status');
    assert.equal(next[1], list[1]);
});
```

- [ ] **Step 2: Run and confirm the failure**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_patch.js
```
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

Create `frontend/src/eng/epicRefreshPatch.js`:

```js
// Pure diff and merge rules for the per-epic refresh (issue #213). No React, no I/O.

export const STORY_DISPLAYED_FIELDS = Object.freeze([
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'storyPoints', 'teamId', 'epicKey', 'sprint', 'subtaskSummary',
]);
export const EPIC_DISPLAYED_FIELDS = Object.freeze(['summary', 'status', 'priority', 'projectTrack', 'assignee', 'initiative']);

const nameOf = value => (value && typeof value === 'object' ? String(value.name ?? value.value ?? '') : String(value ?? ''));

const personKey = person => {
    if (!person) return '';
    if (typeof person === 'string') return person;
    return String(person.accountId || person.displayName || '');
};

const sprintKey = value => {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return list
        .map(item => (item && typeof item === 'object' ? String(item.id ?? item.name ?? '') : String(item)))
        .filter(Boolean)
        .sort()
        .join(',');
};

const stableStringify = value => {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${key}:${stableStringify(value[key])}`).join(',')}}`;
};

const storyPointsKey = value => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
};

export function normalizeStory(issue) {
    const fields = issue?.fields || {};
    return {
        summary: String(fields.summary ?? ''),
        status: nameOf(fields.status),
        priority: nameOf(fields.priority),
        issuetype: nameOf(fields.issuetype),
        assignee: personKey(fields.assignee),
        storyPoints: storyPointsKey(fields.customfield_10004),
        teamId: String(fields.teamId ?? fields.team?.id ?? ''),
        epicKey: String(fields.epicKey ?? ''),
        sprint: sprintKey(fields.customfield_10101),
        subtaskSummary: stableStringify(fields.subtaskSummary),
    };
}

export function diffStory(held, fetched) {
    const before = normalizeStory(held);
    const after = normalizeStory(fetched);
    const changedFields = STORY_DISPLAYED_FIELDS.filter(field => before[field] !== after[field]);
    const updatedChanged = String(held?.fields?.updated ?? '') !== String(fetched?.fields?.updated ?? '');
    return {
        changedFields,
        silent: changedFields.length === 0 && updatedChanged,
        equal: changedFields.length === 0 && !updatedChanged,
    };
}

export function mergeEpicStories({
    held = [], fetched = [], epicKey, laneApplied = true, capped = false, detailsMissing = false,
    protectedKeys = new Set(), clickSnapshot = new Map(), userRemovedKeys = new Set(),
}) {
    const unchanged = { items: held, changedKeys: [], silentKeys: [], addedKeys: [], removedKeys: [], keptKeys: [], changedFieldsByKey: {}, changed: false };
    if (!laneApplied) return unchanged;
    const fetchedByKey = new Map(fetched.map(issue => [issue.key, issue]));
    const heldKeys = new Set(held.map(issue => issue.key));
    const canRemove = !capped && !detailsMissing;
    const items = [];
    const changedKeys = [];
    const silentKeys = [];
    const addedKeys = [];
    const removedKeys = [];
    const keptKeys = [];
    const changedFieldsByKey = {};
    let replaced = false;

    for (const current of held) {
        const key = current.key;
        const snapshot = clickSnapshot.get(key);
        const editedSinceClick = Boolean(snapshot) && diffStory(snapshot, current).changedFields.length > 0;
        if (protectedKeys.has(key) || editedSinceClick) {
            items.push(current);
            keptKeys.push(key);
            continue;
        }
        const incoming = fetchedByKey.get(key);
        if (incoming) {
            const diff = diffStory(current, incoming);
            if (diff.equal) {
                items.push(current);
                continue;
            }
            items.push(incoming);
            replaced = true;
            changedFieldsByKey[key] = diff.changedFields;
            (diff.silent ? silentKeys : changedKeys).push(key);
            continue;
        }
        if (canRemove && String(current.fields?.epicKey ?? '') === String(epicKey)) {
            removedKeys.push(key);
            replaced = true;
            continue;
        }
        items.push(current);
    }
    for (const incoming of fetched) {
        if (heldKeys.has(incoming.key) || userRemovedKeys.has(incoming.key)) continue;
        items.push(incoming);
        addedKeys.push(incoming.key);
        replaced = true;
    }
    return { items: replaced ? items : held, changedKeys, silentKeys, addedKeys, removedKeys, keptKeys, changedFieldsByKey, changed: replaced };
}

export function normalizeEpic(epic) {
    return {
        summary: String(epic?.summary ?? ''),
        status: nameOf(epic?.status),
        priority: nameOf(epic?.priority),
        projectTrack: String(epic?.projectTrack ?? ''),
        assignee: personKey(epic?.assignee),
        initiative: epic?.initiative?.key ? `${epic.initiative.key}|${epic.initiative.summary ?? ''}` : '',
    };
}

export function diffEpic(held, fetched) {
    if (!fetched) return { changedFields: [], silent: false, equal: true };
    const before = normalizeEpic(held);
    const after = normalizeEpic(fetched);
    const changedFields = EPIC_DISPLAYED_FIELDS.filter(field => before[field] !== after[field]);
    const updatedChanged = String(held?.updated ?? '') !== String(fetched?.updated ?? '');
    return { changedFields, silent: changedFields.length === 0 && updatedChanged, equal: changedFields.length === 0 && !updatedChanged };
}

// Epic-shaped copies (`*EpicsInScope`, both `readyToClose*EpicsInScope`) keep their status as `{ name }`.
export function patchEpicScopeEntries(list, epicKey, fetchedEpic) {
    if (!Array.isArray(list) || !fetchedEpic) return list;
    let changed = false;
    const next = list.map(entry => {
        if (String(entry?.key ?? '') !== String(epicKey)) return entry;
        const patched = {
            ...entry,
            summary: fetchedEpic.summary ?? entry.summary,
            status: { name: nameOf(fetchedEpic.status) || entry.status?.name || '' },
            assignee: fetchedEpic.assignee ?? entry.assignee,
        };
        const same = patched.summary === entry.summary
            && nameOf(patched.status) === nameOf(entry.status)
            && personKey(patched.assignee) === personKey(entry.assignee);
        if (same) return entry;
        changed = true;
        return patched;
    });
    return changed ? next : list;
}

// Story-shaped copies (`readyToClose*Tasks`) are lightweight: patch only the keys they already carry.
export function patchStoryCopies(list, fetchedByKey) {
    if (!Array.isArray(list) || !fetchedByKey || !fetchedByKey.size) return list;
    let changed = false;
    const next = list.map(entry => {
        const incoming = fetchedByKey.get(entry?.key);
        if (!incoming) return entry;
        const keys = Object.keys(entry.fields || {}).filter(key => key !== 'missingFields' && key in (incoming.fields || {}));
        if (!keys.some(key => stableStringify(entry.fields[key]) !== stableStringify(incoming.fields[key]))) return entry;
        changed = true;
        const fields = { ...entry.fields };
        for (const key of keys) fields[key] = incoming.fields[key];
        return { ...entry, fields };
    });
    return changed ? next : list;
}
```

- [ ] **Step 4: Run and confirm the tests pass**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_patch.js
```
Expected: all pass. Fix the module, never a test.

- [ ] **Step 5: Report for commit**

Files: `frontend/src/eng/epicRefreshPatch.js`, `tests/test_epic_refresh_patch.js`. Message: `Add pure diff and merge rules for per-epic refresh`.

---

## Task 3: UI atoms — burst mark, glare, leaving dissolve, button

**Files:**
- Create: `frontend/src/ui/LoadingMark.jsx`, `frontend/src/ui/EpicRefreshButton.jsx`, `frontend/src/eng/epicRefreshGlare.js`, `tests/test_epic_refresh_glare.js`
- Modify: `frontend/src/issues/IssueCard.jsx` (export `REMOVE_FADE_MS`, `isLeaving` prop), `frontend/src/styles/eng/loading.css` (size modifier), `frontend/src/styles/eng/issues.css` (glare ring), `frontend/src/styles/eng/epics.css` (button overlay and header glare)

**Interfaces:** Produces the LoadingMark, EpicRefreshButton, IssueCard and glare blocks in Shared Interfaces.

**Read first:** `frontend/src/ui/LoadingState.jsx`, `frontend/src/styles/eng/loading.css` (mark and spinner rules), `frontend/src/ui/IconButton.jsx`, the header Refresh button SVG in `dashboard.jsx` (search `refresh-icon`), `frontend/src/issues/IssueCard.jsx` (props, `isRemoveFading`, className line), `frontend/src/styles/eng/issues.css` (`.task-item`, `::after`, `.task-highlight`, `.is-removing`), `frontend/src/styles/eng/epics.css` (`.epic-header`), `tests/test_eng_board_styles.js:100-140` (header CSS regex guards: do not violate), `tmp/glare-specimen.html` (visual reference).

- [ ] **Step 1: Write the failing glare tests**

Create `tests/test_epic_refresh_glare.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLARE_CAP, glareDelayMs, selectGlareKeys } from '../frontend/src/eng/epicRefreshGlare.js';

const rect = (top, height = 60) => ({ top, bottom: top + height });
const viewport = { top: 100, bottom: 700 };

test('selects only mounted, in-viewport keys below the sticky stack, top first', () => {
    const rects = new Map([['A', rect(300)], ['B', rect(120)], ['C', rect(40)], ['D', rect(800)]]);
    const keys = selectGlareKeys({ changedKeys: ['A', 'B', 'C', 'D', 'E'], rects, viewport });
    assert.deepEqual(keys, ['B', 'A']);
});

test('suppressed keys never glint and the cap is 8', () => {
    const rects = new Map(Array.from({ length: 12 }, (_, i) => [`K${i}`, rect(110 + i * 20)]));
    const keys = selectGlareKeys({ changedKeys: [...rects.keys()], rects, viewport, suppressed: new Set(['K0']) });
    assert.equal(GLARE_CAP, 8);
    assert.equal(keys.length, 8);
    assert.ok(!keys.includes('K0'));
});

test('delay grows with distance below the viewport top', () => {
    assert.equal(glareDelayMs(100, 100), 0);
    assert.equal(glareDelayMs(600, 100), 200);
    assert.equal(glareDelayMs(50, 100), 0);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_glare.js
```
Expected: FAIL (module not found).

- [ ] **Step 3: Write the glare helper**

Create `frontend/src/eng/epicRefreshGlare.js`:

```js
export const GLARE_CAP = 8;
const GLARE_ANIMATIONS = new Set(['epic-refresh-glint', 'epic-refresh-tint']);

export function selectGlareKeys({ changedKeys, rects, viewport, suppressed = new Set(), cap = GLARE_CAP }) {
    return changedKeys
        .filter(key => !suppressed.has(key) && rects.has(key))
        .map(key => ({ key, rect: rects.get(key) }))
        .filter(({ rect }) => rect.bottom > viewport.top && rect.top < viewport.bottom)
        .sort((a, b) => a.rect.top - b.rect.top)
        .slice(0, cap)
        .map(({ key }) => key);
}

export function glareDelayMs(rectTop, viewportTop) {
    return Math.max(0, rectTop - viewportTop) * 0.4;
}

// React owns className, so the glare is an attribute React never renders.
export function playGlare(element, delayMs = 0) {
    if (!element) return;
    element.style.setProperty('--glare-delay', `${Math.round(delayMs)}ms`);
    element.removeAttribute('data-glare');
    void element.offsetWidth;
    element.setAttribute('data-glare', 'on');
    const onEnd = event => {
        if (event.target !== element || !GLARE_ANIMATIONS.has(event.animationName)) return;
        element.removeAttribute('data-glare');
        element.removeEventListener('animationend', onEnd);
    };
    element.addEventListener('animationend', onEnd);
}
```

- [ ] **Step 4: Run the glare tests and confirm they pass**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_glare.js
```
Expected: pass.

- [ ] **Step 5: `LoadingMark` and its CSS**

Create `frontend/src/ui/LoadingMark.jsx`:

```jsx
import * as React from 'react';

// The EPM burst, sized for inline controls. Same images and classes as LoadingState.
export default function LoadingMark({ size = 'xs', className = '' }) {
    return (
        <span className={`loading-mark loading-mark-${size} ${className}`.trim()} aria-hidden="true">
            <img className="loading-mark-spinner" src="epm-burst.svg" alt="" />
            <img className="loading-mark-signature" src="epm-burst.svg" alt="" />
        </span>
    );
}
```

Append to `frontend/src/styles/eng/loading.css` (after the `.loading-state-inline .loading-mark` rule group):

```css
        .loading-mark-xs {
            width: 16px;
            height: 16px;
        }

        .loading-mark-xs .loading-mark-spinner {
            filter: none;
        }

        .loading-mark-xs .loading-mark-signature {
            width: 5px;
            height: 5px;
        }

        @media (prefers-reduced-motion: reduce) {
            .loading-mark-xs .loading-mark-spinner {
                animation: none;
            }
        }
```

- [ ] **Step 6: `IssueCard` changes**

In `frontend/src/issues/IssueCard.jsx`: change `const REMOVE_FADE_MS = 240;` to `export const REMOVE_FADE_MS = 240;`; add `isLeaving = false,` to the props destructuring; in the `className` template replace `${isRemoveFading ? 'is-removing' : ''}` with `${isRemoveFading || isLeaving ? 'is-removing' : ''}`; and change the remove button's `disabled={isRemoveFading}` to `disabled={isRemoveFading || isLeaving}`. No other change (EPM also renders `IssueCard` and never passes `isLeaving`).

- [ ] **Step 7: Glare CSS**

Append to `frontend/src/styles/eng/issues.css` after the `.task-item::after` block group:

```css
        /* Per-epic refresh glare (issue #213). ::after is taken by the red overlay and .task-highlight. */
        .task-item[data-glare]::before {
            content: '';
            position: absolute;
            inset: 0 0 0 -3px;
            border-radius: inherit;
            padding: 1.5px;
            pointer-events: none;
            background: linear-gradient(115deg,
                transparent calc(50% - 22%),
                rgba(232, 163, 61, 0.35) calc(50% - 9.9%),
                rgba(232, 163, 61, 1) 50%,
                rgba(232, 163, 61, 0.35) calc(50% + 9.9%),
                transparent calc(50% + 22%));
            background-size: 300% 100%;
            background-position: 100% 0;
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            -webkit-mask-composite: xor;
            mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
            animation: epic-refresh-glint 1800ms cubic-bezier(0.3, 0.1, 0.2, 1) var(--glare-delay, 0ms) 1 both;
        }

        @keyframes epic-refresh-glint {
            0% { background-position: 100% 0; opacity: 0; }
            12% { opacity: var(--glare-peak, 0.5); }
            88% { opacity: var(--glare-peak, 0.5); }
            100% { background-position: 0% 0; opacity: 0; }
        }

        @keyframes epic-refresh-tint {
            0% { opacity: 0; }
            25% { opacity: calc(var(--glare-peak, 0.5) * 1.2); }
            100% { opacity: 0; }
        }

        /* Card opacity multiplies the ring down on killed and incomplete cards; dimmed cards get no glare. */
        .task-item.status-killed[data-glare],
        .task-item.status-incomplete[data-glare] {
            --glare-peak: 0.8;
        }

        @media (prefers-reduced-motion: reduce) {
            .task-item[data-glare]::before {
                background: rgba(232, 163, 61, 1);
                background-size: auto;
                animation: epic-refresh-tint 900ms ease-out 1 both;
            }
        }
```

Append to `frontend/src/styles/eng/epics.css` (check `grep -n "epic-header::" frontend/src/styles/**` first; if `::after` or `::before` exists on `.epic-header`, use the free one):

```css
        /* Per-epic refresh (issue #213): header glare and the corner button. */
        .epic-header[data-glare]::after {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            bottom: -1px;
            height: 2px;
            pointer-events: none;
            background: linear-gradient(90deg, transparent calc(50% - 22%), rgba(232, 163, 61, 1) 50%, transparent calc(50% + 22%));
            background-size: 300% 100%;
            background-position: 100% 0;
            animation: epic-refresh-glint 1800ms cubic-bezier(0.3, 0.1, 0.2, 1) var(--glare-delay, 0ms) 1 both;
        }

        @media (prefers-reduced-motion: reduce) {
            .epic-header[data-glare]::after {
                background: rgba(232, 163, 61, 1);
                background-size: auto;
                animation: epic-refresh-tint 900ms ease-out 1 both;
            }
        }

        .epic-header .epic-refresh-button {
            position: absolute;
            top: 4px;
            right: 6px;
            z-index: 1;
            opacity: 0;
            pointer-events: none;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text-secondary);
            transition: opacity 0.12s ease;
        }

        .epic-header:hover .epic-refresh-button,
        .epic-header:focus-within .epic-refresh-button,
        .epic-header .epic-refresh-button[aria-busy="true"],
        .epic-header .epic-refresh-button[data-state="error"] {
            opacity: 1;
            pointer-events: auto;
        }

        .epic-header .epic-refresh-button[aria-disabled="true"] {
            cursor: progress;
        }

        .epic-header .epic-refresh-button[data-state="error"] {
            color: var(--accent);
            border-color: var(--accent);
        }

        .epic-header .epic-refresh-button svg {
            width: 14px;
            height: 14px;
        }

        @media (hover: none) {
            .epic-header .epic-refresh-button {
                opacity: 1;
                pointer-events: auto;
            }
        }

        @media (max-width: 760px) {
            .epic-header:has(> .epic-refresh-button) .epic-title-row {
                padding-right: 32px;
            }
        }
```

- [ ] **Step 8: `EpicRefreshButton`**

Create `frontend/src/ui/EpicRefreshButton.jsx` (copy the refresh `<svg>` markup from the header Refresh button into `RefreshGlyph`; do not invent a new icon):

```jsx
import * as React from 'react';
import IconButton from './IconButton.jsx';
import LoadingMark from './LoadingMark.jsx';

// The same two paths as the header Refresh button (dashboard.jsx, `refresh-icon`).
const RefreshGlyph = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

export default function EpicRefreshButton({
    epicKey,
    epicName,
    state = 'idle',
    onRefresh,
    errorLabel = 'Epic refresh failed. Try again.',
}) {
    const busy = state === 'busy';
    const name = epicName || epicKey;
    const label = busy ? `Refreshing ${name}` : state === 'error' ? errorLabel : `Refresh epic ${name}`;
    return (
        <IconButton
            size="sm"
            variant="secondary compact"
            className="epic-refresh-button"
            data-state={state}
            data-epic-refresh={epicKey}
            aria-label={label}
            title={label}
            aria-disabled={busy ? 'true' : undefined}
            aria-busy={busy ? 'true' : undefined}
            onClick={(event) => {
                event.stopPropagation();
                if (!busy) onRefresh?.(epicKey);
            }}
        >
            {busy ? <LoadingMark /> : <RefreshGlyph />}
        </IconButton>
    );
}
```
`RefreshGlyph` uses the same two paths as the header Refresh button; `focus-visible` styling comes from the existing header rule (the plan adds none).

- [ ] **Step 9: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_glare.js tests/test_eng_board_styles.js tests/test_epm_view_source_guards.js tests/test_dashboard_epic_icon_source_guards.js
```
Expected: pass (the header CSS regex guards and the EPM loader guard stay green; no duplicate of the epic icon SVG markup). Do not run `npm run build`.

- [ ] **Step 10: Render probe (scratch only, nothing committed)**

```bash
mkdir -p tmp/probe
# Run the same esbuild command as the `build` script in package.json with the output directory changed to tmp/probe.
```
Open a scratch HTML page that loads `tmp/probe/dashboard.css` and copy into it one `.epic-block` (header with the decorative `.epic-icon`, title row, `.epic-meta`, the `EpicRefreshButton` markup, two `.task-item` cards). With a Playwright script run by `fnm exec --using 20 node` from `tmp/`, assert: the button is 24x24, opacity 0 and `pointer-events:none` at rest, opacity 1 when the header is hovered; the header and title-row rects are identical shown and hidden; the glare ring is visible mid-animation after `document.getAnimations()` is paused at 900 ms (take a screenshot and look at it); under `reducedMotion: 'reduce'` both the card ring and the header sweep report `animationName` `epic-refresh-tint`; at 390 px the `.epic-title-row` padding applies only when the button is a direct child of the header; `.loading-mark-xs` measures 16x16. Delete `tmp/probe` afterwards. Never build into `frontend/dist` here.

- [ ] **Step 11: Report for commit**

Files: the files listed under this task's Files. Message: `Add refresh button, burst mark, glare styles and leaving dissolve`.

---

## Task 4: Analytics

**Files:**
- Modify: `frontend/src/analytics/events.js`, `frontend/src/analytics/analytics.js`, `frontend/src/analytics/dashboardAnalytics.js`, `frontend/src/api/engApi.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `docs/README_ANALYTICS.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`

**Interfaces:** Produces the Analytics block in Shared Interfaces.

**Read first:** `frontend/src/analytics/events.js` (`EVENT_NAMES`, `EVENT_PARAMS`, `validateAnalyticsPayload`), `analytics.js` `API_SURFACES`, `dashboardAnalytics.js` (`buildIssueFieldEditAnalyticsParams` and `trackIssueFieldEditAction`), the nearest existing tests in `tests/test_analytics_events.js` and the source-guard pattern in `tests/test_analytics_source_guards.js:108-143`, the `docs/README_ANALYTICS.md` taxonomy table, and the GA4 runbook and YAML entries for `issue_field_edit_action`.

- [ ] **Step 1: Failing tests**

Add to `tests/test_analytics_events.js`:

```js
test('epic_refresh_action validates and carries only allowlisted params', () => {
    const payload = {
        event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'epic_refresh_action',
        feature_name: 'epic_refresh', workflow_action: 'refresh_result', source_surface: 'catch_up',
        result: 'changed', issue_count_bucket: '1_5',
    };
    assert.doesNotThrow(() => validateAnalyticsPayload(payload));
    assert.throws(() => validateAnalyticsPayload({ ...payload, epic_key: 'EPIC-1' }), /unsupported analytics parameter/);
});

test('buildEpicRefreshAnalyticsParams buckets counts and never includes keys', async () => {
    const { buildEpicRefreshAnalyticsParams } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    assert.deepEqual(
        buildEpicRefreshAnalyticsParams({ result: 'changed', sourceSurface: 'planning', changedCount: 7 }),
        { feature_name: 'epic_refresh', workflow_action: 'refresh_result', source_surface: 'planning', result: 'changed', issue_count_bucket: '6_10' },
    );
    assert.equal(buildEpicRefreshAnalyticsParams({ result: 'unchanged', sourceSurface: 'catch_up', changedCount: 0 }).issue_count_bucket, '0');
});
```
(Match the import and `test` style used at the top of the file.) Add to `tests/test_analytics_source_guards.js` an assertion in the existing style that `engApi.js` passes `apiSurface: 'epic_refresh'` and that `API_SURFACES` contains `'epic_refresh'`.

```bash
fnm exec --using 20 node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js
```
Expected: FAIL.

- [ ] **Step 2: Implement**

- `events.js`: add `'epic_refresh_action'` to `EVENT_NAMES` (after `'issue_field_edit_action'`). No new params are needed (`feature_name`, `workflow_action`, `source_surface`, `result`, `issue_count_bucket` exist).
- `analytics.js`: add `'epic_refresh'` to `API_SURFACES` (after `'eng_tasks'`).
- `dashboardAnalytics.js`: export the builder and add the tracker next to `trackIssueFieldEditAction`, and include it in the hook's returned object:

```js
export function buildEpicRefreshAnalyticsParams({ result, sourceSurface, changedCount = 0 } = {}) {
    return {
        feature_name: 'epic_refresh',
        workflow_action: 'refresh_result',
        source_surface: sourceSurface,
        result,
        issue_count_bucket: bucketCount(changedCount),
    };
}
// inside the hook:
const trackEpicRefreshAction = useCallback((params = {}) => {
    trackProductEvent('epic_refresh_action', buildEpicRefreshAnalyticsParams(params));
}, [trackProductEvent]);
```
(Import `bucketCount` from wherever `dashboardAnalytics.js` already gets it.)
- `engApi.js`: extend `fetchEngTasks` with two optional arguments so the epic refresh reuses it instead of duplicating it (it already accepts `purpose`, `epicKeys` and `refresh`, drops an empty `epicKeys`, and sends `team=all`):

```js
export const fetchEngTasks = (backendUrl, { project, sprint, sprintName = '', groupId, teamIds = [], teamLabels = [], refresh = false, purpose = '', epicKeys = [], signal, debugTimings = false, apiSurface = 'eng_tasks', featureName = 'eng' } = {}) => {
    // ... existing body unchanged ...
    return trackedFetch(apiSurface, `${backendUrl}/api/tasks-with-team-name?${params.toString()}`, { /* existing options */ }, { featureName });
};

export const fetchEpicRefresh = (backendUrl, { project, sprint, sprintName = '', groupId, teamIds = [], teamLabels = [], epicKey, signal } = {}) => fetchEngTasks(backendUrl, {
    project, sprint, sprintName, groupId, teamIds, teamLabels, refresh: true, purpose: 'epic-refresh', epicKeys: [epicKey], signal,
    apiSurface: 'epic_refresh', featureName: 'epic_refresh',
});
```
Every existing caller is unchanged because both new arguments default to today's values.
- Docs: add the `epic_refresh_action` row to the `docs/README_ANALYTICS.md` taxonomy (trigger `userevent`, event_type `event`, feature `epic_refresh`, params, the decision it supports: whether manual refresh adoption and change rate justify revisiting the deferred automatic-update designs), a note that `api_surface=epic_refresh` keeps per-click requests out of the `eng_tasks` load series, and a matching entry in `docs/plans/SUPPORT-ga4-user-configuration.md` in the form of `issue_field_edit_action`. For `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`, read it first: it has no `issue_field_edit_action` entry, so add the `epic_refresh_action` entry in the form of the nearest existing event entry in that file, and skip the file only if it lists no events at all (then say so in the commit message). Do not register custom dimensions in bulk and do not add `has_*` params.

- [ ] **Step 3: Verify**

```bash
fnm exec --using 20 node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js tests/test_frontend_api_source_guards.js
```
Expected: pass.

- [ ] **Step 4: Report for commit**

Message: `Add epic_refresh_action analytics event and dedicated API surface`.

---

## Task 5: Loader, controller and hook

**Files:**
- Create: `frontend/src/eng/epicRefreshController.js`, `frontend/src/eng/useEpicRefresh.js`, `tests/test_epic_refresh_controller.js`, `tests/test_epic_refresh_source_guards.js`
- Modify: `frontend/src/eng/useEngSprintData.js`

**Interfaces:**
- Consumes: Task 2 (`mergeEpicStories`, `diffEpic`, `patchEpicScopeEntries`, `patchStoryCopies`), Task 3 (`epicRefreshGlare`, `REMOVE_FADE_MS`), Task 4 (`fetchEpicRefresh`).
- Produces: `createEpicRefreshController`, `useEpicRefresh(inputs)`, and `loadEpicRefresh` from `useEngSprintData`.

**Read first:** `frontend/src/eng/useEngSprintData.js` (`fetchTasks`, `loadAlertEpics`, `loadReadyToClose*`, `loadGroupTasks`, the return object, `ENG_TASK_LOAD_OUTCOME`, `buildTaskResponseError`), `frontend/src/eng/engIssueEditState.js` (`beginRead`, `finishRead`, `reconcileIssues`), `frontend/src/eng/engTaskUtils.js` (`sortTasksByPriority` sorts in place; `filterTasksForTeamSet` returns a fresh array), `frontend/src/api/http.js` (401 handling), `frontend/src/dashboardRuntime.js` (`isBackendConnectionFailure` matches `failed to fetch` in `err.message`).

- [ ] **Step 1: Write the failing controller tests**

Create `tests/test_epic_refresh_controller.js`. The controller takes injected dependencies, so every test uses fakes:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EPIC_REFRESH, EPIC_REFRESH_RESULT, createEpicRefreshController } from '../frontend/src/eng/epicRefreshController.js';

const story = (key, fields = {}) => ({ key, fields: { summary: key, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Story' }, epicKey: 'EPIC-1', customfield_10004: 1, updated: '1', ...fields } });
const okLane = (items, meta = {}) => ({ status: 'ok', items, meta: { epics: {}, capped: false, epicKeysMissing: [], ...meta } });

function harness(overrides = {}) {
    const state = { epoch: 1, version: 1, scopeKey: 'g|1', blocked: false };
    const held = {
        productTasks: [story('S-1')], techTasks: [], loadedProductTasks: [story('S-1')], loadedTechTasks: [],
        epicDetails: { 'EPIC-1': { key: 'EPIC-1', summary: 'E', status: 'In Progress', updated: '1' } },
        protectedKeys: new Set(), snapshotByKey: new Map(), userRemovedKeys: () => new Set(),
    };
    const calls = { states: [], applied: [], announced: [], tracked: [], order: [] };
    let clock = 1000;
    const controller = createEpicRefreshController({
        loadEpicRefresh: overrides.loadEpicRefresh || (async () => ({
            product: okLane([story('S-1', { status: { name: 'Done' } })]), tech: okLane([]),
        })),
        readGuards: () => ({ ...state }),
        readHeld: () => held,
        apply: overrides.apply || (async update => { calls.applied.push(update); calls.order.push('apply'); return { hiddenCount: 0 }; }),
        setEpicState: (key, value) => calls.states.push([key, value]),
        announce: outcome => { calls.announced.push(outcome); calls.order.push('announce'); },
        track: outcome => calls.tracked.push(outcome),
        now: () => clock,
        sleep: async ms => { clock += ms; },
    });
    return { controller, state, held, calls, tick: ms => { clock += ms; }, clockNow: () => clock };
}

test('blocked guard means no load and no state change', async () => {
    const h = harness();
    h.state.blocked = true;
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.BLOCKED);
    assert.equal(h.calls.states.length, 0);
});

test('a changed story is applied once, announced and tracked', async () => {
    const h = harness();
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.CHANGED);
    assert.equal(h.calls.applied.length, 1);
    assert.deepEqual(h.calls.applied[0].changedKeys, ['S-1']);
    assert.deepEqual(h.calls.applied[0].changedFieldsByKey['S-1'], ['status']);
    assert.ok(h.calls.applied[0].mergeInputs.length >= 2);
    assert.deepEqual(h.calls.states.map(s => s[1]), ['busy', 'idle']);
    assert.equal(h.calls.announced.length, 1);
    assert.equal(h.calls.tracked.length, 1);
});

test('apply is awaited before the outcome is announced', async () => {
    const h = harness({ apply: async () => { await new Promise(resolve => setTimeout(resolve, 5)); return { hiddenCount: 0 }; } });
    await h.controller.refresh('EPIC-1');
    assert.equal(h.calls.announced.length, 1);
});

test('an unchanged epic applies nothing and reports unchanged', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: okLane([story('S-1')]), tech: okLane([]) }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.UNCHANGED);
    assert.equal(h.calls.applied.length, 0);
});

test('the busy mark shows at least the minimum time even when the response is instant', async () => {
    const h = harness();
    const start = h.clockNow();
    await h.controller.refresh('EPIC-1');
    assert.ok(EPIC_REFRESH.MIN_BUSY_MS >= 400);
    assert.ok(h.clockNow() - start >= EPIC_REFRESH.MIN_BUSY_MS);
});

test('an epoch change while fetching discards the result silently', async () => {
    const h = harness();
    const pending = h.controller.refresh('EPIC-1');
    h.state.epoch += 1;
    const out = await pending;
    assert.equal(out.result, EPIC_REFRESH_RESULT.DISCARDED);
    assert.equal(h.calls.applied.length, 0);
    assert.equal(h.calls.announced.length, 0);
    assert.equal(h.calls.tracked.length, 0);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('a 401 lane discards the result and shows no error UI (the sign-in lock owns it)', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: { status: 'auth_required' }, tech: okLane([]) }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.DISCARDED);
    assert.equal(h.calls.announced.length, 0);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('all lanes ignored (strict Board active) is a discard, not "up to date"', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: { status: 'ignored' }, tech: { status: 'ignored' } }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.DISCARDED);
    assert.equal(h.calls.announced.length, 0);
});

test('a denied lane is left untouched and raises no error', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: okLane([story('S-1', { status: { name: 'Done' } })]), tech: { status: 'denied' } }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.CHANGED);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('a failed lane applies the good lane and leaves the epic in the error state', async () => {
    const h = harness({ loadEpicRefresh: async () => ({ product: okLane([story('S-1', { status: { name: 'Done' } })]), tech: { status: 'failed' } }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.FAILURE);
    assert.equal(out.partial, true);
    assert.equal(h.calls.applied.length, 1);
    assert.equal(h.calls.states.at(-1)[1], 'error');
});

test('rate-limited lanes and a thrown load are failures with nothing applied, and retry is not blocked', async () => {
    for (const load of [async () => ({ product: { status: 'rate_limited' }, tech: { status: 'rate_limited' } }), async () => { throw new Error('boom'); }]) {
        const h = harness({ loadEpicRefresh: load });
        const out = await h.controller.refresh('EPIC-1');
        assert.equal(out.result, EPIC_REFRESH_RESULT.FAILURE);
        assert.equal(h.calls.applied.length, 0);
        assert.equal(h.calls.states.at(-1)[1], 'error');
        assert.notEqual((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    }
});

test('a capped lane never removes cards; an uncapped lane does', async () => {
    const make = capped => harness({ loadEpicRefresh: async () => ({ product: okLane([], { capped }), tech: okLane([]) }) });
    const cappedOut = await make(true).controller.refresh('EPIC-1');
    assert.equal(cappedOut.removedKeys.length, 0);
    const openOut = await make(false).controller.refresh('EPIC-1');
    assert.deepEqual(openOut.removedKeys, ['S-1']);
});

test('an epic header edited since the click, or protected, is not overwritten by fetched data', async () => {
    const fetchedEpic = { key: 'EPIC-1', summary: 'E', status: 'Done', updated: '2' };
    const load = async () => ({ product: okLane([story('S-1')], { epics: { 'EPIC-1': fetchedEpic } }), tech: okLane([]) });
    const edited = harness({ loadEpicRefresh: load });
    const pending = edited.controller.refresh('EPIC-1');
    edited.held.epicDetails = { 'EPIC-1': { ...edited.held.epicDetails['EPIC-1'], status: 'Accepted' } };
    assert.equal((await pending).epicDetailsPatch, null);
    const protectedEpic = harness({ loadEpicRefresh: load });
    protectedEpic.held.protectedKeys = new Set(['EPIC-1']);
    assert.equal((await protectedEpic.controller.refresh('EPIC-1')).epicDetailsPatch, null);
    const plain = harness({ loadEpicRefresh: load });
    const out = await plain.controller.refresh('EPIC-1');
    assert.deepEqual(out.epicDetailsPatch, { 'EPIC-1': fetchedEpic });
    assert.equal(out.epicChanged, true);
});

test('second click while in flight and the third epic at two in flight are blocked; cooldown applies after success', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ loadEpicRefresh: async () => { await gate; return { product: okLane([story('S-1')]), tech: okLane([]) }; } });
    const first = h.controller.refresh('EPIC-1');
    assert.equal((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    const second = h.controller.refresh('EPIC-2');
    assert.equal((await h.controller.refresh('EPIC-3')).result, EPIC_REFRESH_RESULT.BLOCKED);
    release();
    await Promise.all([first, second]);
    assert.equal((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    h.tick(EPIC_REFRESH.COOLDOWN_MS + 1);
    assert.notEqual((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
});

test('the cooldown is per scope, so a sprint or group change does not inherit it', async () => {
    const h = harness();
    await h.controller.refresh('EPIC-1');
    h.state.scopeKey = 'g|2';
    assert.notEqual((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
});

test('hidden changes are reported when the apply callback says no changed card is visible', async () => {
    const h = harness({ apply: async () => ({ hiddenCount: 1 }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.HIDDEN);
});
```

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_controller.js
```
Expected: FAIL (module not found).

- [ ] **Step 2: Write the controller**

Create `frontend/src/eng/epicRefreshController.js`:

```js
import { diffEpic, mergeEpicStories } from './epicRefreshPatch.js';

export const EPIC_REFRESH = Object.freeze({ COOLDOWN_MS: 10000, MAX_IN_FLIGHT: 2, MIN_BUSY_MS: 400 });
export const EPIC_REFRESH_RESULT = Object.freeze({
    CHANGED: 'changed', UNCHANGED: 'unchanged', HIDDEN: 'hidden', FAILURE: 'failure', DISCARDED: 'discarded', BLOCKED: 'blocked',
});

const LANES = ['product', 'tech'];
const listNames = lane => ({ display: `${lane}Tasks`, loaded: `loaded${lane === 'product' ? 'Product' : 'Tech'}Tasks` });

export function createEpicRefreshController({
    loadEpicRefresh, readGuards, readHeld, apply, setEpicState, announce, track,
    now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
    const inFlight = new Set();
    const cooldownUntil = new Map();
    const sameScope = (a, b) => a.epoch === b.epoch && a.version === b.version && a.scopeKey === b.scopeKey;
    const cooldownKey = (guards, epicKey) => `${guards.scopeKey}|${epicKey}`;

    async function applyLanes(epicKey, lanes, click) {
        const statuses = LANES.map(lane => lanes?.[lane]?.status || 'failed');
        if (statuses.includes('auth_required') || statuses.every(status => status === 'ignored')) {
            return { result: EPIC_REFRESH_RESULT.DISCARDED };
        }
        const held = readHeld(epicKey);
        const update = {
            epicKey, changedKeys: [], silentKeys: [], addedKeys: [], removedKeys: [], changedFieldsByKey: {},
            fetchedStories: [], mergeInputs: [], epicDetailsPatch: null, epicChanged: false, epicSilent: false,
        };
        let failed = false;
        let okLanes = 0;
        let fetchedEpic;
        for (const lane of LANES) {
            const result = lanes?.[lane] || { status: 'failed' };
            if (result.status === 'denied' || result.status === 'ignored') continue;
            if (result.status !== 'ok') { failed = true; continue; }
            okLanes += 1;
            const meta = result.meta || {};
            fetchedEpic = fetchedEpic || meta.epics?.[epicKey];
            const common = {
                fetched: result.items || [], epicKey, laneApplied: true, capped: meta.capped === true,
                detailsMissing: (meta.epicKeysMissing || []).includes(epicKey), clickSnapshot: click.snapshot,
            };
            const names = listNames(lane);
            const display = mergeEpicStories({ ...common, held: held[names.display] || [], protectedKeys: held.protectedKeys, userRemovedKeys: held.userRemovedKeys(lane) });
            const loaded = mergeEpicStories({ ...common, held: held[names.loaded] || [], protectedKeys: held.protectedKeys, userRemovedKeys: new Set() });
            update.mergeInputs.push({ listName: names.display, lane, ...common }, { listName: names.loaded, lane, ...common });
            update.fetchedStories.push(...common.fetched);
            update.changedKeys.push(...display.changedKeys);
            update.silentKeys.push(...display.silentKeys, ...loaded.silentKeys.filter(key => !display.silentKeys.includes(key)));
            update.addedKeys.push(...display.addedKeys);
            update.removedKeys.push(...display.removedKeys);
            Object.assign(update.changedFieldsByKey, display.changedFieldsByKey);
        }
        const currentEpic = held.epicDetails?.[epicKey];
        const editedSinceClick = Boolean(click.epic) && diffEpic(click.epic, currentEpic).changedFields.length > 0;
        if (fetchedEpic && !editedSinceClick && !held.protectedKeys.has(epicKey)) {
            const epicDiff = diffEpic(currentEpic, fetchedEpic);
            if (!epicDiff.equal) {
                update.epicDetailsPatch = { [epicKey]: fetchedEpic };
                update.epicChanged = epicDiff.changedFields.length > 0;
                update.epicSilent = epicDiff.silent;
            }
        }
        const changedCount = new Set([...update.changedKeys, ...update.addedKeys, ...update.removedKeys]).size + (update.epicChanged ? 1 : 0);
        const dirty = changedCount > 0 || update.silentKeys.length > 0 || Boolean(update.epicDetailsPatch);
        let result = changedCount > 0 ? EPIC_REFRESH_RESULT.CHANGED : EPIC_REFRESH_RESULT.UNCHANGED;
        if (dirty) {
            const applied = (await apply(update)) || {};
            update.hiddenCount = applied.hiddenCount || 0;
            if (changedCount > 0 && update.hiddenCount >= changedCount) result = EPIC_REFRESH_RESULT.HIDDEN;
        }
        if (failed) result = EPIC_REFRESH_RESULT.FAILURE;
        return { result, partial: failed && okLanes > 0, changedCount, ...update };
    }

    async function refresh(epicKey) {
        const started = now();
        const clickGuards = readGuards(epicKey);
        const cdKey = cooldownKey(clickGuards, epicKey);
        if (inFlight.has(epicKey) || inFlight.size >= EPIC_REFRESH.MAX_IN_FLIGHT || (cooldownUntil.get(cdKey) || 0) > started) {
            return { result: EPIC_REFRESH_RESULT.BLOCKED };
        }
        if (clickGuards.blocked) return { result: EPIC_REFRESH_RESULT.BLOCKED, reason: clickGuards.reason };
        const heldAtClick = readHeld(epicKey);
        const click = { snapshot: heldAtClick.snapshotByKey, epic: heldAtClick.epicDetails?.[epicKey] };
        inFlight.add(epicKey);
        setEpicState(epicKey, 'busy');
        let outcome;
        try {
            const lanes = await loadEpicRefresh({ epicKey, shouldApplyResult: () => sameScope(readGuards(epicKey), clickGuards) });
            const remaining = Math.max(0, EPIC_REFRESH.MIN_BUSY_MS - (now() - started));
            if (remaining) await sleep(remaining);
            outcome = sameScope(readGuards(epicKey), clickGuards)
                ? await applyLanes(epicKey, lanes, click)
                : { result: EPIC_REFRESH_RESULT.DISCARDED };
        } catch (error) {
            outcome = { result: EPIC_REFRESH_RESULT.FAILURE };
        } finally {
            inFlight.delete(epicKey);
        }
        if (outcome.result !== EPIC_REFRESH_RESULT.FAILURE && outcome.result !== EPIC_REFRESH_RESULT.DISCARDED) {
            cooldownUntil.set(cdKey, now() + EPIC_REFRESH.COOLDOWN_MS);
        }
        setEpicState(epicKey, outcome.result === EPIC_REFRESH_RESULT.FAILURE ? 'error' : 'idle');
        if (outcome.result !== EPIC_REFRESH_RESULT.DISCARDED) {
            announce(outcome);
            track(outcome);
        }
        return outcome;
    }

    return { refresh };
}
```

- [ ] **Step 3: Run the controller tests**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_controller.js tests/test_epic_refresh_patch.js
```
Expected: pass. Fix the code, never a test.

- [ ] **Step 4: Add the loader to `useEngSprintData.js`**

1. Extend the outcomes: add `LANE_DENIED: 'lane_denied'` and `RATE_LIMITED: 'rate_limited'` to `ENG_TASK_LOAD_OUTCOME`, and `const EPIC_REFRESH_META = Symbol('epicRefreshMeta');` next to `ISSUE_EDIT_READ_TOKEN`. Import `fetchEpicRefresh` from `../api/engApi.js` with `fetchEngTasks`.
2. In `fetchTasks`, replace the `const requestTasks = () => fetchEngTasks(...)` definition so an epic refresh uses the wrapper and every other caller is unchanged:

```js
            const requestTasks = options.epicRefresh
                ? () => fetchEpicRefresh(backendUrl, {
                    project,
                    sprint: sprintParam,
                    sprintName: selectedSprintName || '',
                    groupId: activeGroupId,
                    teamIds: groupTeamIds,
                    teamLabels: groupTeamLabels,
                    epicKey: options.epicKeys[0],
                    signal: requestSignal,
                })
                : () => fetchEngTasks(backendUrl, { /* the existing argument object, unchanged */ });
```
3. Just before `tokenRetained = true;` attach the meta, using the existing `reconciledEpicEntries` array (do not recompute it; `filteredEpics` is not used for this because it drops epics that have no stories):

```js
            if (options.epicRefresh) {
                Object.defineProperty(filteredTasks, EPIC_REFRESH_META, {
                    value: {
                        epics: Object.fromEntries(reconciledEpicEntries.map(epic => [epic.key, epic])),
                        capped: data.capped === true,
                        epicKeysMissing: Array.isArray(data.epicKeysMissing) ? data.epicKeysMissing : [],
                    },
                });
            }
```
4. In the `catch` block, before `const handledServerConnection`, add the two early returns, and gate the connection handler so an HTTP response never raises the global outage banner (a 500 body whose `error` text contains "Failed to fetch" would otherwise match `isBackendConnectionFailure`):

```js
            if (options.epicRefresh && err.code === 'missing_project_access') return ENG_TASK_LOAD_OUTCOME.LANE_DENIED;
            if (options.epicRefresh && err.code === 'epic_refresh_rate_limited') return ENG_TASK_LOAD_OUTCOME.RATE_LIMITED;
            const handledServerConnection = !(options.epicRefresh && err.status) && onServerConnectionFailure?.(err) === true;
```
5. Add the loader **after** `loadGroupTasks` (the existing source guards slice the file by symbol; keep new loaders out of the `loadReadyToClose*` neighbourhood):

```js
    // Per-epic refresh (issue #213): both lanes, no loading flag, results handed back for one atomic apply.
    const loadEpicRefresh = async ({ epicKey, shouldApplyResult, signal } = {}) => {
        if (strictBoardActive) return { product: { status: 'ignored' }, tech: { status: 'ignored' } };
        const fetchLane = async project => {
            const data = await fetchTasks(project, {
                epicRefresh: true,
                epicKeys: [epicKey],
                updateEpics: false,
                useLoading: false,
                setErrorOnFailure: false,
                forceRefresh: true,
                shouldApplyResult,
                signal,
            });
            const readToken = data?.[ISSUE_EDIT_READ_TOKEN];
            try {
                if (Array.isArray(data)) return { status: 'ok', items: data, meta: data[EPIC_REFRESH_META] };
                if (data === ENG_TASK_LOAD_OUTCOME.LANE_DENIED) return { status: 'denied' };
                if (data === ENG_TASK_LOAD_OUTCOME.RATE_LIMITED) return { status: 'rate_limited' };
                if (data === ENG_TASK_LOAD_OUTCOME.AUTH_REQUIRED) return { status: 'auth_required' };
                if (data === ENG_TASK_LOAD_OUTCOME.IGNORED) return { status: 'ignored' };
                return { status: 'failed' };
            } finally {
                issueEditState?.finishRead(readToken);
            }
        };
        const [product, tech] = await Promise.all([fetchLane('product'), fetchLane('tech')]);
        return { product, tech };
    };
```
6. Add `loadEpicRefresh` to the hook's return object.

- [ ] **Step 5: The hook**

Create `frontend/src/eng/useEpicRefresh.js` (keep it under about 220 lines; every decision lives in the tested controller). Contract:

```js
useEpicRefresh({
    loadEpicRefresh,          // from useEngSprintData
    getState,                 // () => { productTasks, techTasks, loadedProductTasks, loadedTechTasks, epicDetails,
                              //         readyToCloseProductTasks, readyToCloseTechTasks, productEpicsInScope, techEpicsInScope,
                              //         readyToCloseProductEpicsInScope, readyToCloseTechEpicsInScope }
    setters,                  // { setProductTasks, setTechTasks, setLoadedProductTasks, setLoadedTechTasks, setEpicDetails,
                              //   setReadyToCloseProductTasks, setReadyToCloseTechTasks, setProductEpicsInScope, setTechEpicsInScope,
                              //   setReadyToCloseProductEpicsInScope, setReadyToCloseTechEpicsInScope }
    readGuards,               // (epicKey) => { blocked, reason, epoch, version, scopeKey }
    getProtectedKeys,         // (epicKey) => Set<string>: pending, active-editor and active-menu keys (stories and the epic)
    getRecentEditKeys,        // () => Set<string>: keys the user edited in the last 10 s
    getViewport,              // () => { top, bottom } below the sticky stack
    priorityOrder,            // PRIORITY_ORDER, for the re-sort
    clearAggregateSources,    // () => void
    afterApply,               // (update) => void: Task 6b and alert slices hang here
    getAlertVersion,          // () => number (catchUpAlertVersionRef.current)
    track,                    // (params) => void
    sourceSurface,            // 'catch_up' | 'planning'
}) -> { epicStates, leavingKeys, announcement, announcementId, refreshEpic }
```
- Every input is read through a `latest` ref updated on each render; the controller is created once and every dependency it receives is a wrapper that calls `latest.current.<input>(...)` (the controller is built once while `loadEpicRefresh`, `readGuards` and the rest are recreated each render and close over the sprint and group).
- `readHeld(epicKey)`: the `getState()` lists and `epicDetails`; `protectedKeys: getProtectedKeys(epicKey)` plus the current `leavingKeys`; `snapshotByKey`: a Map of this epic's held story items by key from the display lists; `userRemovedKeys(lane)`: keys present in `loaded<Lane>Tasks` and absent from `<lane>Tasks`.
- `apply(update)` is async and does, in order:
  1. Capture the epic header's `getBoundingClientRect().top` (`[data-epic-key="<key>"] .epic-header`) and whether the refresh button has focus.
  2. Inside `flushSync` (from `react-dom`; no `startTransition`), apply every `update.mergeInputs` entry with **functional updaters**: `setX(prev => mergeEpicStories({ ...input, held: prev, protectedKeys: currentProtected(), userRemovedKeys: input.listName.startsWith('loaded') ? new Set() : currentUserRemoved(input.lane) }).items)`, so two epics finishing in the same tick do not overwrite each other. Write the merged arrays back into the `latest` state immediately as well. For display lists, re-insert the removed items so they stay rendered while they dissolve, and re-sort with `sortTasksByPriority([...items], priorityOrder)` (it sorts in place, so pass a copy); `loaded*` lists drop removed items immediately. Merge `update.epicDetailsPatch` into `epicDetails` as whole objects, patch the epic-shaped copies with `patchEpicScopeEntries` (`productEpicsInScope`, `techEpicsInScope`, both `readyToClose*EpicsInScope`; their status is `{name}`), and the story-shaped copies with `patchStoryCopies` (`readyToCloseProductTasks`, `readyToCloseTechTasks`).
  3. Add `update.removedKeys` to `leavingKeys`; after `REMOVE_FADE_MS` (import it from `IssueCard.jsx`) run `setX(prev => prev.filter(t => !removed.has(t.key)))` on the display lists and clear the keys; clear the timer on unmount.
  4. Call `clearAggregateSources()`.
  5. `await` two animation frames.
  6. Anchor: if the header still exists, `window.scrollBy(0, newTop - oldTop)` when the delta exceeds 1 px.
  7. Glare: look up `[data-issue-key="<key>"]` for each changed or added key; build `rects`; skip elements with the `is-dimmed` class and keys in `getRecentEditKeys()`; `selectGlareKeys(...)`, then `playGlare(element, glareDelayMs(rect.top, viewport.top))`; play the header glare (`playGlare(header)`) when `update.epicChanged`.
  8. `hiddenCount`: the number of changed or added keys with no `[data-issue-key]` node after the frames.
  9. If the header is gone and the refresh button had focus, focus the nearest remaining `.epic-header` (next epic block, else previous).
  10. Call `afterApply(update)`; return `{ hiddenCount }`.
- `announce(outcome)`: set `announcement` to fixed text and a new numeric `announcementId` each time so the status region re-inserts its node (identical consecutive messages are otherwise not re-announced): `changed` gives `"1 story updated"` or `"N stories updated"` (use `"Epic updated"` when only the epic header changed), `unchanged` gives `"Epic is up to date"`, `hidden` gives `"N changes hidden by filters"`, `failure` gives `"Epic refresh failed"`.
- `track(outcome)`: `trackEpicRefreshAction({ result: outcome.result === 'hidden' ? 'changed' : outcome.result, sourceSurface, changedCount: outcome.changedCount || 0 })` (passed in as `track`).

- [ ] **Step 6: Source guard test**

Create `tests/test_epic_refresh_source_guards.js` in the style of `tests/test_dashboard_alert_source_guards.js` (read it first) asserting, by reading source text:
- `frontend/src/eng/useEpicRefresh.js`, `epicRefreshController.js` and `epicRefreshPatch.js` contain none of `rearmCatchUpAlerts`, `loadGroupTasks`, `applyLocalEngIssueField`, `localStorage`, `setLoading(`, `setProductTasksLoading`, `setTechTasksLoading`, `startTransition`;
- `useEngSprintData.js` `loadEpicRefresh` passes `useLoading: false`, `forceRefresh: true` and `epicRefresh: true`, and is defined after `loadGroupTasks`;
- `frontend/src/api/engApi.js` contains `purpose: 'epic-refresh'` and `'epic_refresh'`;
- no file outside `frontend/src/api/` contains the literal `/api/tasks-with-team-name`;
- no `frontend/src/epm/` file or `EpmRollupPanel.jsx` contains `data-glare` or `epicRefresh`.

- [ ] **Step 7: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_controller.js tests/test_epic_refresh_patch.js tests/test_epic_refresh_source_guards.js tests/test_frontend_api_source_guards.js tests/test_dashboard_alert_source_guards.js
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -8
git status --short frontend/dist
```
Expected: pass, no change to other suites, dist clean.

- [ ] **Step 8: Report for commit**

Files: `frontend/src/eng/epicRefreshController.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/eng/useEngSprintData.js`, `tests/test_epic_refresh_controller.js`, `tests/test_epic_refresh_source_guards.js`. Message: `Add per-epic refresh loader, controller and hook`.

---

## Task 6a: Dashboard wiring — mount the button and the hook

**Files:**
- Modify: `frontend/src/dashboard.jsx`, `frontend/src/styles/eng/epics.css` (`.epic-refresh-status` only), `tests/test_epic_refresh_source_guards.js`

**Interfaces:** Consumes Tasks 3, 4 and 5. Produces the mounted feature for Catch Up only (Planning is Task 13) and `alertCohortRef` (wired in Task 6b).

**Read first:** `dashboard.jsx` — the analytics destructure (~1214, where `trackIssueFieldEditAction` comes from), the `useEngSprintData(` destructure (~7155-7200), `loadMeasuredGroupTasks` (~7215), `useStorySubtasks` call (~7230), `applyLocalEngIssueField` (~12557), `epicStickyTop` (~12138), `manualRefreshDisabled` and the `longAbsenceRefreshRef` effect (~14912-14935), `renderEpicBlock` (~14461-14715: the `.epic-header` closes right after the `.epic-meta` block), the `IssueCard` render site (~14725-14745), `epicInteractionActive` (~14485). Declaration order matters: `statusTransitionSourceSurface`, `issueFieldEdits`, the `pending*IssueKeys` sets, the three `*ActiveKey`s, `visibleTasks`, `epicStickyTop`, `removeTask` and `manualRefreshDisabled` are all declared **after** the `useStorySubtasks` call, so the hook call goes **after the `longAbsenceRefreshRef` effect** (there is no early return before the final `return (`, and `renderEpicBlock` only runs inside the JSX). `frontend/src/styles/eng/status-transitions.css:385` shows the existing visually-hidden clip pattern.

- [ ] **Step 1: Failing source-guard assertions**

Extend `tests/test_epic_refresh_source_guards.js` with assertions that `dashboard.jsx` contains `useEpicRefresh(`, `EpicRefreshButton`, `isLeaving={`, `loadEpochRef`, `alertCohortRef`, `data-epic-refresh-status`, and that the count of `rearmCatchUpAlerts();` call sites and `onAlertDataInvalidated: rearmCatchUpAlerts` are unchanged (copy the exact patterns from `tests/test_dashboard_alert_source_guards.js:144-145`). Run:

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_source_guards.js
```
Expected: FAIL.

- [ ] **Step 2: Refs and destructures**

- Add `const loadEpochRef = useRef(0);`, `const alertCohortRef = useRef(null);` and `const recentEditKeysRef = useRef(new Map());` next to `catchUpAlertVersionRef`. As the first statement of `loadMeasuredGroupTasks` add `loadEpochRef.current += 1;` (this also covers `refreshLegacyBoardTasks` and the long-absence refresh through `refreshActiveViewFromJira`).
- In `applyLocalEngIssueField` add one line at the top, `recentEditKeysRef.current.set(issueKey, Date.now());`, so the user's own edits never glint (no behavior change otherwise).
- Add `trackEpicRefreshAction` to the analytics destructure (~1214) and `loadEpicRefresh` to the `useEngSprintData` destructure.

- [ ] **Step 3: The hook call (after the `longAbsenceRefreshRef` effect)**

```jsx
const epicInteractionActiveFor = (epicKey) => statusTransitionActiveKey === epicKey
    || priorityTransitionActiveKey === epicKey
    || projectTrackTransitionActiveKey === epicKey
    || issueFieldEdits.activeEditor?.issueKey === epicKey;
const epicRefresh = useEpicRefresh({
    loadEpicRefresh,
    getState: () => ({
        productTasks, techTasks, loadedProductTasks, loadedTechTasks, epicDetails,
        readyToCloseProductTasks, readyToCloseTechTasks, productEpicsInScope, techEpicsInScope,
        readyToCloseProductEpicsInScope, readyToCloseTechEpicsInScope,
    }),
    setters: {
        setProductTasks, setTechTasks, setLoadedProductTasks, setLoadedTechTasks, setEpicDetails,
        setReadyToCloseProductTasks, setReadyToCloseTechTasks, setProductEpicsInScope, setTechEpicsInScope,
        setReadyToCloseProductEpicsInScope, setReadyToCloseTechEpicsInScope,
    },
    readGuards: (epicKey) => ({
        blocked: loading || productTasksLoading || techTasksLoading || manualRefreshDisabled || !tasksFetched
            || String(lastLoadedSprintRef.current ?? '') !== String(selectedSprint ?? '')
            || alertCohortRef.current !== null || boardScopeRequested || !isCatchUpMode
            || epicInteractionActiveFor(epicKey),
        reason: '',
        epoch: loadEpochRef.current,
        version: groupLoadVersionRef.current,
        scopeKey: `${activeGroupId}|${selectedSprint}`,
    }),
    getProtectedKeys: () => new Set([
        ...pendingStatusIssueKeys, ...pendingPriorityIssueKeys, ...pendingProjectTrackIssueKeys,
        ...issueFieldEdits.pendingIssueKeys, statusTransitionActiveKey, priorityTransitionActiveKey,
        projectTrackTransitionActiveKey, issueFieldEdits.activeEditor?.issueKey,
    ].filter(Boolean)),
    getRecentEditKeys: () => new Set([...recentEditKeysRef.current].filter(([, at]) => Date.now() - at < 10000).map(([key]) => key)),
    getViewport: () => ({ top: epicStickyTop + (document.querySelector('.epic-block .epic-header')?.offsetHeight || 0), bottom: window.innerHeight }),
    priorityOrder,
    clearAggregateSources: () => {},   // Task 6b
    afterApply: () => {},              // Task 6b and the alert slices
    getAlertVersion: () => catchUpAlertVersionRef.current,
    track: trackEpicRefreshAction,
    sourceSurface: isCatchUpMode ? 'catch_up' : 'planning',
});
```
Every value above exists by this point in the component (verify each with `rg`; if a name differs, use the real one). `renderEpicBlock` reads `epicRefresh` inside the JSX, which runs after this declaration.

- [ ] **Step 4: Mount the button, `isLeaving` and the status region**

As the **last child of `<div className="epic-header">`** (after the `.epic-meta` block closes) add:

```jsx
{isCatchUpMode && epicGroup.key !== 'NO_EPIC' && (
    <EpicRefreshButton
        epicKey={epicGroup.key}
        epicName={epicTitle}
        state={epicRefresh.epicStates[epicGroup.key] || 'idle'}
        onRefresh={epicRefresh.refreshEpic}
    />
)}
```
Import `EpicRefreshButton` and `useEpicRefresh` at the top of `dashboard.jsx`. At the `IssueCard` render site add `isLeaving={epicRefresh.leavingKeys.has(task.key)}`. Render the status region once inside the ENG view wrapper near the alerts panel:

```jsx
<div className="epic-refresh-status" role="status" data-epic-refresh-status key={epicRefresh.announcementId}>{epicRefresh.announcement}</div>
```
(the changing `key` re-inserts the node so identical consecutive messages are re-announced; do not add `aria-live="polite"`, `tests/ui/onboarding_tour.spec.js` asserts exactly one; other `role="status"` elements exist in Catch Up, so tests select `[data-epic-refresh-status]`). Append to `frontend/src/styles/eng/epics.css`:

```css
        .epic-refresh-status {
            position: absolute;
            width: 1px;
            height: 1px;
            margin: -1px;
            padding: 0;
            border: 0;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
        }
```

- [ ] **Step 5: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_source_guards.js tests/test_dashboard_alert_source_guards.js tests/test_eng_board_styles.js
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -8
git status --short frontend/dist
wc -l frontend/src/dashboard.jsx
```
Expected: pass (30 test files read `dashboard.jsx`; fix the code, never a guard, unless a guard pins a count this task legitimately changes). Report the new `dashboard.jsx` line count; the orchestrator ratchets the budget with an itemized comment (hook call, refs, guards, mount, `isLeaving`, status region, recent-edit record). `tests/ui/load_performance.spec.js:221` does a page-wide `getByRole('status')`: run it in Task 7 and note any change.

- [ ] **Step 6: Report for commit**

Files: `frontend/src/dashboard.jsx`, `frontend/src/styles/eng/epics.css`, `tests/test_epic_refresh_source_guards.js`, plus `tests/test_codebase_structure_budgets.py` (orchestrator). Message: `Mount per-epic refresh in Catch Up`.

---

## Task 6b: Dependency, subtask and alert-cohort guards

**Files:**
- Modify: `frontend/src/dashboard.jsx`, `frontend/src/issues/useStorySubtasks.js`, `frontend/src/api/engApi.js`, `frontend/src/eng/useEpicRefresh.js` (only to call `afterApply`), `tests/test_story_subtasks.js`, `tests/test_epic_refresh_source_guards.js`

**Interfaces:** Consumes Tasks 5 and 6a. Produces the guarantee that an epic refresh issues no department-wide request.

**Read first:** `dashboard.jsx` — the alert effect (~7802-7857: five independent promises; the guard regexes at `tests/test_dashboard_alert_source_guards.js:154-157` require statements shaped `fetchMissingPlanningInfo(…);`, so keep `const x = call({...});` for each call), the dependencies effect and `dependencyKeySignature` (~12194-12227; the guard at `tests/test_dashboard_alert_source_guards.js:17-47` slices the effect body from `if (!showDependencies && !showBlockedAlert) {` to the first `}, [` and runs it with `new Function`: **nothing new may be referenced inside that slice**, and the stale-branch text pinned at ~597 must not change), `fetchDependencies` (~7235-7260: `registerSprintFetch`, `issueEditStateRef.beginRead({ aggregate: true })`, generation checks, `setDependencyRefreshNonce`), `invalidateEngIssueFieldSources` (~12553-12559: the cache refs plus the three nulling setters), `frontend/src/issues/useStorySubtasks.js` (whole file), `tests/test_story_subtasks.js`.

- [ ] **Step 1: Failing tests**

- In `tests/test_story_subtasks.js` (follow its existing style) add tests for a new `invalidateStorySubtasks(keys)`: it drops cached entries for those keys, reloads the ones whose panel is `expanded`, leaves other keys untouched, and is a no-op for unknown keys.
- In `tests/test_epic_refresh_source_guards.js` assert that `dashboard.jsx` contains `dependencySkipRef`, `refreshEpicDependencies`, `Promise.allSettled` for the alert cohort, and that the dependencies-effect slice used by `tests/test_dashboard_alert_source_guards.js` is byte-identical to the committed one.

```bash
fnm exec --using 20 node --test tests/test_story_subtasks.js tests/test_epic_refresh_source_guards.js
```
Expected: FAIL.

- [ ] **Step 2: One-shot dependency skip (not an effect change)**

Do **not** change the dependencies effect body. Add a one-shot skip inside `fetchDependencies` so a refresh that adds or removes a story does not trigger the department-wide POST, while every legitimate refetch (global Refresh, Story Points edit with `setDependencyData({})`, re-enabling dependencies) still runs:

```jsx
const dependencySkipRef = useRef(null);
// inside fetchDependencies(keys), right after the empty-keys guard:
if (dependencySkipRef.current === keys.join('|')) { dependencySkipRef.current = null; return ENG_TASK_LOAD_OUTCOME.APPLIED; }
// markDependencySignature(next): arm the skip only when dependencies are shown and the signature really changes
const markDependencySignature = (next) => {
    if ((showDependencies || showBlockedAlert) && next !== dependencyKeySignature) dependencySkipRef.current = next;
};
// after the dependencies effect, disarm on any signature change:
useEffect(() => { dependencySkipRef.current = null; }, [dependencyKeySignature]);
```
(Make sure `next` is built exactly as `dependencyKeySignature` is built: the sorted key string of `loadedProductTasks` plus `loadedTechTasks` after the merge. Compute it in `afterApply` from the merged `loaded*` lists.)

Add a **separate** `refreshEpicDependencies(keys)` for the epic's own stories: it runs only when `showDependencies || showBlockedAlert`, calls the existing dependencies request through `engApi.js` with a JSON body `{ keys, refresh: true }` (add the `refresh` body field to the client function; the server side lands in Task 10 and ignores an unknown field until then), merges the result into `dependencyData` **per key** (replace only those keys; keep the old entries on any non-2xx or thrown response), drops silently when the aggregate read is stale (use the same `issueEditStateRef` generation check `fetchDependencies` uses), and never calls `setDependencyRefreshNonce` (that triggers the department-wide refetch).

- [ ] **Step 3: Alert cohort ref**

In the alert effect keep each call as its own `const x = call({...});` statement and add the token pattern so a cancelled cohort's late settle cannot clear a newer cohort's flag:

```jsx
const cohortToken = {};
alertCohortRef.current = cohortToken;
Promise.allSettled([alertEpicsLoad, missingInfoLoad, readyToCloseProductLoad, readyToCloseTechLoad, backlogLoad])
    .finally(() => { if (alertCohortRef.current === cohortToken) alertCohortRef.current = null; });
// in the effect cleanup: if (alertCohortRef.current === cohortToken) alertCohortRef.current = null;
```
(use the real variable names the effect already declares; do not change what the effect loads or when.)

- [ ] **Step 4: Subtask invalidation**

Add `invalidateStorySubtasks(keys)` to `frontend/src/issues/useStorySubtasks.js` (drop the cached summary for those keys; reload open panels through the existing loader) and include it in the hook's return value; destructure it in `dashboard.jsx`.

- [ ] **Step 5: Wire `afterApply` and `clearAggregateSources`**

In the `useEpicRefresh` call (Task 6a) set:
- `clearAggregateSources`: the same cache clears `invalidateEngIssueFieldSources` performs at ~12553-12559: the three cache refs plus `setBurnoutData(null)`, `setCohortData(null)`, `setExcludedCapacityData(null)`; **no** nonce bumps (those effects are gated on `showStats`) and no `rearmCatchUpAlerts`.
- `afterApply(update)`: compute the next dependency signature from the merged `loaded*` lists and call `markDependencySignature(next)`; call `refreshEpicDependencies(keysOfThisEpic)` with the epic's current story keys; call `invalidateStorySubtasks([...update.changedKeys, ...update.addedKeys, ...update.silentKeys])`.

- [ ] **Step 6: Verify**

```bash
fnm exec --using 20 node --test tests/test_story_subtasks.js tests/test_epic_refresh_source_guards.js tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -8
git status --short frontend/dist
wc -l frontend/src/dashboard.jsx
```
Expected: pass, dist clean. Report the new `dashboard.jsx` line count for the orchestrator's ratchet.

- [ ] **Step 7: Report for commit**

Files: the six listed. Message: `Guard dependency, subtask and alert-cohort effects for epic refresh`.

---

## Task 7: Playwright spec for the core refresh

**Files:** Create `tests/ui/eng_epic_refresh.spec.js`.

**Read first:** `tests/ui/eng_group_board_card.spec.js:163-238` (route fixture), `tests/ui/epm_home_token_fixture.js` (`installDashboardShell`; the shell reads `frontend/dist/*` at require time, so a current build is required), `tests/ui/eng_alert_loading_order.spec.js:77-124` (`calls[]` and `deferred()` gating), `tests/ui/eng_dependency_chip_visual.spec.js:563-590` (`is-removing` assertions), `tests/ui/eng_sticky_stack_helpers.js`, `tests/ui/load_performance.spec.js:221` (page-wide `getByRole('status')`). Existing board specs force `reducedMotion: 'reduce'`; this spec must set `reducedMotion: 'no-preference'` explicitly for the glare tests.

- [ ] **Step 1: Fixture**

Define `mockDashboard(page, { scenario })` with `page.route('**/api/**', ...)` that records `calls[]` (`{ method, pathname, search, body }`) and serves: `/api/tasks-with-team-name` by `purpose`, `project` and `epicKeys` (full scope for initial loads, the epic's stories plus `epics` for `purpose=epic-refresh`), `/api/eng/story-readiness` (`{ schemaVersion: 1, complete: true, scope: {}, epics: [] }`), `/api/dependencies`, `/api/issues/subtasks`, `/api/auth/*`, `/api/config`, `/api/sprints` and the other stubs the model spec uses, with `respond(pattern, handler)` so a test overrides one route. The scenario has **three** epics (`EPIC-1` with three stories, `EPIC-2` with two, `EPIC-3` with one), **every epic has an assignee** (the long one reaches the header's right edge), one initiative-grouped epic, and at least 12 stories in `EPIC-1` for the cap test. Use a viewport of at least 1300x1000 for the cap-8 test (a card is about 74 px tall).

- [ ] **Step 2: Tests (normal clicks; hover the header first, because the button is `pointer-events:none` at rest)**

1. hidden at rest (opacity 0, `pointer-events:none`); hovering the header and tabbing into it make it visible and clickable.
2. visible under touch: `test.use({ hasTouch: true })` (CDP `Emulation.setEmulatedMedia` does **not** change `hover`; `hasTouch: true` makes `(hover: none)` true) and assert opacity 1 and `pointer-events:auto`.
3. header geometry identical with the button shown and hidden: for a direct epic, an initiative-grouped epic, at 1280, 1024 and 390 px, compare `getBoundingClientRect()` of `.epic-title-row > *` and `.epic-meta > *` exactly (move the mouse away first), `scrollWidth - clientWidth <= 1`, and the button rect lies inside the header rect. At 390 px the EPM-shaped headers are untouched (scoped padding rule).
4. assignee, Story Points and status stay clickable: `document.elementFromPoint` at the centre of each returns that target or a descendant; also record whether the button rect intersects each target's painted text rect (this is the user-accepted overlay; assert the centres, report the intersection).
5. an open status menu layers above the button.
6. a click sends one request per lane with `purpose=epic-refresh&epicKeys=EPIC-1&refresh=true`, and `.loading-state` never renders; every call after the click carries `epicKeys=EPIC-1` or is on the allowlist (`POST /api/dependencies` with only that epic's keys, subtask reloads for that epic's open panels).
7. the burst shows for at least 400 ms: install `page.clock` before navigation, `pauseAt` after load and before the click, fast-forward 300 ms and assert `.epic-refresh-button .loading-mark-xs` and `aria-busy="true"`, then the rest and assert the glyph is back.
8. a changed story is replaced in place: the same DOM node (tag it with a counter before the click), unchanged scroll position, applied filters kept, the clicked header's top unchanged.
9. glare on changed, mounted, in-viewport cards only, capped at 8 (12 changed cards): exactly 8 have `data-glare` shortly after apply; freeze with `document.getAnimations().forEach(a => { a.pause(); a.currentTime = 900; })` and screenshot the frame (never `animations:'disabled'`, which jumps to the end and hides the glare).
10. reduced motion: `page.emulateMedia({ reducedMotion: 'reduce' })`; the card ring's computed `animationName` is `epic-refresh-tint`, and so is the header sweep's.
11. the no-change case shows no glare, no layout change, and the announcement "Epic is up to date".
12. a card that leaves is still rendered with `is-removing` and animation `task-remove-dissolve` 0.24 s, then disappears; a card that enters fades in (`task-appear`) then glints.
13. a user-removed card (click its ×) stays removed after a refresh.
14. a global Refresh during a per-epic refresh discards the epic result (gate the epic response with `deferred()`).
15. an edit confirmed during the fetch is kept (status change confirmed on a story of that epic while the stale response is pending), and likewise the epic's own status edit.
16. two epics at once issue two requests per lane; a third click issues **no** request; a second click on the same epic within 10 s issues no request.
17. a 401 uses the existing sign-in lock and no extra error UI; a 429 shows the fixed label with no global banner and no automatic retry; an HTTP 500 shows the error state and no global banner; a denied product lane (403) applies the tech lane silently; one failed lane shows the error state and still applies the other.
18. the announcement region (`[data-epic-refresh-status]`) says "1 story updated", "Epic is up to date" and "N changes hidden by filters" in the matching cases, and repeats identical messages.
19. changes hidden by the default Killed filter announce and do not glint.
20. an alert cohort in flight (gate the alerts request with `deferred()`): the click issues **no** request and the button shows no busy state.
21. a story that moved into the epic from another epic appears once (no duplicate), and a story that moved out disappears from this epic only.
22. a story removed from a capped (250) lane is **not** removed; removal happens for an uncapped lane.
23. a focus move: when the epic's last story leaves and its block unmounts while the button had focus, focus lands on the nearest remaining epic header.
24. viewport anchor: a priority change that re-orders the epics leaves the clicked header at the same viewport offset.
25. `IssueCard` in EPM never gets `data-glare` (open the EPM view fixture, trigger nothing, assert the attribute is absent and the button is absent).
26. `tests/ui/load_performance.spec.js` still passes (the new `role="status"` element does not break its page-wide query).

- [ ] **Step 3: Build, run the spec and the neighbours, restore dist**

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js --workers=1 --reporter=line
for s in eng_group_board_card eng_status_transitions eng_priority_transitions eng_issue_field_edits eng_story_subtasks eng_dependency_chip_visual load_performance; do echo "== $s"; fnm exec --using 20 npx playwright test tests/ui/$s.spec.js --workers=1 --reporter=line 2>&1 | tail -4; done
git checkout -- frontend/dist
git status --short frontend/dist
```
Expected: the new spec passes; the neighbours show only the baseline failures recorded in Task 0 (`eng_priority_transitions` has one known failure from #210).

- [ ] **Step 4: Report for commit**

Files: `tests/ui/eng_epic_refresh.spec.js`. Message: `Add Playwright coverage for per-epic refresh`.

---

## Task 8: Alerts A — client-derived alerts follow the refresh

**Files:**
- Create: `frontend/src/eng/epicRefreshAlerts.js`, `tests/test_epic_refresh_alerts.js`
- Modify: `frontend/src/eng/useEpicRefresh.js` (`afterApply` hook-in), `frontend/src/dashboard.jsx` (minimal wiring), `frontend/src/eng/engWorkHierarchy.js` (ghost rows), `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `dashboard.jsx` Missing Info derivation (`hasStoryPoints` ~13243, `consolidatedMissingStories` ~13290-13330, which prefers the server entry's task, and the union with `/api/missing-info`), `backend/routes/eng_routes.py` missing-info predicate (~1404-1470: the endpoint excludes `Killed`, `Done`, `Postponed`, and emits the `missingFields` names `'Sprint'`, `'Story Points'` (sp must be greater than 0) and `'Team'`; it never emits `'Assignee'`), `frontend/src/eng/engWorkHierarchy.js` ghost rows (~237-283, rendered in **both** Catch Up and Planning), `backend/services/story_readiness.py` actionable rule (~10-12 and ~166), `docs/features/alerts.md`.

- [ ] **Step 1: Failing tests**

Create `tests/test_epic_refresh_alerts.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { recomputeMissingPlanningInfo, shouldHideReadinessGhost } from '../frontend/src/eng/epicRefreshAlerts.js';

const story = (key, fields = {}) => ({ key, fields: { summary: key, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Story' }, epicKey: 'EPIC-1', teamId: 't1', customfield_10004: 3, customfield_10101: [{ id: 7 }], updated: '1', ...fields } });
const entry = (key, missingFields, fields = {}) => ({ key, fields: { ...story(key).fields, missingFields, ...fields } });

test('Story Points from empty to a value removes the entry when nothing else is missing', () => {
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null })];
    assert.deepEqual(recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 3 })], epicKey: 'EPIC-1' }), []);
});

test('an entry keeps only the names that are still missing and refreshes its stale fields', () => {
    const held = [entry('S-1', ['Story Points', 'Team'], { customfield_10004: null, teamId: null, summary: 'old' })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 3, teamId: null, summary: 'new' })], epicKey: 'EPIC-1' });
    assert.deepEqual(out[0].fields.missingFields, ['Team']);
    assert.equal(out[0].fields.summary, 'new');
});

test('a refreshed story with Story Points 0 is flagged, never "Assignee"', () => {
    const held = [entry('S-1', ['Team'], { teamId: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: 0, teamId: null })], epicKey: 'EPIC-1' });
    assert.deepEqual(out[0].fields.missingFields, ['Story Points', 'Team']);
});

test('terminal statuses drop the entry (the endpoint excludes Killed, Done and Postponed)', () => {
    for (const name of ['Killed', 'Done', 'Postponed']) {
        const held = [entry('S-1', ['Story Points'], { customfield_10004: null })];
        assert.deepEqual(recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: null, status: { name } })], epicKey: 'EPIC-1' }), [], name);
    }
});

test('entries whose story was not refreshed, and other epics, are untouched and identity is kept', () => {
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null }), entry('S-9', ['Team'], { epicKey: 'EPIC-2', teamId: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-2')], epicKey: 'EPIC-1' });
    assert.equal(out, held);
});

test('an unchanged refreshed story keeps the same entry object', () => {
    const held = [entry('S-1', ['Story Points'], { customfield_10004: null })];
    const out = recomputeMissingPlanningInfo({ held, refreshedStories: [story('S-1', { customfield_10004: null })], epicKey: 'EPIC-1' });
    assert.equal(out, held);
});

test('a ghost is hidden once an actionable story for that team exists, but not for blocked, done, killed or incomplete ones', () => {
    assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-1', teamId: 't1', stories: [story('S-1')] }), true);
    for (const name of ['Blocked', 'Done', 'Killed', 'Incomplete']) {
        assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-1', teamId: 't1', stories: [story('S-1', { status: { name } })] }), false, name);
    }
    assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-1', teamId: 't2', stories: [story('S-1')] }), false);
    assert.equal(shouldHideReadinessGhost({ epicKey: 'EPIC-2', teamId: 't1', stories: [story('S-1')] }), false);
});
```
(Adjust the two status sets to match `story_readiness.py` exactly: read it, then keep these tests as the executable statement of that rule.)

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js
```
Expected: FAIL (module not found).

- [ ] **Step 2: Implement** `epicRefreshAlerts.js` with both functions as pure code following the tests: `missingNamesFor(story)` returns `'Sprint'` when no sprint id, `'Story Points'` when Story Points is null, empty or at most 0, `'Team'` when no team id; `recomputeMissingPlanningInfo` keeps an entry untouched unless its story is among `refreshedStories`; for a refreshed story it drops the entry on a terminal status or an empty recomputed list, otherwise returns `{ ...entry, fields: { ...entry.fields, ...story.fields, missingFields: names } }` (or the flat shape `{ ...entry, missingFields: names }` when the entry has no nested `fields.missingFields`), returns the original array when nothing changed; `shouldHideReadinessGhost({ epicKey, teamId, stories })` is true when a story with that epic and team id has an actionable status. Do not reuse `patchMissingFields` (it is a no-op for `customfield_10004`).

- [ ] **Step 3: Wire**

In `useEpicRefresh.js` `afterApply` (Catch Up only): `setMissingPlanningInfoTasks(prev => recomputeMissingPlanningInfo({ held: prev, refreshedStories: update.fetchedStories, epicKey: update.epicKey }))` (add `setMissingPlanningInfoTasks` to the hook inputs and pass it from `dashboard.jsx`, one line). In `engWorkHierarchy.js` filter the Stories Required ghost rows with `shouldHideReadinessGhost` against the current stories, in **both** Catch Up and Planning (Planning renders ghosts first), with no new request.

- [ ] **Step 4: Playwright** (extend `eng_epic_refresh.spec.js`): Story Points from empty to a value removes that story's Missing Info entry with no `/api/missing-info` request and no department-wide request; the Stories Required ghost for a team disappears when the refresh adds an actionable story for that team (Catch Up and Planning); a terminal status drops the entry; dismissals (`dismissedAlertKeys`) survive; a department reload started mid-refresh discards the per-epic alert result (compare `getAlertVersion()` captured at click with the current one).

- [ ] **Step 5: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_dashboard_alert_source_guards.js tests/test_eng_work_hierarchy.js
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_alert_loading_order.spec.js tests/ui/eng_alerts_panel_summary.spec.js tests/ui/eng_missing_story_ghosts.spec.js --workers=1 --reporter=line
git checkout -- frontend/dist && git status --short frontend/dist
wc -l frontend/src/dashboard.jsx
```
Report the `dashboard.jsx` line count for the orchestrator's ratchet.

- [ ] **Step 6: Report for commit**

Files: `frontend/src/eng/epicRefreshAlerts.js`, `tests/test_epic_refresh_alerts.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/dashboard.jsx`, `frontend/src/eng/engWorkHierarchy.js`, `tests/ui/eng_epic_refresh.spec.js`. Message: `Keep client-derived alerts in step with a per-epic refresh`.

---

## Task 9: Alerts B backend — scoped epic alert object

**Files:**
- Modify: `jira_server.py` (`fetch_epics_for_empty_alert` parameter; a short `epic-alerts` branch; optional `failures` list on the counts and distribution functions), `backend/services/epic_refresh.py` (`apply_epic_enrichment`, `fetch_epic_alert_bundle`), `tests/test_epic_refresh_purpose.py`, `tests/test_create_stories_alert.py`

**Runs before Task 10 (both edit `tests/test_create_stories_alert.py`).** Validation and the rate limit for `epic-alerts` already exist from Task 1 (`EPIC_SCOPED_PURPOSES`).

**Read first:** `jira_server.py` `fetch_epics_for_empty_alert` (~2880), `fetch_story_counts_for_epics` and `fetch_story_distribution_for_epics` (~2985-3190; they turn a non-200 into zero counts), the enrichment assignment block in `fetch_tasks` (~3509-3548; its per-epic assignments are pure and can move verbatim), `backend/services/alert_epics.py` (`fetch_epics_for_alert_scope_service`: with `complete_alert_scope=True` it raises on a non-200 or malformed page, with `False` it returns `[]`), `quote_jql_value` (importable from `alert_epics`, not yet imported in `jira_server.py`).

- [ ] **Step 1: Failing tests** (two separate tests for the JQL and the bundle, because the JQL cannot be asserted while `fetch_epics_for_empty_alert` is patched):
  1. **JQL:** do **not** patch `fetch_epics_for_empty_alert`; capture the search payloads with a `jira_search_request` mock. Query: `purpose=epic-alerts&project=product&sprint=123&sprintName=2026Q3&teamIds=team-a&teamLabels=team_alpha&epicKeys=EPIC-1`. Assert the epic search JQL contains the sprint-label alternative (`labels in ("2026Q3","2026Q3_candidate")`), the team and alias scope clause (`"Team[Team]" = "team-a" OR labels = "team_alpha"`), and ends with `issueKey in ("EPIC-1")`; and that `complete_alert_scope=True` is used (a mocked non-200 makes the route return 500, never `epicsInScope: []`).
  2. **Bundle:** patch the three fetchers; the route returns `{epicsInScope: [...]}` with no `issues`; `fetch_story_counts_for_epics` and `fetch_story_distribution_for_epics` are called with `['EPIC-1']` only and the epic is enriched (`totalStories`, `selectedStories`, `selectedActionableStories`, `futureOpenStories`, `openStoriesOutsideSelected`, `selectedActionableByTeam`); an epic outside the scope returns `epicsInScope: []`; a future-sprint epic in scope only by label is returned; a counts or distribution failure (their new `failures` list non-empty) returns 502/500 and never zero counts.
  3. `epic-alerts` right after `epic-refresh` for the same epic and lane is not rate-limited (separate bucket); missing `epicKeys` returns 400; no `TASKS_CACHE` write.
  4. `tests/test_create_stories_alert.py` stays green unchanged (the `alerts` purpose still runs the complete scan).

- [ ] **Step 2: Add the parameter** in `jira_server.py`:

```python
def fetch_epics_for_empty_alert(jql, headers, team_field_id, epic_name_field, sprint_field_id=None, scope_team_ids=None, scope_team_labels=None, scope_sprint_label=None, complete_alert_scope=False, epic_keys=None):
    ...
    if scope_clause:
        epic_jql = add_clause_to_jql(epic_jql, scope_clause)
    if epic_keys:
        epic_jql = add_clause_to_jql(epic_jql, f'issueKey in ({", ".join(quote_jql_value(key) for key in epic_keys)})')
```
(import `quote_jql_value` with the existing `alert_epics` import list).

- [ ] **Step 3: Extract the enrichment** (the per-epic assignments at ~3520-3547) verbatim into `backend/services/epic_refresh.py::apply_epic_enrichment(epics, counts, distribution)` and call it from both `fetch_tasks` (replacing the inline block) and the new branch; this shrinks `jira_server.py`. `tests/test_create_stories_alert.py` enrichment tests must pass unchanged. Give `fetch_story_counts_for_epics` and `fetch_story_distribution_for_epics` an optional `failures=None` list that they append to on a non-200 (the bundle turns a non-empty list into an error).

- [ ] **Step 4: `fetch_epic_alert_bundle`** in the service takes the three callables and the request values and returns `{'epicsInScope': enriched}`; add the `epic-alerts` branch in `fetch_tasks` right after the JQL and field ids are resolved, returning before the story fetch. Inputs the branch needs: the `jql` built above; `headers`; `team_field_id`; `epic_name_field=None` (it is computed after the story fetch; the `or PARENT_NAME_FIELD_DEFAULT` fallback exists); `epic_link_field_id` for the counts; `sprint_field_id`; the group's `team_ids` and `team_label_values`; `sprint_name`. The early return bypasses `publish_result`, so set the `Cache-Control: no-cache, no-store, must-revalidate` and `Pragma: no-cache` headers on the response yourself. Cost is about 5 searches per lane (1 scope, 1 counts, 3 distribution).

- [ ] **Step 5: Verify**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_purpose tests.test_epic_refresh_service tests.test_create_stories_alert tests.test_codebase_structure_budgets -v 2>&1 | tail -15
make test-security 2>&1 | tail -4
wc -l jira_server.py
```
Report the `jira_server.py` line count; the orchestrator ratchets the budget at the end of the wave (the extraction offsets this task's own growth but not Task 1's).

- [ ] **Step 6: Report for commit**

Message: `Add scope-aware epic alert purpose for one epic`.

---

## Task 10: Alerts C backend — `epicKeys` on missing-info, backlog and story-readiness

**Runs after Task 9.** **Files:** Modify `backend/routes/eng_routes.py`, `tests/test_oauth_eng_routes.py`, `tests/test_story_readiness.py`, `tests/test_create_stories_alert.py`, `tests/test_oauth_cache_isolation.py`. **Does not touch** `jira_server.py`, `backend/services/epic_refresh.py` or `backend/services/story_readiness.py` (`project_story_readiness` emits only epics with missing teams, so an empty per-epic result already means deletion; `single_epic_key` and `epic_keys_error(..., single=True)` exist from Task 1).

**Read first:** `eng_routes.py` missing-info route and its `MISSING_INFO_CACHE` key (~1282-1515; it has **no** `refresh` parameter today), the backlog route (~2070) and `fetch_backlog_epics_for_alert` (`jira_server.py` ~2935-2985: it derives its epic JQL with `derive_epic_jql`, which keeps other clauses, and builds its children search from the keys found, so an added `issueKey in (...)` on the `jql` you pass scopes both searches), the story-readiness route (`_story_readiness_cache_key` ~229 is called at **two** sites, ~562 and ~610 (the post-compute `!= cache_key` stale-scope check); `_story_readiness_compute(context, requested, ...)` unpacks `requested` as a 3-tuple at ~288 and ~365; the `ValueError('invalid_scope')` block ~524; the 128-entry LRU read ~578 and write ~631; the discovery JQL ends ` ORDER BY key ASC`), `POST /api/dependencies` (~829; it reads a JSON body only), and the pinned tests (`tests/test_oauth_eng_routes.py` ~582, ~628 and the readiness stub at ~205-250, whose `compute(captured, *_args)` rejects keyword arguments; `tests/test_story_readiness.py:201-320` pins the department discovery JQL string).

- [ ] **Step 1: Failing tests**, one group per route:
  - **missing-info:** `epicKeys=EPIC-1` (one key, `epic_keys_error(args, single=True)`; a bad or multi-key value returns 400 `invalid_epic_keys`) ANDs `issueKey in (...)` into the epic query keeping the sprint, component, team, status and project scope; the cache key gains the epic key **only when present** (the pinned existing key is unchanged); a new `refresh=true` parameter bypasses the cache read; a full-scope call after a per-epic call returns the full payload.
  - **backlog-epics:** `epicKeys=EPIC-1` adds `issueKey in (...)` to the `jql` passed to `fetch_backlog_epics_for_alert`, scoping both searches; 400 on a bad or multi-key value.
  - **story-readiness:** `epicKeys=EPIC-1` is validated inside the existing `ValueError` block; **both** `_story_readiness_cache_key` call sites include the key when present (otherwise every per-epic call raises `stale_scope` and returns 502); the per-epic call skips the LRU read and the LRU write and uses its own in-flight key (assert the LRU has no per-epic entry and a following department call computes the full payload); the keys reach `_story_readiness_compute` as an extra positional argument, not inside `requested`; ` AND key in (...)` is spliced before ` ORDER BY key ASC` only when keys are present; the existing stubs and pinned strings pass unchanged.
  - **dependencies:** a JSON body field `refresh` bypasses the 5-minute cache; the key format check returns 400 on a bad key.
- [ ] **Step 2: Implement** each change with the smallest edit, reusing `epic_refresh.epic_keys_error(args, single=True)` and `epic_refresh.single_epic_key(args)`.
- [ ] **Step 3: Verify**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_oauth_eng_routes tests.test_story_readiness tests.test_create_stories_alert tests.test_oauth_cache_isolation tests.test_epic_refresh_service tests.test_epic_refresh_purpose -v 2>&1 | tail -20
make test-security 2>&1 | tail -4
```
- [ ] **Step 4: Report for commit.** Message: `Add single-epic scoping to missing-info, backlog and readiness`.

---

## Task 11: Alerts B frontend — Ready to Close, Empty Epic, Missing Team and Missing Labels for one epic

**Files:** Modify `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/epicRefreshAlerts.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/dashboard.jsx` (minimal wiring), `frontend/src/api/engApi.js`, `tests/test_epic_refresh_alerts.js`, `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `loadAlertEpics` and `loadReadyToClose*` (`useEngSprintData.js` ~330-430; `fetchTasks` applies `epicsInScopeSetter` **wholesale**, so per-epic loaders pass a **capturing** setter and merge themselves), the `*EpicsInScope` and `readyToClose*` state and the Waiting, Ready to Close and Empty Epic derivations in `dashboard.jsx` (~13481-13660).

- [ ] **Step 1: Failing tests** in `tests/test_epic_refresh_alerts.js`: a pure `mergeEpicScopeEntries({ held, incoming, epicKey })` that replaces or deletes the epic-shaped entry for `epicKey` by key (status `{name}`), keeping other epics and the array identity when nothing changes; and `alertCallsFor(update, { isFutureSprint, isCatchUp })` returning the epic-scoped calls per the design's trigger matrix: Story Points only or assignee, summary, priority, `updated` only gives none; a story status change gives `readyToClose` and `epicAlerts`; a story added, removed or moved sprint gives every epic-level call; a story team change gives `missingInfo` and `readiness`; an epic status, assignee or `epicSilent` change gives `epicAlerts`; a future sprint always includes `epicAlerts`; Planning (`isCatchUp` false) gives none.
- [ ] **Step 2: Implement** both in `epicRefreshAlerts.js`; add `fetchEpicAlertBundle` and `fetchEpicReadyToClose` to `engApi.js` (both use `trackedFetch('epic_refresh', ...)`, `purpose=epic-alerts` and `purpose=ready-to-close&epicKeys=<key>&sprint=`, with the epic's project lane); add per-epic loaders in `useEngSprintData.js` that return data without applying it (read token finished on every path).
- [ ] **Step 3: Wire** the calls after a successful `apply` in `useEpicRefresh.js` `afterApply`, only when `alertCallsFor` says so. Implement them as one function `recheckEpicAlerts(epicKey, calls)` inside the hook (both lanes, per-lane merge, `getAlertVersion()` discard) that `afterApply` invokes and that the hook also returns, because Task 13b reuses it for inline edits. **Call both lanes** (the owning lane cannot be determined for a zero-story epic or an epic with children in both lanes) and merge each lane's result into that lane's `*EpicsInScope` and `readyToClose*EpicsInScope` / `readyToClose*Tasks` by upsert or delete. Capture `getAlertVersion()` at click and discard alert results if it changed.
- [ ] **Step 4: Playwright:** a status change makes exactly the ready-to-close and epic-alerts calls for that epic only (both lanes); no other alert call; a refresh with no displayed change makes none; a department reload mid-refresh discards the alert result; an epic that leaves scope disappears from the Empty Epic alert; a future-sprint label-only epic stays; a failed epic-alerts call keeps the existing alerts and raises no banner.
- [ ] **Step 5: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_alert_loading_order.spec.js tests/ui/eng_alerts_panel_summary.spec.js --workers=1 --reporter=line
git checkout -- frontend/dist && git status --short frontend/dist
wc -l frontend/src/dashboard.jsx
```
- [ ] **Step 6: Report for commit.** Files: the seven listed. Message: `Re-check scope-based epic alerts after a per-epic refresh`.

---

## Task 12: Alerts C frontend — missing-info, backlog and Stories Required for one epic

**Files:** Modify `frontend/src/eng/useStoryReadiness.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/eng/epicRefreshAlerts.js`, `frontend/src/api/engApi.js`, `frontend/src/dashboard.jsx` (minimal wiring), `tests/test_story_readiness_api.js`, `tests/test_epic_refresh_alerts.js`, `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `useStoryReadiness.js` (whole file: state machine, `refreshRevision`, `snapshot:null` while loading), `engApi.js` `fetchStoryReadiness`, `tests/test_story_readiness_api.js`, the ghost-row rendering in `engWorkHierarchy.js` (~237-283).

- [ ] **Step 1: Failing tests:** `mergeReadinessEpic({ snapshot, epicPayload, epicKey })` (upsert and delete by epic key in `snapshot.epics[]`, preserving other epics and identity when equal; stale readiness assignee, track or initiative never shadows cleared `epicDetails` fields); merges for the missing-info and backlog lists keyed by `fields.epicKey` and epic key; `alertCallsFor` extended: `missingInfo` when a story is added, removed or moved sprint, or its **team** changes (**not** for a Story Points change alone: that case is handled client-side in Task 8); `backlog` only in a future sprint; `readiness` on a status, membership or team change.
- [ ] **Step 2: Implement:** a separate `fetchEpicReadiness` in `engApi.js` (the department request is untouched), `fetchEpicMissingInfo`, `fetchEpicBacklog`; add `mergeEpic(epicKey, payload)` to `useStoryReadiness` that updates the snapshot **without** the `snapshot:null` blanking; add the missing-info, backlog and readiness calls to the same `recheckEpicAlerts(epicKey, calls)` runner so `afterApply` and Task 13b both get them.
- [ ] **Step 3: Playwright:** after a membership change, the Stories Required ghost for that epic updates with no department-wide readiness request and no blanking of other epics' ghosts; missing-info and backlog calls are epic-scoped and only when the matrix says so; a failed per-epic readiness call leaves the existing ghosts and raises no banner.
- [ ] **Step 4: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_story_readiness_api.js tests/test_frontend_api_source_guards.js tests/test_dashboard_alert_source_guards.js
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_missing_story_ghosts.spec.js tests/ui/eng_alert_loading_order.spec.js --workers=1 --reporter=line
git checkout -- frontend/dist && git status --short frontend/dist
wc -l frontend/src/dashboard.jsx
```
- [ ] **Step 5: Report for commit.** Files: the seven listed. Message: `Re-check missing-info, backlog and Stories Required per epic`.

---

## Task 13: Planning enablement

**Files:** Modify `frontend/src/dashboard.jsx` (gate and capacity hold), `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `dashboard.jsx` `capacityScopeSignature` (~12786) and the `/api/capacity` effect (~12804-12882, which blanks the capacity cards), `planningCapacityUtils.js:453` (`displayedTeamOptions` keeps only teams with `teamSpTotals > 0`, so a refresh that moves a team's Story Points across zero changes the signature and refires `/api/capacity`), the Planning selection effect and `resolvePlanningSelectionState` (~11617-11734, `planningSelectionState.mjs`).

- [ ] **Step 1: Failing tests** (Playwright, Planning mode): the button appears on Planning headers; a Planning refresh issues **zero** alert requests and **zero** `/api/capacity` requests even when a refresh moves a team's Story Points across zero; capacity cards do not blank and keep their values; a story that moves out of the epic is not double-counted in the capacity bar; future-sprint default-all mode auto-selects a newly arrived story; in manual selection mode a removed story's selection is pruned and persisted exactly as a normal reload would; header geometry and layering tests from Task 7 repeat in Planning at 1280, 1024 and 390 px, including that the Planning stat toggle centre is not covered at 390 px.
- [ ] **Step 2: Implement:** widen the `readGuards` mode check to `isCatchUpMode || showPlanning`, mount the button under the same condition, pass `sourceSurface` accordingly, suppress the alert calls when `!isCatchUpMode`, and **hold `capacityScopeSignature`**: add a `capacityScopeHoldRef` that the hook's `apply` sets before the merge and clears two frames after it, and have the signature memo return its previous value while the hold is set (so a transient zero-SP team change does not refire `/api/capacity`); the signature recomputes normally afterwards only if the set of displayed teams truly differs and the user changed the scope.
- [ ] **Step 3: Verify**

```bash
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/planning_capacity_editing.spec.js tests/ui/planning_selection_defaults.spec.js --workers=1 --reporter=line
git checkout -- frontend/dist && git status --short frontend/dist
wc -l frontend/src/dashboard.jsx
```
Expected: new tests pass; `planning_selection_defaults` shows only its known baseline failure (#210).
- [ ] **Step 4: Report for commit.** Message: `Enable per-epic refresh in Planning with capacity and selection guards`.

**Outcome (2026-10-01; accepted limitation, flagged for the requester's decision).** The brief's 2-frame hold could not meet the "zero `/api/capacity` requests" test, because the signature recomputes the moment the hold clears. It became a PIN: while the hold is set in Planning the previous capacity scope signature is pinned, and the pin lasts until the user changes the capacity scope (sprint, group, Planning mode, selected teams) or a department load bumps the load epoch. Consequences: after a per-epic refresh in Planning, a team that newly rises above zero Story Points shows no capacity value until the next scope change or department Refresh; a team that drops to zero loses its card with no refetch; the same applies to a later inline Story Points edit that crosses zero. Alternative considered and not taken: one silent capacity reread after the refresh settles when the displayed team set differs (keeps the old cards, no blanking, but breaks the "zero `/api/capacity` requests" acceptance test). A scope change inside the hold window recomputes the signature normally (test 70). Test 71 covers the department Refresh after a pin; it does not isolate the load-epoch term of the pin key (the Refresh also bumps the capacity refresh nonce and the read names the displayed teams), so removing that term did not fail it.

---

## Task 13b: Inline status and priority edits re-check only their epic

Added 2026-09-30 at the requester's request ("do not refresh all the data when the priority or status of an epic or story changes in the UI"). Not covered by the first plan review; review it like any other task.

**Amendments from the Task 13b plan review (2026-10-01; full review in the working notes, decision by the requester). Where this block conflicts with the text below, this block governs.**
1. **Contract decision (requester, 2026-10-01): keep "invalidate in every ENG mode"** (`docs/features/alerts.md:12`, MRT023). In **Catch Up** a successful status edit runs the scoped per-epic re-check (below) instead of the department reload, and a successful priority edit re-checks nothing. **Outside Catch Up** (Planning, Board), a successful status or priority edit keeps today's request-free invalidation: the same ref resets and nonce bump `rearmCatchUpAlerts` performs today, so Catch Up reloads its cohort on return and Planning's readiness `refreshRevision` bumps. Implement it as one named dashboard function (for example `invalidateAlertsAfterEdit({ keys, field })`) that picks the path by mode; the old literal `onAlertDataInvalidated: rearmCatchUpAlerts` disappears (count 2 to 0) but the `rearmCatchUpAlerts();` call-site count may change deliberately: pin the exact new counts and wiring in the guard and justify each in the report. Add a Playwright case: a Planning status edit, then switch to Catch Up, and the cohort reloads (department alert requests appear on return, none while in Planning).
2. **Bulk status exists only in Planning** (`isSingleIssueSurface = sourceSurface !== 'planning'`; priority is always one key). Replace the "bulk across two epics" Playwright case by a unit test of `recheckAlertsForEdit` (several keys of one or more epics de-duplicate to one re-check per epic) and a Planning case asserting the bulk edit issues zero scoped loader calls (it takes the request-free path of item 1).
3. **Per-epic coalescing and 429.** `purpose=epic-alerts` is limited to one request per user, lane and epic per 8 s. In `useEpicRefresh`, keep per-epic state: at most one re-check in flight plus one trailing re-check; a `rate_limited` `epicAlerts` lane is retried once after `retryAfterSeconds` (8 s when absent) and then given up (bounded stale window). Tests: two edits on one epic 1 s apart end with the alert state of the second edit; a mocked 429 on `epic-alerts` is retried once after the window.
4. **Cohort deferral mechanism.** Add an `alertCohortSettle` listener list in `dashboard.jsx`, notified in the cohort's `.finally` AND in the effect cleanup (keep the two pinned `if (alertCohortRef.current === alertCohortToken) alertCohortRef.current = null;` statements unchanged), passed to `useEpicRefresh` as an input. The edit captures `{ epoch, version, scopeKey }` at success time; a scope switch or unmount drops the pending re-check; a cohort that was ABORTED restarts and reads post-edit data, so the pending re-check is dropped; several queued edits merge into the coalescer of item 3. State in the report which guard assertions stay untouched (the dependencies-effect digest in `tests/test_epic_refresh_source_guards.js`; the cohort effect is pinned by regexes and counts). Add a deterministic test: a held cohort response is released after the edit and the final state equals the post-edit state (cohort result first, then the re-check result).
4b. **In-flight per-epic refresh.** One per-epic in-flight map in `useEpicRefresh` serializes the refresh follow-up and the edit re-check for the same epic; add a case "status change lands during an in-flight refresh" asserting the final status and alert state.
5. **Guards that will change (add to Files and to the commit):** `tests/test_epic_refresh_source_guards.js` (lines 68-69 pin the counts 3 and 2), `tests/test_planning_action_source_guards.js` (lines ~450-455 pin the literal `onAlertDataInvalidated?.();` text; passing `{ keys }` changes it), and `tests/test_eng_status_transition_utils.js` only if it pins call arguments. The Global Constraint sentence about the guard counts is superseded by item 1; state every guard assertion touched in the report.
6. **Key-to-epic resolver (specified).** Order: sprint lists (`productTasks`, `techTasks`, `loaded*`), ready-to-close story copies, missing-info issues (add `missingPlanningInfoTasks` to the hook's `getState()`), then the key itself when it is an epic in `epicDetails`, then a subtask's parent story (`storySubtasksByKey` / `resolveSubtaskParentStoryKeys`). `NO_EPIC` stories and unresolved keys fall back, in Catch Up, to the department invalidation of item 1 (today's behavior), with a unit test per source and for the fallback. Keys whose result is `already_in_status` are excluded from the succeeded keys passed to the re-check.
7. **Priority.** No alert request in Catch Up (as designed). Known limitation to verify and record in the Outcome and the ontology: readiness-only epics (Stories Required ghosts without sprint stories) carry `priority` in the readiness snapshot, which the local patch does not update; the ontology line "Priority: none" must say so if confirmed. Do not add a priority re-check without asking.
8. **Verification additions (Playwright or unit as noted):** a failed or partially failed edit (`summary.succeeded === 0`, and `isCurrentMutation` false after a scope switch) triggers no loader call and no invalidation; other epics' alert entries keep object identity after a re-check; assignee and Story Points edits still call `rearmCatchUpAlerts()` (guard count plus a behavior assertion); loader spies (`loadEpicAlerts`, `loadEpicReadiness`) for Planning and Board in addition to request counting; after a status edit the Stories Required ghosts of other epics are not blanked; a 401 inside the re-check follows the existing terminal sign-in lock and is never retried; the re-check must not call the status or priority write routes again (patch `transitionIssues` and `updateIssuePriorities` to raise during the re-check).
9. **Details.** `alertCallsForEdit` reuses `ALERT_CALL_ORDER` and returns `[]` for unknown fields and for `isCatchUp: false`; `recheckEpicAlerts(epicKey, calls, { alertVersion })` receives the version captured at edit time explicitly. Residual risks to state in the Outcome: Jira search lag right after a transition; a story reopened from Killed or Done with no sprint is not added to the server-only Missing Info list (`alertCallsForEdit('status')` omits `missingInfo`, matching `alertCallsFor`).

**Files:**
- Modify: `frontend/src/dashboard.jsx` (the two `onAlertDataInvalidated: rearmCatchUpAlerts` sites), `frontend/src/eng/useEngStatusTransitions.js`, `frontend/src/eng/useEngPriorityTransitions.js`, `frontend/src/eng/epicRefreshAlerts.js`, `frontend/src/eng/useEpicRefresh.js`, `tests/test_dashboard_alert_source_guards.js`, `tests/test_epic_refresh_alerts.js`, `tests/ui/eng_epic_refresh.spec.js`, `docs/ontology.md`

**Interfaces:**
- Consumes: Tasks 8, 11 and 12 (`alertCallsFor`, `recheckEpicAlerts(epicKey, calls)`, the epic-scoped loaders and merges).
- Produces: `alertCallsForEdit({ field, isFutureSprint, isCatchUp })` and `recheckAlertsForEdit({ keys, field })` (returned by `useEpicRefresh`).

**Read first:** `dashboard.jsx` `rearmCatchUpAlerts` (~1141), `invalidateEngIssueFieldSources` and `applyLocalEngIssueField` (~12553-12570), the status and priority hook wiring (~12575-12615: `onAlertDataInvalidated: rearmCatchUpAlerts` at two sites), `useEngStatusTransitions.js` (~349, where `succeededKeys` is in scope: `if (isCurrentMutation) onAlertDataInvalidated?.();`), `useEngPriorityTransitions.js` (~216: `if (summary.succeeded > 0 && isCurrentMutation) onAlertDataInvalidated?.();`; read `summarizePriorityTransitionResults` for how success is marked), `tests/test_dashboard_alert_source_guards.js:144-145`, `docs/features/alerts.md` (lines 11-12), postmortem MRT023.

**What happens today (verified 2026-09-30):** after a successful status change or priority change (story or epic, single or bulk) the hooks call `onAlertDataInvalidated`, which is `rearmCatchUpAlerts`: it reloads the alerts for **both lanes with the complete epic scan**, missing-info, ready-to-close and backlog for the whole department, and blanks the Stories Required ghost rows through the readiness `refreshRevision`. Assignee and Story Points edits do the same through `rearmCatchUpAlerts()` inside `invalidateEngIssueFieldSources`. No alert rule depends on priority (priority only filters the visible Story set on the client), so a priority reload is pure waste.

**Behavior:**
- Priority change (story or epic): no alert request at all.
- Status change (story or epic): no `rearmCatchUpAlerts`. The local patch (`applyLocalEngIssueField`) already updates the client-derived alerts; the server-backed alerts for **that story's epic only** (the epic itself when an epic changed) are re-checked through the Task 11 and 12 epic-scoped calls, selected by `alertCallsForEdit`.
- If an alert cohort is in flight (`alertCohortRef.current !== null`) when the edit succeeds, run the scoped re-check after the cohort settles, so a stale cohort result is corrected instead of clobbering the re-check.
- Catch Up only: Planning issues no alert requests (MRT023 mode-negative).
- Left as they are on purpose (listed as follow-ups in the Outcome): assignee and Story Points inline edits (their `rearmCatchUpAlerts()` calls), Project Track (no rearm today), the global Refresh, and the server-side `clear_jira_issue_status_caches` call that wipes the process-wide caches after every status, priority and Project Track change.

- [ ] **Step 1: Failing tests**
  - In `tests/test_epic_refresh_alerts.js`: `alertCallsForEdit({ field: 'priority', ... })` returns `[]`; `field: 'status'` returns `['readyToClose', 'epicAlerts', 'readiness']` and adds `'backlog'` in a future sprint; any other field returns `[]`; `isCatchUp: false` returns `[]`.
  - In `tests/test_dashboard_alert_source_guards.js`: the `rearmCatchUpAlerts();` count stays 3 (assignee, Story Points, global Refresh); the `onAlertDataInvalidated: rearmCatchUpAlerts` count goes from 2 to 0 and `recheckAlertsForEdit` appears at both hook wirings; the dependencies-effect and cohort regex slices are byte-identical.
  - Playwright (extend the spec): a story status change issues **no** request with `purpose=alerts`, no `/api/missing-info` or `/api/backlog-epics` without `epicKeys`, and no `/api/eng/story-readiness` without `epicKeys`; it issues only epic-scoped calls carrying that story's epic key; a priority change on a story and on an epic issues **zero** alert requests and does not blank the Stories Required ghost rows; an epic status change re-checks that epic only; a status change while an alert cohort is in flight re-checks after the cohort settles; in Planning a status change issues zero alert requests; a bulk status change on stories of two epics re-checks both epics once each.

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_dashboard_alert_source_guards.js
```
  Expected: FAIL.

- [ ] **Step 2: Implement**
  - `epicRefreshAlerts.js`: add `alertCallsForEdit` (pure, following the tests).
  - `useEngStatusTransitions.js` and `useEngPriorityTransitions.js`: call `onAlertDataInvalidated?.({ keys })` with the succeeded keys (`succeededKeys` in the status hook; the keys whose result succeeded in the priority hook). Keep the call inside the existing `isCurrentMutation` conditions; change nothing else in the hooks. Run `rg -n onAlertDataInvalidated tests` and update only the assertions that pin the call arguments (they currently expect no arguments).
  - `useEpicRefresh.js`: add `recheckAlertsForEdit({ keys, field })`: map each key to its epic (the story's `fields.epicKey` from the held lists, or the key itself when it is an epic in `epicDetails`), de-duplicate epics, defer behind the alert cohort when one is in flight, then call `recheckEpicAlerts(epicKey, alertCallsForEdit({ field, isFutureSprint, isCatchUp }))` for each; return immediately for priority.
  - `dashboard.jsx`: replace the two `onAlertDataInvalidated: rearmCatchUpAlerts,` lines with `onAlertDataInvalidated: ({ keys } = {}) => epicRefresh.recheckAlertsForEdit({ keys, field: 'status' }),` and `field: 'priority'` respectively. The status and priority hooks are declared before the `epicRefresh` hook call (which sits after the `longAbsenceRefreshRef` effect); the arrow functions only run after a mutation completes, long after render, so `epicRefresh` is initialized by then and no ref is needed. Confirm with the spec (a read before initialization would throw a `ReferenceError`).
  - Update `tests/test_dashboard_alert_source_guards.js` exactly as in Step 1 and nothing else.

- [ ] **Step 3: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_dashboard_alert_source_guards.js tests/test_epic_refresh_source_guards.js tests/test_eng_status_transition_utils.js
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -8
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_alert_loading_order.spec.js tests/ui/eng_alerts_panel_summary.spec.js tests/ui/eng_missing_story_ghosts.spec.js --workers=1 --reporter=line
git checkout -- frontend/dist && git status --short frontend/dist
wc -l frontend/src/dashboard.jsx
```
  Expected: pass; `eng_priority_transitions` shows only its known baseline failure (#210). Report the `dashboard.jsx` line count for the orchestrator's ratchet.

- [ ] **Step 4: Update the ontology (same commit)**

In the `ENG inline issue edits and alert invalidation` section of `docs/ontology.md`: change the **Alert cohort reload** entry's verified triggers (status and priority changes no longer rearm; assignee and Story Points edits and the global Refresh still do), add the new relationship **Inline issue edit -> scoped alert re-check** (`recheckAlertsForEdit` and `alertCallsForEdit`, Catch Up only, deferred behind an in-flight cohort, priority re-checks none), refresh the verification date, and confirm every path and symbol resolves with `rg`.

- [ ] **Step 5: Report for commit.** Files: the nine listed. Message: `Re-check only the edited epic after inline status and priority edits`.

---

## Task 14: Docs, final verification, dist and publication prep (orchestrator, inline)

**Files:** Modify `docs/ontology.md`, `README.md`, `docs/features/eng-workflows.md`, `docs/features/alerts.md`, `docs/README_ANALYTICS.md` (confirm Task 4), `docs/plans/README.md`, this plan, the design artifact; generate `frontend/dist/*`.

- [ ] **Step 1: Docs.** Consult `docs/ontology.md` first (including the `ENG inline issue edits and alert invalidation` entries from Task 0 and Task 13b, which must now describe the shipped behavior), then add an `Epic refresh` entry (concept, canonical name, aliases `per-epic refresh`, entry points `epicRefreshController.js`, `epicRefreshPatch.js`, `epicRefreshAlerts.js`, `useEpicRefresh.js`, `EpicRefreshButton.jsx`, `purpose=epic-refresh` and `purpose=epic-alerts` in `fetch_tasks`, relations to the Catch Up hierarchy, Alert Epic candidate and Story-readiness snapshot, verification date 2026-09-30) and check every path and symbol resolves with `rg`. Update `docs/features/alerts.md` (the statement near line 12 that task refreshes and status or priority changes invalidate any pending alert cohort becomes: a refresh and a status change re-check only that epic's alerts, a priority change re-checks none; Task 13b), `docs/features/eng-workflows.md` (refresh semantics, the moved-story limitation, the button), and `README.md` near the refresh description (~355). Re-read each section against the shipped behavior. Record the placement decision and the `hasTouch` hover-emulation note in the design artifact.
- [ ] **Step 2: Build and commit dist once, then verify at that head**

```bash
fnm exec --using 20 npm ci && fnm exec --using 20 npm run build
git add frontend/dist
git commit -m "Rebuild frontend bundle for per-epic refresh"
git show --stat HEAD && git status --short
fnm exec --using 20 npm run build && git diff --exit-code frontend/dist
rg -c '\.\./\.\./\.\./' frontend/dist/dashboard.js.map
```
Expected: dist files in the commit; the second build leaves no diff (CI's `verify-frontend-build` check); the source-map search prints `0` (no ancestor-checkout paths).
- [ ] **Step 3: Close the design artifact and index the outcome** (docs commit): rename the design to `docs/agents/features/2026-09-29-executed-per-epic-refresh-with-glare.md` with `Status: executed`, add `## Outcome` and `## Current Accuracy`, update every link; keep this plan as `EXEC-*` until acceptance or merge with a top status note naming the commit range; record the breaker-isolation decision from Task 1 step 11 and the measured Jira search counts from the Python tests; update the `docs/plans/README.md` entry. Commit with a subject of at most 72 characters.
- [ ] **Step 4: Full verification at the final head**

```bash
make test 2>&1 | tail -6
make test-security 2>&1 | tail -6
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -14
for f in tests/ui/*.spec.js; do echo "== $f"; fnm exec --using 20 npx playwright test "$f" --workers=1 --reporter=line 2>&1 | tail -4; done | tee tmp/final-ui.txt
git checkout -- frontend/dist; git status --short
diff <(rg '^==|passed|failed|skipped' tmp/baseline-ui.txt) <(rg '^==|passed|failed|skipped' tmp/final-ui.txt)
```
Compare with the Baseline table: no new failures (only the issue #210 failures may remain). If backend startup or dependency paths changed, also start `.venv/bin/python jira_server.py` (needs a local `.env` and dashboard config that a worktree lacks; if absent, record that and run `scripts/check_startup_preflight.py` instead) and `curl http://localhost:5050/api/test` with no warning before the Flask banner. This feature changes routes only, so the check is conditional.
- [ ] **Step 5: Whole-branch review.** Dispatch one final reviewer over `git diff origin/main...HEAD` with the design and this plan: spec coverage, forbidden regressions, stray files, local data, absolute paths, secrets, attribution trailers, commit subject lengths.
- [ ] **Step 6: Publication transaction (AGENTS.md section 10).** Do not push. Report to the user, as one unit:
  1. Fetch the base; record the exact base and head SHAs.
  2. `git status --short`, `git log --oneline origin/main..HEAD`, `git diff --name-status origin/main...HEAD`.
  3. Compare the complete commit list, the commit count and every changed path with this plan's file map and its commit list (the plan commits, each task commit, the baseline record, the plan revisions, the dist commit, the docs commit); a clean worktree is not enough. If history or scope differs, stop and ask before any commit, push or PR.
  4. Screenshots for the PR notes: **before and after** of the epic header at rest and hovered, the busy mark, a glare frame, a Planning header, and the 390 px layout.
  5. Wait for explicit user confirmation, then `git push`, then `gh pr create --body-file -` with a body written in the reply (no attribution line), read the body back as rendered text, visually inspect the GitHub PR page, verify the remote head equals the approved local head, the remote changed-file list and commit count, and report the real CI state. If any post-publication check fails, report the publication as malformed and stop.

---

## Self-Review (run against the design)

- Goal and decisions (design section 1): Tasks 3, 6a, 13 (button, placement, scope), Task 4 (analytics), Tasks 8, 11, 12 (alerts), Global Constraints (no wipes, glare numbers, manual only, credential policy).
- Facts and traps (section 2): guarded in Tasks 1, 5, 6a, 6b (validation, read token, cohort, dependencies, subtasks, budgets, declaration order).
- Interaction and accessibility (3.1): Tasks 3, 6a, 7 (reveal, `aria-disabled`, announcements with a keyed region, cap and cooldown in Task 5's controller).
- Endpoint matrix (3.2) and state machine: the matrices above; Tasks 1, 9, 10.
- Backend (3.3): Task 1 (validation, meta, cache skip and evict with tests that catch removal of either, limiter per lane and purpose, inline, budget, breaker checkpoint).
- Frontend data flow (3.4), diff and merge (3.5): Tasks 2, 5, 6b (functional updaters, per lane, capped, snapshot incl. the epic header, protected, removed-by-user, moved story, re-sort, anchor, focus move, copies patched).
- Alerts (3.6): Tasks 8 through 12; inline status and priority edits no longer reload the department (3.6b): Task 13b.
- Glare (3.7): Task 3 (CSS, helper, `data-glare`, header sweep incl. reduced motion, killed and incomplete peak, `isLeaving`), Task 5 (selection, delay, dimmed skip), Task 7 (frozen-frame screenshot).
- Persistence and ordering (3.8): no storage anywhere (source guard in Task 5); anchoring asserted in Task 7 test 24.
- Analytics (3.9): Task 4.
- Acceptance criteria (section 6): mapped to Tasks 1, 2, 5, 7, 8 through 13 and Task 14's final verification; measured Jira search counts come from the Python tests (live timing is optional evidence when a user session is available).
- Open risks carried, not hidden: the baseline suite is not green (issue #210); Jira search counts are from reading the code (the Python tests count them); Story Readiness per epic is the highest-risk slice; breaker isolation may be deferred (Task 1 step 11); the top-right overlay can cover the end of the right-most header item (user-approved).
