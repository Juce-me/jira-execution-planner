# GA4 Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

**Status:** Drafted on 2026-05-26 for GA4 Measurement ID `G-6QERX19WB0`. This is an implementation plan, not an executed code change.

**Revision notes:**
- 2026-05-26 review update: clarify that direct/ad hoc `page_view` sends are replaced by the controlled `pageview` dataLayer trigger, `user_id` is pseudonymous only and must not identify a specific person in GA4, Basic/local bootstrap does not emit repeated `login`, and durable analytics docs/agent rules are part of the deliverables.
- 2026-05-26 configuration update: allow GA4 Enhanced Measurement for scrolls, outbound clicks, file downloads, site-search results, and form submits after consent; keep GA4 default page URL/title metadata; store consent only in first-party localStorage; and remove DSR deletion workflow from this implementation scope.
- 2026-05-26 GTM schema update: use a web GTM container and a stable two-event `dataLayer` contract: `event: "pageview"` for logical page/view tracking and `event: "userevent"` for all product events. GTM needs only two custom-event triggers plus fixed pageview and user-event variable/parameter maps; new app events must not require new GTM triggers.

**Goal:** Add privacy-safe Google Analytics 4 tracking for Jira Execution Planner usage: authenticated user continuity, major view/mode adoption, search and filter usage, settings and connection flows, Scenario Planner actions, EPM usage, chart interactions, API outcome timing, and reliability signals.

**Architecture:** Use a Google Tag Manager web container as the browser transport. The app initializes `window.dataLayer`, defers loading the GTM container until analytics consent is granted, and pushes only two GTM trigger events: `pageview` and `userevent`. GTM owns the GA4 Google tag and GA4 Event tags, including the GA4 Measurement ID `G-6QERX19WB0`. App code owns the typed, sanitized dataLayer payload. Add one small backend analytics context endpoint that returns only feature flags, the GTM container ID, the GA4 measurement ID for verification, and pseudonymous identifiers derived server-side for real per-user OAuth/DB sessions. Do not add Measurement Protocol or server-side GTM in this slice; if later server-only events are needed, create a separate `EXEC-*` plan with an API-secret operating model.

**Tech Stack:** Flask, React 19, esbuild, Google Tag Manager web, `dataLayer.push`, GA4 Consent Mode v2, Python `unittest`, Node source-guard tests, Playwright UI/network assertions.

**External references checked on 2026-05-26:**
- Google Analytics event setup: https://developers.google.com/analytics/devguides/collection/ga4/events
- GA4 recommended events: https://developers.google.com/analytics/devguides/collection/ga4/reference/events
- GA4 User-ID: https://developers.google.com/analytics/devguides/collection/ga4/user-id
- Consent Mode: https://developers.google.com/tag-platform/security/guides/consent
- CSP for Google tags: https://developers.google.com/tag-platform/security/guides/csp
- GTM data layer: https://developers.google.com/tag-platform/tag-manager/datalayer
- GA4 setup in GTM: https://support.google.com/tagmanager/answer/9442095
- GA4 pageview behavior: https://developers.google.com/analytics/devguides/collection/ga4/views
- GA4 Enhanced Measurement events: https://support.google.com/analytics/answer/9216061
- GA4 DebugView: https://support.google.com/analytics/answer/7201382
- GA4 EU data and privacy controls: https://support.google.com/analytics/answer/12017362
- GA4 Measurement ID: https://support.google.com/analytics/answer/12270356
- Event naming rules and reserved names: https://support.google.com/analytics/answer/13316687
- Custom dimension/metric limits and cardinality guidance: https://support.google.com/analytics/answer/14240153
- GA4 PII policy guidance: https://support.google.com/analytics/answer/6366371
- Event collection limits: https://support.google.com/analytics/answer/9267744

---

## Product Decisions

