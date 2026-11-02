# Shared Planning inclusion and clear controls — implementation plan #331

> **Status:** Planned; not executed. D1/D2 are confirmed: DB-backed OAuth only application-wide, and no legacy browser-selection import. Task0 auth retirement is a prerequisite; runtime setup, an approved disposable PostgreSQL target, and versioned API/recovery review remain execution gates.
> **Execution:** Implement one task at a time, run its red/green checks, and review the result before its dependents. This document authorizes no implementation, commit, push, or pull request by itself.

**Goal:** Deliver [#331](https://github.com/Juce-me/jira-execution-planner/issues/331): one explicit shared Department/Sprint plan, safe Team/filter projection, understandable inclusion/save labels, and Table-only Planning without losing dependency context.

**Architecture:** First retire Basic/API-token and local-store OAuth runtime paths application-wide while preserving supported DB/OAuth behavior and existing files. Then extend the existing shared review transaction and controller with an inclusion document and operation receipts. Reuse its group/namespace lock, issue authorization, row kinds, dirty-scope guard, and presentation components. Keep Jira writes and Team/assignee-capacity stores independent.

**Tech stack:** Python 3.10+ with supported OpenSSL, Flask, SQLAlchemy/Alembic, SQLite for disposable journey tests and PostgreSQL for lock races; React 19, Node 20.x, esbuild, existing Playwright. No new runtime dependency.

**Branch base:** `feature/331-shared-planning` was reconstructed directly from fetched `origin/main` at `13d63d43d016d37bf76ec034cf7652c25ef6e2f5` on 2026-11-02. Its commit contains only this plan, its index entry and the two instruction learnings. No quarterly-configuration implementation or capacity/chart changes are included.

**Original review baseline:** source findings below were gathered at `fbca7d7ee8d675bb8a856071d0901efaea26c043`. That checkout contained quarterly review-namespace code not present in the clean branch base. Preserve that distinction: E4 gates the affected implementation steps until the prerequisite is integrated or the plan is explicitly adapted and reviewed against the then-current main.

**Outcome:** Specification reviewed and revised; this plan is a proposed implementation contract. No production code implemented.

**Current accuracy:** Navigation/interfaces were verified at the original review baseline, not asserted to exist on the clean main base. The quarterly namespace/helper dependencies identified by E4 are absent here. New symbols, files, schemas and wire shapes are proposed. The GitHub spec remains the product requirement; this file owns execution detail and prerequisite gates.

## 1. Global constraints and gates

- Preserve the unrelated capacity/chart work saved outside this clean branch; do not restore it as part of #331. The initial modified paths were `docs/design-system.md`, `docs/features/planning-sprint-review.md`, `docs/ontology.md`, `frontend/src/eng/PlanningAssigneeCapacityBar.jsx`, `frontend/src/eng/planningAssigneeCapacityModel.js`, `frontend/src/stats/StackedBar.jsx`, `frontend/src/styles/stats/project-track.css`, `tests/test_planning_assignee_capacity_model.js`, and `tests/ui/planning_assignee_capacity.spec.js`. Read and coordinate overlaps before future implementation; do not reset them.
- Use [root instructions](../../AGENTS.md), [plan instructions](AGENTS.md), [ownership contract](../../backend/security/CONFIGURATION_OWNERSHIP.md), [design system](../design-system.md), and applicable nested instruction chains.
- One plan scope: workspace + Department group + Sprint + review namespace. Team is a filter. No selection inheritance, automatic inclusion, Jira Sprint/status writeback, administrator-store relocation, or new live-update transport.
- Preserve existing review ownership: definitions/issue values across Sprints; layouts per Sprint; namespace isolation. Preserve capacity document inheritance separately.
- Reuse components/tokens/classes. Keep Filters and dirty Save/Discard in their existing positions; retain existing desktop sticky-stack limits, including the 175px assertion at 1440x900 and 1280x720.
- New Planning wire contracts below apply only to explicit v2 calls. Preserve older review-only wire payloads under DB/OAuth; “legacy review-only” does not mean retaining retired authentication profiles. Task0 changes the application auth/profile contract explicitly.
- Plan scope is app-owned. No review/capacity/Jira mutation widens to every included issue. Inclusion actions must issue no Jira mutation.
- Source comments, fixtures, docs and issue content use synthetic values and repository-relative paths. No credentials or identifiable Jira fixture data.

| Gate | Required decision/evidence | Effect |
| --- | --- | --- |
| D1 | Confirmed: require DB-backed OAuth application-wide; retire Basic/API-token and local-file OAuth, with no local-preview/read-only compatibility branch. | Closed product decision; implement prerequisite Task0 before shared-plan tasks. |
| D2 | Confirmed: preserve old browser data untouched and start shared plans explicitly; no unverifiable legacy import. | Closed product decision; enforce in Tasks4–5. |
| E0 | Current feature branch and dirty-work ownership inspected; Node 20.x, supported Python, local dependencies and build available. | No source implementation until the baseline, dirty-work ownership and runtime are validated. |
| E1 | Approve/review the additive v2 wire and auth-resume v2 compatibility contracts in Sections 4 and 5 before modifying them. | Existing migration-sensitive contracts must not change implicitly. |
| E2 | Explicit approved disposable PostgreSQL target, with isolated test schema. | Required concurrency evidence; SQLite or skipped tests do not satisfy release acceptance. |
| E3 | Table detail interaction and compact control geometry pass real browser inspection and existing sticky-height checks. | List retirement cannot ship before its inspection replacement works. |
| E4 | The original review's quarterly namespace dependency is absent from main: the review namespace migration, `backend/services/work_write_scope.py`, `backend/routes/work_structure_routes.py`, `backend/services/planning_work.py`, `frontend/src/eng/planningReviewKinds.js`, and associated work-structure tests. | Gate only tasks/acceptance that reference those interfaces. Integrate their approved upstream implementation first, or explicitly adapt and re-review those task contracts against current main. Do not silently recreate missing helpers or pull quarterly history into #331. Independent DB/OAuth-retirement work may proceed after its own gates. |

No open product choices remain. D1/D2 are confirmed; E0–E4 are execution/environment/review/prerequisite gates. Task0 is part of the agreed scope, not an optional compatibility variant. Do not substitute a legacy auth/storage fallback when a gate is unavailable.

Home write gate review: `GATE-05-home-write-capability.md` remains blocked and is not a dependency of this feature. The four required probe inputs were absent, no approved write target exists, and no Home mutation ran. Its recorded 2026-11-02 review date was not passed; unchanged results leave that unrelated file untouched.

Home read gate review: the OAuth setup support reference records the original eight-operation probe as FAIL; the accepted, implemented public-read-v1 query profile omits unsupported identity/Teamwork Graph fields. The older EPM migration reference contains superseded API-token descriptions and must not override current source or the accepted public-read design. No live probe or new Home migration ran for this documentation task. Task0 removes legacy Basic reachability while preserving the shipped DB OAuth profile; it must not claim the original gate passed, add unsupported projections/scopes, or clear Home write gates. Record supported live-user acceptance separately from format/source tests.

## 2. Review findings and disposition

Three independent read-only passes covered UX, persistence/concurrency, and testing/security. This table records the actionable results; repeated stories/tests were consolidated in the revised issue.

| Finding | Source evidence | Resolution |
| --- | --- | --- |
| Browser tests mock the persistence boundary | `tests/ui/planning_review_integration.spec.js:168`, review stubs around 321; `tests/ui/planning_selection_defaults.spec.js:145` | Task 1 creates a real Flask + migrated DB + two opaque sessions fixture; mock only external providers. |
| Legacy “exact scope” import is unverifiable | `frontend/src/planningSelectionState.mjs:54` keys only Sprint/group | D2; never infer workspace/principal/namespace from legacy data. |
| Full-plan reads could disclose unauthorized IDs/totals | `backend/services/sprint_review.py:472` metadata read and `494` authorized value read | Metadata only on GET; issue projections via authorized bounded reads, staged at one revision. |
| A shared save needs one transaction and durable outcome proof | `backend/services/sprint_review.py:527` fence, `540` save; no operation fields | Tasks 2–3 add entries, tombstones and receipts inside the existing session/lock order. |
| Response-size checks can happen after commit | `backend/routes/sprint_review_routes.py:22`; `backend/db/engine.py:197` | Pre-serialize bounded v2 acknowledgement before transaction exits; reconcile potentially committed failures. |
| Active automatic inclusion also exists | `frontend/src/dashboard.jsx:3036`; future resolver in `planningSelectionState.mjs:186` | Retire both paths in Task 4, not only future default-all. |
| Save completion clears all drafts | `frontend/src/eng/usePlanningSprintReview.js:203` | Freeze submitted snapshot; rebase later inclusion edits rather than clearing them. |
| Existing auth capsule cannot hold review drafts | `frontend/src/api/authResumeState.js:52` strict v1 fields; dashboard capture around 2605 | Task 5 adds bounded same-tab v2 recovery, retaining v1 shell compatibility without importing shared inclusion. |
| No Table dependency inspection path | `frontend/src/eng/PlanningReviewTable.jsx:130` props; List `IssueCard` dependency/subtask composition | Task 7 adds explicit anchored View details using existing components before removing List. |
| Current capability and closed-Sprint promises were imprecise | `sprint_review.py:53`; dashboard around 3030; share resolver 44 | D1; preserve closed-Sprint UI exclusion without inventing a new HTTP lifecycle policy. |
| Identical boolean inclusion edits should converge | Existing per-cell strict CAS at `sprint_review.py:590` differs from inclusion desired values | Revision-first inclusion rule below, with same-value no-op; keep stricter existing review predicates. |
| Proposed analytics fields were unsupported | `frontend/src/analytics/events.js`, review builder in `dashboardAnalytics.js:88` | Retain current inclusion/review identities, action enums and unknown result; add no row_kind/department_sprint parameter. |
| Hidden totals, saved-empty state and save scope were unclear | `planningReviewTableModel.js:115`, dashboard selected totals around 4878 | Equations/state matrix below; label Save as whole draft across Teams and explain cross-Sprint review ownership. |

Relevant lessons: [MRT033](../postmortem/MRT033-review-columns-hidden-after-migration.md) on migration/source-of-truth adoption; [MRT027](../postmortem/MRT027-board-catalog-pagination.md) on scope/discovery and performance; [MRT021](../postmortem/MRT021-project-track-segmented-control-override.md) on reusing shared controls.

## 3. Ownership, state and calculations

### 3.1 Stored entities

Proposed additions to `backend/db/models.py` and one additive migration:

| Model/table | Fields and constraints |
| --- | --- |
| `GroupSprintPlan` / `group_sprint_plans` | UUID id; schema_id FK to workspace_group_review_schemas, CASCADE; numeric sprint_id string; revision integer >=1; timestamps; unique(schema_id, sprint_id). The FK supplies workspace/group/NULL-Legacy-or-configuration namespace. Absence means uninitialized; a row with no true entries means saved empty. |
| `GroupSprintPlanEntry` / `group_sprint_plan_entries` | plan_id FK CASCADE; immutable numeric issue_id; included boolean; revision >=1; unique(plan_id, issue_id). Keep false rows as tombstones. Team is absent from the key. |
| `PlanningSaveOperation` / `planning_save_operations` | workspace_id + actor_user_id + operation_id unique; plan_id FK CASCADE; canonical request SHA-256; bounded JSON acknowledgement; immutable expires_at. Bind operation to canonical plan scope; do not store credentials or a full plan snapshot. |

New migration: `backend/db/migrations/versions/20261102_0023_shared_sprint_plans.py`, with proposed parent `20261030_0022` from the original review baseline. That namespace prerequisite is absent from this clean main base: resolve E4 first, then re-read the actual Alembic head before creating the migration. Do not silently substitute a parent that omits the required namespace contract. Upgrade makes no Jira/browser-data call and preserves every existing row. Downgrade checks for populated plans/entries/receipts and refuses before dropping data.

### 3.2 Inclusion transition rule

Desired values, never server-side toggle commands:

```python
def inclusion_decision(current_revision, current_included, base_revision, desired):
    if base_revision == current_revision:
        return 'apply' if desired != current_included else 'noop'
    if desired == current_included:
        return 'noop'
    return 'conflict'
```

Unstored entry has false/revision 0. A real change increments its entry revision; a no-op does not. A saved plan's document revision increments once per transaction that changes inclusion or explicitly initializes a plan, not once per issue. Review-only transactions leave plan revision unchanged. Global revision mismatch alone never rejects disjoint inclusion edits.

A stale opposing edit after include/remove (ABA) conflicts because its base revision is stale even if the present boolean returned to the old value. Two users setting true from false converge. Use incompatible review cell values or the ABA case for a real conflict acceptance test.

### 3.3 Visible projection

Use the complete existing Department candidate pool, `capacityTasks`, before the current `engFilterScopeTasks` Team/search/facet projection. Request authorization/projection for child immutable IDs through the existing read boundary; do not trust browser membership as write authority.

For the current Team scope:

```text
planned = authorized eligible entries with draft-effective included=true
shown   = planned intersect complete Team-and-ordinary-filter match set
hidden  = planned minus shown
strip count/SP = shown count/SP + hidden count/SP
table footer and parent Planned SP = shown real child count/SP
```

Keep all-planned SP distinct from the existing capacity-counted set that excludes configured excluded-capacity work. Preserve the existing formulas; give their difference a source-aware readout. Missing estimates/capacity and incomplete source data are not zero-valued success.

Rows filtered out, missing from a partial read, unauthorized, or no longer in the candidate pool are never implicitly removed from storage. Their unauthorized details/effort never appear in projections. For removals no longer in the current pool, require current issue authorization and an existing scoped inclusion record; for additions require current authoritative Department/Sprint eligibility.

### 3.4 State-machine acceptance

| State/event | Required observable behavior |
| --- | --- |
| Loading | Loading plan…; no successful-empty inference; bulk actions disabled until complete authorized work source is staged. |
| Loaded uninitialized | No saved plan yet; explicit inclusion creates a dirty draft; explicit Save can persist empty initialization. |
| Loaded saved empty | No stories in this plan; remains initialized; no inheritance or legacy adoption. |
| Loaded clean | Confirmed projection and capability; clean remote refresh may replace it. |
| Inclusion/review edit | Unsaved changes; capacity immediately reflects draft; include/remove operates only on matching real children. |
| Team/filter/row/detail change | Same draft, no guard, no pruning, no Jira refetch due solely to the filter. |
| Save pending | Freeze payload and operation ID; review editors retain their existing save lock; later inclusion edits allowed. Undo is temporarily disabled; Save cannot dispatch again. |
| Save confirmed | Advance submitted baseline; remove only acknowledged unchanged draft entries; retain later inclusion actions/dirty state. |
| Definite rejection | Preserve entire draft/history, show typed error; no partial confirmed state. |
| Unconfirmed | Preserve frozen request and later draft; block another operation; look up original outcome. Same unexpired ID/hash can be deliberately retried. |
| Dirty remote refresh | Preserve local desired values/base revisions; show remote-change/conflict information; never silently rebase or discard. |
| Undo | Inclusion only, one gesture per action, newest first; native input Cmd/Ctrl+Z remains native. Keep last 20 actions, matching existing capacity undo scale. |
| Discard | Reload latest confirmed projection/review, clear local inclusion history and app-owned review draft; no PATCH. Resolve an unconfirmed operation before claiming discard completed. |
| Scope change | Guard Save plan / Discard changes / Stay for Sprint/group/namespace; no automatic unsafe-scope discard. Ordinary dashboard-mode changes retain the mounted draft without a new prompt. |
| Any API 401 | Existing global mounted-app lock, sanitized same-tab sign-in; no local recovery screen or replay. Restore v2 draft after authorization, or report bounded recovery failure explicitly. |
| Closed Sprint | Existing UI/share-link fallback to Catch Up preserves the draft. New writes require an admitted Sprint/source, but add no new closed-Sprint HTTP prohibition; legacy review-only policy is unchanged. |
| Retired profile | Supported serving startup rejects Basic/local-store OAuth/live JSON profiles with a sanitized setup error. Bypassed launchers still cannot authenticate through them. No local preview, read-only compatibility or Plan saved fallback. |

## 4. API and transaction contract

### 4.1 Endpoint matrix

All server workspace/actor identity comes from the DB request context, never request body fields. New mutations resolve current groups/namespaces in that workspace; configured group visibility is not a server ACL. Receipt reads resolve persisted actor-bound scope even after group configuration/digest changes.

| Endpoint | Body/query and success | Guards/errors |
| --- | --- | --- |
| Existing GET `/api/eng/sprints/<sprint_id>/review` | Existing groupId/configuration query. Add `plan:{exists,revision}`, opaque `scopeProof` and explicit plan read/save capabilities; no issue IDs, inclusion totals or receipt list. | Existing read/capability behavior; no CSRF on GET. No GET creates plan rows. |
| Existing POST `.../review/values/read` | Existing groupId, issueIds, native rowKind; optional `includePlan:true, expectedPlanRevision, expectedScopeProof`. Return existing cells plus authorized `planEntries:[{issueId,included,revision}]`, planRevision, unavailableIssueIds for requested IDs only. Absent eligible entries return false/revision0. | DB/OAuth issue authorization intersected with authoritative candidate eligibility, never merely browser IDs; requested-with and real CSRF; max500 IDs. Mixed revision returns 409 plan_projection_changed; no partial staged publication. |
| Existing PATCH `.../review`, legacy body | Existing schema/view/cell request unchanged. No plan or receipt side effect. | Existing review authorization and CAS preserved. |
| Existing PATCH `.../review`, v2 body | Shape below. Bounded acknowledgement of submitted changes/revisions, not whole stored plan. | DB/OAuth non-admin user_write; requested-with and CSRF; server group/namespace/catalog/source/issue admission; 400 invalid, 403 unavailable issue/capability, 409 conflicts/configuration/ID reuse, 410 operation_expired, 413 request/response/draft limit, 429 operation limit, 503 storage/authorization unavailable. Typed errors must state whether no commit is proven; potentially committed failures use reconciliation. |
| New GET `.../review/operations/<operation_id>` | strict query allowlist `groupId` and optional `configurationId` (stored schema namespace ID, omitted for NULL Legacy), one value each; bind these, Sprint, workspace and actor to the persisted receipt. Return committed + resulting revisions, or unknown. Never values/issue IDs. Does not require a formerly current configuration digest merely to establish an existing outcome. | Same authenticated workspace/actor and canonical scope; requested-with as existing app reads use it; no CSRF on GET. Other actors' receipts are not discoverable. Missing is unknown, not proof of no commit. |

The combined payload extends existing review shapes:

```json
{
  "version": 2,
  "groupId": "group-synthetic",
  "operationId": "019a413c-0000-7000-8000-000000000001",
  "initializePlan": false,
  "basePlanRevision": 4,
  "baseScopeProof": "synthetic-scope-proof",
  "inclusionChanges": [
    {"issueId": "8101", "included": true, "baseRevision": 2}
  ],
  "baseSchemaRevision": 3,
  "baseViewRevision": 1,
  "schemaChanges": [],
  "cellChanges": []
}
```

The example IDs are synthetic; executable tests generate a current UUIDv7 rather than submitting this fixed timestamp. `configuration` is omitted for unpromoted Legacy; for a promoted context use the existing server-produced stamp unchanged, never a null substitute.

Response fields: existing bounded columns/cells/layout acknowledgements when changed, plus `operationId`, `plan:{exists,revision}`, and only confirmed submitted `inclusionChanges` with their revisions. A current plan not yet initialized returns exists=false/revision0 on metadata reads; saved empty returns exists=true/revision>=1.

Conflict shape adds `inclusionConflicts:[{issueId,included,revision}]` for the caller's authorized submitted identities to existing `schemaConflict`, `viewConflict`, `cellConflicts`. Keep existing review fields/strict CAS. A projection change is not an inclusion write conflict: discard only the incomplete read staging and retry a complete projection.

### 4.2 Bounds and receipt lifetime

- Keep existing request maximum 256 KiB and response maximum 1 MiB, maximum 100 changed review cells, maximum 500 distinct authorization IDs across inclusion + review combined, maximum 500 inclusion changes per atomic save.
- Keep existing authorization budget of 15 seconds and 10 Jira search pages for the union, and use one budget rather than resetting it for each category. Keep byte-aware Jira batching and endpoint-specific pagination.
- Limit stored entries to 10,000 per plan, including false tombstones. A limit failure rejects the whole save; do not delete tombstones or silently truncate. Limits have explicit inline copy recommending smaller draft operations/current scope, not a partial success.
- One v2 save has a30-second monotonic server deadline including admission, authorization, waits, SQL and acknowledgement preparation. Authorization consumes at most15 seconds. Derive each DB lock/statement timeout from remaining time, capped at5s/10s; recheck before every SQL execution and phase. SQLite busy/progress handling observes the same deadline. Keep network authorization outside held write locks. V2 PATCH uses a35-second client timeout; legacy review requests retain20 seconds. Precommit deadline expiry rolls back; lost postcommit delivery reconciles.
- Operation IDs use UUIDv7 timestamp + cryptographically random bits, generated with browser Web Crypto and parsed without a new dependency. Immutable expiry is ID timestamp +24h. Reject malformed version/variant, timestamps >5 minutes ahead, and expired missing operations before starting a new transaction.
- Retain receipts at least until their immutable expiry. Bound to 256 unexpired receipts per actor and plan; reject a new operation with 429 before mutation when full, while existing-ID replay/status remains available. Delete only expired receipts during a subsequent scoped write; no new scheduler.
- Resolve retained receipts before mutable admission checks, then recheck under the common fence. Immediately before first execution of a missing operation recheck immutable expiry and remaining deadline; crossing expiry while waiting must reject it. Expiry cannot let a missing old operation become new. Receipt lookup returns metadata only and is permitted after expiry while a receipt remains, without enabling re-execution.
- A retained matching receipt may confirm an expired original operation; a receipt-less expired lookup is unknown/expired and directs the user to review current state. Do not reapply it under a fresh ID automatically.

### 4.3 Transaction sequence

1. Start the v2 handler's monotonic deadline, then resolve authenticated DB actor/workspace and syntactic frozen request/scope/hash. Before mutable configuration resolution, find an existing actor-bound receipt and verify its persisted canonical scope/hash. Report its committed outcome despite later issue movement/configuration changes; reauthorize any value-bearing acknowledgement or return committed metadata plus `reloadRequired:true`. Different scope/hash under the same ID conflicts; other actors' receipts are not discoverable.
2. For a missing receipt, resolve current group/configuration and source-admitted Sprint in every namespace. Capture configuration digest, WorkspaceGroupConfig.config_revision, source/catalog proof and scope digest within the already-running deadline. Add no new closed-Sprint HTTP denial.
3. Compile authoritative addition/projection eligibility using the helper below. Validate the union of additions and review IDs through current-user Jira visibility and correct native child/review kinds under one budget. Removals need current Jira visibility plus an existing exact-plan record, without requiring current Department/Sprint membership or old child-kind classification after a move/type change. No Basic fallback.
4. Enter one session_scope and lock in this order: `acquire_workspace_config_fence(session, workspace_id, budget=remaining_seconds)` -> current WorkspaceGroupConfig row FOR UPDATE -> existing NULL-Legacy schema fence -> selected namespace schema -> exact plan/entries. Refresh-read configuration/group/catalog proof after locking; abort if it differs from the authorization snapshot. Catalog publication shares the advisory fence; group UPDATE blocks on its row lock. Legacy review-only callers keep their original path.
5. Recheck receipt/hash under the fence to serialize duplicate first attempts, then recheck immutable expiry and remaining deadline before first execution. Matching receipts remain readable after expiry. No independently committing service or inclusion inheritance.
6. Compare existing schema/view/cell CAS unchanged and Section3.2 inclusion revisions, normalize review changes, enforce caps, and stage plan/entry/review/receipt mutations. Explicit initializePlan may create a missing plan but never resets an existing one. A first v2 save, including review-only or intentionally empty, sends initializePlan=true; a missing plan with false is a typed validation rejection.
7. Build and JSON-serialize the bounded acknowledgement using the same encoder as the route before transaction exit. Size/serialization failure rolls everything back. Commit once and return the prepared acknowledgement; receipt reconciliation handles failed delivery.

Create `backend/services/planning_scope.py` with `compile_planning_inclusion_scope(config_snapshot, group_snapshot, admitted_sprint, work_context) -> {candidate_jql, child_kind, scope_digest}`. Extract verified discovery semantics from `jira_server.fetch_tasks` around3560–3687; resolve the work context with `planning_work.resolve_work_request` before invoking the pure compiler, which consumes resolved roles/JQL helpers only. Never call the HTTP handler or read request.args inside the compiler. Capture Teams/labels/other Department inputs from the shared group row and configuration from the authoritative snapshot. Build bounded `id in (...) AND (candidate_jql)` searches. Reuse `work_structure_routes.admit_sprint_source` for source proof through a narrow adapter. Projection reads use the same eligibility compiler, planRevision and scopeProof. Read the plan revision and returned entries in one SQL snapshot (one joined statement, or an appropriate plan read lock) so READ COMMITTED cannot label new entries with an old planRevision. An absent plan returns a self-consistent false/revision0 projection without creating rows; concurrent first creation is detected by subsequent chunk revision checks. Jira membership/visibility is a completed-read snapshot, not a distributed transaction; these DB fences protect configuration/catalog/group consistency, not external Jira changes.

## 5. Frontend interfaces and recovery

Do not maintain the new shared plan and the old browser selection map as independent authorities.

Proposed interfaces:

```ts
type InclusionEntry = {issueId: string, included: boolean, revision: number};
type InclusionChange = {issueId: string, included: boolean, baseRevision: number};
type PlanScope = {workspaceId: string, groupId: string, sprintId: string, namespaceId: string | null};

type InclusionDraft = {
  effectiveEntries: Map<string, InclusionEntry>;
  dirtyChanges: Map<string, InclusionChange>;
  actionSequence: number;
  apply(ids: string[], included: boolean): void;
  undo(): boolean;
  snapshot(): {sequence: number, changes: InclusionChange[]};
  confirm(snapshot: {sequence: number, changes: InclusionChange[]}, entries: InclusionEntry[]): void;
  discard(entries: InclusionEntry[]): void;
};
```

Create `createPlanningInclusionDraft({entries = [], historyLimit = 20} = {}) -> InclusionDraft` in `frontend/src/eng/planningInclusionDraft.js`; compose it into `createPlanningSprintReviewController` instead of a second save coordinator. Expose `includeShown`, `removeShown`, `undoInclusion`, `getPlanSnapshot`, and derived selection maps through `usePlanningSprintReview`. Keep existing review methods as adapters to the same combined guard/save/discard lifecycle.

For pending save rebasing, capture desired values and local action sequence. On confirmation, set the submitted values/revisions as baseline; keep any current desired value changed after capture with the new entry base revision. Drop history at/before the submitted cursor; keep later gestures. On rejection preserve the entire original baseline/history. Review editors keep their existing save lock so this task does not invent review-keystroke Undo.

Inventory and retire/delegate every old selection writer: `createPlanningSelectionHandlers`, `usePlanningSelectionSync`, active/future automatic inclusion, browser persistence, group snapshots, private view capture/apply, share-link hydration, and auth-resume restoration. Under the sole supported DB/OAuth profile all read or mutate the controller; none writes legacy browser selection as authoritative. Leave legacy browser records untouched and unused; offer no import or compatibility preview.

Auth recovery v2 extends `frontend/src/api/authResumeState.js` and dashboard snapshot integration. Preserve the existing verified principal identity (workspace plus owner-private view identity), add explicit canonical namespace/scope, current app-owned draft deltas and revisions, and the frozen pending operation if present. Keep 30-minute TTL and same-tab sessionStorage; cap the entire v2 envelope at 640 KiB (up to two bounded 256 KiB draft/submission payloads plus shell metadata). No tokens, credentials, full Jira responses, or undo history.

Read v1 for compatible shell/navigation restoration only; never promote its unstamped selection into a shared plan. Strictly validate v2 fields, counts, bytes, expiry, principal and scope. After sign-in, load current authorized plan/review and restore as unsaved or conflicted; query an original pending operation before allowing another save. Storage/size failure is surfaced before departing the mounted recovery screen; preserve mounted state and do not silently claim cross-document recovery succeeded. The user may still need to copy/review work or explicitly accept leaving if the browser cannot retain it.

## 6. Implementation tasks

Each task includes focused red/green evidence and a reviewable deliverable. Do not stage unrelated files or commit unless separately authorized.

### Task 0 — Retire obsolete auth/storage profiles application-wide

**Dependency:** required before Tasks1–8 assume DB-backed OAuth. This is an explicitly approved prerequisite, not a new sign-in mode or a request to delete existing credentials/data.

**Create:** `backend/auth/runtime_profile.py`, `tests/db_oauth_test_helpers.py`, `tests/fixtures/db_oauth_server.py`, `tests/ui/db_oauth_fixture.js`, `tests/ui/db_oauth_lifecycle.spec.js`, `tests/test_runtime_profile.py`.

**Modify runtime:** `jira_server.py`, `backend/auth/jira_auth.py`, `backend/security/guards.py`, `backend/security/policy.py`, `backend/routes/auth_routes.py`, `backend/config/repository.py`, `backend/auth/cache_policy.py`, `backend/auth/project_access.py`, `backend/routes/eng_board_routes.py`, `backend/epm/home.py`, `backend/routes/admin_routes.py`, and active callers of retired service-credential recovery. Remove `backend/auth/local_oauth_store.py` and `backend/services/eng_board_basic.py` only after all runtime imports/compatibility wrappers and positive test dependencies are retired.

**Modify launch/setup:** `scripts/check_startup_preflight.py`, `scripts/docker-entrypoint.sh`, `scripts/install.sh`, `runners/local/run.sh`, `Makefile`, `.env.example`, `.github/workflows/verify-frontend-build.yml`, `.github/workflows/release-latest.yml`, active container packaging config if it independently names the WSGI target. Keep ignored token-file/packaging protections.

**Modify tests/docs:** `tests/auth_mode_test_utils.py`, `tests/oauth_test_helpers.py`, ordinary callers using their obsolete positive profiles, `tests/test_startup_preflight.py`, `tests/test_app_startup.py`, `tests/test_container_packaging.py`, `tests/test_auth_routes.py`, `tests/test_config_storage_selector.py`, `tests/test_config_jsonfile_fallback.py`, endpoint/security and DB cutover/refresh/cache/Board/Home tests. Convert relevant visual-browser fixture profiles, including Planning, capacity, settings-access, status-color, Board and measurement-runner scenarios. Update `README.md`, `INSTALL.md`, `docs/SUPPORT-atlassian-oauth-setup.md`, ownership/profile instructions and touched ontology entries. Read relevant nested instructions and preserve existing dirty docs.

**Interfaces:** `validate_supported_runtime_profile(auth_mode, storage_backend, retired_options) -> None` is pure and raises a sanitized typed unsupported-profile error. Runtime defaults are Atlassian OAuth + DB; it rejects Basic, live JSON configuration, and active/explicit retired local-token/Basic CLI options. Missing required serving configuration fails clearly rather than selecting another profile. `jira_server.create_serving_app()` validates serving configuration then returns the application; supported Gunicorn/WSGI targets call this factory. Importing models, Alembic, helpers or jira_server for tests/tooling remains free of token-file reads, remote calls and mandatory OAuth credential I/O. Request/token guards independently enforce DB-only identity even if a raw app import bypasses the factory. Preserve the intended public login/callback/status/health behavior; DB-only session checks apply to protected policies rather than blocking authentication bootstrap itself.

**Reusable fixture interfaces:** `seed_db_actor(session, *, workspace, account_identity, roles)` persists encrypted synthetic tokens and creates a real opaque DB session using existing DB helpers. `startDbOAuthServer({python, databaseUrl})` exposes real signed-cookie contexts, provider-boundary login, per-session expiry and owned teardown; launcher-only IPC controls provider responses. Task1 extends it with Planning data and real-save pause/lost-ack controls instead of building a second auth fixture or intercepting application APIs.

- [ ] **0.1 Migrate the test foundation first.** Create the isolated migrated DB/auth fixture from `store_oauth_callback_tokens` and `create_browser_session`; seed required workspace/source config, group/private-view/project-access/catalog records. Classify every Basic/local-store reference: convert ordinary feature fixtures, retire positive compatibility promises, retain explicit rejection/source guards. Do not blanket-skip tests or replace real session/CSRF resolution with a mocked RequestAuthContext in the primary journey. Narrow pure-unit tests remain import-safe.
- [ ] **0.2 Make serving and request resolution DB-only.** Share the profile validator across CLI/preflight/serving factory and update Gunicorn's existing `jira_server:app` target. Remove Basic defaults/CLI credential acceptance, synthetic local-basic admin context, local OAuth store constructors/wrappers, fallback branches in `current_request_auth_context`, `current_jira_session_data`, `current_oauth_session_callbacks`, CSRF/auth-refresh/callback/login/logout paths and `_require_real_oauth_session`. Retain the supported validated upgrade of an older DB-backed cookie; that is distinct from local-file OAuth. No missing/invalid/revoked DB session may consult a legacy file or produce a local principal.
- [ ] **0.3 Retire reachable Basic clients and live JSON persistence.** Remove Basic Jira header/URL construction, Basic Board dispatch/cache/project-access shortcuts, Basic Home clients/factories and runtime service-credential connect/recovery prompts. The Basic-only Scenario overrides write is retired, not converted into a new OAuth write. Preserve DB OAuth bearer/context propagation, encrypted token refresh locking/version/revocation, non-admin/tool-admin ownership, strict Home public-read-v1 scopes/private enablement and all external write gates. Keep explicit JSON artifact import/export tooling; it is not a runtime profile. Existing service-integration rows and historical migrations stay untouched and unused; no deletion migration.
- [ ] **0.4 Close launcher/fixture/CI gaps.** Change Makefile/backend-security targets and both build/release workflows from Basic+JSON to isolated DB/OAuth. Update Docker entrypoint, installer and local runner; DB setup/migrations/encryption are mandatory for serving. Remove obsolete local-token/Basic setup from active examples/runbooks and require sanitized DB/OAuth setup guidance on rejection. Never rewrite the operator's existing environment, credential/config files, browser keys, or encrypted historical rows. If a controlled external capability probe needs an old Basic adapter, isolate it from application runtime under its existing explicit approved-target gate; do not leave an app fallback.
- [ ] **0.5 Prove the real DB lifecycle before Planning.** The real browser/API/database journey covers unauthenticated redirect/sanitized API401; provider-mediated callback, encrypted DB tokens and opaque session; two non-admin users/private preferences/session-bound CSRF; authorized write/reload/second-user read; refresh, restart, logout, disabled/revoked users and DB failure; expiry, same-tab sign-in navigation and a new document mount without automatic write replay. Basic headers, old local cookies and a poisoned legacy token file grant no access and cause no file read/write. Check unpromoted/promoted quarterly configuration and strict EPM/Home OAuth. Provider stubs do not prove Microsoft Entra/Atlassian SSO; retain that named operator journey.
- [ ] **0.6 Validate boundaries and scope.** Run focused runtime-profile/startup/preflight/auth/DB/security/config/Board/Home tests and `tests/ui/db_oauth_lifecycle.spec.js`, then the existing full frontend/backend and local Chromium gates after build. Keep deterministic PostgreSQL refresh/locking evidence where already required. Add CLI, preflight, validated WSGI factory and bypassed-launcher request negatives; preserve import-safe tests. Record that old files/DB rows/browser keys are unchanged. Update owner-budget/digest inventories only for actual retired or changed owners.

**Deliverable:** the supported application and its positive fixture/deployment profiles use DB-backed OAuth exclusively; obsolete paths fail closed with no data deletion or fallback. Shared Planning implementation cannot proceed on an auth cutover that only changes startup messages.

### Task 1 — Real persistence journey fixture

**Create:** `tests/ui/planning_shared_plan_fixture.js`, `tests/fixtures/planning_shared_plan_server.py`, `tests/ui/planning_shared_plan.spec.js`.

**Read/reuse:** Task0's reusable DB fixture/launcher, `tests/test_db_oauth_cutover.py`, `backend/auth/db_tokens.py`, `backend/auth/db_browser_sessions.py`, `tests/ui/epm_view_fixture.js`, `playwright.config.js`.

**Interfaces:** `startPlanningSharedPlanServer({python, databaseUrl})` returns `{baseUrl, createContexts, expireSession, pauseSave, releaseSave, dropNextAckAfterCommit, allowProviderReauth, readOperation, stop}`. `createContexts(browser)` installs real opaque-session cookies in two separate contexts and returns their pages/contexts. Test-launcher-only IPC expires one DB BrowserSession, pauses/releases a real save, suppresses its acknowledgement only after a persisted receipt exists, permits same-principal provider reauthentication, and reads receipt metadata. No production control route is added. Python launcher extends Task0's real DB/OAuth launcher with Planning seed/save controls and starts the real app on an owned ephemeral loopback port; creates only an isolated migrated DB/test schema, seeds synthetic workspace dashboard source configuration, group/Teams, private views, project-access rows, validated catalog data, active/future Sprints and non-admin actors. Seed real encrypted OAuth connections and opaque browser sessions via `store_oauth_callback_tokens` and `create_browser_session`. Stub only provider/Jira network methods. Obtain CSRF from the real HTTP endpoint per session; never use local `install_oauth_session` token-store mode.

- [ ] Add boot/smoke test proving distinct users, non-admin shared review capability, real API responses, real persisted readback and cross-session CSRF rejection. No `page.route('**/api/**')` in primary acceptance.
- [ ] Add failing feature journey: A/B included, remove A, B stays; Save/reload/second session; different Sprint independent; no Jira mutation captured by the provider stub.
- [ ] Run `npx playwright test tests/ui/planning_shared_plan.spec.js --browser=chromium --workers=1`. At this point smoke must pass; missing v2 feature checks must fail for the expected absent contract, not auth/bootstrap/environment errors.
- [ ] Ensure teardown kills only the fixture server and removes only its owned DB/schema, including startup failure. Never use the live port 5050 server or application database.

**Deliverable:** a trustworthy test seam; current broad mocked browser suites remain useful for visual/controller cases.

### Task 2 — Inclusion storage, revisions and receipts

**Create:** `backend/services/planning_inclusion.py`, `backend/db/migrations/versions/20261102_0023_shared_sprint_plans.py`, `tests/test_planning_inclusion.py`.

**Modify:** `backend/db/models.py`, migration/schema guard tests that enumerate model tables.

**Interfaces:** `apply_inclusion_changes(session, plan, changes)` returns confirmed changed/no-op entries; `load_inclusion_projection(session, schema_id, sprint_id, allowed_ids, expected_revision)` returns only the requested authorized entries; `operation_identity(value, now)` validates UUIDv7/expiry; `find_operation(session, workspace_id, actor_id, operation_id)` binds scope/hash.

- [ ] Add service tests for no-row vs saved-empty, namespace FK isolation, false tombstones, same-value convergence, stale opposing ABA conflict, disjoint changes, explicit initialization race, malformed/reused/expired operation identity and receipt cap.
- [ ] Implement Section 3 models and exact inclusion transition rule; queries take the caller-provided existing session. These helpers do not open transactions or authorize Jira independently.
- [ ] Implement canonical hash over normalized scoped v2 content, omitting only transport headers; reject same ID with a different canonical scope/hash. Receipt expires at the operation's immutable timestamp plus24h.
- [ ] Add upgrade preservation and refused destructive downgrade tests; verify one Alembic head and startup schema validation includes the new tables.
- [ ] Run `.venv/bin/python -m unittest tests.test_planning_inclusion` and the migration tests with isolated DBs. Expected: all cases pass after an initial relevant red.

**Deliverable:** independently tested persistence primitives with no new live route.

### Task 3 — Atomic review/inclusion HTTP contract

**Create:** `backend/services/planning_scope.py`, `tests/test_planning_scope.py`.

**Modify:** `backend/services/sprint_review.py`, `backend/routes/sprint_review_routes.py`, `backend/security/policy.py`, and `jira_server.py` only for the narrow discovery extraction/parity seam; `backend/services/work_write_scope.py` and `backend/routes/work_structure_routes.py` only for existing work/source admission adapters. Read/reuse `backend/services/workspace_dashboard_config.py`, `backend/services/shared_group_config.py` and `backend/services/workspace_catalog_cache.py` for synchronization.

**Tests:** `tests/test_sprint_review.py`, `tests/test_sprint_review_routes.py`, `tests/test_sprint_review_postgresql.py`, `tests/test_work_structure_reviews.py`, `tests/test_endpoint_policy_inventory.py`, `tests/test_endpoint_security_matrix.py`, `tests/endpoint_security_samples.py`, new `tests/test_planning_inclusion_routes.py`.

**Interfaces:** existing `load_review`, `read_values`, `save_review` retain legacy behavior; accept v2 optional fields and add the Section 4 metadata/projection/operation lookup responses. Add `load_save_operation(context, sprint_id, group_id, operation_id, namespace)`.

- [ ] Add failing HTTP tests for every endpoint matrix row, wrong workspace/group/configuration, non-admin access, requested-with/CSRF failures, unauthorized IDs, invalid addition to Department/Sprint, moved/type-changed-but-authorized removal, and unchanged legacy review-only and closed-Sprint HTTP policy.
- [ ] Extend authorization to the union of review and inclusion IDs under one count/time/page budget. Implement the new pure compiler named in Section4.3 from verified discovery semantics; do not assume an authoritative compiler already exists or approximate group ownership with Team IDs/client arrays. Test Component/label-backed and configured hierarchy scope cases.
- [ ] Implement Section 4.3 in the existing `save_review` session after `_locked_schema`; do not invoke a separately committing review service. Keep existing review CAS and cap behavior.
- [ ] Pre-serialize v2 acknowledgement before commit. Inject serialization/size failures after staged mutations and assert DB rollback across entries, review cells/layout/schema and receipt.
- [ ] Register the operations GET as dynamic authenticated_read in the policy registry and security samples. Test anonymous denial, same-actor success, cross-actor indistinguishable unknown, wrong workspace/scope, strict query keys and no GET CSRF requirement.
- [ ] Implement candidate-authorized projections with one revision/scopeProof, receipt lookup and exact replay before mutable admission. Test committed outcome after issue move/type change, closed Sprint, changed configuration digest and revoked issue visibility; do not leak values.
- [ ] Add controlled-clock expiry-crossing-while-waiting and aggregate deadline tests; enforce per-execution SQL remaining time. V2 API timeout35s exceeds30s server deadline.
- [ ] Extend deterministic PostgreSQL `overlap`/`wait_until_blocked` cases for first-create, disjoint entries, ABA, duplicate operation, namespace writers and atomic rollback. Also change config/group/catalog proof after Jira authorization and before locks; the save must reject without changing any store. No timing sleeps as race proof.
- [ ] Run `.venv/bin/python -m unittest tests.test_planning_inclusion_routes tests.test_sprint_review tests.test_sprint_review_routes tests.test_work_structure_reviews`; then `REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1 .venv/bin/python -m unittest tests.test_sprint_review_postgresql` against the explicitly approved disposable target. A skip does not satisfy E2.

**Deliverable:** v2 shared persistence with backward-compatible existing review callers.

### Task 4 — Single inclusion draft owner and combined save

**Create:** `frontend/src/eng/planningInclusionDraft.js`, `tests/test_planning_inclusion_draft.js`.

**Modify:** `frontend/src/eng/usePlanningSprintReview.js`, `frontend/src/api/sprintReviewApi.js`, `frontend/src/eng/planningSelectionActions.js`, `frontend/src/eng/usePlanningSelectionSync.js`, `frontend/src/planningSelectionState.mjs`, `frontend/src/dashboard.jsx`.

**Tests:** `tests/test_planning_selection_state.js`, `tests/test_planning_sprint_review.js`, `tests/test_sprint_review_api.js`, the primary journey.

- [ ] Implement the Section 5 inclusion interface and compose it into the existing controller. Add observable tests for additive/subtractive scope, full off-screen match set, mixed parent states and placeholders, 20-step inclusion Undo, confirmed baseline and pending-snapshot rebasing.
- [ ] Extend API wrapper for v2 payloads/projection staging/status lookup and v2-only35s timeout (legacy20s unchanged). Freeze payload/UUIDv7 until outcome known. Treat malformed 2xx bodies and potentially post-commit 5xx as unconfirmed, not proven rejection.
- [ ] Inventory all old selectedTasks setters/storage writers listed in Section 5. Replace DB shared-mode writes with controller commands and derive the compatibility key map for render/analytics/export consumers. Keep issue keys a render adapter; immutable IDs remain authority.
- [ ] Remove both active Accepted/In Progress auto-inclusion and future default_all behavior. Do not prune inclusion based on filtered `selectionTasks`; project Team/filter rows from the complete authorized candidate pool.
- [ ] Stage all inclusion read chunks at one planRevision. On mixed revision retry a complete read at most twice, then show a stale/retryable state rather than partial totals. Do not drop dirty entries.
- [ ] Combined Save submits inclusion plus review draft once. Preserve later inclusion edits; retain existing review editor pending locks; prevent a second new operation before reconciliation. Combine Save/Discard/scope guards around one controller.
- [ ] Run `node --test tests/test_planning_inclusion_draft.js tests/test_planning_selection_state.js tests/test_planning_sprint_review.js tests/test_sprint_review_api.js` with Node20 after build dependencies exist, plus primary Playwright journey.
- [ ] Verify actual application API requests, persisted rows and the second session; helper-only passes are insufficient.

**Deliverable:** shared explicit inclusion without a parallel browser-authoritative map.

### Task 5 — Capability policy, safe migration and recovery

**Modify:** `frontend/src/api/authResumeState.js`, `frontend/src/api/authRecoveryCoordinator.js`, dashboard snapshot/restore adapters, `frontend/src/eng/usePlanningGroupScope.js`, existing connection/group snapshot adapters that capture Planning.

**Tests:** `tests/test_auth_resume_state.js`, `tests/test_auth_recovery_coordinator.js`, `tests/ui/planning_selection_defaults.spec.js`, primary shared-plan journey.

- [ ] Verify Task0 completed the confirmed DB/OAuth-only cutover before integrating shared Planning; D1/D2 are settled and need no further product interview.
- [ ] DB/OAuth canSavePlan still requires successful capability/read validation. Missing/expired DB sessions use global sign-in recovery; shared storage/capability failure never enables local Save or a compatibility profile.
- [ ] Preserve legacy browser records byte-for-byte, do not offer an import, and never seed shared inclusion from them. Add same-browser coincident Sprint/group across workspaces/configurations tests; fresh shared plans require explicit inclusion/save under DB/OAuth.
- [ ] Implement strict auth-resume v2 with Section 5 byte/count/TTL/principal/scope limits and v1 shell-only compatibility. Test oversized/unavailable sessionStorage feedback and no silent truncation.
- [ ] Restore only after fresh authorized reads; preserve pending operation identity and reconcile it before enabling Save. Never auto-replay a plan or Jira write.
- [ ] Guard every scope leave, including configuration switch, group snapshots, closed-Sprint fallback and supported share apply, rather than retaining the current automatic-discard path.
- [ ] Run auth/controller tests and real-session browser expiry: expire session A in DB, provoke real 401, confirm mounted lock, sign in through fixture provider boundary, restore authorized unsaved/conflicted draft, and observe zero automatic PATCH/Jira writes. Prove same-tab sign-in navigation and a second dashboard Document/App mount using existing observeDocuments prior art; assert inclusion AND review reconstruction, a frozen unconfirmed operation plus a later inclusion edit, reconciliation before Save, and principal/namespace/TTL/oversize/storage-failure negatives. Swapping cookies in a mounted app is not acceptance.

**Deliverable:** explicit compatibility/capability state and bounded draft recovery.

### Task 6 — Labels, compact controls and totals

**Modify:** `frontend/src/eng/PlanningActionBar.jsx`, `PlanningOverviewPanel.jsx`, `PlanningCapacityBar.jsx`, `planningReviewTableModel.js`, `PlanningReviewTable.jsx`, `PlanningTableStickyStack.jsx`, `frontend/src/styles/planning.css`, `frontend/src/styles/eng/planning-review-table.css`, affected onboarding module/copy adapters located from their existing planning targets.

**Tests:** `tests/ui/planning_review_integration.spec.js`, `tests/ui/planning_review_table.spec.js`, `tests/test_planning_review_table_model.js`, primary journey.

- [ ] Use the issue's R5 table as the sole UI copy contract. Change only the display label of built-in `accepted` to Planned SP; preserve identity, stored order, visibility, custom columns and actual Jira Accepted status.
- [ ] Keep Include N shown, Remove N shown and Undo outside compact-hidden details. Place status presets in the existing compact menu pattern with explicit Include/Remove actions and full matched status names.
- [ ] Keep Save plan/Discard changes in the existing Filters view-controls slot. Explain all pending Teams and cross-Sprint definitions/values when relevant; do not imply Save affects only the visible Team.
- [ ] Compute Section 3.3 visible/hidden/team totals from one draft. Show distinct loading/missing/saved-empty/read-error/capability states and preserve capacity provenance/exclusion explanation.
- [ ] Fit the existing desktop compact row; secondary status/export/detail commands use existing menus when necessary. Maintain measured offsets and the175px docked-header bottom limit at both desktop sizes for clean, dirty, saving and recoverable-error states, one/multiple Teams and hidden-work feedback. Primary actions/feedback remain reachable; secondary commands use existing menus. Responsive wrapping updates offsets.
- [ ] Capture settled before/after screenshots for one/multiple Teams, expanded/compact, 1440x900, 1280x720 and narrow/zoom states. Assert menu layering, readable focus/hover/disabled/mixed states and reachable controls.
- [ ] Run focused model and Playwright geometry tests; recheck Catch Up, Planning and Scenario sticky behavior. Do not hand-edit frontend/dist.

**Deliverable:** clear, continuously visible planning controls with reconciled totals.

### Task 7 — In-app Table details, then List retirement

**Create:** `frontend/src/eng/PlanningRowDetails.jsx`; add a focused browser scenario to existing review integration or primary suite.

**Modify:** `frontend/src/eng/PlanningReviewTable.jsx`, dashboard dependency/subtask composition, `frontend/src/eng/EngView.jsx`, presentation preference normalization, `frontend/src/shareView/resolver.js`, related share/pref tests.

**Reuse:** `frontend/src/issues/IssueCard.jsx`, `IssueDependencies.jsx`, `useIssueFieldPopover.js`, `dependencyFocusUtils.js`, existing subtask readers and registered icon/popover controls.

- [ ] Add View details in each real row's bounded Summary cell; reuse the existing anchored nonmodal issue-popover behavior with explicit close/Escape and focus return. Synthetic placeholders do not acquire fake issue details.
- [ ] Compose lineage plus a read-only IssueCard with `showPlanning=false`, `allowSelection=false`, no field/status/priority mutation callbacks, and existing dependency/subtask readers. Parent metadata is flat: use a display-only fields adapter or existing parent summary composition, never pass a flat parent directly to IssueCard. Test Legacy parent/child and configured Initiative/Epic roles.
- [ ] Own dependency focus locally in the panel. Delegate native clicks from `button[data-dep-chip]`/`data-task-key`; Enter/Space use the same click path. Existing chip handlers provide hover only and rely on the List ancestor. Build the complete deduplicated related-issue list for the selected category, including currently visible Table targets, not just existing hidden/missing/offscreen lists. Do not set global dependency focus/filter state.
- [ ] Reuse requestIssuesLookup in batches of at most20 missing related keys, one in-flight batch per explicit category/load-more action. No prefetch across rows or per-key calls. Keep existing subtask limits and one explicitly expanded issue at a time; show total count, unavailable/incomplete states, Retry and explicit next batch.
- [ ] Keep dependency focus/navigation inside the inspection flow unless the user explicitly chooses a row/Jira link. Do not auto-clear Team/ordinary filters or discard draft/scroll position. Restore trigger focus on close.
- [ ] Verify required hierarchy/dependency/subtask questions through the actual Table. Validate control geometry and portal layering above the sticky stack before E3 clears.
- [ ] Only then retire Planning List toggle/duplicate Planning render branch; normalize old layout choices and links to Table, retain configured row-kind switch, Catch Up list, share focus and reading anchors.
- [ ] Run existing share codec/resolver/rows-seed tests plus browser cases for old List preference/link, orphan Stories, readiness-only parents, long names and dependency failure. Coordinate scope with #330 without closing that issue before acceptance.

**Deliverable:** a single supported Planning presentation with a concrete detail path.

### Task 8 — Analytics, docs and acceptance

**Modify:** `frontend/src/analytics/dashboardAnalytics.js`, analytics/source tests, `docs/README_ANALYTICS.md`, `backend/security/CONFIGURATION_OWNERSHIP.md`, `docs/features/planning-sprint-review.md`, relevant touched `docs/ontology.md` entries; `docs/design-system.md` for the new row-detail call-site/registered control kind as needed.

**Preserve:** inclusion `planning_action`/feature_name=planning; review/combined-save feature_name=planning_review; established allowlisted workflow names and result `unknown`. No new scope_type or row_kind parameter; no GTM trigger change. Capacity analytics stays independent.

- [ ] Add exact payload assertions: one combined-save submit/result sequence, inclusion per gesture, existing review values, no raw IDs/free text, transport gate respected, no hydration events. Update taxonomy and only necessary GA4 runbook entries.
- [ ] Update ownership row with canonical inclusion/receipt scope and capabilities, changed feature copy/behavior, registered detail control and no-Jira-write pin. Preserve other users' dirty docs; do not change ontology Coverage line3, date touched sections only.
- [ ] Run final commands in Section 7 and record actual results, including PostgreSQL and browser evidence. Reconcile the R1–R7 coverage matrix below.
- [ ] Review complete diff and remove unrelated lines. Keep this plan EXEC/Planned until code is implemented and verified. On authorized publication, follow the root exact-head transaction, explicit push confirmation, and DONE rename/link rules; do not publish an unfinished plan as complete.

**Deliverable:** verified implementation and aligned contracts, only during a separately authorized execution turn.

## 7. Verification and publication handoff

The planning turn does not install missing runtimes, start a second live application, run external mutations, or claim implementation tests passed. Current checkout lacks its .venv and local esbuild/Playwright executables; pinned Node20 is available separately. Resolve E0 using the repository's existing bootstrap/pinned tools, not unmanaged host Python.

Focused execution commands, after dependencies/build and approved environment:

```sh
npm run build
node --test tests/test_planning_inclusion_draft.js tests/test_planning_selection_state.js tests/test_planning_sprint_review.js tests/test_sprint_review_api.js tests/test_auth_resume_state.js tests/test_analytics_events.js
.venv/bin/python -m unittest tests.test_planning_inclusion tests.test_planning_inclusion_routes tests.test_sprint_review tests.test_sprint_review_routes tests.test_work_structure_reviews tests.test_db_oauth_cutover
npx playwright test tests/ui/planning_shared_plan.spec.js tests/ui/planning_review_integration.spec.js tests/ui/planning_review_table.spec.js --browser=chromium --workers=1
```

Run deterministic PostgreSQL race gate only against the approved disposable target, never the configured application DB:

```sh
REQUIRE_POSTGRES_REVIEW_CONCURRENCY=1 .venv/bin/python -m unittest tests.test_sprint_review_postgresql
```

Before authorized push: build, full frontend/backend checks, full local Chromium suite, required headed Firefox/WebKit geometry, structure and union-doc guards, complete diff/history review and explicit user confirmation. Preserve actual CI status; no commit/push/PR is requested here.

| Requirement | Primary tasks | Observable acceptance |
| --- | --- | --- |
| R0 | 0,1,5 | DB/OAuth-only serving/guards; real lifecycle and no fallback; fixtures/CI/docs migrated; old files/data untouched. |
| R1 | 1–4,6 | Complete authorized A/B projection; visible+hidden arithmetic; no unauthorized IDs/totals; no filtered pruning. |
| R2 | 2,4,5,7 | Both auto-inclusion paths gone; saved empty distinct; independent Sprints/namespaces; D1/D2 policy and link compatibility. |
| R3 | 3–5 | Single atomic Save, inclusion Undo, latest-baseline Discard, guards, pending-edit rebasing, receipt reconciliation and real sign-in restoration. |
| R4 | 2–3 | HTTP capability/auth/scope matrix, tombstones/CAS, precommit ack bounds, PostgreSQL overlaps, no Jira writes. |
| R5 | 6 | Exact copy and accessible names; built-in identity preserved; truthful empty/error/save/preview states. |
| R6 | 6–7 | Compact controls/sticky budgets; read-only row details; preserved context; List retired after E3. |
| R7 | 8 | Existing analytics identities, no private data/duplicates, affected contracts updated. |

### Review/verification record for this documentation turn

- Specification reviewed through three independent read-only passes; source findings and dispositions recorded in Section2. Two bounded follow-up inventories traced the newly approved auth-retirement runtime, fixture, deployment and documentation scope.
- User-confirmed primary testing boundary retained; missing fixture and PostgreSQL overlap gate made explicit.
- Source implementation not executed. Runtime gaps, approved-target requirements and the explicit E4 namespace prerequisite remain gates. The clean branch was reconstructed from main with only the three #331 files; unrelated work remains preserved outside it.
- The user confirmed D1 application-wide DB/OAuth-only retirement and D2 preservation without import. Both are incorporated; the updated issue body and restored ready-for-agent label were read back exactly on 2026-11-02 (updatedAt 2026-11-02T13:56:44Z). No product decisions remain pending; implementation and environment gates remain explicit.
- Final local validation passed: relative Markdown links, JSON examples, R0–R7 task coverage and corrected contract/gate assertions; 12 union-document guard tests; git diff --check.
- Second-pass findings on receipt ordering, synchronized admission proof, policy registration, real fixture controls, cross-document auth evidence and local dependency inspection are incorporated. Final changes receive root self-review; no third independent approval is claimed.
