# Dashboard Data Freshness and Reading Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Use `superpowers:subagent-driven-development` only when delegation is authorized. Steps use checkbox (`- [ ]`) syntax for tracking. Work in the checkout the user is viewing; do not create another worktree.

**Goal:** Check the active dashboard's data after a long focused return without background freshness work, lost refresh intent, or displacement of the item being read.

**Architecture:** A small browser lifecycle controller owns pending intent, eligibility, generation cancellation and source-check records. Existing feature owners acquire and reconcile their data; a separate reading-anchor helper owns one temporary presentation exception and compensation in the actual scroll container. Auth renewal, manual Refresh, bootstrap, catalog authority, mutation transactions and Scenario collaboration retain their existing owners.

**Tech Stack:** React 19, JavaScript, esbuild and Node 20; existing Flask/Python API; Node's test runner and Playwright. No new dependency, route, storage schema or Jira polling interval.

---

Status: planned; design approved, application implementation not started
Date: 2026-10-09 (Europe/Berlin)
Issue: [#251](https://github.com/Juce-me/jira-execution-planner/issues/251)
Design and Definition of Done: [approved design](SUPPORT-dashboard-data-freshness-design-251.md#definition-of-done)
Evidence: [source and primary-source research](SUPPORT-data-freshness-research-251.md)
Recorded source baseline: `fb3593492d52a9f854ba1300c4f21f55476a9f51`, equal to fetched `origin/main` when this plan was prepared.
Authorization: the user approved the design and requested a planning commit and this implementation plan on 2026-10-09. This authorizes the documentation commit; executing application changes, pushing, publishing a PR and closing the issue are separate steps.
Execution prerequisite: Task 0 must pass before application edits. Its remaining validation does not block writing or committing this plan.

## Approved policy and boundaries

- Retain the existing **more than 12 minutes** threshold. An 11-minute or exactly 12-minute return uses the current auth shell/throttle without automatic Jira freshness work. A 13-minute, 8-hour or 24-hour return coalesces one relevant check.
- Browser focus means `document.visibilityState === 'visible' && document.hasFocus()`. This is distinct from a Board's focused column or an Epic being read. Gate acquisition, commit and follow-ups; abort or retire automatic work on blur/hidden.
- Preserve one pending intent through bootstrap, onboarding, auth in flight, connection recovery, loading, editors, dirty drafts and saves. No periodic retry loop. Any API `401` keeps the terminal mounted sign-in gate and forbids request/write replay.
- Compatible Catch Up and Planning scopes check one viewed Epic first, then discover the scope once. Strict Component/All work Board instead uses its existing focused-column-first stream. No offscreen Epic fan-out.
- Keep canonical remote priority values current while retaining the presented position and Story order of at most one reading Epic. Preserve filters, selection, expansions, drafts and pane positions. Release the exception on deliberate Refresh/sort/scope/surface/navigation changes or user scrolling the anchor out of its container.
- Freshness is a source observation. Forced, cached and unknown checks are distinct; coverage is complete, partial or unknown. HTTP success or auth success does not prove complete current Jira membership or indexing consistency.
- Use current user/workspace/site partitions and current API wrappers. Do not introduce Home writes, Home 3LO migration, Basic/service credentials, token storage, Settings ownership changes or a server scheduler.
- Event-driven checks provide no maximum data age during uninterrupted focused reading. BFCache restoration is observable; a new/discarded document bootstraps normally. Eventless retained sleep/wake has no guaranteed trigger. Record real lifecycle evidence separately from simulated time.

## Verified file map

All Modify and existing Test paths below were resolved at the recorded baseline. Create paths are proposed files. Read the instruction chain again at execution; a new directory instruction may have appeared. The map is an allowlist, not an instruction to change every file.

| Action | Path | Responsibility / tasks |
| --- | --- | --- |
| Create | `frontend/src/dashboardFreshnessController.js` | Pure intent, generation, source checks and retry controller; Task 2. |
| Create | `frontend/src/useDashboardFreshness.js` | React/browser lifecycle subscription and adapter dispatch, without feature data ownership; Tasks 2–3, 7–9. |
| Create | `frontend/src/eng/engReadingAnchor.js` | Container geometry, movement fence, one-Epic presentation order and departure fallback; Task 5. |
| Modify | `frontend/src/api/authFocusRefresh.js` | Preserve return intent across auth/connection guards and report auth attempt activity; Task 3. |
| Modify | `frontend/src/api/authRefreshContract.js` | Side-effect-free additive event contract shared by the separate shell and dashboard bundles; Task 3. |
| Modify | `frontend/src/dashboard.jsx` | Replace automatic-to-manual coupling, supply existing owner adapters/guards, wire reading projection and freshness copy; Tasks 3–9. |
| Modify | `frontend/src/eng/useEngSprintData.js` | Silent two-lane collection and guarded source reconciliation; Tasks 4–5. |
| Modify | `frontend/src/eng/epicRefreshController.js` | Share per-Epic admission/cancellation; manual and automatic presentation modes; Task 4. |
| Modify | `frontend/src/eng/useEpicRefresh.js` | Silent targeted application, reading capture and guarded follow-ups; Tasks 4–5. |
| Modify | `frontend/src/eng/epicRefreshPatch.js` | Conservative scope merge using existing per-key edit fences; Tasks 4–5. |
| Modify | `frontend/src/eng/useEngBoardData.js` | Stage compatible automatic streams instead of publishing empty working snapshots; Task 6. |
| Modify | `frontend/src/eng/useStrictEngBoardIntegration.js` | Keep transactional issue patches until a current accepted stream reconciles them; Task 6. |
| Modify | `frontend/src/eng/EngBoardView.jsx` | Preserve open detail, focus/star, expansion and independent pane anchors; Task 6. |
| Modify | `frontend/src/eng/usePlanningSprintReview.js` | Automatic clean-only read, generation guards and row-signature coalescing; Task 7. |
| Modify | `frontend/src/eng/useEngCapacity.js` | Hold scope during primary application and run one clean follow-up; Task 7. |
| Modify | `frontend/src/stats/useStatsData.js` | Active-source automatic refresh with held data, signal and aggregate-read guards; Task 8. |
| Modify | `frontend/src/epm/useEpmViewData.js` | Staged scoped metadata/rollup reads without selection loss; Task 8. |
| Modify | `frontend/src/api/epmApi.js` | Pass optional signal and the already-supported metadata `refresh` query; no invented rollup bypass; Task 8. |
| Modify | `frontend/src/eng/PlanningReviewTable.jsx` | Stable issue/row anchor attributes and local editor eligibility reporting if existing attributes cannot identify the row; Tasks 5, 7. |
| Modify | `frontend/src/styles/dashboard.css` | Only compact freshness/departing-item styles, using existing tokens; Tasks 5, 9. |
| Create | `tests/test_dashboard_freshness.js`, `tests/test_eng_reading_anchor.js` | Controller races/source records and anchor/projection rules; Tasks 1–5. |
| Create | `tests/ui/eng_epic_refresh_fixture.js` | Extract the existing synthetic fixture section verbatim for shared use; Task 1. |
| Create | `tests/ui/dashboard_data_freshness.spec.js` | Current-source lifecycle, movement, requests and all-surface acceptance; Tasks 1–9. |
| Modify | `tests/test_auth_focus_refresh.js`, `tests/ui/auth_focus_refresh_counts.spec.js` | Focus, auth activity and retained intent; Tasks 1, 3. |
| Modify | `tests/test_epic_refresh_controller.js`, `tests/test_epic_refresh_patch.js`, `tests/test_epic_refresh_source_guards.js`, `tests/ui/eng_epic_refresh.spec.js` | Manual compatibility, automatic silence, partial data and local edits; Tasks 1, 4–5. |
| Modify | `tests/test_eng_board_data.js`, `tests/test_strict_eng_board_integration.js`, `tests/ui/eng_group_board_view.spec.js` | Stream staging, patch ownership and pane/detail continuity; Task 6. |
| Modify | `tests/test_planning_sprint_review.js`, `tests/test_use_eng_capacity.js`, `tests/ui/planning_review_integration.spec.js`, `tests/ui/planning_capacity_editing.spec.js` | Clean/dirty, revision, save/conflict and capacity isolation; Task 7. |
| Modify | `tests/test_use_stats_data.js`, `tests/test_epm_view_source_guards.js`, `tests/ui/epm_initial_config_load.spec.js` | Source-specific hooks, no duplicate EPM fan-out and scope retention; Task 8. |
| Modify | `tests/test_analytics_source_guards.js`, `docs/README_ANALYTICS.md`, `docs/features/eng-workflows.md`, `docs/ontology.md`, `docs/plans/README.md` | Analytics allowlist and verified behavior/status; Task 9. |
| Generated | `frontend/dist/` outputs from `npm run build` | Auth shell, dashboard/chunks/manifests and CSS; Task 10. Never hand-edit. |

Existing fixture consumers: `tests/ui/eng_board_dashboard_fixture.js`, `tests/ui/epm_home_token_fixture.js`. Existing Scenario collaboration/history and backend security/route tests are verification inputs, not modification targets. No backend file is in the application edit map. If Task 0 finds an additive response/stream contract necessary, present the concrete contract and revise the plan with user approval before those edits.

The controller and browser hook are separate so Node tests do not load React or install browser listeners. Keep adapter acquisition/application in the feature owner. Remove the old long-absence listener/ref when wiring the hook; do not leave two schedulers. Preserve the `dashboard.jsx` structure budget of 7,616 lines and existing hook boundaries; do not relax budgets or turn this into an App refactor.

## Controller and owner contracts

New controller export: `createDashboardFreshnessController({ readEnvironment, readAdapter, now, notify, timers })`. `now` defaults to `Date.now`; `notify` informs the hook of state changes; `timers` defaults to `{ setTimeout, clearTimeout }` and is injected by deadline tests. No I/O lives in the controller except calls to the supplied adapter and its single retry deadline.

```js
// readEnvironment() returns a fresh value on every guard check.
// contextKey is an opaque, in-memory identity; never send it to analytics.
{
    contextKey: '', // principal/site + accepted config/scope + active source/range
    focused: false,
    bootstrapReady: false,
    authReady: false,
    connectionOwned: false,
    blocked: false, // draft/editor/save/drag/owner loading or unsafe review state
    terminalAuth: false,
}
```

Compose `contextKey` from the accepted config/browser context, auth mode/site and `authResumeStagedRevision`, Department and shared-config revision, active surface and its acquisition scope. Strict Board includes accepted stream scope; Stats includes its existing query key/range; EPM includes saved/runtime sub-goal keys, tab, project and Sprint. Use accepted identity values already supplied by config/catalog owners; do not create or persist a new user identity. Display-only facets do not change acquisition scope. Read mutable guards through current refs, not request-start closures.

Public methods:

| Method | Contract |
| --- | --- |
| `request({ reason, absenceStartedAtMs })` | Reasons `long_return` / `bfcache`; coalesce one current-context intent and retain the earliest relevant absence. Return the current drain Promise when eligible; otherwise resolve without discarding intent. |
| `update()` | Reevaluate current environment; retire an incompatible generation, resume eligible pending work once. Call on guard transitions, focus/visibility/pageshow and owner settlement. Repeated calls during the same job cannot duplicate it. |
| `retire(reason)` | Abort active acquisition, drop staged results and cancel the scheduled retry. Blur/temporary blocks retain pending intent; scope/surface/principal replacement drops the old intent. |
| `supersedeManual()` | Retire automatic work before a deliberate global Refresh or competing manual per-Epic read. No implicit automatic replay after the manual result. |
| `acceptChecks(checks)` | Record accepted source observations from automatic or explicit reads. Only an equal-context forced check begun/completed after the absence can satisfy that source's pending intent. |
| `getState()` | Stable snapshot `{pending, running, retryAtMs, failure, checks}` for the hook; the first two are booleans, deadline/failure nullable, checks are per-source observations. No mutable feature arrays. |
| `dispose()` | Abort and cancel retry; the hook unsubscribes on unmount and owners release read leases in `finally`. Late results cannot notify or apply. |

Automatic job supplied to every adapter:

```js
{
    contextKey: '', generation: 0, signal: new AbortController().signal,
    shouldApply: () => false, // rereads eligibility + identity + current generation
    retrySources: null, // source-enum array only on the one permitted retry
}
```

`shouldApply` is false after blur, blocked state, scope/config/principal/surface change, cancellation, disposal or terminal auth. Check it before dispatch, after awaits, immediately before state/cache writes and before follow-ups. Cancellation alone is insufficient. If a response is `401`, the HTTP owner's terminal auth boundary still runs even when the job is retired; never catch a `401` as an ordinary stale result.

Every feature adapter implements the following local interface; unused anchor/follow-up methods return `null` / an empty result and start no request:

```js
{
    captureAnchor: () => null,
    refreshAnchor: async (job, anchor) => [],
    refreshScope: async (job, anchor) => [],
    followUp: async job => [],
}
```

The `refresh*` methods own the complete collection/guarded-application transaction and return per-source outcome descriptors. They call the existing owner's loader/commit path; the controller never handles feature payloads or invokes a second application. Inside each owner, collection must not mutate rendered lists, loading surfaces, caches, metadata, review revisions or freshness timestamps. Acquire edit-read leases before dispatch and finish each exactly once in `finally` after acceptance or retirement, including failures. Feature caches change only after the application guard passes. Follow-ups cannot run after retirement. Only successfully accepted descriptors become source-check records.

Collected sources use this common metadata; their feature payload stays private:

```js
{
    source: 'eng_product', // stable local enum, never a Jira key
    status: 'ok', // ok | denied | failed | rate_limited | ignored | auth_required
    checkKind: 'forced', // forced | cached | unknown
    coverage: 'unknown', // complete | partial | unknown
    requestStartedAtMs: 0,
    retryAtMs: null,
}
```

Accepted observations store `contextKey`, `source`, `lastCheckedAtMs`, `checkKind` and `coverage`. Partial forced reads can update their own observation without claiming complete scope. Cached/unknown reads cannot satisfy a forced-check intent or advance a forced check timestamp. If an owner cannot prove a forced source read with its current contract, settle the attempt as unverified, retain truthful pending/unknown guidance and wait for a new deliberate trigger; never loop until the contract appears complete.

Stages are sequential: capture one anchor → `refreshAnchor` → `refreshScope` → surface follow-ups. Each refresh method collects then applies within its own guarded transaction. At most two primary lane requests concurrently and four primary requests without retries. A failed targeted source does not indefinitely block broader discovery. A `429` schedules at most one foreground retry for the failed source(s), not the successful phase; maximum two extra lane calls for that one retry. If a valid `Retry-After` is absent, keep pending intent and expose explicit Refresh; do not invent a hot retry interval. Use one cancellable timeout for a known deadline, rechecking focus/identity before dispatch. A header date is interpreted against the injected clock. Network failure retains content and waits for a later return/explicit action. This retry budget is additional to, and does not enlarge, current server attempt/page/deadline/byte limits.

## Existing endpoint contract matrix

No route is added or migrated. OAuth reads keep `RequestAuthContext` and current project/site authorization; local supported Basic mode keeps its existing policy. Never use a fallback credential to make a blocked source look successful. GET reads have no body or CSRF token. Unsafe OAuth methods keep `X-Requested-With: jira-execution-planner`; token-bound CSRF additionally applies to the current `user_write`/preview policies. The Stats/dependencies POSTs are `authenticated_read`, while Planning values-read POST is `user_write` by policy despite its read behavior. Keep that distinction.

| Existing transport / owner | Request and successful result | Auth/boundary and failure verification |
| --- | --- | --- |
| `POST /api/auth/refresh`, `authFocusRefresh.js` | No body, same-origin credentials and requested-with header. Existing `{authenticated, authMode, loginRequired?, expiresAt?, siteUrl?, siteName?}` stays private to auth. | `auth_flow` policy, DB session/token resolver unchanged. `401 {error:'auth_required', loginUrl,...}` terminal; network/other failure preserves return intent. Auth unit/browser cases; endpoint security matrix. |
| `GET /api/tasks-with-team-name`, `fetchEngTasks` / `fetchEpicRefresh` | Existing `project`, numeric `sprint`, `sprintName`, `groupId`, Team/label scope; forced ordinary query uses `refresh=true`; targeted uses `purpose=epic-refresh`, one `epicKeys`. `{issues, epics, epicsInScope}`, targeted `capped` and `epicKeysMissing` retained. | Existing request auth and lane authorization. Preserve 400 invalid scope, denied-lane behavior, 422 alert scope too large, 429 plus `Retry-After`, and terminal 401. `test_oauth_eng_routes.py`, `test_epic_refresh_purpose.py`, `test_epic_refresh_breaker.py`. Ordinary membership completeness remains unknown. |
| `GET /api/eng/board`, `streamEngBoard` in `engBoardApi.js` | Department, `scope`, optional `sprintId`, `focusedColumnId`, `refresh=1`; `application/x-ndjson` frames interpreted by existing parser/reducer. | Server-resolved workspace/Department/projects; accepted authority and request/generation/frame ordering mandatory. Keep terminal/error frames and configured budgets. `test_eng_board_routes.py`, `test_eng_board_stream.py`, frontend stream/owner tests. |
| `GET /api/sprints`, `fetchSprints` | Existing catalog identity/version/completion contract. No forced rediscovery in an ordinary automatic freshness job. | Separate workspace catalog owner; current initial bootstrap and same-attempt publication fence remain. Catalog due check is a non-forced separate job after visible work, never a reason to silently change selected Sprint. `test_workspace_catalog_cache.py`. |
| `GET /api/eng/story-readiness`, `fetchStoryReadiness` / `fetchEpicReadiness` | Existing group/Sprint/state, optional one-Epic filter and refresh flag; existing `{epics,...}` snapshot. | Same scoped owner; malformed/configuration and incomplete errors remain visible; terminal 401 and stale-response rejection. Existing readiness tests and Epic-refresh browser cases. |
| `GET /api/missing-info`, task `purpose=epic-alerts` / `ready-to-close`, `loadEpicAlerts` and Catch Up alert owner | Keep the existing affected-Epic or Department payload (`issues`, `epics`, `epicsInScope`) and purpose/scope. No Board/Stats acquisition. | Current lane, group/component and auth guards. Hold old alert bundles on failed replacement, retain 422/429/401 handling. `test_epic_refresh_alerts.js` and `eng_epic_refresh.spec.js`. |
| `POST /api/dependencies`, `fetchDependencies`; `GET /api/issues/subtasks`, `fetchSubtasks` | Existing `{keys, refresh?}` body for dependencies; existing `parentKey`, Sprint and refresh query for subtasks. Current response parsers remain. | Dependencies POST is authenticated read with requested-with; no new CSRF exemption or mutation. Only relevant accepted keys/expanded children, bounded existing batches; `epicRefreshDependencySkip` must prevent duplicate automatic department load. Existing Epic-refresh dependency/source guards. |
| `GET /api/eng/sprints/<sprint_id>/review`, `fetchSprintReview` | `{schemaVersion, sprintId, schemaRevision, columns, layouts, capabilities}`. | Workspace/Sprint ownership, same request context; 400/403/413/503 structured errors and 401 boundary. `test_planning_sprint_review.js` and existing backend Sprint-review tests. |
| `POST /api/eng/sprints/<sprint_id>/review/values/read`, `readSprintReviewValues` | `{issueIds, rowKind}` → `{cells:[{issueId,rowKind,columnId,value,revision}], unavailableIssueIds}`. | Existing user-write policy requires token-bound CSRF plus requested-with. Preserve authorization-filtered unavailable IDs; no widening row admission. PATCH review save and its base revisions/409 conflicts are untouched. Browser review/save/conflict cases and security matrix. |
| `GET /api/capacity`, `fetchCapacity` | Existing `sprint` name and admitted Team list; current capacity payload/parser. | Current user Jira auth; no PATCH on automatic path. Existing expected-value capacity save/409 recovery remains. `test_oauth_capacity_routes.py`, capacity unit/browser tests. |
| `POST /api/stats/burnout`, `/api/stats/epic-cohort`, `/api/stats/project-track-phase-durations`, `/api/stats/excluded-capacity-source` | Keep current API wrapper bodies: burnout Sprint/Teams/issues/closure option; cohort existing range/scope; phase `{epicKeys,refresh?}`; excluded `{sprintIds,teamIds,refresh?}`. Existing `{data,...}` and warnings remain. | Authenticated-read POST plus requested-with, aggregate edit-read lease, current range/cache/concurrency/30s deadline. `test_oauth_stats_routes.py`, Stats unit/source guards and active-source browser probes. No new phase per-Epic fan-out. |
| `GET /api/epm/projects`, `fetchEpmProjects` | `tab`, runtime `subGoalKeys`, optional existing `refresh=true`; `{projects,...}` interpreted by the same owner. Add optional signal forwarding. | Current user's Home token for Home metadata; scoped private EPM config. `home_user_token_required` keeps existing Settings gating; terminal 401 retains precedence. `test_epm_projects_api.py`, `test_epm_home_cache_isolation.py`, EPM browser tests. |
| `GET /api/epm/projects/<project_id>/rollup` and `/api/epm/projects/rollup/all` | Existing `tab`, selected Sprint for Active, sub-goal scope; same tree/aggregate builders, duplicate/truncation/fallback metadata. Add optional signal forwarding, not an unsupported force flag. | User OAuth Jira plus captured auth/config context in worker threads. Per-project cache hit is real (`Server-Timing: cache;dur=1`); classify check conservatively. `test_epm_rollup_api.py`, EPM ownership/worker isolation tests. No Home mutation or service fallback. |

Task 0 freezes exact wrapper bodies/response fixture fields for the Stats, alert, dependency, capacity and stream parsers against source; this matrix delegates those already-versioned payloads to their existing parser, rather than defining replacement shapes. Any missing provenance is `unknown`, not an inferred new field. Enhanced Jira search remains `nextPageToken` / `isLast`; project search remains `startAt` / `isLast`.

## Task 0: Finish validation and freeze the execution baseline

**Read:** root and nested instructions, [ontology](../ontology.md), [configuration ownership](../../backend/security/CONFIGURATION_OWNERSHIP.md), design/research, current API owners and the file map. Review [MRT010](../postmortem/MRT010-startup-api-load-fanout-and-overscoped-payloads.md), [MRT023](../postmortem/MRT023-alert-enrichment-blocked-first-screen.md), [MRT014](../postmortem/MRT014-epm-cold-load-cache-race.md) and [MRT015](../postmortem/MRT015-epm-first-load-home-fanout-overfetch.md). Recheck [GATE-05](GATE-05-home-write-capability.md) under its own safety rules; it remains unrelated to this read-only feature.

**Update:** this plan's validation record only. Do not edit application source during this task.

- [ ] Record branch, clean/dirty state, fetched intended base/head and all existing user changes. Resolve every Modify/Test path and symbol in the map. Review incoming changes before updating line references; preserve the approved policy.
- [ ] Run the existing auth, merge, owner and structure baselines with Node 20 and the repository Python runtime. Build existing source and verify a clean generated diff. Use the existing `.venv` or the documented `JEP_TEST_PYTHON` runtime for browser specs that launch Flask; do not install into host Python or invent credentials.

```bash
fnm exec --using 20 node --test tests/test_auth_focus_refresh.js tests/test_epic_refresh_controller.js tests/test_epic_refresh_patch.js tests/test_eng_board_data.js tests/test_planning_sprint_review.js tests/test_use_stats_data.js
python3 -m unittest tests.test_codebase_structure_budgets
fnm exec --using 20 npm run build
git diff --exit-code -- frontend/dist
fnm exec --using 20 npx playwright test tests/ui/auth_focus_refresh_counts.spec.js tests/ui/eng_epic_refresh.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/planning_review_integration.spec.js --browser=chromium --workers=2 --reporter=line
```

Expected: existing checks pass and rebuilt source produces no unapproved diff. Record failures/skips as execution blockers; don't weaken assertions to proceed.

- [ ] Extend the two current-source synthetic probes to Planning List/Table and both Board ownership paths. Measure changed priority, status, membership, height above a mid-Epic anchor, visible-but-unfocused late response, and a busy/onboarding/save return. Distinguish reproduced defects from source-derived risks. Use fixture-side lifecycle/focus/clock overrides; no production test globals.
- [ ] Pin the exact endpoint/parser ledger, initial and return request counts/bytes, NDJSON budgets and upstream page/attempt measurements available through existing synthetic service diagnostics. Establish measured timing tolerances for the same fixture/scope. Keep unavailable live Jira cost/OS-wake evidence explicitly open; do not fabricate a numeric improvement target.
- [ ] Record whether each owner can prove a forced source check and complete membership with its current response. Broad tasks are unknown; capped targeted responses are partial. EPM rollup cache hits and missing provenance stay cached/unknown. Do not add a backend bypass or metadata field without presenting the contract for approval.
- [ ] Close the design checkpoint's remaining validation/file-map checks with evidence. If the campaign requires reducing surface coverage, changing the return policy, adding a backend/stream contract or relaxing a load-bearing budget, stop before dependent code and obtain the specific decision. Otherwise Task 1 may begin when application execution is authorized.

## Task 1: Turn the reproduced defects into permanent regression tests

**Create:** `tests/ui/eng_epic_refresh_fixture.js`, `tests/ui/dashboard_data_freshness.spec.js`.
**Modify:** `tests/ui/eng_epic_refresh.spec.js`, `tests/ui/auth_focus_refresh_counts.spec.js`.

- [ ] Extract only the existing fixture section through its helpers before `// ---- tests 1-8 ----` into the fixture module. Keep `test.use` and test registrations in the spec; the fixture may import Playwright `expect`. Export `appBaseUrl`, `SPRINT_ID`, `SPRINT_NAME`, `GROUP_ID`, `EPIC_ONE_STORY_COUNT`, `deferred`, `buildStory`, `buildEpic`, `buildScenario`, `storyKeysOf`, `groupsConfigPayload`, `mockDashboard`, `taskPayload`, `catchUpPrefs`, `openCatchUp`, `epicBlock`, `epicHeader`, `refreshButton`, `taskCard`, `statusRegion`, `parkPointer`, `hoverHeader`, `revealRefreshButton`, `epicRefreshCalls` and `assertScopedCalls`; these existing names are used by the current consumer or the new regression. Preserve their internal helper dependencies/constants. Replace the fixture section with imports, preserving every existing test body and payload. No test definitions belong in the shared fixture.
- [ ] Port the reading probe to the permanent spec using the shared fixture and in-memory current-source bundle. Deliberately read synthetic `E1-S06`, change a different Epic's priority, dispatch the real return event, then assert document count unchanged, anchor DOM identity retained and settled offset within 2 CSS pixels. Add status/removal/height variants after the first regression is red. Capture screenshots after transitions settle.

```js
// In a browser test after locating/positioning the synthetic anchor:
const anchor = page.locator('.task-item[data-task-key="E1-S06"]');
const before = await anchor.evaluate(node => {
    window.__freshnessTestAnchor = node; // fixture-only observation
    return node.getBoundingClientRect().top;
});
await page.evaluate(() => window.dispatchEvent(new CustomEvent(
    'jep:auth-long-absence-return', { detail: { unfocusedMs: 13 * 60 * 1000 } }
)));
// Wait for the fixture's expected primary responses and settled layout here,
// rather than sampling before the automatic request has completed.
await expect.poll(() => anchor.evaluate(node =>
    node === window.__freshnessTestAnchor
)).toBe(true);
await expect.poll(async () => Math.abs(
    await anchor.evaluate(node => node.getBoundingClientRect().top) - before
)).toBeLessThanOrEqual(2);
```

- [ ] Port the delayed-response probe with a manually released lane Promise. Mark hidden and `hasFocus() === false` before releasing it; assert the old summary remains, no follow-up requests start and only one current-scope job resumes on refocus. Repeat visible-but-unfocused. Count primary, alert/catalog, document and asset requests independently.
- [ ] Run only the new movement/hidden-response cases against the recorded baseline with current-source bundling. Expected: the movement assertion and hidden-state assertion fail for the observed defects, not missing fixture imports. Record actual red results in this plan; these tests must be green after Tasks 4–5. Existing manual Epic fixture consumers must remain green.

```bash
fnm exec --using 20 npx playwright test tests/ui/dashboard_data_freshness.spec.js --browser=chromium --workers=1 --reporter=line
fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js --browser=chromium --workers=2 --reporter=line
```

Expected at this task: the two new known-defect regressions are red; existing manual cases pass. Do not report an intentionally red intermediate revision as feature completion or publish it.

## Task 2: Implement the bounded lifecycle controller

**Create:** `frontend/src/dashboardFreshnessController.js`, `frontend/src/useDashboardFreshness.js`, `tests/test_dashboard_freshness.js`.
**Modify:** `tests/ui/dashboard_data_freshness.spec.js` for lifecycle integration.

- [ ] Add VM/esbuild-based Node tests, following `test_auth_focus_refresh.js`, against the public controller methods. Supply a mutable synthetic environment, fake clock and deferred adapters. Test request coalescing, all temporary blocks, late old-context results, dispose, manual supersession, auth lock, cached/partial source checks and the single retry. Include blur between each stage and between response/apply/follow-up. Start with this complete synthetic contract case; add the other transitions as distinct cases, not implementation-line assertions.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function loadController() {
    const bundle = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '../frontend/src/dashboardFreshnessController.js')],
        bundle: true, write: false, format: 'cjs', platform: 'node',
    }).outputFiles[0].text;
    const context = { module: { exports: {} }, AbortController, setTimeout, clearTimeout };
    vm.runInNewContext(bundle, context);
    return context.module.exports.createDashboardFreshnessController;
}

