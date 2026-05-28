# Codebase Operability Request-Context Guardrails Slice

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Add guardrails that prevent future worker fan-out from losing the explicit `RequestAuthContext` required by OAuth-backed Jira/Home calls.

## Scope

- Add a runtime EPM rollup test proving worker-executed Jira rollup fetches receive the request auth context.
- Add source guard coverage for Home project fan-out preserving explicit context in worker functions.

## Out Of Scope

- No route contract changes.
- No new Jira/Home fan-out.
- No service extraction.

## Verification

- `.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_backend_route_source_guards`: passed 41 tests.
