# ENG Story Readiness Ghosts Implementation Plan

> **Status:** Implemented and locally verified on 2026-09-16; pending acceptance or merge. The
> user's request to implement this plan as written confirmed the four product decisions below.

**Goal:** In Catch Up and Planning, render one non-Jira Story-requirement ghost per expected
Team that has no actionable Story in the selected active or future sprint, keep zero-Story Epics in
their Initiative hierarchy with a dotted whole-Epic treatment when Jira has no child Stories, put
requirement-bearing work first in Planning, make the Catch Up alert reveal the exact local ghost,
and make the ghost open its Jira Epic for Story creation.

**Design record:**
[`../agents/features/2026-09-16-executed-eng-story-readiness-ghosts-design.md`](../agents/features/2026-09-16-executed-eng-story-readiness-ghosts-design.md)

**Approved visual reference:** Variant A — Story-card echo in
[`../../frontend/src/eng/story-readiness-ghosts-prototype.html`](../../frontend/src/eng/story-readiness-ghosts-prototype.html),
canonical state `?variant=A&sprint=active&scenario=mixed&mode=catchup`.

**Architecture:** Add a progressive, scope-stamped Story Readiness read model after the primary
Story lists paint. A backend module owns complete Jira discovery, per-Team coverage, and Epic display
metadata. A pure frontend hierarchy module merges the complete snapshot with real Story groups and
returns synthetic rows that never enter the application's real Story collections.

**Tech stack:** Python 3.10+/Flask, React 19, ES modules, Node test runner, Playwright, Python
`unittest`, esbuild.

## Decision Gate

The user's 2026-09-16 request to implement this plan as written confirmed all four product decisions:

1. Show the selected target sprint on each ghost, not the Epic's persisted Jira Sprint field.
2. Alert dismissal hides only the alert, not the hierarchy ghost.
3. Active and future sprints share the current Needs Stories definition of actionable: a Team with
   only `Blocked`, `Done`, `Killed`, or `Incomplete` Stories still requires an actionable Story.
4. Ghosts appear in Catch Up and Planning while the Alerts panel remains Catch-Up-only.

If any answer changes, revise the design, acceptance criteria, tests, and this plan before further
application changes.

The user confirmed these additional UX decisions on 2026-09-16; they are fixed plan requirements,
not open gate items:

5. An Epic proven by the complete snapshot to have no child Stories at all uses a dotted outline
   around the entire Epic container. Filters cannot create this visual state.
6. Planning orders requirement-bearing work first at every visible hierarchy level: qualifying
   Initiatives before covered-only Initiatives, qualifying Epics before covered-only Epics, and
   `Story required` rows before real Story rows. The selected Epic sort is secondary within each
   partition. Catch Up ordering is unchanged.
7. Variant A — Story-card echo is the approved visual direction. Implement requirement rows as
   full-width synthetic Story-card echoes in the normal Story stream. Do not substitute Variant B's
   coverage-checklist container or Variant C's empty-slot rail/action-column layout.

## Global Constraints

- Preserve the first-screen rule from MRT010 and MRT023: primary Product/Tech Story requests paint
  before Story Readiness begins and never perform readiness distribution work.
- Do not activate `/api/missing-info`, ready-to-close, backlog, or any other Catch Up alert source in
  Planning.
- Do not model a ghost as a Jira issue or insert it into `tasks`, `visibleTasks`, `selectionTasks`,
  `capacityTasks`, dependency collections, exports, bulk targets, or edit state.
- Keep the validated one-row Epic header contract. Put target sprint and urgency inside the ghost.
- Use exact configured Team labels and stable Team ids; do not match display names or invent labels.
- Use enhanced-search `nextPageToken`/`isLast` pagination for Jira issue searches. Do not leave the
  current 250-Epic alert cap in the new readiness path.
- Fail closed on missing, partial, truncated, stale, or unauthorized data. No complete snapshot means
  no missing-story assertion.
- Keep Jira/Home/Townsquare surfaces read-only. The only outbound action is an ordinary Jira Epic
  browse link; no create/mutation endpoint is added.
- Preserve DB/OAuth workspace and user partitioning, Basic/local compatibility where the existing
  ENG task route supports it, and the global application `401` recovery contract.
- Never send issue keys, Team/sprint names, labels, Jira URLs, JQL, or reason text to analytics.
- Do not hand-edit `frontend/dist/`; rebuild it with `npm run build`.
- Do not commit, push, merge, or create a PR without a separate explicit publication request.

