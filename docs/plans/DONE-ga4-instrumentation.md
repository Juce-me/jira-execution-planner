# GA4 Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking. Do not hand-edit `frontend/dist/*`; run `npm run build` after frontend source changes.

> **Status:** Done. Executed and merged in [PR #58](https://github.com/Juce-me/jira-execution-planner/pull/58). Kept for audit context only.

**Revision notes:**
- 2026-05-26 review update: clarify that direct/ad hoc `page_view` sends are replaced by the controlled `pageview` dataLayer trigger, `user_id` is pseudonymous only and must not identify a specific person in GA4, Basic/local bootstrap does not emit repeated `login`, and durable analytics docs/agent rules are part of the deliverables.
- 2026-05-26 configuration update: allow GA4 Enhanced Measurement for scrolls, file downloads, site-search results, and form submits when analytics is enabled; keep GA4 default page URL/title metadata; and remove DSR deletion workflow from this implementation scope.
- 2026-05-26 GTM schema update: use a web GTM container and a stable two-event `dataLayer` contract: `event: "pageview"` for page name/view tracking and `event: "userevent"` for all product events. GTM needs only two custom-event triggers plus fixed pageview and user-event variable/parameter maps; new app events must not require new GTM triggers.
- 2026-05-27 readiness update: replace `ga4_event_name` with canonical `event_name`, add explicit EPM settings sort tracking, split Jira issue-list/filter link opens from Jira Home project/update opens, and disable GA4 Enhanced Measurement outbound-click collection unless tests prove Atlassian/Jira/Home URLs cannot be sent through managed `click` events.
- 2026-05-27 internal-policy update: remove in-app analytics consent as a product feature. This is an internal employee tool; analytics collection is governed by employee/internal tool policy and the deployment-level `GA4_ENABLED` flag, not by a per-user opt-in UI.
- 2026-05-29 MCP validation update: align the support runbook and MCP desired-state YAML with the current `ga4-gtm-config-mcp` validator. The MCP spec now uses a concrete `target.environment` enum, excludes the unsupported `Page Title` GTM built-in, and represents only the current MCP-supported write surface: GA4 custom definitions/key events plus GTM built-ins, Data Layer Variables, Custom Event triggers, and GA4 Event tags. Google tag setup and Enhanced Measurement remain manual runbook steps until the MCP supports those resources.
- 2026-05-30 execution update: app-side GA4/GTM context, dataLayer contract, privacy guards, pseudonymous identity, CSP, API outcome tracking, product event wiring, docs, and focused verification were implemented. Full local unittest discovery still has sandbox-blocked Postgres socket failures unrelated to this analytics slice.
- 2026-05-30 kill-switch update: `GA4_ENABLED=false` is the single deployment shutdown switch. New page loads do not load GTM, app-owned sends stop, and open tabs re-check `/api/analytics/context` every 60 seconds so collection shuts down without clearing other GA4/GTM environment variables.

**Goal:** Add privacy-safe Google Analytics 4 tracking for Jira Delivery Planner usage: authenticated user continuity, major view/mode adoption, search and filter usage, settings and connection flows, Scenario Planner actions, EPM usage, chart interactions, API outcome timing, and reliability signals.

**Architecture:** Use a Google Tag Manager web container as the browser transport. The app initializes `window.dataLayer`, loads the GTM container when `/api/analytics/context` returns `enabled:true`, and pushes only two GTM trigger events: `pageview` and `userevent`. GTM owns the GA4 Google tag and GA4 Event tags, including the GA4 Measurement ID `G-6QERX19WB0`. App code owns the typed, sanitized dataLayer payload. Add one small backend analytics context endpoint that returns only feature flags, the GTM container ID, the GA4 measurement ID for verification, and pseudonymous identifiers derived server-side for real per-user OAuth/DB sessions. Do not add Measurement Protocol or server-side GTM in this slice; if later server-only events are needed, create a separate `EXEC-*` plan with an API-secret operating model.

**Tech Stack:** Flask, React 19, esbuild, Google Tag Manager web, `dataLayer.push`, Python `unittest`, Node source-guard tests, Playwright UI/network assertions.

**External references checked on 2026-05-27:**
- Google Analytics event setup: https://developers.google.com/analytics/devguides/collection/ga4/events
- GA4 recommended events: https://developers.google.com/analytics/devguides/collection/ga4/reference/events
- GA4 User-ID: https://developers.google.com/analytics/devguides/collection/ga4/user-id
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
2. This is an internal product for employee use. Do not build an in-app analytics consent UI, consent localStorage key, or revoke flow. Analytics collection is enabled or disabled by the deployment-level `GA4_ENABLED` flag and governed by employee/internal tool policy. If `GA4_ENABLED=false`, the app must not load GTM or send GA4 requests; already-open tabs must stop app-owned sends after their next analytics-context refresh. If `GA4_ENABLED=true`, employee usage is measured without per-user opt-in. `ad_user_data` and `ad_personalization` stay out of scope for this internal productivity app unless a separate ads/marketing review changes that.
3. Send GA4 `user_id` only as a server-derived pseudonymous value. GA4 users and reports must not identify a specific person, Atlassian account, workspace, tenant, or deployment. Never send raw Atlassian account IDs, emails, display names, workspace IDs, cloud IDs, site URLs, API tokens, OAuth codes, Jira issue keys, Home project IDs, local file paths, or full IP addresses as app-owned GA4 event parameters or user properties.
4. Do not send raw custom group names, team names, sprint names, project names, Jira labels, search terms, issue summaries, assignees, draft IDs, version IDs, JQL, Jira URLs, Home URLs, validation messages, imported JSON, or saved config payloads.
5. For user-requested "custom groups names" and "team names", collect usage safely as `filter_type`, `selection_count_bucket`, `team_count_bucket`, `group_count_bucket`, `scope_type`, and `source_surface`. Raw names belong in product-owned operational reporting, not GA4 custom dimensions.
6. Prefer GA4 recommended events where their required parameter contract matches the privacy rules (`login`, `select_content`). Use a small set of custom events for app-specific workflows. Use `app_search` for app-owned search telemetry because it sends only query-length and result-count buckets. GA4 Enhanced Measurement `view_search_results` may also be enabled only when the managed-metadata safety gate proves its managed `search_term` behavior cannot expose raw app search text or other forbidden values.
7. Keep event names below 40 characters and events below 25 parameters. Keep custom definitions below the standard GA4 quota: 50 event-scoped custom dimensions, 50 custom metrics, and 25 user properties.
8. Do not track hover/readout events unless throttled to once per chart per session. Native tooltip hover noise is out of scope.
9. Analytics must be non-blocking. A GA script failure or send failure must not block dashboard load, auth refresh, Jira fetches, EPM rollups, Scenario drafts, settings saves, or exports.
10. Use `dataLayer.push({ event: "pageview", ... })` for page name/view tracking. GTM maps this single trigger to the GA4 `page_view` event and may keep GA4 default page URL/title metadata. App-owned pageview fields must remain low-cardinality and must not include raw URLs, query strings, callback values, tokens, issue keys, or local file paths.
11. Allow GA4-managed Enhanced Measurement when analytics is enabled for `scroll`. Allow `view_search_results`, `file_download`, `form_start`, and `form_submit` only after the runbook's managed-metadata safety gate proves their automatic parameters cannot include Jira/Home/auth URLs, OAuth callback data, raw app-search terms, JQL, issue keys, tokens, local paths, or user-entered text. Do not enable outbound-click Enhanced Measurement for v1 unless operator configuration and tests prove Atlassian/Jira/Home `link_url` values cannot be sent, because Jira issue-list links contain JQL and issue keys. Count Jira/Home outbound actions through app-owned `external_link_opened` events instead.
12. Direct browser GTM/GA4 cannot truncate the network source IP before Google receives the request. This plan therefore forbids full IP addresses in app-owned GA4 payloads and relies on GA4 property controls and Google's GA4 IP handling. If a named internal report later needs IP-derived context, it must be generated server-side as a truncated prefix such as `xxx.yyy.zzz.---` before it reaches the analytics wrapper; never send full IP values. If a future requirement demands app-controlled source-IP truncation before Google, replace this architecture with server-side GTM or a first-party proxy in a separate plan.
13. Do not recreate Universal Analytics `event_category` / `event_action` / `event_label`. GA4 sends an `event_name` plus typed event parameters. Use GA4 recommended event names where they fit and use custom parameters only when they answer a named report decision.
14. GTM configuration must be stable: one Custom Event trigger for `pageview`, one Custom Event trigger for `userevent`, one pageview GA4 Event tag, and one generic user-event GA4 Event tag whose event name is read from the canonical `event_name` dataLayer field. Adding a new product event should require code/schema/test updates only, not a new GTM trigger.

---

## Codebase Anchors

Core shell and security:
- `jira-dashboard.html:1` - HTML shell where `dataLayer` and the config-gated GTM container loader belong.
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
- `frontend/src/components/JiraExportButton.jsx:56` - Jira issue-list export action; track bucketed issue-list opens without URLs, JQL, or issue keys.
- `frontend/src/jiraExportUtils.mjs:75` and `frontend/src/jiraExportUtils.mjs:82` - Jira issue-list URL construction/opening; instrumentation must happen before opening and must not send the URL/JQL.
- `frontend/src/components/TrackedExternalLink.jsx` - create a reusable tracked anchor wrapper. It must receive `href` plus explicit analytics metadata, call `trackEvent('external_link_opened', metadata)` on click, and never parse or forward the URL.
- `frontend/src/analytics/externalLinks.js` - create low-cardinality metadata builders for Jira issue-list/filter, Jira issue/epic/initiative browse, Jira Home project, and Jira Home update handoffs.
- `frontend/src/dashboard.jsx:11148` and `frontend/src/dashboard.jsx:11223` - shared Jira issue-list/filter link builders for stats, capacity, and alert lists. Update `buildTeamStatusLink` and `buildKeyListLink` to return `{ href, analytics }` objects, then render those objects through `TrackedExternalLink` at every caller. This keeps the unsafe URL/JQL construction in one place and the safe analytics metadata beside it, so every `/issues/?jql=` list open is counted without sending JQL, issue keys, project names, team IDs, or statuses.
- `frontend/src/dashboard.jsx:12712`, `frontend/src/stats/StatsTeamsView.jsx:104`, `frontend/src/stats/StatsPriorityView.jsx:163`, and `frontend/src/eng/EngAlertsPanel.jsx:111` - representative rendered Jira issue-list/filter links outside `JiraExportButton`; implementation must cover all same-pattern links in these surfaces, not only these first anchors.
- `frontend/src/eng/EngAlertsPanel.jsx:160`, `frontend/src/dashboard.jsx:12373`, `frontend/src/epm/EpmRollupPanel.jsx:357`, and `frontend/src/epm/EpmRollupTree.jsx:17` - direct Jira `/browse/<key>` handoffs. Track with `link_type=jira_issue_browse` and `issue_kind=story|epic|initiative|unknown`; never send the key, summary, or browse URL.

EPM:
- `frontend/src/epm/EpmControls.jsx:12` - EPM active/backlog/archived and project/sub-goal controls.
- `frontend/src/epm/EpmRollupPanel.jsx:48` - EPM project board interactions.
- `frontend/src/epm/EpmRollupPanel.jsx:93` and `frontend/src/epm/EpmRollupPanel.jsx:117` - Jira Home update links; track only `link_type=jira_home_update`, surface, tab/scope, and result.
- `frontend/src/epm/EpmRollupPanel.jsx:242` and `frontend/src/epm/EpmRollupPanel.jsx:378` - Jira Home project links; track only low-cardinality link type/surface, never URLs or Home IDs.
- `frontend/src/epm/EpmSettings.jsx:92` - EPM settings workflows.
- `frontend/src/epm/EpmSettings.jsx:417`, `frontend/src/epm/EpmSettings.jsx:426`, and `frontend/src/epm/EpmSettings.jsx:435` - EPM project sort controls for name, status, and Jira label.
- `frontend/src/epm/EpmSettings.jsx:481` - EPM settings Jira Home project shortcut.
- `frontend/src/epm/epmProjectUtils.mjs:316` - EPM settings project sort implementation.
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
- `frontend/src/analytics/analytics.js` - GTM loader/context, dataLayer push wrapper, user-id handling, sanitization, bucketing.
- `frontend/src/analytics/events.js` - dataLayer contract, event-name constants, enum/bucket validators, and allowlisted parameter schema.
- `frontend/src/analytics/externalLinks.js` - metadata builders for safe external-link analytics.
- `frontend/src/components/TrackedExternalLink.jsx` - tracked anchor wrapper that sends safe metadata before normal navigation.
- `tests/test_analytics_identity.py` - backend pseudonymous ID and context tests.
- `tests/test_analytics_routes.py` - Flask route tests for disabled/enabled context and no raw identity fields.
- `tests/test_security_headers.py` - extend security header coverage for GA4 CSP directives.
- `tests/test_analytics_events.js` - unit tests for event schema validation, sanitizer rejection, and bucket helpers.
- `tests/test_analytics_source_guards.js` - source guard for forbidden analytics payload names and generated dist exclusion.
- `tests/ui/ga4_tag_and_events.spec.js` - Playwright network tests for disabled analytics, enabled analytics, and representative event payloads.

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
- `frontend/src/components/JiraExportButton.jsx` - wire Jira export through the shared tracked-link/open helper.
- `docs/README_ANALYTICS.md` - update the durable analytics contract after launch.
- `frontend/src/eng/useEngSprintData.js` - wire user-visible ENG auth/task error surfaces if they cannot be cleanly tracked through a parent callback.
- `frontend/src/epm/EpmControls.jsx`, `frontend/src/epm/EpmRollupPanel.jsx`, `frontend/src/epm/EpmSettings.jsx` - wire EPM interaction events.
- `frontend/src/settings/SettingsModal.jsx`, `frontend/src/settings/JiraFieldSettings.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/settings/UserConnectionsSettings.jsx` - wire settings and connection events.
- `frontend/src/stats/*.jsx` - wire click/filter events only; avoid unthrottled hover telemetry.

Do not modify:
- `frontend/dist/*` by hand.
- Scenario write-back capability or Home/Townsquare write gates.
- Jira/Home route auth behavior except the new read-only analytics context route.
- Saved config schemas.

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
  "ga4UserId": "pseudonymous-value-or-null"
}
```

The response must not include raw Atlassian account IDs, emails, display names, workspace IDs, cloud IDs, Jira URLs, Home URLs, project keys, team IDs, group IDs, auth connection IDs, token versions, or service integration metadata.

## Analytics Context Route Contract

| Case | Expected response | Notes |
| --- | --- | --- |
| `GA4_ENABLED=false` | `200 {"enabled": false, "gtmContainerId": null, "measurementId": null, "debugMode": false, "ga4UserId": null}` | Must not require auth, must not expose config details, and must not cause the browser to load GTM. |
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

1. `pageview` - page name/view tracking.
2. `userevent` - all app-owned product events.

Pageview payload shape:

```js
window.dataLayer.push({
  event: 'pageview',
  trigger: 'pageview',
  event_type: 'pageview',
  event_name: 'page_view',
  page_name: 'dashboard',
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
  trigger: 'userevent',
  event_type: 'event',
  event_name: 'scenario_action',
  feature_name: 'scenario',
  workflow_action: 'compute',
  source_surface: 'scenario',
  lane_mode: 'team',
  result: 'success',
  duration_bucket: '1_3s',
  debug_mode: true
});
```

GTM maps the `userevent` Custom Event trigger to one generic GA4 Event tag whose Event Name is `{{DLV - event_name}}`. The tag must send only parameters that are present on the current dataLayer push; it must not serialize blank or undefined values from the full fixed property set. Implement this with Data Layer Variables that have no default value, or with a single event-parameter variable/template that reads the current flat push and returns only defined allowlisted keys. Verification must inspect the outgoing GA4 hit and assert each event stays at or below GA4's 25-parameter event limit. Adding a new value for an existing property must not require a GTM change. Adding a new property key requires updating this plan, `docs/README_ANALYTICS.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, `frontend/src/analytics/events.js`, tests, and the single GTM variable/parameter map. The app wrapper may keep an internal canonical envelope, but the pushed GTM payload stays flat so the GTM configuration remains two triggers plus fixed variable maps.

