# Jira Delivery Planner Domain Ontology

This document is the canonical reference for product entities, their ownership, and the
relationships used when a view filters or aggregates data. Feature documentation may describe
how a surface presents these entities, but it must not redefine which entity owns a field.

## Core entities

### Epic

An Epic is a Jira issue that groups delivery Stories. Epic fields describe the Epic itself, even
when a Story-oriented view exposes those fields as controls or filters.

Epic-owned fields currently include:

- Project Track (`Project Track[Dropdown]`), with recognized values `Committed` and `Flexible`.
- Epic status, priority, assignee, summary, and configured board-column membership.

Project Track has four meaningful states:

1. `Committed`
2. `Flexible`
3. genuinely unset: `null`, missing, or trim-empty
4. populated but unrecognized, such as `Other`

Unrecognized populated values are not genuinely unset. A synthetic group for Stories without an
Epic is not an Epic and therefore is not an Epic with an unset Project Track.

### Story

A Story is a Jira issue that may belong to one parent Epic. Story-owned fields include its own
status, priority, assignee, team, story points, summary, and sprint membership.

A Story-oriented view may filter Stories through a parent-Epic field. Such a filter does not move
field ownership to the Story: it follows `Story -> parent Epic -> Epic field`.

### Department

A Department is the application scope that groups Teams and owns shared ENG board configuration.
Its board columns classify Epics by Epic status. Department selection controls which configured
Teams and board rules are in scope; it does not own Jira issue fields.

### Team

A Team is an application/Jira grouping attached to Stories. Epic-level views may derive Team or
Product/Tech classification from the Epic's child Stories, but that derivation does not make Team
a direct Epic field.

### Sprint

A Sprint is a delivery-time scope. Sprint selection limits the issues considered by the current
view. It does not change field ownership.

## View projections

### Catch Up

Catch Up is a Story-oriented task list grouped under Epic headers.

- Its overall readout counts Stories.
- Story-owned facets count and filter Stories directly.
- Its Project Track facet follows each Story's parent Epic.
- Project Track option and heading totals count unique Epics, because Project Track belongs to the
  Epic entity.
- Narrowing Project Track determines which parent Epics qualify, then admits the Stories beneath
  those Epics.
- Both Project Track options unchecked admits only Stories whose existing parent Epic has a
  genuinely unset Project Track.
- Stories without a parent Epic do not match that explicit-empty state.

### Board

Board is an Epic-oriented view. Its Project Track facet counts and filters Epics directly. Both
options unchecked means only Epics with a genuinely unset Project Track.

### Planning and Scenario

Planning and Scenario reuse the shared Story task-list projection where applicable. When they use
the Project Track facet, they inherit Catch Up's parent-Epic relationship and entity-specific
counts rather than defining a separate interpretation.

### Statistics

Statistics may aggregate Story points through Epic-owned fields. A Story contributes to a Project
Track bucket through its parent Epic, while Epic-mode totals and phase histories remain Epic-level
measures. Each chart or card must label its unit explicitly.

## Implementation rules

- Define field ownership once and reuse a shared classifier when multiple views consume the same
  field.
- Keep `unset`, `unrecognized`, and `missing parent entity` as distinct states.
- A view's primary readout unit does not automatically become every facet's count unit.
- Documentation and tests must name both the owning entity and the displayed unit for relational
  filters and aggregations.
- UI placement never changes domain ownership.