## Endpoint Contract Matrix

| Field | Contract |
| --- | --- |
| Route | `GET /api/eng/story-readiness` |
| Query | Required `sprint`, `sprintName`, `sprintState=active|future`, `groupId`; optional `refresh=true|false`; the server resolves the sprint id from the accessible catalog and requires the supplied name/state to equal that canonical tuple; the frontend does not call the route for completed/unknown states |
| Auth | Same authenticated Jira read context as `/api/tasks-with-team-name`; DB/OAuth resolves the signed-in user's Jira OAuth context; local Basic mode uses the existing allowed Jira read adapter |
| Workspace/site boundary | Resolve `groupId` from the authenticated request's current workspace/Jira site; a foreign id is indistinguishable from missing |
| CSRF / headers | Read-only GET: no CSRF token or `X-Requested-With` requirement; global auth/session rules still apply |
| Success | `200` with `schemaVersion: 1`, exact scope stamp, `complete: true`, normalized actionable Epic records with `missingTeams`, and header-only `Server-Timing` |
| Empty | `200` with the same complete scope and `epics: []`; this is the only authoritative green/empty result |
| Malformed input | `400 invalid_story_readiness_scope` with no reflected raw values |
| Missing/foreign group | `404 story_readiness_scope_not_found` |
| Unsupported sprint state | `400 invalid_story_readiness_scope`; completed/unknown sprint states are suppressed before request and render no ghosts |
| Authentication | Existing sanitized `401` codes and global auth lock behavior; never return raw Jira/auth text |
| Authorization/project access | Check only configured project types through the existing ENG access helper. An absent snapshot defers to Jira; an explicit inaccessible/unknown snapshot returns sanitized `403 missing_project_access` |
| Configuration conflict | `409 story_readiness_configuration_invalid` for unusable field/group configuration |
| Jira/partial/pagination failure | `502 story_readiness_unavailable`; never return `complete: true` with a partial scan |
| Scope safety limit | `422 story_readiness_scope_too_large`; never truncate or cache the cohort |
| Cache | Partition by auth/workspace/site/user token version, group id/revision, sprint id/name/state, field/config revision, and Jira issue-cache generation; `refresh=true` bypasses the result cache |
| Response headers | Success and route-owned errors use `Cache-Control: private, no-store`; success also returns `Server-Timing` and `X-Story-Readiness-Cache: hit|miss` |

### Success response

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

Allowed reason values are `no_stories`, `stories_outside_sprint`,
`selected_stories_not_actionable`, and `team_uncovered`.

Route-owned errors use one sanitized body shape:

```json
{
  "error": "story_readiness_unavailable",
  "message": "Story readiness is temporarily unavailable."
}
```

The `error` value is the exact matrix code and `message` is fixed public copy. Authentication errors
delegate to the existing ENG auth response helper so the global login/recovery payload shape stays
unchanged. No error reflects query values, Jira response text, JQL, issue keys, labels, or credentials.

The fixed route-owned bodies are:

| Status | JSON body |
| --- | --- |
| 400 | `{"error":"invalid_story_readiness_scope","message":"Story readiness scope is invalid."}` |
| 404 | `{"error":"story_readiness_scope_not_found","message":"Story readiness scope was not found."}` |
| 409 | `{"error":"story_readiness_configuration_invalid","message":"Story readiness configuration is incomplete."}` |
| 422 | `{"error":"story_readiness_scope_too_large","message":"Story readiness scope is too large."}` |
| 502 | `{"error":"story_readiness_unavailable","message":"Story readiness is temporarily unavailable."}` |

For 403, reuse `project_access_denied_response()` exactly:
`{"error":"missing_project_access","message":"Your Jira account does not have confirmed access to this project view.","projectType":"product|tech","projectAccessStatus":"inaccessible|unknown","recoveryUrl":"/auth/missing-project-access"}`.
Check configured project types deterministically and report the first explicitly unavailable view.
As on existing ENG routes, an absent access snapshot is not itself a denial; the Jira request remains
authoritative and Jira failures use the sanitized `502` response. The 401 body remains owned by the
existing auth helper.

## User-visible State Machine

