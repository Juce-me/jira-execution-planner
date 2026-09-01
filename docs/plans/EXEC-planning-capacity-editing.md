# Planning Team Capacity Editing Implementation Plan

> **Status:** Implemented with changes and verified on `feature/planning-capacity-editing`; pending integration into `main`.

## Outcome

Implemented with changes. ENG Planning now reads Capacity targets from the workspace-shared dashboard configuration, exposes the Jira issue and single-card editor only for signed-in OAuth users with a provider-reported write grant, saves through the signed-in user's Jira context, and preserves one scoped Capacity read for the selected sprint/team set. The approved hover, single-editor, compact equal-height controls, Enter/Escape behavior, microbar gap, conflict handling, responsive layout, analytics, and generated frontend output are covered by automated tests.

## Current Accuracy

This plan records the implementation sequence, but these as-built decisions supersede the earlier task text where they differ:

- Capacity is a revisioned section of the canonical `WorkspaceDashboardConfig`; the planned separate `WorkspaceCapacityConfig` table and online reconciliation model were not retained after merging the shared-configuration architecture from `origin/main`.
- Legacy private saved-view Capacity values are rejected on new writes and sanitized from responses; reads do not mutate stored user rows.
- Application API `401` recovery is owned by the global `AuthRequiredGate`. Capacity cards keep their mounted draft inert while the gate is shown and do not render a second card-local recovery action.
- Jira browse links use the configured Atlassian origin plus `/browse/<issue-key>` and intentionally discard any configured path, query, or fragment.
- The implementation and tests are the source of truth for schema and route details that the completed checklist below describes using the earlier standalone-storage design.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in Atlassian OAuth user open and safely edit the configured Jira Capacity value from a Selected SP by Team card while preserving the existing Planning layout and calculations.

**Architecture:** First move Capacity Project/field ownership out of private DB user views into one revisioned, site-bound workspace configuration used by both Admin settings and capacity routes. Extend the existing single scoped Jira read with issue targets, then add one OAuth-only PATCH route backed by a pure dependency-injected service that revalidates project, summary identity, exact stored field id, requested target, and expected baseline before writing Jira. Keep dashboard-owned capacity data separate from card-local editor state: dashboard state feeds all calculations, while a focused Planning card component owns hover controls, draft/error/conflict behavior and reports successful Jira values through one scope-generation-guarded reconciliation callback.

**Tech Stack:** Python 3.10+, Flask, Jira Cloud REST v3, React 19, CSS, Node test runner, Playwright, esbuild.

**Spec:** docs/plans/SUPPORT-planning-capacity-editing-design.md

**Approved UI Reference:** frontend/src/eng/planning-capacity-editing-prototype.html

## Global Constraints

- Work on feature/planning-capacity-editing in the checkout the user is viewing; do not create another worktree.
- Jira is the only source of capacity values. The only new app storage is the required workspace-owned Admin configuration for Capacity Project/field; do not add a capacity-value cache, override/history table, bulk editor, issue creation, or clear-value action.
- Only Atlassian OAuth mode can write. Jira Browse Projects, issue security, Edit Issues, field configuration, and workflow permissions remain authoritative; tool-admin status is irrelevant.
- Use current_request_auth_context and current_jira_request for Jira writes. Require a provider-reported and provenance-verified `write:jira-work` grant through a context-only auth helper even if `ATLASSIAN_SCOPES` requests it. Requested scopes are never copied into granted scopes; an omitted provider `scope` is unknown and fails closed until reauthentication records a verified grant. Never use Basic headers, service integrations, Home/Townsquare, API-token connections, field-name discovery, or local token-store helpers in the capacity **mutation** domain or route; the existing read-only legacy field-name fallback may remain outside the mutation path for backward compatibility.
- The browser never submits a project key or field id. The route resolves both from the workspace-shared Capacity configuration; DB mode must never fall back to the requester's private ViewConfig.
- A DB Capacity configuration is usable for mutation only when its stored Jira cloud/site identity matches `RequestAuthContext` and its exact custom field has a persisted numeric-schema verification from that same site. Legacy unverified config remains readable but pencils/PATCH stay disabled until an Admin re-saves a Jira-verified numeric field.
- Capacity input accepts JSON numbers that are finite and greater than or equal to zero, including 0. Reject booleans, numeric strings, blanks, null new values, negatives, NaN, and infinity. expectedCapacity must be present and may be null.
- Preserve GET /api/capacity and GET /api/planned-capacity. Both retain capacities and add entries; disabled responses contain capacities: {} and entries: [].
- Do not add hover, focus, link-click, or editor-open requests. One save uses one validation GET and at most one PUT; only an upstream PUT 409 permits one reconciliation GET.
- Preserve a dirty draft on ordinary failure and conflict. Enter/checkmark save; Escape/cancel/outside pointer cancel before submission without a write; blur alone never saves. Once submission begins, cancel/outside/Escape are disabled or ignored because browser abort cannot undo a Jira write that already reached the server.
- Render Jira and pencil actions only for a signed-in Atlassian OAuth user and one unambiguous issue target. Hide them at idle mouse state, reveal on hover/focus, and keep them visible for hoverless input. An unverified shared field may retain the OAuth Jira link but never the pencil.
- Permit exactly one active team editor. While it is open, render no Jira or pencil action rail anywhere in the team grid; the only editor actions are Save and Cancel beside the input.
- Match the approved reference geometry: keep a visible gap between the revealed action rail and microbar; keep the editor input, Save, and Cancel on one row at an identical 28px height; cap the desktop input at 84px and allow it to shrink inside the existing 375px card.
- Preserve idle/edit/submitting Planning card dimensions, team labels, microbars, selected-SP calculations, project splits, sticky order, and Catch Up/Scenario behavior. Error rows may expand to a bounded readable height and align sibling cards; never clip the error to satisfy a fixed-height assertion.
- Reuse IconButton, TrackedExternalLink, buildJiraBrowseLinkAnalytics, and a shared JiraMarkIcon. Do not nest interactive elements or make the whole card a link.
- Reuse the canonical planning_action analytics event with feature_name planning_capacity_edit. Add only the jira_team_capacity API surface; never collect capacity values, issue keys, team/sprint names, Jira URLs, field ids, JQL, or raw errors.
- Do not hand-edit frontend/dist; regenerate it with npm run build and prove reproducibility with two consecutive builds plus a snapshot diff. Run make verify-dist-clean only after explicit commit authorization and a commit containing generated output.
- Use synthetic issue keys, teams, sprints, projects, and Jira responses in committed tests and screenshots.
- Do not stage, commit, push, merge, or rewrite history unless the requester explicitly asks during execution.

## Endpoint Contract Matrix

| Route | Method | Policy/auth | Request | Success | Errors and proof |
| --- | --- | --- | --- | --- | --- |
| /api/capacity/config | GET | authenticated_read; DB-backed OAuth uses workspace DB; local OAuth/Basic use shared JSON | none | 200 {project, fieldId, fieldName, configRevision, source, requiresResolution, mutationEnabled}; unresolved is a blank durable row with positive revision | 503 fixed config_storage_unavailable; no storage text |
| /api/capacity/config | POST | existing shared_admin_write; OAuth X-Requested-With + one-time CSRF; DB requires baseRevision; Jira field catalog checked with current user OAuth | {project, fieldId, fieldName, baseRevision}; identity/schema fields rejected | CAS updates active or unresolved row, stores the catalog's canonical field name, and increments revision after same-site numeric-field verification | 400 invalid/unsupported config or capacity_field_not_numeric; structured auth/403 admin_required; 409 capacity_config_conflict; 502 jira_field_catalog_failed; 503 fixed config_storage_unavailable |
| /api/capacity?sprint=...&teams=... | GET | authenticated_read; existing Basic and OAuth reads; workspace shared config in DB | Query sprint required; teams optional | Existing enabled, sprint, capacities plus entries [{teamName, issueKey, capacity}] and safe mutationEnabled boolean | 400 sprint required; 409 capacity_config_conflict for unresolved shared config; existing structured 401 auth; 502 jira_capacity_fetch_failed; 503 config_storage_unavailable. Canonical and alias responses never include upstream/exception text |
| /api/planned-capacity?sprint=...&teams=... | GET | authenticated_read compatibility alias | Same as canonical GET | Delegates to canonical response unchanged | Same unresolved-config and sanitized error contract as canonical GET plus additive response assertion |
| /api/capacity/<issue_key> | PATCH | dynamic user_write. OAuth: real session, unconditional provider-verified `write:jira-work`, X-Requested-With, one-time CSRF. Local/dev loopback Basic reaches route; remote Basic is hidden | exact {sprintName, teamName, expectedCapacity, capacity}; helper discards extras and route rejects unsupported keys; no project/field ids | 200 {issueKey, teamName, previousCapacity, capacity, result}; result success or already_current | Pre-route: 401 auth/global scope recovery; 403 csrf_required for missing XRW or CSRF; remote Basic 404 {error:not_found}. Route: local Basic 403 jira_oauth_required before parse; 400 input; 401 missing_oauth_scope recovery; 403 capacity_forbidden; 404 issue missing; 409 config/mismatch/conflict/not-editable; 502 update conflict/failure; 503 config storage |

The PATCH route is site/workspace-bound by `RequestAuthContext`, the workspace's unique Capacity configuration row, and Jira visibility. It validates that the issue project equals the configured Capacity Project and that its exact Team info <sprint> - <team> summary identity matches the submitted scope before any PUT. The request never supplies a workspace/site/project/field selector.

Pre-route and route-owned security responses are distinct and tests assert exact key allowlists:

- missing `X-Requested-With`: `403 {"error":"csrf_required","message":"Unsafe OAuth requests require X-Requested-With: jira-execution-planner"}`;
- missing, invalid, or consumed CSRF: `403 {"error":"csrf_required","message":"A valid CSRF token is required for this request."}`;
- session missing any operator-configured OAuth scope in the global guard, or carrying only unverified/unknown scope provenance: `401 {"error":"auth_required","loginUrl":"/login?reason=missing_scope"}`. This pre-route response wins when `ATLASSIAN_SCOPES` itself includes the missing write scope;
- context missing the unconditional route-owned `write:jira-work`: `401 {"error":"missing_oauth_scope","message":"Your Jira sign-in needs updated permissions.","recoveryUrl":"/login?reason=missing_scope"}` when operator configuration omits write and therefore the global guard does not reject it first;
- non-loopback Basic: `404 {"error":"not_found"}` before route code;
- local/dev loopback Basic, including malformed JSON: `403 {"error":"jira_oauth_required"}` before parsing;
- shared config storage failure: `503 {"error":"config_storage_unavailable","message":"Configuration storage is temporarily unavailable."}`.

Every global-guard `DatabaseConfigurationError` path uses that fixed storage response too. Neither the authenticated-read, CSRF, nor Admin guard may serialize `str(error)` before a capacity route can sanitize it.

## UI State Machine

| State/event | Required transition |
| --- | --- |
| Idle matched card | Hover/focus reveals Jira plus pencil; Jira opens exact issue; pencil opens Editing |
| Idle missing/ambiguous card | No Jira or pencil actions; readable SP card remains |
| Editing open | Capture issue key, sprint, team, expected raw capacity; seed 0 as 0 and null as blank; focus/select input; render exactly one editor and no Jira/pencil rails anywhere in the team grid |
| Draft input | Preserve raw text; enable save only for changed finite number >= 0 |
| Cancel/Escape/outside pointer before submit | Discard draft/error and restore microbar; restore pencil focus for explicit keyboard/button cancel. While submitting, controls are disabled and outside/Escape are ignored because Jira may already have accepted the write |
| Save | Enter/checkmark sends exactly one PATCH and disables editor controls until settled |
| Success/already_current | Apply only if captured sprint plus normalized-team scope signature still equals the active signature and the issue target still matches; update both dashboard capacity maps, close editor, recompute all derived values, restore pencil focus after reorder |
| Validation/permission/upstream failure | Keep editor and draft; show mapped sanitized message; do not mutate capacity maps |
| Stale expected value | If Jira already equals the draft, reconcile as already_current. Otherwise keep draft, replace baseline with currentCapacity, render `blank` copy for null, and allow one new explicit save |
| Target invalid/config changed | Issue missing/mismatch/uneditable suppress only that target after close. capacity_config_missing, capacity_config_unverified, and capacity_config_conflict disable all pencils and immediately make an open editor read-only with its draft preserved. Suppression clears only when a successful capacity GET advances capacityReadRevision |
| Sprint/team scope switch | Abort the superseded GET and browser PATCH, detach the editor without claiming a submitted write was canceled, clear actionable target state, and ignore every late try/catch/finally branch whose monotonic generation/full scope signature is no longer current |
| Successful scoped capacity reread | Atomically install numeric/target maps, advance capacityReadRevision, and clear invalid-target/config-wide suppression. Disabled is a successful read; aborted/error reads do not advance the revision |
| Auth expired/revoked/disabled/missing project | Preserve the draft; use only safe same-origin /login or /auth/ recovery targets, and keep a visible fallback action when redirect is unavailable |
| Reload/remote edit | Manual Refresh and explicit retry start a new capacity GET. expectedCapacity gives best-effort stale-baseline detection, but a Jira edit between validation GET and unconditional PUT can still be overwritten |

## Plan Review

