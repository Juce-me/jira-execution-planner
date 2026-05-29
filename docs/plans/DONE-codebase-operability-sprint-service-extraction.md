# Codebase Operability: Sprint Service Extraction

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Move Jira sprint cache, board sprint loading, JQL fallback sprint discovery, and sprint de-duplication logic out of `jira_server.py` into a backend service while preserving existing `jira_server` wrappers as patchable compatibility seams.

## Scope

- Add `backend/services/sprints.py` for sprint cache and Jira sprint discovery helpers.
- Update `jira_server.py` sprint helper functions to delegate to the service.
- Add direct service tests and source guards.
- Do not touch frontend files, Home/Townsquare behavior, endpoint policy, `/api/sprints` response shape, OAuth cache bypass behavior, or Jira auth request mechanics.

## Files

- `backend/services/sprints.py`
- `jira_server.py`
- `tests/test_sprint_service.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_sprint_service tests.test_sprint_dates tests.test_oauth_stats_routes tests.test_board_config_api tests.test_backend_service_extraction tests.test_backend_route_source_guards tests.test_route_move_preservation` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed on 2026-05-28.

## Commit

`Extract sprint service helpers`
