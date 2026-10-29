# EPM Load Performance Metrics Implementation Plan

> **Status:** Done. Executed in `feature/318-epm-load-performance` (issue #318). Kept for audit context only. Started 2026-10-29 from `origin/main` `e5899c34` on branch `feature/318-epm-load-performance` (issue #318). Scope decided by the operator: metrics and graphs only (optimization is a follow-up once real EPM numbers exist); per EPM project; two weekly charts. 

**Goal:** Settings -> Admin -> Performance with Surface `epm` shows, per week, average, median and p95 for "Projects listed" (Home project list arrived) and "Rollup loaded" (rollup fetched, applied and painted), plus a per-project table of rollup time, in the Catch Up weekly grammar (`PerformanceCatchUpWeeks`).

**Architecture:** EPM loads reuse `load_performance` (no migration): `surface='epm'`, `group_id='epm'` (constant; EPM has no Department group, my call), `scope_type` = EPM tab (`active|backlog|archived`), `sprint_id` = selected Sprint or NULL, `index_ms` = Projects listed, `duration_ms` = full load to paint, `lanes` = one lane per EPM project (`project` = Home project id, `durationMs` = that project's rollup time). The all-projects endpoint returns additive per-project server timings (`projectTimings`) because the client sees one request; a single-project load records its own client-observed fetch time. `load_report` derives `epmWeekly` and `epmProjects` over every scanned row and accepts a `projectId` filter applied to lanes. The frontend measurement lives in `frontend/src/epm/epmLoadMeasurement.js` and is driven from `useEpmViewData`; collection is gated by `/api/performance/context` (fetched once, lazily, on the first EPM load, so `dashboard.jsx` and its line ceiling stay untouched).

**Not in scope / known limits:** background (job) refreshes and the lazy Archived per-project rollup are not measured; completeness of EPM rollups stays `unknown` (contextual); no optimization.

## Ordered tasks

- [x] Backend RED/GREEN in `tests/test_load_performance.py`: EPM validator (strict keys, outcome, lane bound 200, lane project string), `record_load` persistence, `epmWeekly` / `epmProjects` math, `surface=epm` / `scopeType` / `projectId` filters, existing surfaces unchanged.
- [x] Backend RED/GREEN in `tests/test_epm_rollup_builder.py` (or the aggregate test file): additive `projectTimings` in the all-projects payload, labeled projects only.
- [x] Frontend RED/GREEN in `tests/test_load_performance.js`: EPM measurement (single emission, cancelled on supersede, error, paint wait, lane shapes).
- [x] Hook integration in `useEpmViewData.js` (no `epmApi.js` change): user-initiated loads only; runtime test in `tests/test_epm_view_source_guards.js`.
- [x] Settings UI: `PerformanceEpmWeeks.jsx` reusing the Catch Up chart component, project filter and table; source guard in `tests/test_performance_settings.js`; Playwright geometry in `tests/ui/load_performance.spec.js`.
- [x] Docs: `docs/ontology.md` entry, `README.md` performance line, `docs/design-system.md` only if a class changes (none planned), `docs/README_ANALYTICS.md` internal-telemetry allowlist line (no product events).
- [x] Full Python and frontend suites, build, structure-budgets test.

## Outcome

Implemented with changes. The implementation is now the source of truth.

- Per-project timings reach the client as an additive `projectTimings` body field, not a header. The frozen Home OAuth parity oracle (`tests/test_epm_home_oauth_parity.py`) now drops that volatile key at capture, as it already ignores `Server-Timing`.
- `PerformanceCatchUpWeeks.jsx` now exports `PerformanceWeeksView` and `PerformanceLineChart` (config-driven) and Catch Up renders through them unchanged; the Catch Up markup tests pass untouched.
- `owner_budgets.json` registers the two new modules, the two new shared interfaces and re-stamps `useEpmViewData` and `PerformanceSettings` digests; the six lint findings that were already on main remain.
- Verification (2026-10-29): full Python suite 2812 tests OK (50 skips, `CONFIG_STORAGE_BACKEND=jsonfile`), frontend unit 3167 passed, `tests/ui/load_performance.spec.js` Catch Up and EPM specs passed in Chromium. The full `tests/ui` run and live-app numbers are not done; no EPM optimization was attempted (follow-up once real numbers exist).

## Current Accuracy

Accurate for the shipped behavior.