1. Use `G-6QERX19WB0` as the GA4 web stream Measurement ID in GTM. A separate numeric GA property ID is not used in website code.
2. Default consent to denied until the user grants analytics consent. Store the app-owned consent preference only in first-party localStorage, never cookies or server config. The app must not create analytics-consent cookies; Google-managed GA storage after consent is controlled by Consent Mode and GA4 Admin. `ad_storage`, `ad_user_data`, and `ad_personalization` stay denied for this internal productivity app unless a separate ads/marketing review changes that.
3. Send GA4 `user_id` only as a server-derived pseudonymous value. GA4 users and reports must not identify a specific person, Atlassian account, workspace, tenant, or deployment. Never send raw Atlassian account IDs, emails, display names, workspace IDs, cloud IDs, site URLs, API tokens, OAuth codes, Jira issue keys, Home project IDs, local file paths, or IP addresses as app-owned GA4 event parameters or user properties.
4. Do not send raw custom group names, team names, sprint names, project names, Jira labels, search terms, issue summaries, assignees, draft IDs, version IDs, JQL, Jira URLs, Home URLs, validation messages, imported JSON, or saved config payloads.
5. For user-requested "custom groups names" and "team names", collect usage safely as `filter_type`, `selection_count_bucket`, `team_count_bucket`, `group_count_bucket`, `scope_type`, and `source_surface`. Raw names belong in product-owned operational reporting, not GA4 custom dimensions.
6. Prefer GA4 recommended events where their required parameter contract matches the privacy rules (`login`, `select_content`). Use a small set of custom events for app-specific workflows. Use `app_search` for app-owned search telemetry because it sends only query-length and result-count buckets. GA4 Enhanced Measurement `view_search_results` may also be enabled after consent for URL-query-driven site-search pages, accepting GA4's managed `search_term` behavior as an operator-configured automatic event.
7. Keep event names below 40 characters and events below 25 parameters. Keep custom definitions below the standard GA4 quota: 50 event-scoped custom dimensions, 50 custom metrics, and 25 user properties.
8. Do not track hover/readout events unless throttled to once per chart per session. Native tooltip hover noise is out of scope.
9. Analytics must be non-blocking. A GA script failure or send failure must not block dashboard load, auth refresh, Jira fetches, EPM rollups, Scenario drafts, settings saves, or exports.
10. Use `dataLayer.push({ event: "pageview", ... })` for logical page/view tracking. GTM maps this single trigger to the GA4 `page_view` event and may keep GA4 default page URL/title metadata. App-owned pageview fields must remain low-cardinality and must not include raw URLs, query strings, callback values, tokens, issue keys, or local file paths.
11. Allow GA4-managed Enhanced Measurement after consent for `scroll`, `click`, `view_search_results`, `file_download`, `form_start`, and `form_submit`. Do not recreate those reserved event names manually from app code; they may only come from GA4 automatic detection.
12. Direct browser GTM/GA4 cannot truncate the network source IP before Google receives the request. This plan therefore forbids IP addresses in app-owned GA4 payloads and relies on GA4 property controls and Google's GA4 IP handling. If a future requirement demands app-controlled IP truncation before Google, replace this architecture with server-side GTM or a first-party proxy in a separate plan.
13. Do not recreate Universal Analytics `event_category` / `event_action` / `event_label`. GA4 sends an `event_name` plus typed event parameters. Use GA4 recommended event names where they fit and use custom parameters only when they answer a named report decision.
14. GTM configuration must be stable: one Custom Event trigger for `pageview`, one Custom Event trigger for `userevent`, one pageview GA4 Event tag, and one generic user-event GA4 Event tag whose event name is read from the `ga4_event_name` dataLayer field. Adding a new product event should require code/schema/test updates only, not a new GTM trigger.

---

## Codebase Anchors

Core shell and security:
- `jira-dashboard.html:1` - HTML shell where Consent Mode, `dataLayer`, and the lazy GTM container loader belong.
- `jira-dashboard.html:16` - focus auth refresh script; analytics must not log callback query strings.
- `backend/security/headers.py:6` - CSP must allow the GTM script and GA4 collect endpoints.
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
- `backend/analytics/config.py` - import-safe analytics env parsing and fail-closed startup validation.
- `backend/routes/analytics_routes.py` - compact analytics context route.
- `backend/analytics/__init__.py` - package marker.
- `backend/analytics/identity.py` - HMAC-SHA256 pseudonymous ID helpers and bucket utilities.
- `frontend/src/analytics/analytics.js` - GTM loader/context, consent handling, dataLayer push wrapper, sanitization, bucketing.
- `frontend/src/analytics/events.js` - dataLayer contract, event-name constants, enum/bucket validators, and allowlisted parameter schema.
- `tests/test_analytics_identity.py` - backend pseudonymous ID and context tests.
- `tests/test_analytics_routes.py` - Flask route tests for disabled/enabled context and no raw identity fields.
- `tests/test_security_headers.py` - extend security header coverage for GA4 CSP directives.
- `tests/test_analytics_events.js` - unit tests for event schema validation, sanitizer rejection, and bucket helpers.
- `tests/test_analytics_source_guards.js` - source guard for forbidden analytics payload names and generated dist exclusion.
- `tests/ui/ga4_consent_and_events.spec.js` - Playwright network tests for denied consent, granted consent, and representative event payloads.
- `docs/README_ANALYTICS.md` - durable analytics contract after launch.

Modify:
- `backend/app.py` - register analytics blueprint.
- `backend/security/policy.py` - register `GET /api/analytics/context` as a read-only public context route that never mutates app data.
- `tests/test_endpoint_policy_inventory.py` and `tests/test_endpoint_security_matrix.py` - include the analytics context route in endpoint policy coverage for Basic, OAuth unauthenticated, and OAuth authenticated modes.
- `backend/security/headers.py` - update CSP directives for GTM-managed GA4:
  - `script-src`: keep existing app sources and add `https://*.googletagmanager.com`.
  - `img-src`: keep existing app sources and add `https://*.google-analytics.com` and `https://*.googletagmanager.com`.
  - `connect-src`: keep existing app sources and add `https://*.google-analytics.com`, `https://*.analytics.google.com`, and `https://*.googletagmanager.com`.
  - Do not add Google Ads or DoubleClick endpoints in this slice because ad features stay disabled.
- `jira-dashboard.html` - initialize `window.dataLayer` and lazy-load the GTM container in the correct order.
- `.env.example` - document analytics env flags and hash pepper.
- `README.md` - document local analytics setup and verification.
- `AGENTS.md` - require analytics impact review for future user-visible feature changes.
- `frontend/src/dashboard.jsx` - wire only top-level view/mode/search/filter/header/scenario/statistics events that cannot be localized to extracted components.
- `frontend/src/api/http.js` or specific API wrappers - add browser-observed API timing through an explicit endpoint allowlist.
- `frontend/src/api/scenarioApi.js` and `frontend/src/api/statsApi.js` if created during implementation - move Scenario Planner and stats-source fetches behind named wrappers before adding API timing events.
- `frontend/src/components/JiraExportButton.jsx` - wire Jira export tool action if it cannot be cleanly tracked through a parent callback.
- `frontend/src/eng/useEngSprintData.js` - wire user-visible ENG auth/task error surfaces if they cannot be cleanly tracked through a parent callback.
- `frontend/src/epm/EpmControls.jsx`, `frontend/src/epm/EpmRollupPanel.jsx`, `frontend/src/epm/EpmSettings.jsx` - wire EPM interaction events.
- `frontend/src/settings/SettingsModal.jsx`, `frontend/src/settings/JiraFieldSettings.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/settings/UserConnectionsSettings.jsx` - wire settings and connection events.
- `frontend/src/stats/*.jsx` - wire click/filter events only; avoid unthrottled hover telemetry.

