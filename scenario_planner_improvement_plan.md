# Scenario Planner Improvement Plan

Branch for this plan and implementation:
- `plan/scenario-planner-improvements`

## Goal
Upgrade Scenario Planner from read-only schedule visualization to an editable planning tool that can:
1. Read schedule dates from Jira when available.
2. Allow users to move/reschedule story bars in a controlled edit mode.
3. Let users save scenarios per quarter + team/group and reopen them later.
4. Synchronize approved start/end dates back to Jira.
5. Provide rollback/history by quarter + group.
6. Render excluded-capacity work in constrained gray lanes that do not span across sprint boundaries.

## Scope Boundaries
- In scope:
  - UI edit mode for story bars.
  - Start/end date data model and synchronization.
  - Write-back pipeline to Jira.
  - History + rollback per quarter/group.
- Out of scope for first release:
  - Multi-quarter global optimization.
  - Full conflict-free collaborative editing.
  - Real-time multi-user cursor sync.

## Current State (Baseline)
- Scenario planner computes dates from dependencies/capacity.
- No manual drag-and-drop write-back to Jira.
- No scenario history snapshots.

## Target Functional Behavior

### A) Date Sources
For each story, effective schedule date source should be explicit:
1. Jira manual date (if present and valid)
2. Scenario override (if user moved bar in edit mode and saved as draft)
3. Computed schedule fallback

Expose this source in UI with subtle badge (e.g., `jira`, `override`, `computed`).

### B) Edit Mode
- Add explicit `Edit mode` toggle in Scenario panel.
- While enabled:
  - Story bars become draggable on timeline.
  - Optional resize handles to adjust duration (if SP->duration model allows).
  - Dependency/capacity violations are validated and shown immediately.
- While disabled:
  - Current read-only behavior remains.

### C) Persisting Changes to Jira
- Add explicit action buttons:
  - `Save draft` (local scenario override snapshot only)
  - `Publish to Jira` (write start/end dates to Jira)
- Publish applies only changed issues.
- Publish result should include success/fail list per issue.

### D) Rollback / History
- History key: `quarter + group + optional sprint`.
- Each publish writes a snapshot entry:
  - who, when, issue count, old dates, new dates, note/comment.
- Add `History` panel:
  - list entries
  - compare changed issues
  - rollback selected entry (writes previous dates back to Jira)

### E) Excluded Capacity Visualization (Planning module)
- Excluded-capacity bars must be treated as flexible/ignored for sprint-span stretching:
  - never render a single excluded bar segment across multiple sprint boundaries;
  - split/chunk excluded segments per sprint window.
- When excluded items overlap in the same sprint window, stack them in dedicated lower lanes.
- Visual treatment:
  - gray palette for excluded bars/chips;
  - positioned at the bottom of each epic lane (or as the last items per assignee lane in assignee mode).
- This is a display/layout rule only; it must not change dependency logic for non-excluded issues.

## Dependencies and Decisions

### 1) Jira Date Fields
Need final field mapping for scenario dates:
- Option A: Jira native fields (`startDate`, `duedate`) when available.
- Option B: Custom fields (e.g., `customfield_xxx_start`, `customfield_xxx_end`).

Action:
- Add two configurable fields in settings: `Scenario Start Field`, `Scenario End Field`.

### 2) Jira Permissions
Required to publish/rollback:
- Jira edit permission on targeted issues.
- Stable account strategy:
  - Current service account write access OR
  - Future user OAuth (3LO) write access.

### 3) Data Storage
Need storage for drafts/history snapshots:
- Phase 1: local JSON store (consistent with current local mode).
- Phase 2: DB-backed per user/team (required for multi-user rollout).

### 4) Scope Key for Saved Scenarios
- Primary key should include quarter + selected group (or team scope signature).
- If team filters can vary inside a group, include a stable team-scope hash in the key.
- Keep save/load deterministic so users can reliably return to the same scenario state.

## Proposed Architecture

## Phase 1 — Read Dates + UI Edit Drafts (no Jira write)
- Backend:
  - Extend scenario payload to include configured start/end field values.
  - Add endpoints for draft overrides:
    - `GET /api/scenario/overrides`
    - `POST /api/scenario/overrides`
- Frontend:
  - Add Edit mode.
  - Drag bars updates in-memory draft.
  - Save/load draft by quarter+group (or quarter+team scope key).
  - Add excluded-capacity lane layout:
    - sprint-bounded segment splitting,
    - dedicated bottom stacking rows,
    - gray styling.

Acceptance:
- User can move bars and save draft.
- Reload restores draft for the same quarter+team/group scope.
- Excluded bars are gray, bottom-stacked, and do not render across sprint boundaries.
- No Jira writes yet.

## Phase 2 — Publish to Jira + Validation
- Backend:
  - `POST /api/scenario/publish`
  - Update only changed issues, batched.
  - Return per-issue status and errors.
- Frontend:
  - Publish CTA with confirmation.
  - Show progress and failures.

Acceptance:
- Changed bars update Jira date fields.
- Failures are explicit and non-blocking for successful issues.

## Phase 3 — History + Rollback
- Backend:
  - `GET /api/scenario/history`
  - `POST /api/scenario/rollback`
  - Snapshot schema includes old/new date pairs.
- Frontend:
  - History drawer with diff summary.
  - Rollback action with confirmation.

Acceptance:
- User can rollback a prior publish for selected quarter+group.

## Data Model Sketch

`scenario_overrides` (drafts)
- scope_key (quarter/group/sprint)
- issue_key
- start_date
- end_date
- updated_by
- updated_at

`scenario_history` (published snapshots)
- history_id
- scope_key
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
- Use explicit dry-run flag for publish validation:
  - `POST /api/scenario/publish?dryRun=true`
- Support idempotency key for publish to avoid duplicate writes on retries.
- Preserve retry/circuit-breaker behavior for Jira calls.

## Validation Rules
- Start date <= end date.
- Respect dependency direction (`depends_on` must not start after dependent starts if rule forbids).
- Capacity violations are warnings or blocking based on policy.
- Excluded-capacity segment rendering is constrained per sprint window.

## Risks and Mitigations
- Risk: accidental Jira date corruption.
  - Mitigation: dry-run + explicit publish confirmation + rollback snapshots.
- Risk: conflicting edits from multiple users.
  - Mitigation: version token on publish + conflict warnings.
- Risk: field mismatch across Jira projects.
  - Mitigation: configurable start/end mapping + per-project fallback rules.

## Test Plan
- Unit tests:
  - override merge precedence (jira vs override vs computed)
  - validation rules (date order, dependency constraints)
- API tests:
  - draft save/load
  - publish dry-run and real publish
  - rollback
- UI tests/manual:
  - edit mode drag interactions
  - publish confirmation flow
  - history compare + rollback
  - excluded-capacity rendering:
    - no cross-sprint stretch,
    - bottom-stacked rows,
    - gray visual style.

## Rollout Plan
1. Ship Phase 1 behind feature flag (draft-only).
2. Validate usage with selected teams.
3. Enable Phase 2 publish with dry-run default.
4. Enable Phase 3 rollback/history once publish is stable.
