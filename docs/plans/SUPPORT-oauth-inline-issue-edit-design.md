# OAuth inline issue editing — design

**Status:** Implemented and verified locally on 2026-09-09; awaiting live tenant capability and operator-approved disposable Jira write evidence. Implementation contract: [EXEC-oauth-inline-issue-editing.md](EXEC-oauth-inline-issue-editing.md).
**Created / reviewed:** 2026-09-08
**Scope:** ENG Catch Up, Planning, and Board. Local application implementation and synthetic verification are complete; no live Jira write has been performed.

## Outcome

Signed-in OAuth users can edit Assignee on Epics and Stories, Delivery Owner on Epics, and Story Points on Stories. Confirmed values persist in Jira, appear in every loaded issue representation, and update existing Epic totals and Planning calculations.

| Field | Catch Up | Planning | ENG Board |
| --- | --- | --- | --- |
| Assignee | Epic and Story | Epic and Story | Epic card/detail panel and Story detail rows |
| Delivery Owner | — | — | Epic card/detail metadata |
| Story Points | Story only | Story only | Display updated values; no editor |

The design baseline is ENG only, five users including Me, non-negative Story Points including zero, and no clearing action. No bulk-field, subtask, EPM/Home, Scenario publishing, or new configuration ownership. Server eligibility is literal Epic/Story excluding subtasks; the current flat configured issue-type list is not a role mapping. Basic mode remains read-only.

## Reuse and consistency are acceptance requirements

Person values open a compact anchored editor. Story Points is edited directly in its existing compact SP slot. A generic edit modal would add unnecessary navigation.

| Need | Existing element | Required reuse |
| --- | --- | --- |
| Popover positioning/dismissal | `frontend/src/issues/IssueFieldOptionMenu.jsx` | Extract only shared placement/outside-dismiss mechanics; preserve existing menu focus, semantics, preview and onboarding behavior |
| Panels/options/loading/error/result | `frontend/src/styles/eng/status-transitions.css` | Extend existing selector aliases, including portal styling; do not copy rules into a parallel design |
| Person search input | `.component-search-input` in `styles/settings/group-editor.css` | Native input with the same class; no new Input component |
| Person Save/Cancel/Reload/Check Jira | `button.compact`, `button.secondary.compact` in `styles/eng/controls.css` | Same typography, sizing, borders and states; no new Button component |
| People in Catch Up/Planning | `.task-assignee`, `.task-assignee-icon`, `.epic-assignee` | Preserve icon and metadata typography; make value a native trigger |
| Board people | `.eperson`, `.lbl`, `.eperson b` | Preserve existing line height, casing and ellipsis |
| Story Points | `.task-inline-sp` | Replace value in its existing position; show 0 explicitly |
| API/auth and writes | `jiraIssueApi.js`, `trackedFetch`, current OAuth wrapper, context-only grant helper | Extend existing paths; no alternate transport/auth flow |
| Calculations/state | `engIssueLocalUpdates.js`, `planningSelectionStats.js`, current task sources | Patch canonical normalized values and rerun existing selectors; no second calculator |

Thin person and SP presentations are necessary for their semantics; a new design system is not. Do not insert a search input into a role=menu container. Person search uses combobox/listbox behavior; SP is the native inline input itself. Reuse the existing slot's mechanics and appearance without changing old menus.

No new permanent buttons, search fields, toolbar, heading row, arbitrary minimum widths, fonts, spacing tokens, or wider/taller cards. Long names ellipsize inside available metadata space. Tests must compare actual text bounds and screenshots, not only container boxes.

## User interactions

Person editor:

- Click the current person, `Unassigned`, or `Not set` in the existing metadata slot.
- Focus search. Pin Me first; display up to four additional users, deduplicated by accountId. Me counts toward the five-value maximum and remains first regardless of query.
- Search Jira after three trimmed Unicode characters, debounced 300 ms. Below threshold show Me plus concise guidance; send no query search. Drop/abort stale query results.
- Accept email, first name or surname as Jira's query. Display Jira-returned names, with email only if Jira provides it. No inferred emails or directory enumeration.
- Known ineligible Me is disabled with a reason. Delivery Owner candidates can be identity-verified but restriction-unverified; the final Jira write remains authoritative. Search results never promise permissions that the API cannot establish.
- Selecting a user submits one field immediately. Keep the last confirmed value visible with a pending indicator until read-back. No extra confirmation dialog; no write for a value equal to freshly loaded canonical metadata. Server still checks independently.

Story Points editor:

- Open from the Story SP value in Catch Up/Planning. Show `0 SP` for both zero and a missing Jira value, while preserving a missing value as `null` until the user saves a number.
- The displayed number is the text input itself with inputMode=decimal. There is no trigger button, popup, Save, or Cancel control. Enter saves once; Escape/outside dismiss cancels unsaved changes.
- A Missing: Story Points alert link stays inside the dashboard: reveal the Story even when ENG filters hide it, scroll to and highlight the Story, then focus/select this inline input so metadata loading enters edit mode. The alert must not open Jira for this case.
- Accept 0, 1.5, 2, 3, 2.0; render integers without an unnecessary decimal. Reject blank target, negatives, NaN/infinity, >1 decimal, commas and exponent shorthand in UI. Do not round invalid input to make it acceptable. API independently validates finite non-negative numbers and decimal precision, rejecting boolean/string/null targets.
- Existing more-precise values remain readable and valid as concurrency baselines; a replacement must satisfy the new precision rule. No estimate-clearing action.

## Placement and accessibility

Catch Up/Planning Stories already have person/SP positions; reuse them. Do not add Delivery Owner to Catch Up or Planning. Board cards already show both Epic people. Board detail panels need Epic Assignee/DO in existing .m-controls; their Story assignee cell is reused. Do not create another title/header row.