Do not modify:
- `frontend/dist/*` by hand.
- Scenario write-back capability or Home/Townsquare write gates.
- Jira/Home route auth behavior except the new read-only analytics context route.
- Saved config schemas unless strictly needed for a user-facing analytics consent preference.

Generated outputs after `npm run build`:
- Commit generated `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css` if the build changes them.

---

## Environment Contract

Add these environment variables:

```bash
GA4_ENABLED=false
GTM_CONTAINER_ID=
GA4_MEASUREMENT_ID=G-6QERX19WB0
GA4_USER_ID_PEPPER=
GA4_DEBUG_MODE=false
```

Rules:
- `GA4_ENABLED` must default to `false` in local/dev/test unless explicitly enabled.
- `GTM_CONTAINER_ID` must be validated as `^GTM-[A-Z0-9]+$` and is required when `GA4_ENABLED=true`.
- `GA4_MEASUREMENT_ID` must be validated as `^G-[A-Z0-9]+$`.
- `GA4_USER_ID_PEPPER` is required when `GA4_ENABLED=true` and an authenticated user id can be sent. Startup should fail closed if enabled without the pepper.
- `GA4_DEBUG_MODE=true` may add `debug_mode: true` to dataLayer payloads for local GA DebugView validation only. GTM maps it to GA4 as a transport/debug parameter, not a custom dimension. Omit it entirely when disabled; do not send `debug_mode:false`.
- Never log the pepper.

---

## User Identity Contract

Backend creates a pseudonymous user ID only when the request has a real per-user OAuth/DB identity:

```text
analytics_user_id = base64url(HMAC_SHA256(GA4_USER_ID_PEPPER, "user:" + RequestAuthContext.stable_subject))
```

Only `analytics_user_id` is sent as GA4 `user_id`. It is not a product user id, Atlassian account id, database id, email hash, or lookup key exposed to GA4 operators. Do not create dashboards, custom dimensions, exports, logs, or docs that map GA4 `user_id` values back to specific people. Return `ga4UserId: null` unless all of these are true: the auth context is authenticated, `RequestAuthContext.stable_subject` is present, the subject is not `local-basic`, and the auth mode represents a real per-user OAuth/DB identity. Add a negative test proving an OAuth-mode request with no session and no stable subject does not call the HMAC helper. Do not derive or send a workspace hash; workspace and deployment identifiers are high-cardinality and can identify a deployment.

`GET /api/analytics/context` returns:

```json
{
  "enabled": true,
  "gtmContainerId": "GTM-XXXXXXX",
  "measurementId": "G-6QERX19WB0",
  "debugMode": false,
  "consentRequired": true,
  "ga4UserId": "pseudonymous-value-or-null"
}
```

The response must not include raw Atlassian account IDs, emails, display names, workspace IDs, cloud IDs, Jira URLs, Home URLs, project keys, team IDs, group IDs, auth connection IDs, token versions, or service integration metadata.

## Analytics Context Route Contract

| Case | Expected response | Notes |
| --- | --- | --- |
| `GA4_ENABLED=false` | `200 {"enabled": false, "gtmContainerId": null, "measurementId": null, "debugMode": false, "consentRequired": true, "ga4UserId": null}` | Must not require auth and must not expose config details. |
| `GA4_ENABLED=true` with missing/invalid `GTM_CONTAINER_ID` | Startup/config validation failure before serving requests | The browser cannot load GTM without a valid container ID. |
| `GA4_ENABLED=true` with missing/invalid `GA4_MEASUREMENT_ID` | Startup/config validation failure before serving requests | Keep app config and GTM runbook tied to the same GA4 web stream. |
| `GA4_ENABLED=true` with missing `GA4_USER_ID_PEPPER` | Startup/config validation failure before serving requests | Required because enabled OAuth/DB sessions can set `user_id`. |
| Basic/local shared auth | `200` enabled context with `ga4UserId: null` | Never send a shared `local-basic` user as GA4 User-ID. |
| Unauthenticated or expired OAuth/browser session | `200` enabled context with `ga4UserId: null` | The route is read-only and must not redirect or leak auth state; product auth recovery remains owned by existing auth routes. |
| Authenticated DB/OAuth user | `200` enabled context with pseudonymous `ga4UserId` | Pseudonym must be stable for the same user and pepper, different across users, and not reversible by GA4 property users. |
| Unsupported method | `405` | Only `GET` is allowed. |

Route rules:
- Do not require CSRF for `GET /api/analytics/context`.
- Do include the existing `X-Requested-With` client convention when calling from the browser for consistency with app APIs. If the implementation uses `getJson`, update that helper to add the header for GET requests or pass the header explicitly at the analytics context call site.
- Return `Cache-Control: no-store` because the response can depend on signed-in user state.
- Do not make Jira, Home/Townsquare, database fan-out, or external Google calls from the context route.
- Do not include workspace/site/cloud boundaries in the response. Use them only as internal inputs if later cache partitioning is needed.

## Privacy Lifecycle

