# Project Bootstrap

You are working on jira-execution-planner.

This is a local Jira execution dashboard. It serves a committed React bundle from
Flask, reads Jira/Home data through local API routes, and keeps most runtime
state scoped to the selected sprint, team group, view, and EPM project scope.

## Core Principles

- Preserve architectural consistency over quick fixes.
- Prefer minimal diffs.
- Never remove existing UX behaviors unless requested.
- Performance regressions are unacceptable.
- State synchronization must remain deterministic.

## Runtime Shape

- Backend entrypoint: `jira_server.py`
  - Loads `.env`, configures auth/storage/cache globals, imports `backend.app`,
    exposes compatibility helpers, and still owns legacy route bodies for
    scenario, stats, capacity, static serving, and export endpoints.
- Flask app factory: `backend/app.py`
  - Registers extracted blueprints from `backend/routes/`.
  - Uses credentialed CORS with explicit allowed origins.
- Extracted backend routes:
  - `backend/routes/auth_routes.py` for Atlassian OAuth, session recovery, CSRF,
    and auth status.
  - `backend/routes/settings_routes.py` for config, sprint, Jira catalog, board,
    field, issue-type, priority-weight, and selected-project APIs.
  - `backend/routes/eng_routes.py` for ENG task loading, dependencies, missing
    planning info, team discovery, and backlog epics.
  - `backend/routes/epm_routes.py` for EPM config, Home goal/project metadata,
    and project rollups.
  - `backend/routes/views_routes.py`, `admin_routes.py`, and
    `user_connection_routes.py` for user views, admin surfaces, and Home token
    connections.
- Domain modules:
  - `planning/` contains the scenario scheduler and capacity model.
  - `backend/epm/` contains Home/Townsquare access, EPM project resolution,
    EPM JQL scope helpers, and rollup construction.
  - `backend/auth/`, `backend/config/`, and `backend/db/` contain auth context,
    encrypted token storage, config repositories, and migrations.
- Frontend entrypoint: `jira-dashboard.html`
  - HTML-first shell that loads `/frontend/dist/dashboard.css` and
    `frontend/dist/dashboard.js`.
  - Includes a small auth-refresh script before the bundled app.
- Frontend source: `frontend/src/dashboard.jsx`
  - Large React app shell that still owns cross-view state and orchestration.
  - Imports extracted feature modules from `api/`, `eng/`, `epm/`, `settings/`,
    `scenario/`, `stats/`, `issues/`, `ui/`, and `cohort/`.
- Build pipeline: `package.json`
  - React 19 bundled with esbuild as an IIFE.
  - No Babel runtime.
  - `frontend/dist/` is committed output; rebuild it from `frontend/src/`.

## Core Data Flows

- Initial dashboard load:
  - Loads auth/config, selected projects, team groups/catalog, sprints, and view
    preferences.
  - Initial load is performance-critical; avoid redundant requests and keep
    heavyweight endpoints lazy or scoped.
- ENG sprint view:
  - Controls select sprint, group, teams, Product/Tech visibility, and filters.
  - `frontend/src/eng/useEngSprintData.js` calls `/api/tasks-with-team-name`
    through `frontend/src/api/engApi.js`.
  - Product and Tech task sets are stored separately, then filtered and grouped
    client-side.
  - Dependency focus uses `/api/dependencies` and `/api/issues/lookup`.
- Scenario planner:
  - Frontend builds a `POST /api/scenario` payload from selected sprint, team
    scope, lane mode, capacity exclusions, and active-sprint anchoring.
  - Backend maps Jira issues into `planning.models.Issue` and schedules them in
    `planning/scheduler.py`.
  - Timeline rendering uses scheduled `start` and `end` values, not raw Jira
    dates.
  - Draft overrides are stored in `scenario-overrides.json` through
    `/api/scenario/overrides`.
- Planning selections:
  - `frontend/src/planningSelectionState.mjs` stores selected task keys and teams
    in local storage under `planning::<sprintId>::<groupId>`.
  - Refreshes reconcile stored selections against the currently valid task and
    team IDs.
