# Codebase Operability: Config Repository Selection

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Make dashboard config repository selection explicit by call site so DB mode cannot silently fall back to JSON storage outside request context.

## Scope

- Add explicit `source` selection to the legacy `jira_server.load_dashboard_config()` and `save_dashboard_config()` wrappers.
- Keep the default behavior unchanged for JSON mode and request-backed DB mode.
- Raise a configuration error when DB mode is active without request context unless the caller explicitly requests JSON.
- Mark legacy startup/team-catalog migration JSON reads as explicit JSON reads.

## Files

- `jira_server.py`
- `tests/test_config_storage_selector.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_config_storage_selector.ConfigStorageSelectorTests.test_dashboard_config_requires_explicit_json_source_without_request_context_in_db_mode`: failed before implementation with `ConfigStorageError not raised`, then passed after implementation.
- `.venv/bin/python -m unittest tests.test_config_storage_selector tests.test_config_jsonfile_fallback tests.test_dashboard_bootstrap_config_source tests.test_user_view_config_routes tests.test_backend_service_extraction tests.test_backend_route_source_guards`: passed 38 tests.

## Commit

`Make config repository selection explicit`
