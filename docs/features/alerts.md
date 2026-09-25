# Alerts

The dashboard uses alert panels to highlight work that needs attention in the currently selected sprint or planning view.

## General Behavior

- Alerts are scoped to the currently selected sprint and active team group.
- Alert panels load only in Catch Up. Board, Planning, Statistics, and Scenario do not request or render the panels.
- Catch Up renders Product and Tech tasks first. After both visible task requests finish, alert enrichment, missing-info, ready-to-close, and future-backlog sources load progressively in the background without blocking the task list.
- Story readiness is a separate progressive read used by both Catch Up and Planning after Product and Tech Stories render. Planning does not start the unrelated Catch Up alert sources.
- Every Catch Up filter also filters every alert category. Story alerts use the exact visible Story set after Team, Status, Priority, Product/Tech, Project Track, search, and focused-stat filtering. Epic alerts, including Stories Required, apply the equivalent Epic fields and facet rules. Alert rows, category summary chips, and the total count all reflect the filtered result.
- Task refreshes and status or priority changes invalidate any pending alert cohort in every ENG mode; stale responses are ignored, and the alerts reload after returning to Catch Up.
- Each panel can be collapsed.
- Dismissed alert items stay hidden in the browser until the local alert state is reset.
- Postponed work is routed separately so it does not also appear in ordinary hygiene panels.

Analytics allowlist reason: no analytics event is added for automatic request scheduling or Epic classification guidance; neither is a new user action. Existing alert and filter events retain their current contract.
Search-driven alert filtering is covered by the existing privacy-bounded `app_search` event. Other filter changes retain the existing `filter_changed` contract. Alert filtering adds no event and never sends query or alert contents.

## Current Alert Panels

### Missing Story Points

Shows stories that still need estimation.

Typical cases:
- story points are missing
- story points are empty
- story points are `0`

Done, killed, and postponed stories are excluded.

### Blocked

Shows stories whose current status looks blocked.

This is based on the normalized status text, so it catches blocked-style statuses even if the Jira wording varies slightly.

### Missing Epic

Shows stories that do not have a parent epic linked.

This helps catch work that is hard to track in planning, alerts, and rollups because it is not attached to an epic.

### Empty Epic

Shows epics that effectively have no actionable child work for the selected sprint.

This is a hygiene alert, not a future-planning alert. In future-planning mode, other epic alerts take precedence instead.

### Epic Ready to Close

Shows epics that are still open even though all child work items are terminal.

In practice, this means the epic looks administratively open but the work underneath it is already done, killed, or incomplete. The check uses an authoritative, fully paginated count of every non-terminal child across all sprints, so an epic with any open work — including work planned for a future sprint or quarter — will not appear here.

### Postponed Work

Shows work that belongs to a future sprint instead of the currently selected one.

This includes:
- stories already marked `Postponed`
- future-routed empty epics
- certain analysis epics in first-future-sprint planning mode

## Future-Planning Epic Alerts

When a future sprint is selected, the dashboard also uses epic-level planning alerts.

Team grouping for these alerts is driven by configured team-label mappings, and each Team may have one to three configured label aliases. An epic carrying any one of a Team's aliases matches that Team; an epic carrying two aliases for the same Team still produces exactly one match for that Team (one alert group, one Story requirement), never a duplicate. If an epic's labels match more than one Team's alias sets, it can still appear under each matching Team. The raw Jira Team field is used only when no configured team label alias matches.

### Oversized Department notice

Alert Epic discovery (Missing Team, Missing Labels, and empty-Epic alerts) is bounded to 2,000 unique open Epics and 101 Jira search pages per request. Widening a Team's label aliases widens that discovery scope; a Department whose Product or Tech scope now exceeds the ceiling gets a status notice at the top of the Alerts panel instead of a silently empty or partial Epic-alert list: "This Department is too large for Epic alerts: more than 2,000 open Epics match its Teams and labels in Product or Tech. Epic alerts are hidden; Story alerts are still shown. Narrow the Department's Teams or labels." Story alerts (Stories Required, Missing Story Points, Blocked, Missing Epic, Epic Ready to Close) keep loading and rendering normally; only the categories built from the oversized alert-scope discovery are affected.

The notice is scoped to the current Department and sprint. It clears on a Department or sprint scope change, on an explicit **Refresh**, or on the next alert load that succeeds; it never leaks into a different scope, and a delayed response from a previous scope cannot show it in the new one. Saving new aliases by itself does not re-trigger the alert load.

Terminal Epics never count toward either 2,000-Epic ceiling: alert Epic discovery excludes Killed, Done, and Incomplete Epics of any age, and Story readiness discovery additionally excludes Postponed Epics, regardless of how long ago they closed.

Analytics allowlist reason: the oversized-Department notice is an automatic status derived from an existing request outcome, not a user action, so it adds no analytics event. See `docs/README_ANALYTICS.md`.

### Backlog

Shows epics whose epic-level sprint field is explicitly empty and that have neither the selected sprint-name label nor its `_candidate` form.

Important:
- either accepted selected-sprint label form is treated as future-planning scope, so labeled epics continue to Missing Labels or Stories Required
- an epic with a concrete sprint value must not appear here, even if that sprint is not the selected future sprint
- backlog is reserved for true unsprinted epic backlog, not for “wrong sprint” or “needs story follow-up” cases

### Missing Team

Shows epics that still do not have usable team information.

If the team is missing, unknown, or cannot be matched, the epic stops here and does not continue into the label-based planning alerts.

### Missing Labels

Shows epics that match the selected future sprint by Jira Sprint value or either accepted sprint label but are missing either the accepted sprint label forms or every one of the Team's configured label aliases. A Jira Sprint value alone does not satisfy the label requirement, and an epic carrying only one of a Team's several aliases still satisfies the Team-label half of the check (it does not land here on that basis alone).

This also covers the case where the active group has no label mapping configured for that team yet.

### Stories Required

Shows one requirement per expected Team on an in-scope Epic that does not have an actionable child Story in the selected active or future sprint. Expected Teams come only from an exact match against one of a Team's configured label aliases; an epic carrying two of the same Team's aliases still yields at most one requirement for that Team. A raw Jira Team value does not create a requirement.

The same complete Story-readiness snapshot drives the Catch Up alert and the synthetic `Story required` rows in the Catch Up and Planning hierarchies. `Blocked`, `Done`, `Killed`, and `Incomplete` Stories do not satisfy readiness. A failed, partial, or stale snapshot never produces a requirement.

The alert title is local navigation to the exact `(Department, sprint, Epic, Team)` requirement and reuses the established alert-row title style. Team groups display the configured Team-catalog name, never the internal Team id. Activation clears only target-hiding list state to a truly neutral reveal state, then scrolls, focuses, and highlights the exact ghost. The hierarchy ghost is the Jira-opening action. Dismissing the alert entry does not hide the hierarchy row. The panel's headline count remains a unique-Epic count even when one Epic has requirements for multiple Teams.

## Alert Precedence

An epic is routed to the first matching planning alert:

1. Postponed Work
2. Backlog
3. Missing Team
4. Missing Labels
5. Stories Required

This avoids the same epic showing up in multiple planning panels at once. In practice, an epic with a filled sprint or either accepted selected-sprint label should bypass Backlog and continue into the later planning checks.

For an active sprint, Story-readiness failures on Epics with either accepted sprint label route to Stories Required after Postponed work; unrelated analysis-waiting candidates remain Waiting, and only remaining empty candidates reach Empty Epic.
