# Team Lifecycle And Historical Statistics

Status: planned
Type: feature

## Outcome

Approved design awaiting an implementation plan. No application behavior has changed yet.

## Problem

Departments retain configured Jira Teams after those Teams have been renamed or archived. Jira
often exposes archived Team names with an `[ARCHIVED]` prefix. Because a Department's current
`teamIds` list is authoritative for dropdowns and Jira requests, these former Teams add noise to
current and future scopes and cause unnecessary Jira work. Removing them outright would lose the
membership needed to interpret earlier quarters.

The product also repeatedly obtains sprint-scoped Statistics data from Jira. Completed-sprint
aggregates should be reusable by everyone attached to the same configured Jira entity without
publishing issue-level or person-level Jira data across authorization boundaries.

## Goals

- Represent Team participation as a sprint-effective relationship with a Department.
- Keep current and future Department controls and requests free of archived Teams.
- Preserve archived Team participation when a historical sprint is selected.
- Lazily migrate already-selected `[ARCHIVED]` Teams when their configured Department is next
  edited.
- Infer the archived membership's first and last participating sprints from Jira, while allowing
  the user to correct the inference before saving.
- Persist reusable, non-identifying, workspace-shared aggregates for the sprint-scoped Statistics
  views.
- Keep Jira issue facts within the authorization context that fetched them.
- Define the Team lifecycle ontology canonically and require future agents to preserve it.

## Non-goals

- Automatically mutating configuration when Settings or a Department is merely read.
- Migrating unused Team catalog entries or creating Department memberships for them.
- Treating `[ARCHIVED]` as the lifecycle source of truth after migration.
- Sharing issue keys, Epic keys, summaries, URLs, descriptions, comments, changelogs, or assignee
  identities through workspace aggregate storage.
- Persisting Burndown or Lead Times data in the first implementation. Those views use changelog and
  cross-quarter datasets that do not fit the sprint/team aggregate contract.
- Introducing a service-account statistics ingestion system.

## Chosen approach

Use a lazy draft migration. Only the configured Department the user edits is inspected. Detection
is read-only, the inferred lifecycle change is staged in the existing Department draft, and the
normal Save action persists it with the established revision and conflict protections.

This is preferred over a configuration-read migration, which would make reads mutate shared state,
and over UI-only hiding, which could not restore historical scope or consistently reduce backend
requests.

## Domain ontology

The canonical ontology in `docs/DOMAIN_ONTOLOGY.md` must define these concepts:

- **Team** is a stable Jira entity keyed by Jira Team ID. The workspace Team catalog owns its
  current display name. Renaming a Team does not create a new Team identity.
- **Department Team Membership** is the relationship between one Department and one Team. The
  relationship, not the Team catalog entity, owns sprint-effective lifecycle fields.
- **Active Team** is the UI projection of a Department Team Membership used for current and future
  Department scope.
- **Archived Team** is the UI projection of a membership with a finite
  `activeThroughSprintId`. It is not a separate kind of Team and does not mean the Team is globally
  archived.
- The same Jira Team may be active in one Department and archived in another.
- An `[ARCHIVED]` name prefix is migration evidence only. Persisted lifecycle fields are
  authoritative after Save.

The root `AGENTS.md` must require reading `docs/DOMAIN_ONTOLOGY.md` before changing Department,
Team, sprint-scope, dropdown, Jira-query, or Statistics behavior. It must also state the invariant
that archival belongs to Department Team Membership, never to the Team catalog entity.

## Shared Department configuration

Preserve `teamIds` as the backward-compatible list of active Team IDs. Add an `archivedTeams` list
to each Department:

```json
{
  "id": "department-id",
  "name": "Department",
  "teamIds": ["active-team-id"],
  "archivedTeams": [
    {
      "teamId": "former-team-id",
      "activeFromSprintId": "first-sprint-id",
      "activeThroughSprintId": "last-sprint-id",
      "detectionSource": "jira_history",
      "archivedAt": "2026-09-07T00:00:00Z"
    }
  ]
}
```

Rules:

- A Team ID cannot appear in both `teamIds` and `archivedTeams` in the same Department.
- Missing `archivedTeams` normalizes to an empty list.
- `activeFromSprintId` and `activeThroughSprintId` must refer to known sprints, and the first sprint
  must not follow the last sprint.
- `detectionSource` distinguishes Jira-inferred and manually corrected values. Editing either
  inferred boundary changes the source to manual.
- Restoring a Team removes its archived membership and adds its ID back to `teamIds` in the draft.
- The Team remains in the workspace Team catalog throughout migration and restoration.
- Active `teamIds` retain their existing open-ended historical behavior. A former Team receives
  explicit bounds when it is archived, which removes it from later sprints without losing its
  earlier scope.

