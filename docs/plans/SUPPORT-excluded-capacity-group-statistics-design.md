# Excluded Capacity Group Statistics Design

Status: planned
Type: feature
Issue: [#156](https://github.com/Juce-me/jira-execution-planner/issues/156)
Review state: Proposed for product and engineering review; do not execute this `SUPPORT-*` document directly.

## Goal

Make Excluded Capacity's Group mode a workspace-wide department comparison instead of a
single-active-department rollup. The active dashboard department appears first and is focused while
every configured department loads progressively. Completed-sprint aggregates persist in the database
so separate application processes can reuse them.

The same change moves Excluded Capacity configuration to one workspace-wide shared list, adds an
optional workspace-wide Ad Hoc list, and retains department-level Ad Hoc additions.

## Current Behavior And Constraints

- `frontend/src/dashboard.jsx` requests `/api/stats/excluded-capacity-source` for the active
  department's selected teams, one sprint at a time, and retains results only in a browser ref plus the
  process-local backend cache.
- `buildEffortTypeSplitRows` always emits Team rows. Group mode affects only
  `buildExcludedCapacityLineSeries`, where it collapses the active department to one line.
- The line-chart title is always **Excluded Capacity by Team and Sprint**.
- `workspace_group_configs.payload.groups[]` currently owns both `excludedCapacityEpics` and
  `adHocCapacityEpics`. This configuration is shared between workspace users, but the lists are
  different for each department.
- The legacy completed-sprint `stats_cache.json` is disabled in DB mode and cannot be shared between
  application processes.
- Department definitions are JSON children of one `workspace_group_configs` row, not independently
  normalized database rows.
- Jira reads in DB/OAuth mode use the signed-in user's OAuth context. Persistent aggregates must not
  make data fetched under one Jira principal visible to another principal.
- Department team membership may overlap. Cross-department totals must not silently claim to be a
  deduplicated workspace total.
- Excluded Capacity and Mono vs Cross are performance-sensitive, stats-source-only views. Group
  loading must start only when Excluded Capacity Group mode is visible; it must not add dashboard
  startup requests or load ENG alerts/task lists.

## Decisions To Review

1. **All groups means shared configuration.** Group mode includes every entry in
   `workspace_group_configs.payload.groups`, independent of the current user's visible/favorite group
   preferences. A configured group with no teams renders as a zero-data row with a configuration note
   and does not trigger Jira work.
2. **The active dashboard group is the initial focus.** It is placed first in Group-mode rows and
   selected in a Statistics-local Group dropdown. If it disappears during a concurrent configuration
   change, focus falls back to the first group in shared-configuration order.
3. **Statistics focus is local.** Changing the Group-mode focus does not mutate the dashboard's active
   group, personal favorite, or visibility preferences. It only changes emphasis and the summary cards.
4. **Shared Excluded Capacity is authoritative.** Existing per-department excluded epic lists are
   unioned into one workspace-wide list during migration. Department-level Excluded Capacity is
   removed.
5. **Ad Hoc has two additive levels.** The workspace-wide Ad Hoc list starts empty during migration.
   Existing per-department Ad Hoc lists remain department additions. Effective Ad Hoc for a department
   is `sharedAdHocCapacityEpics ∪ group.adHocCapacityEpics`.
6. **Excluded wins during legacy migration; v2 saves reject overlap.** Saving is rejected when a
   shared excluded epic overlaps the workspace-wide Ad Hoc list or any department's effective Ad Hoc
   list. The UI explains which department causes the overlap. A v1 migration can create a cross-group
   collision when one department excluded an epic that another marked Ad Hoc; migration removes that
   epic from the affected Ad Hoc list, returns a warning, and preserves the exact original payload in
   the downgrade archive. Normal v2 saves and imports cannot create the conflict.
7. **Summary cards describe the focused department in Group mode.** Summing all Group rows can double
   count teams that belong to more than one department. Cards therefore show the focused department's
   values and name that scope in their notes. Team mode keeps its current active-scope totals.
8. **Database cache sharing is process-wide, not principal-wide.** Cache rows are partitioned by
   workspace and Jira auth connection. Two application instances using the same database and Jira
   connection reuse completed-sprint results; different Jira principals do not share aggregates.
9. **Only closed sprints are durable.** Active/future results are never written to the DB cache.
   Explicit Refresh recomputes the visible range and replaces matching closed-sprint rows.
10. **Team mode and sibling Statistics views keep their existing data source.** This slice adds a
    group-aggregate path for Excluded Capacity Group mode only. Mono vs Cross and Project Track keep
    consuming `/api/stats/excluded-capacity-source`.

## Alternatives

### A. Batched server aggregates with a durable aggregate cache — recommended

Add a dedicated group-statistics endpoint. It derives groups from canonical shared configuration,
aggregates Jira source rows server-side, and persists only compact closed-sprint metrics. The frontend
first reads available DB cache rows, then computes the focused group, then computes remaining misses
in batches of five.

Advantages:

- Meets selected-first, cached-first, batch-of-five, and cross-process requirements directly.
- Stores no issue summaries, assignees, issue keys, or raw Jira response data.
- Enforces workspace, configuration-revision, and Jira-principal boundaries centrally.
- Allows one Jira source query over the union of teams in each five-group batch rather than one query
  per department.

Costs:

- Requires a new aggregate service and parity tests between backend and existing frontend capacity
  classification semantics.
- Adds a database migration and cache lifecycle rules.

### B. Persist raw Excluded Capacity source rows

Store the current `/api/stats/excluded-capacity-source` issue payload by sprint/team signature, then let
React build department rows.

Advantages:

- Reuses existing frontend calculations with fewer backend aggregation changes.
- Future charts could reuse the raw snapshot.

Reasons not recommended:

- Persists issue identifiers, summaries, assignees, and more data than the feature needs.
- Produces larger rows and stronger retention/privacy obligations.
- Overlapping department team sets create redundant snapshots or complicated union keys.
- Cache readers still need configuration- and principal-aware filtering.

### C. Reuse the current endpoint once per department

Have the browser call `/api/stats/excluded-capacity-source` for the active group and then for each
remaining group's team IDs, adding a DB layer underneath the existing source cache.

Advantages:

- Smallest initial API-shape change.
- Existing JavaScript aggregators remain authoritative.

Reasons not recommended:

- Creates one request/query path per department and repeats Jira work for overlapping teams.
- Makes the five-group batch requirement cosmetic rather than a true backend fan-out bound.
- Persists or transmits raw source rows and recreates the startup/load fan-out pattern documented in
  `MRT010`.

## Shared Configuration Design

Raise the group payload schema version and normalize this shape:

```json
{
  "version": 2,
  "excludedCapacityEpics": ["EXAMPLE-100"],
  "adHocCapacityEpics": [],
  "groups": [
    {
      "id": "department-a",
      "name": "Department A",
      "teamIds": ["team-a"],
      "adHocCapacityEpics": ["EXAMPLE-200"]
    }
  ],
  "defaultGroupId": "department-a"
}
```

Semantics:

- Top-level `excludedCapacityEpics` applies to Planning, Scenario, Burndown, Lead Times, Excluded
  Capacity, Mono vs Cross, Project Track, and every department.
- Top-level `adHocCapacityEpics` applies to every department.
- `groups[].adHocCapacityEpics` remains an additive department-level list.
- `groups[].excludedCapacityEpics` is a v1 compatibility input only. It is never emitted by normalized
  v2 responses or saved by the v2 UI.
- Effective excluded set: `config.excludedCapacityEpics`.
- Effective Ad Hoc set for group `G`:
  `config.adHocCapacityEpics ∪ G.adHocCapacityEpics`.
- Validation compares the shared excluded set against the shared Ad Hoc set and every effective
  department Ad Hoc set.

### Migration

The database migration that creates the stats cache also upgrades existing DB group payloads:

1. Archive each original `workspace_group_configs` payload and revision in a migration archive table so
   downgrade can restore the exact per-department lists.
2. Normalize and union every `groups[].excludedCapacityEpics` list into top-level
   `excludedCapacityEpics`, preserving first occurrence in shared group order.
3. Set top-level `adHocCapacityEpics` to an existing valid top-level value or `[]`; do not promote any
   department Ad Hoc entry.
4. Preserve each `groups[].adHocCapacityEpics` entry except keys now present in the unioned shared
   excluded list. Remove those collisions from Ad Hoc, record a sanitized migration warning, and keep
   the exact original list in the migration archive.
5. Remove `groups[].excludedCapacityEpics`, set `version: 2`, and increment `config_revision` once for a
   changed payload.
6. Leave unrelated group, board, team-label, preference, dashboard, and EPM data untouched.

JSON/basic mode performs the same v1-to-v2 normalization in memory. Its next explicit configuration
save/export writes the canonical v2 shape; reading the legacy file does not rewrite it implicitly.

### Settings UX

Add a **Capacity** sub-tab under **Departments**, alongside Teams, Labels, and Boards. This is a shared
workspace configuration surface, not an administrator-only tab.

- **Shared Excluded Capacity** uses the established compact selected-chip / explicit search pattern.
- **Shared Ad Hoc Capacity** uses the same pattern and explains that it applies to all departments.
- **Department Ad Hoc additions** provides a department dropdown followed by the existing Ad Hoc epic
  selector for that department.
- Remove the per-department Excluded Capacity selector from the Teams editor.
- Keep one modal-footer Save operation. The request remains scoped to `/api/groups-config`, carries the
  complete v2 group payload and `baseRevision`, and participates in existing dirty/conflict recovery.
- Inline Included/Excluded actions in Planning and Reporting update the workspace-wide excluded list.
  Their copy must say the change affects all departments.

## Statistics UX

### Team mode

No behavioral change beyond consuming the new effective configuration helpers. Effort Split remains
by Team and the lower chart remains **Excluded Capacity by Team and Sprint** for the active dashboard
department/team filter.

### Group mode

- Effort Split contains one row for every configured department and no Team rows.
- The active dashboard department appears first; remaining rows preserve shared-configuration order.
- A Statistics-local **Group focus** dropdown is visible in Group mode and initially selects the active
  dashboard department.
- The focused department row is visually emphasized. Selecting another row or line legend item updates
  the same focus state without changing global dashboard scope.
- The lower title becomes **Excluded Capacity by Group and Sprint**.
- The lower chart contains one line per configured department. The focused line uses full opacity and a
  stronger stroke; other loaded lines remain visible at reduced emphasis rather than being hidden.
- Department colors are deterministic by group ID and remain stable as batches arrive. The existing
  single hard-coded Group color is removed.
- The five summary cards show the focused department's values and identify the focused department in
  their supporting text.
- Cached department rows/lines render as soon as cache lookup returns. A loading indicator reports
  loaded departments, not only sprints.
- Missing focused data renders a focused skeleton immediately. A failed non-focused department renders
  a retryable per-department warning without blanking loaded departments.
- Empty configured groups render a zero row and a **No teams configured** note.

### Progressive order

1. Entering Excluded Capacity Group mode sends one cache-only lookup for the selected sprint IDs.
2. All matching cached closed-sprint fragments render immediately.
3. If the focused department has any missing fragment, request that department alone.
4. Divide remaining incomplete departments into stable chunks of at most five in shared-configuration
   order and load the chunks sequentially.
5. Merge each response without replacing already rendered rows. If focus changes to an incomplete
   department, move it ahead of the remaining queue and request it alone.
6. Abort and generation-guard the queue when the sprint range, chart mode, configuration revision,
   auth-required state, or shared group catalog changes.

Cached departments do not consume a compute-batch slot. A cached fragment may coexist with a live
active-sprint fragment for the same department; the response marks this as `mixed`.

## API Contract

Add one route with explicit lookup and compute operations:

| Route | Policy | Headers | Request | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| `POST /api/stats/excluded-capacity-groups` | `authenticated_read`; current workspace and Jira OAuth connection come only from `RequestAuthContext` | `Content-Type: application/json`; `X-Requested-With: jira-execution-planner`; no CSRF token because this is an authenticated read | Lookup: `{ "operation": "lookup", "sprintIds": ["101"], "groupConfigRevision": 7 }`. Compute: `{ "operation": "compute", "sprintIds": ["101"], "groupIds": ["department-a"], "groupConfigRevision": 7, "refresh": false }`. Compute accepts 1–5 unique configured group IDs. | `{ "groups": [GroupStats], "missing": [{ "groupId": "department-a", "sprintIds": ["101"] }], "groupConfigRevision": 7, "meta": { "operation": "lookup", "cachedSprintCount": 1, "computedSprintCount": 0, "returnedGroupCount": 1, "warnings": [] } }` plus `Server-Timing` | `400 invalid_json`, `400 sprint_ids_required`, `400 invalid_operation`, `400 group_ids_required`, `400 group_batch_too_large`, `400 unknown_group_id`; existing sanitized `401` auth recovery; `409 group_config_changed`; `502 jira_request_failed`; `500 stats_cache_unavailable` only when DB mode cannot safely read/write the required durable cache |

`lookup` performs no Jira request. It derives the complete allowed group catalog from
`workspace_group_configs`, returns matching cache rows, and reports missing group/sprint cells.

`compute` validates its IDs against the same canonical catalog, resolves requested sprint state from
Jira through a bounded/cached sprint-metadata path, reads matching DB rows first, and computes only
missing or explicitly refreshed cells. It captures `config_revision` before Jira work and verifies the
revision again before returning/persisting; a mismatch returns `409 group_config_changed` and does not
publish stale data.

`GroupStats` is aggregate-only:

```json
{
  "groupId": "department-a",
  "groupName": "Department A",
  "order": 0,
  "source": "db_cache",
  "sprints": [
    {
      "sprintId": "101",
      "sprintName": "2026Q3 Sprint 1",
      "state": "closed",
      "effort": {
        "excludedCapacityPoints": 5,
        "adHocPoints": 3,
        "productPoints": 8,
        "techPoints": 2,
        "totalPoints": 18
      },
      "excluded": {
        "excludedPoints": 5,
        "totalPoints": 18,
        "percent": 0.277778
      },
      "generatedAt": "2026-09-06T12:00:00+00:00"
    }
  ],
  "warnings": []
}
```

The payload contains no issue keys, summaries, assignees, JQL, team names, credential identifiers, or
raw Jira errors.

## Aggregate And Query Semantics

- For each compute batch, take the union of the requested groups' team IDs and fetch only missing
  sprint IDs through the existing next-page-token/isLast stats-source path.
- Request only fields needed for story points, sprint identity, epic identity, team identity, and
  Product/Tech classification. Do not fetch dependencies, descriptions, changelogs, or alerts.
- A Story contributes independently to every configured department containing its Team. This is
  intentional for comparison rows; no workspace total is presented.
- Excluded classification uses the workspace-wide excluded set.
- Ad Hoc classification uses the workspace-wide set plus the current department's additions.
- Product/Tech classification must match `classifyCapacityIssue` semantics. Introduce shared synthetic
  fixtures consumed by Python and Node parity tests so either implementation fails if bucket precedence
  drifts.
- The lower line's denominator is all scoped Story points for that department/sprint; numerator is the
  workspace-wide excluded set. Ad Hoc remains included Product capacity and is not part of the lower
  line's numerator.
- A partial Jira page failure returns no cache write for affected cells. Complete group results from the
  same batch may still be returned with sanitized warnings.

## Database Cache Design

Create `workspace_group_sprint_stats_cache` with:

| Column | Purpose |
| --- | --- |
| `id` | UUID primary key |
| `workspace_id` | FK to `workspaces.id`, `ON DELETE CASCADE`; mandatory tenant boundary |
| `group_config_id` | FK to `workspace_group_configs.id`, `ON DELETE CASCADE`; ties rows to the canonical shared department catalog |
| `auth_connection_id` | FK to `auth_connections.id`, `ON DELETE CASCADE`; prevents cross-principal Jira aggregate reuse |
| `group_id` | Configured department ID captured as an identity key |
| `sprint_id`, `sprint_name` | Canonical Jira sprint identity/display label |
| `scope_fingerprint` | SHA-256 of aggregate inputs; no raw configuration text |
| `payload_version`, `payload` | Versioned aggregate-only JSON |
| `generated_at`, `created_at`, `updated_at` | Timezone-aware cache audit timestamps |

Use a unique constraint on
`(workspace_id, auth_connection_id, group_id, sprint_id, scope_fingerprint)` and an index on
`(workspace_id, auth_connection_id, sprint_id)`. Every cache query repeats the workspace and auth
connection predicates even though foreign keys exist.

The fingerprint includes:

- aggregate schema version;
- group ID and normalized team IDs;
- workspace-wide excluded and Ad Hoc epic sets;
- the group's Ad Hoc additions;
- canonical base JQL and configured issue types;
- selected Product/Tech project classification;
- story-points, sprint, epic-link, and Team field IDs.

It excludes group display name, personal group visibility/favorite state, and browser focus. Renaming a
department therefore reuses the same numeric cache while the response uses the current shared name.

After a successful group configuration save, delete cache rows for removed group IDs and old
fingerprints. Fingerprint misses already guarantee correctness; cleanup prevents unbounded stale rows.
No failed save, conflict, validation error, or rollback deletes cache rows.

DB/OAuth mode requires the durable cache service. JSON/basic mode keeps the current non-durable source
behavior and never claims a DB cache hit. This preserves local development without inventing a shared
identity for Basic credentials.

## Concurrency And State Machine

| Event | Required behavior |
| --- | --- |
| Open Group mode | Set local focus to active dashboard group, render its placeholder first, start lookup only after shared config and sprint range are ready |
| Lookup cache hit | Merge immediately; do not enqueue complete closed-sprint cells |
| Focused miss | Request the focused group alone before any five-group batch |
| Other misses | Load sequential batches of at most five; append/merge stable rows after each response |
| Focus changes | Update emphasis immediately; if incomplete, move that group ahead of the queue without duplicating an in-flight request |
| Sprint range changes | Abort requests, increment generation, clear incompatible live fragments, repeat lookup |
| Shared config changes locally after save | Use new revision/fingerprint; old rows cannot match; retain no stale rendered aggregate |
| Remote config revision conflict | Discard the stale stats response, refresh shared config, preserve any Settings draft through existing conflict handling, restart stats only after canonical config settles |
| One group fails | Keep successful groups; mark only that group retryable; continue later batches |
| Every compute fails | Keep cache hits visible and show one scoped error summary |
| Application API returns `401` | Enter the existing terminal global auth lock; never show a raw feature-level `401` or replay the request |
| Leave Group mode/unmount | Abort the queue and ignore late responses |
| Refresh | Bypass matching cache cells, recompute focused group then batches of five, and replace closed-sprint rows only after a complete successful cell calculation |

## Planned File Boundaries

The later `EXEC-*` implementation plan should keep these responsibilities separate:

- Create `backend/services/excluded_capacity_group_stats.py`: pure aggregation, fingerprints, group
  scope construction, and aggregate payload shaping.
- Create `backend/services/group_sprint_stats_cache.py`: tenant/principal-scoped cache reads, upserts,
  pruning, and transaction boundaries.
- Modify `backend/db/models.py` and create the Alembic revision after `20260902_0013`: cache model,
  migration archive, reversible v1-to-v2 payload migration, SQLite/PostgreSQL metadata.
- Modify `backend/services/group_config.py` and `backend/services/shared_group_config.py`: v2
  normalization, shared/effective capacity helpers, validation, and post-commit cache cleanup.
- Modify `backend/routes/stats_routes.py`, `backend/security/policy.py`, and thin `jira_server.py`
  integration: endpoint registration, authenticated request context, Jira source adapter, and
  `Server-Timing`.
- Create `frontend/src/stats/useExcludedCapacityGroupStats.js`: cache lookup, selected-first queue,
  batch-of-five orchestration, abort/generation guards, merge, retry, and progress state.
- Modify `frontend/src/api/statsApi.js`: strict lookup/compute request builders.
- Modify `frontend/src/stats/excludedCapacityStats.js`: generic group aggregation adapters and stable
  group ordering; keep Team/Mono-vs-Cross functions compatible.
- Modify `frontend/src/stats/EffortTypeSplitChart.jsx`: accept generic row identity/label semantics
  rather than Team-only accessible names.
- Modify `frontend/src/stats/ExcludedCapacityLineChart.jsx`: deterministic group colors, focused-vs-
  dimmed presentation, and Group-correct reset/ARIA copy.
- Create `frontend/src/settings/SharedCapacitySettings.jsx`; modify
  `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/settings/groupConfigUtils.js`, and
  `frontend/src/dashboard.jsx`: shared Capacity settings, effective sets, inline global toggle, Group
  focus control, focused summary, and minimal orchestration wiring.
- Modify `frontend/src/styles/stats/excluded-capacity.css` and the existing settings CSS partials only
  for the new focus/loading/shared-capacity states.
- Update generated `frontend/dist/` only through `npm run build`.
- Update `docs/features/statistics.md`, relevant configuration/setup documentation, and
  `docs/README_ANALYTICS.md`.
- Add focused Python, Node, source-guard, migration, and Playwright tests described below. Ratchet
  `tests/test_codebase_structure_budgets.py` only for legitimate legacy entry-point wiring growth and
  record the reason beside the changed budget.

## Error Handling And Observability

- Add `Server-Timing` tokens for `config`, `db_cache_read`, `sprint_metadata`, `jira_search`,
  `aggregate`, `db_cache_write`, and `total`.
- Log workspace-safe counts, operation, batch size, hit/miss counts, and durations. Never log group
  names, Jira issue/epic keys, JQL, auth connection IDs, tokens, or raw Jira payloads.
- Return sanitized group-level warnings. Raw Jira response bodies remain server-side and redacted.
- Do not convert DB failures into Jira recomputation when durable cache correctness is required in
  DB/OAuth mode; return `500 stats_cache_unavailable` and keep already rendered browser data.
- Cap compute requests at five groups server-side even if a caller bypasses the frontend.
- Keep nextPageToken/isLast pagination and the existing issue cap warning semantics.

## Analytics Impact

Use existing canonical events; add no event name or transport:

- Group-focus changes emit `stats_action` with `stats_view=excluded_capacity`,
  `workflow_action=group_focus_change`, `scope_type=group`, and `source_surface=stats`.
- Initial focus, automatic batch progress, cache hits, and passive line/row rendering emit no product
  event.
- Browser-observed endpoint completion uses existing `api_result` with a new allowlisted
  `api_surface=excluded_capacity_groups` and standard status/duration/cache-state buckets.
- Shared-capacity Settings changes remain covered by `settings_action`; never send epic keys, group
  IDs/names, Team IDs/names, sprint IDs/names, JQL, or raw errors.
- Preserve the two-trigger `pageview`/`userevent` dataLayer contract and `GA4_ENABLED` transport gate.

Update analytics unit/source-guard coverage and `docs/README_ANALYTICS.md` taxonomy as part of
implementation.

## Verification Plan

### Configuration and migration

- Python tests prove v1 normalization unions department Excluded Capacity in stable order, starts
  shared Ad Hoc empty, preserves non-conflicting department Ad Hoc, removes cross-group collisions
  from Ad Hoc with a warning, and emits canonical v2.
- Tests reject shared-excluded overlap with shared or department effective Ad Hoc.
- DB migration tests cover upgrade, downgrade, rerun, exact archive restoration, data neutrality for
  unrelated ownership tables, SQLite execution, and PostgreSQL offline SQL.
- Two-user/same-workspace and two-workspace tests prove shared edit rights, isolation, revision conflict,
  and unrelated field preservation.
- JSON/basic tests prove read-time compatibility without implicit file writes.

### Cache and endpoint

- Service tests prove cache hits cross independent SQLAlchemy sessions/process facades for the same
  workspace/auth connection and do not cross workspace or auth-connection boundaries.
- Closed sprint results upsert and reuse DB rows; active/future sprint results never persist.
- Group/config/JQL/field/classification changes miss through the fingerprint.
- Removed groups are never returned and stale rows are pruned only after successful config commits.
- Lookup performs zero Jira calls.
- Compute derives groups from server-side shared config, rejects unknown IDs and batches over five,
  uses nextPageToken/isLast, and queries the union Team scope once per missing batch/range.
- A no-request-context unit reaches the real Jira auth wrapper to guard worker/helper propagation.
- Route/policy tests prove `authenticated_read`, requested-with enforcement, OAuth recovery, no Basic or
  service-credential fallback in DB/OAuth mode, and sanitized errors.
- `Server-Timing` is asserted for cache hit, mixed, and cold compute paths.

### Frontend calculations and orchestration

- Node tests use shared synthetic fixtures to prove Python/JavaScript classification parity.
- Queue tests with 12 groups prove request sizes `1, 5, 5, 1`, cached groups omitted from compute,
  focus promotion, deduplication, stable merge order, abort/generation guards, retry, and refresh.
- Utility tests prove active group first, config order thereafter, empty-group rows, effective shared +
  department Ad Hoc, and focused-group summary totals without cross-group double counting.
- Source guards prove Group mode does not load ENG alerts/task lists and Team/Mono-vs-Cross/Project
  Track keep their existing source paths.

### Browser and visual proof

- Playwright renders more than 11 configured departments and asserts cache-first display, selected
  active focus, Group dropdown behavior, normal-click legend focus, batch progress, per-group failure,
  retry, range reset, and mode-switch cancellation.
- Assert the titles **Excluded Capacity by Team and Sprint** and **Excluded Capacity by Group and
  Sprint** in their respective modes.
- Assert deterministic distinct group colors and readable hover bubbles at left/right chart edges.
- Assert desktop and compact layouts, dropdown layering, keyboard focus, accessible names, and no
  global active-group mutation when local Group focus changes.
- Capture settled before/after screenshots for Team mode, partially loaded Group mode, and fully loaded
  Group mode with active and alternate focus.

### Required final commands

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_group_config_service tests.test_shared_group_config_service tests.test_excluded_capacity_group_stats tests.test_group_sprint_stats_cache tests.test_excluded_capacity_group_stats_api tests.test_oauth_stats_routes tests.test_backend_route_source_guards tests.test_initiative_extraction tests.test_codebase_structure_budgets
node --test tests/test_group_config_utils.js tests/test_excluded_capacity_stats.js tests/test_excluded_capacity_group_loading.js tests/test_excluded_capacity_stats_source_guards.js tests/test_frontend_api_source_guards.js tests/test_analytics_events.js tests/test_analytics_source_guards.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js tests/ui/excluded_capacity_group_stats.spec.js
npm run build
python3 -m unittest discover -s tests
.venv/bin/python jira_server.py
curl http://localhost:5050/api/test
git diff --check
```

Before push, inspect screenshots, verify a clean build diff, inspect `git log --oneline -5`, and obtain
the repository-required explicit user confirmation.

## Acceptance Criteria

- Group mode shows every department from shared workspace configuration and no Team rows.
- The active dashboard department is selected, ordered first, and focused without changing global
  department preference/state.
- Cached completed-sprint fragments appear before live work finishes.
- A missing focused department loads alone; every later compute request contains no more than five
  departments; results append without clearing earlier rows.
- The lower Group-mode title and chart show one deterministic-color line per configured department.
- Summary cards describe only the focused department and cannot double count overlapping departments.
- Workspace-wide Excluded Capacity is the union of legacy department lists and is used everywhere.
- Shared Ad Hoc starts empty after migration; existing department Ad Hoc lists remain additive.
- Any authenticated workspace user can edit Shared Capacity with revision-conflict protection.
- Closed-sprint aggregate cache rows are reusable across application processes sharing the DB, but not
  across workspaces or Jira principals. Active/future results are never durable.
- No raw Jira issue data, group names, credentials, or JQL is persisted in the aggregate cache or sent
  to analytics.
- Team mode, Mono vs Cross, Project Track, Planning capacity, Scenario semantics, global auth recovery,
  Settings combined-save behavior, and initial dashboard request count do not regress.

## Forbidden Regressions

- Do not move Shared Capacity into administrator-only configuration.
- Do not use personal visible/favorite group preferences to filter Group-mode departments.
- Do not reintroduce department-level Excluded Capacity.
- Do not promote legacy department Ad Hoc entries to shared Ad Hoc during migration.
- Do not persist active/future sprint aggregates or raw Jira rows.
- Do not share cache entries between different Jira auth connections.
- Do not start all-group work during dashboard bootstrap or in other Statistics views.
- Do not issue one backend request per remaining department; enforce the five-group batch contract.
- Do not hand-edit `frontend/dist/`.

## From Design To Execution

After product/engineering review, resolve requested changes in this document, then create a separate
`EXEC-excluded-capacity-group-statistics.md` with test-first, bite-sized tasks and exact code snippets.
The `EXEC-*` plan must re-read the current source, verify every named file exists unless marked
`Create`, and use this design as the approved behavior contract rather than executing this support
document directly.
