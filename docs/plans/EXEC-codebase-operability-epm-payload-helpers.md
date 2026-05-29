# Codebase Operability: EPM Payload Helpers

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move pure EPM payload helpers out of `jira_server.py` into the `backend.epm` package while preserving existing `jira_server` compatibility names.

## Scope

- Add `backend/epm/payload.py` for pure issue dedupe, tab/sprint validation, issue-type set normalization, empty rollup payloads, and rollup hierarchy construction.
- Keep Jira field lookup, raw Jira fetch wrappers, and functions that depend on route/runtime callbacks in `jira_server.py`.
- Preserve all existing route response shapes and patchable `jira_server` symbols.
- Do not change EPM project discovery, rollup query fan-out, or frontend behavior.

## Files

- `backend/epm/payload.py`
- `jira_server.py`
- `tests/test_epm_payload_helpers.py`
- `tests/test_backend_service_extraction.py`
- `docs/plans/FUTURE-codebase-operability-improvements.md`
- `docs/plans/README.md`

## Verification

- `.venv/bin/python -m unittest tests.test_epm_payload_helpers tests.test_backend_service_extraction`: failed first because `backend.epm.payload` did not exist, then passed after extraction.
- `.venv/bin/python -m unittest tests.test_epm_rollup_builder tests.test_epm_rollup_api tests.test_epm_issues_endpoint tests.test_epm_scope_resolution`: passed 55 tests.
- `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`: passed.

## Commit

`Extract EPM payload helpers`
