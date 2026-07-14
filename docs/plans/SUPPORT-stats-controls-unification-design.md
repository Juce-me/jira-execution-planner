# Stats Controls Unification — Design

| Field | Value |
| --- | --- |
| Status | Design (pending user review) → feeds `EXEC-stats-controls-unification.md` |
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

### A. Shared range dropdown (`frontend/src/ui/RangeSelectDropdown.jsx`, reusing `sprint-dropdown` CSS)

A small single-select component extracted from the `sprint-dropdown` pattern so it is not hand-rolled:
button + positioned panel that **opens downward**, sized to content (narrower), with outside-click
close and optional type-ahead search (useful for long sprint lists). Props: `label`, `options:
[{value,label}]`, `value`, `onChange(value)`, plus an id/aria hook. It reuses the existing
`sprint-dropdown-*` class family (per repo rule: reuse dropdown classes, no bespoke hover/caret/radius).

### B. Apply the shared dropdown to all 8 stats range selectors; relabel

- Excluded Capacity, Mono vs Cross, Project Track: replace both native sprint selects with
  `RangeSelectDropdown` bound to the existing `excludedCapacityStartSprintId/EndSprintId` +
  `excludedCapacitySprintOptions` (mapped to `{value:String(id), label:name||id}`).
- Lead Times: replace both native quarter selects with `RangeSelectDropdown` bound to
  `cohortStartQuarter/EndQuarter` + `cohortQuarterOptions`. **The last-control-wins reconciliation and
  the debounced refetch stay in the parent onChange** — the widget only reports the chosen value.
- **Two label elements per control** (per the inspected DOM): the `ControlField` `control-label`
  span = **`Start`** / **`End`** (position); the bare `<label>` element = the **kind**, **`Sprint`**
  for the three sprint views and **`Quarter`** for Lead Times. Today's single `<label>Start Sprint</label>`
  splits into `control-label "Start"` + `<label>Sprint</label>`. The dropdown toggle shows the selected
  sprint/quarter value.

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
- No analytics event added — matches the existing uninstrumented cohort filters; record a no-event
  allowlist line if the repo requires one.

## Risks & Mitigations

- **Dropdown panel layering/clipping** (MRT — panels rendering under sibling content or clipped by an
  ancestor `overflow`/transform). The panel now lives in four stats containers; each needs the
  z-index/overflow handling, verified by a **real (non-forced) click** on an option, not just a
  screenshot.
- **Lead Times behavior regressions**: reconciliation, debounced single-request, and no-refetch-on-
  Group-By are all covered by existing Playwright assertions that must keep passing.
- **Shared-state surprise**: because 3 views share the sprint range, per-view tests must not assume
  independent ranges.

## Verification Strategy

- Unit: `cohortUtils` test for `excludeAdHoc`; component test for `RangeSelectDropdown`
  (opens down, selects, closes on outside click).
- Playwright (per view): shared dropdown opens downward + option clickable with a normal click +
  content width; Start/End labels; Lead Times capacity checkboxes filter correctly; Group By segmented
  toggles without a cohort refetch; Lead Times reconciliation still one debounced request.
- Source guards for `cohortExcludeAdHoc` persistence sites.
- `npm run build`; full unit + Playwright suites; rebuild dist drift-free.

## Labeling (resolved)

Each range control renders both label elements: `control-label` span = `Start` / `End`; bare `<label>`
= `Sprint` (sprint views) / `Quarter` (Lead Times). Exact visual arrangement (order/size) will be shown
in a screenshot during implementation and matched to the existing control styling.

## Open Question For Reviewer

- **Global top SPRINT control** left unchanged in this work (risk reduction) — agree, or unify it too?
