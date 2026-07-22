# SUPPORT: GA4 User Configuration Runbook

**Status:** Drafted on 2026-05-26 for GA4 web stream Measurement ID `G-6QERX19WB0`. Use this runbook alongside `docs/plans/DONE-ga4-instrumentation.md`.

**Revision notes:**
- 2026-05-28: Re-verified the GA4/GTM configuration instructions against current Google docs and the latest `google-analytics-implementation-planner` MCP guidance. Added the custom MCP boundary, API-backed automation rules, and the dry-run desired-state spec at `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`.
- 2026-05-29: Re-verified the MCP handoff against the current `ga4-gtm-config-mcp` validator. The YAML spec now uses the strict validator schema, a concrete `target.environment` enum, supported GTM built-ins only, and current MCP-supported tag/config resources. Google tag setup, Enhanced Measurement toggles, retention, ads/signals settings, and full sparse event-parameter mapping remain manual runbook steps unless a later MCP release adds those resource types.

**Audience:** The GA4 property owner or operator configuring Google Analytics for Jira Delivery Planner.

**Important ID note:** `G-6QERX19WB0` is the GA4 web stream Measurement ID configured inside Google Tag Manager. GA Admin may also show a separate numeric property ID; do not place that numeric ID in app code or GTM tags.

---

## Preconditions

- You have Editor or Administrator access to the GA4 property that owns web stream `G-6QERX19WB0`.
- You have edit/publish access to the GTM web container used by this app.
- The implementation from `docs/plans/DONE-ga4-instrumentation.md` has shipped to the target environment.
- The deployment has set `GA4_ENABLED=true`, `GTM_CONTAINER_ID=<container id>`, `GA4_MEASUREMENT_ID=G-6QERX19WB0`, and a secret `GA4_USER_ID_PEPPER`.
- The deployment is approved for internal employee product analytics. This app does not implement an in-app analytics consent control; `GA4_ENABLED=false` is the app-level off switch and must prevent GTM/GA4 requests.

Official docs checked on 2026-05-29:
- Events: https://developers.google.com/analytics/devguides/collection/ga4/events
- User-ID: https://developers.google.com/analytics/devguides/collection/ga4/user-id
- CSP for Google tags: https://developers.google.com/tag-platform/security/guides/csp
- GTM data layer: https://developers.google.com/tag-platform/tag-manager/datalayer
- GA4 setup in GTM: https://support.google.com/tagmanager/answer/9442095
- GA4 event setup in GTM: https://support.google.com/tagmanager/answer/13034206
- GTM API v2 overview: https://developers.google.com/tag-platform/tag-manager/api/reference/rest
- GTM API workspace quick preview: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces/quick_preview
- GTM API workspace version creation: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces/create_version
- GTM API version publishing: https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.versions/publish
- Google Analytics MCP server: https://developers.google.com/analytics/devguides/MCP
- GA Admin API overview: https://developers.google.com/analytics/devguides/config/admin/v1/rest
- GA Admin API custom dimensions: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.customDimensions/create
- GA Admin API custom metrics: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.customMetrics
- GA Admin API key events: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.keyEvents/create
- GA Admin API Enhanced Measurement settings: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/EnhancedMeasurementSettings
- GA Admin API Enhanced Measurement update: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.dataStreams/updateEnhancedMeasurementSettings
- GA Admin API Measurement Protocol secrets: https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.dataStreams.measurementProtocolSecrets/create
- GA4 pageview behavior: https://developers.google.com/analytics/devguides/collection/ga4/views
- GA4 Enhanced Measurement events: https://support.google.com/analytics/answer/9216061
- GA4 DebugView: https://support.google.com/analytics/answer/7201382
- GA4 EU data and privacy controls: https://support.google.com/analytics/answer/12017362
- Measurement ID: https://support.google.com/analytics/answer/12270356
- Event naming and reserved names: https://support.google.com/analytics/answer/13316687
- Custom definitions and limits: https://support.google.com/analytics/answer/14240153
- PII guidance: https://support.google.com/analytics/answer/6366371
- Event collection limits: https://support.google.com/analytics/answer/9267744

---

## MCP Configuration Boundary

MCP configuration is possible only with a custom, write-capable MCP server that wraps the Google Analytics Admin API and Google Tag Manager API. The official Google Analytics MCP server is read-only for Analytics data exploration and must not be described as able to edit GA4 properties, web streams, custom definitions, Enhanced Measurement, or GTM containers.

