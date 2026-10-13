# Shareable View Links Design

> **Status:** Proposed design, written 2026-10-13 after the operator approved the decisions below in conversation. Awaiting operator review of this document. This is not an implementation plan; the execution plan will be `EXEC-shareable-view-links-194.md`, written only after this design is approved.

| Field | Value |
| --- | --- |
| Issue | [#194 — Create shareable links to the current view](https://github.com/Juce-me/jira-execution-planner/issues/194) |
| Surface | ENG → Catch Up, Planning, Board, Statistics; app header; OAuth login return |
| Configuration owner | None new. Links reference existing shared Department groups, Sprint catalog and Team catalog. |
| Personal state owner | Existing browser prefs; a link replaces them like normal navigation |
| Jira writes | None. A link only selects and reveals; it never triggers a mutation |
| Supersedes | The "Shareable View Links" section of [`FUTURE-db-additional-features.md`](FUTURE-db-additional-features.md) for v1. The token variant stays deferred there. |

## Goal

A signed-in user presses one Share control and gets a plain URL to paste into chat. Another user in the same resolved workspace and site who opens it, signing in first if needed, lands in the same ENG view: mode, group, sprint, teams, filters, an opened alerts category scrolled to a team, or an exact Epic or Story. What the recipient sees is bounded by their own Jira access, group visibility and catalogs.

## Decisions (operator-approved 2026-10-13)

| Decision | Choice | Rejected alternative |
| --- | --- | --- |
| Link carrier | Self-contained URL at `/`; no server-stored state | Server-stored opaque token (`shared_view_links`, `/share/v/<token>`): needs a table, migration, three endpoints, policy and CSRF matrix tests, DB mode only, and a path route that breaks the relative asset URLs in `jira-dashboard.html` |
| Link form | Readable query params through a header Share button | Opaque base64 blob; live address-bar URL with no button (puts view state in every GA4 `page_location`); short links (need server storage) |
| v1 scope | Catch Up, Planning, Board, Statistics | Catch Up only; EPM and Scenario are out of v1 |
| Apply mode | Replace like normal navigation: the link drives the same setters as clicking the controls and persists like any change | Temporary overlay that suppresses persistence (needs a new suppress mechanism through the prefs persist effect and three team-selection writers) |
| Focus target | One Share button; focus is the topmost visible alerts team group, Epic or Story at click time | Per-target Copy link controls (new controls in the fragile Epic header and alert rows) |
| Recipient mismatch | Apply what resolves and show one notice; if the group or sprint does not resolve, apply nothing else | Auto-granting a group the recipient has not made visible (the issue assumes the recipient has the groups configured) |

## Non-goals

- Server-side storage, revocation, expiry, short links, or "save a copy". These stay in the FUTURE token plan.
- EPM and Scenario links. EPM needs the recipient's own Home token and saved private scope; Scenario content is shared realtime draft state. Opening a link whose mode is unavailable falls back to Catch Up.
- Planning row selection, Planning review drafts and dirty state, issue-edit holds, Settings modal state, dependency focus, alert dismissals, raw scroll offsets, onboarding state, and personal group visibility or favorites. None of these is encoded or applied.
- Workspace membership or ACLs. Access stays gated by the resolved workspace and site plus the recipient's own Jira authorization (`docs/plans/AGENTS.md`, Service-Credential Policy).
- Changing the reauth recovery path (`AuthRequiredGate`, `authRecoveryCoordinator`, `sanitizeLoginUrl`) or its source guards.
- Fixing the pre-existing unvalidated Sprint and Team interpolation into JQL. A link never reaches it because every value is resolved client-side first (Apply pipeline); the item is recorded as residual risk only.

## Link contract

Plain query params at `/`. Only non-default values are included, except `v` and `mode`, which are always present. `v=1` marks a link and its schema version.

Example: `/?v=1&mode=catch-up&group=<group-id>&sprint=<sprint-id>&teams=<team-id>,<team-id>&status=only:In%20Progress&alerts=blocked&alertTeam=<team-id>`

| Key | Value | Maps to |
| --- | --- | --- |
| `v` | `1` | Schema version. A different value is ignored with a notice that the link needs a newer app version. |
| `mode` | `catch-up`, `planning`, `board`, `statistics` | `applyEngMode` (`frontend/src/eng/engModeState.js`), so analytics and `onEnterCatchUp` still fire |
| `group` | Department group id | `activeGroupId` |
| `sprint` | Jira sprint id (digits) | `selectedSprint` |
| `scope` | `component`, `all-work` | Board-only `boardStrictScope`; replaces `sprint` for Board |
| `teams` | `all` or a comma list of Team ids | `selectedTeams` |
| `q` | Search text, at most 100 chars | `searchQuery` |
| `status`, `priority`, `track` | `only:<a>,<b>` or `hide:<a>,<b>` | Existing `{only}` and `{hidden}` facet shapes in `engCatchUpFilters.js` |
| `lanes` | `product`, `tech` or `product,tech` | `showProduct` and `showTech` |
| `initiatives` | `1` | `groupByInitiativeChoice` |
| `sort` | Existing Epic sort value | `engEpicSort` |
| `layout`, `rows` | `list` or `table`; `epics` or `stories` | `planningLayout` and the Planning table row mode |
| `stats`, `from`, `to` | Stats sub-view key; range ends | Stats sub-view and range controls |
| `alerts` | Alert category key | Opens the alerts panel and expands that category |
| `alertTeam` | Team id of an alerts team group | Scroll target inside the category; requires `alerts` |
| `epic`, `story` | Jira issue key | Focus target; on Board, `epic` opens the Epic panel |

Rules:

- Group and Team values are the app's own ids, not names. Names are not unique or stable, so only the keys are readable.
- Unknown keys are ignored. For a duplicated key the first value wins.
- Issue keys must match `^[A-Z][A-Z0-9_]+-[0-9]+$`, the same shape `backend/services/epic_refresh.py` already enforces.
- A link has at most one focus target. The exact value vocabularies for `sort`, `stats`, `from`/`to`, `scope` and the alert category keys are fixed in the execution plan's Task 0 from the owning source files (`useStatsState.js`, `engSprintSelectorState.js`, `EngAlertsPanel.jsx`), not in this document.
- A link never contains workspace, site, cloud or user ids, names, tokens or credential values. This mirrors the forbidden-key rule for stored views in `backend/config/view_validation.py` (reported; re-verify in Task 0).
- The whole query string must stay under a 1.5 KB cap. When the Team selection is the full group, the sender writes `teams=all`.

## Surviving login

Today a link is lost at the login hop:

- `redirect_unauthenticated_oauth_dashboard_entry` (`jira_server.py:894-909`) redirects `/` and `/jira-dashboard.html` to a fixed `/login`, dropping the query.
- The OAuth callback ends in a hard-coded `redirect('/')` (`backend/routes/auth_routes.py:437`).
- `sanitizeLoginUrl` rejects every query key except `reason` and any hash (`frontend/src/api/authRequired.js:12-31`).
- `/login` is static HTML with no script, and the CSP is `script-src 'self'` plus Google Tag Manager (`backend/security/headers.py`), so a client-side stash on `/login` would need a new served JS file. That is why a `#fragment` carrier was rejected.

Design: keep the validated query in the signed Flask session cookie, which already holds the OAuth state and PKCE verifier.

1. In `redirect_unauthenticated_oauth_dashboard_entry`, when the request query starts with `v=1`, is at most 1.5 KB and uses only a conservative percent-encoded charset, store it as `session['pending_share_view']` with a timestamp, then redirect as today. An invalid query is dropped, not stored. A newer link replaces an older stash.
2. In the callback success path, pop the stash once. If it is present and younger than 15 minutes, redirect to `/?<stashed query>`; otherwise `redirect('/')` as today. The path is always `/`, so there is no open-redirect surface, and the stash is re-validated at pop time.
3. An already-authenticated recipient is not redirected; the SPA reads the query directly.
4. Basic mode and the non-DB OAuth profile need no change: the first has no login hop and the second uses the same cookie session.
5. `sanitizeLoginUrl`, `AuthRequiredGate` and `window.location.assign('/')` (pinned by `tests/test_auth_isolation_source_guard.js`) are not modified.

An abandoned login leaves a stash in the cookie until the 15-minute TTL, the next link, or session end. It cannot be replayed after the TTL.

## Apply pipeline

New code lives in `frontend/src/shareView/`; `dashboard.jsx` is at its 7,573-line budget (`tests/test_codebase_structure_budgets.py:71`) and the budget target for this feature is net zero or negative lines there.

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| Codec | Encode the view state to query params; decode and strictly validate (allowlisted keys, size cap, types), dropping unknown and forbidden values. Modeled on `frontend/src/api/authResumeState.js`. | Nothing |
| Resolver | Pure function: decoded payload plus the recipient's validated context gives `{apply, unresolved[]}` | Codec |
| Apply hook | Staged apply through the existing setters, after the recipient's own startup stages | Resolver, app state |
| Focus | Capture at click time; reveal at apply time with its own wait and retry | Alerts, Epic and Story DOM anchors |
| Share control | Header button, clipboard write, copied and failure states | Codec, Focus |

On load:

1. Read `v` and the rest of the query synchronously at entry-script start, before analytics initialises, then remove them with `history.replaceState` so a reload or a connection-recovery `location.reload()` never replays them. The payload is kept in a one-shot module variable. GTM is appended only after the analytics context loads (`appendGtmScript` inside `applyAnalyticsContext`, `frontend/src/analytics/analytics.js`), so the first `page_location` carries no view state; a test must prove this order.
2. Wait for the existing readiness signals: `sharedConfigReady`, `groupsLoading` false, `onboardingRequired` false, validated sprint catalog, and `tasksFetched` for the scope. A first-run recipient keeps the payload in memory through the group-selection popup.
3. Apply last, after the staged reauth restore, so a link overrides whatever the capsule or saved prefs restored without modifying that guarded code. Order: group, then sprint, then mode, then teams and filters, then alerts and focus once the alert cohort settles.

Resolution rules, so link strings never reach a backend request unresolved:

| Value | Applied only if |
| --- | --- |
| `group` | It is in the recipient's visible groups (`visibleControlGroups`) |
| `sprint` | It is in the recipient's validated Sprint catalog |
| `teams` | `sanitizeSelectedTeamsForScope` (`teamSelectionUtils.mjs:71`) keeps it for the resolved group and sprint |
| Facets | They survive the existing reconciliation in `engCatchUpFilters.js` |
| `epic`, `story` | The key matches the regex and the node exists after data settles |
| `mode` | `applyEngMode` accepts it for the resolved sprint; closed-sprint Planning, future-sprint Statistics and unavailable Board scope are reported, not forced |
| `q` | Always, as plain text capped at 100 chars |

Failure tiers:

- If `group` or `sprint` does not resolve, nothing else is applied and the recipient keeps their own view.
- Anything else that does not resolve is skipped and the rest still applies.
- Either case shows one dismissible notice naming the unapplied categories (group, sprint, teams, filters, mode, focus), never raw values. The execution plan's Task 0 picks the existing notice component; no new notification system.

The apply goes through the normal setters, so it persists to the recipient's prefs and per-scope team and planning selections exactly as if they had clicked the controls. The three team-selection writers (the hydrate effect, `usePlanningSelectionSync`, and the prefs persist effect) must be shown by test to keep the applied selection.

## Focus

Capture at Share click is a read-only resolver, separate from `engReadingAnchor.js`. That module's selector covers only Planning rows, `.task-item[data-task-key]` and `.epic-block[data-epic-key]`, and extending it would risk its refresh-preservation behavior.

| Mode | Captured target |
| --- | --- |
| Catch Up | Topmost visible alerts team group (with its category), else Epic, else Story |
| Planning (Table) | Topmost visible Planning row, written as `epic` or `story` |
| Board | The open Epic panel's key, if any; no scroll target |
| Statistics | None |

Reveal at apply time:

- Add `data-alert-team` (the team group id) to each `.alert-team-group` container in `frontend/src/eng/EngAlertsPanel.jsx`. Today those containers have no anchor.
- Use a link-owned wait and retry bounded by the data-settled signals (`tasksFetched`, `subscribeAlertCohortSettle`) and a timeout. `focusAlertSection` is a single attempt, and the existing story-navigation miss path calls `clearEngFilters` (`dashboard.jsx:5558`, passed at `dashboard.jsx:4611`), which wipes the recipient's Teams. The link path must never call `clearEngFilters`.
- Reuse the existing highlight classes (`story-requirement-highlight`, `task-highlight`, `epic-flash`) and `measureStickyBottom()` from `alertEpicNavigation.js` for the sticky-stack offset. If the target never appears, scroll nothing and include "focus" in the notice.
- The Planning table's Epics/Stories mode (local `useState` in `PlanningReviewTable.jsx`) and the Board's open-Epic panel (local `useState` in `EngBoardView.jsx`) need minimal hoisting to accept an initial value; no other state is hoisted.

## Share control

- One control in the app header, in the icon cluster beside `JiraExportButton` and the refresh `IconButton` (`frontend/src/dashboard.jsx:6231`), reusing `IconButton` with the `header-icon-button` class. No new button class.
- Hidden in EPM and Scenario. It does not duplicate any existing control.
- Click copies the link with `navigator.clipboard.writeText`, then shows a short copied state on the control. If the write is rejected, show the URL in a selectable read-only field so it can still be copied by hand.
- Per the project rules for transparent and icon buttons: override the global `button:hover` surface and letter-spacing with a readable hover, and add a settled-state hover-contrast assertion.
- Task 0 of the execution plan is a visual specification and mock built from the repository's verbatim CSS, with Playwright geometry and menu-layering assertions for the header cluster, before any wiring.

## Security, privacy and analytics

- A link is untrusted input from a possibly malicious sender. It can only select among values the recipient already owns, it triggers no write, and `q` is rendered as text. A forged link cannot reveal anything the recipient's own Jira OAuth token and visible groups would not already show.
- No new route and no new `EndpointPolicy`. The only server change is the stash and callback redirect; negative tests prove the redirect target is always `/` with a re-validated query.
- Analytics: add one event, `share_view_action`, following the existing `board_action` and `planning_action` pattern. Copy and apply outcomes use the existing params `feature_name`, `workflow_action`, `result` and `source_surface` with fixed enum values only (copy, apply; success, failed, applied, partial, rejected). No ids, names, URLs or keys. Update `frontend/src/analytics/events.js`, the `docs/README_ANALYTICS.md` taxonomy, and tests. The execution plan's Task 0 re-checks the GTM tag's dynamic `event_name` mapping and the permitted param values.
- The query string reaches the application server and its access logs, as sprint ids, Team ids and issue keys already do in `/api` requests. The repo's own diagnostics strip query strings (`jira_server.py` static-request logging, reported).

## Acceptance criteria

1. Pressing Share copies a URL that, opened by a signed-in user in the same workspace and site, reproduces the sender's mode, group, sprint, teams, filters, alerts category and team, or focused Epic or Story, for Catch Up, Planning, Board and Statistics.
2. An unauthenticated recipient who opens the link signs in and lands in the same view without re-clicking; a link older than 15 minutes at callback time falls back to `/`.
3. A recipient whose group or sprint does not resolve gets their own view and one notice; other unresolved parts are skipped with the notice and the rest applies.
4. Opening a link adds no request to initial load beyond the existing sequence (Catch Up to Board still performs no additional selected-sprint data request), and the first GA4 `page_location` carries no view state.
5. Reload, connection recovery and reauth recovery never replay or lose a consumed link incorrectly, and the existing reauth source guards still pass unmodified.
6. The Share control matches the header cluster's geometry and hover contrast in headed Firefox and WebKit as well as Chromium.

## Forbidden regressions

- Reauth recovery and its source guards, sticky layering (Catch Up, Planning and Scenario modes re-verified), header control geometry, non-link startup and persisted-prefs behavior, the alert-loading deferral, and initial-load performance.
- No change to any Jira write path, and no Home, Townsquare or service-credential use.

## Files allowed to touch (indicative; the execution plan fixes the file map)

- New: `frontend/src/shareView/*` with its Node tests, a Flask test for the stash and callback redirect, and a Playwright spec under `tests/ui/`.
- Backend: `jira_server.py` (`redirect_unauthenticated_oauth_dashboard_entry`) and `backend/routes/auth_routes.py` (callback success redirect).
- Frontend: `frontend/src/dashboard.jsx` (hook call and mount only, net lines at most zero), `frontend/src/eng/EngAlertsPanel.jsx`, `frontend/src/eng/PlanningReviewTable.jsx`, `frontend/src/eng/EngBoardView.jsx`, `frontend/src/analytics/events.js`, regenerated `frontend/dist/`.
- Docs: `docs/README_ANALYTICS.md`, `docs/ontology.md` (new concepts, with verification date), a feature doc under `docs/features/`, `docs/plans/README.md`, and the pointer in `FUTURE-db-additional-features.md`.

## Evidence and verification status

Verified directly in this design session:

| Claim | Source |
| --- | --- |
| Unauthenticated entry redirects to a fixed `/login` | `jira_server.py:366`, `jira_server.py:894-909` |
| OAuth callback ends in `redirect('/')` | `backend/routes/auth_routes.py:437` |
| `sanitizeLoginUrl` rejects other query keys and any hash | `frontend/src/api/authRequired.js:12-31` |
| CSP is `script-src 'self'` plus GTM; `/login` has no script | `backend/security/headers.py`, `/login` handler in `auth_routes.py` |
| GTM is appended only after the analytics context loads | `frontend/src/analytics/analytics.js` (`applyAnalyticsContext`, `appendGtmScript`) |
| `?perf` is the only URL param read; `dashboard.jsx` is 7,573 lines at its budget | `frontend/src/dashboard.jsx:250`; `tests/test_codebase_structure_budgets.py:71` |
| `clearEngFilters` resets Teams and is the story-navigation miss handler | `frontend/src/dashboard.jsx:5558`, `4611` |
| `.alert-team-group` has no anchor attribute | `frontend/src/eng/EngAlertsPanel.jsx:214` and siblings |
| Reading anchor selector covers only Planning rows, tasks and Epic blocks | `frontend/src/eng/engReadingAnchor.js` |
| Header icon cluster uses `IconButton` with `header-icon-button` | `frontend/src/dashboard.jsx:6231` |
| Reauth source guard pins `window.location.assign('/')` | `tests/test_auth_isolation_source_guard.js:82` |
| The share-link plan constraint; the FUTURE token design | `docs/plans/AGENTS.md:104`; `docs/plans/FUTURE-db-additional-features.md` |

Reported by exploration and not re-read here; re-verify in the execution plan's Task 0 before relying on them:

- The staged reauth shell restore ordering and where a final link stage can attach.
- Startup readiness signals and the first-run onboarding behavior.
- The alert category keys, Stats state names and range vocabularies, and the Planning and Board local state locations.
- `useGroupVisibilityPreferences.js:78-84` replacing a hidden active group with the favorite.
- Analytics param enum values and the GTM dynamic `event_name`; the absence of any `navigator.clipboard` precedent.
- The unvalidated Sprint and Team JQL interpolation in task-fetch routes.
- Forbidden payload keys in `backend/config/view_validation.py`.

## Risks

- `dashboard.jsx` is mid-decomposition (`EXEC-dashboard-app-decomposition.md`). Sequence this work with that plan or accept rebase conflicts in the same file.
- GA4 container configuration is outside the repo. The design relies on stripping the params before GTM loads and proves it with a test, but does not inspect the container.
- The session cookie is a random per-process key when `FLASK_SECRET_KEY` is unset; the OAuth state already shares that limit, so the stash adds no new failure mode.
- Planning and Board need small state hoisting; the execution plan must keep that to initial values only.
- Pre-existing, not fixed here: Sprint and Team values are interpolated into task-fetch JQL without whitelist validation.
- `docs/security/endpoints.md` has drifted from `backend/security/policy.py` (reported); this work adds no route, so it is left unchanged.
