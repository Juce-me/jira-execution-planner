# Endpoint Security Policy

The endpoint policy registry lives in `backend/security/policy.py`. Every Flask route must match exactly one policy, and new routes must fail tests until the route, policy, sample, and matrix coverage are added together.

## Policy Classes

| Class | Meaning |
| --- | --- |
| `public_page` | Browser entry, health, static asset, or non-secret public page. |
| `auth_flow` | Login, OAuth callback, auth status, CSRF token, logout, and auth recovery pages. |
| `authenticated_read` | App-data read routes that require Basic-local or an authenticated OAuth browser session. |
| `user_write` | Current-user private state or user-owned export/connection routes. |
| `workspace_write` | Collaborative workspace state writes such as Scenario draft collaboration. |
| `shared_admin_write` | Shared workspace/app configuration writes requiring tool admin in OAuth/DB mode. |
| `tool_admin` | Operator/admin inspection and user/service credential administration. |
| `dev_local` | Local-only diagnostics hidden unless explicitly enabled on loopback. |
| `legacy_basic_local` | Compatibility routes allowed only for local Basic mode during migration. |

## Adding An Endpoint

1. Add the Flask route in a blueprint under `backend/routes/`.
2. Add one `EndpointPolicy` entry in `backend/security/policy.py`.
3. Add a dynamic sample in `tests/endpoint_security_samples.py` when the route has path variables.
4. Add or update `tests/test_endpoint_security_matrix.py` for representative auth, CSRF, admin, or dev-local behavior.
5. Run `make test-security`.

## Current Registry

