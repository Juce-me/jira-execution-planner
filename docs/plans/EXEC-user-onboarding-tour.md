# User Onboarding Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Ready for execution on `feature/user-onboarding-tour`; prerequisite `DONE-personal-group-star.md` was completed and verified on 2026-08-26.

**Goal:** After mandatory personal-group selection succeeds, teach the dashboard's scope controls, actions, filters, issue hierarchy, and editable Jira fields through a guided tour that users may skip and replay from Settings.

**Architecture:** Treat the personal-group flow as a completed prerequisite. Add `onboarding_done` to the existing workspace/user preference row, expose it in the existing groups-config bootstrap response, and mutate it through one idempotent, CSRF-protected `/api/me/onboarding` endpoint. Implement the tour as a body-level React portal with pure step/placement helpers, stable `data-onboarding-target` attributes, and centered fallback cards for missing data-dependent targets. The tour may open the existing Department configuration UI for the “Configure your own” path but must not implement or alter favorite-star behavior.

**Tech Stack:** Python 3.10+, Flask, SQLAlchemy, Alembic, React 19, React DOM portals, CSS, Node test runner, Playwright, esbuild, and GA4 through the existing GTM `userevent` contract.

**Dependency (satisfied):** `DONE-personal-group-star.md` owns the exact-one personal star, first-run single-selection UI, DB preference semantics, and separation of a saved favorite from transient dashboard scope. This plan consumes those contracts read-only.

## Global Constraints

- Mandatory group selection or creation remains the entry gate. **Skip onboarding** skips only the instructional tour and never bypasses group selection.
- Do not modify first-run star selection, Settings star controls, `/api/groups-preferences` validation, `activeGroupId` persistence semantics, or shared `defaultGroupId` behavior in this plan.
- `onboardingRequired` continues to mean “group selection blocks group-scoped data.” `onboardingDone` means only “the instructional tour is complete or skipped.”
- Persistence is scoped by authenticated `workspace_id` and `user_id` from `RequestAuthContext`; never accept identity, workspace, site, or cloud fields from the request.
- Existing preference rows are backfilled to `onboarding_done=true`; rows created after the migration default to `false`.
- JSON/basic mode keeps current behavior: no DB onboarding mutation, automatic tour, or replay action.
- A replay writes `onboardingDone:false` before starting. An interrupted first run or replay restarts at the first eligible step; individual step position is not persisted.
- Starting the tour prepares ENG Catch Up without changing the saved personal star, active sprint, current Department scope, or selected teams. It may set only the view/mode state needed to reveal tour targets.
- Missing optional controls are omitted from progress. Missing issue data uses centered explanatory cards so the user can always finish.
- The overlay renders through `document.body`, remains above sticky/dropdown layers, and does not change existing shared control layout or z-index contracts.
- Background controls are inert while the tour is open. Tour controls support focus trapping, Back/Next/Finish, **Skip onboarding**, Escape as skip, and focus restoration.
- Persist completion/skip before closing. On failure, keep the UI open, show a retryable `role="alert"`, and do not emit a successful outcome event.
- A safe app-owned `loginUrl` returned with `401` becomes a visible **Sign in again** link; never log or forward OAuth callback query strings.
- Reuse existing button, modal, typography, settings, and focus styles. Add no tour dependency or custom implementation of an existing control.
- Analytics uses canonical `settings_action` with `section=onboarding`, `workflow_action=started|completed|skipped`, `source_surface=first_run|settings`, and `result` where applicable. Never send step ids, group/team/sprint names, issue keys, summaries, URLs, or raw search values.
- Do not hand-edit `frontend/dist/`; rebuild it from source.

## Scenario Contract