Two independent security, feasibility, and UI review passes plus a final source trace found and resolved: private-view ownership and direct saved-view ingress; non-durable migration conflicts; cross-site legacy seeding; unverified OAuth scope fabrication; guarded-route tests with non-attested context stubs; missing numeric-field attestation; global guard error leakage; one-time CSRF reuse and an inaccessible private CSRF helper; exact-field-id fallback; stale GET and target-remap races; overstated Jira concurrency; unsafe cancel claims; incomplete PUT-409 reconciliation; responsive overflow; raw/adjusted unit ambiguity; auth-recovery, analytics, and body-allowlist gaps; and an impossible pre-commit dist-clean gate. The requester then approved the runnable UI reference, including one-editor-only locking, no Jira/pencil rails while editing, a clear rail-to-microbar gap, and equal-height compact one-row edit controls. The endpoint matrix, state machine, task ordering, existing-path inventory, import/export coverage, and focused/final commands encode the implemented behavior; Jira's documented validation-GET-to-unconditional-PUT race remains an explicit residual risk rather than an unproved compare-and-set claim.

---

### Task 0: Verify Checkout, File Map, And Pinned Runtimes

**Files:**
- Read only: AGENTS.md
- Read only: docs/plans/AGENTS.md
- Modify when required by the gate sweep: every docs/plans/GATE-*.md (`Checked on`/`Last result` only unless its documented probe passes)
- Read only: docs/postmortem/MRT007-*.md
- Read only: docs/postmortem/MRT009-*.md
- Read only: docs/postmortem/MRT010-*.md
- Read only: docs/postmortem/MRT016-*.md
- Read only: frontend/src/eng/planning-capacity-editing-prototype.html
- Read only: .nvmrc
- Read only: package.json
- Read only: every existing `Modify`/`Regenerate` path named in this plan

**Interfaces:**
- Consumes: the active checkout and repository-pinned Python/Node dependency manifests.
- Produces: a verified `feature/planning-capacity-editing` checkout, complete path inventory, Python `.venv`, Node 20.x runtime, installed locked dependencies, and green baseline tests before any red test is added.

- [x] **Step 1: Verify branch, preserve unrelated work, and re-read instructions**

Run:

~~~bash
git branch --show-current
git status --short
cat AGENTS.md
cat docs/plans/AGENTS.md
rg --files docs/plans | rg '/GATE-'
rg --files docs/postmortem | rg 'MRT007|MRT009|MRT010|MRT016'
~~~

Read every listed gate and matching postmortem completely. For each gate, refresh `Checked on`/`Last result` and run its probe only when its required credentials/approved target are available; never mark PASS without the documented output. Expected: branch is `feature/planning-capacity-editing`; only the approved feature documents and required gate metadata refreshes are changed. Stop if implementation would overlap any unrelated user change.

- [x] **Step 2: Verify every existing file in the implementation map**

Use `git ls-files --error-unmatch <path>` for every `Modify` and `Regenerate` path in Tasks 1-8, except `tests/ui/planning_capacity_editing.spec.js`: Task 7 creates it and Task 8 deliberately extends it. `Create` paths and that ordered create-then-modify path are the only allowed initial misses. Also verify the migration head before naming the new revision:

~~~bash
ls -1 backend/db/migrations/versions
git ls-files --error-unmatch backend/db/models.py backend/config/db_repository.py backend/config/import_config.py backend/routes/settings_routes.py backend/routes/capacity_routes.py backend/services/capacity.py backend/security/policy.py docs/security/endpoints.md frontend/src/dashboard.jsx frontend/src/api/configApi.js frontend/src/api/engApi.js frontend/src/eng/planningCapacityUtils.js frontend/src/styles/planning/stat-cards.css
~~~

Expected: every named existing path resolves and the prior Alembic head is `20260604_0006` before creating `20260901_0007`.

- [x] **Step 3: Establish the repository runtimes without host-global installation**

The current checkout may have no `.venv` or `node_modules`, and a host `node` found on PATH may fail before printing a version. If so, use the Codex workspace-dependency loader or the configured Node version manager to select Node 20.x for this shell; do not commit a local absolute runtime path. Then run:

~~~bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e .
node --version
npm ci
~~~

Expected: Python dependencies install in `.venv`, `node --version` reports 20.x, and `npm ci` uses `package-lock.json`. If network-restricted installation is blocked, request the normal dependency-download approval rather than changing manifests or using the broken host runtime.

- [x] **Step 4: Run the focused baseline before red tests**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_capacity_service tests.test_oauth_stats_routes tests.test_config_storage_selector tests.test_oauth_settings_routes
npm run test:frontend:unit
~~~

Expected: PASS. Record any pre-existing failure and stop rather than attributing it to this feature.

---

### Task 1: Establish One Workspace-Shared Capacity Configuration

**Files:**
- Create: backend/db/migrations/versions/20260901_0007_workspace_capacity_config.py
- Create: backend/services/shared_capacity_config.py
- Create: tests/test_shared_capacity_config.py
- Create: tests/test_shared_capacity_config_db.py
- Create: tests/test_shared_capacity_config_routes.py
- Create: tests/test_shared_capacity_config_import.py
- Modify: backend/db/models.py
- Modify: backend/config/db_repository.py
- Modify: backend/config/import_config.py
- Modify: backend/config/view_validation.py
- Modify: backend/routes/settings_routes.py
- Modify: backend/routes/views_routes.py
- Modify: jira_server.py
- Modify: frontend/src/api/configApi.js
- Modify: frontend/src/dashboard.jsx
- Modify: tests/test_config_jsonfile_fallback.py
- Modify: tests/test_db_migrations.py
- Modify: tests/test_user_view_config_routes.py
- Modify: tests/test_view_config_validator.py
- Modify: tests/ui/settings_unified_save.spec.js

**Interfaces:**
- Produces: `WorkspaceCapacityConfig(workspace_id unique, jira_site_url, jira_cloud_id, status active|requires_resolution, project_key, field_id, field_name, field_schema_type, field_verified_at, config_revision, created_by, updated_by, timestamps)`; unresolved rows are materialized blank records, not inferred later from mutable private views.
- Produces: `load_shared_capacity_config(context, fallback_loader, database_url=None) -> {project, fieldId, fieldName, configRevision, source, requiresResolution, mutationEnabled}`.
- Produces: one production compatibility adapter owned by `jira_server.py`, `load_request_capacity_config(context=None, *, source='auto')`: DB-backed OAuth uses `load_shared_capacity_config`; local OAuth and Basic contexts use the explicit shared JSON/operator loader; no-context startup callers must pass `source='jsonfile'`. It never calls itself or reads a private view.
- Produces: `save_shared_capacity_config(context, payload, base_revision, field_catalog: list[dict], database_url=None)` with one conditional update, pure same-site numeric custom-field validation against the route-supplied catalog, and `CapacityConfigConflict(current, requires_resolution=False)`.
- Invariant: DB/OAuth capacity routes and Admin settings never read `capacity` from the current user's private `ViewConfig`; JSON/basic mode preserves the shared `dashboard-config.json` compatibility path.

- [x] **Step 1: Add failing migration and ownership tests**

In `tests/test_shared_capacity_config_db.py`, add upgrade/downgrade tests for the new table, unique workspace constraint, foreign keys, revision/audit columns, and both SQLite/PostgreSQL-compatible metadata. In `tests/test_shared_capacity_config.py`, create two synthetic users sharing one workspace and two users in different site-bound workspaces, then assert:

- the same workspace resolves one identical project/field regardless of user;
- another workspace/site cannot see or overwrite it, even when it uses the same synthetic project and field-id strings;
- request payload workspace/site/user identifiers are rejected rather than trusted;
- a conditional save with the wrong revision raises `CapacityConfigConflict` and returns the current sanitized config;
- simultaneous saves from the same base revision permit one winner and one conflict;
- one identical private-view remnant may be promoted, but multiple distinct remnants materialize one blank `requires_resolution` row at revision 1 before any private payload is stripped; its sanitized response never exposes a candidate;
- unrelated private-view saves after migration cannot erase/change that unresolved marker or cause a remaining candidate to be auto-promoted;
- two Admin resolutions from the marker's base revision permit one CAS winner, advance the row to active, and return the winner to the loser as a normal conflict;
- a legacy shared JSON `capacity` section or operator Capacity environment defaults seed only when normalized `JIRA_URL` matches `context.site_url` and that workspace's Jira identity; a second site using the same project/field strings is never seeded;
- a selected field is accepted only when the current user's same-site `/rest/api/3/field` catalog identifies the exact `customfield_*` id with numeric schema; built-in, missing, non-numeric, and foreign-site ids cause zero Jira PUTs and do not change the shared row.

- [x] **Step 2: Add failing Admin config route and compatibility tests**

In `tests/test_shared_capacity_config_routes.py`, prove `GET /api/capacity/config` returns `{project, fieldId, fieldName, configRevision, source, requiresResolution, mutationEnabled}` for both users in one workspace and isolates another site/workspace. Prove DB `POST`:

- requires existing `shared_admin_write`, X-Requested-With, one-time CSRF, and tool-admin policy;
- requires `baseRevision`, rejects unknown/identity keys, and uses the request context's workspace;
- maps stale revision to `409 {error:'capacity_config_conflict', current:{...}}`; unresolved rows include their real positive revision, blank fields, `requiresResolution:true`, and never any private candidate;
- resolves an unresolved row only through a matching-base-revision CAS after same-site numeric-field verification;
- returns fixed `400 capacity_field_not_numeric` when the exact id is absent, built-in, or non-numeric; returns fixed `502 jira_field_catalog_failed` when the current-site catalog cannot be loaded; neither response exposes Jira/catalog text;
- stores the canonical Jira catalog `name` for the verified id rather than trusting request `fieldName` as attestation;
- maps storage/database failures to fixed `503 {error:'config_storage_unavailable', message:'Configuration storage is temporarily unavailable.'}` without raw text;
- clears the existing `CAPACITY_FIELD_CACHE` only after a successful save.

Extend JSON fallback tests to prove local/basic GET/POST still use the shared JSON file, fall back to existing operator Capacity environment values when the file section is absent, and do not require a DB revision. Extend `tests/ui/settings_unified_save.spec.js` so config load retains `configRevision`, Admin Save sends it as `baseRevision`, and a normal stale conflict preserves the dirty Capacity draft plus a visible reload/review path instead of overwriting. An initial `requiresResolution:true` conflict seeds blank selectors with its materialized revision, shows why an Admin choice is required, and still permits a verified save. In an all-dirty save, already successful endpoint saves keep their updated baselines while Capacity alone remains dirty; do not imply a cross-endpoint transaction or roll back successful unrelated sections.

In `tests/test_user_view_config_routes.py` and `tests/test_view_config_validator.py`, prove every `/api/me/views` GET/POST/PATCH/version path strips existing legacy **root** `capacity` from responses and rejects new normalized root-key variants as a forbidden shared field before direct model writes. Preserve legitimate nested domain data such as a Scenario config's own `config.capacity`; the ownership rule applies only to the dashboard root Capacity Project/field section.

Keep `import_dashboard_config`'s existing signature. Its `context.is_admin` is the authorization source, and root Capacity import is deliberately first-seed-only rather than a second Admin editing path:

- reconciliation runs before the existing same-path/hash early return;
- a non-Admin import strips root `capacity`, imports the remaining private sections, and never changes the shared row;
- an Admin import may supply that root section as the explicit workspace legacy seed only when no shared row and no private remnant existed at reconciliation; the resulting active row is unverified/read-only until Settings validates it;
- once any active or unresolved row exists, imports never overwrite or resolve it, regardless of source hash; Admin changes use revisioned `/api/capacity/config` instead;
- extend `ConfigImportResult` with a backward-compatible defaulted `capacity_result` value from `seeded|ignored_non_admin|unchanged_existing|absent`, so same-hash retries are observable and idempotent without changing existing positional callers.

In `tests/test_shared_capacity_config_import.py`, prove those four outcomes, two-workspace isolation, and stripping from every current/version private payload. Compatibility export merges exactly `capacity:{project,fieldId,fieldName}` only for the current workspace's active non-empty row; it omits revision, status, site/cloud, attestation, unresolved/blank values, and all private candidates. Update `tests/test_config_jsonfile_fallback.py` so its non-Admin import no longer expects its supplied root Capacity value to round-trip unless an existing current-workspace shared value is eligible for export.

- [x] **Step 3: Run new tests and verify red**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_shared_capacity_config tests.test_shared_capacity_config_db tests.test_shared_capacity_config_routes tests.test_shared_capacity_config_import tests.test_config_jsonfile_fallback tests.test_db_migrations tests.test_user_view_config_routes tests.test_view_config_validator
npx playwright test tests/ui/settings_unified_save.spec.js -g 'capacity config revision conflict'
~~~

Expected: FAIL because the table/service/revision contract does not exist.

- [x] **Step 4: Add the model, migration, and deterministic legacy reconciliation**

Create `WorkspaceCapacityConfig` in the existing model style. Keep Alembic `0007` offline-renderable: it creates the table/constraints and adds `scope_provenance` (`provider|unknown`, default `unknown`) to `AuthConnection`, but does not issue data-dependent SELECTs from `upgrade()`. Existing auth rows are unknown and therefore cannot authorize this write until a new callback records a provider-reported grant. Extend the offline-to-head SQL assertion through `0007`.