- Treat GA4 `user_id` as pseudonymous personal data. It must support aggregate continuity only, not person-level reporting.
- Do not register `user_id` as a custom dimension or event parameter, and do not build reports grouped by GA4 `user_id`.
- This implementation plan does not add a GA4 data-subject-request or account-deletion workflow. If a future legal/privacy requirement needs GA4 user deletion, write a separate `EXEC-*` plan that covers GA Admin deletion credentials, downstream exports, client-ID-only events, audit evidence, and pepper rotation.
- If `GA4_USER_ID_PEPPER` rotates before a separate deletion workflow exists, the rotation note must state that older pseudonymous IDs are intentionally not recomputable by this app.

---

## DataLayer Contract

App code must push flat JavaScript objects with `window.dataLayer.push({ ... })`. Do not use a `dataLayer(...)` function call, do not call `gtag('event', ...)` from app code, and do not create one dataLayer `event` value per product action.

Only these two app-owned dataLayer trigger names are allowed:

1. `pageview` - logical page/view tracking.
2. `userevent` - all app-owned product events.

Pageview payload shape:

```js
window.dataLayer.push({
  event: 'pageview',
  logical_page: 'dashboard',
  dashboard_view: 'eng',
  eng_mode: 'scenario',
  auth_mode: 'oauth',
  source_surface: 'dashboard',
  ga4_user_id: 'pseudonymous-value-or-null',
  debug_mode: true
});
```

GTM maps the `pageview` Custom Event trigger to one GA4 Event tag named `page_view`. The GA4 tag keeps default page URL/title metadata; the app-owned fields above provide low-cardinality product context.

User-event payload shape:

```js
window.dataLayer.push({
  event: 'userevent',
  ga4_event_name: 'scenario_action',
  workflow_action: 'compute',
  source_surface: 'scenario',
  lane_mode: 'team',
  result: 'success',
  duration_bucket: '1_3s',
  debug_mode: true
});
```

