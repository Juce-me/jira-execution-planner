# GA4 Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Status:** Drafted on 2026-05-26 for GA4 Measurement ID `G-6QERX19WB0`. This is an implementation plan, not an executed code change.

**Goal:** Add privacy-safe Google Analytics 4 tracking for Jira Execution Planner usage: authenticated user continuity, major view/mode adoption, search and filter usage, settings and connection flows, Scenario Planner actions, EPM usage, chart interactions, API outcome timing, and reliability signals.

**Architecture:** Use direct browser-side `gtag.js` as the primary GA4 transport. Add one small backend analytics context endpoint that returns only feature flags, the measurement ID, and pseudonymous identifiers derived server-side. Instrument browser UX and API outcomes through an allowlisted analytics wrapper. Do not add Measurement Protocol in this slice; if later server-only events are needed, create a separate `EXEC-*` plan with an API-secret operating model.

**Tech Stack:** Flask, React 19, esbuild, `gtag.js`, GA4 Consent Mode v2, Python `unittest`, Node source-guard tests, Playwright UI/network assertions.

**External references checked on 2026-05-26:**
- Google Analytics event setup: https://developers.google.com/analytics/devguides/collection/ga4/events
- GA4 recommended events: https://developers.google.com/analytics/devguides/collection/ga4/reference/events
- GA4 User-ID: https://developers.google.com/analytics/devguides/collection/ga4/user-id
- Consent Mode: https://developers.google.com/tag-platform/security/guides/consent
- Event naming rules and reserved names: https://support.google.com/analytics/answer/13316687
- Custom dimension/metric limits and cardinality guidance: https://support.google.com/analytics/answer/14240153
- GA4 PII policy guidance: https://support.google.com/analytics/answer/6366371
- Event collection limits: https://support.google.com/analytics/answer/9267744

---

## Product Decisions

1. Use `G-6QERX19WB0` as the GA4 web stream Measurement ID. A separate numeric GA property ID in Google Admin is not used in website code.
2. Default consent to denied until the user grants analytics consent. `ad_storage`, `ad_user_data`, and `ad_personalization` stay denied for this internal productivity app unless a separate ads/marketing review changes that.
3. Send `user_id` only as a server-derived pseudonymous value. Never send raw Atlassian account IDs, emails, display names, workspace IDs, cloud IDs, site URLs, API tokens, OAuth codes, Jira issue keys, Home project IDs, or local file paths.
4. Do not send raw custom group names, team names, sprint names, project names, Jira labels, search terms, issue summaries, assignees, draft IDs, version IDs, JQL, Jira URLs, Home URLs, validation messages, imported JSON, or saved config payloads.
5. For user-requested "custom groups names" and "team names", collect usage safely as `filter_type`, `selection_count_bucket`, `team_count_bucket`, `group_count_bucket`, `scope_type`, and `source_surface`. Raw names belong in product-owned operational reporting, not GA4 custom dimensions.
6. Prefer GA4 recommended events where they match the action (`login`, `search`, `select_content`). Use a small set of custom events for app-specific workflows.
7. Keep event names below 40 characters and events below 25 parameters. Keep custom definitions below the standard GA4 quota: 50 event-scoped custom dimensions, 50 custom metrics, and 25 user properties.
8. Do not track hover/readout events unless throttled to once per chart per session. Native tooltip hover noise is out of scope.
9. Analytics must be non-blocking. A GA script failure or send failure must not block dashboard load, auth refresh, Jira fetches, EPM rollups, Scenario drafts, settings saves, or exports.

---

## Codebase Anchors

Core shell and security:
- `jira-dashboard.html:1` - HTML shell where Consent Mode and the Google tag loader belong.
- `jira-dashboard.html:16` - focus auth refresh script; analytics must not log callback query strings.
- `backend/security/headers.py:6` - CSP must allow the GA script and collect endpoints.
- `backend/app.py:17` - Flask app creation and blueprint registration.
- `jira_server.py:6494` - dashboard/static serving.

