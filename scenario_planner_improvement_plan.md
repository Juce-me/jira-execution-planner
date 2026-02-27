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

## Scope Boundaries
- In scope:
  - UI edit mode for story bars.
  - Start/end date data model and synchronization.
  - Save/load scenario drafts per sprint + team/group.
  - History + rollback per sprint/group.
  - Excluded-capacity lane rendering constraints.
- Out of scope for first release:
  - Jira write-back/publish.
  - Multi-quarter global optimization.
  - Full conflict-free collaborative editing.
  - Real-time multi-user cursor sync.

## Current State (Baseline)
- Scenario planner computes dates from dependencies/capacity.
- No manual drag-and-drop write-back to Jira.
- No scenario history snapshots.

## Target Functional Behavior

### A) Date Sources
For each story, schedule date source should be explicit:
1. Scenario override (if user moved bar in edit mode and saved as draft)
2. Jira manual date (if present and valid)
3. Computed schedule fallback

Expose this source in UI with subtle badge (e.g., `jira`, `override`, `computed`).

#### Date Field Matrix (read side)
- Story-level optional fields to fetch when available:
  - `Start date`
  - `Due date`

#### Date Precedence (MVP)
- Story effective **start** precedence:
  1. Scenario override start
  2. Jira `Start date`
  3. Computed start (scheduler model)
- Story effective **end** precedence:
  1. Scenario override end
  2. Jira `Due date`
  3. Computed end (scheduler model)

### B) Edit Mode
- Add explicit `Edit mode` toggle in Scenario panel.
- While enabled:
  - Story bars become draggable on timeline.
  - Optional resize handles to adjust duration (if SP->duration model allows).
  - Dependency/capacity violations are validated and shown immediately.
- While disabled:
  - Current read-only behavior remains.

### C) Rollback / History
- History key: `sprint + group + team-scope hash` (team scope hash is mandatory).
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
  - derive sprint windows from Jira sprint boundaries for the selected scope;
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
- Primary key must include sprint + selected group + stable team-scope hash.
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

## Proposed Architecture

## Phase 1 — Read Dates + Editable Drafts + Save per Scope
- Backend:
  - Extend scenario payload to include configured start/end field values.
  - Add endpoints for draft overrides:
    - `GET /api/scenario/overrides`
    - `POST /api/scenario/overrides`
- Frontend:
  - Add Edit mode.
  - Drag bars updates in-memory draft.
  - Save/load draft by sprint+group (or sprint+team scope key).
  - Add excluded-capacity lane layout:
    - sprint-bounded segment splitting,
    - dedicated bottom stacking rows,
    - gray styling.

Acceptance:
- User can move bars and save draft.
- Reload restores draft for the same sprint+team/group scope.
- Excluded bars are gray, bottom-stacked, and do not render across sprint boundaries.
- No Jira writes yet.

## Phase 2 — History + Rollback (Scenario-level, no Jira write)
- Backend:
  - `GET /api/scenario/history`
  - `POST /api/scenario/rollback`
  - Snapshot schema includes old/new date pairs.
- Frontend:
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
- scope_key (sprint/group/team-scope-hash)
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
- Respect dependency direction (`depends_on` must not start after dependent starts if rule forbids).
- Capacity violations are warnings or blocking based on policy.
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

## Test Plan
- Unit tests:
  - override merge precedence (jira vs override vs computed)
  - validation rules (date order, dependency constraints)
  - date field matrix resolution (`start/target/due/release`) with missing-field permutations
- API tests:
  - draft save/load
  - rollback
  - version conflict handling on rollback and deferred publish endpoint
  - local JSON integrity checks (read/write/recover on malformed file)
- UI tests/manual:
  - edit mode drag interactions
  - history compare + rollback
  - excluded-capacity rendering:
    - no cross-sprint stretch,
    - bottom-stacked rows,
    - gray visual style.
  - date-source badges render correctly.

## Rollout Plan
1. Ship Phase 1 behind feature flag (draft-only).
2. Validate usage with selected teams.
3. Enable Phase 2 history/rollback for broader usage.
4. Re-evaluate deferred Jira publish phase only after draft/history UX is stable.