Board cards are currently one native button. Inline triggers must not be nested inside it: preserve .ecard geometry as a noninteractive draggable wrapper, put existing summary/status rows in a native .ecard-open button, and leave people triggers as siblings. Update focus restoration to the open button. Summary activation/drag still works; people clicks do not open, drag or select the card.

Use native triggers, visible focus and accessible complete labels; arrows/Enter for suggestions, Escape to close and return focus. Board popovers portal within the panel root so its focus trap contains them; elsewhere use the body host. Register editor closers so first Escape closes the editor and the next closes Board. Keep the global auth overlay above all editors.

Verify popup bounds and normal option clicks after scroll/resize/mobile viewport changes. Preserve Planning-panel-above-Epic sticky order; when Planning closes, Epic header sticks at top. Preserve Story selection and prevent trigger events from reaching parent expand/navigation/drag handlers.

## Jira, auth and state contract

The execution plan contains exact routes, JSON, errors, task files, and tests. Core constraints:

- OAuth current user only, active verified grants and same authenticated site. Use `missing_context_oauth_scopes`, existing unsafe-method Requested-With and token-bound CSRF guards. Tool-admin rights do not replace Jira permissions; no Settings-admin gate for ordinary issue writes.
- Resolve configured field IDs on the server. Validate actual issue type, editmeta schema, and set operation. No arbitrary field/URL/credential payload, autoCompleteUrl proxy, Basic/service/Home fallback, or local-store resolution in the new service.
- Assignee search uses issue-scoped assignable search. DO uses active-user search plus explicit allowedValues when provided; absence of those restrictions means eligibility remains unverified until PUT. Do not require Delivery Owners to be assignable.
- Update one Jira field with accountId or numeric value. Read back directly from the issue. Explicit Jira null differs from a missing/malformed field response.
- Preflight detects stale edited-field values and changed mappings. It does not promise atomic Jira compare-and-swap. Preserve unrelated-field changes and use explicit Reload/reselect after conflict.
- Known Jira 400/409/422 rejection differs from ambiguous dispatch or unreadable success. Unknown writes are never automatically replayed. Check Jira is a read of current state, not proof of causality, and can reconcile only the same mappingRevision. Changed/missing mapping retains uncertainty with native-Jira guidance.
- Any 401, including read-back after an accepted write, uses the existing terminal global auth lock and no replay.

Patch normalized Assignee/DO identity and normalized Story SP (`fields.customfield_10004`) after confirmation, while using actual configured IDs only for Jira writes. Retain accountId in existing shapers. Epic owner edits never cascade to Story assignees. Board currently derives from the shared scoped task/Epic models; adapt explicitly if the separately planned Board pipeline lands first.

Update active arrays and inactive group snapshots without clearing user filters/selections. Guard all task/epic/stat cache commits against pre-write loads; an older response preserves the latest accepted observation, including a newer external value from a later read. Keep read tokens until final downstream commits, not just fetch return. Guard backend cache fills so old requests cannot repopulate invalidated caches. Invalidate lazy stats/dependency sources without fetching inactive tabs or rebuilding Scenario drafts.

Reuse and complete the shared mutation queue: all ENG field/status/priority/track writes use it across surfaces; overlapping batch issue keys reserve atomically. Pending work checks auth/context before dispatch. Cancel unsent work on scope change; already-dispatched results may update matching same-site issues without reopening an old editor.

Recompute Epic sums and Planning's existing selected/team/project/capacity inputs from replaced Story objects. Never write derived sums to the Epic Jira field. Overall selected SP/team totals intentionally include selected excluded Stories; Product/Tech allocations exclude those Epics. Preserve that distinction. Fixture: 1.5+3 edited to 2+3 yields 5, second-only selection remains 3; editing an excluded selected Story affects overall totals but not allocation.

## Analytics and acceptance

Use `issue_field_edit_action`, trigger userevent, event_type event, feature_name eng_issue_field_edits, with bounded workflow/field/surface/issue_kind/result enums. Reuse issue_kind; no raw names, emails, query, account IDs, issue keys, field IDs, SP values or errors. Reuse api_result for reliability. Preserve GA4_ENABLED and the two-trigger contract. No per-keystroke/cancel/recalculation events.

The execution plan requires service, route security, real OAuth-wrapper, numeric/state/queue, full surface Playwright, and settled screenshot checks. Screenshots must prove current design consistency and fixed geometry with long names and blank/zero fields. Run existing status/priority/track/onboarding/Board drag tests when shared mechanics change.

Local implementation may begin with synthetic fixtures. Live OAuth name/email/privacy/field capability checks and approved disposable Jira write/read-back/native-UI verification gate final acceptance, not plan creation. Include Atlassian sign-in via Microsoft Entra SSO. No live tenant pass has been claimed. Home GATE-05 stays blocked and unrelated to this Jira REST feature.

## Review evidence and limits

Three subagent reviews identified and corrected API eligibility/schema/errors, invalid nested Board buttons, missing reuse targets, queue bypasses, stale group/cache/load behavior, and calculation denominator risks. The implementation plan records final closure and exact checks.

Residual limits: Jira-controlled privacy/search permissions and custom-field restrictions; non-atomic GET/PUT races with other clients; uncertain outcomes after transport failure; process-local cache invalidation rather than a new distributed event system.

Sources: [Jira user search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-user-search/), [official v3 OpenAPI](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json), and [privacy migration](https://developer.atlassian.com/cloud/jira/platform/deprecation-notice-user-privacy-api-migration-guide/). Reviewed 2026-09-08. No upstream-template change was applied after the earlier failed fetch.