Auth and identity:
- `backend/auth/context.py:14` - request auth context contains raw identity fields that must never be sent directly.
- `backend/db/models.py:83` - `User` stores email/display name; do not send them to GA4.
- `backend/routes/auth_routes.py:22` - auth status.
- `backend/routes/auth_routes.py:354` - Atlassian login redirect.
- `backend/routes/auth_routes.py:372` - OAuth callback.
- `backend/routes/auth_routes.py:527` - logout.

Frontend data and UX:
- `frontend/src/api/http.js:1` - shared API helpers; use for browser-observed API timing only through an explicit allowlist.
- `frontend/src/dashboard.jsx:328` - top-level view state.
- `frontend/src/dashboard.jsx:4964` and `frontend/src/dashboard.jsx:11957` - global search logic and input.
- `frontend/src/dashboard.jsx:11985` - ENG/EPM view switch.
- `frontend/src/dashboard.jsx:12004` - ENG mode switch.
- `frontend/src/dashboard.jsx:12114` - sprint selector.
- `frontend/src/dashboard.jsx:12182` - group selector.
- `frontend/src/dashboard.jsx:12247` - team selector.
- `frontend/src/dashboard.jsx:12516` - header actions.
- `frontend/src/components/JiraExportButton.jsx:56` - Jira export action.

EPM:
- `frontend/src/epm/EpmControls.jsx:12` - EPM active/backlog/archived and project/sub-goal controls.
- `frontend/src/epm/EpmRollupPanel.jsx:48` - EPM project board interactions.
- `frontend/src/epm/EpmSettings.jsx:92` - EPM settings workflows.
- `backend/routes/epm_routes.py:96` - EPM Home projects.
- `backend/routes/epm_routes.py:137` and `backend/routes/epm_routes.py:154` - EPM rollup/issue endpoints.

Settings and connections:
- `frontend/src/settings/SettingsModal.jsx:33` - settings shell and tabs.
- `frontend/src/settings/JiraFieldSettings.jsx:151` - Jira field/admin settings.
- `frontend/src/settings/TeamGroupsSettings.jsx:79` - team group settings.
- `frontend/src/settings/UserConnectionsSettings.jsx:35` - Home token connection UX.
- `backend/routes/settings_routes.py:251` - config bootstrap.
- `backend/routes/user_connection_routes.py:70` - user Home/Townsquare token connection routes.

Scenario and statistics:
- `frontend/src/dashboard.jsx:5741` - scenario data loading.
- `frontend/src/dashboard.jsx:7579` - scenario bar edits.
- `frontend/src/dashboard.jsx:7650` - scenario undo/redo.
- `frontend/src/dashboard.jsx:7781` - scenario history.
- `frontend/src/dashboard.jsx:8086` - scenario writeback gate/preview.
- `frontend/src/dashboard.jsx:13071` - statistics view switch.
- `frontend/src/stats/BurnoutChart.jsx:214` - chart click/readout interactions.
- `frontend/src/stats/ExcludedCapacityLineChart.jsx:276` - excluded capacity chart readouts.
- `backend/routes/scenario_routes.py:11` - scenario compute route.
- `backend/routes/scenario_draft_routes.py:214` - scenario draft API.

---

## File Map

Create:
- `backend/routes/analytics_routes.py` - compact analytics context route.
- `backend/analytics/__init__.py` - package marker.
- `backend/analytics/identity.py` - HMAC-SHA256 pseudonymous ID helpers and bucket utilities.
- `frontend/src/analytics/analytics.js` - GA loader/context, consent handling, event send wrapper, sanitization, bucketing.
- `frontend/src/analytics/events.js` - event-name constants and allowlisted parameter schema.
- `tests/test_analytics_identity.py` - backend pseudonymous ID and context tests.
- `tests/test_analytics_routes.py` - Flask route tests for disabled/enabled context and no raw identity fields.
- `tests/test_analytics_source_guards.js` - source guard for forbidden analytics payload names and generated dist exclusion.
- `tests/ui/ga4_consent_and_events.spec.js` - Playwright network tests for denied consent, granted consent, and representative event payloads.

