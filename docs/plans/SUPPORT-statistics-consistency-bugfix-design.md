# Statistics Consistency Bugfix Design

> **Status:** Approved design reference. This document defines the intended behavior; a separate `EXEC-*` plan will provide task-level implementation steps after written-spec review.

## Goal

Fix three Statistics regressions without changing unrelated reporting behavior:

1. Priority and Mono vs Cross team series use the same colors as Burndown.
2. Excluded Capacity no longer renders the oversized `Range` summary card.
3. Lead Times is scoped by explicit Start Quarter and End Quarter selectors instead of a Start Quarter selector with an implicit current-quarter end.

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

Build the shared map from the complete active group definition: `activeGroupTeamIds` supplies stable ids and the shared team catalog resolves their display names. Sort that full group list by display name and assign the Burndown palette once. Do not rebuild the map from the selected sprint, selected team filter, or an individual chart's visible series. A sprint or report range controls whether a series renders, not which color represents its team.

Burndown, Priority, and Mono vs Cross consume the same `teamId -> color` map. A chart-only team id that is not in the active group uses the existing deterministic shared resolver fallback rather than a private palette. Teams beyond the palette length may cycle; teams within the active group palette length must not collide.

Because the map is derived from shared group membership and the shared catalog, every user of the same group sees the same colors. Colors remain stable while group membership and names are unchanged. Adding, deleting, or renaming a group team may reassign later alphabetical palette positions; persistent colors across group edits are deferred and require stored `teamId -> color` assignments.

The palette remains in `statsConstants.js`. No new palette or CSS color list is introduced.

### Remove the redundant Excluded Capacity card

Delete only the Excluded Capacity `Range` card. Keep the existing Start Sprint and End Sprint controls, sprint-range data model, loading state, and the remaining Excluded Share, Ad Hoc Share, Product total, and Tech Share cards unchanged. Mono vs Cross and Project Track summary cards are outside this removal unless separately requested.

### Quarter-scoped Lead Times

Keep persisted `cohortStartQuarter` and add persisted `cohortEndQuarter`. Both controls use the existing quarter option builder, ending at the current quarter; future quarters are not selectable. Existing saved Start Quarter preferences remain valid, and a missing End Quarter defaults to the current quarter.

The backend derives dates from the selected quarter labels. The range filters Epic creation cohorts, not terminal dates:

- `startDate`: first calendar day of Start Quarter.
- Historical `endDate`: last calendar day of End Quarter.
- Current-quarter `endDate`: today, so the month-grouped heatmap does not create empty future months.
- Jira uses a half-open timestamp interval: `created >= startDate AND created < dayAfter(endDate)`. The UI still presents End Quarter as inclusive.

The frontend sends `startQuarter` and `endQuarter` to `POST /api/stats/epic-cohort`. The backend validates both quarter labels, rejects missing, malformed, future-end, or inverted ranges with `400`, includes both labels in the cache key, and returns the derived `startDate` and effective `endDate` in `data.range`.

Changing Start Quarter to a value later than End Quarter also moves End Quarter to the new Start Quarter. Changing End Quarter to a value earlier than Start Quarter also moves Start Quarter to the new End Quarter. The last control the user changed therefore wins; the frontend never silently swaps the requested range, while backend validation remains defense in depth.

The heatmap continues to offer `Group By: Quarter` and `Group By: Month`. Those controls only regroup the returned dates; they no longer determine the fetch range.

Existing project, assignee, capacity, excluded-capacity, and status filters remain client-side filters over the one scoped cohort response. Changing either quarter boundary triggers one new scoped request; changing only a client-side filter or heatmap grouping does not refetch.

An Epic created within the selected cohort range remains eligible when its terminal date is later than End Quarter; otherwise its actual lead time would be truncated. Open Epic age continues through today. The selected end boundary limits cohort creation rows, not elapsed lead-time columns.

## API Contract

`POST /api/stats/epic-cohort` request fields affected by this bugfix:

```json
{
  "startQuarter": "2026Q1",
  "endQuarter": "2026Q2",
  "teamIds": ["team-alpha"],
  "components": [],
  "adHocCapacityEpics": ["SYN-100"],
  "refresh": false
}
```

Success remains `200` with the existing envelope. `data.range.startDate` is the first day of Start Quarter; `data.range.endDate` is the last day of a historical End Quarter or today for the current quarter. Validation failures return `400` with a stable `error` message and do not call Jira.

The route remains an authenticated read with the existing `X-Requested-With` requirement. This bugfix does not change auth, CSRF, workspace scope, credential resolution, pagination, or Home/Townsquare behavior.

## Verification

- Unit tests prove the shared team-color map is deterministic, alphabetical, collision-free within the palette, and reused by Burndown, Priority, and Mono vs Cross.
- Source/component tests prove Burndown no longer assigns a private palette and the Excluded Capacity `Range` card is absent while the other summary cards remain.
- Backend tests prove valid quarter forwarding, half-open inclusive JQL bounds, current-quarter capping, cache-key separation by both quarter labels, preservation of later terminal dates, and `400` responses for missing, malformed, future, and inverted ranges before Jira access.
- Frontend tests prove both quarter selectors render, persist, constrain the request, reconcile inverted changes with last-control-wins behavior, and leave Quarter/Month as grouping-only controls.
- Playwright verifies the three charts show matching team colors, the Excluded Capacity summary compacts after card removal, and changing Lead Times End Quarter changes the request and visible cohort range.
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
