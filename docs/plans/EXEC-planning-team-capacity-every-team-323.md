# Planning Team Capacity for Every Selected Team (#323) Implementation Plan

> **Status:** Ready for execution. Decisions D1–D4 and the G1 count were recorded on 2026-11-06; implementation not started; Task 9 remains gated by G2. Revision 3 (2026-11-06) incorporates two independent reviews of revision 1 and one re-validation of revision 2. Decisions D1–D4 and gates G1–G3 below must be answered before the tasks that name them. Branch: `feature/331-shared-planning`, on top of #331 Task 0.1 (PostgreSQL-only, single-use DB CSRF tokens).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Commit steps run only after the operator authorizes commits for this work.

**Goal:** Every displayed Team in Planning Table shows and edits its own stored "Team capacity (not in Jira)" for the selected Sprint, whether one, several or All Teams are selected. Other outcomes:
- the reconcile row can push a stored number to the matched Jira ticket in one click (after D1);
- the open #323 verification items are closed;
- Planning List is retired once #331's Table details are accepted.

**Architecture:**
- **Backend:** one additive, read-only batch route projects Team-level numbers (no person rows) with a single column-limited PostgreSQL query per chunk.
- **Frontend controller:** the per-backend assignee-capacity controller moves from one `current` queue to keyed per-Team owners. The one-Team strip and that Team's card share an owner.
- **App subscription:** App subscribes, through its existing single `useSyncExternalStore`, to a numbers-only Team map. Cards read per-Team load/save status from the provider context, so save-state changes never re-render App.
- **Cards:** `useEngCapacity` drops its one-Team gate and builds cards for the Team set chosen in D3.
- **Jira writes:** only through the existing App adapter `updateCapacityRequest` → `PATCH /api/capacity/<issue_key>`.

**Tech Stack:** Flask, SQLAlchemy on PostgreSQL, React 19, esbuild, Node 20 `node:test`, Playwright (Chromium; headed Firefox and WebKit for glyph checks).

