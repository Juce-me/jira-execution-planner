# ENG Board scope and performance regressions — issue #190 implementation plan

> **Selector supersession (2026-09-14):** [ENG shared Sprint selector availability](EXEC-eng-board-scope-selector-availability.md) supersedes this plan's requirement that missing authority, missing Department prerequisites, or unresolved capability disable Component/All work and make their handlers no-op. The implemented selector now accepts the user's scope intent, preserves the saved ordinary Sprint, and shows an explicit loading/setup/error state while issuing zero strict or ordinary fallback requests until authority is ready. This plan's backend authority, Sprint-catalog, stream, measurement, resource-limit, and historical verification evidence remain current; its old disabled/no-op UI assertions must not guide future work.

> **Startup correction (2026-09-12):** Authenticated localhost validation exposed a Sprint-readiness regression after this plan was implemented: OAuth had no reusable Sprint catalog and the dashboard rendered saved-sprint work before Jira validated the catalog. The user rejected the plan's clickable-loading-selector requirement. The local correction adds a user-partitioned 24-hour process cache, gates all ENG Jira work on a non-empty cached or live Jira catalog, and keeps the Sprint selector disabled while discovery is pending or unavailable.

> **Status: In progress; implemented locally with one verification gap.** Reviewed and executed on 2026-09-12 against the current working tree on `bugfix/board-progressive-loading`, HEAD `40bffe730159ebadb1904b0188981c853fdf85ed`. The implementation remains uncommitted. Saved-authority gating, Component measurement persistence/filtering, production-shaped fixtures, documentation, build, and automated regression suites are complete; the new dual-scope held-child departure/late-frame browser case remains unresolved after two failed setup attempts.
>
> **Execution:** Use `superpowers:executing-plans` task by task. This document covers only the two current regressions reported after [the progressive-loading implementation](EXEC-eng-board-progressive-loading-190.md). The user explicitly excluded existing gates: do not read, validate, run, or update gate documents for this work. No commit, push, PR, worktree, configuration change, or Jira write is authorized by this plan.

**Goal:** Prevent invalid cross-sprint requests, preserve Component measurements, and require cached or live Jira Sprint values before the ENG dashboard becomes operable.

**Architecture:** Reuse saved workspace configuration, the top Sprint selector, the existing strict Board owner, and the existing observation/report service. Add project availability to the frontend predicate and Component to the backend measurement allowlists. Keep Jira authority, pagination, progressive response validation, storage ownership, and request budgets unchanged.

**Tech stack:** React 19, esbuild and Node 20; Flask, SQLAlchemy, the existing Python virtual environment; unittest, Node tests and Playwright.

## 1. Findings, ordered by severity

### P1 — cross-sprint options ignore saved Jira project authority

- **Location:** `frontend/src/dashboard.jsx:13652`; option predicates at `:13654`, handler guards at `:13711` and `:13714`. Authority is resolved by `backend/routes/eng_board_routes.py:312` and enforced by `backend/services/eng_board.py:92`.
- **Violated contract:** Component and All work require saved workspace-selected Jira projects or a saved Jira source Board whose project can be resolved. Department Board columns are a separate configuration and do not provide Jira project authority. Catalog completion and strict-adapter availability are also necessary.
- **Failure:** With saved projects empty and saved Board ID empty, the current frontend enables both options after catalog loading. Selection reaches preflight and cannot start a stream. The service raises `board_project_scope_required`; `_public_eng_board_error` maps config-phase errors to public HTTP `409` / `board_config_invalid`. Do not change this mapping merely to match an internal diagnostic name.
- **Smallest correction:** Extend `boardConfigAvailable` using `savedSelectedProjects` and trimmed `savedBoardId`. Preserve `!sprintsLoading`, the existing Components/Teams conditions, and both guarded click handlers. The later authenticated startup correction also blocks the Sprint control and ordinary ENG data until a non-empty catalog validates the saved selection.
- **Missing coverage:** `tests/ui/eng_group_board_view.spec.js:158` returns no selected projects but still returns strict success. Its `/api/config` also lacks the DB bootstrap's `sharedConfig` and integer `sharedConfigRevision`. `tests/ui/eng_board_dashboard_fixture.js` repeats the same mismatch. Cover selected projects, saved Board fallback, missing authority, and delayed config/catalog responses with consistent endpoint-shaped fixtures. Exercise real backend fallback resolution rather than mocking a successful snapshot as proof of fallback.

