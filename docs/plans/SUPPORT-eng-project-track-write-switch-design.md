# ENG Project Track Write Switch — Design

| Field | Value |
| --- | --- |
| Status | User-approved design; validated against current status/priority update paths; feeds `EXEC-eng-project-track-write-switch.md` |
| Branch | `docs/project-track-write-switch-plan` |
| Type | OAuth-backed Jira Epic field update in ENG Catch Up and Planning |

## Goal

Let a signed-in ENG user change a real Epic's configured Jira `Project Track[Dropdown]`
field between `Flexible` and `Committed` from the existing Epic-header indicator. Keep the
interaction and failure behavior aligned with the shipped ENG status and priority update
controls. Render an unidentified track as `⚪` instead of hiding the indicator.

## Current State (Verified)

- `jira_server.py` resolves the field through `get_project_track_field_id()` and
  `fetch_epic_details_bulk(...)` exposes its selected option value as
  `epic.projectTrack`.
- `frontend/src/eng/engTaskUtils.js` maps `Committed` to `🔒` and `Flexible` to
  `🤷`; blank and unrecognized values currently return no emoji.
- `frontend/src/dashboard.jsx::renderEpicBlock(...)` renders the indicator in each ENG
  Epic header, but it is a passive `<span>` and the tooltip incorrectly says
  `Product Track`.
- ENG status and priority updates are enabled only by the shared Catch Up/Planning
  surface gate. Settings, Statistics, Scenario, and EPM keep issue-field controls inert.
- Priority changes already provide the closest interaction contract: a native icon
  button opens `IssueFieldOptionMenu`, options load on demand, writes use the signed-in
  user's Jira OAuth context, Catch Up uses the per-issue mutation queue, local state is
  patched optimistically, failures roll back, and late scope responses cannot patch the
  newly selected scope.

## Chosen Approach

Add a dedicated Project Track read-options/write service and ENG control. Do not add a
generic custom-field writer and do not hard-code tenant-specific Jira option ids.

The dedicated boundary is intentionally narrow:

- the browser may submit only one real Jira Epic key and one canonical target,
  `Flexible` or `Committed`;
- the server owns the configured field id and resolves the target option id from that
  exact issue's Jira edit metadata;
- the server writes only that field through Jira's issue-edit endpoint;
- no browser request may supply an arbitrary Jira field id, option id, field name, or
  update document.

This follows Atlassian's documented contract: editable fields and allowed values come
from `GET /rest/api/3/issue/{issueIdOrKey}/editmeta`, while field updates use
`PUT /rest/api/3/issue/{issueIdOrKey}` and require the user's Edit Issues permission.
The existing classic OAuth `write:jira-work` scope covers editing issues.

References:

- <https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/>
- <https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/>

## Interaction Contract

### Indicator and trigger

- `Committed` renders `🔒`.
- `Flexible` renders `🤷`.
- Null, blank, or unrecognized values render `⚪` with the accessible state
  `Project Track: Unidentified`.
- Only a real Epic key gets an interactive Project Track trigger. The synthetic
  `NO_EPIC` / `No Epic Linked` group never gets a white indicator or a write control.
- On ENG Catch Up and Planning, while Settings is closed, the indicator is a native
  button with `aria-haspopup="menu"`, `aria-expanded`, a visible focus state, and the
  accessible label `Project Track: <state>. Change Project Track`.
- On Statistics, Scenario, EPM, and any other non-ENG issue surface, Project Track stays
  passive/read-only. EPM receives no Project Track write props or API imports.

### Menu behavior

The control reuses `IssueFieldOptionMenu` and the status/priority menu behavior:

- trigger click toggles the anchored compact menu;
- options load only after the user opens the menu, so dashboard startup gains no Jira
  request;
- the current recognized value is omitted, leaving only the real alternative; an
  unidentified value shows both `Flexible` and `Committed`;
- each row shows the same emoji used by the header;
- the first option receives focus after loading;
- Escape and an outside pointer press close the menu;
- loading, empty, error, submitting, and result states use the existing shared menu
  grammar;
- submitting disables duplicate selection for that Epic.

No confirmation dialog is added. Choosing an option is the explicit Jira write action,
matching status and priority option selection.

## Backend Design

Create `backend/services/jira_issue_project_track.py`, dependency-injected like
`jira_issue_priorities.py`. It must not import Flask, `requests`, Basic credential
builders, Home/Townsquare helpers, service integrations, or local OAuth token-store
helpers.

The service owns these rules:

1. Normalize and validate one Jira issue key.
2. Accept only canonical target values `Flexible` or `Committed`, case-insensitively at
   the HTTP boundary and canonically in service results.
