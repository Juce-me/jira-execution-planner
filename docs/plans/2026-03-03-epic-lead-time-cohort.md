# Epic Lead Time Cohort Chart — Implementation Plan (v3)

## Goal
Implement a full-screen **Lead Times** panel for epics with:
- cohort heatmap grid (count-based)
- summary cards by status
- open-epics bar chart
- fast client-side regroup/filter behavior

This v3 plan aligns with project rules:
- Jira pagination uses `nextPageToken/isLast`
- tests use `unittest`
- UI toggles/filtering avoid backend refetches unless scope changes

## Scope and Non-Goals
### In scope
- `POST /api/stats/epic-cohort`
- Frontend cohort panel in `frontend/src/dashboard.jsx`
- Cohort utility + presentational components
- Backend + frontend verification checklist

### Out of scope
- Persisted user custom cohort presets
- Heavy historical backfill beyond selected `startQuarter`

## Data/Request Strategy
## Backend refetch triggers
Refetch only when one of these changes:
- `startQuarter`
- team scope (`teamIds`)
- explicit refresh

## Client-side only transforms
No refetch for:
- group mode `quarter/month`
- project filter
- assignee filter
- status toggles (`Killed`, `Incomplete`, `Postponed`)
- row drill-down selection

## API Contract (v3)
### Request
```json
{
  "startQuarter": "2025Q1",
  "teamIds": [],
  "refresh": false
}
```

### Response shape
- `data.issues[]`: normalized epic records (`createdDate`, `terminalDate`, `status`, `leadTimeDays`, project/team/assignee)
- `data.range`
- `data.meta` with warnings/truncation/pagination mode

## Status Semantics
- Done, Killed, Incomplete, Postponed are terminal statuses.
- `Postponed` means `status == "Postponed"`.
- `open` means non-terminal and contributes to open chart/count.
- Terminal without known terminal date:
  - counted in status cards
  - excluded from elapsed-period heatmap cell assignment until date resolved

## Performance and Safety Budgets
- Expected 2-year scope up to ~398 epics.
- Backend budgets:
  - changelog enrichment max targets/request: 200
  - enrichment worker pool: 4
  - enrichment timeout budget: 10s
- Cache:
  - key: `startQuarter + teamIds + projectConfigSignature`
  - TTL: short-lived (session / configurable)
- Failure mode:
  - return partial data + warnings (do not spam Jira retries/fanout)

## Execution Tasks
## Task 1: Backend helper functions + unit tests
Files:
- `jira_server.py`
- `tests/test_epic_cohort_api.py`

Implement helpers:
- period labeling for quarter/month
- elapsed period index calculation
- terminal status/date normalization

Tests (`unittest`):
- quarter/month boundaries (including leap month)
- elapsed index calculations
- status normalization (including Postponed)

Run:
```bash
python3 -m unittest tests.test_epic_cohort_api -v
```

## Task 2: Backend fetch function with Jira pagination contract
Files:
- `jira_server.py`
- `tests/test_epic_cohort_api.py`

Implement `fetch_epic_cohort_data(...)`:
- paginated epic fetch with `nextPageToken/isLast`
- no `startAt/total` logic
- bounded terminal-date enrichment via changelog
- warning metadata for partial enrichment

Tests:
- multi-page aggregation through nextPageToken
- enrichment budget cutoff behavior
- status/date mapping for Done/Killed/Incomplete/Postponed/open

Run:
```bash
python3 -m unittest tests.test_epic_cohort_api -v
```

## Task 3: API endpoint wiring
Files:
- `jira_server.py`
- `tests/test_epic_cohort_api.py`

Add `POST /api/stats/epic-cohort`:
- validate `startQuarter`
- parse optional `teamIds`, `refresh`
- call fetch function
- return normalized payload + meta

Tests:
- 400 for missing `startQuarter`
- 200 success payload contract
- warning passthrough

Run:
```bash
python3 -m unittest tests.test_epic_cohort_api -v
```

## Task 4: Frontend cohort utils
Files:
- `frontend/src/cohort/cohortUtils.js`

Implement pure functions:
- build grid model (count-based cells)
- group by quarter/month (client-side)
- status/project/assignee filtering
- summary card aggregation
- open-epics bar data model

Verification:
- add lightweight deterministic checks (pure-function assertions) using existing frontend test approach or Node-based script if already present.

## Task 5: Frontend components
Files:
- `frontend/src/cohort/CohortGrid.jsx`
- `frontend/src/cohort/OpenEpicsChart.jsx`
- `frontend/dist/dashboard.css`

Implement:
- heatmap grid with row click drill-down
- tooltip (cell breakdown and epic list)
- open-epics horizontal bars sorted by days open

## Task 6: Dashboard integration
Files:
- `frontend/src/dashboard.jsx`
- `frontend/dist/dashboard.js`
- `frontend/dist/dashboard.js.map`

Integrate panel state and fetch flow:
- request only on scope changes
- reuse cached dataset for all client-side interactions
- ensure no request on groupBy/filter/toggle changes

## Task 7: Verification checklist (must run)
1. Backend tests:
```bash
python3 -m unittest tests.test_epic_cohort_api -v
```
2. Full suite:
```bash
python3 -m unittest discover -s tests
```
3. Frontend build:
```bash
npm run build
```
4. Manual network checks in browser:
- open Lead Times panel => one cohort API call
- change groupBy/project/assignee/status toggles => zero additional cohort API calls
- change startQuarter/team scope => one new cohort API call

## Task 8: Delivery notes
Document in README:
- what cohort chart represents
- status semantics (including Postponed)
- performance behavior and when API refetch occurs

## Acceptance Criteria
1. Cohort endpoint and helpers use `nextPageToken/isLast` only.
2. Postponed is treated as explicit terminal status, not open.
3. GroupBy switch is UI-only recompute, no API call.
4. Project/assignee/status toggles are UI-only recompute, no API call.
5. Enrichment fan-out is bounded with warnings on partial data.
6. Works for scope near 398 epics without request storming.
7. Tests/build pass using repo-standard commands.
