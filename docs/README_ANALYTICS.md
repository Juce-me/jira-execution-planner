# Analytics Contract

Status: planned
Type: product analytics contract

This is the durable source of truth for Jira Execution Planner analytics after the GA4 implementation ships. While `docs/plans/EXEC-ga4-instrumentation.md` is still active, that plan owns implementation sequencing; this document owns the product contract future feature work must keep current.

## Scope

- Analytics vendor: Google Analytics 4.
- Active architecture: Google Tag Manager web container with deferred loading after analytics consent and a stable two-event `dataLayer` contract.
- Not in scope: server-side GTM, Measurement Protocol, Google Ads, remarketing, audiences, Google Signals, or ad personalization.
- GTM schema policy: app code may push only `event=pageview` or `event=userevent` to `window.dataLayer`. GTM owns exactly two app-owned Custom Event triggers: one for `pageview`, one for `userevent`.
- Page-view policy: logical app views are measured through `dataLayer.push({ event: 'pageview', ... })`; GTM maps that to GA4 `page_view` with the fixed pageview property map.
- Enhanced Measurement policy: GA4-managed `scroll`, `click`, `view_search_results`, `file_download`, `form_start`, and `form_submit` may fire after consent from GA4 automatic detection. App code must not recreate those reserved names as custom sends.
- Privacy floor for app-owned events: no raw email, name, phone, free text, token, raw user agent, IP address, Atlassian account id, workspace id, cloud id, Jira/Home URL, issue key, team/group/project/sprint name, Jira label, JQL, draft id, version id, local path, or config payload is sent as an app-owned GA4 event parameter or user property.
- GA4 defaults: after consent, GA4-managed page URL/title/link/form/search metadata is allowed for the web stream. Browser GTM/GA4 cannot app-truncate the network source IP before Google receives it; this contract relies on GA4's documented IP handling and forbids IP addresses in app-owned payloads.

## Future Feature Rule

Every user-visible feature change must answer these before merge:

- What decision will this feature's analytics support?
- Which event name and typed parameters are added or changed?
- Which test asserts the event and required parameters?
- Which row in this taxonomy changed?
- Did any GA4 admin, consent, custom-definition, or runbook step change?

If no analytics event is needed, add or update an allowlist row with the reason.

## Identity Rule

GA4 must not identify a specific person. The only allowed GA4 User-ID is the server-derived pseudonymous value from `docs/plans/EXEC-ga4-instrumentation.md`.

- Do not send raw Atlassian account ids, database user ids, emails, display names, workspace ids, auth connection ids, cloud ids, or token versions.
- Do not register `user_id` as a custom dimension or event parameter.
- Do not build GA4 reports, exports, logs, docs, or PR notes that map the pseudonymous GA4 User-ID back to a specific person.
- Basic/local shared auth sends no GA4 User-ID.

## Event Taxonomy

Use these event names as the v1 allowlist. Do not add ad hoc event names from components.

Every app-owned product event is pushed as:

```js
window.dataLayer.push({
  event: 'userevent',
  ga4_event_name: '<event name from the table below>',
  // allowlisted typed parameters only
});
```

Use `window.dataLayer.push({ ... })`; do not use `dataLayer(...)`, direct `gtag('event', ...)`, or product event names as the dataLayer `event` value.

Logical page/view tracking is pushed as:

```js
window.dataLayer.push({
  event: 'pageview',
  logical_page: 'dashboard',
  dashboard_view: 'eng',
  source_surface: 'dashboard'
});
```

