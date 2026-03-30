# Planning Module Improvements Design

## Overview
Tighten the Planning panel so it preserves user selections per sprint and group, adds the missing bulk actions, fixes dropdown layering above sticky UI, and reduces the amount of screen space the sticky panel consumes.

Approved behavior:
- Planning selections persist in this browser only.
- Planning state is scoped by `sprint + group`.
- The stored planning state includes selected story keys and the selected planning team for that group in that sprint.
- A page refresh restores planning state for the same sprint and group, then reconciles it against freshly loaded Jira data.
- Stories that moved out of the sprint or no longer appear in the current sprint/group dataset disappear from the stored selection state.
- Stories that remain in scope stay selected even if their status, SP, summary, assignee, or other metadata changed.
- The planning action row adds `Include Postponed` and `Include Awaiting Validation`.
- Sprint and team dropdown panels must remain visible above sticky elements, including the planning panel.
- The sticky planning panel should be materially more compact.
- The planning bar footer should be removed.

## Context
The current planner already persists some state, but it does so inconsistently:
- selected stories are stored per group in a cookie
- selected teams are stored globally in UI preferences
- refresh reconciliation depends on whatever tasks happen to be in memory after reload

That split does not match the planning workflow. Users are making a plan for one sprint within one selected group, and they expect that plan to survive a refresh without leaking into other scopes.

The sticky layering guardrail is [MRT009](../../postmortem/MRT009-sticky-layering-regressions.md):
- sticky elements must share one offset model
- overlays must not sit underneath sticky panels
- any sticky change must be validated in Catch Up, Planning, and Scenario modes

The screenshots also show that the current planning panel is too tall for constrained viewports:
- the main bar area reserves too much vertical space
- the team cards are too large
- the footer rows below the bars consume space without adding enough value

## Requirements
### Functional
- Persist planning state in browser storage only.
- Scope planning state to `selectedSprint + activeGroupId`.
- Store these fields per scope:
  - selected story keys
  - selected planning team for the current group in that sprint
- Restore scoped planning state after refresh.
- Reconcile restored state against freshly loaded tasks:
  - keep selected keys that still exist in the current sprint/group dataset
  - remove selected keys that left the sprint, left the group-scoped dataset, or no longer exist
  - preserve valid selected keys even when other task fields changed
- If the stored planning team is no longer valid for the refreshed scope, fall back to `All Teams`.

### Planning actions
- Keep the current bulk toggle behavior:
  - if every matching visible task is already selected, clicking the button removes that batch
  - otherwise clicking adds that batch
- Support these bulk actions:
  - `Include Accepted`
  - `Include To Do`
  - `Include Postponed`
  - `Include Awaiting Validation`
  - `Uncheck Selected`
- Bulk actions always operate on the freshly loaded task list, never stale cached task objects.

### Layering
- Sprint, group, and team dropdown overlays must render above the sticky planning panel.
- The layering fix must work for both the main header controls and the compact sticky header controls.
- The fix must preserve the documented sticky order:
  - planning panel
  - epic header
  - scenario axis

### Layout
- Reduce the planning panel’s vertical footprint.
- Make the main capacity bars visually narrower and shorter.
- Tighten team microbar cards so more fit on limited-height screens.
- Remove `.capacity-bar-footer` from both the capacity bar and the project split bar.
- Preserve the existing content and interaction model as much as possible; this is a compaction pass, not a redesign.

## Recommended Approach
Create a dedicated planning-scope persistence layer and keep it separate from the global UI preferences object.

Why this approach:
- It matches the approved scope exactly: per sprint, per group, browser-only.
- It avoids further overloading the global UI prefs store with planner-specific state.
- It gives refresh reconciliation one stable place to live.
- It lets the dashboard keep its existing global team filter behavior outside of planning concerns.

For the sticky fix, use the existing shared sticky stack and add one explicit control-overlay layer above sticky panels rather than introducing an ad hoc sticky shell or a separate floating control system.

For the compaction work, shrink the existing planning panel primitives instead of replacing them:
- smaller action row spacing
- shorter bar tracks
- smaller team cards
- inline secondary labels/tooltips instead of footer rows