Configuration rule:
- No additional GTM trigger, tag, or variable is required when adding a new app event name to the taxonomy if it uses `event: 'userevent'`, an allowlisted `event_name` value, and only existing property keys from the fixed user-event map.
- New GTM configuration is required only when introducing a new dataLayer property key, a new GA4 destination, or a new transport behavior.
- App-owned code must never push raw URLs, query strings, issue keys, names, token material, full IP addresses, JSON payloads, or free text into either dataLayer payload shape.

---

## Event Catalog

Use these event names and parameters as the v1 allowlist. Do not add ad hoc event names from components. Every `event_type=event` payload requires `feature_name` in addition to the row-specific parameters below. Every `event_type=pageview` payload requires `page_name`.

| Decision | Event name | Trigger | Parameters |
| --- | --- | --- | --- |
| Page/view adoption | `page_view` | GTM receives `dataLayer.event=pageview` on dashboard load and page/view/mode transitions | `page_name`, `dashboard_view`, `eng_mode`, `auth_mode`, `source_surface` |
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
| Scenario compute and navigation | `scenario_action` | Scenario opened, computed, lane mode changed, conflicts-only toggled | `workflow_action`, `lane_mode`, `sprint_selection_state`, `issue_count_bucket`, `conflict_count_bucket` |
| Scenario edits | `scenario_action` | Drag/reschedule, undo, redo, discard, save draft, reload history | `workflow_action`, `override_count_bucket`, `conflict_state`, `dependency_state`, `result` |
| Scenario writeback gate | `scenario_action` | Preview/writeback gate checked or blocked | `workflow_action=writeback_gate`, `result`, `blocking_reason`, `pending_unsaved_state` |
| Statistics adoption | `stats_action` | Stats view, metric, range, chart click-to-filter, legend filter | `stats_view`, `workflow_action`, `metric`, `range_size_bucket`, `source_surface` |
| Chart inspection | `chart_action` | Throttled chart click/readout, not raw hover | `chart_id`, `workflow_action`, `series_type`, `point_bucket`, `source_surface` |
| EPM controls | `epm_action` | EPM tab, project scope, sub-goal scope, expand/collapse, rollup load | `workflow_action`, `epm_tab`, `project_scope`, `subgoal_scope`, `project_count_bucket`, `result` |
| EPM settings sort | `sort_changed` | EPM settings Projects table sort by Project, Status, or Jira label | `sort_scope=epm_settings_projects`, `sort_key=name|status|label`, `sort_direction=asc`, `source_surface=epm_settings` |
| External Jira issue-list/filter opens | `external_link_opened` | Any Jira `/issues/?jql=` issue-list/filter view opens from export buttons, stats/capacity tables, ENG alerts, Scenario, or EPM | `link_type=jira_issue_list`, `issue_kind=story|epic|initiative|mixed|unknown`, `issue_count_bucket`, `source_surface`, `result` |
| External Jira issue/epic/initiative browse opens | `external_link_opened` | Any direct Jira `/browse/<key>` handoff from dashboard, ENG alerts, or EPM rollup/tree surfaces | `link_type=jira_issue_browse`, `issue_kind=story|epic|initiative|unknown`, `source_surface`, `result` |
| External Jira Home project/update opens | `external_link_opened` | EPM Home project/update link opens from settings, board header, metadata-only card, or latest update | `link_type=jira_home_project|jira_home_update`, `epm_tab=active|backlog|archived|settings|unknown`, `project_scope=single|all|settings`, `source_surface`, `result` |
| API reliability | `api_result` | Browser-observed allowlisted API response completes | `feature_name`, `api_surface`, `method`, `status_bucket`, `result`, `duration_bucket`, `cache_state`; for `api_surface=epm_projects|epm_rollup`, use `feature_name=epm` and also include `epm_tab`, `project_scope`, and `subgoal_scope` when known |
| App errors | `app_error_shown` | User-visible server/auth/config unavailable state appears | `error_area`, `error_code`, `recoverable_state`, `source_surface` |