Use `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` as the project-specific desired-state handoff. It must pass the custom MCP's strict schema before any dry-run diff or workspace apply. The default execution mode is `dry_run`; publishing is disabled; creating a GTM container version is disabled; deleting GTM entities, archiving GA4 custom definitions, changing consent settings, and storing secrets are disabled.

Confirmed API-backed MCP scope:
- The current custom MCP can use the GA Admin API with `analytics.edit` to create or update custom dimensions, custom metrics, and key events. It reads Measurement Protocol secret metadata only; Measurement Protocol remains disabled in v1, so secret creation must stay off unless a later plan and MCP release approve it.
- The current custom MCP can use the GTM API v2 to create a new workspace, enable supported built-in variables, create Data Layer Variables, create two Custom Event triggers, create GA4 Event tags, run quick preview, create a container version, and publish a version. Version creation and publish are gated because version creation materializes workspace changes and publish changes live collection.
- A custom MCP must work in a new GTM workspace, run workspace status/conflict checks, generate a dry-run diff, and produce a quick-preview or Tag Assistant validation artifact before any version or publish request.
- If the MCP server cannot map the logical tag names in the YAML spec to native GTM tag template/type parameters from the current API/library/exported container state, it must stop and ask for operator input. It must not fall back to Custom HTML, direct `gtag('event', ...)`, or ad hoc tags.
- The current MCP spec supports only GTM built-ins from this list: `Page URL`, `Page Path`, `Page Hostname`, `Referrer`, and `Event`. Do not include `Page Title`; GA4 default page-title behavior is accepted through the Google tag/GA4 web stream, not through an MCP-requested built-in variable.
- The current MCP schema caps each GA4 Event tag at 25 static event parameters. Use the YAML for the validator-compatible core mapping, then complete any remaining approved sparse event-parameter mappings manually from this runbook until the MCP supports a sparse allowlisted event-parameter variable or equivalent.
- The current MCP does not create the Google tag or edit Enhanced Measurement, retention, Google Signals, ads, or consent settings. Those remain manual operator steps in this runbook.

Project-specific rule: this repo intentionally uses two app-owned dataLayer trigger names, `pageview` and `userevent`. Do not convert it to a single top-level `userevent` trigger filtered by `event_type`. The latest planner skill supports that generic pattern, but this repository's root `AGENTS.md`, implementation plan, and analytics contract require the two-trigger GTM contract.

MCP publish gates:
1. Dry-run diff reviewed by the operator.
2. GTM quick preview or Tag Assistant validation passes.
3. GA4 DebugView/Realtime validation proves `page_view` and representative `userevent` hits arrive with allowed params only.
4. A human explicitly approves GTM container version creation.
5. A separate human approval explicitly permits publishing the created version.

---

## Property Setup

1. Open Google Analytics Admin.
2. Select the property that contains the web stream with Measurement ID `G-6QERX19WB0`.
3. Go to **Data streams** and confirm the web stream URL matches the deployed Jira Delivery Planner URL.
4. Create or select the GTM web container whose public ID is deployed as `GTM_CONTAINER_ID`.
5. In GTM, create a Google tag or GA4 configuration tag for Measurement ID `G-6QERX19WB0`, set `send_page_view=false`, and do not paste the GA4 numeric property ID into GTM. This app sends logical page views through the dedicated `pageview` Custom Event trigger; leaving automatic page views enabled can double-count page views.
6. Keep Google Signals and ad personalization disabled unless legal/privacy review explicitly approves advertising use.
7. Set data retention to the longest allowed period that matches company policy, commonly 14 months for standard GA4 properties.
8. Configure internal traffic filters if company policy requires excluding developer or office traffic.
9. In the web stream's Enhanced Measurement settings, allow Scrolls (`scroll`) when analytics is enabled. Allow Site search (`view_search_results`), file downloads (`file_download`), and form interactions (`form_start`, `form_submit`) only after the managed-metadata safety gate below passes for the deployed app. Keep outbound clicks (`click`) off in v1 unless operator configuration and tests prove Atlassian/Jira/Home `link_url` values cannot be sent; Jira issue-list links contain JQL and issue keys in `link_url`. Keep video engagement off unless the app later embeds YouTube content and a separate report needs it.
10. For app-controlled page views, use only the GTM `pageview` Custom Event trigger described below. Disable browser-history-change page-view tracking in Enhanced Measurement so route changes are not double-counted.
11. If company privacy policy wants less device/location detail, disable granular location and device data by region in GA4 Admin. With browser GTM/GA4, the app cannot pre-strip the network source IP before Google receives the request; this runbook relies on GA4's documented IP handling and forbids full IP addresses in app-owned event parameters. If a named internal report later needs IP-derived context, send only a server-generated truncated prefix such as `xxx.yyy.zzz.---`, never a full IP value.

