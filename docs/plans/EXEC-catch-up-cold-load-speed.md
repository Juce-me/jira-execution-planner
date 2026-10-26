# Catch Up Cold Load Speed Implementation Plan

> **Status:** Planned on 2026-10-26 from `origin/main` at `07a7b68b` on branch `improvement/catch-up-cold-load-speed` (no issue number was supplied; rename to `improvement/<issue>-catch-up-cold-load-speed` if one exists). Not started: nothing is implemented, nothing is pushed, no PR. Baseline measured the same day; the four scope decisions were made by the requester (see Decisions). Revised the same day after one independent review against `docs/plans/AGENTS.md` (no blockers; six P1 and nine P2 findings, each verified against the code before it was folded in: the single-`fetch(` source guard, the two line-budget ceilings, two existing tests that the batch change breaks, a hard-coded chunk name, the lock timestamp on an adopted 401, and the config-gate proof under prefetch, among others), and again after the requester's own second review (nine findings, verified against the code and folded in: complete-or-incomplete dependencies with pagination and no caching of failures, aggregate Jira admission with a G6 multi-user gate, abort propagation through a stalled early body, early 401 adoption through the shared boundary, a server deadline in place of an unmechanized browser-abort promise, end-to-end G5 acceptance measurements, shared ownership between the late script and the app, and HEAD and 304 metadata parity; the lane cap is out of scope by the requester's decision). This plan is its own design record (no separate spec file).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (the requester's stated method) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Catch Up cold-load time with four independent, separately committed changes: gzip for JSON and static responses, concurrent Jira batches inside `/api/dependencies` and `/api/eng/story-readiness`, the admin settings panels out of the entry bundle, and an early prefetch of the two startup reads.

**Architecture:** (1) A response-compression `after_request` module in the Flask app (stdlib `gzip`, no new dependency). (2) A bounded batch runner (per-run cap 4, process-wide helper slots, deadline, rate-limit cooldown) used by the dependency key fetch, which becomes complete-or-flagged (`incomplete: true`, never cached, notice with Retry), and by the readiness child and enrichment searches. (3) `AdminSettingsContainer` becomes the fourth lazy view (manifest, loader, `LazyViewBoundary`). (4) A tiny early script starts `/api/config` and `/api/groups-config` at HTML parse; `apiFetch` adopts each response once, whatever its status, and the script and the app share ownership of each read. No new route, no schema change, no new Jira endpoint, no change to what the client records, and the lane loaders (with their 250-issue cap) are untouched.

**Tech Stack:** Python 3.10+/Flask/Werkzeug/`unittest`; React 19 ES modules; Node 20 `node --test`; Playwright (Chromium); esbuild.

**Spec:** this document's "Why", "Decisions", "Expected behavior", "Gates" and "Global Constraints".

## Why (evidence)

From the 2026-10-25 production HAR (requester's figures): one Catch Up load took 8,236 ms (lanes 286 and 526 ms, dependency tail about 7,515 ms); the data requests start about 3.4 s after page start (entry `dashboard.js` 1.46 MB took 2.5 s); `/api/eng/story-readiness` took about 6.3 s; no compression was seen. Production topology is not in the repo: `Dockerfile` runs gunicorn (1 worker, 8 threads) on port 5050; TLS and ingress are SRE-owned (`INSTALL.md` section 8). The HAR is the only evidence about the ingress, and it shows no `Content-Encoding`.

Two premises of the request were checked and are wrong; the plan is built on the corrected facts:

1. **The dist assets are not `no-store`.** `jira_server.py:3353` sets `no-store` on the epic-alert bundle JSON, not on the JS bundle. `/frontend/dist/*` goes through `send_from_directory` (`jira_server.py:6237`) and gets Flask's defaults: `Cache-Control: no-cache`, `ETag`, `Last-Modified`, and a conditional request returns 304 with no body (verified with the Flask test client). A returning user already skips the 1.48 MB body when the file is unchanged; the HAR's 2.5 s download was a full 200 (first visit, load after a deploy, or a disabled cache). The entry `dashboard.js` is not content-hashed. Decision: leave the headers alone.
2. **Dependencies and readiness are not in series on the client.** Both are gated on the same lane-done condition (`dashboard.jsx:4543-4545` for dependencies, `useStoryReadiness({ primaryReady: sprintWorkLoaded })` at `dashboard.jsx:3730` for readiness) and fire in the same millisecond (638 and 639 ms in the waterfall below). The serial chains are inside each endpoint: `collect_dependencies` runs two rounds of `fetch_issues_by_keys` with one Jira search per 100 keys, one after another (`backend/jira_client.py:322-344`); `_story_readiness_compute` (`backend/routes/eng_routes.py:362`) runs sprint-page validation, discovery, `/rest/api/3/field`, then every child batch, then every enrichment batch serially. Readiness needs no lane data (its request carries group and sprint scope only), and the measured "Fully loaded" clock includes dependencies but not readiness (`useEngSprintData.js:523-527`).

### Measured baseline (2026-10-26, base `07a7b68b`, synthetic data, numbers only)

| Measure | Baseline |
|---|---|
| `make test` | Ran 2,423 tests, OK (skipped=50), 148 s |
| `make test-security` | Ran 82 tests, OK |
| `npm run test:frontend:unit` | 3,057 pass, 0 fail |
| Extraction lint (`scripts/extraction_lint/run.sh`) | exit 1; six enforced problems (GroupBoardSettings `expandedInputCount` and unresolved inventory, `useTeamCatalogLifecycle` x1, `useTeamGroupSettings` x3); 104 ESLint warnings, 0 errors; 83 modules |
| `npm ci` + `npm run build` | `frontend/dist` reproduces with no diff |
| Chromium `tests/ui` (full, `--workers=4`, `JEP_TEST_BASE_URL` on 5074, machine loaded by other work) | 1,930 passed, 12 skipped, 6 failed in 24.2 min. Failures: `design_system_hover_surfaces.spec.js:813` (30 s test timeout) and `eng_board_progressive_loading.spec.js` lines 535, 594 and the three `604` cases (four "campaign server startup timed out" and one `rejects.toThrow` diagnostic). All six pass when their two files are rerun alone (12 passed in 1.0 min); cause is load (the memory-noted load-sensitive class), no user impact, reproducible only under load, remedy is to rerun alone |
| Entry `dashboard.js` | 1,479,635 B raw; gzip-6 433,102; gzip-9 432,054; brotli-11 346,722 |
| `dashboard.css` | 361,261 B raw; gzip-6 52,342 |
| Shared chunk `chunk-AMILAIYK.js` / `StatsPanel-*.js` | 84,453 / 78,189 B raw; gzip-6 28,569 / 19,884 |
| Static closure of the entry (entry + 4 shared chunks) | 1,576,866 B raw |
| Synthetic 250-issue lane JSON | 140,506 B raw; gzip-6 9,023 (6.4%) |
| gzip-6 CPU, median of 5 | entry 32 ms, css 5 ms, 140 KB lane JSON 0.8 ms |
| Real Flask static route, Chromium, 4,000 kbps down, 40 ms latency, median of 5 | `dashboard.js` 3,019 ms; `dashboard.css` 776 ms; chunk 218 ms; none had `Content-Encoding` |
| Waterfall, every API call delayed 100 ms, instant entry, median of 3 | first lane request 562 ms (runs 444, 562, 699) |
| Waterfall, API 250 ms, instant entry, median of 3 | first lane request 842 ms (800, 842, 925) |
| Waterfall, API 100 ms, entry delayed 800 ms, median of 3 | first `/api/config` 1,037 ms; first lane request 1,298 ms (1,262 to 1,301) |
| Waterfall, API 250 ms, entry delayed 800 ms, median of 3 | first `/api/config` 1,041 ms; first lane request 1,600 ms (1,548 to 1,650) |
| Request order (in the three runs printed in full) | static chunks, then `/api/config` with `/api/groups-config` together, then `/api/sprints`, then both lanes with `/api/team-catalog`, then dependencies, readiness, both alert lanes and missing-info within 1 ms of each other |
| `collect_dependencies`, fake Jira at 100 ms per call | 100 keys: 2 serial calls, 222 ms; 250 keys: 5 calls, 535 ms; 500 keys: 8 calls, 859 ms |
| Entry with `AdminSettingsContainer` stubbed (upper bound, not a build) | 1,406,321 B raw (-73,295) and gzip-9 416,677 (-16,537) vs 1,479,616 / 433,214 |

Critical path to the first lane request (code and waterfall agree): entry download and evaluation, then `loadConfig()` and `loadGroupsConfig()` in parallel (`dashboard.jsx:1717-1722`), then `loadSprints()` once groups, onboarding and the admin gate allow it (`dashboard.jsx:1724-1728`), then the lane effect (`dashboard.jsx:3488-3579`). That is two sequential API levels after the entry runs: the first lane request time is about the entry-ready time plus two API latencies plus 55 ms.

## Decisions

Made by the requester (2026-10-26, after the brainstorm):

1. **Compression:** Flask gzip with no new dependency, in the app. Brotli is deferred.
2. **Dist caching headers:** unchanged.
3. **Item 3 scope:** inner parallelism only, capped at 4; both endpoints still start where they start today, after both lanes. Readiness does not move earlier.
4. **Item 2 scope:** early prefetch of `/api/config` and `/api/groups-config` only; sprints and lanes keep every current gate.
5. **Order and commits:** compression, dependencies and readiness, lazy admin settings, early prefetch; one commit per item, each with its tests, its docs and (for frontend items) its rebuilt `frontend/dist`. Item 4 (early prefetch) is last and independently revertable; it is the first to drop if a contract cannot be kept.
6. **Lane cap (second review, 2026-10-26):** the 250-issue lane cap (`jira_server.py:3382`) is out of scope. The lane loader is untouched; the plan guards that none of the four items changes completeness at more than 250 issues per lane, and a separate follow-up is offered.
7. **Incomplete dependencies (second review, 2026-10-26):** `/api/dependencies` returns `200` with `incomplete: true` and the partial map when any batch fails or is cut short, never caches that result, and the Catch Up view shows a notice with Retry that reuses the readiness notice. Key batches follow continuation tokens, so a short page is no longer dropped silently.

My calls (the requester may override each; none is an agreement):

1. gzip level 6; threshold 1,024 bytes; status 200 and GET or HEAD only; allowlisted types `application/json`, `text/javascript`, `application/javascript`, `text/css`, `text/html`, `image/svg+xml`. HEAD is treated exactly like GET for its headers (same `Content-Encoding`, weak ETag, `Vary` and `Content-Length` as the GET would carry; only the body is dropped by the server). Source maps (`*.map`, served as `application/json`, 5.8 MB for the entry) are never compressed: they are not on the load path. A generator response (`is_streamed and not direct_passthrough`) is never touched; `send_file` responses are streamed but `direct_passthrough`, and those are the static files this change targets.
2. Static `/frontend/dist/*` responses are compressed once per process and memoized by path and ETag (at most 32 entries, evicting the oldest), behind a lock so concurrent cold requests compress once; JSON responses are compressed per request, never memoized.
3. `/api/auth/*` is never compressed (token-bearing responses; they are under the threshold anyway). Nothing user-specific is memoized.
4. Every response of an allowlisted type, and every 200 or 304 for a `/frontend/dist/*` target, carries `Vary: Accept-Encoding` merged into every existing `Vary` line (Flask-CORS sets `Vary: Origin`; `response.vary` reads only the first line, so the merge is done on `headers.getlist('Vary')`), whatever the client sent, because the representation depends on that header. A compressed response also gets a weak ETag (`W/"..."`) and no `Accept-Ranges`; a 304 for a compressible static target carries the validators of the 200 it stands for (RFC 9110), so conditional requests keep returning 304 across gzip, identity and `gzip;q=0` clients.
5. Concurrency has two limits, both in the new `jira_batches` module. Per run: `JIRA_BATCH_CONCURRENCY = 4`, the Board child scheduler's number (`ENG_BOARD_MAX_CHILD_SEARCHES`). Process-wide: `JIRA_BATCH_GLOBAL_SLOTS = 6` helper workers across every run in the process; each run always has its own first worker, and extra helpers start only if a slot is free without waiting, so a busy process degrades to today's one-call-at-a-time behavior per run and never starves or deadlocks. After a rate-limited failure no helper starts for `RATE_LIMIT_COOLDOWN_SECONDS = 10`. `max_concurrency=1` runs inline and is exactly today's behavior (it keeps today's implicit request-context resolution); a cap above 1 passes the resolved auth context to every worker. This bounds worker threads, not Jira calls per second; see runtime feasibility.
6. For `/api/dependencies` only `collect_dependencies` callers that pass `max_concurrency` change; the second caller (`jira_server.py:4071`) and `/api/issues/lookup` stay serial and non-strict.
7. Readiness runs its child and enrichment batches in one shared queue (they depend only on the discovered epic keys, plus the Epic Link field id for children). Sprint validation, discovery and the `/rest/api/3/field` call stay in today's serial order, and readiness keeps its own 25 s budget and error classification (`outcome.raise_if_failed()`). Its `Server-Timing` keeps the same four segment names; `child-distribution` and `enrichment` become the elapsed span of their group of batches and may overlap, `total` stays the wall time.
8. The early prefetch adopts at most once and only a GET with the same URL, method and cache mode, within 30 s of the request start. It adopts every HTTP response, including 401 and 5xx, so the shared boundary (`performApiFetch`) sees exactly what it would see from its own request and the ownership contract's "every application 401 locks the document" holds; the lock is stamped with the early request's start time (`startedAtEpoch`), which is what `authRecoveryCoordinator.js:66` compares with a recovery success. Only a network error (no response) falls back to a normal request. The caller's `AbortSignal` is linked to the early fetch's own controller, so aborting during headers or during the body stops it, and the existing 15 s startup timeout still ends a stalled body. The early request sends no `Referer`.
9. The early script and the app share ownership of each startup read through the `window` slot: whichever side reaches a key first claims it. The app, when it reaches a read the script has not started, marks it claimed by the app, and a later script skips it, so each endpoint is requested exactly once whatever the arrival order.
10. The `config_bootstrap` `api_result` duration of an adopted response is measured from the early request start to the earlier of the moment the early response settled and the moment it was adopted, so the existing metric keeps meaning "time to get the config" and does not absorb the wait for the entry.
11. The early script is `<script async>` placed first in `<head>`, before the stylesheet links, because a classic deferred script waits for pending stylesheets exactly like the module entry. Gate G4a is measured with the stylesheet and font requests delayed as well.
12. `/api/dependencies` gets a server deadline of 25 s (`_DEPENDENCIES_DEADLINE_SECONDS`, readiness's value). Each Jira call's timeout is `max(1, min(30, remaining))`, so no call outlives the deadline by more than about a second; after the deadline, a failure or a rate limit no new batch is admitted, the caller returns what completed with `incomplete: true`, and stuck workers finish on their own timeouts and release their slots. A browser abort cannot reach a synchronous handler (gunicorn gthread does not detect client disconnects), so the deadline plus admission stop is the cancellation mechanism, not the abort.
13. Retry behavior of the shared Jira client is unchanged. In particular it does not honor `Retry-After` outside diagnostic mode (`backend/jira_client.py:263`: exponential backoff with jitter, at most 4 attempts and 10 s); fixing that affects every caller and is parked. Inside this change a rate-limited batch (`upstreamStatus == 429`) stops admission and starts the cooldown above.
14. Test scope: each task runs the specs that touch what it changes (listed in the task); the full Chromium run is at the Task 4 commit (it changes the bootstrap every spec uses) and again only if a later commit changes code.

Not done here (parked in `docs/TODO.md` by Task 5): the 250-issue lane cap and the fact that the task list can drop issues beyond it (decision 6; a separate design on the performance-critical initial-load path); continuation-token handling for the other `fetch_issues_by_keys` callers (`/api/issues/lookup`, epic record fetches); unbounded key count on `/api/dependencies` (the client sends one key per Story of both lanes, so worst-case Jira calls are `ceil(N/100) + ceil(M/100)` plus continuation pages; a hard cap would change the contract); caching successful key batches individually so a Retry redoes only the missing work; honoring `Retry-After` in the shared retry loop; running sprint validation and the `/field` call concurrently with discovery; `immutable` caching for hashed chunks; brotli; a page-start-to-list metric (`startOffsetMs`); preloading the static chunks; the alerts fetch duplicating the lane payloads; the per-Epic refresh paths (`refreshEpicDependencies` and the freshness adapter) merging `/api/dependencies` answers without checking `incomplete`.

## Expected behavior

- A client sending `Accept-Encoding: gzip` receives gzip for allowlisted responses of 1 KB or more; everyone else receives today's bytes with the same validators. GET and HEAD describe the same representation. Streams, ranges, errors, `/api/auth/*` and already-encoded bodies are untouched. Conditional requests on static files still return 304.
- `/api/dependencies` and the readiness endpoint return the same data as before for the same Jira data, and finish sooner. For dependencies, "the same data" is judged against independently computed expected keys, not against the old code: key batches follow continuation tokens, and any failed, cut-short, rate-limited or late batch makes the response `incomplete: true` (partial map, never cached, notice with Retry in the UI) instead of a silent 200. At most 4 Jira searches per run and at most 6 helper workers per process are in flight beyond each run's first worker.
- The first open of Settings, Admin loads one extra chunk and shows "Loading Admin settings…" until it arrives; the second open renders at once; a failed load shows the existing Retry or Reload message. Every other Settings tab is unaffected.
- With the early script blocked, failing, stale or late, the app behaves exactly as before and requests each startup read once. With it working, `/api/config` and `/api/groups-config` are each requested once and begin before the entry is evaluated, even while the stylesheet and fonts are still loading; a 401 or 5xx on them is handled by the same shared boundary as any other response, and a stalled body still ends in the existing startup timeout, connection banner and Retry.

## Acceptance criteria

The change is accepted when each of the following is verified at the final head (numbers recorded in Execution Status):

1. Every gate in the Gates table passes, or a divergence is recorded and the requester has accepted it.
2. `make test`, `make test-security`, `npm run test:frontend:unit`, the extraction lint (same six identities, at most 104 warnings), `make verify-dist-clean` and the full Chromium `tests/ui` run pass against the Task 0 baseline; every failure is explained (cause, user impact, reproducibility, remedy) before it is accepted as pre-existing.
3. `.venv/bin/python jira_server.py` on a port other than 5050 starts without dependency warnings before the Flask banner and `/api/test` answers.
4. Allowlisted responses are gzip-encoded for clients that accept it and carry matching validators for gzip, identity and `gzip;q=0` clients on GET, HEAD and conditional requests; streams, ranges, `/api/auth/*`, `.map` files behave as the Task 1 tests pin.
5. Dependencies are complete or explicitly incomplete: scopes with more than 100 keys and continuation pages return every independently expected edge; a failure in either round, a deadline or a 429 yields `incomplete: true`, is never cached, shows the notice, and the next request retries the missing work. Readiness returns the same JSON and issues the same Jira searches at cap 4 as at cap 1. Every worker call carries the explicit auth context.
6. Aggregate Jira pressure is bounded: with both endpoints running for 1, 4 and 8 simultaneous users the process never exceeds its helper-slot limit, no user fails, and per-user p95 and another user's responsiveness are no worse than baseline (G6).
7. The first Settings -> Admin open loads its chunk once, shows "Loading Admin settings…", and recovers from a failed load without losing drafts; no other Settings tab changes.
8. With the early script working, blocked, failing, late, stale or answered with an error, the app issues the same requests as before except that the two startup reads begin earlier and happen once each; a 401 locks exactly once; a stalled body ends in the existing timeout; the pinned configuration-bootstrap gate holds with the early config held.
9. End-to-end acceptance measurements (G5) show navigation to a usable list and navigation to dependencies and readiness settled no worse than baseline at p50 and p95 in every scenario and clearly better on the throttled profile, with no extra long tasks or heap; production metrics (`loadPerformance.js` records) are unchanged.
10. The 250-issue lane cap is unchanged and guarded: the four items do not alter what a scope above 250 issues per lane returns or signals.
11. The diff touches only File Map paths; no analytics event, route, schema, credential or Jira write path changed; docs are updated as each task lists.

## Forbidden regressions

What the client records (`frontend/src/eng/loadPerformance.js`, one record per load, including the Playwright test "real dashboard emits one measured load after both lanes and delayed dependencies", which stays green and unchanged; the acceptance measurements are separate harness output and never replace or alter a production metric); the config-bootstrap gates (`expectConfigBootstrapHoldsJiraWork` stays unchanged: no `/api/sprints`, lane or Board request before the first `/api/config` read has returned); the cache-first sprint startup rule; any Jira request earlier than today; any Jira write or credential path; the Cache-Control and security headers (`no-store` on `/api/*`, `no-cache` on dist, CSP, `Vary: Origin`); streaming of the Board NDJSON and scenario SSE responses; token-bound CSRF and global-auth-lock behavior (every application 401 locks the document once and is never swallowed or replaced); the share-link address-bar cleanup (no share-link query may leave the page through the prefetch); analytics event names and parameters; the lane loaders and the 250-issue cap; `frontend/dist` edited by hand; any weakened or deleted test.

## Gates (measured, numbers only; recorded in "Execution Status" by the owning task)

| Gate | Method | Baseline | Threshold |
|---|---|---|---|
| G1a entry encoded body | one-off measurement with the Flask test client and real Flask on 5073, `Accept-Encoding: gzip`; the committed test asserts only the ratio at most 0.35 | 1,479,635 | at most 440,000 bytes (one-off) |
| G1b css / largest shared chunk / Stats chunk | same (the committed test finds the largest `chunk-*.js` by scanning dist, because chunk names are content hashes) | 361,261 / 84,453 / 78,189 | at most 56,000 / 30,000 / 21,000 bytes (one-off); committed ratios at most 0.20 / 0.40 / 0.40 |
| G1c synthetic 250-issue lane JSON | route test body built in the test | 140,506 | ratio at most 0.10 |
| G1d throttled transfer (4,000 kbps, 40 ms, median of 5) | Appendix A transfer harness | entry 3,019 ms; css 776; chunk 218 | at most 1,200; 300; 150 ms |
| G1e CPU and reuse | `time.process_time()` around the first entry compression, plus a compress-call counter | 32 ms per entry (idle machine) | at most 100 ms of process time; second request compresses nothing |
| G1f metadata parity | tests for gzip, identity and `gzip;q=0` clients on GET, HEAD, conditional GET and conditional HEAD | n/a | ETag, `Vary`, `Content-Encoding` and `Content-Length` of HEAD equal GET's; every 304 carries the validators of its 200 |
| G2a dependencies, 500 keys, fake Jira 100 ms per call | Appendix A deps harness, median of 5 | 8 serial calls, 859 ms | same 8 calls, peak per run at most 4 (asserted by test), wall at most 500 ms (expected about 360: 3 waves plus 59 ms of fixed overhead) |
| G2b readiness compute, 160 epics (sprint 1 page, discovery 2 pages of 100, field 1, 4 child + 4 enrichment batches = 12 serial calls today), fake Jira 50 ms per call | readiness harness in Task 2 | recorded in Task 2 step 1 (expected about 600 ms) | wall at most 65% of baseline, peak at most 4 |
| G2c completeness | dependency tests against a fake Jira whose dataset is generated independently of the code under test, with pages of at most 50 and continuation tokens, more than 100 keys, edges in both rounds | n/a | every expected edge present, none invented; same set of Jira payloads at cap 1 and cap 4 (continuation payloads included) for complete runs |
| G2d failure contract | tests: a batch failure in round one, in round two, a deadline, a 429 | n/a | `incomplete: true` with a reason, partial map, nothing written to `DEPENDENCIES_CACHE`, next request retries and caches; no batch starts after the failure; no worker alive after the stalled call is released |
| G3a entry raw and gzip-9 (Python `gzip.compress(bytes, 9, mtime=0)` of `frontend/dist/dashboard.js`) | rebuilt committed dist | 1,479,635 / 432,054 | at most 1,429,635 / 421,000 (upper bound measured: -73,295 / -16,537) |
| G3b static closure raw (entry + chunks it imports statically) | build output | 1,576,866 | at most 1,526,866 |
| G3c first-open behavior | Playwright; first inspect the build output and list the chunks reachable from the Admin chunk that the entry does not already import statically (the Admin-exclusive chunks; shared chunks the entry needs are excluded) | n/a | zero Admin-exclusive chunk requests before the Admin tab opens, one request per such chunk on first open, none on reopen |
| G4a first `/api/config` request with the entry delayed 800 ms, run twice: instant stylesheet and fonts, and stylesheet and fonts delayed 600 ms | Appendix A waterfall harness | 1,001 to 1,100 ms | at most 300 ms in both variants |
| G4b first lane request, median of 5 runs back to back with a baseline re-run | same, entry delayed 800 ms, API 100 and 250 ms | 1,298 and 1,600 ms (re-baselined) | at most baseline minus 0.6 x API latency |
| G4c request multisets | same, plus a variant where the early script arrives after the app has started and one where it arrives between the two loader calls | one `/api/config`, one `/api/groups-config` | unchanged counts in every order; no `Referer` on the early requests; app loads with the script blocked |
| G5 end-to-end acceptance (browser) | new harness (Task 0): real Flask serves the page and `dist` under the 4,000 kbps / 40 ms throttle, the API is stubbed with the modeled latency profile; scenarios: small scope (2 issues per lane) and large scope (250 issues per lane, 500 dependency keys), cold (empty HTTP cache) and warm (second navigation), plus failures (incomplete dependencies, early 401, stalled early body, aborted Admin chunk); 10 runs each; CDP `Performance.getMetrics` for heap and a `longtask` observer; it exercises client-side changes only, because the API is stubbed | Task 0, 2026-10-26, base `07a7b68b` (`e2e-baseline.json`): 10 runs per cell, nearest-rank p50 / p95, load average rising from 10 to 45 on 8 cores (other Playwright runs and antivirus scans). Cells in the order throttled small, throttled large, unthrottled small, unthrottled large, each cold then warm. Navigation to usable list ms: 5,066 / 5,151, 1,053 / 1,107; 5,397 / 5,891, 1,354 / 1,726; 1,187 / 1,401, 1,022 / 1,148; 1,758 / 2,044, 1,648 / 2,075. Navigation to dependencies and readiness settled ms: 7,108 / 7,194, 3,091 / 3,154; 7,629 / 8,158, 3,560 / 4,112; 3,252 / 3,621, 3,056 / 3,213; 4,171 / 4,333, 3,966 / 4,898. Long-task total ms: 57 / 124, 0 / 0; 1,309 / 1,825, 1,128 / 1,834; 106 / 160, 0 / 0; 1,623 / 1,935, 1,755 / 2,077. JS heap at settle MB: 11.7 / 13.0, 16.1 / 17.2; 66.1 / 69.6, 77.3 / 86.7; 11.7 / 13.1, 17.2 / 18.9; 53.4 / 84.8, 84.6 / 86.6. Entry transfer 1,479,935 B cold, 300 B warm (304). A back-to-back repeat of the unchanged code drifted 0.60x to 1.20x on the usable and settled percentiles, 0x to 2.16x on long-task totals and 0.80x to 1.10x on heap (see Divergences). Failure scenarios are asserted by the Task 2a, 3 and 4 specs, not by this harness | compared against a baseline run back to back in the same session at the same load (interleaved before/after runs, never the Task 0 numbers alone): p50 and p95 of navigation to a usable list and to settled no worse than 1.25 x baseline in every scenario (1.25 is the measured drift of two identical runs, 1.20); cold throttled usable-list p50 at most 70% of baseline (warm loads revalidate the entry as a 304, so compression and the 70% bound do not apply to them); long-task total no more than baseline plus 200 ms or 1.25 x, whichever is larger; JS heap, read after a forced garbage collection, no more than 1.10 x baseline; every failure scenario shows its expected recovery (asserted by the Task 2a, 3 and 4 specs) |
| G6 aggregate admission (server) | new Python harness (Task 0): 1, 4 and 8 simultaneous users each running dependencies and readiness against one fake Jira (50 ms per call) behind a 15-connection database-session semaphore (SQLAlchemy's default 5 plus 10 overflow), with a bystander probe issuing one Jira call every 100 ms, and a 429 injected for one user | Task 0, 2026-10-26, base `07a7b68b` (`admission-baseline.json`): 10 iterations per user, each running dependencies over 500 keys then readiness over 160 epics, all users released together per iteration; the semaphore slot is held for the whole fake call (an upper bound: the code holds the session only for the token lookup); load average 8 to 9. N = 1 / 4 / 8: per-user total p50 1,156 / 1,166 / 1,177 ms, p95 1,205 / 1,231 / 1,226 ms (worst user p95 1,205 / 1,296 / 1,282; dependencies p50 458 / 458 / 463, readiness p50 693 / 705 / 715); 20 Jira calls per user and iteration (8 dependencies, 12 readiness; totals 200 / 800 / 1,600); peak concurrent Jira calls 1 / 4 / 8 (9 with the bystander); helper calls 0; session wait total 6.1 / 12.3 / 12.8 ms, max 0.8 / 1.3 / 1.8 ms; failures 0; bystander p95 60.6 / 65.7 / 64.9 ms (p50 55.5 / 57.7 / 56.3). 429 pass (every call of one user answers the synthetic 503 with `upstreamStatus` 429): that user's dependencies return an empty map with no error (5 calls, 0 of 250 edges, round two skipped) and its readiness raises `jira_unavailable` after one call; the other users have 0 failures (N = 4 / 8 total p95 1,220 / 1,283 ms; bystander p95 63.8 / 61.9 ms). A back-to-back repeat: per-user p95 1,208 / 1,334 / 1,277 ms, bystander p95 60.5 / 62.2 / 67.9 ms | per-user p95 at most 1.15 x baseline for every user count (the measured drift of two identical runs was 1.08) and, for N = 4 and 8, at most the baseline; total Jira calls per user equal; peak helper workers at most 6; zero failures; no session wait over 250 ms; bystander p95 at most 1.25 x baseline; after the 429 no helper starts for 10 s |

Production effect is not verifiable here (no live data, no ingress): after deploy, read the weekly List loaded and Fully loaded charts in Settings -> Admin -> Performance (numbers only). The first-lane clock starts at the data requests, so those charts will not show the compression or early-prefetch gain; only a fresh HAR will.

## Global Constraints

Every task's requirements include this section.

- **Environment:** Python via `.venv/bin/python` with `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile` (the Makefile's `PYTHON_TEST_ENV`); Node 20 via `fnm exec --using 20`; `npm ci` before `npm run build`; never hand-edit `frontend/dist`. Playwright one spec at a time with `--browser=chromium --workers=1` during iteration; set `JEP_TEST_BASE_URL=http://127.0.0.1:<port other than 5050>` for every Playwright run, because the fixtures default to 5050, which is the requester's server. Servers started for measurement use ports 5072 to 5074 and are stopped afterwards.
- **Data:** synthetic data only; live data stays read-only and transient; no screenshots of live data; the requester signs in themselves; never enter credentials.
- **Git:** work on `improvement/catch-up-cold-load-speed` (zero inherited commits, verified). Commit subjects at most 72 characters; no agent or tool attribution and no `Co-Authored-By`. Every commit uses the noreply identity through one-shot flags: `git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit ...`. After every commit run `git show --stat HEAD`, `git status --short` and `git log -1 --format='%an <%ae>'` and read them (Gate A). Do not push or open a PR until the requester says so; publication then follows the AGENTS.md section 10 transaction (fetch base, record SHAs, compare commit list and files with this plan, PR body through stdin, verify remote head and rendered body, report CI), with no secrets, local paths or real issue keys in the PR text.
- **Registry:** `scripts/extraction_lint/owner_budgets.json` lists the settings owner modules and `dashboard.jsx`; when a task changes a registered file, re-sync that file's ceilings, `unresolved` inventory and `sourceDigest` deliberately in the same commit (recipe in `docs/plans/EXEC-catch-up-weekly-load-performance.md`, Task 2 step on `check_hook_interfaces.mjs --write-inventory`) and run `tests.test_codebase_structure_budgets`. The gate is the same six problem identities and no more than 104 ESLint warnings, never a zero count. No CI runs the lint.
- **Tests:** an existing test that pins the old shape (for example the static `AdminSettingsContainer` import) is updated to pin the new shape, with its assertion strength kept; no test is weakened or deleted.
- **UI:** a frontend control or layout change gets element-level assertions and a screenshot that is looked at (MRT020, MRT021); reuse `.stats-note`, `LazyViewBoundary` and its Retry control; no new class, font, radius or button style.
- **Analytics:** none of the four items adds or changes an event. `docs/README_ANALYTICS.md` gets the allowlist rows named in each task.
- **Postmortems to honour:** MRT009 (sticky layering: no sticky or z-index change here), MRT010 (startup request fan-out: no extra startup request, no heavier endpoint), MRT017 (readout placement: no readout touched), MRT020 and MRT021 (reuse shared controls, never override a shared component's layout).

## Review Focus

Conditions the plan implies but the obvious tests would miss; each has a test in the owning task.

1. A client that sends `Accept-Encoding: gzip` and `If-None-Match` for an unchanged static file must still get 304, the ETag it stored from the compressed response must match, and HEAD must describe the same representation as GET for gzip, identity and `gzip;q=0` clients (Task 1).
2. The Board NDJSON stream and the scenario SSE with gzip accepted must still deliver chunks as they are produced and carry no `Content-Encoding` (Task 1).
3. Dependencies never look complete when they are not: a short Jira page with a continuation token, a failure in round one or round two, a deadline, or a 429 must give `incomplete: true`, no cache entry, a visible notice, and a retry that redoes the missing work; a scope above 250 issues per lane must neither change nor be hidden by the new code (Task 2).
4. A stalled upstream call and a rapid scope switch: the deadline returns what completed, no batch starts after it, stuck workers release their slots when their own timeout ends, and the next request succeeds (Task 2).
5. Several users at once: the process-wide helper limit holds, nobody fails, and another user's single call stays responsive (Task 2, G6).
6. The admin chunk fails to load on first open (offline, or a stale build after a deploy): Retry or Reload recovers, unsaved drafts held by `App()` are untouched, and the other Settings tabs keep working (Task 3).
7. The early response is unusable or hostile: a 401 (even when a fresh request would succeed) locks the document once with the early request's start time, and a groups 401 with a config 200 does too; a 5xx is handled as any 5xx; headers followed by a stalled body end in the existing 15 s timeout, banner and Retry; the script arriving after the app started, or between the two loader calls, never duplicates a read; a share-link query is never sent as a `Referer` (Task 4). While the early `/api/config` or `/api/groups-config` is held, the mounted app still makes no sprint, lane or Board request, and makes them once it is released (Task 4; the existing `expectConfigBootstrapHoldsJiraWork` helper cannot prove this because its poll succeeds before the entry is evaluated).

## File Map

- **Task 0:** modify `docs/plans/README.md` (index entry) and, for the startup gate sweep, `docs/plans/GATE-05-home-write-capability.md` (the `Checked on`, `Last result` and `Next review` fields only; the requester confirms this edit with the plan, see Task 0). The G5 and G6 harnesses live in gitignored `tmp/cold-load-speed/` and are copied into Appendix A when written.
- **Task 1:** create `backend/response_compression.py`, `tests/test_response_compression.py`; modify `backend/app.py` (register first, so it runs last), `tests/test_eng_board_routes.py` (gzip accepted on the real Board stream route), `README.md` (Performance & Caching section and the hosting checklist) and `INSTALL.md` (one hosting note), `docs/ontology.md`, `docs/README_ANALYTICS.md`.
- **Task 2 (commit 2a, runner and dependencies):** create `backend/services/jira_batches.py` (`run_batches`, `BatchOutcome`, `JiraBatchIncomplete`, the limits), `tests/test_jira_batches.py`, `tests/test_dependencies_concurrency.py`, `tests/ui/dependency_incomplete_notice.spec.js`; modify `backend/jira_client.py` (`fetch_issues_by_keys` gains `max_concurrency=1`, `strict=False`, `deadline=None` and continuation handling in strict mode), `jira_server.py` (`jira_search_request` gains an optional `timeout`; `fetch_issues_by_keys` and `collect_dependencies` gain the same keywords; net lines kept at or below the ceiling by compact pass-through, or the ceiling raised with its justification comment), `backend/routes/eng_routes.py` (the dependencies route: deadline, strict call, `incomplete` response, no cache on incomplete), `frontend/src/dashboard.jsx` (one state cell, set in `fetchDependencies`, two props passed to `EngView`), `frontend/src/eng/EngView.jsx` (the notice, reusing the readiness notice markup and its registered class hook), `tests/test_issue_edit_cache_generation.py` (its `blocked_collect(keys, context=None)` stub at line 78 widens to accept the new keywords), `tests/test_jira_issue_fetch_helpers.py` (cap, strict and continuation tests for `fetch_issues_by_keys`), `tests/test_codebase_structure_budgets.py` and `scripts/extraction_lint/owner_budgets.json` (the `jira_server.py` and `dashboard.jsx` ceilings, each with a justification comment as the file's precedent requires), `docs/design-system.md` only if the notice kind's entry needs the second use named, `docs/ontology.md`, `docs/README_ANALYTICS.md`; rebuild `frontend/dist`.
- **Task 2 (commit 2b, readiness):** modify `backend/routes/eng_routes.py` (`_story_readiness_compute` uses `run_batches`), `tests/test_story_readiness.py` (new tests, plus the existing compute test at line 540 pinned to cap 1 or turned order-insensitive), `docs/ontology.md`.
- **Task 3:** modify `scripts/build_dashboard.mjs` (`adminSettings` is appended last in `views`), `frontend/src/components/lazyViewLoaders.js`, `frontend/src/dashboard.jsx`, `scripts/extraction_lint/owner_budgets.json` (the `dashboard` ceiling and the registry entries that changed), `tests/test_codebase_structure_budgets.py` (the `dashboard.jsx` ceiling, with a justification comment), `tests/test_lazy_view_loaders.js`, `tests/test_dashboard_split_build.js` (including the pinned view order, which gains `adminSettings` last), `tests/test_epm_settings_source_guards.js`, `tests/ui/lazy_view_boundary.spec.js`, `tests/ui/codebase_structure_smoke.spec.js`, `tests/ui/settings_admin_access.spec.js`, `docs/ontology.md`; rebuild `frontend/dist` (entry, chunks, `lazy-views-*.json`, maps).
- **Task 4:** create `frontend/src/api/earlyBootstrapContract.js`, `frontend/src/api/earlyBootstrap.js`, `frontend/src/api/earlyBootstrapRegistry.js`, `tests/test_early_bootstrap.js`, `tests/ui/early_bootstrap.spec.js`; modify `frontend/src/api/http.js` (`performApiFetch` adopts; `trackedFetch` timing; both existing `fetch(` call sites stay, the second one in `apiFetchHeaders` for streaming is untouched), `frontend/src/api/configApi.js` only if the contract needs the loaders' request shapes exported, `tests/test_frontend_api_source_guards.js` (the guard keeps exactly two `fetch(` sites in `http.js` and gains a narrow pinned exception for `earlyBootstrap.js`, with mutation tests modeled on `withoutMountedManifestFetch`, and the `loadHttpHelpers` stub gains the new imported names), `jira-dashboard.html` (one `<script async>` first in `<head>`), `package.json` (`build:early`, `watch:early`, wired into `build` and `watch`), `tests/ui/epm_home_token_fixture.js` and the four other specs that serve the real HTML (`auth_focus_refresh_counts`, `scenario_draft_collaboration`, `scenario_draft_history`, `ga4_tag_and_events`) so they route the new asset, `tests/test_analytics_source_guards.js` and `tests/test_auth_entry_page.py` only if they pin the script list, `docs/ontology.md`, `docs/README_ANALYTICS.md`; rebuild `frontend/dist`.
- **Task 5:** modify `docs/plans/EXEC-catch-up-cold-load-speed.md` (status, gates, divergences), `docs/plans/README.md`, `docs/TODO.md`.
- **Forbidden to touch:** `frontend/src/eng/loadPerformance.js`, `backend/routes/performance_routes.py`, `backend/services/load_performance.py`, the DB models and migrations, `backend/security/policy.py`, `backend/security/headers.py` (compression runs after it; it is not edited), `useEngSprintData.js`, `useStoryReadiness.js`, the lane loaders (including the 250-issue cap) and every Jira write path. Anything else needs the requester's decision first.

## Execution Status

| Task | Status | Commit | Notes |
|---|---|---|---|
| T0 baseline and plan | baseline of the existing suites done 2026-10-26 (including the Chromium run); plan reviewed twice, findings folded in; the waterfall harness fixed to fail when the list never renders; the G5 and G6 harnesses written (Appendix A.5 and A.6) and baselined 2026-10-26 on the unchanged code, each run twice back to back (Gates table); four G5 and G6 thresholds cannot hold reliably at baseline and one is ambiguous (Divergences, for the requester); gate sweep pending the requester's confirmation; plan not yet committed | plan commit | Python, security, unit and lint numbers are in the baseline table above; G5 and G6 baselines in the Gates table |
| T1 compression | done 2026-10-26 | `Compress JSON and static responses with gzip` | `make test` Ran 2,444 tests, OK (skipped=50), 145 s (2,423 baseline + 20 in `test_response_compression` + 1 Board stream pin); `make test-security` Ran 82 tests, OK; Chromium `eng_board_stream` 3 passed, `eng_board_measurement_runner` 2 passed, `lazy_view_boundary` 3 passed. G1a entry 433,102 B encoded (raw 1,479,635, ratio 0.293). G1b css 52,342 / largest chunk 28,569 / Stats chunk 19,884 B. G1c committed ratio test at most 0.10 passes. G1d real Flask on 5073, 4,000 kbps / 40 ms, median of 5, load average 3 to 5 (lighter than the baseline session): entry 927 ms (runs 921 to 929), css 154 ms (153 to 162), chunk 104 ms (102 to 110); wire bytes 433,402 / 52,642 / 28,869; every asset `Content-Encoding: gzip`, `Cache-Control: no-cache`, `Vary: Origin, Accept-Encoding`; the entry had one warm-up request before the runs, the first-compression cost is G1e. G1e first entry compression 35.5 ms process time (5 fresh processes: 35.4 to 36.0; request wall 36 ms); second request 0.5 ms; compress-call counter 1 after two requests. G1f parity covered by the HEAD and 304 tests. Interpretations: the Board stream pin is `test_real_board_stream_ignores_gzip` in `tests/test_eng_board_routes.py` (it passes before and after the change; it is a regression pin) and the scenario SSE pin is `test_real_board_stream_and_scenario_sse_routes_ignore_gzip` in `tests/test_response_compression.py` (SSE half, with the route's auth and storage patched on `jira_server`); the HEAD case of the skip test asserts a HEAD of a skipped response stays skipped, because Decision 1 and G1f require HEAD to be processed like GET |
| T2a runner and dependencies | 2a-i (backend) done 2026-10-26; 2a-ii (the Catch Up notice, `frontend/dist`, the notice spec and the Playwright runs of Step 5) not started | `Make dependency batches concurrent, bounded and complete or flagged` (2a-i) | 2a-i: `make test` Ran 2,476 tests, OK (skipped=50) (2,444 before + 32 new); `make test-security` Ran 82 tests, OK; new and widened modules 40 tests OK (`test_jira_batches` 11, `test_jira_issue_fetch_helpers` 11 of which 7 new, `test_dependencies_concurrency` 14, `test_issue_edit_cache_generation` 4 with the widened stub). The app module starts on port 5072 (`serve_app.py`) with no warning before it serves; `/api/test` was not called because it reaches live Jira. G2a (500 keys, fake Jira 100 ms per call, median of 5, load average 7.8; base `f834b557` copy and the changed tree each run from an extracted copy): base 874 ms (861 to 925), 8 calls, peak 1; changed tree default path 877 ms, 8 calls, peak 1; strict cap 4 (the route's call) 329 ms (328 to 335), 8 calls, peak 4, 250 of 250 edges, payload set equal to the serial one. G2c and G2d: `tests/test_dependencies_concurrency.py`. G6 (50 ms per call, 15-slot session semaphore, 10 iterations, alternating base, after, base, after, load average 3.0 to 5.4; base / after pairs, first then second round): per-user total p95 N = 1: 1,254 / 932, 1,244 / 937; N = 4: 1,253 / 1,009, 1,238 / 1,020; N = 8: 1,269 / 1,136, 1,267 / 1,142 ms (worst user p95 N = 8: 1,276 / 1,150, 1,298 / 1,181); dependencies p50 N = 1 / 4 / 8: base 469 / 465 / 473, after 181 / 219 / 318 ms; Jira calls 20 per user and iteration in every run; failures 0; session wait max 0.0 to 0.2 ms (2.0 ms in one 429 pass); bystander p95 N = 1 / 4 / 8: base 60.2 / 64.4 / 65.6 and 60.2 / 62.1 / 68.7, after 60.2 / 64.0 / 73.1 and 60.1 / 64.9 / 69.8 ms (worst ratio 1.11); peak helper slots held 3 / 6 / 6; helper slot acquisitions within 10 s after the first cooldown start 0 in every 429 pass (cooldown starts 10 per pass); the 429 user's dependencies now end `incomplete: rate_limited` after 21 to 23 calls instead of an empty map after 60. The unmodified harness with `--label after-2a-i`: p95 928 / 1,034 / 1,122 ms, its own `helpers peak` 4 / 10 / 14 counts each run's first worker (see Divergences). Every G6 threshold holds |
| T2b readiness | done 2026-10-26; one G6 bystander reading over its bound, flagged for the requester (Divergences) | `Fetch readiness child and enrichment batches concurrently` | `make test` Ran 2,483 tests, OK (skipped=50) (2,480 before + 3 new); `make test-security` Ran 82 tests, OK; `tests.test_story_readiness` 27 OK (run three times); `test_oauth_eng_routes`, `test_backend_route_source_guards`, `test_codebase_structure_budgets`, `test_request_performance`, `test_dependencies_concurrency`, `test_jira_batches`, `test_endpoint_policy_inventory` 194 OK; Chromium `load_performance` 29 passed (the pinned measured-load test unchanged). RED on `14ef0a13`: 10 failures and 1 error across the three new tests (missing `_STORY_READINESS_BATCH_CONCURRENCY`, serial peak 1, broken first-wave barrier); the adapted components test passes before and after. G2b baseline (Step 1(a), unchanged code, load average 3.1 to 3.8): median of 5 726.0 ms (707.4 to 753.5), 12 calls (sprint 1, discovery 2, field 1, child 4, enrichment 4), peak 1. G2b back to back (base `14ef0a13` copy vs changed, alternating twice, load average 3.7 to 7.0): base 737.8 (728.9 to 766.3) and 744.4 (731.5 to 779.8) ms; changed 382.6 (379.1 to 428.7) and 387.2 (371.5 to 421.1) ms, ratio 0.52 both (0.53 of the Step 1(a) baseline), same 12 calls, peak 4, 160 epics; `Server-Timing` child-distribution about 64 ms and enrichment 59 to 64 ms against 254 and 256 ms serial. G6 (instrumented `admission_2a.py`, 50 ms per call, 10 iterations, base `14ef0a13` and changed tree each from a `git archive` copy, alternating base, changed, base, changed, then three more N = 8 pairs; load average 2.8 to 3.9). Normal pass per-user total p95 base / changed: N = 1: 920.0 / 569.1, 943.1 / 585.4; N = 4: 1,031.2 / 750.3, 1,052.7 / 762.5; N = 8: 1,112.0 / 998.3, 1,129.2 / 980.1, 1,136.2 / 981.7, 1,128.1 / 989.0, 1,130.1 / 990.6 ms (worst user p95 N = 8: 1,135.4 / 1,042.7, 1,177.5 / 1,005.7); readiness p50 N = 1 / 4 / 8: base 726 / 727 / 740 and 731 / 742 / 753, changed 379 / 401 / 547 and 384 / 434 / 542 ms; dependencies p50 unchanged (183 to 186 / 199 to 229 / 310 to 318); 20 Jira calls per user and iteration in every run; failures 0; session wait max 0.0 to 0.3 ms (one base 429 pass 15.3 ms); peak helper slots held 3 / 6 / 6 in both trees; helper slot acquisitions within 10 s after the first cooldown 0 in every 429 pass; the 429 user's outcomes unchanged (dependencies `incomplete: rate_limited` after 21 to 23 calls, readiness `jira_unavailable`). Bystander p95 base / changed: N = 1: 60.7 / 61.5, 60.1 / 62.4; N = 4: 64.3 / 65.2, 68.2 / 67.5; N = 8: 67.3 / 86.9 (1.29), 67.6 / 68.9, 70.4 / 70.3, 71.3 / 74.9, 65.4 / 64.8 (median of the five pairs 67.6 / 70.3, 1.04); bystander max at N = 8 base 82 to 94, changed 95 to 116 ms. 429 pass healthy-user p95 (every iteration restarts the cooldown, so both trees run serially): N = 4: 1,249.4 / 1,253.3, 1,268.6 / 1,291.2; N = 8: 1,293.2 / 1,300.5, 1,331.3 / 1,307.5 ms. The unmodified harness with `--label after-2b`: p95 581.5 / 746.0 / 969.8 ms, its own `helpers peak` 4 / 10 / 14 counts first workers (see Divergences). Every G2b and G6 threshold holds except the one N = 8 bystander pair above |
| T3 lazy admin settings | done 2026-10-26 | `Lazy-load the admin settings panels` | RED on `a2f50cd1`: node 7 failures of 49 (`test_lazy_view_loaders` 4, `test_dashboard_split_build` 2, `test_epm_settings_source_guards` 1), `lazy_view_boundary` adminSettings case 1 failed, the four new `codebase_structure_smoke` Admin cases 4 failed (missing `manifest.views.adminSettings`); GREEN after the change. `npm run test:frontend:unit` 3,059 pass (3,057 + 2 new); `make test` Ran 2,483 tests, OK (skipped=50); `make test-security` Ran 82 tests, OK; `tests.test_codebase_structure_budgets` 2 OK; extraction lint exit 1 with the same six enforced identities and 104 warnings (before the registry re-sync: 8 enforced problems and 14 owner-budget problems from the new line counts, the fourth `LazyViewBoundary` caller and the emptied `AdminSettingsContainer` callers ledger). Chromium, one spec at a time, `--workers=1`, base URL port 5072: `lazy_view_boundary` 4 passed; `codebase_structure_smoke` 63 passed, 2 skipped (opt-in); `settings_admin_access` 20; `settings_unified_save` 59 passed, 1 skipped; `load_performance` 29; `dom_parity_helpers` 15; `design_system_hover_surfaces` 26; `onboarding_tour` 100; `shared_department_groups` 78; `epm-settings-gear` 2; `eng_group_board_view` 229; extra Admin-touching specs `unconfigured_workspace_gate` 4 and `settings-home-token-connection` 1. G3a entry raw / gzip-9 of the rebuilt dist 1,402,804 / 414,399 (origin/main 1,479,635 / 432,054: -76,831 / -17,655; `a2f50cd1` 1,480,085 / 432,196: -77,281 / -17,797; threshold at most 1,429,635 / 421,000). G3b static closure raw 1,506,149 over the entry and six chunks (origin/main 1,576,866; `a2f50cd1` 1,577,316; threshold at most 1,526,866). G3c Admin-exclusive chunks (reachable from the Admin chunk, not imported by the entry, not reachable from the Settings chunk): `AdminSettingsContainer-RDPHLJ25.js` 70,078 raw / 16,433 gzip-9 and `chunk-APTY26RR.js` 1,056 / 545 (shared with the Statistics chunk, not with the entry); first-open cost 71,134 raw / 16,978 gzip-9 summed per file; Playwright: zero requests for either before the Admin tab opens (Settings open requests only `SettingsModalContainer-*.js`), one each on the first open, none on reopen or on closing and reopening Settings. The build also re-partitioned the shared chunks (`StatsPanel-*.js`, `chunk-AMILAIYK.js` replaced by `chunk-47GW6OK4.js` 67,641 and `chunk-AMIKJR42.js` 15,785). |
| T4 early prefetch | not started | | |
| T5 docs and verification | not started | | |

## Divergences from the plan

Record each divergence here during execution, as `docs/AGENTS.md` requires.

- **Task 0 step 3, G5 stubs (mechanism):** the G5 harness stubs `/api/*` (and the two Google Fonts hosts) through a CDP `Fetch.enable` pattern instead of `page.route`, because `page.route` makes Playwright 1.59 send `Network.setCacheDisabled` for the page (`playwright-core/lib/server/chromium/crNetworkManager.js`), which would make the warm navigation as cold as the first. The stubbed set and the real-Flask page and `dist` are as planned; the warm runs show the entry revalidated as a 304 (300 B transferred).
- **Task 0 step 3, G5 failure scenarios:** by the controller's direction the harness does not run the four failure scenarios (incomplete dependencies, early 401, stalled early body, aborted Admin chunk); they are asserted by `dependency_incomplete_notice.spec.js` (Task 2a), `codebase_structure_smoke.spec.js` (Task 3) and `early_bootstrap.spec.js` (Task 4).
- **Ruling (controller, 2026-10-26): the G5 and G6 thresholds below were rewritten in the Gates table to what the baseline noise allows** (interleaved back-to-back A/B at the same load; time metrics 1.25 x; long tasks +200 ms or 1.25 x; heap after forced GC 1.10 x; G6 per-user p95 1.15 x and not above baseline at N = 4 and 8; the 70% bound for cold throttled loads only); cost if wrong: a regression under 25% on a metric the change does not target could pass, while the targeted improvements (compression, early prefetch, lazy admin) must still show their gains. The subagent's findings follow unchanged.
- **Task 0 step 4, thresholds that cannot hold reliably at baseline (the finding behind the ruling above).** Both harnesses were run twice back to back on the unchanged code; the machine was shared with other test runs (load average 10 to 45 during G5, 8 to 9 during G6).
  - G5 "p50 and p95 no worse than baseline plus 5% in every scenario": the repeat drifted up to 1.16x at p50 and 1.20x at p95 (throttled small warm usable 1,053 to 1,220 and 1,107 to 1,332 ms; throttled large warm usable p95 1,726 to 2,073 ms) and down to 0.60x as the load fell, so unchanged code fails the bound on noise alone.
  - G5 "long-task total and heap no more than baseline plus 5%": long-task totals drifted 0x to 2.16x (throttled small cold p50 57 to 123 ms); heap at settle is bimodal with GC timing (throttled large cold p50 66.1 to 53.3 MB, throttled small warm p95 17.2 to 19.0 MB).
  - G6 "per-user p95 no worse than baseline for every user count": a zero-tolerance bound; the repeat gave 1,208 / 1,334 / 1,277 ms against 1,205 / 1,231 / 1,226 (1.08x at N = 4). The change is expected to cut per-user time well below that, but as written noise alone can fail it.
  - G5 "throttled-profile p50 of navigation to usable list at most 70% of baseline" is ambiguous for warm loads: the warm entry is a 304, so compression cannot reach it, and 800 ms of the 1,053 / 1,354 ms warm baselines is the modeled API chain alone (config 150, sprints 150, the slower lane 500); the early prefetch can overlap only the config level with the entry, so warm small lands near 900 ms (about 85%) at best. Cold (5,066 / 5,397 ms) is dominated by the entry transfer that gzip shrinks. Requester to decide whether the bound applies to cold only.
  - Possible remedies, not applied: compare interleaved back-to-back A/B runs at the same load with a tolerance at least the measured drift; read the heap after a forced GC (`HeapProfiler.collectGarbage`); give long-task totals an absolute allowance; give the G6 per-user bound a tolerance. Confirmed at baseline as written: G6 bystander p95 at most 1.25x (repeat 0.95x to 1.05x), no session wait over 250 ms (max 1.8 ms), zero failures, equal Jira calls per user (20 per iteration); peak helpers at most 6 and the 10 s cooldown after a 429 have nothing to measure until Task 2 (0 helper calls today).
- **Task 2a-i (backend half of 2a), interpretations and notes:**
  - A malformed strict page (a body that is not an object or cannot be read, a non-list `issues` or a non-object row, a missing or non-boolean `isLast`, or `isLast: false` without a fresh non-empty `nextPageToken`) raises `JiraBatchIncomplete('continuation')`, the same reason as more than `MAX_PAGES_PER_BATCH` pages: the reason set has no separate "malformed" value. Requiring a boolean `isLast` follows the Board strict pager (`iter_strict_search_pages` in `backend/services/eng_board.py`).
  - When a deadline is passed, the per-call timeout `max(1, min(30, remaining))` applies at every cap, not only above cap 1 (only the strict route passes a deadline, at cap 4; the tests also use it at cap 1). Without a deadline the call is exactly today's (`current_jira_search(payload)` with no keywords).
  - The non-strict path also goes through `run_batches`, inline at cap 1: same calls, order, payloads, skip-and-log and exception propagation as the old loop (pinned in `tests/test_jira_issue_fetch_helpers.py` and `test_default_collect_dependencies_stays_serial_and_non_strict`).
  - The per-call timeout bounds each attempt, but the unchanged shared retry loop (decision 13: at most 4 attempts within 10 s) can keep a stuck worker's call running past the deadline by up to that retry budget; the route still answers at the deadline, nothing is admitted after it, and the late result is discarded. The State-machine checklist's "within about a second of the deadline" holds only when the call does not retry.
  - Step 4 review of shared state reached by batch workers: `EngBoardRequestObserver.add` (Lock), `PagerCounters.claim_request` and `UniqueKeyBudget.accept` (RLock), `JiraCircuitBreaker` (RLock; the shared `JIRA_SEARCH_CIRCUIT_BREAKER`) and `EngBoardRequestBudget.check` (read-only) are safe. Exceptions, none with an effect on the dependencies route: the request-performance observer, the epic-refresh transport and the diagnostic transport are ContextVars that do not reach pool threads (the route binds none of them); a local OAuth token refresh in a worker saves through `save_oauth_session_for_auth_context` under the local store lock instead of the cookie path, as the existing readiness and EPM workers already do; DB tokens are read per call through `session_scope`.
  - `jira_server.py` grows by 15 lines (the ceiling in `tests/test_codebase_structure_budgets.py` is raised from 6,615 to 6,630 with its justification comment); `jira_search_request` got shorter. `owner_budgets.json` registers only frontend sources and is untouched.
  - G6 helper measurement: the Task 0 harness marks every call made off the user's own thread as a helper call, and after 2a each run's first worker is a pool thread too (the caller only waits), so its `peakHelperCallsInFlight` (4 / 10 / 14) and `helperCallsWithin10sAfterFirst429` count first workers. Helpers were therefore counted at the process-wide slot, which a helper holds for its whole life: `tmp/cold-load-speed/admission_2a.py` is the Task 0 harness plus a counting subclass of the runner's `_ProcessAdmission` (peak slots held, acquisitions, cooldown starts) and an unchanged measurement path; it was run on both trees, and the unmodified harness was run once more on the changed tree with `--label after-2a-i`. G2a used `tmp/cold-load-speed/task2a-i/deps_g2a.py`, the Appendix A deps data with `isLast: true` added (strict mode requires it). Base and changed trees were each run from a `git archive f834b557` copy (the changed one with the four changed backend files copied in), so neither read the checkout's local configuration.
  - Beyond the listed tests: `test_route_auth_error_in_a_worker_stays_a_401_and_is_never_flagged_or_cached` (an `AuthError` raised in a worker still locks the app through the route's 401, never an `incomplete` 200), `test_limits_match_the_plan` and `test_a_deadline_bounds_each_call_timeout_and_stops_admission`. The decision-6 lane guard drives `/api/tasks-with-team-name` with a 300-issue scope and asserts the 250 cap (`maxResults` 100, 100, 50) and no strict or concurrent key fetch.
- **Task 2a-ii (the Catch Up notice) and its fix round 1, divergences and notes:**
  - Failure ranking in the runner (commit `057bb54b`, review fix; the Interfaces text above still says "the failure of the lowest batch index"): any failure that is not a `JiraBatchIncomplete` (an `AuthError` or any other error) outranks incomplete batches when `BatchOutcome.failure` is chosen, the lowest batch index decides among equals, and an auth error in any batch therefore still gives the route's 401, never an `incomplete` 200.
  - Late work and the helper bound: the shared retry loop is unchanged (decision 13, parked), so a stuck worker's call can stay alive for up to about 10 s past the 25 s deadline while the route still answers at the deadline and discards the late result. The "users + 6" bound on helper calls in flight assumes runs that finish normally: a stress probe with 12 users and abandoned runs saw up to 20 calls in flight.
  - G6 helper counts: the Task 0 harness counts each run's first worker as a helper, so its `peakHelperCallsInFlight` of 4 / 10 / 14 overstates helpers; the 2a-i implementer used an instrumented copy that counts at the process-wide slot (peak 6), as the 2a-i note above records.
  - Notice reset (divergence from "set and cleared in `fetchDependencies`"): the dependencies `useEffect` that clears the map for an empty scope is byte-pinned by `tests/test_epic_refresh_source_guards.js:102` (a digest of its body), so the flag cannot be reset there. The first version (`602c7441`) relied on a render guard, `dependenciesIncomplete={dependencyIncomplete && Boolean(dependencyKeySignature)}`, which fixed only the empty scope. Review found the hole: after a Sprint or Department switch the first lane to answer makes the key signature non-empty again while the dependencies effect still waits for the second lane, so the previous scope's notice showed for a scope that had made no request. Resolution (fix round 1): `setDependencyIncomplete(false)` on the same line as the map clear in `resetSprintScopedState`, `clearEngGroupScopeData` and `applyGroupState` (the third was found by the new Department-switch test; the Sprint-switch test passed without it); `dashboard.jsx` stays at 7,662 lines. The key-signature guard stays as a second line of defense. Covered by `tests/ui/dependency_incomplete_notice.spec.js` (Sprint and Department switch with a held tech lane assert no notice before the new scope's own request; a pending Retry request asserts the notice is already gone; returning to the first Department asks again and shows the notice again). The `clearEngGroupScopeData` reset is on the configuration-refresh path and has no covering test.
  - Per-Epic refresh paths: `refreshEpicDependencies` in `dashboard.jsx` and the freshness adapter in `dashboardFreshnessAdapters.js` (around line 140) still merge `/api/dependencies` answers without checking `incomplete`. The review judged this out of scope: a key whose batch failed is absent from the partial map, so its previous entries are left alone, and only a round-two failure degrades linked snapshots. Deferred as a follow-up (the adapter file is outside the File Map) and added to "Not done here".
- **Task 2b (readiness), interpretations and notes:**
  - The Step 1(a) harness is `_ReadinessJira` and `run_readiness_compute` in `tests/test_story_readiness.py` (the three new tests use it too); the G2b and G6 runs drove it and `admission_2a.py` from gitignored `tmp/cold-load-speed/task2b/`, each tree from a `git archive 14ef0a13` copy (the changed one with `backend/routes/eng_routes.py` copied in), so neither read the checkout's local configuration.
  - Classification: readiness tasks raise ordinary errors only (never `JiraBatchIncomplete`), so the runner's rule reduces to "the lowest failing batch index wins". Batches are claimed in index order, so every batch below a failing one has already started and reports its own outcome, which is the serial order's first failure. Shared state (the child `UniqueKeyBudget`, `PagerCounters`, the per-request breaker and budget) raises the same type and code whichever batch reaches it second. A higher-index auth error does not outrank a lower-index ordinary failure, as in serial order (pinned by `test_compute_raises_the_same_classification_when_any_batch_fails`); unlike the dependencies route, readiness has no incomplete class for an auth error to outrank.
  - Both batch splits (`split_epic_batches`) now run before the first child batch instead of the enrichment split after the last one. The order of raised errors could differ only if the enrichment split failed for a key the child split accepted, which needs a single Epic key whose one-key request exceeds `MAX_ENCODED_REQUEST_BYTES`; discovery admits only normalized Jira keys, so this is unreachable. Cap 1 also checks the budget once more before each batch (the runner's `cancel_check`), raising the same `EngBoardRequestDeadline` the batch's own first page check would.
  - G6 per-user gates are judged on the normal pass, as in 2a. In the 429 pass every iteration restarts the process-wide cooldown, so both trees run readiness serially and their healthy-user p95 differ only by noise (one reading 1.8% above base at N = 4).
  - G6 bystander bound: one of five N = 8 pairs read 1.29 x the paired base (the bound is 1.25 x); the first two alternations and three extra N = 8 pairs read 0.99 to 1.05 x, and the bystander maximum rose by about 15 to 20 ms in every changed run (more Python work in flight at once under one GIL). No limit was lowered; the requester decides whether to accept this or lower `_STORY_READINESS_BATCH_CONCURRENCY` or `JIRA_BATCH_GLOBAL_SLOTS`.
- **Task 3 (lazy admin settings), interpretations and notes:**
  - Registry callers ledger (the Task 3 Interfaces and Step 4 say the `AdminSettingsContainer` caller `line` is not validated and can stay): the checker discovers callers only through a static import, so once `dashboard.jsx` stopped importing the container it reported `stale callers` for it (an enforced problem outside the six identities). The ledger is now `"callers": []`, as the `SettingsModalContainer` entry already is, and `LazyViewBoundary` lists its fourth `dashboard.jsx` render site (all four lines refreshed to the measured ones). The render-prop parameter keeps the name `AdminSettingsContainer` for readers and the source guards; the checker itself does not follow it. Also re-synced: `lazyViewLoaders.js` line count 96 to 97, the `dashboard` ceiling 7,662 to 7,666 (also in `tests/test_codebase_structure_budgets.py`, with its justification comment) and the scenario, settings, stats, unique-owner and app-plus-owner aggregates; `AdminSettingsContainer.jsx` itself is unchanged, so its `sourceDigest` is too.
  - Admin-exclusive chunks (G3c): the Admin chunk and the 1,056-byte `chunk-APTY26RR.js`, which the Statistics chunk also imports; opening Statistics first leaves only the Admin chunk to fetch. The Playwright case defines the set from the committed dist (reachable from the Admin chunk, minus the entry's static closure, minus the Settings chunk's) instead of hard-coding names, and asserts it contains the Admin chunk. The shared chunk is fetched after the Admin chunk is parsed, so a first open is two sequential hops after the Settings chunk (three on the first-run unconfigured flow, which also loads Settings first).
  - Accepted cost, first-run unconfigured flow: it now waits for the Settings chunk, then the Admin chunk, then `chunk-APTY26RR.js`. `onboarding_tour` (100 passed) and `unconfigured_workspace_gate` (4 passed) show no delay and needed no timeout change. A throwaway probe on a loaded machine (load average about 11; Resource Timing from the Playwright route fixture, three runs, numbers only): from the Admin chunk request to the end of the shared chunk 94, 31 and 48 ms; "Loading Settings…" visible 63 to 74 ms and "Loading Admin settings…" about 300 ms, most of it the first render of the Admin tree (the Admin tab strip appeared 230 to 275 ms after the last chunk finished), which the static import also paid, only without a fallback in between. Production round trips were not measured.
  - The rebuilt dist also re-partitioned the shared chunks: the Statistics chunk and the largest shared chunk got new hashes (`chunk-AMILAIYK.js`, 84,453 raw, became `chunk-47GW6OK4.js` 67,641 and `chunk-AMIKJR42.js` 15,785). The Appendix A transfer harness hard-codes `chunk-AMILAIYK.js` in `ASSETS`; Task 5 and any re-run of G1d must point it at the current largest chunk (the committed G1b test already finds it by scanning).
  - `tests/ui/codebase_structure_smoke.spec.js` gained an optional `configExtras` option in its `installApiMocks` (merged into the `/api/config` mock) so the Retry case can show the Performance tab.
  - Appearance (looked at; Settings modal captures in gitignored `tmp/lazy-admin-settings/`, animations disabled): the loading notice and the Retry notice are the shared `.stats-note` line flush with the left edge of the modal body under the main tab strip, as "Loading Settings…" is; the loaded Admin tab shows its own padding. No new class, so the flush edge is the existing look of that notice; the requester may want an inset for the three notices together (not changed here).

---

### Task 0: Plan commit, baselines and harnesses

- [x] **Step 1:** The `tests/ui` baseline ran in the background (`tmp/cold-load-speed/baseline-ui.log`, `JEP_TEST_BASE_URL=http://127.0.0.1:5074 ... --workers=4`) and is recorded in the baseline table with each failure's cause, user impact, reproducibility and remedy; the six failures pass alone.
- [ ] **Step 2: Startup gate sweep** (`docs/plans/AGENTS.md`; this work touches the config bootstrap and executes a plan). `rg --files docs/plans | rg '/GATE-'` lists one gate, `GATE-05-home-write-capability.md`, whose `Next review` date (2026-10-19) has passed. It is unrelated to these four items and its gate command needs four credentials and a disposable Home project that are not available, so the review is: confirm the four `HOME_WRITE_PROBE_*` variables are absent (names only, never values), keep `Status` as `Blocked`, set `Checked on` to the review date, write `Last result` as "Not run: required inputs unavailable; no PASS evidence", and set `Next review` to the Monday of the following calendar week. This edits a file outside the four items' scope; it is in the File Map only if the requester confirms it with this plan, otherwise skip it and report the overdue review in the final report.
- [x] **Step 3: Fix and extend the waterfall harness.** Remove the `.catch(() => {})` that swallows a failed content wait in `waterfall.spec.js`, so a run that never shows its issues fails. Then write the G5 harness (`tmp/cold-load-speed/e2e.spec.js`): real Flask (`serve_app.py`) serves the page and `dist` while a Chromium CDP throttle of 4,000 kbps / 40 ms applies to those requests; `page.route` stubs only `/api/**` with the modeled profile (config, groups and sprints 150 ms, lanes 300 and 500 ms, dependencies and readiness at fixed modeled durations, payloads built like the synthetic 250-issue lane JSON). It records, per scenario and run: navigation to a usable list (all expected `[data-issue-key]` elements rendered), navigation to dependencies and readiness settled (both responses fulfilled and applied, plus two animation frames), the `longtask` total from a `PerformanceObserver` and the JS heap from `Performance.getMetrics` at settle. Scenarios: small and large scope, cold and warm, and the four failure cases of G5. Ten runs each; report p50 and p95; fail the run on any wait timeout.
- [x] **Step 4: Write the G6 harness** (`tmp/cold-load-speed/admission.py`): N user threads (1, 4, 8) each run `collect_dependencies` and `_story_readiness_compute` against one fake Jira at 50 ms per call and a 15-slot semaphore standing in for `session_scope`; a bystander thread issues one fake Jira call every 100 ms; one user receives a synthetic 429. Report per user p50 and p95, peak concurrent Jira calls, total calls, session wait, failures and bystander p95. Run it on the unchanged code and record the baselines in the Gates table (G5 and G6 rows), confirming or adjusting each threshold there before any code changes; a threshold that cannot hold at baseline is a divergence for the requester.
- [ ] **Step 5:** Add the index entry for this plan to `docs/plans/README.md` (one line, in the same style as the weekly plan's entry). Commit the plan and the index entry (and the gate-sweep edit if confirmed) only (`Plan the Catch Up cold load speed work`), then run the Gate A reads.

### Task 1: Response compression

**Files:** per the File Map.

**Interfaces:**
- Produces `backend/response_compression.py`: `MIN_COMPRESS_BYTES = 1024`, `GZIP_LEVEL = 6`, `MAX_MEMOIZED_ASSETS = 32`, `COMPRESSIBLE_TYPES` (frozenset of the six types), `EXCLUDED_PATH_PREFIXES = ('/api/auth/',)`, `EXCLUDED_PATH_SUFFIXES = ('.map',)`, and `register_response_compression(flask_app) -> None`.
- Consumes `backend/app.py:create_app`: the call goes first, before `CORS(...)` and `register_security_headers(...)`. Flask runs after-request handlers in reverse registration order, so it runs last and sees the final headers.

- [x] **Step 1: Write the failing tests** in `tests/test_response_compression.py` (a small `Flask` app with `register_response_compression`, plus the real `jira_server.app` for the last three):
  - `test_large_json_is_gzipped_and_round_trips`: `Accept-Encoding: gzip`, 5 KB JSON gives `Content-Encoding: gzip`, `Content-Length` equal to the body length, `gzip.decompress(body) == original`, `Vary` contains `Accept-Encoding`.
  - `test_missing_identity_and_q0_clients_get_the_plain_body_with_vary`: no header, `identity`, and `gzip;q=0` all return the plain body; `Accept-Encoding: *` and `gzip, br` are compressed; `Vary` contains `Accept-Encoding` for allowlisted types in every case.
  - `test_small_body_is_left_alone`: a body under 1,024 bytes has no `Content-Encoding`.
  - `test_generator_responses_are_never_buffered_or_encoded`: an `application/json` generator (an allowlisted type, so only the streaming rule can skip it), an NDJSON generator and a `text/event-stream` generator, with gzip accepted, have no `Content-Encoding`, and the generator is not consumed before the client iterates (counter). A `send_file` response (also `is_streamed`, but `direct_passthrough`) is compressed, which pins the rule as `is_streamed and not direct_passthrough`.
  - `test_real_board_stream_and_scenario_sse_routes_ignore_gzip` (`tests/test_eng_board_routes.py` for the Board route at its existing test near line 181; the scenario draft SSE route in this file with its existing auth patches): with `Accept-Encoding: gzip` the response has no `Content-Encoding` and the same body as without it.
  - `test_encoded_no_transform_range_head_and_error_responses_are_skipped`: an existing `Content-Encoding`, `Cache-Control: no-transform`, a 206, a HEAD request and a 404 JSON are each left untouched.
  - `test_auth_routes_source_maps_and_non_allowlisted_types_are_skipped`: a large JSON under `/api/auth/`, a large `.js.map` served as `application/json`, a large `image/png` and an `application/octet-stream` body are not encoded.
  - `test_static_asset_is_compressed_once_and_memoized`: a `send_file` of a temp `.js` over 1 KB, two requests, `gzip.compress` patched with a counter: one call; eight threads requesting a cold asset at once cause one call (lock); changing the file's mtime and size causes one more; the cache never holds more than 32 entries and evicts the oldest.
  - `test_static_conditional_request_returns_304_with_matching_validators`: the first gzip response's ETag starts with `W/` and it has no `Accept-Ranges`; replaying that ETag in `If-None-Match` returns 304 with an empty body, the same weak ETag and the same `Vary`.
  - `test_head_describes_the_same_representation_as_get_for_every_client` (G1f): for a gzip client, an identity client and a `gzip;q=0` client, HEAD and GET of a static asset and of an allowlisted JSON route carry the same `ETag`, `Content-Encoding`, `Vary`, `Content-Type` and `Content-Length`, and HEAD has no body.
  - `test_every_304_carries_the_validators_of_its_200_for_every_client` (G1f): conditional GET and conditional HEAD for gzip, identity and `gzip;q=0` clients return 304 with the ETag the matching 200 would send (weak for gzip, unchanged for identity) and a `Vary` containing `Accept-Encoding`; an identity client's 200 and 304 both carry that `Vary` as well.
  - `test_existing_headers_survive_and_every_vary_line_merges` (real app): `/api/auth/status` keeps `Cache-Control: no-store` and the CSP; a request with `Origin` and gzip on an allowlisted route has a `Vary` containing both `Origin` and `Accept-Encoding`; a response with two separate `Vary` header lines keeps both and gains `Accept-Encoding` once; a handler-set `Server-Timing` survives.
  - `test_real_dist_assets_compress_below_their_ratio_gates` (real app, files found by scanning `frontend/dist`, never by name): `dashboard.js` encoded at most 0.35 of raw, `dashboard.css` at most 0.20, the largest `chunks/chunk-*.js` at most 0.40. The absolute sizes in G1a and G1b are one-off measurements in Step 5, not committed assertions, so unrelated frontend growth cannot turn the suite red.
  - `test_synthetic_lane_json_compresses_below_ten_percent`: a 250-issue payload built in the test (G1c).
- [x] **Step 2: Run** `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_response_compression -v`. Expected: import error or failures for the missing module.
- [x] **Step 3: Implement** `register_response_compression`. One `@flask_app.after_request` function; skip rules exactly as the tests above (status 200, GET or HEAD (HEAD is processed exactly like GET so its headers describe the same representation), allowlisted type, at least 1,024 bytes, not `is_streamed and not direct_passthrough`, not already encoded, not `no-transform`, path not excluded); for `direct_passthrough` file responses (`send_file`) set `direct_passthrough = False` and read the data once; memoize by `(request.path, original ETag)` for paths under `/frontend/dist/` behind a `threading.Lock` (compress inside the lock so concurrent cold requests compress once; evict the oldest beyond 32); set `Content-Encoding`, `Content-Length`, remove `Accept-Ranges`, merge `Vary` by reading `headers.getlist('Vary')` (not `response.vary`, which reads only the first line), and convert a present strong ETag to weak with `response.set_etag(..., weak=True)`. Add the `Vary` merge to every allowlisted-type response and to every 200 or 304 under `/frontend/dist/` whatever the client sent; for a 304 on a `/frontend/dist/` GET or HEAD from a client that accepts gzip, apply the weak ETag too. Use `request.accept_encodings.quality('gzip') > 0`. Call it first in `create_app`.
- [x] **Step 4: Run** the new tests, then `make test-security` (security headers, endpoint policy inventory and CORS tests must stay green), the full `make test` (expected: all pass; compare counts with the baseline, 2,423 plus the new tests) and the Playwright specs that serve or read these routes, one at a time: `tests/ui/eng_board_stream.spec.js`, `tests/ui/eng_board_measurement_runner.spec.js`, `tests/ui/lazy_view_boundary.spec.js`.
- [x] **Step 5: Measure G1a, G1b, G1d and G1e.** Run the Appendix A transfer harness against real Flask on port 5073 (`tmp/cold-load-speed/serve_app.py 5073`), five runs per asset, record the absolute encoded sizes, and time the first compression of the entry with `time.process_time()`. Record the numbers in Execution Status. Stop the server afterwards (check the PID's command first).
- [x] **Step 6: Docs.** `README.md` and `INSTALL.md` (hosting checklist): the app compresses allowlisted responses with gzip; an ingress that also compresses must leave a response with `Content-Encoding` alone, and `Vary: Accept-Encoding` is set. `docs/ontology.md`: a "Response compression" entry (module, rules, tests, verified date). `docs/README_ANALYTICS.md`: allowlist row, no event (transport-level change).
- [x] **Step 7: Commit** `Compress JSON and static responses with gzip`; run the Gate A reads.

### Task 2: Bounded concurrent Jira batches, complete-or-incomplete dependencies, concurrent readiness

Two commits: **2a** (runner, dependencies, the incomplete notice) and **2b** (readiness).

**Files:** per the File Map.

**Interfaces (2a):**
- `backend/services/jira_batches.py`:
  - Constants `JIRA_BATCH_CONCURRENCY = 4`, `JIRA_BATCH_GLOBAL_SLOTS = 6`, `RATE_LIMIT_COOLDOWN_SECONDS = 10`.
  - `class JiraBatchIncomplete(Exception)` with `reason` (`'http_status'`, `'continuation'`, `'deadline'`, `'rate_limited'`, `'cancelled'`), `rate_limited: bool` and `partial: object | None`.
  - `@dataclass BatchOutcome`: `results: list` (one slot per batch, `None` where a batch did not run or failed), `failure: BaseException | None` (the failure of the lowest batch index), `deadline_exceeded: bool`, `rate_limited: bool`; property `complete`; method `raise_if_failed()`.
  - `run_batches(batches, fetch_batch, *, max_concurrency=JIRA_BATCH_CONCURRENCY, deadline=None, cancel_check=None) -> BatchOutcome`. With `max_concurrency <= 1` it runs inline on the caller's thread in order and stops at the first failure. Otherwise the caller only waits; the run starts one worker unconditionally and up to `max_concurrency - 1` helpers, each started only if a process-wide slot (a `BoundedSemaphore(JIRA_BATCH_GLOBAL_SLOTS)`) can be acquired without waiting and no cooldown is active (helpers are requested at run start and again whenever a batch finishes while batches remain, so slots freed by other runs are used; a run that never gets a slot simply stays serial); workers take the next unstarted batch index from a locked counter; no batch is admitted after `deadline` (a `time.monotonic()` value), after any failure, after `cancel_check()` raises, or after a rate-limited failure (which also starts the process-wide cooldown); the caller returns when the admitted batches finish or at the deadline, without waiting for stuck workers; the request-local pool is shut down with `wait=False, cancel_futures=True`; each helper releases its slot when it exits.
- `backend/jira_client.py: fetch_issues_by_keys(keys, fields_list, *, search_request, context=None, log_warning_fn=None, max_concurrency=1, strict=False, deadline=None)`. Non-strict (the default, used by every other caller) is today's behavior exactly. Strict: each 100-key batch follows `nextPageToken` until `isLast` (at most `MAX_PAGES_PER_BATCH = 10` pages; more is an incomplete batch), any non-200 or malformed page raises `JiraBatchIncomplete` (`rate_limited` is true when the response status or its `upstreamStatus` is 429), and the batches run through `run_batches`. `jira_server.py: fetch_issues_by_keys` passes the three keywords through; `jira_search_request(payload, *, context=None, timeout=None)` forwards `timeout` to `current_jira_search` only when it is given.
- `jira_server.py: collect_dependencies(keys, context=None, max_concurrency=1, strict=False, deadline=None)`. Today it resolves `auth_context` (line 3816) but never forwards it, so every Jira call re-resolves the request context; at `max_concurrency == 1` that is kept. When `max_concurrency > 1` the resolved `auth_context` (never `None`) is passed to every worker call, and each call's timeout is `max(1.0, min(30.0, deadline - now))`. In strict mode, if either round fails, round two is skipped when round one failed, and `JiraBatchIncomplete(reason, rate_limited, partial=<dependencies built from what completed>)` is raised. Non-strict returns the dict as today.
- `eng_routes.get_dependencies`: `deadline = time.monotonic() + _DEPENDENCIES_DEADLINE_SECONDS` (25); calls `collect_dependencies(keys, context=auth_context, max_concurrency=JIRA_BATCH_CONCURRENCY, strict=True, deadline=deadline)`; on `JiraBatchIncomplete` it returns `200` with `{'dependencies': partial, 'incomplete': True, 'reason': reason}` and its `Server-Timing`, and writes nothing to `DEPENDENCIES_CACHE`; a complete result is cached and returned exactly as today (no `incomplete` key).
- Frontend: `fetchDependencies` (`dashboard.jsx:3769`) sets one state cell `dependencyIncomplete` to `true` when the response carries `incomplete: true` or is not OK (other than an abort or an authentication error, which keep their handling), and to `false` when a fetch starts and when it completes cleanly; it still applies the data it received and returns the same `ENG_TASK_LOAD_OUTCOME` values as today, so what the client records does not change. `EngView` gains `dependenciesIncomplete` and `onRetryDependencies` (which bumps `dependencyRefreshNonce`) and renders, next to the readiness notice, a notice with the same markup and registered class hook (`story-readiness-notice`, `role="status"`, a `secondary compact` Retry button) reading "Some dependencies could not be loaded." Look the notice kind up in `docs/design-system.md` first; no new class.

**Interfaces (2b):** `eng_routes._STORY_READINESS_BATCH_CONCURRENCY = JIRA_BATCH_CONCURRENCY` (tests patch it to 1 for the serial reference); `_story_readiness_compute` builds one ordered task list (child batches, then enrichment batches), calls `run_batches(tasks, lambda task: task(), max_concurrency=_STORY_READINESS_BATCH_CONCURRENCY, cancel_check=transport.budget.check)` and `outcome.raise_if_failed()`, then assembles `children` and `epics` in batch order with the existing row handling and the existing `{keys} != batch_set` check inside the enrichment task.

- [x] **Step 1: Baselines.** (a) Add the readiness harness to `tests/test_story_readiness.py` as a helper that calls `_story_readiness_compute` directly with `current_jira_get` and `current_jira_search` patched to a fake that sleeps 50 ms, serves a one-page sprint list, discovery of 160 epics as two pages of at most 100 rows (`PAGE_SIZE = 100` in `backend/services/eng_board.py`; a longer page is rejected), the field list, 4 child batches and 4 enrichment batches (at most 40 keys each), and records call times and peak in-flight (the existing test at `tests/test_story_readiness.py:271` shows the patching); run it on the unchanged code and record wall time and call count (expected 12 serial calls, about 600 ms) as the G2b baseline. (b) The G6 baselines were recorded in Task 0.
- [ ] **Step 2 (2a): Write the failing tests.**
  - `tests/test_jira_batches.py`: `test_results_keep_input_order_with_out_of_order_completion`; `test_never_exceeds_max_concurrency` (12 batches, peak at most 4, exactly 4 reached); `test_max_concurrency_one_runs_inline_on_the_caller_thread`; `test_lowest_index_failure_is_reported_and_no_batch_starts_after_it`; `test_cancel_check_and_deadline_stop_admission`; `test_stalled_batch_returns_at_the_deadline_with_completed_results_and_the_worker_exits_when_released` (a batch blocked on an `Event`, deadline 0.2 s: `run_batches` returns within 0.7 s with `deadline_exceeded`; after the event is set the worker thread ends and every slot is back); `test_pool_is_shut_down_and_slots_are_released_after_success_failure_and_deadline`; `test_process_wide_slots_bound_helpers_across_eight_concurrent_runs` (8 runs of 12 batches: helper threads at most 6 at any instant, all runs complete); `test_a_run_with_no_free_slot_still_completes_with_its_own_first_worker`; `test_rate_limited_failure_starts_a_cooldown_that_expires` (patched monotonic clock: no helper starts for 10 s, then helpers start again).
  - `tests/test_jira_issue_fetch_helpers.py`: non-strict `fetch_issues_by_keys` is unchanged (default cap 1, skips non-200, ignores `nextPageToken`: pinned as today's behavior for its other callers); strict follows continuation tokens, raises on a non-200, on a malformed page and on more than 10 pages, and classifies a synthetic 503 with `upstreamStatus: 429` as rate limited.
  - `tests/test_dependencies_concurrency.py`: `test_default_collect_dependencies_stays_serial_and_non_strict` (500 keys, 8 calls, peak 1); `test_strict_concurrent_result_has_every_independently_expected_edge` (a dataset of 1,000 generated issues with links, a fake whose pages hold at most 50 rows and carry `nextPageToken`, expected edges computed from the dataset without calling the code under test, more than 100 keys, edges that need round two); `test_strict_cap_four_and_cap_one_issue_the_same_payloads` (including continuation payloads) and return equal dictionaries; `test_failure_in_round_one_gives_incomplete_with_partial_and_skips_round_two`; `test_failure_in_round_two_gives_incomplete_with_round_one_data`; `test_429_marks_the_run_rate_limited_and_stops_admission`; `test_route_returns_200_incomplete_and_never_caches_it_and_a_later_request_retries` (first request fails a batch: body `incomplete: true`, `reason`, partial map, `DEPENDENCIES_CACHE` untouched; second request with a healthy fake: complete, no `incomplete` key, now cached; a third request is served from cache); `test_route_deadline_returns_partial_incomplete_and_a_scope_switch_proceeds` (a stalled upstream with the deadline patched to 0.3 s: the response arrives within 1 s with `reason == 'deadline'`; while it was stalled a second request for other keys completed; after the stall is released the first worker exits and the late result is not cached); `test_worker_calls_carry_the_explicit_auth_context_without_request_context` (a plain thread, `current_request_auth_context` patched to raise, `current_jira_search` patched as the lowest boundary, every call receives `context is ctx`); `test_cap_four_and_cap_one_resolve_the_same_auth_context` (a DB-mode OAuth context and a local OAuth context); `test_batches_complete_when_the_db_session_pool_is_smaller_than_the_cap` (the Jira boundary acquires a size-2 semaphore standing in for `session_scope`: the run completes, so no path holds one connection while waiting for another); `test_other_callers_stay_serial_and_non_strict` (`/api/issues/lookup` and `jira_server.py:4071`); `test_scope_above_250_issues_per_lane_is_untouched` (500 lane-sized keys through the dependencies route return every expected edge, and a 250-issue lane payload is not altered by the changed code paths: the guard for decision 6).
  - `tests/test_issue_edit_cache_generation.py`: widen the stub at line 78 to `blocked_collect(keys, context=None, **_kwargs)` so the route's new keywords do not raise; keep every assertion.
  - `tests/ui/dependency_incomplete_notice.spec.js`: with `/api/dependencies` answering `{ dependencies: {...}, incomplete: true }` the notice is visible with `role="status"` and the exact text, its computed padding, border, font size and radius equal those of the readiness notice rendered in the same spec by stubbing readiness `unavailable` (MRT020 and MRT021: the shared hook, not a copy), and the partial dependency chips are shown; clicking Retry makes a second `/api/dependencies` request, and with a complete answer the notice disappears and the full data is applied; a 500 shows the notice too; a 401 is not a notice (it locks as today); and the pinned test "real dashboard emits one measured load ..." stays green. Take a screenshot with animations off and look at it.
- [ ] **Step 3 (2a): Run** them and confirm they fail for the missing module, parameters and behavior.
- [ ] **Step 4 (2a): Implement** the module, the client, the route and the notice as specified. Before relying on the runner, read `EngBoardRequestObserver.add`, `PagerCounters`, `UniqueKeyBudget`, `JiraCircuitBreaker` and `EngBoardRequestBudget.check` again and record any exception in Divergences (reviewed once: lock-protected or read-only; token refresh in worker threads takes the DB row lock or the local store lock). Raise the `dashboard.jsx` and `jira_server.py` ceilings only as far as measured, each with a justification comment in `tests/test_codebase_structure_budgets.py`, and re-sync `owner_budgets.json` as in Task 3 step 4. `npm run build`.
- [ ] **Step 5 (2a): Run** the new tests, `tests.test_issue_edit_cache_generation`, `tests.test_oauth_eng_routes`, `tests.test_backend_route_source_guards`, `tests.test_jira_issue_fetch_helpers`, `npm run test:frontend:unit`, `make test`, `make test-security`, the extraction lint, and the Playwright specs `dependency_incomplete_notice`, `load_performance` (the pinned measured-load test unchanged), `eng_alert_loading_order`, `codebase_structure_smoke` (dependency cases).
- [x] **Step 6 (2a): Measure G2a, G2c, G2d and G6.** Run the Appendix A deps harness (median of 5 at 100 ms per call) and the G6 harness at 1, 4 and 8 users; record numbers beside the baselines. Call counts and payload sets must equal the baseline for complete runs; the G6 thresholds must hold, otherwise lower `JIRA_BATCH_GLOBAL_SLOTS` or the cap, record the divergence and stop for the requester if a gate still fails.
- [ ] **Step 7 (2a): Docs and commit.** `docs/ontology.md`: "Bounded Jira batches" and the dependencies flow (strict mode, continuation, deadline, `incomplete`); `docs/README_ANALYTICS.md`: allowlist row, no event. Commit `Make dependency batches concurrent, bounded and complete or flagged` with the rebuilt `frontend/dist`; Gate A reads.
- [x] **Step 8 (2b): Tests, implementation, run, measure, commit.** In `tests/test_story_readiness.py`: `test_compute_runs_child_and_enrichment_batches_with_a_cap_of_four` (peak at most 4, payload equal to the serial reference, same set of JQL strings, `Server-Timing` still has the four segment names); `test_compute_raises_the_same_classification_when_any_batch_fails` (a failing child batch and a failing enrichment batch each give the serial error type); `test_compute_deadline_cancel_stops_queued_batches_and_leaves_no_worker`; the existing compute test that asserts `search_calls[-1]['fields']` contains `components` and `len(search_calls) == 4` (line 540) becomes order-insensitive (assert on the set of calls: one search has `components` in its fields, four in total) or pins the cap to 1, its assertion strength kept. Confirm they fail, implement, run `tests.test_story_readiness`, `tests.test_oauth_eng_routes`, `make test`, `make test-security`, the `load_performance` spec once, measure G2b and re-run G6, then commit `Fetch readiness child and enrichment batches concurrently`; Gate A reads. Docs: `docs/ontology.md` readiness flow line.

### Task 3: Lazy-load the admin settings panels

**Files:** per the File Map.

**Interfaces:**
- `lazyViewLoaders.js`: `viewEntries.adminSettings = { name: 'AdminSettingsContainer', exportName: 'default' }`; the manifest now has exactly the view ids `adminSettings`, `scenario`, `settings`, `stats`, and its chunk path must match `^chunks/AdminSettingsContainer-[A-Z0-9]{8}\.js$`.
- `scripts/build_dashboard.mjs`: `views.adminSettings = ['frontend/src/settings/AdminSettingsContainer.jsx', 'default']`.
- `dashboard.jsx`: remove `import AdminSettingsContainer from './settings/AdminSettingsContainer.jsx'`; add `const loadAdminSettingsView = createLazyViewLoader({ viewId: 'adminSettings', initialLoad: () => import('./settings/AdminSettingsContainer.jsx') })` and `const adminSettingsLoadingFallback = <div className="stats-note">Loading Admin settings…</div>`; render `<LazyViewBoundary load={loadAdminSettingsView} fallback={adminSettingsLoadingFallback}>{AdminSettingsContainer => <AdminSettingsContainer ...the same 160 explicit props... />}</LazyViewBoundary>` inside the unchanged `ADMIN_SETTINGS_TAB_IDS.has(groupManageTab)` wrapper. The render-prop parameter keeps the name `AdminSettingsContainer` so the extraction checker still finds the call site, as it does for `SettingsModalContainer`.

- [x] **Step 1: Write the failing tests** (extend, never weaken):
  - `tests/test_lazy_view_loaders.js`: the fixture manifest gains `adminSettings`; add cases that a manifest without it, with an extra view, or with a path of another stem is rejected with `JEP_STALE_LAZY_BUILD`; a loader for `adminSettings` caches success across attempts.
  - `tests/test_dashboard_split_build.js`: the synthetic build fixture gains a fourth dynamic import; the pinned order of `Object.keys(manifest.views)` becomes `['stats', 'scenario', 'settings', 'adminSettings']` and the export names `['default', 'ScenarioView', 'default', 'default']`; add that editing only the admin module changes the build id and its chunk path.
  - `tests/test_epm_settings_source_guards.js`: replace the pin on the static import (line 206) by pins on the loader constant and the `LazyViewBoundary` wrapper, keep every prop-parity assertion.
  - `tests/ui/lazy_view_boundary.spec.js`: add `adminSettings` to the view loop (missing chunk settles, stays failed on reopen, Retry then Reload).
  - `tests/ui/codebase_structure_smoke.spec.js`: with the committed dist, open Settings, then Admin: before the click there is no request for any Admin-exclusive chunk (the `AdminSettingsContainer-*.js` chunk and any shared chunk only it needs; chunks the entry already imports do not count, G3c); on the click exactly one request per such chunk; "Loading Admin settings…" is a `.stats-note` and then replaced by the tab strip; closing and reopening Admin requests nothing and never shows the fallback again; an aborted first chunk request shows Retry, Retry fetches the chunk with `jep_retry=1` and the Performance, Access and Jira-source tabs then work; a draft typed in Settings before the failure is still there.
  - `tests/ui/settings_admin_access.spec.js` stays as the open-path regression and must pass unchanged.
- [x] **Step 2: Run** them and confirm the expected failures (manifest keys, missing view).
- [x] **Step 3: Implement** the three source changes above, then `fnm exec --using 20 npm ci && npm run build`.
- [x] **Step 4: Re-sync the registry and the line budgets.** `dashboard.jsx` is at its ceiling at the base (7,659 lines in both `tests/test_codebase_structure_budgets.py:89` and `owner_budgets.json:23`); Task 2a already raised both for the notice state, and this change nets a few more lines, so raise both ceilings again to the new measured count with a justification comment in the test file, as its precedent requires (the loader constant, the fallback constant and the boundary wrapper replace one import line and one wrapper). Then `JEP_TEST_PYTHON=.venv/bin/python fnm exec --using 20 bash scripts/extraction_lint/run.sh`, then `node tmp/lint/check_hook_interfaces.mjs --write-inventory tmp/lint/inventory.json frontend/src/dashboard.jsx`; update `owner_budgets.json` (the `dashboard` entry and any `sourceDigest` that changed; the `AdminSettingsContainer` caller `line` is not validated and already stale, leave it), run `tests.test_codebase_structure_budgets`, and confirm the same six problem identities and no more than 104 warnings.
- [x] **Step 5: Measure G3a and G3b** from the rebuilt dist (Python `gzip.compress(..., 9, mtime=0)`; static closure from the `import ... from "./chunks/..."` statements, recursively). Record the Admin chunk's raw and gzip size as the first-open cost. Take a screenshot of the Admin tab at first open (loading state) and after load, and look at both; verify with element assertions that the fallback uses `.stats-note` and no new class was added.
- [x] **Step 6: Run** `npm run test:frontend:unit`, `make test`, `make test-security`, and one at a time every Playwright spec that opens the Admin tab or the lazy views: `lazy_view_boundary`, `codebase_structure_smoke` (the lazy and Settings cases), `settings_admin_access`, `settings_unified_save`, `load_performance`, `dom_parity_helpers`, `design_system_hover_surfaces`, `onboarding_tour`, `shared_department_groups`, `epm-settings-gear`, `eng_group_board_view`; then `make verify-dist-clean` (after committing). The first-run unconfigured Settings flow now waits for two sequential chunk loads (Settings, then Admin); record that as an accepted cost in Divergences if the onboarding spec shows a visible delay.
- [x] **Step 7: Docs and commit.** `docs/ontology.md` (Lazy view recovery and Settings state ownership entries: the fourth view, the loader, the registry). `docs/README_ANALYTICS.md`: allowlist row, no event. Commit `Lazy-load the admin settings panels` with the rebuilt `frontend/dist`; Gate A reads.

### Task 4: Early prefetch of `/api/config` and `/api/groups-config`

**Files:** per the File Map.

**Interfaces:**
- `earlyBootstrapContract.js`: `EARLY_BOOTSTRAP_SLOT = '__JEP_EARLY_BOOTSTRAP__'`, `EARLY_BOOTSTRAP_MAX_AGE_MS = 30000`, `earlyBootstrapRequests(backendUrl) -> [{ key: 'config', url: backendUrl + '/api/config?includeViewConfig=true', init: {} }, { key: 'groups', url: backendUrl + '/api/groups-config', init: { method: 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-cache' } }]` and `earlySlot(win) -> object` (creates `win[EARLY_BOOTSTRAP_SLOT] = {}` if absent). Each `init` equals, without `signal`, what the existing loader passes to `fetch` (`configApi.js:58` and `:75-80`); the contract test compares method, headers and cache mode with the arguments a recording `fetch` receives from the real `fetchAppConfig` and `fetchGroupsConfig`, not only the URLs.
- Slot entries, one per key, created by whichever side reaches the key first: `{ state: 'early' | 'app', url, method, cache, startedAt, startedAtEpoch, settledAt, claimed, controller, promise }`. State `'app'` means the application made its own request for that key.
- `earlyBootstrap.js` (classic IIFE built to `frontend/dist/early-bootstrap.js`): when `location.protocol` is http or https and `fetch` exists, computes the base with `resolveBackendUrl(window)` (`backendUrl.js`); for each request whose key already has an entry (the app got there first) it does nothing; otherwise it creates the entry (`state: 'early'`, its own `AbortController`, `startedAt = performance.now()`, `startedAtEpoch = Date.now()`) and starts `fetch(request.url, { ...request.init, signal: controller.signal, credentials: 'same-origin', referrerPolicy: 'no-referrer' })` (the only difference from the normal request is the missing `Referer`, so a share-link query in the address bar never leaves the page); its promise resolves to the `Response` for any HTTP status, or to `null` on a network error or abort, and sets `settledAt`. It reads no query string and no storage and never throws.
- `earlyBootstrapRegistry.js`: `takeEarlyResponse(url, options) -> { promise, startedAtEpoch } | null` and `earlyTimingOf(response) -> { startedAt, settledAt } | undefined` (a `WeakMap`). For a URL that is not one of the two early URLs it returns `null`. For an early URL with no entry it creates `{ state: 'app', claimed: true }` (so a late script skips that key) and returns `null`. For an entry already claimed or in state `'app'` it returns `null`. Otherwise it sets `claimed`, and if the entry is older than 30 s, or the call is not a GET, or `options.cache` differs from the entry's, it aborts the entry's controller and returns `null`; else it links `options.signal` to the entry's controller (an already-aborted signal aborts it at once; a later abort aborts it while headers or the body are pending; the listener is removed when the promise settles) and returns the promise and the early request's start time.
- `http.js`: in `performApiFetch`, `const early = takeEarlyResponse(url, options); const requestStartedAt = early ? early.startedAtEpoch : Date.now();` and inside the existing `try`, `response = (early ? await early.promise : null) || await fetch(url, options);`. A `null` (network error, abort) therefore becomes one normal request, which rejects at once with `AbortError` if the caller's signal is aborted. Every later step (401 handling and the lock stamped with `requestStartedAt`, body wait, auth lock) is unchanged and runs on whatever response was adopted, including 401 and 5xx. `trackedFetch` reads `earlyTimingOf(response)` and, when present, starts the clock at `startedAt` and ends it at the earlier of `settledAt` and now. `http.js` keeps its two existing `fetch(` call sites (`performApiFetch` and the streaming `apiFetchHeaders`); the second is untouched.

- [ ] **Step 1: Re-baseline G4** back to back in one session: five runs each of the Appendix A waterfall harness at API 100 ms and 250 ms with the entry delayed 800 ms, in the two variants of G4a (extend the harness with `CSS_DELAY_MS`: delay the `dashboard.css` and Google Fonts routes before fulfilling them), plus the late-script variants of G4c (hold the early script's route until `/api/config` has been requested, and until just after it). Record medians in the Gates table.
- [ ] **Step 2: Write the failing tests.**
  - `tests/test_early_bootstrap.js` (Node, with a stubbed `window` and `fetch`): `test_contract_requests_equal_the_loader_requests` (URL, method, headers and cache mode against a recording `fetch` driven by the real `fetchAppConfig` and `fetchGroupsConfig`); `test_script_starts_both_requests_once_with_no_referrer_and_no_query` (also asserts it used `resolveBackendUrl`); `test_script_does_nothing_off_http_and_never_throws_without_fetch`; `test_adoption_is_get_only_exact_url_cache_and_once` (a second take returns `null`; the claim lives in the slot); `test_adoption_rejects_entries_older_than_30_seconds`; `test_each_endpoint_is_requested_once_whatever_the_arrival_order` (script first; script after the app claimed both reads; script between the two loader calls: the fake `fetch` sees exactly one request per endpoint in each order); `test_stalled_body_after_adopted_headers_obeys_the_callers_abort_signal` (early headers 200, body never ends; aborting the caller's signal makes `apiFetch` reject with `AbortError`, and `fetchBootstrapConfig` with its timeout shortened ends in `ConfigBootstrapTimeoutError`); `test_early_401_is_adopted_locks_once_and_is_never_replaced_by_a_second_request` (the stub would answer 200 to a second request: there is no second request, the lock is published once, and its `requestStartedAt` equals the early request's start time, which is the value `authRecoveryCoordinator.js:66` compares with a recovery success); `test_groups_401_with_config_200_locks_once`; `test_early_5xx_is_handled_like_a_normal_5xx_and_not_retried`; `test_network_error_falls_back_to_exactly_one_normal_request`; `test_adoption_through_getJson_keeps_the_json_and_error_contract`; `test_tracked_fetch_measures_from_the_early_start_to_the_earlier_of_settle_and_adoption`.
  - `tests/test_frontend_api_source_guards.js`: `http.js` still contains exactly two `fetch(` calls (`performApiFetch` and `apiFetchHeaders`) and no other file under `frontend/src` does, except `earlyBootstrap.js`, which is pinned to exactly one call of the shape above, with mutation cases (a second call, a call without `referrerPolicy`, a call in any other file, a third call in `http.js`) that must fail, modeled on `withoutMountedManifestFetch`; `loadHttpHelpers` injects stubs for `takeEarlyResponse` (returns `null`) and `earlyTimingOf` (returns `undefined`) so the existing `apiFetch` and `trackedFetch` tests keep running unchanged.
  - `tests/ui/early_bootstrap.spec.js` (real built bundle through `installDashboardFixture`): `with the entry delayed 800 ms the config and groups requests start before it, and the same holds with the stylesheet and fonts held (G4a)`; `each is requested exactly once in every arrival order, including a script that arrives after the app started (G4c)`; `the early requests carry no Referer even when the page URL has a share-link query`; `with the early script aborted the app still loads and requests config and groups itself`; `a 401 on the early config locks the document once and no second /api/config request is made even though one would succeed`; `a 401 on the early groups-config with a 200 config locks once`; `early headers followed by a stalled body end in the existing startup timeout, connection banner and Retry` (Playwright's clock fast-forwards the 15 s timeout; Retry then loads normally); `held early config: once the mounted app shows its disabled Sprint button and a settle has passed there is no sprint, lane or Board request, and releasing it makes them follow`, and the same for a held early groups-config (this replaces reliance on `expectConfigBootstrapHoldsJiraWork`, whose poll succeeds before the entry is evaluated; the helper itself stays unchanged and passing).
  - The five fixtures route `**/frontend/dist/early-bootstrap.js` to the real built file (or, in `auth_focus_refresh_counts`, to the file with the request counted as an asset); their pinned counters gain the two documented early reads and the one asset, with assertion strength kept.
- [ ] **Step 3: Run** them and confirm the expected failures.
- [ ] **Step 4: Implement** the contract, script, registry, the `http.js` change, the `<script async src="frontend/dist/early-bootstrap.js"></script>` line as the first element of `<head>` in `jira-dashboard.html` (before the stylesheet links), and `package.json` scripts (`build:early` and `watch:early` modeled on `build:auth`; `build` and `watch` include them). `npm ci`, `npm run build`.
- [ ] **Step 5: Run** `tests/test_early_bootstrap.js`, `npm run test:frontend:unit`, the new spec, `load_performance.spec.js` (the "real dashboard emits one measured load ..." test unchanged), `auth_focus_refresh_counts.spec.js`, `epm_initial_config_load.spec.js`, `shareable_view_links.spec.js`, `global_auth_lock.spec.js`, `server_unavailable_ui.spec.js`, `make test` and `make test-security`; then the full Chromium run (`JEP_TEST_BASE_URL=http://127.0.0.1:5074 fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4`, long on a loaded machine), rerunning any failure alone before judging it and comparing with the Task 0 baseline.
- [ ] **Step 6: Measure G4a to G4c and G5** with the harnesses (five runs each for G4, ten for G5, back to back with a fresh baseline re-run from the previous commit's dist if more than an hour has passed). Record medians, p95 and the request multisets.
- [ ] **Step 7: Docs and commit.** `docs/ontology.md` (an "Early bootstrap prefetch" entry and the changed `apiFetch` contract); `docs/README_ANALYTICS.md`: allowlist row, plus one line that an adopted `config_bootstrap` `api_result` duration runs from the early request start to the earlier of its settle and its adoption. Commit `Prefetch the startup config and groups reads` with the rebuilt `frontend/dist`; Gate A reads.

### Task 5: Documentation, full verification and report

- [ ] **Step 1: Docs.** `docs/TODO.md` (Deferred): remove the lines this plan completes and add the "Not done here" list from Decisions (the 250-issue lane cap first, with a pointer to `jira_server.py:3382` and the code comment at `:3515`). `docs/plans/README.md`: update the entry (status, commits). This plan: Execution Status (commits, numbers), Gates (measured column), Divergences, and, once executed and accepted, an Outcome and Current Accuracy section per `docs/AGENTS.md`; keep the `EXEC-` name until the requester accepts or merges (rename to `DONE-` then, with the status note naming the PR).
- [ ] **Step 2: Full verification at the head**, each result read: `make test`; `make test-security`; `npm run test:frontend:unit`; the extraction lint (same six identities, at most 104 warnings); `fnm exec --using 20 npm ci && npm run build` then `git status --porcelain -- frontend/dist` empty; the full Chromium run `JEP_TEST_BASE_URL=http://127.0.0.1:5074 fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4` (skipped when the Task 4 run is at the head and nothing has changed since; long on a loaded machine; rerun any failure alone before judging it, since sigint runner, scenario-history, field-edit and campaign-startup specs are known to flake under load); `git log --oneline origin/main..HEAD` and `git diff --name-status origin/main...HEAD` compared with the File Map; startup check `.venv/bin/python jira_server.py` on a port other than 5050 then `/api/test` (AGENTS.md section 11), with its output free of dependency warnings before the Flask banner; re-run the G5 and G6 harnesses at the head (the numbers of the last code commit stand if nothing changed since).
- [ ] **Step 3: Final report** to the requester: every gate with baseline, measured value and threshold; divergences; what was not verified (production ingress, real lane sizes, concurrency against the real Jira site and its rate limits, the real database pool under production load, the live Performance panel and a fresh HAR, comfortable use on production-sized data; headed Firefox and WebKit were not needed because no glyph or form-control geometry changed); and the commit list. Stop for the requester's go-ahead before any push.

## Endpoint and contract matrix

No route is added, removed or re-authorized. Header and timing changes only:

| Route class | Method | Auth | Change | Test |
|---|---|---|---|---|
| `/api/*` JSON except `/api/auth/*` | GET or HEAD, 200 | unchanged | gzip when accepted and at least 1 KB; `Vary` merged for every client; HEAD carries GET's headers; `Cache-Control: no-store` kept | T1 |
| `/api/auth/*` | any | unchanged | never compressed | T1 |
| `/frontend/dist/*` (not `*.map`) | GET or HEAD | public | gzip when accepted and at least 1 KB; weak ETag; `Vary` merged on every 200 and 304 whatever the client sent; no `Accept-Ranges` on the gzip 200 | T1 |
| `/` (909 bytes) and `*.map` | GET | public | unchanged: under the threshold, and excluded | T1 |
| Board NDJSON, scenario SSE | GET | unchanged | never compressed or buffered | T1 |
| `POST /api/dependencies` | POST | unchanged (policy class `authenticated_read`, no CSRF token class) | same request; complete result exactly as today; any failed, cut-short, rate-limited or late batch gives `200` with `incomplete: true`, `reason` and the partial map, never cached; key batches follow continuation tokens; server deadline 25 s | T2a |
| `GET /api/eng/story-readiness` | GET | unchanged | same request and response; child and enrichment searches concurrent (per run 4, process-wide helpers 6) | T2b |
| `GET /api/config`, `GET /api/groups-config` | GET | unchanged | requested earlier by the page and once; any status adopted through the shared boundary | T4 |

## State-machine checklist

- **Lazy admin first open:** idle, loading (fallback), loaded; reopen renders synchronously; attempt 0 failure shows Retry; Retry runs attempt 1 through the manifest; a stale manifest or second failure shows Reload page; drafts live in `App()` and survive every state; closing the modal during loading drops nothing; Surface, group and sprint changes do not touch it.
- **Early prefetch:** script blocked or late → the app claims the key and makes its own request, and a late script skips it; in flight → adopted when the loader asks, the caller's `AbortSignal` is linked to the early controller so abort and the 15 s timeout end headers and body; resolved before adoption → adopted instantly, whatever the status (a 401 locks the document once, stamped with the early start time; a 5xx is a normal 5xx, not retried); network error → exactly one normal request; older than 30 s → aborted and a normal request; second call for the same URL (reconcile re-read, retry, refresh) → normal request; auth recovery reload → fresh page, fresh prefetch; account switch in another tab within the 30 s window → accepted residual risk (the normal bootstrap has the same race over a few hundred milliseconds).
- **Dependencies and batches:** all batches succeed → cached, no flag; a batch fails, is rate limited (cooldown starts), or the 25 s deadline passes → no new batch is admitted, completed work is returned with `incomplete: true`, nothing is cached, the notice offers Retry, and Retry redoes the work; the browser abandons the request (scope switch, navigation) → nothing notifies the synchronous handler, so the deadline and the per-call timeouts bound it: workers finish their current call within about a second of the deadline, release their slots, and a result that arrives late is not cached when the cache generation moved or the run was incomplete; the next request starts normally and always has its own first worker. Readiness keeps its own 25 s budget and classification.

## Data ownership and runtime feasibility

- Ownership: no table, key, cache or workspace boundary changes. The only memoized bytes are public static assets (at most 32 entries, at most about 2 MB).
- CPU: gzip-6 is 32 ms once per static asset per process and 0.8 ms for a 140 KB lane response; zlib releases the GIL.
- Jira load: per run at most 4 concurrent searches (its own first worker plus up to 3 helpers), and process-wide at most 6 helper workers across all runs (`JIRA_BATCH_GLOBAL_SLOTS`), so the extra concurrency over today's one-call-at-a-time is bounded by 6 plus one first worker per active run: at most 8 request threads plus the 4 readiness executor threads. Four simultaneous page loads therefore cannot reach the 32 workers a per-request cap alone would allow. A rate-limited batch stops admission for its run and starts a 10 s serial-only cooldown for the process. This bounds worker threads, not Jira calls per second: Atlassian guidance also asks callers to honor `Retry-After`, which the shared retry loop does not do outside diagnostic mode (decision 13, parked), so G6 measures aggregate calls, session waits and failures at 1, 4 and 8 users rather than assuming them. Readiness is single-flight per scope and cached for 300 s.
- Database and HTTP pools (DB/OAuth mode): every Jira call opens a `session_scope()` for the token lookup (`jira_server.py:545-560`), and the engine uses SQLAlchemy's default `QueuePool` (5 plus 10 overflow, `backend/db/engine.py`). Worst-case concurrent Jira-calling threads rise from about 12 (8 request threads plus 4 readiness executor threads) to at most about 18 (plus the 6 process-wide helpers). No code path holds one connection while requesting another, so exhaustion makes a call wait for a connection (the pool timeout is 30 s) instead of failing or deadlocking; Task 2 proves this with a pool smaller than the cap. The shared `requests` session (`HTTP_SESSION`) has urllib3's default pool of 10 connections per host: more than 10 simultaneous calls open extra short-lived connections and log a "pool is full" warning, which is noise, not an error. G6 enforces no session wait over 250 ms at 1, 4 and 8 users; if it fails, lower `JIRA_BATCH_GLOBAL_SLOTS` (or the per-run cap) and record the divergence.
- Initial load (MRT010): no new startup request except the one small script; the two early reads replace, not duplicate, the loaders' reads.

## Appendix A: measurement harnesses (disposable, gitignored `tmp/cold-load-speed/`)

Run with `JEP_TEST_BASE_URL=http://127.0.0.1:5072` (any port except 5050) and a local Playwright config `tmp/cold-load-speed/playwright.config.cjs` (`module.exports = { testDir: __dirname, testMatch: /.*\.spec\.js/, timeout: 90000, reporter: 'line' };`) because, observed on 2026-10-26, Playwright found no tests for a spec under `tmp/` without it (the repository has no Playwright config file, so this is not about a repository config). Commands:

- Waterfall: `API_LATENCY_MS=100 ENTRY_DELAY_MS=800 WATERFALL_OUT=tmp/cold-load-speed/waterfall-x.json fnm exec --using 20 npx playwright test --config tmp/cold-load-speed/playwright.config.cjs waterfall --browser=chromium --workers=1`; read `summary.firstLaneRequestMs` and the first `/api/config` entry of `summary.order`.
- Transfer: `.venv/bin/python tmp/cold-load-speed/serve_app.py 5073 &`, then `APP_BASE=http://127.0.0.1:5073 TRANSFER_OUT=tmp/cold-load-speed/transfer-x.json fnm exec --using 20 npx playwright test --config tmp/cold-load-speed/playwright.config.cjs transfer --browser=chromium --workers=1`; stop the server (check the PID belongs to `serve_app.py`) afterwards.
- Dependencies: `.venv/bin/python tmp/cold-load-speed/deps_serial_baseline.py 0.1`.
- G5 end-to-end: `.venv/bin/python tmp/cold-load-speed/serve_app.py 5073 &`, then `JEP_TEST_BASE_URL=http://127.0.0.1:5073 RUNS=10 E2E_LABEL=<label> fnm exec --using 20 npx playwright test --config tmp/cold-load-speed/playwright.config.cjs e2e --browser=chromium --workers=1` (optional `PROFILES=throttled,unthrottled`, `SCOPES=small,large`); read `tmp/cold-load-speed/e2e-<label>.json` (per-run samples in `e2e-<label>-<profile>-<scope>.json`); stop the server (check the PID belongs to `serve_app.py`) afterwards.
- G6 admission: `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python tmp/cold-load-speed/admission.py --label <label>` (optional `--users 1,4,8 --iterations 10`); read `tmp/cold-load-speed/admission-<label>.json`.

### Harness sources

Verbatim copies of the instruments that produced the baseline numbers; recreate them under `tmp/cold-load-speed/` (gitignored) to re-measure. The transfer harness names one content-hashed chunk in `ASSETS`; update it to the largest `chunks/chunk-*.js` of the build being measured. They stub every API with synthetic data; none contacts Jira or any live system.

**A.1 `tmp/cold-load-speed/waterfall.spec.js`** (Task 0 step 3 removed the `.catch(() => {})` that swallowed a failed content wait, so a run that never shows its issues now fails; the waterfall baselines above were taken before that fix, and each of their twelve runs requested `/api/dependencies`, which the app only does after both lanes are applied)

```js
// Throwaway measurement harness (gitignored tmp/): request waterfall of a Catch Up cold load on synthetic data.
// Every stubbed API response is delayed by API_LATENCY_MS so the sequential depth shows up as time.
const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { installDashboardFixture } = require('../../tests/ui/epm_home_token_fixture');

const API_LATENCY_MS = Number(process.env.API_LATENCY_MS || 100);
const ENTRY_DELAY_MS = Number(process.env.ENTRY_DELAY_MS || 0);
const OUT = process.env.WATERFALL_OUT || path.join(__dirname, 'waterfall-latest.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('catch up cold load waterfall', async ({ page }) => {
    const fixture = await installDashboardFixture(page);
    const events = [];
    let t0 = 0;
    const mark = (kind, url) => {
        const u = new URL(url);
        events.push({ kind, path: u.pathname, purpose: u.searchParams.get('purpose') || '', project: u.searchParams.get('project') || '', t: Math.round(Date.now() - t0) });
    };
    const delayed = (handler) => async route => { await sleep(API_LATENCY_MS); return handler(route); };

    if (ENTRY_DELAY_MS) await page.route('**/frontend/dist/dashboard.js', async route => { await sleep(ENTRY_DELAY_MS); return route.fallback(); });
    await page.addInitScript(() => {
        localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'eng', selectedSprint: 34625 }));
    });
    await page.route('**/api/**', async route => { await sleep(API_LATENCY_MS); return route.fallback(); });
    const sharedConfig = { version: 1, projects: { selected: [{ key: 'DEMO', type: 'product' }] }, board: { boardId: '7', boardName: 'Sprint Board' }, capacity: {},
        sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' }, parentNameField: { fieldId: 'customfield_10021', fieldName: 'Parent Link' },
        storyPointsField: { fieldId: 'customfield_10022', fieldName: 'Story points' }, teamField: { fieldId: 'customfield_10023', fieldName: 'Team' },
        deliveryOwnerField: { fieldId: 'customfield_20501', fieldName: 'Delivery Owner' }, statsPriorityWeights: [], issueTypes: ['Story'],
        epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} } };
    await page.route('**/api/config?**', delayed(route => route.fulfill({ json: {
        jiraUrl: 'https://jira.example.test', authMode: 'atlassian_oauth', settingsAdminOnly: false,
        userCanEditSettings: true, environmentConfigExists: true, projectsConfigured: true,
        performanceDebugEnabled: true, performanceAdminAvailable: true,
        sharedConfigRevision: 3, sharedConfig,
        viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: {} },
    } })));
    await page.route('**/api/groups-config', delayed(route => route.fulfill({ json: {
        version: 1, groups: [{ id: 'sample-group', name: 'Sample Department', teamIds: ['sample-team'] }],
        defaultGroupId: 'sample-group', source: 'workspace_db', preferences: {
            customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true,
            completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
            visibleGroupIds: ['sample-group'], activeGroupId: 'sample-group', effectiveVisibleGroupIds: ['sample-group'],
        },
    } })));
    await page.route('**/api/tasks-with-team-name?**', delayed(route => {
        const params = Object.fromEntries(new URL(route.request().url()).searchParams);
        const key = params.project === 'tech' ? 'TEST-2' : 'TEST-1';
        return route.fulfill({ json: { issues: [{ key, fields: { summary: `Sample ${params.project} story`, teamId: 'sample-team', teamName: 'Sample Team', issuetype: { name: 'Story' }, status: { name: 'In Progress' }, priority: { name: 'Medium' }, issuelinks: [] } }], epics: {}, epicsInScope: [], loadMetrics: { completeness: 'unknown', cacheState: 'miss', jiraRequests: 1, jiraPages: 1, jiraRetries: 0 } } });
    }));
    await page.route('**/api/eng/story-readiness?**', delayed(route => route.fulfill({ json: { schemaVersion: 1, complete: true, scope: {}, epics: [] } })));
    await page.route('**/api/dependencies', delayed(route => route.fulfill({ json: { dependencies: {} } })));
    await page.route('**/api/performance/loads', route => route.fulfill({ json: { saved: true } }));
    page.on('request', request => { const p = new URL(request.url()).pathname; if (p.startsWith('/api/') || p.startsWith('/frontend/dist/') || p === '/') mark('request', request.url()); });
    page.on('requestfinished', request => { const p = new URL(request.url()).pathname; if (p.startsWith('/api/')) mark('finished', request.url()); });

    t0 = Date.now();
    await page.goto(fixture.appBaseUrl);
    await page.waitForFunction(() => document.querySelectorAll('[data-issue-key]').length >= 2, null, { timeout: 15000 });
    await sleep(1500);

    const firstLane = events.find(e => e.kind === 'request' && e.path === '/api/tasks-with-team-name' && !e.purpose);
    const first = name => events.find(e => e.kind === 'request' && e.path === name);
    const summary = {
        apiLatencyMs: API_LATENCY_MS,
        entryDelayMs: ENTRY_DELAY_MS,
        firstLaneRequestMs: firstLane?.t ?? null,
        firstApiRequestMs: events.find(e => e.kind === 'request' && e.path.startsWith('/api/'))?.t ?? null,
        dependenciesRequestMs: first('/api/dependencies')?.t ?? null,
        storyReadinessRequestMs: first('/api/eng/story-readiness')?.t ?? null,
        order: events.filter(e => e.kind === 'request').map(e => `${e.t}ms ${e.path}${e.project ? ' ' + e.project : ''}${e.purpose ? ' ' + e.purpose : ''}`),
    };
    fs.writeFileSync(OUT, JSON.stringify({ summary, events }, null, 2));
    console.log(JSON.stringify(summary, null, 2));
});
```

**A.2 `tmp/cold-load-speed/transfer.spec.js`**

```js
// Throwaway: throttled transfer time of the real Flask static assets (bytes on the wire and elapsed), median of RUNS.
const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.APP_BASE || 'http://127.0.0.1:5073';
const DOWN_KBPS = Number(process.env.DOWN_KBPS || 4000);  // kilobits per second
const LATENCY = Number(process.env.LATENCY_MS || 40);
const RUNS = Number(process.env.RUNS || 5);
const OUT = process.env.TRANSFER_OUT || path.join(__dirname, 'transfer-latest.json');
const ASSETS = ['/frontend/dist/dashboard.js', '/frontend/dist/dashboard.css', '/frontend/dist/chunks/chunk-AMILAIYK.js'];
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('throttled static transfer', async ({ browser }) => {
    const result = { baseUrl: BASE, downKbps: DOWN_KBPS, latencyMs: LATENCY, runs: RUNS, assets: {} };
    for (const asset of ASSETS) {
        const elapsed = []; let sample = null;
        for (let i = 0; i < RUNS; i++) {
            const context = await browser.newContext();   // fresh context: no HTTP cache
            const page = await context.newPage();
            const cdp = await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY, downloadThroughput: DOWN_KBPS * 1000 / 8, uploadThroughput: DOWN_KBPS * 1000 / 8 });
            await page.goto(`${BASE}/health`);          // warm connection and JS-free origin
            const m = await page.evaluate(async url => {
                const t0 = performance.now();
                const response = await fetch(url, { cache: 'no-store' });
                const buffer = await response.arrayBuffer();
                const t1 = performance.now();
                const entry = performance.getEntriesByName(new URL(url, location.href).href).pop();
                return { ms: t1 - t0, decoded: buffer.byteLength, encoded: entry?.encodedBodySize ?? null, transfer: entry?.transferSize ?? null,
                    encoding: response.headers.get('content-encoding'), cacheControl: response.headers.get('cache-control'), vary: response.headers.get('vary'), etag: response.headers.get('etag') };
            }, asset);
            elapsed.push(m.ms); sample = m;
            await context.close();
        }
        result.assets[asset] = { medianMs: Math.round(median(elapsed)), allMs: elapsed.map(Math.round), decodedBytes: sample.decoded, encodedBytes: sample.encoded, transferBytes: sample.transfer, contentEncoding: sample.encoding, cacheControl: sample.cacheControl, vary: sample.vary };
    }
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
});
```

**A.3 `tmp/cold-load-speed/serve_app.py`**

```python
"""Throwaway: serve the real Flask app (static routes only are exercised) on a non-5050 port."""
import os, sys
os.environ.setdefault('JIRA_AUTH_MODE', 'basic'); os.environ.setdefault('CONFIG_STORAGE_BACKEND', 'jsonfile')
sys.path.insert(0, os.getcwd())
import jira_server
from werkzeug.serving import make_server
port = int(sys.argv[1])
assert port != 5050
srv = make_server('127.0.0.1', port, jira_server.app, threaded=True)
print('serving', port, flush=True)
srv.serve_forever()
```

**A.4 `tmp/cold-load-speed/deps_serial_baseline.py`**

```python
"""Throwaway: wall time of collect_dependencies with a fake Jira search that costs LAT ms per call (synthetic keys)."""
import os, sys, time, threading
os.environ.setdefault('JIRA_AUTH_MODE', 'basic'); os.environ.setdefault('CONFIG_STORAGE_BACKEND', 'jsonfile')
sys.path.insert(0, os.getcwd())
import jira_server as js

LAT = float(sys.argv[1]) if len(sys.argv) > 1 else 0.1
calls = []
lock = threading.Lock()

class Resp:
    status_code = 200
    def __init__(self, issues): self._issues = issues
    def json(self): return {'issues': self._issues}

def fake_search(payload, context=None, **kw):
    jql = payload['jql']
    keys = [k.strip().strip('"') for k in jql[jql.index('(')+1:jql.rindex(')')].split(',')]
    with lock: calls.append((time.perf_counter(), len(keys)))
    time.sleep(LAT)
    issues = []
    for k in keys:
        n = int(k.split('-')[1])
        links = []
        if k.startswith('SRC-') and n % 2 == 0:     # half the sprint keys link to an out-of-sprint key
            links.append({'type': {'name': 'Blocks', 'inward': 'is blocked by', 'outward': 'blocks'}, 'outwardIssue': {'key': f'EXT-{n}', 'fields': {'summary': 'x', 'issuetype': {'name': 'Story'}, 'status': {'name': 'To Do'}}}})
        issues.append({'key': k, 'fields': {'summary': k, 'status': {'name': 'To Do'}, 'issuetype': {'name': 'Story'}, 'issuelinks': links}})
    return Resp(issues)

js.jira_search_request = fake_search
js.resolve_team_field_id = lambda *a, **k: None
js.resolve_epic_link_field_id = lambda *a, **k: None
js.get_story_points_field_id = lambda *a, **k: 'customfield_1'
for n in (100, 250, 500):
    calls.clear()
    keys = [f'SRC-{i}' for i in range(n)]
    t = time.perf_counter()
    result = js.collect_dependencies(keys, context=None)
    wall = (time.perf_counter() - t) * 1000
    print(f'keys={n:4d} jira calls={len(calls):2d} (serial) wall={wall:7.0f} ms at {LAT*1000:.0f} ms/call; dependencies={len(result)}')
```

**A.5 `tmp/cold-load-speed/e2e.spec.js`** (G5)

```js
// Throwaway G5 harness (gitignored tmp/): end-to-end Catch Up load on synthetic data.
// Real Flask (serve_app.py) serves the page and frontend/dist; only /api/** (and the Google Fonts hosts) are
// stubbed, through a CDP Fetch pattern rather than page.route, because page.route makes Playwright send
// Network.setCacheDisabled (playwright-core crNetworkManager), which would turn the warm navigation into a cold one.
// Per run: a fresh browser context (empty HTTP cache) loads the page (cold), then the same page loads it again (warm).
// Records navigation to a usable list, navigation to dependencies and readiness settled, long-task total and JS heap.
const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5073').replace(/\/$/, '');
if (new URL(BASE).port === '5050') throw new Error('port 5050 belongs to the main checkout; use 5072-5074');
const RUNS = Number(process.env.RUNS || 10);
const PROFILES = (process.env.PROFILES || 'throttled,unthrottled').split(',').filter(Boolean);
const SCOPES = (process.env.SCOPES || 'small,large').split(',').filter(Boolean);
const LABEL = process.env.E2E_LABEL || 'latest';
const WAIT_MS = Number(process.env.WAIT_MS || 60000);
const THROTTLE = { offline: false, latency: 40, downloadThroughput: 4000 * 1000 / 8, uploadThroughput: 4000 * 1000 / 8 };
// Modeled API latency profile (ms). `other` covers every stubbed call the profile does not name.
const LATENCY = { config: 150, groups: 150, sprints: 150, product: 300, tech: 500, dependencies: 2000, readiness: 1600, other: 150 };
const SCOPE_SIZE = { small: 2, large: 250 };          // issues per lane; dependency keys are both lanes together
const READINESS_EPICS = { small: 1, large: 20 };
const SPRINT = { id: 34625, name: '2026Q2 Sprint 42', state: 'active' };
const TEAMS = Array.from({ length: 9 }, (_, i) => `team-${i}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Shape modeled on the synthetic 250-issue lane JSON of the Measured baseline (compression_bytes.py), plus the
// fields the Catch Up list reads (story points field of the stubbed config, epic summary, project key, sprint list).
function lanePayload(project, count) {
    const rnd = mulberry32(project === 'tech' ? 8 : 7);
    const pick = values => values[Math.floor(rnd() * values.length)];
    const prefix = project === 'tech' ? 'TEC' : 'PRJ';
    const epicPrefix = project === 'tech' ? 'TEPIC' : 'PEPIC';
    const epicCount = Math.min(40, count);
    const words = ['improve', 'pipeline', 'report', 'budget', 'sync', 'model', 'export', 'audit', 'cache', 'index'];
    const issues = Array.from({ length: count }, (_, i) => {
        const points = pick([null, 1, 2, 3, 5, 8]);
        const epicKey = `${epicPrefix}-${i % epicCount}`;
        return {
            id: `${project === 'tech' ? 2 : 1}${String(1000 + i)}`,
            key: `${prefix}-${1000 + i}`,
            fields: {
                summary: `Synthetic story ${i}: ` + Array.from({ length: 6 }, () => pick(words)).join(' '),
                status: { name: pick(['To Do', 'In Progress', 'Done', 'Accepted']) },
                priority: { name: pick(['Major', 'Minor', 'Critical']) },
                issuetype: { name: 'Story' },
                assignee: { displayName: `Person ${i % 17}`, accountId: `acc-${String(i % 17).padStart(4, '0')}` },
                customfield_10022: points,
                storyPoints: points,
                epicKey,
                parentKey: epicKey,
                parentSummary: `Synthetic epic ${i % epicCount}`,
                projectKey: prefix,
                teamId: TEAMS[i % 9],
                teamName: `Team ${i % 9}`,
                labels: i % 3 ? ['committed'] : [],
                issuelinks: [],
                updated: `2026-10-2${i % 6}T10:${String(i % 60).padStart(2, '0')}:00.000+0000`,
                sprint: [{ ...SPRINT }],
            },
        };
    });
    const epics = Object.fromEntries(Array.from({ length: epicCount }, (_, e) => {
        const key = `${epicPrefix}-${e}`;
        return [key, {
            key, summary: `Synthetic epic ${e}`, status: { name: 'In Progress' }, priority: { name: 'Major' },
            assignee: { displayName: `Person ${e % 17}` }, projectKey: prefix, projectClass: project,
            teamId: TEAMS[e % 9], teamName: `Team ${e % 9}`, labels: [], projectTrack: 'Committed', sprint: [{ ...SPRINT }],
        }];
    }));
    return {
        issues, epics, epicsInScope: Object.values(epics),
        loadMetrics: { completeness: 'unknown', cacheState: 'miss', jiraRequests: 5, jiraPages: 3, jiraRetries: 0 },
    };
}

// Shape of collect_dependencies output: half of the stories block an out-of-sprint key (as in deps_serial_baseline.py).
function dependencyPayload(keys) {
    const dependencies = {};
    for (const key of keys) {
        const n = Number(String(key).split('-')[1]);
        if (!Number.isFinite(n) || n % 2) continue;
        const linked = `EXT-${String(key).split('-')[0]}${n}`;
        dependencies[key] = [{
            key: linked, summary: `External ${linked}`, issuetype: 'Story', status: 'To Do', storyPoints: null,
            teamName: null, teamId: null, epicKey: null, direction: 'outward', relation: 'blocks', category: 'block',
            typeName: 'Blocks', typeInward: 'is blocked by', typeOutward: 'blocks', prereqKey: key, dependentKey: linked,
        }];
    }
    return { dependencies };
}

// Shape of project_story_readiness output; the scope echoes the request so the client accepts it as READY.
function readinessPayload(url, count) {
    const p = url.searchParams;
    return {
        schemaVersion: 1,
        scope: { groupId: p.get('groupId'), groupRevision: 1, sprintId: p.get('sprint'), sprintName: p.get('sprintName'), sprintState: p.get('sprintState') },
        complete: true,
        epics: Array.from({ length: count }, (_, i) => ({
            id: String(9000 + i), team: null, project: { key: 'PRJ' }, key: `REPIC-${i}`, summary: `Stories required epic ${i}`,
            status: { name: 'In Progress' }, priority: { name: 'Major' }, assignee: { displayName: `Person ${i % 17}` },
            components: [], projectTrack: 'Committed', projectKey: 'PRJ', projectClass: 'product', initiative: null,
            sprint: { id: p.get('sprint'), name: p.get('sprintName') },
            missingTeams: [{ id: TEAMS[i % 9], name: `Team ${i % 9}`, reason: 'no_stories' }],
        })),
    };
}

const sharedConfig = { version: 1, projects: { selected: [{ key: 'DEMO', type: 'product' }] }, board: { boardId: '7', boardName: 'Sprint Board' }, capacity: {},
    sprintField: { fieldId: 'customfield_10020', fieldName: 'Sprint' }, parentNameField: { fieldId: 'customfield_10021', fieldName: 'Parent Link' },
    storyPointsField: { fieldId: 'customfield_10022', fieldName: 'Story points' }, teamField: { fieldId: 'customfield_10023', fieldName: 'Team' },
    deliveryOwnerField: { fieldId: 'customfield_20501', fieldName: 'Delivery Owner' }, statsPriorityWeights: [], issueTypes: ['Story'],
    epm: { version: 2, labelPrefix: 'rnd_project_', scope: { rootGoalKey: 'ROOT-100', subGoalKeys: ['CHILD-200'] }, projects: {} } };
const configPayload = {
    jiraUrl: 'https://jira.example.test', authMode: 'atlassian_oauth', settingsAdminOnly: false,
    userCanEditSettings: true, environmentConfigExists: true, projectsConfigured: true,
    performanceDebugEnabled: true, performanceAdminAvailable: true,
    sharedConfigRevision: 3, sharedConfig,
    viewConfig: { workspaceId: 'workspace-test', viewConfigId: 'view-test', view: {} },
};
const groupsPayload = {
    version: 1, groups: [{ id: 'sample-group', name: 'Sample Department', teamIds: TEAMS }],
    defaultGroupId: 'sample-group', source: 'workspace_db', preferences: {
        customized: true, preferenceExists: true, onboardingRequired: false, onboardingDone: true,
        completedOnboardingModules: ['catch-up', 'configuration', 'planning', 'board', 'statistics'],
        visibleGroupIds: ['sample-group'], activeGroupId: 'sample-group', effectiveVisibleGroupIds: ['sample-group'],
    },
};

function buildScope(scope) {
    const size = SCOPE_SIZE[scope];
    const lanes = { product: lanePayload('product', size), tech: lanePayload('tech', size) };
    const keys = [...lanes.product.issues, ...lanes.tech.issues].map(issue => issue.key);
    return { scope, size, keys, lanes, laneBodies: { product: JSON.stringify(lanes.product), tech: JSON.stringify(lanes.tech) } };
}

function requestKeys(request) {
    try {
        let raw = request.postData;
        if (!raw && Array.isArray(request.postDataEntries)) {
            raw = request.postDataEntries.map(entry => Buffer.from(entry.bytes || '', 'base64').toString('utf8')).join('');
        }
        const keys = JSON.parse(raw || '{}').keys;
        return Array.isArray(keys) ? keys : null;
    } catch (err) {
        return null;
    }
}

// Answers one stubbed request: [status, body string or null, contentType, delay ms, name].
function answer(url, request, data) {
    const p = url.pathname;
    const json = (name, body, delay = LATENCY.other, status = 200) => [status, typeof body === 'string' ? body : JSON.stringify(body), 'application/json', delay, name];
    if (url.hostname === 'fonts.googleapis.com') return [200, '', 'text/css', 0, 'fonts'];
    if (url.hostname === 'fonts.gstatic.com') return [204, null, 'text/plain', 0, 'fonts'];
    if (p === '/api/auth/refresh') return [204, null, 'text/plain', LATENCY.other, 'auth-refresh'];
    if (p === '/api/auth/status') return json('auth-status', { authMode: 'atlassian_oauth', authenticated: true, email: 'profile@example.com', profile: { email: 'profile@example.com' } });
    if (p === '/api/auth/csrf') return json('csrf', { csrfToken: 'csrf-token' });
    if (p === '/api/me/connections/home-token') return json('home-token', { connected: false });
    if (p === '/api/config') return json('config', configPayload, LATENCY.config);
    if (p === '/api/groups-config') return json('groups', groupsPayload, LATENCY.groups);
    if (p === '/api/sprints') return json('sprints', { sprints: [{ ...SPRINT }] }, LATENCY.sprints);
    if (p === '/api/version') return json('version', { enabled: false });
    if (p === '/api/tasks-with-team-name') {
        const project = url.searchParams.get('project') === 'tech' ? 'tech' : 'product';
        const purpose = url.searchParams.get('purpose') || '';
        return json(`lane-${project}${purpose ? '-' + purpose : ''}`, data.laneBodies[project], LATENCY[project]);
    }
    if (p === '/api/dependencies') return json('dependencies', dependencyPayload(requestKeys(request) || data.keys), LATENCY.dependencies);
    if (p === '/api/eng/story-readiness') return json('readiness', readinessPayload(url, READINESS_EPICS[data.scope]), LATENCY.readiness);
    if (p === '/api/missing-info') return json('missing-info', { issues: [], epics: [], count: 0, epicCount: 0 });
    if (p === '/api/backlog-epics') return json('backlog-epics', { epics: [] });
    if (p === '/api/performance/loads') return json('performance-loads', { saved: true }, 0);
    return json(`other:${p}`, {});
}

async function installStub(cdp, data) {
    const stub = { requested: {}, fulfilled: {}, errors: 0, reset() { this.requested = {}; this.fulfilled = {}; this.errors = 0; } };
    cdp.on('Fetch.requestPaused', async event => {
        const url = new URL(event.request.url);
        const [status, body, contentType, delay, name] = answer(url, event.request, data);
        stub.requested[name] = (stub.requested[name] || 0) + 1;
        if (delay) await sleep(delay);
        try {
            await cdp.send('Fetch.fulfillRequest', {
                requestId: event.requestId,
                responseCode: status,
                responseHeaders: [{ name: 'Content-Type', value: contentType }, { name: 'Cache-Control', value: 'no-store' }],
                body: body ? Buffer.from(body).toString('base64') : undefined,
            });
            stub.fulfilled[name] = (stub.fulfilled[name] || 0) + 1;
        } catch (err) {
            stub.errors += 1;    // the request was cancelled (navigation or abort) before its modeled delay ended
        }
    });
    await cdp.send('Fetch.enable', { patterns: [
        { urlPattern: `${BASE}/api/*`, requestStage: 'Request' },
        { urlPattern: 'https://fonts.googleapis.com/*', requestStage: 'Request' },
        { urlPattern: 'https://fonts.gstatic.com/*', requestStage: 'Request' },
    ] });
    return stub;
}

// Runs in every document before the app: prefs (only when absent, so the warm load keeps what the app saved),
// a buffered long-task observer, and a Response.json hook that stamps when the dependencies and readiness bodies
// were parsed by the app and, two animation frames later, when they were applied.
function instrument(sprintId) {
    try {
        if (!localStorage.getItem('jira_dashboard_ui_prefs_v1')) {
            localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify({ selectedView: 'eng', selectedSprint: sprintId }));
        }
    } catch (err) { /* storage unavailable: the app falls back to defaults */ }
    const g = window.__g5 = { longTasks: [], parsed: {}, applied: {}, observer: null };
    try {
        g.observer = new PerformanceObserver(list => { for (const e of list.getEntries()) g.longTasks.push([e.startTime, e.duration]); });
        g.observer.observe({ type: 'longtask', buffered: true });
    } catch (err) { g.longTaskError = String(err); }
    const original = Response.prototype.json;
    Response.prototype.json = function json() {
        const url = String(this.url || '');
        const name = url.includes('/api/dependencies') ? 'dependencies' : url.includes('/api/eng/story-readiness') ? 'readiness' : '';
        const promise = original.call(this);
        if (!name) return promise;
        return promise.then(value => {
            if (g.parsed[name] === undefined) {
                g.parsed[name] = performance.now();
                requestAnimationFrame(() => requestAnimationFrame(() => { g.applied[name] = performance.now(); }));
            }
            return value;
        });
    };
}

async function measure(page, cdp, stub, data, phase) {
    stub.reset();
    await page.goto(`${BASE}/`, { waitUntil: 'commit', timeout: WAIT_MS });
    // Usable list: every expected story key is in the DOM (fails the run on timeout).
    const usableMs = await (await page.waitForFunction(expected => {
        const nodes = document.querySelectorAll('[data-issue-key]');
        if (nodes.length < expected.length) return false;
        const seen = new Set();
        for (const node of nodes) seen.add(node.getAttribute('data-issue-key'));
        for (const key of expected) if (!seen.has(key)) return false;
        return performance.now();
    }, data.keys, { polling: 'raf', timeout: WAIT_MS })).jsonValue();
    // Dependencies and readiness settled: both bodies parsed by the app and two frames later (fails on timeout).
    const settledMs = await (await page.waitForFunction(() => {
        const g = window.__g5;
        return g && g.applied.dependencies !== undefined && g.applied.readiness !== undefined
            ? Math.max(g.applied.dependencies, g.applied.readiness) : false;
    }, null, { polling: 50, timeout: WAIT_MS })).jsonValue();
    const metrics = await cdp.send('Performance.getMetrics');
    const heap = metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
    const page_ = await page.evaluate(settled => {
        const g = window.__g5;
        if (g.observer) for (const e of g.observer.takeRecords()) g.longTasks.push([e.startTime, e.duration]);
        const before = g.longTasks.filter(([start]) => start <= settled);
        const entry = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/frontend/dist/dashboard.js');
        return {
            longTaskMs: before.reduce((sum, [, duration]) => sum + duration, 0),
            longTaskCount: before.length,
            longTaskError: g.longTaskError || null,
            dependenciesParsedMs: g.parsed.dependencies, readinessParsedMs: g.parsed.readiness,
            entryTransferBytes: entry ? entry.transferSize : null,
            entryEncodedBytes: entry ? entry.encodedBodySize : null,
        };
    }, settledMs);
    for (const name of ['dependencies', 'readiness']) {
        if (!stub.fulfilled[name]) throw new Error(`${phase}: the ${name} stub was never fulfilled`);
    }
    return {
        phase, usableMs, settledMs, longTaskMs: page_.longTaskMs, longTaskCount: page_.longTaskCount, heapBytes: heap,
        dependenciesParsedMs: page_.dependenciesParsedMs, readinessParsedMs: page_.readinessParsedMs,
        entryTransferBytes: page_.entryTransferBytes, entryEncodedBytes: page_.entryEncodedBytes,
        longTaskError: page_.longTaskError, requested: { ...stub.requested },
    };
}

// Nearest-rank percentile.
const percentile = (values, p) => {
    const sorted = values.filter(v => typeof v === 'number').sort((a, b) => a - b);
    return sorted.length ? sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)] : null;
};
const METRICS = ['usableMs', 'settledMs', 'longTaskMs', 'heapBytes'];

function summarize(samples) {
    const out = {};
    for (const metric of METRICS) {
        const values = samples.map(sample => sample[metric]);
        out[metric] = { p50: percentile(values, 50), p95: percentile(values, 95) };
    }
    return out;
}

const outFile = (profile, scope) => path.join(__dirname, `e2e-${LABEL}-${profile}-${scope}.json`);

for (const profile of PROFILES) {
    for (const scope of SCOPES) {
        test(`G5 ${profile} ${scope}`, async ({ browser }) => {
            test.setTimeout(RUNS * 4 * WAIT_MS);
            const data = buildScope(scope);
            const samples = { cold: [], warm: [] };
            for (let run = 0; run < RUNS; run++) {
                const context = await browser.newContext();          // fresh context: empty HTTP cache
                try {
                    const page = await context.newPage();
                    await page.addInitScript(instrument, SPRINT.id);
                    const cdp = await context.newCDPSession(page);
                    await cdp.send('Network.enable');
                    if (profile === 'throttled') await cdp.send('Network.emulateNetworkConditions', THROTTLE);
                    await cdp.send('Performance.enable');
                    const stub = await installStub(cdp, data);
                    for (const phase of ['cold', 'warm']) {
                        const sample = await measure(page, cdp, stub, data, phase);
                        samples[phase].push({ run, ...sample });
                        console.log(`${profile} ${scope} run ${run} ${phase}: usable ${Math.round(sample.usableMs)} ms, settled ${Math.round(sample.settledMs)} ms, long tasks ${Math.round(sample.longTaskMs)} ms (${sample.longTaskCount}), heap ${(sample.heapBytes / 1048576).toFixed(1)} MB, entry transfer ${sample.entryTransferBytes} B`);
                        await sleep(500);                               // let the load record and late requests finish
                    }
                } finally {
                    await context.close();
                }
            }
            const result = {
                label: LABEL, profile, scope, runs: RUNS, baseUrl: BASE, issuesPerLane: data.size, dependencyKeys: data.keys.length,
                throttle: profile === 'throttled' ? { downKbps: 4000, latencyMs: 40 } : null, latencyProfileMs: LATENCY,
                percentileMethod: 'nearest-rank',
                cold: summarize(samples.cold), warm: summarize(samples.warm), samples,
            };
            fs.writeFileSync(outFile(profile, scope), JSON.stringify(result, null, 2));
            for (const phase of ['cold', 'warm']) {
                const s = result[phase];
                console.log(`SUMMARY ${profile} ${scope} ${phase}: usable p50 ${Math.round(s.usableMs.p50)} p95 ${Math.round(s.usableMs.p95)} | settled p50 ${Math.round(s.settledMs.p50)} p95 ${Math.round(s.settledMs.p95)} | long tasks p50 ${Math.round(s.longTaskMs.p50)} p95 ${Math.round(s.longTaskMs.p95)} | heap MB p50 ${(s.heapBytes.p50 / 1048576).toFixed(1)} p95 ${(s.heapBytes.p95 / 1048576).toFixed(1)}`);
            }
        });
    }
}

test.afterAll(() => {
    const merged = {};
    for (const profile of PROFILES) for (const scope of SCOPES) {
        const file = outFile(profile, scope);
        if (!fs.existsSync(file)) continue;
        const result = JSON.parse(fs.readFileSync(file, 'utf8'));
        merged[`${profile}/${scope}`] = { cold: result.cold, warm: result.warm };
    }
    fs.writeFileSync(path.join(__dirname, `e2e-${LABEL}.json`), JSON.stringify({ label: LABEL, runs: RUNS, latencyProfileMs: LATENCY, percentileMethod: 'nearest-rank', results: merged }, null, 2));
});
```

**A.6 `tmp/cold-load-speed/admission.py`** (G6)

```python
"""Throwaway G6 harness (gitignored tmp/): aggregate Jira admission with N simultaneous users (synthetic data only).

Each user thread runs, per iteration and in this order, jira_server.collect_dependencies over 500 synthetic keys and
eng_routes._story_readiness_compute over 160 synthetic epics, against ONE fake Jira that answers every call after
LAT seconds. Every fake call (users and bystander) first takes a slot of a 15-slot semaphore standing in for the
database session scope (SQLAlchemy's default 5 + 10 overflow) and holds it for the whole call, a conservative upper
bound (the real code holds it only for the token lookup); the wait for a slot is recorded per call. A bystander thread
issues one fake call every 100 ms while the users run. Pass "normal" has no failures; pass "429" answers every call of
user 0 with the repo's synthetic 503 carrying upstreamStatus 429 (the shape the retry loop returns once it gives up).

Runs unchanged after collect_dependencies gains max_concurrency/strict/deadline: the keywords are passed (as the
dependencies route passes them) only when inspect.signature shows them.

Usage: JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python tmp/cold-load-speed/admission.py --label baseline
"""
import argparse
import inspect
import json
import logging
import os
import re
import sys
import threading
import time

os.environ.setdefault('JIRA_AUTH_MODE', 'basic'); os.environ.setdefault('CONFIG_STORAGE_BACKEND', 'jsonfile')
sys.path.insert(0, os.getcwd())
import jira_server as js  # noqa: E402
from backend.auth.context import RequestAuthContext  # noqa: E402
from backend.jira_client import _build_jira_unavailable_response  # noqa: E402
from backend.routes import eng_routes  # noqa: E402
from backend.services.eng_board_stream import EngBoardRequestBudget, EngBoardRequestTransport  # noqa: E402

logging.disable(logging.WARNING)  # today's non-strict path logs one warning per failed batch in the 429 pass

parser = argparse.ArgumentParser()
parser.add_argument('--label', required=True, help='names the output file tmp/cold-load-speed/admission-<label>.json')
parser.add_argument('--users', default='1,4,8')
parser.add_argument('--iterations', type=int, default=10)
parser.add_argument('--latency', type=float, default=0.05, help='seconds per fake Jira call')
parser.add_argument('--slots', type=int, default=15)
args = parser.parse_args()

LAT = args.latency
DEP_KEYS = 500
EPICS = 160
CHILDREN_PER_EPIC = 2
SPRINT = ('42', 'Sprint 42', 'active')
TEAMS = 4

try:
    from backend.services import jira_batches as _jira_batches  # present after Task 2
except ImportError:
    _jira_batches = None
CONCURRENCY = getattr(_jira_batches, 'JIRA_BATCH_CONCURRENCY', 4)
COOLDOWN = getattr(_jira_batches, 'RATE_LIMIT_COOLDOWN_SECONDS', 0)
DEPS_DEADLINE = getattr(eng_routes, '_DEPENDENCIES_DEADLINE_SECONDS', 25)
COLLECT_PARAMS = inspect.signature(js.collect_dependencies).parameters


class Resp:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class Recorder:
    """Shared state of the fake Jira: slot waits, in-flight peaks, call attribution, the 429 user."""
    def __init__(self, slots):
        self.sem = threading.BoundedSemaphore(slots)
        self.lock = threading.Lock()
        self.reset(fail_user=None)

    def reset(self, fail_user):
        self.fail_user = fail_user
        self.calls = []                 # (user, kind, start, end, wait, helper, failed)
        self.in_flight = 0; self.peak_in_flight = 0
        self.user_in_flight = 0; self.peak_user_in_flight = 0
        self.callers = 0; self.peak_callers = 0
        self.helper_in_flight = 0; self.peak_helper_in_flight = 0
        self.first_429_at = None
        self.user_threads = {}          # thread ident -> user index
        self.user_contexts = {}         # id(context) -> user index

    def call(self, user, kind, helper):
        started = time.perf_counter()
        with self.lock:
            self.callers += 1; self.peak_callers = max(self.peak_callers, self.callers)
        self.sem.acquire()
        acquired = time.perf_counter()
        with self.lock:
            self.in_flight += 1; self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
            if user is not None:
                self.user_in_flight += 1; self.peak_user_in_flight = max(self.peak_user_in_flight, self.user_in_flight)
            if helper:
                self.helper_in_flight += 1; self.peak_helper_in_flight = max(self.peak_helper_in_flight, self.helper_in_flight)
        try:
            time.sleep(LAT)
        finally:
            ended = time.perf_counter()
            failed = user is not None and user == self.fail_user
            with self.lock:
                self.in_flight -= 1; self.callers -= 1
                if user is not None:
                    self.user_in_flight -= 1
                if helper:
                    self.helper_in_flight -= 1
                if failed and self.first_429_at is None:
                    self.first_429_at = ended
                self.calls.append((user, kind, started, ended, acquired - started, helper, failed))
            self.sem.release()
        return failed, acquired - started


REC = Recorder(args.slots)
_local = threading.local()
_USER_IN_TEXT = re.compile(r'\bU(\d+)[A-Z]+-\d')


def attribute(context, text=''):
    """Which user a call belongs to: its auth context, else the keys in its JQL/path, else the calling thread."""
    user = REC.user_contexts.get(id(context)) if context is not None else None
    if user is None and text:
        match = _USER_IN_TEXT.search(text)
        if match:
            user = int(match.group(1))
    if user is None:
        user = getattr(_local, 'user', None)
    ident = threading.get_ident()
    helper = ident != getattr(_local, 'own_ident', None) or REC.user_threads.get(ident) != user
    return user, helper


def unavailable_429():
    return _build_jira_unavailable_response('Jira rate limited the request', attempts=4, elapsed_seconds=LAT,
                                            upstream_status=429)


# --- dependencies: fake jira_server.jira_search_request (same data as deps_serial_baseline.py) ---
def deps_search(payload, context=None, **_kw):
    jql = payload['jql']
    user, helper = attribute(context, jql)
    failed, _wait = REC.call(user, 'deps', helper)
    if failed:
        return unavailable_429()
    keys = [k.strip().strip('"') for k in jql[jql.index('(') + 1:jql.rindex(')')].split(',')]
    issues = []
    for key in keys:
        prefix, number = key.split('-')
        links = []
        if prefix.endswith('S') and int(number) % 2 == 0:     # half the source keys block an out-of-scope key
            links.append({'type': {'name': 'Blocks', 'inward': 'is blocked by', 'outward': 'blocks'},
                          'outwardIssue': {'key': f'{prefix[:-1]}X-{number}', 'fields': {
                              'summary': 'x', 'issuetype': {'name': 'Story'}, 'status': {'name': 'To Do'}}}})
        issues.append({'key': key, 'fields': {'summary': key, 'status': {'name': 'To Do'},
                                              'issuetype': {'name': 'Story'}, 'issuelinks': links}})
    return Resp({'issues': issues, 'isLast': True})


js.jira_search_request = deps_search
js.resolve_team_field_id = lambda *a, **k: None
js.resolve_epic_link_field_id = lambda *a, **k: None
js.get_story_points_field_id = lambda *a, **k: 'customfield_1'


# --- readiness: fake eng_routes.current_jira_get / current_jira_search (patching as tests/test_story_readiness.py) ---
def epic_keys_for(user):
    return sorted(f'U{user}E-{n}' for n in range(EPICS))


def readiness_get(path, context=None, **_kw):
    user, helper = attribute(context, path)
    failed, _wait = REC.call(user, 'readiness', helper)
    if failed:
        return unavailable_429()
    if '/board/' in path and path.endswith('/sprint'):
        return Resp({'values': [{'id': int(SPRINT[0]), 'name': SPRINT[1], 'state': SPRINT[2]}], 'isLast': True})
    if path == '/rest/api/3/field':
        return Resp([{'id': 'customfield_epic', 'name': 'Epic Link'}])
    raise AssertionError(path)


def readiness_search(payload, context=None, **_kw):
    jql = payload['jql']
    user, helper = attribute(context, jql)
    failed, _wait = REC.call(user, 'readiness', helper)
    if failed:
        return unavailable_429()
    if 'issuetype = Epic' in jql:                       # discovery: 160 epics in pages of at most 100
        keys = epic_keys_for(user)
        page = keys[100:] if payload.get('nextPageToken') else keys[:100]
        body = {'issues': [{'key': k, 'fields': {'project': {'key': f'U{user}P'}}} for k in page], 'isLast': bool(payload.get('nextPageToken'))}
        if not body['isLast']:
            body['nextPageToken'] = f'U{user}-page-2'
        return Resp(body)
    batch = re.findall(r'"(U\d+E-\d+)"', jql)
    batch = list(dict.fromkeys(batch))
    if jql.startswith('issuetype = Story'):             # child batch: two Stories per epic, one Team each
        rows = []
        for epic in batch:
            n = int(epic.split('-')[1])
            for j in range(CHILDREN_PER_EPIC):
                rows.append({'key': f'U{user}C-{n * 10 + j}', 'fields': {
                    'parent': {'key': epic}, 'status': {'name': 'In Progress'},
                    'customfield_sprint': [{'id': int(SPRINT[0])}], 'customfield_team': {'id': f'team-{n % TEAMS}'}}})
        return Resp({'issues': rows, 'isLast': True})
    if jql.startswith('key in'):                        # enrichment batch
        rows = []
        for epic in batch:
            n = int(epic.split('-')[1])
            rows.append({'id': str(n), 'key': epic, 'fields': {
                'summary': f'Synthetic epic {n}', 'status': {'name': 'In Progress'}, 'priority': {'name': 'High'},
                'assignee': None, 'labels': [f'team_{n % TEAMS}', f'team_{(n + 1) % TEAMS}'], 'components': [],
                'parent': None, 'project': {'key': f'U{user}P'}, 'customfield_track': {'value': 'Committed'},
                'customfield_team': {'id': f'team-{n % TEAMS}'}}})
        return Resp({'issues': rows, 'isLast': True})
    raise AssertionError(jql)


eng_routes.bind_server_globals(vars(eng_routes))
eng_routes.current_jira_get = readiness_get
eng_routes.current_jira_search = readiness_search


def context_for(user):
    return RequestAuthContext(
        auth_mode='basic', user_id=f'user-{user}', stable_subject=f'user-{user}',
        workspace_id='workspace', auth_connection_id='local-basic-connection',
        atlassian_account_id='', cloud_id='', site_url='https://example.invalid', token_version='1',
        account_status='active', is_admin=False,
    )


def run_dependencies(user, context):
    keys = [f'U{user}S-{i}' for i in range(DEP_KEYS)]
    kwargs = {}
    if 'max_concurrency' in COLLECT_PARAMS: kwargs['max_concurrency'] = CONCURRENCY
    if 'strict' in COLLECT_PARAMS: kwargs['strict'] = True
    if 'deadline' in COLLECT_PARAMS: kwargs['deadline'] = time.monotonic() + DEPS_DEADLINE
    try:
        result = js.collect_dependencies(keys, context=context, **kwargs)
        edges = sum(len(v) for v in result.values())
        return ('ok' if edges == DEP_KEYS // 2 else f'silent_partial:{edges}_of_{DEP_KEYS // 2}_edges'), edges
    except Exception as exc:  # JiraBatchIncomplete after Task 2, anything else today
        partial = getattr(exc, 'partial', None)
        edges = sum(len(v) for v in partial.values()) if isinstance(partial, dict) else 0
        reason = getattr(exc, 'reason', None)
        return (f'incomplete:{reason}' if reason else f'error:{type(exc).__name__}:{exc}'), edges


def run_readiness(user, context):
    group = {'id': f'dept{user}', 'revision': 1,
             'teams': [{'id': f'team-{t}', 'name': f'Team {t}', 'labels': [f'team_{t}']} for t in range(TEAMS)]}
    projects = [{'key': f'U{user}P', 'type': 'product'}, {'key': f'U{user}T', 'type': 'tech'}]
    config = {'board': {'boardId': str(700 + user)}, 'sprintField': {'fieldId': 'customfield_sprint'},
              'teamField': {'fieldId': 'customfield_team'}, 'projectTrackField': {'fieldId': 'customfield_track'}}
    transport = EngBoardRequestTransport(budget=EngBoardRequestBudget.start(25))
    try:
        result, _timing = eng_routes._story_readiness_compute(context, SPRINT, group, projects, config, transport)
        epics = len(result.get('epics') or [])
        return ('ok' if epics == EPICS else f'wrong_epics:{epics}'), epics
    except Exception as exc:
        return f'error:{type(exc).__name__}:{exc}', 0


def pct(values, p):
    values = sorted(values)
    if not values:
        return None
    return values[max(0, -(-p * len(values) // 100) - 1)]   # nearest rank


def run_pass(n_users, fail_user):
    REC.reset(fail_user)
    contexts = {u: context_for(u) for u in range(n_users)}
    REC.user_contexts = {id(ctx): u for u, ctx in contexts.items()}
    barrier = threading.Barrier(n_users)
    samples = {u: [] for u in range(n_users)}
    stop = threading.Event()
    bystander = []

    def bystander_loop():
        next_at = time.perf_counter()
        while not stop.is_set():
            started = time.perf_counter()
            REC.call(None, 'bystander', False)
            bystander.append((started, time.perf_counter() - started))
            next_at += 0.1
            time.sleep(max(0.0, next_at - time.perf_counter()))

    def user_loop(user):
        _local.user = user
        _local.own_ident = threading.get_ident()
        REC.user_threads[threading.get_ident()] = user
        for iteration in range(args.iterations):
            barrier.wait()
            t0 = time.perf_counter()
            deps_outcome, edges = run_dependencies(user, contexts[user])
            t1 = time.perf_counter()
            ready_outcome, epics = run_readiness(user, contexts[user])
            t2 = time.perf_counter()
            samples[user].append({'iteration': iteration, 'depsMs': (t1 - t0) * 1000, 'readinessMs': (t2 - t1) * 1000,
                                  'totalMs': (t2 - t0) * 1000, 'deps': deps_outcome, 'edges': edges,
                                  'readiness': ready_outcome, 'epics': epics})

    probe = threading.Thread(target=bystander_loop, name='bystander')
    probe.start()
    time.sleep(0.3)                                      # a few bystander samples before the users start
    window_start = time.perf_counter()
    threads = [threading.Thread(target=user_loop, args=(u,), name=f'user-{u}') for u in range(n_users)]
    for t in threads: t.start()
    for t in threads: t.join()
    window_end = time.perf_counter()
    stop.set(); probe.join()

    calls = REC.calls
    user_calls = [c for c in calls if c[0] is not None]
    waits = [c[4] * 1000 for c in calls]
    in_window = [lat * 1000 for start, lat in bystander if window_start <= start <= window_end]
    per_user = {}
    for u, rows in samples.items():
        per_user[u] = {
            'calls': sum(1 for c in user_calls if c[0] == u),
            'totalMs': {'p50': pct([r['totalMs'] for r in rows], 50), 'p95': pct([r['totalMs'] for r in rows], 95)},
            'depsMs': {'p50': pct([r['depsMs'] for r in rows], 50), 'p95': pct([r['depsMs'] for r in rows], 95)},
            'readinessMs': {'p50': pct([r['readinessMs'] for r in rows], 50), 'p95': pct([r['readinessMs'] for r in rows], 95)},
            'outcomes': sorted({f"deps={r['deps']}" for r in rows} | {f"readiness={r['readiness']}" for r in rows}),
            'failures': sum(1 for r in rows if r['deps'] != 'ok' or r['readiness'] != 'ok'),
        }
    healthy = [u for u in samples if u != fail_user]
    all_rows = [r for u in healthy for r in samples[u]]
    helpers_after_429 = None
    if REC.first_429_at is not None:
        helpers_after_429 = sum(1 for c in calls if c[5] and REC.first_429_at <= c[2] <= REC.first_429_at + 10)
    return {
        'users': n_users, 'failUser': fail_user, 'iterations': args.iterations,
        'healthyUsers': {
            'totalMs': {'p50': pct([r['totalMs'] for r in all_rows], 50), 'p95': pct([r['totalMs'] for r in all_rows], 95)},
            'depsMs': {'p50': pct([r['depsMs'] for r in all_rows], 50), 'p95': pct([r['depsMs'] for r in all_rows], 95)},
            'readinessMs': {'p50': pct([r['readinessMs'] for r in all_rows], 50), 'p95': pct([r['readinessMs'] for r in all_rows], 95)},
            'worstUserTotalP95Ms': max((per_user[u]['totalMs']['p95'] for u in healthy), default=None),
            'failures': sum(per_user[u]['failures'] for u in healthy),
        },
        'perUser': per_user,
        'totalUserCalls': len(user_calls),
        'callsPerUserIteration': len(user_calls) / (n_users * args.iterations) if fail_user is None else None,
        'peakJiraInFlightUsers': REC.peak_user_in_flight,
        'peakJiraInFlightAll': REC.peak_in_flight,
        'peakCallersIncludingWaiting': REC.peak_callers,
        'peakHelperCallsInFlight': REC.peak_helper_in_flight,
        'helperCalls': sum(1 for c in calls if c[5]),
        'helperCallsWithin10sAfterFirst429': helpers_after_429,
        'sessionWaitMs': {'total': sum(waits), 'max': max(waits, default=0), 'p95': pct(waits, 95),
                          'callsThatWaited': sum(1 for w in waits if w > 1)},
        'bystanderMs': {'samples': len(in_window), 'p50': pct(in_window, 50), 'p95': pct(in_window, 95), 'max': max(in_window, default=None)},
        'wallMs': (window_end - window_start) * 1000,
    }


def main():
    users = [int(x) for x in args.users.split(',') if x]
    detected = {name: name in COLLECT_PARAMS for name in ('max_concurrency', 'strict', 'deadline')}
    out = {'label': args.label, 'latencyMs': LAT * 1000, 'slots': args.slots, 'iterations': args.iterations,
           'depKeys': DEP_KEYS, 'epics': EPICS, 'collectDependenciesKeywords': detected,
           'jiraBatchesModule': _jira_batches is not None, 'percentileMethod': 'nearest-rank',
           'sessionModel': 'slot held for the whole fake call (upper bound)', 'passes': {}}
    print(f"label={args.label} latency={LAT * 1000:.0f} ms slots={args.slots} iterations={args.iterations} keywords={detected}")
    for pass_name, fail_user in (('normal', None), ('429', 0)):
        for n in users:
            if pass_name == '429' and COOLDOWN:
                time.sleep(COOLDOWN + 1)                 # let a previous pass's process-wide cooldown expire
            result = run_pass(n, fail_user)
            out['passes'][f'{pass_name}/{n}'] = result
            h = result['healthyUsers']
            fu = result['perUser'][0] if fail_user is not None else None
            print(f"[{pass_name} N={n}] healthy total p50 {h['totalMs']['p50'] and round(h['totalMs']['p50'])} p95 {h['totalMs']['p95'] and round(h['totalMs']['p95'])} ms "
                  f"(deps p50/p95 {h['depsMs']['p50'] and round(h['depsMs']['p50'])}/{h['depsMs']['p95'] and round(h['depsMs']['p95'])}, "
                  f"readiness {h['readinessMs']['p50'] and round(h['readinessMs']['p50'])}/{h['readinessMs']['p95'] and round(h['readinessMs']['p95'])}); "
                  f"worst user p95 {h['worstUserTotalP95Ms'] and round(h['worstUserTotalP95Ms'])}; failures {h['failures']}; "
                  f"calls {result['totalUserCalls']} ({result['callsPerUserIteration']} per user-iteration); "
                  f"peak in flight users {result['peakJiraInFlightUsers']} all {result['peakJiraInFlightAll']}; helpers peak {result['peakHelperCallsInFlight']}; "
                  f"session wait total {result['sessionWaitMs']['total']:.1f} max {result['sessionWaitMs']['max']:.1f} ms; "
                  f"bystander p50/p95/max {result['bystanderMs']['p50']:.1f}/{result['bystanderMs']['p95']:.1f}/{result['bystanderMs']['max']:.1f} ms (n={result['bystanderMs']['samples']})")
            if fu is not None:
                print(f"    429 user: calls {fu['calls']}, outcomes {fu['outcomes']}, total p50 {round(fu['totalMs']['p50'])} ms; helpers within 10 s of the first 429: {result['helperCallsWithin10sAfterFirst429']}")
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f'admission-{args.label}.json')
    with open(path, 'w') as handle:
        json.dump(out, handle, indent=2, default=str)
    print('wrote', os.path.relpath(path))


main()
```