Use `select_content` only for low-cardinality content/action selections. Use custom event names for app workflow states. Do not use reserved event names such as `click`, `error`, `page_view`, `scroll`, `session_start`, `user_engagement`, `view_search_results`, `file_download`, `form_start`, or `form_submit` through `event=userevent`. The only app-owned path to GA4 `page_view` is the `event=pageview` GTM trigger.

GA4-managed Enhanced Measurement event policy when analytics is enabled:
- `scroll` is allowed when analytics is enabled.
- `view_search_results`, `file_download`, `form_start`, and `form_submit` are allowed only after the runbook's managed-metadata safety gate passes for the deployed app.

These automatic events are configured in GA4 Admin, not emitted through `frontend/src/analytics/events.js`. Do not register their URL, link, file, form, or search-term parameters as custom definitions in v1 unless a separate reporting decision explicitly needs them. Outbound `click` Enhanced Measurement is excluded in v1 unless operator configuration and tests prove Atlassian/Jira/Home `link_url` values cannot be sent through managed link tracking; app-owned `external_link_opened` events count those links without raw URLs.

Automated tracking is useful for generic web engagement, but it is not a substitute for app-owned events. Scenario Planner, EPM, settings, auth recovery, planning, and API reliability need typed domain parameters and privacy bucketing that Enhanced Measurement cannot infer. Keep both layers separate: GA4-managed events cover generic browser interactions; app-owned events cover product decisions.

