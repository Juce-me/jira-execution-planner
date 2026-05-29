# Codebase Operability: EPM Config Extraction

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move EPM config defaults and normalization helpers out of `jira_server.py` into the `backend.epm` package while preserving existing route behavior and `jira_server` compatibility symbols.

## Scope

- Add `backend/epm/config.py` for EPM config constants and normalizers.
- Keep `jira_server.DEFAULT_EPM_LABEL_PREFIX`, `DEFAULT_EPM_ISSUE_TYPES`, and normalization helper names as patchable compatibility aliases.
- Do not change EPM route response shapes, saved config semantics, cache behavior, or Home/Townsquare fetch behavior.

## Files

- `backend/epm/config.py`
- `jira_server.py`
- `tests/test_backend_service_extraction.py`
- `tests/test_epm_config_api.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_backend_service_extraction.TestBackendServiceExtraction.test_epm_config_normalizers_live_in_epm_package_with_compatibility_aliases`: failed before implementation with `ModuleNotFoundError: No module named 'backend.epm.config'`, then passed after implementation.
- `.venv/bin/python -m unittest tests.test_backend_service_extraction tests.test_epm_config_api tests.test_epm_scope_api tests.test_epm_projects_api tests.test_epm_rollup_api tests.test_epm_rollup_builder tests.test_backend_route_source_guards`: passed 115 tests.

## Commit

`Extract EPM config normalization`
