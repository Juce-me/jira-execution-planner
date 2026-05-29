# Codebase Operability: Local OAuth Store Extraction

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Move local Atlassian OAuth token-store persistence, TTL cleanup, and refresh-lock mechanics out of `jira_server.py` into `backend.auth` while preserving the current browser-session compatibility functions.

## Scope

- Add `backend/auth/local_oauth_store.py` for local OAuth session storage and persistence.
- Keep `jira_server.save_oauth_session`, `oauth_session_data`, `oauth_refresh_lock`, and auth-context variants as compatibility wrappers.
- Preserve DB OAuth behavior and do not move DB token refresh logic.
- Do not change route contracts, cookie/session names, OAuth callback behavior, or startup validation semantics.

## Files

- `backend/auth/local_oauth_store.py`
- `jira_server.py`
- `tests/test_local_oauth_store.py`
- `tests/test_auth_routes.py`
- `tests/test_auth_context.py`
- `tests/test_oauth_route_guards.py`
- `tests/test_oauth_cache_isolation.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_local_oauth_store tests.test_backend_service_extraction`: failed first because `backend.auth.local_oauth_store` did not exist and `jira_server.py` still owned private persistence/cleanup helpers.
- `.venv/bin/python -m unittest tests.test_local_oauth_store tests.test_auth_routes tests.test_auth_context tests.test_oauth_route_guards tests.test_oauth_cache_isolation tests.test_backend_service_extraction`: passed 57 tests.
- `.venv/bin/python -m unittest tests.test_oauth_jira_client tests.test_token_refresh_race tests.test_db_oauth_cutover tests.test_user_api_token_connections`: passed 36 tests, skipped 1.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`: passed.

## Commit

`Extract local OAuth token store`
