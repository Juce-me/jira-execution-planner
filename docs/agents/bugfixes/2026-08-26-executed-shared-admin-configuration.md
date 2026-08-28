# Shared Admin Configuration Design

Status: executed
Type: bugfix

## Problem

DB-backed compatibility endpoints call `save_dashboard_config()`, but `DbConfigRepository` persists the complete payload as the current user's private default `ViewConfig`. `load_dashboard_config()` then selects by `owner_user_id`. An administrator can therefore save environment settings that no other user in the same Jira site sees.

The current compatibility boundary also mixes three ownership models in one private payload:

- administrator-controlled Jira/EPM configuration;
- user-owned saved-view state; and
- the derived team-name catalog, which any authenticated user may refresh through `/api/team-catalog`.

That mix makes a direct "promote the latest compatibility save" migration unsafe. `/api/team-catalog` also creates `change_note='compatibility save'`, and the marked private payload may contain personal filters or stale environment settings. Promoting it wholesale could disclose personal state or select the wrong administrator's configuration.

## Decision

Configuration is shared by every user in the same resolved workspace/Jira site, not globally across every workspace in a deployment. `RequestAuthContext.workspace_id` remains the isolation key because `Workspace` already binds `environment_key` to the Jira cloud/site identity. Sharing across workspace ids would leak project keys, field ids, Home goal scope, and Jira-label mappings between tenants.

This plan intentionally completes the transition from the user-owned EPM compatibility behavior recorded in `DONE-03-db-user-configuration.md` and `DONE-04-db-user-home-epm-read-token.md` to administrator-owned EPM scope/mappings. Those completed plans remain accurate history, but their current-accuracy notes must be updated when this plan is executed. Per-user Home/Townsquare credentials and EPM tab/sprint UI state remain user-owned; only the normalized EPM scope, label mask, issue-type mapping, and project-label mapping become workspace configuration.

## Ownership Boundaries

### Workspace administrator configuration

`WorkspaceDashboardConfig` owns one allowlisted, non-secret payload per workspace. The only stored top-level keys are:

- `version`
- `projects`
- `board`
- `capacity`
- `sprintField`
- `storyPointsField`
- `parentNameField`
- `teamField`
- `projectTrackField`
- `deliveryOwnerField`
- `statsPriorityWeights`
- `issueTypes`
- `epm`

Unknown keys, identity claims, credentials, raw GraphQL operations, `teamGroups`, `teamCatalog`, `filters`, and `eng` are rejected or removed before persistence.

The allowlist is not enough by itself. A shared helper must also normalize and validate the exact nested shape of every section, and routes, recovery, fallback reads, and persistence must use that same helper. Client writes reject unknown top-level and nested fields. Legacy recovery may discard known personal top-level fields, but any forbidden key or malformed shared section rejects the whole candidate instead of partially publishing it.

The row includes a monotonic `config_revision`. Every administrator-controlled write is a section-scoped compare-and-swap using a client-supplied `baseRevision`; a route may change only the section hard-coded by that route. The client never supplies a section name, workspace id, actor id, or replacement full payload.

### Private views

`ViewConfig` remains workspace-and-owner scoped. Runtime view resolution removes administrator-owned top-level sections and the shared EPM keys `version`, `labelPrefix`, `scope`, `issueTypes`, and `projects` so a private view cannot override workspace configuration. The structural top-level `version` field may remain private because it versions that view payload; it is not a runtime configuration override. New or updated private views reject the shared-only fields. Personal EPM state such as `tab` and `selectedSprint` remains in the private view. Existing stored rows and version history are not destructively rewritten, so operators can still export historical data for recovery.

### Department groups and preferences

`teamGroups` remains in `workspace_group_configs`, with current revision-conflict behavior. Per-user visibility and favorite/active-group preferences remain in `user_group_preferences`.

### Team-name catalog