test('blocked returns coalesce until the current owner becomes ready', async () => {
    const environment = {
        contextKey: 'synthetic-scope', focused: true, bootstrapReady: true,
        authReady: true, connectionOwned: false, blocked: true, terminalAuth: false,
    };
    let scopeCalls = 0;
    const controller = loadController()({
        readEnvironment: () => environment,
        readAdapter: () => ({
            captureAnchor: () => null,
            refreshAnchor: async () => [],
            refreshScope: async job => {
                scopeCalls += 1;
                assert.equal(job.shouldApply(), true);
                return [{ source: 'eng_product', status: 'ok', checkKind: 'forced',
                    coverage: 'unknown', requestStartedAtMs: 2000, retryAtMs: null }];
            },
            followUp: async () => [],
        }),
        now: () => 3000, notify: () => {},
    });
    await controller.request({ reason: 'long_return', absenceStartedAtMs: 1000 });
    await controller.request({ reason: 'long_return', absenceStartedAtMs: 1500 });
    assert.equal(scopeCalls, 0);
    assert.equal(controller.getState().pending, true);
    environment.blocked = false;
    await controller.update();
    await controller.update();
    assert.equal(scopeCalls, 1);
    assert.equal(controller.getState().pending, false);
    controller.dispose();
});
```
- [ ] Implement the contract above with one pending intent, one active AbortController and one retry handle. Store identity/generation in each job, reread environment at every boundary, and run the phases sequentially. Read-lease/staged-snapshot cleanup belongs in the owner's `finally`; accepted source records change only after guarded application. No `setInterval`, per-Epic loop, persistent key or application data store.

```js
export function isFreshnessEligible(environment) {
    return environment.focused && environment.bootstrapReady && environment.authReady &&
        !environment.connectionOwned && !environment.blocked && !environment.terminalAuth;
}

