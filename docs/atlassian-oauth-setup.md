# Atlassian OAuth Setup

This app uses Atlassian OAuth 2.0 (3LO) for browser login. Microsoft Entra SSO, when enforced by your organization, happens inside Atlassian's login flow; do not create or use a Microsoft OAuth app for Jira API bearer tokens.

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

## Add Required APIs And Scopes

Open the app's `Permissions` page and add/configure these APIs.

| API in Developer Console | Scope | Why this app needs it |
| --- | --- | --- |
| User identity API | `read:me` | Backend calls `https://api.atlassian.com/me` after callback. |
| Jira API | `read:jira-work` | Jira issue, project, field, label, component, and search reads. |
| Jira API | `read:jira-user` | User/profile fields returned by issue and team-related reads. |
| Jira Software API | `read:board-scope:jira-software` | `/rest/agile/1.0/board` board discovery. |
| Jira Software API | `read:sprint:jira-software` | `/rest/agile/1.0/board/{boardId}/sprint` sprint discovery. |
| Jira API | `read:project:jira` | Jira Software board APIs require project read scope. |
| OAuth authorize URL only | `offline_access` | Refresh tokens for local OAuth sessions; this does not appear as a separate API row. |

### Refresh Tokens

Keep this scope in `ATLASSIAN_SCOPES`:

```text
offline_access
```

Atlassian uses `offline_access` in the authorization URL to issue refresh tokens. It is not the same checkbox group as the Jira API or User Identity API permissions.

You do not add `offline_access` from the app's `Permissions` API list, and it does not appear as a separate API row in the screen. Leave it in `ATLASSIAN_SCOPES`; the backend sends it to Atlassian as part of the OAuth authorize URL.

## Local `.env`

Copy `.env.example` to `.env`, comment the Basic auth block, and uncomment the Atlassian OAuth block. Use real values from the Atlassian Developer Console:

```env
JIRA_URL=https://your-company.atlassian.net
APP_ENVIRONMENT_KEY=local

JIRA_AUTH_MODE=atlassian_oauth
ATLASSIAN_CLIENT_ID=...
ATLASSIAN_CLIENT_SECRET=...
ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback
ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access

FLASK_SECRET_KEY=...
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true
OAUTH_TOKEN_STORE_PATH=.oauth-token-store.json
OAUTH_TOKEN_STORE_TTL_SECONDS=2592000
# Reserved for future DB-backed first-admin bootstrap.
# Pre-DB OAuth treats every signed-in Atlassian user as a local tool admin.
# TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS=...
```

`JIRA_URL` is required in OAuth mode, but it is not a Basic-auth credential. It tells the backend which Jira Cloud site to select after Atlassian returns the user's accessible resources.

Generate `FLASK_SECRET_KEY` locally:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Local OAuth Session Persistence

`offline_access` gives the server a refresh token. With `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true`, the local/dev server stores that OAuth session server-side at `OAUTH_TOKEN_STORE_PATH` so a Flask restart does not force a new Atlassian consent flow. The browser cookie keeps only an opaque local session id; access and refresh tokens stay in the server-side token store.

Keep `OAUTH_TOKEN_STORE_PATH` local and ignored by git. The default local path `.oauth-token-store.json` is ignored by this repo. `OAUTH_TOKEN_STORE_TTL_SECONDS` defaults to 30 days; shorten it only if you want local sessions to expire sooner. Delete the token store file or use `/api/auth/logout` when you want to clear the saved local session.

### Temporary Pre-DB Tool-Admin Writes

Until database-backed users and roles land, OAuth mode treats every signed-in Atlassian user as a local tool admin for shared configuration writes. This is a temporary local-runner simplification, not an Atlassian admin signal. `TOOL_ADMIN_ATLASSIAN_ACCOUNT_IDS` is reserved for future DB-backed first-admin bootstrap, where stable Atlassian `account_id` values will be identity keys and Atlassian tenant/admin status, email address, email domain, Jira project access, or Home/Townsquare access will not grant tool-admin rights.

## Test The Flow

Restart the Flask server after changing `.env`.

1. Open `http://localhost:5050/login`.
2. Click `Sign in with Atlassian`.
3. Complete Atlassian login. If Microsoft Entra SSO is enforced, Atlassian redirects through it automatically.
4. Accept the Atlassian consent screen.
5. Confirm the callback returns to the dashboard.
6. Open `http://localhost:5050/api/auth/status`; it should report authenticated state and must not include tokens.
7. Open `http://localhost:5050/api/test`; it should use OAuth.

