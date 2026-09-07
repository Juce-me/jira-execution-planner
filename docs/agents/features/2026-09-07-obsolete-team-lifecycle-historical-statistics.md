# Team Lifecycle And On-Demand Historical Statistics

Status: obsolete
Disposition: parked
Type: feature

## Outcome

Obsolete before execution. The feature is parked and must not be used as an implementation plan
without a fresh product review. No application behavior changed.

## Parking note

Dragging historical Statistics across previously archived Teams could become too complicated and
expensive: it requires lifecycle inference, historical Jira queries, access reconciliation, and
careful handling of incomplete results. That complexity is not justified for the supported product
scope.

For now, supporting up to 12 active Teams per Department/group is enough. Statistics remain live
and on demand, with no additional Statistics persistence, backfill, or archived-Team aggregation.
The 12-Team support statement records the product boundary; this parked document does not add or
change a validation limit in application code.

## Current Accuracy

Historical design context only. The lifecycle migration, Archived Teams configuration, access
probe, and loading changes below were not implemented or approved for execution. The current
direction is the Parking note above.

## Problem

Departments retain configured Jira Teams after those Teams have been renamed or archived. The
company convention marks archived Team names with an `[ARCHIVED]` prefix. Because a Department's
current `teamIds` list drives dropdowns and Jira requests, those former Teams add noise and
unnecessary Jira work in later quarters. Removing them outright would lose the Department
membership needed to interpret earlier quarters.

The initial design also proposed durable Jira facts and workspace-shared Statistics aggregates.
That would create a new data service, retention rules, database migrations, invalidation logic, and
cross-user authorization risk. This revision deliberately removes that scope: Statistics remain
live, user-authorized Jira reads with visible loading progress.

## Goals

- Move a configured Department's already-selected archived Teams into a separate Archived Teams
  section the next time that Department is edited.
- Infer one editable `lastActiveSprintId` for each candidate without searching all Jira history.
- Exclude an archived membership from every sprint after its saved boundary while preserving it in
  earlier quarters.
- Remove archived-name noise from active Team selection.
- Fetch Statistics from Jira on demand without adding facts, aggregate tables, or durable result
  caches.
- Check the current user's access to every configured Product/Tech Jira project before lifecycle or
  Statistics data is queried or rendered.
- Show honest determinate or indeterminate loading progress instead of leaving an apparently empty
  surface.
- Define the Team lifecycle ontology canonically and require future agents to preserve it.

## Non-goals

- Discovering when an active Team was created.
- Modeling multiple active/archive/reactivation periods for one Department membership.
- Searching seven years of Jira history to find an old Team's first issue.
- Automatically saving a lifecycle suggestion when Settings or a Department is opened.
- Migrating unused Team catalog entries or creating Department memberships for them.
- Adding a Statistics database schema, background ingestion service, service-account snapshot, or
  cross-user Statistics cache.
- Guaranteeing that two users receive identical totals when Jira issue-security rules give them
  different issue visibility.

## Chosen approach

Use a lazy draft migration plus on-demand Jira reads.

Only the persisted Department that the user edits is inspected. A configurable company archive
prefix identifies candidates. The application stages matching Teams in the existing Department
draft, makes a bounded Jira request to suggest the last active sprint, and uses the existing Save
action and revision conflict protections for persistence.

Statistics continue to load only when requested. The current user's existing Jira authorization
context is used for every read. The backend may reuse its existing short-lived,
authorization-partitioned process cache, but no fetched issue facts or calculated Statistics are
written to the database or browser storage.

## Domain ontology

The canonical ontology in `docs/DOMAIN_ONTOLOGY.md` must define these concepts:

- **Workspace** is the shared application entity for the configured Jira site. The existing
  workspace record uses Atlassian cloud ID, with normalized configured Jira URL as fallback.
- **Team** is a stable Jira entity keyed by Jira Team ID. The workspace Team catalog owns its
  current display name. Renaming a Team does not create a new Team identity, and this feature does
  not reconstruct historical Team names.
- **Department Team Membership** is the relationship between one Department and one Team. The
  relationship, not the Team catalog entity, owns lifecycle state.