export function parseFreshnessRetryAt(value, nowMs) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const seconds = Number(text);
    if (Number.isFinite(seconds)) return seconds >= 0 ? nowMs + seconds * 1000 : null;
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(nowMs, date) : null;
}
```

Both exports live beside `createDashboardFreshnessController`; use the factory's `timers` dependency for Node deadline tests. Tests verify deadline/cancellation, not elapsed wall time. A retry when unfocused is retired and its intent remains pending; it cannot use a past deadline to spin on every render. Supply `job.retrySources` to the owner on retry so only failed sources are acquired; the owner must not reapply/refetch already successful lanes.

- [ ] Implement `useDashboardFreshness` as the browser/React adapter to that controller: subscribe/unsubscribe `focus`, `blur`, `visibilitychange`, persisted `pageshow`, the long-absence event, auth/connection events; update current refs for environment and active adapter. Initialize from current terminal-auth/connection/bootstrap state. `pageshow.persisted` requests one check only when current sources are unknown or older than the threshold. Ordinary mount does not duplicate bootstrap. Return `state`, `supersedeManual` and `acceptChecks` to App.
- [ ] Run Node policy tests red then green; keep UI production bundling free of test clocks/focus overrides. Verify no listener or retry remains after unmount.

```bash
fnm exec --using 20 node --test tests/test_dashboard_freshness.js
python3 -m unittest tests.test_codebase_structure_budgets
```

Expected: all controller race/source/deadline cases pass; structure checks remain unchanged.

## Task 3: Preserve auth-return intent and remove manual-refresh coupling

**Modify:** `frontend/src/api/authFocusRefresh.js`, `frontend/src/api/authRefreshContract.js`, `frontend/src/dashboard.jsx`, `tests/test_auth_focus_refresh.js`, `tests/ui/auth_focus_refresh_counts.spec.js`.

- [ ] Add shell regression cases: visible-but-blurred focus; blur while auth POST awaits; long return during an in-flight POST; connection ownership; storage exceptions; failed renewal followed by a short focused return; exactly 12 minutes; late mounted app; BFCache; concurrent-tab attempt timestamps. Assert actual event/request counts without claiming atomic cross-tab exclusion.
- [ ] Keep the earliest unfocused timestamp and pending long-return intent until a renewal/eligible throttled return can dispatch it. Do not clear intent before in-flight/connection checks. Recheck focus after awaited auth before starting freshness; if focus was lost, preserve intent for the next eligible return. Terminal auth clears executable intent and retains recovery precedence.
- [ ] Add one side-effect-free event constant for auth attempt activity and additive long-return timestamps. Dispatch activity before a return intent and before calling the network; settle after the request. The hook uses it only to defer/resume checks. Existing `AUTH_SESSION_REFRESH_EVENT` remains the permission-cache invalidation signal, never a broad data-fetch trigger. Shared storage records attempts only.

```js
// authRefreshContract.js: additive events contain no token or user data.
export const AUTH_FOCUS_REFRESH_STATE_EVENT = 'jep:auth-focus-refresh-state';
// Activity detail: { status: 'refreshing' | 'settled' | 'failed' }.
// Long-return detail retains unfocusedMs, adding:
// { absenceStartedAtMs: number, observedAtMs: number }.
```

Use existing successful bootstrap as the hook's initial auth readiness, then current activity transitions. A failed renewal retains pending intent and does not initiate retries on render; the next independent focused/auth transition may retry through the existing throttle. A throttled attempt in another tab is not proof of renewal; ordinary API auth remains authoritative.

- [ ] Replace `longAbsenceRefreshRef` and its event listener with the freshness hook, initially registering adapters only after their tasks pass. Keep `refreshActiveViewFromJira` as explicit Refresh; call `supersedeManual()` before its existing work. Keep the new feature inactive where its owner adapter is not yet complete; this is an intermediate execution state, not an accepted scope reduction.
- [ ] Run shell unit/browser cases and the build. Expected: no freshness navigation/asset load, short-return data count zero, delayed hidden/unfocused events do not start automatic acquisition, busy returns retain intent. Adjust only the old browser assertion that explicitly expected the broad manual-refresh coupling; keep its auth/navigation assertions.

```bash
fnm exec --using 20 node --test tests/test_auth_focus_refresh.js tests/test_dashboard_freshness.js
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/auth_focus_refresh_counts.spec.js --browser=chromium --workers=2 --reporter=line
```

## Task 4: Add silent targeted and scope acquisition to the ENG owner

**Modify:** `useEngSprintData.js`, `epicRefreshController.js`, `useEpicRefresh.js`, `epicRefreshPatch.js` under `frontend/src/eng/`; `frontend/src/dashboard.jsx`; associated Epic/controller tests in the map.

- [ ] Add meaningful loader/merge cases for two lanes, one failed/denied lane, capped and unknown membership, changed local fields while awaiting, pending write/rollback and late scope generations. Assert that collection invokes zero rendered setters/cache writes, and every read lease is released once. Keep manual cooldown/concurrency/glare/announcement assertions.
- [ ] Add `collectGroupRefresh(job)` to `useEngSprintData` and expose it alongside existing loaders. Collect the Product and Tech lanes via the same `fetchTasks` normalization/filtering/auth path, with `forceRefresh: true`, `useLoading: false`, `setErrorOnFailure: false`, `updateEpics: false`, no in-scope setter, `signal: job.signal`, `shouldApplyResult: job.shouldApply`. Capture normalized Epic metadata and per-source status locally. Do not consume the page-load cache-bypass flag as a side effect of this collector. Hold `ISSUE_EDIT_READ_TOKEN` leases through apply/disposal.
- [ ] Extend `createEpicRefreshController.refresh` and `useEpicRefresh.refreshEpic` with an optional second options object. Omitted options preserve current manual behavior. Automatic options use the same admission slots/edit protection and guarded load path but skip the manual 400ms floor, busy UI, glare, announcement, adoption event and unconditional aggregate invalidation.

```js
// New optional call contract; all existing one-argument manual calls remain valid.
refreshEpic(epicKey, {
    source: 'automatic',
    signal: job.signal,
    shouldApply: job.shouldApply,
    deferFollowUps: true,
});
```

`source` accepts `manual` / `automatic`; default is `manual`. `deferFollowUps` places alert/dependency/subtask work in the owning adapter's guarded follow-up phase. A competing manual per-Epic click cancels the automatic job before admission; both modes share the existing two-slot limit and scoped cooldown/breaker. The controller returns an accepted-result descriptor, not a fabricated success on ignored/failed lanes.

- [ ] Extend the pure patch module with `mergeEngScopeSnapshot` using its existing key comparison/edit-protection helpers. Input is held/fetched Product or Tech items, normalized metadata, current protected keys, request snapshot and source coverage. Preserve equal object references, accept new keys, update unprotected fields; remove absent keys only when membership is proven complete. Unknown/capped/failed lanes retain unproven held members. A lane denial cannot be used to display newly unauthorized data; explicit access removal retires that item and falls back to an authorized anchor.
- [ ] Wire the compatible ENG adapter: one anchor Epic's two targeted calls first, then the collector's two broad calls. Avoid `loadMeasuredGroupTasks` for automatic collection because it uses wholesale loading/replacement. Reuse existing `loadPerformance` observations without inventing GA4 fields. Do not force Sprint discovery, clear mounted arrays, reset unrelated Stats sources, or run alerts before accepted primary data. Record `Retry-After` before the existing response-error conversion loses it; retain current error codes/public array-return contracts for legacy loaders.
- [ ] Guard the existing dependency/subtask/alert follow-ups with the same job and current source scope. Use the `epicRefreshDependencySkip` mechanism so accepted list changes do not also trigger an unguarded full-department dependency effect. Catch Up follows its existing alert owner; Planning/Board/Stats do not acquire Catch Up bundles. Hold old alerts on partial failure.

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_controller.js tests/test_epic_refresh_patch.js tests/test_epic_refresh_alerts.js tests/test_epic_refresh_dependency_skip.js tests/test_epic_refresh_source_guards.js tests/test_dashboard_freshness.js
fnm exec --using 20 npx playwright test tests/ui/dashboard_data_freshness.spec.js tests/ui/eng_epic_refresh.spec.js --browser=chromium --workers=2 --reporter=line
```