---

## Event Parameter Contract

The contract below is a validation allowlist, not a GA4 admin registration list. These are event parameters, not legacy `event_action` or `event_label` fields. The implementation must not emit `event_category`, `event_action`, or `event_label`.

DataLayer control fields:
- `event` is the GTM trigger name and must be only `pageview` or `userevent`.
- `trigger` duplicates the allowed GTM trigger name for audit/tests and must match `event`.
- `event_type` must be `pageview` or `event`.
- `event_name` is the final GA4 event name. GTM uses it as the user-event tag Event Name and must not forward it as a GA4 event parameter.
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
- `conflict_state`
- `dashboard_view`
- `dependency_state`
- `dirty_state`
- `duration_bucket`
- `eng_mode`
- `epm_tab`
- `error_area`
- `error_code`
- `feature_name`
- `filter_type`
- `from_mode`
- `from_view`
- `group_count_bucket`
- `issue_count_bucket`
- `issue_kind`
- `lane_mode`
- `link_type`
- `page_name`
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
- `sort_direction`
- `sort_key`
- `sort_scope`
- `sprint_selection_state`
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
- Initial registration should stay at or below the named-report-driven event-scoped custom dimensions in the GA4 user-configuration runbook and under GA4's 50 event-scoped custom-dimension standard-property limit.
- Allowed but unregistered parameters may still be sent when validated by the event schema; register them later only when a named report needs them.