The ENG dashboard and Jira REST catalog/statistics routes are migrated through the OAuth Jira client. Home/Townsquare GraphQL-backed API routes remain guarded until the Home client has its own auth migration. Today those routes sit under `/api/epm/*` because EPM is the feature that consumes Home/Townsquare metadata. If a route returns `route_not_oauth_ready`, the OAuth session is valid but that route is intentionally outside the current OAuth Jira REST surface.

If Atlassian reports a missing scope, add the named scope to the matching API on the app's `Permissions` page, save, then start again from `/login?reason=missing_scope`. That path forces a new consent prompt so Atlassian issues a grant with the updated scopes.

If you already signed in before adding the Jira Software scopes, update `ATLASSIAN_SCOPES` and sign in again through `/login?reason=missing_scope`. `/api/auth/status` reports `loginUrl: "/login?reason=missing_scope"` when the stored session was issued without the current required scopes.

Use the same browser and hostname for the whole flow. If `ATLASSIAN_REDIRECT_URI` uses `localhost`, start from `http://localhost:5050/login`, not `http://127.0.0.1:5050/login`.

## Home GraphQL OAuth Gate

The local Home/Townsquare GraphQL 3LO feasibility probe currently stops the Home/Townsquare-backed API route migration with:

```text
FAIL home_graphql_3lo_unsupported
```

The Jira OAuth session can read Jira REST and Jira Software APIs, but the Home GraphQL `goals_search` operation returns a Home scope authorization error for the current grant. Do not use the user's Jira OAuth access token for Home/Townsquare GraphQL calls while this gate fails.

Keep these Home/Townsquare-backed API routes guarded with `route_not_oauth_ready` in OAuth mode:

```text
/api/epm/scope
/api/epm/goals
/api/epm/projects
/api/epm/projects/configuration
/api/epm/projects/preview
/api/epm/projects/rollup/all
/api/epm/projects/<home_project_id>/issues
/api/epm/projects/<project_id>/rollup
```

Home/Townsquare access needs server-side Basic service credentials until a fresh real probe returns PASS. In local JSON-backed runs, configure explicit `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN`; OAuth mode must not fall back to `JIRA_EMAIL`/`JIRA_TOKEN` for Home/Townsquare. In DB-backed runs, store the same kind of credential as a `home_townsquare_basic` service integration, not as a normal user's token.

### Home/Townsquare Visibility Model

When Home/Townsquare-backed routes are migrated, use hybrid authorization:

- Require a valid user Atlassian OAuth session before serving the route.
- Use the user OAuth session for Jira REST reads, rollups, labels, issue search, and any user-specific Jira data.
- Use the server-side Home/Townsquare service credential only for Home goals/projects metadata.
- Limit service-credential Home reads to the configured Home root/sub-goals.
- Do not claim that Home/Townsquare GraphQL verified per-user Home project or goal access. The local feasibility probe showed the user's Jira 3LO token cannot call that GraphQL surface.

The intended internal policy is: any authenticated Atlassian user for the configured site may view configured Home/Townsquare metadata, while Jira-backed data remains constrained by that user's Jira OAuth permissions.

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

The login session is valid, but the requested API route is intentionally outside the current OAuth Jira REST surface. The ENG dashboard and Jira REST catalog/statistics routes are migrated; Home/Townsquare GraphQL-backed API routes remain guarded until the Home client has its own auth migration.

`Local OAuth token storage requires APP_ENVIRONMENT_KEY=local or dev and OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true`

Set both values for local testing:

```env
APP_ENVIRONMENT_KEY=local
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true
```

## References

- Atlassian OAuth 2.0 (3LO) apps: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- Jira Platform OAuth scopes: https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
- Jira Software OAuth scopes: https://developer.atlassian.com/cloud/jira/software/scopes-for-oauth-2-3LO-and-forge-apps/
- Jira Software board API scopes: https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/
- Jira Software sprint API scopes: https://developer.atlassian.com/cloud/jira/software/rest/api-group-sprint/
- Atlassian refresh tokens: https://developer.atlassian.com/cloud/oauth/getting-started/refresh-tokens/
