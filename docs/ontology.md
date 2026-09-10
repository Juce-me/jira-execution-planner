# Project Ontology

Coverage: verified entry points and relationships for the Statistics area involved in the 2026-09-10 update. Other application areas remain unmapped.

## Statistics

Verified on: 2026-09-10.

- **Statistics**: ENG dashboard reporting surface. Entry point: `frontend/src/dashboard.jsx`; API wrappers: `frontend/src/api/statsApi.js`; feature contract: `docs/features/statistics.md`; UI coverage: `tests/ui/codebase_structure_smoke.spec.js`.
- **Statistics source**: cached sprint-scoped Jira Story payload shared by Excluded Capacity, Mono vs Cross, and Project Track. Producer: `fetch_excluded_capacity_stats_source` and `build_excluded_capacity_issue_payload` in `jira_server.py`; route: `backend/routes/stats_routes.py`; contract tests: `tests/test_excluded_capacity_stats_api.py`. Produces normalized Story records with parent-Epic metadata consumed by Project Track.
- **Project Track**: Statistics view that groups Story Points by the parent Epic's Project Track value. Aliases in the UI: Project Track view, Epic mode, Team mode. Aggregation: `frontend/src/stats/projectTrackStats.js`; rendering: `frontend/src/stats/ProjectTrackTotalsBar.jsx`, `frontend/src/stats/ProjectTrackSprintChart.jsx`, `frontend/src/stats/ProjectTrackBreakdownChart.jsx`, and `frontend/src/stats/ProjectTrackPhaseChart.jsx`; tests: `tests/test_project_track_stats.js` and the Project Track case in `tests/ui/codebase_structure_smoke.spec.js`. Depends on the Statistics source and Jira issue-list links.
- **Lead Times**: Statistics view for Epic cohorts and elapsed time. Alias: Cohort Heatmap. Data model: `frontend/src/cohort/cohortUtils.js`; heatmap rendering: `frontend/src/cohort/CohortGrid.jsx`; styles: `frontend/src/styles/stats/cohort.css`; API route: `/api/stats/epic-cohort`; UI coverage: the Statistics and Lead Times cases in `tests/ui/codebase_structure_smoke.spec.js`.
- **Jira issue-list link**: external Jira search navigation for a filtered set of issues. Link analytics contract: `frontend/src/analytics/externalLinks.js`; tracked anchor: `frontend/src/components/TrackedExternalLink.jsx`; taxonomy: `docs/README_ANALYTICS.md`. Consumed by Statistics tables and Lead Times charts.