## Rejected Alternatives
### Keep selected teams global and only scope selected stories
Rejected because it still leaks planning context between sprints and groups. The selected planning team is part of the plan and needs the same scope as the story selection.

### Persist planning state by sprint only
Rejected because groups intentionally reshape the available team/task scope. Reusing a plan across groups would restore invalid intent and create noisy reconciliation.

### Store full task snapshots in browser storage
Rejected because refresh must trust live Jira-backed data. Persisting task snapshots would create stale totals, stale statuses, and stale inclusion logic.

### Solve dropdown overlap by giving panels ad hoc huge `z-index` values
Rejected because MRT009 already showed that local `z-index` escalation is fragile. The control overlays need one explicit layer that fits the existing sticky stack.

## Implementation Shape
### Planning scope persistence
- Add a dedicated planning storage key namespace, for example `jira_dashboard_planning_state_v1`.
- Use a derived scope key shaped like `planning::<sprintId>::<groupId>`.
- Persist only stable identifiers and compact state:
  - selected story keys
  - selected planning team id or `all`
- Do not persist task snapshots or derived totals.

### Refresh reconciliation
- Restore scoped planning state only after the new task set for the selected sprint and group is available.
- Build the valid task-key set from the refreshed planning dataset.
- Remove stored selections that are no longer valid.
- Keep still-valid keys selected without caring whether story metadata changed.
- Validate the stored planning team against the refreshed available teams before applying it.

### Dashboard state wiring
- Continue to compute selected story totals, team splits, and project splits from live task data.
- Update planning handlers so they read and write the scoped planning state instead of the current mixed cookie/global-preference model.
- Keep `Uncheck Selected` scoped to the current sprint and group only.

### Bulk actions
- Extend the planning action row with `Include Postponed` and `Include Awaiting Validation`.
- Continue to use normalized status matching.
- Treat `awaiting validation` as a direct normalized string match unless the data shows another alias later.

### Sticky overlay layer
- Add a shared overlay z-layer for sprint/group/team dropdown panels.
- Apply it to:
  - main header dropdown panels
  - compact sticky header dropdown panels
- Keep overlay positioning anchored to the existing controls; only the stacking changes.

### Compaction pass
- Reduce planning panel padding and internal gaps.
- Reduce bar heights and marker spacing.
- Reduce team-card padding and microbar heights.
- Remove `.capacity-bar-footer` markup and move remaining secondary text inline or into tooltips.
- Keep the current visual language; do not replace the panel structure wholesale.

## Verification
### Automated
- Add unit coverage for planning-scope keying and refresh reconciliation behavior.
- Add source or asset coverage for the new planning action buttons and compacted planning layout hooks where practical.

### Manual
- Planning refresh:
  - select stories
  - refresh page
  - confirm still-in-scope stories remain selected
  - confirm stories moved out of the sprint disappear from selection
- Planning scope:
  - change sprint
  - confirm a different scoped selection loads
  - return to the original sprint and group
  - confirm the original scoped selection restores
- Dropdown layering:
  - open sprint dropdown with planning panel sticky
  - open team dropdown with planning panel sticky
  - verify both stay above sticky elements
- Panel compaction:
  - verify the planning panel is materially shorter on a limited-height viewport
  - verify the missing footer rows do not remove required information
- Sticky stack:
  - validate Catch Up, Planning, and Scenario modes

## Risks
- Replacing the selected-story cookie flow may break restoration if scope hydration happens before task loading completes.
- Refresh reconciliation could over-prune valid selections if the valid-task set is built from the wrong filtered dataset.
- Dropdown overlay changes can regress compact-header behavior if the overlay layer is not shared consistently.
- Compaction can make labels unreadable if bar/text reductions are too aggressive.

## Risk Mitigation
- Rehydrate planning state only after sprint/group task data is available.
- Base reconciliation on stable task keys from the refreshed planning dataset.
- Use one shared overlay z-layer for all planner-related dropdown panels.
- Make one targeted compaction pass and keep remaining detail available via inline labels or tooltips.