Forbidden parameter/property names or values:
- `user_id` as a custom dimension or event parameter. GA4 `user_id` must be set through the config/set command only.
- Google-reserved event parameter names: `cid`, `currency`, `customer_id`, `customerid`, `dclid`, `gclid`, `session_id`, `sessionid`, `sfmc_id`, `sid`, `srsltid`, `uid`, `user_id`, and `userid`.
- Google-reserved user property names: `cid`, `customer_id`, `customerid`, `first_open_after_install`, `first_open_time`, `first_visit_time`, `google_allow_ad_personalization_signals`, `last_advertising_id_reset`, `last_deep_link_referrer`, `last_gclid`, `lifetime_user_engagement`, `non_personalized_ads`, `session_id`, `session_number`, `sessionid`, `sfmc_id`, `sid`, `uid`, `user_id`, and `userid`.
- Any parameter or user-property name with reserved `ga_`, `google_`, `firebase_`, `_`, or `gtag.` prefixes. Treat `query_id` as a reserved event-name prefix.
- Locally forbidden in v1 because ecommerce/item analytics are out of scope: `item_id`, `item_name`, `item_brand`, `item_category`, `item_list_id`, `item_list_name`, `promotion_id`, and `promotion_name`.
- Raw names, emails, account IDs, issue keys, Jira keys, Home IDs, URLs, labels, search text, assignees, owners, team/group names, sprint names, project names, field IDs, board IDs, draft IDs, version IDs, JQL, error messages, callback query strings, token material, local paths, full IP addresses, or JSON payloads in app-owned custom events.