### P2 — Component observations and report filters are rejected

- **Location:** `backend/services/load_performance.py:70`, null-sprint condition at `:72`, report filter allowlist at `:259`; test helper `tests/test_load_performance.py:30` also assigns Component a fabricated sprint.
- **Violated contract:** Board observation `scopeType` accepts `all_work`, `component`, and `sprint`; the two cross-sprint scopes require `sprintId: null`. Ingestion, persisted reporting, and filter choices must preserve the same scope.
- **Failure:** An otherwise valid Component payload returns HTTP `400 {"error":"invalid_measurement"}` and is not persisted. A Component report filter raises `Invalid scope type`; the admin route returns `400 invalid_performance_filters`. Thus Component diagnostics cannot support operational verification even when the Board stream succeeds.
- **Smallest correction:** Add `component` to both service allowlists and apply the null-sprint requirement to both cross-sprint values. Correct the fixture helper's conditional. The frontend already emits null for every non-sprint scope; its production emitter, database schema, and report UI need no behavioral change.
- **Missing coverage:** Add validation positives/negatives, a committed-session persistence round-trip, Component filtering before query limits, OAuth HTTP `201` plus duplicate `200`, HTTP report retrieval, and actual frontend emission assertions. Existing measurement tests mostly exercise All work and Sprint.

These findings describe the current branch's unresolved defects. They are not claims that the latest uncommitted diff newly introduced both predicates: the missing authority check and performance allowlists are already present at HEAD.

## 2. Reviewed production contracts

Read-only sources: `backend/security/CONFIGURATION_OWNERSHIP.md`, `backend/routes/settings_routes.py`, `backend/routes/eng_board_routes.py`, `backend/services/eng_board.py`, `backend/security/policy.py`, `backend/security/guards.py`, `frontend/src/api/configApi.js`, `frontend/src/api/performanceApi.js`, `frontend/src/eng/useEngBoardData.js`, `frontend/src/eng/useStrictEngBoardIntegration.js`, and `frontend/src/settings/PerformanceSettings.jsx`.

| Surface | Request and authority | Success and errors | Required proof |
| --- | --- | --- | --- |
| Config bootstrap | `GET /api/config?includeViewConfig=true`, existing authenticated workspace context; no body or new CSRF requirement | DB response includes `boardAllWorkAvailable`, `sharedConfigRevision` integer, `sharedConfig.projects.selected`, `sharedConfig.board.boardId`; existing errors unchanged | Saved values populate availability without opening Settings or fetching extra catalogs |
| Section reads | `GET /api/projects/selected`, `GET /api/board-config`; same workspace config | `{selected:[{key,type}], configRevision}` and `{boardId,boardName,source,configRevision}` in DB mode | Fixture values agree with bootstrap; no draft or optimistic value supplies authority |
| Strict Board | `GET /api/eng/board?departmentId=department-a&scope=component&refresh=0` or `scope=all_work`; optional existing focus parameter; omit `sprintId` entirely | DB/OAuth capability only. NDJSON `200` is transport start; success requires valid authoritative terminal completion. Missing project authority gives public `409 board_config_invalid`, denied project `403 board_permission_denied`; existing auth/unavailable/stream errors remain unchanged | No request from disabled choices; real capture resolves saved projects/fallback and verifies project access before issue searches |
| Observation context | `GET /api/performance/context`; existing authenticated read | `{enabled:boolean}` | Preserve collection opt-out and DB requirement |
| Observation ingestion | `POST /api/performance/loads`; existing authenticated `user_write`; OAuth requires token-bound `X-CSRF-Token` and `X-Requested-With: jira-execution-planner` | Schema-v1 Board payload below. `201 {recorded:true}`, duplicate `200 {recorded:false}`; invalid payload `400`, CSRF `403`, disabled `404`, oversized `413`, storage failure `503` | Component goes through real validation and persistence; workspace/environment/revision come from the server |
| Operational report | `GET /api/admin/performance?surface=eng_board&scopeType=component`; authenticated explicit tool admin; no body | `200` with `samples`, `summary`, `trend`, `filters`; invalid filters `400`, non-admin `403`, storage failure `503` | Component round-trips with null sprint, appears in scope choices, filters in SQL before limits; other workspace/environment rows remain excluded |

