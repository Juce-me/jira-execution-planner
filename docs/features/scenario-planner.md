# Scenario Planner

The Scenario Planner builds a quarter timeline from Jira data so users can inspect sequencing, capacity pressure, and dependency risk before changing plans.

## What It Uses

- sprint-scoped Jira work
- team capacity data
- dependency links
- story points
- optional saved overrides

## What It Shows

- per-issue start and end dates
- critical path
- slack
- bottleneck lanes
- late items
- unschedulable work

The planner can render lanes by:
- team
- epic
- assignee

## Scheduling Model

The planner schedules work by:
- respecting dependency order first
- then prioritizing higher-priority work
- then preferring larger story-point items when multiple items are ready

Blocked relationships are treated as prerequisites, so blocked work does not run in parallel with its blockers.

Assignee lanes are single-threaded, which means one assignee can only execute one item at a time in that view.

Planner assumption:
- `1 SP = 2 working weeks`

## Editing

Edit mode is for interactive rescheduling.

Users can:
- drag bars to new date ranges
- undo and redo changes
- save and reload drafts
- discard overrides and return to computed dates

Behavior details:
- dragging snaps to day boundaries
- date-source badges show whether a bar comes from Jira data or a manual override
- dependency violations are highlighted in red
- assignee overlap conflicts update as bars move
- edit mode forces Assignee lane view

## Missing or Partial Data

The planner surfaces incomplete scheduling inputs instead of hiding them.

Examples:
- missing story points
- missing dependencies
- issues that cannot be scheduled safely

Dependency neighbors are also included as context items so cross-epic relationships stay visible even when the main focus is narrower.

## Overrides

Scenario drafts are persisted in `scenario-overrides.json`.

API behavior:
- `GET /api/scenario/overrides?scope_key=<sprint_id>:<group_id>` returns saved overrides for the scope
- `POST /api/scenario/overrides` saves overrides for that scope

This allows users to preserve manual planning experiments without changing Jira itself.
