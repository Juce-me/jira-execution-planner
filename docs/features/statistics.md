# Statistics

The Statistics panel summarizes sprint execution and epic flow for the currently selected scope.

It is available for active and completed sprints. Future sprints do not use the Statistics panel.

Use the current UI names when translating older meeting language: **Burndown** is the remaining-work chart; **Lead Times** contains the cohort heatmap and open/completed Epic views; **Excluded Capacity** reports configured excluded work; **Mono vs Cross** reports whether Epic work spans teams; and **Project Track** contains the Epic-mode assignee view and Team-mode team view.

## Views

### Teams

Shows delivery split by team, including product vs tech work.

Use it when you want to see how much work each team delivered and how that delivery is distributed.

### Priority

Shows done vs incomplete work grouped by priority instead of by team.

Use it when you want to understand delivery mix and whether high-priority work is closing as expected.

### Burndown

Shows the remaining open work across the sprint as a team-stacked area chart.

Behavior:
- opening Burndown triggers an on-demand changelog fetch
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
- cohort heatmap by created period and elapsed period; its hover detail renders above the graph panel
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

### Mono vs Cross

Shows how much scoped Epic work stays within one Team versus spanning multiple Teams over the selected sprint range. An Epic/sprint bucket is **Cross** when that Epic has Stories from more than one Team in the same sprint; otherwise it is mono-team.

Summary cards:
- **Cross Epic SP**: Story points in multi-Team Epic/sprint buckets
- **Total SP**: all scoped Story points attached to Epic/sprint buckets
- **Cross Share**: Cross Epic SP divided by Total SP

Main parts:
- **Cross-Team Epic Footprint** shows the overall and per-sprint Cross SP, Total SP, and percentage.
- **Team Cross Share** is a per-sprint, per-Team line graph. Its percentage is team cross SP / total team story points in that sprint.

This view uses the same Start Sprint and End Sprint range as Excluded Capacity and Project Track. It describes aggregate Epic/Team allocation; it does not claim per-task hover details.

### Project Track

Shows story points by Project Track (the Jira `Project Track[Dropdown]` custom field, e.g. `Flexible`/`Committed`) for the selected sprint range. Stories with no track on their parent epic fall into a `No track` bucket. In Epic mode, Epics in `Done`, `Killed`, or `Incomplete` are excluded from every section. In Team mode, every Epic in the range counts whatever its status, so totals do not shrink as Epics close; only Killed work is excluded (stories whose own status is `Killed` and stories under a `Killed` Epic).

Filter bar (drives every section, no separate fetch):
- **Start Sprint** / **End Sprint** — same sprint-range state as Excluded Capacity
- **Capacity side** — `Product` (default), `Tech`, or `Tech + Product`
- **Exclude Ad Hoc** / **Exclude Excluded Capacity** — checkboxes, both off (included) by default
- **Mode** — `Epic` (default) or `Team`

A mode title (`EPIC MODE` / `TEAM MODE`) renders under the filter bar. Mode switches both the aggregation unit and the breakdown dimension:
- **Epic mode**: SP aggregated per epic (each epic's full SP lands in its dominant sprint — the in-range sprint holding the largest share of that epic's points); breakdown is **by assignee**.
- **Team mode**: SP aggregated per story (each story counts in its own sprint); breakdown is **by team**. The totals bar, per-sprint chart, and By team rows share the Team-mode scope above.

Main parts:
- **Totals bar**: one horizontal stacked bar of SP by track, aggregated over the whole selected sprint range, with a value label on each segment. The bars carry the track names, so there is no separate track legend.
- **Per-sprint chart**: one vertical stacked bar per sprint in range, split by track (hidden when the range is a single sprint).
- **By assignee / By team breakdown**: one horizontal stacked bar per assignee (Epic mode) or team (Team mode), split by track, each segment value-labelled. In Epic mode, selecting an assignee's `No track` segment opens those epics in Jira.
- **Board-column strips** (Team mode only, #173): a thin 7px strip under every track segment of the totals bar and each By team row, aligned to that segment. It splits the track's SP by the parent Epic's current column on the Department's ENG Board, in Board column order and colours, using the Board's own rule (exact Epic status match; the first column wins a status listed twice; an unlisted status lands in the first column). A Department without a configured Board uses the Board composer's default To Do / In Progress / Done columns built from the observed Epic statuses. Stories without a parent Epic form a neutral `No Epic` part. Strips have no labels and no click action: hovering or focusing one shows the team, the track total, and every Board column's SP (including `0 SP` columns).
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
- Burndown uses a separate on-demand API call
- Lead Times uses a separate on-demand cohort API call
- Excluded Capacity uses cached progressive stats-source requests for the Start Sprint / End Sprint range
- Mono vs Cross reuses the cached progressive stats-source data and the same sprint range
- Project Track reuses that same cached stats-source data and sprint range (no second fetch); only its time-in-phase section makes a separate, bounded, client-cached changelog request per distinct in-scope epic set
- changing UI-only controls such as row selection or view grouping does not refetch the lead-time dataset

## Implementation ownership

Verified on 2026-10-08 against App decomposition Task 8 and post-review corrections `055d8bbf`. [`App`](../../frontend/src/dashboard.jsx) keeps [`useStatsState`](../../frontend/src/stats/useStatsState.js), the per-group [`statsGroupState`](../../frontend/src/stats/statsGroupState.js) seam and the three [`useStatsData`](../../frontend/src/stats/useStatsData.js) layers mounted, consuming the memoized [`useEngScope`](../../frontend/src/eng/useEngScope.js). Caches and selections survive closing Statistics. [`StatsPanel`](../../frontend/src/stats/StatsPanel.jsx) owns chart hover state, pointer handling and chart DOM effects, including scroll-to-today when Burndown mounts.

The panel loads through [`LazyViewBoundary`](../../frontend/src/components/LazyViewBoundary.jsx). Once loaded, reopening the panel renders without suspending or showing the loading fallback. A failed chunk load offers one explicit Retry through [`createLazyViewLoader`](../../frontend/src/components/lazyViewLoaders.js), using only the mounted build's validated versioned manifest. The boundary handles only tagged load failures; view render errors propagate to the app as before. A second failure or stale/malformed manifest shows reload guidance; selections stay mounted and terminal authentication recovery takes precedence. The dashboard is served by Flask using the split ESM output from [`build_dashboard.mjs`](../../scripts/build_dashboard.mjs); direct file-scheme opening is unsupported. [Ownership and verification contracts](../ontology.md#remaining-app-responsibilities) include committed-asset recovery coverage.

Analytics impact: this is a pure refactor with unchanged canonical events and typed parameters; no new event is needed for static chunk or manifest retries.
