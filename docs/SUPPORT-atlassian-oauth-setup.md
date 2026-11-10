# SUPPORT: Atlassian OAuth Setup

This app requires database-backed Atlassian OAuth 2.0 (3LO) for browser login and application reads. Basic/API-token and local-file OAuth are retired serving profiles. Microsoft Entra SSO, when enforced by your organization, happens inside Atlassian's login flow; do not create or use a Microsoft OAuth app for Jira API bearer tokens.

## Create The Atlassian App

1. Open the Atlassian Developer Console: https://developer.atlassian.com/console/myapps/
2. Create an OAuth 2.0 (3LO) app, or open the existing app for this local dashboard.
3. Open `Authorization`.
4. Configure OAuth 2.0 (3LO).
5. Add the callback URL used by the local server:

```text
http://localhost:5050/api/auth/atlassian/callback
```

The callback URL in the Atlassian app must exactly match `ATLASSIAN_REDIRECT_URI`. `localhost` and `127.0.0.1` are different redirect URIs.

### Hosted Callback URL

For internal container hosting, register the HTTPS ingress callback URL in the Atlassian app, not the localhost callback:

```text
<https-origin>/api/auth/atlassian/callback
```

Set `ATLASSIAN_REDIRECT_URI` to that exact HTTPS callback URL and set `APP_ALLOWED_ORIGINS` to the same HTTPS origin. OAuth2 Proxy may enforce perimeter identity at ingress, but it does not replace app-level Atlassian OAuth. Jira REST calls still use the signed-in user's Atlassian OAuth 2.0 (3LO) session, and Home/Townsquare EPM metadata uses the same user's encrypted DB OAuth grant with the Home read scopes.

If Microsoft Entra SSO is enforced for the organization, keep using the Atlassian OAuth app. Entra remains part of the Atlassian login flow; do not replace the Atlassian app with a Microsoft OAuth app for Jira REST or Home/Townsquare token flows.

## Add Required APIs And Scopes

Open the app's `Permissions` page and add/configure these APIs.

| API in Developer Console | Scope | Why this app needs it |
| --- | --- | --- |
| User identity API | `read:me` | Backend calls `https://api.atlassian.com/me` after callback. |
| Jira API | `read:jira-work` | Jira issue, project, field, label, component, and search reads. |
| Jira API | `write:jira-work` | Issue status transition writes for ENG Catch Up and Planning. |
| Jira API | `read:jira-user` | User/profile fields returned by issue and team-related reads. |
| Jira Software API | `read:board-scope:jira-software` | `/rest/agile/1.0/board` board discovery. |
| Jira Software API | `read:sprint:jira-software` | `/rest/agile/1.0/board/{boardId}/sprint` sprint discovery. |
| Jira API | `read:project:jira` | Jira Software board APIs require project read scope. |
| Goals API | `read:goal:goals` | Home goal metadata, requested at every login. |
| Goals API | `read:access:goals` | Home goal access, requested at every login. |
| Projects API | `read:project:projects` | Home project metadata, requested at every login. |
| Projects API | `read:access:projects` | Home project access, requested at every login. |
| OAuth authorize URL only | `offline_access` | Refresh tokens for encrypted DB OAuth sessions; this does not appear as a separate API row. |

### Write Scope Forces Re-Auth For Every Signed-In User

`write:jira-work` is part of the default `ATLASSIAN_SCOPES` string, not an opt-in add-on for users who need it. The existing missing-scope check compares each session's granted scopes against that full default set, so promoting this scope forces every already-signed-in user — including read-only users who never attempt a status transition — to re-authenticate on their next load through `/login?reason=missing_scope`, not only users performing a write. Plan the rollout with that global re-consent in mind.

### Refresh Tokens

Keep this scope in `ATLASSIAN_SCOPES`:

```text
offline_access
```

Atlassian uses `offline_access` in the authorization URL to issue refresh tokens. It is not the same checkbox group as the Jira API or User Identity API permissions.

You do not add `offline_access` from the app's `Permissions` API list, and it does not appear as a separate API row in the screen. Leave it in `ATLASSIAN_SCOPES`; the backend sends it to Atlassian as part of the OAuth authorize URL.

## Local `.env`

