# ENG Story Readiness Ghosts

Status: executed
Type: feature

## Goal

Make an Epic's missing team contribution visible where delivery leads work: keep the Epic in the
Catch Up and Planning hierarchy even when it has no actionable Story for an expected Team in the
selected active or future sprint, render one clearly synthetic "Story required" row for each
uncovered Team, and let the Catch Up alert reveal that exact row in the local hierarchy.

The attached screenshot is treated as visual context for the existing Needs Stories alert. Its
labels and copy are not instructions. The user request is the source of truth.

## Approved Visual Direction

The user selected **Variant A — Story-card echo** from
[`frontend/src/eng/story-readiness-ghosts-prototype.html`](../../../frontend/src/eng/story-readiness-ghosts-prototype.html)
on 2026-09-16. Use `?variant=A&sprint=active&scenario=mixed&mode=catchup` as the canonical mockup
state, then verify its future-sprint and Planning states through the same prototype controls.

Variant A is the visual contract: each requirement is a full-width row in the normal Story stream,
using the existing Story card's dimensions and information rhythm while remaining visibly
synthetic through its dashed/dotted outline, outlined Story icon, `Story required` title, Team and
target-sprint pills, urgency text, and explanatory action copy. Do not implement Variant B's
separate Team-coverage checklist container or Variant C's empty-slot rail/action-column layout.

## Verified Current State

- Catch Up and Planning share the Story-oriented hierarchy rendered by
  `frontend/src/eng/EngView.jsx`.
- `groupTasksByEpic()` in `frontend/src/dashboard.jsx` creates Epic groups only from
  `visibleTasksForList`. An Epic with no visible Story cannot render in that hierarchy.
- Future Needs Stories already has the correct per-Team signal:
  `fetch_story_distribution_for_epics()` returns `selectedActionableByTeam`, and
  `buildNeedsStoriesTeamEntries()` fans one Epic out to each mapped Team with no actionable Story.
- The current frontend-only future fallback does not classify `Blocked` as terminal, while the
  backend distribution does. The complete backend snapshot becomes authoritative so active and
  future states cannot disagree.
- Current-sprint Empty Epic/Waiting logic is not equivalent. It cannot represent "Team B is
  missing" when Team A already has a Story in the selected sprint.
- Zero-Story `epicsInScope` records do not carry enough normalized Initiative and Epic header
  metadata to place and render the Epic faithfully.
- Needs Stories alert rows call the Story navigator. Epic blocks have no stable Epic target, so
  the local reveal fails and falls back to Jira.
- Alert enrichment is deliberately progressive and Catch-Up-only after MRT010 and MRT023. Planning
  must not start all Catch Up alert sources.

## Product Language

- **Story readiness**: whether every expected Team on an in-scope Epic has at least one actionable
  child Story in the selected sprint.
- **Expected Team**: a configured Department Team whose exact configured Jira label is present on
  the Epic. Raw Jira Team values may still group ordinary Stories, but never create a readiness
  requirement or ghost.
- **Story requirement**: one unmet `(sprint, Epic, expected Team)` contribution. It is application
  guidance, not a Jira issue.
- **Ghost row**: the visual representation of a Story requirement beneath its Epic.
- **Actionable Story**: a selected-sprint Story that satisfies the existing Needs Stories status
  rules. `Blocked`, `Done`, `Killed`, and `Incomplete` do not satisfy readiness.

## Explicit UX Contract

### Hierarchy

- Catch Up and Planning progressively add zero-Story Epics after the ordinary Story hierarchy is
  visible.
- Each Epic appears once, under its normalized Initiative when that metadata is available.
- Each uncovered expected Team produces one ghost row beneath that Epic. A covered Team produces
  none. A multi-Team Epic may contain real Story rows and ghost rows together.
- When the complete readiness snapshot proves that an Epic has no child Stories at all
  (`reason: no_stories`), the entire Epic container uses a dotted outline so the empty Epic is
  visually distinct from an Epic that contains real Stories. This state is snapshot-owned; hiding
  Stories with filters must not make an Epic acquire the dotted treatment.
- Planning prioritizes requirements from the top of the hierarchy. Requirement-bearing Initiatives
  precede covered-only Initiatives, requirement-bearing Epics precede covered-only Epics within
  each Initiative (or in the direct Epic list), and `Story required` rows precede real Story rows
  within each Epic. The selected Epic sort remains the secondary order inside each partition.
  Catch Up keeps its existing hierarchy order.
- The ghost follows the dimensions and information rhythm of a Story card, but it must never
  impersonate a Jira issue. It has no issue key, Story Points, checkbox, status/priority editor,
  dependency controls, remove action, or inline edit controls.