Modify:
- `backend/app.py` - register analytics blueprint.
- `backend/security/headers.py` - allow `https://www.googletagmanager.com`, `https://www.google-analytics.com`, and `https://region1.google-analytics.com` in CSP.
- `jira-dashboard.html` - add Consent Mode default and Google tag snippet in the correct order.
- `.env.example` - document analytics env flags and hash pepper.
- `README.md` - document local analytics setup and verification.
- `frontend/src/dashboard.jsx` - wire only top-level view/mode/search/filter/header/scenario/statistics events that cannot be localized to extracted components.
- `frontend/src/api/http.js` or specific API wrappers - add browser-observed API timing through an explicit endpoint allowlist.
- `frontend/src/epm/EpmControls.jsx`, `frontend/src/epm/EpmRollupPanel.jsx`, `frontend/src/epm/EpmSettings.jsx` - wire EPM interaction events.
- `frontend/src/settings/SettingsModal.jsx`, `frontend/src/settings/JiraFieldSettings.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/settings/UserConnectionsSettings.jsx` - wire settings and connection events.
- `frontend/src/stats/*.jsx` - wire click/filter events only; avoid unthrottled hover telemetry.

Do not modify:
- `frontend/dist/*` by hand.
- Scenario write-back capability or Home/Townsquare write gates.
- Jira/Home route auth behavior except the new read-only analytics context route.
- Saved config schemas unless strictly needed for a user-facing analytics consent preference.

---

## Environment Contract

Add these environment variables:

```bash
GA4_ENABLED=false
GA4_MEASUREMENT_ID=G-6QERX19WB0
GA4_USER_ID_PEPPER=
GA4_DEBUG_MODE=false
```

Rules:
- `GA4_ENABLED` must default to `false` in local/dev/test unless explicitly enabled.
- `GA4_MEASUREMENT_ID` must be validated as `G-[A-Z0-9]+`.
- `GA4_USER_ID_PEPPER` is required when `GA4_ENABLED=true` and an authenticated user id can be sent. Startup should fail closed if enabled without the pepper.
- `GA4_DEBUG_MODE=true` may add `debug_mode: true` to events for local GA DebugView validation only.
- Never log the pepper.

---

## User Identity Contract

Backend creates pseudonymous IDs:

```text
analytics_user_id = base64url(HMAC_SHA256(GA4_USER_ID_PEPPER, "user:" + RequestAuthContext.stable_subject))
analytics_workspace_id = base64url(HMAC_SHA256(GA4_USER_ID_PEPPER, "workspace:" + RequestAuthContext.workspace_id))
```

Only `analytics_user_id` is sent as GA4 `user_id`. `analytics_workspace_id` may be sent only as an unregistered event parameter for debugging during implementation; do not register it as a custom dimension because workspace IDs are high-cardinality.

`GET /api/analytics/context` returns:

```json
{
  "enabled": true,
  "measurementId": "G-6QERX19WB0",
  "debugMode": false,
  "consentRequired": true,
  "userId": "pseudonymous-value-or-null"
}
```

The response must not include raw Atlassian account IDs, emails, display names, workspace IDs, cloud IDs, Jira URLs, Home URLs, project keys, team IDs, group IDs, auth connection IDs, token versions, or service integration metadata.

---

## Event Catalog

Use these event names and parameters as the v1 allowlist. Do not add ad hoc event names from components.