---

## Internal Analytics And Tag Loading

This is an internal employee product. Analytics collection is governed by employee/internal tool policy and deployment configuration, not by an in-app per-user consent UI. Do not configure or document a consent grant/revoke workflow for v1.

`GA4_ENABLED=false` means the app must not load GTM and must not send GA4 requests. `GA4_ENABLED=true` means the app loads the configured GTM container after `/api/analytics/context` returns `enabled:true`; employee usage is measured without an app-owned opt-in prompt. Keep Google Signals, ads, remarketing, audiences, `ad_user_data`, and `ad_personalization` out of scope unless a separate review approves advertising use.

Operator check:
- With `GA4_ENABLED=false`, open the app in a fresh browser profile and verify no requests are sent to `googletagmanager.com` or `google-analytics.com`.
- With `GA4_ENABLED=true`, perform a view switch and verify the app pushes `event=pageview` to `dataLayer` and GTM sends a GA4 `page_view` with only the configured pageview parameters. Verify the Google tag has `send_page_view=false` and Enhanced Measurement browser-history page changes are disabled so GA4 does not emit duplicate automatic `page_view` events. GA4 default page URL/title metadata is allowed when analytics is enabled, but app-owned custom parameters must not contain OAuth callback markers, Jira/Home URLs, tokens, issue keys, full IP addresses, local file paths, or config payloads.
- With `GA4_ENABLED=true`, verify enabled Enhanced Measurement interactions can appear as GA4-managed events: 90% scroll (`scroll`), file link click (`file_download`), form submit (`form_submit`), and URL-query-driven site search (`view_search_results`) only when the managed-metadata safety gate below passes and the test environment exposes those interactions. Verify Jira/Home outbound links are counted only by app-owned `external_link_opened` events unless operator configuration and tests prove those `link_url` values cannot be sent through managed `click` collection.

### Enhanced Measurement Safety Gate

Before enabling any managed option beyond `scroll`, inventory the deployed page and test the resulting GA4 payloads in GTM Preview/DebugView:

- `view_search_results`: enable only if URL-query-driven search terms cannot contain raw user-entered dashboard/search text, issue keys, JQL, callback values, tokens, local paths, or Jira/Home URLs. If app search can contain user-entered text, keep this off and rely on app-owned `app_search` buckets.
- `file_download`: enable only if matching file links cannot expose Jira/Home/auth URLs, query strings, issue keys, tokens, local paths, or sensitive filenames through `link_url`, `file_name`, or link metadata.
- `form_start` and `form_submit`: enable only if form metadata cannot expose auth callback destinations, Jira/Home URLs, token-bearing query strings, user-entered text, credential field names, or sensitive submit text through form parameters.
- `click`: keep off unless Atlassian/Jira/Home destinations are excluded or another tested operator configuration proves their `link_url` values cannot be sent.

Record the safety-gate result in PR notes for the implementation. If any gate fails, leave that specific Enhanced Measurement option disabled and add an app-owned, bucketed event only if a named report needs it.

Tag loading must initialize `dataLayer` before loading GTM:

```js
window.dataLayer = window.dataLayer || [];

// After /api/analytics/context returns { enabled: true, gtmContainerId }:
// inject https://www.googletagmanager.com/gtm.js?id=<GTM_CONTAINER_ID>
```

App-owned analytics events must use `dataLayer.push({ event: 'pageview', ... })` or `dataLayer.push({ event: 'userevent', ... })`. Do not use direct `gtag('event', ...)` calls.

Do not override `page_location` or `page_title` in app code. GA4 defaults are accepted when analytics is enabled for the web stream. App-owned `pageview` and `userevent` payloads still must not pass raw URLs or titles as custom event parameters.

---

## User-ID Configuration