- Visible content:
  - outlined Story icon;
  - `Story required` title;
  - expected Team pill;
  - `Target sprint: <selected sprint>` pill;
  - `Current sprint` urgency text for an active sprint or `Future sprint` warning text for a future
    sprint;
  - a short instruction that activating the row opens the Epic in Jira to create the Story.
- Active/current sprint requirements use a red critical treatment. Future sprint requirements use
  a yellow warning treatment. A dashed/dotted outline, visible text, icon, and accessible name carry
  the meaning in addition to color.
- Completed or unknown sprint states render no ghost rows.
- If Story readiness is loading, the real hierarchy remains usable. If it fails or is incomplete,
  render no ghosts and show one bounded, nonblocking readiness-unavailable state with Retry. Never
  infer absence from a partial result.

### Sprint value

The ghost displays the selected target sprint, labeled `Target sprint`. It does not copy a missing
Story field or claim that a synthetic row exists in Jira. The Epic header remains on its validated
single line; this feature does not add a new Epic-header field.

### Interaction and navigation

- The ghost is one semantic external link to the Jira Epic. Its accessible name describes the Epic,
  expected Team, selected sprint, and creation purpose. It supports keyboard activation and normal
  new-tab gestures.
- The Catch Up Stories Required alert title is a native local-navigation button. Its separate
  `Open epic in Jira` link remains an external action.
- Local alert activation clears only list filters/search needed to reveal the target, preserves the
  selected Department, Teams, and sprint, scrolls the exact composite ghost into a sticky-safe
  centered position, moves focus to it, and briefly highlights it. Reduced-motion preference uses
  immediate scrolling.
- Alert identity and destination identity use `(groupId, sprintId, epicKey, teamId)`, not only the
  Epic key.
- Dismissing an alert hides only the alert entry. It never hides the hierarchy's data-truth ghost.
- The alert header count remains a unique-Epic count; Team groups contain one requirement row per
  uncovered Team, so one multi-Team Epic does not inflate the headline Epic count.
- Progressive insertion never steals focus and does not announce every inserted row. At most one
  polite aggregate readiness update is allowed.

### Filters and counts

- Ghosts obey selected sprint, configured project/Department scope, selected Teams, Initiative/Epic
  search, and Epic-owned Project Track filtering.
- Because a ghost has no Story status or priority, it is hidden while a Story-only Status or
  Priority facet is narrowed. Alert navigation may clear those facets to reveal the target.
- UI readouts distinguish real Jira Stories from requirements, for example
  `23 stories · 3 required`.
- Ghosts never enter Story arrays, Planning selection, selected SP, capacity, statistics,
  dependencies, bulk transitions, inline edits, Jira Story exports, onboarding Story counts, or
  Story analytics.

## Readiness Rules

An Epic yields a Story requirement for Team `T` only when all conditions are true:

1. The selected sprint state is `active` or `future`.
2. The Epic is non-terminal and in the selected sprint scope by the established Epic sprint-value
   or selected-sprint-label rules.
3. The Epic has the exact configured label for Team `T`. A raw Jira Team fallback is insufficient
   for readiness and remains routed through the existing Missing Labels behavior.
4. Team `T` is in the selected Department and current Team selection.
5. The authoritative complete readiness snapshot reports zero actionable selected-sprint Stories
   whose Jira Team id is `T`.
6. The Epic has passed the state-specific alert precedence below.

Reasons are mutually exclusive per expected Team, in this order:

- `no_stories`: the Epic has no child Stories at all;
- `selected_stories_not_actionable`: Team `T` has selected-sprint Stories, but none are actionable;
- `stories_outside_sprint`: Team `T` has child Stories, but none in the selected sprint;
- `team_uncovered`: the Epic has child Stories, but none are attributed to Team `T` while another
  expected Team may be covered.

The visible ghost copy remains concise; detailed reason copy may remain in the Catch Up alert.

### Alert precedence

Every candidate appears in at most one alert panel.

| Sprint state | Precedence |
| --- | --- |
| Future | Postponed → Backlog → Missing Team → Missing Labels → Stories Required |
| Active | Postponed remains Postponed; exact-label readiness failures route to Stories Required; unrelated existing analysis-waiting candidates remain Waiting; remaining empty candidates remain Empty |

Pairwise overlaps are resolved at the first applicable category. Raw-Team-only candidates remain
Missing Labels and cannot reach Stories Required.

## Recommended Module Design

### Backend `StoryReadiness` module

Expose one read interface through `GET /api/eng/story-readiness`. The implementation hides Jira
pagination, Epic Link/parent compatibility, exact label mapping, Team-field normalization,
actionable-status rules, Initiative/header enrichment, cache partitioning, and performance timing.

