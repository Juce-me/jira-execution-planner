# Statistics

The Statistics panel summarizes sprint execution and epic flow for the currently selected scope.

It is available for active and completed sprints. Future sprints do not use the Statistics panel.

## Views

### Teams

Shows delivery split by team, including product vs tech work.

Use it when you want to see how much work each team delivered and how that delivery is distributed.

### Priority

Shows done vs incomplete work grouped by priority instead of by team.

Use it when you want to understand delivery mix and whether high-priority work is closing as expected.

### Burnout

Shows the remaining open work across the sprint as a team-stacked area chart.

Behavior:
- opening Burnout triggers an on-demand changelog fetch
- start = stories already present on sprint start day
- added = stories created after sprint start
- closed = stories that reach `Done`, `Killed`, or `Incomplete`
- remaining = open stories still left on each day

It also supports:
- assignee filtering
- weekly split lines
- a today marker
- a shaded future region after today

### Lead Times

Shows epic cohorts and open-epic aging from a selected start quarter.

Main parts:
- cohort heatmap by created period and elapsed period
- longest-open epics view
- filters for project, assignee, grouping mode, and status

`Postponed` is treated as terminal rather than open in this view.

## Lead Time Definition

Each epic gets a `leadTimeDays` value.

- terminal epic: `terminal date - created date`
- open epic: `today - created date`

Terminal date source:
- first choice: Jira `resolutiondate`
- fallback: first terminal transition found in changelog history when the epic is already terminal but `resolutiondate` is missing

The dashboard shows:
- **Avg Lead Time**: arithmetic mean of terminal epics with numeric lead time
- **Median Lead Time**: middle terminal lead time after sorting, or the average of the two middle values when there is an even count

Open epics are useful for cohort/open-epic displays, but they are excluded from the Avg and Median Lead Time summary cards.

## Scope and Filtering

Statistics use the currently selected sprint and active team scope.

Important behavior:
- Teams and Priority derive from the already loaded sprint task data
- Burnout uses a separate on-demand API call
- Lead Times uses a separate on-demand cohort API call
- changing UI-only controls such as row selection or view grouping does not refetch the lead-time dataset
