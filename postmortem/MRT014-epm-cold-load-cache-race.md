# Postmortem MRT014: EPM Cold Load Cache Race

**Date**: 2026-04-30
**Severity**: Medium
**Status**: Resolved
**Author**: Codex

## Summary

EPM load could emit backend deprecation warnings and spend several seconds in `/api/epm/projects/rollup/all` on a cold load. The frontend started project metadata loading and all-project rollup from separate effects, so the rollup could begin before Home project discovery had warmed the backend cache.

## Impact

- Users affected: EPM users landing directly on the Active all-projects board.
- Symptoms: backend console showed `datetime.utcnow()` deprecation warnings, and the all-project rollup request could take more than seven seconds.
- The first visible EPM render had no timing breakdown to identify whether Home discovery or Jira rollup was slow.

## Root Cause

EPM view initialization split project discovery and rollup loading into independent effects. On cold cache, `/api/epm/projects/rollup/all` could perform Home discovery and Jira rollup work in one blocking request instead of reusing warmed project metadata.

The backend also still used naive `datetime.utcnow()` in EPM project timestamps and update-check payloads, which Python 3.14 surfaces as deprecation warnings.

## Resolution

- EPM initial view load now uses `refreshEpmView()`, warming project metadata before rollup.
- Rollup refresh now exits while project metadata is pending and when no saved EPM scope is loaded.
- `/api/epm/projects/rollup/all` now returns `Server-Timing` for Home project shaping, Jira rollups, and total time, and logs the same breakdown.
- Backend UTC timestamps now use timezone-aware `datetime.now(timezone.utc)`.

## Verification

- `.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api tests.test_epm_rollup_api`
- `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js`
- `npm run build`

## Lessons Learned

- EPM cold-load work must be sequenced through one path so Home discovery warms cache before rollup.
- Slow aggregate endpoints need timing headers before optimization work continues.

## Action Items

- [x] Add source guard for EPM initial load sequencing.
- [x] Add server timing coverage for all-project rollups.
- [x] Remove naive UTC timestamp usage from `jira_server.py`.

## Related Issues

- [MRT012](./MRT012-epm-active-sprint-value-hidden.md)
- [MRT013](./MRT013-epm-active-home-projects-hidden.md)
