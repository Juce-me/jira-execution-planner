# Persistent Sprint And Per-Sprint Team Catalogs Implementation Plan

> **Status:** Implementation-ready after the 2026-09-14 contract amendment; not implemented. Workspace-shared ownership is confirmed and unchanged. Execute on `bugfix/board-progressive-loading`, preserving unrelated work and replacing only DB-mode `SPRINTS_PROCESS_CACHE` authority. See amendment evidence and acceptance gates below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve one shared Sprint catalog per workspace/Board and one shared Team snapshot per workspace/Sprint from PostgreSQL in under one second on cached reads, with Jira used only for a first cache fill, asynchronous Sprint refresh, or explicit Team refresh.

**Architecture:** Resolve workspace from the configured environment and authenticated Jira site/domain through the existing workspace identity. Add one workspace-and-Board Sprint catalog table and one workspace-and-Sprint Team snapshot table. Database leases coordinate refreshes across Flask processes. Sprint reads use stale-while-revalidate and the Jira Board Sprint endpoint only; Team reads use exact persisted snapshots, synchronously warm missing snapshots once, and replace them only after complete refreshes. Existing `workspace_team_catalogs` remains the durable Team ID-to-name directory.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy/Alembic, PostgreSQL, Jira REST, React 19, Node 20, Playwright, esbuild.

---

## Amendment Review And Execution Status — 2026-09-14

**Status: implementation-ready contract; implementation and acceptance are not performed.** The four 2026-09-13 P1 findings are closed by the contracts and tasks below. No unresolved execution decision remains. Real PostgreSQL races, new red/green tests, authenticated read-only browser acceptance and latency measurements are mandatory implementation acceptance, not evidence supplied by this documentation amendment.

Baseline after `git fetch origin bugfix/board-progressive-loading`:

- Branch: `bugfix/board-progressive-loading`; initial worktree clean.
- Local HEAD: `d9da7bf788c68fbe2eb374a1d4af2a6ba5ac083b`.
- `origin/bugfix/board-progressive-loading`: `d9da7bf788c68fbe2eb374a1d4af2a6ba5ac083b`.
- Selector implementation is already merged as `22c5d677056d16a65afa8fd17a00d9808b417971`; [the completed selector plan](DONE-eng-board-scope-selector-availability.md) is historical evidence, not another implementation prerequisite. Current symbols below replace the obsolete dashboard line numbers from 2026-09-13.
- This amendment changes only this plan, its index and relevant ontology entries. The final user instruction authorizes a local documentation commit; it does not authorize catalog implementation, another worktree, push, PR, or an execution handoff.
- User explicitly excluded the gate sweep for this task. No `GATE-*` document or Home mutation probe is opened, run, or updated; the blocked Home-write gate is not claimed passed. Upstream instruction-template version could not be retrieved (web cache miss, then DNS failure); local template remains 2026-09-08 and is unchanged.

| Closed gap | Current evidence at baseline | Binding amendment |
| --- | --- | --- |
| Browser-restored Sprint authority | `dashboardRuntime.js:4` `loadCachedSprintCatalog`; `dashboard.jsx:496` initialization, `:5675` `sprintCatalogReady`, `:7044` `loadSprints`, empty rejection `:7060`, error retention `:7090` | Browser Authority contract; Task 6a; identity/empty/generation tests |
| No asynchronous refresh consumer | `dashboard.jsx:14832` `refreshActiveViewFromJira`; `api/engApi.js:19` `fetchSprints` only makes one request | Endpoint envelopes, Completion Protocol, Tasks 4 and 6a; held-worker browser proof |
| Final HTTP timeout is not a refresh budget | `jira_server.py:691/718/723` read/search/generic wrappers; `backend/auth/jira_auth.py:424` generic wrapper omits cooperative budget | Budget And Credential Contract; Tasks 3–5; real-wrapper and PostgreSQL auth-lock tests |
| Missing-row configuration race | `workspace_dashboard_config.py:79/99` fallback/read/write; `jira_server.py:1863` environment query precedence | Effective Configuration And Fence; Task 2; deterministic first-insert races |

Additional findings closed in this amendment, in severity order:

- **P1:** `shared_capacity_config.py:160` and `scripts/promote_legacy_shared_admin_config.py:57` also create administrator rows; both join the common fence. A capacity-only first insert stops fallback resolution and can change catalog identity.
- **P1:** `db_tokens.db_oauth_session_data:393` does not itself revalidate the captured user's active status/bindings, and `db_context._status_for:40` caches status. Catalog workers use fresh actor validation before reads and publication, allowing legitimate token rotation.
- **P2:** remove only `dashboard.jsx:3087`'s catalog branch of `saveBlockedReason` and its unused dependency entries; retain every other save gate (Task 7).
- **P2:** old browser tests encode immediate restored authority and whole-editor catalog locks. Task 6a/7 replace those expectations explicitly. Generated CSS belongs in the implementation file map because Task 7 changes CSS.

### Settled workspace ownership

The user confirmed on 2026-09-13 that workspace means the shared Jira site/domain within the configured environment. Existing `RequestAuthContext.workspace_id` is canonical. Sprint keys are `(workspace_id, board_id)`, membership keys `(workspace_id, sprint_id)` with effective scope digest, and the name directory remains workspace-only. No user ID, OAuth connection, token version, project-access snapshot, Department, or private preference enters ownership, catalog identity/scope digests or lease/admission keys. Credentials authorize the refresher's read; they do not own the committed metadata. Two users in the same workspace intentionally see the same saved result. Do not reopen this decision.

Complete pagination means all results in the refresher's configured visible Jira query, not a transactionally frozen union of every user's upstream permissions. Auth revocation never deletes already-validated shared metadata. It does prevent an uncommitted revoked actor from publishing.

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

### Ownership and publication metadata

| Catalog | DB key | Payload identity |
| --- | --- | --- |
| `WorkspaceSprintCatalog` / `workspace_sprint_catalogs` | `(workspace_id, board_id)` | `sc1:` + SHA-256 of canonical JSON `[1,"sprints",workspace_id,board_id]` |
| `WorkspaceSprintTeamCatalog` / `workspace_sprint_team_catalogs` | `(workspace_id, sprint_id)` | `tc1:` + SHA-256 of canonical JSON `[1,"teams",workspace_id,sprint_id,scope_digest]` |
| Existing `WorkspaceTeamCatalog` / `workspace_team_catalogs` | `workspace_id` | Workspace-wide names only; no membership authority |

Canonical JSON uses UTF-8, `ensure_ascii=False`, `sort_keys=True`, `separators=(',', ':')`; IDs are normalized strings. Reject request IDs not matching `[1-9][0-9]*`; Board/Sprint IDs from numeric Jira JSON values normalize with `str(int(value))`, excluding booleans and nonpositive values. Do not treat empty strings as a default Board. Browser parameters never select a workspace, Board, field, or query. Catalog identity is a comparison token, not an authorization credential. No secret or credential-derived material enters it.

Both new tables have UUID primary key, workspace FK `ON DELETE CASCADE`, nullable `updated_by` user FK `ON DELETE SET NULL`, `payload_version=1`, UTC `created_at`/`updated_at`, nullable `validated_at`, and nullable UUID `catalog_version`. Sprint rows contain positive-decimal string `board_id`, JSON `sprints` (default `[]`), `next_refresh_at`. Membership rows contain positive-decimal string `sprint_id`, `sprint_name`, validated `scope_digest`, JSON `teams` (default `[]`).

Both store independent attempt bookkeeping: UUID `refresh_attempt_id`, `attempt_identity`, `attempt_config_digest`, UTC `attempt_deadline_at`, `refresh_status` (`idle|pending|completed|failed`), nullable allowlisted `failure_code` (`refresh_budget_exhausted|catalog_refresh_lock_timeout|oauth_refresh_timeout|jira_unavailable|catalog_incomplete|catalog_identity_changed|auth_required|catalog_runtime_unavailable`), nullable `last_failure_at`, `retry_at`, UUID `refresh_lease_owner`, UTC `refresh_lease_until`. Team attempts store exact column `attempt_scope_digest` separately from validated `scope_digest`; Sprint rows omit that column. `retry_at` is the sole failed-attempt retry time (no duplicate `next_attempt_at`). Add unique catalog keys, lease-deadline indexes and checks pairing owner/until and attempt-ID/deadline. Idle means all attempt fields are null; a validated payload requires nonnull `validated_at` and `catalog_version`. Payload length is never a validation flag.

Each admitted attempt gets a new unpredictable UUID used as both attempt ID and internal lease owner. Clearing the lease retains terminal attempt ID/status/deadline, so completion reads can recognize it. Every complete publication gets a new publication UUID, including an empty replacement. Failure never changes the last validated payload, identity, name, timestamp or version. A B attempt must not retag a stored A membership payload as B. Serve only matching validated payloads; keep mismatched rows internally until replacement succeeds.

Sprint success sets next refresh to validation time +24 hours. Team snapshots have no age-based automatic refresh. All failure/backoff is identity-specific: `retry_at = failure_at +300 seconds`; deadline-derived failure uses `attempt_deadline_at +300 seconds`. Forced reads may bypass backoff but never an active lease or admission limit. No process/file cache is imported into DB validation. Names merge only with fully validated Team membership, in the same SQLAlchemy transaction; valid `teams:[]` replaces membership without deleting directory names.

## Effective Configuration And Common Fence

### Canonical resolver

Create `backend/services/workspace_catalog_config.py` with:

```python
@dataclass(frozen=True)
class EffectiveCatalogConfig:
    workspace_id: str
    config_revision: int
    config_source: str                 # workspace_db | legacy_json | empty
    workspace_payload: dict            # defensive copy of that same resolved snapshot
    board_id: str
    projects: tuple[str, ...]
    team_field_id: str
    sprint_field_id: str               # normalization aliases only
    base_jql: str                      # exact normalized membership base
    config_digest: str                # relevant effective fields, not revision
    sprint_identity: str | None
    team_scope_error: str | None       # fixed 409 code; Sprint read still works

resolve_effective_catalog_config(session, context, *, runtime_inputs,
                                 fallback_loader, legacy_site_url) -> EffectiveCatalogConfig
normalize_catalog_base_jql(jql, *, team_field_id, sprint_field_id) -> str
build_team_scope_digest(*, board_id, projects, team_field_id, base_jql,
                        payload_version=1) -> str
```

Use a new session-aware `load_workspace_config_in_session(session, context, *, fallback_loader=None, legacy_site_url='')` in `workspace_dashboard_config.py`. Existing `load_workspace_config` delegates to it without changing its signature. Resolve in the caller's transaction with fresh reads (`populate_existing` or scalar projection); never call the `g`-memoized `jira_server.load_dashboard_config_snapshot:1727` during publication. Never refresh Jira fields to resolve a cached read. The DB `/api/config` branch builds both `sharedConfig` and `sprintCatalogSource` from this single resolver result (`workspace_payload`, revision and effective Board); never combine a memoized A payload with a separate B source lookup. Other bootstrap fields keep their current owners.

`jira_server.catalog_runtime_inputs()` is a new thin provider returning current startup values `JQL_QUERY`, `JIRA_BOARD_ID`, `TEAM_FIELD_DEFAULT`, `SPRINT_FIELD_DEFAULT`. Use the same provider at capture and publication, not a stale captured config object. Runtime environment/CLI inputs are immutable in a deployed process; all replicas of one configured environment must use the same inputs. Tests inject a changing provider for a held JQL change. This plan adds no environment editor, cross-process environment broadcast or legacy import.

Resolution is fixed:

