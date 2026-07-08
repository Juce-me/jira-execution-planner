# Postmortem MRT015: EPM First Load Home Fan-Out and Overfetch

**Date**: 2026-05-01
**Severity**: High
**Status**: Resolved
**Author**: Codex

## Summary

First-time EPM load could spend roughly a minute waiting on EPM data in Safari. The backend first fetched the full Home project catalog, enriched each project with separate Home detail, update, and tag requests, then returned all Home projects to the dashboard even when the initial EPM view only needed Active projects.

## Impact

- Users affected: EPM users landing on the Active all-projects board.
- Symptoms: `/api/epm/projects` and `/api/epm/projects/rollup/all` showed long first-load timings, while normal bootstrap calls completed quickly.
- The UI rendered its shell but waited on EPM data before the board became useful.

## Root Cause

Home project discovery used bounded pagination correctly, but each project row then triggered separate detail, update, and tag GraphQL calls. That multiplied first-load Home traffic by project count.

The first-load project metadata request also returned the full Home catalog. Active rollups filtered to visible projects later, but `/api/epm/projects` still delivered Backlog and Archived project metadata to the dashboard. Pending Home projects were also bucketed as Backlog, but the intended Active first-load scope is pending, on-track, at-risk, and off-track.

## Resolution

- Batched Home project state, tags, and latest update into the goal-projects query so project enrichment no longer fans out per project.
- Added `Server-Timing` to `/api/epm/projects` and `/api/epm/projects/configuration`.
- Scoped dashboard project metadata fetches with `tab=active` on first Active load.
- Updated Active lifecycle bucketing to include pending, on-track, at-risk, and off-track Home projects; Backlog is now paused only.
- Preserved full project loading for EPM settings/configuration flows.

## Verification

- Live sanitized timing check before batching: `/api/epm/projects` returned 28 projects in 6952.4 ms with 28 detail, 28 update, and 28 tag Home calls.
- Live sanitized timing check after batching: `/api/epm/projects` returned the full catalog in 4356.3 ms with one enriched goal-projects page request plus goal resolution.
- Live sanitized timing check after Active scoping: `/api/epm/projects?tab=active` returned 7 projects from a 28-project Home catalog; Active rollup logged `projects=7 visible=7 labeled=7`.
- `npm run build`
- `.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api tests.test_epm_rollup_api`
- `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_control_dropdown_utils.js`
- `.venv/bin/python -m unittest discover -s tests`
- `npx playwright test tests/ui/epm_initial_config_load.spec.js`

## Lessons Learned

- Project metadata endpoints need the same tab scoping discipline as rollup endpoints.
- `homeProjectCount` can report the full Home catalog, but the first-load `projects` payload should match the visible lifecycle scope.
- Pending Home projects are Active for first-load EPM work, not Backlog.
- Batching Home fields at the pagination query is safer than compensating with larger thread pools.

## Action Items

- [x] Add tests for batched Home project enrichment.
- [x] Add tests for tab-scoped `/api/epm/projects`.
- [x] Add frontend source guards for scoped EPM project metadata fetches.
- [x] Update EPM lifecycle docs.

## Related Issues

- [MRT013](./MRT013-epm-active-home-projects-hidden.md)
- [MRT014](./MRT014-epm-cold-load-cache-race.md)