GTM maps the `userevent` Custom Event trigger to one generic GA4 Event tag whose Event Name is `{{DLV - ga4_event_name}}`. The tag maps the full fixed property set from the Event Parameter Contract below. Undefined variables are ignored; adding a new value for an existing property must not require a GTM change. Adding a new property key requires updating this plan, `docs/README_ANALYTICS.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, `frontend/src/analytics/events.js`, tests, and the single GTM variable/parameter map.

Configuration rule:
- No additional GTM trigger, tag, or variable is required when adding a new app event name to the taxonomy if it uses `event: 'userevent'`, an allowlisted `ga4_event_name` value, and only existing property keys from the fixed user-event map.
- New GTM configuration is required only when introducing a new dataLayer property key, a new GA4 destination, or a new consent/transport behavior.
- App-owned code must never push raw URLs, query strings, issue keys, names, token material, IP addresses, JSON payloads, or free text into either dataLayer payload shape.

---

## Event Catalog

Use these event names and parameters as the v1 allowlist. Do not add ad hoc event names from components.

| Decision | Event name | Trigger | Parameters |
| --- | --- | --- | --- |
| Logical page/view adoption | `page_view` | GTM receives `dataLayer.event=pageview` on dashboard load and logical view/mode transitions | `logical_page`, `dashboard_view`, `eng_mode`, `auth_mode`, `source_surface` |
| Auth adoption and recovery | `login` | OAuth authenticated transition only, after the browser moves from unauthenticated/unknown to authenticated in the current session | `method`, `auth_mode`, `result`, `source_surface` |
| Auth exit | `logout` | User-triggered logout completes | `auth_mode`, `source_surface` |
| ENG/EPM adoption | `select_content` | Top-level ENG/EPM view changes | `content_type=dashboard_view`, `content_id=eng|epm`, `from_view`, `source_surface` |
| ENG mode adoption | `select_content` | Catch Up, Planning, Statistics, or Scenario mode changes | `content_type=eng_mode`, `content_id`, `from_mode`, `source_surface` |
| Search friction | `app_search` | Debounced dashboard, EPM, or settings search submits/settles | `search_scope`, `query_length_bucket`, `result_count_bucket`, `source_surface` |
| Filter usage | `filter_changed` | Sprint, group, team, EPM project, stats, field, or issue-type filters change | `filter_type`, `selection_count_bucket`, `team_count_bucket`, `group_count_bucket`, `scope_type`, `value_state`, `source_surface` |
| Header/tool actions | `select_content` | Refresh, settings open, update notice, Jira export | `content_type=tool_action`, `content_id`, `source_surface`, `visible_count_bucket` |
| Settings workflow | `settings_action` | Settings tab open, test, save, cancel, validation failure | `section`, `workflow_action`, `result`, `validation_count_bucket`, `dirty_state` |
| User connection workflow | `connection_action` | Home token connect/revoke/status recovery | `connection_type=home_townsquare`, `workflow_action`, `previous_status`, `result`, `error_code` |
| Planning selection | `planning_action` | Task select/deselect/bulk select/status include change | `workflow_action`, `status_bucket`, `selected_count_bucket`, `selected_sp_bucket` |
| Scenario compute and navigation | `scenario_action` | Scenario opened, computed, lane mode changed, conflicts-only toggled | `workflow_action`, `lane_mode`, `has_selected_sprint`, `issue_count_bucket`, `conflict_count_bucket` |
| Scenario edits | `scenario_action` | Drag/reschedule, undo, redo, discard, save draft, reload history | `workflow_action`, `override_count_bucket`, `has_conflicts`, `has_dep_violations`, `result` |
| Scenario writeback gate | `scenario_action` | Preview/writeback gate checked or blocked | `workflow_action=writeback_gate`, `result`, `blocking_reason`, `pending_unsaved_state` |
| Statistics adoption | `stats_action` | Stats view, metric, range, chart click-to-filter, legend filter | `stats_view`, `workflow_action`, `metric`, `range_size_bucket`, `source_surface` |
| Chart inspection | `chart_action` | Throttled chart click/readout, not raw hover | `chart_id`, `workflow_action`, `series_type`, `point_bucket`, `source_surface` |
| EPM controls | `epm_action` | EPM tab, project scope, sub-goal scope, expand/collapse, rollup load | `workflow_action`, `epm_tab`, `project_scope`, `subgoal_scope`, `project_count_bucket`, `result` |
| API reliability | `api_result` | Browser-observed allowlisted API response completes | `api_surface`, `method`, `status_bucket`, `result`, `duration_bucket`, `cache_state` |
| App errors | `app_error_shown` | User-visible server/auth/config unavailable state appears | `error_area`, `error_code`, `recoverable_state`, `source_surface` |

Use `select_content` only for low-cardinality content/action selections. Use custom event names for app workflow states. Do not use reserved event names such as `click`, `error`, `page_view`, `scroll`, `session_start`, `user_engagement`, `view_search_results`, `file_download`, `form_start`, or `form_submit` through `event=userevent`. The only app-owned path to GA4 `page_view` is the `event=pageview` GTM trigger.

GA4-managed Enhanced Measurement events allowed after consent:
- `scroll`
- `click`
- `view_search_results`
- `file_download`
- `form_start`
- `form_submit`

These automatic events are configured in GA4 Admin, not emitted through `frontend/src/analytics/events.js`. Do not register their URL, link, file, form, or search-term parameters as custom definitions in v1 unless a separate reporting decision explicitly needs them.

Automated tracking is useful for generic web engagement, but it is not a substitute for app-owned events. Scenario Planner, EPM, settings, auth recovery, planning, and API reliability need typed domain parameters and privacy bucketing that Enhanced Measurement cannot infer. Keep both layers separate: GA4-managed events cover generic browser interactions; app-owned events cover product decisions.

---

## Event Parameter Contract

The contract below is a validation allowlist, not a GA4 admin registration list. These are event parameters, not legacy `event_action` or `event_label` fields. The implementation must not emit `event_category`, `event_action`, or `event_label`.

DataLayer control fields:
- `event` is the GTM trigger name and must be only `pageview` or `userevent`.
- `ga4_event_name` is the GA4 event name used only by the GTM `userevent` tag; it is not sent as a GA4 event parameter.
- `ga4_user_id` is mapped by GTM to GA4 User-ID; it is not sent as a GA4 event parameter or custom dimension.
- `debug_mode` is mapped by GTM only when `GA4_DEBUG_MODE=true`; it is not a custom dimension.

Allowed event-scoped dimensions:
- `api_surface`
- `auth_mode`
- `blocking_reason`
- `cache_state`
- `chart_id`
- `connection_type`
- `content_id`
- `content_type`
- `conflict_count_bucket`
- `dashboard_view`
- `dirty_state`
- `duration_bucket`
- `eng_mode`
- `epm_tab`
- `error_area`
- `error_code`
- `filter_type`
- `from_mode`
- `from_view`
- `group_count_bucket`
- `has_dep_violations`
- `has_conflicts`
- `has_selected_sprint`
- `issue_count_bucket`
- `lane_mode`
- `logical_page`
- `method`
- `metric`
- `override_count_bucket`
- `pending_unsaved_state`
- `point_bucket`
- `previous_status`
- `project_count_bucket`
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
- `scope_type`
- `stats_view`
- `status_bucket`
- `subgoal_scope`
- `team_count_bucket`
- `value_state`
- `validation_count_bucket`
- `visible_count_bucket`
- `workflow_action`

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

GA4 admin registration budget:
- Do not register every allowed event parameter as a custom dimension.
- Initial registration should stay near 20 event-scoped custom dimensions and must stay below 25 unless a named report requires more.
- Allowed but unregistered parameters may still be sent when validated by the event schema; register them later only when a named report needs them.

Forbidden parameter/property names or values:
- `user_id` as a custom dimension or event parameter. GA4 `user_id` must be set through the config/set command only.
- Google-reserved event parameter names: `cid`, `currency`, `customer_id`, `customerid`, `dclid`, `gclid`, `session_id`, `sessionid`, `sfmc_id`, `sid`, `srsltid`, `uid`, `user_id`, and `userid`.
- Google-reserved user property names: `cid`, `customer_id`, `customerid`, `first_open_after_install`, `first_open_time`, `first_visit_time`, `google_allow_ad_personalization_signals`, `last_advertising_id_reset`, `last_deep_link_referrer`, `last_gclid`, `lifetime_user_engagement`, `non_personalized_ads`, `session_id`, `session_number`, `sessionid`, `sfmc_id`, `sid`, `uid`, `user_id`, and `userid`.
- Any parameter or user-property name with reserved `ga_`, `google_`, `firebase_`, `_`, or `gtag.` prefixes. Treat `query_id` as a reserved event-name prefix.
- Locally forbidden in v1 because ecommerce/item analytics are out of scope: `item_id`, `item_name`, `item_brand`, `item_category`, `item_list_id`, `item_list_name`, `promotion_id`, and `promotion_name`.
- Raw names, emails, account IDs, issue keys, Jira keys, Home IDs, URLs, labels, search text, assignees, owners, team/group names, sprint names, project names, field IDs, board IDs, draft IDs, version IDs, JQL, error messages, callback query strings, token material, local paths, IP addresses, or JSON payloads in app-owned custom events.

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
- `tests/test_analytics_events.js`
- `tests/test_analytics_source_guards.js`
- `tests/ui/ga4_consent_and_events.spec.js`

Tasks:
- [ ] Add Consent Mode default-denied initialization before loading the GTM container.
- [ ] Define `window.dataLayer` and default-denied consent in the HTML shell without making a network request to Google.
- [ ] Inject `https://www.googletagmanager.com/gtm.js?id=<GTM_CONTAINER_ID>` only after analytics context is enabled and the user grants analytics consent.
- [ ] Do not call `gtag('event', ...)` from app code. App code may only call `window.dataLayer.push(...)` through the central analytics wrapper.
- [ ] Do not override `page_location` or `page_title` in v1; GA4 default page URL/title metadata is accepted after consent for GA4-managed events. App-owned custom events must not include raw URLs or titles as parameters.
- [ ] Persist analytics consent only in first-party localStorage using key `jep.analyticsConsent.v1` with values `granted` or `denied`. Default missing/unknown values to denied. Do not use cookies.
- [ ] Implement `initAnalytics`, `setAnalyticsConsent`, `setAnalyticsUser`, `trackPageview`, `trackEvent`, `bucketCount`, `bucketDuration`, and `sanitizeAnalyticsParams`.
- [ ] Implement a central event schema that validates dataLayer trigger names, GA4 event names, allowed parameters, enum values, bucket formats, booleans, and numeric metric fields before any push reaches `window.dataLayer`.
- [ ] Reject forbidden parameter names and values at runtime in development/test for app-owned custom events, including dynamic values such as selected project names, sprint labels, team/group objects, Jira error text, URLs, query strings, issue keys, IP addresses, and Home/Jira labels.
- [ ] Add CSP support for GA script, image, and collect endpoints using the directive-specific file map above.
- [ ] Add `tests/test_security_headers.py` assertions for `script-src`, `img-src`, and `connect-src`.
- [ ] Add Playwright assertions that denied consent sends no requests to `google-analytics.com` or `googletagmanager.com`, granted consent loads GTM without CSP violations, app-owned code pushes only `event=pageview` or `event=userevent`, app-owned payloads contain only sanitized allowlisted parameters, and GA4-managed Enhanced Measurement events can fire only after consent.

