# SUPPORT: GA4 User Configuration Runbook

**Status:** Drafted on 2026-05-26 for GA4 web stream Measurement ID `G-6QERX19WB0`. Use this runbook alongside `docs/plans/EXEC-ga4-instrumentation.md`.

**Audience:** The GA4 property owner or operator configuring Google Analytics for Jira Execution Planner.

**Important ID note:** `G-6QERX19WB0` is the GA4 web stream Measurement ID used by the website tag. GA Admin may also show a separate numeric property ID; do not place that numeric ID in `gtag.js` code.

---

## Preconditions

- You have Editor or Administrator access to the GA4 property that owns web stream `G-6QERX19WB0`.
- The implementation from `docs/plans/EXEC-ga4-instrumentation.md` has shipped to the target environment.
- The deployment has set `GA4_ENABLED=true`, `GA4_MEASUREMENT_ID=G-6QERX19WB0`, and a secret `GA4_USER_ID_PEPPER`.
- The app exposes an analytics consent control and defaults consent to denied before any Google tag can collect data.

Official docs checked on 2026-05-26:
- Events and `gtag('event', ...)`: https://developers.google.com/analytics/devguides/collection/ga4/events
- User-ID: https://developers.google.com/analytics/devguides/collection/ga4/user-id
- Consent Mode: https://developers.google.com/tag-platform/security/guides/consent
- Event naming and reserved names: https://support.google.com/analytics/answer/13316687
- Custom definitions and limits: https://support.google.com/analytics/answer/14240153
- PII guidance: https://support.google.com/analytics/answer/6366371
- Event collection limits: https://support.google.com/analytics/answer/9267744

---

## Property Setup

1. Open Google Analytics Admin.
2. Select the property that contains the web stream with Measurement ID `G-6QERX19WB0`.
3. Go to **Data streams** and confirm the web stream URL matches the deployed Jira Execution Planner URL.
4. In **View tag instructions**, choose manual installation only if you need to inspect the tag. The app implementation should own the actual code snippet.
5. Do not create a Google Tag Manager container for this first slice unless a separate migration plan is approved.
6. Keep Google Signals and ad personalization disabled unless legal/privacy review explicitly approves advertising use.
7. Set data retention to the longest allowed period that matches company policy, commonly 14 months for standard GA4 properties.
8. Configure internal traffic filters if company policy requires excluding developer or office traffic.

---

## Consent Configuration

The website must set Consent Mode defaults before loading the Google tag:

```js
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied'
});
```

When the user grants analytics consent, the app may update only `analytics_storage` to `granted` for product analytics. Keep ad consent values denied:

```js
gtag('consent', 'update', {
  analytics_storage: 'granted',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied'
});
```

When the user revokes consent, the app must update consent back to denied and stop sending events:

```js
gtag('consent', 'update', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied'
});
```

Operator check:
- In a fresh browser profile, open the app before consenting and verify no requests are sent to `googletagmanager.com` or `google-analytics.com`.
- Grant analytics consent, perform a view switch, and verify a GA4 request appears.
- Revoke consent, repeat the action, and verify no further GA4 requests are sent.

---

## User-ID Configuration

The app sends a server-derived pseudonymous `user_id` with GA4, not raw user identity.

Allowed:
- HMAC-SHA256 output derived from `RequestAuthContext.stable_subject` and `GA4_USER_ID_PEPPER`.
- `null` on logout or expired auth.

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
1. Confirm the website sends `user_id` through the GA4 config/set path, not as a custom event parameter.
2. Do not create a custom dimension named `user_id`, `uid`, `userid`, `customer_id`, or anything equivalent.
3. Use GA4 reporting identity settings according to company policy. For internal product analytics, prefer an identity mode that uses User-ID when available without enabling ad personalization.
4. In DebugView, verify authenticated events include User-ID association while event parameters do not include identity fields.

---

## Custom Definitions

Create only the following event-scoped custom dimensions initially. Do not register high-cardinality names, IDs, URLs, raw labels, or search terms.

