# Scenario Planner Improvement Plan

Branch for this plan and implementation:
- `plan/scenario-planner-improvements`

## Goal
Upgrade Scenario Planner from read-only schedule visualization to an editable planning tool that can:
1. Read schedule dates from Jira when available.
2. Allow users to move/reschedule story bars in a controlled edit mode.
3. Let users save scenarios per sprint + team/group and reopen them later.
4. Provide rollback/history by sprint + group before any Jira write-back.
5. Render excluded-capacity work in constrained gray lanes that do not span across sprint boundaries.
6. Keep Jira write-back (`Publish to Jira`) as a deferred future phase.
7. Provide per-assignee editing lanes as the primary editing surface.

## Scope Boundaries
- In scope:
  - Per-assignee lane editing as the primary edit surface.
  - UI edit mode for story bars (drag-to-reorder/reschedule, snap-to-day).
  - In-session undo/redo stack for edit operations.
  - Start/end date data model and synchronization.
  - Client-side capacity/dependency revalidation after manual moves.
  - Save/load scenario drafts per sprint + group.
  - History + rollback per sprint/group.
  - Excluded-capacity lane rendering constraints.
  - Frontend component extraction (ScenarioEditor, ScenarioHistory, ScenarioBar).
  - Assignee labels on lane rows.
- Out of scope for first release:
  - Jira write-back/publish.
  - Multi-quarter global optimization.
  - Full conflict-free collaborative editing.
  - Real-time multi-user cursor sync.

## Current State (Baseline)
- Scenario planner computes dates from dependencies/capacity.
- No manual drag-and-drop write-back to Jira.
- No scenario history snapshots.
- Assignee-aware row stacking is implemented (MRT006 fix at `dashboard.jsx:4453-4472`).
- Assignee labels on lane rows are **NOT** implemented (open MRT006 TODO).
- Sprint data (`/api/sprints`) stores only `{id, name, state}` — no `startDate`/`endDate` (stripped at `jira_server.py:1590-1594`).
- Issue date fields (`startDate`, `duedate`) are **NOT** fetched by `/api/scenario` (fields at `jira_server.py:2812-2825`).

## Prerequisites (must be done before Phase 1)

### P0a) Fetch sprint boundary dates
- `fetch_sprints_from_jira()` (`jira_server.py:1549`) already receives `startDate`/`endDate` from the Jira Board API but strips them.
- **Action**: Include `startDate` and `endDate` in the formatted sprint objects.
- **Action**: Include sprint boundaries in the `/api/scenario` response (for the selected sprint + neighbors) so the frontend can clip excluded bars and render sprint markers.

### P0b) Fetch issue date fields from Jira
- `/api/scenario` currently fetches: `summary, status, priority, issuetype, assignee, storypoints, parent, epic_link, team`.
- **Action**: Add `startDate` and `duedate` (native Jira fields) to the fetch field list.
- **Action**: Add configurable custom field overrides in settings (for orgs that use custom date fields):
  - `Scenario Start Field` (default: `startDate`)
  - `Scenario End Field` (default: `duedate`)
- **Action**: Include raw Jira dates in the per-issue response alongside computed dates, so the frontend can apply the precedence model.

### P0c) Assignee labels on lane rows
- MRT006 postmortem TODO (still open): "Add assignee name labels to row gutters".
- **Action**: Add assignee name labels to lane rows in team-view mode (each row already tracks its assignee via `rowAssignees[]` at `dashboard.jsx:4480`).
- This is a prerequisite for the per-assignee editing UX — users must see who each row belongs to.

## Target Functional Behavior

### A) Date Sources
For each story, schedule date source should be explicit:
1. Scenario override (if user moved bar in edit mode and saved as draft)
2. Jira manual date (if present and valid)
3. Computed schedule fallback

Expose this source in UI with subtle badge (e.g., `jira`, `override`, `computed`).

#### Date Field Matrix (read side)
- Story-level optional fields to fetch when available:
  - `Start date` (Jira native `startDate` or configured custom field)
  - `Due date` (Jira native `duedate` or configured custom field)

#### Date Precedence (MVP)
- Story effective **start** precedence:
  1. Scenario override start
  2. Jira `Start date`
  3. Computed start (scheduler model)
