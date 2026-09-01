# Planning Team Capacity Editing Design

> **Status:** Interaction design and the runnable UI reference were approved by the requester on 2026-09-01; technical ownership, security, concurrency, and responsive amendments were applied after independent plan review. This is the design source for `EXEC-planning-capacity-editing.md`, not an executable plan by itself.

## Goal

Let a signed-in Atlassian OAuth user edit a team’s planned-capacity value from that team’s **Selected SP by Team** card in ENG Planning, persist the value to the configured numeric Capacity field on the matching Jira issue in the configured Capacity Project, and open that same Jira issue from a compact hover action.

## Product Decisions

- Only signed-in Atlassian OAuth users can edit capacity. App tool-admin status is irrelevant to this Jira issue write.
- Jira remains the source of truth. The app does not store a separate capacity override.
- Jira’s Browse Projects, issue security, Edit Issues, field configuration, and workflow permissions remain authoritative.
- The Capacity Project and exact Capacity field id come from one workspace-shared, site-bound Admin configuration. DB/OAuth mode must not resolve them from a user's private `ViewConfig`; JSON/basic mode keeps the existing shared-file compatibility source. The client never selects or submits a Jira field id or project key for the write.
- Capacity accepts finite non-negative decimals, including `0`.
- An empty input is invalid and cannot clear the Jira field.
- Enter or the compact checkmark saves. Escape, the compact cancel control, or clicking outside the card cancels without writing.
- The Jira and pencil controls sit together in the card’s top-right corner. They are hidden until mouse hover or keyboard focus; touch layouts expose them because hover is unavailable.
- The action rail and microbar have a visible vertical gap; neither control may overlap or visually touch the bar.
- The Jira control opens the exact matching Capacity Project issue in a new tab. The entire card is not a link.
- Only one team may be edited at a time. While an editor is open, every Jira/pencil action rail is absent across the card grid, so a second editor cannot be opened.
- Edit mode replaces only the microbar with a focused compact numeric editor. The input, checkmark, and cancel controls share one row and the same height; the Jira control is not shown in that row. Team name, card dimensions, and capacity context remain visible.

## Approved UI Reference

`frontend/src/eng/planning-capacity-editing-prototype.html` is the approved, synthetic, non-production visual reference. Its four states are available with `?state=idle|hover|edit|conflict`; `&team=<synthetic-team-id>` selects the demonstrated team. Serve the repository root locally with `python3 -m http.server 4173`, then open:

```text
http://127.0.0.1:4173/frontend/src/eng/planning-capacity-editing-prototype.html?state=hover&team=alpha
http://127.0.0.1:4173/frontend/src/eng/planning-capacity-editing-prototype.html?state=edit&team=alpha
```

The implementation must reuse production components and tokens rather than copy prototype-only CSS, but its visible idle, revealed, editing, conflict, desktop, and 375px behavior must match this reference. The companion `assets/planning-capacity-prototype-*.svg` files belong only to the reference; production reuses `IconButton` and the shared Jira mark.

## Non-Goals

- Creating missing Capacity Project issues.
- Deleting or clearing a Capacity field value.
- Editing Capacity Project or field configuration from Planning.
- Bulk capacity editing.
- Home/Townsquare, EPM, APM, Scenario Planner, Statistics, or service-account writes.
- Supporting Basic-auth capacity mutation.
- Adding an app-owned capacity-value database, history table, realtime collaboration channel, or background Jira sync. The workspace Admin configuration row stores only project/field metadata.
- Refactoring unrelated Planning cards, capacity formulas, or Jira issue-edit features.

## Current Implementation

`backend/services/capacity.py::fetch_capacity_for_sprint` already searches the configured Capacity Project for summaries matching `Team info <sprint> - <team>`. Jira returns each issue key, summary, and configured capacity field, but the service currently discards the issue key and returns only a `capacities` name-to-number map.

The existing `/api/capacity/config` Admin surface is shared only in JSON mode. In DB mode it currently reads and writes `capacity` inside the signed-in user's private default `ViewConfig`, so two users in one workspace can resolve different projects or fields. That contradicts the Admin ownership required by this feature and must be corrected before enabling the mutation.

`backend/routes/capacity_routes.py` exposes authenticated reads through `GET /api/capacity` and its legacy alias `GET /api/planned-capacity`. `frontend/src/api/engApi.js::fetchCapacity` performs the read. `frontend/src/dashboard.jsx` normalizes the numeric map into `capacityByTeam`, computes aggregate and per-team capacity values, and renders every Selected SP by Team card inline.

The repository already has the required safe Jira-write primitives: an OAuth-bound `current_jira_request`, `user_write` endpoint policy, `X-Requested-With` enforcement, token-bound CSRF, structured auth recovery, sanitized Jira errors, and tracked API calls. Status, priority, and Project Track writes establish the pattern; capacity editing must use the same signed-in-user path without importing those issue-field modules.

## Architecture

The feature has four focused modules separated by narrow interfaces:

1. **Workspace Capacity configuration module** — a new DB model/service owns one revisioned, site-bound Capacity Project plus exact numeric-attested field id per `workspace_id`. An idempotent online reconciliation runs before capacity or saved-view access, materializes either an active row or a durable unresolved marker before stripping private remnants, site-qualifies global legacy seed data, and keeps JSON/basic compatibility. All capacity reads, writes, direct saved-view routes, import/export, and the existing Admin Capacity settings endpoint use this module.
2. **Capacity domain module** — `backend/services/capacity.py` owns target validation, decimal normalization, best-effort stale-baseline comparison, Jira payload shaping, and sanitized result/error codes. It accepts injected Jira request functions and configured project/field values; it does not import Flask or resolve credentials.
3. **Capacity route adapter** — `backend/routes/capacity_routes.py` checks OAuth mode before parsing, obtains the current request auth context, requires a provider-reported and provenance-verified `write:jira-work` grant, loads the current-site workspace Capacity Project and stored numeric-attested field id, injects `current_jira_request`, and maps domain errors to the endpoint contract. Requested scopes are never fabricated into granted scopes; global guards and auth status also fail closed for unknown DB/local provenance while keeping the missing-scope login recovery usable.
4. **Planning team-card module** — a new `frontend/src/eng/PlanningTeamCapacityCards.jsx` owns card sorting/rendering, hover actions, the single active editor, input validation, save/cancel behavior, conflict display, and successful local reconciliation. `dashboard.jsx` supplies prepared entries and accepts the saved record; it does not own per-card editor state.

The existing capacity fetch remains one scoped Jira search for the screen. A legacy read-only config that has only a field name may retain today's one-time field-catalog discovery fallback, but properly configured shared rows use the stored id and there is never per-card fan-out. There is no request on hover, focus, Jira-link click, or editor open. A save performs one scoped Jira issue read for validation/current-value comparison and at most one Jira issue update. Only when Jira returns an upstream `409` does the service perform one additional scoped issue read to classify the outcome. Jira Cloud does not expose a verified atomic compare-and-set primitive for this field update, so the design detects a stale baseline before PUT but acknowledges the narrow lost-update window between validation GET and unconditional PUT.

## Workspace Capacity Configuration

- DB/OAuth mode stores one `WorkspaceCapacityConfig` row per `workspace_id`, with Jira site/cloud identity, `active|requires_resolution` status, project key, exact field id/name, numeric schema attestation/timestamp, positive `config_revision`, and created/updated actor metadata. The workspace/site derives only from `RequestAuthContext`; request payloads never choose identity or attestation fields.
- The existing authenticated `GET /api/capacity/config` always returns HTTP 200 with the shared value plus `configRevision`, `source`, `requiresResolution`, and `mutationEnabled`; a durable unresolved row is data the Admin UI can resolve, not a read exception. The Admin-only `POST /api/capacity/config` includes `baseRevision` in DB mode, validates the selected exact `customfield_*` as `schema.type == "number"` through the current user's same-site Jira field catalog, stores the catalog's canonical field name, and conditionally updates `workspace_id + config_revision`. Missing/non-numeric ids return fixed `400 capacity_field_not_numeric`, catalog failure returns fixed `502 jira_field_catalog_failed`, and stale saves return sanitized `409 capacity_config_conflict` without overwriting.
- Alembic creates only offline-renderable schema. Before the first capacity/config/import/export or `/api/me/views` operation, an idempotent transaction materializes the workspace row and then strips `capacity` from all current/version private payloads. One distinct private remnant may seed an active revision-1 row; multiple distinct values create a blank revision-1 `requires_resolution` marker. That marker remains durable regardless of later private-view saves. An Admin resolves it by matching-revision CAS; concurrent resolution has one winner.
- Process-global JSON/environment defaults may seed only when normalized configured `JIRA_URL` matches the request context's site (or an explicit single-workspace import names the exact workspace). A second site never inherits the same project/field strings. Migrated values without same-site numeric attestation remain readable but return `mutationEnabled:false` until an Admin verifies and saves them.
- Local OAuth keeps shared JSON storage: its Admin save performs the same current-user Jira numeric verification and writes server-owned site/cloud/schema/timestamp attestation beside the public Capacity fields. Basic saves never create attestation and remain read-only. The request adapter dispatches DB OAuth to the shared table, local OAuth/Basic to shared JSON, and permits no-context startup reads only with explicit JSON source.
- Direct `/api/me/views` responses and create/patch/version writes, DB repository paths, and import/export all reconcile first and strip/reject the normalized root `capacity` section as a shared field. Legitimate nested domain values such as Scenario `config.capacity` remain valid. Non-Admin imports ignore the shared section; an Admin import may seed it only on first reconciliation and never overwrite/resolve an existing row. Later edits use the revisioned Settings endpoint. Compatibility export emits only `{project,fieldId,fieldName}` from the current workspace's active non-empty row.
- Capacity issue reads and writes consume one named request-aware shared adapter. The mutation requires an active, same-site, numeric-attested exact `fieldId`; it never falls back to a field-name lookup or calls Jira's field catalog. The read-only legacy name fallback remains isolated to GET compatibility.

## Read Contract

### `GET /api/capacity`

The existing query remains unchanged:

```text
GET /api/capacity?sprint=2026Q2&teams=Alpha,Beta
```

The response retains `capacities` for backward compatibility and adds `entries`:

