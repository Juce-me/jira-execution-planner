# Statistics Consistency Bugfix Design

> **Status:** Approved design reference. This document defines the intended behavior; a separate `EXEC-*` plan will provide task-level implementation steps after written-spec review.

## Goal

Fix three Statistics regressions without changing unrelated reporting behavior:

1. Priority and Mono vs Cross team series use the same colors as Burndown.
2. Excluded Capacity no longer renders the oversized `Range` summary card.
3. Lead Times is scoped by explicit Start Sprint and End Sprint selectors instead of a Start Quarter selector with an implicit current-quarter end.

## Root Causes

### Team colors

`frontend/src/stats/statsConstants.js` owns the shared `RADAR_PALETTE`, but color assignment is not shared. `resolveTeamColor` hashes a team id for Priority and Mono vs Cross, while `buildBurnoutChartModel` sorts teams by display name and assigns palette entries by index. Hashing can collide and gives the same team a different color from Burndown.

### Excluded Capacity range card

The Excluded Capacity summary renders a `Range` `stats-card` even though Start Sprint and End Sprint already display the active range. The card repeats control state and consumes one full summary-grid position.

### Lead Times range

Lead Times stores `cohortStartQuarter`, sends `startQuarter` to `/api/stats/epic-cohort`, and lets the backend derive the end as the current quarter. The quarter value therefore controls data retrieval, response range, and heatmap presentation at once. There is no user-selectable end boundary.

## Design

### One team-color source of truth

Move Burndown's current rule into a shared Statistics utility: normalize team descriptors, sort them by display name, and assign `RADAR_PALETTE` entries by sorted index. The utility will return a color map keyed by the canonical team id, with a normalized-name fallback only for records that genuinely lack an id.

Build the shared map from the active Statistics team universe so Burndown, Priority, and Mono vs Cross receive the same mapping even when one chart has no data for a team. Burndown must consume the shared mapping rather than assigning colors internally. Priority and `ExcludedCapacityLineChart` must resolve their series through that same map. Teams beyond the palette length may cycle; teams within the palette length must not collide.

The palette remains in `statsConstants.js`. No new palette or CSS color list is introduced.

### Remove the redundant Excluded Capacity card

Delete only the Excluded Capacity `Range` card. Keep the existing Start Sprint and End Sprint controls, sprint-range data model, loading state, and the remaining Excluded Share, Ad Hoc Share, Product total, and Tech Share cards unchanged. Mono vs Cross and Project Track summary cards are outside this removal unless separately requested.

### Sprint-scoped Lead Times

Replace `cohortStartQuarter` with persisted `cohortStartSprintId` and `cohortEndSprintId` state. Reuse the ordered sprint options and compact Start Sprint / End Sprint selector pattern already used by the range-based Statistics views.

The selected sprint records provide `startDate` and `endDate`. Lead Times derives an inclusive ISO date range as follows:

- `startDate`: selected Start Sprint `startDate`.
- `endDate`: selected End Sprint `endDate`.
- A selection is valid only when both sprint records and both dates exist and `startDate <= endDate`.

The frontend sends `startDate` and `endDate` to `POST /api/stats/epic-cohort`. The backend validates both ISO dates, rejects missing, malformed, or inverted ranges with `400`, includes both values in the cache key, and scopes Jira Epics with inclusive created-date bounds. The response `data.range` echoes the selected boundaries.

The heatmap continues to offer `Group By: Quarter` and `Group By: Month`. Those controls only regroup the returned dates; they no longer determine the fetch range.

Existing project, assignee, capacity, excluded-capacity, and status filters remain client-side filters over the one scoped cohort response. Changing either sprint boundary triggers one new scoped request; changing only a client-side filter or heatmap grouping does not refetch.

Saved legacy `cohortStartQuarter` preferences are ignored. The initial Lead Times range defaults to the current selected sprint when valid, otherwise the latest valid sprint in the ordered options. No compatibility request using `startQuarter` remains after the migration.

## API Contract

`POST /api/stats/epic-cohort` request fields affected by this bugfix:

```json
{
  "startDate": "2026-04-01",
  "endDate": "2026-06-30",
  "teamIds": ["team-alpha"],
  "components": [],
  "adHocCapacityEpics": ["SYN-100"],
  "refresh": false
}
```

Success remains `200` with the existing envelope. `data.range.startDate` and `data.range.endDate` equal the validated request range. Validation failures return `400` with a stable `error` message and do not call Jira.

The route remains an authenticated read with the existing `X-Requested-With` requirement. This bugfix does not change auth, CSRF, workspace scope, credential resolution, pagination, or Home/Townsquare behavior.

## Verification

- Unit tests prove the shared team-color map is deterministic, alphabetical, collision-free within the palette, and reused by Burndown, Priority, and Mono vs Cross.
- Source/component tests prove Burndown no longer assigns a private palette and the Excluded Capacity `Range` card is absent while the other summary cards remain.
- Backend tests prove valid date forwarding, inclusive JQL bounds, cache-key separation by both dates, and `400` responses for missing, malformed, and inverted ranges before Jira access.
- Frontend tests prove both sprint selectors render, persist, constrain the request, prevent inverted ranges, and leave Quarter/Month as grouping-only controls.
- Playwright verifies the three charts show matching team colors, the Excluded Capacity summary compacts after card removal, and changing Lead Times End Sprint changes the request and visible range.
- Run `npm run build` and include generated `frontend/dist/` changes during implementation.

## Analytics Impact

No new analytics event is required. These are corrective changes to existing Statistics controls and rendering, not new user workflows. Existing Statistics interaction events remain the allowlisted instrumentation; the implementation plan must confirm no canonical event taxonomy or GA4 runbook change is needed.

## Forbidden Regressions

- Do not change Burndown calculations, series order, hover behavior, or metric selection.
- Do not add per-chart palettes or one-off color overrides.
- Do not remove the Excluded Capacity sprint controls or change its calculations.
- Do not refetch Lead Times when only grouping or client-side filters change.
- Do not replace Jira `nextPageToken` / `isLast` pagination.
- Do not introduce Jira/Home mutations, new credentials, or startup requests.