| Scenario | Required result |
| --- | --- |
| New user, group selection incomplete | Mandatory selector/configuration remains in front; the tour cannot start or be skipped. |
| New user selects a valid personal group | Preference save succeeds first, then the tour starts with `source_surface=first_run`. |
| New user chooses configuration | Open Settings → Departments → Team groups, explain that duplicating an existing group is the easiest start, and return to mandatory selection after Save or Cancel. |
| No groups exist | Allow group creation in existing configuration UI, then return to mandatory selection; the star plan remains responsible for choosing exactly one group. |
| Existing user at deployment | Migration backfill keeps the automatic tour closed; Settings shows **Run onboarding again**. |
| First-run tour | Start in ENG Catch Up and begin with the first eligible dashboard control. |
| Optional Department/Jira export control absent | Omit the step and recompute visible progress without an empty spotlight. |
| No issues or slow Jira response | Hierarchy/editing steps use centered explanatory cards; Finish remains available. |
| Skip button or Escape | Persist `true`, emit one successful `skipped`, close, and do not reopen on reload. |
| Finish | Persist `true`, emit one successful `completed`, close, and do not reopen on reload. |
| Interrupted run | Persisted state remains `false`; reload starts at the first eligible step. |
| Persistence failure | Keep tour/Settings open, show error and retry, and retain the previous local state. |
| Replay from Settings | Disabled while Settings is dirty/saving; successful `false` write closes Settings and starts the tour with `source_surface=settings`. |
| Two tabs | Idempotent last-write-wins applies for the same user/workspace; a later bootstrap reconciles persisted state. |
| Two users/workspaces | Completion/replay is isolated and cannot affect another preference row. |
| Mobile/sticky header | Spotlight and coachmark remain in viewport and target only the visible main-or-compact control. |

## Endpoint Contract Matrix

| Method/path | Policy | Request | Success | Errors | Required proof |
| --- | --- | --- | --- | --- | --- |
| `GET /api/groups-config` | Existing `authenticated_read` | None | Existing payload plus `preferences.onboardingDone:boolean` | Existing auth/config errors | Missing preference row returns `onboardingRequired:true,onboardingDone:false`; existing row returns stored value; JSON mode returns `onboardingDone:true`. |
| `POST /api/me/onboarding` | New `user_write`, token-bound CSRF, `X-Requested-With` | Exactly `{onboardingDone:boolean}` | `200 {"onboardingDone":true|false}` | `400 invalid_json`, `400 unsupported_onboarding_field`, `400 onboarding_done_required`, `409 onboarding_db_required`, `409 group_selection_required`, existing auth/CSRF errors | Reject spoofed fields and missing preference rows; prove idempotence and workspace/user isolation. |

## Tour Step Catalog

| Step | Preferred target | Presence rule | Message intent |
| --- | --- | --- | --- |
| Sprint | `[data-onboarding-target="sprint"]` | Required dashboard control | Choose which sprint the dashboard shows. |
| Department | `[data-onboarding-target="group"]` | Only when the Group dropdown exists | Change the current Department scope without changing the saved favorite. |
| Teams | `[data-onboarding-target="teams"]` | When team scope exists | Narrow the selected Department to teams. |
| Search | `[data-onboarding-target="search"]` | When search is rendered | Find issues by supported key/summary behavior. |
| Jira export | `[data-onboarding-target="jira-export"]` | Only when visible and enabled | Open the current issue set in Jira. |
| Refresh | `[data-onboarding-target="refresh"]` | Required dashboard action | Request fresh dashboard data. |
| Filters | `[data-onboarding-target="filters"]` | When ENG filters are rendered | Explain Show only and Display controls without enumerating unavailable filters. |
| Hierarchy | First visible hierarchy target, otherwise fallback | Never blocks | Explain Initiative → Epic → Story structure. |
| Editing | First visible editable priority/track/status target, otherwise fallback | Never blocks | Explain permitted issue-field actions; do not imply permissions the UI does not expose. |

## File Map

### Create

