# Project Track Left Capacity — Approved UI Decision

Status: approved design, 2026-09-08. Production implementation has not started.

The user approved the status-strip preview with “yeap, seems legit” and requested an implementation plan and a precise record of this decision. This document supersedes the earlier burndown, separate-track charts, team-selector, and standalone capacity-bar explorations.

## Authoritative visual

[Open the approved standalone preview](../../assets/mockups/project-track-left-capacity.html).

The preview contains synthetic teams and status values. Its body is the approved preview preserved unchanged, wrapped as a standalone document. It is a visual reference, not production code or a real-data fixture. Its sample-data caption is not production copy.

## Fixed composition

- Reuse the existing **By team** Project Track card and `StackedBar` layout: team name, total SP, then a full-width track bar.
- Keep the established track order: **Committed**, then **Flexible**. Keep the existing track color resolver, labels, compact-label fallback, rounded ends, typography, and row-relative proportional widths.
- Add a **thin 7px status strip**, separated by 3px, immediately under each track segment. Its left/right boundaries must coincide with that parent segment. It is a child breakdown of the track, not another independently scaled bar.
- Within each strip, order statuses **Spent → In Progress → To Do**. Reuse Board progress appearance: green `#52c41a`, the existing blue gradient, and gray `#e8edf7`. No animation is required; do not copy Board's shimmering animation into a 12-team stats list.
- Show **N SP left** centered below each track's strip. Use the existing SP display precision, including decimals. Keep the quantity visually stronger than “left.”
- Use one compact status legend above the rows: **Spent (Done + Incomplete)**, **In Progress**, **To Do**.
- Keep one quiet, inline readout beneath the rows. A strip click or keyboard focus shows team, track, total, spent, in-progress, to-do, and left SP. It replaces its own text; it does not open a modal, tooltip, task list, or Jira link. Reset it when the data scope changes.
- Match the approved responsive layout: team name and total stay together above the bar on narrow screens; the two track segments and their status strips remain aligned. Do not put 12 teams into independent cards.
- For very narrow track segments, retain the existing compact bar-label fallback. If an exact left label cannot fit, show both track-left quantities in one compact row beneath that team's bar, explicitly labeled Committed/Flexible; never clip or omit the exact value. This is the narrow-width fallback, not a new desktop layout.

## Scope and calculations

The enhanced **By team** card is a selected-sprint capacity view. Show the header-selected sprint name in that same card. Its upper track bars, row total, strips, and left labels must all use that one sprint and the header Teams/Department scope. Capacity side and exclusion controls continue to apply.

The other Project Track sections retain their existing range-based behavior. In Epic mode, By assignee and phase charts retain their existing behavior. Do not show selected-sprint strips underneath range-based or dominant-sprint Epic totals. This deliberately makes the By team card's selected-sprint scope explicit while leaving the range analyses intact.

For each team and each of Committed/Flexible:

```text
track total = sum of non-Killed selected-sprint Story SP under Epics of this track
spent       = sum of those Story SP in Done or Incomplete
left        = track total - spent
team total  = Committed total + Flexible total
```

Each strip's widths sum to its track width. Use SP, not story counts; do not call Board's story-count progress model. In Progress plus To Do/residual SP equals left. Story status determines consumption; Epic track determines classification. Killed stories are absent from both totals and strips. No track/unknown track is outside this capacity metric, and remains represented by the existing range-based analyses.

Normalize status names for comparisons. Check Killed first, then Done/Incomplete, then the existing Board phase rank 4 for In Progress; remaining statuses use the neutral residual segment. “To Do” is the compact neutral legend label. If that residual includes other or unrecognized statuses, the readout must identify their actual names and SP instead of falsely claiming they are all literally To Do. Missing status is labeled Unknown in the readout. Do not silently treat all terminal phase ranks as spent.

No sprint selection means an explicit select-sprint empty state. No eligible SP means an empty state, not fabricated capacity. Invalid, negative, zero, or missing estimates do not add capacity; disclose unestimated story count in the inline note when present. A team with only spent work still appears with 0 SP left. A missing/zero track does not get a fabricated segment or divide by zero.

## Forbidden substitutions

No burndown or timeline, no separate Flexible/Committed graphs, no additional team picker, no new stats navigation item, no per-team cards, no 12-team line legend, no capacity budgets or throughput forecasts, no redesigned filter controls, and no Board story-count calculation. Keep the screenshot's current track-bar grammar.

## Implementation contract

See [the implementation plan](EXEC-project-track-left-capacity.md) for file ownership, source loading, tests, and acceptance checks. A future layout change must be reviewed against this decision and the approved preview, not against the abandoned graph proposals.