1. Use the workspace DB row when present. Otherwise preserve `_fallback_snapshot:69`'s exact-site eligible normalized JSON fallback at revision zero; a read/lease claim/first-fill publication does **not** insert a configuration row. Only existing authorized configuration writes copy fallback or explicitly promote it under their current contracts.
2. Normalize selected project keys from strings or `{key,type}` records by trimming, sorting and deduplicating. Keep this full saved list in the scope digest even when environment JQL takes precedence. Types/private project-access snapshots do not enter it.
3. If a saved `board` section exists, its `boardId` wins, including explicit blank removal. Only an absent section uses `JIRA_BOARD_ID`, matching `get_board_config:1957`. Blank effective Board means no Sprint identity and `409 sprint_board_required`; malformed nonblank IDs are a configuration error with that same public code.
4. If `teamField` exists, use its trimmed `fieldId`; explicit blank produces `409 team_field_required` on Team reads. An absent section uses the existing `TEAM_FIELD_DEFAULT` as established runtime configuration, without metadata discovery. Sprint field aliases use saved `sprintField.fieldId`, otherwise `SPRINT_FIELD_DEFAULT`. This does not change legacy `get_team_field_id` fallback semantics outside DB catalogs.
5. Nonempty runtime `JQL_QUERY` wins over selected projects, exactly as `build_base_jql:1863` (CLI override `:6423`). Otherwise construct `project in ("P1", "P2") ORDER BY created DESC` using the sorted, escaped saved keys. No projects and no environment JQL means `team_scope_required`; no default Product/Tech or all-workspace fallback.
6. Normalize with the following bounded grammar, not the regex helpers `strip_sprint_clause:1572`, `remove_team_filter_from_jql:1600`, or `add_clause_to_jql:963`. Tokenize quoted strings/quoted field names with escapes and balanced parentheses; identify one top-level `ORDER BY` outside quotes, discard only that suffix. Remove outer parentheses enclosing the entire filter, split top-level `AND`, and strip only an entire simple Sprint/Team conjunct (`=`, `!=`, `IN`, `NOT IN`, `IS EMPTY`, `IS NOT EMPTY`, with scalar/list/function RHS). Recognize case-insensitive field-position `Sprint`, `Team`, `"Team[Team]"`, configured `customfield_N` and `cf[N]` aliases. Never match target words inside RHS literals. A remaining target predicate inside `OR`, `NOT`, nested expressions, an unbalanced token stream, unsupported target operator, or an empty remaining filter returns `team_scope_unsupported`. Entire unrelated OR expressions are retained verbatim and parenthesized; do not distribute/flatten them. Preserve every quoted literal and internal whitespace; trim outer clause whitespace only, wrap retained conjuncts in parentheses and join with exactly ` AND `. Maximum input 32,768 characters, depth 32; exceeding either returns `team_scope_unsupported`. Query output is `(<base_jql>) AND Sprint = <positive decimal id>`, without `ORDER BY`. This fixed conservative subset rejects unsafe reductions instead of broadening scope.
7. `scope_digest` is SHA-256 of canonical `[1,board_id,list(projects),team_field_id,base_jql]`. `config_digest` is SHA-256 of canonical `[1,board_id,list(projects),team_field_id,base_jql,team_scope_error]`, with null error on success and empty base on normalization failure. A Team error does not prevent Board-only Sprint discovery; it is still part of the captured config comparison. `config_revision` records provenance, not ownership or a reason alone to invalidate. Different revision with identical relevant digest may publish; changed Board/projects/Team field/base JQL may not. Sprint catalog read identity remains workspace/Board only; a project-only change does not erase a valid Board Sprint list, but invalidates held publication captured under the old relevant digest and the affected Team membership.

### Common PostgreSQL transaction fence

Add these helpers to `backend/services/workspace_dashboard_config.py`:

```python
workspace_config_fence_key(workspace_id) -> int
acquire_workspace_config_fence(session, workspace_id, *, budget=None,
                               nonblocking=False) -> bool
merge_workspace_team_catalog_in_session(session, context, payload, *, merge) -> dict
```

Fence key is signed big-endian integer from the first eight SHA-256 bytes of UTF-8 `workspace-catalog-config-v1\0` followed by server-resolved workspace ID. PostgreSQL uses `pg_try_advisory_xact_lock(:key)` for cached-read refresh admission. Blocking operations use `pg_advisory_xact_lock(:key)` with local `lock_timeout` and `statement_timeout` capped by `min(5000 ms, floor(remaining_budget*1000))`, at least 1 ms only after a positive-budget check. Existing config writers without a refresh budget retain a 5-second DB fence timeout and their existing sanitized storage-error boundary. SQLite helper is a no-op for sequential functional tests, never concurrency evidence.

Acquire the same fence **before the first existence/config read** in every live write path:

- `workspace_dashboard_config.update_workspace_config_section:99`, including first insert, all administrator sections and no-op/revision conflict handling;
- `shared_capacity_config.save_shared_capacity_config:160`, including capacity-only first insert at `:186`; retain its current payload/fallback behavior;
- `scripts/promote_legacy_shared_admin_config.main:57` in apply mode before the existence check at `:79`; preserve fingerprint, immutable-version reread and refusal to overwrite. Dry run stays read-only;
- catalog lease claim, first-fill and every publication/failure/release path; directory POST merge/replacement also uses the fence, so a missing directory row cannot race atomic membership publication.

Lock order: workspace advisory fence → fresh refresh-actor rows (when applicable, `User` then `AuthConnection`, shared row locks) → effective configuration row if present → Sprint row → Sprint-Team row → directory row. Acquire only rows needed by the operation, in that order. The advisory fence exists even when every derived/config row is absent. Auth token refresh completes its separate transaction before acquiring this fence; never nest the token-refresh lock inside it.

Claims resolve current effective configuration under the fence, compare the requested captured digest, then conditionally acquire/renew only an expired-or-absent lease. No queued job owns a lease without an admission slot. A claim/submission failure with a live budget records `catalog_runtime_unavailable`, retry_at +300s and releases only its own lease. Admission-full before claim has no attempt and returns pending for a cold caller. At publication, reacquire the same fence, re-resolve effective config and actor, compare captured workspace/Board/relevant digest and diagnostic revision, then compare owner, attempted identity, lease deadline and attempt deadline using PostgreSQL `clock_timestamp()`. Only then conditionally replace payload/version/timestamps and merge names. Check the same budget after flush and before commit; a failed check rolls back both membership and directory. Release/failure updates are conditional on the same owner and identity, and cannot clear or fail a newer lease.

Jira reads occur outside configuration/catalog transactions and locks. The existing DB OAuth token-rotation transaction intentionally holds its `AuthConnection` lock across OAuth refresh HTTP; no Jira GET or catalog/config fence is held there. No lock can hard-cancel Python, pool acquisition or commit I/O. Deadline predicates forbid publication admitted after expiry; do not claim that a commit already admitted within budget has a hard wall-clock completion guarantee.

For Team publication, also recheck under that fence that the current Board's validated Sprint catalog still contains the captured Sprint ID. A concurrent complete Sprint replacement can remove it without changing configuration. Absence discards the Team result as `catalog_identity_changed`, with no directory merge; a subsequent Team read returns `404 sprint_not_in_catalog`. Lock the Sprint row before the membership row as above.

## Endpoint Contract Matrix

DB/OAuth is selected by existing storage helpers **and** a verified DB `RequestAuthContext`, never OAuth mode alone. All routes authenticate before cache access, even completion reads. Workspace/site is server-resolved. Reject supplied `workspaceId`, `userId`, `boardId`, project/field/JQL ownership overrides as `400 unsupported_catalog_parameter`; identity query fields below are comparison-only. Basic/jsonfile and allowed local/dev OAuth keep their existing server wire shapes and cache paths.

| Route | Policy, headers, body/query | Success | Non-auth errors / tests |
| --- | --- | --- | --- |
| GET `/api/config?includeViewConfig=true` | Existing authenticated read, no CSRF/requested-with requirement, no body | Existing complete bootstrap plus DB-only `sprintCatalogSource` below | Existing `503 config_storage_unavailable`; Task 6a bootstrap/generation tests |
| GET `/api/sprints` | `authenticated_read`; no GET CSRF; optional literal `refresh=true` OR paired `completionAttemptId=<UUID>&catalogIdentity=<identity>`; no body; reject mixed/partial completion arguments | `200 {sprints,cache}` as below, including validated `[]` | `400 invalid_catalog_completion`; `409 sprint_board_required`, `catalog_identity_changed`, `catalog_refresh_superseded`; `502 sprint_catalog_unavailable`; `503 catalog_refresh_pending`, `catalog_storage_unavailable`; Tasks 3/4/6a |
| GET `/api/teams` | `authenticated_read`; required positive-decimal `sprint`; optional `all=true`, comma-separated `teamIds`, literal `refresh=true`, or paired completion args; no body | `200 {teams,sprintId,cache}`; same cache schema, Team identity and scope digest; Task 5 | `400 sprint_required`, `invalid_sprint`, `invalid_catalog_completion`; `409 sprint_board_required`, `team_scope_required`, `team_field_required`, `team_scope_unsupported`, `catalog_identity_changed`, `catalog_refresh_superseded`; `404 sprint_not_in_catalog`; cold `502 team_catalog_unavailable`; `503 sprint_catalog_pending`, `catalog_refresh_pending`, `catalog_storage_unavailable` |
| GET `/api/team-catalog` | Existing authenticated read; no body/CSRF | Existing `{catalog,meta}` directory; names never grant membership | Existing sanitized auth/storage errors |
| POST `/api/team-catalog` | Existing `user_write`, no admin; OAuth token-bound `X-CSRF-Token` and `X-Requested-With: jira-execution-planner`; JSON `{catalog,meta,merge}` only | Existing `{catalog,meta}`, with transaction-aware merge; Task 2/5/6 | `400 invalid_json`, `unsupported_team_catalog_field`; `409 team_catalog_conflict`; existing auth/CSRF/storage errors |
| GET `/api/teams/resolve`, `/api/teams/all` | Existing authenticated read and current query/body contracts | Existing names/debug shapes; never writes membership | Existing auth behavior; compatibility consumers stay separate |
| Existing POST config section routes | Existing `shared_admin_write` and OAuth CSRF/requested-with; `{baseRevision,...section fields}` only | Existing section shape plus `configRevision`; Task 2 changes fence only | Preserve `403 admin_required`, validation errors, `409 workspace_config_conflict` with current section/revision and dirty recovery; Capacity retains its own conflict contract |

The configuration POST row covers `/api/projects/selected`, `/api/board-config`, `/api/capacity/config`, `/api/sprint-field/config`, `/api/story-points-field/config`, `/api/parent-name-field/config`, `/api/team-field/config`, `/api/delivery-owner-field/config`, `/api/stats/priority-weights-config`, `/api/issue-types/config`. Section serializers/rights do not change. Synthetic examples: Board request `{"baseRevision":0,"boardId":"42","boardName":"Example Board"}`, response `{"boardId":"42","boardName":"Example Board","source":"config","configRevision":1}`; Team-field request `{"baseRevision":1,"fieldId":"customfield_10001","fieldName":"Team"}`, response keeps that section and `configRevision:2`. Fence contention is storage unavailability, never a revision success or implicit retry of a browser write. Private views/groups/EPM remain their existing owners; they do not acquire catalog ownership.

### Exact DB source and cache envelopes

DB bootstrap adds `sprintCatalogSource: {backend:"postgresql", identity:string|null, boardId:string, browserContextId:string}`. `browserContextId` is a separate server SHA-256 digest of canonical `[1,"browser",workspace_id,user_id,auth_connection_id,browser_session_id]`, prefixed `bc1:`; it is browser invalidation state only, never persisted in shared catalog keys. Token version is deliberately excluded so the current user's token rotation does not invalidate its own successful refresh. A new user/connection/browser session does invalidate browser authority. Missing Board returns `identity:null,boardId:""` in bootstrap.

Every DB catalog envelope has these fields (no implicit defaults):

```typescript
type Cache = {
  backend: 'postgresql'; identity: string; browserContextId: string;
  boardId: string; scopeDigest: string | null; // null for Sprints
  catalogVersion: string | null; validatedAt: string | null;
  state: 'fresh' | 'stale' | 'refreshing' | 'missing' | 'failed';
  refreshStarted: boolean; refreshFailed: boolean;
  refreshAttemptId: string | null;
  refreshStatus: 'idle' | 'pending' | 'completed' | 'failed';
  refreshDeadlineAt: string | null;
  failureCode: string | null; retryAt: string | null;
};
```

All timestamps are UTC ISO-8601; `validatedAt` is publication time, never read time. These are complete JSON fixtures using synthetic workspace/user/connection/session names to compute the hashes; they are not production identities.

Pending initiating response (HTTP 200); comparison reads return the same JSON with `refreshStarted:false`:

```json
{
  "sprints": [
    {
      "id": 101,
      "name": "2026Q3",
      "state": "active",
      "startDate": null,
      "endDate": null
    }
  ],
  "cache": {
    "backend": "postgresql",
    "identity": "sc1:acd0b37aba4f82c2e57e4366032da67412751a0ea0274954b9afd8dc68c13626",
    "browserContextId": "bc1:db95110059c46d91f317c6e92db28d238604d59b57e4bcec48b8643e276e3630",
    "boardId": "42",
    "scopeDigest": null,
    "catalogVersion": "11111111-1111-4111-8111-111111111111",
    "validatedAt": "2026-09-13T12:00:00Z",
    "state": "refreshing",
    "refreshStarted": true,
    "refreshFailed": false,
    "refreshAttemptId": "22222222-2222-4222-8222-222222222222",
    "refreshStatus": "pending",
    "refreshDeadlineAt": "2026-09-14T12:01:00Z",
    "failureCode": null,
    "retryAt": null
  }
}
```

Completed empty response (HTTP 200), same identity/attempt and new publication version:

```json
{
  "sprints": [],
  "cache": {
    "backend": "postgresql",
    "identity": "sc1:acd0b37aba4f82c2e57e4366032da67412751a0ea0274954b9afd8dc68c13626",
    "browserContextId": "bc1:db95110059c46d91f317c6e92db28d238604d59b57e4bcec48b8643e276e3630",
    "boardId": "42",
    "scopeDigest": null,
    "catalogVersion": "33333333-3333-4333-8333-333333333333",
    "validatedAt": "2026-09-14T12:00:30Z",
    "state": "fresh",
    "refreshStarted": false,
    "refreshFailed": false,
    "refreshAttemptId": "22222222-2222-4222-8222-222222222222",
    "refreshStatus": "completed",
    "refreshDeadlineAt": "2026-09-14T12:01:00Z",
    "failureCode": null,
    "retryAt": null
  }
}
```

Failed response with same-identity validated data (HTTP 200):