All application API `401` responses retain the global terminal sign-in recovery contract. Observation failures other than auth recovery remain best-effort and cannot fail Board rendering. Do not add a feature-local auth recovery path.

**Authority distinction:** A nonblank saved Board ID is a frontend prerequisite for attempting fallback, not proof of a valid Jira project. `_resolve_projects` reads its Jira `location.projectKey`, then checks the complete accessible project catalog. Keep this backend enforcement. Do not authorize from `projectsConfigured`, draft controls, Department columns, the selected Sprint, a browser project parameter, or arbitrary JQL. Selected projects take precedence over Board fallback.

**Canonical names:** Jira source Board = administrator-owned `sharedConfig.board`; Department Board = shared group `group.board.columns`. Component scope = exact Department `missingInfoComponents` matched on Epics. All work = Component Epics union eligible Team-work parent Epics. Ordinary Sprint Board = the existing Catch Up snapshot rendered in Board columns.

## 3. Allowed file map and boundaries

All existing paths listed here were verified on 2026-09-12. Recheck before execution. Preserve current uncommitted edits; no reset, checkout replacement, or branch merge is part of this repair.

| Files | Allowed work |
| --- | --- |
| `frontend/src/dashboard.jsx` | Add saved project authority to the existing option predicate; clarify existing disabled-option title copy if needed, using concise explanatory text only |
| `backend/services/load_performance.py` | Add Component scope to validation/report filtering and enforce cross-sprint null sprint |
| `tests/ui/eng_group_board_view.spec.js` | Correct bootstrap/section fixtures; authority matrix, delayed discovery, zero-request and recovery assertions; capture Board observation POSTs |
| `tests/ui/eng_board_dashboard_fixture.js` | Consistent saved project authority for the existing joined stream campaign |
| `tests/test_eng_board_routes.py`, `tests/test_eng_board_service.py` | Missing-authority and real saved-Board resolution/access tests; preserve selected-project precedence |
| `tests/test_load_performance.py` | Correct fixture helper; validation, persisted filtering/reporting, isolation and HTTP coverage |
| `tests/test_load_performance.js` | Component/All work emission, null sprint, retirement, opt-out and telemetry-failure coverage |
| `tests/ui/load_performance.spec.js` | Component appears as a report scope option and is sent through the existing report API wrapper |
| `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map` | Generated with the normal build only; retain unrelated generated files unless the build actually changes them |
| `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`, `docs/ontology.md`, `docs/postmortem/MRT027-board-catalog-pagination.md` | After implementation, update affected Board prerequisite/measurement facts, verified links and regression prevention only |
| This plan, `docs/plans/EXEC-eng-board-progressive-loading-190.md`, `docs/plans/README.md` | Accurate execution status and evidence; do not rewrite historical test results as current acceptance |

No runtime edits to Board project resolution, capture, paging, stream protocol, owner lifecycle, Sprint discovery, Settings persistence, auth/security, or DB models/migrations are required by these findings. Any additional defect needs its own reproduction and scope assessment. No new endpoint, dependency, polling, per-issue enrichment, retry policy, or resource-ceiling increase.

## 4. Implementation tasks

### Task 1 — make the regression fixtures represent production configuration

**Files:** the two Board UI fixtures above, `tests/test_eng_board_routes.py`, `tests/test_eng_board_service.py`.

- [ ] Add `selectedProjects` and `savedBoardId` options to `installBoardFixture`. Default successful strict cases to explicit synthetic selected projects matching their fixture data, not empty authority. Keep missing-authority tests explicit: `selectedProjects: [], savedBoardId: ''`. For the joined fixture, use `ABC` to match `board_snapshot().projects`; retain source-root and real-HTTP passthrough behavior.
- [ ] Return production-shaped config and matching section reads. This is the authority portion to merge into the existing fixture response; retain its other required fields:

```js
const sharedConfig = {
    projects: { selected: selectedProjects },
    board: { boardId: savedBoardId, boardName: savedBoardId ? 'Synthetic Board' : '' },
};
// /api/config
const authorityConfig = {
    authMode: 'atlassian_oauth',
    boardAllWorkAvailable: strictBoard,
    projectsConfigured: selectedProjects.length > 0,
    sharedConfigRevision: 1,
    sharedConfig,
    boardId: savedBoardId,
    boardName: sharedConfig.board.boardName,
};
// /api/projects/selected -> { selected: selectedProjects, configRevision: 1 }
// /api/board-config -> { ...sharedConfig.board, source: 'config', configRevision: 1 }
```