---

## Sub-Agent Implementation Handoff

Split implementation into disjoint tasks. Agents are not alone in the codebase; each worker must preserve other workers' changes and avoid editing files outside its ownership.

### Worker A: Analytics Foundation And Tag Loading

Ownership:
- `jira-dashboard.html`
- `frontend/src/analytics/analytics.js`
- `frontend/src/analytics/events.js`
- `backend/security/headers.py`
- `.env.example`
- `README.md`
- `tests/test_analytics_events.js`
- `tests/test_analytics_source_guards.js`
- `tests/ui/ga4_tag_and_events.spec.js`

Tasks:
- [ ] Record the internal analytics decision in implementation comments/docs: this employee-only tool has no in-app analytics consent UI, consent localStorage key, or revoke flow; `GA4_ENABLED` is the only app-level analytics gate.
- [ ] Define `window.dataLayer` in the HTML shell without making a network request to Google while analytics context is disabled or unknown.
- [ ] Inject `https://www.googletagmanager.com/gtm.js?id=<GTM_CONTAINER_ID>` only after `/api/analytics/context` returns `enabled:true`.
- [ ] Do not call `gtag('event', ...)` from app code. App code may only call `window.dataLayer.push(...)` through the central analytics wrapper.
- [ ] Do not override `page_location` or `page_title` in v1; GA4 default page URL/title metadata is accepted when analytics is enabled. App-owned custom events must not include raw URLs or titles as parameters.
- [ ] Implement `initAnalytics`, `setAnalyticsUser`, `trackPageview`, `trackEvent`, `trackExternalLinkOpened`, `bucketCount`, `bucketDuration`, and `sanitizeAnalyticsParams`.
- [ ] Implement a central event schema that validates dataLayer `event` trigger names, `trigger`, `event_type`, canonical `event_name`, allowed parameters, enum values, bucket formats, booleans, and numeric metric fields before any push reaches `window.dataLayer`.
- [ ] Validate every `event_type=event` includes `feature_name`, every `event_type=pageview` includes `page_name`, and every outbound payload has at most 25 event parameters after omitted/undefined values are removed.
- [ ] Reject forbidden parameter names and values at runtime in development/test for app-owned custom events, including dynamic values such as selected project names, sprint labels, team/group objects, Jira error text, URLs, query strings, issue keys, full IP addresses, and Home/Jira labels. If a later named report adds IP-derived context, accept only server-generated truncated prefixes such as `xxx.yyy.zzz.---`.
- [ ] Add CSP support for GA script, image, and collect endpoints using the directive-specific file map above.
- [ ] Add `tests/test_security_headers.py` assertions for `script-src`, `img-src`, and `connect-src`.
- [ ] Add Playwright assertions that `GA4_ENABLED=false` sends no requests to `google-analytics.com` or `googletagmanager.com`, `GA4_ENABLED=true` loads GTM without CSP violations, app-owned code pushes only `event=pageview` or `event=userevent`, app-owned payloads contain only sanitized allowlisted parameters, app-owned Jira/Home link opens never include URLs/JQL/issue keys/Home IDs, and GA4-managed Enhanced Measurement events can fire only when analytics is enabled. Assert managed `view_search_results`, `file_download`, `form_start`, and `form_submit` are enabled only after their automatic parameters pass the runbook safety gate. If outbound-click Enhanced Measurement is later enabled, assert Atlassian/Jira/Home `link_url` values cannot be sent through managed `click` collection.

