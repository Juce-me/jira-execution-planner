# Codebase Operability: Update Check Service

> **Status:** In progress on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move local git/release-info update-check mechanics out of `jira_server.py` into a backend service while preserving the existing `jira_server` wrapper functions used by the settings route.

## Scope

- Add `backend/services/update_check.py`.
- Update `jira_server.py` `run_git_command`, `load_release_info`, and `build_update_check_payload` wrappers to delegate to the service.
- Add direct service tests and source guards.
- Do not change `/api/version` response shape, cache TTL behavior, frontend update badge behavior, auth, DB, Home/Townsquare, or route registration.

## Files

- `backend/services/update_check.py`
- `jira_server.py`
- `tests/test_update_check_service.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_update_check_service tests.test_oauth_settings_routes tests.test_backend_service_extraction tests.test_backend_route_source_guards tests.test_route_move_preservation`
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`

## Commit

`Extract update check service`