- [ ] Make the synthetic strict response reject absent authority with public `409 board_config_invalid`, instead of succeeding regardless of configuration. Its positive Board-ID case remains UI-only evidence; test real backend fallback separately. Never use the frontend predicate itself as the fixture's authority oracle.
- [ ] Add a Playwright table for selected projects / Board-ID fallback / missing authority and run each across Component and All work. Use source-bundled dashboard code. For missing authority, require `aria-disabled=true` on both choices after catalog completion; dispatch a click event explicitly to test the handler guard, settle two animation frames, and assert zero strict requests and the unchanged saved Sprint label/cards. Use normal, unforced clicks for enabled choices to prove hit testing. Assert exactly one request per explicit successful choice and no `sprintId` query key.
- [ ] Hold `/api/sprints` with a releasable promise for both positive authority profiles. Before release: saved Sprint id/name and cached Board cards remain visible, the top selector opens by click and keyboard, both strict choices are disabled, and attempted handler events dispatch zero strict requests. Release in `finally`; after completion both become eligible without another bootstrap or Settings visit. Also hold config while sprint discovery completes to prove unresolved capability/authority cannot enable options. Preserve existing empty/failed catalog tests and active-Sprint fallback; this fix does not redefine an empty settled catalog as a pending request.
- [ ] Cover saved-value semantics: changing/clearing an unsaved Jira-source draft cannot enable/disable strict choices; only the successful persisted value may affect them. Keep capability false/null and missing Department columns negative cases. Team-only Department permits All work but keeps Component disabled.
- [ ] Extend the real capture/metadata route test pattern (`test_metadata_pagination_reaches_complete_board_for_both_scopes`) without mocking `_capture_snapshot`, `_resolve_projects`, or `normalize_projects`. Stub only auth/config storage and Jira I/O. For each cross-sprint scope, test selected projects (no Board lookup), empty selection + saved Board (`location.projectKey` then project-access catalog), no selection/no Board (zero issue searches), saved Board without a project (reject), and inaccessible fallback project (`403`, zero issue searches). Keep malformed/conflicting selected-project rejection and do not silently fall back from invalid nonempty selection.

Concrete missing-authority service assertion:

```python
def test_missing_saved_project_authority_is_rejected(self):
    with self.assertRaisesRegex(eng_board.EngBoardError, 'board_project_scope_required'):
        eng_board.normalize_projects([], saved_board_project_key=None)
```

Run under Node 20: `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1`. The new missing-authority UI assertion must fail on the reviewed source because both options become enabled. Backend authority protections should already pass. Do not interpret existing green tests as closure of this new regression.

### Task 2 — add the smallest frontend availability correction

**File:** `frontend/src/dashboard.jsx`, existing availability declarations near line 13652.

- [ ] Replace only `boardConfigAvailable` with:

```js
const boardConfigAvailable = boardAllWorkAvailable === true
    && Boolean(activeGroup?.board?.columns?.length)
    && Boolean(savedSelectedProjects.length || String(savedBoardId || '').trim());
```

- [ ] Keep `sprintCatalogReady = !sprintsLoading`, both existing Components/Teams predicates, and both click-handler early returns. Project authority must not gate ordinary Sprint Board, but Sprint readiness now gates the entire ENG surface: the selector stays disabled and Jira work stays hidden until a non-empty cached or live catalog validates the selection. Keep capability unresolved until bootstrap; do not infer it from sprint discovery.
- [ ] If updating existing disabled titles, include “saved Jira projects or a Jira Board” separately from “Department Board columns” and Components/Teams. Preserve the existing control and layout; no automatic Settings navigation or new control.
- [ ] Re-run Task 1's UI matrix. Switching Catch Up → ordinary Sprint Board must reuse the warmed snapshot without an extra tasks request or any strict request. Verify Board → Statistics/Planning → Board restores the saved Sprint and Board state under the existing behavior.

### Task 3 — validate, persist and filter Component observations