Expected: new hidden/late-response regression green, four primary calls maximum without retry, targeted phase before broad, no automatic manual-event/glare. The movement regression closes in Task 5; do not remove it to make this task appear complete.

## Task 5: Preserve one reading context and compensate the real container

**Create:** `frontend/src/eng/engReadingAnchor.js`, `tests/test_eng_reading_anchor.js`.
**Modify:** `dashboard.jsx`, `useEpicRefresh.js`, `PlanningReviewTable.jsx`, `styles/dashboard.css` and the freshness/Epic browser specs from the map.

- [ ] Test pure order projection and movement fences with synthetic keyed Epics/Stories: remote priority change, added/moved/filtered/deleted item, unavailable access, anchor release and a second navigation. Assert canonical arrays/totals/export never receive the presentation-only exception. There can be only one retained Epic and one bounded Story key order.
- [ ] Implement `captureEngReadingAnchor`, `restoreEngReadingAnchor` and `projectEngReadingOrder` in the new helper. The first two receive DOM/container access and measured visible bounds; the third is pure. Anchor selection is open detail/active interaction, then last deliberate visible interaction, then first real visible Story/Epic below measured sticky tiers. Use existing `data-epic-key` / `data-task-key`; add stable row attributes to the Planning table if needed. Hover is not an intent. Track user movement separately from compensation so internal scrolling cannot release the pin or rewind a new user position.

