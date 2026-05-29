# Codebase Operability: Config Repository Selection

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Make dashboard config repository selection explicit by call site so DB mode cannot silently fall back to JSON storage outside request context.

## Scope

- Add explicit `source` selection to the legacy `jira_server.load_dashboard_config()` and `save_dashboard_config()` wrappers.
- Keep the default behavior unchanged for JSON mode and request-backed DB mode.
- Raise a configuration error when DB mode is active without request context unless the caller explicitly requests JSON.
- Mark legacy startup/team-catalog migration JSON reads as explicit JSON reads, including startup banner board-id logging before a request context exists.

## Files

- `jira_server.py`
- `tests/test_config_storage_selector.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_config_storage_selector.ConfigStorageSelectorTests.test_dashboard_config_requires_explicit_json_source_without_request_context_in_db_mode`: failed before implementation with `ConfigStorageError not raised`, then passed after implementation.
- `.venv/bin/python -m unittest tests.test_config_storage_selector tests.test_config_jsonfile_fallback tests.test_dashboard_bootstrap_config_source tests.test_user_view_config_routes tests.test_backend_service_extraction tests.test_backend_route_source_guards`: passed 38 tests.
- `.venv/bin/python -m unittest tests.test_app_startup.AppStartupTests.test_main_startup_banner_uses_json_board_config_without_request_context`: failed after the initial extraction because startup board-id logging called `load_dashboard_config()` without `source="jsonfile"`, then passed after fixing the startup call path.
- `.venv/bin/python jira_server.py` reached the Flask startup banner in DB/OAuth mode and `curl http://127.0.0.1:5050/api/test` returned `401 auth_required`, proving the server was responsive.

## Commit

`Make config repository selection explicit`

`Fix DB-mode startup board config read`