**Spec:** [FUTURE-planning-assignee-capacity-deferred-323.md](FUTURE-planning-assignee-capacity-deferred-323.md) ("Team capacity for every selected Team", "One-click push", "Open items"). The shipped contract is in [DONE-planning-assignee-capacity-table-323.md](DONE-planning-assignee-capacity-table-323.md) and [docs/features/planning-sprint-review.md](../features/planning-sprint-review.md). Planning List retirement follows [#331 Task 7](EXEC-planning-shared-plan-331.md).

## Review of the deferred design (source-checked 2026-11-06)

| # | Finding (evidence) | Effect on this plan |
| --- | --- | --- |
| R1 | The stored-number fallback already reaches `effectiveCapacityState` (`useEngCapacity.js` `plannedCapacityByTeam`), so multiplier, exclusions, totals and project split consume it. The remaining one-Team gates are: `useEngCapacity`'s `if (!plannedCapacity \|\| isAllTeamsSelected \|\| selectedTeamSet.size !== 1) return null;`, `plannedFor` (`PlanningTeamCapacityCards.jsx:156`), the silent mirror call (`:280`) and the settle-to-`jira` after a Jira save (`:425`). | Task 4 removes the hook gate; Task 5 the card gates. |
| R2 | `park()` protects only `running` queues: failed, rejected and stopped-with-drafts scopes are evicted past `MAX_PARKED_SCOPES` (5). The predecessor test "at most five scopes are kept" pins this. | Task 3 fixes eviction and rewrites that test. |
| R3 | One controller per backend holds one `current` queue. Mirror, `flush`, `isBusy` and `dispose` act on `current` only. Cards have no owner when the strip is inactive. | Task 3 adds keyed owners and per-Team commands. |
| R4 | Cards come from `buildDisplayedTeamOptions` (`teamSpTotals[id] > 0` only); totals and the project split loop over those Teams (`planningCapacityUtils.js:358-362, 394`). For All Teams, `teamOptions` holds every configured Department Team, which the dropdown hides when the Sprint has no work for it (`buildTeamDropdownOptions`); unresolved names fall back to the raw id. | Decisions D2 and D3. |
| R5 | Showing a zero-effort Team adds its name to the Jira capacity read. `resolveUniqueCapacityCandidate` falls back to substring matching, so Team "Core" with no ticket could "match" a newly read "Platform Core" ticket. The read searches `summary ~` in chunks of 20 Teams (`capacity.py` `_team_chunks`); names are joined by commas in the URL. | Task 4: newly shown zero-effort Teams match only exactly, and the substring fallback never takes a candidate whose key equals any configured Department Team. This applies at every resolver call site. Names containing a comma are excluded from the read, like unresolved names. G3 measures URL bytes and Jira search counts. |
| R6 | The EPM automatic-refresh defect was fixed by `a312bae3` (`readFreshnessEnvironment`); a residual (no load-ownership token in `useEngSprintData`) remains unproven. | Task 8 adds the residual regression first; code changes only if it fails. |
| R7 | No toggle-to-paint harness exists; `tests/ui/runtime_probe_helpers.js` hard-wires the repo root. Only "a strip edit does not re-render App" is tested. | Task 8 parameterizes the probe and adds the positive App-render case. |
| R8 | Undo of Add assignee sends `removed: true` (no delete route); Undo of an inherited number re-sends it as `source: 'user'`. `planning-sprint-review.md:435` still says "Undo is not built yet". After Enter, the cell blurs, so Cmd/Ctrl+Z does nothing until focus returns. | Task 8 pins and documents these semantics, and fixes Cmd/Ctrl+Z after Enter, which the operator explicitly requested in the 2026-11-06 session task ("Address the documented Cmd/Ctrl+Z-after-Enter limitation"). This overrides the AGENTS.md keyboard-backlog default for this item. |
| R9 | `PATCH /api/capacity/<issue_key>` is best-effort, not compare-and-set. Outcomes:<ul><li>409 `capacity_conflict` with `currentCapacity`;</li><li>other 409 codes: `capacity_issue_mismatch`, `capacity_config_*`, `capacity_field_not_editable`;</li><li>502 `jira_capacity_update_conflict`;</li><li>200 `already_current`;</li><li>a non-numeric `capacity` gives 400 `invalid_capacity`.</li></ul>Card writes must use App's `updateCapacityRequest`; the existing pin already matches the editor call. | Task 6 adds a distinct registry entry and pin, and handles every outcome. |
| R10 | The predecessor has no batch route. Single-use CSRF tokens are capped at 8 per browser session (`MAX_CSRF_TOKENS`); concurrent saves, chunks, pushes and other tabs can evict an older token. | Writes are capped at 4 concurrent per controller, the existing one-shot pre-dispatch `csrf_required` retry is kept, and a 9-tokens test is added. |
| R11 | `MAX_DOCUMENTS_PER_WORKSPACE = 2000` is a lifetime cap with no delete route. | Decision D4. |
| R12 | #331 Task 7: all checkboxes are open; `PlanningRowDetails.jsx` exists; about 26 test files seed `planningLayout: 'list'`. | Task 9 is gated by G2. |
| R13 | The DONE #323 record says "not yet pushed" (it shipped as PR #328), and its DoD 10 is satisfied. | Task 10 corrects the record. |
| R14 | Budgets:<ul><li>`dashboard.jsx` 7,488 of 7,502 lines, with 74 of 74 App `useEffect`s;</li><li>`useEngCapacity` 458 of 470 lines, 67/67 inputs and 21/21 returns, with a reviewed `sourceDigest`;</li><li>the extraction lint checks expanded input names exactly (`scripts/extraction_lint/check_hook_interfaces.mjs`).</li></ul> | No new App effect. The provider drives the projection scope. One App memo (`planningCardTeamIds`) and one `useEngCapacity` input (`scope.cardTeamIds`) are added. The App memo and hook interface inventories are re-synced deliberately in Task 4, with `scripts/extraction_lint/run.sh`. `plannedCapacity` is forwarded whole to a util. |
| R15 | `tests/fixtures/db_oauth_server.py` seeds two actors in one workspace. Planning mode's fake Jira rejects `summary ~` and every PUT, and has no capacity config. | Task 10 extends the fixture; workspace isolation is proven at route level (Task 1). |

## Decisions and gates (answer before the named task)

- **D1. One-click push UX (Task 6).** The spec's decision 9 says "Write to ticket" opens the prefilled editor.
  - (a) *Recommended:* "Write to ticket" writes immediately, showing in-row pending, success and conflict states. The Jira pencil remains the editing path. This supersedes spec decision 9 and keeps one affordance.
  - (b) Keep the editor and add a separate push action.
  - (c) Keep today's two-click editor and close the push item without building it.
- **D2. Totals with newly shown Teams (Task 4).** Two linked rules:
  - *Totals:* a zero-effort Team with Jira or stored capacity changes the capacity totals and project split once it has a card. *Recommended:* count it, because a selected Team's capacity is real. Alternative: exclude zero-effort Teams from totals.
  - *Availability:* the compact "Capacity:" readout (`dashboard.jsx`) shows a total only when every entry `hasCapacityValue`, so a zero-effort Team with no ticket and no stored number would turn All Teams to "unavailable". *Recommended:* evaluate availability only over Teams with effort or a capacity value.
  - Task 4 tests both rules as chosen.
- **D3. Which Teams get cards (Task 4).**
  - *Recommended:* the Teams the Teams selector would show for the current selection, before any search text: `buildTeamDropdownOptions` with `selectedTeamIds`. Explicitly selected Teams are always kept; for All Teams, configured Teams with Sprint work or awaited Stories are kept.
  - *Before work is known* (`workKnown` false, when the selector temporarily lists every configured Team), cards keep today's set (pointed Teams plus explicitly selected Teams). Zero-effort Teams join only once work is known, so a Planning load reads Jira capacity at most once per settled scope.
  - Teams whose name is unresolved (raw-id fallback) or contains a comma get a card without a stored-number pencil and are not sent to the Jira read.
  - Alternative: all configured Department Teams, regardless of Sprint work.
- **D4. Document cap (Tasks 1 and 5).** `MAX_DOCUMENTS_PER_WORKSPACE = 2000` is a lifetime cap with no delete route.
  - *Recommended:* keep it, show the 400 `assignee_capacity_document_limit` as a visible per-Team rejection, and record Teams × Sprints from G1.
  - Raising the cap or adding retention is a separate decision.
- **G1. Counts-only evidence (recorded in Task 0).** Operator-provided integers: the largest Department's Team count, typical selected/displayed counts, and Teams × Sprints with stored documents. No names or ids.
- **G2. Planning List retirement (Task 9).** Requires the operator's explicit approval of #331 Task 7 and recorded E3 real-app Table inspection acceptance.
- **G3. Jira capacity read cost (measured in Task 0).** URL bytes and Jira searches (`ceil(N/20)`, sequential) before and after D3, for the G1 counts and for 500 synthetic Teams. Server time against the fake Jira proves nothing, so it is not used. If the URL exceeds 6,000 bytes, or the search count grows for the operator's typical selection, stop and ask with the numbers; do not truncate Teams silently.

## Global Constraints

- **Storage:** reuse `PlanningTeamSprintCapacity`, keyed by workspace, Sprint and Team. No migration and no new write route.
- **Numbers:**
  - wire values are strings matching `\d+(\.\d{1,2})?`, at most 16 characters, ≤ 10000;
  - zero is a value;
  - an own document with a null number never inherits;
  - inheritance takes the whole document from the nearest earlier Sprint by padded `sprint_order`;
  - reads never create documents.
- **Batch read:**
  - limits: at most 500 unique ids per chunk, at most 128 KiB of encoded (UTF-8) request JSON, a 256 KiB response limit, and one chunk in flight;
  - a 413 halves the chunk, and a single id that still fails is terminal and visible;
  - only while Planning Table is active with validated scope, or on an authorized refresh;
  - one-Team scope derives from the existing full GET;
  - no request is added to the initial Catch Up, EPM or dashboard bootstrap;
  - policy `user_write` with token-bound CSRF, as the spec requires (each chunk costs one token request; this tradeoff is recorded).
- **Writes:**
  - one owner per Sprint and Team per controller;
  - an editor captures its Team and Sprint;
  - scope changes never retarget an in-flight write;
  - at most 4 concurrent assignee-capacity PATCHes per controller;
  - at most one card editor or push per ticket at a time;
  - last-write-wins between users is unchanged and documented.
- **Unchanged rules:**
  - the no-ticket eligibility rule (capacity enabled, matching scope, known issue count, not loading/failed/stale/ambiguous, missing target, no numeric Jira value);
  - Jira wins whenever it has a value;
  - the strip, Add assignee and the person underbar stay one-Team only;
  - ambiguous or unresolved Team names never get a stored-number pencil or another Team's value.
- **Jira:**
  - only an explicit click writes, through `updateCapacityRequest`, to the displayed Team's matched ticket, with current mutation rights;
  - no automatic or background Jira writes;
  - never claim a conflict proves nothing was written.
- **Auth:**
  - a 401 stops the affected owners and keeps drafts in memory behind the terminal sign-in lock, with no replay (lost on reload, as today);
  - `AUTH_SESSION_REFRESH_EVENT` clears the cache and undo history but keeps dirty owners. The numbers map keeps its values until the re-read lands.
- **Tests:**
  - isolated runner with explicit `--include`;
  - real Flask/PostgreSQL for persistence and security acceptance;
  - no new skips beyond the existing opt-in runtime-probe convention (`JEP_RUNTIME_PROBE=1`);
  - no weakened assertions or raised budgets.
- **UI:**
  - reuse existing card, rail, banner and button classes and current geometry;
  - before/after screenshots;
  - settled element-level hover/focus/geometry assertions for every affected control kind;
  - pinned-stack height checks (MRT009) for compact and expanded overview at 1440×900 and 1280×720 with the G1 Team count.
- **Analytics:** no Team ids, names or values in any event; no-event reasons go in `docs/README_ANALYTICS.md`.

## Review Focus

1. A Team whose name is a substring of another configured Team's ticket or stored key (for example "Core" and "Platform Core"), displayed or not: no borrowed value, target or pencil. Pinned in Task 4.
2. A header Sprint or Team change while Team A's save is in flight and Team B's editor is open: A completes against its captured scope, and B's editor closes without saving. Pinned in Tasks 3 and 7.
3. A 401 between batch chunks or during a save: terminal recovery; no further chunk, no replay; drafts held in memory until reload. Pinned in Tasks 2 and 3.
4. A Team whose own document stores null after an earlier Sprint stored a number: null in batch and full reads alike. Pinned in Task 1.
5. A Jira ticket changed between the read and a one-click push: the row shows the current ticket value and does not say the write was prevented. Pinned in Task 6.

## File map

- **Backend:**
  - `backend/services/assignee_capacity.py`: `read_planned_numbers`;
  - `backend/routes/sprint_review_routes.py`: batch route, after `_namespace`;
  - `backend/security/policy.py`, `tests/endpoint_security_samples.py`, `tests/test_endpoint_security_matrix.py`: registration.
- **Frontend:**
  - `frontend/src/api/assigneeCapacityApi.js`: `readPlannedNumbers`;
  - `frontend/src/eng/usePlanningAssigneeCapacity.js`: keyed owners, per-Team commands, numbers map, status, eviction fix, write cap;
  - `frontend/src/eng/PlanningAssigneeCapacity.jsx`: the provider drives `setProjectionScope` from a new `teamIds` prop and exposes per-Team status;
  - `frontend/src/eng/useEngCapacity.js`, `frontend/src/eng/planningCapacityUtils.js`: gate removal, numbers map, substring guard, D2/D3 Team set;
  - `frontend/src/eng/PlanningTeamCapacityCards.jsx`: per-Team pencils, status, Retry/Discard, reconcile rows, mirror and settle, one-click push;
  - `frontend/src/dashboard.jsx`: subscription target and the provider's `teamIds` prop on existing lines; List removal in Task 9;
  - `frontend/src/dashboardFreshnessAdapters.js`: multi-Team freshness in the existing `assigneeCapacity` slot;
  - `frontend/src/eng/useEngSprintData.js` (only if Task 8 Step 1 fails);
  - `frontend/src/analytics/dashboardAnalytics.js`;
  - share-view files in Task 9.
- **Tests:**
  - backend: `tests/test_assignee_capacity_service.py`, `tests/test_assignee_capacity_routes.py`, `tests/test_work_structure_consumer_inventory.py` (run);
  - frontend unit: `tests/test_assignee_capacity_api.js`, `tests/test_planning_assignee_capacity_queue.js`, `tests/test_planning_capacity_utils.js`, `tests/test_design_system_write_contract.js`, `tests/test_analytics_events.js`, `tests/test_dashboard_freshness_interactions.js`;
  - browser: `tests/ui/planning_assignee_capacity.spec.js`, `tests/ui/planning_capacity_editing.spec.js`, `tests/ui/runtime_probe_helpers.js`, new `tests/ui/planning_toggle_paint.spec.js`, new `tests/ui/planning_capacity_real_server.spec.js`;
  - fixtures: `tests/fixtures/db_oauth_server.py`, `tests/fixtures/planning_shared_plan_server.py`, `tests/ui/planning_shared_plan_fixture.js`.
- **Docs and inventories:**
  - `docs/features/planning-sprint-review.md`, `docs/design-system.md`, `docs/README_ANALYTICS.md`, `docs/ontology.md`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `docs/TODO.md`;
  - `scripts/extraction_lint/owner_budgets.json`;
  - this plan, the FUTURE and DONE #323 plans, `docs/plans/README.md`.

---

### Task 0: Baseline, evidence and decisions

**Files:** this plan (Execution evidence); captures under the ignored `tmp/planning-323-every-team/`.

- [ ] **Step 1:** Record the starting head SHA (it was `07949f38` when this plan was written), the operator's answers to D1–D4, and the G1 integers in Execution evidence.
- [ ] **Step 2:** Run `npm run build`, the isolated backend suite and `node --test tests/test_*.js` (Node 20) at the starting head; record the summary lines.
- [ ] **Step 3:** Capture "before" Chromium screenshots (synthetic data, mocked routes as in `planning_assignee_capacity.spec.js`) for:
  - one Team;
  - two Teams;
  - All Teams;
  - a no-Story Team;
  - an unpointed-Story Team;
  - the reconcile row (compact and expanded).
- [ ] **Step 4:** Record the request ledger for initial dashboard load and for Planning Table at one, two and All Teams, using the DoD 12 ledger tests.
- [ ] **Step 5 (G3):** Measure the Jira capacity GET for the G1 counts and for 500 synthetic Teams, before and after the D3 Team set: URL bytes and the number of Jira searches. Stop and ask if a G3 limit is exceeded.

### Task 1: Batch Team-number projection (backend)

**Files:** Modify `backend/services/assignee_capacity.py`, `backend/routes/sprint_review_routes.py`, `backend/security/policy.py`, `tests/endpoint_security_samples.py`, `tests/test_endpoint_security_matrix.py`. Test `tests/test_assignee_capacity_service.py`, `tests/test_assignee_capacity_routes.py`.

**Interfaces:**
- **Produces:** `read_planned_numbers(context, sprint_id: str, team_ids: list[str], database_url=None) -> dict`, returning `{"sprintId": str, "teams": [{"teamId", "revision", "planned", "inherited"}], "capabilities": sprint_review.capabilities(context)}`.
  - Records come back in request order, one per id.
  - An absent Team gets `{"revision": 0, "planned": None, "inherited": None}`.
  - An inherited Team gets `{"revision": 0, "planned": None, "inherited": {"fromSprintId": str, "planned": {"value": str, "source": "inherited"} | None}}`.
  - Own versus inherited is decided by comparing `sprint_id`, as `_document` does.
- **Route:**
  - `POST /api/eng/sprints/<sprint_id>/assignee-capacity/planned/read`, body exactly `{"teamIds": [...]}`;
  - `EndpointPolicy("eng-assignee-capacity-planned-read", …, frozenset({"POST"}), "user_write", "dynamic")`;
  - `_payload(MAX_BATCH_REQUEST_BYTES)`, Server-Timing `assignee-capacity-planned-read`;
  - capabilities are checked in the route as `_capacity_get` does.
- **Constants:** `MAX_BATCH_TEAM_IDS = 500`, `MAX_BATCH_REQUEST_BYTES = 128 * 1024`; responses reuse `MAX_RESPONSE_BYTES`.

- [ ] **Step 1: Write failing service tests:**
  - `test_batch_projection_matches_full_documents`: own-with-value, own-null, inherited (with two earlier documents, the nearest wins), inherited-null, absent, and a Team with a document for a later Sprint, which is ignored. Use Sprint ids 9/10 and 99/100 against padded order. Each record equals `get_document`'s `revision`, `planned`, `inherited.fromSprintId` and `inherited.planned`.
  - `test_batch_projection_is_one_column_limited_statement`: exactly one statement on `planning_team_sprint_capacity`, and its SQL does not select `rows`.
  - `test_batch_projection_never_returns_rows_or_notes`.
  - `test_batch_projection_preserves_request_order_and_workspace_isolation`.
  - `test_batch_projection_zero_is_a_value`.
  - `test_batch_projection_writes_nothing`.
- [ ] **Step 2:** Run `.venv/bin/python tests/run_isolated_runtime_tests.py <includes> tests.test_assignee_capacity_service`. Expected: FAIL (undefined).
- [ ] **Step 3: Implement.**
  - Query: `SELECT DISTINCT ON (team_id) team_id, sprint_id, revision, planned_capacity, planned_source … WHERE workspace_id = :w AND team_id = ANY(:ids) AND sprint_order <= :order ORDER BY team_id, sprint_order DESC`.
  - Project with `_stored_planned` and `_inherit_planned`, and validate ids with `team_identity`.
- [ ] **Step 4: Write failing route tests:**
  - `test_batch_read_contract_and_errors`:
    - 200 shape, including `capabilities.reason`;
    - 400 `invalid_review_request` for unknown fields, duplicates, an empty list, an invalid id or Sprint, and 501 ids;
    - 413 `review_request_limit` for a body over 128 KiB;
    - 413 `review_response_limit` for a patched oversized result;
    - 503 `review_storage_unavailable` for patched storage failure;
    - 403 for a missing `X-Requested-With`;
    - 403 `csrf_required` for a missing or consumed token;
    - 401 anonymous, before storage;
  - `test_batch_read_is_workspace_isolated_and_non_admin_readable`;
  - `test_batch_read_without_read_capability_returns_no_teams_and_no_query`, and the `Server-Timing: assignee-capacity-planned-read` header;
  - a security-matrix sample.
- [ ] **Step 5:** Implement the route and register the policy and samples.
- [ ] **Step 6:** Run both modules plus `tests.test_endpoint_policy_inventory`, `tests.test_endpoint_security_matrix`, `tests.test_backend_route_source_guards` and `tests.test_work_structure_consumer_inventory`. Expected: PASS.
- [ ] **Step 7:** Commit `Add a bounded batch read of stored Team capacity numbers (#323)`.

### Task 2: Batch read client

**Files:** Modify `frontend/src/api/assigneeCapacityApi.js`. Test `tests/test_assignee_capacity_api.js`.

**Interfaces:**
- **Produces:** `readPlannedNumbers(backendUrl, sprintId, teamIds, { signal }) -> Promise<{ sprintId, capabilities, byTeam: Record<teamId, { revision, planned, inherited }>, failedTeamIds: string[] }>`.
- The batch path is passed to `request()` as the suffix `'/planned/read'`.

- [ ] **Step 1: Write failing tests:**
  - 2 ids give one POST; 1,001 ids give 3 sequential POSTs with no overlap;
  - multi-byte ids split by UTF-8 bytes under 128 KiB;
  - a 413 on a 500-id chunk halves to 250+250;
  - a single-id 413 lands in `failedTeamIds` with no retry loop;
  - each POST fetched its own CSRF token and sent `X-Requested-With`;
  - a pre-dispatch 403 `csrf_required` on a chunk is retried once with a fresh token, then fails visibly;
  - a 401 rejects with the existing auth-required error and sends no further chunk;
  - abort stops the sequence;
  - `capabilities` are returned.
- [ ] **Step 2:** Run `node --test tests/test_assignee_capacity_api.js` (Node 20). Expected: FAIL.
- [ ] **Step 3:** Implement with `request()` and its 20 s timeout.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `Read stored Team numbers in bounded sequential chunks (#323)`.

### Task 3: Keyed per-Team owners in the capacity controller

**Files:** Modify `frontend/src/eng/usePlanningAssigneeCapacity.js`, `frontend/src/eng/PlanningAssigneeCapacity.jsx`. Test `tests/test_planning_assignee_capacity_queue.js`.

**Interfaces (controller):**
- **Projection scope:** `setProjectionScope({ sprintId, teamIds, active })`, called by the provider from a new `teamIds` prop; `refreshProjection({ automatic, signal, shouldApply })`.
- **Numbers map for App:** `getPlannedNumbers() -> { sprintId, byTeam: Record<teamId, { value: number|null, source }> } | null`.
  - `value` is converted with the existing `plannedNumber` (`"0"` gives 0).
  - Every projected Team appears, including absent Teams with `value: null`, so a first number can be typed.
  - It is frozen and identity-stable while values and sources are unchanged; a source change, such as inherited to user, is a stored-number change.
  - It holds no save or load state.
  - It is the overlay of owners' local values on batch records.
- **Per-Team status for cards:** `getTeamStatus(teamId) -> { load: 'idle'|'loading'|'ready'|'error', readError, save: 'idle'|'saving'|'failed'|'rejected', error, canSave }`.
  - Exposed through the provider context, with subscription via `subscribeTeam(teamId, listener)`.
- **Per-Team commands:**
  - `commitTeamPlanned(teamId, value, source = 'user')`;
  - `mirrorTeamPlanned(teamId, ticketWire)`, using the existing `onlyIfSource` guard;
  - `retryTeam(teamId)`;
  - `discardTeamPlanned(teamId)`, which drops only that Team's stored-number draft and never person-row drafts;
  - `ensureTeamDocument(teamId)`;
  - `flushTeam(teamId)`.
- **Whole-controller:** `isBusy()` and `dispose()` cover every owner.
- **Strip API unchanged:** `setScope`, `commit`, `addPerson`, `commitPlanned`, `undo`, `retry`, `discard` act on the strip Team's owner. `getPlannedSnapshot` remains as a derived one-Team view until Task 4 moves its consumer to `getPlannedNumbers`, then is deleted.
- **Policy:**
  - at most 4 concurrent PATCHes across owners, with the rest queued;
  - the existing pre-dispatch `csrf_required` single retry is kept;
  - eviction drops only clean, idle owners past 5 (an evicted displayed owner reloads lazily; the numbers map is unaffected);
  - running, dirty, failed, rejected and stopped owners are never evicted.

- [ ] **Step 1: Write failing queue tests:**
  - "Team A delayed while Team B saves; B publishes first";
  - "A fails while B succeeds; A keeps Retry and Discard";
  - "revisiting failed A restores its draft";
  - "an edit during A's readback recovery is kept";
  - "a header Sprint/Team change mid-save sends the captured Sprint and Team";
  - "a late projection refresh does not overwrite A's in-flight or failed value";
  - "six dirty Teams: none evicted; clean idle owners are evicted first";
  - "a 401 stops owners, keeps drafts and never replays";
  - "`AUTH_SESSION_REFRESH_EVENT` clears cache and undo but keeps dirty owners";
  - "the strip and card for one Team share one owner (one PATCH)";
  - "a card edit loads the full document once; selecting that Team for the strip reuses it (no second GET)";
  - "a planned-only PATCH keeps person rows";
  - "the numbers map keeps identity across save-state changes";
  - "a fifth concurrent PATCH waits for a slot";
  - "nine token fetches before the first PATCH dispatches: the evicted token's 403 `csrf_required` is retried once and lands".
- [ ] **Step 2:** Rewrite the predecessor test "a failed background save is kept per scope … at most five scopes are kept" to the new eviction rule.
- [ ] **Step 3:** Run `node --test tests/test_planning_assignee_capacity_queue.js`. Expected: FAIL.
- [ ] **Step 4: Implement** owners as `Map<scopeKey, { queue, document, load }>`.
  - Reuse `newQueue`, `pump`, `recover`, `mergeInto` and the write-epoch fencing per owner.
  - The provider calls `setProjectionScope` in its own effect (App gains no effect).
- [ ] **Step 5:** Run the queue tests and the full `node --test tests/test_*.js`, then `npm run build` and the strip cases of `tests/ui/planning_assignee_capacity.spec.js` (Chromium). Expected: PASS.
- [ ] **Step 6:** Commit `Give every Team its own capacity save owner (#323)`.

### Task 4: Numbers and cards for every displayed Team

**Files:** Modify `frontend/src/eng/useEngCapacity.js`, `frontend/src/eng/planningCapacityUtils.js`, `frontend/src/teamSelectionUtils.mjs` (if needed), `frontend/src/dashboard.jsx` (the `planningCardTeamIds` memo, the subscription target, and the provider's `teamIds` prop), `scripts/extraction_lint/owner_budgets.json` (App memo and `eng.useEngCapacity` interface and digest re-sync). Test `tests/test_planning_capacity_utils.js`, `tests/ui/planning_assignee_capacity.spec.js`.

**Interfaces:**
- **Consumes:** `getPlannedNumbers()`.
- **Produces:**
  - `buildPlannedCapacityByTeam({ plannedCapacity, displayedTeamOptions, sprintId }) -> Record<capacityKey, value> | null`. `useEngCapacity` forwards `plannedCapacity` whole, so no expanded input member is added. An ambiguous or unresolved key yields no entry.
  - App memo `planningCardTeamIds`: `buildTeamDropdownOptions` with `selectedTeamIds` and no search text, applying D3's work-known rule. It is passed as `scope.cardTeamIds` to `useEngCapacity` and as `teamIds` to the provider.
  - `buildDisplayedTeamOptions({ teamOptions, isAllTeamsSelected, selectedTeamSet, teamSpTotals, cardTeamIds })`, implementing D3 (the `> 0` filter is removed).
  - `resolveUniqueCapacityCandidate(valuesByTeam, teamName, { exactOnly, configuredTeamKeys })`: zero-effort Teams use `exactOnly`, and the substring fallback never takes a candidate whose key is in `configuredTeamKeys`. Its callers `resolveUniqueCapacityValue`, `resolveUniqueCapacityTarget`, `resolvePlannedCapacity` and `useEngCapacity`'s `getTeamCapacity` all pass these options. Stored numbers merged into `capacityByTeam` match exactly only.

- [ ] **Step 1: Write failing unit tests:**
  - `buildPlannedCapacityByTeam` maps two Teams, drops ambiguous and unresolved keys, and ignores another Sprint's map;
  - D3: selected zero-effort Teams are kept, and All Teams follows the chosen rule;
  - "Core" with no ticket does not match the "Platform Core" ticket, whether or not "Platform Core" is displayed, while "Platform Core" still matches its own; a stored key never becomes a substring candidate;
  - before work is known the card set equals today's, and after it the D3 set applies;
  - D2: totals, multiplier and project split follow the chosen rule; the "Capacity:" availability gate follows the chosen rule; a Team introduced by both catalog and tasks counts once; Jira-only totals are otherwise unchanged.
- [ ] **Step 2: Write failing Playwright cases** (mocked routes):
  - two Teams and All Teams show each Team's stored number (display only; pencils are Task 5);
  - zero-effort cards are shown;
  - unresolved names show no stored number;
  - the request ledger shows no per-Team startup fan-out, one Jira capacity read per settled scope, and reuse of page-session data when widening from one to two to All Teams;
  - rewrite `planning_assignee_capacity.spec.js` "keep the old cards" (`:200`) to the new card set.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement: remove the hook gate and move the subscription to `getPlannedNumbers`; delete `getPlannedSnapshot`.
- [ ] **Step 5:** Run `scripts/extraction_lint/run.sh` and deliberately re-sync the App memo count and the `eng.useEngCapacity` input inventory (+`scope.cardTeamIds`) and `sourceDigest`. Then run `tests.test_codebase_structure_budgets`, the tests from Steps 1–2 and `tests/ui/planning_capacity_editing.spec.js`. Expected: PASS.
- [ ] **Step 6:** Commit `Show stored Team capacity for every displayed Team (#323)`.

### Task 5: Per-Team card editing, status and reconciliation

**Files:** Modify `frontend/src/eng/PlanningTeamCapacityCards.jsx`. Test `tests/ui/planning_capacity_editing.spec.js`, `tests/ui/planning_assignee_capacity.spec.js`.

**Interfaces:**
- **Consumes:** Task 3's per-Team commands and `getTeamStatus` through context.
- **Produces:**
  - `plannedFor(entry)`, true when the numbers map has the entry's Team in the current Sprint and its status `canSave`;
  - one reconcile row per differing Team, in card order. The dismissal key `${sprintId}|${teamId}` and signature `${stored}|${ticket}` are unchanged.

- [ ] **Step 1: Write failing Playwright cases:**
  - Saving and status:
    - each card's pencil saves only its own Team and Sprint;
    - saves for two Teams overlap and both land;
    - A fails with Retry and Discard on its card (Discard drops only the stored-number draft) while B is saved;
    - a failure is visible in the compact overview status;
    - D4's document-limit 400 shows as A's visible rejection;
    - only one editor is open at a time.
  - Reconcile rows:
    - two rows, each naming its Team;
    - dismissing or failing A's row leaves B's row;
    - "Use ticket value" writes only that Team's document.
  - Mirror and settle:
    - the per-Team mirror runs only for idle loaded owners after a user-initiated read (never after an automatic read; never creates a document);
    - after a Jira editor save, a stored `user` number settles to `jira` for that Team in any scope.
  - No `PATCH /api/capacity` happens until a Save.
  - Geometry and layout:
    - settled hover, focus and geometry assertions for pencils, editor controls, Retry/Discard and every reconcile action;
    - pinned-stack height checks at the G1 Team count, compact and expanded, at 1440×900 and 1280×720. If the rows break the existing sticky contract, stop and ask; do not invent a collapse UI.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with the existing rail, banner and button classes and the strip's Discard copy.
- [ ] **Step 4:** Run. Expected: PASS. Capture "after" screenshots matching Task 0.
- [ ] **Step 5:** Commit `Edit, retry and reconcile each Team's stored number on its card (#323)`.

### Task 6: One-click push to the matched ticket (D1 (a) or (b) only)

**Files:** Modify `frontend/src/eng/PlanningTeamCapacityCards.jsx`, `frontend/src/analytics/dashboardAnalytics.js`, `docs/design-system.md`, `docs/README_ANALYTICS.md` (the planning action rows and the line that says the banner emits no event). Test `tests/test_design_system_write_contract.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `tests/ui/planning_capacity_editing.spec.js`.

**Interfaces:**
- **Consumes:** App's `updateCapacityRequest(issueKey, { sprintName, teamName, expectedCapacity, capacity })` prop (existing).
- **Produces:**
  - registry entry `capacityReconcilePush` with a distinct pin, `updateCapacityRequest(row.candidate.issueKey,`, added to the path-check loop in `test_design_system_write_contract.js`;
  - `CAPACITY_WORKFLOW_ACTIONS` gains `capacity_reconcile_push` with results `success|failure|conflict`.

- [ ] **Step 1:** If D1 is (c), mark this task "not built by decision" and skip to Task 7.
- [ ] **Step 2:** Add the registry entry and the distinct pin. Run `node --test tests/test_design_system_write_contract.js`. Expected: FAIL (no call site).
- [ ] **Step 3: Write failing Playwright cases.** The push is offered only when `capacityTargetState === 'matched'` and `canEditCapacity`. It sends one PATCH to that row's ticket, with `capacity` as a JSON number and `expectedCapacity` set to the read ticket value. Then:
  - success, or 200 `already_current`, updates the ticket value, settles the stored source to `jira`, and removes the row;
  - 409 `capacity_conflict` shows `currentCapacity`, with copy that does not say "nothing was written";
  - other 409 codes, 403 `capacity_forbidden`, 404 `capacity_issue_not_found`, and 502 `jira_capacity_update_conflict` / `jira_capacity_update_failed` show the existing editor error copy;
  - a 401 enters terminal recovery;
  - targets in the editor's `invalidTargets` and config-suppressed states offer no push;
  - one abort controller per row, with no push while that ticket's editor or another push is in flight;
  - freshness is held through `onInteractionChange`, driven by a count of open editors and pushes, so closing another editor mid-push keeps the hold;
  - a missing mutation right hides the action;
  - hover, focus and geometry assertions for the pending and conflict states.
- [ ] **Step 4:** Implement it, and add the analytics action and its test.
- [ ] **Step 5:** Run the specs and Node tests. Expected: PASS.
- [ ] **Step 6:** Commit `Push a Team's stored number to its matched ticket in one click (#323)`.

### Task 7: Refresh and scope changes that preserve working state

**Files:** Modify `frontend/src/eng/usePlanningAssigneeCapacity.js`, `frontend/src/eng/PlanningAssigneeCapacity.jsx`, `frontend/src/dashboardFreshnessAdapters.js`. Test `tests/test_planning_assignee_capacity_queue.js`, `tests/test_dashboard_freshness_interactions.js`, `tests/ui/planning_assignee_capacity.spec.js`.

**Interfaces:** the existing `stableOwner.assigneeCapacity` slot is registered in multi-Team scope too.
- `refresh` calls `refreshProjection({ automatic, signal, shouldApply })`.
- `refreshProjection` fences per Team: it never replaces the value of an owner that is dirty, in flight or failed, and clean Teams take the new values.
- `blocked()` keeps today's whole-Planning rule for the automatic follow-up: any open editor or push already blocks automatic Planning refresh.
- Header Refresh (`dashboard.jsx`) uses the same slot and is not blocked by a busy owner.

- [ ] **Step 1: Write failing tests:**
  - header Refresh and the automatic follow-up use the batch read in multi-Team scope and the full GET in one-Team scope;
  - header Refresh with one editor open, another Team failed and the rest clean: clean Teams refresh, the editor's text, focus and scroll are kept, and the failed draft is kept;
  - an automatic follow-up while an editor is open does not run (existing rule), and runs after it closes;
  - an unchanged projection keeps identity (App renders zero times);
  - a late response after a scope or auth change is discarded;
  - a read error shows the existing error state and enables no pencil;
  - recovery causes no PATCH.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `Refresh stored Team numbers without disturbing edits (#323)`.

### Task 8: Remaining verification items

**Files:** Test `tests/test_dashboard_freshness_interactions.js`, `tests/ui/dashboard_data_freshness.spec.js`, `tests/ui/planning_assignee_capacity.spec.js`, `tests/ui/runtime_probe_helpers.js` (root parameter), new `tests/ui/planning_toggle_paint.spec.js`. Modify `frontend/src/eng/PlanningAssigneeCapacity.jsx`, `frontend/src/eng/useEngSprintData.js` (only if Step 1 fails), `docs/features/planning-sprint-review.md`, `docs/TODO.md`.

- [ ] **Step 1, EPM residual:**
  - Add "ENG return refresh starts after an aborted ENG read retired while EPM was active".
  - Run it, and run `dashboard_data_freshness.spec.js` with `--repeat-each=5`.
  - If both pass, record the FUTURE defect as closed by `a312bae3`.
  - Otherwise give `useEngSprintData` a load-ownership token that clears flags when a load is superseded with no owner, and rerun.
- [ ] **Step 2, App render** (opt-in runtime-probe block):
  - "a stored Team number change re-renders App exactly once";
  - "a person's Capacity, Vacations or Notes edit and any save-state change render App zero times".
- [ ] **Step 3, toggle-to-paint** (`planning_toggle_paint.spec.js`, opt-in):
  - Add a `root` parameter to `buildRuntimeProbeBundle`.
  - Build the base from the starting head's source, extracted with `git archive` into the ignored `tmp/` with its own `npm ci` (not a worktree).
  - Generate synthetic 500, 2,000 and 5,000-Story fixtures.
  - Time a Story toggle to the next painted frame (double `requestAnimationFrame`) over 30 toggles, alternating head and base runs. Report p50 and p95.
  - No pass rule is invented: the operator signs off on the recorded numbers.
- [ ] **Step 4, Cmd/Ctrl+Z after Enter:**
  - Failing tests: "after Enter commits a cell, Cmd/Ctrl+Z undoes it" and "while a cell is being edited, Cmd/Ctrl+Z is the input's native undo".
  - Implement: Enter moves focus to the committed cell's focusable container instead of `blur()`.
  - Assert the focus position and capture a screenshot of any focus ring.
  - Remove the `docs/TODO.md` Deferred entry.
- [ ] **Step 5, Undo semantics:**
  - Pin with tests: Undo of Add assignee sends `removed: true` (no delete route); Undo restoring an inherited number sends `source: 'user'` and shows "Undo kept this Sprint's own copy…".
  - Document both, plus last-write-wins between users, in `planning-sprint-review.md`, replacing "Undo is not built yet". Inheritance semantics are unchanged.
- [ ] **Step 6:** Commit `Close the open #323 verification items`.

### Task 9: Retire Planning List (gated by G2)

**Files:**
- `frontend/src/dashboard.jsx`: the layout state default and the List branches;
- `frontend/src/eng/usePlanningRowMotion.js`: delete the orphaned `usePlanningListConfirmedEdit` export;
- `frontend/src/eng/PlanningActionBar.jsx`: remove `PlanningLayoutToggle`;
- `frontend/src/eng/EngView.jsx`, `frontend/src/dashboardFreshnessAdapters.js`;
- `frontend/src/shareView/{viewDefaults,codec,resolver,applyController,captureState}.js`, `useShareViewApply.js`;
- `frontend/src/analytics/dashboardAnalytics.js`: the `eng/planning/list` page name and `layout_*` action;
- `docs/README_ANALYTICS.md`;
- tests: share codec/resolver tests, `share-view-query-corpus-example-sanitized.json`, and the specs seeding `planningLayout: 'list'`.

- [ ] **Step 1:** Confirm that #331 Task 7 and E3 are recorded as accepted; otherwise stop.
- [ ] **Step 2: Write failing tests:**
  - a saved `planningLayout: 'list'` opens Table;
  - `'list'` still parses in links;
  - an old List link with Sprint, Team, Story focus and reading anchor opens Table with `rows` derived from the focus kind and keeps the focus;
  - the toggle is gone;
  - Catch Up List and its stored choices are unchanged;
  - sticky heights are unchanged in Catch Up, Planning and Scenario.
- [ ] **Step 3:** Implement. Migrate the seeding specs to Table, or to the Catch Up List where they test Catch Up.
- [ ] **Step 4:** Run the share suites and the full Chromium `tests/ui`. Expected: PASS.
- [ ] **Step 5:** Commit `Retire Planning List in favour of Table (#323, #331)`.

### Task 10: Real-server acceptance, documentation and full gates

**Files:** Create `tests/ui/planning_capacity_real_server.spec.js`. Modify:
- fixtures:
  - `tests/fixtures/planning_shared_plan_server.py`: a capacity config, synthetic "Team info" issues (and none for the no-ticket path), `summary ~` support, issue GETs before and after an update, and a capacity PUT allowed only when a test opts in. The default provider guard keeps asserting that Planning never mutates Jira;
  - `tests/fixtures/db_oauth_server.py`, `tests/ui/planning_shared_plan_fixture.js`;
- the docs from the File map; this plan; `FUTURE-…-323.md`; `DONE-…-323.md` (status note and Current Accuracy only); `docs/plans/README.md`.

- [ ] **Step 1: Write the real-server spec** (owned PostgreSQL cluster, actors A and B in one workspace; workspace isolation is proven at route level in Task 1):
  - two Teams saved concurrently both persist and B reads them back;
  - A and B editing the same Team resolve last-write-wins, as documented;
  - zero CSRF 403 responses;
  - sign-in expiry mid-save: hold the PATCH with `page.route`, call `expireSession`, release; the result is terminal recovery with no replay;
  - after D1 (a) or (b), one push reaches the fake Jira PUT.
- [ ] **Step 2:** Run it serially. Expected: PASS.
- [ ] **Step 3: Update documentation:**
  - the feature doc: Freshness, Limitations, card coverage, D2–D4 outcomes, Undo and last-write-wins;
  - the ownership doc and ontology: the batch route;
  - the analytics doc: no-event reasons for batch reads, hydration, mirroring and List normalization;
  - the DONE #323 record: pushed as PR #328, DoD 10 satisfied, open items moved here;
  - the FUTURE plan: shrink to what stays deferred;
  - the index.
- [ ] **Step 4: Run the full gates in sequence:**
  1. `npm run build`;
  2. the isolated backend suite;
  3. `node --test tests/test_*.js` (Node 20);
  4. `scripts/extraction_lint/run.sh`;
  5. Chromium `tests/ui`: real-server specs serially, then the rest with `--workers=4`, preserving the inventory;
  6. headed Firefox and WebKit for the capacity specs, plus the manual glyph and hover check (DoD 14).
  Record exact summaries.
- [ ] **Step 5: Publication naming** follows root AGENTS.md §10. If Task 6 or 9 is still gated, either the operator declares the PR partial (keep `EXEC-*`), or the gated items move to the `DONE-*` status note and `docs/TODO.md`. Commit `Record #323 every-Team capacity delivery`.

## Definition of Done

Each item is done only with its named evidence recorded in Execution evidence (command and summary line, test names, or capture paths under the ignored `tmp/`).

1. **Cards (D3).**
   - One, two and All Teams show one card per Team in the selector set, including no-Story and unpointed-Story Teams; before work is known, the set equals today's.
   - *Evidence:* Task 4 Playwright cases and before/after screenshots.
2. **Own-Team writes.**
   - Each card reads and writes only its own Team and Sprint number; two Teams saved concurrently both persist, and another user reads them back.
   - *Evidence:* Task 5 request-body assertions and the Task 10 real-server spec.
3. **Unchanged rules.**
   - No-ticket eligibility, Jira precedence, inheritance, zero as a value, and the one-Team strip and underbar behave as before.
   - *Evidence:* the predecessor tests pass unchanged, plus Task 4/5 mixed-state cases.
4. **No borrowing.**
   - A substring-named Team ("Core" / "Platform Core"), displayed or not, an ambiguous name, an unresolved name or a comma-containing name never borrows a value or target and gets no stored-number pencil. This holds at every resolver call site.
   - *Evidence:* Task 4 unit tests.
5. **Maths (D2).**
   - Totals and the project split count zero-effort Teams; "Capacity:" availability is judged only over Teams with effort or a value; no Team is counted twice; Jira-only totals are otherwise unchanged.
   - *Evidence:* Task 4 unit tests.
6. **Batch route.**
   - Its results match `get_document` for own, own-null, inherited (nearest of several), inherited-null, absent and later-Sprint Teams, with 9/10 and 99/100 Sprint ids.
   - It issues one column-limited statement with no `rows` and writes nothing.
   - The full error matrix holds (400, 413 request and response, 503, 401, 403 for the header and for CSRF), as do workspace isolation, the no-read-capability path and Server-Timing.
   - It is registered in the policy, samples and matrix.
   - *Evidence:* Task 1 service and route tests and the security inventories.
7. **Client bounds.**
   - 500-id and 128 KiB (UTF-8) chunking, one chunk in flight, halving on 413, a terminal single-id failure, one CSRF retry, and no further chunk after a 401.
   - *Evidence:* Task 2 tests.
8. **Per-Team owners.**
   - Saves for different Teams are independent.
   - Failures keep Retry and Team-only Discard.
   - Readback edits are kept; a scope change never retargets a write.
   - Dirty, failed, rejected, stopped and running owners are never evicted.
   - At most 4 concurrent PATCHes; the 9-token CSRF case lands.
   - A 401 keeps drafts with no replay; a session-refresh event keeps dirty owners and numbers.
   - *Evidence:* Task 3 queue tests and the strip Playwright cases.
9. **App renders.**
   - A stored Team number change re-renders App exactly once; person-row edits and save-state changes re-render it zero times.
   - *Evidence:* Task 8 runtime-probe tests.
10. **Refresh.**
    - Header Refresh updates clean Teams and keeps open-editor text, focus, scroll and failed drafts.
    - The automatic follow-up waits while an editor is open; an unchanged projection keeps its identity; late responses are discarded; recovery never sends a PATCH.
    - *Evidence:* Task 7 tests.
11. **Reconciliation.**
    - One row per differing Team, each named; dismissal and failure are independent; "Use ticket value" writes only that Team.
    - The mirror runs only for idle loaded owners after user-initiated reads and never creates a document; a Jira save settles that Team's stored number to `jira` in any scope.
    - *Evidence:* Task 5 Playwright cases.
12. **One-click push (D1 a).**
    - "Write to ticket" sends one PATCH to the row's own matched ticket, with a numeric `capacity` and `expectedCapacity`.
    - Every outcome in R9 and Task 6 shows the specified state; `capacity_conflict` never claims that nothing was written.
    - Each row has its own abort; the freshness hold uses a counter.
    - There is a distinct registry entry and pin, and the `capacity_reconcile_push` analytics is documented.
    - The real-server push reaches the opt-in fake Jira PUT.
    - *Evidence:* Task 6 and Task 10 tests.
13. **Startup and read cost.**
    - The initial dashboard request ledger is unchanged; there is one Jira capacity read per settled scope and no per-Team fan-out; G3 numbers are recorded.
    - *Evidence:* Task 0 and Task 4 ledgers.
14. **UI quality.**
    - Only existing classes are used.
    - Settled hover, focus and geometry assertions cover every affected control kind.
    - Pinned-stack heights hold compact and expanded at 1440×900 and 1280×720 with 12 Teams.
    - Headed Firefox and WebKit capacity specs pass, and the manual glyph and hover check is recorded.
    - *Evidence:* Task 5, 6 and 10 runs and screenshots.
15. **Verification items.**
    - The EPM residual test passes, with `dashboard_data_freshness.spec.js` at `--repeat-each=5`.
    - Toggle-to-paint p50/p95 at 500, 2,000 and 5,000 Stories is recorded against the starting-head base and signed off by the operator.
    - Cmd/Ctrl+Z after Enter undoes the commit while native input undo still works; the TODO entry is removed.
    - Undo semantics are pinned and documented.
    - *Evidence:* Task 8.
16. **Planning List (after G2).**
    - Old preferences and links open Table with focus and anchors kept; `'list'` still parses; the toggle is gone; Catch Up List is unchanged; sticky heights are unchanged.
    - Or the item is recorded as gated.
    - *Evidence:* Task 9 tests and the full Chromium run.
17. **Security.**
    - Zero CSRF 403s in the real-server journey; sign-in expiry mid-save gives terminal recovery with no replay; no automatic or background Jira write exists.
    - *Evidence:* Task 10, plus the Task 5/6 "no PATCH without a click" assertions.
18. **Budgets.**
    - `dashboard.jsx` stays within its line ceiling and App effect count; the App memo and `eng.useEngCapacity` interface are re-synced deliberately.
    - *Evidence:* `scripts/extraction_lint/run.sh` and `tests.test_codebase_structure_budgets` pass.
19. **Documentation.**
    - The feature doc (Freshness, Limitations, card coverage, D2–D4, Undo, last-write-wins), design-system registry, analytics taxonomy and no-event reasons, ownership doc and ontology are updated.
    - The DONE #323 record is corrected, the FUTURE plan shrunk, and the index updated.
    - *Evidence:* the Task 10 diff.
20. **Full gates.**
    - `npm run build`, the isolated backend suite, `node --test tests/test_*.js` (Node 20), the extraction lint, the complete Chromium `tests/ui` inventory, and headed Firefox/WebKit capacity specs all pass with recorded summaries.
    - The plan is renamed `DONE-*` per root AGENTS.md §10, or kept `EXEC-*` for a declared partial PR.
    - *Evidence:* the Task 10 Step 4 output.

## Execution evidence

Not started.

Operator decisions (2026-11-06): the recommended options were accepted.
- **D1 (a):** "Write to ticket" writes immediately, with in-row pending, success and conflict states. This supersedes spec decision 9.
- **D2:** zero-effort Teams count in totals and the project split; "Capacity:" availability is judged only over Teams with effort or a capacity value.
- **D3:** the Team-selector set; today's set until work is known; no stored-number pencil and no Jira read for unresolved or comma-containing names.
- **D4:** keep `MAX_DOCUMENTS_PER_WORKSPACE = 2000` and show the limit as that Team's visible rejection.

G1 (counts only, operator-provided 2026-11-06):
- The largest Department has 12 Teams.
- Typical selected/displayed counts and Teams × Sprints were not provided; both are bounded by 12 per Sprint.
- At 12 Teams the 2,000-document cap allows about 166 Sprints of documents.
- At 12 Teams the batch read is always one chunk, and the Jira capacity read stays at one search (`ceil(12/20)`). Task 0 still measures G3.

Review record (2026-11-06), all independent and read-only:
- revision 1: a backend/security review (2 P1, 5 P2) and a frontend/verification review (6 P1, several P2);
- revision 2: a re-validation (4 P1, 9 P2, minors).

Revision 3 addresses every finding or raises it as D1–D4 or G1–G3.