```json
{
  "enabled": true,
  "mutationEnabled": true,
  "sprint": "2026Q2",
  "capacities": {
    "Alpha": 5.5,
    "Beta": 0
  },
  "entries": [
    {
      "teamName": "Alpha",
      "issueKey": "CAP-101",
      "capacity": 5.5
    },
    {
      "teamName": "Beta",
      "issueKey": "CAP-102",
      "capacity": 0
    },
    {
      "teamName": "Gamma",
      "issueKey": "CAP-103",
      "capacity": null
    }
  ]
}
```

Rules:

- Disabled or incompletely configured responses include `entries: []` alongside the existing empty `capacities` map and `mutationEnabled:false`.
- `mutationEnabled` is true only for an active current-site numeric-attested config in OAuth mode. Legacy/unverified rows remain readable with false; the dashboard stores the flag in scope-tagged capacity state and never derives it from Admin permission.
- `entries` contains one record per distinct Jira issue returned by the existing scoped search.
- An issue with a blank, non-numeric, non-finite, or negative Capacity field remains in `entries` with `capacity: null`, allowing the user to repair it with a valid value.
- An explicit Jira value of zero remains `0`; it is never collapsed to missing.
- Repeated copies of the same Jira issue from chunked searches are deduplicated by issue key.
- If multiple distinct issues resolve to the same normalized team/sprint, the frontend treats that team as ambiguous: it keeps the existing readable card and numeric behavior but suppresses both Jira and pencil actions because there is no safe single target.
- `GET /api/planned-capacity` delegates to the same implementation and receives the same additive response shape.
- Existing callers that read only `capacities` continue to work.
- The browser owns a capacity-read generation keyed by sprint plus the normalized team set, tags installed state with that signature, and renders no prior-scope maps while signatures differ. A scope change aborts the superseded request, and only the current generation may install or clear capacity state/loading. A successful GET advances a dedicated read revision used to clear invalid-target suppression; unrelated Planning recomputation does not.
- Manual Planning refresh and the explicit capacity retry path start a new capacity GET even when the sprint/team signature is unchanged.
- A current-scope GET failure retains prior numeric values only as visibly stale, clears actionable Jira targets, and shows a fixed retry state. A new-scope failure shows Capacity unavailable rather than converting unknown values to zero. Deliberate aborts do not emit false API-failure analytics.

## Write Contract

### `PATCH /api/capacity/<issueKey>`

| Item | Contract |
| --- | --- |
| Purpose | Set the configured Capacity field on one already-resolved Capacity Project issue. |
| Endpoint policy | `user_write`, dynamic path. |
| Auth mode | Atlassian OAuth only. Local/dev loopback Basic reaches the route and returns `403 jira_oauth_required`; non-loopback Basic is hidden by the global guard with `404 not_found`. The mode check happens before JSON parsing. |
| Browser security | Requires `X-Requested-With: jira-execution-planner` and a valid one-time `X-CSRF-Token`. |
| Jira identity | `current_request_auth_context()` plus `current_jira_request`; only the signed-in user’s Jira OAuth token. |
| OAuth scope | `write:jira-work`; a central auth-layer helper accepts only provider-reported, provenance-verified grants in `RequestAuthContext`, independent of requested `ATLASSIAN_SCOPES`. Omitted/legacy-unknown scope provenance fails closed and requires reauthentication. |
| Request body | `{"sprintName":"2026Q2","teamName":"Alpha","expectedCapacity":5.5,"capacity":6}`. `expectedCapacity` may be `null` when Jira had no numeric value. |
| Validation read | `GET /rest/api/3/issue/<issueKey>?fields=project,summary,<configured-field-id>` using the request auth context. |
| Jira write | `PUT /rest/api/3/issue/<issueKey>` with exactly `{"fields":{"<configured-field-id>":6}}`. |
| Success | HTTP `200`, `{"issueKey":"CAP-101","teamName":"Alpha","previousCapacity":5.5,"capacity":6,"result":"success"}`. |
| No-op | HTTP `200` with `result: "already_current"`; no Jira `PUT`. |

The backend performs these checks before any Jira write:

1. The path value is a valid Jira issue key.
2. The body is JSON with non-empty `sprintName` and `teamName` strings.
3. `capacity` is a finite number greater than or equal to zero. Booleans, numeric strings, `NaN`, infinities, negatives, blanks, and `null` are rejected.
4. `expectedCapacity` is either `null` or a finite non-negative number.
5. Capacity configuration is active, belongs to the request context's Jira site/cloud, has an exact project/field id, and carries a stored numeric-field attestation from that site.
6. The request context contains a provider-verified `write:jira-work` grant.
7. The Jira issue exists for the signed-in user.
8. The issue’s project key exactly equals the configured Capacity Project.
9. Its summary follows `Team info <sprint> - <team>` and matches the submitted sprint plus normalized team name.
10. If the configured Jira field's current normalized decimal already equals the requested `capacity`, return `already_current` before stale-baseline comparison.
11. Otherwise, the current normalized decimal must equal `expectedCapacity` before PUT.

The request never accepts a project key or field id. A forged issue key cannot turn the route into a general Jira field editor because the server validates both the configured project and the capacity-summary identity before writing.

### Error Responses