- Story effective **end** precedence:
  1. Scenario override end
  2. Jira `Due date`
  3. Computed end (scheduler model)

### B) Edit Mode — Per-Assignee Lanes

Edit mode uses **assignee lane mode** as the primary editing surface.

**Rationale**: Sprint planning is fundamentally about who does what when. The assignee view gives each person a single-threaded (WIP=1) sequential timeline — the simplest possible surface for drag-based scheduling. This avoids stacking ambiguity (MRT006), makes dependency violations visually obvious, and naturally supports cross-assignee reassignment.

#### Edit mode UX
- Add explicit `Edit mode` toggle in Scenario panel.
- When toggled ON, lane mode **locks to assignee view** (team/epic views remain read-only for the "big picture").
- While enabled:
  - Story bars become draggable on the timeline.
  - **Snap**: bars snap to day boundaries (not free-form).
  - **Drag within lane**: reorders/reschedules the issue for that assignee.
  - **Drag across lanes**: moves the issue to a different assignee (reassignment).
  - Dependency and capacity violations are validated on the client immediately (see section B2).
  - Conflicts (assignee overload) are shown as **warnings** — user is allowed to save.
  - Optional resize handles to adjust end date (does NOT change story points — only overrides the end date).
- While disabled:
  - Current read-only behavior remains.
  - All three lane modes (team/epic/assignee) available.

#### Lane header in edit mode
- Each assignee lane header shows: **assignee name**, capacity info, total SP loaded in sprint.
- Visual indicator when lane is overloaded (total SP > capacity).

#### Unscheduled issues in edit mode
- Issues without story points cannot be dragged onto the timeline.
- **Minimum requirement for scheduling**: the issue must have story points assigned.
- Unscheduled issues remain in a separate "unscheduled" section/chip area.
- User must add story points in Jira (or via a future inline-edit) before the issue becomes draggable.

### B2) Client-Side Revalidation

After each manual move, the frontend validates constraints locally (no server round-trip per drag):

#### Dependency validation
- Check: does the moved bar's new start violate any `blockedBy` relationship (start before a prerequisite ends)?
- Check: does the move cause any downstream dependent to start before this bar ends?
- Display: highlight violated dependency edges in red; show inline warning badge.
- Policy: **warning only** — allow save.

#### Capacity validation
- Check: does the assignee now have overlapping tasks in the same time window?
- Display: highlight overlapping bars; show "overloaded" warning on lane header.
- Policy: **warning only** — allow save.

#### What happens to dependents when dragging a prerequisite
- **No auto-cascade.** Moving a prerequisite does NOT auto-move its dependents.
- Violations are shown as warnings. User decides whether to also adjust dependents manually.
- Rationale: auto-cascade is complex and surprising. For MVP, explicit manual control is safer.

### B3) In-Session Undo/Redo

- Maintain an in-memory **command stack** for edit-mode operations.
- Each drag/move/resize creates a command entry: `{ issueKey, oldStart, oldEnd, newStart, newEnd }`.
- **Undo** (Ctrl+Z / Cmd+Z): pops last command, restores previous dates.
- **Redo** (Ctrl+Shift+Z / Cmd+Shift+Z): re-applies undone command.
- Stack is cleared on save or when exiting edit mode.
- This is distinct from the cross-session rollback/history feature (section C).

### C) Rollback / History
- History key: `sprint_id + group_id` (group ID from `dashboard-config.json` `teamGroups.groups[].id`).
- Each scenario save writes a snapshot entry:
  - who, when, issue count, old dates, new dates, note/comment.
- Add `History` panel:
  - list entries
  - compare changed issues
  - rollback selected entry (restores previous scenario state)

### D) Excluded Capacity Visualization (Planning module)
- Excluded-capacity bars must be treated as flexible/ignored for sprint-span stretching:
  - never render a single excluded bar segment across multiple sprint boundaries;
  - split/chunk excluded segments per sprint window.
- When excluded items overlap in the same sprint window, stack them in dedicated lower lanes.
- Visual treatment:
  - gray palette for excluded bars/chips;
  - positioned at the bottom of each epic lane (or as the last items per assignee lane in assignee mode).
