# User-Owned EPM Configuration Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task by task. Update the checkboxes and status after
> every committed task.

**Goal:** Restore EPM settings to each authenticated user's private default saved view, preserve
workspace-shared department configuration for every authenticated editor, preserve administrator-only
workspace settings, and turn every application API `401` into one blocking authentication-recovery state.

**Canonical contracts:**

- `backend/security/CONFIGURATION_OWNERSHIP.md`
- `docs/agents/bugfixes/2026-08-27-planned-global-auth-lock.md`

**Architecture:** In DB mode, the canonical EPM settings source is the current user's private default
`view_configs` row. One serialized private-view mutation service owns default creation, targeted merges,
default switching/archive behavior, version allocation, and detection of whether a committed mutation
changes the normalized effective EPM configuration. Its transaction-owning wrapper exposes that change
only after commit so every caller can invoke the same partition-aware cache invalidator. Functional EPM
routes and worker dependencies resolve or capture this user-scoped configuration rather than workspace
configuration. Every EPM project/issues/rollup cache key also includes a deterministic digest of the
normalized five-key EPM settings object, so another process that did not receive the local invalidation
cannot reuse an entry from an older effective configuration; local post-commit eviction removes obsolete
entries eagerly.
Legacy JSON mode keeps its local single-user file behavior: stored v1/v2 reads use the existing
legacy-aware normalizer, while HTTP writes use the same strict v2 validator as DB mode.
Misplaced workspace EPM data is removed by a reversible migration archive without assigning it to a
guessed user. The frontend removes EPM from workspace revision/conflict state, then adds one common API
authentication boundary and root recovery gate.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy 2, Alembic, React 19, esbuild, `unittest`, Node test
runner, Playwright, SQLite/PostgreSQL-compatible schema.