- `backend/db/migrations/versions/20260826_0007_user_onboarding.py`: add and backfill `user_group_preferences.onboarding_done`.
- `frontend/src/onboarding/onboardingSteps.js`: immutable step catalog, target eligibility, and placement helpers.
- `frontend/src/onboarding/useOnboardingTour.js`: automatic start, replay, persistence, and analytics dedupe.
- `frontend/src/onboarding/OnboardingTour.jsx`: portal, spotlight, coachmark, navigation, focus trap, and fallback card.
- `frontend/src/styles/settings/onboarding-tour.css`: onboarding overlay styles only.
- `tests/test_onboarding_tour_utils.js`: pure catalog/placement/state-gate tests.
- `tests/ui/onboarding_tour.spec.js`: user scenarios, accessibility, geometry, analytics, and screenshots.
- `docs/features/onboarding.md`: behavior, skip, and replay guide.

### Modify

- `backend/db/models.py`: map `onboarding_done`.
- `backend/services/shared_group_config.py`: expose state and add the isolated updater without changing personal-star normalization.
- `backend/routes/settings_routes.py`: register `/api/me/onboarding`.
- `backend/security/policy.py`: classify the new unsafe route as `user_write`.
- `frontend/src/settings/groupConfigUtils.js`: normalize `onboardingDone`.
- `frontend/src/settings/useGroupVisibilityPreferences.js`: expose prerequisite completion and configuration-return state only; do not change star selection.
- `frontend/src/settings/FirstRunGroupSelectionModal.jsx`: add **Configure your own** entry and explanatory copy only; preserve the star plan's selection controls.
- `frontend/src/settings/TeamGroupsSettings.jsx`: show duplicate-first guidance when opened from onboarding; preserve existing Duplicate behavior.
- `frontend/src/dashboard.jsx`: integrate the tour, replay action, and stable target attributes.
- `frontend/src/styles/settings.css`: import onboarding CSS.
- `tests/test_db_migrations.py`, `tests/test_shared_group_config_service.py`, `tests/test_shared_group_config_routes.py`, `tests/test_endpoint_policy_inventory.py`, `tests/test_backend_route_source_guards.py`: backend state and route contract.
- `tests/test_frontend_api_source_guards.js`, `tests/test_analytics_source_guards.js`: request and analytics guards.
- `docs/README_ANALYTICS.md`, `docs/security/endpoints.md`, `docs/features/README.md`, `docs/plans/README.md`: taxonomy and indexes.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`: generated output.

### Read Only / Must Not Modify

- The personal-star contract and tests introduced by `DONE-personal-group-star.md`, except minimal integration needed to observe successful prerequisite completion.
- Shared `defaultGroupId` semantics, Settings favorite draft, dashboard group-switch persistence, and `/api/groups-preferences` validation.
- Jira transition/priority/Product Track logic and Home/Townsquare routes.

---

### Task 1: Persist isolated onboarding completion state

**Files:** migration, `backend/db/models.py`, `backend/services/shared_group_config.py`, migration/service tests.

**Interfaces:** produce `preferences.onboardingDone:boolean` and `set_onboarding_done(context, done, database_url=None) -> bool`; preserve every personal-group response field and validation rule.

- [ ] Add failing migration tests proving a new column is non-null, existing rows backfill to `true`, new rows default to `false`, and downgrade removes only that column.
- [ ] Add failing service tests for missing row, stored false/true, user/workspace isolation, idempotent writes, and JSON-mode rejection.
- [ ] Run focused backend tests and confirm failure is limited to missing onboarding state.
- [ ] Add migration `revision='20260826_0007'`, `down_revision='20260604_0006'` and map the boolean with a safe server default.
- [ ] Extend groups-config preference serialization without adding a request or changing `activeGroupId`, visible-group, or `onboardingRequired` logic.
- [ ] Implement an updater that resolves the preference row by authenticated workspace/user, rejects absence with `GroupSelectionRequired`, commits only `onboarding_done`, and translates storage errors consistently.
- [ ] Re-run focused tests and commit the backend state slice.

Focused verification:

```bash
.venv/bin/python -m unittest tests.test_db_migrations tests.test_shared_group_config_service
```

### Task 2: Add the authenticated onboarding endpoint

**Files:** `backend/routes/settings_routes.py`, `backend/security/policy.py`, `docs/security/endpoints.md`, route/policy tests.

**Interfaces:** consume exactly `{onboardingDone:boolean}` and produce exactly `{"onboardingDone":boolean}`.

- [ ] Add failing route tests for success, repeat success, strict JSON shape, non-boolean/missing fields, spoofed identity fields, missing group preference, JSON mode, CSRF, `X-Requested-With`, unauthenticated access, and cross-user/workspace isolation.
- [ ] Add endpoint inventory and source-guard tests requiring `user_write`, and update the generated/maintained endpoint policy documentation.
- [ ] Register `POST /api/me/onboarding`, validate exact keys before service invocation, and map only documented safe errors.
- [ ] Prove the route cannot create a preference row or mutate group/star fields.
- [ ] Run focused route/policy tests and commit.

Focused verification:

```bash
.venv/bin/python -m unittest tests.test_shared_group_config_routes tests.test_endpoint_policy_inventory tests.test_backend_route_source_guards
```

### Task 3: Add configure-your-own onboarding guidance

**Files:** first-run modal, preference hook integration, Team Groups Settings, Playwright tests.

**Interfaces:** consume the star plan's existing mandatory selection state; produce `openFirstRunGroupConfiguration()`, `firstRunConfigPending`, and onboarding-only guidance context.

- [ ] Add failing Playwright scenarios for existing groups, no groups, Save, Cancel, validation failure, and return to the mandatory picker.
- [ ] Add **Configure your own** to the mandatory modal. Do not add Skip and do not alter its radio/star/search behavior.
- [ ] Open Settings → Departments → Team groups using established modal/tab handlers. While configuration is open, keep group-scoped data blocked.
- [ ] Show: “Easiest way to get started: duplicate an existing group, then adjust its teams.” when a duplicable group exists; use appropriate create-first copy when none exists.
- [ ] Reuse the existing Duplicate and Add group actions; do not auto-star a created/duplicated group.
- [ ] Return to the mandatory picker after Save or Cancel. A failed save stays in Settings with the existing error path.
- [ ] Verify both desktop and compact layouts and commit.

### Task 4: Build the accessible spotlight tour

**Files:** new onboarding helpers/hook/component/CSS and unit tests.

**Interfaces:** consume eligible target descriptors and `onboardingDone`; produce deterministic visible steps, current target/fallback, navigation state, and viewport-bounded placement.

- [ ] Add failing unit tests for conditional-step filtering, target resolution, progress renumbering, placement on all viewport edges, target disappearance, and fallback cards.
- [ ] Define the catalog from the table above. Keep copy product-focused and never claim an edit is possible unless its visible control exists.
- [ ] Implement a body portal, fixed dimmer, spotlight geometry, `role="dialog"`, labelled heading, live progress, focus trap, Escape, focus restoration, resize/scroll remeasurement, and `ResizeObserver` cleanup.
- [ ] Disable background interaction while preserving the highlighted element as visual context only.
- [ ] Keep the coachmark in the viewport and choose a centered fallback when no safe target exists.
- [ ] Run helper tests and commit.

Focused verification:

```bash
node --test tests/test_onboarding_tour_utils.js
```

### Task 5: Integrate automatic start, skip, finish, replay, and targets

**Files:** `frontend/src/dashboard.jsx`, onboarding hook/component, frontend API guards, Playwright tests.

**Interfaces:** consume Task 2 endpoint and the star plan's successful prerequisite state; produce one automatic/replayed tour run without changing saved scope preferences.

- [ ] Add failing API guard tests proving every onboarding write uses the CSRF wrapper and exact payload, and no GET or duplicate startup request is added.
- [ ] Add failing Playwright tests for automatic start only after selection, skip, Escape, finish, retry, auth recovery, interruption/reload, replay, dirty Settings, and no automatic rollout for existing users.
- [ ] Start only when `onboardingRequired === false && onboardingDone === false`; prevent transient bootstrap defaults from starting it early.
- [ ] Persist `true` before successful skip/finish closure. Deduplicate repeated clicks and emit analytics only after persistence succeeds.
- [ ] Add **Run onboarding again** in the appropriate personal/preferences Settings section. Disable it while any section is dirty or saving; persist `false`, close Settings, prepare ENG Catch Up, then start.
- [ ] Add stable target attributes to both main and compact render paths for Sprint, Group, Teams, Search, Jira export, Refresh, filters, hierarchy, and editable controls.
- [ ] Never call the Settings favorite setter or `/api/groups-preferences` from tour code. Preserve sprint, current Department scope, teams, and personal star.
- [ ] Run focused API and Playwright tests and commit.

### Task 6: Lock analytics and documentation contracts

**Files:** analytics guards, `docs/README_ANALYTICS.md`, feature docs/index.

- [ ] Add failing source guards for exactly the allowed event/action/parameter set and forbidden identity/raw-content fields.
- [ ] Emit `started` once per successful open, and `completed`/`skipped` once only after the corresponding persisted success. Set `source_surface` to `first_run` or `settings`.
- [ ] Update the canonical `settings_action` row and describe why step navigation is intentionally untracked.
- [ ] Document mandatory selection versus skippable tour, configure-your-own flow, replay, interruption behavior, and personal-star prerequisite without redefining it.
- [ ] Run analytics guards and commit.

Focused verification:

```bash
node --test tests/test_analytics_source_guards.js tests/test_frontend_api_source_guards.js
```

### Task 7: Verify scenarios, visuals, generated output, and startup

- [ ] Run focused Python and Node suites from Tasks 1–6.
- [ ] Run Playwright for all scenario rows, including normal-click layering, keyboard/focus, viewport-edge geometry, and settled desktop/mobile screenshots.
- [ ] Run the full Python suite and frontend build; confirm generated output has no post-build diff beyond intended files.
- [ ] Run startup preflight. Before push, launch the configured Flask server and verify `/api/test` as required by repository policy.
- [ ] Inspect the final diff and remove every line that changes star persistence/UI, shared defaults, Jira writes, Home/Townsquare paths, or unrelated controls.

Final verification:

```bash
.venv/bin/python -m unittest discover -s tests
node --test tests/test_*.js
npm run build
npx playwright test tests/ui/onboarding_tour.spec.js
.venv/bin/python scripts/check_startup_preflight.py
git diff --check
git status --short
git log --oneline -5
```

Do not push until the user explicitly confirms.

## Acceptance Criteria

- Mandatory personal-group selection remains unskippable and wholly owned by `DONE-personal-group-star.md`.
- Configuration supports duplicate-first guidance and group creation, then returns to mandatory selection without auto-starring anything.
- New users start the instructional tour only after successful group selection; existing users are backfilled as complete.
- Sprint, optional Department, Teams, Search, Jira export, Refresh, filters, Initiative/Epic/Story hierarchy, and priority/Product Track/status capability are explained when present.
- Missing controls or Jira data never trap the user.
- Skip, Escape, Finish, interruption, failure/retry, reload, replay, dirty Settings, multi-user/workspace, mobile, and sticky-header scenarios behave as specified.
- `onboarding_done` persists per workspace/user and cannot be written before mandatory selection.
- Replay is available from Settings and never changes the personal star or current saved group preference.
- Analytics records only started/completed/skipped outcomes through the privacy-safe existing contract.
- Focus, keyboard navigation, viewport bounds, background blocking, and screenshots pass Playwright verification.
- Generated output matches source and full verification results are reported from actual commands.

## Out of Scope

- Personal-star persistence, first-run selection UI, Settings star UI, saved favorite versus transient scope behavior, or shared `defaultGroupId` corrections; those belong to `DONE-personal-group-star.md`.
- Persisting an individual tour step or cross-device step-by-step progress.
- Admin-authored tours, remote content, experimentation frameworks, or localization infrastructure.
- Analytics for step views, Next/Back clicks, searches, or issue/group/team identities.
- Changes to Jira permissions, transitions, priority, Product Track, status, filters, hierarchy, or EPM/Home/Townsquare behavior.
- A tour library, animation framework, polling/SSE, or extra startup endpoint.