| Name | Methods | Path | Class | Match |
| --- | --- | --- | --- | --- |
| `dashboard-root` | `GET` | `/` | `public_page` | `exact` |
| `dashboard-html` | `GET` | `/jira-dashboard.html` | `public_page` | `exact` |
| `frontend-dist` | `GET` | `/frontend/dist/<path:filename>` | `public_page` | `dynamic` |
| `favicon` | `GET` | `/favicon.ico` | `public_page` | `exact` |
| `epm-burst` | `GET` | `/epm-burst.svg` | `public_page` | `exact` |
| `health` | `GET` | `/health` | `public_page` | `exact` |
| `auth-pages` | `GET` | `/auth/` | `auth_flow` | `prefix` |
| `login` | `GET` | `/login` | `auth_flow` | `exact` |
| `auth-dev-home-probe` | `GET` | `/api/auth/dev/home-graphql-oauth-probe` | `dev_local` | `exact` |
| `auth-api` | `GET, POST` | `/api/auth/` | `auth_flow` | `prefix` |
| `admin-api` | `DELETE, GET, PATCH, POST` | `/api/admin/` | `tool_admin` | `prefix` |
| `user-views-api` | `GET, PATCH, POST` | `/api/me/views` | `user_write` | `prefix` |
| `user-connections-api` | `DELETE, GET, POST` | `/api/me/connections/` | `user_write` | `prefix` |
| `eng-api` | `GET` | `/api/tasks` | `authenticated_read` | `exact` |
| `eng-api-team-name` | `GET` | `/api/tasks-with-team-name` | `authenticated_read` | `exact` |
| `eng-api-teams` | `GET` | `/api/teams` | `authenticated_read` | `exact` |
| `eng-api-teams-prefix` | `GET` | `/api/teams/` | `authenticated_read` | `prefix` |
| `eng-api-backlog` | `GET` | `/api/backlog-epics` | `authenticated_read` | `exact` |
| `eng-api-missing-info` | `GET` | `/api/missing-info` | `authenticated_read` | `exact` |
| `eng-api-dependencies` | `POST` | `/api/dependencies` | `authenticated_read` | `exact` |
| `eng-api-issue-lookup` | `GET` | `/api/issues/lookup` | `authenticated_read` | `exact` |
| `settings-config-read` | `GET` | `/api/config` | `authenticated_read` | `exact` |
| `settings-version` | `GET` | `/api/version` | `authenticated_read` | `exact` |
| `settings-groups-read` | `GET` | `/api/groups-config` | `authenticated_read` | `exact` |
| `settings-groups-write` | `POST` | `/api/groups-config` | `user_write` | `exact` |
| `settings-catalog-read` | `GET` | `/api/team-catalog` | `authenticated_read` | `exact` |
| `settings-catalog-write` | `POST` | `/api/team-catalog` | `user_write` | `exact` |
| `jira-catalogs` | `GET` | `/api/projects` | `authenticated_read` | `exact` |
| `jira-components` | `GET` | `/api/components` | `authenticated_read` | `exact` |
| `jira-epics-search` | `GET` | `/api/epics/search` | `authenticated_read` | `exact` |
| `jira-labels` | `GET` | `/api/jira/labels` | `authenticated_read` | `exact` |
| `jira-fields` | `GET` | `/api/fields` | `authenticated_read` | `exact` |
| `jira-boards` | `GET` | `/api/boards` | `authenticated_read` | `exact` |
| `jira-sprints` | `GET` | `/api/sprints` | `authenticated_read` | `exact` |
| `jira-issue-types` | `GET` | `/api/issue-types` | `authenticated_read` | `exact` |
| `selected-projects-read` | `GET` | `/api/projects/selected` | `authenticated_read` | `exact` |
| `selected-projects-write` | `POST` | `/api/projects/selected` | `shared_admin_write` | `exact` |
| `board-config-read` | `GET` | `/api/board-config` | `authenticated_read` | `exact` |
| `board-config-write` | `POST` | `/api/board-config` | `shared_admin_write` | `exact` |
| `capacity-config-read` | `GET` | `/api/capacity/config` | `authenticated_read` | `exact` |
| `capacity-config-write` | `POST` | `/api/capacity/config` | `shared_admin_write` | `exact` |
| `sprint-field-config-read` | `GET` | `/api/sprint-field/config` | `authenticated_read` | `exact` |
| `sprint-field-config-write` | `POST` | `/api/sprint-field/config` | `shared_admin_write` | `exact` |
| `story-points-config-read` | `GET` | `/api/story-points-field/config` | `authenticated_read` | `exact` |
| `story-points-config-write` | `POST` | `/api/story-points-field/config` | `shared_admin_write` | `exact` |
| `parent-name-config-read` | `GET` | `/api/parent-name-field/config` | `authenticated_read` | `exact` |
| `parent-name-config-write` | `POST` | `/api/parent-name-field/config` | `shared_admin_write` | `exact` |
| `team-field-config-read` | `GET` | `/api/team-field/config` | `authenticated_read` | `exact` |
| `team-field-config-write` | `POST` | `/api/team-field/config` | `shared_admin_write` | `exact` |
| `priority-weights-read` | `GET` | `/api/stats/priority-weights-config` | `authenticated_read` | `exact` |
| `priority-weights-write` | `POST` | `/api/stats/priority-weights-config` | `shared_admin_write` | `exact` |
| `issue-types-config-read` | `GET` | `/api/issue-types/config` | `authenticated_read` | `exact` |
| `issue-types-config-write` | `POST` | `/api/issue-types/config` | `shared_admin_write` | `exact` |
| `epm-config-read` | `GET` | `/api/epm/config` | `authenticated_read` | `exact` |
| `epm-config-write` | `POST` | `/api/epm/config` | `shared_admin_write` | `exact` |
| `epm-scope` | `GET` | `/api/epm/scope` | `authenticated_read` | `exact` |
| `epm-goals` | `GET` | `/api/epm/goals` | `authenticated_read` | `exact` |
| `epm-projects` | `GET` | `/api/epm/projects` | `authenticated_read` | `exact` |
| `epm-project-issues` | `GET` | `/api/epm/projects/<home_project_id>/issues` | `authenticated_read` | `dynamic` |
| `epm-project-rollup` | `GET` | `/api/epm/projects/<project_id>/rollup` | `authenticated_read` | `dynamic` |
| `epm-projects-configuration` | `POST` | `/api/epm/projects/configuration` | `shared_admin_write` | `exact` |
| `epm-projects-preview` | `POST` | `/api/epm/projects/preview` | `authenticated_read` | `exact` |
| `epm-projects-rollup-all` | `GET` | `/api/epm/projects/rollup/all` | `authenticated_read` | `exact` |
| `scenario-main` | `GET, POST` | `/api/scenario` | `authenticated_read` | `exact` |
| `scenario-drafts-root-read` | `GET` | `/api/scenario/drafts` | `authenticated_read` | `exact` |
| `scenario-drafts-root-write` | `POST` | `/api/scenario/drafts` | `workspace_write` | `exact` |
| `scenario-draft-version` | `GET` | `/api/scenario/drafts/<draft_id>/versions/<int:version_number>` | `authenticated_read` | `dynamic` |
| `scenario-draft-events` | `GET` | `/api/scenario/drafts/<draft_id>/events` | `authenticated_read` | `dynamic` |
| `scenario-draft-events-stream` | `GET` | `/api/scenario/drafts/<draft_id>/events/stream` | `authenticated_read` | `dynamic` |
| `scenario-draft-presence-read` | `GET` | `/api/scenario/drafts/<draft_id>/presence` | `authenticated_read` | `dynamic` |
| `scenario-draft-presence-write` | `POST` | `/api/scenario/drafts/<draft_id>/presence` | `workspace_write` | `dynamic` |
| `scenario-draft-locks` | `POST` | `/api/scenario/drafts/<draft_id>/locks` | `workspace_write` | `dynamic` |
| `scenario-draft-reload` | `POST` | `/api/scenario/drafts/<draft_id>/reload-from-jira` | `workspace_write` | `dynamic` |
| `scenario-draft-rollback` | `POST` | `/api/scenario/drafts/<draft_id>/rollback` | `workspace_write` | `dynamic` |
| `scenario-draft-writeback-preview` | `POST` | `/api/scenario/drafts/<draft_id>/writeback/preview` | `workspace_write` | `dynamic` |
| `scenario-draft-writeback-blocked` | `POST` | `/api/scenario/drafts/<draft_id>/writeback` | `workspace_write` | `dynamic` |
| `scenario-overrides-read` | `GET` | `/api/scenario/overrides` | `authenticated_read` | `exact` |
| `scenario-overrides-legacy-write` | `POST` | `/api/scenario/overrides` | `legacy_basic_local` | `exact` |
| `stats-read` | `GET` | `/api/stats` | `authenticated_read` | `exact` |
| `stats-burnout` | `GET, POST` | `/api/stats/burnout` | `authenticated_read` | `exact` |
| `stats-epic-cohort` | `POST` | `/api/stats/epic-cohort` | `authenticated_read` | `exact` |
| `stats-excluded-source` | `POST` | `/api/stats/excluded-capacity-source` | `authenticated_read` | `exact` |
| `capacity-read` | `GET` | `/api/capacity` | `authenticated_read` | `exact` |
| `planned-capacity-read` | `GET` | `/api/planned-capacity` | `authenticated_read` | `exact` |
| `test-connection` | `GET` | `/api/test` | `authenticated_read` | `exact` |
| `export-excel` | `POST` | `/api/export-excel` | `user_write` | `exact` |
| `debug-fields` | `GET` | `/api/debug-fields` | `dev_local` | `exact` |
| `tasks-fields` | `GET` | `/api/tasks-fields` | `dev_local` | `exact` |
