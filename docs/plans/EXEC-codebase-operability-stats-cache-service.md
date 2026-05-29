# Codebase Operability: Stats Cache Service

> **Status:** In progress on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move stats file-cache load/save/invalidation and cache-key construction out of `jira_server.py` into a backend service while preserving existing `jira_server` wrappers as patchable compatibility seams.

## Scope

- Add `backend/services/stats_cache.py`.
- Update `jira_server.py` stats cache helper functions to delegate to the service.
- Add direct service tests and source guards.
- Do not touch frontend files, stats route response shape, OAuth cache bypass behavior, Jira auth mechanics, or Home/Townsquare behavior.

## Files

- `backend/services/stats_cache.py`
- `jira_server.py`
- `tests/test_stats_cache_service.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_stats_cache_service tests.test_oauth_stats_routes tests.test_backend_service_extraction tests.test_backend_route_source_guards tests.test_route_move_preservation`
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`

## Commit

`Extract stats cache service helpers`