The app sends a server-derived pseudonymous `user_id` with GA4, not raw user identity. GA4 property users must not be able to identify a specific person from the GA4 User-ID value, custom definitions, reports, exports, PR notes, logs, or this runbook.

Allowed:
- HMAC-SHA256 output derived from `RequestAuthContext.stable_subject` and `GA4_USER_ID_PEPPER`.
- Pseudonymous `user_id` only for real per-user OAuth/DB identities.
- `null` on logout or expired auth.
- `null` for Basic/local shared auth, because the shared `local-basic` subject is not an individual user.
- No GA4 report, custom dimension, export, or admin workflow may map the pseudonymous value back to a specific person.

Forbidden:
- Atlassian account ID.
- Email address.
- Display name.
- Jira username.
- Workspace ID.
- Cloud ID.
- Auth connection ID.
- Service integration ID.
- Team or group name.

GA4 Admin steps:
1. Confirm GTM maps `ga4_user_id` to GA4 User-ID in the Google tag / GA4 settings path, not as a custom event parameter.
2. Do not create a custom dimension named `user_id`, `uid`, `userid`, `customer_id`, or anything equivalent.
3. Use GA4 reporting identity settings according to company policy. For internal product analytics, prefer an identity mode that uses User-ID when available without enabling ad personalization.
4. In DebugView, verify authenticated events include User-ID association while event parameters do not include identity fields.
5. In Basic/local shared mode, verify events have no GA4 User-ID association.

Privacy operations:
1. Treat GA4 User-ID as pseudonymous personal data, not anonymous data.
2. This implementation does not add a GA4 data-subject-request or account-deletion workflow. If policy later requires GA4 deletion, create a separate implementation plan that covers GA Admin deletion credentials, downstream exports, client-ID-only events, audit evidence, and pepper rotation.
3. Do not paste pseudonymous ids, source identities, local URLs, callback URLs, tokens, or raw DebugView payloads into plans, PR descriptions, or commit messages.

---

## GTM Schema Configuration

The app uses a stable two-trigger dataLayer schema. Do not create a new GTM trigger or tag for each app event.

Create the Google tag once for Measurement ID `G-6QERX19WB0` and configure it with `send_page_view=false`. The Google tag may set cookies and common GA4 settings, but app-controlled page views must be sent only by the `pageview` Custom Event path below. Do not use Custom HTML to deploy Google tag or GA4 event code.

App syntax is always object-push based:

```js
window.dataLayer.push({ event: 'pageview', /* pageview properties */ });
window.dataLayer.push({ event: 'userevent', event_name: 'scenario_action', /* event properties */ });
```

Do not configure GTM around product event names such as `scenario_action`, `settings_action`, `sort_changed`, `external_link_opened`, or `api_result` as Custom Event trigger names. Those values live in `event_name` and are read by the single `userevent` tag.

### Trigger 1: Pageview

Create one Custom Event trigger:

| GTM item | Value |
| --- | --- |
| Trigger type | Custom Event |
| Event name | `pageview` |
| Fires on | All Custom Events matching `pageview` |
| GA4 Event tag name | `GA4 - page_view from dataLayer pageview` |
| GA4 event name | `page_view` |

Create these Data Layer Variables and map them as GA4 event parameters on that tag:

| Data layer key | GA4 parameter | Notes |
| --- | --- | --- |
| `page_name` | `page_name` | Low-cardinality app page name, for example `dashboard`. |
| `dashboard_view` | `dashboard_view` | `eng` or `epm`. |
| `eng_mode` | `eng_mode` | `catch_up`, `planning`, `statistics`, or `scenario` when applicable. |
| `auth_mode` | `auth_mode` | Low-cardinality auth mode. |
| `source_surface` | `source_surface` | Where the pageview was produced. |
| `debug_mode` | `debug_mode` | Map only in debug environments; do not create a custom dimension. |

Map `ga4_user_id` to GA4 User-ID, not to an event parameter.

### Trigger 2: User Event

Create one Custom Event trigger:

| GTM item | Value |
| --- | --- |
| Trigger type | Custom Event |
| Event name | `userevent` |
| Fires on | All Custom Events matching `userevent` |
| GA4 Event tag name | `GA4 - dynamic app event from dataLayer userevent` |
| GA4 event name | Data Layer Variable `event_name` |

Create one Data Layer Variable for `event_name` and use it only as the GA4 Event Name. Do not send `event_name` as a GA4 event parameter.