| Decision | Event name | Trigger | Parameters |
| --- | --- | --- | --- |
| Auth adoption and recovery | `login` | Authenticated bootstrap after Atlassian OAuth or Basic local auth is confirmed | `method`, `auth_mode`, `result`, `source_surface` |
| Auth exit | `logout` | User-triggered logout completes | `auth_mode`, `source_surface` |
| ENG/EPM adoption | `select_content` | Top-level ENG/EPM view changes | `content_type=dashboard_view`, `item_id=eng|epm`, `from_view`, `source_surface` |
| ENG mode adoption | `select_content` | Catch Up, Planning, Statistics, or Scenario mode changes | `content_type=eng_mode`, `item_id`, `from_mode`, `source_surface` |
| Search friction | `search` | Debounced dashboard, EPM, or settings search submits/settles | `search_scope`, `query_length_bucket`, `result_count_bucket`, `source_surface` |
| Filter usage | `filter_changed` | Sprint, group, team, EPM project, stats, field, or issue-type filters change | `filter_type`, `selection_count_bucket`, `value_state`, `source_surface` |
| Header/tool actions | `select_content` | Refresh, settings open, update notice, Jira export | `content_type=tool_action`, `item_id`, `source_surface`, `visible_count_bucket` |
| Settings workflow | `settings_action` | Settings tab open, test, save, cancel, validation failure | `section`, `action`, `result`, `validation_count_bucket`, `dirty_state` |
| User connection workflow | `connection_action` | Home token connect/revoke/status recovery | `connection_type=home_townsquare`, `action`, `previous_status`, `result`, `error_code` |
| Planning selection | `planning_action` | Task select/deselect/bulk select/status include change | `action`, `status_bucket`, `selected_count_bucket`, `selected_sp_bucket` |
| Scenario compute and navigation | `scenario_action` | Scenario opened, computed, lane mode changed, conflicts-only toggled | `action`, `lane_mode`, `has_selected_sprint`, `issue_count_bucket`, `conflict_count_bucket` |
| Scenario edits | `scenario_action` | Drag/reschedule, undo, redo, discard, save draft, reload history | `action`, `override_count_bucket`, `has_conflicts`, `has_dep_violations`, `result` |
| Scenario writeback gate | `scenario_action` | Preview/writeback gate checked or blocked | `action=writeback_gate`, `result`, `blocking_reason`, `pending_unsaved_state` |
| Statistics adoption | `stats_action` | Stats view, metric, range, chart click-to-filter, legend filter | `stats_view`, `action`, `metric`, `range_size_bucket`, `source_surface` |
| Chart inspection | `chart_action` | Throttled chart click/readout, not raw hover | `chart_id`, `action`, `series_type`, `point_bucket`, `source_surface` |
| EPM controls | `epm_action` | EPM tab, project scope, sub-goal scope, expand/collapse, rollup load | `action`, `epm_tab`, `project_scope`, `subgoal_scope`, `project_count_bucket`, `result` |
| API reliability | `api_result` | Browser-observed allowlisted API response completes | `api_surface`, `method`, `status_bucket`, `result`, `duration_bucket`, `cache_state` |
| App errors | `app_error_shown` | User-visible server/auth/config unavailable state appears | `error_area`, `error_code`, `recoverable_state`, `source_surface` |

Use `select_content` only for low-cardinality content/action selections. Use custom event names for app workflow states. Do not use reserved event names such as `click`, `error`, `page_view`, `scroll`, `session_start`, `user_engagement`, or `view_search_results` as custom sends.

---

## Parameter Allowlist

Allowed event-scoped dimensions:
- `action`
- `api_surface`
- `auth_mode`
- `blocking_reason`
- `cache_state`
- `chart_id`
- `connection_type`
- `content_type`
- `dirty_state`
- `duration_bucket`
- `eng_mode`
- `epm_tab`
- `error_area`
- `error_code`
- `filter_type`
- `from_mode`
- `from_view`
- `has_dep_violations`
- `has_conflicts`
- `has_selected_sprint`
- `item_id`
- `lane_mode`
- `method`
- `metric`
- `pending_unsaved_state`
- `previous_status`
- `project_scope`
- `query_length_bucket`
- `range_size_bucket`
- `recoverable_state`
- `result`
- `result_count_bucket`
- `search_scope`
- `section`
- `selection_count_bucket`
- `selected_count_bucket`
- `selected_sp_bucket`
- `series_type`
- `source_surface`
- `stats_view`
- `status_bucket`
- `subgoal_scope`
- `value_state`
- `validation_count_bucket`
- `visible_count_bucket`

