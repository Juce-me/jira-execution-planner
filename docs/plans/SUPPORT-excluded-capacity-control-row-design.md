# Excluded Capacity Control Row Design

**Status:** Approved on 2026-07-16.

## Goal

Compact the Excluded Capacity controls into one desktop row with the sprint range first, the Excluded Epics filter using the remaining space, and both segmented controls aligned together on the right.

## Layout

Desktop order:

`Sprint (Start, End) | Excluded Epics | Teams, Group | Percentage, Story Points`

- Reorder the JSX so visual, DOM, keyboard, and screen-reader order match.
- Keep the shared `StatsRangeControl`, Excluded Epics dropdown, and both existing `SegmentedControl` instances unchanged internally.
- Make the sprint range content-sized, let Excluded Epics flex into the remaining width with a smaller minimum, and keep the segmented controls content-sized on the right.
- At narrow widths, allow the row to wrap while preserving the same control order. The mobile breakpoint may stack controls when one row is no longer readable.

## Preserved Behavior

- Do not change sprint state, excluded-epic selection, chart mode, display metric, analytics, requests, dropdown behavior, or chart calculations.
- Reuse existing control classes and components; do not add a bespoke control style.
- Rebuild `frontend/dist/` from `frontend/src/`.

## Verification

- Update the focused source guard to fail unless Sprint precedes Excluded Epics and the desktop grid assigns the two segmented controls to the right side of the same row.
- Run the focused Node source-guard test and `npm run build`.
- Run the Statistics Playwright smoke coverage and inspect a settled desktop screenshot confirming one-row alignment and no clipped or overlapping labels.

## Analytics Impact

No new event is needed. This is a presentation-only reordering of existing controls; existing interactions and analytics handlers remain unchanged.
