# Project Track Board-Column Strips — Approved UI Decision

Status: approved design, 2026-09-29, issue #173. Production implementation has not started.

This decision supersedes the 2026-09-08 "Left capacity" decision (story-status Spent / In Progress / To Do strips, selected-sprint scope, and `N SP left` labels). The user reviewed the revised preview in three rounds and dropped the "left" concept: the Board-column split already shows how much of each track is finished.

## Authoritative visual

[Open the approved standalone preview](../../assets/mockups/project-track-board-column-strips.html).

The preview copies the real stats card, track-bar and hover-readout CSS from `main` and uses synthetic teams. Its "Mockup only" board toggle and caption are not production UI.

## Fixed composition

- Reuse the existing Team mode **Story points by track** totals card and **By team** card with their `StackedBar` rows: row label, total SP, then the full-width track bar. Track order stays **Committed, Flexible, No track** from the shared track resolver; track colours, labels, compact-label fallback, and 28px bar height are unchanged.
- Under every track segment, in both cards (the All teams totals row and each team row), render a **7px strip**, 3px below the bar, whose left/right edges coincide with that segment. A 2px white separator marks each track boundary inside the strip row without changing its width.
- Each strip splits that track's SP by the **current Board column of the parent Epic**, in the Department Board's column order and using each column's configured `colour`. Widths are SP shares of that track segment.
- **No legend pane.** Track names stay inside the bars. Board column names appear only in the hover readout.
- **No "left" value anywhere**: no labels under the bars, no readout line, no screen-reader text.
- **Hover/focus readout only; no click action.** Reuse the shared `StackedBar` bounded readout. For a strip it shows `Team · Track: N SP` as the title, then one line per Board column in Board order with its colour swatch and SP, including `0 SP` columns. Keyboard focus shows the same readout. Existing bar-segment readouts are unchanged.
- **Hover styling for Project Track bars and strips:** no lift. Replace the global button hover lift on `.stacked-bar-segment` with a soft shadow and keep the segment's own colour. Keep the existing lift on main controls such as the Catch Up / Statistics / Planning view switch.
- Epic mode (totals, per-sprint, By assignee, phase) is unchanged and has no strips.
- The preview omits the existing totals-card track legend; whether production removes it is open decision D1 in the plan.

## Scope and calculations

- Scope is the existing Project Track **Start–End sprint range**, capacity side, and exclusion toggles. There is no separate header-sprint data path.
- In **Team mode**, every section counts every Epic in the range, whatever its status, so totals do not shrink when an Epic closes. The #186 closed-Epic exclusion (Done, Killed, Incomplete) keeps applying to Epic mode only.
- **Killed is excluded** in Team mode: stories whose own status is Killed, and stories under a Killed Epic. Story status requires adding Jira `status` to the stats-source field list; that backend change was approved on 2026-09-29.
- Column resolution reuses the Board's rules: an exact Epic status match picks the column; the first column wins a status held by two; a status held by no column lands in the first column; columns without statuses are ignored.
- A Department without a usable Board configuration uses the Board composer's default **To Do / In Progress / Done** split (`deriveDefaultBoardColumns`), derived from the observed Epic statuses. The Board page itself shows a single "All epics" column in that case; the strips deliberately use the three-phase default instead (user decision, 2026-09-29).
- A story without a parent Epic has no Board column. It is shown as a neutral `No Epic` part at the end of the strip and in the readout, never assigned to a real column.
- Strip parts per track sum exactly to that track segment's SP. The All teams strip is the sum of the team strips.

## Forbidden substitutions

No legend pane, no "left" or remaining-capacity values, no click actions, popups or Jira links on strips, no story-status buckets, no separate per-track charts, no burndown, no new team selector or sprint selector, no new API, and no Board data loading on the Statistics tab.

## Implementation contract

See [the implementation plan](EXEC-project-track-board-column-strips.md) for file ownership, tests, and acceptance checks. Review any future layout change against this decision and the approved preview.
