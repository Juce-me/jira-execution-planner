# Codebase Operability Improvements

> **Status:** Future scope. This is a prioritized structural review and handoff note, not an implementation-ready `EXEC-*` plan.

## Goal

Make the current repo easier to operate, package, verify, and modify by finishing the extraction work already started in the frontend and backend.

## Review Basis

This plan summarizes a read-only review of the current checkout on 2026-05-28. The review focused on:

- frontend feature ownership and dashboard splitting
- backend route, service, auth, config, and startup boundaries
- packaging, dependency management, local verification, and operator setup

No P0 issues were found. The main structural risk is that extracted modules exist, but the true ownership centers are still large legacy files:

- `frontend/src/dashboard.jsx` is still about 15.5k lines and owns Scenario, settings state, planning/capacity behavior, and transitional API calls.
- `jira_server.py` is still about 6.8k lines and owns runtime configuration, caches, auth/session helpers, Jira wrappers, EPM orchestration, and compatibility exports.
- `backend/services/` exists but has no service modules yet.

## Recommended Order

1. Improve verification and operability commands first.
2. Make packaging and startup behavior explicit.
3. Finish backend service/runtime extraction.
4. Finish frontend API and feature ownership extraction.
5. Add source guards that prevent the legacy files from growing again.

## Prioritized Backlog

| Priority | Improvement | Complexity | Effort | Affected Areas | Outcome |
| --- | --- | --- | --- | --- | --- |
| P1 | Add one local CI-equivalent verification command | M | 1 day | `Makefile`, `package.json`, `.github/workflows/verify-frontend-build.yml` | Contributors can run one local command that mirrors CI: build, Python tests, security tests, Node source guards, and dist cleanliness. |
| P1 | Make packaging self-contained or explicitly release-zip-only | M | 1-2 days | `pyproject.toml`, `install.sh`, `.github/workflows/release-latest.yml`, static asset loading | There is one reliable install story. Either `pip install .` produces a runnable app with dependencies/assets, or docs clearly say the release zip is the runnable package. |
| P1 | Add startup, migration, and environment preflight | M | 1-2 days | `Makefile`, `INSTALL.md`, `backend/db/alembic.ini`, `jira_server.py` or a new script | Operators can diagnose missing DB/OAuth/encryption/migration state before starting Flask. |
| P1 | Make app creation and startup configuration explicit | M | 1-2 days | `backend/app.py`, `jira_server.py`, startup tests | `create_app()` becomes safe for tests and WSGI. CLI/env validation moves into startup instead of import-time side effects. |
| P1 | Finish real backend service extraction | L | 3-5 days | `backend/routes/__init__.py`, `backend/routes/*`, `backend/services/*`, `jira_server.py` shims | Route modules stop copying all `jira_server` globals per request and become adapters over explicit services. |
| P1 | Consolidate backend auth runtime boundaries | M | 2-3 days | `backend/auth/*`, `backend/security/guards.py`, `jira_server.py` | DB OAuth, local token-store compatibility, CSRF session data, Jira request auth, and auth recovery paths become easier to audit. |
| P1 | Move remaining EPM orchestration out of `jira_server.py` | M/L | 3-4 days | `backend/epm/*`, `backend/routes/epm_routes.py`, `jira_server.py` | EPM config normalization, cache dependency builders, payload shaping, lookup, and aggregate rollup orchestration become package-owned and directly testable. |
| P1 | Finish frontend API boundary | M | 3-5 days | `frontend/src/api/*`, `frontend/src/dashboard.jsx`, `tests/test_frontend_api_source_guards.js` | Endpoint construction and CSRF/error conventions live in API modules instead of transitional dashboard calls. |
| P1 | Extract Scenario Planner ownership | L | 5-8 days | `frontend/src/scenario/*`, new `frontend/src/api/scenarioApi.js`, new Scenario state/view modules, `frontend/src/dashboard.jsx` | Scenario draft APIs, realtime/polling, locks, drag state, layout, tooltips, and render orchestration move behind a Scenario package boundary. |
| P2 | Move settings state/actions behind feature hooks | M/L | 4-7 days | `frontend/src/settings/*`, `frontend/src/epm/EpmSettings.jsx`, `frontend/src/dashboard.jsx` | Settings components stop being large prop sinks; Team Groups, Jira fields, priority weights, and EPM settings become easier to modify independently. |
| P2 | Extract remaining ENG planning and capacity shell | M | 3-5 days | `frontend/src/eng/*`, `frontend/src/issues/*`, `frontend/src/dashboard.jsx` | Planning selection, capacity math, dependency focus, export keys, and alert derivations move out of the app shell. |
| P2 | Split CSS source into feature-owned partials | M | 3-4 days | `frontend/src/styles/dashboard.css`, `package.json`, generated `frontend/dist/dashboard.css` | Source CSS becomes easier to review while keeping one shipped bundled stylesheet. |
| P2 | Add structural budgets and source guards | M | 2-4 days | source guard tests, `tests/ui/codebase_structure_smoke.spec.js` | New feature code is blocked from re-accumulating in `dashboard.jsx` and `jira_server.py` after each extraction. |
| P2 | Unify DB/config storage mode parsing | S/M | 1 day | `backend/db/engine.py`, `backend/config/repository.py`, env docs/tests | `CONFIG_STORAGE_BACKEND` aliases cannot enable DB in one layer while config storage rejects it in another. |
| P2 | Make config repository selection explicit by call site | S/M | 1-2 days | `backend/config/*`, `jira_server.py` | DB mode avoids silent JSON fallback outside request context unless the call site explicitly asks for legacy JSON. |
| P2 | Add guardrails for request-context use in worker fan-out | S | 1 day | `jira_server.py`, `backend/epm/home.py`, source guard tests | Future threaded Jira/Home work must receive an explicit `RequestAuthContext`, preventing no-request-context OAuth regressions. |
| P2 | Replace obsolete quickstart docs | S | 0.5-1 day | `QUICKSTART_ENV.txt`, `README.md`, `AGENTS.md` | Onboarding no longer points users toward system/user pip or legacy Basic credentials as the default DB/OAuth path. |
| P2 | Refresh test organization docs | S | 0.5 day | `tests/README.md`, `package.json`, `Makefile` | Contributors can identify which Python, Node, source-guard, security, and Playwright checks apply to their change. |
| P2 | Reclassify the May 1 structure plan | S | 0.5 day | `docs/plans/2026-05-01-codebase-structure-optimization.md`, `docs/plans/README.md` | The already-partially-executed historical plan stops looking like stale executable work. |
| P3 | Update README structure snapshot | S | 0.5 day | `README.md` | New maintainers can orient around the current `backend/routes`, `backend/auth`, `backend/config`, `frontend/api`, `frontend/ui`, EPM, ENG, Scenario, and Stats layout. |

