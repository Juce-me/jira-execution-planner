# Planning Assignee Capacity Table (#323)

> **Status:** Design, revision 2 (2026-10-29), approved by the operator the same day (D1 to D4 resolved, deactivated-user names added). Revision 1 was committed as `430bed1c`; four independent read-only validations (flaws, API usage, load, redundancy) produced this revision. Nothing is implemented. Branch `feature/323-planning-assignee-capacity-table`.

## Intent

The team lead plans the team's effort for a Sprint from one view: how much capacity each person has, how much work each carries, how much has been taken (checked) into the plan, and how much work still has no owner. Issue [#323](https://github.com/Juce-me/jira-execution-planner/issues/323). All numbers are Story Points. Anti-goal: a second source of truth for team capacity; Jira capacity stays the core number.

## Operator decisions (resolved 2026-10-29)

- **D1 Placement.** The table is a collapsible strip in normal page flow (the pattern of the Planned Teams Effort strip, expanded state persisted), not inside the pinned overview. Only a thin underbar (a 4 to 6 px strip inside the existing capacity track, adding no height) appears in the pinned panel, once the table has been expanded. Reason: the Table-layout pinned stack is `position: sticky` with a 173.5 px contract; a 15-person table would pin about 1,000 px.
- **D2 First slice.** Add assignee, Cmd+Z/Undo and the stored planned team capacity with Push to Jira are deferred (see Deferred scope), as recommended; the operator accepted the rest of the plan as written. Without a planned number the underbar uses Jira capacity, else the sum of the people's Capacity.
- **D3 Concurrent edits.** Per-field last-write-wins merge under a lock; no 409 and no per-row revisions.
- **D4 Visibility.** Capacity, Vacations, Notes and stored names are readable and writable by any signed-in user of the workspace, as with shared group settings, with no per-issue Jira authorization.
- **Names are stored.** Every row keeps a `displayName` snapshot so a person later deactivated in Jira still shows, as historic data (see Rows and inheritance).

## Behaviour

### Where it shows

Planning Table layout, exactly one team selected (`!isAllTeamsSelected && selectedTeamSet.size === 1`). Otherwise `PlanningTeamCapacityCards` is unchanged. The team capacity card stays as it is (Jira number, pencil editor, missing-ticket banner, Refresh capacity). The table is a new in-flow strip (D1) holding the table and the removed strip; its expanded state is a persisted preference like `planningTeamsEffortExpanded`.

### Columns

Assignee, Capacity, Selected effort, Total effort, Vacations, Notes. No Total/available column.

