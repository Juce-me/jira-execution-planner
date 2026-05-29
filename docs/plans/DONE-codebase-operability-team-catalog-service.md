# Codebase Operability: Team Catalog Service

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Move team catalog and team-label normalization helpers out of `jira_server.py` into a backend service while preserving the existing wrapper functions used by config-store and settings routes.

## Scope

- Add `backend/services/team_catalog.py`.
- Update `jira_server.py` `normalize_team_catalog`, `normalize_team_catalog_meta`, and `normalize_group_team_labels` wrappers to delegate to the service.
- Add direct service tests and source guards.
- Do not change group config validation, team catalog persistence, API response shapes, frontend settings behavior, DB/auth, Home/Townsquare, or route registration.

## Files

- `backend/services/team_catalog.py`
- `jira_server.py`
- `tests/test_team_catalog_service.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_team_catalog_service tests.test_team_catalog_api tests.test_create_stories_alert tests.test_backend_service_extraction tests.test_backend_route_source_guards tests.test_route_move_preservation`
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`

## Commit

`Extract team catalog service`