Create Data Layer Variables once for all allowed app-owned user-event properties. Map every variable below as a GA4 event parameter on the single `userevent` tag; undefined values can be ignored by GTM/GA4. Every app-owned `userevent` push must include `feature_name`; every app-owned `pageview` push must include `page_name`.

```text
api_surface
auth_mode
blocking_reason
cache_state
chart_id
connection_type
content_id
content_type
conflict_count_bucket
conflict_state
dashboard_view
dependency_state
dirty_state
duration_bucket
eng_mode
epm_tab
error_area
error_code
feature_name
filter_type
from_mode
from_view
group_count_bucket
issue_count_bucket
issue_kind
lane_mode
link_type
page_name
method
metric
override_count_bucket
pending_unsaved_state
point_bucket
previous_status
project_count_bucket
project_scope
query_length_bucket
range_size_bucket
recoverable_state
result
result_count_bucket
search_scope
section
selection_count_bucket
selected_count_bucket
selected_sp_bucket
series_type
source_surface
scope_type
sort_direction
sort_key
sort_scope
sprint_selection_state
stats_view
status_bucket
subgoal_scope
team_count_bucket
value_state
validation_count_bucket
visible_count_bucket
workflow_action
duration_ms
visible_count
selected_count
selected_story_points
override_count
issue_count
conflict_count
unschedulable_count
project_count
```

No additional GTM configuration is required for a new app event name when it uses `event=userevent`, an allowlisted `event_name`, and only the properties above. GTM changes are required only when adding a new dataLayer property key, adding a new analytics destination, or changing tag transport behavior. Configure Data Layer Variables without default values so omitted app fields do not become blank GA4 parameters.

---

## Custom Definitions

Create only the following event-scoped custom dimensions initially. Do not register every allowed event parameter. This report-backed core set uses 36 of 50 standard-property event-scoped custom-dimension slots and leaves room for corrections or future reports. If a field is not used by a named report below, do not register it.

| Display name | Scope | Event parameter |
| --- | --- | --- |
| API Surface | Event | `api_surface` |
| Auth Mode | Event | `auth_mode` |
| Blocking Reason | Event | `blocking_reason` |
| Cache State | Event | `cache_state` |
| Chart ID | Event | `chart_id` |
| Connection Type | Event | `connection_type` |
| Content ID | Event | `content_id` |
| Content Type | Event | `content_type` |
| Dashboard View | Event | `dashboard_view` |
| Duration Bucket | Event | `duration_bucket` |
| ENG Mode | Event | `eng_mode` |
| EPM Tab | Event | `epm_tab` |
| Error Area | Event | `error_area` |
| Error Code | Event | `error_code` |
| Feature Name | Event | `feature_name` |
| Filter Type | Event | `filter_type` |
| Issue Kind | Event | `issue_kind` |
| Lane Mode | Event | `lane_mode` |
| Link Type | Event | `link_type` |
| Metric | Event | `metric` |
| Page Name | Event | `page_name` |
| Project Scope | Event | `project_scope` |
| Query Length Bucket | Event | `query_length_bucket` |
| Range Size Bucket | Event | `range_size_bucket` |
| Result | Event | `result` |
| Result Count Bucket | Event | `result_count_bucket` |
| Search Scope | Event | `search_scope` |
| Section | Event | `section` |
| Selection Count Bucket | Event | `selection_count_bucket` |
| Sort Key | Event | `sort_key` |
| Sort Scope | Event | `sort_scope` |
| Source Surface | Event | `source_surface` |
| Stats View | Event | `stats_view` |
| Status Bucket | Event | `status_bucket` |
| Subgoal Scope | Event | `subgoal_scope` |
| Workflow Action | Event | `workflow_action` |

Allowed but initially unregistered parameters include `conflict_count_bucket`, `conflict_state`, `dependency_state`, `dirty_state`, `from_mode`, `from_view`, `group_count_bucket`, `issue_count_bucket`, `method`, `override_count_bucket`, `pending_unsaved_state`, `point_bucket`, `previous_status`, `project_count_bucket`, `recoverable_state`, `scope_type`, `selected_count_bucket`, `selected_sp_bucket`, `series_type`, `sort_direction`, `sprint_selection_state`, `team_count_bucket`, `validation_count_bucket`, `value_state`, and `visible_count_bucket`. Register one later only when a named report needs it.

