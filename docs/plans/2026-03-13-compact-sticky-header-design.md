# Compact Sticky Header Design

## Overview
Add a compact sticky header that replaces the main dashboard header controls once the main `<header>` scrolls offscreen.

Approved behavior:
- Main header keeps the mode switch.
- Compact sticky header contains only `Sprint`, `Groups`, `Teams` on the left and `Search` on the right.
- Compact sticky header stays on a single line.
- Compact sticky header gets a bottom border like the main header.
- Compact sticky header is used in Catch Up, Planning, and Scenario modes.

## Context
The previous sticky-search branch is not a safe implementation base:
- it is `103` commits behind `main`
- its only branch-only change is unrelated `TODO.md`
- its older sticky-search approach used a separate sticky shell and oversized `z-index` values

The relevant guardrail is [MRT009](../../postmortem/MRT009-sticky-layering-regressions.md):
- sticky layers must share one offset model
- ad hoc sticky search containers and independent `top` values caused overlap regressions
- any header compaction change must be validated in Catch Up, Planning, and Scenario modes

## Requirements
### Functional
- When the main `<header>` is visible, only the main header is shown.
- When the main `<header>` is offscreen, show the compact sticky header at the top of the viewport.
- Compact sticky header reuses the existing sprint/group/team/search state and handlers.
- Mode buttons remain only in the main header.

### Layout
- Compact sticky header is one lane:
  - left: sprint, groups, teams
  - right: search
- Compact sticky header must remain one line on narrow viewports.
- Compact sticky header needs a bottom border that visually matches the main header divider.

### Layering
- Compact sticky header must sit above all other sticky elements.
- Planning panel must sit directly below the compact sticky header when both are visible.
- Epic header must sit directly below the planning panel.
- Scenario axis must sit below the epic header.

## Recommended Approach
Implement a separate compact sticky header component inside the dashboard render tree and toggle it from the visibility of the main `<header>`.

Why this approach:
- It matches the requested “replacement header” behavior exactly.
- It keeps the existing main header layout intact.
- It avoids making the full header itself sticky or partially collapsible.
- It allows sticky offsets to remain explicit and shared.

## Rejected Alternatives
### Make the existing controls row sticky
Rejected because the mode switch is intentionally excluded from the compact header, and coupling the sticky behavior to the full header makes that split fragile.

### Reuse the old sticky-search shell from the stale branch
Rejected because it predates the current React structure and repeats the MRT009 failure mode: separate sticky shell, separate offsets, and conflicting `z-index` values.

## Implementation Shape
### Dashboard state and refs
- Add a ref for the main `<header>`.
- Add a boolean state that tracks whether the compact sticky header should be visible.
- Use an observer on the main header so visibility is driven by actual header presence, not hardcoded scroll thresholds.

### Markup
- Keep the existing main header structure for normal flow.
- Add a compact sticky header container near the top of the page structure.
- Render compact versions of the existing sprint/group/team/search controls inside that container.
- Reuse the same state, values, and event handlers so behavior stays consistent.

### Shared offset model
- Replace the current “planning-only” offset model with a stack model:
  - `compactHeaderOffset`
  - `planningOffset`
  - derived combined offsets for lower sticky elements
- Continue using measured heights instead of hardcoded pixel constants.
- Centralize sticky `top` usage through CSS custom properties.

### CSS
- Add compact sticky header styles in [frontend/dist/dashboard.css](/Users/juce/Documents/codex/jira-planning/frontend/dist/dashboard.css).
- Add shared sticky variables for stack order and offsets.
- Preserve the current planning/epic/scenario sticky ordering, but derive their `top` values from the new combined variables.
- Add the bottom border and background surface to the compact sticky header.
- Prevent wrapping by using a single-line layout with shrinking widths and overflow-safe flex settings.

## Verification
### Automated
- Extend [tests/test_dashboard_css_extraction.py](/Users/juce/Documents/codex/jira-planning/tests/test_dashboard_css_extraction.py) with checks that the served CSS includes the new compact sticky header class names and shared sticky variables.

### Manual
- Catch Up:
  - main header visible
  - compact sticky header visible after scroll
  - no overlap with epic headers
- Planning:
  - compact sticky header above sticky planning panel
  - epic headers remain directly below planning panel
- Scenario:
  - compact sticky header above planning panel and scenario axis
  - scenario axis stays below epic header
- Narrow viewport:
  - compact sticky header remains one line
  - controls stay usable
  - dropdowns anchor correctly

## Risks
- Duplicating the control markup can create styling drift between main and compact variants.
- Dropdown panels may clip or overlap if the compact header widths are reduced without checking panel anchoring.
- Any mismatch between measured sticky heights and CSS `top` values can recreate MRT009.

## Risk Mitigation
- Reuse current control handlers and value sources.
- Keep all sticky `top` values derived from shared CSS variables.
- Measure compact header and planning panel heights with observers.
- Validate the sticky stack manually in all three modes before claiming completion.