**Files:** `tests/test_load_performance.py`, `backend/services/load_performance.py`.

- [ ] Correct `board_observation` to use `sprintId='sprint-a' if scope_type == 'sprint' else None`. Add explicit validation cases for `component` and `all_work` with null sprint; reject non-null values including a saved sprint string, empty string, `0`, and boolean. Sprint still requires a valid nonempty string. Reject unknown scope values and retain schema/diagnostic bounds.
- [ ] Add a Component round-trip that commits the transaction, closes the writer session, opens a new reader session, and filters by `surface=eng_board`, `scopeType=component`, cache and cohort. Assert exact scope, SQL null sprint, no fabricated lanes, counts, diagnostics and timing values. Insert All work and Sprint rows too; Component filtering must exclude them. Use relative current timestamps, not expiring hard-coded retention dates.
- [ ] Add a limited-query regression: a newer All work row must not hide an older Component row with `limit=1`. Assert `filters.scopeTypes` contains Component, null is absent from Sprint choices, and scope filtering works both with and without the surface filter. Preserve workspace/environment exclusion, retention, duplicate-id handling and cohort separation; mixed Component/All work samples must not create combined latency percentiles.
- [ ] Add an OAuth HTTP test using the existing authenticated test context and in-memory SQLite session fixture, not a mocked `record_load`. Obtain the session-bound CSRF token through `/api/auth/csrf` and send both required headers. Component POST must return `201 {recorded:true}`, repeated same payload `200 {recorded:false}`; admin GET with Component scope must return exactly that persisted sample with null sprint. Keep missing-header/token, non-admin report, invalid extra-field and cross-workspace negatives. Apply the same null-sprint rejection to All work and Component HTTP samples.
- [ ] Run `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_load_performance`. Confirm Component validation/report/HTTP positives are red before changing production code.
- [ ] Change only the two allowlists and the cross-sprint condition in the service:

```python
if payload['scopeType'] not in ('all_work', 'component', 'sprint'):
    raise ValueError('Invalid Board scope')
if payload['scopeType'] in ('all_work', 'component'):
    if payload['sprintId'] is not None:
        raise ValueError('Cross-sprint Board scope must not fabricate a sprint')
else:
    _scope(payload['sprintId'])

# In load_report's existing per-filter validation:
if key == 'scopeType' and value not in ('all_work', 'component', 'sprint'):
    raise ValueError('Invalid scope type')
```

- [ ] Re-run the same module and confirm green. `LoadPerformance.scope_type` is already nullable `String(16)` and `sprint_id` supports null; no schema migration, backfill, query widening or index change is needed. Keep SQL filters before report row limits. The report request omits `sprintId` for cross-sprint queries; do not send the string `"null"` or invent a Sprint filter value.

### Task 4 — verify emitted measurements and user control

**Files:** `tests/test_load_performance.js`, `tests/ui/eng_group_board_view.spec.js`, `tests/ui/load_performance.spec.js`.

- [ ] Parameterize the existing complete Board-emission test over `['all_work', 'component']`. Pass `sprintId: 42` deliberately and assert the emitted `sprintId` is still null, `scopeType` is preserved, the full closed payload matches, and one accepted generation emits once after paint. Keep the separate ordinary Sprint test expecting string `'42'`. Exercise Component retirement/late-paint suppression, disabled collection and a rejected telemetry callback using the existing measurement methods.
- [ ] Add measurement capture to the Board fixture: `/api/config` enables collection, `/api/auth/csrf` returns a synthetic session token, and `/api/performance/loads` records parsed POST bodies and responds `201 {recorded:true}`. For each cross-sprint selection, use the real dashboard → strict owner → parser → measurement → API wrapper path. Assert one matching Board observation, null sprint, exact final counts/diagnostics and no Jira issue content; initial `eng_sprint` observations must be counted separately. Never fabricate diagnostic values merely to satisfy successful observation validation.
- [ ] Hold the observation response, and separately return `503` from it. Board completion, counts, selector and mode switches must remain usable, without another strict generation or duplicate observation. A separate Component report UI case supplies `filters.scopeTypes=['all_work','component','sprint']`, selects Component with the existing native select, and asserts `scopeType=component` is sent without a fabricated Sprint filter.
- [ ] Hold strict child completion using the existing synthetic stream/controller pattern. While candidates are visible, operate search/focus/collapse/detail controls as currently supported, open the shared Sprint selector, and return to the saved Sprint. Assert original cards restore, the departed generation cannot replace them after release, and retry happens only on explicit action. Repeat failure recovery for both strict scopes. No disabled child-derived filter or Work items export may become authoritative before completion.

