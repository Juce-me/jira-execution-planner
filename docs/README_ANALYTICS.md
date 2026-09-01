# Analytics Contract

Status: implemented in app code; GA4/GTM operator setup remains deployment-gated
Type: product analytics contract

This is the durable source of truth for Jira Delivery Planner analytics. While `docs/plans/DONE-ga4-instrumentation.md` is still active, that plan owns implementation sequencing; this document owns the product contract future feature work must keep current.

## Scope

- Analytics vendor: Google Analytics 4.
- Active architecture: Google Tag Manager web container with `GA4_ENABLED`-gated loading, periodic context refresh for open tabs, and a stable two-event `dataLayer` contract.
- Not in scope: server-side GTM, Measurement Protocol, Google Ads, remarketing, audiences, Google Signals, or ad personalization.
- GTM schema policy: app code may push only `event=pageview` or `event=userevent` to `window.dataLayer`. GTM owns exactly two app-owned Custom Event triggers: one for `pageview`, one for `userevent`.
- Page-view policy: logical app views are measured through `dataLayer.push({ event: 'pageview', ... })`; GTM maps that to GA4 `page_view` with the fixed pageview property map.
- Enhanced Measurement policy: GA4-managed `scroll` may fire when analytics is enabled. `view_search_results`, `file_download`, `form_start`, and `form_submit` may fire only after the runbook's managed-metadata safety gate proves their automatic parameters cannot expose Jira/Home/auth URLs, callback data, raw app-search terms, JQL, issue keys, tokens, local paths, or user-entered text. Outbound-click Enhanced Measurement stays off in v1 unless operator configuration and tests prove Atlassian/Jira/Home `link_url` values cannot be sent, because Jira issue-list links can expose URLs, JQL, and issue keys through managed click metadata. App code must not recreate reserved names as custom sends.
- Privacy floor for app-owned events: no raw email, name, phone, free text, token, raw user agent, full IP address, Atlassian account id, workspace id, cloud id, Jira/Home URL, issue key, team/group/project/sprint name, Jira label, JQL, draft id, version id, local path, or config payload is sent as an app-owned GA4 event parameter or user property.
- GA4 defaults: when analytics is enabled, GA4-managed page URL/title metadata is allowed for the web stream. Managed file/form/search/link metadata is allowed only when the runbook safety gate or operator configuration proves sensitive values cannot be sent. Browser GTM/GA4 cannot app-truncate the network source IP before Google receives it; this contract relies on GA4's documented IP handling and forbids full IP addresses in app-owned payloads. If a named internal report later needs IP-derived context, send only a server-generated truncated prefix such as `xxx.yyy.zzz.---`, never a full IP value.
- Internal analytics decision: this is an internal employee tool, so there is no in-app analytics consent UI, consent localStorage key, or grant/revoke flow. `GA4_ENABLED=false` is the single deployment kill switch: new page loads do not load GTM, app-owned sends stop, and already-open tabs re-check the server switch every 60 seconds. `GA4_ENABLED=true` measures employee usage under internal policy.

## Future Feature Rule

Every user-visible feature change must answer these before merge:

- What decision will this feature's analytics support?
- Which `trigger`, `event_type`, canonical `event_name`, `feature_name` or `page_name`, and typed parameters are added or changed?
- Which test asserts the event and required parameters?
- Which row in this taxonomy changed?
- Did this reuse existing GA4 dimensions first, or does it need a named-report reason for a new custom definition?
- Did any GA4 admin, custom-definition, transport, or runbook step change?

If no analytics event is needed, add or update an allowlist row with the reason.

Do not add Universal Analytics fields (`event_category`, `event_action`, `event_label`), `event_group`, `ga4_event_name`, or boolean presence dimensions such as `has_*`.

## Identity Rule