```js
// Pure projection used only by the render model; source arrays stay canonical.
export function projectEngReadingOrder(items, heldKeys, keyOf) {
    const rank = new Map(heldKeys.map((key, index) => [key, index]));
    const retained = items.filter(item => rank.has(keyOf(item)))
        .sort((left, right) => rank.get(keyOf(left)) - rank.get(keyOf(right)));
    const additions = items.filter(item => !rank.has(keyOf(item)));
    return [...retained, ...additions];
}
```

Use this only for the pinned Epic's Story order. The Epic-level projection keeps that one Epic in its previous slot while other Epics follow canonical order; do not freeze every Epic with the same helper. Explicit sorting clears the exception first. New Stories append within the pinned presentation until release; their source order/priority remains canonical.

- [ ] Capture immediately before each synchronous guarded commit, then restore after two settled layout frames only if identity and user-movement epoch still match. Measure the anchor's container-relative offset before/after, apply the delta once, and clamp to the available range. Do not combine independent window and pane compensation. Story → Epic → nearest authorized surviving item → clamped previous offset is the fallback order. Test native browser anchoring to prevent double compensation.
- [ ] Represent an authoritative filter/scope departure as one clearly marked temporary reading item outside normal scoped arrays. Exclude it from selection, totals, export and write handlers; release when the reading context ends. If access is explicitly unavailable/revoked, remove immediately instead of holding. Unknown broad membership alone does not establish departure. Use existing text/tokens, no extra toolbar or card animation.
- [ ] Run the red baseline movement case against the new implementation and require ≤2 CSS pixels, stable DOM identity for unchanged rows and no forced restoration after user scroll/navigation during the request. Cover changed height, sticky Planning panels, horizontal sheet scroll and desktop/touch fallback. Capture settled synthetic screenshots and menu/sticky geometry assertions.