Verification:
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `node tests/test_analytics_events.js`
- [ ] `npx playwright test tests/ui/ga4_tag_and_events.spec.js`
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
- `frontend/src/analytics/externalLinks.js`
- `frontend/src/components/TrackedExternalLink.jsx`
- `frontend/src/components/JiraExportButton.jsx`
- `frontend/src/jiraExportUtils.mjs`
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
- [ ] Wire EPM controls, settings Projects table sort changes, board events, Jira Home project/update link opens, direct Jira issue/epic/initiative browse opens, and every Jira issue-list/filter open without Home project names, IDs, labels, goal keys, URLs, JQL, or issue keys. Cover export buttons plus stats/capacity/ENG alert `/issues/?jql=` links.
- [ ] Wire Scenario events for compute/open, edits, draft save/history, and writeback gate outcomes without issue keys, draft IDs, version IDs, assignees, or override payloads.
- [ ] Wire stats/chart events for view selection, filter changes, legend/click-to-filter, and throttled readouts. Do not instrument raw hover streams.
- [ ] Add browser-observed `api_result` only for allowlisted surfaces: `config_bootstrap`, `auth_status`, `home_connection`, `eng_tasks`, `stats_source`, `scenario`, `scenario_drafts`, `epm_projects`, `epm_rollup`, and `settings_save`. For `epm_projects` and `epm_rollup`, include low-cardinality `epm_tab`, `project_scope`, and `subgoal_scope` when known so EPM load outcomes can be segmented.
- [ ] For `stats_source`, emit one `api_result` per logical stats load, not one event per progressive sprint chunk, unless a named report needs chunk-level reliability.
- [ ] For Scenario Planner fetches, use explicit `api_surface=scenario` or `api_surface=scenario_drafts`; do not infer surfaces from draft IDs, version URLs, query strings, or raw endpoint paths.

Verification:
- [ ] `npm run build`
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `npx playwright test tests/ui/ga4_tag_and_events.spec.js`

### Worker D: Final Verification

Ownership:
- No production ownership unless fixing failures found in analytics files.

Tasks:
- [ ] Run sanitizer unit tests with raw forbidden examples: search text, selected project names, sprint labels, team/group objects, Jira error text, URLs, query strings, issue keys, Home/Jira labels, draft IDs, version IDs, and token-like strings.
- [ ] Run a forbidden-payload source scan for `searchTerm`, `issue.key`, `assignee`, `displayName`, `email`, `team.name`, `group.name`, `project.name`, `label`, `jql`, `draftId`, `versionId`, `jiraUrl`, `homeUrl`, `apiToken`, `access_token`, `refresh_token`, `authorization`, IP-address patterns, and local absolute path patterns in app-owned analytics send calls. Treat this as a backstop, not the primary privacy test.
- [ ] With `GA4_ENABLED=false`, verify no GA network requests are made on initial load, view switches, search, filters, settings open, and scenario interactions.
- [ ] With `GA4_ENABLED=true` and `GA4_DEBUG_MODE=true`, verify one `pageview` dataLayer push and representative `userevent` pushes for app search, team/group/sprint/project filters, EPM, EPM settings sort, Jira issue-list/filter opens from export/stats/capacity/alert surfaces, direct Jira issue/epic/initiative browse opens, Jira Home project/update opens, settings, connection, scenario, stats, and API outcomes. Verify network payloads/DebugView contain only allowed enum, bucket, boolean, and numeric app-owned values, every app-owned `userevent` includes `feature_name`, every pageview includes `page_name`, and each GA4 hit stays at or below 25 event parameters. Also verify GA4-managed `scroll`, `file_download`, `form_submit`, and `view_search_results` when those interactions are available in the test fixture and their managed metadata safety gates pass. Verify no managed outbound `click` event carries Atlassian/Jira/Home `link_url` unless operator configuration and tests prove those URLs cannot be sent.
- [ ] Run the full test suite before push.

Verification:
- [ ] `npm run build`
- [ ] `node tests/test_analytics_source_guards.js`
- [ ] `node tests/test_analytics_events.js`
- [ ] `npx playwright test tests/ui/ga4_tag_and_events.spec.js`
- [ ] `.venv/bin/python -m unittest tests.test_analytics_identity tests.test_analytics_routes`
- [ ] `.venv/bin/python -m unittest tests.test_security_headers`
- [ ] `.venv/bin/python -m unittest discover -s tests`

---

## Execution Tasks

### Task 1: Add Analytics Foundation Tests

Files:
- Create `tests/test_analytics_events.js`
- Create `tests/test_analytics_source_guards.js`
- Create `tests/ui/ga4_tag_and_events.spec.js`

