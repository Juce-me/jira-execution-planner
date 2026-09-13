# Persistent Sprint And Per-Sprint Team Catalogs Implementation Plan

> **Status:** Fresh review 2026-09-13: requires the four execution-contract amendments below before implementation. Workspace-shared catalog ownership is confirmed and unchanged. Execution branch: `bugfix/board-progressive-loading`. Execution must preserve unrelated local work and replace, rather than stack on, the branch's temporary DB-mode `SPRINTS_PROCESS_CACHE` behavior.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve one shared Sprint catalog per workspace/Board and one shared Team snapshot per workspace/Sprint from PostgreSQL in under one second on cached reads, with Jira used only for a first cache fill, asynchronous Sprint refresh, or explicit Team refresh.

**Architecture:** Resolve workspace from the configured environment and authenticated Jira site/domain through the existing workspace identity. Add one workspace-and-Board Sprint catalog table and one workspace-and-Sprint Team snapshot table. Database leases coordinate refreshes across Flask processes. Sprint reads use stale-while-revalidate and the Jira Board Sprint endpoint only; Team reads use exact persisted snapshots, synchronously warm missing snapshots once, and replace them only after complete refreshes. Existing `workspace_team_catalogs` remains the durable Team ID-to-name directory.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy/Alembic, PostgreSQL, Jira REST, React 19, Node 20, Playwright, esbuild.

---

## Fresh Review And Execution Order — 2026-09-13

Three independent reviews checked catalog backend/runtime, catalog frontend/API integration, and selector readiness/order against current source. The previous implementation-ready assessment was premature. These are concrete implementation-contract gaps; none reopens workspace sharing.

1. **P1 — browser Sprint authority is not migrated.** `frontend/src/dashboardRuntime.js:4` restores a 24-hour browser catalog without workspace/Board identity; `frontend/src/dashboard.jsx:488` accepts it as ready. `loadSprints` at `:6666` rejects a validated empty response and at `:6696` retains old cached Sprints after an error. A Board change can therefore leave old Sprint choices authorizing ENG work while the new Team endpoint rejects them. Before execution, add an explicit browser catalog identity/invalidation and authoritative-empty task, include `dashboardRuntime.js` and `tests/test_dashboard_runtime.js` in the file map, and specify stale-generation handling. Tests must cover populated Board A → empty B, removed Board/409, delayed A after B, and same-identity transient-error retention. Saved Sprint labels may remain display-only; they must not authorize work without current-identity validation.
2. **P1 — asynchronous Sprint refresh has no completion consumer.** `loadSprints` at `frontend/src/dashboard.jsx:6664` consumes only `data.sprints`; `refreshActiveViewFromJira` at `:14378` makes one forced call. The proposed response returns the old list while a worker refreshes, but the open menu never consumes that result or failure. Before execution, specify bounded non-forced completion reads, cancellation by identity/auth/modal or document lifetime as appropriate, sanitized failure/exhaustion presentation, and tests proving a held worker's new catalog reaches the open menu without another manual force refresh. Amend the runtime polling restriction accordingly; include `frontend/src/api/engApi.js` if the chosen cancellation wiring changes its API.
3. **P1 — worker transport does not implement the declared deadline.** `jira_server.py:723` exposes `current_jira_request` with a final HTTP timeout, but does not propagate a cooperative budget into DB token resolution; `backend/auth/jira_auth.py:424` also lacks the budget when ensuring the OAuth token. Before execution, select and document the existing budget-aware `current_jira_get`/`current_jira_search` adapter with captured context, or explicitly map the necessary generic-adapter/auth changes. Add real-wrapper tests for expired tokens, refresh-lock contention and remaining-budget exhaustion. Do not claim that a final HTTP timeout bounds authentication or retries.
4. **P1 — publication fencing misses first configuration creation.** `backend/services/workspace_dashboard_config.py:79` supports a revision-zero legacy fallback with no configuration row; `:113` allows the first admin save to insert that row. Locking a missing config row cannot serialize the insert against catalog publication. Before execution, specify one common workspace-row/advisory transaction lock used by configuration creation/writes and catalog publication, and prove the fallback-fill/first-save race on PostgreSQL. Preserve fallback behavior without silently importing configuration. Also name the effective configuration resolver: `jira_server.py:1863` prioritizes environment `JQL_QUERY`, so checking only DB project fields is insufficient.

**P2 clarification:** Task 7 must explicitly remove the catalog-related branch of `saveBlockedReason` in `frontend/src/dashboard.jsx:2929`, in addition to fieldset disables; retain unrelated save/permission/validation gates. Its existing footer-save acceptance criteria still apply.

**Recommended order:** implement [the selector availability plan](EXEC-eng-board-scope-selector-availability.md) first, then this catalog plan after the four amendments. No additional demonstrated blocker was found in the selector's own scope: its proven no-op and keyboard problems occur with a valid existing catalog and do not depend on PostgreSQL persistence. The order is a risk/review recommendation, not a hard backend dependency or authorization to execute.

Execute dashboard integration sequentially. Both plans touch `frontend/src/dashboard.jsx`, `tests/ui/eng_group_board_view.spec.js`, generated frontend output, and shared documentation. Reconcile the current unpublished work before each plan. Catalog acceptance must rerun the selector's five-mode/readiness matrix with DB-shaped fresh/stale, pending/error, validated-empty, changed-Board and delayed-result responses. Preserve selected intent versus load authority and prevent ordinary fallback requests for blocked cross-sprint selection.

This fresh review ran source inspection, not implementation acceptance tests. The earlier 24-test result below remains baseline compatibility evidence only. Real PostgreSQL concurrency, UI red/green tests and authenticated acceptance remain execution checks.

## Readiness Review — 2026-09-13