Allowed event-scoped metrics:
- `duration_ms`
- `visible_count`
- `selected_count`
- `selected_story_points`
- `override_count`
- `issue_count`
- `conflict_count`
- `unschedulable_count`
- `project_count`

Allowed user properties:
- `auth_mode`
- `analytics_consent_state`

Forbidden parameter/property names or values:
- `user_id` as a custom dimension or event parameter. GA4 `user_id` must be set through the config/set command only.
- `uid`, `userid`, `customer_id`, `session_id`, `sid`, `cid`, or any reserved `ga_`, `google_`, `firebase_`, `_`, or `gtag.` prefixes.
- Raw names, emails, account IDs, issue keys, Jira keys, Home IDs, URLs, labels, search text, assignees, owners, team/group names, sprint names, project names, field IDs, board IDs, draft IDs, version IDs, JQL, error messages, callback query strings, token material, local paths, or JSON payloads.

---

## Sub-Agent Implementation Handoff

Split implementation into disjoint tasks. Agents are not alone in the codebase; each worker must preserve other workers' changes and avoid editing files outside its ownership.

### Worker A: Analytics Foundation And Consent

Ownership:
- `jira-dashboard.html`
- `frontend/src/analytics/analytics.js`
- `frontend/src/analytics/events.js`
- `backend/security/headers.py`
- `.env.example`
- `README.md`
- `tests/test_analytics_source_guards.js`
- `tests/ui/ga4_consent_and_events.spec.js`

Tasks:
- [ ] Add Consent Mode default-denied initialization before loading the Google tag.
- [ ] Load `https://www.googletagmanager.com/gtag/js?id=G-6QERX19WB0` only when analytics context is enabled and consent allows analytics storage, or queue it behind the consent update path.
- [ ] Implement `initAnalytics`, `setAnalyticsConsent`, `setAnalyticsUser`, `trackEvent`, `trackRecommendedEvent`, `bucketCount`, `bucketDuration`, and `sanitizeAnalyticsParams`.
- [ ] Reject forbidden parameter names and values at runtime in development/test.
- [ ] Add CSP support for GA script and collect endpoints.
- [ ] Add Playwright assertions that denied consent sends no requests to `google-analytics.com` or `googletagmanager.com`, and granted consent sends only sanitized payloads.

Verification:
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `npx playwright test tests/ui/ga4_consent_and_events.spec.js`
- [ ] `npm run build`

### Worker B: Backend Analytics Context

Ownership:
- `backend/analytics/*`
- `backend/routes/analytics_routes.py`
- `backend/app.py`
- `tests/test_analytics_identity.py`
- `tests/test_analytics_routes.py`

Tasks:
- [ ] Add HMAC-SHA256 pseudonymous ID helper using `GA4_USER_ID_PEPPER`.
- [ ] Add analytics env parsing and fail-closed validation when analytics is enabled without required config.
- [ ] Add `/api/analytics/context` route that returns the compact contract in this plan.
- [ ] Register the blueprint from `backend/app.py`.
- [ ] Prove tests cannot observe raw `stable_subject`, `atlassian_account_id`, `email`, `display_name`, `workspace_id`, `cloud_id`, `site_url`, token fields, or route credentials in the response.

Verification:
- [ ] `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`

### Worker C: Product Event Wiring

Ownership:
- `frontend/src/dashboard.jsx`
- `frontend/src/api/http.js` or the specific API wrappers named below
- `frontend/src/epm/EpmControls.jsx`
- `frontend/src/epm/EpmRollupPanel.jsx`
- `frontend/src/epm/EpmSettings.jsx`
- `frontend/src/settings/SettingsModal.jsx`
- `frontend/src/settings/JiraFieldSettings.jsx`
- `frontend/src/settings/TeamGroupsSettings.jsx`
- `frontend/src/settings/UserConnectionsSettings.jsx`
- `frontend/src/stats/*.jsx`