Put data movement in idempotent `ensure_workspace_capacity_reconciled(session, context, eligible_legacy_loader)` inside `shared_capacity_config.py`. Every capacity/config load or save, compatibility import/export, and `/api/me/views` read/create/patch calls it inside the operation's DB transaction before stripping or mutating a private view. On the first call use exactly this precedence: (1) distinct normalized root Capacity values across both `view_configs.payload` and `view_config_versions.payload`; one value creates an active revision-1 row and multiple values create a blank revision-1 `requires_resolution` row; (2) only when no private remnant exists, one site-eligible operator/shared JSON source; (3) otherwise an active blank row. Store workspace Jira site/cloud identity. Flush/materialize the row first, then strip root `capacity` from every current/version payload in the same transaction. A unique-row race reloads the winner before stripping; no caller independently recomputes an unresolved state. Tests start from schema-only `0007` and cover eligible operator source plus zero/one/multiple private remnants (private evidence wins), ineligible cross-site source, first capacity access, and first unrelated saved-view save. Downgrade may merge only an active sanitized value, never reconstruct conflicting private candidates.

Implement `shared_capacity_config.py` in the pattern of `shared_group_config.py`, but keep the Admin policy boundary in the route. Normalize project key, exact field id, display name, and Jira site identity; use `config_revision` for one `UPDATE ... WHERE workspace_id = ? AND config_revision = ?`. Never re-derive a materialized unresolved state from mutable private payloads. On a missing row, reconcile private remnants first. Only when none exist may the routine use an operator source whose normalized configured `JIRA_URL` equals `context.site_url` (or an explicitly invoked single-workspace import names this exact workspace); otherwise create an active blank row. Unique-row races catch `IntegrityError`, reload the winner, and never cross workspace/site boundaries.

Before accepting an Admin save, the route-owned `load_current_site_field_catalog(context) -> list[dict]` calls the current site's `/rest/api/3/field` through `current_jira_request` exactly once and passes that list to the pure `save_shared_capacity_config(..., field_catalog=fields)` validator. Require an exact `customfield_*` match with `schema.type == 'number'`, and persist `field_schema_type`, verification timestamp, and the current context site/cloud identity. These attestation fields are server-owned and rejected in request bodies. A migrated/legacy active row without a valid same-site numeric attestation remains readable with `mutationEnabled:false`; it cannot reach PATCH until an Admin re-saves it. Do not query the catalog on card load or PATCH.

- [x] **Step 5: Remove private-view ownership and wire Admin settings**

Add a `strip_shared_capacity_config` helper beside `strip_private_team_groups` and apply it on DB repository load/save/import paths and direct `backend/routes/views_routes.py` response/create/patch/version paths. Add a root-only normalized forbidden-key check for `capacity` rather than adding it to the recursive sensitive-key set; nested Scenario/domain capacity remains valid. Response stripping remains necessary for migrated legacy rows. Import follows the first-seed-only contract above; all subsequent shared edits/resolution use the revisioned Admin endpoint. Explicit rollback/export merges only the current workspace's active non-empty public config for JSON compatibility. Do not move unrelated Admin sections in this task.

Implement `load_request_capacity_config` with an exact non-recursive split:

- DB-backed OAuth context plus `source='auto'` calls `load_shared_capacity_config(context, fallback_loader=site_eligible_legacy_capacity_loader)`;
- local OAuth context plus `source='auto'` loads the shared JSON/operator config, marks `mutationEnabled:true` only when server-owned numeric/schema/site attestation in that section matches the context's site/cloud, and otherwise remains readable/false;
- Basic context plus `source='auto'` loads the same JSON/operator config with `mutationEnabled:false`;
- `context is None` requires explicit `source='jsonfile'` and is reserved for startup compatibility.

Loaders always return the durable unresolved row with `requiresResolution:true`; `CapacityConfigConflict` is reserved for failed Admin save CAS and never represents a read. Storage errors pass through for callers to map. No adapter branch calls `load_dashboard_config` in DB mode or consults a private view. Add Basic canonical/alias, local OAuth attested/unattested, and no-request-context dispatch tests.

Change `/api/capacity/config` GET/POST to use that adapter. GET returns 200 for unresolved config so the Admin UI can resolve its positive revision. POST validates only `{project, fieldId, fieldName, baseRevision}`. DB-backed OAuth validates the exact numeric Jira field and uses conditional save. Local OAuth validates the field identically, then writes the public JSON fields plus server-owned `verifiedSiteUrl`, `verifiedCloudId`, `fieldSchemaType:'number'`, and `fieldVerifiedAt`; these metadata keys are never accepted from the browser. Basic JSON save preserves compatibility but clears/does not create attestation, so it cannot enable mutation. The frontend stores the loaded revision separately, sends `baseRevision` only for DB Capacity payloads, and keeps the modal footer's existing all-dirty-sections save behavior.

- [x] **Step 6: Run focused shared-config coverage**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_shared_capacity_config tests.test_shared_capacity_config_db tests.test_shared_capacity_config_routes tests.test_shared_capacity_config_import tests.test_config_jsonfile_fallback tests.test_db_migrations tests.test_oauth_settings_routes tests.test_user_view_config_routes tests.test_view_config_validator
npx playwright test tests/ui/settings_unified_save.spec.js -g 'capacity config|all dirty'
~~~

Expected: PASS. Inspect migration upgrade/downgrade output; confirm the unresolved row survives unrelated saved-view writes, two same-workspace users receive the same exact field id, a second site is never seeded, and only a same-site numeric Jira custom field enables mutation.

---

### Task 2: Add Jira Issue Targets To The Existing Capacity Read

**Files:**
- Modify: backend/services/capacity.py:50-129
- Modify: backend/routes/capacity_routes.py:18-42
- Modify: backend/routes/settings_routes.py:287-305
- Modify: jira_server.py:1285-1315, 1429-1443, 1815-1828, 2435-2438
- Modify: tests/test_capacity_service.py:1-95
- Modify: tests/test_dashboard_bootstrap_config_source.py
- Modify: tests/test_oauth_stats_routes.py:60-88
- Modify: tests/test_oauth_stats_routes.py:110-130, 361-380

**Interfaces:**
- Consumes: `load_request_capacity_config(context)` from Task 1 and `fetch_capacity_for_sprint(sprint_name, headers, debug=False, team_names=None, *, capacity_project, capacity_field_id, mutation_enabled=False, search_request, ...)`.
- Produces: the same (payload, error) tuple with payload.entries: list[{teamName: str, issueKey: str, capacity: float|null}].
- Invariant: payload.capacities remains a normalized team-name to numeric value map for all existing callers; `/api/config`, canonical/alias reads, JQL, team-size, and Scenario paths all resolve through the same request-aware shared adapter and never a private view.

- [x] **Step 1: Write failing service tests for additive entries and deduplication**

Add focused cases to tests/test_capacity_service.py using its FakeResponse:

~~~python
def test_capacity_read_keeps_zero_and_blank_issue_targets(self):
    payload = {
        'issues': [
            {'key': 'CAP-101', 'fields': {'summary': 'Team info 2026Q2 - Alpha', 'customfield_capacity': 0}},
            {'key': 'CAP-102', 'fields': {'summary': 'Team info 2026Q2 - Beta', 'customfield_capacity': None}},
        ]
    }
    result, error = capacity.fetch_capacity_for_sprint(
        '2026Q2',
        None,
        team_names=['Alpha', 'Beta'],
        capacity_project='CAP',
        capacity_field_id='customfield_capacity',
        search_request=lambda _payload: FakeResponse(200, payload),
    )
    self.assertIsNone(error)
    self.assertEqual(result['capacities'], {'Alpha': 0.0})
    self.assertEqual(result['entries'], [
        {'teamName': 'Alpha', 'issueKey': 'CAP-101', 'capacity': 0.0},
        {'teamName': 'Beta', 'issueKey': 'CAP-102', 'capacity': None},
    ])
~~~

Add a second test whose two chunk responses repeat CAP-101 and include a distinct CAP-103 for Alpha. Assert CAP-101 appears once, CAP-103 remains, and the search count still follows _team_chunks. Add blank, negative, non-finite, and a huge integer that raises `OverflowError` during float conversion; each remains in `entries` as `capacity: None` and is omitted from `capacities`. Extend the disabled-project and missing-field assertions to include entries: []. Add an upstream response containing a synthetic secret-like string and assert the returned error is only `jira_capacity_fetch_failed`.

- [x] **Step 2: Run the service tests and verify the contract red state**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_capacity_service
~~~

Expected: FAIL because entries is absent and blank/zero target preservation plus issue-key deduplication is not implemented. Import/setup failures are not an acceptable red state.

- [x] **Step 3: Implement the additive response without changing JQL or fan-out**

In backend/services/capacity.py, add the keyword-only `mutation_enabled=False` argument and a Jira-value parser that preserves the old string-to-float compatibility and returns None for non-numeric values:

~~~python
def _jira_capacity_value(value):
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if math.isfinite(parsed) and parsed >= 0 else None
~~~

Import math. In fetch_capacity_for_sprint:

- return `entries: []` and `mutationEnabled: false` in both disabled branches;
- use the `capacity_field_id` supplied by the server wrapper; prefer the shared stored id, while preserving the existing read-only field-name discovery fallback for legacy incomplete configs outside the service;
- deduplicate the collected Jira issues by non-empty issue key before shaping;
- append an entry for every matching summary with a key, even when capacity is None;
- add only numeric entries to capacities;
- preserve the current debug keys and JQL construction.

The shaping loop must follow this form:

~~~python
seen_issue_keys = set()
entries = []
for issue in issues:
    issue_key = str(issue.get('key') or '').strip().upper()
    if not issue_key or issue_key in seen_issue_keys:
        continue
    seen_issue_keys.add(issue_key)
    # Preserve the existing anchored sprint-summary match and team normalization.
    capacity_value = _jira_capacity_value(raw_capacity)
    entries.append({
        'teamName': short_name,
        'issueKey': issue_key,
        'capacity': capacity_value,
    })
    if capacity_value is not None:
        capacities[short_name] = capacity_value
~~~

Add entries and `mutationEnabled: mutation_enabled is True` to `response_payload`; the request-aware wrapper passes true only for an OAuth request with a same-site numeric-attested active config. Disabled branches also return this normalized false value. Read values remain available for legacy unverified rows, but actions do not.

- [x] **Step 4: Add failing caller, bootstrap, alias, and Scenario tests**

Before changing the callers, add tests for this exact matrix:

- `/api/config` bootstrap in `backend/routes/settings_routes.py`;
- root `build_capacity_jql`, `fetch_capacity_for_sprint`, and `fetch_capacity_team_sizes` wrappers;
- canonical `/api/capacity` and `/api/planned-capacity` reads;
- Scenario Planner's team-size/capacity-details call, passing its captured `auth_context` explicitly.

An unresolved shared row must not break dashboard bootstrap: `/api/config` inspects the returned row and sends `capacityProject:''`, `capacityConfigRequiresResolution:true`, and `capacityMutationEnabled:false`, allowing an Admin to open Settings. Normal/blank configs return the same flags with false/attested state as applicable. Capacity GET and its alias inspect `requiresResolution` and map it to fixed `409 capacity_config_conflict`; the frontend renders a visible unavailable/retry state and no actions. Add bootstrap tests for active, blank, unresolved, and storage-error cases. Add Scenario tests proving the captured context reaches the adapter and an unresolved config skips capacity-team-size enrichment safely rather than falling back to private config or failing the entire Scenario response.

Extend test_capacity_route_is_oauth_ready in tests/test_oauth_stats_routes.py to assert its synthetic CAP-1 entry and `mutationEnabled`. Extend the alias mock/result to include entries: [] and assert the alias returns it. Add a missing-project route test and change get_capacity's early disabled response to include entries: [] plus `mutationEnabled:false`; this route currently returns before fetch_capacity_for_sprint, so changing only the service is insufficient. Map a failed Jira search to fixed `502 {error:'jira_capacity_fetch_failed', message:'Capacity could not be loaded from Jira.'}` and log only status/exception details server-side. Inspect returned `requiresResolution` and map it to fixed `409 capacity_config_conflict`; map `ConfigStorageError`/`DatabaseConfigurationError` to fixed `503 config_storage_unavailable`. Preserve structured auth error codes/recovery fields rather than collapsing every `AuthError` to a new generic session-expired response. Test both aliases with synthetic sensitive upstream/exception text and assert it is absent from the response.

Add source/behavior guards that patch the legacy `get_effective_capacity_project` and private-config repository paths to raise while bootstrap, capacity GET, team-size, and Scenario compatibility tests succeed through `load_request_capacity_config`. No old caller may read `capacity` from a requester-owned view.

Run:

~~~bash
.venv/bin/python -m unittest tests.test_dashboard_bootstrap_config_source tests.test_oauth_stats_routes
~~~

Expected: FAIL because the old callers still use private/root Capacity helpers, unresolved bootstrap/read handling is absent, and Scenario does not pass request context.

- [x] **Step 5: Migrate every capacity caller to the shared adapter**