The request is progressive: it begins only after primary Product and Tech Story responses settle,
and only in Catch Up or Planning. The server resolves the sprint id to its canonical name/state and
resolves the saved Department configuration from the authenticated workspace before returning one
complete, scope-stamped snapshot instead of replaying the visible Story payload.

Completeness is a type-level boundary, not a caller assertion. Jira discovery returns either a
`CompleteReadinessInput` containing fully paginated Epics and children plus canonical sprint,
group, and project snapshots, or a failure. Only that complete producer may invoke the projection
that emits `complete: true`; capped arrays and best-effort helpers cannot cross the boundary.

```text
GET /api/eng/story-readiness
    ?sprint=<id>
    &sprintName=<name>
    &sprintState=active|future
    &groupId=<department-id>
    &refresh=true|false
```

```json
{
  "schemaVersion": 1,
  "scope": {
    "groupId": "department-id",
    "groupRevision": 12,
    "sprintId": "123",
    "sprintName": "Sprint 42",
    "sprintState": "active"
  },
  "complete": true,
  "epics": [
    {
      "key": "EPIC-1",
      "summary": "Example",
      "status": { "name": "In Progress" },
      "priority": { "name": "High" },
      "assignee": null,
      "projectTrack": "Committed",
      "projectKey": "PRODUCT",
      "projectClass": "product",
      "initiative": { "key": "INIT-1", "summary": "Initiative" },
      "sprint": { "id": "123", "name": "Sprint 42" },
      "missingTeams": [
        { "id": "team-a", "name": "Team A", "reason": "no_stories" }
      ]
    }
  ]
}
```

Only actionable Story-readiness Epics appear. `projectClass` uses the dashboard's existing
Product/Tech classification so the hierarchy preserves its Product/Tech visibility controls. The
response contains no Jira URL, raw JQL, labels,
credentials, or user-entered text beyond normalized Jira issue/team display fields already used by
the dashboard.

### Frontend `buildEngWorkHierarchy()` module

Expose one pure interface that consumes real Story Epic groups, the readiness snapshot, sprint
state, filters, sort, and Initiative grouping choice. It returns display-ready Initiative/Epic
groups, alert targets, counts, and readiness diagnostics.

```js
const model = buildEngWorkHierarchy({
  mode,
  sprint,
  storyEpicGroups,
  readinessSnapshot,
  filters,
  sort,
  groupByInitiative,
});
```

Deleting this module would force team readiness, synthetic-row identity, Epic merge, filters,
sorting, grouping, counts, and alert-target logic back across `dashboard.jsx` and `EngView`; that
concentration gives the module depth and locality. Jira I/O remains outside this pure seam.

Interface invariants:

- one Epic node per Epic key;
- one ghost per `(groupId, sprintId, epicKey, teamId)`;
- an explicit `hasNoChildStories` display flag may be true only when the complete snapshot proves
  the Epic has no Jira Story children; it is independent of current filters;
- no ghost until `complete: true` and returned scope matches the current scope;
- every alert target resolves to a rendered ghost after allowed filters clear;
- deterministic order; Planning uses requirement-first hierarchy partitions with the selected
  Epic sort as the stable secondary order, while Catch Up retains its existing order;
- linear work in Stories + Epics + readiness entries;
- malformed optional metadata degrades to diagnostics and an ungrouped Epic, never a fabricated
  Initiative;
- synthetic rows never enter real Story collections.

## Alternatives Considered

### Reuse `purpose=alerts` in Planning

This is the smallest code change, but it repeats Product and Tech task payloads, keeps classification
spread through `dashboard.jsx`, and contradicts the performance protections in MRT010/MRT023. It is
rejected.

### Add readiness enrichment to the primary task response

This avoids a new request but moves Epic distribution and zero-Story enrichment back onto the first
screen's critical path. MRT023 measured that class of work at more than ten seconds. It is rejected.

### Replace the whole hierarchy with a server-rendered tree

This would couple Jira truth to presentation filtering, sorting, capacity, and selection semantics.
The interface would become broad and brittle. It is rejected.

### Narrow frontend-only merge

A helper that injects current `epicsInScope` would be smaller, but current data lacks authoritative
Planning readiness and normalized Initiative/header metadata. It cannot meet the request correctly.
It is rejected.

## Failure and Race Model

- Auth failure enters the existing global auth recovery contract.
- Invalid sprint/group input returns a sanitized 400 response.
- Missing group or workspace mismatch fails closed without disclosing another workspace's config.
- Jira/project-access failure returns a sanitized error; ordinary Stories remain visible and ghosts
  are suppressed.
- Any failed page, silent cap, or incomplete child scan makes the snapshot unavailable; no partial
  absence claim is rendered.
