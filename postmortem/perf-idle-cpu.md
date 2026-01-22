# Postmortem: Scenario Planner Idle CPU Spike

## Summary
- Firefox CPU stayed ~90–100% at idle after page load.
- Perf logs showed thousands of renders per 5s with no user activity.

## Root Cause
- The Scenario auto-collapse effect ran even when Scenario had no data.
- It always wrote a new `scenarioCollapsedLanes` object (`{}` or new map), which triggered another render.
- Memoized Scenario inputs also used fresh `[]`/`{}` defaults each render, so dependencies were unstable.

## Fix
- Use stable empty defaults (`EMPTY_ARRAY`, `EMPTY_OBJECT`) for Scenario memo inputs.
- Guard `setScenarioCollapsedLanes` with equality checks.
- Skip auto-collapse when Scenario is hidden or has no lanes/issues.

## Why It Worked
- The render loop ended once redundant state writes stopped.
- Memo dependencies stabilized, so effects stopped re-firing.

## Prevention
- Add equality guards for state writes inside effects.
- Avoid inline `[]`/`{}` defaults in memo dependencies.
- Keep perf debug flags like `?perf=1` for quick loop detection.

## Verification
- Load `jira-dashboard.html?perf=1`.
- Wait ~20s idle: render deltas should drop to near-zero.
- Toggle Scenario on/off: no recurring render spike after closing.
