# Postmortem MRT021: Project Track Segmented Controls Overridden Instead of Reused

**Date**: 2026-07-02
**Severity**: Medium
**Status**: Resolved
**Author**: Execution session (subagent-driven development)
**Tooling**: Introduced by **Claude**; fixed by **Codex** (tool names recorded at the user's explicit request; this is a deliberate exception to the AGENTS.md §6 no-branding rule for this postmortem only).

## Summary

The Project Track stats tab reused the shared `SegmentedControl` component for the **Capacity side** (Product / Tech / Tech + Product) and **Mode** (Epic / Team) controls, but then a Project-Track-local CSS override (`.project-track-controls .segmented-control { flex-wrap: wrap; height: auto; min-height: … }`) fought the component's own layout, forcing the controls to wrap and grow to auto-height. The controls also missed the canonical `eng-mode-control` class, and the Exclusions checkbox rows were not tightened, so their labels ran into the Mode control. This is the same "override/reinvent an existing element instead of reusing it as-is" failure as MRT020 — recurring on the sibling controls that MRT020 did not touch.

## Impact

- **Users affected**: anyone opening ENG → Statistics → Project Track. Visual only — the controls function; the layout was wrong.
- **Symptoms**: the multi-button Capacity side / Mode segmented controls wrapped and rendered at an inconsistent (auto) height instead of the shared single-row fixed-height pill; the Exclusions checkbox rows crowded/ran toward the Mode control.
- **Duration / process failure**: introduced in Task 3 (`3353ccc`), survived the MRT020 fix, the polish wave (`af0863d`), the analytics/docs task, AND a final whole-branch review that I signed off as "READY TO MERGE" — despite the user having already pointed at this exact class of bug. The user had to catch it a second time.

## Root Cause

1. **Reused the component, then overrode its layout (primary).** `frontend/src/dashboard.jsx` correctly rendered `<SegmentedControl>` for both controls, but `frontend/src/styles/stats/project-track.css` added `.project-track-controls .segmented-control { flex-wrap: wrap; height: auto; min-height: var(--control-height); margin-top: 0; }`. Reusing a shared component means inheriting its layout; overriding `flex-wrap`/`height` locally defeats the reuse and reintroduces exactly the bespoke-layout problem the component exists to prevent. The controls were also never given the shared `eng-mode-control` class that the ENG mode controls use, so they didn't pick up the canonical mode-control styling.
2. **Exclusions rows not compact.** `.project-track-checkbox` used a looser gap/line-height and an unconstrained label span, so checked/unchecked rows could push toward the Mode control.
3. **Verification blind to the actual controls (why it shipped twice).** The Playwright coverage asserted the exclusion labels' geometry (added during MRT020) but had NO assertion on the segmented controls' single-row layout or fixed height, and no check that they carry the shared class. My "look at the screenshot" verification did not scrutinize the Capacity/Mode controls, so their wrapped/auto-height rendering passed unnoticed. I declared the feature ready while the defect was on screen.
4. **Scoped the earlier fix too narrowly.** After the user's first report, MRT020 fixed only the Exclusions group and added reuse/visual-verification learnings, but I did not audit the sibling segmented controls in the same filter bar. A reported UI bug should trigger an audit of every control of the same kind, not a one-instance patch.

## Timeline

- Task 3 (`3353ccc`): Project Track filter bar built; SegmentedControls reused but overridden by local CSS; no `eng-mode-control` class.
- User report #1 ("why did you invent [existing UI elements] from the ground up?"): I wrote MRT020 and fixed only the Exclusions group; segmented-control override left in place.
- Polish wave (`af0863d`) + analytics/docs: override still present; not caught.
- Final whole-branch review: I reported **READY TO MERGE**.
- User report #2 (screenshot): segmented controls wrapping / checkbox alignment still wrong.
- Fix (`c3fe99c`, by Codex): committed.

## Resolution

Fixed in commit `c3fe99c` ("fix(stats): restore Project Track control layout"), by Codex:

- Capacity side and Mode now reuse `SegmentedControl` **with the shared `eng-mode-control` class** (`dashboard.jsx`).
- Removed the Project-Track CSS override that made segmented controls wrap / auto-height (`.project-track-controls .segmented-control { flex-wrap: wrap; height: auto; … }` → a harmless `.eng-mode-control { margin-top: 0 }`); changed `.project-track-controls` `align-items: flex-start` → `flex-end`.
- Tightened the Exclusions checkbox rows (`inline-flex`, `gap: 0.35rem`, fixed 14×14 input, `line-height: 1.2`, `overflow-wrap: anywhere`, `max-width: 100%`) so checked/unchecked states stay compact and do not run into Mode.
- Added Playwright geometry assertions: the Capacity/Mode radiogroups carry `eng-mode-control` (and not `stats-view-toggle`), use `flex-wrap: nowrap`, keep a fixed height (≤ 42px), and render all buttons on a single row; plus the existing Exclusions-boundary checks.
- Rebuilt `frontend/dist`.

## Verification

Codex's new assertions in `tests/ui/codebase_structure_smoke.spec.js` fail if the segmented controls wrap, grow past the shared height, or lose the shared class — the coverage gap that let this ship is now closed. `frontend/dist` rebuilt to match source.

## Affected Components

- **`SegmentedControl`** (shared component) — the Capacity side and Mode instances: reused but overridden and missing the `eng-mode-control` class.
- **`frontend/src/styles/stats/project-track.css`** — the `.project-track-controls .segmented-control { flex-wrap: wrap; height: auto; min-height: … }` override (removed) and the Exclusions checkbox-row styling (tightened).
- **`frontend/src/dashboard.jsx`** — the two `<SegmentedControl>` usages that lacked `className="eng-mode-control"`.
- **Exclusions checkbox rows** (`.project-track-checkbox`) — alignment/compactness vs. the Mode control.
- **`tests/ui/codebase_structure_smoke.spec.js`** — missing single-row / fixed-height / shared-class assertions for the segmented controls (added).

## Lessons Learned

- **Reusing a shared component means NOT overriding its internal layout.** Giving it the canonical class (`eng-mode-control`) is reuse; adding local `flex-wrap`/`height` CSS is reinvention wearing the component's name. If local CSS has to fight the component, the integration is wrong.
- **A reported UI bug is a class, not an instance.** After user report #1 I patched only the Exclusions group; the sibling segmented controls in the same bar had the same disease and went untouched. Audit all controls of the same kind.
- **"READY TO MERGE" requires per-control scrutiny.** MRT020 already said "look at the screenshot, don't trust green" — I looked but did not examine the Capacity/Mode controls, and had no assertion covering them. A screenshot only helps if every control in it is actually checked; geometry assertions must cover each control, not just the one previously broken.
- **This is a recurrence.** MRT020's prevention was too narrow; the rule is tightened below so "reuse" explicitly forbids overriding a shared component's layout and requires auditing sibling controls.

## Action Items

- [x] Reuse `SegmentedControl` via `eng-mode-control`; remove the wrap/auto-height override; tighten Exclusions rows (`c3fe99c`).
- [x] Add Playwright single-row / fixed-height / shared-class assertions for the segmented controls (`c3fe99c`).
- [x] Rebuild `frontend/dist` (`c3fe99c`).
- [x] Tighten the root `AGENTS.md` §11 learning: reusing a shared component forbids overriding its layout, and a reported UI bug requires auditing every sibling control of the same kind.

## Prevention

- When a design-system component exists for a control, render it and style it only through its documented class hooks; never add local CSS that changes its `display`/`flex`/`height`. If you think you need to, you are reinventing it — stop.
- On any UI-bug report, enumerate every control of the same type on the surface and verify each, with an element-level assertion per control, before claiming the surface is fixed.

## Related Issues

- [MRT020](./MRT020-project-track-filter-bar-bespoke-controls.md) — the first instance (Exclusions group); this postmortem is the recurrence on the sibling segmented controls that MRT020 did not audit.
- [MRT009](./MRT009-sticky-layering-regressions.md) — layout regressions from not respecting the existing design system.

## References

- Introduced: commit `3353ccc` (Task 3). Fixed: commit `c3fe99c` (Codex).
- `frontend/src/styles/stats/project-track.css`, `frontend/src/dashboard.jsx` (Capacity side + Mode `SegmentedControl`), `frontend/src/ui/SegmentedControl.jsx` (`.eng-mode-control`), `tests/ui/codebase_structure_smoke.spec.js`.
- User screenshot (2026-07-02) showing wrapped controls / checkbox alignment.