Run: `node --test tests/test_load_performance.js tests/test_eng_board_data.js tests/test_strict_eng_board_integration.js` and `npx --no-install playwright test tests/ui/eng_group_board_view.spec.js tests/ui/load_performance.spec.js --workers=1` under Node 20.

### Task 5 — accuracy, performance, documentation and acceptance

- [ ] Run the existing production-stream campaign after correcting its config fixture: `npx --no-install playwright test tests/ui/eng_board_stream.spec.js tests/ui/eng_board_progressive_loading.spec.js --workers=1`. Verify real early card paint before held later pages, unchanged final deduplicated membership/counts, and cancellation/stale-result behavior. This is synthetic transport evidence, not authenticated production completeness.
- [ ] Preserve issue paging with `nextPageToken` / boolean `isLast`, project catalog paging with `startAt` / `isLast`, exact Component matching, All work union, parent-owned status, and final child authority. Required malformed pages still fail closed. Partial/capped loads remain explicitly incomplete and never become successful snapshots or authoritative zeros.
- [ ] Keep one strict generation per explicit scope change/retry, zero strict requests for missing authority and ordinary Sprint entry, and zero extra project/catalog/dependency requests introduced by the frontend guard. Keep the 30-second cooperative budget, two child workers, 1,000 admitted Epics, 10,000 children, 7,000-byte encoded query ceiling and existing wire/page limits. No performance promise is based merely on a passing build or HTTP `200`.
- [ ] In the already-open authenticated environment, verify disabled missing-authority behavior and Sprint recovery without changing workspace configuration. For an existing authorized configured scope, verify both real cross-sprint streams through terminal outcome and visible cards, exact displayed final counts against validated returned membership/children, and observation POST `201` plus admin Component retrieval when the current user already has that access. Do not create projects/Boards, change shared configuration, or acquire another user's credentials to make a positive live case pass. If no configured scope is available, record that precise limitation; synthetic fallback tests remain distinct evidence.
- [ ] Capture settled screenshots for missing authority, pending catalog with cached Sprint, enabled valid scopes, provisional cards, and final/recovered Board. Use normal clicks for enabled controls and retain element-level geometry/layering assertions; inspect the screenshots. Keep artifacts under ignored `tmp/` and use synthetic data for committed examples.
- [ ] Record before/after request counts, first visible Epic and terminal/settled duration separately on the same synthetic schedule. The guard should remove doomed requests without adding a fetch. No live speedup claim unless comparable successful samples exist; prior failed preflight runs are not a valid successful-load timing baseline. Leave unobserved timings null. Do not rerun the parent plan's unrelated measurement or external gates.
- [ ] Run focused Python verification: `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_load_performance tests.test_eng_board_service tests.test_eng_board_routes tests.test_eng_board_progressive_loading tests.test_eng_board_stream tests.test_eng_board_basic_compat tests.test_eng_board_source_guards`.
- [ ] After final changes, run `npm run test:frontend:unit`, `npm run build` under Node 20, and `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`. Record actual results, skips and warnings. Inspect the diff and generated output. Do not change structure budgets to hide an accidental expansion.
- [ ] Update only affected Board docs and the existing postmortem. Analytics review: disabled clicks emit no `filter_changed`; accepted existing selection events retain `trigger=userevent`, `event_type=event`, `event_name=filter_changed`, Board source and bounded `scope_type`. Accepted terminal analytics remain `event_name=api_result`, `feature_name=eng_board`, `api_surface=eng_board`, existing typed string enums/buckets and numeric duration. Operational measurements remain outside GA4. No new event for passive availability/catalog/render changes; record that allowlist reason in `docs/README_ANALYTICS.md`. Preserve the two-trigger transport and existing analytics gate; no taxonomy expansion or GA4 runbook change is required.
- [ ] Update plan outcome/current accuracy and index with actual tests and remaining live evidence. Keep `EXEC-*` until completed, verified and accepted or merged. Publication remains a separate explicitly authorized transaction under root instructions; do not issue an execution handoff to another task from unpublished artifacts.