Tasks:
- [ ] Wire `login`, `logout`, `select_content`, `search`, `filter_changed`, and `app_error_shown` at top-level dashboard/auth recovery surfaces.
- [ ] Wire settings and user connection events without sending config values or credential fields.
- [ ] Wire EPM controls and board events without Home project names, IDs, labels, goal keys, or URLs.
- [ ] Wire Scenario events for compute/open, edits, draft save/history, and writeback gate outcomes without issue keys, draft IDs, version IDs, assignees, or override payloads.
- [ ] Wire stats/chart events for view selection, filter changes, legend/click-to-filter, and throttled readouts. Do not instrument raw hover streams.
- [ ] Add browser-observed `api_result` only for allowlisted surfaces: `config_bootstrap`, `auth_status`, `home_connection`, `eng_tasks`, `stats_source`, `scenario`, `scenario_drafts`, `epm_projects`, `epm_rollup`, and `settings_save`.

Verification:
- [ ] `npm run build`
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `npx playwright test tests/ui/ga4_consent_and_events.spec.js`

### Worker D: Final Verification

Ownership:
- No production ownership unless fixing failures found in analytics files.

Tasks:
- [ ] Run a forbidden-payload source scan for `searchTerm`, `issue.key`, `assignee`, `displayName`, `email`, `team.name`, `group.name`, `project.name`, `label`, `jql`, `draftId`, `versionId`, `jiraUrl`, `homeUrl`, `apiToken`, `access_token`, `refresh_token`, `authorization`, and local absolute path patterns in analytics send calls.
- [ ] With consent denied, verify no GA network requests are made on initial load, view switches, search, filters, settings open, and scenario interactions.
- [ ] With consent granted and `GA4_DEBUG_MODE=true`, verify representative events appear in DebugView or network payloads with only allowed parameters.
- [ ] Run the full test suite before push.

Verification:
- [ ] `npm run build`
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `npx playwright test tests/ui/ga4_consent_and_events.spec.js`
- [ ] `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`
- [ ] `.venv/bin/python -m unittest discover -s tests`

---

## Execution Tasks

### Task 1: Add Analytics Foundation Tests

Files:
- Create `tests/test_analytics_source_guards.js`
- Create `tests/ui/ga4_consent_and_events.spec.js`

- [ ] Add a source-guard test that fails if analytics send calls include forbidden parameter names or string snippets from the forbidden list.
- [ ] Add a Playwright test that loads the dashboard with analytics enabled but consent denied and asserts no requests to GA domains.
- [ ] Add a Playwright test that grants analytics consent, performs one view switch, one search, and one filter action, then asserts network payloads use only allowlisted names and bucketed values.
- [ ] Run `node tests/test_analytics_source_guards.js` and `npx playwright test tests/ui/ga4_consent_and_events.spec.js`; expected result before implementation is failure.

### Task 2: Add Backend Identity And Context

Files:
- Create `backend/analytics/__init__.py`
- Create `backend/analytics/identity.py`
- Create `backend/routes/analytics_routes.py`
- Modify `backend/app.py`
- Create `tests/test_analytics_identity.py`
- Create `tests/test_analytics_routes.py`

- [ ] Implement HMAC-SHA256 pseudonymous ID helpers.
- [ ] Add env parsing for `GA4_ENABLED`, `GA4_MEASUREMENT_ID`, `GA4_USER_ID_PEPPER`, and `GA4_DEBUG_MODE`.
- [ ] Return disabled context when `GA4_ENABLED=false`.
- [ ] Fail closed when `GA4_ENABLED=true` and required measurement ID or pepper is missing.
- [ ] Return compact enabled context for authenticated users and `userId: null` for unauthenticated users.
- [ ] Prove route output excludes raw identity/config/credential fields.
- [ ] Run `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`.

### Task 3: Add Consent, Tag Loading, And CSP

Files:
- Modify `jira-dashboard.html`
- Modify `backend/security/headers.py`
- Create/modify `frontend/src/analytics/analytics.js`
- Create/modify `frontend/src/analytics/events.js`

