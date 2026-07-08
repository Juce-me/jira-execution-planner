# Postmortem MRT013: EPM Active Home Projects Hidden

**Date**: 2026-04-30
**Severity**: High
**Status**: Resolved
**Author**: Codex

## Summary

The EPM Active board could show fewer Atlassian Home projects than the Home project list. A Home goal with more than 200 projects was truncated before project details were fetched, and Home status labels such as `On track` were not normalized into the Active lifecycle bucket when the enum value was unavailable.

## Impact

- Users affected: EPM users comparing Active boards against Atlassian Home project status.
- Symptoms: Home showed at least seven `ON TRACK` projects, while EPM Active rendered only five.
- Missing projects could disappear before label resolution, so they did not render even as metadata-only cards.

## Root Cause

EPM Home discovery stopped `goals_byId.projects` pagination at 200 project links. The current Home project list exceeded that size, so active projects after the cap were invisible to `/api/epm/projects` and `/api/epm/projects/rollup/all`.

Separately, `bucket_epm_state` matched only enum-style values such as `ON_TRACK`. If Home returned or fell back to a display label such as `On track`, the project was assigned to `backlog`.

## Resolution

- Raised the bounded Home project-list cap from 200 to 500.
- Normalized Home status text by collapsing spaces, punctuation, and emoji separators into enum-style tokens before lifecycle bucketing.
- Added tests for `On track` label bucketing, fetching beyond 200 Home projects, and retaining the 500-project fan-out cap.

## Verification

- `.venv/bin/python -m unittest tests.test_epm_home_api.TestEpmHomeApi.test_bucket_on_track_label_as_active tests.test_epm_home_api.TestEpmHomeApi.test_fetch_goal_project_links_reads_more_than_200_projects tests.test_epm_home_api.TestEpmHomeApi.test_fetch_goal_project_links_caps_large_goal_fetches`
- `.venv/bin/python -m unittest tests.test_epm_home_api tests.test_epm_projects_api tests.test_epm_rollup_api`
- `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js`

## Lessons Learned

- EPM Active project visibility must be validated against Home lifecycle labels, not only Home enum values.
- Bounded Home fan-out is still required, but the bound must exceed known current Home goal sizes or the UI will silently undercount visible projects.

## Action Items

- [x] Add status-label bucketing coverage for `On track`.
- [x] Add pagination coverage for Home goals above 200 projects.
- [x] Keep a regression guard that very large Home goals still stop at the configured cap.

## Related Issues

- [MRT011](./MRT011-epm-settings-overgeneralized-selection-ux.md)
- [MRT012](./MRT012-epm-active-sprint-value-hidden.md)