GA4 must not identify a specific person. The only allowed GA4 User-ID is the server-derived pseudonymous value from `docs/plans/DONE-ga4-instrumentation.md`.

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
  trigger: 'userevent',
  event_type: 'event',
  event_name: '<event name from the table below>',
  // allowlisted typed parameters only
});
```

Use `window.dataLayer.push({ ... })`; do not use `dataLayer(...)`, direct `gtag('event', ...)`, or product event names as the dataLayer `event` value.

Logical page/view tracking is pushed as:

```js
window.dataLayer.push({
  event: 'pageview',
  trigger: 'pageview',
  event_type: 'pageview',
  event_name: 'page_view',
  page_name: 'dashboard',
  dashboard_view: 'eng',
  source_surface: 'dashboard'
});
```

Every app-owned `userevent` requires `feature_name`. Every app-owned pageview requires `page_name`.

| Event name | Required params | Trigger | Primary anchors | Side | Decision/use |
| --- | --- | --- | --- | --- | --- |
| `page_view` | `page_name`, `dashboard_view`, `auth_mode`, `source_surface` | GTM receives `dataLayer.event=pageview` | `frontend/src/dashboard.jsx` | browser/GTM | Logical page/view adoption |
| `login` | `method`, `auth_mode`, `result`, `source_surface` | OAuth authenticated transition only | `frontend/src/dashboard.jsx`, `backend/routes/auth_routes.py` | browser | Auth adoption and recovery |
| `logout` | `auth_mode`, `source_surface` | User-triggered logout completes | `backend/routes/auth_routes.py` | browser | Auth exit |
| `select_content` | `content_type`, `content_id`, `from_view`, `source_surface` | ENG/EPM view changes | `frontend/src/dashboard.jsx` | browser | ENG/EPM adoption |
| `select_content` | `content_type`, `content_id`, `from_mode`, `source_surface` | Catch Up, Planning, Board, Statistics, or Scenario mode changes; `content_id` and `from_mode` carry the `eng_mode` value (`catch_up`, `planning`, `board`, `statistics`, `scenario`) | `frontend/src/dashboard.jsx` | browser | ENG mode adoption |
| `app_search` | `search_scope`, `query_length_bucket`, `result_count_bucket`, `source_surface` | Debounced dashboard, EPM, or settings search settles; ENG result counts include Story, Epic, and Initiative hierarchy matching | `frontend/src/dashboard.jsx`, `frontend/src/epm/*`, `frontend/src/settings/*` | browser | Search friction |
| `filter_changed` | `filter_type`, `selection_count_bucket`, `scope_type`, `source_surface`; group changes may also include `group_count_bucket` | Sprint, group, team, EPM project, stats, field, or issue-type filters change | `frontend/src/dashboard.jsx`, `frontend/src/epm/*`, `frontend/src/settings/*` | browser | Filter usage |
| `sort_changed` | `sort_scope`, `sort_key`, `sort_direction`, `source_surface` | EPM settings Projects sort by Project, Status, or Jira label | `frontend/src/epm/EpmSettings.jsx`, `frontend/src/epm/epmProjectUtils.mjs` | browser | EPM settings sort usage |
| `sort_changed` | `sort_scope=eng_epics`, `sort_key` (one of `default`, `priority`, `status`, `track_committed`, `track_flexible`), `feature_name=eng`, `source_surface=eng` | ENG epic Sort dropdown: user selects a sort mode (Default / Priority / Status / Track) | `frontend/src/dashboard.jsx` (`handleEngEpicSortChange`) | browser | ENG epic sort adoption |
| `external_link_opened` | `link_type`, `source_surface`, `result`; plus `issue_count_bucket`/`issue_kind` for `jira_issue_list`, `issue_kind` for `jira_issue_browse`, or `epm_tab`/`project_scope` for `jira_home_project|jira_home_update` | Jira issue-list/filter, direct Jira issue/epic/initiative browse, or Jira Home project/update link opens | `frontend/src/components/TrackedExternalLink.jsx`, `frontend/src/components/JiraExportButton.jsx`, `frontend/src/jiraExportUtils.mjs`, `frontend/src/dashboard.jsx`, `frontend/src/stats/*`, `frontend/src/eng/EngAlertsPanel.jsx`, `frontend/src/epm/*` | browser | External Jira/Home link usage |
| `settings_action` | `section`, `workflow_action`, `result`, `validation_count_bucket`, `dirty_state`; Department preference changes may use bucketed `selection_count_bucket`, first-run selection uses `group_count_bucket` only, and workspace revision conflicts use `conflict_state=remote` plus bucketed `conflict_count_bucket`. Onboarding uses exactly `section=onboarding`, `workflow_action=started|completed|skipped`, and `source_surface=first_run|settings`; `completed` and `skipped` add `result=success` only after the preference write succeeds, while `started` has no `result`. | Settings tab open, test, save, cancel, validation failure, workspace revision conflict (`workflow_action=save_result`, `result=failure`), app-admin membership save, Department visibility preference change, first-run Department selection completion, onboarding start/completion/skip, or shared excluded-capacity epic toggle from Planning/Reporting. Tab-open also fires from the ENG Board's first-run *Configure Group Board* link (`section=boards`, `source_surface=board`). Step navigation is intentionally untracked: Next, Back, target activation, target visibility, and displayed step content create no new onboarding event because they are transient and would add noise or risk collecting issue, Department, Team, sprint, search, and other raw context. Field-preview activation retains the normal safe `priority_options_open`, `project_track_options_open`, or `status_options_open` event owned by the underlying control; it does not add a parallel tour event. | `frontend/src/settings/*`, `frontend/src/onboarding/useOnboardingTour.js`, `frontend/src/dashboard.jsx` | browser | Settings and onboarding reliability |
| `connection_action` | `connection_type`, `workflow_action`, `previous_status`, `result`, `error_code` | Home token connect, revoke, or recovery | `frontend/src/settings/UserConnectionsSettings.jsx` | browser | Connection reliability |
| `planning_action` | `workflow_action`, `status_bucket`, `selected_count_bucket`, `selected_sp_bucket` | Task select, bulk select, include-state change, or Planning selection undo | `frontend/src/dashboard.jsx` | browser | Planning usage |
| `scenario_action` | `workflow_action`, `lane_mode`, `result` | Scenario open, compute, edit, draft, history, or writeback gate | `frontend/src/dashboard.jsx` | browser | Scenario Planner usage |
| `stats_action` | `stats_view`, `workflow_action`, `metric`, `range_size_bucket`, `source_surface`; Project Track mode change also sends `chart_id=project_track`, `mode` (`epic`\|`team`) | Stats view, metric, range, chart click-to-filter, legend filter, or Project Track Mode toggle | `frontend/src/dashboard.jsx`, `frontend/src/stats/*` | browser | Statistics adoption |
| `chart_action` | `chart_id`, `workflow_action`, `series_type`, `point_bucket`, `source_surface`. `series_type` is a fixed enum of effort buckets: `excluded_capacity`, `ad_hoc`, `product`, `tech` (snake_case tokens, never raw epic keys, summaries, or BAU display copy). Project Track capacity-side change sends `chart_id=project_track`, `capacity_side` (`product`\|`tech`\|`both`) | Throttled chart click/readout, not raw hover; Effort Split legend toggle and segment readout emit `chart_id=effort_split` with the bucket `series_type`; Project Track Capacity side toggle emits `chart_id=project_track` with `capacity_side` | `frontend/src/stats/*`, `frontend/src/dashboard.jsx` | browser | Chart inspection |
| `filter_changed` | `filter_type`, `chart_id`, `value_state`, `source_surface`; Project Track exclusion toggles send `filter_type=exclude_ad_hoc`\|`exclude_excluded_capacity`, `chart_id=project_track`, `value_state=on`\|`off` | Project Track Exclude Ad Hoc / Exclude Excluded Capacity checkboxes change | `frontend/src/dashboard.jsx` | browser | Filter usage |
| `epm_action` | `workflow_action`, `epm_tab`, `project_scope`, `subgoal_scope`, `result` | EPM tab, project scope, sub-goal scope, expand/collapse, or rollup load | `frontend/src/epm/*` | browser | EPM usage |
| `issue_status_action` | `workflow_action` (`status_options_open`\|`status_change_submit`\|`status_change_result`), `source_surface` (`catch_up`\|`planning`\|`board`), `status_bucket`, `selected_count_bucket`, `selected_sp_bucket`, `issue_type_mix` (`stories`\|`epics`\|`subtasks`\|`mixed`), `result` (`success`\|`partial`\|`failure`) | ENG Catch Up single-issue status change; ENG Planning batch status change for selected Stories, Epics, and Subtasks; ENG Board epic-detail-panel epic and story status change, and an ENG Board card dragged to another column (§6.4) | `frontend/src/eng/useEngStatusTransitions.js`, `frontend/src/analytics/dashboardAnalytics.js` | browser | ENG status-change adoption and reliability |
| `issue_priority_action` | `workflow_action` (`priority_options_open`\|`priority_change_submit`\|`priority_change_result`), `source_surface` (`catch_up`\|`planning`\|`board`), `selected_count_bucket`, `issue_type_mix` (`stories`\|`epics`\|`subtasks`\|`mixed`), `priority_bucket` (`highest`\|`high`\|`medium`\|`low`\|`lowest`\|`other`), `result` (`success`\|`partial`\|`failure`) | ENG Catch Up/Planning Story card and Epic header priority change; ENG Board epic-detail-panel epic and story priority change | `frontend/src/eng/useEngPriorityTransitions.js`, `frontend/src/analytics/dashboardAnalytics.js` | browser | ENG priority-change adoption and reliability |
| `issue_project_track_action` | `workflow_action` (`project_track_options_open`\|`project_track_change_submit`\|`project_track_change_result`), `source_surface` (`catch_up`\|`planning`\|`board`), `selected_count_bucket`, `issue_type_mix` (`epics`), `value_state` (`flexible`\|`committed`, only after a target is selected), `result` (`success`\|`failure`, result event only) | ENG Catch Up/Planning Epic header Project Track change; ENG Board epic-detail-panel Project Track change | `frontend/src/eng/useEngProjectTrackTransitions.js`, `frontend/src/analytics/dashboardAnalytics.js` | browser | ENG Project Track change adoption and reliability |
| `api_result` | `feature_name`, `api_surface`, `method`, `status_bucket`, `result`, `duration_bucket`, `cache_state`; for EPM APIs use `feature_name=epm` and also include `epm_tab`, `project_scope`, `subgoal_scope` when known; `api_surface=jira_issue_transitions` sends only `feature_name=eng_status_transitions` plus the standard `method`/`status_bucket`/`result`/`duration_bucket`/`cache_state` reliability params, never issue keys, transition ids, or Jira error text; `api_surface=jira_issue_priorities` sends only `feature_name=eng_priority_changes` plus the same standard reliability params, never issue keys, priority ids, or Jira error text; `api_surface=jira_issue_project_track` sends only `feature_name=eng_project_track_changes` plus the same standard reliability params, never issue keys, field ids, or Jira error text; `api_surface=eng_issue_description` sends only `feature_name=eng_epic_description` plus the same standard reliability params, never issue keys, description HTML, or Jira error text; `api_surface=board_config_statuses` sends only `feature_name=group_board_composer` plus the same standard reliability params, never board ids, status ids, or Jira error text | Browser-observed allowlisted API response completes | `frontend/src/api/*` | browser | API reliability |
| `app_error_shown` | `error_area`, `error_code`, `recoverable_state`, `source_surface` | User-visible server/auth/config unavailable state appears; the global auth lock emits once per mounted-document lock episode only when analytics was already initialized and enabled, using a context-free fixed payload that omits `ga4_user_id` and `debug_mode` | `frontend/src/dashboard.jsx`, `frontend/src/components/AuthRequiredGate.jsx` | browser | Reliability and recovery |

### No-Event Allowlist

These user-visible changes intentionally do not add a new app-owned `userevent`; the reason is documented here so future feature reviews do not re-add duplicate or sensitive analytics.

| Feature action | Primary anchors | Reason | Reviewed on |
| --- | --- | --- | --- |
| ENG story subtask expand/collapse | `frontend/src/issues/IssueCard.jsx`, `frontend/src/api/engApi.js` | No separate `userevent`; the only networked action is the on-demand subtask load, covered by existing `api_result` with `feature_name=eng` and `api_surface=eng_subtasks`. The event sends no issue keys, summaries, assignee names, sprint names, JQL, or Jira URLs. | 2026-06-03 |
| ENG ready-to-close alert classification | `jira_server.py`, `frontend/src/dashboard.jsx`, `frontend/src/eng/EngAlertsPanel.jsx` | Passive alert eligibility correction; no new user action is introduced. Existing page/API analytics and alert external-link tracking cover the surrounding workflow without sending issue keys, statuses, summaries, Jira URLs, or JQL. | 2026-06-18 |
| ENG Needs Stories selected-sprint and team-label routing | `jira_server.py`, `frontend/src/backlogAlertSprintUtils.mjs`, `frontend/src/dashboard.jsx`, `frontend/src/eng/useEngSprintData.js`, `frontend/src/futurePlanningTeamUtils.mjs` | Passive alert eligibility and grouping correction; no new user action is introduced. Existing page/API analytics and alert external-link tracking cover the surrounding workflow without sending issue keys, sprint labels, Jira labels, team names, Jira URLs, or JQL. | 2026-06-16 |
| Ad Hoc capacity epic selection (Department settings) | `frontend/src/settings/GroupEpicSelector.jsx`, `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/dashboard.jsx` | No separate `userevent` for add/remove of Ad Hoc capacity epics; the change persists through the existing Department `settings_action` save, which sends only bucketed `dirty_state`/`validation_count_bucket` and never raw epic keys, summaries, or group names. | 2026-06-19 |
| Lead Times capacity cohort filter | `frontend/src/dashboard.jsx`, `frontend/src/cohort/cohortUtils.js` | The existing uninstrumented local-only exclusion group is displayed as `Exclude` with `Ad Hoc` and `Excluded Capacity` checkboxes; their accessible names remain `Exclude Ad Hoc` and `Exclude Excluded Capacity`. Both only re-slice already-fetched issues, add no request or data contract, and send no epic keys, summaries, team names, or other user data; this preserves the existing no-event decision. | 2026-07-16 |
| ENG epic priority pill and Product Track emoji (header badges) | `frontend/src/eng/EngView.jsx`, `frontend/src/issues/IssueCard.jsx`, `frontend/src/eng/engTaskUtils.js` | Passive display elements derived from already-loaded data; no user interaction. The Sort dropdown that uses these values emits `sort_changed` (see taxonomy above). No separate `userevent` for the badge render — consistent with other ENG view-control toggles (`groupByInitiative` etc.). | 2026-06-29 |
| Project Track chart segment/legend hover and epic-link clicks | `frontend/src/stats/ProjectTrackTotalsBar.jsx`, `frontend/src/stats/ProjectTrackSprintChart.jsx`, `frontend/src/stats/ProjectTrackBreakdownChart.jsx`, `frontend/src/stats/ProjectTrackPhaseChart.jsx` | Tab open (`stats_action` view_change) and the filter-bar controls (Capacity side, Mode, both exclusion checkboxes) are the tracked interactions for this tab. In-chart segment/legend hover readouts and epic-title Jira links are passive/already-covered display interactions; adding per-segment analytics would risk carrying assignee/team names or epic identifiers, so it is intentionally out of scope. | 2026-07-01 |
| Statistics consistency fixes (shared team colors, Excluded Capacity Range-card removal, Lead Times End Quarter) | affected Statistics source anchors | Corrective rendering/filter parity only; existing Statistics view analytics and Jira external-link analytics cover the workflow, and a new event would duplicate the existing uninstrumented Start Quarter interaction without a new product decision. | 2026-07-13 |
| Planning priority refresh team-filter preservation | `frontend/src/teamSelectionUtils.mjs`, `frontend/src/dashboard.jsx`, `frontend/src/eng/useEngPriorityTransitions.js` | Corrective state retention after the existing tracked priority mutation; no new user action is introduced. Existing `issue_priority_action` covers the mutation, while `filter_changed` remains reserved for explicit user filter changes. Automatic retention sends no team IDs, team names, issue keys, priorities, or Jira URLs. | 2026-07-12 |
| ENG Board column focus/fold/star | `frontend/src/eng/EngBoardView.jsx` | Session-only view arrangement is high-frequency noise; it changes no shared configuration and sends no column ids, names, counts, or Jira data. | 2026-08-08 |
| ENG Board complete open-column rendering | `frontend/src/eng/EngBoardView.jsx` | Passive rendering of all already-loaded epics replaces the untracked incremental reveal control; no new user action, request, or data contract is introduced. | 2026-08-08 |
| ENG Board/Catch Up filter facet ticks, chip clears, and +n more | `frontend/src/eng/EngFilterBar.jsx`, `frontend/src/styles/eng/filter-bar.css`, `frontend/src/eng/EngBoardView.jsx`, `frontend/src/eng/EngView.jsx` | These controls only re-slice already-loaded data; the full-width treatment is passive layout. Keeping them untracked preserves comparable semantics across Board and Catch Up and sends no facet values, group names, issue keys, or Jira data. | 2026-08-25 |
| ENG Board epic detail panel open and description Smart Links | `frontend/src/eng/EngBoardView.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`, `backend/epm/home.py` | Opening a read-only detail surface and rendering user-authored Smart Links are not tracked; the existing `eng_issue_description` API reliability event covers description loading, and mutations inside remain covered by existing issue action events. Never collect the link destination, description text, or issue key. | 2026-08-08 |
| ENG Board help, fixed card titles, and description tables | `frontend/src/eng/EngBoardHelp.jsx`, `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`, `backend/epm/home.py` | Help is an ephemeral read-only disclosure with no persisted or shared state; title truncation and semantic table rendering are passive presentation. Existing Board view/filter interactions remain intentionally untracked and `eng_issue_description` continues to cover API reliability. Never collect help copy, description text, table cells, URLs, summaries, or issue keys. | 2026-08-08 |
| Group Board composer draft edits | `frontend/src/settings/GroupBoardSettings.jsx` | Draft churn before Save is not tracked. The existing settings save event covers the committed action without sending status names, column names, group names, or Jira ids. | 2026-08-08 |
| Selected Department group JSON export/import | `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/dashboard.jsx` | Export is a local file download for the active group, and import only updates that selected group's settings draft. The existing Department `settings_action` save covers a committed import; no event may include exported/imported JSON, group names, team ids, labels, board columns, Jira keys, or file contents. | 2026-08-25 |
| App-admin membership draft edits | `frontend/src/settings/AdminAccessSettings.jsx`, `frontend/src/dashboard.jsx` | Checkbox churn before Save is not tracked. The existing `settings_action` save and `api_result` with `api_surface=settings_save` cover committed changes without sending account IDs, display names, emails, or internal user IDs. | 2026-08-24 |
| Header dropdown query typing | `frontend/src/dashboard.jsx` | No separate `userevent`; Sprint, Group, and Teams query text only filters already-loaded local options and is discarded on close. Existing `filter_changed` events remain attached to committed Sprint, Group, and Teams selections, while raw query text, sprint names, group names, and team names are never collected. | 2026-08-25 |
| Personal group favorite render/change | `frontend/src/settings/useGroupVisibilityPreferences.js`, `frontend/src/settings/TeamGroupsSettings.jsx`, `frontend/src/dashboard.jsx` | Rendering the star adds no event. First-run completion and Settings persistence use the existing Department `settings_action`; temporary dashboard scope changes retain `filter_changed(filter_type=group)`. Events may include only count buckets and fixed workflow tokens—never a favorite/group id or name. | 2026-08-26 |
| Dashboard tour target activation | `frontend/src/onboarding/OnboardingTour.jsx`, `frontend/src/eng/useEngPriorityTransitions.js`, `frontend/src/eng/useEngProjectTrackTransitions.js`, `frontend/src/eng/useEngStatusTransitions.js` | Target activation creates no new onboarding event. Priority, Project Track, and Status preview targets activate the real field controls, so their existing safe `priority_options_open`, `project_track_options_open`, and `status_options_open` behavior remains in the owning hooks. Those contracts use fixed workflow tokens and bucketed context only; never send issue keys, field values, summaries, Department or Team names, Jira URLs, or tour step content. | 2026-09-01 |
| Shared workspace configuration revision conflict | `frontend/src/settings/workspaceConfigConflict.js`, `frontend/src/dashboard.jsx` | Use the existing `settings_action` save-result event with fixed `conflict_state=remote` and bucketed `conflict_count_bucket`. Never include configuration values, revision numbers, Jira or Home identifiers, field ids, workspace ids, user ids, or conflict payload contents. | 2026-08-26 |
| Header context settings relocation and icon-button alignment | `frontend/src/dashboard.jsx`, `frontend/src/components/JiraExportButton.jsx`, `frontend/src/styles/shared/controls.css` | Moving and visually aligning the Jira export, Refresh, and ENG/EPM settings controls preserves their existing handlers, permission/disabled gates, analytics, and destinations. Another event would duplicate the same actions, and no group name, team name, EPM scope value, or Jira issue data is added to analytics. | 2026-08-25 |
| ENG Initiative icon toggle | `frontend/src/dashboard.jsx`, `frontend/src/eng/EngView.jsx` | Group by Initiative remains an already-untracked local persisted view preference that only regroups loaded tasks; its icon, tooltip, and gray/yellow presentation add no new product action and send no initiative keys, summaries, group names, team names, or issue data. | 2026-08-25 |
| ENG Board card drag: cancelled or refused | `frontend/src/eng/EngBoardView.jsx`, `frontend/src/eng/engBoardDrop.js`, `frontend/src/eng/useEngStatusTransitions.js` | A drag that is cancelled, dropped on its own column, or refused because the target column shares no offered transition emits no `status_change_submit` and no `status_change_result` — only a completed transition is tracked, by the existing `issue_status_action`. `status_options_open` **does** still fire on a drop, because resolving the drop asks Jira for that issue's transitions through the same shared single-issue status control the status pill uses; suppressing it would require a board-only branch inside that shared hook, which the plan forbids. It sends no issue keys, statuses, column names, or Jira URLs. | 2026-08-07 |
| Auth long-absence refresh (no reload) | `frontend/src/api/authFocusRefresh.js`, `frontend/src/dashboard.jsx` | No separate `userevent`; automatic reliability recovery after >12 continuously unfocused/hidden minutes issues one throttled cross-tab-deduplicated `POST /api/auth/refresh` and re-runs the active view's existing scoped fetches, which are already covered by `api_result`. No document reload and no new client identifiers. | 2026-07-16 |

Do not use reserved GA4 event names such as `click`, `error`, `page_view`, `scroll`, `session_start`, `user_engagement`, `view_search_results`, `file_download`, `form_start`, or `form_submit` through `event=userevent`. GA4 `page_view` is allowed only through the `event=pageview` GTM trigger, and GA4 may emit the allowed Enhanced Measurement names automatically when analytics is enabled. Do not emit Universal Analytics-style `event_category`, `event_action`, or `event_label`.

Do not add one GTM trigger per event. Adding a new app event name that uses existing property keys requires code, schema, tests, and this contract to change, but it must continue to use the existing `userevent` GTM trigger. GTM changes are needed only for a new dataLayer property key, a new destination, or changed transport behavior.

GA4-managed automatic event policy when analytics is enabled:

| Event name | Source | Notes |
| --- | --- | --- |
| `scroll` | Enhanced Measurement | 90% scroll-depth event. |
| `click` | Enhanced Measurement | Disabled in v1 unless operator configuration and tests prove Atlassian/Jira/Home `link_url` values cannot be sent through managed click collection. |
| `view_search_results` | Enhanced Measurement | Enable only if managed `search_term`/query metadata cannot expose raw app search text, Jira keys, JQL, callback values, tokens, local paths, or Jira/Home URLs. App-owned `app_search` remains bucketed. |
| `file_download` | Enhanced Measurement | Enable only if managed file/link metadata cannot expose Jira/Home/auth URLs, query strings, issue keys, tokens, local paths, or sensitive filenames. |
| `form_start` | Enhanced Measurement | Enable only if managed form metadata cannot expose auth callback destinations, Jira/Home URLs, token-bearing queries, user-entered text, credential field names, or sensitive submit text. |
| `form_submit` | Enhanced Measurement | Same safety gate as `form_start`. |

## Required Parameters

All parameters must be low-cardinality enums, booleans, numbers, or buckets. Bucket values should use stable labels such as `0`, `1`, `2_5`, `6_10`, `11_25`, `26_plus`, or equivalent documented in `frontend/src/analytics/events.js`.

Forbidden app-owned parameter examples include `search_term`, raw search text, URL, query string, issue key, Jira label, project/team/group/sprint name, email, display name, token, full IP address, `user_id`, `session_id`, `cid`, `uid`, `customer_id`, and any `ga_`, `google_`, `firebase_`, `_`, or `gtag.` prefix.

DataLayer control fields:
- `event` is a GTM trigger name and must be only `pageview` or `userevent`.
- `trigger` duplicates the allowed GTM trigger name for audit/tests and must match `event`.
- `event_type` must be `pageview` or `event`.
- `event_name` is the final GA4 event name; it is not sent as a GA4 event parameter.
- `ga4_user_id` maps to GA4 User-ID only, never a custom event parameter.
- `debug_mode` is a transport/debug flag only.

`external_link_opened` may send only enum/bucket metadata such as `link_type=jira_issue_list|jira_issue_browse|jira_home_project|jira_home_update`, `issue_kind`, `source_surface`, `issue_count_bucket`, and `result`. It must not send URLs, JQL, issue keys, Home IDs, project names, Jira labels, owners, statuses, team IDs, or update text. GA4-managed outbound `click` must not collect Atlassian/Jira/Home `link_url` values unless operator configuration and tests prove those URLs cannot be sent.

## Custom Definitions

Do not register every allowed parameter. Initial GA4 admin registration is the named-report-backed set in `docs/plans/SUPPORT-ga4-user-configuration.md` and must stay below GA4's 50 event-scoped custom-dimension limit. Adding a custom dimension needs a named report reason.

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

- Analytics disabled sends zero third-party analytics requests. Operators shut collection down with `GA4_ENABLED=false`; no other GA4/GTM env vars need to be cleared.
- Analytics enabled sends employee product analytics under internal tool policy. Do not add an in-app analytics consent UI, consent localStorage key, or grant/revoke flow in v1.
- Basic/local shared auth sends no GA4 User-ID.
- App-owned page/view tracking uses only `event=pageview`; app code must not push direct GA4 `page_view` events or ad hoc page event names.
- GA4 User-ID is pseudonymous personal data. This implementation does not include a GA4 data-subject-request or account-deletion workflow.
- Forbidden keys are scrubbed in the analytics wrapper and checked again by tests.
- Value-shape regexes must drop whole app-owned custom events for email-like values, bearer/JWT/token-like values, full URLs with queries, full IP addresses, UUIDs unless explicitly allowlisted, credit-card-like values, and local path patterns.

## Allowlist

State-changing routes or user-visible surfaces without analytics must be documented here.

| Surface | File/line anchor | Reason no event is emitted | Review date |
| --- | --- | --- | --- |
| Home/Townsquare writes | `docs/plans/GATE-05-home-write-capability.md` | Blocked external capability; no write route exists in this analytics slice. | 2026-05-26 |
| EPM project progress display | `frontend/src/epm/EpmRollupPanel.jsx` | Passive readout derived from already-loaded rollup Stories; existing EPM rollup load and expand/collapse analytics cover the surrounding workflow. | 2026-05-28 |
| EPM nested Home goal project discovery | `backend/epm/home.py` | Backend broadens the existing selected sub-goal project catalog; existing EPM API result, rollup load, and sub-goal filter analytics cover the workflow without adding a new user action. | 2026-05-28 |
| EPM Pending lifecycle tab correction | `backend/epm/projects.py`, `frontend/src/epm/epmProjectUtils.mjs` | Lifecycle bucket correction changes which existing EPM tab displays Pending projects; existing EPM API result and tab/filter analytics cover the workflow. | 2026-05-28 |
| EPM collapse-all control placement | `frontend/src/epm/EpmControls.jsx` | Placement-only UI change for the existing expand/collapse control; existing `epm_action` expand/collapse analytics cover usage. | 2026-05-28 |
| ENG Catch Up targeted background reconciliation | `frontend/src/eng/useEngStatusTransitions.js`, `frontend/src/eng/useEngPriorityTransitions.js` | Existing `issue_status_action` / `issue_priority_action` submit-result events and `api_result` already cover adoption and reliability; another event would duplicate the same user action. | 2026-07-10 |
| ENG Group Board sticky column chrome | `frontend/src/eng/EngBoardView.jsx`, `frontend/src/styles/eng/board.css` | Passive positioning adds no new user action or application state; Board focus/fold/star interactions remain intentionally untracked under the existing Board allowlist, and scroll position itself is not collected. | 2026-08-08 |
| ENG shared filter-bar wrapper spacing | `frontend/src/styles/eng/filter-bar.css` | Passive layout correction in existing Catch Up and Board controls; no new action, state, or data collection is introduced. | 2026-08-08 |

## Drift Checks

CI or focused source-guard tests must fail when:

- Code sends a dataLayer trigger outside `pageview` or `userevent`.
- Code sends an `event_name` outside this taxonomy.
- Code sends a parameter outside the allowlist in `frontend/src/analytics/events.js`.
- Required params lack tests.
- Captured payloads contain forbidden keys or forbidden value shapes.
- `GA4_ENABLED=false` still sends a request to `googletagmanager.com` or `google-analytics.com`.
- App code sends direct `gtag('event', ...)` calls or manually pushes a GA4 event name as the dataLayer `event` value.
- App-owned `userevent` pushes omit `feature_name`, pageviews omit `page_name`, or any GA4 hit exceeds 25 event parameters.
- GA4-managed Enhanced Measurement events appear while `GA4_ENABLED=false`.
- A user-visible feature changes without updating this contract or documenting why analytics does not apply.

## Operations Links

- Implementation plan: `docs/plans/DONE-ga4-instrumentation.md`
- GA4 setup runbook: `docs/plans/SUPPORT-ga4-user-configuration.md`
- GA4/GTM MCP dry-run spec: `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` (requires a custom write-capable MCP; the official Google Analytics MCP server is read-only)
- GA4 web stream Measurement ID: `G-6QERX19WB0`
- GTM container: `GTM-NZJW2CFN`, configured by `GTM_CONTAINER_ID`
- Measurement Protocol secret: none in v1
- GA4 deletion workflow: out of scope for this implementation