`teamCatalog` moves to its own `WorkspaceTeamCatalog` row because `/api/team-catalog` is intentionally a normal authenticated-user write. Its route accepts only normalized `catalog`, `meta`, and `merge` fields. It cannot call the administrator configuration replacement path or write any administrator-owned section. Server-side compare-and-swap with bounded retry protects concurrent merge refreshes without making the catalog revision part of the public API. This prevents a normal-user catalog refresh from overwriting, advancing, or becoming a migration candidate for administrator configuration.

## Read And Fallback Rules

`DbConfigRepository.load_dashboard_config()` reads only the workspace row selected with `context.workspace_id`. It never reads another user's private default view.

The legacy JSON fallback is permitted in DB mode only for the workspace whose normalized `context.site_url` exactly matches the configured legacy Jira site URL. If the configured site is absent or does not match, the fallback is not returned. This preserves a single-site rollback bridge without exposing one process-wide JSON file to every workspace in a multi-site deployment. Reads never create database rows.

Once a workspace row exists, it is authoritative even when a section is empty; reads never merge later JSON-file changes into the DB row.

When the matching workspace performs its first shared section write at revision zero, the service reloads and normalizes the current fallback, replaces only the route-owned section, and inserts that complete snapshot at revision one. Untouched legacy sections therefore survive cutover. A non-matching workspace starts from an empty snapshot and can never copy fallback data.

`GET /api/config?includeViewConfig=true` returns one atomic `sharedConfig` snapshot plus `sharedConfigRevision`, shared EPM configuration in the existing top-level `epm` compatibility field, and the sanitized personal view separately in `viewConfig`. The Settings modal must seed all shared drafts and their single base revision from that same snapshot; it must not combine section values from independently timed GETs with a newer revision. A private view must never replace `payload.epm`. `GET /api/epm/config` also returns the shared EPM configuration.

## Migration And Recovery

Create `workspace_dashboard_configs` and `workspace_team_catalogs`, each unique on `workspace_id` with workspace foreign keys using `ON DELETE CASCADE`. The administrator row includes `payload_version`, `config_revision`, creator/updater attribution with `ON DELETE SET NULL`, and timezone-aware timestamps. The team-catalog row includes payload version, an internal catalog revision, normalized payload, updater attribution, and timestamps.

The schema migration performs no automatic content backfill from private views. The shared `compatibility save` marker does not identify the originating endpoint, so even one candidate can be a stale private snapshot or a catalog refresh. Automatically publishing it would be an unprovable ownership decision. Existing rows and version history remain untouched, and the exact-site legacy JSON fallback remains read-only until an administrator saves a shared section or an operator completes explicit recovery.

Add an operator-only recovery command that accepts an explicit workspace, view, and version; reads the exact immutable `ViewConfigVersion.payload`; verifies same-workspace ownership, matching active-admin actor/owner, and the `compatibility save` marker; applies the shared section normalizers; and rejects the entire candidate on a forbidden key or malformed section. Dry-run is the default and prints only operator-supplied identifiers, included section names, and a canonical `sha256:` fingerprint. Apply requires both `--apply` and the matching `--expected-sha256`, rechecks the fingerprint in the insertion transaction, and refuses to overwrite an existing workspace row. This prevents heuristic promotion and time-of-check/time-of-use mistakes.

Do not automatically backfill `WorkspaceTeamCatalog`; the derived catalog can be rehydrated safely through its existing Jira discovery flow.

## Concurrency And User Flow

All shared-admin GET responses include the current `configRevision`. All corresponding POST bodies include `baseRevision`; successful POST responses return the incremented revision. The update transaction checks both `workspace_id` and `config_revision`, patches only the route-owned section, records `updated_by`, increments the revision, and writes a redacted `workspace_dashboard_config_updated` audit event containing only the section name and revision.

A stale write returns:

```json
{
  "error": "workspace_config_conflict",
  "message": "Shared settings changed while you were editing. Your changes are still unsaved.",
  "currentRevision": 7,
  "current": {
    "section": "board",
    "value": {},
    "configRevision": 7
  }
}
```

The Settings modal keeps every dirty draft on `409`. Sections saved before the conflict stay committed and are named in the conflict message. "Keep mine" retries the conflicted and remaining dirty sections against `currentRevision`; "Use latest" reloads shared sections and clears only their drafts. Cancel, auth expiry, CSRF failure, network failure, and validation failure all preserve unsaved drafts. A workspace/site switch discards the old workspace baselines and loads the new workspace before enabling Save.

## Authorization And Request Contract

- OAuth GET routes require an active authenticated request context.
- Every unsafe OAuth request requires `X-Requested-With: jira-execution-planner` and a token-bound `X-CSRF-Token` before route code runs.
- Shared administrator writes use the existing `shared_admin_write` policy: tool admin required when `SETTINGS_ADMIN_ONLY=true`; any authenticated user may write when the operator explicitly disables that flag.
- `/api/team-catalog` remains `user_write`, but its payload allowlist and separate repository make privilege escalation into administrator configuration impossible.
- Workspace and actor identity always come from `RequestAuthContext`; payload identity fields are rejected.
- Basic/JSON-file mode retains its current single-user behavior and does not require `baseRevision`.

## Forbidden Regressions

- A second workspace must never read, recover, update, or receive conflict data from the first workspace.
- A process-wide JSON fallback must never be returned to a non-matching Jira site.
- A private view must never override workspace-owned EPM or other administrator configuration.
- A normal-user team-catalog write must never mutate administrator configuration or create an administrator-config audit event.
- Normal users must remain unable to call shared-admin write endpoints when administrator-only settings are enabled.
- `teamGroups` must remain owned by `workspace_group_configs` in DB mode.
- Existing private saved-view ownership, list/default selection, and version history must remain owner-scoped.
- Reads must not mutate the database.
- No payload, Jira/Home identifier, identity value, or credential material may be written to audit metadata or migration logs.
- JSON-file/basic mode must keep its current response and save behavior.

## Acceptance Criteria

- Administrator A saves a shared section and Administrator B plus a normal user in the same workspace read the same value and revision.
- A user in a second workspace receives neither that value nor its conflict snapshot.
- A normal user receives `403 admin_required` on every `shared_admin_write` route when `SETTINGS_ADMIN_ONLY=true`.
- Shared writes without `X-Requested-With` or a valid token-bound CSRF token fail before route code.
- Two administrators saving from the same revision produce one success and one `409`; the first write is preserved and the second user's draft remains recoverable.
- The settings footer threads the new revision through sequential section saves and accurately reports partially committed sections.
- `/api/team-catalog` remains usable by a normal authenticated user but changes only `workspace_team_catalogs`.
- Schema migration never publishes private-view content into shared configuration.
- Explicit recovery can promote only an operator-selected, fingerprint-confirmed, valid administrator version; normal-user catalog versions, later mutable private rows, forbidden keys, malformed shared sections, and fingerprint mismatches are refused.
- `GET /api/config?includeViewConfig=true` returns shared `epm` plus a separate private view that cannot override it.
- Bootstrap adds no browser request or Jira/Home fan-out and reads workspace configuration once per request.
- Private saved-view ownership and JSON-file rollback tests remain green.
- Migration upgrade/downgrade/offline checks, startup preflight, frontend build, focused tests, and the full Python/Node suites pass.

## Files In Scope