3. Resolve the configured field id through injected `get_project_track_field_id`.
4. Load the issue snapshot with only `issuetype` and the configured Project Track field.
5. Reject a non-Epic issue without attempting a Jira write.
6. Treat an already-selected target as a successful no-op.
7. Fetch that issue's `editmeta`, locate the configured field id, and match the target
   against `allowedValues[*].value` case-insensitively.
8. Send exactly
   `{"fields": {"<configured-field-id>": {"id": "<resolved-option-id>"}}}` to
   `PUT /rest/api/3/issue/<key>`.
9. Return only sanitized issue key/state/result fields; never return raw Jira bodies,
   edit metadata, field ids, option ids, URLs, or permission details.

The write path re-resolves edit metadata at submission time rather than trusting the
earlier menu response. This keeps a stale open menu from bypassing changed Jira field
context, editability, or allowed values.

## Endpoint Contracts

| Contract | Options | Write |
| --- | --- | --- |
| Route | `GET /api/issues/project-track/options?issueKey=<key>` | `POST /api/issues/project-track` |
| Policy | `authenticated_read` plus explicit Atlassian OAuth mode | `user_write` plus explicit Atlassian OAuth mode |
| Headers | `X-Requested-With: jira-execution-planner` from the client | `X-Requested-With: jira-execution-planner` and token-bound `X-CSRF-Token` |
| OAuth scope | Existing read scope used by issue `editmeta` | Explicit defense-in-depth check for `write:jira-work` before Jira access |
| Request | One validated `issueKey` query value | `{"issueKey":"PRODUCT-1","targetTrack":"Committed"}` and no client-owned field/option id |
| Success | `200 {"options":[{"value":"Flexible"},{"value":"Committed"}],"source":"jira"}`; option ids stay server-owned | `200 {"issueKey":"PRODUCT-1","result":"success","fromTrack":"Flexible","toTrack":"Committed"}` or `result:"already_in_track"` |
| Input errors | `400 invalid_issue_key` | `400 invalid_json`, `invalid_issue_key`, or `invalid_project_track` |
| Jira state errors | `404 issue_not_found`; `409 project_track_not_editable` when the configured field or both expected options are unavailable | `404 issue_not_found`; `409 issue_not_epic`, `project_track_not_editable`, or `project_track_option_unavailable` |
| Auth errors | Existing `401` auth recovery and `403 jira_oauth_required` | Existing auth recovery; `401 missing_oauth_scope`; middleware `403 csrf_required`; `403 jira_oauth_required` |
| Upstream failure | Sanitized `502 jira_project_track_options_failed` | Sanitized `502 jira_project_track_update_failed` |

The options response deliberately omits Jira option ids. The write accepts a canonical
track name and resolves the current option id again on the server.

After a successful write, the route calls the existing Jira-derived cache invalidator
with a Project Track-specific reason. It does not clear caches for validation failures,
no-op results, or failed writes.

## Frontend State and Data Flow

Add Project Track API wrappers, pure normalization/analytics helpers, a focused
`useEngProjectTrackTransitions` hook, and a presentational
`ProjectTrackTransitionMenu` that composes `IssueFieldOptionMenu`.

The flow mirrors priority updates:

1. Opening a real Epic's indicator records the active target and fetches its options.
2. Selecting a target records the prior track and applies the canonical target to every
   current ENG Epic representation that can render or sort the Epic.
3. The write runs through `enqueueEngIssueMutation(epicKey, mutation)` so status,
   priority, and Project Track writes for the same issue serialize.
4. A pending-key set disables duplicate submission and marks only that Epic busy.
5. Success reconciles the local value with the sanitized server result. Track-based Epic
   sorting reacts immediately to the patched `projectTrack` value.
6. Failure restores the exact prior value and keeps a visible retryable error in the
   open menu.
7. A sprint/group/surface mutation-scope token prevents a late response from patching a
   newly selected scope.
8. Auth recovery clears active menu state and redirects through the same recovery helper
   used by status and priority changes.

Because Project Track does not determine which ENG tasks are fetched, a successful
single-Epic change does not force a full task-list refresh. Cache invalidation makes the
next normal reload authoritative; the targeted patch keeps the current view accurate
without adding request fan-out.

## Similarity to Status and Priority Updates