- [ ] Add Consent Mode default-denied snippet before the Google tag.
- [ ] Add the Google tag loader for `G-6QERX19WB0` in the order required by Google Consent Mode.
- [ ] Implement consent persistence in first-party local storage or cookie using a project-specific key.
- [ ] Add runtime guards that no event is sent while analytics is disabled or consent is denied.
- [ ] Update CSP for GA script/connect endpoints.
- [ ] Run the Playwright denied-consent test and confirm no GA network calls.

### Task 4: Wire User Identity And App Bootstrap

Files:
- Modify `frontend/src/dashboard.jsx`
- Modify `frontend/src/analytics/analytics.js`
- Modify `frontend/src/api/authApi.js` only if the current auth-status helper is the cleanest context call site.

- [ ] Fetch `/api/analytics/context` once during app bootstrap after config/auth bootstrap is available.
- [ ] Set GA4 `user_id` only from the pseudonymous context `userId`.
- [ ] Set `user_id` to `null` on logout.
- [ ] Track `login` only after authenticated state is confirmed, not during redirects.
- [ ] Track auth-expired recovery as `app_error_shown` with `error_area=auth` and a sanitized `error_code`.

### Task 5: Wire Product Usage Events

Files:
- Modify the frontend files listed in Worker C ownership.

- [ ] Wire top-level view/mode changes.
- [ ] Wire search with `query_length_bucket` and `result_count_bucket`; never send the search term.
- [ ] Wire sprint/group/team filters with counts and scope enums; never send names or IDs.
- [ ] Wire settings open/test/save/cancel/result actions.
- [ ] Wire user Home/Townsquare connection connect/revoke/recovery events.
- [ ] Wire planning selection counts and story point buckets.
- [ ] Wire Scenario open/compute/edit/draft/history/writeback-gate actions.
- [ ] Wire Statistics and chart click/filter/readout actions with throttling.
- [ ] Wire EPM controls, settings, board expand/collapse, and rollup result actions.

### Task 6: Wire API Outcome Events

Files:
- Modify `frontend/src/api/http.js` or individual API wrapper modules:
  - `frontend/src/api/authApi.js`
  - `frontend/src/api/configApi.js`
  - `frontend/src/api/engApi.js`
  - `frontend/src/api/epmApi.js`

- [ ] Add a browser-observed allowlist of API surfaces. Do not infer event names from URLs.
- [ ] Record `duration_ms`, `duration_bucket`, `status_bucket`, `result`, and `cache_state` when available from response headers.
- [ ] Never send query strings, request bodies, response bodies, Jira errors, validation messages, or endpoint-specific identifiers.
- [ ] Keep API analytics failures swallowed and non-blocking.

### Task 7: Documentation And GA4 Admin Handoff

Files:
- Modify `README.md`
- Modify `.env.example`
- Reference `docs/plans/SUPPORT-ga4-user-configuration.md`

- [ ] Document local enablement and debug-mode verification.
- [ ] Document the consent behavior and the list of forbidden payload classes.
- [ ] Link the GA4 admin setup runbook.

### Task 8: Final Verification

- [ ] Run `npm run build`.
- [ ] Run `node tests/test_analytics_source_guards.js`.
- [ ] Run `npx playwright test tests/ui/ga4_consent_and_events.spec.js`.
- [ ] Run `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`.
- [ ] Run `.venv/bin/python -m unittest discover -s tests`.
- [ ] Inspect `git diff -- frontend/dist` after build and commit generated output if the build changes it.
- [ ] Record DebugView or network-payload evidence in the PR notes, redacting any local URLs or user identifiers.

---

## Rejected Scope

- Raw custom group names, team names, sprint names, project names, issue keys, assignees, or search terms in GA4.
- Server-side Measurement Protocol events and API secrets.
- Google Tag Manager container migration.
- Ads, remarketing, audiences, Google Signals, or ad personalization.
- Home/Townsquare writes or Scenario Jira write-back capability.
- Broad route-body or response-body analytics sampling.
- Per-user, per-team, per-project, or per-workspace custom dimensions.