| Status | Error | Meaning and UI behavior |
| --- | --- | --- |
| `400` | `invalid_json` | Body is not an object; keep editor open with a generic validation message. |
| `400` | `invalid_issue_key` | Malformed path target; keep card readable and suppress retry until data reload. |
| `400` | `invalid_capacity` | New or expected capacity is not in the allowed numeric domain; keep editor open. |
| `400` | `capacity_identity_required` | Sprint/team identity is missing; keep editor open. |
| `401` | existing auth recovery payload | Redirect through the existing visible OAuth recovery path. |
| `403` | `jira_oauth_required` | Mutation is unavailable outside OAuth mode. |
| `403` | `capacity_forbidden` | Jira rejected the signed-in user’s edit permission; keep editor open with a permission message. |
| `404` | `capacity_issue_not_found` | Jira cannot resolve or reveal the issue; keep card readable and suppress unsafe actions after reconciliation. |
| `409` | `capacity_config_missing` | Capacity Project or field id is no longer configured. |
| `409` | `capacity_config_unverified` | The shared field lacks current-site numeric attestation; preserve the draft and require Admin verification/reload. |
| `409` | `capacity_config_conflict` | The workspace configuration requires Admin resolution; preserve the draft and disable editing until reload after resolution. |
| `409` | `capacity_issue_mismatch` | Issue project or summary no longer matches the card’s configured capacity identity. |
| `409` | `capacity_conflict` | Jira’s current value differs from `expectedCapacity`; body includes only `currentCapacity` and the stable result code. |
| `409` | `capacity_field_not_editable` | Jira rejects the configured field for this issue/project/type. |
| `503` | `config_storage_unavailable` | Shared Capacity configuration cannot be loaded; keep the draft and offer retry after storage recovers. |
| `502` | `jira_capacity_update_conflict` | Jira returned an update conflict but reconciliation still equals the acknowledged baseline; keep the draft and offer retry without claiming the value changed. |
| `502` | `jira_capacity_update_failed` | Sanitized upstream failure; no Jira response body or text reaches the browser. |

On `capacity_conflict`, the UI preserves the typed draft, replaces its baseline with `currentCapacity`, and displays `Capacity changed in Jira to <value>. Review and save again, or cancel.` When `currentCapacity` is `null`, the copy is `Capacity is now blank in Jira. Review and save again, or cancel.` A second explicit save may overwrite that newly acknowledged baseline. If the current value already equals the requested target, both the validation-GET path and the PUT-409 reconciliation path return `already_current` and reconcile the UI as achieved. If a PUT returns `409`, the single reconciliation GET classifies exactly three cases: latest equals target → `already_current`; latest differs from expected → `capacity_conflict`; latest still equals expected → `jira_capacity_update_conflict`. No stronger atomic compare-and-set contract is claimed, and an edit landing between validation GET and PUT can still be overwritten by Jira's unconditional field update.

## Frontend Data Model

The capacity fetch maintains two related structures:

- The existing normalized `capacityByTeam` numeric map continues to drive aggregate and project/team capacity math.
- A new normalized target map groups `entries` by team and retains `issueKey`, `capacity`, and ambiguity state for UI actions.
- A scope-tagged `mutationEnabled` boolean is true only when the server confirms the shared config is active, current-site, and numeric-attested. OAuth mode plus this flag gates pencils; Admin/settings permission does not.

Numeric capacity presence and issue actionability are independent. An ambiguous issue target suppresses Jira/pencil controls but must not erase a numeric value already resolved in `capacityByTeam`. Numeric and target matching use one shared unique normalized-team resolver so aliases such as `Alpha` and `Alpha Core` cannot resolve differently across the two maps.

`buildSelectedTeamEntries` adds explicit fields instead of relying on truthiness:

```js
{
    id,
    name,
    storyPoints,
    teamCapacity,
    planningCapacity,
    rawCapacity,
    hasCapacityValue,
    capacityIssueKey,
    capacityTargetTeamName,
    capacityTargetCapacity,
    capacityTargetState // "matched", "missing", or "ambiguous"
}
```

`rawCapacity` and `hasCapacityValue` come from the numeric map, not target state; `0` sets `hasCapacityValue: true`. The editor baseline comes from `capacityTargetCapacity`, and PATCH submits canonical `capacityTargetTeamName`, so a displayed alias never changes which summary identity the backend validates. Utilities that currently use `if (!capacity)` or `capacity > 0` must distinguish missing from zero. A zero-capacity card displays `Cap 0.0` and the selected-SP delta without dividing by zero; percentage text is omitted when the denominator is zero.

After a successful save, one dashboard callback immutably updates both capacity structures. Existing memoized totals, markers, team deltas, and card sorting then recompute from the saved Jira value without refetching tasks or capacity.

The editor captures the sprint plus normalized-team scope used to open it. A scope change detaches the editor and aborts its browser request when possible, without claiming that a submitted server-side write was canceled. If Jira completed before abort won the race, the dashboard ignores a success whose scope signature no longer equals the active signature; returning to that scope triggers the scoped capacity read from Jira.

## Team Card Interaction

### Default State