| State/event | Required behavior |
| --- | --- |
| Primary Stories loading | Render existing loading behavior; do not start readiness yet |
| Primary Stories ready in Catch Up/Planning | Paint real hierarchy, then start one readiness cohort for the selected group+sprint |
| Readiness pending | Keep real hierarchy interactive; no ghost and no false empty claim |
| Complete snapshot | Merge once, render zero-Story Epics/ghosts, update `stories · required` readout without changing Story totals |
| Empty complete snapshot | Render no ghosts and no readiness warning |
| Network/`502` unavailable | Keep Stories, suppress ghosts, show one nonblocking Retry state |
| `409` invalid configuration | Suppress ghosts and offer the existing Settings recovery path; do not retry automatically |
| `403` project access | Suppress ghosts and use the existing access-recovery/support UI |
| `404` stale/missing group | Reload groups once, then require a valid Department selection |
| `400` scope mismatch | Suppress ghosts, record a sanitized diagnostic, and do not retry the same request |
| `422` scope too large | Suppress ghosts and show bounded support copy; do not retry unchanged scope |
| Group/sprint/auth revision changes | Abort or ignore the previous cohort; clear its ghosts before applying the new complete scope |
| Search/facet changes | Reproject locally; no readiness refetch unless the group/sprint/auth/config scope changes |
| Alert activation | Clear only hiding list facets/search, reveal exact composite target, sticky-safe scroll, focus, highlight |
| Ghost activation | Open the parent Jira Epic in a new tab; local state and Planning selection remain unchanged |
| Alert dismissal | Remove only the alert entry for that `(group, sprint, Epic, Team)`; keep the ghost |
| Refresh | Invalidate readiness and ordinary Jira reads through their existing refresh ownership, keep stale data from crossing scope |
| Auth expired | Existing global same-tab sign-in recovery locks the app; do not replay the failed readiness request in the old document |

The route is GET-only; POST and other unsafe methods are rejected by Flask routing. Scope or config
revision changes discard the current result, while search/facet changes only reproject it. A retry
keeps the same scope stamp. A restored cache entry is accepted only after the same auth, group,
sprint, config, and issue-cache revisions match.

Dirty/save/conflict/rollback states are not applicable because this feature persists no Jira,
workspace, or preference data. Alert dismissal is session UI state only and is discarded by the
bounded pruning rules below.

## Task 0: Baseline and instruction gates

**Files:** No application edits.

- [x] Confirm the Decision Gate with the user and record the answers in the design and this plan.
- [x] Verify every path named in this plan exists or is explicitly marked `Create`.
- [x] Record exact `origin/main` and branch HEAD SHAs and confirm the branch remains based on the
      intended `origin/main`.
- [x] Re-read MRT001, MRT009, MRT010, MRT023, MRT027, and MRT028.
- [x] Run current focused baselines:
  - `.venv/bin/python -m unittest tests.test_create_stories_alert tests.test_oauth_eng_routes`
  - configured Node runtime for `tests/test_future_planning_needs_stories.js`,
    `tests/test_dashboard_alert_source_guards.js`, and `tests/test_frontend_api_source_guards.js`
  - `npx playwright test tests/ui/eng_alert_loading_order.spec.js tests/ui/eng_alerts_panel_summary.spec.js`
- [ ] Capture settled before screenshots for one active-sprint Catch Up hierarchy and one future-sprint
      Planning hierarchy using synthetic fixtures.
- [x] Capture the approved Variant A prototype states for active Catch Up and future Planning as the
      visual reference; Variant B and Variant C are comparison history only.

## Task 1: Define the backend Story Readiness module test-first

**Files:**

- Create: `backend/services/story_readiness.py`
- Create: `tests/test_story_readiness.py`

**Interface:** A pure projection accepts only a `CompleteReadinessInput` produced by the exhaustive
I/O layer:

```text
CompleteReadinessInput = {
  status: "complete",
  canonicalSprint,
  groupSnapshot,
  projectAccessSnapshot,
  epics,
  children
}
```

The I/O layer otherwise returns a typed failure and never an array that could be mistaken for an
empty result. Jira I/O and Flask stay outside this interface.

- [x] Add failing tests for active/future severity-independent domain output, multi-Team partial
      coverage, exact-label matching, raw-Team-only rejection, terminal/blocked selected-sprint Stories,
      Stories outside the sprint, no children, terminal Epic suppression, duplicate Epic keys,
      deterministic ordering, and missing Initiative degradation.
- [x] Add the deterministic reason table: no Epic children → `no_stories`; Team selected-sprint
      children but none actionable → `selected_stories_not_actionable`; Team children but none in
      selected sprint → `stories_outside_sprint`; otherwise uncovered exact-label Team →
      `team_uncovered`.
