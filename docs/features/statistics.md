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

### Excluded Capacity

Shows story-point-based Excluded Capacity analytics for the selected ENG scope.

Main parts:
- **Effort Split**: selected sprint-range horizontal bars by team, split into Excluded Capacity, Tech, and Product story points
- Excluded Capacity trend: selected sprint-range line chart by team or group
- Excluded Epics filter: controls which configured excluded epics count as Excluded Capacity

The Effort Split chart and Excluded Capacity trend both use the Start Sprint and End Sprint controls inside the Statistics panel.

### Project Track

Shows story points by Project Track (the Jira `Project Track[Dropdown]` custom field, e.g. `Flexible`/`Committed`) for the selected sprint range. Stories with no track on their parent epic fall into a `No track` bucket.

Filter bar (drives every section, no separate fetch):
- **Start Sprint** / **End Sprint** — same sprint-range state as Excluded Capacity
- **Capacity side** — `Product` (default), `Tech`, or `Tech + Product`
- **Exclude Ad Hoc** / **Exclude Excluded Capacity** — checkboxes, both off (included) by default
- **Mode** — `Epic` (default) or `Team`

A mode title (`EPIC MODE` / `TEAM MODE`) renders under the filter bar. Mode switches both the aggregation unit and the breakdown dimension:
- **Epic mode**: SP aggregated per epic (each epic's full SP lands in its dominant sprint — the in-range sprint holding the largest share of that epic's points); breakdown is **by assignee**.
- **Team mode**: SP aggregated per story (each story counts in its own sprint); breakdown is **by team**.

Main parts:
- **Totals bar**: one horizontal stacked bar of SP by track, aggregated over the whole selected sprint range, with a value label on each segment.
- **Per-sprint chart**: one vertical stacked bar per sprint in range, split by track (hidden when the range is a single sprint).
- **By assignee / By team breakdown**: one horizontal stacked bar per assignee (Epic mode) or team (Team mode), split by track, each segment value-labelled.
- **Time in Project Track phase** (Epic mode only): for each in-scope epic, days spent in each track state (`No track` → `Flexible` → `Committed`, derived from Jira changelog), each phase segment value-labelled in days, plus an aggregate summary (avg days to first track, avg days to Committed). Epic names link to Jira. If the epic set is capped server-side, a truncation notice is shown instead of silently dropping epics.

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
- Excluded Capacity uses cached progressive stats-source requests for the Start Sprint / End Sprint range
- Project Track reuses that same cached stats-source data and sprint range (no second fetch); only its time-in-phase section makes a separate, bounded, client-cached changelog request per distinct in-scope epic set
- changing UI-only controls such as row selection or view grouping does not refetch the lead-time dataset