| Display name | Scope | Event parameter |
| --- | --- | --- |
| Action | Event | `action` |
| API Surface | Event | `api_surface` |
| Auth Mode | Event | `auth_mode` |
| Blocking Reason | Event | `blocking_reason` |
| Cache State | Event | `cache_state` |
| Chart ID | Event | `chart_id` |
| Connection Type | Event | `connection_type` |
| Content Type | Event | `content_type` |
| Dirty State | Event | `dirty_state` |
| Duration Bucket | Event | `duration_bucket` |
| EPM Tab | Event | `epm_tab` |
| Error Area | Event | `error_area` |
| Error Code | Event | `error_code` |
| Filter Type | Event | `filter_type` |
| From Mode | Event | `from_mode` |
| From View | Event | `from_view` |
| Item ID | Event | `item_id` |
| Lane Mode | Event | `lane_mode` |
| Method | Event | `method` |
| Metric | Event | `metric` |
| Project Scope | Event | `project_scope` |
| Query Length Bucket | Event | `query_length_bucket` |
| Range Size Bucket | Event | `range_size_bucket` |
| Result | Event | `result` |
| Result Count Bucket | Event | `result_count_bucket` |
| Search Scope | Event | `search_scope` |
| Section | Event | `section` |
| Selection Count Bucket | Event | `selection_count_bucket` |
| Selected Count Bucket | Event | `selected_count_bucket` |
| Selected SP Bucket | Event | `selected_sp_bucket` |
| Source Surface | Event | `source_surface` |
| Stats View | Event | `stats_view` |
| Status Bucket | Event | `status_bucket` |
| Subgoal Scope | Event | `subgoal_scope` |
| Value State | Event | `value_state` |
| Validation Count Bucket | Event | `validation_count_bucket` |
| Visible Count Bucket | Event | `visible_count_bucket` |

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
| Analytics Consent State | User | `analytics_consent_state` |

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
| Sign in and load dashboard | `login` | `method`, `auth_mode`, `result` | email, account ID, callback URL |
| Switch ENG to EPM | `select_content` | `content_type=dashboard_view`, `item_id=epm` | project names, Home URLs |
| Change ENG mode to Scenario | `select_content` | `content_type=eng_mode`, `item_id=scenario` | issue keys |
| Search dashboard | `search` | `search_scope`, `query_length_bucket`, `result_count_bucket` | raw search text |
| Select teams/groups | `filter_changed` | `filter_type`, `selection_count_bucket` | team names, group names, team IDs |
| Save Settings | `settings_action` | `section`, `action=save`, `result` | config payload, field IDs, validation text |
| Connect Home token | `connection_action` | `connection_type`, `action`, `result` | email, token, credential subject |
| Edit Scenario timeline | `scenario_action` | `action`, `override_count_bucket`, `result` | issue key, draft ID, assignee |
| Load EPM rollup | `epm_action` | `epm_tab`, `project_scope`, `project_count_bucket` | project name, label, Home ID |
| API completes | `api_result` | `api_surface`, `status_bucket`, `duration_bucket` | URL query, response body, Jira error text |

Validation commands for implementers:

```bash
npm run build
node tests/test_analytics_source_guards.js
npx playwright test tests/ui/ga4_consent_and_events.spec.js
.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes
```

For production validation, use GA4 DebugView with `GA4_DEBUG_MODE=true` in a non-production or controlled environment. Turn debug mode off after validation.

---

## Reports To Build

Start with Explore reports or standard custom reports:

1. **Feature Adoption**
   - Rows: `source_surface`, `content_type`, `item_id`
   - Metrics: event count, active users
   - Events: `select_content`, `stats_action`, `epm_action`, `scenario_action`

2. **Search And Filter Friction**
   - Rows: `search_scope`, `query_length_bucket`, `result_count_bucket`, `filter_type`
   - Metrics: event count, active users
   - Events: `search`, `filter_changed`

3. **Settings And Connection Reliability**
   - Rows: `section`, `action`, `result`, `error_code`
   - Metrics: event count, active users
   - Events: `settings_action`, `connection_action`

4. **Scenario Planner Usage**
   - Rows: `action`, `lane_mode`, `result`, `blocking_reason`
   - Metrics: event count, `override_count`, `conflict_count`, active users
   - Events: `scenario_action`

5. **EPM Usage And Load Outcomes**
   - Rows: `epm_tab`, `project_scope`, `result`, `duration_bucket`
   - Metrics: event count, `project_count`, `duration_ms`, active users
   - Events: `epm_action`, `api_result`

6. **API Reliability**
   - Rows: `api_surface`, `status_bucket`, `result`, `cache_state`
   - Metrics: event count, `duration_ms`, active users
   - Events: `api_result`

---

## Operating Rules

- Review new analytics events during code review against `docs/plans/EXEC-ga4-instrumentation.md`.
- Do not register a custom dimension just because an event parameter exists. Register only fields needed for reports.
- Delete or archive unused custom definitions only after confirming no active report depends on them.
- Treat values that identify a person, team, project, Jira issue, Home project, deployment, or workspace as sensitive even when they are not obvious PII.
- If stakeholders require reports by actual team or group name, build a separate internal reporting path with access controls. Do not overload GA4.
- Keep Measurement Protocol API secrets out of this slice.