```json
{
  "sprints": [
    {
      "id": 101,
      "name": "2026Q3",
      "state": "active",
      "startDate": null,
      "endDate": null
    }
  ],
  "cache": {
    "backend": "postgresql",
    "identity": "sc1:acd0b37aba4f82c2e57e4366032da67412751a0ea0274954b9afd8dc68c13626",
    "browserContextId": "bc1:db95110059c46d91f317c6e92db28d238604d59b57e4bcec48b8643e276e3630",
    "boardId": "42",
    "scopeDigest": null,
    "catalogVersion": "11111111-1111-4111-8111-111111111111",
    "validatedAt": "2026-09-13T12:00:00Z",
    "state": "failed",
    "refreshStarted": false,
    "refreshFailed": true,
    "refreshAttemptId": "22222222-2222-4222-8222-222222222222",
    "refreshStatus": "failed",
    "refreshDeadlineAt": "2026-09-14T12:01:00Z",
    "failureCode": "jira_unavailable",
    "retryAt": "2026-09-14T12:05:30Z"
  }
}
```

`refreshStarted:true` means **this** request reserved admission and claimed/submitted that attempt (or ran its cold fill). Other readers return false even for the same pending attempt. `refreshFailed` means the current identity's latest attempt failed; successful retry clears it. `fresh` is a matching validated snapshot not due; `stale` is a matching due snapshot without an active/failed attempt; `refreshing` means a live pending attempt, with or without validated data; `missing` means neither validated data nor live/failed attempt; `failed` retains only a matching validated snapshot, if any. Never infer validity from state or length: nonnull matching `validatedAt`/version and validated shape are required. A new in-flight attempt may carry the previous version until completion.

Cache/storage responses use `Cache-Control: no-store`. Pending cold responses carry `Retry-After: 1`. A known identity cold failure has exactly two keys: `error` (`sprint_catalog_unavailable` or `team_catalog_unavailable`) and the full `cache` object specified above, with `catalogVersion:null`, `validatedAt:null`, `state:"failed"`, `refreshStatus:"failed"`, `refreshFailed:true` and the failed attempt's metadata. It has no payload key. Only successful envelopes contain `sprints`/`teams`. Validation errors without a resolved identity, including Board removal, are exactly `{"error":"sprint_board_required"}`. Storage outage is exactly `{"error":"catalog_storage_unavailable"}`. Comparison conflicts contain only the fixed error and current `sprintCatalogSource` (Team comparisons also return current `scopeDigest`); never another workspace's payload. Generic errors never contain raw Jira text, SQL, JQL or identities in logs. Functional successful payloads necessarily contain their domain IDs.

Completion compares current server identity first, then the persisted latest attempt ID. Matching pending returns current envelope without Jira I/O; matching completed returns the newly committed full list; matching failed returns failed envelope (200 if matching validation exists, otherwise the cold 502). An expired persisted pending deadline is serialized as `failed/refreshFailed:true/failureCode:"refresh_budget_exhausted"` with retry deadline +300s, even if a blocked worker cannot record cleanup. A different current attempt returns `409 catalog_refresh_superseded`; a changed current source returns `409 catalog_identity_changed`; missing Board always returns `409 sprint_board_required`. Cold pending completion is HTTP 503 `{"error":"catalog_refresh_pending","cache":Cache}` with `validatedAt:null,catalogVersion:null,refreshStatus:"pending"`; matching validated pending is HTTP 200 with the list. The controller parses 503 cache metadata and keeps observing the same attempt within its original deadline. A known cold no-admission/no-attempt response uses `state:"missing",refreshStatus:"idle",refreshAttemptId:null`; it does not start an automatic completion loop. Attempts and validation belonging to a different Team digest are hidden: emit null validation/version, no old payload and only current-identity attempt fields (idle/null when none). No comparison read may claim a lease, clear a lease, bypass backoff, or create another refresh, even after expiry.

`all=true` means the exact Sprint snapshot in DB mode, with no global Teams registry or no-Sprint fallback. Without it, intersect `teamIds` with the canonical snapshot **after** retrieval. `JQL_QUERY_TEMPLATE` never defines DB membership; keep its old behavior only in non-DB routes and other existing task consumers. `/api/teams/resolve` remains names-only. Validate requested Sprint IDs against the current Board's persisted validated list, including deterministic duplicate-name winners; missing validation is `503 sprint_catalog_pending`, unknown ID (including validated empty catalog) is `404 sprint_not_in_catalog`. Team reads never schedule Sprint refreshes.

All genuine synchronous auth failures return the existing sanitized `401` recovery envelope; the global HTTP layer terminally locks the document. Transport-caused OAuth timeout classification is specified below and does not revoke credentials. Background auth failure records only `auth_required`; subsequent reads still run current auth guards. No failed request is replayed after sign-in.

## Browser Authority And Refresh Completion

### Display restoration versus validated authority

`dashboardRuntime.loadCachedSprintCatalog` returns a display candidate, never an authority flag. Preserve the 24-hour browser display TTL, but version-2 data accepts valid empty arrays. Store:

```json
{"version":2,"identity":"sc1:acd0b37aba4f82c2e57e4366032da67412751a0ea0274954b9afd8dc68c13626","cachedAt":1789387230000,"validatedAt":"2026-09-14T12:00:30Z","catalogVersion":"33333333-3333-4333-8333-333333333333","sprints":[]}
```

Legacy identity-less data is display-only. The saved `sprintName` is a separate display label and remains visible even when the list is invalid. Do not restore browser authority, `browserContextId`, errors, attempt IDs, timers or request generations from storage. Do not pass browser workspace values to any API.

Create pure state/coordinator exports in the existing `dashboardRuntime.js` (Task 6a):

```js
createSprintCatalogState({displaySnapshot, savedSprintId, savedSprintName})
reduceSprintCatalog(state, event)
createSprintCatalogController({read, onState, now, setTimer, clearTimer})
// controller: readCurrent(), refresh(), acceptSource(source), invalidate(reason), dispose()
// read({forceRefresh, completionAttemptId, catalogIdentity, signal}) -> Promise<{httpStatus,...body}>
```

State has `{generation, browserContextId, identity, authority, status, validatedSnapshot, displaySnapshot, selectedSprintId, savedSprintName, refreshAttemptId}`. `authority` is `display_only|validated|invalid|auth_locked`; `status` is `unknown|loading|ready|refreshing|error|exhausted`. Snapshot is `{identity,browserContextId,catalogVersion,validatedAt,sprints}` or null. Events are `SOURCE`, `START`, `RESPONSE`, `FAILURE`, `EXHAUSTED`, `INVALIDATE`, `AUTH_LOCK`; async events carry captured generation/context/identity/attempt. Every state mutation, localStorage write and `finally` cleanup checks that captured generation is current. Delayed ordinary A failures mean non-auth errors in the stale-result tests; any application 401 still triggers the existing global terminal lock, even from an old request, and is never swallowed as a stale-data retry.

The dashboard read adapter decodes the Response from `fetchSprints` into `{httpStatus,...body}`; it preserves fixed error/source/cache metadata on 409/502/503 rather than throwing away a pending attempt, and relies on existing `apiFetch` for terminal 401. A successful current GET supplies server identity/context and validates its full list. A server Sprint response can establish source before a slow config bootstrap; it does not wait on Board capability. Track accepted config-read generation/start generation so a config request started before that Sprint validation cannot replace its source with an older Board; instead retire that config response for catalog authority and perform one current config reread. Reuse existing `loadConfig`/Settings save read fences. If current source still disagrees after that single reconciliation, invalidate and show fixed Retry; no automatic reconciliation loop. Every Board-affecting save attempt invalidates/fences at save-start, before its first mutation; success is not assumed. After success use its designated accepted post-save config read and one non-forced catalog read. A known noncommitting validation rejection or 409 conflict regains authority only through one accepted latest config read plus non-forced catalog read, preserving the losing dirty draft. A partial unified save or uncertain transport outcome remains invalid until those designated current reads settle; never restore the pre-save snapshot as authority or replay the write. Failed recovery stays invalid with explicit Retry. Draft Board changes alone do not change authority.

| Event | Mandatory transition and work authority |
| --- | --- |
| Mount/restored data | Display saved label; `validatedSnapshot=null`, `availableSprints=[]`, `authority=display_only`; selector/ENG work wait for current server validation |
| Current nonempty success | Replace choices; `authority=validated,status=ready` (or refreshing for pending attempt); retain saved ID if in list, else first active, else current quarter, else last deterministic list item |
| Current `sprints:[]` success | Valid current snapshot, `authority=validated,status=ready`; clear selectable choices, `selectedSprintId=null`, readiness false; retain old saved label only as display text; no automatic refetch just because empty |
| Same-identity refresh starts | Keep current document's validated snapshot usable; status refreshing, track attempt separately; browser-only restoration still cannot authorize |
| Same-identity transient failure/exhaustion | Keep only current document's previously validated matching context/identity snapshot; status error/exhausted; no new authority; show fixed retry copy |
| Accepted Board A→B or Board removal / `409 sprint_board_required` | Increment generation synchronously, abort requests/timers, clear validation/choices/readiness and active load generations; keep display label and dirty Settings drafts; B must validate independently |
| Auth user/connection/browser context change | Same invalidation even if workspace catalog identity is equal; shared DB data is retained, new current response may validate it |
| New request generation | Retire old effects and completion ownership; only explicitly retained same-identity validated snapshot survives; late success, failure, abort/finally cannot restore old state |
| `401` / auth lock | `authority=auth_locked`, cancel all activity; mounted drafts preserved behind existing terminal global screen; no in-place unlock or replay |

`catalogReady` supplied to the existing selector is current-document matching validated authority AND nonempty choices AND selected ID membership. `sprintsLoading` is initial validation only; same-identity background refresh does not switch off readiness. Clear `availableSprints` immediately on identity change so consumers using its length cannot load from restored A. Add the same validation predicate to any direct load entry point that currently bypasses `sprintCatalogReady`. Preserve `boardScopeRequested`, `selectedScopeReadiness` and `strictBoardOwnerActive`; a selected but blocked Component/All work remains selected and cannot fall back to ordinary Sprint requests.

These browser restore/generation rules also wrap legacy replies safely: a current non-DB response validates under the current accepted config/auth generation, without requiring DB cache fields. Keep Basic file cache/fallback and local OAuth process cache on the server unchanged; legacy immediate-browser-authority assertions are replaced, not used to weaken DB validation. Legacy successful empty replies also clear old choices. No shared DB key is inferred from a legacy response.

### One bounded completion protocol

The mounted `App` owns one Sprint coordinator; main and compact selector panels are views of that owner. On `refreshStarted:true`, or when the initiating normal/forced response reports a specific competing pending attempt, follow that identity and attempt. Completion reads are non-forced and use `fetchSprints(backendUrl,{forceRefresh:false,completionAttemptId,catalogIdentity,signal})`. The API helper rejects simultaneous force/completion arguments. It uses existing `apiFetch`; `http.js` needs no change.

- Schedule sequential `setTimeout` reads after delays **1, 2, 4, then 5 seconds**; never overlap. Stop at **16 completion reads or 75 seconds** from the initiating pending response, whichever comes first. Each read has an AbortController timeout `min(5 seconds, remaining wall time)`. Count network errors/timeouts as attempts; preserve a matching snapshot and continue only within the same limits. A wall-deadline timer aborts a hanging read.
- Terminal success/failure/conflict/401 stops immediately. Matching completed list replaces `availableSprints`; an already-open menu rerenders, its active index is clamped, and any removed `aria-activedescendant` is cleared. No manual force or menu reopen is needed.
- On exhaustion set `status=exhausted`, detach observer and show **“Sprint refresh is taking longer than expected. Retry.”** Failure copy is **“Sprint refresh failed. Retry.”** No valid snapshot: **“Sprint catalog is unavailable. Retry.”** Board removed: **“Choose a Jira source Board in Settings.”** Never show upstream errors/IDs. Retry is an explicit new normal read, which may observe the existing attempt or admit a due attempt; a user manual force refresh remains explicit.
- Identity/context change, superseding generation, global auth lock, App unmount or `pagehide` cancels controllers/timers, pending forced flag and late writes. Menu close, compact/main switch or Settings close does **not** cancel the Sprint coordinator because `App` and its catalog consumers remain mounted. `pageshow` after a persisted-page restore invalidates authority and requests one current catalog; it never resumes an old observer. Timer cleanup is idempotent.
- While an ordinary read is in flight, a manual Sprint refresh queues exactly **one** forced read after it settles; that ordinary promise cannot count as forced completion. If the ordinary response already admitted a pending attempt, coalesce the queued force onto that identified attempt instead of starting another. While observing a pending attempt, additional manual Sprint-refresh clicks coalesce to it. Once terminal/exhausted, a later explicit force starts a new request generation. Retain existing unrelated active-view Refresh gates and routing; requested-but-blocked cross-sprint scopes use existing configuration retry and never ordinary fallback.
- Sprint refresh scheduling has one owner: server `/api/sprints`. Team reads, completion reads, menu renders and browser timers cannot start a Jira refresh. The process semaphore/DB lease remain final server admission authority across users/replicas.