- [x] Prove one missing slot per `(Epic, Team)` and no slot for a covered Team.
- [x] Prove malformed/partial inputs cannot produce `complete: true`.
- [x] Implement the smallest pure projection and test only through its interface.
- [x] Remove superseded private classifier tests only when equivalent interface coverage exists;
      do not retain duplicate tests of implementation details.

## Task 2: Add the complete, progressive read endpoint

**Files:**

- Modify: `backend/routes/eng_routes.py`
- Modify: `jira_server.py`
- Modify: `backend/services/shared_group_config.py`
- Modify: `backend/routes/settings_routes.py`
- Modify: `backend/security/policy.py`
- Modify: `tests/test_story_readiness.py`
- Modify: `tests/test_oauth_eng_routes.py`
- Modify: `tests/test_request_performance.py`
- Modify: `tests/test_endpoint_policy_inventory.py`

- [x] Extract and reuse one read-only effective-group resolver. DB/OAuth must call
      `shared_group_config.load_shared_groups(context, fallback_loader=lambda:
      load_dashboard_config(source='jsonfile'), validate_groups_config_fn=validate_groups_config)`;
      Basic/local must preserve the current `/api/groups-config` order: dashboard `teamGroups`,
      groups file, environment, then generated default. The readiness route selects `groupId` from
      that result and never calls global `load_dashboard_config()` as an authorization boundary.
- [x] Add failing route tests for the full Endpoint Contract Matrix, including cross-workspace and
      missing group ids, absent DB row with legacy fallback, DB/OAuth user Jira context,
      revoked/disabled auth, configured inaccessible and unknown Product/Tech access independently,
      absent access snapshots deferring to Jira, unconfigured project types being ignored,
      Basic/local compatibility, and sanitized failures.
- [x] Register exact GET `/api/eng/story-readiness` in `ENDPOINT_POLICIES` as
      `authenticated_read`. Prove it matches exactly one policy and that no unsafe method is
      registered.
- [x] Validate the requested sprint id/name/state tuple against the accessible sprint catalog and
      reject mismatches before Epic discovery. Never trust a caller-supplied sprint name as a label
      scope without that match.
- [x] Test a forged sprint name, forged state, completed/unknown state, and sprint id absent from the
      accessible catalog; none may start Epic discovery or populate cache.
- [x] Add endpoint-shaped Jira fixtures proving enhanced-search pagination beyond 250 Epics and
      fully paginated children. A failed later Epic or child page must fail the entire snapshot,
      produce no `200 complete`, and write no result cache entry.
- [x] Do not call `fetch_epics_for_empty_alert()` or `fetch_story_distribution_for_epics()` until
      they are refactored to return explicit completeness. The endpoint's paginator must be the only
      producer allowed to construct `CompleteReadinessInput`.
- [x] Resolve the saved Department Team ids and exact label map server-side. Reject or hide a foreign
      workspace group without leaking its existence.
- [x] Resolve the same configured Jira project scope and Product/Tech classification used by the ENG
      hierarchy. Return a normalized `projectKey` and `projectClass` so existing Product/Tech
      visibility controls remain authoritative.
- [x] Capture `RequestAuthContext` before any worker starts and pass it explicitly through the real
      Jira wrapper. Add a no-request-context worker test that reaches that wrapper; route mocks alone
      are insufficient.
- [x] Add credential-boundary tests that make
      `backend.auth.home_credentials.resolve_home_credential`,
      `backend.auth.home_credentials._resolve_service_credential`, `oauth_session_data`, and
      `oauth_session_data_for_auth_context` fail if called.
      The DB/OAuth case must still reach `current_jira_get`/`current_jira_search` with the captured
      DB `RequestAuthContext`; Basic mode may use only the existing Basic Jira adapter.
- [x] Fetch the Epic candidate scope once, de-duplicate by key, and enrich zero-Story Epics in batches
      with Initiative and the fields needed by the existing Epic header. Never issue one request per
      Epic.
- [x] Count actionable selected-sprint children per Jira Team id with the established status rules.
- [x] Make this snapshot authoritative for active and future readiness: `Blocked`, `Done`, `Killed`,
      and `Incomplete` are non-actionable. Delegate or remove the divergent future frontend
      classifier only after a Blocked regression test passes.
- [x] Apply and test this exact one-panel routing precedence: Future is Postponed → Backlog → Missing
      Team → Missing Labels → Stories Required. Active keeps Postponed first, routes exact-label
      readiness failures to Stories Required, leaves unrelated analysis waiting in Waiting, and
      sends only remaining empty candidates to Empty.