- **Active Team** is the UI projection of a membership stored in `teamIds`. It has no tracked start
  date or end date.
- **Archived Team** is the UI projection of a membership stored in `archivedTeams` with one
  inclusive `lastActiveSprintId`. It is not a separate Team type and does not mean that the Team is
  globally archived.
- The same Jira Team may be active in one Department and archived in another.
- The admin-owned archive-name prefix detects unsaved migration candidates. After Save, the
  membership's persisted location and boundary are authoritative.

This deliberately asymmetric model does not know when an active Team was created. An active Team
may therefore remain available in an old-quarter selector even when Jira returns no work for it.
That limitation is accepted to avoid expensive historical discovery and multiple lifecycle
periods.

The root `AGENTS.md` must require reading `docs/DOMAIN_ONTOLOGY.md` before changing Department,
Team, sprint-scope, dropdown, Jira-query, or Statistics behavior. It must also state that lifecycle
belongs to Department Team Membership, never to the Team catalog entity.

## Configuration contracts

### Admin-owned archive convention

Add one workspace administrator setting:

```json
{
  "teamLifecycle": {
    "archivedNamePrefix": "[ARCHIVED]"
  }
}
```

Rules:

- Missing configuration uses `[ARCHIVED]` as the default.
- Matching is case-insensitive after leading whitespace is ignored.
- The value is a literal prefix, not a regular expression. This avoids invalid expressions and
  denial-of-service-prone patterns.
- An empty prefix is invalid because it would classify every Team as a candidate.
- The setting is shared once per workspace and editable only through the existing workspace-admin
  configuration gate.
- Changing the setting affects future candidate detection and active-Team search. It does not
  rewrite already-saved Department memberships.

Place the compact control with the existing Jira Team field administration rather than adding it
to every Department editor.

### Department membership payload

Preserve `teamIds` as the backward-compatible list of active Team IDs. Add the smallest necessary
`archivedTeams` record to each Department:

```json
{
  "id": "department-id",
  "name": "Department",
  "teamIds": ["active-team-id"],
  "archivedTeams": [
    {
      "teamId": "former-team-id",
      "lastActiveSprintId": "last-participating-sprint-id"
    }
  ]
}
```

Rules:

- A Team ID cannot appear in both lists or appear twice in either list.
- Missing `archivedTeams` normalizes to an empty list.
- `lastActiveSprintId` is required before Save. The backend validates a non-empty scalar ID; the
  editor and inference endpoint accept a new value only from the current ordered sprint catalog.
- Restoring a Team removes its archived record and adds its ID back to `teamIds` in the draft. It
  does not create a second lifecycle period.
- The Team remains in the workspace Team catalog throughout migration and restoration.
- No detection source, archive timestamp, first-active sprint, or name snapshot is stored. The
  shared configuration row already supplies update revision, actor, and timestamp metadata.

This is an existing JSON-payload extension, not a database-table change. Readers accept version 1
payloads and normalize missing `archivedTeams` in memory. Writers emit group payload version 2.
`GROUPS_CONFIG_VERSION` and `GROUPS_PAYLOAD_VERSION` must remain aligned. The backend normalizer
must be updated before the frontend can round-trip the field, because it currently reconstructs a
fixed allowlist of Department keys.

## Lazy migration and bounded inference

The migration runs only when the user opens the editor for a Department that already exists in the
persisted configuration. It does not run for a new draft, an empty Department, an unopened
Department, or a sibling Department.

1. Resolve the current admin-configured archive prefix.
2. Compare it only with the edited Department's selected `teamIds` using current Team catalog
   names.
3. Move matching Teams into the local Archived Teams draft immediately. No shared state changes.
4. Before requesting Jira evidence, run the all-configured-project access gate described below.
5. In one bounded lifecycle operation, query all unresolved candidate Team IDs against:
   - the current and known future sprints; and
   - at most the eight most recent completed quarterly sprints.
6. Request only the configured Team and Sprint fields and follow Jira's `nextPageToken` / `isLast`
   pagination contract. Do not make one Jira request per Team.
7. Suggest the latest observed sprint, including current or future activity when it exists, as
   `lastActiveSprintId`.