- Preserve the existing card background, border, radius, shadow, grid behavior, team label, microbar, color resolver, selected-SP label, and delta text.
- Reserve only the top-right icon footprint needed to prevent a long team label from rendering beneath the action rail; do not change card width with a magic-number minimum.
- Render a Jira icon link and pencil `IconButton` together only for a signed-in OAuth user and a single matched issue. Normalize the Jira base as an absolute HTTP(S) URL, remove trailing slashes, and suppress the link when the URL is empty/invalid or auth mode is not OAuth. The pencil is additionally gated by `mutationEnabled:true`, so an unverified-but-readable OAuth row retains its value/link but cannot open an editor; Basic and unresolved auth render neither control.
- Reuse `TrackedExternalLink` with `buildJiraBrowseLinkAnalytics({ issueKind: "unknown", sourceSurface: "planning" })`.
- Extract the Jira mark already used by `JiraExportButton` into a shared icon module and reuse it; do not duplicate the logo paths or invent a separate Jira glyph.
- Mouse actions reveal on `.team-stat-card:hover`. Keyboard actions reveal on `:focus-within`. For `@media (hover: none)`, the action rail remains visible.
- Move the calculated desktop card count from an overriding inline `gridTemplateColumns` declaration to a CSS custom property. The existing mobile media rule overrides that property with `auto-fit, minmax(120px, 1fr)` so seven teams do not become four cramped columns at 375px.

### Edit State

- Only one team card editor may be active at a time. While one editor is open, do not render any Jira or pencil action rail on any team card; a defensive state transition may replace the active editor, but the UI exposes no second edit action.
- Replace `.microbar` with a `<form>` containing `input[type="number"]`, `min="0"`, and `step="any"`, followed by compact checkmark and cancel controls. Label the field as Jira total planned capacity and show compact context when Planning displays a Product-only or Tech-only share, so a card showing an adjusted `Cap 7.0` cannot silently open an unexplained raw Jira value of `10`.
- Keep the input, checkmark, and cancel controls on one line with identical 28px heights. Cap the desktop input width at 84px and allow it to shrink at 375px so the three controls remain inside the existing card.
- Seed the input with the exact current numeric capacity, including `0`; seed it blank for `null`.
- Focus and select the input on open.
- Disable save when the draft is blank, invalid, negative, unchanged, or submitting.
- Enter submits the form. Escape cancels. The cancel control cancels. A document-level pointer-down outside the card cancels. Blur alone never saves. These cancel paths apply before submission; while a Jira write is submitting, input/save/cancel are disabled and outside/Escape are ignored because the server-side write may already have won the abort race.
- Hide the Jira link and pencil across the grid while editing. Save/cancel live beside the input; do not move Jira into the editor row.
- While submitting, keep card geometry stable, set `aria-busy` on the form, disable input/actions, use `type="submit"` for Save and `type="button"` for Cancel, and give the save control an accessible loading state.
- On ordinary failure, retain the input and typed value and show a compact sanitized error below the editor. Errors use a stable `aria-describedby` target, remain fully readable without clipping, and may cause bounded card-row expansion while sibling cards align to the row. On conflict, retain the draft and show the current Jira value as described above.
- On success, exit edit mode, update local capacity state, and return focus to the pencil control if it still exists after card reordering.
- `capacity_config_missing`, `capacity_config_unverified`, and `capacity_config_conflict` disable every pencil until a successful shared-config/capacity reload; issue-not-found, mismatch, and field-not-editable suppress only the affected target. Suppression resets only when a successful capacity GET advances the dedicated read revision.
- On a successful same-scope reread, an open editor remains writable only when its captured issue key is still the single matched target. If the target becomes missing, ambiguous, or changes issue key, retain the draft in a disabled mapping-changed state and re-check before PATCH so no stale target is mutated.
- The same fail-closed pre-submit gate blocks an open editor when `mutationEnabled` becomes false, config-wide suppression is active, or the read is stale/failed. Save is disabled and the handler rechecks before CSRF/PATCH; the draft remains visible with fixed status copy.
- Capacity Retry is disabled and exposes an accessible busy label while a reread is pending, preventing repeated clicks from abort/restart loops.

## Accessibility

- Jira link label: `Open <team> capacity ticket in Jira`.
- Pencil label: `Edit <team> capacity`.
- Numeric input label: `<team> Jira total planned capacity`.
- Save label: `Save <team> capacity`; cancel label: `Cancel <team> capacity edit`.
- Use native anchor, button, form, and number-input semantics. Do not nest an anchor inside a button or make the card a `role="button"` container.
- Hidden hover actions remain keyboard reachable; focus reveals them before activation.
- Inline errors use a stable `role="status"` or `aria-live="polite"` association without moving focus away from the draft. Auth recovery is a visible, safe same-origin `/login` or `/auth/` action; mutation failures never auto-navigate away from the draft.
- Focus outlines remain visible in normal and sticky Planning states.

## Analytics Impact

Reuse the existing low-cardinality Planning event and add one API reliability surface:

- `planning_action`
  - `feature_name: planning_capacity_edit`
  - `source_surface: planning`
  - `workflow_action`: `capacity_edit_open`, `capacity_change_submit`, or `capacity_change_result`
  - `result`: `success`, `failure`, or `conflict` on result events only
- `api_result`
  - `api_surface: jira_team_capacity`
  - `feature_name: planning_capacity_edit`
  - existing method/status/result/duration/cache fields only