- [x] Add cache partitioning, `refresh=true`, stale revision handling, and `Server-Timing` stages for
      Epic discovery, child distribution, enrichment, and total time.
- [x] Test the exact `Cache-Control`, `Server-Timing`, and cache-result headers, fixed sanitized error
      bodies, and rejection of POST/unsafe methods.
- [x] Enforce initial operational bounds: enhanced-search pages are exhaustive; enrichment batches
      contain at most 40 Epic keys; a cohort above 2,000 unique Epics or 20,000 children fails with
      `422` rather than truncating; the endpoint has a 25-second cooperative deadline; result TTL is
      300 seconds with at most 128 entries and one in-flight computation per exact cache key.
- [x] Pass the remaining cooperative budget into every Jira call, retry, and backoff, with each
      request timeout strictly below the remaining route deadline. Test that a stalled later page
      terminates within the route budget and cannot emit/cache a complete snapshot.
- [x] Assert request-count bounds from page count plus `ceil(uniqueEpics / 40)` enrichment batches,
      zero Jira calls on a warm hit, unchanged primary Story request/timing paths, and a readiness
      payload smaller than the paired legacy alert-enriched task payload on the same fixture.
- [x] Prove ordinary `/api/tasks-with-team-name` responses still skip readiness enrichment and retain
      their existing payload and timing path.

## Task 3: Add the frontend snapshot adapter and lifecycle owner

**Files:**

- Modify: `frontend/src/api/engApi.js`
- Modify: `frontend/src/analytics/analytics.js`
- Create: `frontend/src/eng/useStoryReadiness.js`
- Create: `tests/test_story_readiness_api.js`
- Modify: `tests/test_frontend_api_source_guards.js`
- Modify: `tests/test_dashboard_alert_source_guards.js`

- [x] Add failing tests for exact query encoding, sanitized error parsing, abort propagation, and no
      credential/config leakage.
- [x] Register `eng_story_readiness` as an allowed `api_result` surface and test success, failure,
      cache-result bucketing, and identifier exclusion.
- [x] Implement one hook that owns start-after-primary-ready, de-duplication, cancellation, exact
      scope matching, refresh, retry, stale result rejection, and unavailable state.
- [x] Enable it only for Catch Up and Planning. Prove Board, Statistics, Scenario, EPM, and completed
      sprints issue no readiness request.
- [x] Preserve the existing Catch-Up-only ownership of missing-info, ready-to-close, backlog, and the
      remaining alert sources.
- [x] Implement the status-specific UI transitions in the state machine; Retry is offered only for
      network/`502`, not every error.
- [x] Do not let readiness loading participate in the primary Story loading spinner or delay the
      first useful hierarchy.

## Task 4: Build the pure ENG hierarchy model

**Files:**

- Create: `frontend/src/eng/engWorkHierarchy.js`
- Create: `tests/test_eng_work_hierarchy.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/eng/EngView.jsx`
- Modify: `frontend/src/futurePlanningNeedsStories.mjs`
- Modify: `frontend/src/futurePlanningTeamUtils.mjs`

- [x] Add failing interface tests for one Epic node per key, direct and Initiative grouping,
      multi-Team ghost identity, deterministic sort, Planning requirement-first partitioning at
      Initiative/Epic/row levels, active/future/completed states, complete/pending/unavailable
      readiness, alert target lookup, and Initiative-null fallback.
- [x] Define filter semantics exactly: selected group/sprint/Teams, Product/Tech visibility, search,
      and Epic Project Track apply; narrowed Story Status/Priority hides ghosts; alert reveal clears
      the hiding filters.
- [x] Return explicit counts for real Stories, Story requirements, and visible rows. Update empty-state
      decisions to use visible rows while preserving Story-only counts elsewhere.
- [x] Merge zero-task readiness Epics before Epic sorting and Initiative grouping. Read Initiative
      metadata from the canonical group Epic record instead of a story-only side map.
- [x] Derive an explicit `hasNoChildStories` display flag only from a complete snapshot's exhaustive
      child set/`no_stories` result. Never derive it from the filtered or selected-sprint Story list.
- [x] In Planning, stably partition Initiatives and Epics by whether they contain a visible Story
      requirement, then apply the selected Epic sort inside each partition; order requirement rows
      before real Story rows within an Epic. Preserve the existing order in Catch Up.
- [x] Keep synthetic rows in a separate `rows`/`requirements` collection. Never push them into
      `epicGroup.tasks`.
- [x] Replace duplicate future-only dashboard coordination only after the new interface tests prove
      equivalent Future Needs Stories behavior.
