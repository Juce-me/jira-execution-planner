# Epic Lead Time Cohort Chart — Design (v3)

## Overview
A full-screen analytics panel (like Scenario/Statistics) showing epic lead-time throughput in a cohort grid:
- Rows: cohort by epic creation period (quarter or month)
- Columns: elapsed periods (`Q+N` or `M+N`)
- Cells: resolved epic count (heatmap intensity)
- Summary cards: totals by status
- Open epics chart: horizontal bars sorted by age

The panel is optimized for fast interaction after first load: regrouping and filters happen client-side without extra Jira requests.

## Key Decisions
| Decision | Choice |
|---|---|
| Endpoint | `POST /api/stats/epic-cohort` |
| Jira pagination | `nextPageToken` + `isLast` only (no `startAt/total`) |
| Fetch strategy | One scoped backend fetch, then client-side regroup/filter |
| Refetch triggers | Only scope changes: `startQuarter`, `teamIds`, explicit refresh |
| Grouping toggle | Quarter/Month regrouped in UI (no API refetch) |
| Status filters | Done + In Progress default; Killed/Incomplete/Postponed optional |
| Postponed semantics | `status == "Postponed"`; not treated as In Progress |
| Performance guard | bounded changelog enrichment + caching + timeout budget |

## API Contract
### Request
```json
{
  "startQuarter": "2025Q1",
  "teamIds": ["team-id-1", "team-id-2"],
  "refresh": false
}
```

### Notes
- `startQuarter` is required.
- `teamIds` is optional; empty means all teams in current dashboard scope.
- `refresh=true` bypasses backend/session cache.
- `groupBy`, project filter, assignee filter, and status toggles are UI-only and do not belong to request payload.

### Response
```json
{
  "generatedAt": "2026-03-04T12:30:00",
  "data": {
    "range": {
      "startDate": "2025-01-01",
      "endDate": "2026-03-31"
    },
    "issues": [
      {
        "key": "PRODUCT-12345",
        "summary": "Epic summary",
        "projectKey": "PRODUCT",
        "team": { "id": "team-id-1", "name": "R&D Distribution" },
        "assignee": { "id": "abc", "name": "User Name" },
        "createdDate": "2025-02-10",
        "terminalDate": "2025-05-21",
        "status": "Done",
        "leadTimeDays": 100,
        "terminalDateSource": "resolutiondate"
      }
    ],
    "meta": {
      "truncated": false,
      "warnings": [],
      "paginationMode": "nextPageToken/isLast"
    }
  }
}
```

Status values:
- `Done`
- `Killed`
- `Incomplete`
- `Postponed`
- `open` (non-terminal)

## Backend Data Strategy
### Phase 1: Base epic fetch (mandatory)
- JQL scoped by `startQuarter`, selected team scope, configured projects.
- Uses Jira pagination contract: `nextPageToken` + `isLast`.
- Required fields only: `created`, `status`, `resolutiondate`, `summary`, `assignee`, `project`, team field.

### Phase 2: Targeted enrichment (bounded)
Only for terminal statuses missing terminal date:
- `Done`, `Killed`, `Incomplete`, `Postponed`
- Changelog lookup bounded by:
  - max parallel workers: 4
  - max enrichment targets per request: 200
  - per-request enrichment timeout budget: 10s
- Items not enriched within budget remain with `terminalDate = null` and warning metadata.

### Lead-time rules
- `Done/Killed/Incomplete/Postponed`: `leadTimeDays = terminalDate - createdDate` when terminal date exists
- `open`: `leadTimeDays = today - createdDate`
- Terminal statuses without terminal date:
  - included in status counters
  - excluded from elapsed-period cell placement until terminal date known

## Frontend Behavior
## Grouping (Quarter/Month)
- Done entirely in UI from `createdDate` + `terminalDate`.
- Switching group mode recalculates grid and cards client-side.
- No network request for group change.

## Filters
- Client-side filters:
  - project
  - assignee
  - status toggles (`Killed`, `Incomplete`, `Postponed`)
- Toggle defaults:
  - ON by default: `Done`, `In Progress`
  - OFF by default: `Killed`, `Incomplete`, `Postponed`

## Postponed semantics
- `Postponed` is a first-class status (`status == "Postponed"`).
- It is never counted as `open`.
- Included only when Postponed toggle is enabled.

## Performance + Safety Constraints
- Expected load scope: up to ~398 epics for 2 years.
- Backend cache key: `startQuarter + teamScope + configuredProjectsVersion`.
- Cache TTL target: session/local (or 5 min server cache, configurable).
- Single backend request per scope load; no request storms on UI toggles.
- Response includes `meta.warnings` for partial enrichment/truncation.
- If epic count exceeds safe limit, return partial result with explicit warning instead of uncontrolled fan-out.

## UI Layout
- Top controls: Start Quarter, Team scope badge, Group By (Quarter/Month), Project filter, Assignee filter, status toggles.
- Summary cards: Total, Done, Killed, Incomplete, Postponed, In Progress.
- Cohort grid with heatmap counts and row selection drill-down.
- Open epics horizontal bar chart scoped by selected row.

## Verification Checklist
1. API returns data using `nextPageToken/isLast` flow (no `startAt/total`).
2. GroupBy switch recalculates UI instantly with zero network calls.
3. Project/assignee/status toggles update UI without refetch.
4. Postponed status is not included in open counts.
5. Large scope (near 398 epics) stays within enrichment/time budgets and surfaces warnings when partial.
6. Drill-down row selection updates cards and open-epics chart correctly.