- This is a display/layout rule only; it must not change dependency logic for non-excluded issues.
- Clipping/stacking rule (explicit):
  - derive sprint windows from Jira sprint boundaries (requires P0a — sprint dates in API response);
  - split excluded bar spans at each sprint boundary;
  - assign clipped segments to dedicated excluded rows after regular rows;
  - excluded segments must never consume regular rows; they may only consume dedicated excluded rows.

## Dependencies and Decisions

### 1) Jira Date Fields
Need final field mapping for scenario dates:
- Option A: Jira native fields (`startDate`, `duedate`) when available.
- Option B: Custom fields (e.g., `customfield_xxx_start`, `customfield_xxx_end`).

Action:
- Add configurable fields in settings:
  - `Scenario Start Field`
  - `Scenario End Field`

### 1b) Write Policy (deferred phase)
- Deferred publish phase writes only explicitly configured scenario date targets.

### 2) Jira Permissions
Required for future publish/rollback to Jira:
- Jira edit permission on targeted issues.
- Stable account strategy:
  - Current service account write access OR
  - Future user OAuth (3LO) write access.

### 3) Data Storage
Need storage for drafts/history snapshots:
- Phase 1: dashboard-local external JSON store (same local model as current app config files).
- Phase 2: DB-backed per user/team (required for multi-user rollout).

### 4) Scope Key for Saved Scenarios
- Primary key: `sprint_id + group_id`.
- `group_id` is the `id` field from `dashboard-config.json` → `teamGroups.groups[]` (e.g., `"default"`).
- Keep save/load deterministic so users can reliably return to the same scenario state.

### 5) Scenario Identity and Versioning
- Support multiple saved scenarios per same scope:
  - `scenario_id`, `name`, `is_default`
  - optimistic `version`
  - `created_by`, `updated_by`, timestamps
- Rollback operations should create a new head version (no destructive rewrite of history).

### 6) Local Storage Shape (Phase 1)
- Store scenario metadata and per-issue overrides in a dedicated dashboard-local JSON file.
- Recommended top-level shape:
  - `scenarios[]` header entries (`scenario_id`, `name`, `scope_key`, `version`, `created_by`, `updated_by`, timestamps)
  - `overrides[]` rows (`scenario_id`, `issue_key`, `start_date`, `end_date`)
  - `history[]` snapshot entries (`scenario_id`, `scenario_version`, `changes[]`, `created_by`, `created_at`, `comment`)
- Keep this file separate from `dashboard-config.json` to avoid config/schema coupling.

### 7) Drag Interaction Approach
- **No external library** for Phase 1 — use native `onMouseDown`/`onMouseMove`/`onMouseUp` handlers on bar elements.
  - Rationale: `react-dnd` and `@dnd-kit` add bundle size and complexity; the interaction is simple enough (horizontal drag within a known track width).
- **Snap**: calculate day offset from mouse position relative to track, round to nearest day boundary.
- **Visual feedback during drag**: ghost bar at snapped position, original bar dimmed.
- **Drop commit**: update in-memory override state, push to undo stack, trigger revalidation.

## Frontend Component Extraction

### Motivation
`dashboard.jsx` is ~565KB. Adding drag/edit/history/save logic to it will make it unmaintainable. The scenario planner should be extracted into its own component tree.

### Proposed extraction
- `frontend/src/scenario/ScenarioPanel.jsx` — top-level scenario container (replaces inline scenario rendering in dashboard.jsx). Owns state for scenario data, edit mode, lane mode.
- `frontend/src/scenario/ScenarioTimeline.jsx` — timeline axis, view range, sprint markers.
- `frontend/src/scenario/ScenarioLane.jsx` — single lane (assignee or team or epic). Owns row layout, stacking.
- `frontend/src/scenario/ScenarioBar.jsx` — single issue bar. In edit mode, handles drag events.
- `frontend/src/scenario/ScenarioEdges.jsx` — SVG dependency edge rendering.
- `frontend/src/scenario/ScenarioEditor.jsx` — edit-mode controller: undo/redo stack, override state, revalidation logic, save/load.
- `frontend/src/scenario/ScenarioHistory.jsx` — history drawer: snapshot list, diff view, rollback action.
- `frontend/src/scenario/scenarioUtils.js` — shared helpers (date parsing, position calculations, snap logic).

