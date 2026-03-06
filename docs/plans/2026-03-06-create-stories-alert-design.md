# Create Stories Alert Design

**Date:** 2026-03-06

## Goal

Add future-planning epic alerts for `Backlog`, `Missing Team`, `Missing Labels`, and `Create Stories` without duplicating epics across the existing alert stack.

## Approved Scope

- The feature is for future sprint planning.
- The selected sprint name is the required planning label. No separate quarter-label config is stored.
- Each saved team group needs per-team Jira label mappings.
- `Empty Epic` stays out of future-planning mode.

## Configuration Model

Store label mappings on each group:

```json
{
  "id": "default",
  "name": "Bidswitch",
  "teamIds": ["team-a", "team-b"],
  "teamLabels": {
    "team-a": "rnd_bsw_bswui",
    "team-b": "rnd_bsw_perimeter"
  }
}
```

Rules:

- `teamLabels` is keyed by Jira team id.
- Only one configured Jira label is stored per selected team.
- The selected sprint name is checked against `epic.labels` at runtime.

## Settings UI

Keep the existing group management modal and add a `Labels` tab.

- The tab is unlocked once at least one team group has been saved.
- Left panel shows available saved groups.
- Right panel shows one row per selected team in the active group.
- Each row shows the team name and a Jira label selector using the existing chip/search pattern.
- Teams with no configured label remain visibly incomplete.

## Backend Data

The backend must provide only the metadata the selectors need:

- `epicsInScope` includes epic `labels`
- dedicated backlog-epics payload includes:
  - epic `components`
  - epic `assignee`
  - epic `team`, `teamId`, `teamName`
  - epic sprint presence
  - `cleanupStoryCount`
- `/api/jira/labels` returns labels for autocomplete in the settings modal

The backlog dataset must stay separate from `/api/missing-info`.

## Alert Routing

### Future-planning order

1. `Postponed Work`
2. `Backlog`
3. `Missing Team`
4. `Missing Labels`
5. `Create Stories`
6. `Waiting for Stories`
7. `Epic Ready to Close`

### Non-future order

Keep the current stack and keep `Empty Epic` available outside future-planning mode.

## Matching Rules

### `Backlog`

Future-sprint only. Match when the epic itself is open, has team, assignee, and component, but has no sprint set. Child stories are used only to compute `cleanupStoryCount`.

### `Missing Team`

Match open epics whose Jira team is missing or resolves to `Unknown Team`.

### `Missing Labels`

Match open epics with a valid Jira team when either required label is missing from `epic.labels`:

- the selected sprint name
- the configured team label for that epic's team in the active group

If the active group does not have a configured team label for that team, the epic stays in `Missing Labels`.

### `Create Stories`

Future-sprint only. Match open epics that have:

- a valid Jira team
- a configured team label for that team
- the selected sprint label on the epic
- the configured team label on the epic
- no usable child stories for the selected future sprint because:
  - the epic has no child stories, or
  - all child stories are `Done`, `Killed`, or `Incomplete`

### `Waiting for Stories`

Future-sprint review state. Match open epics that already have child stories, but none are actionable in the selected future sprint.

This covers epics where stories exist but remain in other sprints or otherwise are not yet ready for the selected future sprint. If at least one actionable child story is already in the selected future sprint, no `Create Stories` or `Waiting for Stories` alert is shown.

### `Empty Epic`

Do not render this alert in future-planning mode. Outside future-planning mode, keep the current behavior.

## Error Handling

- Label autocomplete failure must not block manual editing.
- Missing team-label mappings should degrade into `Missing Labels`, not `Create Stories`.
- Backlog fetch failure should leave the rest of the alert stack intact.

## Testing

- Backend tests for config normalization, epic labels, backlog payload, and cleanup story counts
- Frontend tests or focused helper coverage for alert classification precedence
- Manual validation for:
  - future sprint mode
  - non-future mode
  - group modal `Labels` tab unlock behavior
  - bundle rebuild and server-served dashboard load
