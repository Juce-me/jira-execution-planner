# Epic Lead Time Cohort Chart — Design

## Overview

A full-screen panel (like Scenario Planner) showing a cohort grid of epic delivery lead times. Rows are cohorts grouped by epic creation period (quarter or month). Columns are elapsed time periods since creation. Cells show average lead time in days with heatmap coloring. Open (unfinished) epics appear at the cohort frontier.

Inspired by [Observable's user retention chart](https://observablehq.com/@observablehq/user-retention), adapted for delivery lead time instead of retention percentage.

## Decisions

| Decision | Choice |
|----------|--------|
| Panel type | Full-screen top-level toggle (like Scenario), not a Statistics tab |
| Data source | Dedicated `POST /api/stats/epic-cohort` endpoint |
| Backend pattern | 2-phase fetch following burnout API pattern |
| Cell content | Average days + heatmap color (green → yellow → red) |
| Killed epics | Excluded entirely |
| Postponed epics | Excluded by default, toggle to include |
| Cohort granularity | Quarter or month (user toggle) |

---

## 1. API: `POST /api/stats/epic-cohort`

### Request

```json
{
  "startQuarter": "2025Q1",
  "groupBy": "quarter",
  "teamIds": [],
  "includePostponed": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `startQuarter` | string | Earliest cohort period (format: `YYYYQN`). Cohorts span from this quarter to now. |
| `groupBy` | `"quarter"` \| `"month"` | Cohort and elapsed-time granularity. |
| `teamIds` | string[] | Optional team filter. Empty = all teams. |
| `includePostponed` | boolean | Whether to include Incomplete/postponed epics in averages. |

### Backend Logic

**Phase 1 — Base fields (fast):**
```
JQL: issuetype = Epic
     AND project IN ({configured_projects})
     AND created >= "{startQuarter start date}"
     AND status != Killed

Fields: created, duedate, status, resolutiondate, summary, {team_field}
```

**Phase 2 — Changelog for Done epics missing `resolutiondate`:**
- For each Done epic where `resolutiondate` is null, fetch changelog
- Find first `status → Done` transition date using `extract_burnout_events_from_issue` pattern
- Use that date as the delivery date

**Lead time calculation:**
- `leadTimeDays = (doneDate - createdDate).days`
- If epic is not Done: `leadTimeDays = null`, `status = "open"`

**Postponed detection:**
- Epic has status `Incomplete` or was moved from one sprint to a later sprint
- When `includePostponed = false`, these epics are excluded from cell averages but counted in the open-epic frontier

### Response

```json
{
  "data": {
    "groupBy": "quarter",
    "cohorts": [
      {
        "label": "2025Q1",
        "startDate": "2025-01-01",
        "endDate": "2025-03-31",
        "epicCount": 12,
        "epics": [
          {
            "key": "PROD-100",
            "summary": "User onboarding flow",
            "team": { "id": "T1", "name": "Team Alpha" },
            "createdDate": "2025-01-15",
            "doneDate": "2025-06-20",
            "leadTimeDays": 156,
            "status": "Done",
            "isPostponed": false
          }
        ]
      }
    ],
    "periods": ["Q+0", "Q+1", "Q+2", "Q+3", "Q+4", "Q+5"],
    "range": {
      "startDate": "2025-01-01",
      "endDate": "2026-03-31"
    }
  }
}
```

---

## 2. Cohort Grid Visualization

### Grid Structure

```
                    Q+0     Q+1     Q+2     Q+3     Q+4     Q+5
              ┌─────────────────────────────────────────────────────
  2025Q1 (12) │  14d     28d     45d     62d     --      --
  2025Q2 (8)  │  10d     32d     51d     --      --
  2025Q3 (15) │  18d     25d     ◊ 3 open
  2025Q4 (6)  │  12d     ◊ 4 open
  2026Q1 (9)  │  ◊ 7 open
```

### Reading the Grid

- **Rows** = cohorts: epics grouped by creation period. Epic count in parentheses.
- **Columns** = elapsed time since cohort start. Q+0 = delivered within the creation quarter; Q+1 = next quarter; etc.
- **Cells** = average lead time (days) for epics from that cohort completed during that period. Background color encodes speed (heatmap).
- **Open-epic cells** (◊) = rightmost cell per row showing count of still-open epics from that cohort. These "hang" at the frontier — not yet delivered.
- **Empty cells** (--) = no epics from that cohort were completed in that period.

### Month Mode

Same layout but rows are months (`2025-01`, `2025-02`, ...) and columns are `M+0`, `M+1`, etc. Cells are narrower; horizontal scroll if needed.

### Heatmap Scale

- Computed dynamically from P25/P75 of all cell values in the current view
- Green (fast): ≤ P25
- Yellow (moderate): P25–P75
- Red (slow): ≥ P75
- Open-epic cells: neutral background (no heatmap), diamond marker (◊)

### Hover Tooltip

Hovering a cell shows:
- List of epics in that cell (key, summary, exact lead time in days)
- Team breakdown if multiple teams contribute to the cell

---

## 3. Panel Layout

Full-bleed panel following the Scenario Planner pattern.

### Access

New top-level toggle button in the header bar: `Catch Up | Planning | Statistics | Scenario | Lead Times`

### Panel Structure

```
┌──────────────────────────────────────────────────────────────────┐
│ Epic Lead Times                                          [Beta] │
│                                                                  │
│ [Quarter ▾ Month]   Start: [2025Q1 ▾]   [Include Postponed]    │
│ Team: [All Teams ▾]                                              │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │              Q+0    Q+1    Q+2    Q+3    Q+4    Q+5         │ │
│ │ 2025Q1 (12)  14d    28d    45d    62d    --     --          │ │
│ │ 2025Q2 (8)   10d    32d    51d    --     --                 │ │
│ │ 2025Q3 (15)  18d    25d    ◊3                               │ │
│ │ 2025Q4 (6)   12d    ◊4                                      │ │
│ │ 2026Q1 (9)   ◊7                                             │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Summary: Avg lead time 38d │ Median 32d │ Open: 14 epics        │
│ Heatmap: ██ ≤20d  ██ 20-60d  ██ ≥60d                           │
└──────────────────────────────────────────────────────────────────┘
```

### Controls

| Control | Behavior |
|---------|----------|
| Quarter / Month toggle | Switches cohort granularity; re-groups data client-side |
| Start quarter selector | Sets the earliest cohort row; triggers API refetch |
| Include Postponed toggle | Off by default; toggles postponed epics in/out of averages |
| Team filter dropdown | Reuses existing team dropdown component; filters by team |

### Panel Lifecycle

- Starts collapsed; opens on toggle click
- Data fetched on open (with loading spinner)
- Unloads data when closed (same pattern as Scenario)
- Client-side cache per query key (start quarter + groupBy + teams + includePostponed)

---

## 4. Summary Bar

Below the grid, a summary row shows aggregate metrics:
- **Avg lead time**: mean across all completed epics in view
- **Median lead time**: P50 across all completed epics
- **Open epics**: total count of unfinished epics across all cohorts
- **Heatmap legend**: color scale with threshold values

---

## 5. Data Flow

```
User opens Lead Times panel
  → fetchEpicCohort(startQuarter, groupBy, teamIds, includePostponed)
  → POST /api/stats/epic-cohort
  → Backend: JQL fetch → changelog enrichment → group into cohorts
  → Response: cohorts[] with epics[]
  → Frontend memo: build cohort grid model (rows, cells, heatmap thresholds)
  → Render: CohortGrid component with hover tooltips
  → User changes groupBy (quarter↔month): re-compute grid client-side (no refetch)
  → User changes start quarter or team filter: refetch from API
```

---

## 6. File Structure (Proposed)

```
frontend/src/
├── dashboard.jsx              # State, fetch effect, panel toggle
├── cohort/                    # New module
│   ├── cohortUtils.js         # Pure functions: groupIntoCohorts, buildCohortGrid,
│   │                          #   computeHeatmapThresholds, computeSummary
│   └── CohortGrid.jsx        # Presentational: grid table, cells, hover tooltip
│
jira_server.py                 # New endpoint: /api/stats/epic-cohort
tests/
└── test_epic_cohort_api.py    # Backend tests for the new endpoint
```

Follows the `scenario/` and planned `statistics/` extraction pattern: pure functions in `*Utils.js`, thin presentational component in `*.jsx`, all state in `dashboard.jsx`.
