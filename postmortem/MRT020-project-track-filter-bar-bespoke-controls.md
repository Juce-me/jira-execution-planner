# Postmortem MRT020: Project Track Filter Bar Reinvented Existing Controls

**Date**: 2026-07-01
**Severity**: Medium
**Status**: In Progress
**Author**: Execution session (subagent-driven development)

## Summary

The new ENG **Project Track** stats tab shipped a filter bar whose **Exclusions** group was built with bespoke CSS/markup instead of the design system's existing control patterns. The result rendered broken: the "EXCLUSIONS" group heading clipped to "XCLUSIONS", the two checkboxes appeared detached from their labels, and the "Exclude Excluded Capacity" label visually overflowed its group box and overlapped the adjacent MODE control. A Playwright "no-overlap" assertion passed anyway, giving false confidence.

## Impact

- **Users affected**: anyone opening ENG → Stats → Project Track (the new tab). No data or functional impact — the toggles work; the defect is purely visual layout.
- **Duration**: introduced in Task 3 (commit `3353ccc`) and not caught through Tasks 3–5; surfaced by user screenshot during execution.
- **Symptoms**: clipped "EXCLUSIONS" heading; checkbox glyphs visually separated from their text; long exclusion label overlapping the MODE segmented control.

## Root Cause

Two independent failures compounded:

1. **Reinvention instead of reuse (primary).** The capacity-side and mode toggles correctly reused the shared `SegmentedControl`, and the sprint selects reused `.stats-control-group` + `.scenario-input`. But the Exclusions group was hand-rolled:
   - `frontend/src/dashboard.jsx` (~13649–13667): bespoke `.project-track-exclusions` group and `.project-track-checkbox` label rows rather than an existing checkbox/toggle pattern.
   - `frontend/src/styles/stats/project-track.css` (~29–61): a bespoke `.project-track-exclusions { display:flex; flex-direction:column; min-width:210px }` plus `.project-track-checkbox { white-space:nowrap; font-size:0.72rem; text-transform:none }`. This overrode the established `.stats-control-group label` typography (0.65rem, uppercase, monospace, secondary color — `shell.css:9-17`), so the labels looked foreign, and:
     - the `min-width: 210px` was a **guess** that reserved space for the checkbox rows but not the "EXCLUSIONS" heading, which then clipped;
     - `white-space: nowrap` on a ~26-char label ("Exclude Excluded Capacity") let the text overflow the group's box (CSS overflow is `visible` by default) and spill under the MODE control, without changing the element's layout box.

2. **A layout test that measured the wrong thing (why it wasn't caught).** `tests/ui/codebase_structure_smoke.spec.js` (~1187–1202) asserted non-overlap by comparing `getBoundingClientRect()` of sibling `.stats-control-group` elements. `getBoundingClientRect()` returns the element's own layout box and ignores visually-overflowing (`overflow: visible`, `white-space: nowrap`) child text. So the assertion was green while the rendered text overlapped. The test proved layout-box separation, not visual correctness — and I relied on that green as visual verification instead of looking at a screenshot.

An earlier "overlap fix" during Task 3 introduced the `min-width` reservation and the bounding-box assertion — it treated the symptom (group boxes touching) with a magic-number guess rather than the cause (bespoke, unwrapped, oversized labels), and locked in a test that couldn't see the real defect.

## Timeline

- Task 3 (`3353ccc`): Project Track tab added; Exclusions group hand-rolled; a bounding-box "no-overlap" Playwright assertion added after an observed overlap.
- Tasks 3–5 reviews: focused on data reuse, wiring, and endpoint correctness; the filter-bar visual defect was not screenshot-verified by the controller — the green bounding-box assertion was accepted as visual proof.
- 2026-07-01: user provided a screenshot showing the clipped heading and overlap; investigation confirmed the bespoke CSS + insufficient test.

## Resolution

Replace the bespoke Exclusions styling with the existing design-system patterns (fix in progress):

- Remove `.project-track-exclusions` column-flex + `min-width: 210px` and the `.project-track-checkbox` typography/casing/`nowrap` overrides.
- Reuse the established inline checkbox/inclusion-toggle pattern already used elsewhere in the app, and the base `.stats-control-group label` typography for the group heading, so the Exclusions group matches every other stats control.
- Let the group size to its content and wrap normally; do not reserve width with a magic number, and do not use `nowrap` that overflows.

## Verification

Fix is validated by:

- A Playwright assertion that measures **real rendering**, not just layout boxes: assert the "EXCLUSIONS" heading is not clipped (`scrollWidth <= clientWidth`), and that each checkbox label's own `getBoundingClientRect().right` does not exceed its group's right edge nor cross the MODE control's left edge.
- A settled before/after screenshot at the target viewport.
- `npm run build` clean and the existing Project Track smoke test still green.

## Lessons Learned

- **A green geometry assertion is not visual verification.** `getBoundingClientRect()` on a container cannot see overflowing `nowrap` text; only a screenshot (or measuring the overflowing element itself / `scrollWidth`) catches it. The controller must look at the screenshot, not trust a bounding-box test.
- **Reuse beats reinvention — and prevents this class of bug.** The break lived entirely in the hand-rolled group; every reused control (`SegmentedControl`, `.scenario-input`) rendered correctly. Matching an existing pattern would have inherited its correct, tested typography and layout.
- **Magic-number CSS ("reserve 210px") is a smell.** It encodes an assumption about content width that silently breaks when content or viewport changes; size-to-content is the correct default.

## Action Items

- [ ] Rebuild the Exclusions group by reusing the existing checkbox/toggle + `.stats-control-group label` patterns; delete the bespoke classes and `min-width`/`nowrap` overrides.
- [ ] Replace the bounding-box-only Playwright check with a real-rendering assertion (heading not clipped; label right-edge within group; no overlap with MODE) and capture a screenshot.
- [ ] Rebuild `frontend/dist` and confirm the Project Track smoke test passes with the new assertion.
- [ ] Add a root `AGENTS.md` learning: reuse existing control components/classes for new filter bars, and verify filter-bar layout with a screenshot + element-level (not container-only) geometry assertions.
- [ ] Flip this postmortem to Resolved once the fix lands and is screenshot-verified.

## Prevention

- When adding a control to an existing surface, reuse the established component/class (SegmentedControl, `.stats-control-group`, existing checkbox/inclusion-toggle) before writing any new CSS; a new bespoke class for a control that already exists is a review-stop.
- For any filter-bar/layout change, visual verification means a screenshot plus geometry assertions on the actual text-bearing elements (and `scrollWidth`/`clientWidth` clip checks), never only container bounding boxes.

## Related Issues

- [MRT017](./MRT017-chart-hover-readout-placement.md) — chart hover readout placement (another "geometry looked fine, render was wrong" case).
- [MRT009](./MRT009-sticky-layering-regressions.md) — layout regressions from not respecting the existing layering/design system.

## References

- `frontend/src/dashboard.jsx` (~13611–13680) — filter-bar markup, bespoke Exclusions group.
- `frontend/src/styles/stats/project-track.css` (~29–61) — bespoke `.project-track-exclusions` / `.project-track-checkbox` overrides.
- `tests/ui/codebase_structure_smoke.spec.js` (~1187–1202) — bounding-box-only non-overlap assertion.
- `frontend/src/styles/stats/shell.css` (~9–17) — the `.stats-control-group label` typography that should have been reused.
- Introduced in commit `3353ccc` (Task 3).
