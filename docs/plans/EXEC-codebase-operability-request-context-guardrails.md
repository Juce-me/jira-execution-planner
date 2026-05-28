# Codebase Operability Request-Context Guardrails Slice

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Add guardrails that prevent future worker fan-out from losing the explicit `RequestAuthContext` and request-scoped dashboard config required by OAuth-backed Jira/Home calls.

## Scope

- Add runtime EPM rollup tests proving worker-executed Jira rollup fetches receive the request auth context and do not read dashboard config from worker threads.
- Add source guard coverage for Home project fan-out preserving explicit context in worker functions.

## Out Of Scope

- No route contract changes.
- No new Jira/Home fan-out.
- No service extraction.

## Verification

- `.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_backend_route_source_guards`: passed 41 tests.
- `.venv/bin/python -m unittest tests.test_epm_rollup_api.TestEpmRollupApi.test_all_projects_rollup_workers_use_captured_dashboard_config_in_db_mode`: failed before the fix with `ConfigStorageError: dashboard config read escaped request context`, then passed after capturing EPM config, base JQL, sprint/story/team field IDs, and shaped issue fields before fan-out.
