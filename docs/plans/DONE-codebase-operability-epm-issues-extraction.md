# Codebase Operability: EPM Issues Extraction

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Move EPM project issues endpoint orchestration out of the route module into `backend.epm` while preserving the current request and response contract.

## Scope

- Add `backend/epm/issues.py` for project issues validation, project lookup, JQL construction, Jira fetch, payload shaping, and cache handling.
- Keep `backend/routes/epm_routes.py` as a Flask adapter that parses request args, delegates, converts payloads to JSON, and preserves Home token prerequisite handling.
- Preserve `jira_server` patch points and cache symbols during the migration.
- Do not change EPM rollup behavior, Home/Townsquare writes, UI code, or response shapes.

## Files

- `backend/epm/issues.py`
- `backend/routes/epm_routes.py`
- `jira_server.py`
- `tests/test_epm_issues_endpoint.py`
- `tests/test_backend_service_extraction.py`
- `tests/test_oauth_cache_isolation.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_epm_issues_endpoint tests.test_backend_service_extraction tests.test_oauth_cache_isolation`: failed first because `backend.epm.issues` did not exist, then passed after extraction.
- `.venv/bin/python -m unittest tests.test_epm_scope_resolution tests.test_epm_rollup_api`: passed 44 tests.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`: failed while the compatibility builder grew `jira_server.py`, then passed after keeping that glue in the route adapter.

## Commit

`Extract EPM project issues orchestration`