| Event name | Required params | Trigger | Primary anchors | Side | Decision/use |
| --- | --- | --- | --- | --- | --- |
| `page_view` | `logical_page`, `dashboard_view`, `auth_mode`, `source_surface` | GTM receives `dataLayer.event=pageview` | `frontend/src/dashboard.jsx` | browser/GTM | Logical page/view adoption |
| `login` | `method`, `auth_mode`, `result`, `source_surface` | OAuth authenticated transition only | `frontend/src/dashboard.jsx`, `backend/routes/auth_routes.py` | browser | Auth adoption and recovery |
| `logout` | `auth_mode`, `source_surface` | User-triggered logout completes | `backend/routes/auth_routes.py` | browser | Auth exit |
| `select_content` | `content_type`, `content_id`, `from_view`, `source_surface` | ENG/EPM view changes | `frontend/src/dashboard.jsx` | browser | ENG/EPM adoption |
| `select_content` | `content_type`, `content_id`, `from_mode`, `source_surface` | Catch Up, Planning, Statistics, or Scenario mode changes | `frontend/src/dashboard.jsx` | browser | ENG mode adoption |
| `app_search` | `search_scope`, `query_length_bucket`, `result_count_bucket`, `source_surface` | Debounced dashboard, EPM, or settings search settles | `frontend/src/dashboard.jsx`, `frontend/src/epm/*`, `frontend/src/settings/*` | browser | Search friction |
| `filter_changed` | `filter_type`, `selection_count_bucket`, `scope_type`, `source_surface` | Sprint, group, team, EPM project, stats, field, or issue-type filters change | `frontend/src/dashboard.jsx`, `frontend/src/epm/*`, `frontend/src/settings/*` | browser | Filter usage |
| `settings_action` | `section`, `workflow_action`, `result`, `validation_count_bucket`, `dirty_state` | Settings tab open, test, save, cancel, or validation failure | `frontend/src/settings/*` | browser | Settings reliability |
| `connection_action` | `connection_type`, `workflow_action`, `previous_status`, `result`, `error_code` | Home token connect, revoke, or recovery | `frontend/src/settings/UserConnectionsSettings.jsx` | browser | Connection reliability |
| `planning_action` | `workflow_action`, `status_bucket`, `selected_count_bucket`, `selected_sp_bucket` | Task select, bulk select, or include-state change | `frontend/src/dashboard.jsx` | browser | Planning usage |
| `scenario_action` | `workflow_action`, `lane_mode`, `result` | Scenario open, compute, edit, draft, history, or writeback gate | `frontend/src/dashboard.jsx` | browser | Scenario Planner usage |
| `stats_action` | `stats_view`, `workflow_action`, `metric`, `range_size_bucket`, `source_surface` | Stats view, metric, range, chart click-to-filter, or legend filter | `frontend/src/dashboard.jsx`, `frontend/src/stats/*` | browser | Statistics adoption |
| `chart_action` | `chart_id`, `workflow_action`, `series_type`, `point_bucket`, `source_surface` | Throttled chart click/readout, not raw hover | `frontend/src/stats/*` | browser | Chart inspection |
| `epm_action` | `workflow_action`, `epm_tab`, `project_scope`, `subgoal_scope`, `result` | EPM tab, project scope, sub-goal scope, expand/collapse, or rollup load | `frontend/src/epm/*` | browser | EPM usage |
| `api_result` | `api_surface`, `method`, `status_bucket`, `result`, `duration_bucket`, `cache_state` | Browser-observed allowlisted API response completes | `frontend/src/api/*` | browser | API reliability |
| `app_error_shown` | `error_area`, `error_code`, `recoverable_state`, `source_surface` | User-visible server/auth/config unavailable state appears | `frontend/src/dashboard.jsx`, `frontend/src/eng/useEngSprintData.js` | browser | Reliability and recovery |

Do not use reserved GA4 event names such as `click`, `error`, `page_view`, `scroll`, `session_start`, `user_engagement`, `view_search_results`, `file_download`, `form_start`, or `form_submit` through `event=userevent`. GA4 `page_view` is allowed only through the `event=pageview` GTM trigger, and GA4 may emit the allowed Enhanced Measurement names automatically after consent. Do not emit Universal Analytics-style `event_category`, `event_action`, or `event_label`.

Do not add one GTM trigger per event. Adding a new app event name that uses existing property keys requires code, schema, tests, and this contract to change, but it must continue to use the existing `userevent` GTM trigger. GTM changes are needed only for a new dataLayer property key, a new destination, or changed consent/transport behavior.

GA4-managed automatic events allowed after consent:

| Event name | Source | Notes |
| --- | --- | --- |
| `scroll` | Enhanced Measurement | 90% scroll-depth event. |
| `click` | Enhanced Measurement | Outbound links only. |
| `view_search_results` | Enhanced Measurement | URL-query-driven site search; app-owned `app_search` remains bucketed. |
| `file_download` | Enhanced Measurement | File links detected by GA4. |
| `form_start` | Enhanced Measurement | Form interaction detection. |
| `form_submit` | Enhanced Measurement | Form submit detection. |

## Required Parameters

All parameters must be low-cardinality enums, booleans, numbers, or buckets. Bucket values should use stable labels such as `0`, `1`, `2_5`, `6_10`, `11_25`, `26_plus`, or equivalent documented in `frontend/src/analytics/events.js`.

