# Shared Planning inclusion and clear controls — implementation plan #331

> **Status:** In progress. The operator approved integrating the committed prerequisite from the main checkout on 2026-11-03; merge `8470f0c3` integrates source head `45b19336` without rewriting history. E4 is resolved at source level; Tasks0–3 are verified; frontend controller, recovery and compact controls have focused verification; Task0.1 (PostgreSQL-only database and DB-backed single-use CSRF) was approved and implemented on 2026-11-06; its full backend and Chromium gates are still pending, so real application integration remains unverified. A fresh disposable local PostgreSQL cluster was explicitly approved for E2; no real application configuration or database may be used. E5 still gates a real installation cutover.
> **Execution:** Implement one task at a time, run its red/green checks, and review the result before its dependents. This document authorizes no implementation, commit, push, or pull request by itself.

**Goal:** Deliver [#331](https://github.com/Juce-me/jira-execution-planner/issues/331): one explicit shared Department/Sprint plan, safe Team/filter projection, understandable inclusion/save labels, and Table-only Planning without losing dependency context.

**Architecture:** First retire Basic/API-token and local-store OAuth runtime paths application-wide while preserving supported DB/OAuth behavior and existing files. Then extend the existing shared review transaction and controller with an inclusion document and operation receipts. Reuse its group/namespace lock, issue authorization, row kinds, dirty-scope guard, and presentation components. Keep Jira writes and Team/assignee-capacity stores independent.

**Tech stack:** Python 3.10+ with supported OpenSSL, Flask, SQLAlchemy/Alembic on PostgreSQL only (SQLite retired by operator decision 2026-11-06; Task0.1A converts the remaining SQLite runtime/test paths); React 19, Node 20.x, esbuild, existing Playwright. No new runtime dependency.

**Branch base:** `feature/331-shared-planning` was reconstructed directly from fetched `origin/main` at `13d63d43d016d37bf76ec034cf7652c25ef6e2f5` on 2026-11-02. Its commit contains only this plan, its index entry and the two instruction learnings. No quarterly-configuration implementation or capacity/chart changes are included.

**Original review baseline:** source findings below were gathered at `fbca7d7ee8d675bb8a856071d0901efaea26c043`. That checkout contained quarterly review-namespace code not present in the clean branch base. Preserve that distinction: E4 gates the affected implementation steps until the prerequisite is integrated or the plan is explicitly adapted and reviewed against the then-current main.

**Outcome:** Preparation and the approved quarterly prerequisite are verified. Task0 is complete: runtime, consumer, launcher and fixture retirement passed full backend/frontend, real PostgreSQL and the operator-approved full browser coverage arrangement. Task1 provides the verified real persistence journey and Task2 the reviewed storage primitives; Task3 atomic HTTP persistence and its concurrency gate are verified; frontend integration remains active. The compact controls passed 66 mocked integration cases, Table details passed six component browser cases, and PostgreSQL concurrency passed 46 cases. The primary real application journey exposed concurrent CSRF cookie issuance invalidating an otherwise valid token; Task0.1 was redesigned on 2026-11-06 after three independent reviews, approved and implemented the same day; full-suite verification is pending. Shared Planning itself is not yet complete.

**Current accuracy:** The active integration baseline is `45b19336` from the clean main checkout, merged as `8470f0c3`; the original `origin/main` base remains recorded above for provenance. Namespace helpers and migration now exist. The issue-scanned Sprint catalog's process-local publication lock differs from the original plan assumption; Section4.3 now requires a bounded proof hold through transaction exit for that source kind.

## 1. Global constraints and gates

- Preserve the unrelated capacity/chart work saved outside this clean branch; do not restore it as part of #331. The initial modified paths were `docs/design-system.md`, `docs/features/planning-sprint-review.md`, `docs/ontology.md`, `frontend/src/eng/PlanningAssigneeCapacityBar.jsx`, `frontend/src/eng/planningAssigneeCapacityModel.js`, `frontend/src/stats/StackedBar.jsx`, `frontend/src/styles/stats/project-track.css`, `tests/test_planning_assignee_capacity_model.js`, and `tests/ui/planning_assignee_capacity.spec.js`. Read and coordinate overlaps before future implementation; do not reset them.
- Use [root instructions](../../AGENTS.md), [plan instructions](AGENTS.md), [ownership contract](../../backend/security/CONFIGURATION_OWNERSHIP.md), [design system](../design-system.md), and applicable nested instruction chains.
- One plan scope: workspace + Department group + Sprint + review namespace. Team is a filter. No selection inheritance, automatic inclusion, Jira Sprint/status writeback, administrator-store relocation, or new live-update transport.
- Preserve existing review ownership: definitions/issue values across Sprints; layouts per Sprint; namespace isolation. Preserve capacity document inheritance separately.
- Reuse components/tokens/classes. Keep Filters and dirty Save/Discard in their existing positions; retain existing desktop sticky-stack limits, including the 175px assertion at 1440x900 and 1280x720.
- Preserve the existing table's typography, row density, column order/visibility/widths, editors, checkboxes and horizontal scrolling. Limit visual changes to the agreed controls/copy and explicit detail action; no table redesign. Produce mockups by rendering branch components/styles with synthetic fixtures and capturing browser screenshots.
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
| E4 | Resolved by approved integration `8470f0c3` from main-checkout head `45b19336`. The original review required: the review namespace migration, `backend/services/work_write_scope.py`, `backend/routes/work_structure_routes.py`, `backend/services/planning_work.py`, `frontend/src/eng/planningReviewKinds.js`, and associated work-structure tests. | Gate only tasks/acceptance that reference those interfaces. Integrate their approved upstream implementation first, or explicitly adapt and re-review those task contracts against current main. Do not silently recreate missing helpers or pull quarterly history into #331. Independent DB/OAuth-retirement work may proceed after its own gates. |
| E5 | Preserve the frozen supported DB/OAuth configuration matrix in Section1.1 through CLI/preflight/WSGI/request resolution, then obtain operator-owned nonsecret effective-profile evidence before a real installation cutover. | This review does not inspect live .env or attest its values. No cutover, configuration rewrite or claim of actual-file compatibility from synthetic evidence alone. Active retired profiles require the approved DB migration first; inert keys in an already supported profile remain accepted. |

No open product choices remain. D1/D2 are confirmed; E0–E5 are execution/environment/review/prerequisite gates. Task0 is part of the agreed scope, not an optional compatibility variant. Do not substitute a legacy auth/storage fallback when a gate is unavailable.

Home write gate review: `GATE-05-home-write-capability.md` remains blocked and is not a dependency of this feature. Its overdue review was recorded on 2026-11-03, next due 2026-11-09. No approved write target or new PASS evidence was provided; live environment/credentials were deliberately not inspected and no probe or Home mutation ran.

Home read gate review: the OAuth setup support reference records the original eight-operation probe as FAIL; the accepted, implemented public-read-v1 query profile omits unsupported identity/Teamwork Graph fields. The older EPM migration reference contains superseded API-token descriptions and must not override current source or the accepted public-read design. No live probe or new Home migration ran for this documentation task. Task0 removes legacy Basic reachability while preserving the shipped DB OAuth profile; it must not claim the original gate passed, add unsupported projections/scopes, or clear Home write gates. Record supported live-user acceptance separately from format/source tests.

### 1.1 Configuration compatibility and secret boundary

This review must not open the real dotenv file, token/credential files, live process environment or runtime endpoints. Do not run existing application imports/preflight/tests that might do so. The actual current configuration remains uninspected: compatibility of that exact installation is unverified until E5. Reading or hashing live credentials to prove they are unchanged is not permitted by this review.

- Preserve behavior of existing **supported DB/OAuth** setups without requiring users to edit their dotenv file. Obsolete Basic credential fields and local-store path/TTL/opt-in settings may remain inert in accepted local-loopback DB profiles; their presence does not select a retired auth mode. Do not read a token file, construct a Basic client, or parse an obsolete TTL/path solely because a leftover key exists. Retired explicit CLI credential requests still reject without echoing values.
- Preserve existing negative security validation, including unsafe hosted binding/local-store opt-in, wildcard origins, missing encryption configuration and invalid IAM/TLS/driver/password combinations, plus existing migration/storage-schema failure handling. Do not make invalid hosted profiles valid merely to broaden an ignore rule or invent a startup physical-schema probe.
- Freeze the old supported-profile cases **before** migrating fixtures/default assertions. Test new default behavior separately; it is an intentional cutover, not proof that an older Basic/local-store configuration remains supported. No automatic file/credential import, key generation/rotation, database rewrite or fallback may conceal an unsupported profile.
- Preserve checkout-pinned dotenv lookup and process-over-file precedence. Keep production dotenv bootstrap before module-level settings, app construction, signing key/cookie and CORS binding; the new serving factory validates that already configured application. Do not move dotenv only into a late factory while leaving earlier globals/app defaults in place. Preserve current explicit noncredential CLI overrides and local-runner overrides. Models/migration/pure-helper imports remain independent; test server imports receive explicit synthetic configuration and blocked live-file access before import.
- Preserve selected site/environment/workspace identity, DB connection mode, key-provider selection and keyring interpretation. Existing encrypted DB tokens and valid older DB-backed cookie upgrades must remain usable after restart; never regenerate/rekey/reset them as a side effect of retirement.
- Add a narrow `tests/run_isolated_runtime_tests.py` entrypoint and reuse its launch preparation in browser fixtures. Snapshot tracked **working-tree source** plus an explicit reviewed allowlist of new task-source files, so dirty and newly created implementation code is tested before staging. Never copy arbitrary untracked files, live dotenv/credentials or generated configuration. Include only frontend build output verified against that same source, and reuse pinned dependency/runtime paths without copying their process environment. Write synthetic config artifacts and launch children with an explicit synthetic environment rather than copying `os.environ`. Before application imports, assert forbidden credential-loader paths and non-fixture network calls fail; keep this to test-fixture guards, not a general sandbox framework. Provider/SQLite fixtures remain synthetic; an explicitly approved PostgreSQL target is a separate E2 input, never the application's DB. Emit only safe test results/error categories. Full backend runs and every browser fixture that starts the app use the same preparation; focused-test isolation alone is insufficient.
- Assert server/backend/test module paths resolve inside the synthetic checkout even when reusing an editable-installed Python environment. Install forbidden-I/O instrumentation before imports in every fresh application-importing child, including browser-started servers; an in-process patch alone is insufficient. PostgreSQL mode allows only the approved E2 connection target in addition to fixture traffic.
- Synthetic file-preservation tests compare complete fake dotenv/config/token-file bytes before/after successful and rejected startup. This is evidence of code behavior, not an assertion that the real private file was read or compared.

| Frozen synthetic case | Required regression result |
| --- | --- |
| Explicit supported DB/OAuth through CLI, preflight and validated WSGI | Same effective site, DB, origins, cookie/signing/key-provider inputs; real DB identity/CSRF/write remains functional. |
| Local/dev loopback DB/OAuth with leftover Basic fields and valid local-token flag/path/TTL | Preserve currently accepted serving/preflight behavior; no Basic field use, token-file access or credential fallback. |
| DB/OAuth with an invalid unused legacy TTL (new parser-removal case) | Preflight already ignores it, while current server import parses it. Removing that obsolete parser intentionally permits it; test separately from the frozen supported corpus and retain hosted opt-in rejection. |
| Hosted/network profile with currently forbidden local-store opt-in or unsafe cookie/origin settings | Remains rejected; no security relaxation, leaked values or mutation. |
| DB aliases plus surrounding whitespace | db/database/postgres/postgresql agree across profile validation, repository, engine and request routing. |
| Omitted/empty/whitespace auth/storage selector | New documented default is identical across all consumers; tested separately from the preserved explicit-DB corpus. |
| Actual selected Basic, live JSON or local-file auth | Sanitized rejection at the explicit retirement cutover; no files/data changed and no silent auth/storage conversion. |
| Retired credential CLI flags | Reject without values in stdout/stderr; supported server-port/site/query overrides preserve existing behavior. |
| Synthetic checkout dotenv, different CWD, and conflicting parent dotenv | Use the chosen checkout only; never search or merge another checkout/parent. |
| Exported/runner values conflict with file values | Preserve effective precedence, dedicated local DB/loopback overrides and migration -> preflight -> app order. |
| Dotenv-configured WSGI start/restart | Configured signing key, secure-cookie/CORS and DB/encryption state are bound before serving; no random secret replacement or invalidation of valid DB sessions. |
| Local/dev implicit encryption source, hosted explicit source and retired keyring | Preserve all previously valid cases and ciphertext/session usability without rekeying or secret output. |
| URL versus Cloud SQL IAM | Existing connection-mode/TLS/driver/timeout/password rules hold; no connection fallback. |
| Container migration on/off and missing config/DB failure | Preserve policy/order; failure stops serving safely without file rewrite or a legacy fallback. |
| Synthetic dotenv/config/token files and unrelated encrypted rows | Exact fake-file bytes and unrelated row contents unchanged through accepted/rejected paths. |
| Versioned DB-cookie upgrade plus OperationalError/rollback | Existing successful upgrades and rejected/stale/error cases keep their tested outcomes. |

## 2. Review findings and disposition

Three independent read-only passes covered UX, persistence/concurrency, and testing/security. This table records the actionable results; repeated stories/tests were consolidated in the revised issue.

| Finding | Source evidence | Resolution |
| --- | --- | --- |
| A valid DB/OAuth config can contain inert legacy settings | tracked sanitized example; `scripts/check_startup_preflight.py:80–90`, `tests/test_startup_preflight.py:107–127` | E5 and Section1.1 prohibit key-presence rejection and freeze supported/unsafe cases. |
| Defaults can disagree between repository and DB engine | `backend/config/repository.py:25–32`, `backend/db/engine.py:40–43` | Shared I/O-free normalization across every consumer; add engine to Task0. |
| Late factory dotenv loading can stale signing/cookie/CORS config | `jira_server.py:107–108,143–181`, `backend/app.py:11–29` | Preserve bootstrap-before-app order and behavioral pinning/precedence/restart tests. |
| Existing test commands may load the live dotenv | `tests/test_app_startup.py:21–38`, server bootstrap | Explicit isolated test entrypoint before imports, synthetic files/env, forbidden-I/O assertions; never run unchanged live-config tests during review. |
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

New migration: `backend/db/migrations/versions/20261102_0023_shared_sprint_plans.py`, with proposed parent `20261030_0022` from the original review baseline. E4 is resolved by the approved integration; re-read the actual Alembic head before creating the migration. Do not silently substitute a parent that omits the required namespace contract. Upgrade makes no Jira/browser-data call and preserves every existing row. Downgrade checks for populated plans/entries/receipts and refuses before dropping data.

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
| Loaded uninitialized | No saved plan yet; a genuine inclusion/review edit starts an explicit initialization draft. If inclusion later returns to empty, keep that initialization intent dirty so Save plan can confirm an empty document. Undo back to the pre-edit state or Discard clears the intent. Merely viewing or a no-op bulk action stays clean; no extra clean-state Save button. |
| Loaded saved empty | No stories in this plan; remains initialized; no inheritance or legacy adoption. |
| Loaded clean | Confirmed projection and capability; clean remote refresh may replace it. |
| Inclusion/review edit | Unsaved changes; capacity immediately reflects draft; include/remove operates only on matching real children. |
| Team/filter/row/detail change | Same draft, no guard, no pruning, no Jira refetch due solely to the filter. |
| Save pending | Freeze payload and operation ID; review editors retain their existing save lock; later inclusion edits allowed. Undo is temporarily disabled; Save cannot dispatch again. |
| Save confirmed | Advance submitted baseline; remove only acknowledged unchanged draft entries; retain later inclusion actions/dirty state. |
| Definite rejection | Preserve entire draft/history, show typed error; no partial confirmed state. |
| Unconfirmed | Preserve frozen request and later draft; block another operation; look up original outcome. Same unexpired ID/hash can be deliberately retried. A later retry's rejection proves only that attempt did not commit; it does not resolve an earlier uncertain attempt. Keep reconciling the original operation. |
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

Client `scopeProof` and internal publication evidence are different contracts. Hash stable canonical scoping semantics for the client: workspace/group identity and shared revision, effective work/field configuration, actual admitted source identity/mode/digest/range, Sprint admission identity/name and compiled scope digest. Exclude publication UUIDs, refresh timestamps and browser identity: identical scope in two workers or an unchanged catalog refresh must not invalidate the draft. Each save separately captures the current publication version before Jira authorization and validates that exact per-attempt evidence after locking, holding the process-store guard through transaction exit when applicable. This adds no shared cache or persistence mechanism.

1. Start the v2 handler's monotonic deadline, then resolve authenticated DB actor/workspace and syntactic frozen request/scope/hash. Before mutable configuration resolution, find an existing actor-bound receipt and verify its persisted canonical scope/hash. Report its committed outcome despite later issue movement/configuration changes; reauthorize any value-bearing acknowledgement or return committed metadata plus `reloadRequired:true`. Different scope/hash under the same ID conflicts; other actors' receipts are not discoverable.
2. For a missing receipt, resolve current group/configuration and source-admitted Sprint in every namespace. Capture configuration digest, WorkspaceGroupConfig.config_revision, source/catalog proof and scope digest within the already-running deadline. Add no new closed-Sprint HTTP denial.
3. Compile authoritative addition/projection eligibility using the helper below. Validate the union through current-user Jira visibility under one budget. Inclusion additions/projections use the authoritative candidate JQL and its planning-row role; review cells separately retain their existing native-kind classifier. In Legacy, `story` is the table's planning-row role, not an extra issue-type/hierarchy filter: explicit `issueTypes=[]` keeps unrestricted discovery, including configured custom types, without changing the narrower existing review-cell policy. Removals need current Jira visibility plus an existing exact-plan record, without requiring current Department/Sprint membership or old child-kind classification after a move/type change. No Basic fallback.
4. Enter one session_scope and lock in this order: `acquire_workspace_config_fence(session, workspace_id, budget=remaining_seconds)` -> current WorkspaceGroupConfig row FOR UPDATE -> existing NULL-Legacy schema fence -> selected namespace schema -> exact plan/entries. Refresh-read configuration/group/catalog proof after locking; abort if it differs from the authorization snapshot. Board catalog publication shares the advisory fence; group UPDATE blocks on its row lock. Issue-scanned catalogs are process-local: acquire a bounded `ScopedSprintCatalogStore` proof guard after the DB locks, recheck the actual admitted source/version/digest, and hold that store lock through transaction exit. Publication/retirement in that process must wait on the same store lock; never claim its publication is protected by the DB advisory fence. Acquire no DB lock or Jira network call while holding that process-local proof guard; preserve DB -> store lock ordering. Legacy review-only callers keep their original path.
5. Recheck receipt/hash under the fence to serialize duplicate first attempts, then recheck immutable expiry and remaining deadline before first execution. Matching receipts remain readable after expiry. No independently committing service or inclusion inheritance.
6. Compare existing schema/view/cell CAS unchanged and Section3.2 inclusion revisions, normalize review changes, enforce caps, and stage plan/entry/review/receipt mutations. Explicit initializePlan may create a missing plan but never resets an existing one. A first v2 save, including review-only or intentionally empty, sends initializePlan=true; a missing plan with false is a typed validation rejection.
7. Build and JSON-serialize the bounded acknowledgement using the same encoder as the route before transaction exit. Size/serialization failure rolls everything back. Commit once and return the prepared acknowledgement; receipt reconciliation handles failed delivery.

Create `backend/services/planning_scope.py` with `compile_planning_inclusion_scope(config_snapshot, group_snapshot, admitted_sprint, work_context) -> {candidate_jql, child_kind, scope_digest}`. Extract the verified `fetch_tasks` base/template -> Team -> Sprint -> planning-type assembly into a shared pure seam; preserve its existing clause insertion and Team-filter removal behavior rather than substituting a similar JQL builder. Resolve the work context with `planning_work.resolve_work_request` before invoking the compiler. The request adapter must explicitly capture the effective base JQL and Team template, which currently come from bound process configuration rather than the workspace payload; the pure compiler reads no environment, request or application global. Never call the HTTP handler or read request.args inside the compiler. Capture Teams/labels/other Department inputs from the shared group row and configuration from the authoritative snapshot. Build bounded `id in (...) AND (candidate_jql)` searches. Reuse `work_structure_routes.admit_sprint_source` through a narrow adapter and retain the actual returned source, including an observed issue-scan supplement instead of assuming the inherited Board source. Use the effective configuration/field digest for work semantics and the admitted source digest/version for source proof; do not conflate them. Projection reads use the same eligibility compiler, planRevision and scopeProof. Read the plan revision and returned entries in one SQL snapshot (one joined statement, or an appropriate plan read lock) so READ COMMITTED cannot label new entries with an old planRevision. An absent plan returns a self-consistent false/revision0 projection without creating rows; concurrent first creation is detected by subsequent chunk revision checks. Jira membership/visibility is a completed-read snapshot, not a distributed transaction; these DB fences protect configuration/catalog/group consistency, not external Jira changes.

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

**Create:** `backend/auth/runtime_profile.py`, `tests/db_oauth_test_helpers.py`, `tests/fixtures/db_oauth_server.py`, `tests/ui/db_oauth_fixture.js`, `tests/ui/db_oauth_lifecycle.spec.js`, `tests/test_runtime_profile.py`, `tests/run_isolated_runtime_tests.py`, `tests/isolated_runtime_sitecustomize.py`, `tests/test_isolated_runtime_runner.py`, `tests/test_runtime_auth_cutover.py`, `tests/test_runtime_consumer_cutover.py`, `tests/test_db_oauth_test_helpers.py`.

**Modify runtime:** `jira_server.py`, `backend/auth/jira_auth.py`, `backend/auth/db_context.py`, `backend/security/guards.py`, `backend/security/policy.py`, `backend/routes/auth_routes.py`, `backend/config/repository.py`, `backend/db/engine.py`, `backend/auth/cache_policy.py`, `backend/auth/project_access.py`, `backend/routes/eng_board_routes.py`, `backend/epm/home.py`, `backend/routes/admin_routes.py`, `backend/routes/eng_routes.py`, `backend/routes/settings_routes.py`, `backend/services/catalog_app_adapter.py`, and active callers of retired service-credential recovery. Remove `backend/auth/local_oauth_store.py` and `backend/services/eng_board_basic.py` only after all runtime imports/compatibility wrappers and positive test dependencies are retired; remove their obsolete dedicated positive test modules while retaining the migrated DB/OAuth and pure-model coverage.

**Modify frontend compatibility:** `frontend/src/dashboardRuntime.js`, `frontend/src/epm/useEpmNavigationState.js`, `frontend/src/settings/AdminAccessSettings.jsx`, `frontend/src/settings/useSettingsPermissions.js` and their capability/visual fixtures. Remove dormant Basic navigation and everyone-admin fallbacks without changing supported DB settings rights. The blocked-storage acceptance finding additionally requires guarded local-storage acquisition at existing `dashboard.jsx` and `eng/usePlanningSelectionSync.js` call sites; this is a getter-safety fix only, with no auth-screen, table-layout, storage-key or selection-rule change.

**Modify launch/setup:** `scripts/check_startup_preflight.py`, `scripts/docker-entrypoint.sh`, `scripts/install.sh`, `runners/local/run.sh`, `Makefile`, `.env.example`, `.github/workflows/verify-frontend-build.yml`, `.github/workflows/release-latest.yml`, active container packaging config if it independently names the WSGI target. Keep ignored token-file/packaging protections.

**Modify tests/docs:** `tests/auth_mode_test_utils.py`, `tests/oauth_test_helpers.py`, ordinary callers using their obsolete positive profiles, `tests/test_startup_preflight.py`, `tests/test_app_startup.py`, `tests/test_container_packaging.py`, `tests/test_auth_routes.py`, `tests/test_config_storage_selector.py`, `tests/test_config_jsonfile_fallback.py`, `tests/test_env_file_pinning.py`, `tests/test_local_postgresql_runner.py`, `tests/test_postgresql_runner_contract.py`, endpoint/security and DB cutover/refresh/cache/Board/Home tests. Convert relevant visual-browser fixture profiles, including Planning, capacity, settings-access, status-color, Board and measurement-runner scenarios. Update `README.md`, `INSTALL.md`, `docs/SUPPORT-atlassian-oauth-setup.md`, ownership/profile instructions and touched ontology entries. Read relevant nested instructions and preserve existing dirty docs.

**Interfaces:** `normalize_runtime_profile(auth_mode, storage_backend) -> tuple[str, str]` is pure and I/O-free: new defaults are Atlassian OAuth + DB; missing/empty/whitespace selectors follow that documented default, and `db`, `database`, `postgres`, `postgresql` retain DB equivalence. `validate_supported_runtime_profile(auth_mode, storage_backend, *, explicit_legacy_cli_options=()) -> None` rejects an effective unsupported profile or an explicit retired credential CLI request with sanitized typed errors. It does not reject supported DB/OAuth merely because obsolete environment keys exist. Configuration repositories, `backend/db/engine.py`, request guards and CLI/preflight/WSGI consume the same normalization; the pure module imports none of those consumers, avoiding a dependency cycle. Required serving values remain validated through existing secret/key/connection validators, without changing their defaults or interpretation. `jira_server.create_serving_app()` validates the already configured application and returns it; preserve Section1.1's dotenv-before-globals/app initialization order. Request/token guards independently require DB identity even if a raw import bypasses serving validation. Public login/callback/status/health retain their intended behavior. Models, Alembic and pure helpers remain independent of serving credentials; server imports in tests must block live dotenv/credential access before import.

**Reusable fixture interfaces:** `seed_db_actor(session, *, workspace, account_identity, roles)` persists encrypted synthetic tokens and creates a real opaque DB session using existing DB helpers. `startDbOAuthServer({python, databaseUrl})` exposes real signed-cookie contexts, provider-boundary login, per-session expiry and owned teardown; launcher-only IPC controls provider responses. Task1 extends it with Planning data and real-save pause/lost-ack controls instead of building a second auth fixture or intercepting application APIs.

- [x] **0.1 Freeze compatibility before changing fixtures.** Capture Section1.1's supported/invalid synthetic corpus from existing tests and selectors first. Build the isolated test entrypoint before invoking runtime suites, including reviewed new source, the matching frontend build and pinned dependencies; prove full-suite and browser launchers use it, with no inherited process-environment copies or live-file access during imports. Then create migrated DB/auth fixtures from existing DB session helpers and classify legacy positive, ordinary feature and rejection tests. Do not weaken the frozen corpus, blanket-skip tests or mock actual identity/CSRF in primary journeys.
- [x] **0.2 Make serving and request resolution DB-only without configuration drift.** Normalize effective defaults/aliases consistently in the engine, repository and guards; preserve Section1.1's bootstrap/app order and inert-key acceptance. Share the profile validator across CLI/preflight/serving factory and update Gunicorn's existing `jira_server:app` target. Remove Basic defaults/CLI credential acceptance, synthetic local-basic admin context, local OAuth store constructors/wrappers, fallback branches in `current_request_auth_context`, `current_jira_session_data`, `current_oauth_session_callbacks`, CSRF/auth-refresh/callback/login/logout paths and `_require_real_oauth_session`. Retain the supported validated upgrade of an older DB-backed cookie; that is distinct from local-file OAuth. No missing/invalid/revoked DB session may consult a legacy file or produce a local principal.
- [x] **0.3 Retire reachable Basic clients and live JSON persistence.** Remove Basic Jira header/URL construction, Basic Board dispatch/cache/project-access shortcuts, Basic Home clients/factories and runtime service-credential connect/recovery prompts. The Basic-only Scenario overrides write is retired, not converted into a new OAuth write. Preserve DB OAuth bearer/context propagation, encrypted token refresh locking/version/revocation, non-admin/tool-admin ownership, strict Home public-read-v1 scopes/private enablement and all external write gates. Keep explicit JSON artifact import/export tooling; it is not a runtime profile. Existing service-integration rows and historical migrations stay untouched and unused; no deletion migration.
- [x] **0.4 Close launcher/fixture/CI gaps.** Change Makefile/backend-security targets and both build/release workflows from Basic+JSON to isolated DB/OAuth. Update Docker entrypoint, installer and local runner; DB setup/migrations/encryption are mandatory for serving. Remove obsolete local-token/Basic setup from active examples/runbooks and require sanitized DB/OAuth setup guidance on rejection. Never rewrite the operator's existing environment, credential/config files, browser keys, or encrypted historical rows. If a controlled external capability probe needs an old Basic adapter, isolate it from application runtime under its existing explicit approved-target gate; do not leave an app fallback.
- [x] **0.5 Prove the real DB lifecycle before Planning.** The real browser/API/database journey covers unauthenticated redirect/sanitized API401; provider-mediated callback, encrypted DB tokens and opaque session; two non-admin users/private preferences/session-bound CSRF; authorized write/reload/second-user read; refresh, restart, logout, disabled/revoked users and DB failure; expiry, same-tab sign-in navigation and a new document mount without automatic write replay. Basic headers, old local cookies and a poisoned legacy token file grant no access and cause no file read/write. Check strict EPM/Home OAuth. The promoted/unpromoted quarterly-configuration subcase depends specifically on E4: independent auth work can proceed, but do not silently skip that case or mark all Task0 acceptance complete before it runs. Provider stubs do not prove Microsoft Entra/Atlassian SSO; retain that named operator journey.
- [x] **0.6 Validate boundaries and scope.** Run focused runtime-profile/startup/preflight/auth/DB/security/config/Board/Home tests through the isolated runner and frozen matrix, including behavioral dotenv pinning/precedence, engine-selector parity, signing/keyring restart, local-runner and container ordering and `tests/ui/db_oauth_lifecycle.spec.js`, then the existing full frontend/backend and local Chromium gates after build. Keep deterministic PostgreSQL refresh/locking evidence where already required and gated by E2. Add CLI, preflight, validated WSGI factory and bypassed-launcher request negatives; preserve import-safe tests. Record that old files/DB rows/browser keys are unchanged. Update owner-budget/digest inventories only for actual retired or changed owners.

**Deliverable:** the supported application and its positive fixture/deployment profiles use DB-backed OAuth exclusively; obsolete paths fail closed with no data deletion or fallback. Shared Planning implementation cannot proceed on an auth cutover that only changes startup messages.

### Task 0.1 — PostgreSQL-only database and race-safe browser CSRF (implemented 2026-11-06; full verification pending)

**Gate:** Approved by the operator on 2026-11-06 and implemented. Operator decision, 2026-11-06: PostgreSQL is the only supported database for serving, tests and local development; SQLite is retired. Three independent read-only reviews on 2026-11-06 (security, functionality, reliability) judged a move to server-side CSRF state correct but rejected the first design. Their findings were checked against the source and are incorporated below. 0.1A must land before 0.1B. The migration and the security change each need explicit implementation approval.

**Problem (verified 2026-11-06):**

- Cookie state. `issue_csrf_token` and `validate_csrf_token` (`backend/auth/csrf.py`) each copy the hash list from the request's signed cookie, change it and write it back.
  - Overlapping issuances keep only the later Set-Cookie, so the other valid token is lost and its request gets 403. `tests.test_csrf_token_bound.CsrfTokenBoundTests.test_concurrent_issuance_preserves_both_single_use_browser_tokens` fails with 403 instead of 200.
  - Validation rewrites the cookie too. A later response, or a resent older cookie, can bring a used hash back, so single-use is not enforced on the server. Exploitability is low: the token travels in a custom header, CORS uses an allowlist and cookies are SameSite=Lax.
- Client reuse. Single-use tokens are shared or reused on the client:
  - `fetchMutationCsrfToken` in `frontend/src/api/jiraIssueApi.js` shares one in-flight token request across up to four concurrent issue writes.
  - The assignee-capacity controller (`frontend/src/eng/usePlanningAssigneeCapacity.js` with `frontend/src/api/assigneeCapacityApi.js`) caches the token and retries once on `csrf_required`.
  - Scenario realtime (`fetchScenarioRealtimeCsrfToken` in `frontend/src/scenario/useScenarioDraft.js`) does the same on every heartbeat.
  - These produce 403s whatever the server stores.
- Error handling. The guard calls `validate_csrf_token` outside its error mapping (`backend/security/guards.py` `_require_token_bound_csrf`). `api_auth_csrf` catches only `AuthError` and `DatabaseConfigurationError`. Once these touch the database, storage failures would become unsanitized 500s. The engine sets no lock or statement timeout.
- Untracked callers. `bind_csrf_token` has no callers. The fallback checks in `backend/routes/views_routes.py` and `backend/routes/scenario_draft_routes.py` are skipped in serving by `g.security_csrf_validated`; the views fallback binds through `oauth_session_data()`, which can never match. The validation in `jira_server.py` `post_scenario_overrides` is unreachable while that route stays `legacy_basic_local`.
- Sessions without a browser-session row. When the older DB-cookie upgrade fails with `OperationalError` (`jira_server.py`), the session keeps a validated context with no browser-session id, so the `db_token_version` branch of `_binding` is used. Concurrent upgrades create several `browser_sessions` rows, and the last cookie wins.
- Lock conflict. Catalog publication takes `FOR SHARE` on the refresh actor's `browser_sessions` row (`backend/services/workspace_catalog_cache.py`), so any CSRF write to that row conflicts with it.

**Rejected alternatives:**

- Client-side serialization of token fetches. Validation also rewrites the cookie, tabs cannot coordinate, and used hashes can still come back.
- Deferral. It keeps the regression and both #331 and #323 real-app acceptance failing.
- A JSON hash list on the `browser_sessions` row. It conflicts with catalog publication's row lock and needs a read-modify-write.
- Stateless reusable HMAC tokens. They were not chosen because this plan keeps single-use tokens.

#### 0.1A — Retire SQLite

**Scope:** remove SQLite as a runtime, local or test database. Historical Alembic revisions stay unchanged, including their `sqlite_where` and dialect branches; current code and tests stop depending on them.

- **Serving.** The shared runtime-profile validation (`backend/auth/runtime_profile.py`, consumed by CLI, preflight and `create_serving_app`) rejects a non-PostgreSQL `DATABASE_URL` with a sanitized typed error. `backend/db/engine.py` and `backend/db/reset_local.py` drop their SQLite branches; reset handles local PostgreSQL only.
- **Services.**
  - Remove SQLite paths in `backend/services/sprint_review.py` (insert and timeout branches), `backend/services/assignee_capacity.py` (insert), `backend/services/user_view_config.py` (`BEGIN IMMEDIATE`, `RETRYABLE_SQLITE_UNIQUE_MESSAGES`) and `backend/auth/db_tokens.py` (the SQLite no-op).
  - An unsupported dialect fails closed through the existing typed storage errors.
  - Remove `sqlite_where` from current models in `backend/db/models.py` only if model/migration parity tests stay unchanged and green.
- **Test infrastructure.**
  - `tests/run_isolated_runtime_tests.py` `synthetic_environment` stops defaulting to `sqlite:///…/runtime.sqlite3`. By default the runner provisions an owned, throwaway PostgreSQL cluster: `initdb`/`pg_ctl`, data directory under the snapshot's gitignored private `tmp/`, TCP on an ephemeral 127.0.0.1 port (the E2 record shows Unix-socket path-length failures), and teardown on every exit path.
  - The existing approved `--postgres-config` descriptor remains the alternative. It never targets an application database or the Docker `jep_local` cluster.
  - Each test module or class owns a schema, following the existing PostgreSQL test helpers in `tests/test_sprint_review_postgresql.py`.
  - Convert the 71 test modules and fixtures that reference SQLite (inventory: `rg -il sqlite tests`), including `tests/isolated_runtime_sitecustomize.py`, `tests/auth_mode_test_utils.py`, `tests/oauth_test_helpers.py`, `tests/db_oauth_test_helpers.py`, `tests/fixtures/db_oauth_server.py`, `tests/fixtures/planning_shared_plan_server.py` and `tests/ui/db_oauth_lifecycle.spec.js`.
  - Tests that assert SQLite behaviour are deleted or replaced with PostgreSQL equivalents. No test is skipped to pass.
- **CI.** `verify-frontend-build.yml` and `release-latest.yml` run the isolated runner and gain the pinned `postgres:16-alpine` service already used by `verify-postgresql.yml`. Note: local Homebrew has PostgreSQL 18; record both versions in evidence.
- **Docs.** `.env.example` (`TEST_DATABASE_URL` and the "SQLite is for unit tests only" comment), `README.md`, `INSTALL.md`, root `AGENTS.md` Commands and `docs/ontology.md`.
- **Verify.**
  - A source guard fails on `sqlite` in `backend/` (excluding historical revisions), `jira_server.py`, `scripts/` and `tests/`, apart from the negative serving test.
  - Serving rejects SQLite in CLI, preflight and the WSGI factory.
  - Full isolated backend and frontend suites pass on PostgreSQL. Record the wall time of the full backend suite before (3,406 tests, 446.540 s on SQLite) and after. The timing is measured evidence, not a new budget.
  - The full Chromium browser gate passes on PostgreSQL-backed fixtures.

#### 0.1B — Race-safe single-use CSRF on PostgreSQL

**Storage.** One row per outstanding token:

- New model `BrowserCsrfToken`, table `browser_csrf_tokens`.
- Columns: `token_hash` CHAR(64) primary key; `browser_session_id` FK to `browser_sessions.id`, ON DELETE CASCADE, not null; `created_at` timestamptz, not null.
- Index on (`browser_session_id`, `created_at`).
- New revision `backend/db/migrations/versions/20261106_0024_browser_csrf_tokens.py`, with `down_revision = '20261102_0023'`.
- Store hashes only. Use `_token_hash(token, binding)` with the binding browser session + auth connection + account; remove the `db_token_version` branch.
- The `browser_sessions` row is never written or locked by CSRF code. Logout, reconnect and revocation delete the session row, and the cascade removes its tokens.

**Issue: `GET /api/auth/csrf`.**

- Requires `X-Requested-With: jira-execution-planner`; otherwise 403. Update the five fetchers: `authApi.js`, `configApi.js`, `jiraCatalogApi.js`, `epmApi.js` and `performanceApi.js`.
- Requires a DB context with a `browser_session_id`; without one it fails closed with 503 `config_storage_unavailable` and never falls back to the cookie.
- Runs in its own short transaction:
  - `SET LOCAL lock_timeout` and `statement_timeout`, each at most 2 s;
  - `pg_advisory_xact_lock` on a namespaced key derived from the browser-session id;
  - INSERT the hash, then DELETE that session's rows beyond the newest 8 (order: `created_at` DESC, then `token_hash`);
  - commit before responding.
- Pop the obsolete `csrf_token_hashes` key from the Flask session.

**Consume: the single serving policy.**

- One statement: `DELETE FROM browser_csrf_tokens … USING browser_sessions … RETURNING token_hash`. Its predicate requires the hash, the browser-session id, matching user/workspace/connection, and the same actor/session/connection/workspace status rules as `revalidate_db_request_auth_context`, read directly rather than through the 30-second status cache.
- Exactly one returned row means valid. Concurrent consumers of one token: one succeeds, the other gets 403.
- It takes no advisory lock and no lock on `browser_sessions` or `auth_connections`.
- It runs in its own transaction with the same timeouts, committed before dispatch, never inside a route's `session_scope`. Planning routes derive the timeouts from the remaining `PlanningDeadline`.

**Results and errors.**

| Outcome | Response |
| --- | --- |
| One row consumed | Dispatch the route once; `g.security_csrf_validated` prevents a second consumption |
| Zero rows, session and connection still valid | 403 `csrf_required` |
| Zero rows, browser session, connection or user gone or disabled | 401 `auth_required` (terminal sign-in recovery) |
| `SQLAlchemyError`, `OperationalError`, SQLSTATE 55P03/57014 or commit failure | 503 `config_storage_unavailable` with an app error code (also through `_planning_auth_failure`); handler not dispatched; no replay |

A consumed token whose route later fails stays consumed; there is no automatic replay.

**Remove the cookie list.** Delete the cookie implementations of `issue_csrf_token`, `bind_csrf_token` and `validate_csrf_token`; `backend/auth/csrf.py` keeps only the hash and binding primitives. `views_routes.py`, `scenario_draft_routes.py` and `jira_server.py` delegate to the single policy (flag short-circuit preserved) or drop their dead checks. No route's policy class changes.

**Frontend.** One fresh token per mutation; the client never shares or caches a token. Remove `fetchMutationCsrfToken` sharing in `jiraIssueApi.js`, the caller-owned `csrf` cache in `assigneeCapacityApi.js` / `usePlanningAssigneeCapacity.js`, and `scenarioRealtimeCsrfRef` reuse in `useScenarioDraft.js`. Existing pre-dispatch `csrf_required` refetches may remain as a defence, but acceptance counts every 403 response and requires zero. Extend `tests/test_frontend_api_source_guards.js` to forbid shared or cached CSRF tokens in every module that fetches one.

**Known residual:** concurrent upgrades of an older DB-backed cookie can still create several browser-session rows, so one token issued to the losing row fails once with 403 (fail closed, no dispatch). The pre-existing absence of `browser_sessions` expiry and orphan cleanup is recorded, not changed here.

**Files:**

- Backend: `backend/db/models.py`, the new 0024 revision, a focused `backend/auth/csrf_store.py` service, `backend/auth/csrf.py`, `backend/routes/auth_routes.py`, `backend/security/guards.py`, `backend/routes/views_routes.py`, `backend/routes/scenario_draft_routes.py`, `jira_server.py`.
- Frontend: the five CSRF fetchers above, `jiraIssueApi.js`, `assigneeCapacityApi.js`, `usePlanningAssigneeCapacity.js`, `useScenarioDraft.js`.
- Tests and fixtures:
  - `tests/test_csrf_token_bound.py`, `tests/test_auth_routes.py` (cookie hash-list and cookie-size assertions, legacy mapping), `tests/test_scenario_draft_routes.py` (seeded cookie tokens);
  - `tests/fixtures/db_oauth_server.py` `NEW_SOURCES`;
  - the migration-head pins in `tests/test_planning_inclusion.py`, `tests/test_review_adoption_migration.py` and `tests/test_sprint_review_postgresql.py`;
  - `tests/test_db_migrations.py`;
  - `tests/test_frontend_api_source_guards.js`.
- Docs: `backend/security/CONFIGURATION_OWNERSHIP.md` (route inventory, no rights change), `docs/ontology.md`, `README.md`/`INSTALL.md` (the `jep_local` upgrade step: the app refuses to serve until 0024 is applied), and `docs/README_ANALYTICS.md` (no-event allowlist reason).

**Acceptance before integration:**

- [ ] Operator approves 0.1A and the 0.1B storage/security migration. All existing browser sessions and unrelated encrypted/auth/private-view rows are preserved; tokens outstanding at deploy fail once by design.
- [ ] 0.1A verification above passes; no SQLite remains outside historical revisions and the negative serving test.
- [ ] The existing regression passes. New deterministic PostgreSQL races, using the `overlap`/`wait_until_blocked` helpers and a pause seam after the lock, with no sleeps as proof:
  - two concurrent issuances both keep their tokens;
  - simultaneous consumption of one token: exactly one 200;
  - issuance racing consumption;
  - pruning at the ninth token;
  - two tabs sharing one opaque session.
- [ ] Replay negatives all return 403:
  - a used token replayed after a concurrent issuance's cookie;
  - a used token replayed with the pre-consumption cookie;
  - a token from a different user, workspace, connection or browser session.
- [ ] Missing `X-Requested-With` on the GET is rejected. Logout or revocation mid-flight gives 401. Lock timeout and storage failure give 503 with the handler proven not called.
- [ ] Source guards:
  - no serving import of the removed cookie functions;
  - no consumption inside `session_scope`;
  - every serving CSRF caller delegates to one policy without double consumption.
- [ ] Migration/adoption and current model parity pass. Opaque and older DB-cookie upgrade journeys, restart, logout/revocation and the frozen supported-configuration corpus pass without environment edits or secret reads.
- [ ] The two-session Planning journey, concurrent startup reads, concurrent ENG issue writes and two concurrent different-Team capacity saves all pass in the real app with zero CSRF 403 responses and no automatic mutation retry.

**Implementation divergences (2026-11-06):**

- Tests create one empty database per test (`tests/postgres_test_db.py`, `jep_t_<hex>`) instead of one schema per module. Only the runner's owned cluster or the exact GitHub CI target is accepted.
- CI locates the runner image's PostgreSQL binaries (`/usr/lib/postgresql/*/bin`) instead of adding the pinned `postgres:16-alpine` service. This is unverified until a push.
- The SQLite rejection lives in `backend/db/engine.py` (`require_postgresql_url`), which the CLI, preflight and WSGI factory all reach, rather than in `runtime_profile.py`.
- `token_hash` is `String(64)`, not CHAR(64).
- There is no stale-cluster reaper: a SIGKILL can leave a cluster under the ignored `tmp/`.

**Evidence so far:**

- Focused CSRF, PostgreSQL race, migration, runner and source-guard suites pass.
- The CSRF-affected batch passed 482 tests before the independent-review fixes.
- Frontend unit tests passed 3,562/3,562 on Node 20.
- An independent review found no blockers. Its P1/P2 findings are fixed: the negative header test, real-server fixture headers, Planning `noCommit`, sanitized 503s, per-test database gating, teardown on SIGTERM, and status/race/source-guard tests.

**Still open:** the full isolated backend suite after those fixes, the full Chromium `tests/ui` gate and CI.

**Deliverable:** a PostgreSQL-only application and test stack, with race-safe single-use CSRF under the already required DB-backed OAuth profile. Until approved and verified, Task 0.1 remains a browser-integration prerequisite for #331 Tasks 4–8 and for the multi-Team capacity work in [FUTURE-planning-assignee-capacity-deferred-323.md](FUTURE-planning-assignee-capacity-deferred-323.md). Earlier isolated runtime, storage and HTTP results remain evidence for their narrower boundaries.

### Task 1 — Real persistence journey fixture

**Create:** `tests/ui/planning_shared_plan_fixture.js`, `tests/fixtures/planning_shared_plan_server.py`, `tests/ui/planning_shared_plan.spec.js`.

**Modify narrowly:** `tests/fixtures/db_oauth_server.py` and `tests/ui/db_oauth_fixture.js` for a fixed Planning profile, reviewed new-source allowlist and test-owned seed/provider/control hooks. Reuse the existing identity, isolation, listener and teardown owners; preserve every existing profile.

**Read/reuse:** Task0's reusable DB fixture/launcher, `tests/test_db_oauth_cutover.py`, `backend/auth/db_tokens.py`, `backend/auth/db_browser_sessions.py`, `tests/ui/epm_view_fixture.js`, `playwright.config.js`.

**Interfaces:** `startPlanningSharedPlanServer({python, databaseUrl})` returns `{baseUrl, createContexts, expireSession, pauseSave, releaseSave, dropNextAckAfterCommit, allowProviderReauth, readOperation, stop}`. `createContexts(browser)` installs real opaque-session cookies in two separate contexts and returns their pages/contexts. Test-launcher-only IPC expires one DB BrowserSession, pauses/releases a real save, suppresses its acknowledgement only after a persisted receipt exists, permits same-principal provider reauthentication, and reads receipt metadata. No production control route is added. Python launcher extends Task0's real DB/OAuth launcher with Planning seed/save controls and starts the real app on an owned ephemeral loopback port; creates only an isolated migrated DB/test schema, seeds synthetic workspace dashboard source configuration, group/Teams, private views, project-access rows, validated catalog data, active/future Sprints and non-admin actors. Seed real encrypted OAuth connections and opaque browser sessions via `store_oauth_callback_tokens` and `create_browser_session`. Stub only provider/Jira network methods. Obtain CSRF from the real HTTP endpoint per session; never use local `install_oauth_session` token-store mode.

- [x] Add boot/smoke test proving distinct users, non-admin shared review capability, real API responses, real persisted readback and cross-session CSRF rejection. No `page.route('**/api/**')` in primary acceptance.
- [x] Add failing feature journey: A/B included, remove A, B stays; Save/reload/second session; different Sprint independent; no Jira mutation captured by the provider stub.
- [x] Run `npx playwright test tests/ui/planning_shared_plan.spec.js --browser=chromium --workers=1`. At this point smoke must pass; missing v2 feature checks must fail for the expected absent contract, not auth/bootstrap/environment errors.
- [x] Ensure teardown kills only the fixture server and removes only its owned DB/schema, including startup failure. Never use the live port 5050 server or application database.

**Deliverable:** a trustworthy test seam; current broad mocked browser suites remain useful for visual/controller cases.

### Task 2 — Inclusion storage, revisions and receipts

**Create:** `backend/services/planning_inclusion.py`, `backend/db/migrations/versions/20261102_0023_shared_sprint_plans.py`, `tests/test_planning_inclusion.py`.

**Modify:** `backend/db/models.py`, migration/schema guard tests that enumerate model tables.

**Interfaces:** `initialize_plan(session, schema_id, sprint_id, initialize) -> (plan, newly_initialized)` carries explicit initialization across flushes; `apply_inclusion_changes(session, plan, changes, newly_initialized=flag)` returns confirmed changed/no-op entries; `load_inclusion_projection(session, schema_id, sprint_id, allowed_ids, expected_revision)` returns only the requested authorized entries; `operation_identity(value, now)` validates UUIDv7/expiry; `find_operation(session, workspace_id, actor_id, operation_id)` binds scope/hash.

- [x] Add service tests for no-row vs saved-empty, namespace FK isolation, false tombstones, same-value convergence, stale opposing ABA conflict, disjoint changes, explicit initialization race, malformed/reused/expired operation identity and receipt cap.
- [x] Implement Section 3 models and exact inclusion transition rule; queries take the caller-provided existing session. These helpers do not open transactions or authorize Jira independently.
- [x] Implement canonical hash over normalized scoped v2 content, omitting only transport headers; reject same ID with a different canonical scope/hash. Receipt expires at the operation's immutable timestamp plus24h.
- [x] Add upgrade preservation and refused destructive downgrade tests; verify one Alembic head, physical migrated schema/model parity and missing-table fail-closed behavior. Current startup validation checks configuration, not the physical database schema; do not introduce a new startup DB probe or table-enumeration gate.
- [x] Run `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_planning_inclusion` and the migration tests with isolated DBs. Expected: all cases pass after an initial relevant red.

**Deliverable:** independently tested persistence primitives with no new live route.

### Task 3 — Atomic review/inclusion HTTP contract

**Create:** `backend/services/planning_scope.py`, `tests/test_planning_scope.py`.

**Modify:** `backend/services/sprint_review.py`, `backend/services/planning_inclusion.py` only for caller-owned prelocked-entry/cap integration, `backend/routes/sprint_review_routes.py`, `backend/security/policy.py`, and `jira_server.py` only for discovery parity and request-local deadline propagation. `backend/security/guards.py` and `backend/auth/db_context.py` propagate the v2 save deadline through initial authentication while preserving default callers. `backend/services/work_write_scope.py` and `backend/routes/work_structure_routes.py` adapt existing work/source admission. `backend/services/workspace_catalog_cache.py` adds a bounded publication proof guard and optional caller-owned, budgeted catalog reads; `tests/test_workspace_catalog_cache.py` verifies lock release, publication exclusion, session ownership and default compatibility. Read/reuse existing workspace configuration and group synchronization; do not add a second lock or storage owner.

**Tests:** `tests/test_sprint_review.py`, `tests/test_sprint_review_routes.py`, `tests/test_sprint_review_postgresql.py`, `tests/test_work_structure_reviews.py`, `tests/test_endpoint_policy_inventory.py`, `tests/test_endpoint_security_matrix.py`, `tests/endpoint_security_samples.py`, new `tests/test_planning_inclusion_routes.py`.

**Interfaces:** existing `load_review`, `read_values`, `save_review` retain legacy behavior; accept v2 optional fields and add the Section 4 metadata/projection/operation lookup responses. Add `load_save_operation(context, sprint_id, group_id, operation_id, namespace)`.

- [x] Add failing HTTP tests for every endpoint matrix row, wrong workspace/group/configuration, non-admin access, requested-with/CSRF failures, unauthorized IDs, invalid addition to Department/Sprint, moved/type-changed-but-authorized removal, and unchanged legacy review-only and closed-Sprint HTTP policy.
- [x] Extend authorization to the union of review and inclusion IDs under one count/time/page budget. Implement the new pure compiler named in Section4.3 from verified discovery semantics; do not assume an authoritative compiler already exists or approximate group ownership with Team IDs/client arrays. Test authoritative Component/label clauses in configured base/template JQL and configured hierarchy cases. Department `teamLabels` and `missingInfoComponents` currently affect readiness/alerts, not child discovery; parity tests must prove they do not widen the inclusion pool. Include Legacy missing/null/default, configured custom-name and explicit-empty issue-type cases; do not reuse the review-cell classifier to narrow inclusion candidates.
- [x] Implement Section 4.3 in the existing `save_review` session after `_locked_schema`; do not invoke a separately committing review service. Keep existing review CAS and cap behavior.
- [x] Pre-serialize v2 acknowledgement before commit. Inject serialization/size failures after staged mutations and assert DB rollback across entries, review cells/layout/schema and receipt.
- [x] Register the operations GET as dynamic authenticated_read in the policy registry and security samples. Test anonymous denial, same-actor success, cross-actor indistinguishable unknown, wrong workspace/scope, strict query keys and no GET CSRF requirement.
- [x] Implement candidate-authorized projections with one revision/scopeProof, receipt lookup and exact replay before mutable admission. Test committed outcome after issue move/type change, closed Sprint, changed configuration digest and revoked issue visibility; do not leak values.
- [x] Prove client scope proofs agree across independent stores/workers with identical semantic scope and survive an unchanged catalog refresh. Separately prove the per-save publication-version guard still rejects a publish between authorization and locking, even when its contents are unchanged.
- [x] Add controlled-clock expiry-crossing-while-waiting and aggregate deadline tests; enforce per-execution SQL remaining time. V2 API timeout35s exceeds30s server deadline.
- [x] Extend deterministic PostgreSQL `overlap`/`wait_until_blocked` cases for first-create, disjoint entries, ABA, duplicate operation, namespace writers and atomic rollback. Also change config/group/catalog proof after Jira authorization and before locks; the save must reject without changing any store. No timing sleeps as race proof.
- [x] Run `.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_planning_inclusion_routes tests.test_sprint_review tests.test_sprint_review_routes tests.test_work_structure_reviews`; then `.venv/bin/python tests/run_isolated_runtime_tests.py --postgres --postgres-config tmp/planning-331-integration/postgres-test-target.json tests.test_sprint_review_postgresql` against the explicitly approved disposable target. A skip does not satisfy E2.

**Deliverable:** v2 shared persistence with backward-compatible existing review callers.

### Task 4 — Single inclusion draft owner and combined save

**Create:** `frontend/src/eng/planningInclusionDraft.js`, `tests/test_planning_inclusion_draft.js`.

**Modify:** `frontend/src/eng/usePlanningSprintReview.js`, `frontend/src/api/sprintReviewApi.js`, `frontend/src/eng/planningSelectionActions.js`, `frontend/src/eng/usePlanningSelectionSync.js`, `frontend/src/planningSelectionState.mjs`, `frontend/src/dashboard.jsx`.

**Tests:** `tests/test_planning_selection_state.js`, `tests/test_planning_sprint_review.js`, `tests/test_sprint_review_api.js`, the primary journey.

- [ ] Implement the Section 5 inclusion interface and compose it into the existing controller. Add observable tests for additive/subtractive scope, full off-screen match set, mixed parent states and placeholders, 20-step inclusion Undo, confirmed baseline and pending-snapshot rebasing.
- [ ] Track unsaved initialization separately from entry differences for an absent plan: genuine include then remove can save an explicitly empty first plan, while Undo back to the pre-edit state or Discard restores clean/uninitialized. Keep dirty-only Save/Discard and no-op behavior; do not add an initial empty-plan button or infer initialization merely from opening Planning.
- [ ] Extend API wrapper for v2 payloads/projection staging/status lookup and v2-only35s timeout (legacy20s unchanged). Freeze payload/UUIDv7 until outcome known. Treat malformed 2xx bodies and potentially post-commit 5xx as unconfirmed, not proven rejection.
- [ ] Test a rejected deliberate retry while the original outcome is still unknown, including lock timeout or configuration change. Do not clear the frozen operation based on the retry's no-commit result; confirm the original receipt or follow explicit current-state recovery before releasing it.
- [ ] Inventory all old selectedTasks setters/storage writers listed in Section 5. Replace DB shared-mode writes with controller commands and derive the compatibility key map for render/analytics/export consumers. Keep issue keys a render adapter; immutable IDs remain authority.
- [ ] Remove both active Accepted/In Progress auto-inclusion and future default_all behavior. Do not prune inclusion based on filtered `selectionTasks`; project Team/filter rows from the complete authorized candidate pool.
- [ ] Stage all inclusion read chunks at one planRevision. On mixed revision retry a complete read at most twice, then show a stale/retryable state rather than partial totals. Do not drop dirty entries.
- [ ] Combined Save submits inclusion plus review draft once. Preserve later inclusion edits; retain existing review editor pending locks; prevent a second new operation before reconciliation. Combine Save/Discard/scope guards around one controller.
- [ ] Run `node --test tests/test_planning_inclusion_draft.js tests/test_planning_selection_state.js tests/test_planning_sprint_review.js tests/test_sprint_review_api.js` with Node20 after build dependencies exist, plus primary Playwright journey.
- [ ] Verify actual application API requests, persisted rows and the second session; helper-only passes are insufficient.

**Deliverable:** shared explicit inclusion without a parallel browser-authoritative map.

### Task 5 — Capability policy, safe migration and recovery

**Modify:** `frontend/src/api/authResumeState.js`, `frontend/src/api/authRecoveryCoordinator.js`, `frontend/src/components/AuthRequiredGate.jsx`, `frontend/src/api/connectionRecoveryState.js`, `frontend/src/api/useConnectionRecovery.js`, `frontend/src/shareView/applyController.js`, dashboard snapshot/restore and configuration-publication adapters, `frontend/src/eng/usePlanningGroupScope.js`, existing connection/group snapshot adapters that capture Planning. Actual sign-in/reload consumers must handle preservation failure before departing; a coordinator-only change is insufficient.

**Tests:** `tests/test_auth_resume_state.js`, `tests/test_auth_recovery_coordinator.js`, `tests/test_auth_required.js`, `tests/test_connection_recovery_state.js`, `tests/test_share_view_apply_controller.js`, `tests/ui/planning_selection_defaults.spec.js`, primary shared-plan journey.

- [ ] Verify Task0 completed the confirmed DB/OAuth-only cutover before integrating shared Planning; D1/D2 are settled and need no further product interview.
- [ ] DB/OAuth canSavePlan still requires successful capability/read validation. Missing/expired DB sessions use global sign-in recovery; shared storage/capability failure never enables local Save or a compatibility profile.
- [ ] Preserve legacy browser records byte-for-byte, do not offer an import, and never seed shared inclusion from them. Add same-browser coincident Sprint/group across workspaces/configurations tests; fresh shared plans require explicit inclusion/save under DB/OAuth.
- [ ] Implement strict auth-resume v2 with Section 5 byte/count/TTL/principal/scope limits and v1 shell-only compatibility. Test oversized/unavailable sessionStorage feedback and no silent truncation.
- [ ] Restore only after fresh authorized reads; preserve pending operation identity and reconcile it before enabling Save. Never auto-replay a plan or Jira write.
- [ ] Guard every scope leave, including configuration switch, group snapshots, closed-Sprint fallback and supported share apply, rather than retaining the current automatic-discard path.
- [ ] Run auth/controller tests and real-session browser expiry: expire session A in DB, provoke real 401, confirm mounted lock, sign in through fixture provider boundary, restore authorized unsaved/conflicted draft, and observe zero automatic PATCH/Jira writes. Prove same-tab sign-in navigation and a second dashboard Document/App mount using existing observeDocuments prior art; assert inclusion AND review reconstruction, a frozen unconfirmed operation plus a later inclusion edit, reconciliation before Save, and principal/namespace/TTL/oversize/storage-failure negatives. Swapping cookies in a mounted app is not acceptance.

**Deliverable:** explicit compatibility/capability state and bounded draft recovery.

### Task 6 — Labels, compact controls and totals

**Modify:** `frontend/src/eng/PlanningActionBar.jsx`, `PlanningOverviewPanel.jsx`, `PlanningCapacityBar.jsx`, `PlanningReviewStateCluster.jsx`, `planningReviewTableModel.js`, `PlanningReviewTable.jsx`, `PlanningTableStickyStack.jsx`, `frontend/src/styles/planning.css`, `frontend/src/styles/planning/actions.css`, `frontend/src/styles/eng/planning-review-table.css`, affected onboarding module/copy adapters located from their existing planning targets.

**Tests:** `tests/ui/planning_review_integration.spec.js`, `tests/ui/planning_review_table.spec.js`, `tests/test_planning_review_table_model.js`, primary journey.

- [ ] Use the issue's R5 table as the sole UI copy contract. Change only the display label of built-in `accepted` to Planned SP; preserve identity, stored order, visibility, custom columns and actual Jira Accepted status.
- [ ] Keep the visible and accessible action names **Select All**, **Clear Selection** and **Undo**, including when capacity details collapse. Do not replace the familiar bulk-action labels with dynamic counts. Both bulk controls explain their scope on hover/focus through the existing readout pattern and an accessible description: **Applies to all stories matching the current Team and filters, including rows below.** Counts and Planned SP remain in the separate summary/readout.
- [ ] Select All adds every matching eligible story to the current draft; Clear Selection removes matching included stories only. Both preserve selections outside the current Team/filter match set and never change Jira Sprint/status. Disable Select All when no matching excluded story remains, and Clear Selection when no matching included story remains; neither no-op creates dirty state or an Undo step. Test all matching rows below the viewport, partial selection, all-selected/empty states, and preservation across Team/filter changes. Keep inclusion semantics from Sections3–4 unchanged.
- [ ] Keep **Include by status** secondary in the existing compact menu pattern. Each of Accepted + In Progress, To Do / Pending, Postponed and Awaiting validation has explicit Include and Remove actions applying to the same matching scope; choosing/opening a group alone performs no mutation. Preserve exact status-set names in labels/descriptions.
- [ ] Keep Save plan/Discard changes in the existing Filters view-controls slot. Explain all pending Teams and cross-Sprint definitions/values when relevant; do not imply Save affects only the visible Team.
- [ ] Compute Section 3.3 visible/hidden/team totals from one draft. Show distinct loading/missing/saved-empty/read-error/capability states and preserve capacity provenance/exclusion explanation.
- [ ] Fit the existing desktop compact row; secondary status/export/detail commands use existing menus when necessary. Maintain measured offsets and the175px docked-header bottom limit at both desktop sizes for clean, dirty, saving and recoverable-error states, one/multiple Teams and hidden-work feedback. Primary actions/feedback remain reachable; secondary commands use existing menus. Responsive wrapping updates offsets.
- [ ] Capture settled before/after screenshots for one/multiple Teams, expanded/compact, 1440x900, 1280x720 and narrow/zoom states. Assert menu layering, readable focus/hover/disabled/mixed states and reachable controls.
- [ ] Compare the table before/after using identical synthetic rows, columns and selection: preserve column order/widths, row height, typography and editor/control geometry except for the approved Accepted -> Planned SP heading and bounded detail trigger. Assert stable Select All/Clear Selection names while counts change, and scope help on keyboard focus as well as hover. Browser-rendered mockups demonstrate layout only; they do not satisfy shared persistence, combined-save, Undo or two-user acceptance.
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

- [ ] Add exact payload assertions: one existing combined-save gesture/outcome event, inclusion per gesture, existing review values, no raw IDs/free text, transport gate respected, no hydration events. Update taxonomy and only necessary GA4 runbook entries.
- [ ] Update ownership row with canonical inclusion/receipt scope and capabilities, changed feature copy/behavior, registered detail control and no-Jira-write pin. Preserve other users' dirty docs; do not change ontology Coverage line3, date touched sections only.
- [ ] Run final commands in Section 7 and record actual results, including PostgreSQL and browser evidence. Reconcile the R1–R7 coverage matrix below.
- [ ] Review complete diff and remove unrelated lines. Keep this plan EXEC/Planned until code is implemented and verified. On authorized publication, follow the root exact-head transaction, explicit push confirmation, and DONE rename/link rules; do not publish an unfinished plan as complete.

**Deliverable:** verified implementation and aligned contracts, only during a separately authorized execution turn.

## 7. Verification and publication handoff

This review does not start a live application, run external mutations, or claim implementation tests passed. Dependencies/build were verified for the clean-branch documentation commit; implementation must revalidate E0 using the repository's existing bootstrap/pinned tools, not unmanaged host Python.

The earlier source-only review used AST probes and documentation validators. Implementation runtime tests must use the reviewed isolation runner; do not invoke unchanged application imports/preflight against the live checkout dotenv. While source files remain untracked, pass each reviewed new file explicitly with `--include`; a missing new file is not permission to substitute an old module or skip its tests. Browser fixtures must reuse the same synthetic preparation and register their owned loopback listener before connecting.

Focused execution commands, after dependencies/build and approved isolated environment:

```sh
npm run build
node --test tests/test_planning_inclusion_draft.js tests/test_planning_selection_state.js tests/test_planning_sprint_review.js tests/test_sprint_review_api.js tests/test_auth_resume_state.js tests/test_analytics_events.js
.venv/bin/python tests/run_isolated_runtime_tests.py tests.test_runtime_profile tests.test_startup_preflight tests.test_env_file_pinning tests.test_local_postgresql_runner tests.test_postgresql_runner_contract tests.test_planning_inclusion tests.test_planning_inclusion_routes tests.test_sprint_review tests.test_sprint_review_routes tests.test_work_structure_reviews tests.test_db_oauth_cutover
npx playwright test tests/ui/planning_shared_plan.spec.js tests/ui/planning_review_integration.spec.js tests/ui/planning_review_table.spec.js --browser=chromium --workers=1
```

Run deterministic PostgreSQL races only against the approved disposable target. The runner's --postgres mode consumes only the explicitly approved test-target input and enables the existing concurrency gate; it never copies the application environment/DB or prints connection values:

```sh
.venv/bin/python tests/run_isolated_runtime_tests.py --postgres --postgres-config tmp/planning-331-integration/postgres-test-target.json tests.test_sprint_review_postgresql
```

Before authorized push: build, full frontend/backend checks, full local Chromium suite, required headed Firefox/WebKit geometry, structure and union-doc guards, complete diff/history review and explicit user confirmation. The full backend suite and all app-starting browser fixtures retain Section1.1's synthetic checkout/environment boundary. Preserve actual CI status; no commit/push/PR is requested here.

The operator approved a full-Chromium execution exception for this branch: run all real-server suites with one worker, then every remaining suite with four workers, sequentially. Prove the two inventories are disjoint and their union equals the full test inventory; keep assertions and skip policy unchanged. This replaces only the concurrency arrangement, not coverage or the publication gate.

| Requirement | Primary tasks | Observable acceptance |
| --- | --- | --- |
| R0 | 0,1,5 | DB/OAuth-only serving/guards; frozen supported configuration corpus unchanged, E5 before real cutover; real lifecycle/no fallback; isolated tests; files/data untouched. |
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
- Environment-focused review: three independent source/test-only passes identified inert-key rejection, split defaults, dotenv/app order, unsafe test imports and E4 acceptance dependencies; Section1.1/E5 and Task0 address them. Two bounded follow-up passes corrected the preflight-versus-serving TTL distinction and isolated-checkout coverage for new source, frontend build output, dependency imports and browser-launched children. The actual private dotenv/process environment was not inspected. Fifteen synthetic AST checks of existing pure validation paths passed (12 preflight-supported local DB combinations, two existing hosted rejections, one unused-Basic-field check); these are existing-contract evidence, not a current-file or future-implementation attestation.
- UI wording decision, 2026-11-03: retain Select All, use Clear Selection, explain Team/filter/off-screen scope through tooltips and accessible descriptions, and show counts separately. This supersedes the earlier dynamic bulk labels in the exploratory preview. Preserve the existing table interface; only browser captures of real branch components are valid UI mockups. The isolated visual preview preserved column order and row height and measured a 173.4px docked panel bottom at 1440x900; it is not implementation acceptance and does not prove the other viewport or persistence gates.
- Second-pass findings on receipt ordering, synchronized admission proof, policy registration, real fixture controls, cross-document auth evidence and local dependency inspection are incorporated. Final changes receive root self-review; no third independent approval is claimed.

## 8. Execution ledger

Current execution state; earlier diagnostic inventories are retained in ignored scratch reports, not accepted as baseline exceptions.

| Slice | State and evidence |
| --- | --- |
| E0 baseline/runtime | `feature/331-shared-planning` starts from fetched `origin/main` at `13d63d43`; plan commit `d2ca37c4` contains no quarterly implementation. Python 3.13.18/OpenSSL 3.5.9 and Node 20 are available; dependencies and frontend build verified. No live application import or preflight ran. |
| E4 prerequisite | Resolved at source level. The operator approved the clean committed main-checkout head `45b19336`; merge `8470f0c3` integrates it without history rewrite or copying real configuration. Initial build, 92 isolated prerequisite checks and nine structure checks passed. |
| E2 disposable PostgreSQL | Operator approved an owned fresh cluster, then TCP-only startup after two Unix-socket path-length failures. Existing review concurrency: 32 passed without skips. OAuth callback/refresh module: 12 passed without skips, including its three PostgreSQL-only races. Task3 then passed 46 PostgreSQL cases without skips (14 new shared-plan cases plus 32 historical cases), including publication guard lifetime through real commit/rollback. The owned cluster and descriptor were removed after testing. |
| E5 installation boundary | No real dotenv, credentials/token/cache contents, live process-environment values or application database were inspected. Synthetic configuration compatibility, keyring/session restart and dotenv precedence passed. No actual installation cutover or live Microsoft Entra/Atlassian SSO acceptance is attested. |
| Task0 implementation | Runtime, consumer, launcher and positive-fixture retirement implemented. Shared defaults/aliases, DB-only request authority, guarded encrypted token loading, serving-key validation and hosted opt-in rejection are independently reviewed. Explicit artifact import/export remains; no automatic runtime JSON fallback. Four frontend compatibility owners retire Basic behavior; the guarded storage getter changes no selection rule or table geometry. |
| Task0 isolation | Source snapshot runner and pre-import guards use tracked working-tree source plus reviewed new files, synthetic environment and matching frontend build; no arbitrary untracked/private files. Driver guard accepts genuine psycopg adapter context while preserving target restrictions. This protects trusted fixtures from accidental I/O, not arbitrary hostile native programs. |
| Task0 backend/frontend | Full isolated discovery: 3,406 tests, OK with 62 skips, in 446.540s. Separate PostgreSQL results above cover required review and callback/refresh races; optional catalog/private-view gates are not claimed run. Auth/session/refresh/Home/dotenv/startup breadth: 196 passed. Frontend unit: 3,464 passed. Structure/instruction guards: 21 passed. |
| Task0 real browser lifecycle | Ten focused Chromium cases passed, including opaque sessions, actual encrypted tokens/CSRF, two-user private preferences, restart, refresh/logout/revocation/disabled/storage recovery and real HTTP quarterly promotion. Exact token, browser-session, private-view and view-history rows remain unchanged in the promotion case. Independent review found no actionable P1/P2 issue. Measurement/stream five focused cases also passed. |
| Task0 full browser gate | Complete: original 2,302-case inventory verified as 2,283 unique passes and 19 existing skips, with zero unresolved failures. Evidence is serial 65 passed, remaining partition 2,213 passed/19 skipped/five fixture failures, then both corrected entire specs 95 passed. Replacement IDs exactly match the affected original files; no app source changed or automatic retry ran. This is full verified coverage, not a claim that the original remaining-partition command exited cleanly. |
| Tasks1–8 | Tasks1–2 verified and independently approved. Task1 four real-browser checks pass plus genuine missing-v2 red; existing lifecycle ten passed. Task2 153 focused checks, 18 inclusion checks and 11 browser checks pass; independent review reran 18 inclusion and 30 migration checks. Task3 independently reviewed and verified: 96 final focused checks and 46 PostgreSQL cases passed; both real HTTP Legacy/promoted checks passed. The Board/observed-source publication race and rejected-body parsing findings were repaired with genuine red/green regressions. Task4 controller passed 165 focused checks. Task5 capsule/navigation and joint recovery ownership have focused independent verification; complete mounted-app expiry/reconnect acceptance remains pending. Task6 mocked UI integration passed 66 cases and focused geometry passed nine; Task7 details passed six component browser and 50 Node checks, with E3 real-app acceptance still pending and List retained. Task8 analytics passed 190 focused checks. Real application integration remains blocked by proposed Task0.1, not by the mocked UI fixtures. Pause/lost-ack browser branches await integration. Preserve the existing table and NULL Legacy namespace. |
| Frontend integration checkpoint (2026-11-04) | Final isolated Node 20 run: 3,561 passed, zero failures/skips; matching build passed. The previous 21 failures were resolved through guarded effect/label alignment, explicit already-installed parser dependency copying in the isolated harness, and bounded recovery-owner extraction. Dashboard remains below its unchanged size/hook ceilings. Independent review repaired a missing public ref; deferred restoration captures the original connection-record identity. Documentation union guards: 12 passed. These checks do not replace the pending real-app CSRF/concurrency and E3 browser acceptance. |
| Task3 catalog synchronization | Twenty isolated cache tests passed; independent review approved bounded publication locking, caller-owned budgeted reads and default-reader compatibility. Authentication and every save SQL execution share the request deadline. Latest 89 auth/CSRF/HTTP/namespace and 18 atomic rollback checks passed before the independent review repair. |
| Task0.1 design review (2026-11-06) | Three independent read-only reviews (security, functionality, reliability) each returned "sound with required changes"; every cited finding was rechecked in source. One review reran the regression through the runner's own synthetic preparation (frontend build check bypassed, no repository writes): 4 tests, one failure, 403 != 200. A SQLite demo showed `with_for_update()` ignored, so both transactions consumed the same token; the operator then retired SQLite. No source changed; Task0.1 records the revised design. |
| Analytics | Runtime retirement and isolated fixtures add no event; existing auth/recovery identities and transport remain. Taxonomy allowlist reason recorded. Task8 owns feature instrumentation. |
| Publication | The approved plan and prerequisite integration are committed. No #331 implementation commit yet; no push or PR performed. |

Browser failure evidence and approved remedy:

- First fresh full run stopped after 145 passes: the generic real-server beforeAll exceeded 30s before any lifecycle assertion. Quiet launcher readiness measured 16.574s; four simultaneous launchers measured 18.256–18.298s. A reviewed fixture-only change separates 90s launcher/120s setup budgets from unchanged 30s application tests and reports sanitized phase/elapsed diagnostics.
- Second full run stopped cleanly: 215 passed, two failed, four interrupted, six skipped and 2,075 not run. The launcher exceeded 90s during application import: snapshot 58.443s, pre-import guards 11.864s, migrations 7.860s. A read-only cleanup check observed unowned Playwright work in another checkout; no further inspection or termination. Contention is a possible cause, not a measured root cause. Owned browser scratch was cleaned up. Evidence: `tmp/planning-331-integration/chromium-final-setup-timeout-90s.log`.
- The separate Statistics failure was an obsolete empty-auth request ledger. Its explicit OAuth fixture now expects nine bootstrap GET additions exactly once; all nine mode multisets, ordered repeated queries and cached reopen passed in the focused 14.2s case. No request filtering, analytics suppression or production change. Evidence: `tmp/planning-331-integration/statistics-cold-contract-correction.md`.
- Root instructions required stopping after two failed attempts. The operator then explicitly approved the coverage partition above. Run that approach without another timeout increase or an assumption that the old full run passed.
- Approved partition evidence: six serial files/65 cases passed in 2.4m; 83 remaining files/2,237 cases completed in 21.7m. Inventory comparison proves disjoint/exhaustive coverage and no retries. Skips are nine opt-in runtime probes, one opt-in runtime-work campaign, one local visual capture, one opt-in DOM capture, five headed-only glyph cases and two pre-existing explicit EPM skeleton skips. Five failures have two fixture causes: an intended table-row selector also matched OAuth editors, and an admin-positive settings mock omitted explicit directory/tool-admin capabilities. Correct only those fixtures, retain every assertion and verify both entire affected specs; the unchanged application and other test bodies retain their full-run evidence. Final feature acceptance must still run its new full inventory.

Reproduce the full backend gate while the new files remain untracked:

```sh
.venv/bin/python tests/run_isolated_runtime_tests.py --node /path/to/node20 --include backend/auth/runtime_profile.py --include tests/db_oauth_test_helpers.py --include tests/test_db_oauth_test_helpers.py --include tests/test_runtime_profile.py --include tests/test_runtime_auth_cutover.py --include tests/test_runtime_consumer_cutover.py --include tests/test_isolated_runtime_runner.py -- discover -s tests -v
```

Earlier failing fixture inventories are superseded by the passing full backend/frontend and bounded checks above, not waived. Home write gate remains blocked and independent of this feature; no live probe or external mutation ran.

Task0 final coverage reconciliation: `tmp/planning-331-integration/chromium-approved-final-coverage.json`; both corrected full specs passed 95/95 in 3.0m, no skips or flaky cases. Owned browser scratch is cleaned up. Task1 implementation released; no commit or publication.

Task1 review approved real DB identity/CSRF, token-derived provider visibility, actual JQL/Team/Sprint filtering, persisted cross-user readback and idempotent restart, actual DOM feature journey, isolation and owned teardown. No production source changed. The four-green/one-red result is intentional before the new HTTP contract; it is not a passing v2 acceptance claim.
