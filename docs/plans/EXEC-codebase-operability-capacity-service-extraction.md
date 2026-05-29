# Codebase Operability: Capacity Service Extraction

> **Status:** Implemented and verified locally on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move capacity Jira query construction, capacity issue parsing, watcher fallback, and route response handling out of `jira_server.py` while preserving existing `jira_server` wrappers as patchable compatibility seams.

## Scope

- Add `backend/services/capacity.py` for backend capacity service helpers.
- Update `jira_server.py` capacity helper functions to delegate to the service.
- Update `backend/routes/capacity_routes.py` to own `/api/capacity` and `/api/planned-capacity` request/response handling instead of delegating to `get_jira_server().get_capacity()`.
- Add direct service tests and source guards.
- Do not touch frontend files, Home/Townsquare write behavior, endpoint policy, or Jira auth request mechanics.

## Files

- `backend/services/capacity.py`
- `backend/routes/capacity_routes.py`
- `jira_server.py`
- `tests/test_capacity_service.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_capacity_service tests.test_oauth_stats_routes tests.test_backend_service_extraction tests.test_backend_route_source_guards tests.test_route_move_preservation` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed on 2026-05-28.

## Commit

`Extract capacity service helpers`
