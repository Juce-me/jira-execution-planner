# Stats Controls Unification — Design

| Field | Value |
| --- | --- |
| Status | Validated against current source and postmortems; feeds `EXEC-stats-controls-unification.md` |
| Branch | `improvement/stats-controls-unification` (off `bugfix/statistics-colors-capacity-lead-time`) |
| Type | UI consistency improvement (Statistics views), no backend change |

## Goal

Make the Statistics start/end range selectors consistent and well-behaved, and fix the Lead Times
capacity filter. Three user-reported problems:

1. Lead Times **Capacity** dropdown offers only `All Capacity` / `Ad Hoc`, where "Ad Hoc" *narrows to
   only ad-hoc epics* — useless. It should express **exclusion** instead.
2. Lead Times **Group By** (Quarter/Month) is a plain dropdown; it should be a segmented radio group
   like the toggles the Excluded Capacity view already uses.
3. The **Start/End** range selectors are native `<select>`s that are too wide and whose option list
   **opens upward** near the viewport bottom (native browser behavior, not fixable with CSS).

## Current State (verified)

- **Three views share one sprint-range state:** Excluded Capacity (`dashboard.jsx:13572-13595`),
  Mono vs Cross (`13727-13749`), and Project Track (`13843-13865`) all render `<label>Start Sprint</label>`
  / `<label>End Sprint</label>` bound to the SAME `excludedCapacityStartSprintId` /
  `excludedCapacityEndSprintId` state over `excludedCapacitySprintOptions`. Changing the range in one
  changes it in all three (existing behavior).
- **Lead Times has its own quarter range:** `cohortStartQuarter` / `cohortEndQuarter` over
  `cohortQuarterOptions` (`14019/14036`), with last-control-wins reconciliation + a debounced refetch.
- All 8 render sites use native `<select className="scenario-input">`.
- Lead Times **Capacity**: `cohortCapacityFilter` ('all' | 'ad_hoc'), clamped by
  `resolveCohortCapacityFilter`; the inclusive filter lives in `cohortUtils.filterCohortIssues`
  (`capacityType` match). A SEPARATE "Excluded Capacity" toggle button (`cohortExcludeCapacity`,
  default **true**) already excludes excluded-capacity epics via `excludeEpicKeys`.
- Lead Times **Group By** is a native select; grouping is client-side regrouping only (must not refetch).
- Existing reusable pieces to lean on: `SegmentedControl` (`frontend/src/ui/SegmentedControl.jsx`,
  `options/value/onChange/className/ariaLabel`), the inline `sprint-dropdown` pattern
  (`dashboard.jsx:12380` — toggle button + downward `-panel` + search + outside-click), and the
  `project-track-checkbox` exclude-checkbox styling (`13895/13911`).

## Design

### A. Extract the existing dropdown pattern; do not create a new visual design

Everything needed already exists. We assemble, not invent:
- `ControlField` (`frontend/src/ui/ControlField.jsx`) already renders the in-border `control-label`.
- The `.sprint-dropdown` markup + `.sprint-dropdown-*` rules in `styles/shared/controls.css` already are
  a content-width dropdown whose panel opens downward (`top: calc(100% + .35rem)`).
- `SegmentedControl` already backs `CAPACITY SIDE` and `MODE` in Project Track.
- Project Track's `Exclude Ad Hoc` / `Exclude Excluded Capacity` `project-track-checkbox`es already exist.

Implementation: create one stats-owned `frontend/src/stats/StatsRangeControl.jsx` used by all four
Statistics views. It composes `ControlField`, `.stats-control-group`, `.controls-label`,
`.view-filters`, and the SAME `.sprint-dropdown*` classes, while `dashboard.jsx` keeps values,
ordering, persistence, analytics, and request behavior. This is a component-boundary extraction of
repeated markup, not a new control style.
The global Sprint control stays isolated because its main/compact sticky behavior is load-bearing.

The extracted control closes on outside pointer/focus, Escape, or Statistics view switch; exposes a
button + listbox/option accessibility contract; supports arrow/Home/End navigation; and lets the
existing `.view-filters` wrap Start/End on narrow screens. The only CSS change is a positioned
open-panel z-index lift on `.stats-controls:has(.sprint-dropdown-panel)`.

### B. Apply the shared dropdown to all 8 stats range selectors; relabel

- Excluded Capacity, Mono vs Cross, Project Track: replace both native sprint selects with
  `StatsRangeControl` bound to the existing `excludedCapacityStartSprintId/EndSprintId` +
  `excludedCapacitySprintOptions` (mapped to `{value:String(id), label:name||id}`).
- Lead Times: replace both native quarter selects with `StatsRangeControl` bound to
  `cohortStartQuarter/EndQuarter` + `cohortQuarterOptions`. **The last-control-wins reconciliation and
  the debounced refetch stay in the parent onChange** — the widget only reports the chosen value.
- The existing `ControlField` `control-label` span remains **`Start`** / **`End`**. The range kind uses
  existing `.controls-label` (`Sprint` or `Quarter`) inside a `role="group"` with an accessible range
  name; do not add an unassociated bare `<label>`. Each trigger has the complete accessible name
  `Start sprint`, `End sprint`, `Start quarter`, or `End quarter`.

### C. Lead Times Capacity → two exclude checkboxes