Registration rationale: every event-scoped custom dimension above must appear in at least one named report below. If a report stops using one, remove that custom definition instead of keeping it for possible future use. Unregistered parameters remain available for DebugView/source-guard validation and can be promoted only with a named report reason.

Create these event-scoped custom metrics:

| Display name | Scope | Event parameter | Unit |
| --- | --- | --- | --- |
| Duration MS | Event | `duration_ms` | Milliseconds |
| Visible Count | Event | `visible_count` | Standard |
| Selected Count | Event | `selected_count` | Standard |
| Selected Story Points | Event | `selected_story_points` | Standard |
| Override Count | Event | `override_count` | Standard |
| Issue Count | Event | `issue_count` | Standard |
| Conflict Count | Event | `conflict_count` | Standard |
| Unschedulable Count | Event | `unschedulable_count` | Standard |
| Project Count | Event | `project_count` | Standard |

Create these user-scoped custom dimensions only if they are sent by the shipped implementation:

| Display name | Scope | User property |
| --- | --- | --- |
| Auth Mode | User | `auth_mode` |

Do not create custom dimensions for:
- `user_id`
- user email/name/account ID
- team name
- group name
- sprint name
- project name
- Jira label
- issue key
- epic key
- search term
- URL
- JQL
- draft ID
- version ID
- workspace ID
- cloud ID
- timestamp
- session ID

---

## Event Validation

Use DebugView and Realtime after the implementation is deployed.

Representative events to verify:

| User action | Expected GA4 event | Must include | Must not include |
| --- | --- | --- | --- |
| Load dashboard or switch logical view | `page_view` from `dataLayer.event=pageview` | `page_name`, `dashboard_view`, `source_surface` | raw URL as custom param, issue key, token |
| Sign in and load dashboard | `login` | `method`, `auth_mode`, `result` | email, account ID, callback URL |
| Basic/local dashboard reload | no `login` | n/a | repeated bootstrap login event |
| Switch ENG to EPM | `select_content` | `content_type=dashboard_view`, `content_id=epm` | project names, Home URLs |
| Change ENG mode to Scenario | `select_content` | `content_type=eng_mode`, `content_id=scenario` | issue keys |
| Search dashboard | `app_search` | `search_scope`, `query_length_bucket`, `result_count_bucket` | raw search text, `search_term` |
| Select teams/groups | `filter_changed` | `filter_type`, `selection_count_bucket` | team names, group names, team IDs |
| Sort EPM Projects table | `sort_changed` | `sort_scope=epm_settings_projects`, `sort_key=name|status|label`, `sort_direction=asc` | project names, Jira labels, Home IDs |
| Open Jira issue-list/filter link from export, stats, capacity, ENG alert, Scenario, or EPM | `external_link_opened` | `link_type=jira_issue_list`, `issue_kind`, `issue_count_bucket`, `source_surface`, `result` | URL, JQL, issue keys, project names, team IDs, statuses, filter IDs |
| Open direct Jira issue, epic, or initiative link from dashboard, ENG alert, or EPM rollup/tree | `external_link_opened` | `link_type=jira_issue_browse`, `issue_kind=story|epic|initiative|unknown`, `source_surface`, `result` | browse URL, issue key, summary, project name, label |
| Open Jira Home project/update | `external_link_opened` | `link_type=jira_home_project|jira_home_update`, `epm_tab`, `project_scope=single`, `source_surface`, `result` | Home URL, project name, Home ID, owner, update text |
| Save Settings | `settings_action` | `section`, `workflow_action=save`, `result` | config payload, field IDs, validation text |
| Connect Home token | `connection_action` | `connection_type`, `workflow_action`, `result` | email, token, credential subject |
| Edit Scenario timeline | `scenario_action` | `workflow_action`, `override_count_bucket`, `result` | issue key, draft ID, assignee |
| Load EPM rollup | `epm_action` | `epm_tab`, `project_scope`, `project_count_bucket` | project name, label, Home ID |
| API completes | `api_result` | `feature_name`, `api_surface`, `status_bucket`, `duration_bucket`; for EPM APIs use `feature_name=epm` and also include `epm_tab`, `project_scope`, `subgoal_scope` when known | URL query, response body, Jira error text |
| Reach 90% scroll depth | `scroll` | GA4-managed Enhanced Measurement event | app-owned custom params |
| Download file link | `file_download` | GA4-managed Enhanced Measurement event | app-owned custom params |
| Submit form | `form_submit` | GA4-managed Enhanced Measurement event | app-owned custom params |
| URL-query-driven site search | `view_search_results` | GA4-managed Enhanced Measurement event | app-owned custom params |