## 5. Acceptance checklist

| Condition | Observable result |
| --- | --- |
| No saved projects or source Board | Both strict choices disabled after catalog settles; attempted handler actions send zero strict requests; ordinary Sprint cards/controls become usable once Sprint readiness succeeds |
| Valid saved selected projects | Both eligible choices enable only after catalog completion; one correct cross-sprint request per choice; no fallback Board lookup |
| Saved source Board only | UI allows fallback after catalog completion; backend resolves and access-checks its project; valid stream completes, missing/denied project still rejects |
| Config or sprint catalog pending | No newly enabled strict choice or Jira-work request; saved Sprint label may remain displayed, but the selector and ENG content stay blocked until catalog success |
| Team-only Department | All work eligible with valid project authority; Component disabled |
| Component observation | Full schema validates, persists with null sprint, POST returns `201`, duplicate `200`, report filter retrieves only matching rows before limits |
| Invalid scope/sprint | Unknown scope rejected; non-null cross-sprint sprint rejected; ordinary Sprint string contract unchanged |
| Loading, error, refresh or scope departure | Existing useful data/partial labels retained according to owner contract; controls work; late frames cannot replace current Sprint; telemetry cannot stall completion |
| Accurate and bounded data | Existing progressive/pagination/deduplication/terminal tests pass; final UI counts equal completed stream; no increased budget or added data fetch |

## 6. Review evidence and remaining uncertainty

This planning review ran on unchanged production source:

- Fetched `origin`; local HEAD and branch upstream matched exactly (`0` ahead / `0` behind). No working files were synchronized over the uncommitted implementation.
- `env CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_load_performance tests.test_eng_board_routes tests.test_eng_board_service`: **104 tests passed**. Negative Board cases produced expected rejection logs.
- Node 20 `node --test tests/test_load_performance.js tests/test_strict_eng_board_integration.js`: **14 tests passed**, with existing module-type warnings.
- Evaluating the current source predicate with no projects/Board ID produced both choices enabled; the same source with pending catalog produced both disabled.
- In-memory synthetic Component probes returned `Invalid Board scope`, `Invalid scope type`, and HTTP `400 {"error":"invalid_measurement"}`. The HTTP probe used the existing Basic test harness with a mocked authenticated context; the planned OAuth/CSRF route regression is stronger coverage and remains unimplemented.
- `normalize_projects([])` raised `board_project_scope_required`; a synthetic resolved Board project normalized successfully. This proves the normalization boundary, not an actual Jira Board lookup.

The user's authenticated browser observations remain the live incident evidence: cached Sprint reuse/restoration worked, while both strict scopes stopped at preflight. This review did not independently run a real Component/All work stream or claim a production speed improvement. Rejected historical observations cannot be recovered by changing validation; future successful collection is required. Existing gate documents were not read or modified. Upstream instruction-template retrieval was unavailable; local instructions were used without modification.

**Outcome:** Implemented locally with one verification gap. The production fixes and all other planned regression coverage are present in the working tree. No commit, push, PR, configuration change, Jira write, or authenticated live acceptance was performed.

**Current accuracy:** Accurate for the implemented authority predicate, Component measurement contract, fixtures, documentation, and completed automated evidence. The plan remains in progress because a new browser case that holds strict child completion, returns to the saved Sprint, then releases late frames was attempted twice but its injected Epic did not render; the unverified test block was removed rather than weakened. Existing owner-level late-frame and browser recovery tests remain green, but they do not close that exact dual-scope scenario.

### Execution evidence (2026-09-12)

- Expected RED: both missing-authority browser cases exposed enabled strict choices before the predicate change; Component validation/report/HTTP tests failed on the missing allowlists.
- Board UI source-bundle suite: 68 passed under Node 20.
- Strict-stream and joined progressive campaign: 14 passed under Node 20.
- Performance report UI suite: 9 passed under Node 20.
- Focused Board/performance Python suite: 173 passed.
- Focused Board/measurement Node suite: 94 passed.
- Full frontend unit suite and full Python discovery exited successfully; existing module-type and resource warnings remain.
- Production build completed successfully under Node 20 and regenerated the dashboard bundle/map.
- Authenticated live cross-sprint streams and admin Component retrieval remain unobserved; no speedup is claimed.
