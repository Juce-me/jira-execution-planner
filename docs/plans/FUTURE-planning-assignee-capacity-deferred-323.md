# Planning Assignee Capacity: Deferred Scope (#323)

> **Status:** Deferred follow-up. Spun out of `DONE-planning-assignee-capacity-table-323.md`. Do not execute without renaming to `EXEC-*` after review. On 2026-11-06 the "Team capacity for every selected Team" scope, the one-click push and the open items were promoted to [EXEC-planning-team-capacity-every-team-323.md](EXEC-planning-team-capacity-every-team-323.md), which records the source review; this file keeps the original design text for audit until that plan completes.

## Team capacity for every selected Team

### Intent

Owner decisions confirmed 2026-11-05: remove the one-Team restriction from stored
**Team capacity (not in Jira)**; deprecate Planning List in favour of Table; show
capacity cards for Teams without pointed Stories too. This is plan authorship
only. No implementation, commit, push or live configuration inspection is authorized
by this update. The earlier request to pause #331 implementation remains in force.

Each displayed Team owns its own editable number for the selected Sprint, whether
one, several or All Teams are selected. There is no combined editable capacity for
the selection. This supersedes the future direction of D6, the one-Team portion of
B1, and B2 in the completed #323 audit record; it does not rewrite that record or
claim the limitation has already been removed.

### Decisions

1. **Keep storage and ownership.** Reuse `PlanningTeamSprintCapacity`, keyed by
   workspace, Sprint and Team, with `planned_capacity` / `planned_source` on the
   same document as person rows. Preserve existing authenticated shared read/save
   rights, nearest-earlier-Sprint-by-id inheritance, nullable values, decimal
   bounds and first-write materialisation. No migration, administrator settings
   relocation, new Jira write route or credential change is needed for this scope.
2. **Read Team numbers in batches.** Add the proposed read-only
   `POST /api/eng/sprints/<sprint_id>/assignee-capacity/planned/read` contract below.
   It returns only Team-level numbers, revision and inheritance metadata, not
   person names, notes or rows. For multi-Team scope, read every displayed Team in
   chunks of at most 500 unique IDs and 128 KiB of encoded request JSON, one chunk
   in flight, with a 256 KiB response limit. Requests are `ceil(N / 500)` when
   byte bounds fit; split oversized chunks by bytes, never a per-Team fetch loop.
   Partition a response-size failure by halving the chunk; a single-ID failure is
   terminal and visible, not an infinite retry. Fetch only when Planning Table is
   active and Sprint/Team scope is validated, or on an authorized refresh; add no
   request to initial Catch Up/EPM/dashboard bootstrap. One-Team mode continues
   its existing full-document GET and derives this projection without a duplicate
   batch call. Moving between scopes reuses matching page-session data.
3. **Measure scope before execution acceptance.** Current Department cardinalities
   are unknown: private generated group/catalog files and the real environment
   were not inspected. During execution, obtain an operator-approved counts-only
   measurement (largest Department and selected/displayed counts; no names or IDs
   in evidence). Verify chunk counts against it, plus synthetic 2, 50, 500 and 501
   Team cases. Do not silently cap which Teams get cards or call the batch size
   evidence of the actual installation's size. Record request counts, payload
   sizes and timing for existing one-Team and new multi-Team flows before/after.
4. **Separate summary and full-document lifetimes.** Keep the Assignee Capacity
   strip, per-person rows, Add assignee and person underbar one-Team only. Multi-Team
   reads hydrate a Team-number projection, never a partial document masquerading
   as a full one. On explicit pencil use, load that Team's full document if not
   cached, then use its existing save machinery. Cache/reuse this document when
   switching to that one Team. Person data is not prefetched for every card.
