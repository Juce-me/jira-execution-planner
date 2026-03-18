# Alerts

The dashboard uses alert panels to highlight work that needs attention in the currently selected sprint or planning view.

## General Behavior

- Alerts are scoped to the currently selected sprint and active team group.
- Each panel can be collapsed.
- Dismissed alert items stay hidden in the browser until the local alert state is reset.
- Postponed work is routed separately so it does not also appear in ordinary hygiene panels.

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

Shows epics that are still open even though all loaded child stories are terminal.

In practice, this means the epic looks administratively open but the work underneath it is already done, killed, or incomplete.

### Postponed Work

Shows work that belongs to a future sprint instead of the currently selected one.

This includes:
- stories already marked `Postponed`
- future-routed empty epics
- certain analysis epics in first-future-sprint planning mode

## Future-Planning Epic Alerts

When a future sprint is selected, the dashboard also uses epic-level planning alerts.

### Backlog

Shows epics whose epic-level sprint field is explicitly empty.

Important:
- this is based on the epic sprint assignment, not on a Jira label
- an epic with a concrete sprint value must not appear here, even if that sprint is not the selected future sprint
- backlog is reserved for true unsprinted epic backlog, not for “wrong sprint” or “needs story follow-up” cases

### Missing Team

Shows epics that still do not have usable team information.

If the team is missing, unknown, or cannot be matched, the epic stops here and does not continue into the label-based planning alerts.

### Missing Labels

Shows epics that are already in the selected future sprint but are still missing the configured team-specific epic label.

This also covers the case where the active group has no label mapping configured for that team yet.

### Create Stories

Shows epics that are in the selected future sprint, have the expected team-specific epic label, but still do not have usable child stories for planning that sprint.

Typical cases:
- no child stories yet
- only terminal child stories exist

### Waiting for Stories

Shows epics that are already configured for the selected future sprint but whose stories are not yet usable in that sprint.

Typical cases:
- child stories exist, but none are actionable in the selected future sprint
- stories need to be moved or completed before planning can continue
- team, label, and epic sprint are already set, so the epic has passed the earlier planning checks

## Alert Precedence

An epic is routed to the first matching planning alert:

1. Postponed Work
2. Backlog
3. Missing Team
4. Missing Labels
5. Create Stories
6. Waiting for Stories

This avoids the same epic showing up in multiple planning panels at once. In practice, an epic with a filled sprint should bypass Backlog and continue into the later planning checks.
