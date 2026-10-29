# Planning Assignee Capacity Table (#323)

> **Status:** Draft design (2026-10-29), reviewed by a cold-read builder check; awaiting operator approval. Nothing is implemented. Branch `feature/323-planning-assignee-capacity-table`.

## Intent

Planners compare what a team can deliver with what the Sprint actually holds. Today Planning shows only a team-level Jira capacity number. With one team selected, the planner also needs the per-person picture: who has how much capacity, who is on vacation, how much work each person carries in total, and how much of it has been taken (checked) into the plan.

Issue: [#323](https://github.com/Juce-me/jira-execution-planner/issues/323). All numbers are Story Points. **Who it is for.** The team lead plans the team's effort for a Sprint. This table, the capacity graph and the underbar form one dashboard for that team: how much capacity each person has, how much work each carries, how much has been taken into the plan, and how much work still has no owner. Anti-goal: a second source of truth for team capacity; Jira capacity stays the core number.

## Behaviour

### Where it shows

Exactly one team selected (`!isAllTeamsSelected && selectedTeamSet.size === 1`, dashboard.jsx). The table fills the `teams` slot of `PlanningOverviewPanel` (`.planning-panel-team-details`, hidden when the panel is compact). With several teams or All Teams, `PlanningTeamCapacityCards` is unchanged.

### Columns

Assignee, Capacity, Selected effort, Total effort, Vacations, Notes. There is no Total/available column.

- **Capacity, Vacations, Notes:** typed in; numbers are Story Points, 0 to 10 000, at most two decimals; Notes at most 500 characters. Blank means unset, which counts as 0 in sums.
- **Selected effort:** sum of Story Points of the checked Planning Stories assigned to that person (`selectedPlanningTasksList`). Null Story Points count as 0.
- **Total effort:** sum of Story Points of every non-Killed Story of the selected team in the Sprint assigned to that person, independent of Planning filters and checkboxes. Source: the unfiltered Sprint task set (`capacityTasks` or `scopedTasks`; Task 0 decides which, because the selection pool `baseFilteredTasks` drops filtered and closed work).
- **Unassigned row:** Stories with no assignee get their own row, effort columns only, so the columns reconcile with the table below. It is highlighted with the existing warning tone (a reused class, not a new one) and sorts first, so the lead sees at once how many Story Points still need an owner. It is shown only while unassigned Stories exist, and it cannot be edited or deleted.
- **Totals row:** sums of all five numeric columns. A subtle over-capacity cue on a row or the totals row where Selected effort exceeds Capacity.

### Rows and inheritance

- A row exists for each assignee that has Stories in this team and Sprint, plus saved rows added by hand. Rows are keyed on the Jira account id; the display name is a stored snapshot used only when no Story supplies one.
- **One row per person.** Rows are merged by assignee key from three sources: Stories in scope, saved rows of this Sprint and inherited rows. Inheritance never creates a second row: an own row replaces the inherited one, a person with Stories and an inherited row appears once, and Add assignee skips (and scrolls to) a person who already has a row. Inherited rows are returned by the read and shown; they are not copied into this Sprint until the user edits one.
- **Add assignee** uses the existing inline person-field search used for Planning assignee editing (Task 0 locates it), so a new row always has an account id. **Remove** takes a row out of this Sprint. A removed row is not hidden silently: it moves to a one-line strip under the table with a sad face, "Removed from this Sprint: name, name", and each name restores the row with one tap. The strip is absent when nothing is removed. A person who still has Stories in scope never shows as removed (their row stays, with blank Capacity).
- **Inheritance (non-closed Sprints only):** for every assignee without an own row, the server returns the assignee and Capacity from the nearest earlier Sprint that has saved rows for this team (`sprint_order`, as in the review views). Inherited Capacity renders gray. Editing it saves an own row for this Sprint and the value turns black. Vacations and Notes are not inherited (my call: they are Sprint-specific). Inherited values count in sums. Closed Sprints show only their own rows.

### Saving and undo

- Each edit saves when the field commits (Enter or blur; Escape cancels). One PATCH per change, with the row's base revision. A 409 shows the current value, keeps the user's losing draft in the cell and reports the conflict. A 401 triggers the existing terminal sign-in lock.
- **Undo:** a client-side stack of inverse changes (up to 50, this table, this page session). Cmd/Ctrl+Z undoes the last change while focus is inside the table and no text field is mid-edit (a field being edited keeps native text undo). A visible Undo control in the table header does the same for touch (named distinctly from the existing selection Undo). An undo is an ordinary save against the current revision; if the row changed since, it fails with the normal conflict message and drops that entry. Undo of a removal restores the row; undo of an add removes it.

### Capacity graph and underbar

The existing capacity bar keeps reading Jira capacity. Under it sits a thin bar split into one segment per assignee, width proportional to that assignee's Capacity against the team number (Jira, else planned). Unassigned work has its own segment after the assignees, hatched in the same warning tone as the Unassigned row and sized by the unassigned Total effort, so the lead sees how many Story Points still have to be given to someone; its readout shows unassigned Total and Selected effort. The unallocated remainder shows as empty track; anything beyond the team number overflows with the existing over-scale treatment. Each assignee has one stable colour from one resolver, used by the segment and a swatch in the table row (`resolveProjectTrackColor` style, using `hashTeamId` and `RADAR_PALETTE`; Task 0 confirms reuse versus a sibling `resolveAssigneeColor` in the same module). Hover readouts are in-app (no native `title`), sized to content. Segments reuse `.capacity-bar-track`.

### Team planned capacity and Jira sync

- A team-level **planned capacity** (Story Points, per team and Sprint) is stored in the app database and edited from the team capacity card shown above the table. My call: with one team selected the table does not replace the card; the card stays as the header strip and keeps the Jira number, the editor, the "Jira capacity issues have not been created yet" banner and Refresh capacity. The card's team-level display is Jira capacity when a ticket exists, otherwise the planned number labelled "Planned".
- When a Jira capacity ticket exists and the planned number differs, the card offers an explicit **Push planned to Jira** action. It runs through the existing capacity editor and `PATCH /api/capacity/<issue_key>`: the signed-in user's OAuth, the existing write-scope and configuration gates, expected-value conflict handling. It is never automatic. The planned number is kept after a push.
- No new Jira write path: the push extends the existing `jira-team-capacity-write` registry entry in `docs/design-system.md`.

## Data model

Names avoid the existing `GET /api/planned-capacity` alias.

- `planning_assignee_capacity_rows`: `id` Uuid, `workspace_id` FK CASCADE, `sprint_id`, `sprint_order` (128-digit padded as in `GroupSprintReviewView`), `team_id`, `assignee_key` (account id), `display_name`, `capacity` Numeric(9,2) null, `vacations` Numeric(9,2) null, `notes` String(500) null, `removed` bool (the row was taken out of this Sprint; inheritance and saved values are suppressed, and the UI lists it in the removed strip), `revision` int >= 1, timestamps. Unique on (workspace_id, sprint_id, team_id, assignee_key).
- `planning_team_planned_capacity`: `workspace_id`, `sprint_id`, `team_id`, `planned_capacity` Numeric(9,2), `revision`; unique on the same three.
- Scope decision (my call): keyed by workspace + Sprint + Team, not Department group. Jira capacity is per team and Sprint, and a team in two groups must not hold two diverging tables. The group-id reattachment hazard in the review store does not arise. This is shared workspace data: any signed-in user reads and writes; no user columns.
- Alembic revision `20261029_0022`, `down_revision = '20261028_0021'`, precedent `20261020_0019_group_review_columns.py`.
- Bounds: at most 200 rows per team and Sprint; request body at most 64 KiB; Sprint, team and assignee ids at most 128 characters.

## API

All under `/api/eng/sprints/<sprint_id>/assignee-capacity`, `no-store`.

- `GET ?teamId=`: own rows, inherited rows (with `inheritedFromSprintId`), planned capacity, revisions. Policy `authenticated_read`.
- `PATCH`: body `{teamId, changes: [{assigneeKey, displayName, capacity?, vacations?, notes?, removed?, baseRevision}], planned?: {value, baseRevision}}`. Policy `user_write` (`X-CSRF-Token` plus `X-Requested-With`). 409 carries `code` and the current rows. Identity from `RequestAuthContext` only; browser-supplied workspace or user is rejected. Per-row revisions let disjoint rows save concurrently; a row fence serialises writers per (workspace, team, Sprint).
- Register both routes in `backend/security/policy.py`, `tests/endpoint_security_samples.py`; update `backend/security/CONFIGURATION_OWNERSHIP.md` with a new matrix row (shared per workspace + Sprint + Team; the read and write policies above; Team is part of the key). Keep it out of `workspace_dashboard_configs` and `shared_capacity_config`.

## Files

Backend, new: `backend/services/assignee_capacity.py`, `backend/routes/assignee_capacity_routes.py`, models in `backend/db/models.py`, the migration. Frontend, new: `eng/PlanningAssigneeCapacityTable.jsx`, `eng/PlanningAssigneeCapacityBar.jsx`, `eng/usePlanningAssigneeCapacity.js` (state, autosave, undo stack), `eng/planningAssigneeCapacityModel.js` (effort sums, merge of own and inherited rows), `api/assigneeCapacityApi.js`, `styles/planning/assignee-capacity.css`. Existing, edited minimally: `dashboard.jsx` (slot wiring only; its `lineCeiling` is exactly its size, so a raise is likely), `PlanningTeamCapacityCards.jsx` (planned number, Push action), `PlanningOverviewPanel.jsx` only if the slot needs a second child. Register new owner modules in `scripts/extraction_lint/owner_budgets.json` (`ceil(lines * 1.10 / 10) * 10`).

## Reuse

Table inputs follow the `planning-review-input` held-row and Enter/Escape/blur pattern (`PlanningReviewTable.jsx`, `createPlanningSprintReviewController`). Buttons use `planning-action-button`; numeric cells align right and text left (existing Planning table rules). Every new element kind is looked up in `docs/design-system.md` first; a new class for an existing kind is a review-stop, and new classes are registered in the design-system map and ratchet allowlist.

## Tasks

0. **Verify assumptions before code.** (a) The Planning task payload carries the assignee account id (`shape_jira_person` in `jira_server.py` has it; confirm the `/api/tasks` path does, else add it to the shaped fields). (b) Which task set gives Total effort with Planning filters ignored and Killed excluded. (c) Locate the inline assignee picker. (d) Run the `GATE-*` sweep per `docs/plans/AGENTS.md` and read `CONFIGURATION_OWNERSHIP.md`. Output: findings in this plan.
1. **Migration, models, service** with inheritance (one row per person), removal, bounds, revisions. Tests: service, migration offline SQL, PostgreSQL concurrency (`tests/test_sprint_review*.py` as templates).
2. **Routes and policy.** Tests: two users in one workspace, two workspaces, 401, CSRF, 409, size limits, endpoint inventory and security matrix.
3. **Client model and API**, pure functions first (effort sums, merge, over-capacity, undo inversion), Node tests.
4. **Table UI and autosave/undo hook**, one-team gating, add, remove and restore rows (removed strip with the sad face), the highlighted Unassigned row, gray inherited values.
5. **Underbar and colour resolver,** including the hatched Unassigned segment.
6. **Card changes:** planned capacity and Push to Jira.
7. **Docs and analytics:** `docs/features/planning-sprint-review.md`, `docs/ontology.md` (new entries, verification dates), `docs/design-system.md`, `docs/README_ANALYTICS.md` (typed `workflow_action` for the Jira push; the table edits are allowlisted no-event rows because they carry user text; no values, names or keys in params), `docs/plans/README.md` entry.
8. **Verification gate.** `npm run build`, full Python and Node suites, structure budgets, and Playwright for the table, underbar and card. Element-level assertions for every control kind in the table (inputs, add, remove and Restore, Undo, swatches, Unassigned row and segment) plus headed Firefox and WebKit checks for hover and glyph geometry. Screenshots at a settled state, with and without gray values. Verify a real one-team journey in the running app on a non-5050 port.

## Verification (acceptance)

1. One team selected shows the table; two teams or All shows the old cards.
2. Selected effort equals the sum of checked Stories per assignee; Total effort equals all non-Killed Stories regardless of filters; the Unassigned row balances the totals.
3. A Future Sprint opens pre-filled with the nearest earlier Sprint's assignees and gray Capacity; editing turns it black and persists across reload and for a second user; deleting an inherited row keeps it gone.
4. Cmd/Ctrl+Z and the Undo control revert the last edit, including removal and add; a stale undo reports a conflict.
5. Two users editing different rows both save; the same cell yields a 409 that keeps the loser's draft.
6. The underbar segments match Capacity and colours match the row swatches.
7. Planned capacity shows as "Planned" with no Jira ticket and pushes to Jira only on the explicit action.

## Definition of Done

The feature is done only when every item below is true and evidenced by a command output, test name or screenshot recorded in this plan's execution log.

**Behaviour**
1. Acceptance items 1 to 7 above hold in the running app on a non-5050 port, in a one-team journey: open Planning, select one team, edit Capacity, Vacations and Notes, check Stories, reload, and confirm persistence and a second user's view.
2. No person ever appears twice: an inherited row, a saved row and a person with Stories merge into one row; Add assignee refuses an existing person; verified by a model test and a UI test.
3. Unassigned work has its own highlighted row and its own hatched underbar segment, and its Story Points equal the Stories with no assignee; the effort columns reconcile with the Stories table below.
4. Removed rows appear in the removed strip with the sad face and restore with one tap; undo restores a removal.
5. The team lead can read, from the one view, per-person Capacity, Vacations, Selected and Total effort, unassigned Story Points and the team number (Jira or planned), without opening Settings or another view.

**Quality**
6. Backend: service, route, migration (offline SQL and PostgreSQL), endpoint policy inventory and security matrix tests pass, including two users in one workspace, two workspaces, 401, CSRF, 409 and size limits.
7. Frontend: `npm run build`, the full Node suite, `python3 -m unittest discover -s tests` (including `tests.test_codebase_structure_budgets` and `tests.test_agents_md_learnings`) and the full Chromium `tests/ui` run pass; baseline failures, if any, are explained per the repository rule before being accepted.
8. UI geometry: element-level Playwright assertions for every control kind in the table and underbar, headed Firefox and WebKit checks for hover and glyph geometry, and settled screenshots with and without gray values, with the Unassigned row and with the removed strip.
9. Touch: every action (edit, add, remove, restore, Undo) works by tap; none needs dragging or a keyboard shortcut.
10. The Jira push is the only Jira write, goes through the existing capacity editor under the signed-in user's OAuth, and has its `docs/design-system.md` registry entry and call-site pin; a negative test proves no other path writes to Jira.

**Documentation and hygiene**
11. Updated: `docs/features/planning-sprint-review.md`, `docs/ontology.md` (new entries, verification dates), `docs/design-system.md`, `docs/README_ANALYTICS.md` (typed events or No-Event Allowlist rows; no values, names, keys or notes in params), `backend/security/CONFIGURATION_OWNERSHIP.md`, `docs/plans/README.md`, and `owner_budgets.json` ceilings re-synced where needed.
12. This plan has its Outcome, Current Accuracy and execution log filled in and is renamed to `DONE-` with its README entry and links updated in the completing commit.
13. The branch has a clean, scoped history checked through the publication transaction in `AGENTS.md` section 10; push and PR happen only on the operator's explicit confirmation.

## Decisions taken by the operator

Storage in the app database; Capacity, Vacations and Notes user-entered, Notes per assignee; Story Points everywhere; Selected effort and Total effort as separate columns; Future Sprint inherits assignees and Capacity, shown gray; Jira capacity stays the core number, with a stored planned capacity and an explicit sync; edits save on commit; Undo.

## Details settled after the builder check

Operator-confirmed: planned capacity is a typed-in team number, independent of the assignee rows (the operator asked for team-level planned capacity entry); the underbar shows Capacity.

My calls, to be checked when reading:

1. **Planned versus assignee sum.** Nothing is derived. The underbar shows allocation against the team number (Jira, else planned); the gap or overflow is the comparison. With neither number set there is no denominator, so no underbar renders.
2. **Push to Jira.** It sends the planned number as `capacity` with `expectedCapacity` set to the Jira value the card last read, exactly as the card editor does today. If Jira changed meanwhile, the existing `jira_capacity_update_conflict` message appears and nothing is written. It is offered only where the card editor is already allowed (OAuth, write grant, verified configuration, unique capacity ticket). The call site is the existing editor path; Task 7 extends the existing registry entry and call-site pin before any code.
3. **Add assignee.** Any Jira user the person search returns may be added (the team's membership list is not available to this table); the row is keyed by team, so it never leaks to another team.
4. **Sprint state and order.** The client knows Sprint state and sends `inherit=true` only for active and future Sprints. The server derives `sprint_order` from the numeric Sprint id, so a Sprint with no saved rows still has an order and no Jira call is made on GET. The lookup is one indexed query.
5. **Removed rows.** (My reading of "tombstone is too grimy, make a sad face": removed rows are shown, not hidden.) Removal suppresses inherited and saved values for that assignee in this Sprint, and the row appears in the removed strip with a sad face and a Restore tap. An assignee who has Stories always appears in the table (blank Capacity), so the effort columns still reconcile with the Unassigned row.
6. **Inheritance source.** One source Sprint: the nearest earlier Sprint that has any rows for this team. From it, every non-removed assignee is inherited, even if their Capacity is blank, and an assignee with no current work still shows. A row removed in the source Sprint is not inherited.
7. **Blank and inherited numbers.** Inherited Capacity counts in totals and the underbar. A row with blank Capacity gets no over-capacity cue. Vacations may exceed Capacity; negative values are rejected.
8. **Team attribution of Stories.** Total and Selected effort use the Stories Planning already scopes to the selected team (its existing team matching). A person from another team who holds a scoped Story gets a row with blank Capacity.
9. **Key by workspace + Sprint + Team**, not Department group. Vacations and Notes are not inherited. The team card stays above the table as the home of the planned-capacity editor and the Jira push.