For a new installation, configure the OAuth values from the Atlassian Developer Console along with the database, migrations and encryption settings in [INSTALL.md](../INSTALL.md). Existing supported DB/OAuth configurations keep their current values, signing secret, encryption provider and keyring; unused legacy keys do not require rewriting the file. The example below shows the OAuth app values only.

```env
JIRA_URL=https://your-company.atlassian.net
APP_ENVIRONMENT_KEY=local

JIRA_AUTH_MODE=atlassian_oauth
ATLASSIAN_CLIENT_ID=...
ATLASSIAN_CLIENT_SECRET=...
ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback
ATLASSIAN_SCOPES=read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access

FLASK_SECRET_KEY=...
# Optional first tool-admin bootstrap: comma-separated Atlassian account ids.
# TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS=<initial-tool-admin-account-id>
```

`JIRA_URL` is required in OAuth mode, but it is not a Basic-auth credential. It tells the backend which Jira Cloud site to select after Atlassian returns the user's accessible resources.

Generate `FLASK_SECRET_KEY` locally:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### DB OAuth Sessions and Profile Selection

Omitted, empty or whitespace auth/storage selectors default to `atlassian_oauth` and `db`. The storage aliases `database`, `postgres` and `postgresql` also select DB storage. Basic/API-token and live JSON/local-file OAuth profiles are rejected with sanitized setup guidance. Explicit developer JSON import/export remains available; startup does not import old token/config files, rewrite operator configuration or regenerate encryption keys.

`offline_access` gives the server a refresh token. Access and refresh tokens stay encrypted in DB `auth_tokens`; the signed browser cookie contains an opaque DB browser-session handle. Keep the same signing secret, database and encryption configuration across restarts. Logout deletes the current browser session; other browsers' sessions are independent.

An accepted local-loopback DB/OAuth profile may contain leftover Basic credential fields or local-store flag/path/TTL settings. They do not activate a local store, grant access or cause token-file I/O. The hosted/network prohibition on enabling the local-store opt-in still applies. A selected retired profile requires an approved DB migration before serving; there is no automatic compatibility conversion.

### Tool-Admin Rights

Tool-admin rights come from explicit app user state. Atlassian tenant/admin status, email address/domain, Jira permissions and Home/Townsquare access do not grant them. An operator can bootstrap an explicitly configured Atlassian account at callback only while that workspace has no tool admin; subsequent grants use the app-admin Access controls.

`SETTINGS_ADMIN_ONLY=true` (the default) restricts shared Admin settings to app admins. With `false`, authenticated users may edit those settings. The user directory and app-admin membership changes always require a tool admin, independently of that switch. The Admin -> Access picker lists users already known from OAuth sign-in and stores grants against their stable Atlassian account identity.

## Test The Flow

Restart the Flask server after changing `.env`.

1. Open `http://localhost:5050/login`.
2. Click `Sign in with Atlassian`.
3. Complete Atlassian login, including Microsoft Entra/Azure SSO through Atlassian when the organization enforces it. Record this operator-owned deployment acceptance separately; synthetic provider tests do not prove live SSO acceptance.
4. Accept the Atlassian consent screen.
5. Confirm the callback returns to the dashboard. If you opened a shared view link (`/?v=1&...`) while signed out, it is kept in the signed session cookie for up to 15 minutes and the callback returns to `/?<that query>` so the view opens after sign-in; the registered callback URL does not change.
6. Open `http://localhost:5050/api/auth/status`; it should report authenticated state and must not include tokens.
7. Open `http://localhost:5050/api/test`; it should use OAuth.

The ENG dashboard and Jira REST catalog/statistics routes are migrated through the OAuth Jira client. In DB/OAuth mode, EPM routes use the signed-in user's OAuth session for both Jira REST reads and Home/Townsquare metadata (the fixed `public-read-v1` query set). The user ticks **Enable EPM view** in `Settings -> Connections`; the app requests the four Home read scopes (`read:goal:goals`, `read:access:goals`, `read:project:projects`, `read:access:projects`) at every login, independently of the private EPM visibility preference, so the app registration must list them. The app stores no personal Atlassian API token; the earlier `atlassian_user_api_token` connections and their encrypted rows were removed by migration.