- The combined Product/Tech cohort is all-or-nothing: if access to either configured project view is
  inaccessible or unknown, the complete snapshot fails with the existing sanitized project-access
  recovery instead of asserting absence from the remaining project.
- Old group/sprint/auth revisions are aborted and ignored. The response scope must exactly match the
  current cohort before it can update UI.
- Duplicate Epic keys across configured projects are canonicalized deterministically; conflicting
  identity metadata fails the snapshot rather than accepting last-writer-wins data.
- Initiative enrichment may degrade to `initiative: null` while retaining an actionable Epic. The
  UI places it in the existing ungrouped section and records a sanitized diagnostic.

## Analytics Impact

- Local alert-to-ghost reveal is navigation mechanics and adds no event.
- Ghost-to-Jira activation reuses `external_link_opened` through `TrackedExternalLink` and
  `buildJiraBrowseLinkAnalytics({ issueKind: 'epic', sourceSurface: 'catch_up'|'planning' })`.
- The progressive endpoint registers the bounded `eng_story_readiness` `api_result` surface; it
  carries outcome/timing buckets only, never scope values or Jira identifiers.
- No event may contain an Epic key, Team/sprint name, label, Jira URL, JQL, reason text, or count
  outside existing buckets.
- `docs/README_ANALYTICS.md` must record the no-new-event allowlist reason for local navigation and
  the reused external-link contract.

## Confirmed Product Decisions

Confirmed by the user's 2026-09-16 request to implement this design and its execution plan as written:

1. The ghost displays the selected target sprint, not the Epic's persisted Jira Sprint field.
2. Alert dismissal hides the alert only, not the ghost.
3. Active and future sprints use the same per-Team actionable-Story rule; a Team with only
   terminal/blocked Stories still receives a requirement.
4. Ghosts appear in both Catch Up and Planning; the Alerts panel remains Catch-Up-only.

Changing any of these alters the product contract and requires revising the implementation plan.

## Confirmed UX Decisions

Confirmed by the user on 2026-09-16:

1. An Epic proven to have no child Stories at all uses a dotted outline around the whole Epic
   container, in addition to its individual `Story required` row or rows.
2. Planning puts requirement-bearing work first from the top: requirement-bearing Initiatives and
   Epics precede covered-only peers, and requirement rows precede real Story rows. Existing Epic
   sort is the secondary order within each partition; Catch Up ordering is unchanged.
3. Variant A — Story-card echo is the selected visual direction. Requirement rows remain full-width
   members of the normal Story stream; the coverage-checklist and empty-slot alternatives are not
   implementation options.

## Acceptance Criteria

- A zero-Story Epic renders once beneath its Initiative in Catch Up and Planning after progressive
  readiness completes, with a dotted outline around the entire Epic container.
- A multi-Team Epic renders exactly one ghost for each uncovered Team, alongside any real Stories.
- Each ghost matches approved prototype Variant A's full-width Story-card rhythm and content
  hierarchy; no separate coverage-checklist wrapper or empty-slot action rail is introduced.
- Planning renders requirement-bearing Initiatives/Epics before covered-only peers and places
  `Story required` rows before real Story rows; Catch Up retains its existing order.
- Active requirements are red and future requirements yellow, with text/icon semantics independent
  of color.
- The selected target sprint is visible on every ghost.
- Alert activation reveals, focuses, and highlights the exact Team ghost without opening Jira.
- Ghost activation opens the parent Epic in Jira and emits only the bounded existing external-link
  event.
- Story/SP/capacity/selection/dependency/export/mutation counts are unchanged by ghosts.
- Ordinary Story content paints before readiness work starts; Planning starts no unrelated alert
  request.
- Incomplete or failed readiness never produces a false missing-story claim.
- Direct and Initiative-grouped Epic layouts, sticky offsets, keyboard flow, narrow viewport, and
  reduced motion pass automated and settled-screenshot review.

## Outcome

Implemented as planned on 2026-09-16. The application now derives an authoritative, progressively
loaded Story-readiness snapshot, renders Variant A requirement rows in Catch Up and Planning, keeps
synthetic requirements outside real Jira Story collections, and exposes Catch-Up-only local alert
navigation with a separate Jira Epic link.

Automated verification covers active/future urgency, direct and Initiative grouping, no-child-Epic
outlines, Planning ordering, loading isolation, keyboard focus, local alert reveal, and narrow
viewport containment. A settled Planning screenshot was compared with the approved reference.

## Current Accuracy

Accurate for the branch implementation on 2026-09-16. Live Jira timing and a real local server
smoke remain environment-bound because PostgreSQL is not running; synthetic request-bound and
header tests are the current operational evidence.