Verification:
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `node tests/test_analytics_events.js`
- [ ] `npx playwright test tests/ui/ga4_consent_and_events.spec.js`
- [ ] `.venv/bin/python -m unittest tests.test_security_headers`
- [ ] `npm run build`

### Worker B: Backend Analytics Context

Ownership:
- `backend/analytics/config.py`
- `backend/analytics/*`
- `backend/routes/analytics_routes.py`
- `backend/app.py`
- `backend/security/policy.py`
- `tests/test_analytics_identity.py`
- `tests/test_analytics_routes.py`
- `tests/test_endpoint_policy_inventory.py`
- `tests/test_endpoint_security_matrix.py`

Tasks:
- [ ] Add HMAC-SHA256 pseudonymous ID helper using `GA4_USER_ID_PEPPER`.
- [ ] Add import-safe analytics env parsing and a named startup validation hook that fails closed when analytics is enabled without required config.
- [ ] Add `/api/analytics/context` route that returns the compact contract in this plan.
- [ ] Register the blueprint from `backend/app.py`.
- [ ] Register `/api/analytics/context` in the endpoint policy registry and prove it is classified exactly once.
- [ ] Prove disabled, misconfigured, Basic/local, unauthenticated/expired OAuth, and authenticated DB/OAuth behavior from the route contract table.
- [ ] Prove an OAuth-mode request with no session or empty stable subject returns `ga4UserId:null` and does not call the HMAC helper.
- [ ] Prove tests cannot observe raw `stable_subject`, `atlassian_account_id`, `email`, `display_name`, `workspace_id`, `cloud_id`, `site_url`, token fields, or route credentials in the response.

Verification:
- [ ] `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`

### Worker C: Product Event Wiring

Ownership:
- `frontend/src/dashboard.jsx`
- `frontend/src/api/http.js` or the specific API wrappers named below
- `frontend/src/api/scenarioApi.js` and `frontend/src/api/statsApi.js` if created to replace raw Scenario/stats fetches before instrumentation
- `frontend/src/components/JiraExportButton.jsx`
- `frontend/src/eng/useEngSprintData.js`
- `frontend/src/epm/EpmControls.jsx`
- `frontend/src/epm/EpmRollupPanel.jsx`
- `frontend/src/epm/EpmSettings.jsx`
- `frontend/src/settings/SettingsModal.jsx`
- `frontend/src/settings/JiraFieldSettings.jsx`
- `frontend/src/settings/TeamGroupsSettings.jsx`
- `frontend/src/settings/UserConnectionsSettings.jsx`
- `frontend/src/stats/*.jsx`

