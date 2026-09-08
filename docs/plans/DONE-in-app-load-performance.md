# In-app load performance implementation plan

Status: Implemented and accepted by the user on 2026-09-08; issue #137 baseline instrumentation. This record is retained for audit. The All work feature is a separate implementation.

Goal: Measure real selected-group sprint loads through rendering, persist debug observations, and expose workspace-admin trends and slow-load evidence. Target <=2 seconds, SLO p95 <=4 seconds. This slice does not implement All work or claim capped legacy data is complete.

Architecture: A frontend generation owns concurrent Product/Tech requests and terminates once with success/error/cancelled. Each lane captures duration, unique issue/Epic counts, bytes, cache and backend stages. Collection defaults on when a database is configured; an explicit false debug environment switch disables it. A separate SQL table stores bounded observations with server-derived workspace/environment/revision. Percentiles use raw samples; cache/scope/revision filters prevent mixing workloads. Admin details retain failed/capped observations.

## Contract and file map

- Create backend services/load_performance.py, routes/performance_routes.py and db/migrations/versions/20260908_0014_load_performance.py; modify backend/db/models.py, backend/app.py and backend/security/policy.py.
- GET /api/performance/context: authenticated, returns enabled. POST /api/performance/loads: user_write and standard CSRF, debug-only closed bounded schema. GET /api/admin/performance: explicit tool-admin check, workspace-only summaries/recent samples. No credentials or issue content persisted.
- Create frontend/src/api/performanceApi.js, frontend/src/eng/loadPerformance.js, frontend/src/settings/PerformanceSettings.jsx and styles/settings/performance.css; modify ENG API/hook and dashboard lifecycle/settings seams.
- Reuse Server-Timing; expose debug server counters without extra Jira requests. Unknown completeness/counters stay unknown. Telemetry writes occur after the measured load; no retries or dependency on telemetry success.
- Retain observations for 30 days. Compute average/p50/p95 from raw rows; show count and sparse-sample notice below 20. Chart includes average/p95 and 2/4-second references, expands vertically for spikes. Details split lanes/stages/counts.

## Ordered tasks

- [x] Backend RED/GREEN: strict schema, disabled mode, idempotence, workspace isolation/admin denial, percentile math, error/cap exclusions, retention and migration tests in tests/test_load_performance.py.
- [x] Frontend RED/GREEN: parallel wall-clock timing, counts, cancellation/late responses, single emission and render completion in tests/test_load_performance.js.
- [x] Admin UI and tests: scope/cache/revision filtering, native accessible controls, trend geometry, expandable evidence, permission gating in tests/ui/load_performance.spec.js.
- [x] Integrate ordinary group loads/refresh, debug bootstrap and server timings. Update docs/README_ANALYTICS.md with internal operational telemetry allowlist; do not emit telemetry about itself.
- [x] Run full Python and frontend unit/source-guard suites, local npm ci/Node 20 build, browser screenshots/geometry, Flask startup and /api/test.
- [x] Gather live local sprint baseline with the user's existing auth profile; use observations for a separate All work implementation plan. If live prerequisites are unavailable, state that explicitly without substituting standalone measurements.

Forbidden regressions: no Jira mutations/fan-out, raw issue payload persistence, cross-workspace access, failed request replay, telemetry self-instrumentation, or DB writes inside the timed group-load path. Home write gate remains blocked and unrelated.

## Implementation notes

- Product/Tech lane timings end after response parsing. Counts deduplicate each lane's returned issue keys and the union of Epic detail/scope/parent keys. `payloadBytes` means decoded response UTF-8 bytes, not compressed wire transfer size.
- First applied lane and complete primary group data each use two animation frames as a paint approximation. Full duration includes requested dependency loading. Lazy alerts, manual subtask expansion and in-memory group restoration are outside this sprint-request baseline.
- Initial timing stays in memory while config resolves; it is submitted only when config explicitly enables collection. Data requests never wait for telemetry configuration. Background/aborted loads cannot enter the success distribution. Authentication expiry can prevent persistence; failed telemetry is not retried.
- Server metadata includes workspace, environment and revision. Rebuilt frontend bundles automatically change the local revision fingerprint. Backend-only comparisons should use a distinct APP_REVISION and restart. Report calculations use raw rows, not averaged percentiles; unknown completeness is labelled contextual and capped/failed/cancelled observations remain visible outside latency summaries.
- The new migration adds only the observation table. It does not create a workspace/config row, change auth ownership, or run against the user's database automatically.

## Verification and remaining evidence

Frontend unit suite: 1,152 passed. Full Python suite: 1,569 tests, successful with nine existing opt-in/environment skips. Focused backend/security/migration suite: 66 passed. Browser suite: eight checks passed, covering a 12-second spike, modal scrolling, admin restrictions, exact request counts, delayed dependencies and delayed config enable/discard and concise enabled/disabled empty states. Local Node 20 npm ci/build and git diff --check passed. Screenshots use synthetic data under ignored tmp/load-performance.

A local database runner and environment profile are now available. Collection previously remained disabled because the opt-in flag was absent; collection now defaults on with database storage. Live sprint samples are still pending; no live Jira timing or production performance conclusion is claimed. The All work evidence-driven plan remains the next step after real sprint samples.

Default-on follow-up verification: 21 focused backend tests, 1,152 frontend unit tests and eight browser tests passed; frontend build and diff checks passed. Full Python suite passed (1,569 tests, nine skips) with CONFIG_STORAGE_BACKEND=jsonfile isolating the test baseline from the local DB profile. The initial default-environment run hit sandbox-denied PostgreSQL connections in four existing tests. The local database runner restarted successfully with migrations at head. Live signed-in browser verification remains pending because Firefox computer access was not approved.

## Accepted outcome

The user confirmed collection works. Read-only local DB inspection found three successful loads for one group, one sprint and one revision: 6,396 ms (cache miss, dependencies 3,356 ms), 143 ms (cache hit), and 2,589 ms (cache miss, dependencies 11 ms). All lanes report unknown completeness. These are contextual baseline observations, not All work measurements or an SLO pass. The implementation is now the source of truth; this record preserves the original approach and subsequent verification. Review also fixed cancellation leaving a stale measurement reference that blocked dependencies after cached-group restoration.

Pre-publication review verification: full Python 1,569 tests passed (nine skips), frontend unit 1,153 passed, eight performance browser tests passed, build passed. The cancellation regression was demonstrated failing before the one-line fix and passing afterward.
