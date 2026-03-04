# Epic Lead Time Cohort Chart — Design (v2)

## Overview

A full-screen panel (like Scenario Planner) showing epic delivery lead times through a retention-style cohort grid. Rows are cohorts grouped by epic creation period (quarter or month). Columns are elapsed time periods. Cells show **epic count** with heatmap coloring. Summary cards break down totals by status. A horizontal bar chart visualizes in-progress epics sorted by age.

Inspired by [Observable's user retention chart](https://observablehq.com/@observablehq/user-retention), adapted for delivery throughput rather than retention percentage.

## Decisions

| Decision | Choice |
|----------|--------|
| Panel type | Full-screen top-level toggle (like Scenario) |
| Data source | Dedicated `POST /api/stats/epic-cohort` endpoint |
| Backend pattern | 2-phase fetch following burnout API pattern |
| Cell content | **Epic count** + heatmap color (intensity by count) |
| Status filters | Three toggles (Killed / Incomplete / Postponed) — all OFF by default. Only Done + In Progress shown initially. |
| Cohort granularity | Quarter or month (user toggle) |
| Segmentation | By Jira project and epic assignee |
| Drill-down | Click a cohort row to filter summary cards + open-epics chart |
| Open-epics chart | Horizontal bar chart sorted longest-first |

---

## 1. API: `POST /api/stats/epic-cohort`

### Request

```json
{
  "startQuarter": "2025Q1",
  "groupBy": "quarter",
  "teamIds": [],
  "projectKeys": [],
  "assignee": ""
}
```

| Field | Type | Description |
|-------|------|-------------|
| `startQuarter` | string | Earliest cohort period (format: `YYYYQN`). Cohorts span from this quarter to now. |
| `groupBy` | `"quarter"` \| `"month"` | Cohort and elapsed-time granularity. |
| `teamIds` | string[] | Optional team filter. Empty = all teams. |
| `projectKeys` | string[] | Optional project filter. Empty = all projects. |
| `assignee` | string | Optional assignee account ID filter. Empty = all. |

### Backend Logic

**Phase 1 — Base fields (fast):**
```
JQL: issuetype = Epic
     AND project IN ({configured_projects or projectKeys filter})
     AND created >= "{startQuarter start date}"

Fields: created, duedate, status, resolutiondate, summary, assignee, {team_field}, project
```

The backend fetches ALL epics (including Killed/Incomplete) and tags each with its status. Filtering by status is done client-side via the three toggles, so the user can toggle without re-fetching.

**Phase 2 — Changelog for Done epics missing `resolutiondate`:**
- For each Done epic where `resolutiondate` is null, fetch changelog
- Find first `status → Done` transition date
- For Killed/Incomplete epics missing resolution: same changelog lookup for their terminal transition date

**Lead time calculation:**
- Done: `leadTimeDays = (doneDate - createdDate).days`
- Killed: `leadTimeDays = (killedDate - createdDate).days`
- Incomplete: `leadTimeDays = (incompleteDate - createdDate).days`
- In Progress (open): `leadTimeDays = (today - createdDate).days`, `status = "open"`

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
            "project": "PROD",
            "team": { "id": "T1", "name": "Team Alpha" },
            "assignee": { "id": "alice-id", "name": "Alice" },
            "createdDate": "2025-01-15",
            "resolvedDate": "2025-06-20",
            "leadTimeDays": 156,
            "status": "Done"
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

Status values: `"Done"`, `"Killed"`, `"Incomplete"`, `"open"`.

---

## 2. Panel Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Epic Lead Times                                              [Beta] │
│                                                                      │
│ [Quarter ▾ Month]  Start: [2025Q1 ▾]                               │
│ Project: [All ▾]   Assignee: [All ▾]                                │
│ [Killed] [Incomplete] [Postponed]         ← toggles, all OFF        │
│                                                                      │
│ ┌─ Summary Cards ──────────────────────────────────────────────────┐ │
│ │  Total    │  Done      │  Killed  │  Incomplete │  In Progress   │ │
│ │  52       │  31        │  4       │  3          │  14            │ │
│ │           │  avg 38d   │  avg 12d │  avg 45d    │  avg 142d      │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─ Cohort Grid ───────────────────────────────────────────────────┐  │
│ │              Q+0    Q+1    Q+2    Q+3    Q+4    Open            │  │
│ │ 2025Q1 (12)   3      4      2      1      --     2             │  │
│ │ 2025Q2 (8)    2      3      1      --     --     2             │  │
│ │ 2025Q3 (15)   5      3      --     --     --     7  ← selected │  │
│ │ 2025Q4 (6)    1      --     --     --     --     5             │  │
│ │ 2026Q1 (9)    --     --     --     --     --     9             │  │
│ └─────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ ┌─ In-Progress Epics (2025Q3 cohort: 7 open) ────────────────────┐  │
│ │ PROD-100  ████████████████████████████  312d  @Alice            │  │
│ │ PROD-205  ██████████████████████         245d  @Bob             │  │
│ │ TECH-88   ████████████████               198d  @Charlie         │  │
│ │ PROD-310  ██████████                     142d  @Alice           │  │
│ │ TECH-120  ████████                       118d  @Dave            │  │
│ │ PROD-415  ██████                          87d  @Bob             │  │
│ │ TECH-200  ████                            52d  @Eve             │  │
│ └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Cohort Grid

### Grid Structure

- **Rows** = cohorts: epics grouped by creation period. Epic count in parentheses.
- **Columns** = elapsed time since cohort start. Q+0 = resolved within the creation quarter; Q+1 = next quarter; etc.
- **Cells** = number of epics from that cohort resolved during that elapsed period. Heatmap color encodes count intensity (higher = darker/more saturated).
- **Open column** = count of still-open (in-progress) epics per cohort.
- **Empty cells** (--) = no epics resolved in that period.
- **Row click** = selects cohort, filters summary cards and open-epics chart to that cohort. Click again to deselect.

### Month Mode

Same layout but rows are months (`2025-01`, `2025-02`, ...) and columns are `M+0`, `M+1`, etc.

### Heatmap Scale

- Computed dynamically from all cell counts in the current view
- Lighter = fewer epics, darker/more saturated = more epics
- Color palette: blue-based intensity (not red/green, since this is count not good/bad)
- Open column: amber/gold color (distinct from resolved cells)

### Hover Tooltip

Hovering a cell shows:
- Breakdown by status: Done: N, Killed: N, Incomplete: N (if those toggles are on)
- List of epics: key, summary, lead time, assignee
- Grouped by project if multiple projects contribute

---

## 4. Summary Cards

Five cards across the top:

| Card | Content |
|------|---------|
| **Total** | Total epic count (in current scope) |
| **Done** | Count + average lead time in days |
| **Killed** | Count + average lead time (hidden when toggle off) |
| **Incomplete** | Count + average lead time (hidden when toggle off) |
| **In Progress** | Count + average days open so far |

Cards update when:
- A cohort row is clicked (filter to that cohort)
- Status toggles change
- Project/assignee filters change

---

## 5. In-Progress Epics Chart

Horizontal bar chart below the cohort grid:

- One bar per open epic, sorted **longest-first** (most days open at top)
- Bar length proportional to days open
- Bar color by project (reuse `resolveTeamColor` or project-based palette)
- Label: epic key, days open, assignee name
- Hover: full epic summary, team, creation date
- Scope: all open epics by default; filtered to selected cohort row when clicked

---

## 6. Controls

| Control | Behavior |
|---------|----------|
| Quarter / Month toggle | Switches cohort granularity; re-groups data client-side (no refetch) |
| Start quarter selector | Sets earliest cohort row; triggers API refetch |
| Project filter | Dropdown of configured projects; client-side filter (no refetch) |
| Assignee filter | Dropdown built from epic assignees in response; client-side filter |
| Killed toggle | OFF by default. When ON, includes Killed epics in grid/cards. Client-side filter. |
| Incomplete toggle | OFF by default. When ON, includes Incomplete epics. Client-side. |
| Postponed toggle | OFF by default. When ON, includes Postponed (status=Incomplete with sprint change). Client-side. |

**Client-side vs server-side:** Backend always returns all epics (except optionally filtered by project/assignee at JQL level). Status toggles, project, and assignee filters are all applied client-side for instant interaction.

---

## 7. Data Flow

```
User opens Lead Times panel
  → fetchEpicCohort(startQuarter, groupBy, teamIds)
  → POST /api/stats/epic-cohort
  → Backend: JQL fetch → changelog enrichment → group into cohorts
  → Response: cohorts[] with all epics[] (Done + Killed + Incomplete + open)
  → Frontend state: cohortData
  → Client-side filtering: project, assignee, status toggles
  → Frontend memo: buildCohortGridModel(filteredData)
  → Render: summary cards, cohort grid, open-epics bar chart
  → User clicks cohort row: selectedCohort state → filters cards + bar chart
  → User changes groupBy: re-compute grid client-side (no refetch)
  → User changes start quarter: refetch from API
```

---

## 8. Interaction Details

### Hover behavior (like burnout chart)
- Grid cells: highlight row + column on hover (crosshair effect)
- Bar chart bars: highlight bar, show tooltip with full epic details
- Summary cards: subtle hover lift effect

### Drill-down
- Click a cohort row label → row gets "selected" styling (brighter border/background)
- Summary cards update to show only that cohort's numbers
- Bar chart filters to only that cohort's open epics
- Click again (or click another row) to deselect

### Transitions
- Grid cells and bar chart bars animate on filter changes (opacity fade)
- Summary card numbers animate (count-up effect like burnout cards)

---

## 9. File Structure

```
frontend/src/
├── dashboard.jsx              # State, fetch effect, panel toggle
├── cohort/                    # New module
│   ├── cohortUtils.js         # Pure functions: buildCohortGridModel,
│   │                          #   filterEpicsByStatus, computeSummaryCards,
│   │                          #   buildOpenEpicsBars, computeHeatmapScale
│   ├── CohortGrid.jsx         # Grid table + hover tooltip
│   └── OpenEpicsChart.jsx     # Horizontal bar chart for in-progress epics
│
jira_server.py                 # New endpoint: /api/stats/epic-cohort
tests/
└── test_epic_cohort_api.py    # Backend tests
```