## Lazy migration flow

1. The user opens an existing Department that has persisted `teamIds`.
2. The client examines only that Department's selected Team names from the Team catalog.
3. If no selected name begins with `[ARCHIVED]`, it makes no lifecycle detection request.
4. Otherwise, one read-only endpoint receives all matching Team IDs together.
5. The backend runs one paginated Jira search for those Teams, requesting only the Team and Sprint
   fields and following Jira's `nextPageToken` / `isLast` pagination contract.
6. The backend maps issue participation to the existing quarterly sprint catalog and returns the
   earliest and latest participating sprint plus evidence of current or future work.
7. A candidate with historical work and no current or future work moves from `teamIds` to
   `archivedTeams` in the local draft. The inferred boundaries remain editable.
8. No shared state changes until the normal Department Save succeeds.

Detection is per Department membership. Opening or editing one Department never migrates a sibling
Department, even when both contain the same Team ID.

## Detection failures and conflicting evidence

- A Jira request failure keeps every candidate active and shows a retryable migration notice.
- A candidate with no historical sprint evidence stays active and requires an explicit sprint
  selection before it can be archived; the application does not invent a boundary.
- A prefixed Team with current or future work stays active and shows a warning because activity is
  stronger evidence than the display-name prefix.
- An existing `archivedTeams` record is never migrated again.
- A save conflict preserves the user's migrated draft and uses the existing Department conflict
  workflow.
- Authentication failures use the existing global same-tab authentication recovery behavior.

## Settings behavior

Active Teams retain the existing compact selected-Team control. Active-Team search excludes Team
catalog entries whose names begin with `[ARCHIVED]`, so unrelated legacy entries do not pollute the
normal add flow.

A configured Department renders a separate collapsed `Archived Teams · N` section below Active
Teams. Expanding it shows compact rows with:

- the Team name without the visual `[ARCHIVED]` prefix;
- Active from sprint;
- Active through sprint;
- inferred or manual status; and
- a Restore action.

Editing dates or restoring a Team updates only the current draft. The existing Save action commits
the change. Archived catalog entries that were never selected in the Department do not appear in
its Archived Teams section.

Import and export remain selected-Department scoped and include `archivedTeams` while preserving
the Department ID, name, sibling Departments, and shared default according to the existing import
contract.

## Effective sprint scope

Current and future Department dropdowns and Jira requests use only `teamIds`.

For a historical sprint, the effective scope is:

1. the Department's active `teamIds`; plus
2. archived memberships whose inclusive `activeFromSprintId` through `activeThroughSprintId` range
   contains the selected sprint.

Multi-sprint Statistics requests resolve the effective Team set separately for each sprint. A Team
archived after one sprint must not be sent in Jira requests for later sprints merely because the
selected Statistics range spans both.

## Statistics persistence architecture

Statistics storage has two layers.

### Authorization-partitioned facts

Minimal normalized Jira facts remain private to the authorization context that fetched them. The
partition includes workspace, user, Jira connection, sprint, Team, source configuration signature,
and schema version. These facts may contain the identifiers needed to calculate projections, but
they are never returned to another user through the shared cache.

The source configuration signature covers the selected Jira project scope, configured issue types,
and relevant Jira field mappings. Changing those inputs creates a new fact partition rather than
silently reusing incompatible data.

### Workspace-shared aggregates

Final non-identifying projections are shared within the application workspace. The application
workspace is the entity bootstrapped from the configured Jira URL and canonically identified by the
existing workspace record, using Atlassian cloud ID with normalized Jira site URL as fallback.

The aggregate partition includes:

```text
workspaceId
+ departmentId
+ sprintId
+ teamId
+ aggregationConfigSignature
+ schemaVersion
```

The aggregation signature covers the relevant Department exclusions and Ad Hoc configuration plus
the source configuration signature. Shared payloads may contain only final counts, story-point
totals, percentages, and fixed categorical buckets needed by:

- Teams;
- Priority;
- Excluded Capacity;
- Mono vs Cross; and
- Project Track Team mode and other Team-level totals.

Project Track Epic/assignee detail remains authorization-partitioned and on-demand. Burndown and
Lead Times remain outside this persistence slice.

Any authenticated workspace user may read a shared aggregate. A user with valid Jira access may
generate or explicitly refresh it. Users in another workspace cannot read or overwrite it. The
shared aggregate contract must be added to `backend/security/CONFIGURATION_OWNERSHIP.md`.

## Statistics read and refresh flow