- [x] Keep `frontend/src/dashboard.jsx` within its enforced structure budget by moving projection and
      lifecycle behavior into the new modules.

## Task 5: Render accessible ghost rows without changing Epic header geometry

**Files:**

- Create: `frontend/src/eng/StoryRequirementCard.jsx`
- Modify: `frontend/src/eng/EngView.jsx`
- Modify: `frontend/src/styles/eng/issues.css`
- Modify: `tests/test_eng_board_styles.js`
- Create: `tests/ui/eng_missing_story_ghosts.spec.js`

- [x] Add failing Playwright cases for active red and future yellow rows, textual urgency, exact Team,
      visible target sprint, dashed/dotted border, visible focus, keyboard activation, and narrow
      viewport containment.
- [x] Match approved Variant A: render each requirement as a full-width Story-card echo in the normal
      Story stream, with title/instruction in the primary row and Team, target sprint, and urgency in
      the metadata row. Add source/style assertions that reject a separate coverage-checklist
      wrapper and empty-slot rail/action column.
- [x] Add failing direct and Initiative-grouped Playwright cases proving a `no_stories` Epic has a
      dotted outline around its entire `.epic-block`, while an Epic with hidden, out-of-sprint, or
      non-actionable child Stories does not acquire that whole-Epic treatment.
- [x] Render the ghost as one `TrackedExternalLink` to `/browse/<epicKey>` with `noopener noreferrer`.
      Do not place another interactive control inside it.
- [x] Use an accessible name that says the Epic, Team, target sprint, and that Jira opens for Story
      creation. Do not rely on native `title` for essential information.
- [x] Render no checkbox, SP, dependency, remove, transition, priority, or inline-edit control.
- [x] Preserve the Epic header's single-row visible-alignment contract and cover both direct
      `.task-list > .epic-block` and `.initiative-body > .epic-block` structures without changing EPM.
- [x] Apply the dotted whole-Epic treatment without changing the Epic block's dimensions, sticky
      header offsets, focus outline, or nested Story/requirement geometry.
- [x] Add the bounded unavailable/retry state and ensure progressive insertion does not move focus.

## Task 6: Unify Stories Required alert semantics and local navigation

**Files:**

- Modify: `frontend/src/eng/EngAlertsPanel.jsx`
- Create: `frontend/src/eng/alertEpicNavigation.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `tests/test_dashboard_alert_source_guards.js`
- Modify: `tests/ui/eng_alerts_panel_summary.spec.js`
- Modify: `tests/ui/eng_missing_story_ghosts.spec.js`

- [x] Rename the user-facing future `Needs Stories` category to `Stories Required` and feed it from
      the same readiness snapshot used by the hierarchy.
- [x] Extend it to active/current sprint requirements with red urgency while preserving Catch-Up-only
      alert rendering and future alert precedence.
- [x] Add pairwise precedence tests for Postponed, Backlog, Missing Team, Missing Labels, Stories
      Required, Waiting, and Empty, proving a candidate renders in exactly one panel.
- [x] Keep the alert header chip as a unique-Epic count while Team sections render composite
      requirement rows; test a single Epic missing two Teams.
- [x] Exclude Story-readiness Epics from Empty Epic/Waiting categories so one Team requirement cannot
      duplicate across panels. Preserve unrelated analysis waiting behavior.
- [x] Key dismissal by the composite requirement id so dismissing Team A does not hide Team B; keep
      dismissal out of the hierarchy projection.
- [x] Namespace requirement dismissal as
      `story-required::<groupId>::<sprintId>::<epicKey>::<teamId>` while preserving existing real-issue alert
      dismissal behavior and preventing a requirement dismissal from hiding another alert category.
- [x] Store these ids in a separate `dismissedStoryRequirementIds` collection, prune entries outside
      the current sprint/group session scope, and test Team independence, sprint/group switch,
      refresh, and same-scope cache restoration. Switching away clears the prior scope's entries, so
      switching back starts undismissed; refresh within the same scope preserves dismissals. Do not
      overload `dismissedAlertKeys`.
- [x] Replace nested `role=button`/anchor markup with a native local-navigation button that reuses
      the established alert-row typography and layout. Do not add a secondary action to this row;
      the hierarchy ghost remains the explicit Jira-opening action.
- [x] Add `data-epic-key` and composite requirement target ids to the hierarchy. The Epic-specific
      navigator clears only hiding list filters, waits for rendering, scrolls with reduced-motion and
      sticky offsets, focuses the target, and applies a temporary highlight.
- [x] If a complete current-scope snapshot says a target exists but the DOM still cannot render it,
      show a local bounded error. Do not silently open Jira; the explicit external link owns that
      action.
- [x] Prove click and Enter activate the same local target and the target is not covered by compact
      header, Planning panel, filter bar, or sticky Epic header.

## Task 7: Analytics and documentation contract

**Files:**

- Modify: `frontend/src/eng/StoryRequirementCard.jsx`
- Modify: `frontend/src/eng/EngAlertsPanel.jsx`
- Modify: `tests/test_analytics_events.js`
- Modify: `tests/ui/ga4_tag_and_events.spec.js`
- Modify: `docs/README_ANALYTICS.md`
- Modify: `docs/features/alerts.md`
- Modify: `docs/DOMAIN_ONTOLOGY.md`
- Modify: `docs/ontology.md`

- [x] Reuse `external_link_opened` with `link_type=jira_issue_browse`, `issue_kind=epic`, and
      `source_surface=catch_up|planning` for ghost activation. Alert-to-ghost navigation remains a
      local navigation mechanic with no analytics event.
- [x] Prove the payload excludes Epic keys, Team/sprint names, labels, Jira URLs, JQL, reasons, and
      raw counts.
- [x] Record a no-new-event allowlist entry for alert-to-local-ghost navigation.
- [x] Update Alerts documentation: readiness loads progressively in Catch Up and Planning, while the
      Alerts panel and unrelated alert sources remain Catch-Up-only.
- [x] Add Story readiness/requirement ownership and relationships to the canonical domain ontology
      and implementation navigation ontology.

## Task 8: End-to-end, visual, performance, and regression verification

**Files:**

- Modify: `tests/ui/eng_alert_loading_order.spec.js`
- Modify: `tests/ui/codebase_structure_smoke.spec.js`
- Modify: `tests/ui/eng_group_board_card.spec.js`
- Rebuild: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`,
  `frontend/dist/dashboard.css`

