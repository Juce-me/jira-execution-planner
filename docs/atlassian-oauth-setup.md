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

### User Identity API

Select:

```text
View active user profile
```

Scope:

```text
read:me
```

This scope is required because the backend calls `https://api.atlassian.com/me` after OAuth callback to identify the signed-in Atlassian account.

### Jira API

Select:

```text
View Jira issue data
View user profiles
```

Scopes:

```text
read:jira-work
read:jira-user
```

These scopes are required for the migrated Jira API smoke path and for selecting the configured Jira Cloud site from Atlassian's accessible resources response.

### Refresh Tokens

Keep this scope in `ATLASSIAN_SCOPES`:

```text
offline_access
```

Atlassian uses `offline_access` in the authorization URL to issue refresh tokens. It is not the same checkbox group as the Jira API or User Identity API permissions.

You do not add `offline_access` from the app's `Permissions` API list, and it does not appear as a separate API row in the screen. Leave it in `ATLASSIAN_SCOPES`; the backend sends it to Atlassian as part of the OAuth authorize URL.

## Local `.env`

Use real values from the Atlassian Developer Console:

```env
JIRA_AUTH_MODE=atlassian_oauth
APP_ENVIRONMENT_KEY=local
JIRA_URL=https://your-company.atlassian.net

ATLASSIAN_CLIENT_ID=...
ATLASSIAN_CLIENT_SECRET=...
ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback
ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user offline_access

FLASK_SECRET_KEY=...
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true
```

`JIRA_URL` is required in OAuth mode, but it is not a Basic-auth credential. It tells the backend which Jira Cloud site to select after Atlassian returns the user's accessible resources.

Generate `FLASK_SECRET_KEY` locally:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

## Test The Flow

Restart the Flask server after changing `.env`.

1. Open `http://localhost:5050/login`.
2. Click `Sign in with Atlassian`.
3. Complete Atlassian login. If Microsoft Entra SSO is enforced, Atlassian redirects through it automatically.
4. Accept the Atlassian consent screen.
5. Confirm the callback returns to the dashboard.
6. Open `http://localhost:5050/api/auth/status`; it should report authenticated state and must not include tokens.
7. Open `http://localhost:5050/api/test`; it should use OAuth.

If Atlassian reports a missing scope, add the named scope to the matching API on the app's `Permissions` page, save, then start again from `/login`.

Use the same browser and hostname for the whole flow. If `ATLASSIAN_REDIRECT_URI` uses `localhost`, start from `http://localhost:5050/login`, not `http://127.0.0.1:5050/login`.

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

`Local OAuth token storage requires APP_ENVIRONMENT_KEY=local or dev and OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true`

Set both values for local testing:

```env
APP_ENVIRONMENT_KEY=local
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true
```

## References

- Atlassian OAuth 2.0 (3LO) apps: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- Atlassian Jira OAuth scopes: https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
- Atlassian refresh tokens: https://developer.atlassian.com/cloud/oauth/getting-started/refresh-tokens/