Wire the matrix above to `load_request_capacity_config`. The wrappers load one config per operation and pass its project plus stored field id into the service; `build_capacity_jql` accepts the already resolved project instead of reloading. Change the legacy resolver to `resolve_capacity_field_id(headers, context=None, *, capacity_config)` (or exact `field_id`/`field_name` keyword arguments) and remove its internal `get_capacity_config()` call. If and only if that already-loaded legacy read config has a field name but no id, preserve the current context-bound read-only field-catalog fallback. The source-guard test keeps `get_capacity_config` and every private-config resolver patched to raise; GET compatibility may call `/rest/api/3/field`, PATCH never does, and a properly configured shared row makes no field-catalog request.

- [x] **Step 6: Run service and caller compatibility coverage green**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_capacity_service tests.test_dashboard_bootstrap_config_source tests.test_oauth_stats_routes
~~~

Expected: PASS.

---

### Task 3: Implement The Pure Best-Effort Capacity Write Service

**Files:**
- Modify: backend/services/capacity.py
- Modify: tests/test_capacity_service.py

**Interfaces:**
- Produces: CapacityInputError(code: str), CapacityServiceError(code: str, status_code: int|None, current_capacity: float|None).
- Produces: update_capacity_issue(issue_key, payload, *, capacity_project, capacity_field_id, jira_request, context=None) -> dict.
- Jira request callable: jira_request(method, path, *, params=None, json_body=None, context=None) -> response.

- [x] **Step 1: Add failing validation, identity, no-op, success, and conflict tests**

Add table-driven tests for these exact cases:

- invalid issue key;
- missing/blank sprintName or teamName;
- missing expectedCapacity;
- capacity values True, '5', None, -1, NaN, infinity, and a huge integer whose float conversion overflows;
- expectedCapacity values True, '5', -1, NaN, infinity, and the same huge integer;
- missing project or field configuration before any Jira call;
- GET 403, 404, and 503;
- configured project mismatch;
- sprint mismatch;
- normalized team mismatch;
- a negative/non-finite existing Jira value normalizes to null and can be repaired with expectedCapacity null;
- current Jira value differs from expectedCapacity;
- current Jira value already equals the requested target even though expectedCapacity is stale: return already_current and skip PUT;
- success PUT contains only the configured field;
- PUT 400, 403, 404, 409, and 503;
- PUT 409 performs exactly one reconciliation GET and classifies: latest equals target -> already_current; latest differs from expected -> capacity_conflict with only current_capacity; latest still equals expected -> jira_capacity_update_conflict with no false changed-value claim;
- an injected remote edit between the validation GET and PUT demonstrates the documented lost-update window; the test records the limitation and the plan must not claim atomic prevention.

Use a request recorder:

~~~python
calls = []

def jira_request(method, path, **kwargs):
    calls.append((method, path, kwargs))
    if len(calls) == 1:
        return FakeResponse(200, {
            'key': 'CAP-101',
            'fields': {
                'project': {'key': 'CAP'},
                'summary': 'Team info 2026Q2 - Tech - Alpha',
                'customfield_capacity': 5.5,
            },
        })
    return FakeResponse(204, {})

result = capacity.update_capacity_issue(
    'cap-101',
    {
        'sprintName': '2026Q2',
        'teamName': 'R&D Alpha',
        'expectedCapacity': 5.5,
        'capacity': 6,
    },
    capacity_project='CAP',
    capacity_field_id='customfield_capacity',
    jira_request=jira_request,
    context=object(),
)
self.assertEqual(result, {
    'issueKey': 'CAP-101',
    'teamName': 'Alpha',
    'previousCapacity': 5.5,
    'capacity': 6.0,
    'result': 'success',
})
self.assertEqual(calls[1][2]['json_body'], {
    'fields': {'customfield_capacity': 6.0},
})
~~~

- [x] **Step 2: Run the new write-service tests and verify red**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_capacity_service
~~~

Expected: FAIL with update_capacity_issue or its error classes missing.

- [x] **Step 3: Add strict client-number and Jira-number normalization**

Implement private helpers with these rules:

~~~python
def _client_capacity_value(value, *, allow_none=False):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CapacityInputError('invalid_capacity')
    try:
        parsed = float(value)
    except OverflowError as error:
        raise CapacityInputError('invalid_capacity') from error
    if not math.isfinite(parsed) or parsed < 0:
        raise CapacityInputError('invalid_capacity')
    return parsed


def _same_capacity(left, right):
    if left is None or right is None:
        return left is right
    return Decimal(str(left)) == Decimal(str(right))
~~~

Import Decimal from decimal. Reuse `_jira_capacity_value` for Jira field parsing, where blank, negative, non-finite, non-numeric, or overflow values normalize to `None`.

- [x] **Step 4: Add issue-key, payload, and summary-identity validation**

Use the same Jira issue-key grammar already documented in backend/routes/eng_routes.py:

~~~python
_CAPACITY_ISSUE_KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]+-\d+$')
~~~

Normalize the submitted team with normalize_capacity_team_name. Validate the issue summary with a sprint-escaped anchored pattern:

~~~python
summary_pattern = re.compile(
    rf'^Team info\s+{re.escape(sprint_name)}\s*-\s*(.+)$',
    re.IGNORECASE,
)
~~~

Compare normalized team names with casefold and configured/issue project keys with stripped uppercase equality. Never accept project or field values from payload.

Use these exact input codes: invalid_issue_key for the path; capacity_identity_required for missing/blank sprintName or teamName; invalid_capacity when capacity is invalid, expectedCapacity is absent, or expectedCapacity is invalid. The Flask route alone owns invalid_json for a non-object request body and unsupported_capacity_field for extra request keys.

- [x] **Step 5: Implement validation GET, no-op, PUT, and 409 reconciliation**

The first Jira call must be:

~~~python
response = jira_request(
    'GET',
    '/rest/api/3/issue/' + key,
    params={'fields': 'project,summary,' + capacity_field_id},
    context=context,
)
~~~

After identity checks, compare current to the requested target **before** comparing current to `expectedCapacity`; return `already_current` without PUT when they match. Only then raise `capacity_conflict` when the baseline is stale. Otherwise send:

~~~python
response = jira_request(
    'PUT',
    '/rest/api/3/issue/' + key,
    json_body={'fields': {capacity_field_id: target_capacity}},
    context=context,
)
~~~

Raise `CapacityServiceError('capacity_config_missing', 409)` when the configured project or stored exact field id is blank, before `jira_request` is called. Raise `capacity_issue_mismatch` for a project, sprint, team, or summary-format mismatch and `capacity_conflict` with `current_capacity` when expectedCapacity is stale. Map 200/204 to success; GET/PUT 403 to `capacity_forbidden`; 404 to `capacity_issue_not_found`; PUT 400 to `capacity_field_not_editable`; other upstream failures to `jira_capacity_update_failed`.

On PUT 409, call the same scoped snapshot loader exactly once, revalidate identity, and classify in this order:

1. latest equals requested target: return `already_current` with `previousCapacity` equal to latest and no extra PUT;
2. latest differs from expected baseline: raise `capacity_conflict` with only `current_capacity`;
3. latest still equals expected baseline: raise `jira_capacity_update_conflict` so the UI offers retry without saying Jira changed the value.

Never include `response.text` or Jira JSON in exceptions returned to the route. Document in the service docstring and test name that the GET-then-PUT check is best-effort stale-baseline detection, not atomic compare-and-set.

- [x] **Step 6: Run all capacity service tests**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_capacity_service
~~~

Expected: PASS, including the exact Jira call-count assertions.

---

### Task 4: Register The OAuth-Only PATCH Route And Security Contract

**Files:**
- Create: backend/auth/scope_policy.py
- Create: tests/test_oauth_capacity_routes.py
- Modify: backend/auth/context.py
- Modify: backend/auth/db_context.py
- Modify: backend/auth/db_tokens.py
- Modify: backend/auth/jira_auth.py
- Modify: backend/routes/auth_routes.py
- Modify: backend/routes/capacity_routes.py:1-47
- Modify: backend/security/guards.py
- Modify: backend/security/policy.py:75-92
- Modify: jira_server.py:551-586
- Modify: docs/security/endpoints.md
- Modify: tests/oauth_test_helpers.py
- Modify: tests/test_analytics_routes.py
- Modify: tests/test_auth_context.py
- Modify: tests/test_auth_context_db.py
- Modify: tests/test_config_jsonfile_fallback.py
- Modify: tests/test_csrf_token_bound.py
- Modify: tests/test_dashboard_bootstrap_config_source.py
- Modify: tests/test_db_admin_bootstrap.py
- Modify: tests/test_db_admin_routes.py
- Modify: tests/test_db_auth_recovery_pages.py
- Modify: tests/test_db_oauth_cutover.py
- Modify: tests/test_home_credential_resolver.py
- Modify: tests/test_oauth_eng_routes.py
- Modify: tests/test_oauth_route_guards.py
- Modify: tests/test_oauth_settings_routes.py
- Modify: tests/test_scenario_draft_routes.py
- Modify: tests/test_shared_group_config_routes.py
- Modify: tests/test_team_catalog_api.py
- Modify: tests/test_user_api_token_connections.py
- Modify: tests/test_user_view_config_routes.py
- Modify: tests/endpoint_security_samples.py:1-20
- Modify: tests/test_endpoint_security_matrix.py:9-43, 113-140
- Modify: tests/test_endpoint_policy_inventory.py:78-141
- Modify: tests/test_backend_route_source_guards.py:17-24
- Modify: tests/test_route_move_preservation.py

**Interfaces:**
- Consumes: the shared Capacity config from Task 1 and `update_capacity_issue` plus its two error types from Task 3.
- Produces: PATCH /api/capacity/<issue_key> with the endpoint matrix above.
- Produces: `RequestAuthContext.granted_scopes: tuple[str, ...]`, `RequestAuthContext.granted_scopes_verified: bool`, and pure `missing_context_oauth_scopes(context, required_scopes)`; route code never reads a local/DB token store, and the helper fails closed when provenance is not verified.
- Security policy: EndpointPolicy('jira-team-capacity-write', '/api/capacity/<issue_key>', frozenset({'PATCH'}), 'user_write', 'dynamic').

- [x] **Step 1: Add the dynamic policy/sample tests in a red state**

Add this concrete route sample:

~~~python
'/api/capacity/<issue_key>': '/api/capacity/CAP-101',
~~~

Add ('PATCH', '/api/capacity/CAP-101') to SECURITY_SAMPLES['user_write'] and the dynamic concrete-path matrix. Add an inventory assertion that both matching_policies on the Flask rule and matching_path_policies on the concrete URL return only jira-team-capacity-write with user_write. Add `jira-team-capacity-write`, `PATCH /api/capacity/<issue_key>`, `user_write`, and `dynamic` to `docs/security/endpoints.md`.

Run:

~~~bash
.venv/bin/python -m unittest tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix
~~~

Expected: FAIL because the dynamic policy and Flask route do not exist.

- [x] **Step 2: Register the dynamic user_write policy**

Add the exact EndpointPolicy next to the existing Jira issue writes in backend/security/policy.py. Do not classify the PATCH as shared_admin_write: Jira user permission, not tool-admin status, is authoritative.

- [x] **Step 3: Add focused route tests before route implementation**

Create tests/test_oauth_capacity_routes.py with the existing install_oauth_session/FakeResponse pattern and exact tests for:

- anonymous OAuth is rejected before route code;
- missing X-Requested-With returns exactly `403 {error:'csrf_required', message:'Unsafe OAuth requests require X-Requested-With: jira-execution-planner'}` before route code;
- missing, invalid, and already-consumed token-bound CSRF return exactly `403 {error:'csrf_required', message:'A valid CSRF token is required for this request.'}` before route code;
- non-loopback Basic returns exactly `404 {error:'not_found'}` from the global guard;
- local/dev loopback Basic returns exactly `403 {error:'jira_oauth_required'}` before parsing both valid and malformed bodies;
- signed-in non-tool-admin OAuth reaches the write;
- local OAuth and DB OAuth contexts whose provider-verified grants omit `write:jira-work` return the pre-route `401 auth_required` response when `ATLASSIAN_SCOPES` requests write, because the global guard wins;
- when operator `ATLASSIAN_SCOPES` intentionally omits write, the same contexts reach the route-owned unconditional check and return `401 missing_oauth_scope` with safe `/login?reason=missing_scope` recovery before config/Jira calls;
- local callback responses with omitted `scope`, legacy DB connections with `scope_provenance='unknown'`, and requested-only scope strings fail closed before config/Jira calls and require visible reauthentication;
- `current_request_auth_context` is passed to the shared config resolver and every `current_jira_request` call;
- request project/field injection comes only from `load_request_capacity_config`; missing stored field id returns capacity_config_missing with zero Jira/field-catalog calls, even when a duplicate-named field is available;
- `mutationEnabled:false`, unresolved status, or a config site's cloud/URL mismatch returns a fixed `capacity_config_unverified`/`capacity_config_conflict` before service/Jira calls;
- success and already_current bodies;
- invalid_json, unsupported_capacity_field, and input errors;
- auth expiry/revoked/stale/disabled/missing-project errors preserve only existing fixed loginUrl/recoveryUrl fields;
- all service codes map to the endpoint matrix;
- conflict includes currentCapacity only;
- ConfigStorageError and DatabaseConfigurationError from shared Capacity configuration or any global authenticated-read/CSRF/Admin guard path map to fixed config_storage_unavailable/503 without leaking the storage exception;
- generic exceptions and upstream failures expose only jira_capacity_update_failed.