- **Capacity, Vacations, Notes:** typed in. Numbers are Story Points, 0 to 10 000, at most two decimals, JSON strings on the wire (`"10.25"`), blank means unset (counts as 0). Notes up to 500 characters, single line, control characters rejected. Vacations are informational (not subtracted from Capacity) and may exceed it; negative values are rejected. An invalid draft stays in its cell with an error and is not sent.
- **Selected effort:** Story Points of the checked Stories of the selected team per assignee, taken from `selectedTasksList` (the set the capacity bar's `selectedSP` and the team card use), so its total equals the bar's Selected for the team. It excludes Stories hidden by active search or facet filters, as the bar does.
- **Total effort:** every non-Killed Story of the selected team in the Sprint, independent of filters and checkboxes: `projectPlanningOriginals(capacityTasks, planningOriginals)` filtered by `getTeamInfo(task).id === teamId` and `normalizeStatus(status) !== 'killed'` (pending status edits count as the existing filters count them). Includes Stories under excluded Epics. Null Story Points count as 0.
- **Unassigned:** `!task.fields.assignee?.accountId` (the loader returns an assignee object with null fields for unassigned work, so a truthiness test is wrong). It gets its own row, highlighted with the existing warning tone (a reused class), sorted first, shown only while unassigned Stories exist, not editable or removable.
- **Totals row:** sums of Capacity, Selected, Total and Vacations (four numeric columns), including the Unassigned row's effort. The over-capacity cue reuses the existing thresholds (over above 120% and under below 90%, `planningCapacityUtils.js`) comparing Selected with Capacity, only for rows with Capacity set; the Totals cue compares the people's Selected (without Unassigned) with the sum of Capacity.
- Sums and comparisons run in integer hundredths (no float drift); display is at most two decimals, trailing zeros trimmed. Rows sort by name then key and keep their position while one is being edited.

### Rows and inheritance

- Rows are merged by assignee key from: assignees with Stories in scope, rows of this Sprint's document, and inherited rows. One person is one row, always.
- Inheritance is whole-document: for an active or future Sprint with no document of its own, the read returns the nearest earlier document for this team (`sprint_order <`) as `inherited`, a single source. Its non-removed people and their Capacity show gray, with one hint line "Inherited from Sprint X" (the existing hint pattern). Vacations and Notes are not inherited. Closed Sprints show only their own document.
- **First write materialises.** The first save in a Sprint without a document creates it in one locked transaction: the server copies the source's non-removed people and Capacity, then applies the change. The Sprint becomes the complete source for the next one, so a partial edit never drops people downstream, and an edit to Vacations or Notes of a gray row cannot blank its Capacity. The client sends no inherited values. A no-op commit (value equals what is shown) sends nothing, so tabbing across gray rows creates no document.
- **Names are stored.** Every row stores a `displayName` snapshot (and the account id, which Jira keeps for deactivated users). When a Story supplies the person's current name, a save refreshes the snapshot; a read never writes. A person with no Stories, including one later deactivated or removed from Jira, keeps appearing under the stored name as historic data, and is never dropped because Jira no longer lists them. A person with Stories shows the name from the Story.
- **Remove / Restore.** Remove is offered only for a person with no Stories in scope. A removed person moves to a one-line strip under the table with a sad face, "Removed from this Sprint: name, name"; each name restores with one tap. Values are retained while removed. A person who has Stories is never removed. The strip is absent when nothing is removed.

### Saving

- Commits (Enter or blur; Escape cancels) go through one serial save queue per Sprint and team: one request in flight, commits within about 200 ms coalesced into one `changes[]`, no no-op requests. Last-write-wins makes a retry idempotent, so a lost response is handled by reloading and re-sending only differing fields.
- The CSRF token is reused across the queue.
- Scope change (Team or Sprint) flushes or guards through the same semantics as `guardScopeChange` in `usePlanningSprintReview.js`; late responses for another scope are dropped (scope key plus generation counter). Collapsing the strip or the panel commits any open edit first. A 401 keeps drafts and uses the existing terminal sign-in lock.
- Basic or non-database mode: the read returns `capabilities {canRead, canSave, reason}` and the table is read-only or hidden accordingly.
- States defined and tested: loading, empty (no Stories, no rows), read failure, saving, saved, failed.

### Underbar

A thin segmented strip inside the existing capacity track using `stats/StackedBar.jsx` (pointer-clamped in-app readout, no native `title`) and `buildTeamColorMap` / `resolveTeamColor` from `statsUtils.js` (sorted-index colours, so no collisions; the row swatch uses the same map). One segment per person, width proportional to Capacity against the denominator: raw Jira capacity (`rawCapacity`; the bar above shows the Product/Tech-adjusted value, so the table notes when they differ), else the sum of the people's Capacity; with no number at all, no underbar. Unassigned work is a trailing segment in the warning colour sized by unassigned Total effort; its readout says "Unassigned (effort)" with Total and Selected, and it overflows plainly rather than claiming over-allocation. Touch: tapping a segment shows the readout. It reads the same data as the table and renders only after the strip has been expanded once (D1).

## Data model

One table, `planning_team_sprint_capacity`: `id` Uuid, `workspace_id` FK CASCADE, `sprint_id`, `sprint_order` (128-digit padded, `CHECK length = 128`, as `GroupSprintReviewView`), `team_id`, `rows` JSON (`assigneeKey`, `displayName`, `capacity`, `vacations`, `notes`, `removed`), `revision` int >= 1, timestamps. Unique on (workspace_id, sprint_id, team_id); index (workspace_id, team_id, sprint_order) serves the nearest-earlier lookup. Keyed by workspace + Sprint + Team, not Department group (Jira capacity is per team and Sprint; no group-id reattachment hazard). No user columns.

Bounds: at most 100 rows per document, 2,000 documents per workspace, body 64 KiB, response 256 KiB, ids 128 characters, `displayName` 200 characters without control characters. `assigneeKey` is the Jira account id and is not Jira-verified; `teamId` is validated by shape and length only.

Alembic revision `20261029_0022`, `down_revision = '20261028_0021'` (precedent `20261020_0019_group_review_columns.py`). Tests that pin the current head must move to the new one: `tests/test_review_adoption_migration.py`, `tests/test_remove_user_api_token_migration.py`, `tests/test_sprint_review_postgresql.py`.

Concurrency mechanism: insert the document row with `ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE` (as `_locked_schema`, `sprint_review.py:418`); `SET LOCAL lock_timeout` about 3 s mapped to 503; no Jira or network call inside the lock; an empty PATCH takes no lock. SQLite ignores `FOR UPDATE`, so a PostgreSQL race test (two first-writers of one new document) is part of the DoD and runs with `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1` and an approved `TEST_DATABASE_URL`.

## API

Routes are added to `backend/routes/sprint_review_routes.py` reusing its `_run`, `_response` and `_payload`; the service is a new `backend/services/assignee_capacity.py` reusing `sprint_order`, `sprint_identity`, `ReviewError` and `require_review_context` from `sprint_review.py`. Responses `Cache-Control: no-store`; identity from `RequestAuthContext` only; unknown or duplicate query args and unknown body keys are 400.

| | `GET /api/eng/sprints/<sprint_id>/assignee-capacity?teamId=` | `PATCH` (same path) |
|---|---|---|
| Policy | `eng-assignee-capacity-read`, `authenticated_read`, dynamic | `eng-assignee-capacity-write`, `user_write`: `X-CSRF-Token` and `X-Requested-With: jira-execution-planner` |
| Body | none | `{teamId, changes:[{assigneeKey, displayName?, capacity?, vacations?, notes?, removed?}]}`; at most 50 changes; duplicate `assigneeKey` is 400; absent field means unchanged, `null` clears |
| 200 | `{teamId, sprintId, revision, rows, inherited: {fromSprintId, rows} \| null, capabilities}`; closed Sprints ignore `inherited` client-side | the saved document (`rows`, `revision`) |
| Errors | 400, 401 (global lock), 413, 503 (storage unavailable, lock timeout) | same; 403 `csrf_required` |

Registration: policy rows in `backend/security/policy.py`, `ROUTE_SAMPLES` and `SECURITY_SAMPLES` (`tests/endpoint_security_samples.py`, `tests/test_endpoint_security_matrix.py`), `docs/security/endpoints.md`, and a new row in `backend/security/CONFIGURATION_OWNERSHIP.md`, reconciling its line "Team is a filter, never a storage key" and checklist item 1 (this store is shared per workspace, Sprint and Team). Keep it out of `workspace_dashboard_configs` and `shared_capacity_config`. The existing `GET /api/planned-capacity` alias does not collide; the user-facing term "Planned capacity" is avoided in this slice. Frontend call module `frontend/src/api/assigneeCapacityApi.js` (the source guard forbids raw `/api/` literals elsewhere) with a `docs/design-system.md` exemption row; reuse an existing analytics `API_SURFACES` entry if one fits, otherwise register one (README `api_result` row and tests), because an unregistered surface is silently dropped.

## Load and freshness

- **Fetch lazily.** Mount and fetch on first expansion of the strip, then keep it mounted (drafts and editors survive collapse). Gate on the review hook's flags (`showPlanning`, Table layout, not `shareViewHold`, `reviewGroupReady`). Abort on scope change, cache per (Sprint, team) for the page session with revalidation, settle about 250 ms after a team change. A user whose strip stays expanded pays one GET per Planning load; others pay none.
- **Freshness (#251).** Add `planning_assignee_capacity` as a secondary source fetched in parallel with the capacity GET, only when mounted and expanded; blocked while a cell is focused, dirty, saving or failed; not part of `ownerBusy`; included in the header Refresh; the #251 ceiling table is amended ("+1 GET, only when mounted"). Row-count changes use the shared reading-position path; verify with the inherited-view hint present and dismissed.
- **State placement.** The hook and the effort derivations live in a provider component that wraps the slot, not in `App` (no new `use*(` call in App; no edit to `useEngCapacity.js`). `totalEffortByAssignee` is keyed on `[capacityTasks, teamId]` only; `selectedEffortByAssignee` on the selected list. Table and underbar are memoised with stable props.
- **Budgets.** `dashboard.jsx` is at its exact ceiling (7,302): net change must be 0 or less, achieved by moving the `capacity=`/`teams=` slot assembly into a new component. New owner modules are registered in `owner_budgets.json`. The table loads as a lazy chunk (existing `views` pattern) on first expansion; measure the bundle with the G3a method and record the delta.
- **Test fixtures.** The Planning fixture answers unknown `/api/**` with 404; update it so one-team specs do not fall into the error state.

## Files

Backend new: `backend/services/assignee_capacity.py`, model and migration. Backend edited: `backend/routes/sprint_review_routes.py`, `backend/security/policy.py`. Frontend new: `eng/PlanningAssigneeCapacity.jsx` (provider, strip, table), `eng/PlanningAssigneeCapacityBar.jsx` (thin wrapper over `StackedBar`), `eng/planningAssigneeCapacityModel.js` (merge, Unassigned, hundredths sums, cues), `eng/usePlanningAssigneeCapacity.js` (state, queue), `api/assigneeCapacityApi.js`, `styles/planning/assignee-capacity.css`. Edited minimally: `dashboard.jsx` (slot extraction, net zero), `PlanningOverviewPanel.jsx` (underbar slot if needed). Reuse: `planning-review-input` cells, `planning-action-button`, existing warning-tone and hint classes; every element kind is looked up in `docs/design-system.md` first (a new class for an existing kind is a review-stop), new classes registered in the map and ratchet allowlist.

## Tasks

1. **Backend store:** model, migration, service (materialise-on-first-write, whole-document inheritance, bounds, lock). Tests: service, migration offline SQL, moved head pins, PostgreSQL concurrency run recorded, EXPLAIN showing an index scan, a query-count assertion (at most 4 queries on GET).
2. **Routes and policy:** contracts above; tests for two users in one workspace, two workspaces, 401 vs 403, CSRF, size limits, every error body, endpoint inventory and security matrix; `Server-Timing` on both routes.
3. **Client model and API:** pure functions with Node tests (merge, Unassigned, hundredths sums, cues, Selected/Total sources, first-write behaviour, no-op commits); confirm during this task how many issues one load can return (`/api/tasks-with-team-name` collects at most 250 per request) and, if Total effort can be understated, show "may be incomplete".
4. **Table and save queue:** strip, rows, Remove/Restore, gray inheritance, Unassigned row, scope-change guard, states.
5. **Underbar** in the pinned track at no added height, Unassigned segment, touch readout.
6. **Freshness and lazy loading:** secondary source, lazy chunk, ceilings, fixture update.
7. **Docs and analytics:** `docs/features/planning-sprint-review.md` (one section), `docs/ontology.md`, `docs/design-system.md`, `docs/README_ANALYTICS.md` (a No-Event Allowlist row; edits carry user text; no names, ids or values in params), `CONFIGURATION_OWNERSHIP.md`, `docs/security/endpoints.md`, `owner_budgets.json`, plan README.
8. **Verification gate** (below).

## Definition of Done

Evidence for each item (command output, test name or screenshot) is recorded in an Execution log section appended to this plan.

**Behaviour**
1. One team selected shows the strip; two teams or All shows the old cards.
2. No person appears twice (inherited, saved and Stories rows merge); a model test and a UI test prove it.
3. Total effort = every non-Killed Story of the team; identity tested: sum of rows plus Unassigned equals that sum. Selected effort totals equal the capacity bar's Selected for the team.
4. Unassigned work has its own highlighted row and underbar segment equal to the Stories with no `accountId`.
5. A Future Sprint opens pre-filled from the nearest earlier document; the first edit materialises it; the next Sprint still shows everyone; editing Vacations of a gray row keeps its Capacity.
6. Remove is unavailable for people with Stories; removed people appear in the sad-face strip and restore with one tap.
7. Three quick edits across one row produce at most two PATCHes and no error; a lost response is recovered without false failure.
8. A person who no longer has Stories, or is deactivated in Jira, still appears in a Sprint's table under the stored name, in the Sprint they were saved in and in Sprints that inherit from it; a model test and a service test prove it, and a read performs no write.
9. The lead reads per-person Capacity, Vacations, Selected, Total, unassigned Story Points and the team number from one view.

**Quality**
10. Backend, migration, endpoint-inventory, security-matrix tests pass; the PostgreSQL concurrency run (env-gated) is recorded as run, not skipped.
11. `npm run build`, the full Node suite, `python3 -m unittest discover -s tests` (including structure budgets and `tests.test_agents_md_learnings`) and the full Chromium `tests/ui` run pass; any baseline failure is explained per repository rules.
12. Request ledger (one-team Table): compact cold load 0 new requests; first expansion 1; collapse and re-expand 0; Sprint switch at most 1; team A to B at most 1; return after 13 minutes at most 1 and 0 when collapsed or blocked; no non-GET in an automatic window.
13. Render and compute: App render counts unchanged on a Story toggle (3,000 Stories, strip expanded) and at most one App render per commit; the Total builder runs 0 times per toggle; toggle-to-paint p50/p95 at 500, 2,000 and 5,000 Stories compared with base.
14. Geometry: compact panel under 64 px and pinned stack at most 175 px with one team selected at 1440x900 and 1280x720 (add one-team cases to `planning_review_integration.spec.js` `:672` and `:802`); element-level assertions for every control kind; headed Firefox and WebKit hover and glyph checks (manual; evidence recorded); settled screenshots with gray values, the Unassigned row and the removed strip.
15. Touch: every action works by tap, including the segment readouts.
16. Bundle delta measured by the G3a method and within the recorded budget, or the chunk is lazy with zero cold bytes.

**Documentation and hygiene**
17. Docs listed in Task 7 are updated; the plan has Outcome, Current Accuracy, an execution log and is renamed `DONE-` with README entry and links in the completing commit.
18. Publication follows `AGENTS.md` section 10; push and PR only on the operator's explicit confirmation.

## Deferred scope (if kept in D2, these are the corrected designs)

- **Add assignee.** Needs a new read-only OAuth user search (for example `POST /api/eng/assignee-capacity/user-options`, `user_write` like the issue one, no email, single page, active users only) feeding the presentational `IssuePersonEditor` (its data hook is Jira-write-registered and bound to an issue key, so it cannot be reused). Adding a removed person is Restore.
- **Undo.** A client stack of full-row snapshots queued behind the save queue, cleared on scope change and on any failure; Cmd/Ctrl+Z only when focus is in the table and no field is mid-edit, plus a visible control for touch; ignore key auto-repeat. Undo of the first edit of an inherited row cannot restore "still inheriting"; document that.
- **Planned team capacity and Push to Jira.** A nullable typed number on the document, shown as "Planned" only when no Jira ticket exists; Push opens the existing capacity editor prefilled with the planned value so the existing single call site and design-system pin are reused; conflicts surface as `capacity_conflict` (409, current value shown); the service is not an atomic compare-and-set, so the UI must not promise that nothing is written; the editor is available only where `capacityTargetState === 'matched'` and `capacityMutationEnabled`; the card needs the Sprint id and the planned value; a distinct analytics `workflow_action` is a README and test change.

## Decisions taken by the operator (unchanged)

Storage in the app database, with a stored display-name snapshot per person; Capacity, Vacations and Notes user-entered, Notes per assignee; Story Points everywhere; separate Selected and Total effort; Future Sprint inherits assignees and Capacity, shown gray; Jira capacity stays the core number; edits save on commit; the team lead plans from this single view; removed rows are shown with a sad face, not hidden; Unassigned work gets its own highlighted row and underbar segment; no duplicate rows.

## Validation record (revision 2)

Four validators agreed on: the pinned-panel height problem (D1), no reusable person search, autosave self-conflicts and the inheritance chain break (both fixed by serial queue plus materialise-on-first-write), the wrong Selected source, and the missing index and lock row. Fixed without a decision: the effort sources, Unassigned detection, colour collisions (sorted-index map), hundredths arithmetic, API registration list, head-pinned tests, fetch laziness, freshness integration, `dashboard.jsx` budget, measurement gates. Left to the operator: D1 to D4.