8. If no activity is found in the bounded window, leave the field empty and require the user to
   select the last active sprint manually. Do not automatically scan older Jira history.
9. The normal Department Save confirms and persists all resolved draft moves.

The eight-completed-quarter bound limits Jira fan-out and corresponds to two years of recent
history. Older Teams remain configurable because manual selection uses the existing sprint catalog.
This fixed product bound is intentionally not another setting.

An existing `archivedTeams` record is never re-inferred on edit. The user may change its last active
sprint manually. A later archive-prefix change also leaves it untouched.

## Detection and save failures

- A Jira failure preserves the staged Archived Teams rows, leaves unresolved sprint fields empty,
  and offers Retry or manual selection. It never silently chooses a boundary.
- If current or future work is observed, the latest such sprint is visibly suggested. The user may
  correct it before Save; the prefix does not hide real work inside the saved boundary.
- Save remains disabled while any archived record lacks a valid last active sprint.
- Cancel discards every suggested move and boundary.
- A save conflict preserves the user's draft and uses the existing Department conflict workflow.
- Authentication failures use the existing terminal same-tab authentication recovery behavior.
- A project-access failure renders the access-required state described below and performs no
  lifecycle or Statistics data query.

## Project-access and privacy gate

Before lifecycle inference or a Statistics view shows Jira-derived data, resolve every project in
the workspace admin `projects.selected` configuration whose type is Product or Tech.

- In per-user OAuth mode, every configured key must have an `accessible` status for the current Jira
  connection. One accessible project of a type is not sufficient.
- Reuse the existing `jira_project_access` snapshots. The current code has no lightweight exact-key
  revalidator, so add one bounded current-user project-catalog probe for missing or `unknown` keys
  and update the existing snapshots before the data query. Do not infer access from an empty issue
  search result and do not fetch issue data merely to test access. The same request must use the
  probe result directly rather than continuing with the stale context snapshot loaded before the
  update.
- If any key is `inaccessible`, remains `unknown`, or the probe fails, fail closed with the existing
  `missing_project_access` recovery contract plus the unresolved project keys. Show no partial or
  previously loaded Statistics.
- In Basic/service-account mode, the configured workspace Jira credential remains the single
  authorization context and follows the existing Basic-mode gate.
- Empty Product/Tech project configuration is a configuration-required state, not permission to
  query all Jira projects.

The strict helper applies to every configured Product/Tech project included by the pending Jira
query. Combined lifecycle and Statistics queries therefore require all selected Product/Tech
projects. Existing Product-only or Tech-only views keep their narrower per-view access behavior;
this feature must not turn unrelated partial-access views into a global all-or-nothing dashboard.
Run this gate before consulting browser or backend Statistics caches so a cached payload cannot
bypass the current request's access decision.

No fetched lifecycle evidence, Jira issue facts, or calculated Statistics are shared between user
connections. Jira responses and UI-derived totals remain scoped to the authorization context that
requested them.

Project access is necessary but not sufficient for identical cross-user totals: Jira issue-level
security may still give two project members different issue visibility. The UI must therefore say
“Based on Jira items visible to your account” in Statistics help/error context and must not claim
workspace-wide snapshot consistency. Exact identical totals would require the shared snapshot or
service-account design that is explicitly out of scope.

## Settings behavior

Active Teams retain the existing compact selected-Team interaction. Active-Team search excludes
catalog entries matching the configured archive prefix so unrelated archived entries do not
pollute the normal add flow.

The edited Department renders a separate `Archived Teams · N` section below Active Teams. It is
collapsed when unchanged and automatically expands when lazy migration stages candidates. Its
banner says: “Found N Teams matching the archived prefix. Review Last active sprint before Save.”

Each compact row shows:

- the current Team name with the visual archive prefix removed;
- one `Last active sprint` selector;
- an `Inferred` or `Needs selection` draft status; and
- `Return to Active Teams`.

Helper text says: “Archived for this Department; the Jira Team is not deleted.” The Save summary
states how many Teams will move. Import and export remain selected-Department scoped and include
`archivedTeams` without changing sibling Departments or the shared default.

## Effective sprint scope

For each selected sprint, the effective Department Team set is:

1. every Team in `teamIds`; plus
2. each archived membership whose selected sprint is not later than its inclusive
   `lastActiveSprintId`.

There is intentionally no lower bound for either kind of membership. For a current or future
sprint, an archived membership appears only if the user explicitly saved a boundary at or after
that sprint.

Dropdowns and Jira requests must use this same pure resolver. Sprint order comes from the catalog's
quarter/date ordering, never lexical comparison of opaque sprint IDs. A saved boundary that is
temporarily absent from the catalog is preserved and shown as needing repair; it is never silently
converted back to active. Multi-sprint Statistics resolve the effective Team IDs independently for
every sprint, so a Team is not sent in later requests merely because the range also includes its
last active sprint. In historical Team controls, archived memberships are labelled `Former Team`
to explain why they are available.

An explicitly resolved empty Team set means zero Teams. The client must skip the Jira request and
produce an empty result for that sprint. It must never send `teamIds: []` to an endpoint where the
existing meaning is “remove the Team filter,” because that would expand a Department-scoped request
to all Teams.

## On-demand Statistics and loading states

Do not add Statistics tables, fact repositories, aggregate repositories, browser persistence,
scheduled jobs, or backfills. Each Statistics range is requested when the user opens or refreshes
it, using the current user's authorization context and the per-sprint effective Team set. Existing
page-session memory and the existing short-lived authorization-partitioned backend process cache
may deduplicate compatible requests. Neither is durable or shared across authorization contexts,
and explicit Refresh bypasses the existing cache.

The current progressive per-sprint Statistics source already exposes loaded and total sprint
counts. Make that progress visible:

- Start with `Checking Jira project access…` while the strict access gate runs.
- During a range load, show a determinate progress bar and text such as `Loading sprint 3 of 8…`.
- Keep the Statistics region `aria-busy="true"`; expose status changes through an accessible live
  region.
- Render progressive results only after the access gate has passed. Mark them as incomplete until
  all sprint requests settle.
- If some sprint requests fail, keep successful results, show `Loaded 6 of 8; 2 failed`, and offer
  Retry. If access or authentication fails, clear all results instead of showing a partial set.
- Refresh repeats the live Jira requests; it does not invalidate or overwrite persistent data.

Lifecycle inference is one bounded paginated HTTP operation and does not expose reliable page
totals to the client. Show an indeterminate bar with `Checking archived Team history in Jira…` and,
after a delay, `Still checking Jira; you can select a sprint manually.` Do not display a fabricated
percentage and do not introduce a background-job API solely to report progress.

## Database and regression safety

- Add no database models, migrations, Statistics rows, lifecycle-evidence rows, or cleanup jobs.
- Extend only the existing workspace group JSON payload and existing workspace admin JSON payload.
- Preserve `workspace_group_configs` revision checks and all-or-nothing Settings Save behavior.
- Reject duplicate active/archived Team IDs and unknown properties in archived Team records
  server-side. Do not reject a stable Team ID merely because a transient catalog refresh omitted
  it.
- Preserve version 1 reads, JSON-file fallback, import/export, empty `teamIds`, Department board,
  labels, exclusions, Ad Hoc capacity, user favorites, visibility, and active-group preferences.
- Never let an older normalizer silently drop `archivedTeams`; add explicit round-trip regression
  tests before enabling frontend Save.
- Do not change `jira_project_access` schema. Add the exact-key revalidation path and a strict
  all-referenced-project helper without weakening existing route-specific partial-access behavior.

## Analytics impact

No new event is required. Detection and inference are passive reads, loading progress is a status
presentation, and persistence occurs through the existing Department Settings Save action. Record
this allowlist decision in `docs/README_ANALYTICS.md`. Existing API-result events must not add
Department IDs or names, Team IDs or names, sprint IDs or names, Jira query text, project keys, or
inferred boundaries.

## Documentation changes required during implementation

- Update `docs/DOMAIN_ONTOLOGY.md` with Workspace, Team, Department Team Membership, Active Team,
  Archived Team, and the accepted no-start-date limitation.
- Update root `AGENTS.md` with the ontology reading requirement and membership lifecycle invariant.
- Update `backend/security/CONFIGURATION_OWNERSHIP.md` with the admin-owned archive prefix and the
  existing shared Department ownership of archived memberships. Do not add Statistics ownership.