5. **One write owner per Team.** Replace the current backend-wide controller's
   single active `current` scope as the multi-card authority with keyed Team
   owners, scoped to authenticated workspace/session, backend, Sprint and Team.
   The one-Team strip and its card share the same owner. Reuse the existing
   coalescing, single-flight-per-document queue, planned-only PATCH and readback
   recovery; do not create a second queue for the same document. Different Teams'
   saves may progress independently. An editor captures its Team ID and Sprint;
   changing header scope must not retarget an in-flight write. Keep one visible
   card editor at a time; saving it may complete while another Team is edited.
   Pending, failed and rejected states, Retry and Discard remain Team-specific.
   The existing five parked-scope eviction limit must never evict dirty or running
   displayed owners: evict clean inactive owners only and retain unsaved scopes
   until explicitly resolved. Reset identities/caches on auth-session change;
   a 401 uses the existing terminal global recovery and never replays a write.
6. **Use one complete ID-keyed capacity projection.** Publish a stable combined
   Team-number snapshot through the existing App subscription boundary; do not
   add one App hook per card. Remove the selection-cardinality test in
   `useEngCapacity`; adapt IDs to existing normalized capacity-name keys only at
   its established boundary. Ambiguous names must not borrow another Team's
   value or editor. Feed the fallback into `effectiveCapacityState`, not only
   `selectedTeamEntries`, so multiplier, excluded-capacity maths, amber bar,
   project split and totals agree. Do not change Jira targets, issue counts or
   mutation capability to make a stored value appear writable.
7. **Preserve the exact eligibility rules.** A stored-number pencil requires
   save rights and the existing settled no-ticket predicate: capacity enabled,
   matching scope, known issue count, not loading/failed/stale/ambiguous, missing
   target and no numeric Jira value. A matched blank ticket may display the
   stored fallback, but its pencil still edits Jira. Jira wins whenever it has a
   value. A zero stored number is a value, not absence; inherited numbers stay
   gray until the existing materialisation rules apply.
8. **Include Teams without pointed Stories.** Build cards from validated selected
   Department Teams, including the All Teams projection, rather than only the
   pointed-task aggregate. Do not use the workspace name directory as proof of
   Department/Sprint membership. Preserve Team ordering and card styling; use
   zero effort for a Team with no Stories, and retain missing-estimate treatment
   for unpointed Stories. A card's existence does not imply a Jira ticket exists
   or authorize an editor before reads settle. Exclusions and totals must not
   double count a Team introduced through both catalog and task aggregation.
