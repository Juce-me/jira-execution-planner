# Postmortem MRT008: Scenario Planner Missing Valid Stories

**Date**: 2026-01-29  
**Severity**: High  
**Status**: Resolved  
**Author**: Codex

---

## Summary
The scenario planner showed fewer stories than the rest of the dashboard (and than `/api/tasks-with-team-name`). A valid Product story appeared in the tasks list but was missing from the scenario view.

## Impact
- **Users Affected**: Scenario planner users working in active sprints.
- **Symptoms**:
  - Scenario planner lanes missed valid stories.
  - “Unschedulable” summary and counts were misleading.
  - Manual API checks showed the issue existed in tasks but not scenario output.

## Root Cause
1. **Sprint filter mismatch**: the scenario planner sent the sprint *name* (e.g., `2026Q1`) while the rest of the app used the sprint *ID* (e.g., `34218`). Jira returned different results for those filters.
2. **Pagination gap**: Jira’s `/search/jql` endpoint used `nextPageToken`, but the backend only paged via `startAt`. This truncated the tasks list and masked missing items.

## Resolution
- Use the sprint **ID** in the scenario payload to match the rest of the app.
- Add `nextPageToken` handling to Jira search pagination for both task and scenario queries.

## Verification
- Compared key sets from `/api/tasks-with-team-name` and `/api/scenario` for the same sprint and team filters.
- Confirmed the same story keys appear in both endpoints for identical filters.

## Lessons Learned
- Keep scenario and tasks pipelines aligned on filter inputs (sprint ID vs name).
- Jira pagination modes differ by endpoint; support both `startAt` and `nextPageToken`.

## Action Items
- [x] Align scenario sprint filter with tasks.
- [x] Support `nextPageToken` pagination in Jira search.
- [ ] Add a regression check that compares scenario/task keys for the same filters.