- EPM view:
  - In DB/OAuth mode, EPM stays hidden until the signed-in user connects a
    Home/Townsquare token in Settings.
  - EPM config is loaded from `/api/epm/config`.
  - Home project metadata resolves each project to exact Jira labels; rollup JQL
    uses the exact label, never the `labelPrefix` mask.
  - Active rollups apply the selected sprint; Backlog and Archived ignore sprint.
  - Rollup rendering is Initiative -> Epic -> Story/Task, with labeled root
    Epics and orphan Stories handled explicitly.
- Capacity and statistics:
  - Capacity config comes from Dashboard Settings and is read via capacity
    endpoints in `jira_server.py`.
  - Capacity planning uses loaded sprint tasks plus configured capacity project
    data, with excluded epics reducing planning capacity.
  - Sprint statistics derive Teams/Priority views from loaded tasks and load
    heavier Burnout, Lead Times, Excluded Capacity, and Mono vs Cross datasets
    on demand.

## Critical Systems

- Scenario planner
  - Backend anchor: `planning/scheduler.py`.
  - Frontend anchors: `frontend/src/scenario/*` plus scenario state/rendering in
    `frontend/src/dashboard.jsx`.
  - Preserve dependency ordering, active-sprint anchoring, unscheduled issue
    visibility, edit-mode overrides, undo/redo, focus mode, and lane behavior.
- Sticky selectors
  - Anchors: `frontend/src/dashboard.jsx` and `frontend/src/styles/dashboard.css`.
  - Preserve the sticky order: planning panel above `.epic-header`; when planning
    is closed, `.epic-header` sticks to the top.
  - Re-verify Catch Up, Planning, Scenario, ENG, and EPM sticky controls after
    changes.
- Timeline renderer
  - Anchor: scenario rendering in `frontend/src/dashboard.jsx`.
  - Dates must parse as local `YYYY-MM-DDT00:00:00`.
  - Bar positions come from scenario API scheduled dates.
  - Dependency edges must render only when endpoint geometry is available or a
    guarded fallback exists.
- Epic aggregation
  - ENG task grouping uses Jira task/epic payloads from `/api/tasks-with-team-name`.
  - EPM aggregation uses `backend/epm/rollup.py` and exact project labels to
    build Initiative -> Epic -> Story/Task trees.
  - Do not mix ENG team scoping into EPM project rollups.
- Capacity estimation
  - Anchors: `planning/capacity.py`, capacity routes in `jira_server.py`, and
    excluded-capacity stats utilities in `frontend/src/stats/`.
  - Keep capacity scoped to selected sprint/team group and excluded epic state.
  - Large sprint ranges must use progressive/cached source loading instead of
    eager full reloads.

## Constraints

- Firefox-safe.
- No Babel runtime.
- HTML-first deployment.
- Large dataset safe.
- Jira search pagination uses `nextPageToken` and `isLast`, not `startAt` and
  `total`.
- No new Jira fan-out without strict limits, caching behavior, and timing
  verification.
- Keep `/frontend/dist/` generated from source; do not hand-edit dist files.
- Preserve DB/OAuth and legacy Basic auth paths unless a task explicitly narrows
  auth scope.
- Treat Home/Townsquare-backed and Jira-project-backed EPM surfaces as
  read-oriented for normal users.
- Keep settings Team Groups/Group Labels and ENG/EPM view preferences separate
  from admin-only shared configuration saves.

## Change Guardrails

- Read both the feature module and its caller before editing.
- For frontend changes, update `frontend/src/` first, then run `npm run build`
  when dist output is required.
- For backend route or startup changes, verify the Flask startup path and
  `/api/test`.
- For UI changes, verify with browser screenshots and account for CSS
  animations/transitions before capturing proof.
- For source-boundary changes, check existing source guards under `tests/`.
- For performance-sensitive changes, compare request count, cache behavior, and
  `Server-Timing` before claiming improvement.
- Keep generated local caches and real Jira data out of commits.