## Implementation Notes

- The verification-command slice is implemented locally in `EXEC-codebase-operability-verification.md`.
- The startup/preflight and storage-alias slice is implemented locally in `EXEC-codebase-operability-startup-preflight.md`.
- The quickstart, May 1 plan reclassification, and current structure docs slice is implemented locally in `EXEC-codebase-operability-doc-cleanup.md`.
- The release-zip packaging-contract slice is implemented locally in `EXEC-codebase-operability-packaging-contract.md`.
- The import-safe startup/app-creation slice is implemented locally in `EXEC-codebase-operability-import-safe-startup.md`.
- The worker fan-out request-context guardrail slice is implemented locally in `EXEC-codebase-operability-request-context-guardrails.md`.
- The EPM aggregate rollup extraction slice is implemented locally in `EXEC-codebase-operability-epm-aggregate-extraction.md`.
- The frontend API boundary slice is implemented locally in `EXEC-codebase-operability-frontend-api-boundary.md`.
- The config repository selection slice is implemented locally in `EXEC-codebase-operability-config-repository-selection.md`.
- The EPM config normalization extraction slice is implemented locally in `EXEC-codebase-operability-epm-config-extraction.md`.
- The structural budgets slice is implemented locally in `EXEC-codebase-operability-structural-budgets.md`.
- The EPM project issues extraction slice is implemented locally in `EXEC-codebase-operability-epm-issues-extraction.md`.
- The local OAuth token-store extraction slice is implemented locally in `EXEC-codebase-operability-local-oauth-store-extraction.md`.
- The CSS source split slice is implemented locally in `EXEC-codebase-operability-css-split.md`.
- The EPM payload-helper extraction slice is implemented locally in `EXEC-codebase-operability-epm-payload-helpers.md`.
- The ENG planning capacity utility extraction slice is implemented locally in `EXEC-codebase-operability-eng-planning-capacity-utils.md`.
- The Jira issue fetch helper extraction slice is implemented locally in `EXEC-codebase-operability-jira-issue-fetch-helpers.md`.
- The ENG planning selection-stats extraction slice is implemented locally in `EXEC-codebase-operability-eng-planning-selection-stats.md`.
- The ENG planning capacity-aggregate extraction slice is implemented locally in `EXEC-codebase-operability-eng-planning-capacity-aggregates.md`.
- The capacity service extraction slice is implemented locally in `EXEC-codebase-operability-capacity-service-extraction.md`.
- The dependency-focus utility extraction slice is implemented locally in `EXEC-codebase-operability-dependency-focus-utils.md`.
- The sprint service extraction slice is implemented locally in `EXEC-codebase-operability-sprint-service-extraction.md`.
- The Planning action bar extraction slice is implemented locally in `EXEC-codebase-operability-planning-action-bar.md`.
- The stats cache service extraction slice is implemented locally in `EXEC-codebase-operability-stats-cache-service.md`.
- The Planning capacity bar extraction slice is implemented locally in `EXEC-codebase-operability-planning-capacity-bar.md`.
- The update-check service extraction slice is implemented locally in `EXEC-codebase-operability-update-check-service.md`.
- Keep this as future scope until the user explicitly chooses a slice to execute.
- Convert a chosen slice into a separate `EXEC-*` plan before implementation.
- Do not execute multiple slices that touch `frontend/src/dashboard.jsx` in parallel.
- Do not execute multiple slices that touch `jira_server.py` in parallel.
- Preserve current route contracts, response shapes, cache keys, `Server-Timing` headers, startup request counts, and sticky UI behavior.
- For UI-affecting slices, include Playwright assertions and screenshots.
- For auth, DB, Home/Townsquare, EPM, or plan execution work, follow the `docs/plans/AGENTS.md` gate sweep rules before execution.

## First Executable Slice Recommendation

> **Slice status:** Converted to `EXEC-codebase-operability-verification.md` and implemented locally on 2026-05-28; keep the execution plan as `EXEC-*` until acceptance or merge.

Start with a small operability slice:

1. Add `npm run test:frontend:unit` for `node --test tests/test_*.js`.
2. Add `npm run test:frontend:ui` for Playwright UI specs.
3. Add `make verify` that runs `npm run build`, Python tests, endpoint-security tests, Node tests, and a dist clean check.
4. Document the focused commands in `tests/README.md`.

This slice is low-risk, improves every later refactor, and does not touch `dashboard.jsx` or `jira_server.py`.
