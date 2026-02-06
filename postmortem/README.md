# Postmortem Index

This directory contains postmortem analyses of significant issues discovered and resolved in the Jira Execution Planner project.

## Purpose

Postmortems serve to:
- Document root causes and resolutions
- Share lessons learned across the team
- Prevent similar issues in the future
- Build institutional knowledge
- Improve development practices
- Capture misses and near-misses while they are fresh

## Postmortem List

| ID | Title | Created | Severity | Status | Summary |
|---|-------|---------|----------|--------|---------|
| [MRT001](./MRT001-missing-teams-stats.md) | Missing Teams in Stats View | 2026-01-22 | Medium | Resolved | Teams with zero issues were omitted from selector and stats tables |
| [MRT002](./MRT002-perf-idle-cpu.md) | Scenario Planner Idle CPU Spike | 2026-01-22 | High | Resolved | Idle render loop pegged CPU due to unstable memo defaults |
| [MRT003](./MRT003-scenario-planner-regressions.md) | Scenario Planner Regressions | 2026-01-22 | High | Resolved | Scroll-linked updates and layout regressions caused timeouts and wrong deps |
| [MRT004](./MRT004-performance-degradation-page-load.md) | Performance Degradation on Page Load | 2026-01-27 | High | Resolved | Page load time increased due to missing guards and memo deps |
| [MRT005](./MRT005-false-conflict-detection.md) | False Conflict Detection | 2026-01-27 | Medium | Resolved | Conflicts flagged from excluded tasks and O(n²) comparisons |
| [MRT006](./MRT006-lane-stacking-assignee-interleaving.md) | Lane Stacking Assignee Interleaving | 2026-01-27 | High | Resolved | Tasks merged across assignees due to lane stacking bug |
| [MRT007](./MRT007-bundled-frontend-regression.md) | Bundled Frontend Regression | 2026-01-28 | High | In Progress | Bundled frontend failed to load due to static route gaps and runtime TDZ errors |
| [MRT008](./MRT008-scenario-task-set-mismatch.md) | Scenario Planner Missing Valid Stories | 2026-01-29 | High | Resolved | Scenario planner omitted valid stories due to sprint filter mismatch and pagination gaps |
| [MRT009](./MRT009-sticky-layering-regressions.md) | Sticky Layering Regressions | 2026-02-06 | High | Resolved | Sticky UI layers overlapped or stacked incorrectly after layout changes |

## Postmortem Template

Each postmortem follows this structure:

```markdown
# Postmortem MRTXXX: [Title]

**Date**: YYYY-MM-DD
**Severity**: [Critical/High/Medium/Low]
**Status**: [Resolved/In Progress/Monitoring]
**Author**: [Name]

## Summary
Brief description of the incident

## Impact
- Users affected
- Duration
- Symptoms

## Root Cause
Technical details of what went wrong

## Timeline
Chronological events

## Resolution
How it was fixed

## Verification
How the fix was validated

## Lessons Learned
- What went well
- What could be improved

## Action Items
- [x] Completed items
- [ ] Pending items

## Prevention
How to avoid similar issues

## Related Issues
Links to related postmortems

## References
Commits, files, documentation
```

## Statistics

- **Total postmortems**: 9
- **Metadata complete (Date/Severity/Status)**: 9 (MRT001-MRT009)

## Common Themes

### Issues Found
1. **Testing Gaps**: Insufficient testing with empty/edge case data
2. **Algorithm Validation**: Need peer review for complex algorithms
3. **Backend/Frontend Alignment**: Frontend didn't match backend logic
4. **Performance**: Missing optimization guards in React hooks

### Action Items Summary
Across all postmortems, key actions needed:

**Immediate** (Already Done):
- ✅ Add early return guards to expensive computations
- ✅ Fix missing memoization dependencies
- ✅ Optimize conflict detection from O(n²) to O(n)
- ✅ Implement assignee-aware lane stacking

**Short Term** (TODO):
- [ ] Add ESLint rule: `react-hooks/exhaustive-deps` enforcement
- [ ] Add performance tests for empty data states
- [ ] Add integration tests with real Jira data
- [ ] Add visual regression tests
- [ ] Document algorithm design decisions

**Medium Term** (TODO):
- [ ] Performance budget metrics in CI
- [ ] Conflict detection accuracy metric
- [ ] Consider moving conflict detection to backend
- [ ] Add assignee labels to lane rows

## Contributing

When creating a new postmortem:

1. **Name it sequentially**: `MRTXXX-short-title.md` (oldest first, then increment)
2. **Use the template** above
3. **Be blameless**: Focus on systems, not people
4. **Be specific**: Include code snippets, data, screenshots
5. **Be actionable**: List concrete action items
6. **Update this README**: Add entry to the table

## Related Documentation

- [SCENARIO_PLANNER_ANALYSIS.md](../SCENARIO_PLANNER_ANALYSIS.md): Original feature analysis
- [SCENARIO_BUG_ANALYSIS.md](../SCENARIO_BUG_ANALYSIS.md): Detailed bug analysis for MRT006

## Questions?

For questions about postmortems or to discuss issues, contact the development team.

---

*Last Updated: 2026-02-06*
*Total Postmortems: 9*
