# Statistics

The Statistics panel summarizes sprint execution and epic flow for the currently selected scope.

It is available for future, active, and completed sprints. Teams and Priority show the data available for the selected sprint; range-backed views retain their own Start Sprint and End Sprint selectors. Changing the header Sprint to a future sprint keeps Statistics open. Sign-in recovery preserves Statistics for future sprints too.

Hover uses the shared [design-system vocabulary](../design-system.md): ordinary actions use the overlay and ring; selected cohort and graph controls keep their selected colors and meaningful elevation with a separate ring; icons use circles and text links underline. Graph headings and notes remain readable on the composed hover fill without changing resting typography. Chart segment fills, legend isolation/dimming, strip feedback and contained pointer readouts retain their existing behavior. The existing muted-detail and excluded-Epic dimming contrast debt remains separate palette scope.

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

Shows epic cohorts and lead times for a selected set of Epics. A **Mode** dropdown (first control) chooses which Epics the view is built from; exactly one selection control follows it, then the shared filters (Group By, Project, Exclude, status chips). There is no Assignee filter.

| Mode | Selection control | Epics |
| --- | --- | --- |
| **Created** (default) | **Created quarter** start and end | Epics created within the quarter range, open or closed, matching the Department's Teams or Components |
| **Closed** | **Closed quarter** start and end | Epics whose terminal date falls within the quarter range |
| **Last N** | **Number of epics** (30, 50 or 60) | The newest N closed Epics, counted after the filters |

Created mode is unchanged: its request, its data, its cache and its parts behave as before this change; the **Quarter** label is now **Created quarter**.

Main parts:
- cohort heatmap by created period and elapsed period; its hover detail renders above the graph panel
- longest-open epics view (Created mode only)
- Completed Epics list with load more, and a Jira link
- filters for project, grouping mode, and status

`Postponed` is treated as terminal rather than open in Created mode.

#### Closed and Last N