**Narrow polling-rule amendment:** the former plan rule forbidding new background polling now permits only this finite, identified refresh-completion observer and finite Team completion reads below. No interval timer, recurrent freshness polling, idle polling, new SSE or workspace broadcast is permitted. Another user's open UI observes new data on its next ordinary read/reopen/explicit action; this plan does not promise live cross-user synchronization.

## Budget And Credential Contract

One `CatalogRefreshBudget` is created before admission reservation and carried unchanged through capture, claim, DB actor/token resolution, lock acquisition, HTTP/retries/pages, publication, failure/release and terminal shaping. It owns a monotonic 60-second deadline and a cancellation Event. Persist `attempt_deadline_at` using DB time plus remaining budget at claim; lease is 120 seconds. These are cooperative resource bounds, not hard thread/HTTP end-to-end guarantees.

```python
CatalogRefreshBudget.start(seconds=60, now_fn=time.monotonic)
budget.remaining(phase) -> float  # raises CatalogRefreshDeadline with fixed code
budget.check(phase) -> None
budget.cancel() -> None
budget.cancelled                # threading.Event for interruptible retry waits
CatalogRefreshTransport(budget, observer, breaker)
# observer.add(key, value=1); counters stay internal, never GA4
# resilient_kwargs(): {breaker, diagnostic_budget: budget, diagnostic_observer: observer}
```

Implement this small existing transport interface in `catalog_refresh_runtime.py`; do not import Board orchestration. Use `JiraCircuitBreaker(failure_threshold=5,open_seconds=30)` per attempt. The complete verified wrapper chain is:

| Step | Current source | Selected use |
| --- | --- | --- |
| Immutable actor | `backend/auth/context.py:14` `RequestAuthContext` | Capture request context; no Flask proxies in worker |
| Jira reads | `jira_server.py:691` `current_jira_get`, `:718` `current_jira_search` | Explicit `context=captured_context`, `diagnostic_transport=transport`, scalar `timeout=min(15,budget.remaining(...))` |
| DB auth | `jira_server.py:564` `current_jira_session_data` → `:534` `db_oauth_session_data_for_auth_context`; callbacks `:665` | Same budget reaches DB reload; DB no-op save/nullcontext avoids local store |
| Token resolution/lock | `backend/auth/db_tokens.py:393` `db_oauth_session_data`, `:246` `_connection_for_update`, `:57` `_postgresql_lock_timeout_ms` | Same object before/after lookup; PostgreSQL token-row lock timeout `min(5000ms,remaining)` |
| Token refresh HTTP | `db_tokens.py:300` `refresh_db_oauth_token` → `jira_auth.py:247` `request_oauth_refresh_token` | Existing `(min(5,R),min(20,R))` connect/read timeout plus streamed body checkpoints and close |
| Jira auth/retries | `jira_auth.py:362` `jira_get`/`ensure_oauth_token`; `backend/jira_client.py:108` `resilient_jira_get` | Same budget bounds each retry, connect/read pair, wait and streamed-body check |
| Unsafe alternative | `jira_server.py:723` `current_jira_request` → `jira_auth.py:424` `jira_request` | Excluded from catalog runtime: final HTTP timeout does not cover DB auth or retries |
| DB lifetime limit | `backend/db/engine.py:94/188` `create_database_engine` / `session_scope` | Pool/connect/commit cannot be hard-preempted by this object; checks and conditional publication fence late work |

No generic adapter/auth signature needs modification: read adapters already expose the required propagation. Existing Jira retry defaults remain four attempts and `max_elapsed_seconds=10` as a retry-admission threshold checked after an attempt, not a hard ten-second logical-request wall limit; they are also limited by the overall budget; budget mode returns 429 immediately. OAuth uses its existing 20-second read cap, not a falsely asserted universal 15-second cap. A scalar retry timeout is required: do not pass the final connect/read tuple as `current_jira_get.timeout`.

At each page check before auth/read, after parsing, before the next page and before publication. Board discovery caps at 100 pages/10,000 raw Sprint records; Team search at 100 pages/10,000 raw issues. Board page `values` must be a list, `isLast` a boolean, and offset progress must advance by received records; nonfinal empty/repeated/malformed pages fail. Enhanced search requires boolean `isLast` and a new nonempty `nextPageToken` on nonfinal pages; reject repeats and false-last at cap. No partial payload/name publication. Team accumulation keeps IDs/names, not full issues. No per-issue enrichment fan-out; names use issue value, directory, then ID.

`assert_catalog_refresh_actor(session, context, *, budget=None)` in `workspace_catalog_cache.py` directly checks fresh active User, OAuth AuthConnection/provider, workspace/site/cloud/user binding, provider-verified required scopes and captured browser-session binding/expiry if present. Invoke on every catalog read (including cached/completion reads, without token resolution or Jira), before every logical upstream call and publication; do not use `db_context`'s status cache or token-version-partitioned Board `_assert_current`. Workers always pass their original budget; DB-only readers may omit it. Legitimate rotation may change `token_version`; it must not make its own worker stale. Revocation/disabled user blocks reads, new work and publication, but never deletes saved shared rows. Token material stays in DB `auth_connections`/encrypted `auth_tokens`.

| Failure point | Fixed result and storage action |
| --- | --- |
| Budget exhausted before token lock | `refresh_budget_exhausted`; no lock/HTTP/new transaction after failed checkpoint |
| PostgreSQL SQLSTATE `55P03` or `57014` at token/config fence with time left | `catalog_refresh_lock_timeout`; no retry with a fresh budget; rollback transaction |
| OAuth timeout with time left | `oauth_refresh_timeout` if the overall budget is still live, otherwise `refresh_budget_exhausted`; inspect `AuthError.__cause__` for `requests.Timeout` from `jira_auth.py:279`; zero Jira calls, no account revocation; noncatalog auth semantics unchanged |
| Expiry during OAuth/body/retry or between pages | `refresh_budget_exhausted`; no next page or publication; incomplete work discarded |
| Jira retry exhaustion, 429 or non-200 other than 401 | `jira_unavailable`; complete old same-identity snapshot retained |
| Shape/token/page/record cap failure | `catalog_incomplete`; no truncated success |
| Relevant configuration changed before publication | `catalog_identity_changed`; discard; conditional owner cleanup only if still current and budget remains |
| Raw Jira 401 on any first/later Board or Team page | Strict fetcher raises existing `AuthError` before generic non-200 handling; synchronous sanitized 401/global lock, background `auth_required`; no partial publish |
| Actor no longer valid | Synchronous existing sanitized `401`; background `auth_required` failure; no publication |
| Expired/superseded lease | No payload/directory/failure write and no clearing newer owner; matching elapsed attempt reads derive deadline failure |
| Expiry before publication | Roll back; same-identity payload/version unchanged; lease expires or is conditionally released only while budget remains |
| Success within budget | Atomically publish complete list (including empty), new version/validation time, terminal completed attempt; clear its failure/lease |

An internal owner release that is not publication marks its own pending attempt failed (`catalog_runtime_unavailable` for rejected submission, `catalog_identity_changed` for invalidated capture), never leaves an ownerless pending attempt, and is suppressed if budget/owner is already invalid. `finish_catalog_failure` and `release_catalog_refresh` acquire the common fence but do not revalidate the actor whose failure they record; they still check exact captured workspace/key/identity/owner and lease expiry.

Propagate genuine `AuthError` and `CatalogRefreshDeadline` unchanged through both strict fetchers. For SQLSTATE 55P03/57014, check the same budget first: elapsed becomes `refresh_budget_exhausted`; live becomes `catalog_refresh_lock_timeout`. Nontransport genuine AuthError remains 401 regardless of the clock. `CatalogRefreshDeadline.code` is `refresh_budget_exhausted` (including cooperative cancellation); do not invent a new cleanup clock.

For all non-auth worker failures, a valid same-identity snapshot yields `200` with failed cache metadata; no snapshot yields `502 sprint_catalog_unavailable` or `team_catalog_unavailable` plus failed cache. True storage outage yields sanitized 503. A budget already exhausted cannot buy a cleanup deadline: leave its lease until expiry and derive failure from persisted deadline on reads. With time left, owner-checked failure/backoff/release uses the same fence/budget. SQL publication condition includes owner, attempted identity, unexpired lease and unexpired attempt deadline using DB time; an old worker cannot clear a newer lease even if it returns successfully later.

## Runtime And Settings State Machines

A process-lifetime `CatalogRefreshRuntime` initializes lazily after fork; two workers and **two total admitted jobs**, with no waiting executor queue. Synchronous cold fills and explicit Team refreshes consume the same semaphore. Reserve nonblocking, claim fenced lease, then submit or run; failed claim/submission releases reservation and only its owner lease within remaining budget. A process crash is recovered by lease expiry. No startup warm, durable queue or per-request pool.

```text
Sprints: matching validated + fresh -> DB-only success
matching validated + due/force -> nonblocking admission/claim; return old DB immediately
missing + admitted lease -> one synchronous complete fill
missing + competitor -> DB rereads every 100ms for <=2s, then 503 pending
missing + failed backoff -> 502 with failed cache, no Jira
completion query -> DB-only pending/completed/failed/conflict; never admission
Teams: matching validated -> DB-only success, even empty
matching + explicit force -> synchronous admitted refresh; atomic membership/name replace
missing/mismatched + admitted lease -> one synchronous auto-fill
matching + competitor -> old DB success + pending attempt
missing + competitor -> same <=2s DB wait, then 503 pending
failure -> matching old payload only; failed metadata and five-minute backoff
```

Seeded catalog read auth/config/field resolution must be DB-only. Stale-hit lease admission uses nonblocking advisory acquisition so another writer cannot consume the cached one-second target. On busy runtime/fence, return existing validated payload with `refreshStarted:false`; cold callers get `503 catalog_refresh_pending`. Add `Server-Timing: catalog_db;dur=...` and include the complete auth/config lookup in timing assertions. Do not claim measured performance before five samples with zero Jira calls.

Settings membership is `{identity,sprintId,scopeDigest,generation,status,snapshot}`, where status is `unknown|loading|ready|refreshing|error|exhausted`; ready includes empty. Names are separate directory state. Additions require current matching validated membership; unknown absence is `availableInSprint:null`, validated absence false. Configured unavailable Teams remain named and removable. `[ARCHIVED]` names are trimmed only.

Settings manual Refresh teams while an ordinary membership read is busy queues exactly one forced read afterward; only a returned current pending attempt permits coalescing onto that attempt instead. Repeated manual clicks while forced read/completion is active coalesce; ordinary in-flight success cannot prove forced completion. Completion reads never force.

Settings open loads directory and current validated Sprint membership independently; directory failure cannot block membership or unrelated edits. On Sprint/config/auth change increment membership generation, preserve names and dirty drafts, clear old availability and wait for current Sprint authority. Guard success/error/finally/directory merge against modal incarnation plus generation. A stale directory GET cannot overwrite names committed later; after DB fill, re-read directory once if its older concurrent GET is still pending. Names resolve with issue name, latest directory name, then ID; ID fallback must not overwrite a real name.

For a known competing Team attempt use the same comparison-only API semantics with at most **five completion reads, one second after each settled read, 2-second per-read timeout and 15-second wall deadline**. No forced completion reads. Stop on terminal, modal close, Sprint/config/auth/generation change. Exhausted/failure copy: “Team refresh is taking longer than expected. Retry.” / “Team refresh failed. Retry.” Same-identity validated membership remains usable; unknown/changed identity cannot borrow old members. No automatic follow-on loop. Ordinary reads/explicit Refresh teams own server fill admission; completion reads do not.

Catalog work never mutates `groupDraft`, dirty state, `baseRevision`, private favorite, first-run completion, selected EPM scope or administrator settings. Keep footer Save for all dirty editable sections, section-scoped payloads, existing `409` losing-draft/reload recovery and rollback semantics. A remote user's save is seen on the next read, not a new subscription. Directory POST is names-only; DB Team refresh needs no client persistence POST. Non-DB refresh keeps the legacy directory-save flow.

## Exact File Map And Source Trace

Every existing path below was inspected at the recorded baseline. `Create` means absent now; no task may assume a future file already exists. Recheck branch and migration head at execution: current head is `20260908_0015_board_load_performance.py` (`revision=20260908_0015`). The new revision below is reserved for this plan; a later competing migration requires an explicit plan amendment, not silent numbering.

