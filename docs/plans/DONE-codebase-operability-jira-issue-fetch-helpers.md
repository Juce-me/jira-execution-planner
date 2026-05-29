# Codebase Operability: Jira Issue Fetch Helpers

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Move reusable Jira issue fetch pagination and key-batching helpers out of `jira_server.py` into `backend/jira_client.py` while preserving `jira_server` wrappers for existing tests and patch targets.

## Scope

- Add `backend.jira_client.fetch_issues_by_jql` and `backend.jira_client.fetch_issues_by_keys` with injected request and logging dependencies.
- Replace the large `jira_server.py` helper bodies with thin wrappers that pass `jira_search_request` and `log_warning`.
- Add focused backend tests for pagination, non-200 handling, key batching, and source-guard coverage.
- Do not change Jira request auth, route behavior, endpoint contracts, or caller imports.

## Files

- `backend/jira_client.py`
- `jira_server.py`
- `tests/test_backend_service_extraction.py`
- `tests/test_jira_issue_fetch_helpers.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_jira_issue_fetch_helpers tests.test_backend_service_extraction` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_epm_scope_resolution tests.test_epm_rollup_api tests.test_oauth_stats_routes` passed on 2026-05-28.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets` passed on 2026-05-28.

## Commit

`Extract Jira issue fetch helpers`