- **Closed Epic** means status Done, Killed or Incomplete. Postponed Epics are excluded entirely from both closed modes, including a saved Postponed status toggle; the status chips show only Done, Killed and Incomplete there. The terminal date is Jira `resolutiondate`, falling back to the changelog for a closed Epic without one (the closed modes read the full changelog for that fallback).
- **Scope** is the Board's exact-Component scope, with no Team matching. A Department with no Components falls back to its Teams; one with neither shows `Scope: none configured (no Components or Teams)` and sends no Jira search. The scope is stated above the chart (`Scope: Components` or `Scope: Teams (no Components configured)`). A scope too large for one Jira search is a 400 that the panel shows as an error, never a silent shortfall.
- **Last N** asks the server for a bounded window of the most recently closed Epics (200 by default, set with `EPIC_COHORT_LAST_N_WINDOW`, never below 60), then applies the Project, Exclude and status filters in the browser and keeps the newest N by closing day, then Epic key. Changing N or a filter never refetches. When the server window was full and the filters leave fewer than N Epics in it, the panel says `Showing X of N` and names the window; when the window was not full, fewer than N simply means fewer closed Epics exist in scope, and no note is shown.
- **Hidden parts:** the closed modes show no Open Epics list, no Workflow Status card and no Open column in the heatmap.
- **Overflow column:** an Epic that took longer to close than the grid's column budget lands in a trailing `Q+12+` (Quarter grouping) or `M+24+` (Month grouping) column instead of vanishing.
- **Jira link:** the Completed Epics link in the closed modes lists exactly the Epics the chart lists (`key in (...)`, up to 250 keys); above 250 the link is omitted and a note says why.
- Mode, each mode's own selection and the Last N count are saved per Department group and can be shared in a link (see [Shareable view links](shareable-view-links.md)). The link also carries the Project, the Exclude boxes, the status chips that are on and Group By, so the recipient lands on the same filtered chart.
- A saved or shared Project is kept until the Epics for the current Mode and range have loaded; it falls back to All Projects only when those Epics contain no such Project.

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
- **Totals bar**: one horizontal stacked bar of SP by track, aggregated over the whole selected sprint range, with a value label on each segment. Hidden in Team mode when the header Teams scope contains exactly one team (including a one-team Department's All Teams scope), because its By team row already shows the same total. Multiple selected teams retain the summary even if only one has Story Points. The bars carry the track names, so there is no separate track legend.
- **Per-sprint chart**: one vertical stacked bar per sprint in range, split by track (hidden when the range is a single sprint).
- **By assignee / By team breakdown**: one horizontal stacked bar per assignee (Epic mode) or team (Team mode), split by track, each segment value-labelled. In Epic mode, selecting an assignee's `No track` segment opens those epics in Jira.
- **Story-status strips** (Team mode only, #262): a thin 7px strip under every track segment of the visible totals bar and each By team row, aligned to that segment. It splits the track's SP by each Story's own status, weighted by its Story Points; Project Track remains inherited from the parent Epic. The Department's ENG Board supplies column order, colours, and status ownership (exact Story status match; the first column wins a status listed twice; an unlisted or missing status lands in the first column). A Department without a configured Board uses the Board composer's default To Do / In Progress / Done columns built from observed Story statuses. Stories without a parent Epic use their own status column too, within `No track`. Strips have no labels and no click action: hovering or focusing one shows the team, the track total, and every column's SP (including `0 SP` columns). Every strip sums to its track segment's SP.
- **Time in Project Track phase** (Epic mode only): for each in-scope epic, days spent in each track state (`No track` → `Flexible` → `Committed`, derived from Jira changelog), each phase segment value-labelled in days, plus an aggregate summary (avg days to first track, avg days to Committed). Epic names link to Jira. If the epic set is capped server-side, a truncation notice is shown instead of silently dropping epics.

## Lead Time Definition

The definition below applies to every mode; the closed modes list only closed Epics.

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
- Lead Times uses a separate on-demand cohort API call per mode; the request for Created mode carries no `mode` and is unchanged, and a mode already fetched is not requested again when you return to it
- Excluded Capacity uses cached progressive stats-source requests for the Start Sprint / End Sprint range
- Mono vs Cross reuses the cached progressive stats-source data and the same sprint range
- Project Track reuses that same cached stats-source data and sprint range (no second fetch); only its time-in-phase section makes a separate, bounded, client-cached changelog request per distinct in-scope epic set
- changing UI-only controls such as row selection or view grouping does not refetch the lead-time dataset; neither does a Last N count or a filter change

## Implementation ownership

The #251 automatic-return implementation refreshes only the active source. Teams/Priority use ENG scope reads; Burndown adds one changelog-source read; Lead Times uses one cohort read. Range-backed views replace the selected Sprint's included chunk and retain the other range chunks. Automatic acquisition keeps charts and user filters visible, without phase-duration or offscreen-source reads. If the header Sprint is outside the displayed range, the automatic attempt settles quietly without a read, check timestamp, pending intent or retry. A later eligible return can check an included Sprint. Cached or unknown coverage is qualified in the header rather than described as fully fresh. See [return behavior and remaining verification gates](eng-workflows.md#return-after-an-absence).

Verified on 2026-10-08 against App decomposition Task 8 and post-review corrections `055d8bbf`. [`App`](../../frontend/src/dashboard.jsx) keeps [`useStatsState`](../../frontend/src/stats/useStatsState.js), the per-group [`statsGroupState`](../../frontend/src/stats/statsGroupState.js) seam and the three [`useStatsData`](../../frontend/src/stats/useStatsData.js) layers mounted, consuming the memoized [`useEngScope`](../../frontend/src/eng/useEngScope.js). Caches and selections survive closing Statistics. [`StatsPanel`](../../frontend/src/stats/StatsPanel.jsx) owns chart hover state, pointer handling and chart DOM effects, including scroll-to-today when Burndown mounts.

The panel loads through [`LazyViewBoundary`](../../frontend/src/components/LazyViewBoundary.jsx). Once loaded, reopening the panel renders without suspending or showing the loading fallback. Failed lazy components also stay cached across parent renders and reopening: only explicit Retry starts a new attempt, preventing repeated imports and a stuck loading message when an older open tab requests a removed chunk. Retry uses [`createLazyViewLoader`](../../frontend/src/components/lazyViewLoaders.js) and only the mounted build's validated versioned manifest. The boundary handles only tagged load failures; view render errors propagate to the app as before. A second failure or stale/malformed manifest shows a **Reload page** button with an unsaved-changes warning. Reload is user-initiated; selections stay mounted until then and terminal authentication recovery takes precedence. The dashboard is served by Flask using the split ESM output from [`build_dashboard.mjs`](../../scripts/build_dashboard.mjs); direct file-scheme opening is unsupported. [Ownership and verification contracts](../ontology.md#remaining-app-responsibilities) include committed-asset recovery and concurrent-parent-render coverage, reverified on 2026-10-13.

Analytics impact: the prior module extraction keeps canonical events and typed parameters unchanged; static chunk or manifest retries need no new event. The #251 automatic-return acquisition and age readout use the [No-Event Allowlist](../README_ANALYTICS.md); existing `api_result` records continue to describe actual source reads.