Forbidden app-owned parameter examples include `search_term`, raw search text, URL, query string, issue key, Jira label, project/team/group/sprint name, email, display name, token, IP address, `user_id`, `session_id`, `cid`, `uid`, `customer_id`, and any `ga_`, `google_`, `firebase_`, `_`, or `gtag.` prefix.

DataLayer control fields:
- `event` is a GTM trigger name and must be only `pageview` or `userevent`.
- `ga4_event_name` is the GA4 event name for `userevent`; it is not sent as a GA4 event parameter.
- `ga4_user_id` maps to GA4 User-ID only, never a custom event parameter.
- `debug_mode` is a transport/debug flag only.

## Custom Definitions

Do not register every allowed parameter. Initial GA4 admin registration should stay near 25 event-scoped custom dimensions; exceeding 25 needs a named report reason in `docs/plans/SUPPORT-ga4-user-configuration.md`.

### Dimensions

The initial registration set is defined in `docs/plans/SUPPORT-ga4-user-configuration.md`. Allowed-but-unregistered parameters may still be validated and sent, but they become GA4 custom definitions only when a named report needs them.

### Metrics

Initial event-scoped metrics:

| Display name | Param | Scope | Unit | Decision/use |
| --- | --- | --- | --- | --- |
| Duration MS | `duration_ms` | Event | Milliseconds | API and EPM latency |
| Visible Count | `visible_count` | Event | Standard | Visible item volume |
| Selected Count | `selected_count` | Event | Standard | Planning selection volume |
| Selected Story Points | `selected_story_points` | Event | Standard | Planning selection size |
| Override Count | `override_count` | Event | Standard | Scenario edit size |
| Issue Count | `issue_count` | Event | Standard | Scenario/API workload size |
| Conflict Count | `conflict_count` | Event | Standard | Scenario conflict size |
| Unschedulable Count | `unschedulable_count` | Event | Standard | Scenario scheduling risk |
| Project Count | `project_count` | Event | Standard | EPM rollup size |

## Privacy Rules

- Consent denied sends zero third-party analytics requests.
- Analytics disabled sends zero third-party analytics requests.
- The app consent preference is stored only in first-party localStorage key `jep.analyticsConsent.v1`, never cookies. The app must not create its own analytics-consent cookie; Google-managed GA storage after consent is governed by Consent Mode and GA4 Admin.
- Basic/local shared auth sends no GA4 User-ID.
- Revoking consent stops future sends and sets GA4 consent back to denied.
- App-owned page/view tracking uses only `event=pageview`; app code must not push direct GA4 `page_view` events or ad hoc page event names.
- GA4 User-ID is pseudonymous personal data. This implementation does not include a GA4 data-subject-request or account-deletion workflow.
- Forbidden keys are scrubbed in the analytics wrapper and checked again by tests.
- Value-shape regexes must drop whole app-owned custom events for email-like values, bearer/JWT/token-like values, full URLs with queries, IP addresses, UUIDs unless explicitly allowlisted, credit-card-like values, and local path patterns.

## Allowlist

State-changing routes or user-visible surfaces without analytics must be documented here.

| Surface | File/line anchor | Reason no event is emitted | Review date |
| --- | --- | --- | --- |
| Home/Townsquare writes | `docs/plans/GATE-05-home-write-capability.md` | Blocked external capability; no write route exists in this analytics slice. | 2026-05-26 |

## Drift Checks

CI or focused source-guard tests must fail when:

- Code sends a dataLayer trigger outside `pageview` or `userevent`.
- Code sends a `ga4_event_name` outside this taxonomy.
- Code sends a parameter outside the allowlist in `frontend/src/analytics/events.js`.
- Required params lack tests.
- Captured payloads contain forbidden keys or forbidden value shapes.
- Consent denied still sends a request to `googletagmanager.com` or `google-analytics.com`.
- App code sends direct `gtag('event', ...)` calls or manually pushes a GA4 event name as the dataLayer `event` value.
- GA4-managed Enhanced Measurement events appear before consent.
- A user-visible feature changes without updating this contract or documenting why analytics does not apply.

## Operations Links

- Implementation plan: `docs/plans/EXEC-ga4-instrumentation.md`
- GA4 setup runbook: `docs/plans/SUPPORT-ga4-user-configuration.md`
- GA4 web stream Measurement ID: `G-6QERX19WB0`
- GTM container: configured by `GTM_CONTAINER_ID`
- Measurement Protocol secret: none in v1
- GA4 deletion workflow: out of scope for this implementation