The existing `external_link_opened` event covers the Jira icon through `jira_issue_browse`. No analytics payload may contain issue keys, team names, sprint names, Jira URLs, Jira field ids, capacity values, raw Jira errors, or JQL.

Update `frontend/src/analytics/analytics.js`, `frontend/src/analytics/dashboardAnalytics.js`, tests, and `docs/README_ANALYTICS.md`. The app-owned GTM contract remains the existing `userevent` trigger; there is no custom-dimension registration work.

## File Map

### Create

- `backend/db/migrations/versions/20260901_0007_workspace_capacity_config.py` — offline-renderable workspace Capacity schema plus auth scope-provenance column.
- `backend/services/shared_capacity_config.py` — idempotent online reconciliation, DB/JSON compatibility, site/workspace ownership, numeric attestation, and atomic revision saves.
- `backend/auth/scope_policy.py` — context-only required-scope check used by the capacity mutation without exposing token stores to the route.
- `frontend/src/api/capacityApi.js` — tracked capacity read and CSRF-protected write requests; replaces the capacity read export currently in `engApi.js`.
- `frontend/src/eng/PlanningTeamCapacityCards.jsx` — complete team-card rendering and editor interaction module.
- `frontend/src/ui/JiraMarkIcon.jsx` — shared Jira mark used by the existing export trigger and new card link.
- `tests/test_shared_capacity_config.py` — shared ownership, site isolation, conflict marker, numeric attestation, and CAS coverage.
- `tests/test_shared_capacity_config_db.py` — schema/offline migration and online reconciliation coverage.
- `tests/test_shared_capacity_config_routes.py` — Admin config route, CSRF, field verification, and sanitized conflict coverage.
- `tests/test_oauth_capacity_routes.py` — focused OAuth, CSRF, authorization, request-contract, and error-mapping coverage for the capacity routes.
- `tests/test_shared_capacity_config_import.py` — first-seed/idempotence import, compatibility export, stripping, authorization, and workspace-isolation coverage.
- `tests/ui/planning_capacity_editing.spec.js` — rendered interaction, geometry, accessibility, mutation, and screenshot proof.

### Modify

