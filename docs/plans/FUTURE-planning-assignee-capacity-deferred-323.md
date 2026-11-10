# Planning Assignee Capacity: Deferred Scope (#323)

> **Status:** Deferred follow-up. Spun out of `DONE-planning-assignee-capacity-table-323.md`. Do not execute without renaming to `EXEC-*` after review. Shrunk on 2026-11-10 to what stays deferred: the "Team capacity for every selected Team" scope, the one-click push and the verification-gate items were promoted on 2026-11-06 to [EXEC-planning-team-capacity-every-team-323.md](EXEC-planning-team-capacity-every-team-323.md), which records their design, decisions and execution evidence. The original design text is in this file's git history.

## Delivered by the every-Team plan

- Every displayed Team's card edits its own stored "Team capacity (not in Jira)" for the selected Sprint, read through the batch route `POST /api/eng/sprints/<sprint_id>/assignee-capacity/planned/read` and saved by one owner per Sprint and Team.
- The card's → writes the stored number to the Team's own matched ticket in one click (`capacityReconcilePush`, analytics `capacity_reconcile_push`).
- The verification-gate items (EPM automatic refresh, toggle-to-paint p50/p95, the App render measurement, Cmd/Ctrl+Z after Enter, Undo semantics) are closed in its Task 8. The headed Firefox and WebKit glyph and hover check runs with its full gates.

The current behaviour is described in [docs/features/planning-sprint-review.md](../features/planning-sprint-review.md).

## Still deferred

- **Two Jira capacity reads on load for an unpointed Team.** With All Teams, a Team whose Sprint Stories are all unpointed joins the card set only once the Sprint's work is known (`buildPlanningCardTeamIds`), so `GET /api/capacity` and its Team-info search run twice: first for the pointed Teams, then for every card Team. Measured on the real server (`tests/ui/planning_capacity_real_server.spec.js`, "late readiness"); with every Team pointed it runs once, also with a late readiness answer. A fix would hold the read until the card set settles, or read the configured Teams from the start; either changes the DoD 13 request ledger and needs its own review.
- **Containment against an unconfigured ticket.** The no-borrowing guard compares against configured Team names, so a ticket for a Team that is not configured ("Platform Core Squad") can still match a configured "Core" by containment (Task 4 kept the brief literally).
- **Installations beyond the G1 count.** At 12 Teams the batch read is one chunk and the Jira capacity read one search; at 500 Teams the browser GET is about 9 KB and costs 25 Jira searches (Task 0, G3, informational).
- The keyboard and refresh items found during execution are tracked in [docs/TODO.md](../TODO.md) Deferred.