- [ ] Add event schema tests that reject unknown event names, unknown parameters, reserved parameter names, malformed buckets, non-enum values, raw search terms, project/team/group/sprint names, issue keys, URLs/query strings, Jira error text, labels, draft/version IDs, token-like strings, and object payloads.
- [ ] Add a source-guard test that fails if analytics send calls include forbidden parameter names or string snippets from the forbidden list.
- [ ] Add a Playwright test that loads the dashboard with `GA4_ENABLED=false` and asserts no requests to `googletagmanager.com` or `google-analytics.com`.
- [ ] Add a Playwright test that loads the dashboard with `GA4_ENABLED=true`, performs one page/view transition, one app search, one sprint filter, one team/group filter, one EPM project filter, one settings action, one connection action, one scenario action, one API action, one Jira issue-list/filter open, one direct Jira issue/epic/initiative browse open, and one Jira Home project/update open, then asserts dataLayer pushes use only `pageview`/`userevent` trigger names and network payloads use only allowlisted enum, bucket, boolean, and numeric values.
- [ ] Assert every app-owned `userevent` includes `feature_name`, every app-owned pageview includes `page_name`, undefined or omitted dataLayer variables are not serialized into GA4 hits, and each GA4 hit has at most 25 event parameters.
- [ ] Run `node tests/test_analytics_events.js`, `node tests/test_analytics_source_guards.js`, and `npx playwright test tests/ui/ga4_tag_and_events.spec.js`; expected result before implementation is failure.

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

### Task 3: Add Tag Loading And CSP

Files:
- Modify `jira-dashboard.html`
- Modify `backend/security/headers.py`
- Create/modify `frontend/src/analytics/analytics.js`
- Create/modify `frontend/src/analytics/events.js`

- [ ] Initialize `window.dataLayer` before any analytics wrapper call without loading GTM while analytics context is disabled or unknown.
- [ ] Do not implement analytics consent UI, consent localStorage key, grant/update command flow, or revocation flow. This is an internal employee tool controlled by `GA4_ENABLED`.
- [ ] Add lazy GTM container injection for `GTM_CONTAINER_ID` only after `/api/analytics/context` returns `enabled:true`.
- [ ] Push page name/view data through `dataLayer.push({ event: 'pageview', ... })`; do not add direct `gtag` event calls.
- [ ] Keep GA4 defaults for `page_location` and `page_title`; do not override them in app code.
- [ ] Add runtime guards that no app-owned event is sent while analytics is disabled or context is not initialized.
- [ ] Update CSP for GA script/connect endpoints.
- [ ] Extend `tests/test_security_headers.py` for the exact `script-src`, `img-src`, and `connect-src` directive additions.
- [ ] Run the Playwright disabled/enabled analytics and CSP tests and confirm no disabled-mode GA network calls and no enabled-mode CSP violation.

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
- [ ] Wire page name/view transitions through `trackPageview`, which pushes `event=pageview`.
- [ ] Wire `app_search` with `query_length_bucket` and `result_count_bucket`; never send the search term.
- [ ] Wire sprint/group/team filters with counts and scope enums; never send names or IDs.
- [ ] Wire settings open/test/save/cancel/result actions.
- [ ] Wire user Home/Townsquare connection connect/revoke/recovery events.
- [ ] Wire planning selection counts and story point buckets.
- [ ] Wire Scenario open/compute/edit/draft/history/writeback-gate actions.
- [ ] Wire Statistics and chart click/filter/readout actions with throttling.
- [ ] Wire EPM controls, settings, Projects table sort changes, board expand/collapse, rollup result actions, Jira issue-list/filter opens across export/stats/capacity/alert surfaces, direct Jira issue/epic/initiative browse opens, and Jira Home project/update link opens.

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
- [ ] For EPM API wrappers, include `feature_name=epm` and safe context (`epm_tab`, `project_scope`, `subgoal_scope` when known) on `epm_projects` and `epm_rollup` outcomes.
- [ ] Never send query strings, request bodies, response bodies, Jira errors, validation messages, or endpoint-specific identifiers.
- [ ] Keep API analytics failures swallowed and non-blocking.

### Task 7: Documentation And GA4 Admin Handoff

Files:
- Modify `README.md`
- Modify `.env.example`
- Modify `docs/README_ANALYTICS.md`
- Modify `AGENTS.md`
- Reference `docs/plans/SUPPORT-ga4-user-configuration.md`

- [ ] Document local enablement and debug-mode verification.
- [ ] Document the internal analytics decision, `GA4_ENABLED` behavior, and the list of forbidden payload classes.
- [ ] Document the durable analytics contract in `docs/README_ANALYTICS.md`, including event taxonomy, future-feature rules, custom-definition budget, privacy rules, and drift checks.
- [ ] Add an `AGENTS.md` rule requiring analytics impact review for future user-visible feature work.
- [ ] Link the GA4 admin setup runbook.

### Task 8: Final Verification

- [ ] Run `npm run build`.
- [ ] Run `node tests/test_analytics_source_guards.js`.
- [ ] Run `node tests/test_analytics_events.js`.
- [ ] Run `npx playwright test tests/ui/ga4_tag_and_events.spec.js`.
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
