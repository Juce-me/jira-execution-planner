# Postmortem MRT010: Startup API Load Fan-Out and Overscoped Payloads

**Date**: 2026-02-23
**Severity**: High
**Status**: Resolved
**Author**: Codex (GPT-5)

---

## Summary

Initial dashboard load performed multiple expensive API calls in parallel, including non-critical preload requests that reused the same heavy endpoint as the visible dashboard data. This caused slow page load behavior, large payloads, and redundant server work on cold loads.

## Impact

- **Users Affected**: Dashboard users on cold page load (especially with cache disabled / empty server cache)
- **Duration**: Ongoing until investigation and optimization on 2026-02-23
- **Symptoms**:
  - Several API requests triggered immediately on page load
  - Initial visible data requests taking multiple seconds
  - Additional deferred analysis requests still downloading large payloads
  - Duplicate dependency-analysis request during startup in some load sequences

## Root Cause

This was not a single bug. It was a combination of frontend request orchestration and backend endpoint overuse.

### 1. Startup request fan-out reused a heavy endpoint for two different jobs

The frontend intentionally loaded:
- Two current-sprint task requests (visible dashboard data)
- Two all-scope analysis preload requests for alert logic

The issue was that both flows used the same heavy task endpoint, which performs task fetch + epic enrichment + alert-related counting/distribution work.

### 2. Analysis preload scope was too broad

The alert preload requests were fetching a broad all-time dataset, even though only data for epics already present in the selected sprint was needed. This inflated payload size and server work.

### 3. Backend did redundant Jira query work inside epic count/distribution helpers

Epic count/distribution logic ran multiple Jira searches per batch:
- separate passes for `"Epic Link"` and `parent`
- separate selected-sprint passes for total vs actionable children (before optimization)

This created extra round trips and made epic distribution the dominant backend cost.

### 4. No built-in timing breakdown for the endpoint

Before instrumentation, it was hard to identify whether the bottleneck was:
- Jira task search
- epic enrichment
- epic count/distribution
- response shaping

This delayed precise optimization.

## Timeline

- **T+0**: User reports slow page load and shows multiple startup requests in browser network panel
- **T+10m**: Frontend request pattern identified (4 task requests on startup: 2 visible + 2 analysis preload)
- **T+25m**: Ready-to-close analysis preload deferred to after main sprint data load
- **T+40m**: Analysis preload scoped to current-sprint epics and switched to lightweight mode
- **T+55m**: Duplicate startup dependency-analysis request eliminated
- **T+75m**: Backend timing instrumentation added (`debugTimings`, `Server-Timing`)
- **T+95m**: Epic count/distribution Jira query flow optimized (parallelization + query consolidation)
- **T+110m**: Re-measured on local server and confirmed improved startup timings

## Resolution

### Frontend changes (request orchestration and scope)

1. **Deferred non-critical alert preload**
- Moved analysis preload requests to run after current-sprint product+tech requests complete
- Reduced contention on initial visible dashboard data load

2. **Scoped analysis preload to current-sprint epic keys**
- Computed epic keys from already-loaded current-sprint tasks
- Sent only those epic keys to backend for analysis preload
- Prevented broad all-scope task downloads for alert calculations

3. **Deduplicated startup dependency-analysis request**
- Added gating so dependency analysis runs once after both current-sprint datasets are ready
- Removed duplicate startup `POST /dependencies` trigger pattern

### Backend changes (endpoint cost reduction)

1. **Lightweight mode for analysis preload**
- Added request purpose handling so analysis preload can skip expensive enrichments not needed for that path
- Returned minimal issue payload for preload rows (only fields required by alert logic)
- Requested fewer Jira fields in preload mode

2. **Cache key separation**
- Included request purpose and scoped epic keys in cache key derivation
- Prevented cache collisions between dashboard and analysis preload payload shapes

3. **Timing instrumentation**
- Added per-stage backend timings and optional `debugTimings` response output
- Added `Server-Timing` headers for browser/network visibility

4. **Epic distribution/count query optimization**
- Parallelized independent enrichment/count phases where safe
- Merged selected-sprint total + actionable counts into one pass
- Combined `"Epic Link"` and `parent` counting/distribution queries into single OR queries per batch

## Verification

### Functional

- ✅ Dashboard still loads expected visible data
- ✅ Alert-related preload still works after request deferral/scoping
- ✅ Only one dependency-analysis request fires during startup
- ✅ Test suite passes
- ✅ Frontend production build passes

### Performance (local measurement, cold requests)

Measured using local server requests with timing instrumentation enabled.

- **Main visible current-sprint requests**
  - Before optimization pass: approximately `3.0-4.0s`
  - After backend query-flow optimization: approximately `1.2-1.3s`

- **Deferred analysis preload requests**
  - Before scoping/lightweight mode: approximately `155-170KB` payloads and `~1.4s`
  - After scoping + lightweight payload: approximately `~48KB` payloads and `<1s`

- **Dominant backend stage reduced**
  - `epic_counts_distribution` dropped from roughly `0.8-1.6s` range to roughly `0.55-0.62s` in the measured cases

## Lessons Learned

### What Went Well
- User-provided network screenshots made the startup fan-out pattern immediately visible
- Instrumentation (`Server-Timing`) helped target the real backend bottleneck instead of guessing
- Incremental optimization preserved behavior while improving startup responsiveness

### What Could Be Improved
- Request intent should have been explicit earlier (visible dashboard data vs alert preload)
- Heavy endpoint reuse encouraged accidental overscoping
- Startup request orchestration lacked a performance budget and redundancy checks
- Backend sub-step timing instrumentation should exist before regressions happen

## Action Items

- [x] Defer non-critical alert preload until visible data loads
- [x] Scope alert preload requests to current-sprint epic keys
- [x] Add lightweight backend mode for alert preload
- [x] Deduplicate startup dependency-analysis request
- [x] Add backend timing instrumentation (`debugTimings`, `Server-Timing`)
- [x] Optimize epic count/distribution query flow
- [ ] Consider a dedicated alert-summary endpoint (avoid task-row payloads entirely for preload)
- [ ] Add automated startup request-count regression check (prevent redundant fetches)
- [ ] Define and document a startup API performance budget in CI/QA checks

## Prevention

To avoid similar regressions:

1. Treat startup API request count and payload size as review criteria for frontend changes
2. Do not reuse heavy endpoints for lightweight alert/preload needs without an explicit mode or dedicated endpoint
3. Keep backend timing instrumentation available in development builds
4. Require scoped preload requests (no broad "all-time" fetches unless strictly necessary)
5. Validate both cold-cache and warm-cache startup behavior during performance-sensitive changes

## Related Issues

- [MRT004](./MRT004-performance-degradation-page-load.md) - Earlier page-load performance regression (frontend compute path)

## References

- Commit: `22274a0` - Optimize startup API request scope and backend query flow
- Files:
  - `frontend/src/dashboard.jsx`
  - `jira_server.py`
  - `AGENTS.md`