Replace the `All/Ad Hoc` dropdown with two `project-track-checkbox`-styled checkboxes:
`☐ Exclude Ad Hoc` (default off) and `☑ Exclude Excluded Capacity` (default on). Remove the standalone
"Excluded Capacity" status-row toggle (no duplicate). `cohortUtils.filterCohortIssues`: drop the
inclusive `capacityType` filter; add `excludeAdHoc` (drops `capacityType==='ad_hoc'`); keep
`excludeEpicKeys`. State: remove `cohortCapacityFilter`/`resolveCohortCapacityFilter`; add
`cohortExcludeAdHoc` (default false); keep `cohortExcludeCapacity` (key unchanged — saved prefs survive).
Both persist across the four cohort state sites (snapshot + deps, applyGroupState, saveUiPrefs + deps).

### D. Lead Times Group By → `SegmentedControl`

Two options (Quarter/Month), reusing `SegmentedControl` with the same class the sibling stats
segmented controls use. Remains client-side regrouping — **no refetch**.

## Preserved Semantics (must not change)

- Each view's range still drives its own data/refetch/regroup exactly as today; the three sprint views
  keep sharing one sprint-range state; Lead Times keeps quarter reconciliation + debounced refetch.
- Group By and the capacity checkboxes stay client-side (no cohort refetch).
- No backend change: cohort epics already carry `capacityType`; sprint options unchanged.

## Scope Boundaries

- **Global top SPRINT control stays as-is** (it is sticky/compact-header, load-bearing — MRT009).
  We reuse its CSS/pattern for the shared component but do NOT refactor the global control in this work.
  (Confirm at review; unifying it too can be a follow-up.)
- **Project and Assignee selects stay native** (not requested).
- No analytics event added — update the existing `Lead Times capacity cohort filter` no-event row to
  describe the two local-only exclusion checkboxes; do not add a duplicate allowlist entry.

## Risks & Mitigations

- **Dropdown panel layering/clipping** (MRT — panels rendering under sibling content or clipped by an
  ancestor `overflow`/transform). The panel now lives in four stats containers; each needs the
  z-index/overflow handling, verified by a **real (non-forced) click** on an option, not just a
  screenshot.
- **Lead Times behavior regressions**: preserve existing reconciliation/refetch assertions and add
  coverage for checkbox semantics, legacy preference migration, reload, and no-refetch-on-Group-By.
- **Shared-state surprise**: because 3 views share the sprint range, per-view tests must not assume
  independent ranges.

## Verification Strategy

- Unit/source: `cohortUtils` test for `excludeAdHoc`; source guards for one `StatsRangeControl`, four
  call sites, existing-class reuse, global Sprint isolation, and all persistence sites.
- Playwright (per view): shared dropdown opens downward + option clickable with a normal click +
  top-layer hit testing; pointer, keyboard, outside-focus, Escape, and view-switch close behavior;
  375 px reflow with no page overflow; Lead Times capacity checkboxes filter correctly and survive
  reload; Group By toggles without a cohort refetch; Lead Times reconciliation still one debounced request.
- Source guards for `cohortExcludeAdHoc` persistence sites.
- `npm run build`; full unit + Playwright suites; rebuild dist drift-free.

## Labeling Contract

Per-view layout: ONE existing `.controls-label` group heading (`Sprint` for the 3 sprint views,
`Quarter` for Lead Times) over the pair; each dropdown is wrapped in `ControlField` whose
`control-label` reads `Start` / `End`. The group exposes `aria-label="Sprint range"` or
`aria-label="Quarter range"`; the triggers expose the full position + kind accessible name.

## Resolved Boundary

- **Global top SPRINT control stays unchanged.** It shares the visual class contract but has distinct
  main/compact sticky-surface behavior. Migrating it would broaden this Statistics-only change and
  re-open MRT009 risk without improving the requested flow.

## Approved Follow-up: Lead Times Control-row Compaction

The initial implementation is functionally correct, but its auto-fit grid gives the quarter range two
columns and pushes Capacity onto a second row. The grid also bottom-aligns groups with different internal
heights, so the visible headings do not share a baseline. The approved refinement is limited to the Lead
Times control row:

- Use a content-aware desktop row for Quarter, Group By, Project, Assignee, and the capacity exclusions.
  Keep the existing responsive wrap below the available width; do not introduce horizontal scrolling.
- Reuse the existing `.controls-label` typography for every top-level heading so Quarter, Group By,
  Project, Assignee, and Exclude share the same size, casing, spacing, and horizontal level.
- Keep `StatsRangeControl`, `SegmentedControl`, and the native Project/Assignee selects. This is layout and
  labeling only; no filter state, request key, persistence, or regrouping behavior changes.
- Rename the Capacity heading to **Exclude** and shorten the checkbox labels to **Ad Hoc** and
  **Excluded Capacity**. Keep their accessible names explicit as **Exclude Ad Hoc** and
  **Exclude Excluded Capacity** so screen-reader meaning and existing behavioral locators remain clear.
- Place both exclusion checkboxes inline at desktop widths. They may wrap together with their group on
  narrow screens, but must not split into a detached second control row at the reference desktop width.
- Keep the existing no-event analytics decision. Update the Lead Times capacity-filter allowlist wording
  and its source guard because the visible labels change, but do not add an analytics event.

Verification adds rendered geometry assertions at the reference desktop viewport: all five top-level
headings have the same top coordinate, all five groups occupy one row, and both checkbox controls share
one vertical level. Existing 375 px no-overflow coverage remains required, along with accessible-name and
no-refetch assertions for Group By and both exclusions. A settled screenshot is required for final visual
review.