9. **Reconcile independently.** Reuse one existing section-level banner row per
   differing Team, in card order, each naming its Team. Preserve Write to ticket
   (open that Team's existing Jira editor prefilled; no write until its Save),
   Use ticket value (that Team's DB document only) and Not now (dismissal keyed
   by Sprint, Team and both values). Hide/defer rows while the existing editor
   suppression applies. A failure/dismissal on A cannot clear B's row. Extend
   guarded silent mirroring to idle loaded Team owners after user-initiated
   reads only; automatic reads never mirror, typed values never get overwritten,
   inherited-only reads never create documents, and failed mirrors stay silent.
10. **Freshness preserves working state.** Automatic follow-up and header Refresh
    use the batch projection for multi-Team scope and the full read for one Team.
    Freeze identity/generation and discard late responses after scope/auth change.
    Do not publish a refreshed number over an open editor, dirty queue, in-flight
    save or retained failure for that Team; overlay local values and fence stale
    reads by write epoch. Other clean Teams may refresh. An unchanged projection
    keeps object identity; refresh must preserve focus, editor text, scroll and
    reading position. Surface read errors without turning unknown values into
    zero or enabling a pencil; recovery is explicit and cannot trigger a PATCH.
11. **Retire Planning List without losing inspection.** Coordinate with
    [#331's Table replacement and E3 gate](EXEC-planning-shared-plan-331.md).
    Table must expose hierarchy, dependencies and subtasks through the agreed
    existing-component details interaction before removing the Planning layout
    toggle and List rendering. Reuse that implementation if already landed;
    otherwise include its acceptance as a prerequisite, without copying a second
    inspector. Normalize old Planning List preferences/share links to Table.
    Catch Up List, its stored choices and other modes remain unchanged. Capacity
    cardinality is independent of the Epics/Stories row-mode switch. Do not ship
    a new List capacity implementation during this transition.

### Route and data contract

Proposed additive batch request: `{"teamIds":["team-alpha","team-beta"]}`.
Reject unknown fields, duplicates, invalid IDs/Sprint and exceeded bounds before
the query. IDs use the same `team_identity` validation as the existing route.
The authenticated server resolves workspace; callers never supply it. Preserve
the existing route's rights policy, not a new Team-admin or Jira-membership rule.

```json
{
  "sprintId": "101",
  "teams": [
    {"teamId": "team-alpha", "revision": 3, "planned": {"value": "20", "source": "user"}, "inherited": null},
    {"teamId": "team-beta", "revision": 0, "planned": null,
     "inherited": {"fromSprintId": "100", "planned": {"value": "15", "source": "inherited"}}}
  ],
  "capabilities": {"canRead": true, "canSave": true}
}
```

Use the existing decimal wire representation. Return exactly one record per
requested ID in request order; absent records have revision 0, `planned: null`,
`inherited: null`. An own document with null capacity must not inherit an older
number. Select the latest whole document at or before the requested Sprint for
each Team, then project its number; never query one Team at a time or mutate on
read. Use a single bounded workspace-scoped SQL query per chunk and verify its
query count, including whole-document inheritance parity and empty own documents.

| Surface | Auth / request guards | Success / failures | Required proof |
| --- | --- | --- | --- |
| New batch POST | Existing DB/OAuth context, workspace boundary, token-bound CSRF and `X-Requested-With: jira-execution-planner`; no shared-save capability needed just to read | 200 projection; when `canRead` is false, empty `teams` and false capabilities without data reads; sanitized 400 invalid input, 401 terminal auth, 403 guard failure, 413 bound/response limit, 503 storage unavailable | Read-only SQL; no rows/notes; exact IDs; multi-workspace denial; body caps; no legacy auth fallback; CSRF consumed once |
| Existing full GET | Existing `teamId` query and authenticated read policy | Existing full-document response/errors unchanged | One-Team strip and explicit card edit load share the same owner/cache |
| Existing single-Team PATCH | Existing auth, CSRF, X-Requested-With and save capability | Existing `{teamId, changes?, planned?}` and response/errors unchanged; no new CAS promise | Exactly one document changes; person rows preserved; concurrent different-Team saves and same-Team readback semantics |

No bulk write endpoint, new revision-CAS contract or storage schema is proposed.
The existing server locks/merge policy remains authoritative; test its actual
same-Team outcomes rather than promising conflict detection it does not provide.
Any independently pending CSRF repair must land through its own approved scope;
this deferred capacity plan neither authorizes nor duplicates that migration.
That repair is [#331 Task 0.1](EXEC-planning-shared-plan-331.md), revised
2026-11-06: a PostgreSQL-only stack and one database row per CSRF token. It also
removes the assignee-capacity controller's cached-token reuse. Real-app acceptance
of independent multi-Team saves and the batch read depends on it.

### File map

- `backend/services/assignee_capacity.py`: bounded batch projection using existing
  model/inheritance rules; existing writes preserved.
- `backend/routes/sprint_review_routes.py`: additive bounded read route and guards.
- `frontend/src/api/assigneeCapacityApi.js`: batch read transport, validation and
  error handling using existing auth/CSRF handling.
- `frontend/src/eng/usePlanningAssigneeCapacity.js`: keyed owner lifecycle, shared
  one-Team/card queue, bounded read cache and stable combined number projection.
- `frontend/src/eng/PlanningAssigneeCapacity.jsx`: keep one-Team person strip;
  remove its accidental exclusive ownership of all stored Team numbers.
- `frontend/src/eng/useEngCapacity.js`, `planningCapacityUtils.js`: multi-Team
  fallback injection and cards for validated Teams without pointed Stories.
- `frontend/src/eng/PlanningTeamCapacityCards.jsx`: Team-keyed editor/feedback,
  multiple reconcile rows and existing action-rail geometry.
- `frontend/src/dashboard.jsx`: existing owner/subscription wiring and Table-only
  Planning integration within current extraction budgets; no new toolbar.
- #331's `PlanningActionBar.jsx` and Planning layout preference/share consumers:
  remove only Planning List paths after the shared E3 acceptance gate.
- Tests: `tests/test_assignee_capacity_service.py`,
  `tests/test_assignee_capacity_routes.py`, `tests/test_assignee_capacity_api.js`,
  `tests/test_planning_assignee_capacity_queue.js`,
  `tests/test_planning_capacity_utils.js`, `tests/ui/planning_assignee_capacity.spec.js`
  and existing Planning/sticky/share-link suites.
- Execution docs: `docs/features/planning-sprint-review.md` (Freshness,
  Limitations, card coverage and Table-only Planning), this plan, the completed
  #323 plan's Current Accuracy, `docs/ontology.md`, `docs/design-system.md`, and
  `docs/README_ANALYTICS.md`. Keep the ownership matrix aligned if adding the
  route inventory, without changing its rights.

### Tasks, each with verification

- [ ] **1. Freeze baselines and scope evidence.** Capture synthetic before
  screenshots for one/two/All Teams, no-Story and unpointed-Story Teams, and the
  existing initial dashboard/Planning request ledger. Record approved counts-only
  Department size evidence. **Verify:** old one-Team value, inheritance, Jira
  precedence, editor predicate and per-person strip tests pass unchanged; new
  two-Team/card-coverage expectations fail for the intended old gates.
- [ ] **2. Add the batch projection.** Implement the contract above in the
  existing service/routes/API; preserve all single-Team interfaces. **Verify:**
  isolated service/routes/API suites cover 0/2/500/501 IDs (empty is rejected),
  response splitting, malformed/duplicate IDs, missing/null/zero/own/inherited
  values, one SQL query, request order, cross-workspace isolation, non-admin
  read/save rights and no DB/Jira writes or person-data leakage on reads.
- [ ] **3. Make Team owners independent.** Share each owner between card and
  strip, load full documents lazily for edits, merge summary refreshes without
  overwriting local changes, and publish one stable App projection. **Verify:**
  queue tests delay A while B saves, fail A while B succeeds, revisit failed A,
  edit during readback, change Sprint/header Teams mid-save, receive late refresh,
  exceed five dirty Teams, and expire auth; payloads always keep their captured
  Team/Sprint, no automatic replay and no lost person rows. Assert no duplicate
  full read when selecting a cached Team and no per-Team startup fetch fan-out.
- [ ] **4. Wire cards, maths and reconciliation.** Remove all three cardinality
  gates, add empty/unpointed Team cards and independent reconcile rows; preserve
  existing capacity editor components, tokens and rail. **Verify:** Playwright
  two/All Team cases exercise each pencil and independent saves; mixed ticketed,
  no-ticket, blank-ticket, ambiguous, failed and inherited states have the exact
  existing rights. Check zero, multiplier/exclusions, totals, amber/project bars,
  dismissal isolation and Jira mutation absence until the issue editor's Save.
  Assert settled element-level hover/focus/geometry for pencils, editor controls,
  Retry/Discard and every reconcile action; capture before/after screenshots.
- [ ] **5. Retire Planning List after E3.** Accept real-app Table inspection,
  hierarchy/dependency/subtask and selection/filter/scroll behavior first, then
  remove the Planning toggle/renderer and normalize old preferences/links.
  **Verify:** Planning always opens Table from old List state; Catch Up List and
  its controls still work; no extra toolbar or sticky-height regression in
  Catch Up, Planning and Scenario; person strip/underbar remain one-Team only.
- [ ] **6. Verify refresh, performance and docs.** Exercise header Refresh and
  automatic follow-up with one editor open, another failed queue and clean other
  Teams; verify unchanged projection identity and preserved focus/reading position.
  Record request/payload/SQL budgets against the measured Department counts and
  synthetic chunk boundary. Update the affected docs and analytics taxonomy.
  **Verify:** existing analytics event names/typed params keep their meanings;
  batch reads, hydration, mirroring and List-preference normalization have an
  explicit no-event allowlist reason; user capacity saves reuse the existing
  event with no Team IDs/names or values added. Run build, isolated relevant
  backend/Node suites, complete required browser coverage and headed Firefox/
  WebKit affected control checks. Use the repository's isolated runner and
  reviewed `--include` paths, never live dotenv or application databases.

### Forbidden regressions

- No one-Team prerequisite for a displayed Team's stored number, card or pencil.
- No selection-wide editable number, Team-name write targeting, cross-Team queue
  contamination, new person prefetch, shared-plan Save coupling or silent loss of
  a pending/failed capacity save. Capacity saves remain independent of #331.
- No changes to no-ticket eligibility, inheritance, Jira precedence, per-person
  strip scope, existing Jira Save authority, ownership or legacy auth retirement.
- No new initial dashboard request, unbounded per-Team fetch/SQL loop, read-side
  materialisation, focus/scroll jump or unrelated Table typography/layout change.
- No Planning List removal before the shared Table-details acceptance gate.

### Acceptance checklist

- [ ] One, two, several and All Teams show each validated selected Team's card,
  including no-Story and unpointed-Story Teams.
- [ ] Each eligible card reads/writes only its own Team/Sprint number; mixed Jira
  and stored capacities, inherited and zero values feed all existing maths.
- [ ] Batched Team-only reads and lazy full-document edits meet measured request,
  response-size and query bounds; initial non-Planning startup is unchanged.
- [ ] Different-Team saves, failures, Retry/Discard, refresh, scope changes and
  auth recovery preserve drafts and never retarget or replay writes.
- [ ] Multiple reconcile rows and guarded mirroring preserve existing semantics;
  only explicit Save in the existing Jira editor writes Jira.
- [ ] Table-only Planning preserves inspection and old link/preferences intent;
  Catch Up List stays supported; assignee strip/underbar stay one-Team only.
- [ ] Required UI geometry/screenshots, analytics review, isolated tests and
  feature/ontology/audit documentation updates pass before marking work done.

### Review status and current accuracy

Source-traced 2026-11-05. Owner scope questions are resolved above. The current
application still has the one-Team restriction; this section is the proposed
follow-up, not evidence of implementation. Department-size measurements and
real-app acceptance remain execution gates. Keep the file `FUTURE-*` as the
deferred-scope list; review and explicitly schedule execution before promoting
the relevant scope to `EXEC-*`, updating the index and all affected links.

## One-click push of the stored team number to Jira

Not built: Jira is written only through the existing capacity editor on the user's Save (the reconcile banner's Write to ticket opens that editor prefilled). If a direct push is wanted later: conflicts surface as `capacity_conflict` (409, current value shown), the service is not an atomic compare-and-set so the UI must not promise nothing is written, it is available only where `capacityTargetState === 'matched'` and `capacityMutationEnabled`, and a distinct analytics `workflow_action` is a README and test change.

## Open items from the verification gate

- **Closed 2026-11-09 by `a312bae3` (Task 8 Step 1 of the EXEC plan):** the regression "ENG return refresh starts after an aborted ENG read retired while EPM was active" in `tests/ui/dashboard_data_freshness.spec.js` passes, the file at `--repeat-each=5` shows no varying subset (only the two deterministic Planning `:1050`/`:1078` failures, which are unrelated), and no load-ownership token was added. Original note: EPM automatic refresh: in EPM view the ENG task loads are aborted and `useEngSprintData.js` leaves `productTasksLoading` and `techTasksLoading` set (it clears them only when `shouldApplyResult` allows), so the owner-busy check blocks the return refresh on every surface. Remedy: clear the flags when a load is superseded or aborted and no newer load owns them (an ownership token), or stop ENG flags gating the `epm` surface; add a test that opens in EPM, aborts the ENG load and asserts the return read starts. Five tests in `tests/ui/dashboard_data_freshness.spec.js` fail with a different subset each run until then.
- Toggle-to-paint p50/p95 at 500, 2,000 and 5,000 Stories against base: no harness exists.
- Manual glyph and hover inspection in headed Firefox and WebKit; a direct measurement that a stored-number change re-renders App.
- Cmd/Ctrl+Z after Enter works only once focus is back in the table (keyboard-only, parked in `docs/TODO.md` Deferred).
- Undo of Add assignee marks the person removed (no delete route); an inherited team number restored by Undo becomes a typed value.