- Update Department workflow and Statistics feature documentation.
- Update `docs/README_ANALYTICS.md` with the no-new-event decision.

## Files allowed during implementation

The implementation plan may touch only the relevant existing files in these areas, plus focused
tests and generated frontend output:

- root `AGENTS.md` and the documentation named above;
- `backend/services/group_config.py`, `backend/services/shared_group_config.py`, and shared admin
  configuration validation/routes;
- the existing project-access helper and only the lifecycle/Statistics routes that consume it;
- Department Settings, Team/sprint selection helpers, and Statistics loading components under
  `frontend/src/`;
- `jira_server.py` only where the existing monolith still owns the required route/config bridge;
- focused Python, JavaScript, and Playwright tests.

No new persistence subsystem, migration file, background worker, or service directory is allowed.

## Acceptance criteria

1. Opening one persisted Department editor stages only that Department's selected Teams whose
   current names match the admin-configured archive prefix.
2. The default prefix is `[ARCHIVED]`; only workspace admins may change it, and the value is treated
   as a literal case-insensitive prefix.
3. Inference queries at most current/future plus eight completed quarterly sprints, batches
   candidate Teams, and never scans older history automatically.
4. Every staged archived Team has an editable last-active sprint; unresolved rows block Save and
   support manual selection.
5. New, empty, unopened, and sibling Departments are not migrated. Cancel writes nothing.
6. Current, future, and historical dropdowns and Jira requests all use the same per-sprint effective
   Team resolver.
7. Active-Team search hides unselected catalog entries matching the archive prefix; archived rows
   stay visible only in the separate Department section and eligible historical scopes.
8. Version 1 group payloads load without mutation, version 2 round-trips `archivedTeams`, and no
   existing Department fields or user preferences are lost.
9. Before any lifecycle or Statistics data query, the current authorization context has confirmed
   access to every configured Product/Tech project included by that query; combined queries require
   all selected projects, and failures show no partial data.
10. Statistics make on-demand Jira requests, create no durable result data, and show accessible
    determinate per-sprint progress. Lifecycle inference shows an honest indeterminate state.
11. Statistics disclose that results reflect the Jira items visible to the current account and do
    not claim identical cross-user totals.
12. The canonical ontology, ownership contract, feature docs, analytics decision, and root
    `AGENTS.md` agree with the shipped behavior.
13. A sprint with no effective Teams makes no Jira issue request and can never expand to the
    endpoint's legacy unfiltered `teamIds: []` behavior.

## Verification strategy

Backend tests must cover v1-to-v2 normalization, full field round-trips, duplicate rejection,
invalid or missing boundaries, bounded/paginated inference, manual fallback, all-project access,
missing/unknown/inaccessible snapshots, Basic mode, and absence of any new persistence writes.

Frontend unit tests must cover lazy trigger conditions, configurable-prefix matching, draft moves,
inferred and unresolved boundaries, cancel, manual correction, restore, failure preservation,
effective per-sprint Team resolution, explicit empty scope, search filtering, progressive loading,
and import/export.

Playwright tests must cover settled Active Teams plus collapsed and auto-expanded Archived Teams,
last-active sprint editing, Save/Cancel/conflict behavior, historical versus current Team dropdowns,
access-required states, determinate Statistics progress, and indeterminate lifecycle progress.
Screenshots must be captured after transitions settle.

Performance verification must show that lifecycle inference is bounded and batched rather than
one request per Team, and that a multi-sprint Statistics range sends only effective Team IDs for
each sprint. Run focused tests during iteration, `npm run build` after frontend source changes, the
complete Python and JavaScript test suites before push, and applicable Playwright coverage with
visual inspection.

## Implementation sequencing

After approval, the implementation plan should use these independently verifiable slices:

1. ontology, admin prefix, group payload v2, and pure effective-scope helpers;
2. strict all-configured-project access gate and bounded read-only lifecycle inference;
3. Archived Teams Settings UI, lazy draft migration, and import/export;
4. on-demand Statistics routing plus determinate/indeterminate loading states; and
5. documentation, analytics, performance, and full regression verification.
