# Codebase Operability: Group Config Service

> **Status:** In progress on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move team-group env parsing, validation, and default config construction out of `jira_server.py` into a backend service while preserving existing wrapper functions used by settings routes and tests.

## Scope

- Add `backend/services/group_config.py`.
- Update `jira_server.py` `parse_groups_config_env`, `validate_groups_config`, and `build_default_groups_config` wrappers to delegate to the service.
- Add direct service tests and source guards.
- Do not change `/api/groups-config` response shape, save behavior, team catalog persistence, frontend settings behavior, DB/auth, Home/Townsquare, or route registration.

## Files

- `backend/services/group_config.py`
- `jira_server.py`
- `tests/test_group_config_service.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_group_config_service tests.test_team_catalog_api tests.test_create_stories_alert tests.test_group_excluded_capacity_epics_api tests.test_oauth_settings_routes tests.test_backend_service_extraction tests.test_backend_route_source_guards tests.test_route_move_preservation`
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`

## Commit

`Extract group config service`