Tasks:
- [ ] Wire `login`, `logout`, `select_content`, `app_search`, `filter_changed`, and `app_error_shown` at top-level dashboard/auth recovery surfaces.
- [ ] Wire settings and user connection events without sending config values or credential fields.
- [ ] Wire EPM controls and board events without Home project names, IDs, labels, goal keys, or URLs.
- [ ] Wire Scenario events for compute/open, edits, draft save/history, and writeback gate outcomes without issue keys, draft IDs, version IDs, assignees, or override payloads.
- [ ] Wire stats/chart events for view selection, filter changes, legend/click-to-filter, and throttled readouts. Do not instrument raw hover streams.
- [ ] Add browser-observed `api_result` only for allowlisted surfaces: `config_bootstrap`, `auth_status`, `home_connection`, `eng_tasks`, `stats_source`, `scenario`, `scenario_drafts`, `epm_projects`, `epm_rollup`, and `settings_save`.
- [ ] For `stats_source`, emit one `api_result` per logical stats load, not one event per progressive sprint chunk, unless a named report needs chunk-level reliability.
- [ ] For Scenario Planner fetches, use explicit `api_surface=scenario` or `api_surface=scenario_drafts`; do not infer surfaces from draft IDs, version URLs, query strings, or raw endpoint paths.

Verification:
- [ ] `npm run build`
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `npx playwright test tests/ui/ga4_consent_and_events.spec.js`

### Worker D: Final Verification

Ownership:
- No production ownership unless fixing failures found in analytics files.

Tasks:
- [ ] Run sanitizer unit tests with raw forbidden examples: search text, selected project names, sprint labels, team/group objects, Jira error text, URLs, query strings, issue keys, Home/Jira labels, draft IDs, version IDs, and token-like strings.
- [ ] Run a forbidden-payload source scan for `searchTerm`, `issue.key`, `assignee`, `displayName`, `email`, `team.name`, `group.name`, `project.name`, `label`, `jql`, `draftId`, `versionId`, `jiraUrl`, `homeUrl`, `apiToken`, `access_token`, `refresh_token`, `authorization`, IP-address patterns, and local absolute path patterns in app-owned analytics send calls. Treat this as a backstop, not the primary privacy test.
- [ ] With consent denied, verify no GA network requests are made on initial load, view switches, search, filters, settings open, and scenario interactions.
- [ ] With consent granted and `GA4_DEBUG_MODE=true`, verify one `pageview` dataLayer push and representative `userevent` pushes for app search, team/group/sprint/project filters, EPM, settings, connection, scenario, stats, and API outcomes. Verify network payloads/DebugView contain only allowed enum, bucket, boolean, and numeric app-owned values. Also verify GA4-managed `scroll`, `click`, `file_download`, `form_submit`, and `view_search_results` when those interactions are available in the test fixture.
- [ ] Run the full test suite before push.

Verification:
- [ ] `npm run build`
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `node tests/test_analytics_events.js`
- [ ] `npx playwright test tests/ui/ga4_consent_and_events.spec.js`
- [ ] `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`
- [ ] `.venv/bin/python -m unittest tests.test_security_headers`
- [ ] `.venv/bin/python -m unittest discover -s tests`

---

## Execution Tasks

### Task 1: Add Analytics Foundation Tests

Files:
- Create `tests/test_analytics_events.js`
- Create `tests/test_analytics_source_guards.js`
- Create `tests/ui/ga4_consent_and_events.spec.js`

- [ ] Add event schema tests that reject unknown event names, unknown parameters, reserved parameter names, malformed buckets, non-enum values, raw search terms, project/team/group/sprint names, issue keys, URLs/query strings, Jira error text, labels, draft/version IDs, token-like strings, and object payloads.
- [ ] Add a source-guard test that fails if analytics send calls include forbidden parameter names or string snippets from the forbidden list.
- [ ] Add a Playwright test that loads the dashboard with analytics enabled but consent denied and asserts no requests to `googletagmanager.com` or `google-analytics.com`.
- [ ] Add a Playwright test that grants analytics consent, performs one page/view transition, one app search, one sprint filter, one team/group filter, one EPM project filter, one settings action, one connection action, one scenario action, and one API action, then asserts dataLayer pushes use only `pageview`/`userevent` trigger names and network payloads use only allowlisted enum, bucket, boolean, and numeric values.
- [ ] Run `node tests/test_analytics_events.js`, `node tests/test_analytics_source_guards.js`, and `npx playwright test tests/ui/ga4_consent_and_events.spec.js`; expected result before implementation is failure.

### Task 2: Add Backend Identity And Context

Files:
- Create `backend/analytics/__init__.py`
- Create `backend/analytics/config.py`
- Create `backend/analytics/identity.py`
- Create `backend/routes/analytics_routes.py`
- Modify `backend/app.py`
- Modify `backend/security/policy.py`
- Modify `tests/test_endpoint_policy_inventory.py`
- Modify `tests/test_endpoint_security_matrix.py`
- Create `tests/test_analytics_identity.py`
- Create `tests/test_analytics_routes.py`

- [ ] Implement HMAC-SHA256 pseudonymous ID helpers.
- [ ] Add import-safe env parsing for `GA4_ENABLED`, `GTM_CONTAINER_ID`, `GA4_MEASUREMENT_ID`, `GA4_USER_ID_PEPPER`, and `GA4_DEBUG_MODE`, plus a named startup validation hook.
- [ ] Return disabled context when `GA4_ENABLED=false`.
- [ ] Fail closed when `GA4_ENABLED=true` and required measurement ID or pepper is missing.
- [ ] Return compact enabled context with `ga4UserId: null` for unauthenticated users, expired OAuth users, and Basic/local shared auth.
- [ ] Return compact enabled context with pseudonymous `ga4UserId` only for real per-user OAuth/DB users.
- [ ] Add endpoint policy and security-matrix coverage proving `GET /api/analytics/context` returns `200` in Basic, OAuth unauthenticated, and OAuth authenticated modes.
- [ ] Add `Cache-Control: no-store` to every context response.
- [ ] Prove route output excludes raw identity/config/credential fields.
- [ ] Run `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`.