- `backend/db/models.py`
- `backend/db/migrations/versions/20260826_0007_workspace_dashboard_config.py`
- `backend/config/db_repository.py`
- `backend/config/shared_config.py`
- `backend/config/import_config.py`
- `backend/config/view_validation.py`
- `backend/services/workspace_dashboard_config.py`
- `backend/routes/settings_routes.py`
- `backend/routes/epm_routes.py`
- `backend/security/policy.py` only if route classification changes during implementation
- `jira_server.py`
- `scripts/promote_legacy_shared_admin_config.py`
- `frontend/src/api/configApi.js`
- `frontend/src/api/epmApi.js`
- `frontend/src/settings/useJiraFieldPickers.js`
- `frontend/src/settings/workspaceConfigConflict.js`
- `frontend/src/dashboard.jsx`
- focused Python, Node, and Playwright tests for the files above
- generated `frontend/dist/` output
- `docs/README_ANALYTICS.md`
- current-accuracy notes in `DONE-03-db-user-configuration.md` and `DONE-04-db-user-home-epm-read-token.md`
- `docs/plans/GATE-05-home-write-capability.md`
- `docs/plans/EXEC-shared-admin-configuration.md`
- `docs/plans/README.md`
- `AGENTS.md`

## Analytics Impact

No new event name is needed. Reuse the existing two-trigger contract: `event_type=userevent`, canonical `event_name=settings_action`, `feature_name=settings`, `workflow_action=save_result`, and `result=success|failure`. A revision conflict may add only the existing low-cardinality `conflict_state=remote` and bucketed `conflict_count_bucket`; never send revisions, section values, Jira/Home identifiers, field ids, workspace ids, or user ids. Update the analytics taxonomy/runbook allowlist to document the conflict trigger.

## Outcome

Implemented as planned. Workspace-owned administrator configuration now has a revisioned, request-scoped persistence boundary; private views retain personal state; the normal-user team catalog uses separate workspace storage; and migration performs no private-content backfill. The implementation and tests are now the source of truth.

The final full-suite verification exposed three stale compatibility assertions and one audit-construction path. The corrections preserved the planned boundary: DB-only revision metadata is compared separately from legacy JSON values, private rollback exports no longer expect shared `projects`, audit events pass through the redacting factory, and the migration source is valid on Python 3.9. Final review also added a real overlapping-transaction CAS regression and raw-route rejection tests so conflicts return the committed server snapshot and malformed or identity-bearing values cannot be coerced or silently dropped before validation. Legacy entrypoint budgets were ratcheted only for the measured shared-config wiring.

## Verification Evidence

- Schema and recovery: 9 migration/recovery tests passed. The migration creates empty workspace tables without selecting or copying private rows. Recovery remains dry-run by default, requires an exact immutable version and fingerprint for apply, and refuses ownership, marker, malformed payload, fingerprint, or existing-row mismatches.
- Focused backend contract suite: 138 tests passed; startup preflight passed with Python 3.14 and OpenSSL 3.6.3 and emitted no dependency/runtime warning.
- Full Python suite: 1255 tests passed with 1 skipped.
- Frontend unit suite: 917 tests passed.
- Focused Settings Playwright suite: 18 tests passed, including sequential revisions, stale-save conflict recovery, atomic latest-value reload, and safe expired-session recovery. Visual evidence was inspected at `test-results/settings-unified-save-qa/workspace-config-conflict-banner.png` and is not committed.
- Frontend build completed and `git diff --exit-code -- frontend/dist` confirmed generated output matches source.
- Source guards confirmed remaining route-level `save_dashboard_config()` calls are reviewed JSON/basic compatibility branches, legacy `compatibility save` appears only in explicit recovery, and private-view EPM cannot replace shared EPM.
- Complete Playwright suite: 424 tests passed and 2 skipped. The first two full-suite attempts exposed a pre-existing Board-help resize synchronization race; before repair, a 20-run stress check reproduced 11 failures and 9 passes. With user approval, the test now waits for both viewport gutters after the component's double-animation-frame position update. The repaired case passed 20 repeated runs before the green full-suite run.

## Current Accuracy

Accurate as executed on 2026-08-27. The ownership, exact-site fallback, section compare-and-swap, conflict recovery, and team-catalog separation described here match the implementation. The plan remains `EXEC-*` until user acceptance or merge.
