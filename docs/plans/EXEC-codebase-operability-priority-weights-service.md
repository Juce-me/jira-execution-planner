# Codebase Operability: Priority Weights Service

> **Status:** In progress on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move stats priority weight normalization, env parsing, and effective config selection out of `jira_server.py` into a backend service while preserving the existing wrapper functions used by settings routes and tests.

## Scope

- Add `backend/services/priority_weights.py`.
- Update `jira_server.py` priority-weight helper functions to delegate to the service.
- Add direct service tests and source guards.
- Do not change `/api/stats/priority-weights-config` response shape, save behavior, frontend settings behavior, DB/auth, Home/Townsquare, or route registration.

## Files

- `backend/services/priority_weights.py`
- `jira_server.py`
- `tests/test_priority_weights_service.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_priority_weights_service tests.test_priority_weights_config_api tests.test_oauth_settings_routes tests.test_backend_service_extraction tests.test_backend_route_source_guards tests.test_route_move_preservation`
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`

## Commit

`Extract priority weights service`