```bash
fnm exec --using 20 node --test tests/test_eng_reading_anchor.js tests/test_epic_refresh_patch.js
fnm exec --using 20 npx playwright test tests/ui/dashboard_data_freshness.spec.js tests/ui/eng_epic_refresh.spec.js tests/ui/planning_review_integration.spec.js --browser=chromium --workers=2 --reporter=line
python3 -m unittest tests.test_codebase_structure_budgets
```

Expected: both known-defect regressions now green; manual refresh contracts and sticky/selection behavior preserved.

## Task 6: Preserve ordinary and strict Board reading state

**Modify:** `useEngBoardData.js`, `useStrictEngBoardIntegration.js`, `EngBoardView.jsx`, `dashboard.jsx`, Board owner/integration/browser tests and the freshness spec.

- [ ] Add strict-owner tests that hold each NDJSON frame, blur or change scope/config, then release it. Assert current rendered data unchanged until compatible guarded acceptance, retired measurements not published, old request/frame generations ignored and authority not borrowed from Sprint task data.
- [ ] Extend the Board owner's existing refresh options with automatic job options; defaults retain manual/initial progressive-loading behavior. For an automatic refresh, retain the compatible rendered snapshot and reduce incoming frames into a staged working projection. Commit authoritative compatible columns without ever exposing an empty read Epic. Abort signal and `shouldApply` gate every frame/cache/publication boundary. When identity is incompatible, retire instead of merging. Keep existing stream/parser/deadline/byte/fan-out limits.

```js
// Existing Board owner refresh gets an optional options argument.
strictBoardData.refresh({
    source: 'automatic', signal: job.signal, shouldApply: job.shouldApply,
    preserveRenderedSnapshot: true,
});
```

Propagate these options through `useStrictEngBoardIntegration`; do not bypass its transactional issue patch owner. Successful automatic reads only retire local patches covered by accepted current data; pending/failed/rolled-back writes keep their existing reconciliation. No write is aborted or replayed by freshness.

- [ ] Capture every expanded `.col-body` scroll position plus the open detail Epic/Story anchor, focused/starred column and collapsed set. Restore only unchanged user-movement epochs per pane. Ordinary Sprint Board uses the accepted silent Sprint snapshot from Task 4 and the same view-preservation helper; strict Component/All work uses one focused-column-first stream, zero `purpose=epic-refresh` calls. In touch/document layout use the actual document container.
- [ ] Require open detail, unchanged card DOM identity, pane offsets ≤2px, no empty detail flash, no column/scope/star reset, and cancellation on every delayed frame. Explicit removal/access denial follows Task 5 fallback. Test user scrolling one pane while another refreshes; compensation must not move that pane back.

```bash
fnm exec --using 20 node --test tests/test_eng_board_data.js tests/test_strict_eng_board_integration.js tests/test_eng_board_stream.js tests/test_eng_board_mutation_coordinator.js
fnm exec --using 20 npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_board_stream.spec.js tests/ui/dashboard_data_freshness.spec.js --browser=chromium --workers=2 --reporter=line
python3 -m unittest tests.test_eng_board_routes tests.test_eng_board_stream tests.test_eng_board_service
```

Expected: existing progressive initial/manual Board behavior remains; automatic strict work is one stream with its current authority, pane/detail assertions pass.

## Task 7: Protect Planning drafts, review revisions and capacity

**Modify:** `usePlanningSprintReview.js`, `useEngCapacity.js`, `PlanningReviewTable.jsx`, `dashboard.jsx`, mapped review/capacity tests and the freshness spec.

- [ ] Add controller/browser cases for dirty cells, schema/layout edits, focused local input not yet committed, save in flight, unconfirmed save, 409 conflict, deliberate discard/rebase and row changes after primary reconciliation. The pending freshness intent must survive every temporary block; automatic reads must not update a dirty base revision or save/discard a draft.
- [ ] Feed concrete eligibility from `planningReview.dirty/loading/saving/conflict/unconfirmed/pendingScopeChange`, local active table editor and existing pending issue/capacity mutations. Add optional automatic options to `planningReview.refresh` and check them around schema and values acquisition/commit. Preserve normal manual/conflict recovery. Do not rely only on App's guard: the owner must reject a newly dirty draft after an awaited response.