- `backend/db/models.py` — `WorkspaceCapacityConfig` model and `AuthConnection.scope_provenance`.
- `backend/auth/context.py`, `backend/auth/db_context.py`, `backend/auth/db_tokens.py`, `backend/auth/jira_auth.py`, `backend/routes/auth_routes.py`, and `jira_server.py` — preserve provider scope provenance and expose only verified grants in `RequestAuthContext` for DB and local OAuth sessions.
- `backend/config/db_repository.py`, `backend/config/import_config.py`, `backend/config/view_validation.py`, and `backend/routes/views_routes.py` — reconcile-before-strip, forbid direct saved-view Capacity ingress, and split/merge the shared value for authorized compatibility imports/exports.
- `backend/routes/settings_routes.py` — migrate `/api/capacity/config` GET/POST and `/api/config` bootstrap to the shared resolver, numeric Jira field validation, safe unresolved flag, and revision-conflict contract.
- `backend/services/capacity.py` — additive read entries plus pure validated update implementation and error types.
- `backend/routes/capacity_routes.py` — OAuth-only PATCH route and HTTP error mapping.
- `backend/security/guards.py` — fixed sanitized DB-storage failures for authenticated-read, CSRF, and Admin guard paths.
- `backend/security/policy.py` — dynamic `user_write` capacity endpoint policy.
- `docs/security/endpoints.md` — register the dynamic Jira team-capacity write route and policy.
- `frontend/src/api/configApi.js` and `frontend/src/dashboard.jsx` Admin settings state — carry `configRevision`, submit `baseRevision`, and preserve dirty Capacity config on conflict.
- `frontend/src/api/http.js` — opt-in suppression of false status-0 analytics for deliberate capacity request aborts; genuine network failures keep existing tracking.
- `frontend/src/api/engApi.js` — remove the moved capacity read export only.
- `frontend/src/dashboard.jsx` — keep capacity target state, reconcile successful writes, and replace inline card JSX with the new module.
- `frontend/src/eng/planningCapacityUtils.js` — target grouping/entry shaping and explicit zero-capacity behavior.
- `frontend/src/components/JiraExportButton.jsx` — reuse `JiraMarkIcon` without changing export behavior.
- `frontend/src/styles/planning/stat-cards.css` — action rail, editor, error, focus, touch, and stable-card styles scoped to Planning team cards.
- `frontend/src/analytics/analytics.js`
- `frontend/src/analytics/dashboardAnalytics.js`
- `docs/README_ANALYTICS.md`
- `docs/plans/README.md`
- `tests/test_capacity_service.py`
- `tests/test_config_jsonfile_fallback.py`
- `tests/test_db_migrations.py`
- `tests/test_user_view_config_routes.py`
- `tests/test_view_config_validator.py`
- `tests/oauth_test_helpers.py`
- `tests/test_analytics_routes.py`
- `tests/test_auth_context.py`
- `tests/test_auth_context_db.py`
- `tests/test_csrf_token_bound.py`
- `tests/test_db_admin_bootstrap.py`
- `tests/test_db_admin_routes.py`
- `tests/test_db_auth_recovery_pages.py`
- `tests/test_db_oauth_cutover.py`
- `tests/test_home_credential_resolver.py`
- `tests/test_oauth_eng_routes.py`
- `tests/test_oauth_route_guards.py`
- `tests/test_oauth_settings_routes.py`
- `tests/test_oauth_stats_routes.py`
- `tests/test_dashboard_bootstrap_config_source.py`
- `tests/test_scenario_draft_routes.py`
- `tests/test_shared_group_config_routes.py`
- `tests/test_team_catalog_api.py`
- `tests/test_user_api_token_connections.py`
- `tests/test_endpoint_security_matrix.py`
- `tests/endpoint_security_samples.py`
- `tests/test_endpoint_policy_inventory.py`
- `tests/test_backend_route_source_guards.py`
- `tests/test_route_move_preservation.py`
- `tests/test_frontend_api_source_guards.js`
- `tests/test_planning_action_source_guards.js`
- `tests/test_planning_capacity_utils.js`
- `tests/test_analytics_events.js`
- `tests/test_analytics_source_guards.js`
- `tests/ui/codebase_structure_smoke.spec.js`
- `tests/ui/settings_unified_save.spec.js`
- `tests/test_codebase_structure_budgets.py` only if a touched-file ratchet is required by measured file growth.
- Generated by `npm run build`: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`.

The executable plan must verify every `Modify` path before implementation. The new route-test module and other `Create` paths are explicit exceptions because they do not exist yet.

## Verification Design

### Backend Unit and Route Coverage

- Workspace Capacity configuration is identical for two users in one workspace, isolated across two workspaces/sites, revision-conflict protected, seeded only for the site matching the configured legacy Jira identity, and blocked by a durable unresolved row until an Admin resolves it.
- Offline migration SQL reaches `0007`; first capacity access or unrelated saved-view save performs reconcile-before-strip atomically; direct saved-view and import paths cannot reintroduce private Capacity ownership; export merges only the current workspace's active config.
- Admin save accepts only an exact same-site numeric Jira custom field and persists attestation. Built-in/non-numeric/foreign-site/unverified configs make zero Jira PUTs; unverified values remain read-only.
- Additive read response includes issue keys, numeric values, `0`, `null`, and a fail-closed `mutationEnabled` while preserving `capacities`.
- Chunked search duplicates are deduplicated by issue key.
- Distinct duplicate targets for one normalized team are detectable by the frontend target builder.
- Capacity parser accepts non-negative ints/floats and rejects strings, booleans, blanks, negative values, non-finite values, and huge integers that overflow float conversion; invalid existing Jira negatives/non-finite values normalize to `null` and remain repairable.
- Update validation rejects a mismatched project, sprint, team, summary format, missing configuration, and stale expected value before `PUT`.
- Target equality is checked before stale-baseline equality and skips `PUT`; PUT-409 reconciliation distinguishes achieved target, changed baseline, and unchanged-baseline update conflict.
- Successful update sends only the configured field and numeric value through the injected OAuth Jira request function.
- Jira `404`, permission/configuration failures, upstream `409`, configuration-storage failure, auth expiry, and generic upstream failures map to documented sanitized errors; neither capacity GET alias nor PATCH returns synthetic sensitive Jira/exception text.
- The mutation uses the stored exact field id and makes zero field-catalog/Jira calls when it is absent, including when a duplicate-named Jira field exists.
- Local/dev loopback Basic returns `403 jira_oauth_required` before JSON parsing; non-loopback Basic returns guarded `404 not_found`. Anonymous OAuth, missing `X-Requested-With`, and missing/invalid/consumed CSRF are rejected before route code.
- Local and DB OAuth contexts missing a provider-verified `write:jira-work` grant return missing-scope recovery before configuration or Jira calls, including provider-omitted callbacks and migrated unknown-provenance rows even when operator `ATLASSIAN_SCOPES` requests write.
- Global authenticated-read, CSRF, Admin, and route storage failures return fixed sanitized `config_storage_unavailable` bodies without exception text.
- The endpoint policy inventory classifies the dynamic PATCH route exactly once as `user_write`.
- AST/source plus behavioral guards cover both route and service and prove the write path does not call `build_jira_headers`, Basic credentials, service integrations, Home/Townsquare helpers, user API-token connections, field-name discovery, or local OAuth token-store helpers.

### Frontend Unit and Source Coverage

- Target grouping differentiates matched, missing, and ambiguous Jira issues.
- Zero remains present and avoids divide-by-zero percentage output.
- A saved capacity updates aggregate/team/project computations through the existing capacity helpers; ambiguous targets retain numeric calculations while actions remain suppressed.
- The API module reconstructs the exact four-field body, discards injected extras, sends `X-Requested-With`, fetches a distinct one-time CSRF token for every intentional PATCH, and records only the allowlisted API surface.
- Analytics validation accepts the new fixed event/surface and rejects raw capacity/team/issue data.
- `dashboard.jsx` delegates team cards and contains no editor markup or document listeners.
- Scope-tagged `mutationEnabled:false` preserves readable values/Jira links but never renders a pencil or sends PATCH; the gate uses OAuth mode plus server attestation and never tool-admin settings.
- Reverse-order deferred GETs across sprint and normalized-team scopes prove only the current generation can install/clear state or loading; an unrelated Planning selection/multiplier change cannot reset invalid-target suppression or discard a draft.

### Playwright and Visual Coverage

- Default screenshot before hover preserves current cards and microbars.
- Hover reveals exactly Jira and pencil controls in the corner; moving away hides them.
- The revealed rail clears the microbar by a positive measured vertical gap.
- Tab focus reveals controls with visible focus outlines and correct accessible names.
- A touch-enabled browser context proves `(hover: none)` exposes the actions.
- Jira control has the exact `/browse/<synthetic-key>` URL, opens a new tab target, and emits safe external-link analytics.
- Pencil replaces the microbar with a prefilled input; `0` is prefilled as `0`; `null` starts blank.
- Editing renders exactly one form, renders no Jira or pencil controls anywhere in the grid, and keeps the input/checkmark/cancel in one row at equal height.
- Desktop geometry caps the input/wrapper at 84px; the 375px fixture proves it shrinks below its desktop width while all three editor controls remain aligned and contained.
- Blank, negative, unchanged, and invalid drafts cannot save.
- Enter/checkmark submits one PATCH; repeated clicks while pending do not duplicate it.
- Escape, cancel, and click-away restore the microbar without a request.
- Keyboard/button cancel restores pencil focus; success restores it after card reordering when the same target remains.
- Success updates the card, aggregate marker, capacity delta, and any resulting card order without a Planning task/capacity refetch.
- Conflict retains the typed value, shows the current Jira capacity, and permits an explicit second save using the new baseline.
- A sprint/scope change detaches the editor, aborts the browser request when possible, ignores late success from the old scope, and never tells the user that a submitted Jira write was canceled.
- Same-scope target remapping disables the open editor before PATCH, and capacity read failure preserves only visibly stale numeric values with actions removed plus retry.
- Permission, login, reconnect, disabled-account, missing-project, field-not-editable, config-wide, and generic failures show safe same-origin recovery/error state without losing the draft; malicious absolute or protocol-relative recovery values are discarded.
- Product-only and Tech-only modes label the editable value as Jira total capacity while preserving the visible adjusted Planning share.
- Card height/width, team-label bounds, icon bounds, input/control/error bounds, and grid rows remain valid with one, six, and seven teams at desktop and 375px; error text is fully visible and hoverless proof runs in a touch-enabled browser context.
- Settled screenshots cover default, hover, edit, zero-capacity, conflict, and touch states.
- Sticky verification proves `planning-panel.open` remains above `.epic-header` and the card editor/error state does not create overlap in Planning; Catch Up and Scenario retain their existing sticky behavior.

### Commands

The implementation plan must include focused red/green commands per task, then finish with:

```bash
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui/planning_capacity_editing.spec.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "ENG Catch Up, Planning, and Scenario render with scoped startup and sticky checks"
npm run build
capacity_build_snapshot=$(mktemp -d)
cp -R frontend/dist/. "$capacity_build_snapshot/"
npm run build
diff -qr "$capacity_build_snapshot" frontend/dist
git diff --check
```

`make verify-dist-clean` is reserved for after the requester explicitly authorizes a commit containing the generated `frontend/dist` files; it cannot pass while the expected generated changes are intentionally uncommitted.

## Acceptance Criteria

1. On a Planning team card with one matching capacity Jira issue, hover or keyboard focus reveals a Jira icon and pencil together in the corner; the idle card otherwise looks unchanged.
2. The Jira icon opens that exact issue in a new tab and produces only safe existing external-link analytics.
3. The pencil is usable only for signed-in OAuth users whose current workspace config has same-site numeric-field attestation; it never depends on tool-admin status.
4. Edit mode replaces the microbar with the current capacity or blank when missing; exactly one compact editor is active, no Jira/pencil rail remains visible, and its equal-height one-row controls support the approved save/cancel keyboard and pointer behavior.
5. A valid non-negative decimal, including zero, updates only the configured Jira Capacity field through the signed-in user’s OAuth context.
6. Missing, ambiguous, moved, stale, forbidden, or uneditable targets never produce a blind Jira write and have explicit recovery behavior.
7. Success updates every visible capacity calculation locally without refetching Planning tasks or adding per-card read requests.
8. DB/OAuth users in the same workspace resolve one shared Admin Capacity Project/field, different sites remain isolated from global legacy defaults, unresolved private remnants stay durably blocked, and stale Admin config saves conflict instead of overwriting.
9. Existing capacity reads, `/api/planned-capacity`, non-Planning surfaces, Basic-mode reads, sticky ordering, and generated frontend output remain compatible.
10. Backend, frontend, analytics, accessibility, geometry, screenshot, full-suite, and deterministic-build verification all pass before completion is claimed; post-commit dist-clean verification runs only after commit authorization.

## External Jira Contract Verified

Checked against Atlassian’s Jira Cloud REST v3 documentation on 2026-09-01:

- [Get issue](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get) supports selecting a field subset and uses classic OAuth scope `read:jira-work`.
- [Edit issue](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put) accepts field edits through `fields`, uses classic OAuth scope `write:jira-work`, requires Browse Projects plus Edit Issues, returns `204` by default on success, and may return `409` for a conflicting update.
