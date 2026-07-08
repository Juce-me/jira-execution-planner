# Postmortem Index

This directory contains postmortem analyses of significant issues discovered and resolved in the Jira Delivery Planner project.

## Purpose

Postmortems serve to:
- Document root causes and resolutions
- Share lessons learned across the team
- Prevent similar issues in the future
- Build institutional knowledge
- Improve development practices
- Capture misses and near-misses while they are fresh
- Guide agents to review relevant postmortems before touching related code

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
| [MRT010](./MRT010-startup-api-load-fanout-and-overscoped-payloads.md) | Startup API Load Fan-Out and Overscoped Payloads | 2026-02-23 | High | Resolved | Slow cold loads caused by heavy endpoint reuse, overscoped preload requests, and redundant backend query passes |
| [MRT011](./MRT011-epm-settings-overgeneralized-selection-ux.md) | EPM Settings Overgeneralized Selection UX | 2026-04-21 | High | In Progress | Persistent search controls and heavy live fetch reuse made EPM settings slow, unreadable, and misleading |
| [MRT012](./MRT012-epm-active-sprint-value-hidden.md) | EPM Active Sprint Value Hidden | 2026-04-27 | High | In Progress | EPM Active used hidden sprint state without showing the selected sprint value or selector |
| [MRT013](./MRT013-epm-active-home-projects-hidden.md) | EPM Active Home Projects Hidden | 2026-04-30 | High | Resolved | Home project pagination and status-label normalization hid Active projects before rollup rendering |
| [MRT014](./MRT014-epm-cold-load-cache-race.md) | EPM Cold Load Cache Race | 2026-04-30 | Medium | Resolved | EPM cold load could race Home project discovery with all-project rollup and lacked timing visibility |
| [MRT015](./MRT015-epm-first-load-home-fanout-overfetch.md) | EPM First Load Home Fan-Out and Overfetch | 2026-05-01 | High | Resolved | Slow first EPM load came from per-project Home enrichment fan-out and unscoped all-project metadata fetches |
| [MRT016](./MRT016-exec-02-plan-file-map-drift.md) | EXEC-02 Plan File Map Drift | 2026-05-11 | Medium | Resolved | EXEC-02 frontend task referenced future files as existing files and crossed task boundaries |
| [MRT017](./MRT017-chart-hover-readout-placement.md) | Chart Hover Readout Placement Regression | 2026-05-20 | Medium | Resolved | Chart hover readouts were offset by transformed containers and clipped by center-only edge clamping |
| [MRT018](./MRT018-lead-times-stats-panel-overflow.md) | Lead Times Stats Panel Overflow | 2026-06-12 | High | Resolved | Lead Times long lists clipped inside nested stats view caps and lacked load-more validation |
| [MRT019](./MRT019-ready-to-close-truncated-child-scan.md) | Ready-to-Close Truncated Child Scan | 2026-06-21 | Medium | Resolved | Silent 250-cap truncation let Ready-to-Close fire on epics with open future-sprint children; fixed with an authoritative open-child count |
| [MRT020](./MRT020-project-track-filter-bar-bespoke-controls.md) | Project Track Filter Bar Reinvented Existing Controls | 2026-07-01 | Medium | Resolved | New tab's Exclusions group used bespoke CSS/markup instead of existing control patterns; clipped heading + label overflow overlapped MODE; a bounding-box-only Playwright check passed while the render was broken. Fixed by reusing shell.css control typography + element-level render assertions |
| [MRT021](./MRT021-project-track-segmented-control-override.md) | Project Track Segmented Controls Overridden Instead of Reused | 2026-07-02 | Medium | Resolved | Recurrence of MRT020 on the sibling controls: Capacity/Mode reused SegmentedControl but a local CSS override forced wrap/auto-height and they missed the `eng-mode-control` class; shipped through a "READY TO MERGE" sign-off. Introduced by Claude, fixed by Codex (`c3fe99c`) with `eng-mode-control` reuse + single-row/fixed-height Playwright assertions |
| [MRT022](./MRT022-agent-branded-branch-names.md) | Agent-Branded Branch Names Ignored Git Conventions | 2026-07-08 | Low | Resolved | Sessions repeatedly started on auto-generated `claude/*` branches despite AGENTS.md forbidding tool branding and requiring typed branch prefixes; fixed with a session-start rename rule in AGENTS.md section 11 |

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

- **Total postmortems**: 22
- **Metadata complete (Date/Severity/Status)**: 22 (MRT001-MRT022)

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

1. **Review related postmortems first**: Apply relevant lessons before touching related code
2. **Follow local instructions**: Use [docs/postmortem/AGENTS.md](./AGENTS.md) for directory-specific agent guidance
3. **Name it sequentially**: `MRTXXX-short-title.md` (oldest first, then increment)
4. **Use the template** above
5. **Be blameless**: Focus on systems, not people
6. **Be specific**: Include code snippets, data, screenshots
7. **Be verified**: Include how the fix or conclusion was validated
8. **Be actionable**: List concrete action items
9. **Update this README**: Add entry to the table whenever adding or renaming a postmortem
10. **Keep docs aligned**: Update `README.md`, `AGENTS.md`, and `docs/postmortem/README.md` together when workflow or structure changes

## Related Documentation

- [SCENARIO_PLANNER_ANALYSIS.md](../SCENARIO_PLANNER_ANALYSIS.md): Original feature analysis
- [SCENARIO_BUG_ANALYSIS.md](../SCENARIO_BUG_ANALYSIS.md): Detailed bug analysis for MRT006

## Questions?

For questions about postmortems or to discuss issues, contact the development team.

---

*Last Updated: 2026-06-12*
*Total Postmortems: 18*