The successful request shape is:

~~~python
csrf_token = self._csrf_token()
response = self.client.patch(
    '/api/capacity/CAP-101',
    json={
        'sprintName': '2026Q2',
        'teamName': 'Alpha',
        'expectedCapacity': 5.5,
        'capacity': 6,
    },
    headers={
        'X-Requested-With': 'jira-execution-planner',
        'X-CSRF-Token': csrf_token,
    },
)
~~~

- [x] **Step 4: Run focused route/security tests and verify red**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_oauth_capacity_routes tests.test_endpoint_policy_inventory tests.test_endpoint_security_matrix
~~~

Expected: FAIL because capacity_routes has no PATCH handler.

- [x] **Step 5: Preserve provider scope provenance and enforce the unconditional write scope**

Remove both requested-to-granted fallbacks: `store_oauth_callback_tokens` must not copy `requested_scopes` into `connection.scopes`, and the local callback must not replace an omitted token-response `scope` with `ATLASSIAN_SCOPES`. On callback, store provider-returned scopes plus `scope_provenance='provider'` only when the provider actually returns `scope`; otherwise store an empty grant with `scope_provenance='unknown'`. The `0007` migration leaves all pre-existing rows unknown because their provenance cannot be reconstructed safely. On token refresh, a returned `scope` replaces the grant and marks it provider-verified; an omitted refresh scope may preserve an already provider-verified grant but never upgrade an unknown one. Local session payloads carry the same provenance and refresh rule. Reauthentication is the only path that can convert an unknown legacy callback/session into a verified grant.

Add `granted_scopes: tuple[str, ...] = field(default_factory=tuple)` and `granted_scopes_verified: bool = False` to `RequestAuthContext`. `resolve_db_request_auth_context` exposes `connection.scopes` only when `scope_provenance == 'provider'`; `current_request_auth_context` does the same for local session data; Basic gets empty/false. Implement `missing_context_oauth_scopes` in `backend/auth/scope_policy.py` using the existing `oauth_scope_set` normalization against only the context fields and returning all required scopes as missing when verification is false.

Make the global OAuth guard provenance-aware for both stores. DB `resolve_db_request_auth_context(..., required_scopes=ATLASSIAN_SCOPES)` treats unknown provenance as missing. For local OAuth, retain the raw access-token/cloud presence check, then resolve `RequestAuthContext` and call `missing_context_oauth_scopes(context, ATLASSIAN_SCOPES)` instead of trusting `oauth_session_data()['scope']`. An old local session with a populated requested-only scope string but no provenance therefore receives pre-route `401 auth_required`. Update `/api/auth/status` to report such DB/local sessions as unauthenticated with the existing safe missing-scope recovery, and ensure `/login?reason=missing_scope` always starts/restarts OAuth instead of redirecting back as already authenticated.

Invert the current omitted-scope callback test in `tests/test_db_oauth_cutover.py`: both DB and local callbacks with no provider `scope` remain unknown even when `ATLASSIAN_SCOPES` requests write; legacy rows are unknown after migration; provider-reported scope is normalized and verified; refresh omission preserves only previously verified grants. Update `tests/oauth_test_helpers.py` and every direct `models.AuthConnection(...)` OAuth fixture named in this task to set `scope_provenance='provider'` when its scopes represent a provider response; retain explicit unknown cases for fail-closed coverage. Audit every test occurrence returned by `rg -n 'current_request_auth_context' tests`: any success-path context stub that crosses the provenance-aware global guard must be a verified synthetic `RequestAuthContext`, not `object()` or a minimal `SimpleNamespace`. At minimum, migrate the affected stubs in `tests/test_oauth_eng_routes.py`, `tests/test_oauth_settings_routes.py`, `tests/test_analytics_routes.py`, and `tests/test_team_catalog_api.py`; keep explicit unknown-provenance rejection fixtures separate. Add auth-context, global-guard, `/api/auth/status`, and `/login?reason=missing_scope` tests for tuple normalization, DB/local population, fail-closed status, and usable reauthentication. The capacity route calls this helper immediately after context resolution and before shared config; when write scope is absent or unverified and the global configured-scope check did not already reject it, raise/map `AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')` through the existing structured recovery response. Do not call `oauth_session_data`, `db_oauth_session_data`, `OAUTH_TOKEN_STORE`, or a token resolver from the capacity route.

- [x] **Step 6: Sanitize global DB guard failures**

Replace every `str(DatabaseConfigurationError)` response in `backend/security/guards.py` with one route-neutral fixed helper returning `503 {'error':'config_storage_unavailable','message':'Configuration storage is temporarily unavailable.'}` consistently across guarded APIs. Preserve server-side exception logging without request/token material. In `tests/test_oauth_route_guards.py` and `tests/test_oauth_capacity_routes.py`, inject synthetic secret-bearing failures from `current_request_auth_context`, strict/regular DB browser session resolution, `csrf_session_data_for_request`, and the Admin guard. Prove GET `/api/capacity`, POST `/api/capacity/config`, and PATCH `/api/capacity/<issue>` expose only the fixed allowlisted body, including failures raised before route code.

- [x] **Step 7: Implement route auth, exact shared config, and sanitized error mapping**

Import AUTH_MODE_ATLASSIAN_OAUTH and AuthError explicitly, ConfigStorageError from backend.config.repository, DatabaseConfigurationError from backend.db.engine, the context-scope helper, the Task 1 shared config loader, plus the Task 3 service symbols. Add a local auth-error mapper matching the existing visible recovery contract. The route checks OAuth mode before parsing, rejects keys outside the exact body allowlist, and never calls a field-name resolver:

~~~python
@bp.route('/api/capacity/<issue_key>', methods=['PATCH'])
def patch_capacity(issue_key):
    if JIRA_AUTH_MODE != AUTH_MODE_ATLASSIAN_OAUTH:
        return jsonify({'error': 'jira_oauth_required'}), 403
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'invalid_json'}), 400
    if set(payload) - {'sprintName', 'teamName', 'expectedCapacity', 'capacity'}:
        return jsonify({'error': 'unsupported_capacity_field'}), 400
    try:
        auth_context = current_request_auth_context()
        if missing_context_oauth_scopes(auth_context, {'write:jira-work'}):
            raise AuthError('missing_oauth_scope', 'Your Jira sign-in needs updated permissions.')
        config = load_request_capacity_config(auth_context)
        if config.get('requiresResolution'):
            raise CapacityServiceError('capacity_config_conflict', 409)
        if not config.get('project') or not config.get('fieldId'):
            raise CapacityServiceError('capacity_config_missing', 409)
        if config.get('mutationEnabled') is not True:
            raise CapacityServiceError('capacity_config_unverified', 409)
        result = update_capacity_issue(
            issue_key,
            payload,
            capacity_project=config['project'],
            capacity_field_id=config['fieldId'],
            jira_request=current_jira_request,
            context=auth_context,
        )
    except AuthError as error:
        if error.code == 'auth_required':
            auth_payload, status = oauth_auth_required_payload()
            return jsonify(auth_payload), status
        return auth_error_response(error, 401)
    except CapacityInputError as error:
        return jsonify({'error': error.code}), 400
    except CapacityServiceError as error:
        return _capacity_service_error_response(error)
    except (ConfigStorageError, DatabaseConfigurationError):
        return jsonify({
            'error': 'config_storage_unavailable',
            'message': 'Configuration storage is temporarily unavailable.',
        }), 503
    except Exception:
        logger.exception('Capacity Jira update failed')
        return jsonify({'error': 'jira_capacity_update_failed'}), 502
    return jsonify(result)
~~~

`_capacity_service_error_response` must use this fixed map and include `currentCapacity` only for `capacity_conflict`:

~~~python
_CAPACITY_SERVICE_STATUS = {
    'capacity_forbidden': 403,
    'capacity_issue_not_found': 404,
    'capacity_config_missing': 409,
    'capacity_config_unverified': 409,
    'capacity_config_conflict': 409,
    'capacity_issue_mismatch': 409,
    'capacity_conflict': 409,
    'capacity_field_not_editable': 409,
    'jira_capacity_update_conflict': 502,
    'jira_capacity_update_failed': 502,
}
~~~

Unknown service codes map to jira_capacity_update_failed/502. The mapper must never serialize str(error), response.text, a Jira payload, issue summary, project, field id, or credentials.

- [x] **Step 8: Tighten AST/behavioral source guards and route-move preservation**

Keep the existing BACKEND_ROUTE_GROUPS['capacity'] prefix guard, which already rejects any root decorator beginning with /api/capacity. Add a dedicated assertion that capacity_routes.py contains the exact dynamic Blueprint rule /api/capacity/<issue_key> with PATCH, and that jira_server.py does not redeclare it. Add `'/api/capacity/<issue_key>': {'PATCH'}` to `EXPECTED_MOVED_ROUTE_METHODS` in `tests/test_route_move_preservation.py`.