```js
// Planning automatic admission in the owner and App:
const blockedReview = review => Boolean(
    review.dirty || review.loading || review.saving || review.conflict ||
    review.unconfirmed || review.pendingScopeChange
);
```

`review` is the current public controller snapshot, not a captured request-start value. Keep row admission by current `rowKind`, immutable `issueId`, shared workspace/Sprint and capabilities. The existing values-read POST still fetches a CSRF token through `sprintReviewApi`.

- [ ] Hold capacity scope while the two primary phases settle; use the existing `capacityScopeHoldRef` and nonce contract. After clean guarded primary acceptance, invoke review once and capacity once. Coalesce the row-signature-triggered review effect with the explicit automatic follow-up; do not double-load or bypass current review read limits. Release the hold in `finally`, including blur/errors. Failed follow-up leaves held values and its own failed check status.
- [ ] Assert document anchor and `.planning-review` sheet horizontal offset, selected rows, column layout, mounted input value/focus and Save/Discard behavior. Keep Table Filters/capacity ordering, view-controls slot and sticky stack intact. Test a new user scroll during primary or follow-up reads and save conflict/rollback after return.

```bash
fnm exec --using 20 node --test tests/test_planning_sprint_review.js tests/test_use_eng_capacity.js tests/test_planning_capacity_utils.js
fnm exec --using 20 npx playwright test tests/ui/planning_review_integration.spec.js tests/ui/planning_capacity_editing.spec.js tests/ui/dashboard_data_freshness.spec.js --browser=chromium --workers=2 --reporter=line
python3 -m unittest tests.test_oauth_capacity_routes tests.test_endpoint_security_matrix
```

Expected: clean follow-ups once per generation; no automatic work/write/base-revision changes while dirty/unsafe; existing explicit conflict/save recovery remains green.

## Task 8: Use active Statistics and EPM owners without broad manual work

**Modify:** `stats/useStatsData.js`, `epm/useEpmViewData.js`, `api/epmApi.js`, `dashboard.jsx`, mapped Stats/EPM tests and the freshness spec.

- [ ] Add active-source tests for each Stats path: task-derived priority/Team statistics, burnout, cohort, excluded-capacity/mono-cross-share/Project Track and phase durations when currently required. Source-only modes must issue zero task/Catch Up requests; task-derived modes use one silent two-lane scope check with no Epic target. Range/facet/control state, chart nodes and inner scroll remain stable.
- [ ] Add an optional automatic refresh input to `useStatsDerivedA/B/C` at their existing lifecycle positions, carrying the job and refresh nonce. Keep current query keys/debounce/30s timeout and existing excluded-source concurrency; forward the job signal and aggregate read fence. Automatic source fetches bypass only the relevant existing cache, hold current display and do not clear data on recoverable failure. Guard progressive chunks, cache writes and final setters. Do not reset every Stats cache from a list refresh. Display facets keep client-side regrouping semantics. Preserve the tested existing return-key interfaces.

```js
// Optional hook input; absent means the existing initial/manual lifecycle.
automaticRefresh: { job, nonce }
// In each active source effect, before acquisition or any cache/data setter:
if (automaticRefresh && !automaticRefresh.job.shouldApply()) return;
```

`job` is the Task 2 contract; `nonce` changes only for a relevant automatic intent, not every App render. Use current dependency/query-key guards in addition to this check. The effect's cleanup aborts only its read, not any save or collaboration transport.

- [ ] For EPM, extend `refreshEpmView` with optional job options; collect metadata for the current lifecycle/sub-goal scope first, then the selected project's rollup or one existing aggregate request. Forward signals in the three API wrappers; the metadata wrapper may use its existing server-supported `refresh=true`. Keep selected project/goal/tab/Sprint and held tree/boards until guarded acceptance. Do not reset selection to All Projects while metadata is pending, including background failures. Coalesce effects triggered by the accepted project array so they cannot add a second rollup.
- [ ] Classify EPM rollup reuse honestly: current per-project cache can return `Server-Timing: cache;dur=1`, and the wrappers otherwise discard response provenance. Preserve optional provenance locally when collecting or use `checkKind: 'unknown'`; do not promise a forced rollup or add a server bypass. A token-required response keeps the existing Home connection/settings behavior; every 401 is terminal. Metadata-only cards retain their Settings CTA.
- [ ] EPM browser tests assert held project card/detail, collapsed set, ≤2px Project anchor offset, exact label and selected-Sprint request scope, one metadata-before-rollup sequence and zero per-project client fan-out. Keep Home token/Jira OAuth/current private-view ownership boundaries; no service fallback or migration probe.

```bash
fnm exec --using 20 node --test tests/test_use_stats_data.js tests/test_stats_module_extraction_source_guards.js tests/test_epm_view_source_guards.js tests/test_epm_private_seed_pins.js
fnm exec --using 20 npx playwright test tests/ui/epm_initial_config_load.spec.js tests/ui/epm_project_progress.spec.js tests/ui/dashboard_data_freshness.spec.js --browser=chromium --workers=2 --reporter=line
python3 -m unittest tests.test_oauth_stats_routes tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_epm_home_cache_isolation
```

Expected: only active-source reads; source check classifications match evidence; held EPM/Stats UI remains on failures; auth/workspace isolation tests pass.

## Task 9: Wire Scenario/Settings eligibility and truthful compact status

**Modify:** `useDashboardFreshness.js`, `dashboard.jsx`, `styles/dashboard.css`, `tests/ui/dashboard_data_freshness.spec.js`, `tests/test_analytics_source_guards.js` and documentation in the map.

- [ ] Feed current dirty/edit/save/lock eligibility from existing owners: `scenarioHasUnsavedChanges`, the Scenario drag/edit/draft transition cells, `showGroupManage && isGroupDraftDirty`, `anyFieldConfigDirty`, and all open Settings sections' existing dirty/saving state. Audit the actual Settings composer outputs rather than guarding only Department drafts. Refresh must never invoke Save, Discard, publish, recompute/replace Scenario draft/history, renew auth credentials itself, or widen write targets.
- [ ] Register Scenario's automatic Jira acquisition through the silent task owner when the source scope is eligible and the draft is clean. Preserve Scenario draft/history/selection state and keep its own base-revision/remote-conflict decisions. If any update would change the draft base implicitly, defer that application until the owner explicitly admits it. Leave `useScenarioRealtime` events/presence and `useScenarioDrag` lock renewal outside the scheduler; no global HTTP/fetch focus veto.
- [ ] Render one compact source-check summary adjacent to the existing header Refresh control. Use a `<span>` in existing header typography; ordinary relative-age display must not issue a network request. Copy states: `Updates pending`, `Could not check; showing previous data`, or `Checked … ago` qualified with `partial results` / `coverage unknown` as appropriate. Cached/unknown provenance must say `Cached data; check unavailable` rather than advancing the last forced-check time. Keep the prior readout if a source fails; don't claim every source checked when one lane failed. No per-Story toast, new toolbar, focus-stealing live announcement or new permission UI.

```jsx
<span className="dashboard-freshness-status" data-dashboard-freshness-status>
    {freshnessSummary}
</span>
```

`freshnessSummary` is the hook's projection of active-source records and pending/failure state. It carries no issue identities. Measure header/control geometry at desktop/touch sizes and keep existing Refresh disabled/explicit behavior.