| Action | Exact path | Current anchor / planned responsibility |
| --- | --- | --- |
| Create | `backend/db/migrations/versions/20260913_0016_workspace_sprint_team_catalogs.py` | `revision=20260913_0016`, `down_revision=20260908_0015`; only the two derived tables |
| Modify | `backend/db/models.py` | `WorkspaceDashboardConfig:245`, `WorkspaceTeamCatalog:264` conventions; new two models |
| Modify | `backend/services/workspace_dashboard_config.py` | `_current:57`, `_fallback_snapshot:69`, `load_workspace_config:79`, `update_workspace_config_section:99`, `save_workspace_team_catalog:181`; fence/session resolver/atomic directory helper |
| Modify | `backend/services/shared_capacity_config.py` | `save_shared_capacity_config:160`; same fence before first row read |
| Modify | `scripts/promote_legacy_shared_admin_config.py` | `main:57`; fence apply existence check/insert only |
| Create | `backend/services/workspace_catalog_config.py` | Canonical effective configuration resolver/digest/limited JQL normalization |
| Create | `backend/services/workspace_catalog_cache.py` | Snapshot/attempt/lease/actor checks, atomic publication |
| Create | `backend/services/catalog_refresh_runtime.py` | One budget, transport, admission, synchronous/background workers |
| Modify | `backend/services/sprints.py` | `_format_quarter_sprint:162`, `_collect_sprints_by_jql:175`, `fetch_sprints_from_jira:213`; new strict Board-only fetch, old legacy helper retained |
| Create | `backend/services/sprint_teams.py` | Strict selected-Sprint enhanced search/normalization |
| Modify | `backend/routes/settings_routes.py` | `get_sprints:351`, `get_config:417`, `post_team_catalog:729`, `_persist_shared_section:78`, config routes `:1098/:1158/:1291/:1400`; route envelopes, source descriptor, bounded completion, safe fence errors |
| Modify | `backend/routes/eng_routes.py` | `get_teams:960`; DB membership branch; `resolve_team_names:1098`, `get_all_teams_list:1169` remain names/debug only |
| Modify | `jira_server.py` | `current_jira_get:691`, `current_jira_search:718` consumed unchanged; catalog runtime input/provider wiring and storage dispatch, `_save_field_config:6148` safe fence error, existing Sprint compatibility wrappers/cache invalidation |
| Modify | `frontend/src/dashboardRuntime.js` | `loadCachedSprintCatalog:4`; display-only restore, pure reducer and finite coordinator |
| Modify | `frontend/src/dashboard.jsx` | `loadConfig:6716`, `loadSprints:7044`, `renderSprintControl:14050`, `refreshActiveViewFromJira:14832`; selected intent/readiness preserved; Team paths `:2633/:2700`, save branch `:3087` |
| Modify | `frontend/src/api/engApi.js` | `fetchSprints:19`; add completion params and AbortSignal, so this path is required |
| Modify | `frontend/src/api/jiraCatalogApi.js` | `fetchAllTeams:32`, `saveTeamCatalog:29`; encoded Sprint/refresh/completion/signal; names-only delta persistence |
| Create | `frontend/src/settings/teamAvailability.js` | Pure names/membership join |
| Modify | `frontend/src/settings/TeamGroupsSettings.jsx` | Fieldset locks `:113/:315`, Refresh `:293`, configured name/remove `:382`, result `:425` |
| Modify | `frontend/src/styles/settings/team-selector.css` | `.team-catalog-edit-lock` and scoped native disabled Team presentation |
| Create | `tests/test_workspace_catalog_config.py` | Effective source/normalization/digest functional tests |
| Create | `tests/test_workspace_catalog_cache.py` | SQLite functional persistence/ownership/empty/atomicity tests |
| Create | `tests/test_workspace_catalog_postgresql.py` | Required PostgreSQL locking/races and real-wrapper token contention |
| Create | `tests/test_catalog_refresh_runtime.py` | Admission/deadline/real-wrapper no-request-context tests |
| Create | `tests/test_sprint_team_service.py` | Enhanced-search completeness and Team value contract |
| Create | `tests/test_persistent_catalog_routes.py` | Actual DB OAuth fixtures + full endpoint/cache/auth/completion responses |
| Create | `tests/test_team_availability.js` | Pure names/availability membership tests |
| Modify/test | `tests/test_workspace_dashboard_config_service.py` | `WorkspaceDashboardConfigServiceTests:20`, fallback/first save/CAS preservation |
| Modify/test | `tests/test_shared_capacity_config.py` | Existing capacity read/save/fallback contracts plus common fence |
| Modify/test | `tests/test_shared_admin_config_recovery.py` | `SharedAdminConfigRecoveryTests:21`, explicit fingerprint/refusal test `:68` plus fence |
| Modify/test | `tests/test_db_migrations.py` | `DbMigrationTests:27`, upgrade/downgrade/offline metadata tests |
| Modify/test | `tests/test_sprint_service.py` | `TestSprintService:21`, Board and JQL compatibility contracts |
| Modify/test | `tests/test_oauth_stats_routes.py` | Current non-DB OAuth Sprint/Team route/cache fixtures; keep separate from new DB cases |
| Modify/test | `tests/test_cache_partitioning.py` | `TestCachePartitioning:13`, connection/config/token invalidation tests `:93–123` |
| Modify/test | `tests/test_team_catalog_api.py` | `TestTeamCatalogAPI:31`, DB directory dispatch and merge `:115/:152` |
| Modify/test | `tests/test_request_performance.py` | `RequestPerformanceTests:12`, real wrapper worker precedent `:101`; cached full request timing |
| Modify/test | `tests/test_dashboard_runtime.js` | Existing restore test `:18`; replace unsafe authority assertion, add pure state/fake-clock cases |
| Modify/test | `tests/test_frontend_api_source_guards.js` | `fetchSprints` wrappers and current Team request expectation `:1130/:1176`; strict query/signal/auth ownership |
| Modify/test | `tests/ui/eng_group_board_view.spec.js` | Five modes `:697`, 22-cell authority table `:1271`, unsafe restored-cache test `:1623`, blocked fallback `:1774` |
| Modify/test | `tests/ui/settings_unified_save.spec.js` | Whole-editor-lock test `:409` changes to additions-only; preserve unified save/conflict tests |
| Modify/test | `tests/ui/shared_department_groups.spec.js` | Shared group permission/name/removal/first-run journeys |
| Modify/test | `tests/test_postgresql_runner_contract.py` | `test_ci_target_validation_precedes_alembic_and_tests:177`; exact module allowlist |
| Modify | `runners/github/run-postgresql-tests.sh` | Existing safe synthetic CI target/required flags/module list |
| Modify | `backend/security/CONFIGURATION_OWNERSHIP.md` | Derived catalogs matrix; no rights/private ownership changes |
| Modify | `docs/ontology.md` | Workspace/catalog and shared-selector integration entries |
| Modify | `docs/features/eng-workflows.md` | Sprint/Board source and readiness contract |
| Modify | `docs/README_ANALYTICS.md` | 2026-09-14 no-event allowlist entry |
| Modify | `README.md` | Catalog cache/runtime/compatibility description only |
| Modify | `docs/plans/EXEC-persistent-sprint-team-catalogs.md`, `docs/plans/README.md` | Execution tracking and evidence/status |
| Generate only | `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css` | `npm run build`; never hand-edit |

Read/verify only (no interface change needed): `backend/config/db_repository.py` (`DbConfigRepository.load_dashboard_config_snapshot:67`, `save_dashboard_section:82`, `save_team_catalog:96` delegate to preserved wrappers); `backend/config/import_config.py` (private import strips shared sections); `backend/auth/context.py`, `backend/auth/db_context.py`, `backend/auth/db_tokens.py`, `backend/auth/jira_auth.py`, `backend/auth/home_credentials.py`, `backend/auth/db_browser_sessions.py`, `backend/db/engine.py`, `backend/jira_client.py`, `backend/services/eng_board_stream.py`, `frontend/src/api/http.js`, `frontend/src/api/authRequired.js`, `frontend/src/eng/engSprintSelectorState.js`, `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/useStrictEngBoardIntegration.js`, `frontend/src/eng/useEngBoardData.js`.

Regression/test-only unchanged paths: `tests/test_sprint_dates.py`, `tests/test_jira_auth.py`, `tests/test_token_refresh_race.py`, `tests/test_eng_board_stream.py`, `tests/test_eng_board_routes.py`, `tests/test_user_view_config_concurrency.py`, `tests/test_eng_sprint_selector_state.js`, `tests/test_codebase_structure_budgets.py`, `tests/ui/eng_board_stream.spec.js`, `tests/ui/eng_board_progressive_loading.spec.js`, `tests/ui/jira_field_picker_read_race.spec.js`. Structural budgets stay fixed; orchestration belongs in mapped helpers. `package.json` is read-only build evidence; untouched auth bundle outputs must remain unchanged.

## Task 0: Reconcile The Merged Baseline

**Files:** inspect the complete map above and read root/docs/plans instructions, ownership, ontology, completed selector plan, and MRT016/MRT025/MRT027. Modify only this plan/index if evidence has changed. No schema/application edit in this task.

- [x] Record initial clean branch and exact matching local/origin SHAs in amendment status.
- [x] Reconcile selector completion; no rebuild of its shared control or pure selected-intent/load-authority model.
- [ ] At implementation start run `git status --short --branch`, `git rev-parse HEAD origin/bugfix/board-progressive-loading`, `.venv/bin/python -m alembic -c backend/db/alembic.ini heads`. Expected baseline migration `20260908_0015`; branch must be correct and unrelated edits preserved.
- [ ] Run `rg -n 'SPRINTS_PROCESS_CACHE|fetch_sprints_from_jira|loadTeamCatalog|resolveMissingTeamNames|setAvailableTeams|/api/sprints|/api/teams' jira_server.py backend frontend/src tests`. Current callers migrate by the table below, not filename guesses.

| Existing caller/source | Target contract |
| --- | --- |
| DB `/api/sprints` process cache | Replaced by persisted shared Board snapshot/attempt |
| Basic `/api/sprints`, file helper, Scenario Sprint boundaries | Intentionally preserve existing file compatibility; no DB file import |
| Non-DB local/dev OAuth `/api/sprints` | Keep authorization-partitioned process cache and allowed-local-store guards; no Basic file access |
| DB `/api/teams` template/global/fallback discovery | Exact current Sprint membership; template and filters never alter persisted scope |
| Non-DB `/api/teams`, `/api/teams/all` | Existing compatibility/debug queries; never writes DB membership |
| `loadTeamCatalog` / missing-name resolution | Directory names only; delta merge, no availability grant |
| `fetchAllTeamsFromJira` | Explicit Sprint membership/DB atomic persistence; legacy save only for legacy reply |
| Shared Sprint menu / ordinary and strict owners | Reuse existing selected intent; consume new validation predicate, never restored browser authority |

Task 0 verification is source/discovery, not a behavioral red/green claim. Both `tests.test_sprint_dates` and `tests.test_sprint_service` exist; no module-name correction was needed.

## Task 1: Add Derived Catalog Schema

**Create:** `backend/db/migrations/versions/20260913_0016_workspace_sprint_team_catalogs.py`. **Modify:** `backend/db/models.py`. **Tests:** `tests/test_db_migrations.py` (`DbMigrationTests`). Consumes existing workspace/user FK conventions; produces the two Storage Design models/constraints, no imported data.

- [ ] RED: write `test_catalog_migration_empty_upgrade_downgrade_and_reupgrade`, `test_catalog_model_identity_attempt_and_lease_constraints`, `test_catalog_migration_postgresql_offline_sql`. Assert exact columns/defaults/indexes/FK actions/unique keys, idle/attempt and validation pairs, version-1 JSON `[]`, no data movement and no user-scoped uniqueness. Run `.venv/bin/python -m unittest tests.test_db_migrations`; new tests must fail for absent revision/tables, while existing migration cases retain their assertions.
- [ ] GREEN: implement models and migration with `down_revision='20260908_0015'`. Downgrade drops only the two derived tables; it never modifies names, configuration or credentials. Re-run the same command; expect all passing. Run PostgreSQL upgrade/downgrade/reupgrade in Task 9, not SQLite as evidence of PostgreSQL constraints.

```python
# Required assertions after upgrade, expressed against reflected metadata:
assert sprint_unique_columns == {'workspace_id', 'board_id'}
assert team_unique_columns == {'workspace_id', 'sprint_id'}
assert migrated_sprint_count == migrated_membership_count == 0
```

## Task 2: Resolve Effective Configuration And Serialize Every Writer

**Create:** `backend/services/workspace_catalog_config.py`, `backend/services/workspace_catalog_cache.py`, `tests/test_workspace_catalog_config.py`, `tests/test_workspace_catalog_cache.py`, `tests/test_workspace_catalog_postgresql.py`, `tests/test_persistent_catalog_routes.py` (initial config-fence route cases). **Modify:** `backend/services/workspace_dashboard_config.py`, `backend/services/shared_capacity_config.py`, `scripts/promote_legacy_shared_admin_config.py`, `backend/routes/settings_routes.py` and `jira_server.py` (`_save_field_config:6148`) for safe fence-storage errors, `runners/github/run-postgresql-tests.sh`. **Tests:** the three new modules plus `tests/test_workspace_dashboard_config_service.py`, `tests/test_shared_capacity_config.py`, `tests/test_shared_admin_config_recovery.py`, `tests/test_postgresql_runner_contract.py`. Current symbols/lines are in the exact map. Do not modify `DbConfigRepository` delegation or private import semantics.

Interfaces consume `EffectiveCatalogConfig`, server `RequestAuthContext` and the same budget. Define frozen `CatalogSnapshot` containing identity, matching payload or null, validation/version and all attempt/lease metadata; `RefreshClaim` contains owner/identity/captured config/deadlines. Persistence functions use short sessions/fence; no Jira calls:

```python
load_sprint_catalog(context, *, config, database_url=None) -> CatalogSnapshot
load_sprint_team_catalog(context, *, sprint_id, config, database_url=None) -> CatalogSnapshot
claim_catalog_refresh(context, *, kind, sprint_id=None, expected_config,
                      owner, budget, resolve_config, nonblocking=False, database_url=None) -> RefreshClaim | None
publish_catalog(context, *, claim, payload, budget, resolve_config, database_url=None) -> bool
finish_catalog_failure(context, *, claim, failure_code, budget, database_url=None) -> bool
release_catalog_refresh(context, *, claim, budget, database_url=None) -> bool
assert_catalog_refresh_actor(session, context, *, budget=None) -> None
```

`resolve_config(session, context)` is a closure wired by `jira_server` to `resolve_effective_catalog_config` with fresh `catalog_runtime_inputs()` and the existing eligible fallback loader/site. Pass this dependency to runtime/claim/publication/completion explicitly; persistence helpers must not import `jira_server` or reuse captured configuration at publication. `RefreshClaim` stores captured `EffectiveCatalogConfig`, kind/Sprint, owner, identity and deadlines, not a Flask object.

`kind` is only `sprints|teams`; Sprint kind forbids sprint_id, Team kind requires it. `publish_catalog` returns false for changed identity/expired owner without side effects; genuine auth failure raises existing `AuthError`. Config section requests keep their exact wire contracts. Add `WorkspaceConfigFenceUnavailable` (fixed message `config_storage_unavailable`) and catch it explicitly at affected Settings config/directory boundaries as `503 {"error":"config_storage_unavailable"}` (catalog endpoints use `catalog_storage_unavailable`); do not stringify SQL exceptions. Promotion apply surfaces its existing nonzero CLI failure without performing an insert.

- [ ] RED resolver: name `test_environment_jql_precedes_projects`, `test_saved_blank_board_blocks_environment_fallback`, `test_absent_team_field_uses_default_but_explicit_blank_is_required`, `test_revision_zero_read_does_not_insert`, `test_exact_quoted_jql_and_top_level_conjunct_normalization`, `test_nested_target_predicate_is_rejected`, `test_digest_excludes_user_token_preferences_and_unrelated_fields`. Include JQL fixtures `project = "A AND B" AND Sprint in (1,2) ORDER BY created DESC`, `Sprint=1 AND project=DEMO`, `project=DEMO AND cf[10001] in ("team-a")`, `(project=A OR project=B) AND Sprint=1`, and `(Sprint=1 OR project=A)`; assert exact preserved base or fixed `team_scope_unsupported` as specified. Run `.venv/bin/python -m unittest tests.test_workspace_catalog_config tests.test_workspace_dashboard_config_service`; absent new module/import fails first, then failing assertions demonstrate old unsafe/fallback behavior.
- [ ] RED persistence: name `test_same_workspace_users_share_catalog_and_lease`, `test_catalogs_isolate_site_and_environment`, `test_validated_empty_is_not_a_miss`, `test_failed_other_identity_never_serves_old_membership`, `test_directory_and_membership_rollback_together`, `test_wrong_owner_cannot_release`, `test_directory_merge_preserves_unrelated_names`. Use two users/connections/token versions/private preferences in one workspace and identical Jira IDs in separate workspaces. Assert shared vs isolated row keys, unchanged versions on failure and successful empty replacement.
- [ ] RED safe write failures: `test_config_fence_timeout_is_sanitized_across_section_routes` in `tests/test_persistent_catalog_routes.py` parameterizes Board/projects/Team field/capacity/priority/issue-type/directory writes and SQLSTATE 55P03/57014. Inject only the fence failure, preserve real route/error handlers, and expect fixed 503 rather than current generic 500/SQL text; include `jira_server._save_field_config`.
- [ ] GREEN: implement the canonical resolver, common fence before all three configuration writers' first reads, transaction-aware directory merge and conditional lease operations. Existing directory wrapper retries whole transactions at most three times on CAS/first-insert conflict; merge only nonblank name deltas, increment directory revision, preserve unrelated names/meta. Never call its committing wrapper inside membership publication. Run `.venv/bin/python -m unittest tests.test_workspace_catalog_config tests.test_workspace_catalog_cache tests.test_workspace_dashboard_config_service tests.test_shared_capacity_config tests.test_shared_admin_config_recovery tests.test_postgresql_runner_contract tests.test_persistent_catalog_routes`; expect passing after updating runner flag/exact module list.
- [ ] Write and run all PostgreSQL races below. Red must demonstrate the unsafe serialization or missing fence, not merely mocked lock SQL. Green requires independent connections and observed lock contention with no skipped case.

### Deterministic PostgreSQL proof

Use existing `tests/test_user_view_config_concurrency.py:475`'s isolated random schema/`TEST_DATABASE_URL` pattern. Refuse an application target; fixtures are synthetic. `REQUIRE_POSTGRES_CATALOG_CONCURRENCY=1` makes missing/non-PostgreSQL target a test failure, not a skip. Extend the existing guarded GitHub runner to require this flag and run the new module alongside migrations, token-refresh races and user-view concurrency. Do not run the GitHub-only script by forging its environment locally.

Test barriers use Events and two distinct connection/backend-PID values. Observe `pg_locks`/`pg_stat_activity` to prove the second connection is waiting at the advisory lock; sleeps are not ordering evidence. Test timeout 5 seconds, lock timeout 1.5 seconds for intentionally blocked fixtures; always release barriers/rollback/drop only the owned schema in `finally`.

| Named test | Forced order and expected result |
| --- | --- |
| `test_fallback_fill_first_save_commits_before_publication_discards` | Claim A under revision-zero fallback, hold Jira outside transaction; real first save inserts B and commits; release A. No A validation or directory changes; current B lookup cannot serve A. Parameterize administrator Board save, capacity-only first save (stops fallback), and fingerprint-authorized promotion. |
| `test_first_save_cannot_enter_between_validation_and_publication` | Hold A publication after fresh resolver **inside** fence; launch first-save writer; observe advisory waiter, no config row visible. Release A, then save may commit. A linearizes before B; every read resolving B rejects A. Run all three first writers. |
| `test_relevant_config_change_while_fetch_held_discards` | Hold Jira; change Board, projects, Team field through actual writes, and base JQL through injected current runtime provider; release worker. Each changed relevant digest rejects old result and retains unrelated rows/names. |
| `test_sprint_catalog_removal_prevents_held_team_publication` | Hold Team Jira fetch; publish a complete current-Board Sprint replacement without that Sprint; release Team worker. No membership/version/name update, own attempt fails with `catalog_identity_changed` if its lease/budget remains live, subsequent Team read is 404. |
| `test_unrelated_config_revision_change_allows_publication` | Existing row changes only priority weights/capacity, with unchanged normalized identity; worker may publish despite newer full revision. First capacity insert is deliberately not this case. |
| `test_expired_worker_cannot_publish_or_release_new_owner` | Expire A attempt/lease with controlled DB fixture time; B claims same catalog. Release A success and failure variants; B owner/deadline/version unchanged. B then publishes complete result. |
| `test_first_catalog_claim_has_one_workspace_winner` | Simultaneous claims on absent catalog/config row: one owner across same-workspace users, independent owners across workspaces. |
| `test_two_sprint_publications_and_directory_post_keep_all_names` | Hold concurrent publications for two Sprints plus current directory POST under common fence; all unique names survive, each membership/version is whole. Force merge failure once and prove entire membership transaction rolls back. |

Run `REQUIRE_POSTGRES_CATALOG_CONCURRENCY=1 .venv/bin/python -m unittest -v tests.test_workspace_catalog_postgresql` with an explicitly provisioned disposable `TEST_DATABASE_URL`; missing PG remains implementation acceptance outstanding. SQLite cannot establish this fence's first-insert, row-lock, or multi-process proof.

## Task 3: Strict Board-Only Sprint Fetch

**Modify:** `backend/services/sprints.py`, `jira_server.py`. **Tests:** `tests/test_sprint_service.py`; unchanged `tests/test_sprint_dates.py`. Consumes captured Board, `CatalogRefreshBudget`, explicit-context adapter; produces a fully shaped list or fixed `SprintCatalogFetchError` (`jira_unavailable|catalog_incomplete`).

```python
fetch_board_sprints(*, board_id, jira_get, auth_error_class, budget) -> list[dict]
# injected jira_get calls current_jira_get with this same budget/transport/context
# Request params: {'maxResults':100,'startAt':0,'state':'active,future,closed'}
# Upstream valid empty: {'values':[], 'startAt':0, 'maxResults':100, 'isLast':True}
```

- [ ] RED: `test_db_board_empty_is_complete_without_issue_fallback`, `test_db_board_pagination_requires_verified_last_page`, `test_db_board_rejects_nonfinal_empty_and_malformed_values`, `test_db_board_duplicate_name_winner_is_deterministic`, `test_db_board_caps_do_not_publish_partial`, `test_db_board_budget_stops_next_page`. Assert IDs offered by the formatted quarterly catalog equal Team validation's accepted IDs; foreign `originBoardId` is excluded, missing origin remains accepted. Duplicate names choose active, closed, future in that order, then lowest numeric ID; preserve `startDate/endDate`, sort name descending. Run `.venv/bin/python -m unittest tests.test_sprint_service tests.test_sprint_dates`; new cases fail before strict helper exists and empty/fallback assertions fail against legacy behavior.
- [ ] GREEN: implement strict helper, preserving `fetch_sprints_from_jira` and `_collect_sprints_by_jql` only for tested non-DB compatibility. Patch `jira_server.jira_search_request` and global Teams/Home paths to raise in DB Sprint tests. Re-run command; expect full pass, zero issue-search calls in DB Sprint tests, retained Basic fallback/date tests.

## Task 4: Runtime, Auth Budget And Sprint Endpoint Completion

**Create:** `backend/services/catalog_refresh_runtime.py`, `tests/test_catalog_refresh_runtime.py`. **Modify:** `tests/test_persistent_catalog_routes.py` (created in Task 2), `backend/routes/settings_routes.py`, `jira_server.py`, `tests/test_oauth_stats_routes.py`, `tests/test_cache_partitioning.py`, `tests/test_request_performance.py`; extend Task 2 PostgreSQL tests. Uses current read adapters unchanged; generic adapters/auth source remain read-only.

```python
CatalogRefreshRuntime.refresh(context, *, kind, config, sprint_id=None,
                              background=False, resolve_config) -> RefreshClaim | None
# creates one budget before admission; invokes strict fetch then fenced publication
read_catalog_completion(context, *, kind, attempt_id, expected_identity,
                        sprint_id=None, resolve_config) -> CatalogSnapshot
# DB-only read: never calls refresh() or claim_catalog_refresh()
```

- [ ] RED endpoint cases in `PersistentCatalogRouteTests`: `test_stale_hit_returns_before_held_worker`, `test_completion_pending_completed_and_failed_keep_same_attempt`, `test_completion_reads_never_admit_jira`, `test_completion_rejects_wrong_identity_new_attempt_and_mixed_force`, `test_cold_fill_empty_and_failed_backoff`, `test_cached_user_b_reuses_user_a_snapshot`, `test_revoked_reader_cannot_read_shared_hit`, `test_removed_board_409_never_returns_old_list`, `test_cache_hit_auth_and_field_resolution_do_not_call_jira`. Assert every Cache field/status/header, current workspace comparison, no raw error payload and one owner across manual/ordinary reads. Seed actual DB OAuth connections/tokens; the existing OAuth stats module clears DB config and is compatibility evidence only. Run `.venv/bin/python -m unittest tests.test_persistent_catalog_routes`; expected RED missing catalog runtime/envelope assertions, not live Jira.
- [ ] RED runtime cases in `CatalogRefreshRuntimeTests`: `test_two_admitted_jobs_have_no_waiting_queue`, `test_submit_failure_releases_only_its_owner`, `test_runtime_is_created_after_fork`, `test_expired_attempt_read_is_failed_without_worker_cleanup`, plus the real-wrapper table below. Run `.venv/bin/python -m unittest tests.test_catalog_refresh_runtime`; expected RED absent runtime, then missing budget/identity enforcement.
- [ ] GREEN: implement bounded runtime and exact cache/attempt envelopes and completion-only branch, before ordinary refresh scheduling. DB `/api/sprints` uses PostgreSQL only; Basic/file and non-DB OAuth behavior remains selected by storage helpers. On a held worker return immediate same-identity stale list; a later same-attempt completion read returns new list/version. Never extend validation timestamps on reads.
- [ ] Re-run `.venv/bin/python -m unittest tests.test_catalog_refresh_runtime tests.test_persistent_catalog_routes tests.test_oauth_stats_routes tests.test_cache_partitioning tests.test_request_performance tests.test_jira_auth tests.test_token_refresh_race tests.test_eng_board_stream tests.test_eng_board_routes`; expect pass. Existing auth/cache tests must prove logout/revoke/token bump/disable do not delete DB shared catalogs and do retain unrelated cache partition contracts.

### Required real-wrapper tests and negative guards

All new runtime cases below belong to `CatalogRefreshRuntimeTests` in `tests/test_catalog_refresh_runtime.py`, except PG contention in `WorkspaceCatalogPostgresqlTests`. Use real `current_jira_get/search`, `jira_auth.jira_get`, DB encrypted-token resolution/refresh and `resilient_jira_get`. Only mock HTTP transport with `requests.Response`-compatible `iter_content`/`close`/`json`, clock/Event, and isolated test configuration. Run from a worker without Flask request context. Do not replace the read adapter/auth/token service with route stubs.