Use AST import/name/call assertions for both `backend/routes/capacity_routes.py` and `backend/services/capacity.py`, not brittle substring matching. Forbid concrete symbols/modules: `build_jira_headers`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_API_TOKEN`, `resolve_capacity_field_id`, service-integration and Home/EPM clients, user API-token connection/credential resolvers, `oauth_session_data`, `db_oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock`, and `OAUTH_TOKEN_STORE`. Add behavioral route tests that patch those server-bound symbols to raise and still complete a synthetic request through only `current_jira_request`; the service receives only the injected callable. Preserve the existing root wrappers used by the read route.

- [x] **Step 9: Run the full focused backend contract**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_shared_capacity_config tests.test_shared_capacity_config_routes tests.test_shared_capacity_config_import tests.test_analytics_routes tests.test_auth_context tests.test_auth_context_db tests.test_config_jsonfile_fallback tests.test_csrf_token_bound tests.test_dashboard_bootstrap_config_source tests.test_db_admin_bootstrap tests.test_db_admin_routes tests.test_db_auth_recovery_pages tests.test_db_oauth_cutover tests.test_home_credential_resolver tests.test_oauth_eng_routes tests.test_oauth_route_guards tests.test_oauth_settings_routes tests.test_scenario_draft_routes tests.test_shared_group_config_routes tests.test_team_catalog_api tests.test_user_api_token_connections tests.test_user_view_config_routes tests.test_capacity_service tests.test_oauth_capacity_routes tests.test_oauth_stats_routes tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards tests.test_route_move_preservation
~~~

Expected: PASS.

---

### Task 5: Add The Tracked Capacity API And Reuse Planning Analytics

**Files:**
- Create: frontend/src/api/capacityApi.js
- Modify: frontend/src/api/http.js:41-72
- Modify: frontend/src/api/engApi.js:1-48
- Modify: frontend/src/analytics/analytics.js:20-37
- Modify: frontend/src/analytics/dashboardAnalytics.js:229-271
- Modify: tests/test_frontend_api_source_guards.js
- Modify: tests/test_analytics_events.js
- Modify: tests/test_analytics_source_guards.js

**Interfaces:**
- Produces: fetchCapacity(backendUrl, {sprintName, teams=[], signal}={}) -> Promise<Response>.
- Produces: updateCapacity(backendUrl, issueKey, {sprintName, teamName, expectedCapacity, capacity}, {signal}={}) -> Promise<success body>; thrown errors carry status, code, loginUrl, recoveryUrl, and currentCapacity only.
- Produces: trackPlanningCapacityAction(workflowAction, {result}={}) using planning_action.

- [x] **Step 1: Add failing API request-contract tests**

Use loadApiModule in tests/test_frontend_api_source_guards.js to assert:

- fetchCapacity uses trackedFetch('jira_team_capacity', ..., {featureName: 'planning_capacity_edit'}), preserves teams/sprint query encoding, and passes signal;
- updateCapacity fetches a fresh `/api/auth/csrf` token for every intentional mutation, encodes the issue key in the PATCH path, sends Content-Type, X-Requested-With, X-CSRF-Token, signal, and reconstructs the exact four-field body;
- two concurrent intentional writes make two CSRF requests and send distinct one-time tokens; duplicate UI submit suppression is owned by the card state machine, not token reuse;
- capacityApi.js imports the public `fetchCsrfToken` export from authApi.js and contains no private `fetchMutationCsrfToken` reference or shared in-flight CSRF `Map`;
- caller-injected `project`, `fieldId`, Jira URL, analytics metadata, and unknown properties are discarded before `JSON.stringify`;
- a conflict error carries only the sanitized currentCapacity and standard structured fields;
- read and write errors do not expose arbitrary response keys;
- deliberate scope/unmount AbortError is rethrown without emitting an `api_result` status-0 failure, while genuine network failures still emit the existing status-0 result;
- engApi.js no longer exports or contains /api/capacity.

- [x] **Step 2: Add failing analytics allowlist and privacy tests**

In tests/test_analytics_events.js, assert trackApiResult accepts jira_team_capacity and emits only the existing bucketed API contract. In tests/test_analytics_source_guards.js, use AST/token-aware checks rather than a raw `body.includes('capacity')` ban: allow the fixed `planning_capacity_edit` feature literal and approved workflow strings, forbid dynamic object spreads plus raw identifiers/keys such as `issueKey`, `teamName`, `sprintName`, `expectedCapacity`, `jiraUrl`, `jql`, `error`, and credential fields. Add runtime deep-equality assertions for open, submit, success, failure, and conflict payloads.

Run:

~~~bash
node --test --test-name-pattern='capacity|planning capacity|jira_team_capacity' tests/test_frontend_api_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
~~~

Expected: FAIL because the module, API surface, and analytics helper do not exist.

- [x] **Step 3: Implement capacityApi.js with a fresh one-time CSRF token per mutation**

Import `fetchCsrfToken` from `frontend/src/api/authApi.js`. Do **not** copy `jiraIssueApi.js`'s in-flight CSRF `Map`: backend validation consumes a token on first use. Call `fetchCsrfToken(backendUrl)` immediately and independently for each `updateCapacity` call. Reconstruct the body from the four supported fields:

~~~js
export async function updateCapacity(backendUrl, issueKey, payload, { signal } = {}) {
    const { csrfToken } = await fetchCsrfToken(backendUrl);
    const body = {
        sprintName: payload?.sprintName,
        teamName: payload?.teamName,
        expectedCapacity: payload?.expectedCapacity,
        capacity: payload?.capacity,
    };
    const response = await trackedFetch(
        'jira_team_capacity',
        backendUrl + '/api/capacity/' + encodeURIComponent(issueKey),
        {
            method: 'PATCH',
            cache: 'no-cache',
            signal,
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'jira-execution-planner',
                'X-CSRF-Token': csrfToken || '',
            },
            body: JSON.stringify(body),
        },
        { featureName: 'planning_capacity_edit', suppressAbortResult: true },
    );
    return capacityJsonOrError(response);
}
~~~

`capacityJsonOrError` must parse non-OK JSON once, create `Error(code || 'jira_capacity_update_failed')` without using backend `message`, attach only status, code, safe structured login/recovery candidates, and attach currentCapacity only when code is capacity_conflict and the value is null or a finite non-negative number. It must discard arbitrary response keys.

Add an opt-in `suppressAbortResult` analytics option to `trackedFetch`: in its catch branch, if `error.name === 'AbortError'` and the option is true, rethrow before `safelyTrackApiResult`; all existing callers and genuine failures retain current behavior. Capacity GET/PATCH set this option. Add a focused `tests/test_analytics_events.js` case that abort emits no API event and network rejection still emits status 0.

- [x] **Step 4: Move the existing read wrapper and add API analytics**

Move fetchCapacity from engApi.js to capacityApi.js without changing query semantics, switch its raw fetch to trackedFetch with `jira_team_capacity` plus `{featureName:'planning_capacity_edit', suppressAbortResult:true}`, and keep Response return semantics so dashboard parsing remains explicit.

Add jira_team_capacity to API_SURFACES in analytics.js. Add:

~~~js
const CAPACITY_WORKFLOW_ACTIONS = new Set([
    'capacity_edit_open',
    'capacity_change_submit',
    'capacity_change_result',
]);

const trackPlanningCapacityAction = useCallback((workflowAction, { result } = {}) => {
    if (!CAPACITY_WORKFLOW_ACTIONS.has(workflowAction)) return;
    const payload = {
        feature_name: 'planning_capacity_edit',
        workflow_action: workflowAction,
        source_surface: 'planning',
    };
    if (workflowAction === 'capacity_change_result' && ['success', 'failure', 'conflict'].includes(result)) {
        payload.result = result;
    }
    trackProductEvent('planning_action', payload);
}, [trackProductEvent]);
~~~

Return it from useDashboardAnalytics. Extra/override caller params are structurally discarded; do not add a new event name or analytics parameter.

- [x] **Step 5: Run API and analytics tests**

Run:

~~~bash
node --test --test-name-pattern='capacity|planning capacity|jira_team_capacity' tests/test_frontend_api_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
~~~

Expected: PASS.

---

### Task 6: Build Explicit Capacity Target State And Guard Dashboard Reconciliation

**Files:**
- Modify: frontend/src/eng/planningCapacityUtils.js:1-30, 245-262
- Modify: tests/test_planning_capacity_utils.js:309-365
- Modify: frontend/src/dashboard.jsx:44, 110-115, 803-805, 5663-5690, 6393-6414, 11231-11363
- Modify: tests/test_planning_action_source_guards.js

**Interfaces:**
- Produces: normalizeCapacityTeamName(name) -> display string and normalizeCapacityKey(name) -> lowercase key.
- Produces: resolveUniqueCapacityValue(capacityByTeam, teamName) -> {matched, value}; exact normalized match wins, otherwise only one fuzzy containment candidate may match.
- Produces: buildCapacityReadState(payload) -> {capacityByTeam, capacityTargetsByTeam, mutationEnabled}; the boolean is true only for exact server `true`.
- Produces: parseCapacityDraft(text) -> {valid: bool, value: number|null}; blank, negative, and non-finite text is invalid while 0 and finite decimals are valid.
- Produces: safeCapacityRecoveryUrl(error, origin) -> same-origin `/login?...` or `/auth/...` path, otherwise empty.
- Produces: buildSelectedTeamEntries receives both numeric and target maps and adds rawCapacity, hasCapacityValue, capacityIssueKey, capacityTargetTeamName, capacityTargetCapacity, and capacityTargetState without coupling display math to the mutation baseline.
- Produces: one atomic dashboard capacityState {capacityByTeam, capacityTargetsByTeam, mutationEnabled, scopeSignature}, dashboard-owned capacityReadRevision plus capacityReadError/stale flags, and onCapacitySaved({issueKey, sprintName, teamName, capacity, scopeSignature}) guarded by the active full scope signature. Only a successful HTTP capacity response advances the revision; local PATCH, aborted GET, and failed GET do not.

- [x] **Step 1: Add failing utility tests for zero, missing, ambiguity, and updates**

Extend tests/test_planning_capacity_utils.js with:

~~~js
const state = buildCapacityReadState({
    mutationEnabled: true,
    capacities: { Alpha: 0, Beta: 5 },
    entries: [
        { teamName: 'Alpha', issueKey: 'CAP-101', capacity: 0 },
        { teamName: 'Beta', issueKey: 'CAP-102', capacity: 5 },
        { teamName: 'Beta', issueKey: 'CAP-103', capacity: 6 },
        { teamName: 'Gamma', issueKey: 'CAP-104', capacity: null },
    ],
});

assert.equal(state.capacityByTeam.alpha, 0);
assert.equal(state.mutationEnabled, true);
assert.deepEqual(state.capacityTargetsByTeam.alpha, {
    state: 'matched',
    issueKey: 'CAP-101',
    teamName: 'Alpha',
    capacity: 0,
});
assert.equal(state.capacityTargetsByTeam.beta.state, 'ambiguous');
assert.equal(state.capacityTargetsByTeam.gamma.capacity, null);
~~~

Update buildSelectedTeamEntries coverage to prove rawCapacity is unmultiplied, teamCapacity remains multiplied, 0 sets hasCapacityValue true, null stays false, and missing/ambiguous targets have no issue key while an ambiguous target still preserves numeric card calculations. Add Alpha/Alpha Core cases proving exact normalized matches win and a non-exact value/target is used only when the containment candidate is unique; expose the target's canonical name/capacity independently from `rawCapacity`. Include an exact Alpha target with null plus a fuzzy numeric Alpha Core value of 5: the display math may show 5, but the editor baseline must be null/blank for Alpha. Add a pure applyCapacitySaveResult test that immutably updates both maps only for a matching canonical target team plus issue key.
Add parseCapacityDraft cases for '', '-', '-1', 'Infinity', 'abc', '0', '5.5', and '1e2'; assert only the last three are valid and numeric. Add `safeCapacityRecoveryUrl` cases for `loginUrl`, a route-owned `/login` in `recoveryUrl`, `/auth/reconnect`, `/login-evil`, protocol-relative, cross-origin, JavaScript, blank, and malformed candidates.

- [x] **Step 2: Run Planning capacity unit tests and verify red**

Run:

~~~bash
node --test tests/test_planning_capacity_utils.js
~~~

Expected: FAIL because the state builders and explicit fields are missing.

- [x] **Step 3: Move normalization and implement target grouping**

Move the existing normalizeCapacityKey/toCapacityShortName behavior out of dashboard.jsx into planningCapacityUtils.js as exported normalizeCapacityKey and normalizeCapacityTeamName. Implement buildCapacityReadState with these invariants:

- capacities accepts only finite numeric values and retains 0;
- entries requires non-empty teamName and issueKey;
- repeated copies of the same issue key are deduplicated;
- one unique issue is matched;
- more than one unique issue is ambiguous and exposes no actionable issueKey;
- a matched null capacity remains a safe editable target.

Implement one generic exact-first/unique-containment candidate resolver and expose `resolveUniqueCapacityValue` plus `resolveUniqueCapacityTarget` wrappers over the numeric and target maps. Use the same candidate selection for every numeric/card/action lookup. Preserve exact matches, including `0`; for the legacy containment fallback, return a value or target only when exactly one candidate matches. An ambiguous target remains non-actionable, but target-map ambiguity never erases a separately valid numeric result.

Implement applyCapacitySaveResult(state, result) to return new maps without changing `mutationEnabled`, validate the backend result's normalized canonical target team and issue key against the current matched target, and otherwise return the original state unchanged. A displayed-team alias is never substituted into Jira identity. Missing, false, or non-boolean `payload.mutationEnabled` normalizes to false.
Implement parseCapacityDraft with an explicit trimmed-empty guard before Number(text), then Number.isFinite(value) and value >= 0. This prevents Number('') from turning an empty editor into an unintended zero write.
Implement `safeCapacityRecoveryUrl` by considering `loginUrl` and `recoveryUrl`, rejecting any candidate that does not begin with exactly one `/`, resolving with `new URL(candidate, origin)`, requiring the same origin, and allowing only `pathname === '/login'` or `pathname.startsWith('/auth/')`. Return only pathname/search/hash. Do not reuse the existing loose login-prefix redirect helper and do not navigate automatically.

- [x] **Step 4: Extend selected-team entries without changing derived math**

Update buildSelectedTeamEntries to accept capacityByTeam plus capacityTargetsByTeam and use the same numeric resolver as `getTeamCapacity` while retaining existing getTeamNetCapacity/adjusted math. Add:

~~~js
const target = resolveUniqueCapacityTarget(capacityTargetsByTeam, team.name);
const numeric = resolveUniqueCapacityValue(capacityByTeam, team.name);
const rawCapacity = numeric.matched ? numeric.value : null;
return {
    id: team.id,
    name: team.name,
    storyPoints: selectedTeamStats[team.id]?.storyPoints || 0,
    teamCapacity: capacityEnabled ? getTeamCapacity(team.name) * capacityMultiplier : null,
    planningCapacity: capacityEnabled ? getTeamNetCapacity(team) * capacityMultiplier : null,
    rawCapacity,
    hasCapacityValue: numeric.matched,
    capacityIssueKey: target.state === 'matched' ? target.issueKey : '',
    capacityTargetTeamName: target.state === 'matched' ? target.teamName : '',
    capacityTargetCapacity: target.state === 'matched' ? target.capacity : null,
    capacityTargetState: target.state,
};
~~~

Define `capacityShareLabel` beside the existing `capacitySplit`/`capacityMultiplier` calculation:

~~~js
const capacityShareLabel = showProduct && !showTech
    ? `Planning Product share ${Math.round(capacitySplit.product * 100)}%`
    : showTech && !showProduct
        ? `Planning Tech share ${Math.round(capacitySplit.tech * 100)}%`
        : '';
~~~

Both-on and both-off yield an empty label. Add unit/source coverage for Product-only `70%`, Tech-only `30%`, both-on empty, and both-off empty before passing the value to the card component; do not reference an undeclared JSX name.

- [x] **Step 5: Integrate atomic read state, full-scope generation ownership, and manual retry**

Import `fetchCapacity as requestCapacity` and `updateCapacity` from capacityApi.js; preserve the existing local loader name `fetchCapacity` so there is no identifier collision or accidental recursion. Replace standalone capacityByTeam with one capacityState object returned by buildCapacityReadState. After applying the render-time scope-signature guard, destructure both effective maps and define the exact fail-closed alias `const capacityMutationEnabled = effectiveCapacityState.mutationEnabled === true`; never derive it from bootstrap config. Add `capacityReadRevision`, `capacityRefreshNonce`, `capacityReadGenerationRef`, `capacityReadAbortRef`, and an active full scope signature built from sprint plus sorted/deduplicated normalized team names.

Each effect run increments/invalidates the generation and aborts the previous GET **before** evaluating early-return gates. If capacity is disabled, Planning closes, or the sprint disappears while still mounted, abort/invalidate, install fail-closed empty targets/`mutationEnabled:false` for the current render scope, and clear `capacityLoading`. On unmount, cleanup only aborts and invalidates refs; it never calls a state setter. Otherwise snapshot the scope signature, clear actionable target state immediately on a new scope, and pass the new AbortSignal to `requestCapacity`. Every success, disabled, catch, and finally branch checks both generation and signature before touching state or `capacityLoading`; `AbortError` touches neither error state nor revision. A successful enabled or disabled HTTP response atomically installs a complete replacement state tagged with the scope signature, clears the read error/stale flags, and increments `capacityReadRevision`.

On a current-scope HTTP/network failure, never turn unknown capacity into zero and never leave stale Jira actions active. If the previous state belongs to the same scope, preserve its numeric map as visibly stale, clear only `capacityTargetsByTeam`, force `mutationEnabled:false`, and set a fixed `capacityReadError` with retry; if the scope changed, install empty maps/false for the new scope plus the error. Do not advance the revision. A local PATCH success calls `setCapacityState(previous => applyCapacitySaveResult(previous, result))` and never advances the read revision.

Increment `capacityRefreshNonce` from the existing manual ENG Refresh path and from the explicit capacity retry action, and include it in the capacity effect so a reread occurs even when sprint/teams are unchanged. Add a runtime/source test proving the loader calls aliased `requestCapacity`, not itself.

Replace `getTeamCapacity`'s truthiness/first-fuzzy-match behavior with the shared resolver:

~~~js
const resolved = resolveUniqueCapacityValue(capacityByTeam, teamName);
return resolved.matched ? resolved.value : 0;
~~~

Tag every installed state with its scope signature and derive empty effective maps during render whenever `capacityState.scopeSignature !== capacityScopeSignature`; old values/actions therefore cannot flash before the fetch effect runs. Keep `activeCapacityScopeRef` synchronized during render (a fail-closed ref assignment, not passive `useEffect`) and use a stable callback that reads it at response time. Apply `applyCapacitySaveResult` only when `result.scopeSignature` equals the active ref and the target still matches. The editor adds its captured client-only signature to the sanitized success body before invoking the callback; it is never sent to the backend:

~~~js
const activeCapacityScopeRef = React.useRef('');
activeCapacityScopeRef.current = capacityScopeSignature;

const handleCapacitySaved = React.useCallback((result) => {
    if (result.scopeSignature !== activeCapacityScopeRef.current) return;
    setCapacityState((previous) => applyCapacitySaveResult(previous, result));
}, []);
~~~

Update tests/test_planning_action_source_guards.js to prove dashboard.jsx delegates API calls/state shaping and contains neither capacity editor markup nor document-level editor listeners.

Add deferred-request tests for unmount, Planning-off, capacity-disabled, and sprint-cleared transitions. Gate-off transitions must abort/invalidate, clear loading/actions, and reject late branches. Unmount must prove abort/invalidation and no post-unmount state setter or late installation.

- [x] **Step 6: Run utilities and source guards**

Run:

~~~bash
node --test tests/test_planning_capacity_utils.js tests/test_planning_action_source_guards.js tests/test_frontend_api_source_guards.js
~~~

Expected: PASS.

---

### Task 7: Replace Inline Team Cards With The Accessible Capacity Editor

**Files:**
- Create: frontend/src/eng/PlanningTeamCapacityCards.jsx
- Create: frontend/src/ui/JiraMarkIcon.jsx
- Create: tests/ui/planning_capacity_editing.spec.js
- Modify: frontend/src/components/JiraExportButton.jsx:1-6, 109-117
- Modify: frontend/src/dashboard.jsx:16, 44, 15252-15311
- Modify: frontend/src/styles/planning/stat-cards.css:31-42, 91-171, 255-282
- Modify: tests/test_planning_action_source_guards.js

**Interfaces:**
- Consumes: entries, capacityEnabled, canOpenCapacityJira, canEditCapacity, jiraUrl, sprintName, scopeSignature, capacityReadRevision, capacityLoading, capacityReadError, capacityDataStale, capacityShareLabel, updateCapacityRequest, onCapacitySaved, onCapacityRetry, onAnalyticsAction, resolveTeamColor, getTeamCapacityMeta.
- Produces: PlanningTeamCapacityCards with one active editor, responsive grid/card geometry, safe Jira link analytics, per-target/config-wide invalidation, and suppression that resets only on a successful read revision.
- Produces: JiraMarkIcon({className=''}) reused by JiraExportButton and capacity links.

- [x] **Step 1: Create a synthetic Playwright fixture and failing default/hover test**

Create tests/ui/planning_capacity_editing.spec.js by reusing the route/bootstrap style in codebase_structure_smoke.spec.js. Supply synthetic OAuth config, sprint 2026Q2, teams Alpha/Beta/Gamma, selected Planning stories, and:

~~~json
{
  "enabled": true,
  "mutationEnabled": true,
  "sprint": "2026Q2",
  "capacities": {"Alpha": 5.5, "Beta": 0},
  "entries": [
    {"teamName": "Alpha", "issueKey": "CAP-101", "capacity": 5.5},
    {"teamName": "Beta", "issueKey": "CAP-102", "capacity": 0},
    {"teamName": "Gamma", "issueKey": "CAP-103", "capacity": null}
  ]
}
~~~

The first test must assert idle action opacity/pointer state, normal card geometry, hover visibility, exactly two controls, accessible names, and Jira href/target/rel plus safe external-link analytics. Add empty, malformed, protocol-relative, and trailing-slash Jira base cases: only normalized absolute HTTP(S) bases render the link. It must fail because the controls do not exist.

- [x] **Step 2: Add failing edit/save/cancel/conflict tests**

Add tests that prove:

- pencil replaces only .microbar and pre-fills 5.5, 0, or blank;
- displayed alias Alpha with unique canonical Jira target Alpha Core pre-fills from `capacityTargetCapacity`, submits `teamName:'Alpha Core'`, succeeds, and keeps Alpha as the UI label/scope identity; multiple alias candidates remain ambiguous and send no PATCH;
- input is focused/selected;
- blank, negative, invalid, and unchanged values disable save;
- Enter/checkmark each produce one PATCH with the exact four-field body;
- submitting prevents duplicate PATCH and ignores Escape/outside-pointer cancellation until the request settles;
- Escape, explicit cancel, and outside pointer make no PATCH;
- explicit keyboard/button cancel restores focus to that card's pencil; success restores focus after capacity-driven reordering when the same target still exists, and safely skips restoration when it no longer exists;
- while editing, exactly one editor form exists and every Jira/pencil action rail is absent across the grid, making a second pointer/keyboard edit activation unavailable;
- success updates the card/delta/aggregate without a task or capacity refetch;
- conflict keeps the typed value, displays the current Jira value or `Capacity is now blank in Jira`, then sends that value/null as expectedCapacity on the next explicit save;
- already_current from the validation GET and from PUT-409 reconciliation exits edit and reconciles the card as achieved, including when the old expected baseline was stale;
- permission/generic errors preserve draft;
- login/missing-scope uses only validated same-origin `/login`; revoked/stale/disabled/missing-project uses visible validated `/auth/` recovery without exposing backend text; malicious absolute/protocol-relative URLs are neither rendered nor navigated and the draft remains;
- issue mismatch/not-found/uneditable suppresses only that target until a successful capacity GET; capacity_config_missing disables every pencil until successful reload; manual Refresh/retry performs that GET;
- reverse-order deferred GETs across two sprints and two normalized-team scopes prove late old success, error, and finally branches cannot replace state/actions/loading;
- resolve an old GET and PATCH in the same turn as a scope switch, before passive effects flush, and prove the render-synchronized signature/epoch rejects both;
- unrelated Planning selection, multiplier, or exclusion recomputation does not reset invalid suppression or discard a draft;
- a successful same-scope reread that makes the edited target missing, ambiguous, or a different issue key preserves the draft in a disabled safe state and produces no PATCH; unchanged matched issue key may keep editing with its captured expected baseline;
- a successful same-scope reread with the same target but `mutationEnabled:false` immediately disables the open editor and produces no PATCH; a config-wide PATCH failure preserves the draft but a second Enter/checkmark attempt makes no additional request until a successful verified reread;
- a current-scope GET failure preserves prior numeric values only as visibly stale, removes Jira/pencil actions, and shows a fixed retry control; a new-scope failure shows unavailable rather than zero;
- repeated Retry clicks while `capacityLoading` is true do not start or abort/restart additional GETs; the disabled control exposes an accessible loading label/state;
- sprint/team scope switch aborts or ignores the late old-scope success and does not claim a submitted write was canceled;
- Basic mode and unresolved auth render neither Jira nor pencil controls. A signed-in OAuth user with `mutationEnabled:false` may still see the matched Jira link but renders no pencil/editor; an unverified-but-readable DB row still renders its numeric value/OAuth Jira link, produces zero PATCH calls, and shows no pencil. OAuth edit gating must not reference userCanEditSettings, userCanEditEpmConfig, SETTINGS_ADMIN_ONLY, or any tool-admin flag;
- Product-only and Tech-only cards keep adjusted visible capacity while the editor visibly labels its prefilled value as Jira total capacity and explains the applied Planning share.

Run:

~~~bash
npx playwright test tests/ui/planning_capacity_editing.spec.js --grep 'hover|edit|save|cancel|conflict|scope'
~~~

Expected: FAIL because PlanningTeamCapacityCards does not exist.

- [x] **Step 3: Extract and reuse the Jira mark**

Create JiraMarkIcon.jsx with the exact two existing JiraExportButton paths, aria-hidden true, and focusable false. Replace JiraExportButton's inline SVG with JiraMarkIcon while retaining jira-export-icon and all existing menu behavior. Add a source-guard assertion that the path data exists only in JiraMarkIcon.jsx.

- [x] **Step 4: Implement card rendering and the one-editor state machine**

PlanningTeamCapacityCards must:

- sort by selected-minus-adjusted-capacity exactly as current dashboard JSX, then selected SP;
- preserve the literal existing desktop algorithm: `rows = teamCount === 6 ? 2 : Math.ceil(teamCount / 6)`, then `columns = Math.ceil(teamCount / rows)`. Expose `columns` through a CSS custom property used by the existing grid rather than inline `gridTemplateColumns`, so six teams remain 3×2 and the mobile media rule can override it;
- compute microbar scale/marker/delta with explicit hasCapacityValue so 0 renders Cap 0.0 without division or percentage;
- use a stable team id key and refs keyed by capacityIssueKey for focus restoration;
- keep activeIssueKey, canonical target team, target capacity baseline, displayed team identity, draft, submitting, error, invalidTargets, and AbortController state local;
- when activeIssueKey is non-empty, omit every card action rail and render only the active card's editor form; no second edit trigger is available until save or cancel closes that form;
- clear/detach editor state on scopeSignature change; reset invalidTargets and config-wide suppression only when capacityReadRevision advances; do not cancel merely because entries is recomputed or a local save updates capacity values;
- when capacityReadRevision advances, compare the active editor's captured issue key with the refreshed matched target. Preserve the draft but disable Save with fixed mapping-changed copy when the target is now missing, ambiguous, or different; revalidate the same condition immediately before every PATCH call;
- derive one fail-closed `submitBlockedReason` covering `!canEditCapacity`, config-wide suppression, `capacityReadError`, `capacityDataStale`, and target remapping. Use it both in Save's disabled calculation and as the first submit-handler guard before CSRF/PATCH. Preserve the draft and render fixed status copy when blocked; a hidden pencil is never treated as sufficient authorization.
- abort the browser PATCH on unmount/scope change when possible but never call it canceled after submission; ordinary pre-submit cancel has no request to abort;
- listen for pointerdown only while an editor is open;
- ignore Escape/outside pointer and disable explicit cancel while submitting; a deferred-PATCH test must prove the unresolved editor remains visible;
- ignore AbortError and never convert it to a visible failure;
- call onCapacitySaved with captured sprintName and client-only scopeSignature added to the sanitized success body;
- call onAnalyticsAction with only capacity_edit_open, capacity_change_submit, or capacity_change_result plus result success/failure/conflict.
- seed the editor and `expectedCapacity` from `capacityTargetCapacity` (including null), never from fuzzy `rawCapacity`; parse the input through parseCapacityDraft and send its numeric value plus `capacityTargetTeamName`, never the displayed alias or input's string value; compare that number to the target baseline before enabling save.
- when capacityReadError is set, render a fixed `role="status"` message plus native `Retry capacity` button wired to onCapacityRetry. Use `Capacity could not be refreshed. Showing last loaded values.` when capacityDataStale and `Capacity is unavailable. Retry.` otherwise; both states suppress Jira/pencil actions. Disable Retry while `capacityLoading`, set `aria-busy`, and change its accessible name to `Retrying capacity` without firing another request.

Normalize `jiraUrl` with a helper that accepts only absolute HTTP(S), strips trailing slashes, and returns an empty string otherwise. Render the matched-card Jira link only when no editor is active, `canOpenCapacityJira` is true, and that helper returns a value:

~~~jsx
<TrackedExternalLink
    className="team-capacity-action"
    href={safeJiraBase + '/browse/' + encodeURIComponent(info.capacityIssueKey)}
    target="_blank"
    rel="noopener noreferrer"
    analyticsMeta={buildJiraBrowseLinkAnalytics({
        issueKind: 'unknown',
        sourceSurface: 'planning',
    })}
    aria-label={'Open ' + info.name + ' capacity ticket in Jira'}
>
    <JiraMarkIcon className="team-capacity-jira-icon" />
</TrackedExternalLink>
~~~

Render the pencil with IconButton only when no editor is active, canEditCapacity is true, and config-wide editing is not suppressed. The editor form uses input type number, min 0, step any; `aria-busy={submitting}`; a stable error id in `aria-describedby`; IconButton Save with `type="submit"`; Cancel with `type="button"`; disabled controls while submitting; native form submit; and pre-submit keydown Escape cancellation. Keep input/Save/Cancel in one row at exactly the same 28px height; cap the input at 84px on desktop and let it shrink at 375px. The visible field copy is `<team> Jira total planned capacity`; Product-only/Tech-only modes show the supplied share label beside it.

Use fixed client copy rather than error.message or raw response text:

~~~js
const CAPACITY_ERROR_MESSAGES = {
    invalid_capacity: 'Enter a valid capacity of 0 or more.',
    capacity_target_changed: 'This card now maps to a different Jira capacity ticket. Cancel and reopen the editor.',
    capacity_read_failed: 'Capacity could not be refreshed. Retry before editing.',
    capacity_forbidden: 'Jira did not allow this capacity change.',
    capacity_issue_not_found: 'This capacity ticket is no longer available. Refresh Planning.',
    capacity_config_missing: 'Capacity editing is no longer configured. Refresh Planning.',
    capacity_config_unverified: 'Capacity editing needs an Admin to verify the Jira Capacity field. Refresh after it is saved.',
    capacity_config_conflict: 'Capacity configuration needs Admin resolution. Refresh after it is resolved.',
    capacity_issue_mismatch: 'This card no longer matches its Jira capacity ticket. Refresh Planning.',
    capacity_field_not_editable: 'The configured Capacity field cannot be edited on this Jira issue.',
    config_storage_unavailable: 'Capacity configuration is temporarily unavailable. Try again.',
    jira_oauth_required: 'Sign in with Atlassian to edit capacity.',
    jira_capacity_update_conflict: 'Jira could not apply the capacity change yet. Review and try again.',
    jira_capacity_update_failed: 'Capacity could not be updated in Jira. Try again.',
};
~~~

Use the final generic message for unknown codes. For capacity_conflict, render null as `Capacity is now blank in Jira. Review and save again, or cancel.` and numeric values as `Capacity changed in Jira to <value>. Review and save again, or cancel.` Mark issue-not-found, mismatch, and field-not-editable as local target failures; mark capacity_config_missing, capacity_config_unverified, and capacity_config_conflict as config-wide/reload-required; permission and transient failures remain explicitly retryable. Tests cover a config becoming unverified or unresolved after the successful GET but before PATCH, with draft preservation and no generic raw-message fallback.

Import only the Task 6 `safeCapacityRecoveryUrl` helper; do not import or call `redirectToAuthRecovery`/`location.assign` after a failed mutation, because automatic navigation would discard the draft. Render the sanitizer result as a visible user-invoked recovery anchor while the editor/draft stays open. This includes the route-owned `missing_oauth_scope` recoveryUrl of `/login?reason=missing_scope`. Tests cover auth-required, missing scope, revoked, stale, disabled, missing project, `/login-evil`, malicious absolute/protocol-relative values, no automatic navigation, and navigation only after explicit click.

- [x] **Step 5: Delegate dashboard rendering and wire OAuth gating**

Replace the inline IIFE/card JSX with:

~~~jsx
<PlanningTeamCapacityCards
    entries={selectedTeamEntries}
    capacityEnabled={capacityEnabled}
    canOpenCapacityJira={authMode === 'atlassian_oauth'}
    canEditCapacity={authMode === 'atlassian_oauth' && capacityMutationEnabled === true}
    jiraUrl={jiraUrl}
    sprintName={selectedSprintInfo?.name || ''}
    scopeSignature={capacityScopeSignature}
    capacityReadRevision={capacityReadRevision}
    capacityLoading={capacityLoading}
    capacityReadError={capacityReadError}
    capacityDataStale={capacityDataStale}
    capacityShareLabel={capacityShareLabel}
    updateCapacityRequest={(issueKey, payload, options) =>
        updateCapacity(BACKEND_URL, issueKey, payload, options)}
    onCapacitySaved={handleCapacitySaved}
    onCapacityRetry={() => setCapacityRefreshNonce((value) => value + 1)}
    onAnalyticsAction={trackPlanningCapacityAction}
    resolveTeamColor={resolveTeamColor}
    getTeamCapacityMeta={getTeamCapacityMeta}
/>
~~~

Update the source guard to require this delegation and forbid team capacity form/input/listener markup in dashboard.jsx.
Also assert `canOpenCapacityJira` requires exact OAuth mode; `capacityMutationEnabled` comes from the current scope's successful capacity response (the bootstrap flag is only an initial fail-closed hint); and `canEditCapacity` is derived exactly from OAuth mode plus that server attestation flag. Neither gate may be combined with a settings/admin permission flag.

- [x] **Step 6: Add scoped CSS using existing control grammar**

In stat-cards.css:

- make only .team-stat-card.team-card position relative;
- reserve the action footprint through label padding within the existing card width;
- make the action rail absolute top/right, opacity 0 and pointer-events none at idle, visible on card hover and focus-within;
- reserve enough label-row height/margin that the revealed rail has a positive measured vertical gap above `.microbar`;
- keep focused actions visible and use existing focus outline variables;
- set hoverless media to visible/pointer-enabled;
- size Jira/pencil/save/cancel controls from the existing compact IconButton grammar without overriding IconButton display/flex layout;
- use a shared editor-control height of 28px for the number input, Save, and Cancel; align their top/bottom edges and cap only the input's desktop width at 84px while permitting flex shrink;
- set the desktop grid count through a feature-owned CSS custom property and let the existing mobile `auto-fit, minmax(120px, 1fr)` rule override it;
- keep the idle/edit/submitting form footprint aligned to the microbar/meta area and show the raw/share context without hiding selected-SP meaning;
- keep error text inside card width, fully visible (`scrollWidth <= clientWidth` and `scrollHeight <= clientHeight`), and permit bounded row-height expansion with sibling alignment;
- suppress the card's hover tooltip while editing/error text is active so it does not cover controls;
- retain the existing stuck-panel tooltip direction and sticky z-index.

Do not add a card min-width, nowrap label overflow, bespoke button reset, local IconButton layout override, or a new global control class.

- [x] **Step 7: Run focused interaction coverage**

Run:

~~~bash
node --test tests/test_planning_action_source_guards.js
npx playwright test tests/ui/planning_capacity_editing.spec.js --grep 'hover|edit|save|cancel|conflict|scope'
~~~

Expected: PASS.

---

### Task 8: Prove Geometry, Sticky Safety, Analytics Documentation, And Reproducible Build

**Files:**
- Modify: tests/ui/planning_capacity_editing.spec.js
- Modify: tests/ui/codebase_structure_smoke.spec.js
- Modify: docs/README_ANALYTICS.md
- Modify: docs/plans/README.md
- Modify if measured failure requires a ratchet: tests/test_codebase_structure_budgets.py
- Regenerate: frontend/dist/dashboard.js
- Regenerate: frontend/dist/dashboard.js.map
- Regenerate: frontend/dist/dashboard.css

**Interfaces:**
- Consumes: all prior task contracts.
- Produces: settled visual proof, complete analytics taxonomy, clean generated bundle, and executable-plan status index.

- [x] **Step 1: Add element-level geometry and hoverless assertions**

For one, six, and seven teams at desktop width and 375px, assert:

- each card stays within its grid cell;
- label right edge clears the action rail;
- label scrollWidth/clientWidth reflects intentional ellipsis only and never crosses the next control;
- Jira/pencil/input/save/cancel/error rectangles stay inside the card;
- the revealed action rail's bottom edge remains above the microbar's top edge with a positive gap;
- the editing grid contains one form and zero Jira/pencil action rails; input/Save/Cancel have equal 28px heights and matching top/bottom coordinates;
- the desktop input and wrapper are at most 84px wide; at 375px the input is narrower than its measured desktop width while input/Save/Cancel remain on the same row and inside the card;
- read-error status and Retry/Retrying control rectangles stay inside the card at desktop, 375px, and sticky Planning positions; repeated activation while loading is disabled and creates no extra GET;
- card widths and row heights remain stable between default, hover, edit, submitting, and success; conflict/error may expand to a bounded readable row while siblings align;
- touch/no-hover media exposes actions in a Playwright context created with touch/mobile capability; do not attempt unsupported page media emulation;
- document width does not overflow at 375px and the mobile `auto-fit` rule wins over the desktop custom column count;
- the Jira-total label/share context and error text have no horizontal or vertical clipping (`scrollWidth/clientWidth`, `scrollHeight/clientHeight`);
- keyboard Tab reveals both controls with visible focus outlines.

Use getBoundingClientRect on the actual label and controls, not only parent containers.

- [x] **Step 2: Add settled screenshots and inspect them**

Disable animations/transitions or wait for them to settle, then capture named screenshots for:

- default idle cards;
- Alpha hovered;
- Alpha editing;
- Beta capacity 0;
- conflict;
- stale/unavailable capacity with Retry and pending Retrying states;
- hoverless/touch;
- Planning stuck with editor/error visible.

Save screenshots through Playwright's configured output; do not commit real Jira data. Compare the revealed/editing screenshots against the approved synthetic reference, then inspect every image for clipping, overlapping controls, tooltip interference, uneven card rows, and sticky overlap before accepting the test.

- [x] **Step 3: Re-run cross-mode sticky proof**

Extend the fixture options in `tests/ui/codebase_structure_smoke.spec.js` with a non-empty `capacityProject`, exact `atlassian_oauth` auth mode, enabled capacity entries, `/api/auth/csrf`, and a deferred/error PATCH response. Interact with the pencil before measuring the editing/error state; merely changing the `/api/capacity` response is insufficient. Keep the existing ENG Catch Up, Planning, and Scenario scoped-startup/sticky assertion intact and prove planning-panel.open remains above .epic-header while Planning editing/error state is visible.

Run:

~~~bash
npx playwright test tests/ui/planning_capacity_editing.spec.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g 'ENG Catch Up, Planning, and Scenario render with scoped startup and sticky checks'
~~~

Expected: PASS with screenshots reviewed.

- [x] **Step 4: Update the analytics taxonomy and plan index**

In docs/README_ANALYTICS.md document:

- trigger userevent;
- event_type event;
- canonical event_name planning_action;
- feature_name planning_capacity_edit;
- source_surface planning;
- workflow_action values capacity_edit_open, capacity_change_submit, capacity_change_result;
- result only on result events;
- API surface jira_team_capacity;
- explicit forbidden raw fields from Global Constraints;
- existing external_link_opened/jira_issue_browse coverage for the Jira icon;
- no GA4 custom-dimension registration.

Update docs/plans/README.md so this EXEC plan follows the SUPPORT design and reflects its implemented status after every review finding is resolved.

- [x] **Step 5: Run focused frontend and backend suites**

Run:

~~~bash
.venv/bin/python -m unittest tests.test_shared_capacity_config tests.test_shared_capacity_config_db tests.test_shared_capacity_config_routes tests.test_shared_capacity_config_import tests.test_analytics_routes tests.test_config_jsonfile_fallback tests.test_db_migrations tests.test_user_view_config_routes tests.test_view_config_validator tests.test_auth_context tests.test_auth_context_db tests.test_csrf_token_bound tests.test_db_admin_bootstrap tests.test_db_admin_routes tests.test_db_auth_recovery_pages tests.test_db_oauth_cutover tests.test_home_credential_resolver tests.test_oauth_eng_routes tests.test_oauth_route_guards tests.test_scenario_draft_routes tests.test_shared_group_config_routes tests.test_team_catalog_api tests.test_user_api_token_connections tests.test_capacity_service tests.test_oauth_capacity_routes tests.test_oauth_stats_routes tests.test_oauth_settings_routes tests.test_dashboard_bootstrap_config_source tests.test_endpoint_security_matrix tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards tests.test_route_move_preservation
node --test tests/test_planning_capacity_utils.js tests/test_planning_action_source_guards.js tests/test_frontend_api_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
npx playwright test tests/ui/planning_capacity_editing.spec.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g 'ENG Catch Up, Planning, and Scenario render with scoped startup and sticky checks'
~~~

Expected: all pass.

- [x] **Step 6: Run the complete repository verification**

Run in this order:

~~~bash
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
.venv/bin/python scripts/check_startup_preflight.py
npm run build
capacity_build_snapshot=$(mktemp -d)
cp -R frontend/dist/. "$capacity_build_snapshot/"
npm run build
diff -qr "$capacity_build_snapshot" frontend/dist
git diff --check
~~~

Expected: all commands exit 0, startup preflight passes, and the second build is byte-for-byte identical to the first. Leave expected regenerated dist changes visible in the uncommitted feature diff. `make verify-dist-clean` is intentionally not a pre-commit gate: run it only after the requester authorizes a commit and generated output is included in that commit. If tests/test_codebase_structure_budgets.py fails only because a touched legacy entrypoint legitimately grew, measure the new count, keep component/editor code outside dashboard.jsx, and ratchet only the exact affected budget to the measured minimum. Do not raise a budget to hide unrelated growth.

Then, with the repository's safe local configuration, run `.venv/bin/python jira_server.py` in a separate terminal, inspect all output before the Flask startup banner, and treat any Python dependency/runtime warning as a failed verification unless intentionally documented. From another terminal run `curl http://127.0.0.1:5050/api/test`; expect HTTP 200 and the existing healthy JSON response, then stop the server cleanly. This startup/API proof is required even when the test suite is green.

- [x] **Step 7: Review the final diff against the design**

Confirm every changed line traces to the design, all generated files match source, no secret/local/real Jira data exists, and git status contains only this feature. Report actual test commands and screenshot paths; do not claim implementation completion from the diff alone.