### Task 3: Add Consent, Tag Loading, And CSP

Files:
- Modify `jira-dashboard.html`
- Modify `backend/security/headers.py`
- Create/modify `frontend/src/analytics/analytics.js`
- Create/modify `frontend/src/analytics/events.js`

- [ ] Add Consent Mode default-denied snippet before any possible GTM tag injection.
- [ ] Add lazy GTM container injection for `GTM_CONTAINER_ID` after the user grants analytics consent.
- [ ] Push logical page/view data through `dataLayer.push({ event: 'pageview', ... })`; do not add direct `gtag` event calls.
- [ ] Keep GA4 defaults for `page_location` and `page_title`; do not override them in app code.
- [ ] Implement consent persistence in first-party localStorage only, using `jep.analyticsConsent.v1`.
- [ ] Add runtime guards that no event is sent while analytics is disabled or consent is denied.
- [ ] Update CSP for GA script/connect endpoints.
- [ ] Extend `tests/test_security_headers.py` for the exact `script-src`, `img-src`, and `connect-src` directive additions.
- [ ] Run the Playwright denied-consent and post-consent CSP tests and confirm no denied-consent GA network calls and no post-consent CSP violation.

### Task 4: Wire User Identity And App Bootstrap

Files:
- Modify `frontend/src/dashboard.jsx`
- Modify `frontend/src/analytics/analytics.js`
- Modify `frontend/src/api/authApi.js` only if the current auth-status helper is the cleanest context call site.

- [ ] Fetch `/api/analytics/context` once during app bootstrap after config/auth bootstrap is available.
- [ ] Send the existing `X-Requested-With: jira-execution-planner` browser header with the context request.
- [ ] Set GA4 `user_id` only from the pseudonymous context `ga4UserId`.
- [ ] Set `user_id` to `null` on logout.
- [ ] Track `login` only on a transition from unauthenticated/unknown to authenticated within the current browser session, not on every Basic/local bootstrap, config reload, or OAuth status refresh.
- [ ] Track auth-expired recovery as `app_error_shown` with `error_area=auth` and a sanitized `error_code`.

### Task 5: Wire Product Usage Events

Files:
- Modify the frontend files listed in Worker C ownership.

- [ ] Wire top-level view/mode changes.
- [ ] Wire logical page/view transitions through `trackPageview`, which pushes `event=pageview`.
- [ ] Wire `app_search` with `query_length_bucket` and `result_count_bucket`; never send the search term.
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
  - `frontend/src/api/scenarioApi.js` if created to replace raw Scenario Planner fetches
  - `frontend/src/api/statsApi.js` if created to replace raw stats-source fetches

- [ ] Add a browser-observed allowlist of API surfaces. Do not infer event names from URLs.
- [ ] Define exact wrapper ownership for `scenario`, `scenario_drafts`, and `stats_source` before implementation; do not leave raw `fetch()` sites instrumented ad hoc in `dashboard.jsx`.
- [ ] Emit `stats_source` timing per logical stats load, not per progressive chunk, unless a named report requires chunk-level timing.
- [ ] Record `duration_ms`, `duration_bucket`, `status_bucket`, `result`, and `cache_state` when available from response headers.
- [ ] Never send query strings, request bodies, response bodies, Jira errors, validation messages, or endpoint-specific identifiers.
- [ ] Keep API analytics failures swallowed and non-blocking.

### Task 7: Documentation And GA4 Admin Handoff

Files:
- Modify `README.md`
- Modify `.env.example`
- Create `docs/README_ANALYTICS.md`
- Modify `AGENTS.md`
- Reference `docs/plans/SUPPORT-ga4-user-configuration.md`

- [ ] Document local enablement and debug-mode verification.
- [ ] Document the consent behavior and the list of forbidden payload classes.
- [ ] Document the durable analytics contract in `docs/README_ANALYTICS.md`, including event taxonomy, future-feature rules, custom-definition budget, privacy rules, and drift checks.
- [ ] Add an `AGENTS.md` rule requiring analytics impact review for future user-visible feature work.
- [ ] Link the GA4 admin setup runbook.

### Task 8: Final Verification

- [ ] Run `npm run build`.
- [ ] Run `node tests/test_analytics_source_guards.js`.
- [ ] Run `node tests/test_analytics_events.js`.
- [ ] Run `npx playwright test tests/ui/ga4_consent_and_events.spec.js`.
- [ ] Run `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`.
- [ ] Run `.venv/bin/python -m unittest tests.test_security_headers`.
- [ ] Run `.venv/bin/python -m unittest discover -s tests`.
- [ ] Inspect `git diff -- frontend/dist` after build and commit generated `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css` if the build changes them.
- [ ] Record DebugView or network-payload evidence in the PR notes, redacting any local URLs or user identifiers.

---

## Rejected Scope

- Raw custom group names, team names, sprint names, project names, issue keys, assignees, or search terms in app-owned custom GA4 events.
- Server-side Measurement Protocol events and API secrets.
- Server-side GTM migration.
- Per-event GTM triggers, per-event GTM tags, or ad hoc dataLayer `event` names beyond `pageview` and `userevent`.
- Ads, remarketing, audiences, Google Signals, or ad personalization.
- Home/Townsquare writes or Scenario Jira write-back capability.
- Broad route-body or response-body analytics sampling.
- Per-user, per-team, per-project, or per-workspace custom dimensions.
- GA4 data-subject-request or account-deletion workflow.
