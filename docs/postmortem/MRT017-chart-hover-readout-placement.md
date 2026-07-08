# Postmortem MRT017: Chart Hover Readout Placement Regression

**Date**: 2026-05-20
**Severity**: Medium
**Status**: Resolved
**Author**: Codex

## Summary

Effort Split and Excluded Capacity line-chart hover readouts were repeatedly unreadable or misplaced in the Statistics panel. The Effort Split readout for a hovered bar could appear below the chart, and the line-chart readout at the right edge could extend beyond the panel background or become visually squashed.

## Impact

- Users affected: anyone inspecting Statistics > Excluded Capacity hover details.
- Duration: multiple correction rounds during the Effort Split implementation.
- Symptoms:
  - Hovering an Effort Split bar could show the readout below the Effort Split chart.
  - Hovering near the right edge of the line chart could push the readout outside the panel background.
  - Readout text could become clipped or compressed, making team and metric values unreadable.

## Root Cause

The Effort Split readout used `position: fixed` while it was rendered inside `.stats-view.open`. That container has `transform: translateY(0)`, and transformed ancestors create a containing block for fixed descendants. The component passed viewport `clientX` / `clientY` values into a node that was effectively positioned inside the transformed stats view, so the readout was offset downward and could appear below the graph.

The Excluded Capacity line-chart readout used percentage `left` / `top` values and `transform: translate(-50%, -50%)`. The code clamped the center point, not the actual bubble bounds. At chart edges, the bubble could still extend past the visible panel. The min-width plus clipped edge made the hover look squashed.

The automated checks were too weak. They verified that a custom hover existed and had a readable background, but they did not prove pointer-relative placement inside a transformed stats panel or enforce panel-edge containment.

## Timeline

- 2026-05-20: Effort Split chart was added with custom hover readouts.
- 2026-05-20: Initial hover fixes addressed dark/unreadable bubbles and basic viewport clamping.
- 2026-05-20: User reported the Bidline hover appearing below the graph and right-edge line-chart hovers escaping the panel.
- 2026-05-20: Root cause traced to transformed containing blocks and center-only edge clamping.
- 2026-05-20: Readouts were moved to `document.body` portals and tested with pointer/edge assertions.

## Resolution

- Rendered Effort Split and line-chart hover bubbles through `document.body` portals so transformed stats containers no longer alter fixed-position coordinates.
- Changed hover placement to use pointer coordinates with explicit width and height reservations.
- Preferred opening to the right of the pointer, with a left-side fallback when the right edge cannot fit the bubble.
- Added Playwright checks that verify:
  - Effort Split readouts stay near the pointer and inside the viewport.
  - Line-chart readouts stay inside the open stats panel at the right edge.
- Added source guards that require body-level readout rendering and width/height-aware edge placement.

## Verification

- `node --test tests/test_excluded_capacity_stats_source_guards.js`
- `npx playwright test tests/ui/codebase_structure_smoke.spec.js -g "Excluded Capacity summary"`

## Lessons Learned

- `position: fixed` is not viewport-fixed when an ancestor has `transform`; render overlays outside transformed containers or avoid the transform.
- Tooltip clamping must reserve the rendered bubble width and height, not just clamp the anchor point.
- Hover fixes need rendered edge assertions because source checks can pass while the actual panel still clips or offsets the readout.

## Action Items

- [x] Move chart hover readouts out of transformed stats containers.
- [x] Add pointer-relative edge checks for Effort Split and line-chart hovers.
- [x] Document this regression in a postmortem.
- [ ] Consider extracting shared chart-hover placement helpers if another chart needs pointer readouts.

## Prevention

- Any chart hover inside Statistics must be tested at an edge point in Playwright.
- Edge assertions must compare the readout rectangle with the viewport or owning panel rectangle.
- Avoid native title tooltips and center-only percentage positioning for chart readouts.

## Related Issues

- MRT009: Sticky Layering Regressions

## References

- `frontend/src/stats/EffortTypeSplitChart.jsx`
- `frontend/src/stats/ExcludedCapacityLineChart.jsx`
- `frontend/src/styles/dashboard.css`
- `tests/ui/codebase_structure_smoke.spec.js`
- `tests/test_excluded_capacity_stats_source_guards.js`