### Migration strategy
- Extract incrementally: start with ScenarioBar and ScenarioEditor (the new code), then migrate existing rendering piece by piece.
- Keep the existing monolithic code working at all times — no big-bang rewrite.

## Proposed Architecture

## Phase 0 — Prerequisites
- P0a: Fetch sprint `startDate`/`endDate` in `fetch_sprints_from_jira()` and include in `/api/scenario` response.
- P0b: Fetch issue `startDate`/`duedate` in `/api/scenario` and include raw Jira dates per issue.
- P0c: Add assignee labels to lane rows in team-view mode.
- P0d: Begin component extraction — create `frontend/src/scenario/` directory, extract ScenarioBar and scenarioUtils first.

Acceptance:
- Sprint objects in API include `startDate`/`endDate`.
- Issue objects in scenario response include `jiraStartDate`/`jiraDueDate` (raw Jira values, nullable).
- Assignee names visible on lane rows in team-view.
- ScenarioBar renders identically to current inline bars but from extracted component.

## Phase 1 — Read Dates + Editable Drafts + Save per Scope
- Backend:
  - Extend scenario payload to include configured start/end field values.
  - Apply date precedence model (override > Jira > computed) in response.
  - Add endpoints for draft overrides:
    - `GET /api/scenario/overrides?scope_key=...`
    - `POST /api/scenario/overrides`
- Frontend:
  - Add Edit mode toggle (locks to assignee lane view).
  - Implement drag-to-move with day-snap (native mouse events).
  - Implement in-session undo/redo command stack.
  - Client-side revalidation (dependency + capacity warnings).
  - Save/load draft by sprint_id + group_id scope key.
  - Add date-source badges (`override`, `jira`, `computed`).
  - Add excluded-capacity lane layout:
    - sprint-bounded segment splitting (using sprint dates from P0a),
    - dedicated bottom stacking rows,
    - gray styling.

Acceptance:
- User can toggle edit mode, which locks to assignee view.
- User can drag bars to reschedule (snaps to day).
- Undo/redo works for all drag operations.
- Dependency violations shown as red edges + warnings.
- Capacity overloads shown as warnings (allowed to save).
- User can save draft; reload restores draft for the same sprint+group scope.
- Excluded bars are gray, bottom-stacked, and do not render across sprint boundaries.
- No Jira writes yet.

## Phase 2 — History + Rollback (Scenario-level, no Jira write)
- Backend:
  - `GET /api/scenario/history?scope_key=...`
  - `POST /api/scenario/rollback`
  - Snapshot schema includes old/new date pairs.
- Frontend:
  - Extract ScenarioHistory component.
  - History drawer with diff summary.
  - Rollback action with confirmation.

Acceptance:
- User can rollback a prior saved scenario state for selected sprint+group.

## Phase 3 (Deferred/Parked) — Publish to Jira
- Keep out of immediate implementation scope.
- Future backend:
  - `POST /api/scenario/publish`
  - update only changed issues, batched, with conflict checks.
- Future frontend:
  - Publish CTA with confirmation + per-issue results.
- Future acceptance:
  - approved changes can be written back to Jira date fields.

## Data Model Sketch

`scenario_overrides` (drafts)
- scenario_id
- scenario_name
- scope_key (`{sprint_id}:{group_id}`)
- version
- issue_key
- start_date
- end_date
- updated_by
- updated_at

`scenario_history` (scenario snapshots)
- history_id
- scenario_id
- scope_key
- scenario_version
- created_by
- created_at
- comment
- changes[]
  - issue_key
  - old_start
  - old_end
  - new_start
  - new_end

`undo_stack` (in-memory only, not persisted)
- commands[]
  - issue_key
  - old_start
  - old_end
  - new_start
  - new_end
- pointer (current position in stack)

## API Notes
- For active phases, API scope is draft/history/rollback only.
- Future (deferred): publish endpoint should support dry-run and idempotency key.
- Preserve retry/circuit-breaker behavior for Jira calls.
- Conflict safety (active phases):
  - scenario save/rollback uses optimistic `version` checks on local JSON scenario snapshots.