| Test | Required red/green observation |
| --- | --- |
| `test_real_wrapper_refreshes_expired_db_token_then_publishes_with_one_budget` | Expired access token, one OAuth refresh, token version advances, Bearer Jira GET then complete publication; same object identity reaches auth/lock/retry/page/publish, completed attempt/new version |
| `test_expired_budget_before_auth_lock_performs_no_oauth_or_jira_io` | Zero lock/HTTP admission; failed deadline cache, old payload retained; no fresh cleanup budget |
| `test_real_wrapper_token_lock_contention_uses_remaining_budget` (PG) | Other connection holds AuthConnection lock; real wrapper times out under remaining lock budget; `catalog_refresh_lock_timeout`, no OAuth/Jira call, old payload/version retained |
| `test_real_wrapper_jira_401_on_first_or_later_page_preserves_auth_contract` | Parameterize Board and Team page 1/later: real wrapper returns 401; synchronous auth envelope/global lock or background auth_required, zero later pages/publication |
| `test_real_wrapper_oauth_timeout_retains_matching_catalog` | Real refresh HTTP raises Timeout; cause maps to `oauth_refresh_timeout`, failed attempt/backoff, zero Jira reads; no revoked row or local fallback |
| `test_real_wrapper_retry_exhaustion_never_publishes_partial_catalog` | Retryable Jira pages exhaust four attempts or cross the ten-second retry-admission threshold; assert no further retry after the threshold, not a hard ten-second total; `jira_unavailable`, old payload only; request timeouts shrink |
| `test_real_wrapper_budget_exhausted_between_team_pages` | First enhanced-search page nonfinal, clock reaches deadline; zero next-page request, `refresh_budget_exhausted`, no membership/name merge |
| `test_budget_exhausted_before_publication_keeps_old_payload` | Hold after complete HTTP result until expiry, then enter publication; no version/validation/name update; expired-attempt serialization supplies failed state |
| `test_failed_cleanup_cannot_clear_new_lease_owner` | A cleanup after B claim cannot change B owner/deadline/payload/failure metadata |
| `test_actor_disable_or_revocation_during_fetch_prevents_publication` | Fresh direct DB actor check rejects status/binding/scopes/browser-session change; no published result; token rotation alone is accepted |
| `test_cached_and_completion_reads_reject_freshly_revoked_actor` | Seed the current auth status cache, then revoke/disable in DB and issue ordinary/completion reads. Fresh actor validation returns sanitized 401 before any catalog payload, OAuth refresh or Jira call; shared stored rows remain intact |

In every DB route/worker test patch these concrete forbidden symbols to raise on use: `jira_server.current_jira_request`, `jira_server.jira_search_request`, `jira_server.oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock`, `oauth_session_data_for_auth_context`, `save_oauth_session_for_auth_context`, `oauth_refresh_lock_for_auth_context`, `_LOCAL_OAUTH_STORE` read/write/lock methods, `fetch_teams_from_jira_api`, `backend.auth.home_credentials.resolve_home_credential`, `_resolve_service_credential`. Guard `jira_auth.build_jira_headers` to require OAuth and inspect every physical HTTP call's OAuth gateway/Bearer form without logging token values. `current_auth_config` remains callable because the legitimate adapter uses it. Source guards for new catalog service files reject imports/references to `OAUTH_TOKEN_STORE`, Basic `HEADERS`, Home/Townsquare/service integrations, generic request and local store helpers. A forbidden-call sentinel failing RED and unreachable GREEN is required; prose guards alone are insufficient.

## Task 5: Exact Sprint Team Membership And Atomic Names

**Create:** `backend/services/sprint_teams.py`, `tests/test_sprint_team_service.py`. **Modify:** `backend/routes/eng_routes.py`, `jira_server.py`, `tests/test_team_catalog_api.py`; extend `tests/test_persistent_catalog_routes.py` and `tests/test_workspace_catalog_cache.py`. Consumes Task 2 effective scope and lease, Task 4 budget adapter; produces complete member IDs/names, then one atomic membership/directory publication.

```python
fetch_sprint_teams(*, sprint_id, base_jql, team_field_id, jira_search,
                   directory, budget) -> list[dict]
# jira_search -> current_jira_search(payload, context=captured, diagnostic_transport=transport)
# request: {'jql':'(<normalized base>) AND Sprint = 101',
#           'fields':['customfield_10001'],'maxResults':100}
# next request alone adds nextPageToken; never startAt
# success: {'teams':[{'id':'team-a','name':'[ARCHIVED] Team A'}],
#           'sprintId':'101','cache':<exact Cache with scopeDigest and Team identity>}
```

- [ ] RED `SprintTeamServiceTests`: `test_complete_empty_membership`, `test_next_page_token_required_and_unique`, `test_nonfinal_page_and_row_caps_fail`, `test_scalar_dict_list_team_values`, `test_invalid_nonnull_team_shape_fails`, `test_issue_then_directory_then_id_names_trim_only`, `test_duplicate_names_have_deterministic_winner`. Null is nonmember; string/positive number is ID, dict requires nonblank `id` with optional name, flat lists normalize each member; nested lists/malformed nonnull values fail. Duplicate IDs choose lexicographically smallest trimmed nonblank issue name; otherwise latest directory name, then ID. Sort `(name.casefold(),id)`. Run `.venv/bin/python -m unittest tests.test_sprint_team_service`; expect absent-helper/assertion RED.
- [ ] RED DB route cases: `test_team_miss_fills_once_and_validated_empty_reuses`, `test_team_scope_change_hides_old_snapshot`, `test_team_refresh_is_visible_to_other_workspace_users`, `test_global_only_team_never_becomes_member`, `test_team_ids_intersect_after_canonical_persistence`, `test_template_does_not_change_db_membership`, `test_unknown_sprint_requires_validated_board_catalog`, `test_failed_team_refresh_retains_membership_and_names`, `test_team_completion_is_read_only`. Assert full cache states, empty success, 409 setup/404 unknown/503 pending/502 failed, cross-workspace rejection and exact atomic names.
- [ ] GREEN: implement strict paginated search and DB branch before legacy route behavior; no broad Teams scan or fallback query. A cached hit joins current directory labels without changing membership. Names-only POST uses shared fence/session-aware merge; DB refresh never requires another client POST. Run `.venv/bin/python -m unittest tests.test_sprint_team_service tests.test_persistent_catalog_routes tests.test_team_catalog_api tests.test_workspace_catalog_cache`; all pass with credential sentinels from Task 4 active. PostgreSQL atomicity remains Task 2/9 proof.

## Task 6a: Browser Sprint Authority And Completion Owner

**Modify:** `frontend/src/dashboardRuntime.js`, `frontend/src/dashboard.jsx`, `frontend/src/api/engApi.js`. **Tests:** `tests/test_dashboard_runtime.js`, `tests/test_frontend_api_source_guards.js`, `tests/ui/eng_group_board_view.spec.js`. Current symbols `loadCachedSprintCatalog:4`, dashboard restore `:496`, `loadConfig:6716`, `loadSprints:7044`, `sprintCatalogReady:5675`, refresh `:14832`; `fetchSprints:19`. Consumes DB source/cache/attempt envelope and existing global auth gate, produces only catalog authority passed into the completed shared selector.

- [ ] RED pure cases (literal Node test names): `restored Sprint catalog remains display-only until server validation`, `populated Board A to validated empty Board B clears authority`, `removed Board invalidates restored and validated choices`, `delayed Board A success and failure cannot change Board B`, `same-identity transient failure retains validated snapshot`, `auth context change invalidates authority without changing shared ownership`, `new generation suppresses stale finally and persistence`, `completion exhaustion is terminal`, `manual refresh never treats ordinary read as completion`. Use injected clock/timers/deferred reads; assert state and request counts, not timer implementation details. Current restore test's 24-hour display TTL remains, but its nonempty authority assumption is removed.
- [ ] RED wrapper cases: `Sprint completion reads pass signal and attempt identity without refresh`, `Sprint forced refresh rejects completion parameters`, `Sprint completion uses apiFetch global auth protection`. Assert encoded query and same AbortSignal. Run `node --test tests/test_dashboard_runtime.js tests/test_frontend_api_source_guards.js tests/test_eng_sprint_selector_state.js`; unsafe authority/missing coordinator fail; existing selector pure behavior remains green.
- [ ] GREEN: implement the exact Browser Authority/Completion contract in the runtime helper; dashboard becomes thin state/render wiring. `availableSprints` contains only current-server-validated choices; saved name remains display. Guard all direct ENG request/retry/Stats/Scenario entry points while invalid. Auth context accepted in `loadConfig:6753` and catalog replies retires old generations. Empty success clears selected ID, readiness and old choices; same-identity transient failure retains validated authority. No changes to `resolveEngSprintSelectorState` or Board control ownership.

```js
// Required reducer test invariant; all async event handlers use it.
const next = reduceSprintCatalog(boardB, {type:'RESPONSE', generation:oldGeneration,
  browserContextId:contextA, identity:identityA, envelope:lateA});
assert.strictEqual(next, boardB);
assert.equal(validatedEmpty.selectedSprintId, null);
assert.equal(validatedEmpty.validatedSnapshot.sprints.length, 0);
```

- [ ] RED/GREEN browser tests below use the actual source bundle/shared selector. Held-worker route harness emits exact DB envelopes, not `{sprints}` mocks masquerading as DB. Join the real held-worker endpoint sequence from Task 4 to fixture responses; separately verify endpoint unit contract so browser fixtures cannot conceal a missing server consumer. Run focused command below before wiring (expected assertions fail), then after wiring (all pass).

| Named Playwright test | Required result |
| --- | --- |
| `catalog identity: saved label is visible but cannot authorize ENG before validation` | Saved label visible through held server response; no choices authority, task/source/strict/Scenario requests; release valid current response enables appropriate existing flow. Replaces unsafe immediate-authority test currently at `:1623`. |
| `catalog identity: populated A to empty B` | Accept B source, clear A synchronously; accept valid B empty, remain empty/blocked with no repeated fill. |
| `catalog identity: removed Board 409` | Actual Board removal/save fence followed by 409 clears choices/readiness and Team membership; saved label and unrelated drafts survive. |
| `catalog identity: delayed A cannot restore choices` | Held A success **and** failure arrive after B validation; no A storage/state/spinner/error/request changes. |
| `catalog identity: rejected and partial Board saves require current revalidation` | Validate pre-mutation invalidation, 400/409 recovery and uncertain/partly committed unified save; one accepted current config plus non-forced catalog read restores authority, failed recovery stays blocked and dirty drafts survive |
| `catalog identity: auth change invalidates shared snapshot locally` | Same workspace, new browser principal; A unusable until new response; shared server key unchanged; 401 path stays globally locked. |
| `catalog refresh: held worker completion updates an open menu` | Start on old list; one force gets pending; held worker yields pending non-forced reads; release complete new list, same attempt/new version visible in still-open main and compact menu; no second force. |
| `catalog refresh: failure preserves same-identity choices` | Failed completion keeps validated choices and fixed warning; change identity before failure and assert no old choices retained. |
| `catalog refresh: deadline exhausts without more reads` | Fake clock advances exact backoff/limits; <=16 reads/75s, no overlap, hanging read aborted, fixed exhaustion UI; no calls afterward. |
| `catalog refresh: identity auth and document lifetime cancel observer` | Board/context/generation/401/unmount/pagehide independently cancel; late responses ignored; mere panel close/reopen continues same bounded owner. |
| `catalog refresh: manual clicks share one attempt` | Repeated manual clicks while pending produce one force/one attempt; terminal explicit force creates a new generation; delayed old completion cannot settle it. |
| `catalog refresh: forced request does not reuse an ordinary read` | Hold ordinary read; manual click queues one force if it returns no pending attempt; forced attempt completion alone can settle manual state. Ordinary-triggered pending coalesces to that returned attempt. |

```bash
node --test tests/test_dashboard_runtime.js tests/test_frontend_api_source_guards.js tests/test_eng_sprint_selector_state.js
npx --no-install playwright test tests/ui/eng_group_board_view.spec.js --workers=1 -g 'catalog identity:|catalog refresh:'
```

## Task 6: Separate Team Names From Membership

**Create:** `frontend/src/settings/teamAvailability.js`, `tests/test_team_availability.js`. **Modify:** `frontend/src/api/jiraCatalogApi.js`, `frontend/src/dashboard.jsx`, `tests/test_frontend_api_source_guards.js`; **browser tests:** `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`. Current `fetchAllTeamsFromJira:2633` and `resolveMissingTeamNames:2700` must no longer conflate names with availability.

```js
buildTeamAvailability({directory, sprintTeams, configuredTeamIds, membershipReady})
// -> [{id,name,availableInSprint:true|false|null,canAdd:boolean}]
fetchAllTeams(backendUrl,{sprint,refresh=false,completionAttemptId=null,catalogIdentity=null,signal})
// URLSearchParams; all=true; rejects force+completion; apiFetch(...,{signal,cache:'no-cache'})
```