- [x] Prove real Product/Tech Stories paint before readiness begins in both Catch Up and Planning.
- [x] Prove Planning requests only Story readiness and none of the unrelated Catch Up alert sources.
- [x] Prove abort, stale cohort, refresh, Retry, auth-expired recovery, incomplete pagination, and
      group/sprint switch behavior.
- [x] Prove a no-real-Story page renders its Epic/ghost hierarchy instead of `No tasks found`.
- [x] Prove a true no-child-Story Epic has a dotted whole-Epic outline in direct and
      Initiative-grouped layouts, and that filter-hidden Stories do not trigger the outline.
- [x] Prove a multi-Team Epic renders real Story rows for covered Teams and one ghost per uncovered
      Team with unchanged SP, capacity, task readout, selection, exports, dependencies, and mutation
      target counts.
- [x] Prove Planning places requirement-bearing Initiatives/Epics first and requirement rows above
      real Story rows, with the selected Epic sort stable inside each partition; prove Catch Up order
      is unchanged.
- [x] Prove direct and Initiative-grouped targets, search/filters, sorting, selected Teams, sticky
      scroll, keyboard focus, reduced motion, and narrow viewport behavior.
- [ ] Capture settled after screenshots matching the two Task 0 baselines and compare every explicit
      design constraint and the approved Variant A reference. Disable or await animations before
      capture.
- [ ] Measure the new endpoint on cold and warm synthetic/live-safe fixtures. Report actual
      `Server-Timing`, request count, and payload size; do not claim improvement without measurements.
- [ ] Run focused Python, Node, and Playwright tests, `npm run build`, generated-output checks,
      `git diff --check`, the full Node suite, the full Python suite, and the relevant full
      Playwright project before any publication request.
- [ ] Launch `.venv/bin/python jira_server.py` with no dependency/runtime warning before the Flask
      banner and verify `/api/test` before any merge request involving backend startup paths.

## Acceptance Criteria

- Catch Up and Planning progressively render a zero-Story Epic under its Initiative without delaying
  real Stories; a complete-snapshot `no_stories` Epic has a dotted outline around the whole Epic
  container, and filters cannot create that state.
- Exactly one `Story required` ghost appears per uncovered expected Team for active/future sprints;
  completed/unknown sprint states show none.
- Every ghost uses approved Variant A's full-width Story-card-echo layout in the normal Story stream;
  Variant B's checklist container and Variant C's empty-slot rail/action column are absent.