- Conflict safety (deferred Jira publish phase):
  - include Jira `updated` timestamp (or version token) per issue in publish payload;
  - publish compares current Jira state before write;
  - on mismatch, skip issue and return conflict details.

## Validation Rules
- Start date <= end date.
- Respect dependency direction: warn if a dependent starts before its prerequisite ends (no auto-cascade, warning only).
- Capacity violations are **warnings only** — user is always allowed to save.
- Unscheduled issues (missing story points) **cannot** be dragged onto the timeline — minimum requirement is having story points.
- Excluded-capacity segment rendering is constrained per sprint window.
- Date parsing must handle optional/missing field values and date-only formats consistently.
- Missing-date fallback policy:
  - if Jira `Due date` is missing, use scheduler-computed end date (current model behavior).
  - if no Jira dates are fetched, use scheduler-computed dates (current model behavior).

## Risks and Mitigations
- Risk: accidental Jira date corruption (deferred publish phase).
  - Mitigation: dry-run + explicit publish confirmation + rollback snapshots + compare-before-write.
- Risk: conflicting edits from multiple users.
  - Mitigation: scenario versioning + Jira updated-token conflict checks + non-destructive rollback.
- Risk: field mismatch across Jira projects.
  - Mitigation: configurable field matrix (start/due) + per-project fallback rules.
- Risk: local JSON growth/corruption for scenario history in Phase 1.
  - Mitigation: versioned schema, append-safe writes, snapshot rotation/backup, and JSON integrity checks.
- Risk: monolithic frontend becomes unmaintainable with new edit features.
  - Mitigation: component extraction (Phase 0) before adding new logic.
- Risk: drag performance on large timelines (many bars).
  - Mitigation: only the dragged bar recalculates position during mousemove; revalidation runs on mouseup (debounced).
- Risk: MRT006 regression — assignee interleaving returns during edit mode.
  - Mitigation: edit mode uses assignee lane mode (one lane per person), eliminating stacking ambiguity entirely.

## Test Plan
- Unit tests:
  - override merge precedence (jira vs override vs computed)
  - validation rules (date order, dependency constraints)
  - date field matrix resolution (`start/target/due/release`) with missing-field permutations
  - undo/redo stack operations (push, undo, redo, clear)
  - scope key generation (`{sprint_id}:{group_id}`)
  - client-side revalidation (dependency violation detection, capacity overload detection)
  - snap-to-day calculation
- API tests:
  - sprint response includes `startDate`/`endDate`
  - scenario issue response includes `jiraStartDate`/`jiraDueDate`
  - draft save/load
  - rollback
  - version conflict handling on rollback and deferred publish endpoint
  - local JSON integrity checks (read/write/recover on malformed file)
- UI tests/manual:
  - edit mode toggle locks to assignee view
  - drag interactions snap to day boundaries
  - cross-lane drag reassigns issue
  - undo/redo with keyboard shortcuts
  - unscheduled issues (no SP) are NOT draggable
  - dependency warnings render on constraint violations
  - capacity overload warnings render correctly
  - history compare + rollback
  - assignee labels on lane rows visible
  - excluded-capacity rendering:
    - no cross-sprint stretch,
    - bottom-stacked rows,
    - gray visual style.
  - date-source badges render correctly.

## Postmortem References
- **MRT006** (Lane Stacking Assignee Interleaving): Fix is implemented (`dashboard.jsx:4453-4472`). Open TODOs: assignee row labels (addressed in P0c), visual regression tests.
- **MRT003** (Scenario Planner Regressions): Scroll-linked updates must be throttled with `requestAnimationFrame` — applies to drag handler too.
- **MRT008** (Scenario Task Set Mismatch): Sprint filter must use sprint ID, not name — scope key uses `sprint_id` accordingly.

## Rollout Plan
1. Ship Phase 0 prerequisites (sprint dates, issue dates, assignee labels, component extraction).
2. Ship Phase 1 behind feature flag (draft-only, edit mode).
3. Validate usage with selected teams.
4. Enable Phase 2 history/rollback for broader usage.
5. Re-evaluate deferred Jira publish phase only after draft/history UX is stable.