**Status:** Done. Executed in PR [#144](https://github.com/Juce-me/jira-execution-planner/pull/144); tracked by commit `48eeed8`. Kept as `EXEC-*` for merge context pending final sign-off.

**Concurrency decision:** Private EPM saves remain last-write-wins and do not use workspace
`baseRevision`. EPM writers are serialized: PostgreSQL takes an owner/workspace transaction lock plus the
target row lock; SQLite starts an immediate write transaction; missing-default and integrity races receive
a bounded retry. EPM saves merge into the latest committed private payload. Whole-view payload PATCH is
different because it is a full replacement: it must send the current private `baseVersion` and returns
`409 view_config_conflict` when stale rather than overwriting a concurrent EPM update. View creation and
default switching use the same owner/workspace serialization boundary.

**Required PostgreSQL gate:** SQLite remains the fast focused-test backend, but it cannot prove
`pg_advisory_xact_lock` or `SELECT ... FOR UPDATE` behavior. Task 1 and final plan completion require the
PostgreSQL-only concurrency class in `tests/test_user_view_config_concurrency.py` to run with
`REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1` and an explicitly supplied PostgreSQL `TEST_DATABASE_URL`.
The test must use a unique temporary schema, two independent connections, and `finally` cleanup. It must
never fall back to `DATABASE_URL` or a production/shared database. The ordinary full suite may skip this
class when the required flag is absent, but a skip does not satisfy either completion gate.

**EPM view-state boundary:** This correction owns the server-persisted EPM settings keys `version`,
`labelPrefix`, `scope`, `issueTypes`, and `projects`. Existing private `epm.tab` and
`epm.selectedSprint` values are allowed and preserved during a settings save, but this plan does not add
new server persistence for dashboard UI choices that currently live in private browser preferences. They
must never enter workspace configuration.

---

## Acceptance Contract

| Configuration | Canonical storage and scope | Read | Write |
| --- | --- | --- | --- |
| Dashboard administrator settings | `workspace_dashboard_configs`, one row per workspace | authenticated workspace users | `shared_admin_write` |
| Department groups, labels, memberships, exclusions, and department boards | `workspace_group_configs`, one row per workspace | `authenticated_read` | `user_write` |
| Visible groups and favorite/active group | `user_group_preferences`, workspace + user | current user | `user_write` |
| EPM scope, label prefix, EPM issue types, and project-label mappings | default private `view_configs`, workspace + owner | current user | `user_write` |
| EPM tab and selected sprint UI state | private browser preferences; preserve any existing private-view values | current user | current user only |
| Derived team catalog | `workspace_team_catalogs`, one row per workspace | `authenticated_read` | `user_write` refresh |
| Connections and tokens | user auth connection/token tables | current user | `user_write` |

Required behavior:

- Two users in one workspace read the same administrator, department-group, and derived team-catalog
  configuration but different EPM settings and group preferences.
- The same user in two workspaces receives the EPM settings, preferences, catalog, connections, and shared
  settings belonging only to the active workspace.
- A non-admin user can open and save Departments and EPM. Administrator tabs remain hidden or read-only
  according to the explicit admin gate.
- `GET/POST /api/epm/config` use the current user's private default view in DB mode. A POST changes only
  the five EPM settings keys, preserves `epm.tab`, `epm.selectedSprint`, and every unrelated private field,
  appends exactly one version, and neither requires nor advances a workspace revision.
- Runtime EPM scope, project discovery, issues, per-project rollups, aggregate rollups, and the Home OAuth
  probe consume the same user-owned settings. Worker threads receive a captured request auth/config
  snapshot and never resolve DB configuration without request identity.
- `/api/config?includeViewConfig=true` resolves the default private view once and derives both
  `viewConfig.view.epm` and the compatibility `epm` field from that single snapshot. `sharedConfig` never
  contains `epm`.
- `POST /api/epm/projects/configuration` is a non-persisting preview. It allows every authenticated user,
  requires the unsafe-request headers and token-bound CSRF, and never requires administrator permission.
  Its compatibility alias `/api/epm/projects/preview` has the identical policy and contract.
- Every successful mutation that changes the normalized effective default EPM configuration invalidates
  only the current DB/OAuth user's EPM project/issues/rollup cache partition after commit. This includes
  direct EPM saves, effective-view replacement, default creation/switch/demotion/archive, and legacy
  import. Rename-only and non-default-view changes, conflicts, validation failures, retries that exhaust,
  and rollbacks do not invalidate. Every EPM cache key includes the canonical normalized-settings digest,
  preventing stale reuse in other processes; the digest contains no raw configuration text. JSON or Basic
  mode retains its process-wide clear.
- Workspace snapshots and administrator recovery never expose, import, save, or promote EPM.
- The cleanup migration archives and removes only misplaced workspace EPM, does not infer an owner, and
  supports downgrade restoration without overwriting newer administrator fields.
- Legacy import sends EPM only to the importing user's private default view, sends groups only to shared
  group storage, and discards top-level legacy `teamCatalog` as a regenerable cache rather than placing it
  in a private view. Existing workspace catalog rows remain unchanged.
- `401` always enters the global auth-required lock. It never means “not an admin,” never renders as a
  feature/configuration error, and never clears dirty state or retries a failed mutation.

## Endpoint Contract

Unsafe OAuth writes require an authenticated session, `X-Requested-With: jira-execution-planner`, and the
token-bound `X-CSRF-Token`. The read-like preview POST uses a dedicated `authenticated_preview` policy
with the same unsafe-request and CSRF checks but no administrator or persistence permission.

| Route | Policy | Request | Success | Stable errors |
| --- | --- | --- | --- | --- |
| `GET /api/config?includeViewConfig=true` | `authenticated_read` | none | shared admin snapshot/revision plus one resolved private view; `epm` comes from that view | `401 auth_required`, `503 config_storage_unavailable` |
| `GET /api/epm/config` | `authenticated_read` | none | normalized current-user settings plus optional private `viewConfigId`; empty normalized defaults when no default exists | `401 auth_required`, `503 config_storage_unavailable` |
| `POST /api/epm/config` | `user_write` | exact EPM settings object; no identity, credential, workspace id, `tab`, `selectedSprint`, or `baseRevision` | normalized saved settings plus `viewConfigId` | `400 invalid_epm_config`, `401 auth_required`, `403 csrf_required`, `503 config_storage_unavailable`; never `admin_required` |
| `POST /api/epm/projects/configuration` and `/api/epm/projects/preview` | `authenticated_preview` | exact EPM settings draft | derived candidates; no persistence | `400 invalid_epm_config`, `401 auth_required`, `403 csrf_required`, `409 home_user_token_required`, `503 config_storage_unavailable` |
| `GET/POST /api/groups-config` | `authenticated_read` / `user_write` | existing revisioned group payload | existing shared group snapshot | `400`, `401 auth_required`, `403 csrf_required`, `409 group_config_conflict`, `503`; never `admin_required` |
| `GET/POST/PATCH /api/me/views` | `user_write` | POST creates; payload-replacing PATCH requires current `baseVersion` | private view with `versionNumber` | `400 invalid_view_payload`, `401 auth_required`, `403 csrf_required`, `404 view_not_found`, `409 view_config_conflict`, `503` |

The strict EPM settings schema is:

```json
{
  "version": 2,
  "labelPrefix": "portfolio_project_*",
  "scope": {
    "rootGoalKey": "ROOT-A",
    "subGoalKeys": ["GOAL-B"]
  },
  "issueTypes": {
    "initiative": ["Initiative"],
    "epic": ["Epic"],
    "leaf": ["Story"]
  },
  "projects": {
    "project-a": {
      "id": "project-a",
      "name": "Example project",
      "label": "portfolio_project_a",
      "homeProjectId": "home-project-a"
    }
  }
}
```

Each v2 project row accepts exactly `id`, `name`, `label`, and optional `homeProjectId`.
`homeProjectId`, when present, must be either a non-empty string for a Home-backed project or explicit
`null` for a custom project. Normalization trims and preserves a non-empty Home id. It accepts `null` as
the custom-row marker and omits that field from normalized storage/output, matching the existing
`normalize_epm_config()` contract. Empty strings and all other types return `400 invalid_epm_config`.

Unknown fields, malformed nested values, identity fields, and credential material return fixed
`400 invalid_epm_config` text. Storage/configuration/integrity failures return fixed
`503 config_storage_unavailable` text and log only the operation plus exception class. Responses may
contain configured goal keys, project ids, and labels because those are EPM settings. They must not add
actor, user, workspace, connection, token, or credential metadata. Logs, committed fixtures, examples,
and docs use synthetic identifiers only.

## File Map

### Backend ownership and private-view writes

- Modify: `backend/config/shared_config.py`
- Modify: `backend/config/view_validation.py`
- Modify: `backend/config/db_repository.py`
- Create: `backend/services/user_view_config.py`
- Modify: `backend/routes/views_routes.py`

### Runtime resolver, policy, bootstrap, and cache isolation

- Modify: `jira_server.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/security/policy.py`
- Modify: `backend/security/guards.py`
- Modify: `backend/auth/cache_policy.py`
- Modify: `backend/epm/config.py`
- Modify: `backend/epm/projects.py`
- Modify: `backend/epm/issues.py`
- Modify: `backend/epm/rollup.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `backend/routes/views_routes.py`
- Modify: `backend/services/user_view_config.py`

### Migration and import

- Create: `backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py`
- Modify: `backend/config/import_config.py`
- Modify: `backend/services/user_view_config.py`
- Modify: `backend/services/workspace_dashboard_config.py`

### Frontend EPM ownership

- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/api/epmApi.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/settings/workspaceConfigConflict.js`

### Global authentication lock

- Create: `frontend/src/api/authRequired.js`
- Create: `frontend/src/components/AuthRequiredGate.jsx`
- Modify: `frontend/src/analytics/analytics.js`
- Modify: `frontend/src/api/http.js`
- Modify application API modules containing native `fetch(`
- Modify: `frontend/src/api/authFocusRefresh.js`
- Modify auth-error feature hooks and Settings utilities named in Task 5
- Modify: `frontend/src/styles/shared/shell.css`

### Generated output and documentation

- Generated: `frontend/dist/auth-focus-refresh.js`
- Generated: `frontend/dist/auth-focus-refresh.js.map`
- Generated: `frontend/dist/dashboard.js`
- Generated: `frontend/dist/dashboard.js.map`
- Generated: `frontend/dist/dashboard.css`
- Ownership, analytics, status, and plan docs named in Task 6

---

### Task 1: Restore Ownership Validation And Serialize Private-View Writes

**Files:**

- Modify: `backend/config/shared_config.py`
- Modify: `backend/config/view_validation.py`
- Modify: `backend/config/db_repository.py`
- Create: `backend/services/user_view_config.py`
- Modify: `backend/routes/views_routes.py`
- Test: `tests/test_shared_admin_config_validation.py`
- Test: `tests/test_view_config_validator.py`
- Test: `tests/test_view_config_resolution.py`
- Test: `tests/test_user_view_config_routes.py`
- Create: `tests/test_user_view_config_concurrency.py`

- [x] **Step 1: Write failing ownership, strict-validation, and concurrency tests**

Prove the administrator allowlist excludes `epm`; private views accept only normalized EPM settings plus
the existing private `tab`/`selectedSprint` keys; workspace validation rejects `epm`; and private views
reject `teamGroups`, `teamCatalog`, workspace identity, user identity, and credential material.
Strict project-row tests must accept and preserve a non-empty string `homeProjectId`, accept explicit
`null` for a custom row and omit it from canonical output, and reject empty strings or other types.

Add overlapping transaction tests for:

- two EPM saves against an existing default view;
- two first saves racing to create the default;
- one EPM save overlapping a stale whole-view payload PATCH, which must return
  `409 view_config_conflict` rather than overwrite EPM;
- one EPM first save overlapping `/api/me/views` POST with `isDefault=true` and one overlapping a default
  switch PATCH;
- one user in two workspaces and two users in one workspace;
- strictly increasing unique `ViewConfigVersion.version_number` values and preservation of unrelated keys.

SQLite tests cover validation, bounded retry, optimistic-conflict behavior, and the mutation service's
effective-EPM change result. The result must be true only when the normalized effective default EPM value
changes through direct save, default-view payload replacement, default create/switch/demotion/archive, or
legacy-import mutation. It remains false for rename-only or non-default-view changes, identical effective
EPM values, conflicts, validation failures, retry exhaustion, and rollback.

Add `PostgresUserViewConcurrencyGateTests` in the same test module. When
`REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1`, it must fail rather than skip unless `TEST_DATABASE_URL` is an
explicit PostgreSQL URL. It must never read `DATABASE_URL`. In a UUID-named temporary schema and with two
independent connections, prove same owner/workspace mutations serialize, first-default races create only
one default, two last-write-wins EPM saves produce two unique monotonic versions and one complete winning
payload without losing unrelated private fields, stale whole-view replacement conflicts, and a held lock
for one owner/workspace does not block a different owner or workspace. Drop the schema in `finally`.

Run:

```bash
.venv/bin/python -m unittest tests.test_shared_admin_config_validation tests.test_view_config_validator tests.test_view_config_resolution tests.test_user_view_config_routes tests.test_user_view_config_concurrency
```

Expected: FAIL because EPM is administrator-owned and view mutation/version allocation is not serialized.

- [x] **Step 2: Implement one serialized private-view mutation service**

Define storage-neutral `normalize_epm_settings_payload()` accepting exactly `version`, `labelPrefix`,
`scope`, `issueTypes`, and `projects`; validate nested shapes before calling `normalize_epm_config()`.
Whole-private-view validation may also allow `epm.tab` and `epm.selectedSprint`, but an EPM settings POST
may not write them.

Create one service used by `DbConfigRepository.save_user_epm_config()` and all `/api/me/views` POST/PATCH
operations that create, mutate, archive, or switch a default:

- acquire a PostgreSQL transaction-scoped advisory lock derived from request-owned workspace/user ids,
  then select the target with `FOR UPDATE`; use an immediate write transaction on SQLite;
- select by request-derived `workspace_id`, `owner_user_id`, `visibility='private'`, and non-archived id;
- create a default private row only when no default exists;
- retry a default unique/integrity race at most three times, then raise a typed storage error;
- apply a caller-supplied mutation to the latest committed payload;
- allocate and append the next version in the same transaction;
- never derive workspace/user identity from a request payload.

Resolve and normalize the effective default EPM value immediately before and after each mutation inside
that serialized transaction. Return an immutable mutation result containing the sanitized view/version
response and `effective_epm_changed`; do not call cache code while the transaction is open. A
transaction-owning wrapper may invoke an injected post-commit callback only after `session_scope()` exits
successfully. Exceptions, rollbacks, conflicts, and exhausted retries produce no callback. Task 2 wires
the partition-aware cache invalidator to this contract, and Task 3 routes legacy import through it.

Expose the current latest `versionNumber` in view responses. Require `baseVersion` when PATCH replaces
`view`/`payload`; compare it inside the serialized transaction and return the current sanitized view plus
`409 view_config_conflict` on mismatch. Name/default/archive-only PATCHes still serialize but do not claim
field-level merging. Strict v2 EPM validation accepts project `label`; HTTP v2 `jiraLabel` is rejected.

`save_user_epm_config()` merges only the five normalized settings keys into `payload.epm`, preserves
existing private state and unrelated fields, updates `view_type`, and uses change note `user EPM update`.
`load_user_epm_config()` returns normalized defaults without creating a row.

- [x] **Step 3: Run focused tests and commit**

```bash
.venv/bin/python -m unittest tests.test_shared_admin_config_validation tests.test_view_config_validator tests.test_view_config_resolution tests.test_user_view_config_routes tests.test_user_view_config_concurrency
REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1 .venv/bin/python -m unittest -v tests.test_user_view_config_concurrency.PostgresUserViewConcurrencyGateTests
git diff --check
git add backend/config/shared_config.py backend/config/view_validation.py backend/config/db_repository.py backend/services/user_view_config.py backend/routes/views_routes.py tests/test_shared_admin_config_validation.py tests/test_view_config_validator.py tests/test_view_config_resolution.py tests/test_user_view_config_routes.py tests/test_user_view_config_concurrency.py
git commit -m "Restore serialized user-owned EPM persistence"
```

Expected: focused tests pass; the PostgreSQL gate exits `0` without skips against the explicitly supplied
`TEST_DATABASE_URL`; the commit contains only validation and private-view mutation behavior. If the URL
is unavailable, stop before this commit and request a safe test database or an authorized disposable
local PostgreSQL instance.

### Task 2: Route Every EPM Consumer Through The Private Source

**Files:**

- Modify: `jira_server.py`
- Modify: `backend/routes/epm_routes.py`
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/security/policy.py`
- Modify: `backend/security/guards.py`
- Modify: `backend/auth/cache_policy.py`
- Modify: `backend/epm/config.py`
- Modify: `backend/epm/projects.py`
- Modify: `backend/epm/issues.py`
- Modify: `backend/epm/rollup.py`
- Modify: `backend/routes/auth_routes.py`
- Modify: `backend/routes/views_routes.py`
- Test: `tests/test_epm_config_api.py`
- Test: `tests/test_epm_scope_api.py`
- Test: `tests/test_epm_projects_api.py`
- Test: `tests/test_epm_rollup_api.py`
- Test: `tests/test_db_oauth_cutover.py`
- Test: `tests/test_epm_home_cache_isolation.py`
- Test: `tests/test_dashboard_bootstrap_config_source.py`
- Test: `tests/test_endpoint_security_matrix.py`
- Test: `tests/test_endpoint_policy_inventory.py`
- Test: `tests/test_oauth_settings_routes.py`
- Test: `tests/test_workspace_dashboard_config_service.py`
- Test: `tests/test_user_view_config_routes.py`

- [x] **Step 1: Write failing route, runtime, policy, cache, and bootstrap tests**

Cover normal-user EPM GET/POST, strict JSON and content-type failures, fixed storage failure bodies/log
redaction, JSON-mode parity, two-user/two-workspace isolation, missing default, unrelated private fields,
and no workspace revision change. Include Home-backed project saves with a preserved string
`homeProjectId` and custom-project saves with accepted `null` and canonical omission.

Exercise the real runtime call graph for `/api/epm/scope`, `/api/epm/projects`, project issues,
per-project rollup, all-project rollup, and the Home OAuth probe with different private settings for two
users. Add a no-request-context worker test that reaches the real resolver through captured rollup
dependencies; an uncaptured DB resolver call must fail closed rather than use workspace/default data.

Warm project, issue, and rollup entries for two users and two workspaces. Prove direct EPM save, payload
replacement of the current default, default creation/promotion/demotion/archive, and default switching
evict exactly the active DB/OAuth partition when and only when the normalized effective EPM value changes.
Another user and another workspace remain cached. Rename-only, non-default payload edits, identical
effective EPM, validation failures, stale `baseVersion`, exhausted retries, and forced commit rollback do
not evict. Assert invalidation runs once after commit, never while the transaction is open. Basic/JSON
mode still clears all EPM caches for direct EPM saves. Task 3 adds the same assertions for legacy import.

Prove a stable SHA-256 digest is derived from canonical normalized `version`, `labelPrefix`, `scope`,
`issueTypes`, and `projects`; equivalent normalized objects share a digest, any effective setting change
changes it, `tab`/`selectedSprint` do not affect it, and no raw goal key, label, or project id appears in a
digest component. Existing functional cache-key parts remain unchanged. With local invalidation disabled
to simulate another process, a request using the new digest must miss the old project/issues/rollup
entries. Worker-thread dependencies capture the same digest with the EPM config snapshot.

Policy assertions:

```python
EndpointPolicy('epm-config-write', '/api/epm/config', frozenset({'POST'}), 'user_write')
EndpointPolicy('epm-projects-configuration', '/api/epm/projects/configuration', frozenset({'POST'}), 'authenticated_preview')
EndpointPolicy('epm-projects-preview', '/api/epm/projects/preview', frozenset({'POST'}), 'authenticated_preview')
```

The preview tests cover missing/invalid CSRF, missing `X-Requested-With`, non-admin success, expired auth,
and `409 home_user_token_required`.

- [x] **Step 2: Implement the canonical resolver and exact route contracts**

Make `jira_server.get_epm_config(context=None, source='auto')` the only runtime resolver:

- DB mode loads the private default through an explicit context or the active request context;
- DB mode without either context raises `ConfigStorageError`;
- JSON mode loads stored v1/v2 data through the legacy-aware normalizer; strict v2 validation applies to
  new HTTP writes in both modes;
- `GET /api/epm/config` reuses this resolver.

Capture the resolved EPM object and `RequestAuthContext` before worker-thread handoff. Remove every
functional dependency on `load_dashboard_config()['epm']`, including scope, projects, issues, rollups,
aggregate rollups, and Home probe. Remove EPM from `_environment_dashboard_config_exists()`.

In `/api/config`, resolve the default private view once. When `includeViewConfig=true`, return the complete
private EPM object under `viewConfig.view.epm`, but derive compatibility `epm` through a read extractor
that selects and normalizes only the five EPM settings keys. Otherwise load those settings once through
the same repository. Return `userCanEditEpmConfig: true` for authenticated users and never include EPM in
`sharedConfig`.

Add `authenticated_preview` to the protected and CSRF policy sets without administrator checks. Map
validation to fixed `400 invalid_epm_config` and storage/integrity/retry exhaustion to fixed
`503 config_storage_unavailable`; log no payloads or identifiers.

Add cache partition helpers in `backend/auth/cache_policy.py` and let `clear_epm_caches(context)` remove
only matching tuple-prefixed keys in DB/OAuth mode. Keep full clear for Basic/JSON mode.

Add a canonical EPM cache-generation helper beside the EPM normalizer. Hash the stable serialized form of
only the five normalized settings keys with SHA-256 and add the digest, never the raw configuration, to
every projects/issues/rollup cache key. Capture it before worker handoff with the normalized config. This
generation is the cross-process correctness boundary; post-commit partition eviction is eager local
cleanup and must still cover every effective-view mutation path.

Wire `clear_epm_caches(context)` as an injected post-commit callback on the serialized mutation wrapper
used by both `DbConfigRepository.save_user_epm_config()` and `/api/me/views` writes. Do not import
`jira_server` from the storage service. Route functions must leave `session_scope()` before invoking the
callback; do not return from inside the transaction in a way that bypasses the post-commit step. Compute
the decision from the service's normalized before/after effective EPM result, not from the endpoint name:
non-default and metadata-only mutations must remain cache-neutral, while default create/switch/demotion/
archive and current-default replacement invalidate when their effective value changes.

- [x] **Step 3: Run focused tests and commit**

```bash
.venv/bin/python -m unittest tests.test_epm_config_api tests.test_epm_scope_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_db_oauth_cutover tests.test_epm_home_cache_isolation tests.test_dashboard_bootstrap_config_source tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_oauth_settings_routes tests.test_workspace_dashboard_config_service tests.test_user_view_config_routes
git diff --check
git add jira_server.py backend/routes/auth_routes.py backend/routes/epm_routes.py backend/routes/settings_routes.py backend/routes/views_routes.py backend/security/policy.py backend/security/guards.py backend/auth/cache_policy.py backend/epm/config.py backend/epm/projects.py backend/epm/issues.py backend/epm/rollup.py backend/services/user_view_config.py tests/test_epm_config_api.py tests/test_epm_scope_api.py tests/test_epm_projects_api.py tests/test_epm_rollup_api.py tests/test_db_oauth_cutover.py tests/test_epm_home_cache_isolation.py tests/test_dashboard_bootstrap_config_source.py tests/test_endpoint_security_matrix.py tests/test_endpoint_policy_inventory.py tests/test_oauth_settings_routes.py tests/test_workspace_dashboard_config_service.py tests/test_user_view_config_routes.py docs/plans/EXEC-user-owned-epm-configuration.md
git commit -m "Route EPM runtime through private user settings"
```

Expected: all focused tests pass; administrator routes remain `shared_admin_write`, groups remain
`authenticated_read`/`user_write`, EPM functional results differ by authenticated owner, and every
effective-view mutation path implemented so far follows the same post-commit partition invalidation rule.

### Task 3: Migrate Workspace Data Reversibly And Correct Legacy Import

**Files:**

- Create: `backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py`
- Modify: `backend/config/import_config.py`
- Modify: `backend/services/user_view_config.py`
- Modify: `backend/services/workspace_dashboard_config.py`
- Modify: `README.md`
- Test: `tests/test_db_migrations.py`
- Test: `tests/test_config_jsonfile_fallback.py`
- Test: `tests/test_shared_admin_config_recovery.py`
- Test: `tests/test_shared_group_config_import.py`
- Test: `tests/test_view_config_validator.py`
- Test: `tests/test_epm_home_cache_isolation.py`

- [x] **Step 1: Write failing migration, downgrade, import, and ownership-isolation tests**

Test SQLite upgrade, downgrade, and re-upgrade; PostgreSQL offline upgrade and offline downgrade SQL
rendering; changed and unchanged
rows; scalar/malformed payload handling; revision movement; and exact EPM restoration on downgrade while
preserving administrator fields changed after upgrade.

Assert the migration does not create/update user views or versions and does not change
`workspace_group_configs`, `user_group_preferences`, `workspace_team_catalogs`, `auth_connections`, or
`auth_tokens`.

Import tests prove:

- EPM enters only the importing user's default private view;
- shared groups enter only group storage;
- top-level legacy `teamCatalog` is discarded and never appears in a view/version/admin payload;
- existing team-catalog, preferences, connections, and tokens remain unchanged;
- import uses the serialized private-view mutation path;
- an import that creates or changes the effective default EPM value invalidates the importing user's
  partition once after commit, while an idempotent duplicate, unchanged effective EPM, validation failure,
  or forced rollback does not invalidate and never touches another user/workspace partition.

- [x] **Step 2: Implement a reversible migration-owned archive**

The `20260827_0008` upgrade runs while the application is quiesced and:

1. creates migration-only `workspace_epm_config_migration_archive` keyed by workspace with the exact
   removed EPM JSON and original revision;
2. archives rows whose top-level payload is an object containing `epm`;
3. removes `epm` and increments `config_revision` atomically in dialect-specific SQL;
4. leaves rows without EPM and non-object payloads unchanged.

PostgreSQL casts generic `JSON` through `jsonb` for key removal and back to `JSON`. SQLite uses a
strict Python top-level JSON parser plus parameterized SQL so exact non-EPM value slices are preserved.
Offline upgrade and downgrade both emit equivalent PostgreSQL SQL without opening a connection;
downgrade is not online-only.

Downgrade merges the archived EPM fragment into the row's current payload, increments the current
revision rather than rewinding it, then drops the archive table. It never overwrites newer non-EPM
administrator fields and never infers a private owner. Re-upgrade recreates the archive and removes EPM
again. Document the quiesced deployment and database-backup requirement in the migration docstring and
operator status docs.

Update runtime workspace load/recovery filtering so dormant EPM never reappears before/after migration.
Update legacy import to use the shared serialized view service, preserve private EPM, and strip/discard
top-level `teamCatalog` as a regenerable cache. Remove its independent direct view-write transaction path:
the import must use the same transaction-owning mutation wrapper and injected post-commit invalidator as
the HTTP mutation routes. It must compare normalized effective EPM before/after, commit first, invalidate
only the active partition when changed, and produce no invalidation on duplicate/no-op/failure paths.

- [x] **Step 3: Run focused tests and commit**

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_config_jsonfile_fallback tests.test_shared_admin_config_recovery tests.test_shared_group_config_import tests.test_view_config_validator tests.test_epm_home_cache_isolation
git diff --check
git add backend/db/migrations/versions/20260827_0008_remove_workspace_epm.py backend/config/import_config.py backend/services/user_view_config.py backend/services/workspace_dashboard_config.py tests/test_db_migrations.py tests/test_config_jsonfile_fallback.py tests/test_shared_admin_config_recovery.py tests/test_shared_group_config_import.py tests/test_view_config_validator.py tests/test_epm_home_cache_isolation.py
git commit -m "Remove workspace EPM with reversible migration"
```

Expected: upgrade/downgrade/offline/import tests pass with no inferred owner, no cross-domain writes, and
legacy import following the same post-commit effective-EPM invalidation contract as HTTP mutations.

### Task 4: Separate Frontend EPM Ownership And Permissions

**Files:**

- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/api/epmApi.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/settings/workspaceConfigConflict.js`
- Modify: `tests/test_frontend_api_source_guards.js`
- Modify: `tests/test_epm_settings_source_guards.js`
- Modify: `tests/test_auth_isolation_source_guard.js`
- Modify: `tests/ui/settings_unified_save.spec.js`
- Modify: `tests/ui/settings_admin_access.spec.js`
- Modify: `tests/ui/shared_department_groups.spec.js`
- Generated frontend files listed in the File Map

- [x] **Step 1: Write failing frontend ownership and permission tests**

Assert private EPM bootstrap wins even if a stale `sharedConfig.epm` fixture exists; EPM saves send only
the strict settings object; no `baseRevision`, identity, `tab`, or `selectedSprint` is sent; EPM saving
never calls `commitSharedConfigRevision`; and `canEditEpmConfiguration` is fail-closed until explicit
`userCanEditEpmConfig === true`.
Assert the save payload keeps a Home-backed row's string `homeProjectId` and sends explicit `null` for a
custom row, without restoring legacy `jiraLabel`.

Add Playwright coverage for admin and non-admin users, missing/false/true permission flags, one settings
Save persisting each dirty section through its own endpoint, workspace “Use latest” leaving dirty EPM
untouched, and no EPM save posting an administrator endpoint.

- [x] **Step 2: Implement independent private EPM UI behavior**

Change `saveEpmConfig(backendUrl, draftConfig)` to post only the normalized EPM settings payload with the
existing unsafe-request headers. Seed EPM from `config.viewConfig?.view?.epm || config.epm`, never from
`sharedConfig.epm`. Keep browser-private `epmTab` and selected sprint behavior unchanged and out of EPM
settings saves.

Keep EPM dirty/save state outside `workspaceConfigConflict`; administrator “Use latest” may refresh admin
drafts but cannot reset a dirty EPM draft. Keep the existing auth-recovery presentation working in this
intermediate commit and preserve drafts/baselines on `401`; Task 5 replaces every feature-owned recovery
path atomically after the shared typed contract and root gate exist.

- [x] **Step 3: Build, verify, and commit**

```bash
node --test tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js tests/test_auth_isolation_source_guard.js
npx playwright test tests/ui/settings_unified_save.spec.js tests/ui/settings_admin_access.spec.js tests/ui/shared_department_groups.spec.js
npm run build
git diff --check
git add frontend/src/api/configApi.js frontend/src/api/epmApi.js frontend/src/dashboard.jsx frontend/src/settings/workspaceConfigConflict.js tests/test_frontend_api_source_guards.js tests/test_epm_settings_source_guards.js tests/test_auth_isolation_source_guard.js tests/ui/settings_unified_save.spec.js tests/ui/settings_admin_access.spec.js tests/ui/shared_department_groups.spec.js frontend/dist/auth-focus-refresh.js frontend/dist/auth-focus-refresh.js.map frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css docs/plans/EXEC-user-owned-epm-configuration.md
git commit -m "Separate EPM settings from admin saves"
```

Expected: focused tests/build pass; generated output matches source; EPM is separated from administrator
revision/conflict state without creating an intermediate broken auth-recovery path.

### Task 5: Add The Global Application Authentication Lock

**Files:**

- Modify: `backend/routes/auth_routes.py`
- Create: `frontend/src/api/authRequired.js`
- Create: `frontend/src/components/AuthRequiredGate.jsx`
- Modify: `frontend/src/analytics/analytics.js`
- Modify: `frontend/src/api/http.js`
- Modify: `frontend/src/api/analyticsApi.js`
- Modify: `frontend/src/api/authApi.js`
- Modify: `frontend/src/api/authFocusRefresh.js`
- Modify: `frontend/src/api/configApi.js`
- Modify: `frontend/src/api/engApi.js`
- Modify: `frontend/src/api/epmApi.js`
- Modify: `frontend/src/api/issuesApi.js`
- Modify: `frontend/src/api/jiraCatalogApi.js`
- Modify: `frontend/src/api/scenarioApi.js`
- Modify: `frontend/src/eng/useEngSprintData.js`
- Modify: `frontend/src/eng/useEngPriorityTransitions.js`
- Modify: `frontend/src/eng/useEngProjectTrackTransitions.js`
- Modify: `frontend/src/eng/useEngStatusTransitions.js`
- Modify: `frontend/src/eng/EngBoardView.jsx`
- Modify: `frontend/src/eng/EngBoardEpicPanel.jsx`
- Modify: `frontend/src/epm/useEpmViewData.js`
- Modify: `frontend/src/issues/useStorySubtasks.js`
- Modify: `frontend/src/settings/AdminAccessSettings.jsx`
- Modify: `frontend/src/settings/GroupBoardSettings.jsx`
- Modify: `frontend/src/settings/groupVisibilityUtils.js`
- Modify: `frontend/src/settings/sharedExcludedCapacityToggle.js`
- Modify: `frontend/src/settings/useGroupVisibilityPreferences.js`
- Modify: `frontend/src/settings/FirstRunGroupSelectionModal.jsx`
- Modify: `frontend/src/settings/TeamGroupsSettings.jsx`
- Modify: `frontend/src/settings/UserConnectionsSettings.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/styles/shared/shell.css`
- Modify: `tests/test_auth_entry_page.py`
- Modify: `tests/test_auth_routes.py`
- Modify: `tests/test_analytics_events.js`
- Create: `tests/test_auth_required.js`
- Modify: `tests/test_auth_focus_refresh.js`
- Modify: `tests/test_auth_isolation_source_guard.js`
- Modify: `tests/test_frontend_api_source_guards.js`
- Modify: `tests/test_eng_auth_recovery_message.js`
- Modify: `tests/test_eng_board_runtime_source_guards.js`
- Modify: `tests/test_epm_settings_source_guards.js`
- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `tests/test_excluded_capacity_stats_source_guards.js`
- Modify: `tests/test_story_subtasks.js`
- Modify: `tests/test_group_visibility_utils.js`
- Modify: `tests/test_planning_action_source_guards.js`
- Create: `tests/ui/global_auth_lock.spec.js`
- Modify: `tests/ui/auth_focus_refresh_counts.spec.js`
- Modify: `tests/ui/shared_department_groups.spec.js`
- Modify: `tests/ui/settings_unified_save.spec.js`
- Modify: `tests/ui/scenario_draft_collaboration.spec.js`
- Modify: `tests/ui/ga4_tag_and_events.spec.js`
- Modify: `tests/ui/eng_priority_transitions.spec.js`
- Modify: `tests/ui/eng_project_track_transitions.spec.js`
- Modify: `tests/ui/eng_status_transitions.spec.js`
- Modify: `tests/ui/eng_group_board_settings_tab.spec.js`
- Modify: `tests/ui/home_token_connection_settings.spec.js`
- Modify: `tests/ui/settings_admin_access.spec.js`
- Modify: `docs/README_ANALYTICS.md`
- Generated frontend files listed in the File Map

- [x] **Step 1: Write failing auth-contract, source, feature-state, analytics, and Playwright tests**

Implement every unit and Playwright assertion from the global-auth design. The source guard must prove
native application API `fetch(` exists only inside `frontend/src/api/http.js`. Replace immediate-redirect
assertions with latch publication and no `location.assign`.

Test bootstrap/ENG/group/EPM `401`, malformed bodies, same-origin absolute login URLs, unsafe URLs,
parallel failures, a refresh `401` before dashboard mount, locked request suppression, an older concurrent
`200` rejected after lock, dirty-save preservation until navigation, no mutation replay,
keyboard/poll/SSE suspension, and negative `403 admin_required`,
`403 csrf_required`, and `409 home_user_token_required` cases.

Backend recovery-entry tests must prove that `session_expired` and `missing_scope` do not redirect an
otherwise valid local session back to `/`, and that only missing-scope recovery starts OAuth with
`prompt=consent`. Update the existing auth-entry source guard to expect `apiFetch` instead of a native
auth-refresh `fetch`.

When analytics was already initialized and enabled, assert one `app_error_shown` per lock episode with
only:

```text
error_area=auth
error_code=auth_required
recoverable_state=reauth
source_surface=app
```

When bootstrap authentication fails before analytics initialization, or analytics is disabled, assert
zero events and no late analytics-context request. The auth lock must not queue an event for later replay.

- [x] **Step 2: Implement the common HTTP boundary and root gate**

Follow `docs/agents/bugfixes/2026-08-27-planned-global-auth-lock.md` exactly. Add the window-backed latch
shared by both frontend bundles, strict login sanitizer, typed error, pre/post-response `apiFetch` guards,
terminal root gate, and fixed analytics event. Move every API module to the shared fetch path.

Update `auth_entry_page()` so recognized terminal reasons bypass its normal authenticated-user redirect:
`session_expired` renders a standard Atlassian sign-in action and `missing_scope` renders an action that
starts OAuth with `prompt=consent`. Unsupported or absent reasons retain the existing redirect behavior.
This is an entry-flow correction only; it does not change API authorization or response schemas.

Feature catches must return early on the typed auth error before clearing groups, EPM settings, Home
connection status, projects, issues, rollups, tasks, or drafts. Remove feature-owned redirects and local
sign-in links. While locked, block every new API request, disable global keyboard effects,
and close Scenario EventSource. The companion poll remains a status-aware SSE failure detector before
lock, but is suppressed with every other request after lock. Apply the same preservation rule to
`UserConnectionsSettings`: auth failures must not replace a known connection with `{ connected: false }`
or expose a local error. Apply it explicitly to board status catalogs, epic descriptions, group-board
status catalogs, administrator membership loads, and excluded-capacity saves so those catches neither
replace hidden state nor render a feature error after the root gate has locked.

- [x] **Step 3: Build, verify, and commit**

```bash
.venv/bin/python -m unittest tests.test_auth_entry_page tests.test_auth_routes
node --test tests/test_analytics_events.js tests/test_auth_required.js tests/test_auth_focus_refresh.js tests/test_auth_isolation_source_guard.js tests/test_frontend_api_source_guards.js tests/test_eng_auth_recovery_message.js tests/test_eng_board_runtime_source_guards.js tests/test_epm_settings_source_guards.js tests/test_epm_view_source_guards.js tests/test_excluded_capacity_stats_source_guards.js tests/test_story_subtasks.js tests/test_group_visibility_utils.js tests/test_planning_action_source_guards.js
npx playwright test tests/ui/global_auth_lock.spec.js tests/ui/auth_focus_refresh_counts.spec.js tests/ui/shared_department_groups.spec.js tests/ui/settings_unified_save.spec.js tests/ui/scenario_draft_collaboration.spec.js tests/ui/ga4_tag_and_events.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_project_track_transitions.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_group_board_settings_tab.spec.js tests/ui/home_token_connection_settings.spec.js tests/ui/settings_admin_access.spec.js
npm run build
git diff --check
git add backend/routes/auth_routes.py frontend/src/api/authRequired.js frontend/src/components/AuthRequiredGate.jsx frontend/src/analytics/analytics.js frontend/src/api/http.js frontend/src/api/analyticsApi.js frontend/src/api/authApi.js frontend/src/api/authFocusRefresh.js frontend/src/api/configApi.js frontend/src/api/engApi.js frontend/src/api/epmApi.js frontend/src/api/issuesApi.js frontend/src/api/jiraCatalogApi.js frontend/src/api/scenarioApi.js frontend/src/eng/EngBoardView.jsx frontend/src/eng/EngBoardEpicPanel.jsx frontend/src/eng/useEngSprintData.js frontend/src/eng/useEngPriorityTransitions.js frontend/src/eng/useEngProjectTrackTransitions.js frontend/src/eng/useEngStatusTransitions.js frontend/src/epm/useEpmViewData.js frontend/src/issues/useStorySubtasks.js frontend/src/settings/AdminAccessSettings.jsx frontend/src/settings/GroupBoardSettings.jsx frontend/src/settings/groupVisibilityUtils.js frontend/src/settings/sharedExcludedCapacityToggle.js frontend/src/settings/useGroupVisibilityPreferences.js frontend/src/settings/FirstRunGroupSelectionModal.jsx frontend/src/settings/TeamGroupsSettings.jsx frontend/src/settings/UserConnectionsSettings.jsx frontend/src/dashboard.jsx frontend/src/styles/shared/shell.css tests/test_auth_entry_page.py tests/test_auth_routes.py tests/test_analytics_events.js tests/test_auth_required.js tests/test_auth_focus_refresh.js tests/test_auth_isolation_source_guard.js tests/test_frontend_api_source_guards.js tests/test_eng_auth_recovery_message.js tests/test_eng_board_runtime_source_guards.js tests/test_epm_settings_source_guards.js tests/test_epm_view_source_guards.js tests/test_excluded_capacity_stats_source_guards.js tests/test_story_subtasks.js tests/test_group_visibility_utils.js tests/test_planning_action_source_guards.js tests/ui/global_auth_lock.spec.js tests/ui/auth_focus_refresh_counts.spec.js tests/ui/shared_department_groups.spec.js tests/ui/settings_unified_save.spec.js tests/ui/scenario_draft_collaboration.spec.js tests/ui/ga4_tag_and_events.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_project_track_transitions.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_group_board_settings_tab.spec.js tests/ui/home_token_connection_settings.spec.js tests/ui/settings_admin_access.spec.js docs/README_ANALYTICS.md frontend/dist/auth-focus-refresh.js frontend/dist/auth-focus-refresh.js.map frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css docs/plans/EXEC-user-owned-epm-configuration.md
git commit -m "Lock the app on authentication expiry"
```

Expected: all focused tests/build pass; no feature renders `401`; same-tab reauthentication starts a new
fully bootstrapped document without replaying the failed request.

### Task 6: Align Ownership Documentation And Run Full Verification

**Files:**

- Modify: `backend/security/CONFIGURATION_OWNERSHIP.md`
- Modify: `AGENTS.md`
- Modify: `docs/plans/DONE-shared-admin-configuration.md`
- Modify: `docs/plans/DONE-03-db-user-configuration.md`
- Modify: `docs/plans/DONE-04-db-user-home-epm-read-token.md`
- Modify: `docs/plans/SUPPORT-db-migration-claude-review-workflow.md`
- Modify: `docs/plans/GATE-05-home-write-capability.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/agents/bugfixes/2026-08-26-executed-shared-admin-configuration.md`
- Modify: `docs/agents/bugfixes/2026-08-27-planned-global-auth-lock.md`
- Modify: `README.md`
- Modify: `docs/plans/EXEC-user-owned-epm-configuration.md`

- [x] **Step 1: Correct current guidance without rewriting historical execution**

Keep PR #130's historical execution record and mark only its shared-EPM decision superseded. Restore
`DONE-03`/`DONE-04` current summaries as authoritative for private EPM. Correct the support workflow to
the current per-user `atlassian_user_api_token` Home-read model and DB token tables.

Document the full ownership matrix, default-private-view behavior, team-catalog import discard, reversible
migration archive, cache isolation, and global `401` lock. Tighten the existing root learning so every app
API `401` globally locks and reauthenticates rather than creating local feature recovery UI.

- [x] **Step 2: Run complete verification**

```bash
node --version
.venv/bin/python scripts/check_startup_preflight.py
REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1 .venv/bin/python -m unittest -v tests.test_user_view_config_concurrency.PostgresUserViewConcurrencyGateTests
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npm run test:frontend:ui
npm run build
git diff --exit-code -- frontend/dist
git diff --check
git status --short
```

Expected: Node reports `v20.x`; every command exits `0`; the PostgreSQL gate runs without a skip against
the explicitly supplied `TEST_DATABASE_URL`; the post-build generated diff is clean. A full-suite skip of
the same PostgreSQL class does not replace the explicit required-gate result.

Start the configured local Flask server with `.venv/bin/python jira_server.py`, verify there are no Python
runtime/dependency warnings before the Flask banner, and exercise `curl -fsS http://127.0.0.1:5050/api/test`
under the configured local auth mode. Stop the server after the check.

- [x] **Step 3: Review the complete branch and commit documentation/status**

```bash
git diff --stat origin/main...HEAD
git log --oneline -8
git diff --check
git add backend/security/CONFIGURATION_OWNERSHIP.md AGENTS.md docs/plans/DONE-shared-admin-configuration.md docs/plans/DONE-03-db-user-configuration.md docs/plans/DONE-04-db-user-home-epm-read-token.md docs/plans/SUPPORT-db-migration-claude-review-workflow.md docs/plans/GATE-05-home-write-capability.md docs/plans/README.md docs/agents/bugfixes/2026-08-26-executed-shared-admin-configuration.md docs/agents/bugfixes/2026-08-27-planned-global-auth-lock.md README.md docs/plans/EXEC-user-owned-epm-configuration.md
git commit -m "Align configuration ownership documentation"
```

Expected: final commit contains only ownership/status/design documentation. Do not rename this plan to
`DONE-*` until implementation is verified and accepted or merged.

## Final Review Checklist

- [x] Every named file exists unless its task marks it `Create`.
- [x] No active runtime path reads EPM from workspace configuration.
- [x] Default private view selection explicitly checks workspace, owner, private visibility, default flag,
  and non-archived state.
- [x] EPM concurrency tests prove monotonic versions and unrelated-field preservation; stale whole-view
  replacement returns `409` instead of overwriting a concurrent EPM save.
- [x] The required PostgreSQL concurrency class passes without skips using two independent connections in
  a disposable schema from `TEST_DATABASE_URL`; SQLite and offline SQL are not accepted as substitutes.
- [x] Two-user and two-workspace tests cover EPM, groups, preferences, catalog, connections, and untouched
  ownership domains with row-count/payload assertions.
- [x] Migration tests prove archive, upgrade, downgrade, re-upgrade, offline SQL, revision movement, and no
  inferred private owner.
- [x] JSON-mode EPM GET/POST strict-validation parity is preserved.
- [x] Direct EPM save, effective default payload replacement, default create/switch/demotion/archive, and
  legacy import invalidate only the active DB/OAuth partition after commit when normalized effective EPM
  changes; metadata/non-default/no-op/conflict/validation/retry-failure/rollback paths do not invalidate.
- [x] Every project/issues/rollup cache key includes only a digest of the normalized effective EPM settings,
  so a process that misses local invalidation cannot reuse an older configuration's entry.
- [x] Preview POST requires authentication, requested-with, and CSRF but no admin permission.
- [x] Missing/false EPM edit permission fails closed; explicit true enables editing.
- [x] No app feature/configuration panel renders raw `401`, owns a sign-in redirect, or bypasses `apiFetch`.
- [x] The global auth gate is blocking, accessible, deduplicated, shared across both frontend bundles,
  rejects late responses after lock, and remains terminal until same-tab sign-in navigation.
- [x] Full Python, Node unit, Playwright, preflight, Flask startup/API, and clean frontend build checks pass.
- [x] Before push: review `git log --oneline -5`, summarize verification, and wait for explicit user
  confirmation.