- Planning places requirement-bearing Initiatives and Epics above covered-only peers and renders
  `Story required` rows above real Story rows, using the selected Epic sort within each partition;
  Catch Up retains its existing ordering.
- Active ghosts are red and Future ghosts yellow, with text/icon/outline semantics and accessible
  labels independent of color.
- Every ghost visibly names the selected target sprint and expected Team.
- Alert activation reveals, focuses, and highlights the exact composite ghost locally; the ghost
  opens the Jira Epic externally.
- Dismissal is per requirement and affects only the alert.
- Story, SP, capacity, selection, dependency, export, mutation, and analytics contracts remain based
  only on real Jira issues.
- A failed, partial, stale, or unauthorized readiness snapshot never produces a ghost.
- Primary task responses retain their existing no-readiness critical path. Planning starts no
  unrelated alert calls.
- Source docs, analytics taxonomy, ontologies, generated assets, automated tests, and settled visual
  evidence match the implementation.

## Forbidden Regressions

- No fake Jira issue keys or synthetic Story objects in canonical data.
- No per-Epic Jira fan-out.
- No 250-item silent cap.
- No alert fallback that unexpectedly opens Jira when local reveal fails.
- No nested interactive elements, mouse-only controls, color-only meaning, or native-title-only
  essential copy.
- No Epic header wrapping, new header row, sticky offset drift, or EPM selector leakage.
- No requirement-first reordering in Catch Up, and no dotted whole-Epic treatment inferred from
  client-side filtering or an incomplete readiness snapshot.
- No first-screen blocking readiness work or Planning activation of all Catch Up alerts.
- No personal/private Team mapping creation and no Home/Townsquare mutation.

## Residual Risks

- Jira indexing delay after a lead creates a Story can leave a ghost visible until refresh. The UI
  should describe Jira as the source and keep Retry/refresh explicit; optimistic removal is out of
  scope.
- Permission-reduced Initiative metadata can place an otherwise actionable Epic in the ungrouped
  section. This is preferable to hiding the requirement and must be covered by degraded fixtures.
- Live Jira performance and field shapes cannot be proven by synthetic tests alone. Record live-safe
  evidence when access is available without making it a prerequisite for local correctness.

## Outcome

Implemented with two environment-bound verification gaps. The backend provides the authenticated,
bounded, cache-partitioned `GET /api/eng/story-readiness` snapshot and the frontend progressively
merges synthetic requirement rows into Catch Up and Planning without contaminating real Story
collections. Planning requirement-first ordering, dotted complete-snapshot zero-Story Epics,
Stories Required alert precedence/dismissal/local reveal, bounded analytics, documentation, and
generated assets are implemented.

Execution started from `origin/main` and branch HEAD
`c017002a6fa71f97f68acf908c5c145c70ad502a` on `feature/missing-story-ghosts-plan`.

The implementation added `frontend/src/eng/useEngWorkHierarchy.js` beyond the original file map so
React lifecycle/grouping coordination stays outside the budget-constrained dashboard entry point.

Verification completed: 1,332 frontend unit tests, 259 focused backend tests, 25 focused Playwright
tests, the structure budget, startup preflight, production build, generated-output checks, and
`git diff --check`. The full Python discovery run executed 1,749 tests and found no feature failure;
its remaining error is an environment-bound suite-order PostgreSQL dependency in
`test_basic_mode_does_not_apply_oauth_route_guard`, which passes alone. A real server launch and
live Jira cold/warm timing could not run because local PostgreSQL is unavailable.

A post-implementation correction on 2026-09-16 aligned project-access handling with existing ENG
routes and restored the established alert-row design. The endpoint now checks only configured
project types, lets absent access snapshots defer to Jira, denies explicit inaccessible/unknown
records, and sanitizes Jira failures. The Stories Required alert keeps local reveal behavior while
reusing the existing title, note, and dismiss-only composition. Focused verification passed 116
backend tests, 66 frontend unit/source tests, and 12 Playwright tests; the production bundle rebuilt
successfully and the settled hover-state crop was inspected against the existing alert reference.
The follow-up functional correction unwraps the persisted Team-catalog envelope before resolving
display names and gives explicit alert navigation a truly neutral facet reset, so a target hidden by
the normal Killed exclusion can render before the bounded reveal retry.

## Current Accuracy

Accurate for the corrected branch implementation on 2026-09-16. Keep this `EXEC-*` name until
acceptance or merge. The code and current product documentation are the source of truth; live
operational timing and `/api/test` remain to be recorded in an environment with PostgreSQL and Jira
access.