- [ ] Update `docs/README_ANALYTICS.md`: automatic acquisition, age readout and anchor retention use the No-Event Allowlist (`trigger=none`, `event_type=none`, `event_name=none`, `feature_name=data_freshness`, no typed custom params). Existing allowlisted `api_result` enum/bucket telemetry continues. Manual per-Epic `epic_refresh_action` stays `trigger=userevent`, `event_type=event`, `feature_name=epic_refresh`, once per applied manual click; automatic reads emit zero. Add a browser assertion for both event counts and source guard against raw IDs/content/coordinates/timestamps. Keep `GA4_ENABLED` and the two GTM triggers; no new dimensions or GA4 runbook changes.
- [ ] Update workflow docs, ontology and plan index with implemented behavior and actual remaining gates. Do not mark this plan DONE until final verification and acceptance/merge. Record limitations: continuous focus has no age bound, cached/unknown source coverage and any unmeasured live latency/OS lifecycle case.

```bash
fnm exec --using 20 node --test tests/test_analytics_source_guards.js tests/test_analytics_events.js tests/test_scenario_draft_history_source_guards.js tests/test_dashboard_freshness.js
fnm exec --using 20 npx playwright test tests/ui/scenario_draft_history.spec.js tests/ui/scenario_draft_collaboration.spec.js tests/ui/dashboard_data_freshness.spec.js --browser=chromium --workers=2 --reporter=line
```

Expected: dirty/save/lock intent preservation and existing collaboration pass; automatic manual-event count zero; compact UI has settled screenshots/geometry evidence.

## Task 10: Verify every Definition of Done gate and prepare delivery

**Modify:** generated `frontend/dist/` and the completion record below. Other changes only to fix a failure within the authorized map; scope/contract changes require an explicit plan revision.

- [ ] Run the browser matrix for 11m/exactly 12m/13m/8h/24h with valid, expired and revoked auth. Verify actual auth/data/document/asset counts, one pending intent through all blockers, BFCache restoration and fresh-document bootstrap. Exercise retained real sleep/wake separately, record observed lifecycle events and resulting checks. An environment-blocked required lifecycle check remains open; fake time is not substitute evidence.
- [ ] Complete all seven surface rows in the approved design, including ordinary Sprint Board and strict Component/All work. Require anchor displacement ≤2 CSS pixels after settled layout, no rewind after user movement, stable unchanged DOM/editor identity and preserved vertical/horizontal/pane state. Test filter departure, moved/deleted anchor, explicit access loss, partial/capped data, source failures and all scope/config/principal races.
- [ ] Repeat the Task 0 synthetic cost campaign on equivalent scopes. Record request/response bytes, application and available upstream page/attempt counts, first anchor application and scope-check timing, initial request count and first useful content. Do not infer Jira cost from browser requests alone or claim unmeasured live improvement. Initial-load counts must not increase; freshness follow-ups cannot gate first content. Server budgets remain unchanged.
- [ ] Run build, full frontend unit suite, full Python suite and full Chromium UI suite. Required feature cases must not be skipped; record unrelated/environment skips accurately. Inspect complete failures, not only summaries. Use documented Python/runtime selection and no unmanaged installations.

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npm run test:frontend:unit
python3 -m unittest discover -s tests
fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4 --reporter=line
git diff --check
```

Expected: all required checks pass. If shared header/menu geometry changed, include layering/icon/control assertions and settled screenshots. When emoji/form-control geometry is affected, run the repository's headed Firefox/WebKit glyph guard as well. Do not add a CI UI job.

- [ ] Review code and contracts inline using `docs/plans/AGENTS.md`: old automatic manual listener removed; auth/cache/check meanings distinct; every adapter guards acquisition/commit/follow-up; read leases/cancel handlers closed; no unauthorized content retained; dirty/rollback/conflict/remote-event journeys preserved; no forbidden credential or mutation path. Run existing backend endpoint/security and worker-auth tests; if a backend fix became approved, include real no-request-context wrapper coverage and startup `/api/test` checks before claiming success.
- [ ] Inspect complete diff against the map and approved policy. Before any separately authorized implementation commit/push/PR, fetch intended base, record exact base/head, inspect `git status --short`, `git log --oneline origin/<base>..HEAD`, `git diff --name-status origin/<base>...HEAD`, commit count and every changed path. Stop on unapproved history/scope. Publication is one blocking transaction under root instructions; do not push until explicit confirmation and required full gates pass.
- [ ] Rebuild at the exact committed implementation head and require no generated diff. Record evidence per gate below; seek acceptance of the verified result. After acceptance or merge, rename EXEC to DONE and update links/status with execution revision or PR. A docs-only planning commit does not satisfy any feature gate or authorize issue closure.

## State-machine verification ledger

| Transition | Required result / primary task |
| --- | --- |
| Hidden or visible-but-unfocused; response arrives | Retire read/staged result/retry; held content untouched; no follow-ups; Tasks 2–6. |
| Focus return during bootstrap/loading/onboarding | One pending current-context intent; resume after owner ready without duplicate bootstrap; Tasks 2–3. |
| Draft dirty, local editor, drag, save, unconfirmed save, conflict | Defer acquisition/application, retain draft/base revisions; Tasks 4, 7, 9. |
| Explicit Refresh/sort/new Epic/scope change | Release reading exception; manual supersedes auto; old context cannot commit; Tasks 3–6. |
| User scrolls during fetch or layout settlement | Movement fence prevents rewind; unaffected containers may restore independently; Tasks 5–7. |
| Network failure / 429 / retry deadline passes while blurred | Retain held data and truthful failed/pending status; one guarded retry at most; Tasks 2, 4, 8. |
| Pending write succeeds/fails/rolls back; remote revision arrives | Existing mutation coordinator/base revision/conflict decisions prevail; no automatic write/replay; Tasks 4, 6–7, 9. |
| Auth-required response from any delayed owner | Terminal mounted sign-in screen; no local/raw401 UI, unlock in place or replay; Tasks 2–3, 6, 8–10. |
| Workspace/site/user/config/surface/range changes | Retire old observations/staged data; no cross-partition application or credential fallback; Tasks 2, 6, 8. |
| BFCache, retained sleep/wake, discarded/new document | Observed lifecycle check versus ordinary bootstrap recorded separately; Task 10. |

## Planning review and completion record

Planning review on 2026-10-09: file map and current entry points traced; no backend contract migration planned; endpoint auth/CSRF distinctions and ownership preserved; strict Board, Planning dirty state, EPM cache provenance, Scenario collaboration and all eight Definition of Done gates assigned concrete tasks. Remaining source/lifecycle measurements are explicit Task 0/10 gates. This is a reviewed plan, not a report of implemented behavior.

Baseline evidence already obtained: 18 auth-focus Node cases, 53 Epic/Team merge/controller cases and 10 Chromium auth-count cases passed. Two current-source Catch Up synthetic probes reproduced 330.08px reading displacement/remount/scroll reset and hidden response application. These are evidence for the problem, not acceptance of the proposed solution. See the design for exact commands, fixture conditions and limitations.

| Definition of Done gate | Task coverage | Implementation evidence / result |
| --- | --- | --- |
| 1. Unfocused work stops | 1–4, 6–9 | Open; not executed. |
| 2. Long returns recover without navigation | 2–3, 10 | Open; real lifecycle evidence required. |
| 3. Reading context stays stable | 1, 4–7, 8–10 | Open; ≤2px and movement-fence cases required. |
| 4. Relevant bounded acquisition | 2, 4, 6–8, 10 | Open; ordered counts and upstream limits required. |
| 5. Honest freshness evidence | 0, 2, 4, 8–9 | Open; source provenance/coverage assertions required. |
| 6. Safe edits/failure recovery | 2–4, 6–9 | Open; dirty/conflict/rollback/auth negatives required. |
| 7. Every affected surface | 4–9 | Open; all seven surface rows required. |
| 8. Regression/cost/delivery evidence | 0–1, 9–10 | Open; full verification and acceptance required. |

Execution record must name exact revision, every command's actual pass/fail/skip result, before/after measured values, screenshot references and accepted exceptions. No required skip closes a gate. Keep secrets, live Jira fixture content, local machine paths and production identifiers out of committed evidence. No implementation revision or acceptance has been recorded.