**Resolved decision — workspace-shared catalogs.** On 2026-09-13 the user confirmed that workspace means the Jira identity/domain shared by the entity within the configured application environment. Sprint catalogs, per-Sprint Team membership, and the Team name directory are intentionally shared by all authenticated users in that workspace. Canonical identity is the existing server-resolved `RequestAuthContext.workspace_id`, backed by environment + Jira cloud/site identity. See [workspace ontology](../ontology.md#workspace-identity-and-shared-catalogs).

The schema keys below are approved: `(workspace_id, board_id)`, `(workspace_id, sprint_id)` with effective scope digest, and the existing workspace-only name directory. Do not add user IDs, OAuth connection IDs, token versions, or user project-access snapshots to catalog keys. User identity remains the refresh credential/audit actor; all same-workspace readers receive the saved catalog, including users other than the refresher. This deliberately replaces the DB-mode user-partitioned Sprint process cache and preserves other caches' existing authorization contracts.

Jira searches still reflect the refresh credential's upstream visibility; a complete successful fetch replaces the shared metadata under this approved policy. Completeness means validated pagination of the configured query, not proof of every user's possible issue visibility. This is not an unresolved sharing gate and does not add a service credential or per-user reconstruction of the saved catalog.

**P1 gaps corrected in this review:**

- `backend/services/workspace_dashboard_config.py:176` owns directory revisions in its own transaction. Tasks 1–2 must reuse a transaction-aware merge with compare-and-swap, so concurrent directory POSTs and two different Sprint fills cannot lose names or partially commit membership.
- `frontend/src/dashboard.jsx:2542` resolves missing names into both `availableTeams` and a whole-directory replacement. Task 6 must make that path names-only and submit only its delta with `merge: true`; otherwise it bypasses membership and can erase another refresh.
- `frontend/src/dashboard.jsx:2502` rejects empty results, and `frontend/src/settings/TeamGroupsSettings.jsx:315` disables the whole editor when catalogs are unavailable. Tasks 6–7 now distinguish validated empty membership from an unknown/error state and leave existing Team removal and unrelated editable group fields usable.
- Tasks 2–5 now specify lease fencing, configuration-change races, bounded admission, deadlines, malformed pagination, cold-fill contention and failed-fill backoff. Two executor workers alone do not bound a submission queue or prevent an expired worker committing late.
- Task 8 no longer supersedes `FUTURE-warm-team-catalog-team-names.md`: it covers cold ENG filter names outside Settings, which this plan does not implement.

**P2 gaps corrected:** mode-specific compatibility, exact error/cache shapes, in-flight frontend generation ownership, currently open Settings in another tab, PostgreSQL CI coverage, and complete file-map/test coverage.

**Review scope and evidence:** `.venv/bin/python -m unittest tests.test_sprint_service tests.test_team_catalog_api tests.test_cache_partitioning` passed 24 tests on 2026-09-13. These existing tests characterize compatibility only, not the proposed implementation. Documentation changes only; existing unpublished implementation remains untouched. All 27 original Modify paths exist and migration head `20260908_0015` exists. The checked-out baseline includes uncommitted Sprint process-cache work, so it is not equivalent to remote HEAD. The plan does not claim implemented behavior, PostgreSQL concurrency proof, or measured endpoint latency.

## Decisions And Constraints

- `GET /api/sprints` never waits on Jira when a validated row exists, regardless of age.
- In DB mode, Sprint discovery uses only `GET /rest/agile/1.0/board/{boardId}/sprint`; issue scanning is forbidden.
- A first-ever Sprint catalog miss may wait for one synchronous Jira fetch.
- Team availability is an exact selected-Sprint snapshot, not the global Team directory.
- A first-ever Team snapshot miss automatically fetches Jira once. Later changes require **Refresh teams** or a cache-identity change.
- A configured Team absent from the Sprint stays visible by latest-known name, is disabled for selection, and has `title="Not in the selected sprint"`.
- Its separate remove button stays enabled so stale configuration is not trapped.
- Jira names are preserved after trimming only; `[ARCHIVED] TEAM NAME` remains unchanged.
- Failed refreshes never overwrite the last validated payload.
- No Jira write, Home/Townsquare call, service credential, personal configuration, or new GA4 event is added.
- Basic/file-storage mode retains its local compatibility behavior, including legacy issue fallback and legacy Team route behavior. DB mode uses PostgreSQL as source of truth; the new Board-only prohibition applies to its discovery path.
- Local/dev OAuth without DB storage keeps its authorization-partitioned process cache and never reads or writes Basic file caches. Select storage by the existing storage/auth helpers; do not equate OAuth with DB mode.
- `validated_at is not None` establishes a valid payload, including `[]`. Truthiness or catalog length never determines whether a fill is needed.
- A successful Team search proves complete pagination of the refresher's visible, configured issue scope at fetch time; Jira does not provide a transactionally frozen workspace snapshot. The shared result follows the confirmed workspace ownership decision above.

## Storage Design

### Ownership And Identity

| Catalog | Canonical DB key | Shared by | User-specific data in the row |
| --- | --- | --- | --- |
| Sprint catalog | `(workspace_id, board_id)` | All authenticated users of that environment/Jira site | Nullable refresh audit actor only |
| Sprint Team membership | `(workspace_id, sprint_id)`; payload validated by `scope_digest` | All authenticated users of that environment/Jira site | Nullable refresh audit actor only |
| Team name directory | `workspace_id` | All authenticated users of that environment/Jira site | Existing nullable update audit actor only |

`workspace_id` already identifies environment + Jira cloud/site. Do not introduce another domain table, a user-owned workspace, or a new identity migration. Board and Sprint IDs come from that workspace's Jira configuration/catalog. The effective scope digest describes shared workspace configuration, never the requesting user's permitted-project subset, token, connection, selected Department, or private preferences. Lease keys and process-local admission/deduplication keys use these same shared catalog keys; refreshing as a different user must not create another refresh owner for the same catalog.

Authorization precedes cache access, but a validated hit requires no per-reader Jira lookup or filtering. The refresh actor's credentials authorize upstream I/O; that actor does not own the committed result. Signing out or revoking the actor does not delete a previously validated shared row. A refresh still in flight must stop publishing if its captured credentials are revoked; another eligible workspace user can refresh after lease release/expiry. No personal token is stored in either catalog.

### Payloads And Refresh Coordination

`workspace_sprint_catalogs` is unique on `(workspace_id, board_id)` and stores `sprints`, `validated_at`, `next_refresh_at`, `refresh_lease_owner`, `refresh_lease_until`, `last_failure_at`, audit user, and timestamps. A successful refresh sets `next_refresh_at` 24 hours ahead. Failure retains `sprints` and applies a five-minute retry delay.

`workspace_sprint_team_catalogs` is unique on `(workspace_id, sprint_id)` and stores `sprint_name`, `scope_digest`, `teams`, `validated_at`, refresh lease fields, `next_attempt_at`, `attempt_scope_digest`, `last_failure_at`, `last_failure_scope_digest`, audit user, and timestamps. `scope_digest` hashes a versioned canonical serialization of effective Board ID, sorted/deduplicated selected project keys, effective Team field ID, and the exact normalized membership base JQL without Sprint/Team clauses. Preserve quoted JQL literal content; never normalize it with blind case-folding or whitespace replacement. A mismatch is a cold miss; the old row remains until replacement succeeds but is not served as current membership.

The existing `workspace_team_catalogs` row remains the workspace name directory. A successful Team refresh atomically replaces Sprint membership and merges its resolved names into this directory. Name lookup may resolve names only for member IDs; it never grants Sprint membership. Default to saved directory names and then the ID itself, without an unconditional global Teams API scan.

Both new rows follow existing model conventions: UUID primary key, workspace FK with `ON DELETE CASCADE`, nullable audit user FK with `ON DELETE SET NULL`, JSON payload version 1, timezone-aware UTC timestamps, string positive-decimal Board/Sprint IDs, nullable `validated_at`, and indexes on lease deadlines. Enforce owner/until nullability as a pair. No import of process/file payloads into validated DB state: their completeness and provenance are not established.

Team retry/failure bookkeeping is tagged with the attempted scope digest separately from the validated payload digest. A failed B attempt must not mark an A snapshot as a failed refresh or prevent unrelated current scope C filling. Successful replacement clears matching failure metadata; cache reads derive `refreshFailed` only from matching identity.

A lease owner is a fresh unpredictable UUID for each attempt, never a process ID. Acquisition must not modify an existing validated payload's digest, Sprint name, or validation timestamp. Claim and commit transactions are short; never hold a row/advisory lock or open transaction over Jira I/O. Replace/release/failure updates check the exact key and owner; replacement also checks an unexpired lease and the captured effective configuration before committing. An expired or superseded worker can neither write payload/name changes nor clear a newer owner's lease.

For same-Sprint configuration A → B, the old A row remains tagged A while B refreshes. A caller with B must not receive A; competing callers wait only for their own matching identity. At commit, lock/check the authoritative workspace config revision and recompute relevant identity; discard the result if Board, projects, Team field or base JQL changed. Do not invalidate on unrelated preference/group changes. This check and catalog replacement must serialize with config writes, not be separate unlocked reads.

The directory merge must run in the **same SQLAlchemy session** as the membership replacement. Refactor the existing save service to expose a session-aware operation while retaining its public wrapper. Increment `WorkspaceTeamCatalog.config_revision`, merge only nonblank resolved-name deltas against the latest payload, preserve unrelated names/meta, and retry the entire transaction on revision/first-insert conflict (maximum three attempts). Use one lock order: authoritative config, Sprint membership, global directory. Do not nest `save_workspace_team_catalog()`'s existing session/commit inside the new transaction.

## Endpoint Contract Matrix

This matrix applies to DB mode. All identity comes from a verified `RequestAuthContext` and effective saved workspace configuration, never client workspace/site/Board IDs. Run the existing authenticated route guards on cache hits too, including disabled/revoked-user checks and required OAuth scopes. Existing non-DB compatibility branches keep their response behavior.

| Route | Policy and CSRF | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /api/sprints` | Existing `authenticated_read`; no GET CSRF token or requested-with requirement | Optional literal `refresh=true`; no body | `200 {sprints, cache:{backend,state,validatedAt,refreshStarted,refreshFailed}}` | `409 sprint_board_required`; sanitized auth `401`; cold `502 sprint_catalog_unavailable`; `503 catalog_refresh_pending` or `catalog_storage_unavailable` |
| `GET /api/teams` | Existing `authenticated_read`; no GET CSRF token or requested-with requirement | Required positive-decimal `sprint`; optional `all=true`, `teamIds`, `refresh=true`; no body | `200 {teams,sprintId,cache:{backend,state,validatedAt,refreshStarted,refreshFailed}}` | `400 sprint_required` / `invalid_sprint`; `409 sprint_board_required` / `team_scope_required` / `team_field_required` / `team_scope_unsupported`; `404 sprint_not_in_catalog`; sanitized auth `401`; cold `502 team_catalog_unavailable`; `503 sprint_catalog_pending` / `catalog_refresh_pending` / `catalog_storage_unavailable` |
| `GET /api/team-catalog` | Existing `authenticated_read`; no GET CSRF token | No body | Existing `{catalog,meta}` | Existing sanitized auth errors |
| `POST /api/team-catalog` | Existing authenticated `user_write`, no admin requirement; OAuth requires token-bound CSRF and `X-Requested-With: jira-execution-planner` | Existing `{catalog,meta,merge}`; no identity fields | Existing `{catalog,meta}` | `400 invalid_json` / `unsupported_team_catalog_field`; existing sanitized auth/CSRF errors; `409 team_catalog_conflict` |
| `GET /api/teams/resolve`, `GET /api/teams/all` | Existing authenticated read/name-resolution behavior | Existing queries | Existing shapes | Existing auth behavior; these paths must never write Sprint membership |

DB success envelopes include `cache.backend: "postgresql"`; legacy responses omit it. The frontend uses this explicit response capability to select atomic server-persistence behavior, never `authMode` alone. Team records are `{id: string, name: string}`; `sprintId` is the normalized string ID.

New non-auth errors have exactly `{"error":"<fixed_code>"}`; pending responses include `Retry-After: 1`. Use `Cache-Control: no-store` on catalog success and failure. `validatedAt` is an ISO-8601 UTC string, never the current read time; `refreshStarted` means this request successfully admitted a refresh; `refreshFailed` means a refresh for this identity failed and has not since succeeded. `cache.state` is `fresh`, `stale`, `refreshing`, or `refreshed`: no due refresh, due/backoff/failure, active lease, and completed synchronous fill respectively. Successful empty payloads return `200`, not an error. DB failures do not fall back to process or file state.

In DB mode `all=true` means all members of the selected Sprint inside the effective configured scope; it deliberately removes the existing global registry and no-Sprint fallback. Without `all=true`, preserve the `teamIds` filter by intersecting requested IDs with the canonical snapshot after retrieval; request filters never contaminate the saved snapshot. Inventory any template-specific callers at Task 0; if their JQL changes more than Team selection, keep them on an explicitly separate compatibility path instead of silently treating different queries as identical.

Validate Sprint membership against the current effective Board's persisted Sprint catalog. If that catalog has never been validated, return `503 sprint_catalog_pending`; the frontend loads `/api/sprints` first. Team reads only read the Board catalog; Sprint refresh scheduling belongs to `/api/sprints`, so a cached Team read has no upstream side effects. Unknown IDs return `404` only against a validated catalog. Preserve quarterly formatting and deterministic duplicate-by-name winner rules; test that the IDs offered to the client are exactly those accepted by Team validation.

A synchronous `AuthError` always wins over stale-data fallback and returns the existing sanitized `401` so global recovery locks the mounted document. Background auth failure cannot retroactively change an already-returned response: retain data, record sanitized failure, and let existing DB revocation/token guards reject subsequent requests where appropriate. No local recovery UI or automatic failed-request replay.

Errors, logs added by this change, and analytics must not include raw Jira response text, JQL, or account/workspace/Board/Sprint/Team identifiers. Domain IDs remain necessary in successful functional response payloads.

## State Machines

```text
Sprints:
validated + not due -> return DB
validated + due/refresh=true -> claim DB lease, enqueue refresh, return DB
missing + lease acquired -> fetch synchronously, validate, commit, return
missing + competing lease -> poll DB for matching validated row for at most 2 seconds
missing + backoff/timeout/full runtime -> sanitized 503; no duplicate Jira fill
failure -> preserve payload, clear lease, apply retry delay

Teams:
matching snapshot -> return DB
matching + refresh=true -> claim lease, fetch synchronously, replace, return
matching + competing refresh -> return DB with state=refreshing
missing/mismatched + lease acquired + retry due -> one synchronous automatic fill
missing/mismatched + competing lease -> poll for matching identity at most 2 seconds, else 503
missing/mismatched + failed-attempt backoff -> 502 without a new Jira call
failure + matching snapshot -> return old data with refreshFailed=true
failure + no matching snapshot -> sanitized 502; retain row with next_attempt_at 5 minutes ahead
auth failure -> sanitized 401, never stale success
```


## Runtime And User-State Contract

- Use a process-lifetime runtime initialized lazily after fork, with two workers and two total admitted background jobs (no waiting executor queue). Reserve a slot nonblocking, claim a DB lease, then submit; release the reservation and owner-checked lease on failed claim/submission/cancellation. Never instantiate a pool on every request or during module import/reloader parent startup.
- Cold synchronous fills and explicit synchronous Team refreshes must also consume bounded process admission. With no slot, cached callers get the old payload; cold callers get `503 catalog_refresh_pending`. Leases, not local sets, coordinate replicas. A process crash is recovered by lease expiry; no durable queue or automatic startup Jira warm is added.
- Use a 120-second lease, a 60-second cooperative fetch deadline, at most 100 Board pages / 10,000 raw Sprint records, and at most 100 Team search pages / 10,000 raw issues. At the cap without a verified last page, fail without replacing data. Limit each network call to the lesser of 15 seconds and remaining time; count OAuth retries against the same deadline. Do not claim hard termination of blocked Python threads. Expired-worker fencing prevents late persistence even if transport outlives the budget.
- Check `startAt` progress and `isLast` for Board pages; check boolean `isLast`, a new nonempty `nextPageToken` on each nonfinal enhanced-search page, and reject repeated tokens, malformed records, and non-200 pages. An empty nonfinal page is not completion. Accumulate only bounded Team IDs/names, not whole issues. Use the explicit-context Jira adapter with deadline-aware timeouts; do not assume `jira_search_request(payload)` currently accepts a timeout.
- A refresh failure sets a five-minute retry delay. Ordinary reads honor it, including cold failures. Explicit refresh may bypass the delay but never an active lease or runtime admission. Fresh reads never extend `validated_at` or `next_refresh_at`.
- DB lease acquisition on a stale-hit request must be nonblocking/bounded so another transaction cannot consume the one-second response budget. Test real DB lock contention as well as a held Jira response. Include auth/config lookup and any Team-field resolution in cached endpoint timing; a seeded hit must not perform hidden Jira discovery.
- Snapshot the verified auth context, effective Board, configuration revision, projects, field ID, and JQL on the request thread. Background code calls `current_jira_request(..., context=captured_context)` and session-scoped DB functions, never mutable request globals. A fresh DB check rejects disabled/revoked credentials before upstream use and before publication of the result.
- Settings membership state is `unknown`, `loading`, `ready` (possibly empty), `refreshing` (last matching snapshot), or `error`. Only `ready`/`refreshing` for the exact current identity may enable adding a Team. Failed/missing data must not label every configured Team “Not in the selected sprint”; absence is established only by validated membership.
- Show the selected Sprint name beside Team availability/Refresh teams. On Sprint or effective configuration change, invalidate the membership generation immediately, preserve directory names and unsaved group edits, and fetch the new identity only after Sprint validation. The generation includes modal incarnation and Sprint/config identity. Guard **all** success, error, readiness, in-flight-map cleanup and `finally` writes; an old request cannot clear a new spinner or overwrite a new result.
- A matching snapshot refresh keeps existing membership usable until its atomic replacement arrives. `200` with `refreshFailed: true` retains data and shows fixed retry copy; `refreshing` from a competing lease uses bounded rechecks (maximum five, one second apart), then leaves an explicit reload action. Stop rechecks on close, identity change, or auth lock. Empty successful membership is ready and disables additions, while configured chips remain named/removable.
- Refresh changes derived catalog state only: never mutate `groupDraft`, reset dirty state, auto-save groups, alter `baseRevision`, or change a user's favorite. Preserve footer Save of all dirty editable sections and existing `409 group_config_conflict` recovery. Unavailable/empty membership must not block removing a Team, editing components/labels/exclusions, saving empty `teamIds`, or completing the existing component-only group workflow.
- Sharing persistence does not mean pushing live UI updates: no new SSE, continuous polling loop, or workspace event is added; the bounded competing-refresh rechecks above are the only new polling. Another open Settings instance sees a replacement on its next membership read/reopen/explicit action; it preserves its unsaved draft. Do not promise instant cross-user UI synchronization.

## File Map

Create:

- `backend/db/migrations/versions/20260913_0016_workspace_sprint_team_catalogs.py`
- `backend/services/workspace_catalog_cache.py`
- `backend/services/catalog_refresh_runtime.py`
- `backend/services/sprint_teams.py`
- `frontend/src/settings/teamAvailability.js`
- `tests/test_workspace_catalog_cache.py`
- `tests/test_sprint_team_service.py`
- `tests/test_team_availability.js`
- `tests/test_catalog_refresh_runtime.py`
- `tests/test_persistent_catalog_routes.py`
- `tests/test_workspace_catalog_postgresql.py`

Modify:

- `backend/services/workspace_dashboard_config.py`, `backend/config/db_repository.py`
- `backend/db/models.py`, `backend/services/sprints.py`, `backend/routes/settings_routes.py`, `backend/routes/eng_routes.py`, `jira_server.py`
- `frontend/src/api/jiraCatalogApi.js`, `frontend/src/dashboard.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/styles/settings/team-selector.css`
- `tests/test_db_migrations.py`, `tests/test_sprint_service.py`, `tests/test_oauth_stats_routes.py`, `tests/test_cache_partitioning.py`, `tests/test_team_catalog_api.py`, `tests/test_request_performance.py`, `tests/test_frontend_api_source_guards.js`
- `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`, `tests/ui/eng_group_board_view.spec.js`
- `tests/test_codebase_structure_budgets.py`, `tests/test_postgresql_runner_contract.py`, `runners/github/run-postgresql-tests.sh`
- `backend/security/CONFIGURATION_OWNERSHIP.md`, `docs/ontology.md`, `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`, `README.md`
- `docs/plans/EXEC-persistent-sprint-team-catalogs.md`, `docs/plans/README.md`
- generated `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`

---

### Task 0: Reconcile The Existing Branch

- [x] Record the user-confirmed workspace sharing decision and align schema keys, directory merging, invalidation rules, ontology, and two-user acceptance criteria. No user partition is added to these catalogs.
- [ ] Verify every file marked Modify exists before editing. Recheck the actual Alembic head; do not create a competing `0016` if another slice has advanced it.
- [ ] Run `git status --short --branch` and inspect the complete diff for Sprint service, routes, globals, and tests.
- [ ] Trace every `/api/sprints`, `/api/teams`, `/api/teams/resolve`, `/api/teams/all`, `fetch_sprints_from_jira`, `SPRINTS_PROCESS_CACHE`, `loadTeamCatalog`, `resolveMissingTeamNames`, and `setAvailableTeams` caller/guard; record each as migrated or compatibility-only.
- [ ] Record the branch baseline. Preserve the current unpublished ENG work; replace only the process-cache lines superseded by this plan.
- [ ] Stop if overlapping edits cannot be attributed safely.

### Task 1: Add Both Database Tables

**Files:** migration, `backend/db/models.py`, `tests/test_db_migrations.py`.

- [ ] Add failing schema tests for both tables, listed columns, foreign keys, lease indexes, unique constraints, migration head, and downgrade.
- [ ] Run `.venv/bin/python -m unittest tests.test_db_migrations`; expect failure because revision `20260913_0016` is absent.
- [ ] Add `WorkspaceSprintCatalog` and `WorkspaceSprintTeamCatalog` plus the Alembic revision with `down_revision = '20260908_0015'`.
- [ ] Run `.venv/bin/python -m unittest tests.test_db_migrations`; expect pass.
- [ ] Keep this slice uncommitted until the root publication transaction is authorized; no task-local commit instruction overrides its complete-history checks.

### Task 2: Implement Snapshots And Cross-Process Leases

**Files:** create `backend/services/workspace_catalog_cache.py`, `tests/test_workspace_catalog_cache.py`, and `tests/test_workspace_catalog_postgresql.py`; modify `backend/services/workspace_dashboard_config.py`, `backend/config/db_repository.py`, and the PostgreSQL runner/contract test.

- [ ] Write failing tests for two-workspace isolation, load/replace, wrong-owner rejection, unexpired and expired leases, failure retention, concurrent first insert, scope mismatch, and atomic Sprint-Team/global-name commit. Include cross-Sprint simultaneous name merges, concurrent existing POST merge, rollback after the membership write, stale owner after lease expiry, config A → B during I/O, and explicit empty payload persistence.
- [ ] Add `test_same_workspace_users_share_catalog_and_lease`: two contexts with the same workspace but different users, connections, token versions and project-access snapshots load the same row; simultaneous claims yield one winner. Changing only those user fields leaves the Team scope digest unchanged.
- [ ] Add `test_catalogs_isolate_site_and_environment`: use identical Board/Sprint IDs in different Jira sites, and the same Jira site in two environments; each resolves to a separate workspace row and independent lease. Neither reads nor refreshes cross those boundaries.
- [ ] Run `.venv/bin/python -m unittest tests.test_workspace_catalog_cache`; expect import failure.
- [ ] Implement immutable snapshots and these exact boundaries:

```python
build_team_scope_digest(*, board_id, projects, team_field_id, base_jql, payload_version=1) -> str
load_sprint_catalog(context, *, board_id, database_url=None)
claim_sprint_refresh(context, *, board_id, owner, now, lease_seconds, database_url=None) -> bool
replace_sprint_catalog(context, *, board_id, owner, sprints, validated_at, expected_config_revision, now, database_url=None)
record_sprint_refresh_failure(context, *, board_id, owner, retry_at, database_url=None)
release_sprint_refresh(context, *, board_id, owner, database_url=None)
load_sprint_team_catalog(context, *, sprint_id, scope_digest, database_url=None)
claim_sprint_team_refresh(context, *, sprint_id, sprint_name, scope_digest, owner, now, lease_seconds, database_url=None) -> bool
replace_sprint_team_catalog(context, *, sprint_id, sprint_name, scope_digest, owner, teams, validated_at, expected_config_revision, now, database_url=None)
record_sprint_team_refresh_failure(context, *, sprint_id, scope_digest, owner, retry_at, database_url=None)
release_sprint_team_refresh(context, *, sprint_id, owner, database_url=None)
```

- [ ] Use conditional owner-checked updates. Serialize first-row creation with a stable PostgreSQL advisory transaction lock; SQLite tests do not claim PostgreSQL concurrency proof.
- [ ] Include captured configuration identity and expiry checks in the replace operations above; if only an unrelated config field changed, compare the effective catalog identity rather than rejecting on revision alone. Pass the same session to the directory merge helper.
- [ ] Create `tests.test_workspace_catalog_postgresql` using the existing `TEST_DATABASE_URL` test database pattern and two independent connections/processes. Require PostgreSQL when `REQUIRE_POSTGRES_CATALOG_CONCURRENCY=1`; fail rather than skip or use SQLite. Synthetic isolated fixtures only; never run against the application's persistent database.
- [ ] Add that module and required flag to `runners/github/run-postgresql-tests.sh` and its source-contract test. Run `.venv/bin/python -m unittest tests.test_workspace_catalog_cache tests.test_workspace_catalog_postgresql` against an explicitly configured disposable test DB; missing PostgreSQL is an outstanding verification gate, not proof of concurrency. Expect one winner for a shared key and independent winners across workspaces.

### Task 3: Make Sprint Discovery Board-Only

**Files:** `backend/services/sprints.py`, `jira_server.py`, `tests/test_sprint_service.py`.

- [ ] Keep Basic/file-storage issue-fallback tests, and add DB-path tests for Board pagination, foreign-origin filtering, quarterly formatting, deterministic duplicate handling, and malformed/non-200 page failures.
- [ ] Patch `jira_search_request` to raise in every DB Sprint discovery test; keep non-DB fallback coverage separate.
- [ ] Run `.venv/bin/python -m unittest tests.test_sprint_service`; expect old fallback behavior to fail.
- [ ] Implement:

```python
fetch_board_sprints(*, board_id, jira_get, auth_error_class, deadline, monotonic_fn,
                    log_info_fn=None, log_warning_fn=None) -> list[dict]
```

- [ ] Require a Board ID, validate pagination progress and response shapes, and raise `SprintCatalogFetchError` on incomplete results. Remove `_collect_sprints_by_jql` from DB production use; retain the legacy helper only behind the explicitly tested compatibility branch. Accept a validated empty Board result, preserve quarterly shaping, and use state priority then numeric ID as a stable duplicate-name tie-breaker.
- [ ] Re-run `tests.test_sprint_service`; expect pass and zero enhanced-search calls on the DB path.

### Task 4: Add PostgreSQL Stale-While-Revalidate For Sprints

**Files:** create `backend/services/catalog_refresh_runtime.py`, `tests/test_catalog_refresh_runtime.py`, `tests/test_persistent_catalog_routes.py`; modify Sprint route/globals and route/cache/performance tests.

- [ ] Seed a DB row, patch request-thread Jira access to raise, and assert fresh, due, and explicit-refresh reads return saved data.
- [ ] Hold the background fetch behind an event and assert the HTTP response completes first with `cache.state == 'refreshing'`.
- [ ] Add `test_cached_catalog_survives_refresh_actor_revocation`: fill as user A, revoke A through the existing auth path, assert A's next request is rejected and user B in the same workspace still receives the saved row with zero Jira calls. Separately prove an uncommitted A refresh cannot publish after revocation.
- [ ] Add `test_same_workspace_second_user_reuses_validated_sprints`: fill through user A's real DB-auth route, then read as user B with Jira patched to fail; assert identical Sprint payload and `validatedAt`, one stored row, and no second fill.
- [ ] Test first-fill success, missing Board, OAuth failure, malformed pagination, upstream failure, competing process leases, and five-minute failure backoff.
- [ ] In the new DB-backed route test module, use actual DB OAuth fixtures and verified contexts; existing `tests.test_oauth_stats_routes` clears DB configuration and cannot alone prove this path. Test disabled user/revoked connection/cache hit, missing scopes, CSRF and requested-with failures on directory POST, and non-admin access. Patch `oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock`, `fetch_teams_from_jira_api`, and Basic credential resolution to fail on the DB path; reach the real Jira wrapper with only HTTP mocked.
- [ ] Add a no-request-context test proving workers call `current_jira_request(..., context=captured_context)` and never Flask `request`, `session`, or `g`.
- [ ] Implement the Runtime Contract exactly: bounded nonblocking admission, post-fork lifetime, owner cleanup on rejected submission/shutdown, deadline/lease fencing, and no request-thread Jira on seeded hits. Test queue saturation, process crash/expired lease recovery, stale worker completion and real DB lock contention. A submitted-key set is only an optimization.
- [ ] Remove `SPRINTS_PROCESS_CACHE` from DB-mode authority; retain file caching only for Basic/local compatibility and the partitioned process cache for allowed non-DB OAuth. Update invalidation tests: logout, connection revoke, token refresh/version bump and user disable must not delete shared catalog rows; the affected user still fails existing auth guards. Board/project/Team-field/base-JQL changes use the workspace catalog identity rules. Never clear other workspaces or alter unrelated issue-cache partitions.
- [ ] With Jira held, assert a seeded `/api/sprints` request takes less than `1.0` second and includes DB-only `Server-Timing`.
- [ ] Run `.venv/bin/python -m unittest tests.test_sprint_service tests.test_oauth_stats_routes tests.test_cache_partitioning tests.test_request_performance`; expect pass.

### Task 5: Add Exact Per-Sprint Team Persistence

**Files:** create `backend/services/sprint_teams.py` and tests; modify Team route/globals/catalog tests.

- [ ] Write enhanced-search pagination tests using `nextPageToken`/`isLast`, mixed Team values, duplicate IDs, empty complete results, `[ARCHIVED]` names, and incomplete-page rejection.
- [ ] Assert `fetch_teams_from_jira_api` is never called to establish membership.
- [ ] Implement:

```python
fetch_sprint_teams(*, sprint_id, base_jql, team_field_id,
                   jira_search_request, build_team_value,
                   extract_team_name, deadline, monotonic_fn) -> list[dict]
```

- [ ] Validate Sprint IDs as positive decimals before JQL interpolation. Resolve membership scope once from effective saved configuration, independent of active Department/team filters or private EPM scope. Require the configured Team field before cache identity/fill; missing field is `409 team_field_required`, not an empty Team list. A cached read uses saved field configuration or already-validated field metadata without Jira discovery.
- [ ] Query the normalized configured base plus the selected Sprint and only the Team field. Existing `strip_sprint_clause`/`remove_team_filter_from_jql` are regex helpers, not general JQL parsers. Test leading/trailing clauses, quoted values, `ORDER BY`, nested OR, and residual numeric/custom-field Team or Sprint predicates. Preserve unrelated predicates and exact literals; if the base cannot be safely reduced, return `409 team_scope_unsupported` before search, never broaden to all workspace issues. Missing scope is `409 team_scope_required`.
- [ ] Normalize dict/scalar/list Team representations; retain valid IDs even when the issue has no name. Use nonblank issue name, latest directory name, then ID fallback; fallback IDs must not overwrite a real directory name. For duplicate IDs resolve deterministic nonblank names, trim only, and sort case-insensitively with ID tie-breaker. Null Team fields are nonmembers; malformed nonnull fields fail the complete refresh instead of silently erasing membership.
- [ ] Add route tests: cached read has zero Jira calls; first miss auto-fills; explicit refresh replaces one Sprint; failure retains old data; cold failure is sanitized; two users share; workspaces isolate; scope mismatch refills; global-only Teams do not become members.
- [ ] Add `test_team_refresh_is_visible_to_other_workspace_users`: fill as A, read as B without Jira, refresh as B, then read as A; both observe the same replaced membership and merged directory names on the next read. A failed refresh keeps the same prior shared result for both. Test successful empty replacement as a shared result too.
- [ ] Preserve the `all=true` request form with the intentional DB semantics in the endpoint matrix; validate the Sprint against the workspace Sprint catalog, and merge names into `workspace_team_catalogs` only after complete pagination.
- [ ] Run `.venv/bin/python -m unittest tests.test_sprint_team_service tests.test_team_catalog_api tests.test_workspace_catalog_cache`; expect pass.

### Task 6: Separate Frontend Names From Membership

**Files:** create `frontend/src/settings/teamAvailability.js` and Node tests; modify API helper, dashboard, and source guards.

- [ ] Write a failing pure test where the directory contains `ACTIVE TEAM` and `[ARCHIVED] OLD TEAM`, but Sprint membership contains only `ACTIVE TEAM`.
- [ ] With `membershipReady: false`, return `availableInSprint: null` and disable additions without asserting absence. With validated membership, assert both names remain, the active Team has `availableInSprint: true`, the archived Team has `false`, and an unknown configured ID uses its ID only as final fallback.
- [ ] Implement:

```js
buildTeamAvailability({ directory, sprintTeams, configuredTeamIds, membershipReady })
```

- [ ] Change `fetchAllTeams` to use `URLSearchParams` and accept `{sprint, refresh = false}`. Only the button sends `refresh=true`; it must not reuse an ordinary read promise as if refresh completed. If a read for the same identity is in flight, disable the button until it settles or schedule exactly one explicit refresh afterward.
- [ ] On Settings open, load both workspace-shared global names and selected-Sprint membership. A browser user/session change must discard local request generations and reload under the new verified context, while server rows remain workspace-owned. Never treat a non-empty global directory as membership readiness.
- [ ] Detect `cache.backend === "postgresql"` on the Team response for server-persisted snapshots. Legacy replies retain the compatibility client save; do not silently assume every OAuth reply is DB-backed.
- [ ] In DB mode remove the client POST of merged names after Team refresh; the server has already committed both records atomically. Retain the existing compatibility save in non-DB mode. The separate missing-name resolution flow submits only resolved-name deltas with `merge: true` and never mutates membership/`availableInSprint`; it must not submit an old whole-directory snapshot with `merge: false`.
- [ ] Apply the full Runtime And User-State Contract: validated empty success, fixed errors, `refreshFailed` handling, scope/config/modal generations, and guarded cleanup. Do not merge old Sprint members into new membership. Directory load failure must not prevent membership loading or existing group edits.
- [ ] Keep membership/name precedence separate: cache hits join saved directory names so a later name resolution can update labels without refreshing membership. If concurrent directory GET and Team fill race, a stale GET may not overwrite newer known names; re-read directory after the server-committed fill where needed.
- [ ] Test close/reopen, A → B → A with out-of-order success and failure, stale `finally`, empty success, cold error, competing refresh, failed refresh, dirty group preservation, and terminal auth recovery. Preserve the separate ENG name-warm scope; this plan does not add a dashboard-wide warm effect.
- [ ] Run `node --test tests/test_team_availability.js tests/test_frontend_api_source_guards.js`; expect pass.

### Task 7: Render Unavailable Teams As Disabled Elements

**Files:** Team Settings component/CSS/dashboard and both Settings Playwright specs.

- [ ] Add failing assertions that an absent Team is a native disabled button, shows its global name, and has `title="Not in the selected sprint"`.
- [ ] Assert click and Enter cannot add it. Assert the noninteractive name region of an already-configured unavailable chip has the title/disabled presentation while its sibling **Remove team** button remains enabled. Do not set `aria-disabled="true"` on an ancestor of that enabled button, because the state would also describe its interactive descendants as disabled.
- [ ] Remove catalog-readiness/loading disables from whole editable fieldsets; gate Team additions only. Prove name/components/labels/exclusions edits, removal, footer Save and empty-Team group save still work during cold failure or refresh.
- [ ] Replace clickable result `div` elements with `<button type="button">`; keyboard navigation considers enabled results only.
- [ ] Apply muted disabled styling without changing chip size, layout, or selected-state colors.
- [ ] Run both complete specs:

```bash
npx --no-install playwright test tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js --workers=1
```

- [ ] Capture settled screenshots with animations disabled and inspect legibility, tooltip coverage, disabled distinction, and the remove control.

### Task 8: Update Contracts And Preserve The Separate Warm Plan

**Files:** ownership, ontology, ENG workflow, analytics, README, this plan/index, generated frontend.

- [ ] Document workspace as environment + Jira site/domain and all three shared catalog ownership keys; distinguish actor authentication from data ownership. Document Board-only Sprint discovery, stale-while-revalidate, Team cold fill, explicit refresh, failure retention, and global-name fallback.
- [ ] Keep `FUTURE-warm-team-catalog-team-names.md` deferred and unchanged: its cold ENG filter-name behavior is not implemented by opening Settings. Note this non-overlap in the plan index. Do not claim supersession without implementing and testing its separate acceptance criteria.
- [ ] Add a `2026-09-13` no-event allowlist row. Cache reads/fills/refreshes and disabled presentation emit no new GA4 event or identifiers.
- [ ] Run `npm run build`; expect generated bundle and source map updates only.
- [ ] Run `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`; extract new orchestration into the mapped service/helper files and update only documented exact budgets where necessary.
- [ ] Verify ontology paths and all new symbols resolve with `rg`.

### Task 9: Verify End To End

- [ ] Run focused verification:

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_workspace_catalog_cache tests.test_sprint_service tests.test_sprint_team_service tests.test_oauth_stats_routes tests.test_cache_partitioning tests.test_team_catalog_api tests.test_request_performance tests.test_catalog_refresh_runtime tests.test_persistent_catalog_routes tests.test_codebase_structure_budgets tests.test_postgresql_runner_contract
node --test tests/test_team_availability.js tests/test_frontend_api_source_guards.js
npx --no-install playwright test tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js --workers=1
```

- [ ] Run full verification: `npm run test:frontend:unit`, `.venv/bin/python -m unittest discover -s tests`, then `npm run build`.
- [ ] Run `.venv/bin/python scripts/check_startup_preflight.py`, start `.venv/bin/python jira_server.py`, and verify `curl -fsS http://localhost:5050/api/test`. Treat pre-banner runtime warnings as failure.
- [ ] Run the new PostgreSQL concurrency module with its required flag and a disposable configured test database; no skipped concurrency case qualifies as acceptance.
- [ ] Exercise seeded ordinary Sprint loading and all five ENG modes in `tests/ui/eng_group_board_view.spec.js`, including empty/error Sprint catalogs and Board/config changes. Keep the separate selector plan's ownership intact.
- [ ] With validated rows, collect five local timings for both cached endpoints. Each must be below one second with zero Jira calls. Never commit real Sprint or Team data.
- [ ] Run `git diff --check` and inspect every changed line against this plan.

## Acceptance Criteria

- Cached ordinary `/api/sprints` and `/api/teams` complete below one second with zero Jira calls. Due/explicit Sprint reads may start Jira work in another worker but never wait for it; explicit Team refresh and cold fills are excluded from the cached latency assertion.
- Due and explicit Sprint refreshes return last-known data immediately and run once across competing processes.
- Only an unvalidated Sprint identity fills synchronously; DB-mode Sprint discovery never scans issues. Retries after failed first fills honor backoff; an empty validated catalog is not a miss.
- A selected Sprint's Teams are shared from PostgreSQL after one automatic first fill per workspace/Sprint/effective configuration, not once per user or browser session.
- Any authenticated user can refresh that snapshot; all users resolved to the same environment/Jira-site workspace see it, while different sites or environments cannot. Different users, connections and token versions reuse the same validated row without new Jira calls. User-specific auth invalidation does not delete it; revoked/disabled users still cannot read it.
- Failed refreshes retain the last validated payload.
- An absent configured Team is named, disabled with the agreed hover text, and still removable.
- `[ARCHIVED]` names remain unchanged.
- Basic compatibility, auth recovery, shared permissions, initial dashboard loading, ENG Sprint selection, and group saves do not regress.

## Plan Self-Review

- Review corrections map to Tasks 0–9. Workspace sharing is confirmed and propagated to the ontology, schema keys, cache invalidation and two-user tests. The later fresh review above supersedes the readiness conclusion: its four amendments must be integrated before execution. PostgreSQL concurrency, UI behavior and latency remain implementation acceptance checks.
- DB mode retires process memory as Sprint authority; the global Team catalog remains names-only.
- Cache identity and authorization come from `RequestAuthContext`, never browser-supplied workspace/site identity.
- Background work carries captured OAuth/DB context and database leases are the cross-process authority.
- Cold, cached, stale, failure, concurrency, scope-switch, keyboard, and UI states have concrete tests.
- The migration adds derived shared state only; it does not move private configuration.
