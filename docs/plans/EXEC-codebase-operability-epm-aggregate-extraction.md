# Codebase Operability EPM Aggregate Extraction Slice

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Move all-project EPM rollup aggregation out of `jira_server.py` and into the `backend.epm` package while preserving route contracts and patchable compatibility shims.

## Scope

- Add `backend/epm/aggregate.py`.
- Keep `jira_server.build_all_epm_projects_rollup` and `collect_epm_rollup_issue_keys` as compatibility shims.
- Add service-extraction coverage for the new backend EPM module.

## Out Of Scope

- No route response shape changes.
- No EPM project payload or Home/Townsquare fetch changes.
- No frontend changes.

## Verification

- `.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_backend_service_extraction tests.test_backend_route_source_guards`: passed 48 tests.