Validation commands for implementers:

```bash
npm run build
node tests/test_analytics_source_guards.js
node tests/test_analytics_events.js
npx playwright test tests/ui/ga4_tag_and_events.spec.js
.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes
.venv/bin/python -m unittest tests.test_security_headers
```

For validation, use GTM Preview/Tag Assistant plus GA4 DebugView with `GA4_DEBUG_MODE=true` in a non-production or controlled environment. `debug_mode` is a transport flag only; do not create a custom dimension for it. Turn debug mode off by omitting the flag after validation, not by sending `debug_mode:false`.

---

## Reports To Build

Start with Explore reports or standard custom reports:

1. **Feature Adoption**
   - Rows: `feature_name`, `content_type`, `content_id`, `dashboard_view`, `eng_mode`, `source_surface`
   - Metrics: event count, active users
   - Events: `select_content`, `stats_action`, `epm_action`, `scenario_action`

2. **Page Name/View Adoption**
   - Rows: `page_name`, `dashboard_view`, `eng_mode`, `auth_mode`, `source_surface`
   - Metrics: event count, active users
   - Events: `page_view`

3. **Search And Filter Friction**
   - Rows: `search_scope`, `query_length_bucket`, `result_count_bucket`, `filter_type`, `selection_count_bucket`, `source_surface`
   - Metrics: event count, active users
   - Events: `app_search`, `filter_changed`

4. **Settings And Connection Reliability**
   - Rows: `section`, `workflow_action`, `result`, `connection_type`, `error_area`, `error_code`
   - Metrics: event count, active users
   - Events: `settings_action`, `connection_action`

5. **Scenario Planner Usage**
   - Rows: `workflow_action`, `lane_mode`, `result`, `blocking_reason`, `source_surface`
   - Metrics: event count, `override_count`, `conflict_count`, active users
   - Events: `scenario_action`

6. **EPM Usage And Load Outcomes**
   - Rows: `epm_tab`, `project_scope`, `subgoal_scope`, `sort_scope`, `sort_key`, `result`, `duration_bucket`, `status_bucket`, `cache_state`, `api_surface`
   - Metrics: event count, `project_count`, `duration_ms`, active users
   - Events: `epm_action`, `sort_changed`, `api_result`

7. **API Reliability**
   - Rows: `api_surface`, `status_bucket`, `result`, `cache_state`
   - Metrics: event count, `duration_ms`, active users
   - Events: `api_result`

8. **Jira/Home External Link Opens**
   - Rows: `link_type`, `issue_kind`, `source_surface`, `epm_tab`, `project_scope`
   - Metrics: event count, active users
   - Events: `external_link_opened`

9. **Statistics And Chart Usage**
   - Rows: `stats_view`, `metric`, `range_size_bucket`, `chart_id`, `source_surface`
   - Metrics: event count, active users
   - Events: `stats_action`, `chart_action`

10. **Enhanced Measurement Engagement**
   - Rows: event name, page title/location, link/file/form/search dimensions when approved for reporting
   - Metrics: event count, active users
   - Events: `scroll`, `view_search_results`, `file_download`, `form_start`, `form_submit`
   - Do not create custom dimensions for link/form/search parameters until a named report needs them.

---

## Operating Rules

- Review new analytics events during code review against `docs/plans/DONE-ga4-instrumentation.md`.
- If GA4/GTM configuration is applied with MCP, use `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` as the desired state and keep the run in dry-run/new-workspace mode until the publish gates pass. The official Google Analytics MCP server is read-only and is not sufficient for configuration writes.
- Do not register a custom dimension just because an event parameter exists. Register only fields needed for reports.
- Delete or archive unused custom definitions only after confirming no active report depends on them.
- Treat values that identify a person, team, project, Jira issue, Home project, deployment, or workspace as sensitive even when they are not obvious PII.
- If stakeholders require reports by actual team or group name, build a separate internal reporting path with access controls. Do not overload GA4.
- Keep Measurement Protocol API secrets out of this slice.