| Behavior | Project Track requirement |
| --- | --- |
| Surface gate | Reuse the same ENG Catch Up/Planning gate and Settings-open exclusion. |
| Trigger | Use the displayed field indicator as the native button; no separate Change button. |
| Menu | Reuse `IssueFieldOptionMenu`, focus, Escape, outside dismissal, compact rows, notes, and result treatment. |
| Authentication | Signed-in user's Jira OAuth context only; explicit scope check; no Basic, service, Home, or local token-store fallback. |
| Unsafe request protection | Same `X-Requested-With` plus token-bound CSRF flow as status/priority writes. |
| Mutation scheduling | Reuse the shared per-issue queue and same-key serialization. |
| Current-view response | Optimistic patch, pending marker, server reconciliation, rollback on failure. |
| Scope changes | Ignore stale completion patches after sprint/group/surface changes. |
| Recovery | Reuse structured API errors and auth recovery redirect behavior. |
| Isolation | EPM, Statistics, Scenario, Settings, and synthetic issue groups remain inert. |

## Analytics Impact

Add one low-cardinality `issue_project_track_action` event with
`feature_name=eng_project_track_changes`. Its workflow actions are
`project_track_options_open`, `project_track_change_submit`, and
`project_track_change_result`. Reuse existing safe parameter keys only:

- `source_surface=catch_up|planning`;
- `issue_type_mix=epics`;
- `selected_count_bucket=1_5`;
- `value_state=flexible|committed` only after a target is selected;
- `result=success|failure` on the result event.

Never emit issue keys, summaries, Jira URLs, raw current values, field ids, option ids,
account ids, JQL, or raw errors. The API wrappers use a new low-cardinality
`jira_issue_project_track` API surface for existing `api_result` tracking.

This adds a new allowed event name but no new dataLayer property key, GTM trigger, tag,
variable, custom dimension, destination, or transport behavior. Update
`docs/README_ANALYTICS.md`; do not change the GA4/GTM operator runbook or register a new
custom dimension.

## Error and Concurrency Behavior

- Options failures leave the current emoji unchanged and expose a retryable menu error.
- A write failure rolls back to the value captured immediately before that queued
  mutation, not to an older page-load value.
- Same-Epic writes serialize with status and priority mutations through the shared queue;
  different Epics may proceed within the queue's existing global concurrency limit.
- The mutation sets an absolute target. A remote user changing the same Epic while the
  menu is open does not create a local toggle race; Jira applies the latest submitted
  absolute value, and the server returns that target only after a successful response.
- The menu options and write path both fail closed if the configured field is absent,
  not editable, or lacks the expected option in that Epic's field context.

## Scope Boundaries

- No Home/Townsquare route or mutation. `GATE-05-home-write-capability.md` remains
  blocked and unrelated.
- No EPM write capability.
- No batch Project Track editing.
- No clearing Project Track back to null; unidentified Epics may be assigned Flexible or
  Committed only.
- No generic Jira custom-field API.
- No settings UI or new field-id configuration; reuse the existing
  `projectTrackField` configuration and fallback.
- No startup fetch, polling, SSE, or background catalog warming.
- No change to Statistics Project Track calculations beyond future normal reloads
  reading the updated Jira value.

## Verification Strategy

- Backend unit tests prove issue/target validation, Epic-only enforcement, configured
  field-id use, exact `editmeta` option matching, already-in-track no-op, exact Jira PUT
  body, sanitized errors, and no forbidden credential/import path.
- OAuth route and policy tests prove mode gating, `X-Requested-With`, token-bound CSRF,
  `write:jira-work`, current `RequestAuthContext`, cache invalidation only on success,
  and no `build_jira_headers`, Basic, Home, or service integration fallback.
- Frontend unit tests prove `⚪` normalization, menu option filtering, safe analytics
  parameters, optimistic patch/reconcile/rollback, per-key pending state, queue use, and
  stale-scope suppression.
- Playwright tests prove `🔒`/`🤷`/⚪ rendering; native trigger semantics; option
  loading only on open; normal-click selection; success and failure behavior; immediate
  sort movement; Escape/outside dismissal; focus; menu layering; no control for
  `NO_EPIC`; and no Project Track API calls from EPM, Statistics, Scenario, or Settings.
- Visual verification includes settled screenshots of Committed, Flexible, and
  Unidentified indicators plus the open menu at desktop and a narrow viewport.
- Final verification runs focused Python/Node/Playwright tests, the full Python and
  frontend unit suites, structure budgets, `npm run build`, the frontend dist clean-diff
  check, startup preflight, Flask startup, and `/api/test`.

## Approval

The user approved the interaction and architecture on 2026-07-16 and added one explicit
requirement: behavior must remain similar to existing status and priority updates. The
comparison table above is therefore an acceptance contract, not optional guidance.