- [ ] RED Node names: `directory names never grant Sprint membership`, `unknown membership does not assert absence`, `validated empty disables additions but retains names`, `archived names are preserved and stale generations ignored`. Fixture directory A/B, membership A and configured B yields A true/canAdd, B false/cannotAdd; unknown yields null/false; empty yields all false with names preserved. Run `node --test tests/test_team_availability.js tests/test_frontend_api_source_guards.js`; absent helper and current unencoded/no-signal wrapper expectation fail. Update current wrapper test `:1176` to the exact request options.
- [ ] GREEN implement pure join and separate dashboard states. DB `cache.backend==='postgresql'` disables client names POST after refresh; legacy responses retain it. `resolveMissingTeamNames` can update names only and posts `{"catalog":{"team-a":{"id":"team-a","name":"Team A"}},"meta":{},"merge":true}` with only resolved deltas, never old full directory or membership. Preserve group drafts on every catalog outcome.
- [ ] RED/GREEN browser cases `team membership: empty is ready and does not refill`, `team membership: stale modal and Sprint results are ignored`, `team membership: failed directory does not block membership`, `team membership: DB refresh commits without client POST`, `team membership: legacy refresh retains directory save`, `team membership: competing attempt reads are bounded`, `team membership: manual refresh does not reuse a held ordinary read`, `team membership: 401 locks the document`. Cover close/reopen, A→B→A, late errors/finally and names read races. Run the complete Settings specs in Task 7; no PostgreSQL claim is made by these browser mocks.

## Task 7: Team Availability Must Not Lock Unrelated Settings

**Modify:** `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/styles/settings/team-selector.css`, `frontend/src/dashboard.jsx`; **tests:** `tests/ui/settings_unified_save.spec.js`, `tests/ui/shared_department_groups.spec.js`. Consumes Task 6 availability only; no endpoint/permission/dirty-state redesign.

- [ ] RED browser tests `catalog failure leaves unrelated dirty sections saveable`, `unavailable Team rejects pointer and keyboard but remains removable`, `component-only first-run saves without Team membership`, `catalog refresh preserves revision conflict drafts`, `unrelated save gates remain enforced`. Rewrite `settings_unified_save.spec.js:409`, which currently expects disabled name/Add/Save, to assert additions-only gating with valid dirty non-Team data. Preserve a distinct legacy directory-persistence test.
- [ ] GREEN remove exactly `if (loadingTeams || !teamCatalogReady) return 'Team cache is loading';` from `saveBlockedReason:3087` and remove only those now-unused memo dependencies. Keep saving-in-progress, first-run guide, shared settings/permission readiness, EPM loading/dirty gates, validation, no-dirty-state and all unrelated footer/onboarding guards. Remove catalog-only fieldset disables at TeamGroupsSettings `:113/:315`; gate only adding Teams.
- [ ] Render search results as native `button type="button"` with `disabled` on unavailable results, title `Not in the selected sprint` only when validated absence is known. Configured name region may be muted/labelled, but sibling Remove team stays enabled; do not apply disabled/aria-disabled to its ancestor. Preserve chip dimensions and selected-state styling. Keyboard navigation skips disabled options.
- [ ] Prove editing Department name only in left list, components/labels/exclusions, Team removal, empty `teamIds`, and all-section footer Save during unknown/refresh/error/empty states. Ensure non-admin editable shared groups remain saveable; admin permission still fails closed. Conflicting save returns existing 409, retains dirty draft, explicit reload resolves it; catalog refresh never changes base revision or replays failed save.
- [ ] Run before and after implementation:

```bash
npx --no-install playwright test tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js --workers=1
```

Expected RED: native-disabled/removal and unrelated-save assertions fail today. Expected GREEN: both complete specs pass. Capture before/after settled screenshots with animations disabled for unavailable option, configured removable chip and dirty-save error state; inspect legibility/control geometry, not just file creation.

## Task 8: Documentation, Build And Selector Integration Acceptance

**Modify:** `backend/security/CONFIGURATION_OWNERSHIP.md`, `docs/ontology.md`, `docs/features/eng-workflows.md`, `docs/README_ANALYTICS.md`, `README.md`, this plan and index. **Generate:** `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`. **Verify:** `tests/test_codebase_structure_budgets.py`, selector/stream/UI paths from the exact map. No new analytics event; no unrelated auth bundle edits.

- [ ] Document persisted workspace keys, effective resolver/fence, browser-only display restoration, bounded completion exception, validated empty and failure retention. Keep deferred `FUTURE-warm-team-catalog-team-names.md` unchanged: cold ENG filter-name warming remains separate.
- [ ] Add analytics allowlist row dated 2026-09-14: trigger catalog read/fill/refresh/completion/disabled availability; `event_type=none`, `event_name=none`, `feature_name=eng/settings`, typed params none. Existing explicit selection events stay unchanged. Source/browser assertions verify no new dataLayer event or identifier; preserve `pageview`/`userevent`, no GA4 runbook change because transport/taxonomy events are unchanged.
- [ ] Run `npm run build`; expect only the three mapped generated outputs to differ. Run `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`; expect passing without increasing ceilings. Run `rg -n` for new ontology symbols and validate every relative link.

### Full selector/readiness matrix (mandatory after catalog integration)

Retain all existing selector assertions, including five modes at `eng_group_board_view.spec.js:697`, 22 two-scope authority cells at `:1271`, explicit Project Track source-only reload/current-Sprint repair, ordinary Board reuse, config/save/read fences, keyboard semantics and auth interaction. Do not rebuild those implementations.

Add DB overlays for **each** of Catch Up, Planning, Board, Statistics and Scenario with fresh, stale, pending with validated snapshot, pending without snapshot, failed with validated snapshot, failed without snapshot, validated empty, changed Board, delayed result and auth-locked response. Ready profiles authorize only the current selected member; pending-without/empty/changed/auth states produce no new ENG work. Same-identity stale/pending/failed snapshots remain usable after server validation. Count the mode's real task lanes or source POST, not an invented one-request total; Scenario computation stays explicit.

Run both Component and All work against catalog overlays crossed with current scope-readiness profiles. With current nonempty validation, intent remains selectable even for setup/error/capability failures and shows existing reason. Already-selected cross-sprint intent during catalog invalidation stays selected/blocked; no ordinary tasks, source requests or previous Sprint Board flash. Ordinary Sprint choices remain independent of cross-sprint capability after their own validation.

The existing saved-project-only/no-Board authority matrix is a valid **selector compatibility characterization**, not a valid DB catalog fixture. Keep those cases with legacy-shaped catalog replies or pure selector tests. DB absence/removal uses `409 sprint_board_required` and zero validated choices; never fabricate DB populated Sprints without an effective Board. All applicable 22 readiness assertions run again with feasible DB catalog states; absence-Board intersections explicitly expect catalog-blocked state.

Run complete suites (new named tests plus existing matrix):

```bash
node --test tests/test_dashboard_runtime.js tests/test_eng_sprint_selector_state.js tests/test_team_availability.js tests/test_frontend_api_source_guards.js
npx --no-install playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_board_stream.spec.js tests/ui/eng_board_progressive_loading.spec.js tests/ui/settings_unified_save.spec.js tests/ui/shared_department_groups.spec.js tests/ui/jira_field_picker_read_race.spec.js --workers=1
```

GREEN requires real pointer/keyboard/DOM/request assertions and before/after settled main/compact screenshots: open menu after completion, empty Board, saved display-only label, blocked Component/All work, auth lock and unavailable removable Team. Menu layering/icon geometry assertions remain mandatory. No layout/selector success is inferred from pure tests alone.

## Task 9: Verification And Acceptance Record

**Files:** all exact Create/Modify/test paths above; update evidence only in this plan/index and affected product contracts. Tasks 1–8 are implementation tasks, not completed by this plan amendment. No task-local commit instruction overrides root publication authorization/history checks.

- [ ] Run all focused backend checks:

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_workspace_catalog_config tests.test_workspace_catalog_cache tests.test_sprint_service tests.test_sprint_dates tests.test_sprint_team_service tests.test_oauth_stats_routes tests.test_cache_partitioning tests.test_team_catalog_api tests.test_workspace_dashboard_config_service tests.test_shared_capacity_config tests.test_shared_admin_config_recovery tests.test_request_performance tests.test_catalog_refresh_runtime tests.test_persistent_catalog_routes tests.test_codebase_structure_budgets tests.test_postgresql_runner_contract
.venv/bin/python -m unittest tests.test_jira_auth tests.test_token_refresh_race tests.test_eng_board_stream tests.test_eng_board_routes
REQUIRE_POSTGRES_CATALOG_CONCURRENCY=1 .venv/bin/python -m unittest -v tests.test_workspace_catalog_postgresql
```

The third command requires an already-provisioned disposable test DB; do not infer an application database target. All named race tests must run with zero skips. CI runner includes this module/required flag. Document the database engine and actual result without credentials.

- [ ] Run Node/Playwright commands from Task 8, `npm run test:frontend:unit`, `.venv/bin/python -m unittest discover -s tests`, then `npm run build`. Record exact counts/failures/skips and warnings; do not use documentation-only baseline tests as future implementation proof.
- [ ] Run `.venv/bin/python scripts/check_startup_preflight.py`, launch `.venv/bin/python jira_server.py`, and `curl -fsS http://localhost:5050/api/test`. Pre-banner dependency/runtime warnings fail startup acceptance unless documented benign. Use the configured supported DB/OAuth profile; do not substitute Basic for DB acceptance.
- [ ] With authorized read-only Jira scope, validate two users in one workspace sharing Sprint/member/name rows and another workspace isolated; explicit cache refresh performs only allowed Jira GET/search reads, no Home calls/Jira writes. Compare observed result against same-ref mocked/PG tests without storing real fixtures.
- [ ] Collect five full-request samples each for seeded `/api/sprints` and `/api/teams` under one second, including DB auth/config/field lookup and `Server-Timing`; assert zero Jira calls for ordinary hits. Due/forced Sprint may launch background Jira but response cannot wait; synchronous cold fills/Team force are excluded from cached latency target. No fabricated measurements.
- [ ] Final `git diff --check`, placeholder scan, exact file-map/history diff review and negative guards. No unrelated changes, no schema import of legacy caches, no changed ownership keys. Acceptance/merge, not merely completed code, controls eventual `DONE-*` rename.

## Plan Self-Review And Amendment Verification

Self-review follows `docs/plans/AGENTS.md`'s Plan Review Prompt, with the user-requested gate-sweep exclusion:

| Review area | Closure |
| --- | --- |
| Source-of-truth migration | Task 0 caller table explicitly migrates DB process cache, preserves Basic/local OAuth and names/debug callers; no silent legacy import |
| Endpoint matrix/auth/CSRF | Full DB envelopes, errors, comparison-only completion, safe config-fence errors and unchanged write policies; Task 4 real wrappers/negative guards |
| Workspace ownership | Shared workspace/Board and workspace/Sprint/digest keys only; browser principal separate; token rotation not a catalog partition |
| Runtime feasibility | Two admitted jobs, no queue, 60-second cooperative budget/120-second lease, page caps, bounded completion/DB contention reads; non-preemptible boundaries stated |
| Browser state machine | Restore/empty/errors/identity/auth/generation/cleanup/superseded manual refresh and open-menu completion specified; existing selected intent preserved |
| Dirty/concurrent configuration | Common fence for all three writers, missing-row fallback and first publication; unchanged dirty/revision/conflict recovery; PG barriers prove no first-save interposition |
| Verification | Named RED/GREEN tests, actual module names, real-wrapper OAuth path, strict PG no-skip requirement, five-mode/readiness overlays, screenshot and latency proof |
| Compatibility/boundaries | Basic/jsonfile and allowed local OAuth server storage behavior unchanged; no Home call, Jira write, service credential, private ownership move or new GA4 event |

**Amendment checks (2026-09-14, current implementation only):** requested `.venv/bin/python -m unittest tests.test_sprint_dates tests.test_oauth_stats_routes tests.test_cache_partitioning tests.test_workspace_dashboard_config_service` passed **49 tests**, zero skipped. `node --test tests/test_dashboard_runtime.js` passed **1 test**, zero failed/skipped. Both requested module names are correct. These characterize existing code, including the browser behavior that Task 6a will replace. They do not prove future catalog implementation.

Pinned Node **20.20.2** was used for the accepted runtime-test rerun and `npm run build`; both passed. The initial host Node 26.8.1 run also passed, but does not replace pinned-runtime verification. `git diff --check` passed; the requested placeholder scan returned exit 1 (no matches). All existing file-map paths and relative links in the three amended documents resolve; all 13 planned Create paths are absent as expected; all four JSON blocks parse. The build changed no generated files. No new implementation tests, PostgreSQL concurrency, server-startup, browser campaign or latency acceptance is claimed by this task.

**Remaining external acceptance:** disposable PostgreSQL execution/CI; supported-runtime startup; authorized read-only two-user/multi-workspace Jira/browser checks; actual cached timing samples; positive authenticated Component/All work evidence already noted in the completed selector plan. These are specified execution/release checks, not unresolved design decisions. Home-write capability remains blocked and outside this plan; no probe or write authority is inferred. Workspace sharing is settled.