1. Resolve effective Team IDs independently for each requested sprint.
2. Read compatible workspace aggregate partitions.
3. For missing partitions, reuse compatible private facts or fetch only the missing sprint/Team
   partitions from Jira, batched where possible.
4. Calculate the allowed projections, persist the shared aggregates, and return them.
5. Subsequent workspace users read those projections without repeating the Jira request.

Future sprint data is never snapshotted. Active sprint data is refreshable and is not final. Once
Jira marks a sprint closed, its next successful fetch creates the durable projection. Archiving a
Team does not block Department Save on a historical backfill; missing closed-sprint partitions are
filled lazily when Statistics first requests them. Explicit Refresh may replace a closed-sprint
projection to capture Jira corrections.

## Access and privacy contract

- The configured Jira site/workspace is the deliberate sharing boundary for aggregate Statistics.
- Sharing aggregates does not imply sharing the Jira issue facts used to calculate them.
- Shared payload validation rejects issue keys, Epic keys, summaries, URLs, assignee identifiers or
  names, free text, descriptions, comments, and changelog material.
- Database uniqueness and every repository query include `workspace_id`.
- An authorization-partitioned fact row includes its owning user and Jira connection and cannot be
  read through another user's context.
- Disconnecting or deleting a Jira connection invalidates or cascades its private facts without
  deleting valid workspace aggregate projections.

## Analytics impact

No new event is required. Detection and inference are passive reads, and persistence occurs through
the existing Department Settings save action. The analytics taxonomy must record this allowlist
decision. Events must not include Department IDs or names, Team IDs or names, sprint IDs or names,
inferred boundaries, Jira query text, or stored metrics.

## Documentation changes required during implementation

- Update `docs/DOMAIN_ONTOLOGY.md` with Team, Department Team Membership, Active Team, Archived
  Team, and workspace aggregate concepts.
- Update root `AGENTS.md` with the ontology reading requirement and lifecycle invariants.
- Update `backend/security/CONFIGURATION_OWNERSHIP.md` with shared aggregate and private fact
  ownership.
- Update Department workflow and Statistics feature documentation.
- Update `docs/README_ANALYTICS.md` with the no-new-event decision.

## Acceptance criteria

1. Editing a configured Department lazily identifies its already-selected `[ARCHIVED]` Teams with
   one batched, paginated Jira history request.
2. A valid candidate moves only in the local draft, receives editable first/last sprint boundaries,
   and persists only through the existing Save flow.
3. Empty, new, unopened, and sibling Departments are not migrated.
4. Current/future controls and API requests exclude archived memberships.
5. Historical controls and requests include an archived membership only inside its inclusive sprint
   range.
6. Active-Team search excludes unassigned `[ARCHIVED]` catalog noise.
7. Restoring and manually correcting an archived membership work without bypassing revision or
   conflict protections.
8. Shared aggregates for the five selected sprint-scoped Statistics views are reused by other
   authenticated users in the same workspace without a Jira refetch.
9. Cross-workspace access is impossible, and shared payloads contain no banned issue-level,
   person-level, or free-text fields.
10. The canonical ontology, ownership contract, feature docs, analytics decision, and root
    `AGENTS.md` agree with the shipped behavior.

## Verification strategy

Backend tests must cover configuration normalization, duplicate rejection, sprint boundary
validation, paginated lifecycle detection, activity-over-prefix precedence, private fact ownership,
workspace aggregate uniqueness, same-workspace sharing, cross-workspace isolation, banned-field
validation, cache misses, cache hits, refresh, and closed-versus-active sprint persistence.

Frontend unit tests must cover lazy trigger conditions, no-request conditions, draft migration,
manual correction, restore, error preservation, effective per-sprint Team resolution, search
filtering, and import/export.

Playwright tests must cover settled Active Teams plus collapsed and expanded Archived Teams states,
editable sprint controls, normal Save/Cancel/conflict behavior, and historical versus current Team
dropdown contents. Screenshots must be captured after transitions settle.

Performance verification must prove that lifecycle detection is one batched Jira query rather than
one request per Team, that multi-sprint requests omit out-of-range Teams per sprint, and that a
compatible shared aggregate hit does not contact Jira.

Run focused tests during iteration, `npm run build` after frontend changes, the complete Python and
JavaScript test suites before push, and the applicable Playwright coverage with visual inspection.

## Implementation sequencing

The implementation plan should split this design into independently verifiable slices:

1. ontology, configuration schema, and pure effective-scope helpers;
2. read-only lifecycle detection API and lazy draft migration;
3. Archived Teams Settings UI and import/export support;
4. private fact and workspace aggregate database models and repositories;
5. Statistics source integration and per-sprint effective Team routing; and
6. documentation, analytics, performance, and full regression verification.
