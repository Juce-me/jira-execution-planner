# Multiple Jira Group Labels Per Team — Implementation Plan

> **Status:** Implemented and locally verified on 2026-09-25; pending acceptance or merge. Executed across Tasks 1-5 from baseline `a673fcc8`, with `origin/main` (`effed8a4`, includes #202) merged in at `b028a8fd` before final verification. See `## Outcome` and `## Current Accuracy` below for what shipped versus this contract, and the ticked `## Acceptance Criteria` for verification evidence.

**Goal:** Allow each Team in a Department's `Group labels` tab (`Team labels` pane) to have one to three distinct Jira Epic-label aliases, so an old or uncertain label continues to discover and classify the same Team's Epics.

**Architecture:** Keep the workspace-shared `group.teamLabels` field and deepen its normalization seam: canonical values become ordered arrays of one to three labels, while legacy scalar values remain accepted and normalize to one-item arrays. All consumers use shared “labels for Team / flattened labels for scope / Epic matches any Team alias” helpers instead of knowing the legacy-versus-canonical shape. Jira discovery uses the existing `labels in (...)` alternative across the flattened aliases; Team attribution remains one logical Team even when more than one of its aliases is present on an Epic.

**Tech stack:** Python 3.10+ Flask services, JSON/JSONB shared configuration, React 19, Jira JQL, `unittest`, Node tests, and Playwright on the pinned Node 20 toolchain.

## Intended Outcome And Acceptance Signal

Given a Department containing Team `team-a` with:

```json
{
  "teamLabels": {
    "team-a": ["label_team_a", "label_team_a_old"]
  }
}
```

an Epic carrying either label is in scope for the Team in alert Epic discovery, future-planning alerts (including the dashboard's Missing Labels predicate), and Story readiness. If it carries both labels, it still contributes only one expected Team and one Story requirement. Settings lets a user add and remove aliases up to a maximum of three, prevents duplicates, preserves the shared-save conflict workflow, and reloads the saved values. Saving new aliases changes the next task response even when the browser's query string is unchanged.

Acceptance requires focused backend, frontend, and browser tests; a production frontend build; before/after Settings screenshots; measured task-request cache-hit timing; and the full test suite before publication.

## Outcome

Implemented with changes. The implementation is now the source of truth for the runtime behavior described above; the changes from this contract are:

- `frontend/src/eng/engTaskUtils.js` (`filterEpicsInScopeForTeamSet` / `epicMatchesActiveGroupLabel`) was added as a consumer during execution — review found it missing from the original file map — so alias-only Epics stay in scope for the active Team set on the client, not only in the server-side alert JQL.
- The Oversized Department Notice uses **option A** gating (decided 2026-09-25, recorded in this plan below): while `alertScopeTooLarge` is set for the current scope, one scope-guarded gate (`alertEpicsInScope`) drops only the alert-scope Epics from `epicsInScope`; Backlog/Follow-up/Waiting-for-Stories categories that mix alert-scope Epics with separately fetched rows keep the separately fetched rows instead of going empty, and Stories Required's de-duplication against the (now-empty) Missing Team/Missing Labels sets is accepted as lost for that scope (no Epic is shown twice).
- `jira_server.fetch_tasks` resolves the effective groups config (and therefore reads `workspace_group_configs` / dashboard config) **after** the existing project-access check, not before it — an unauthorized request never triggers the extra groups read.
- The `422 alert_scope_too_large` response's `Cache-Control` header is not set ad hoc in `fetch_tasks`; it is normalized to `no-store` by the pre-existing global `backend/security/headers.py` response hook that already applies to every response, so the "uncached" requirement is met without new header-setting code.
- `frontend/src/dashboard.jsx` grew from 18,093 to 18,189 lines (+96) for the multi-chip alias editor, the `alertScopeTooLarge` scope-guarded state, and the alias-aware `missingLabelEpics`/`normalizedActiveGroupTeamLabels` predicates; `tests/test_codebase_structure_budgets.py`'s `LEGACY_ENTRYPOINT_LINE_BUDGETS` entry for `frontend/src/dashboard.jsx` was ratcheted from 18093 to 18189 to match (mechanical update permitted by this plan's Documentation/Tests file map).
- The live before/after cache-hit `Server-Timing` measurement for `/api/tasks-with-team-name` (`groups` phase) called for in Task 2 step 9 was **not taken**: no local database or authenticated Jira session was available in this execution environment. The `groups` Server-Timing phase itself is implemented and covered by unit/integration tests (cache hit and miss both pay the read), but the numeric before/after timing is unmeasured. This is called out again in the unticked Acceptance Criteria item below.

## Current Accuracy

Accurate. Every product decision, contract shape, workflow semantics rule, and forbidden regression in this document matches the shipped implementation, subject to the five execution-time changes listed under `## Outcome`. The Settings pane subtitle, oversized-Department notice copy, and error-response shapes documented above are verbatim what the code emits (verified by reading `frontend/src/dashboard.jsx`, `frontend/src/eng/EngAlertsPanel.jsx`, and `jira_server.py` directly).

## Per-Task Commits

Branch `improvement/multiple-group-labels`, base `a673fcc8` (this plan, no product code):

- **Task 1** — Lock the canonical label and version contract in pure tests: `aa4a2197` Add multi-alias Team label contract (version 2) in pure tests.
- **Task 2** — Make Jira scope, cache, discovery, and Story readiness alias-aware: `d01ef2c9` Resolve saved Team label aliases before the task cache key; `0ec19d7a` Match Story readiness Teams by any of their label aliases; `22f374a9` Flatten Team label aliases in measurement and endpoint collector; `1164627e` Match in-scope Epics by any Team alias and skip denied groups reads.
- **Task 3** — Update future-planning classification and the Missing Labels predicate: `ad254adb` Map the in-scope Epic label filter in the aliases plan (file-map fix); `5fc3f2c9` Match future-planning Teams and Missing Labels by any alias; `3470127c` Show an oversized-Department notice instead of partial Epic alerts.
- **Task 4** — Implement the bounded multi-chip Settings editor: `16d9cdf2` Record the oversized-notice gating decision in the aliases plan; `3dfe1065` Edit up to three Jira label aliases per Team in Settings.
- Merge: `b028a8fd` Merge remote-tracking branch 'origin/main' into improvement/multiple-group-labels (brings in `effed8a4` / #202, unrelated to this plan).
- **Task 5** — Documentation, analytics, build, and final verification: this session's commits (docs; test line-budget ratchet; generated `frontend/dist` build), listed in the task-5 report.

## Review Resolution (2026-09-24)

Prior findings were rechecked against current sources before this revision.

| # | Finding | Verified evidence | Resolution in this plan |
| --- | --- | --- | --- |
| 1 | Saved aliases come from the wrong source and are not in the task cache key | `build_tasks_cache_key` (`jira_server.py`, in `fetch_tasks`) hashes only the query-string `teamLabels`; the saved merge happens later through `resolve_group_team_label_values(load_dashboard_config() ...)`, which reads `teamGroups` from the dashboard config instead of `workspace_group_configs` in DB/OAuth mode (`backend/security/CONFIGURATION_OWNERSHIP.md`) | Task 2 resolves saved aliases through `shared_group_config.load_effective_groups` (the seam Story readiness already uses) **before** the cache key; regression tests in both modes |
| 2 | Alert Epic discovery is capped at 250 | **Resolved on main by #197** (`docs/plans/EXEC-candidate-sprint-label.md`): `purpose=alerts` calls `fetch_complete_alert_epic_issues` in `backend/services/alert_epics.py` — 100 rows per page, `nextPageToken`/`isLast`, at most 2,000 unique Epics and 101 pages, and any failure, malformed page, bad token, or ceiling overflow fails the request without caching an empty scope; other purposes keep one 250-row page | This plan adds **no** pagination change. Aliases only widen the existing Team-label clause inside that JQL; one test proves an alias-only Epic on page two is included through main's path. **Added 2026-09-24 (user decision):** an over-ceiling scope currently surfaces as the generic `500 Failed to fetch tasks from Jira`, and `loadAlertEpics` calls `fetchTasks` with `setErrorOnFailure: false`, so Epic alerts silently disappear. The ceiling overflow becomes a distinct `422 alert_scope_too_large` with a Department-too-large notice in the Alerts panel (see Oversized Department Notice) |
| 3 | The dashboard's Missing Labels predicate is inline, not the helper | `missingLabelEpics` in `dashboard.jsx` calls `getFuturePlanningExpectedTeamLabel` (one label) plus `epicHasLabel`; `normalizedActiveGroupTeamLabels` coerces each value with `String(...)` | Replace with one exported alias-set predicate; source guard plus browser proof for old-only/new-only Epics |
| 4 | Scalar-only diagnostic collector missing from file map | `scripts/gather_eng_board_endpoint_data.py` `_team_labels` stringifies each map value | Added to file map and Task 2 with `tests/test_eng_board_endpoint_collector.py` |
| 5 | Shared payload and personal preference versions are coupled | `GROUPS_PAYLOAD_VERSION` is written to both `workspace_group_configs.payload_version` and `user_group_preferences.payload_version` (`_apply_group_preferences`, `save_group_preferences`) | Separate `GROUP_PREFERENCES_PAYLOAD_VERSION = 1`; only the shared group payload moves to 2 |
| 6 | Validation messages would expose labels; response shapes differ; JQL is unescaped | DB/OAuth returns `{"error": "invalid_groups_config", "errors": [...]}`; Basic returns `{"errors": [...]}`; `build_epic_alert_scope_clause` interpolates `"{label}"` without escaping | Label-free messages, both shapes documented, `alert_epics.quote_jql_value` required |
| 7 | “Import/export round-trip” is ambiguous | Two paths exist: the Settings selected-group JSON control (`exportGroupsConfig`/`importGroupsConfig`, draft-only) and backend `backend/config/import_config.py` (`import_dashboard_config` first-seed, `export_view_config_json`) | Both are covered; invalid imported arrays are rejected with the draft unchanged |
| 8 | No-label-logging promise conflicts with an existing console log | `useEngSprintData.js` logs the full task response (`console.log('Success! Received data:', data)`) | Rule scoped to server logs, error payloads, analytics, and newly added code; the existing console log is recorded as pre-existing and untouched |
| 9 | No verification bootstrap | `.nvmrc` is `20` and `package.json` `engines.node` is `20.x`; the host default `node` is not 20 | Verification Bootstrap section added |

Additional issues found during review and folded into the plan:

- `validate_groups_config` returns `payload.get('version') or groups_config_version`, so a client-sent version passes through; canonical output must always carry the current version.
- `verifyFirstRunGroupsSaveSnapshot` (`FirstRunGroupConfigurationGuide.jsx`) compares submitted and response `version`; `normalizeGroupsConfig` must therefore always emit version 2 so the draft matches the server. The verifier itself stays unchanged and is covered by `tests/test_first_run_group_configuration.js`.
- The current normalizer applies `str(...)` to each value, so old code reading a version-2 row would persist `"['a', 'b']"`. The rollout is forward-only (see Rollout And Rollback).
- Development measurement (`dev_routes._legacy_descriptor`, `eng_board_measurement_runtime.validate_legacy_request`) reads the normalized group and would stringify arrays.
- Story readiness rejects cross-Team duplicate labels in two places (`eng_routes` scope check and `story_readiness` input validation); both move to the flattened alias set.

## Product And Contract Decisions

1. **Aliases, not primary/secondary labels.** The one to three configured values are equivalent read aliases. Order is preserved for stable display and export but does not affect matching.
2. **Maximum three.** A Team may have zero to three labels while editing, but Story readiness remains unavailable for a selected Team with no label mapping, as it is today. Saving more than three returns `400` (shape per mode below); the backend never silently truncates.
3. **Distinct after normalization.** Trim whitespace and compare case-insensitively for uniqueness within one Team while preserving the first label's original Jira spelling. `label_team_a`, ` LABEL_TEAM_A `, and a repeated `label_team_a` are duplicates and are rejected on save.
4. **Distinctness is per Team.** Cross-Team label ambiguity is not widened or redesigned here. Each workflow keeps its current behavior, applied to the flattened alias set: Story readiness still fails closed (`story_readiness_configuration_invalid`) when any alias is shared by two Teams (existing exact-match comparison), and future-planning alerts still show an Epic under every matching Team.
5. **Backward-compatible input, canonical output.** Accept the scalar shape (`"team-a": "label_team_a"`) from DB rows, dashboard/groups JSON files, `TEAM_GROUPS_JSON`, backend import, Settings JSON import, and stale clients. Normalize reads and successful saves to arrays (`"team-a": ["label_team_a"]`). Blank entries are dropped; a Team whose aliases are all blank has no map entry. Mappings for Teams outside `teamIds` are dropped silently, as today.
6. **Versioning.** The shared group payload version moves from `1` to `2` (`GROUPS_CONFIG_VERSION` in `jira_server.py`, `GROUPS_PAYLOAD_VERSION` in `shared_group_config.py`, and a frontend constant). The validator always emits the current version regardless of the client-sent value; input versions `1`, `2`, or missing are accepted. Existing rows upgrade lazily: reads return version 2 without writing, and the row's `payload_version` becomes 2 on its next successful save. Personal group preferences keep their own `GROUP_PREFERENCES_PAYLOAD_VERSION = 1`. No SQL/Alembic migration is required because `workspace_group_configs.payload` is JSONB and `payload_version` already exists.
7. **Any-alias matching.** Jira JQL receives the case-insensitively de-duplicated union of aliases for the selected Teams through the existing `labels in (...)` / `labels = ...` alternative, escaped with the shared JQL string quoting. Client-side Epic classification and Story readiness match a Team when any of its aliases is present, keeping each workflow's existing case semantics (frontend case-insensitive; readiness exact).
8. **One Team result.** Multiple matching aliases for the same Team never duplicate alert groups, expected-Team entries, synthetic Story requirements, or counts.
9. **No write-path expansion.** This remains read-oriented Jira behavior plus the existing shared configuration write. It adds no Jira mutation, Home/Townsquare request, credential path, route, or permission.
10. **Existing shared ownership.** Department labels remain in `workspace_group_configs` (DB/OAuth) or `dashboard-config.json` `teamGroups` (Basic), readable and writable by authenticated workspace users under the existing revision/CSRF contract. Personal preferences and administrator configuration remain untouched.
11. **Existing analytics.** Add/remove is draft state and successful persistence remains covered by the existing Department `settings_action` save event. Add no event and never send Jira labels, Team IDs/names, group names, search text, or payload contents.
12. **Label-free diagnostics.** Server logs, validation messages, error payloads, analytics, and any logging added by this change never contain label values. The pre-existing browser `console.log` of the full task response in `useEngSprintData.js` is out of scope and left untouched; it is not claimed as covered by this rule.

## Deep Module And Seam Design

The normalization/matching module in `backend/services/team_catalog.py` and its frontend counterpart in `frontend/src/settings/groupConfigUtils.js` own the full label-shape contract:

- normalize a legacy scalar or canonical array into `string[]`;
- trim, remove blanks, and preserve order;
- detect case-insensitive duplicates within a Team, non-string entries, and the three-label limit;
- filter mappings to configured Team IDs;
- flatten aliases for request/JQL scope without exposing nested-shape logic to callers;
- test through these interfaces rather than duplicating scalar/array branching in each workflow.

The deletion test supports this seam: without it, legacy migration, bounds, duplicate handling, flattening, and any-alias matching would reappear in Settings, task loading, Story readiness, alerts, measurement, and the collector.

Canonical interfaces:

```text
teamLabels: Record<TeamId, JiraLabel[]>
JiraLabel[] length: 1..3 for each persisted mapping
```

Backend helper behavior:

```text
normalize_group_team_labels(raw, team_ids) -> (mapping, errors)
  mapping: canonical Record<TeamId, JiraLabel[]>
  errors: label-free strings; empty for valid input

flatten_group_team_labels(mapping, team_ids) -> JiraLabel[]
  ordered, case-insensitively distinct union across the requested Teams

resolve_group_team_label_values(groups_config, group_id, team_ids) -> JiraLabel[]
  takes an effective groups config (the /api/groups-config shape), not the dashboard config
```

`validate_groups_config` prefixes each error with the group name, matching existing messages. Callers that only need a mapping (task route, readiness, measurement) use the normalized groups config, which is already validated.

Frontend helper behavior:

```text
GROUPS_CONFIG_VERSION = 2
normalizeTeamLabelAliases(rawValue) -> JiraLabel[]
validateTeamLabelAliases(rawValue) -> { aliases, error }   // Settings JSON import only
flattenTeamLabelAliases(teamLabels, teamIds?) -> JiraLabel[]
epicMatchesTeamAliases(epicLabels, aliases) -> boolean
```

Future-planning helpers in `frontend/src/futurePlanningTeamUtils.mjs`:

```text
getFuturePlanningExpectedTeamLabels(epic, { selectedTeamSet, teamLabels }) -> JiraLabel[]
epicHasFuturePlanningTeamLabel(epic, { selectedTeamSet, teamLabels }) -> boolean
```

The resolved Team follows the existing order (single selected Team, then the Epic's Jira Team id, then the first label-matched Team); the predicate passes when the Epic carries any alias of that Team. `getFuturePlanningExpectedTeamLabel` (scalar) is removed once its only caller moves.

Exact helper names may follow existing local naming, but the ownership and test surface above must remain concentrated rather than copied into callers.

## Configuration And Endpoint Contract

### Canonical shared payload (version 2)

```json
{
  "version": 2,
  "groups": [
    {
      "id": "department-a",
      "name": "Department A",
      "teamIds": ["team-a"],
      "teamLabels": {
        "team-a": ["label_team_a", "label_team_a_old"]
      }
    }
  ],
  "defaultGroupId": "department-a",
  "configRevision": 8,
  "source": "workspace_db"
}
```

Basic mode returns the same `version`, `groups`, and `defaultGroupId` with `"source": "file"` (or `"env"`/`"auto"` per existing precedence) and no meaningful `configRevision`.

### Validation messages (label-free)

```text
Group "Department A" Team "team-a" has more than 3 Jira labels.
Group "Department A" Team "team-a" has duplicate Jira labels.
Group "Department A" Team "team-a" has an invalid Jira label.
```

Team IDs and group names appear as in existing messages; label values never do.

### Endpoint matrix

| Route / entry | Method / auth mode | Request change | Success change | Errors / invariants | Required tests |
| --- | --- | --- | --- | --- | --- |
| `/api/groups-config` | `GET`, `authenticated_read`, no CSRF; DB/OAuth and Basic | None | `version: 2`; alias arrays even when storage holds version-1 scalars | Read normalization never writes, never increments `configRevision`, and leaves the DB row's `payload_version` unchanged; invalid stored data keeps the existing invalid-config path (Basic: auto Default group plus warnings; DB: existing `InvalidSharedGroupConfig` behavior) | Version-1 DB row and version-1 JSON file read as version 2 with arrays; row bytes, revision, and `payload_version` unchanged |
| `/api/groups-config` | `POST`, DB/OAuth: `user_write`, `X-Requested-With` plus token-bound CSRF, `baseRevision` | `groups[*].teamLabels[teamId]` accepts a string or an array; any `version` accepted | Persists `version: 2` and arrays; increments revision once; row `payload_version = 2`; preference rows unchanged at 1 | `400 {"error": "invalid_groups_config", "errors": [...]}` for >3, duplicate, or non-string aliases; existing `401`, `409 group_config_conflict` with `current`, `team_groups_cannot_be_cleared_implicitly`, and `unsupported_group_config_field` unchanged | Scalar and array accepted; 4 aliases, case/whitespace duplicate, and non-string rejected with label-free messages; `409` shape unchanged; CSRF/XRW still required; preference `payload_version` stays 1 |
| `/api/groups-config` | `POST`, Basic (local JSON) | Same as above | Writes `dashboard-config.json` `teamGroups` with `version: 2` and arrays | `400 {"errors": [...]}` (no `error` key, as today); existing implicit-clear guard unchanged | Same validation cases asserting the Basic shape; no file write on rejection |
| `/api/tasks-with-team-name` | `GET`, existing ENG read policy, all purposes | Existing comma-separated `teamLabels` stays a flat transport detail | No response-shape change | Saved aliases resolved before the cache key; key uses the merged, case-insensitively distinct, sorted set alongside main's existing `sprint_name` input; `TASKS_CACHE_SCHEMA_VERSION` bumped; main's alert-scope pagination and fail-closed contract unchanged, except that a unique-Epic or page-ceiling overflow on `purpose=alerts` returns `422 {"error": "alert_scope_too_large", "message": "..."}` with `Cache-Control: no-cache, no-store, must-revalidate` and no cache entry (every other failure keeps the existing `500`); non-alerts purposes keep one 250-row page; Team-label JQL escaped; no label in logs | Saved-alias change with an identical query string misses the cache and reaches JQL (both modes); identical aliases hit; alias-only Epic on alert page two is included; both ceilings return the `422` shape uncached while non-200/malformed pages still return `500`; terminal-status exclusion present in the alert JQL; `dashboard` purpose issues one discovery search; escaping |
| `/api/eng/story-readiness` | `GET`, existing ENG read policy | None | No public response-shape change | Group snapshot uses `labels[]`; cache digest includes the arrays; cross-Team shared alias still returns `story_readiness_configuration_invalid`; one requirement per Team | Either alias matches; both aliases yield one Team; cross-Team collision fails closed; discovery JQL contains every alias escaped |
| `/api/dev/eng-board-measurement/*` | Existing development-only policy | None | None | Legacy descriptor and legacy request validation flatten aliases identically; a version-1 scalar and a version-2 one-item array produce identical expected query parameters | Scalar/array equivalence; two-alias Team produces `a,b` |
| `scripts/gather_eng_board_endpoint_data.py` | CLI, existing auth-mode profile | None | Emits flat `teamLabels` query parameter from alias arrays | Scalar-only `_team_labels` replaced; output stays scalar-only diagnostics (no label values in the report) | Scalar and array groups produce the same flat parameter; report contains no label values |
| `backend/config/import_config.py` | Backend first-seed import / view export | None | `import_dashboard_config` seeds version-2 arrays from a scalar legacy file; `export_view_config_json` emits `teamGroups.version: 2` with arrays | Import of invalid aliases raises the existing `InvalidSharedGroupConfig` and seeds nothing | Legacy scalar file import and export round-trip; invalid import leaves no group row |

Conflict responses, `clearGroups`, workspace identity, unsupported ownership fields, and preference handling remain unchanged.

## Settings UX Contract

In `Settings -> Departments -> Group labels` (`Team labels` pane):

- Change the pane subtitle to “Map up to three Jira Epic labels per Team; any of them matches the Team. Use labels only this Team applies.” The last sentence is the only guard against a broad alias (a label other teams also use pulls their Epics into this Team's alerts); no usage checker is built.
- Render existing values as compact removable chips in configured order, reusing `selected-team-chip` and `remove-btn`.
- When at least one chip exists and fewer than three are configured, keep search hidden until an explicit compact `Add label` action is activated; this preserves the established selected-state/change interaction. With zero chips, the existing search input remains the default affordance.
- Opening `Add label` reuses the existing Jira-label search, three-character threshold, keyboard navigation, loading, empty, blur, and Escape behavior. Since #199, typed search is Jira JQL autocomplete (prefix-only, about 15 results) via `GET /api/jira/labels?query=`; alias exclusion filters that result list client-side and adds no request.
- Exclude aliases already selected for that Team from the result list. If stale search state nevertheless selects a duplicate, leave the draft unchanged and announce a short inline status (`Already added`), reusing the existing Team feedback pattern.
- At three aliases, hide the add action and show `3 of 3 labels` without leaving a search input visible.
- Each remove action has an alias-specific accessible name such as `Remove label_team_a from Team A` while the visible chip stays compact.
- A Team may temporarily have zero aliases in the draft. Saving is allowed for the general group catalog as today, but Story readiness continues to return its existing configuration-incomplete response for a scope whose Team lacks any label.
- Cancel restores the baseline. Save uses the existing unified Settings footer and dirty-state path. A `409` preserves the full local alias arrays for the existing Reload/Keep recovery flow.
- Removing a Team removes its entire alias list. Duplicating a Department deep-copies every alias list.
- **Settings JSON export** (`exportGroupsConfig`) writes `{ "version": 2, "group": { ... } }` with alias arrays for the selected group.
- **Settings JSON import** (`importGroupsConfig`) accepts version-1 scalars and version-2 arrays into the selected group only, preserving its id/name. If any imported Team's aliases are invalid (more than three, case-insensitive duplicates, or non-string entries), the import is rejected: `groupDraftError` shows a label-free message, the import text and panel stay open, and the draft, dirty state, and baseline are unchanged. Invalid imports are never silently truncated or de-duplicated.

No bespoke visual language is introduced: reuse the existing selected-chip, compact icon action, feedback, and search-result patterns.

## Workflow Semantics

### Task request and alert Epic discovery

The frontend flattens all aliases for the active Team scope before calling `fetchEngTasks`. The server then:

1. Resolves the effective groups config once per request through `shared_group_config.load_effective_groups` with the same loaders as Story readiness (DB/OAuth: `workspace_group_configs`; Basic: dashboard JSON, groups file, environment, default), only when both `groupId` and `teamIds` are present.
2. Merges saved aliases with request aliases, de-duplicates case-insensitively, sorts, and uses that set for **both** the cache key and JQL. The read happens before the `TASKS_CACHE` lookup, so cache hits also pay it; this cost is accepted and measured (Server-Timing `groups` phase on hit and miss responses).
3. Keeps the existing JQL shape, with labels escaped through `backend.services.alert_epics.quote_jql_value`:

```text
("Team[Team]" in (...) OR labels in ("label_team_a", "label_team_a_old", ...))
```

4. Leaves main's discovery paging untouched: `purpose=alerts` reads the complete bounded scope (2,000 Epics / 101 pages) or fails the request without caching; every other purpose keeps one 250-row page, so the first-screen request count does not change. Wider alias JQL can push a scope over the ceiling; that outcome is reported explicitly (below), never as a silent empty or partial alert list.

### Oversized Department Notice

- `backend/services/alert_epics.py` raises a dedicated `AlertEpicScopeTooLarge` (subclass of the existing `RuntimeError`) for both the 2,000-unique-Epic and the 101-page ceilings. Other failures keep their existing `RuntimeError`.
- `fetch_tasks` maps `AlertEpicScopeTooLarge` to `422 {"error": "alert_scope_too_large", "message": "This Department is too large for Epic alerts."}` with no-store headers and no `TASKS_CACHE` write. The body carries no labels, Team ids, or counts.
- `useEngSprintData.loadAlertEpics` keeps `setErrorOnFailure: false`, but returns the per-project outcome. When Product or Tech reports `alert_scope_too_large`, the dashboard sets an `alertScopeTooLarge` flag for the current scope (group, sprint, Team selection) behind the existing `shouldApplyResult` stale-scope guard. The flag clears on a scope change and on the next successful alert load.
- `EngAlertsPanel` then renders one `role="status"` notice at the top of the panel, reusing the existing `story-readiness-notice` presentation (no new class, no Retry button, no Settings navigation): “This Department is too large for Epic alerts: more than 2,000 open Epics match its Teams and labels in Product or Tech. Epic alerts are hidden; Story alerts are still shown. Narrow the Department's Teams or labels.” Categories computed from the alert-purpose `epicsInScope` (for example Missing Team, Missing Labels, and empty-Epic alerts) are not presented as clean from an empty scope; categories fed by separate requests (Story readiness's Stories Required, `purpose=ready-to-close`, remote Backlog) keep their own success/failure handling. The executor must enumerate the exact `epicsInScope` consumers with `rg` before implementing and list them in the outcome. **Execution decision (2026-09-25, option A):** when the dashboard load already populated `epicsInScope` with its first page, a failed alert load leaves those stale Epics in place, and Backlog, Follow-up and Waiting for Stories mix them with separately fetched rows. While the flag is set, one scope-guarded gate (`alertEpicsInScope`) drops only the alert-scope Epics. Scope-only categories render nothing from that scope, mixed categories keep their separately fetched rows, and Stories Required is unchanged (its de-duplication against the then-empty Missing Team/Missing Labels sets is lost, so no Epic is shown twice). The flag is keyed on the Department and sprint scope and clears on scope change, explicit Refresh, or the next successful alert load; saving new aliases alone does not re-run the alert load.
- The existing Story readiness `422 story_readiness_scope_too_large` message stays as is.
- Analytics: automatic status, no user action; no new event (allowlist reason recorded in `docs/features/alerts.md` and `docs/README_ANALYTICS.md`).

### Terminal Epics never count toward the ceiling

Verified on main: alert discovery (`derive_epic_jql`) already adds `status not in (EPIC_EMPTY_EXCLUDED_STATUSES)`, default `Killed, Done, Incomplete`. Story readiness discovery hard-codes `status not in (Done, Killed, Incomplete, Postponed)`. So Done Epics of **any** age, not only those older than 90 days, are already excluded from both 2,000-Epic scans. (The Board's separate 1,000-Epic index already limits terminal Epics to its 28-day default, 90-day maximum retention window.) This plan adds regression tests that both discovery queries keep those exclusions, so aliases cannot reintroduce closed Epics into the ceiling count.

Errors loading the groups config propagate through the existing `fetch_tasks` error path; the route never silently falls back to request-only aliases.

### Future-planning alerts

- Normalize every Team mapping to an alias array with the shared helper before planning calculations; `normalizedActiveGroupTeamLabels` no longer coerces values with `String(...)`.
- Team selection matches when an Epic contains any alias for that Team.
- `missingLabelEpics` in `dashboard.jsx` keeps main's gates (`epicMatchesPlanningSprintValue`, and `epicHasPlanningSprintLabel`, which accepts the plain sprint label or its `_candidate` form). Only the Team half changes: it passes when `epicHasFuturePlanningTeamLabel(epic, ...)` is true, meaning the Epic carries at least one alias of its resolved Team. An Epic carrying only the old alias or only the new alias is not flagged.
- An Epic carrying old and new aliases for one Team yields one Team group.
- An Epic carrying labels mapped to two different Teams may still appear under both Teams, preserving the existing multi-Team behavior.

### Story readiness and Stories Required

The internal group snapshot changes from `{"label": "..."}` to `{"labels": ["...", "..."]}` in `_story_readiness_group_snapshot`, and `story_readiness` input validation accepts `labels` (non-empty list of non-empty strings). The cross-Team duplicate checks in `eng_routes` and `story_readiness` run over the flattened aliases. Discovery JQL keeps main's sprint clause (`Sprint = id OR labels in (plain, _candidate)`) and puts the flattened alias union in its existing `labels in (...)` Team clause through `_story_readiness_quote`. Projection resolves expected Teams by `intersection(epic.labels, team.labels)` and de-duplicates by Team ID before evaluating children. Public readiness output and composite requirement IDs do not change.

### Measurement and diagnostics

Development measurement descriptors, legacy request validation, and the endpoint collector flatten the same canonical aliases through the shared helper, except the collector: it is a standalone stdlib-only script, so `_team_labels` gets a local scalar-or-list flatten rather than an app import. A version-1 scalar snapshot and version-2 one-item array must produce identical query parameters. No label values enter logs, reports, analytics, or error payloads.

## Rollout And Rollback

This release is **forward-only**. Code from before this change reads an alias array with `str(...)`, producing a literal label such as `"['a', 'b']"`, and would persist that value on its next save.

- Before deploying, the operator snapshots the `workspace_group_configs` rows (DB/OAuth) and the `teamGroups` section of `dashboard-config.json` (Basic).
- Rollback means restoring that snapshot and then redeploying the previous release. Never run the previous release against version-2 group data.
- Backend, frontend source, and generated `frontend/dist` ship atomically in one change.
- The rollback note is added to the PR description and to `docs/features/eng-workflows.md`.

## State-Machine Checklist

| State/event | Required behavior |
| --- | --- |
| Initial load | Scalars and arrays render as chips; normalization performs no write and does not mark the form dirty |
| Add alias | Adds once, preserves order, updates dirty state, closes search, and keeps Add available below three |
| Duplicate add | No mutation; accessible inline feedback; Save payload remains unchanged |
| Third alias | Adds successfully and removes the add-search affordance; shows `3 of 3 labels` |
| Fourth alias / crafted payload | UI prevents it; backend rejects it with the mode-specific `400` shape |
| Remove alias | Removes only that alias; removing the final alias removes the Team's map entry |
| Remove Team | Removes the Team ID and its full alias array |
| Settings JSON import (valid) | Replaces only the selected group's settings; scalar input becomes arrays; draft becomes dirty |
| Settings JSON import (invalid aliases) | Rejected with a label-free error; draft, dirty state, and baseline unchanged; import text retained |
| Save | Existing unified Settings save persists the canonical version-2 group payload once; first-run save verification passes against a version-2 response |
| Stale save | Existing `409 group_config_conflict` keeps local alias edits and offers Reload/Keep; no automatic replay |
| Reload | Replaces the draft with the server's canonical arrays and new revision |
| Keep mine | Rebases the complete local group payload onto the server revision and requires the existing explicit retry action |
| Cancel/close | Restores the saved baseline with no request |
| Scope switch | Changing Department shows that Department's own alias arrays; search/query state does not leak between Team rows |
| Auth expiry | Existing global terminal `401` lock owns recovery; the failed save is not replayed and the mounted draft remains intact |
| Refresh / next load | The next task request uses the newly saved aliases even with an unchanged query string (cache key includes saved aliases); readiness digest changes with the arrays; stale in-flight responses remain subject to existing scope guards |

## Forbidden Regressions

- Do not rename the persisted `teamLabels` field or split labels into private/user configuration.
- Do not require a SQL migration, rewrite all workspace rows at startup, write during GET normalization, or increment revisions on read.
- Do not change `user_group_preferences.payload_version` semantics or bump it with the group payload.
- Do not silently truncate a fourth value or silently collapse a duplicate within one Team's mapping on save or Settings JSON import.
- Do not replace Jira Team-field matching; aliases remain the existing OR alternative for Epic discovery.
- Do not treat aliases as Team display names. Display names still come from the Team catalog.
- Do not duplicate Epics, alert groups, Story requirements, counts, or cache entries when two aliases of the same Team are present.
- Do not add requests to initial dashboard load or change main's alert-scope pagination/fail-closed contract; Catch Up-only alert work must not move into Board, Planning, Statistics, or Scenario.
- Do not interpolate label values into JQL without the shared escaping helper.
- Do not change EPM project labels, Jira write paths, Home/Townsquare behavior, group preferences, or administrator configuration.
- Do not emit Jira labels or search text to server logs, validation messages, error payloads, analytics, or new logging, and do not add an analytics event.
- Do not hand-edit `frontend/dist/`; rebuild it from source.

## File Map

### Runtime and configuration

- Modify `backend/services/team_catalog.py` — alias normalization with label-free errors, bounds, duplicate detection, and flattening.
- Modify `backend/services/group_config.py` — validation integration, forced current `version`, `resolve_group_team_label_values` over an effective groups config, and escaped `labels` clause in `build_epic_alert_scope_clause`.
- Modify `backend/services/shared_group_config.py` — `GROUPS_PAYLOAD_VERSION = 2`, new `GROUP_PREFERENCES_PAYLOAD_VERSION = 1` for preference rows, and lazy read/save compatibility without eager row writes.
- Modify `backend/services/story_readiness.py` — `labels[]` input validation, cross-Team duplicate check over aliases, any-alias expected-Team matching with one result per Team.
- Modify `backend/routes/eng_routes.py` — alias-array group snapshot, flattened cross-Team check, flattened discovery JQL, and cache input.
- Modify `backend/services/alert_epics.py` — `AlertEpicScopeTooLarge` for both ceilings.
- Modify `jira_server.py` — map `AlertEpicScopeTooLarge` to the uncached `422 alert_scope_too_large`; `GROUPS_CONFIG_VERSION = 2`, effective-groups alias resolution before `build_tasks_cache_key`, `TASKS_CACHE_SCHEMA_VERSION` bump, and `groups` Server-Timing phase.
- Modify `backend/routes/dev_routes.py` — measurement descriptor flattening.
- Modify `backend/services/eng_board_measurement_runtime.py` — legacy measurement query validation for array values.
- Modify `scripts/gather_eng_board_endpoint_data.py` — `_team_labels` flattens scalar or array values.
- Modify `frontend/src/settings/groupConfigUtils.js` — version constant, scalar-to-array normalization, import validation, and shared alias helpers.
- Modify `frontend/src/settings/groupVisibilityUtils.js` — `buildSharedGroupsPayload` emits the current group payload version.
- Modify `frontend/src/dashboard.jsx` — multi-chip editor, add/remove behavior, Settings JSON import/export validation, `normalizedActiveGroupTeamLabels` via the shared helper, `missingLabelEpics` via `epicHasFuturePlanningTeamLabel`, scope-guarded `alertScopeTooLarge` state passed to `EngAlertsPanel`, and copy.
- Modify `frontend/src/eng/useEngSprintData.js` — flatten all aliases for the existing task request; return per-project alert outcomes so `alert_scope_too_large` is not swallowed (no change to existing console logging).
- Modify `frontend/src/eng/EngAlertsPanel.jsx` — the oversized-Department status notice.
- Modify `frontend/src/eng/engTaskUtils.js` — `filterEpicsInScopeForTeamSet`/`epicMatchesActiveGroupLabel` keep alias-only Epics through the shared alias helpers (added during execution: review found this consumer missing from the original map).
- Modify `frontend/src/futurePlanningTeamUtils.mjs` — alias-set Team matching, `getFuturePlanningExpectedTeamLabels`, `epicHasFuturePlanningTeamLabel`; remove the scalar `getFuturePlanningExpectedTeamLabel` once unused.
- Modify `frontend/src/styles/settings/group-editor.css` — scoped wrapping/count/add-action layout for the existing chip and search patterns.
- Generated by `npm run build`: `frontend/dist/*`.

### Tests

- Modify `tests/test_team_catalog_service.py` — scalar compatibility, arrays, whitespace/case duplicates, non-string entries, limit, unknown Team, ordering, flattening, and label-free errors.
- Modify `tests/test_group_config_service.py` — forced version 2, validation messages without label values, escaped `labels` clause, and `resolve_group_team_label_values` over an effective groups config.
- Modify `tests/test_shared_group_config_service.py` — version-1 DB payload normalization, version-2 save, unchanged read revision and `payload_version`, and preference rows staying at version 1.
- Modify `tests/test_shared_group_config_routes.py` — DB/OAuth `400 invalid_groups_config` shape, CSRF/XRW unchanged, `409` shape unchanged.
- Modify `tests/test_group_excluded_capacity_epics_api.py` (owns the Basic `POST /api/groups-config` `errors` assertion) — Basic `400 {"errors": [...]}` shape for alias errors and no file write on rejection.
- Modify `tests/test_shared_group_config_import.py` — backend legacy scalar import seeds version-2 arrays; export emits version 2; invalid import seeds nothing.
- Modify `tests/test_story_readiness.py` — discovery JQL keeps `status not in (Done, Killed, Incomplete, Postponed)`; either alias matches, two aliases do not duplicate a Team, cross-Team collision fails closed, cache/JQL scope contains all aliases escaped.
- Modify `tests/test_create_stories_alert.py` (Basic task route via `force_basic_auth_mode`) — alert JQL uses the escaped alias union once inside main's grouped sprint/Team clause; an alias-only Epic on alert page two reaches `epicsInScope`; `dashboard` purpose issues exactly one discovery search; main's pagination tests stay green; both ceilings return `422 alert_scope_too_large` with no-store headers and no cache entry, while non-200/malformed pages still return `500`; the alert JQL keeps the terminal-status exclusion; Basic saved-alias cache regression (saved JSON aliases change, query string identical).
- Modify `tests/test_oauth_eng_routes.py` — DB/OAuth task path reads saved aliases from `workspace_group_configs` (not dashboard config); saved-alias change with an identical query string misses the cache and reaches JQL; identical aliases hit.
- Modify `tests/test_eng_board_measurement.py` — scalar/array descriptor and legacy request equivalence.
- Modify `tests/test_eng_board_endpoint_collector.py` — scalar and array `teamLabels` produce the same flat parameter; report omits label values.
- Modify `tests/test_group_config_utils.js` — legacy scalar normalization, canonical arrays, version 2, order, duplicate/limit/non-string import validation, and immutable copies.
- Modify `tests/test_eng_task_utils.js` — two-alias Team keeps an Epic with another Team's id carrying either alias, drops one with neither, and still accepts legacy scalars.
- Modify `tests/test_future_planning_team_utils.js` — old-only, new-only, both, and neither alias cases for `epicHasFuturePlanningTeamLabel` across selected-Team, Jira-Team-id, and label-matched resolution; same-Team double match stays single.
- Modify `tests/test_dashboard_missing_labels_source_guards.js` and `tests/test_dashboard_alert_source_guards.js` — `missingLabelEpics` keeps `epicMatchesPlanningSprintValue`, uses `epicHasFuturePlanningTeamLabel` and no longer references `getFuturePlanningExpectedTeamLabel`; `loadAlertEpics` outcomes feed the scope-guarded `alertScopeTooLarge` flag; `normalizedActiveGroupTeamLabels` uses the shared normalizer.
- Modify `tests/test_first_run_group_configuration.js` — duplication/removal and save-snapshot verification with nested alias arrays and a version-2 response for a version-1 draft origin.
- Modify `tests/ui/shared_department_groups.spec.js` — add two distinct labels, prevent duplicate/fourth label, remove one, save/reload, conflict recovery, cancel, Settings JSON export and valid/invalid import, accessible controls; capture before/after screenshots after transitions settle.
- Modify `tests/ui/eng_missing_story_ghosts.spec.js` — extend main's future-sprint label-case table with a two-alias Team: old alias only and new alias only (each with the sprint label) route to Stories Required, both aliases yield exactly one result, and neither alias routes to Missing Labels; assert absence from the other sections after all responses settle. Add an oversized case: a `422 alert_scope_too_large` alert response renders exactly one notice, no `epicsInScope`-derived category, and still renders Story alerts and a successful readiness result; switching to another Department clears it, and a delayed `422` from the previous scope never shows in the new one. Capture a screenshot of the notice after animations settle.
- Modify `tests/test_backend_service_extraction.py` and `tests/test_codebase_structure_budgets.py` only if the existing extraction or line-budget guards require mechanical updates caused by the scoped change.

### Documentation

- Modify `docs/features/eng-workflows.md` — up-to-three alias setup, Epic discovery semantics, and the forward-only rollback note.
- Modify `docs/features/alerts.md` — any-alias Missing Labels/Stories Required behavior, one-Team de-duplication, the oversized-Department notice, and terminal-status exclusion from the 2,000-Epic scan.
- Modify `docs/README_ANALYTICS.md` — explicit no-new-event allowlist for alias editing/matching and the oversized-Department status notice.
- Modify `backend/security/CONFIGURATION_OWNERSHIP.md` only to clarify the group-label value shape; ownership and permissions do not change.
- Modify `docs/ontology.md` — keep the Department group-label, task-route alias resolution, and Story-readiness relationships current.
- Modify `docs/plans/README.md` — index this plan and later record execution state.

All files above already exist (verified 2026-09-24). No new runtime module, route, database migration, or dependency is planned. Before executing a task, confirm each named file still exists.

## Verification Bootstrap

Run once per fresh checkout or worktree before any verification command:

```bash
fnm use 20            # or: export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
node --version        # must print v20.x; stop if not
npm ci
.venv/bin/python -m pip install -r requirements.txt && .venv/bin/python -m pip install -e .
npx playwright install chromium
```

Run every `node`, `npm`, and `npx` command below in the same Node 20 shell. Run Python tests with explicit environment overrides so a parent checkout's `.env` does not leak into results.

## Implementation Tasks

### Task 1 — Lock the canonical label and version contract in pure tests

1. Add failing Python cases for scalar input, one-to-three arrays, trim/order preservation, case-insensitive duplicates, non-string entries, a fourth alias, and label-free error text.
2. Add failing frontend normalization and import-validation cases proving the same canonical shape without mutating the input.
3. Implement the seam in `team_catalog.py` and `groupConfigUtils.js`; wire `validate_groups_config` messages and force the current `version`.
4. Bump the shared group version to 2 and split `GROUP_PREFERENCES_PAYLOAD_VERSION = 1`; prove preference rows keep version 1.
5. Prove a version-1 scalar payload (DB row and JSON file) reads as version 2 without a write, revision change, or `payload_version` change.
6. Prove both `POST` error shapes (DB/OAuth and Basic) and that backend import/export round-trips.

Focused verification:

```bash
.venv/bin/python -m unittest tests.test_team_catalog_service tests.test_group_config_service tests.test_shared_group_config_service tests.test_shared_group_config_routes tests.test_shared_group_config_import tests.test_group_excluded_capacity_epics_api
node --test tests/test_group_config_utils.js tests/test_first_run_group_configuration.js
```

### Task 2 — Make Jira scope, cache, discovery, and Story readiness alias-aware

1. Flatten selected-Team aliases in `useEngSprintData`.
2. In `fetch_tasks`, resolve saved aliases through `load_effective_groups` before `build_tasks_cache_key`; build the key and JQL from the merged set; bump `TASKS_CACHE_SCHEMA_VERSION`; add the `groups` Server-Timing phase.
3. Escape labels in `build_epic_alert_scope_clause` with `quote_jql_value`.
4. Add the alias-only-on-page-two test through main's `fetch_complete_alert_epic_issues` path; make no pagination change. Add `AlertEpicScopeTooLarge`, map it to the uncached `422 alert_scope_too_large`, and lock the terminal-status exclusions in both discovery queries with tests.
5. Change the readiness snapshot and input validation to `labels[]`, flatten the cross-Team check and discovery JQL, and match any alias per Team exactly once.
6. Update the development measurement path and the endpoint collector to the same flattened representation.
7. Add the saved-alias cache regression in both modes: the first request with saved `[a]`; change saved to `[a, b]`; the second request with a byte-identical query string must miss the cache and include `b` in the discovery JQL.
8. Assert no label value appears in server log calls or error bodies for these paths, and that the `dashboard` purpose issues exactly one discovery search.
9. Record cache-hit and cache-miss `Server-Timing` for `/api/tasks-with-team-name` before and after the change (Basic mode locally; DB/OAuth when a local database is available) in this plan's outcome; do not claim a measurement that was not taken.

Focused verification:

```bash
.venv/bin/python -m unittest tests.test_story_readiness tests.test_create_stories_alert tests.test_oauth_eng_routes
.venv/bin/python -m unittest tests.test_eng_board_measurement tests.test_eng_board_endpoint_collector tests.test_backend_service_extraction
```

### Task 3 — Update future-planning classification and the Missing Labels predicate

1. Normalize every Team mapping to an alias array with the shared helper in `normalizedActiveGroupTeamLabels`.
2. Match Team selection when any alias is on the Epic.
2a. Surface `alert_scope_too_large` from `loadAlertEpics`, keep it scope-guarded, and render the Alerts-panel notice.
3. Add `getFuturePlanningExpectedTeamLabels` and `epicHasFuturePlanningTeamLabel`; switch `missingLabelEpics` in `dashboard.jsx` to the predicate; remove the scalar helper.
4. Preserve multi-Team grouping when distinct Team alias sets match one Epic, while de-duplicating repeated aliases for the same Team.

Focused verification:

```bash
node --test tests/test_future_planning_team_utils.js tests/test_dashboard_missing_labels_source_guards.js tests/test_dashboard_alert_source_guards.js tests/test_backlog_alert_sprint_filter.js tests/test_analytics_source_guards.js
npx playwright test tests/ui/eng_missing_story_ghosts.spec.js
```

### Task 4 — Implement the bounded multi-chip Settings editor

1. Replace the scalar setter with add/remove alias operations over immutable arrays.
2. Render up to three compact chips, an explicit `Add label` action below the limit, and the existing search only while adding.
3. Filter selected values, guard stale duplicate selection, preserve keyboard behavior, and expose accessible add/remove/status text.
4. Implement Settings JSON export (version 2) and import validation (reject invalid arrays without changing the draft).
5. Verify Team removal, Department duplication, dirty detection, unified Save, first-run save verification, cancel, reload, Keep mine, and auth-lock behavior with nested arrays.
6. Compare before/after screenshots at desktop and compact viewport after animations settle, with element-level geometry checks that chips, count text, and the add action stay within the row.

Focused verification:

```bash
node --test tests/test_group_config_utils.js tests/test_first_run_group_configuration.js tests/test_group_visibility_utils.js tests/test_groups_config_conflict.js
npx playwright test tests/ui/shared_department_groups.spec.js
```

### Task 5 — Documentation, analytics, build, and final verification

1. Update the workflow, alert, analytics, security-shape, ontology, and plan-index documents named above, including the forward-only rollback note.
2. Run `npm run build` in the Node 20 shell; inspect generated changes and do not hand-edit them.
3. Run focused tests again, then the full suites required before publication:

```bash
.venv/bin/python scripts/check_startup_preflight.py
.venv/bin/python -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test
npm run build
```

4. Launch `.venv/bin/python jira_server.py`, verify `/api/test`, and treat any pre-banner runtime warning as a failed startup check.
5. Inspect `git diff` and remove every changed line not traceable to this plan. Do not commit, push, or create a PR without the user's explicit publication confirmation and the repository's full publication transaction.

## Acceptance Criteria

- [x] A legacy scalar mapping (DB row, JSON file, environment JSON, backend import, Settings JSON import) loads as a one-item alias array with no manual migration and no write on read. Evidence: `.venv/bin/python -m unittest tests.test_team_catalog_service tests.test_group_config_service tests.test_shared_group_config_service tests.test_shared_group_config_import` — part of the clean full-suite run below (1989 tests, OK).
- [x] A Team can save and reload one, two, or three distinct aliases; a fourth, a case/whitespace duplicate, or a non-string entry is rejected with label-free messages in the mode-specific `400` shape. Evidence: `tests.test_group_config_service`, `tests.test_shared_group_config_routes`, `tests.test_group_excluded_capacity_epics_api`, `node --test tests/test_group_config_utils.js` — all passing in the full-suite runs below.
- [x] Group payloads are version 2 on read and save; personal group-preference rows remain at `payload_version` 1. Evidence: `tests.test_shared_group_config_service` (full-suite run, OK).
- [x] Changing saved aliases changes the next task response even when the browser's query string is identical, in DB/OAuth and Basic modes. Evidence: `tests.test_create_stories_alert`, `tests.test_oauth_eng_routes` (full-suite run, OK).
- [x] An Epic carrying any configured alias is discovered and attributed to the intended Team; label values in JQL are escaped. Evidence: `tests.test_story_readiness`, `tests.test_group_config_service`, `tests.test_create_stories_alert` (full-suite run, OK).
- [x] An alias-only Epic beyond the first alert page is discovered through main's bounded pagination, whose fail-closed contract is unchanged; the default dashboard request still issues one discovery search. Evidence: `tests.test_create_stories_alert` (full-suite run, OK).
- [x] An alert scope over main's ceiling returns an uncached `422 alert_scope_too_large` and shows one Department-too-large notice in the Alerts panel instead of silently empty Epic alerts; Story alerts still render; the notice never leaks across a scope switch. Evidence: `tests.test_create_stories_alert` (backend shape) plus `npx playwright test tests/ui/eng_missing_story_ghosts.spec.js`, part of the full Playwright run (888 passed; this spec is not among the 29 pre-existing failures, reproduced identically against clean `origin/main`).
- [x] Done/Killed/Incomplete Epics (plus Postponed for readiness) of any age are excluded from both 2,000-Epic scans, proven by JQL tests. Evidence: `tests.test_story_readiness`, `tests.test_create_stories_alert` (full-suite run, OK).
- [x] An Epic carrying two aliases for the same Team produces one Team match, one alert group, and at most one Story requirement. Evidence: `node --test tests/test_eng_task_utils.js tests/test_future_planning_team_utils.js`, `tests.test_story_readiness` (full-suite runs, OK).
- [x] The dashboard's Missing Labels list excludes an Epic with the sprint label plus only the old alias or only the new alias, proven in the browser. Evidence: `npx playwright test tests/ui/eng_missing_story_ghosts.spec.js`, part of the full Playwright run (888 passed; not among the 29 pre-existing failures).
- [x] Story readiness discovery includes every alias, a cross-Team shared alias still fails closed, and the public response shape is unchanged. Evidence: `tests.test_story_readiness` (full-suite run, OK).
- [ ] Existing Jira Team-field matching, Catch Up deferral, first-screen request count, and cache isolation remain unchanged; cache-hit timing before and after is recorded. The functional half (Team-field matching, Catch Up deferral, one first-screen discovery search, cache isolation) is verified by `tests.test_create_stories_alert`, `tests.test_oauth_eng_routes`, and `tests.test_backend_service_extraction` (full-suite run, OK). The `Server-Timing` `groups` phase is implemented and its presence/shape is unit-tested, but the live cache-hit-vs-miss timing measurement itself was **not taken**: this execution environment has no `.env`, `JIRA_URL`, or local database (`scripts/check_startup_preflight.py` fails `auth_config: JIRA_URL is required.`), so there is no authenticated Jira session to measure against. Left unticked per this plan's own residual risk.
- [x] Shared save ownership, CSRF, revision conflict, Reload/Keep, auth-lock, and no-replay behavior remain unchanged. Evidence: `tests.test_shared_group_config_routes` (full-suite run, OK) and `npx playwright test tests/ui/shared_department_groups.spec.js`, part of the full Playwright run (888 passed; not among the 29 pre-existing failures).
- [x] Department duplication, Team removal, Settings JSON export/import (valid and rejected), backend import/export, Basic mode, and DB/OAuth mode preserve alias arrays correctly. Evidence: `node --test tests/test_first_run_group_configuration.js`, `tests.test_shared_group_config_import` (full-suite runs, OK), and `npx playwright test tests/ui/shared_department_groups.spec.js` (passed). The 3 known pre-existing `tests/ui/eng_group_board_settings_tab.spec.js` failures (Import JSON new-group case and two malformed-board cases) are legacy Board-column import cases unrelated to alias arrays; verified pre-existing on clean `origin/main` at `effed8a4` in this session (identical failure list and messages reproduced in an isolated worktree).
- [x] Development measurement and the endpoint collector produce identical flat parameters for scalar and one-item array mappings. Evidence: `tests.test_eng_board_measurement`, `tests.test_eng_board_endpoint_collector` (full-suite run, OK).
- [x] UI controls are keyboard accessible, reuse established chip/search styles, and have stable desktop/compact screenshots. Evidence: `npx playwright test tests/ui/shared_department_groups.spec.js` (passed) and desktop/compact before/after screenshots captured under `test-results/multiple-group-labels/`.
- [x] No new analytics event exists; the taxonomy documents the existing `settings_action` coverage and sensitive-data exclusions; no label values are added to server logs or error payloads. Evidence: `docs/README_ANALYTICS.md` No-Event Allowlist rows added this session (Team-label alias editing/matching; oversized-Department notice); `node --test tests/test_analytics_source_guards.js`, part of `npm run test:frontend:unit` (passing).
- [x] The forward-only rollback procedure is documented. Evidence: `docs/features/eng-workflows.md` "Team labels (aliases)" section (added this session) plus the pre-existing Rollout And Rollback section below.
- [x] Focused tests, full Python/Node/Playwright suites, build, preflight, server startup, and `/api/test` report their actual results in the Node 20 toolchain. Evidence (actual results, not all green): `.venv/bin/python -m unittest discover -s tests` → 1989 tests, OK (25 skipped); `npm run test:frontend:unit` → 1500/1501 passing (the 1 failure is a transient working-tree dist-vs-source guard that clears once `frontend/dist` is committed); `npx playwright test` → 888 passed, 29 failed (3 previously verified pre-existing + 26 newly verified pre-existing against clean `origin/main` in this session), 2 skipped, 3 did not run; `npm run build` → clean, matching regenerated `frontend/dist`; `scripts/check_startup_preflight.py` and `jira_server.py` startup both fail on `auth_config: JIRA_URL is required.` — environment-bound (no `.env`/Jira credentials in this sandbox), consistent with prior plans in this repo; `/api/test` therefore unreachable.

## Residual Risks

- Jira label values containing commas already cannot round-trip through the existing comma-separated `teamLabels` query parameter. The server-side saved-alias merge now covers saved labels regardless of transport, but request-supplied labels with commas remain split. Replacing the transport with repeated query parameters is a separately approved contract change.
- The release is forward-only; a rollback without restoring the pre-deploy snapshot corrupts labels. Backend, frontend, and generated assets must ship atomically.
- Resolving saved aliases before the cache lookup adds one shared-group read to every scoped task request, including cache hits. It is measured, not assumed free. Dropping Basic JSON configuration to simplify this path is a separate, cross-cutting plan (config repositories, EPM, capacity, Scenario, Board, team catalog, and startup import).
- Aliases widen alert and readiness discovery; a Department whose widened scope exceeds main's 2,000-Epic ceiling (per Product or Tech request) gets the Department-too-large notice instead of Epic alerts. Record page counts when real scope is available.
- Terminal-Epic exclusion is by status **name** (`EPIC_EMPTY_EXCLUDED_STATUSES`, readiness's hard-coded list), not Jira `statusCategory`. A workflow whose closed status has another name (for example `Closed` or `Released`) still counts toward the ceiling; switching to `statusCategory != Done` is a separate decision.
- Story readiness projection matches returned labels exactly while frontend alerts match case-insensitively (Jira Cloud JQL label search itself is case-insensitive, per `docs/plans/EXEC-candidate-sprint-label.md`); this pre-existing divergence is unchanged.
- The pre-existing browser `console.log` of the full task response in `useEngSprintData.js` still prints Epic labels to the developer console; it is intentionally out of scope.
- Existing cross-Team label ambiguity remains outside this improvement. Story readiness must continue to fail closed for an ambiguous mapping rather than silently manufacturing duplicate requirements.
- The full local Playwright run (Task 5) found 26 additional failing tests beyond the 3 pre-existing `eng_group_board_settings_tab.spec.js` cases already recorded in Task 4 — spanning `codebase_structure_smoke`, `eng_alert_loading_order`, `eng_board_measurement_runner`, `eng_board_progressive_loading`, `eng_board_stream`, `eng_compact_layout_visual`, `eng_group_board_view`, `epm_settings_visual_states`, `global_auth_lock`, `group_board_composer`, and `planning_capacity_editing`. None of these files or their app-source dependencies appear in this branch's diff against `origin/main`. Re-running the identical 11 spec files against a disposable worktree of clean `origin/main` (`effed8a4`) in this session reproduced the exact same 26 failures with identical error messages and line numbers, confirming they are pre-existing and unrelated to this change, not a regression introduced here.
- The live-CPU-contention re-run of the full Python suite once transiently failed `test_local_postgresql_runner.LocalPostgresqlRunnerProcessTests.test_sigint_returns_130_kills_child_and_cleans_once` plus one unrelated `TimeoutExpired` while a full Playwright run was competing for CPU concurrently; re-running that test file in isolation (3 consecutive passes) and the full suite again on a quieter host both came back clean (`OK`, 1989 tests, 25 skipped), confirming this was host-load flakiness in a wall-clock-timed subprocess-signal test, not a regression from this change.