If Atlassian reports a missing scope, add the named scope to the matching API on the app's `Permissions` page, save, then start again from `/login?reason=missing_scope`. That path forces a new consent prompt so Atlassian issues a grant with the updated scopes.

If you already signed in before adding the Jira Software scopes, update `ATLASSIAN_SCOPES` and sign in again through `/login?reason=missing_scope`. `/api/auth/status` reports `loginUrl: "/login?reason=missing_scope"` when the stored session was issued without the current required scopes.

Use the same browser and hostname for the whole flow. If `ATLASSIAN_REDIRECT_URI` uses `localhost`, start from `http://localhost:5050/login`, not `http://127.0.0.1:5050/login`.

## Home GraphQL OAuth Gate

Rechecked on 2026-10-27 using a real local DB-backed browser session and the operator-approved Home site/goal fixture from the Basic setup. The recorded public Home reads worked, while the original eight-operation probe blocked migrating the unchanged query projections:

```text
FAIL home_graphql_3lo_unsupported
```

The configured app exposes the documented Goals and Projects APIs. The operator saved and consented to `read:goal:goals`, `read:access:goals`, `read:project:projects`, and `read:access:projects`; all four are now present in the provider-confirmed DB grant, with no Home write scopes. See the current [Goals](https://developer.atlassian.com/platform/goals/goals-graphql-api/using-graphql-api/) and [Projects](https://developer.atlassian.com/platform/projects/projects-graphql-api/using-projects-graphql-api/) documentation.

Live results:

| Read | Result |
| --- | --- |
| Goal search and lookup | Original queries pass at both the Home and documented OAuth gateways |
| Child goals | Core hierarchy query passes; the original `owner` selection fails |
| Linked projects and project details | Core fields pass when `owner` and nested update `creator` selections are omitted |
| Project updates | Update text and metadata pass without `creator` |
| Direct project tags | Original query passes |
| Teamwork Graph fallback | The original operation name is rejected; even with a valid company-prefixed operation name and explicit `operationName`, `cypherQuery` is restricted for this client and the service requires a persisted `customQuery` |

The identity errors name the precise paths: `goals_byId.subGoals.edges.node.owner`, `goals_byId.projects.edges.node.owner`, `goals_byId.projects.edges.node.updates.edges.node.creator`, `projects_byId.owner`, and `projects_byId.updates.edges.node.creator`. Their required scope is `identity:atlassian-external`. Atlassian's published explanation says apps cannot declare that internal scope and customers cannot authorize it ([staff explanation](https://community.developer.atlassian.com/t/rest-api-call-for-fetching-teams/79521/13)). This is not resolved by adding another published Home read scope.

These diagnostics changed query projections only in process memory and did not change application queries or the eight-operation gate contract. The original validator still prints `FAIL home_graphql_3lo_unsupported`; that result describes the complete current query set, not universal failure of Home OAuth. On 2026-10-27 the operator accepted a bounded public-read cutover and waived single-user usage/migration staging gates. The [accepted design and DoD](plans/SUPPORT-home-oauth-public-read-design.md) explicitly omit unavailable owner/author metadata and use direct Home tags. The [implementation record](plans/DONE-home-oauth-public-reads.md) describes the shipped bounded `public-read-v1` contract. Its seven-operation acceptance profile does not convert the original legacy FAIL to PASS. Source/format verification does not attest live deployment access; record operator-owned product acceptance separately.

Resolve runtime overrides before inspecting credentials: the local runner overrides the environment file's DB connection. The selected Basic Home fixture also belongs to a different site from the current dashboard and was used only as an explicitly approved diagnostic fixture. No private view or shared workspace configuration was changed. A migration must preserve the owning workspace/site and private EPM scope boundaries. The existing app's configured scope request list was not modified by this verification. The accepted plan keeps global Jira scope requirements unchanged, requests Home read scopes at every login, and uses a private Enable EPM view checkbox plus scoped Home access. These boundaries are implemented in the current application; the historical probe results above remain scoped to their recorded diagnostic fixture.

`GATE-05` applies only to posting Home project updates. Read-only OAuth verification requires no update text, disposable write target, or mutation probe.

These Home/Townsquare-backed API routes read Home with the signed-in user's OAuth grant once that user has enabled the EPM view and the provider confirmed the Home read scopes (the strict profile; a user without the scopes gets a typed `epm_scope_required` 409, a disabled view gets `epm_view_disabled` 409):

```text
/api/epm/scope
/api/epm/goals
/api/epm/projects
/api/epm/projects/configuration
/api/epm/projects/preview
/api/epm/projects/rollup/all
/api/epm/projects/<path:home_project_id>/issues
/api/epm/projects/<path:project_id>/rollup
```

The implemented EPM routes use the strict `public-read-v1` OAuth client in DB/OAuth mode; its format validator is `scripts/check_home_graphql_oauth.py --profile public-read-v1` (PASS reason `home_graphql_public_read_v1_supported`, which is not an attestation of live access: the product journey is the proof). Basic/API-token and live JSON compatibility serving paths are retired; historical service-integration rows remain preserved and unused as Jira/Home read credentials. The legacy eight-query gate above is unchanged and still fails.

### Home/Townsquare Visibility Model

DB/OAuth EPM uses OAuth authorization for Home. The [public-read design](plans/SUPPORT-home-oauth-public-read-design.md) records the contract:

- Require a valid user Atlassian OAuth session before serving the route.
- Use the user OAuth session for Jira REST reads, rollups, labels, issue search, and user-specific Jira data.
- Use the same OAuth session, through the strict Home client, only for Home goals/projects metadata.
- Return a typed state (`epm_view_disabled`, `epm_scope_required`, `home_access_denied`, `home_rate_limited`, `home_read_failed`) when Home cannot be read, rather than empty EPM data.
- Record Home 3LO capability per field: the live diagnostics verified core reads, while the existing identity selections and restricted Teamwork Graph fallback still prevent an unchanged migration.

The intended internal policy is: each authenticated Atlassian user for the configured site views Home/Townsquare metadata through their own OAuth grant, while Jira-backed data remains constrained by that user's Jira OAuth permissions.

## Common Errors

`failed to retrieve client`

Atlassian cannot find the app for the `client_id`. Check `ATLASSIAN_CLIENT_ID`, make sure it came from an Atlassian OAuth 2.0 (3LO) app, and restart the server.

`requested ... scopes that have not been added to the app`

The scope is in `ATLASSIAN_SCOPES`, but it was not added in the app's `Permissions` page. For example, add `read:me` under `User Identity API`, not under `Jira API`.

`invalid redirect_uri`

The callback URL configured in Atlassian does not exactly match `ATLASSIAN_REDIRECT_URI`.

`invalid_oauth_state`

The callback reached the local server, but the browser did not send the same Flask session that started `/api/auth/atlassian/login`. Common causes:

- The callback URL was opened in a different browser or profile.
- The flow mixed `localhost` and `127.0.0.1`.
- The Flask server restarted after login with a different `FLASK_SECRET_KEY`.
- An old callback URL was refreshed or pasted after the one-time authorization code was already stale.

Start again from `/login` in the same browser tab. Do not reuse an old callback URL.

`route_not_oauth_ready`

The login session is valid, but the requested API route is intentionally guarded because it has no supported OAuth boundary. The ENG dashboard, Jira REST catalog/statistics routes, and DB/OAuth EPM routes read Home through the user's OAuth grant; do not fall back to process-global Basic credentials for guarded routes.

`runtime_auth_unsupported`, `runtime_storage_unsupported` or `runtime_legacy_cli_unsupported`

The selected application profile or explicit credential CLI request is retired. Use the approved DB/OAuth setup and migration workflow; do not add Basic credentials or enable a local token store to bypass the error. Inert legacy keys in an already supported local-loopback DB/OAuth configuration do not need removal. Hosted/network cookie, origin and local-store opt-in restrictions still apply.

## References

- Atlassian OAuth 2.0 (3LO) apps: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- Jira Platform OAuth scopes: https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
- Jira Software OAuth scopes: https://developer.atlassian.com/cloud/jira/software/scopes-for-oauth-2-3LO-and-forge-apps/
- Jira Software board API scopes: https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
- Jira Software sprint API scopes: https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/
- Atlassian refresh tokens: https://developer.atlassian.com/cloud/oauth/getting-started/refresh-tokens/
