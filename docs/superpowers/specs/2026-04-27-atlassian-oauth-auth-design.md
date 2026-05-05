# Atlassian OAuth Authentication

**Date:** 2026-04-27
**Status:** Draft for review

## Problem

Jira Execution Planner currently requires every local operator to create an Atlassian API token and configure `JIRA_EMAIL` plus `JIRA_TOKEN`. That works for a personal script, but it is the wrong default for a company tool: users expect to sign in with the company identity flow they already use for Jira and Confluence.

Microsoft Entra ID, formerly Azure Active Directory, cannot be used as a bearer token issuer for Jira Cloud REST APIs directly. Jira Cloud accepts Atlassian authentication. If the company's Atlassian organization is configured for SAML SSO through Microsoft Entra ID, Atlassian login will send the user through Entra during the Atlassian OAuth consent flow.

## Goal

Add an optional Atlassian OAuth 2.0 3LO authentication mode so users can sign in through Atlassian, inherit company SSO when configured, and call Jira APIs on their own behalf without copying API tokens into `.env`.

## Non-Goals

- Do not implement direct Microsoft Graph or Microsoft Entra API access.
- Do not try to exchange a Microsoft access token for Jira access locally.
- Do not remove API-token Basic auth in the first slice.
- Do not add Confluence API calls in the first slice; design the auth layer so Confluence can be added later.
- Do not build production multi-user persistence in the first slice.
- Do not add database tables, migrations, or database-backed user configuration in the first slice. The first slice creates the auth/client boundary that the later database phase depends on.
- Do not modify `frontend/src/dashboard.jsx` in the first slice. Auth-mode work stays isolated to backend helpers, routes, config, tests, and documentation unless a separate UI change is explicitly approved.

## Current State

- `jira_server.py` reads `JIRA_URL`, `JIRA_EMAIL`, and `JIRA_TOKEN` at process startup.
- Current route code is split across `backend/routes/`, with `backend/app.py` registering blueprints and `backend/jira_client.py` holding shared Jira request behavior.
- Many Jira calls build `Authorization: Basic ...` headers inline.
- Startup fails unless the Basic auth env vars are present.
- The current dashboard assumes the backend can fetch Jira data immediately.
- There is no server-side user session or token refresh path.

## Proposed Design

### 1. Auth Modes

Introduce an explicit auth mode:

```text
JIRA_AUTH_MODE=basic
JIRA_AUTH_MODE=atlassian_oauth
```

`basic` preserves current behavior. `atlassian_oauth` enables browser login and removes the requirement for `JIRA_EMAIL` and `JIRA_TOKEN`.

OAuth config:

```text
ATLASSIAN_CLIENT_ID=
ATLASSIAN_CLIENT_SECRET=
ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback
ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user offline_access
```

`JIRA_URL` remains required in both modes because it selects the Atlassian site this dashboard targets.

### 2. Backend Auth Routes

Add local Flask routes:

- `GET /api/auth/status`
- `GET /api/auth/atlassian/login`
- `GET /api/auth/atlassian/callback`
- `POST /api/auth/logout`

The login route creates a CSRF `state`, redirects to `https://auth.atlassian.com/authorize`, and requests the configured scopes. The callback validates `state`, exchanges the authorization code at `https://auth.atlassian.com/oauth/token`, calls `https://api.atlassian.com/oauth/token/accessible-resources`, selects the resource whose URL matches `JIRA_URL`, stores token data and `cloudid` in the server-side token store, and keeps only an opaque session id in Flask's signed cookie.

The authorization request also uses PKCE with an S256 `code_challenge`. The callback must submit the matching `code_verifier` during token exchange. `state` remains a separate one-time CSRF value and is cleared after the callback succeeds or fails.

The callback must fetch `https://api.atlassian.com/me` with the granted token and store the stable `account_id` in the local auth context. Email and display name are mutable profile fields. The database phase must upsert users by provider plus `account_id`, reject inactive Atlassian accounts, and handle email changes without creating duplicate users.

### 3. Local Token Storage Boundary

The first implementation uses Flask's signed session cookie only for an opaque auth session id and OAuth `state`. Access tokens, refresh tokens, and API tokens stay server-side in a local process store keyed by that opaque session id. The browser never sees access or refresh tokens through frontend JavaScript.

Wrap token access behind functions such as `oauth_session_data()` and `save_oauth_session(data)` so the later database phase can replace the local process store with PostgreSQL-backed `auth_connections` and encrypted `auth_tokens` without changing every Jira route.

The local process store must be explicitly gated as non-production. It needs TTL cleanup, logout/revoke deletion, refresh locking, and a startup guard such as `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true` so production multi-user deployments cannot accidentally use it as the token store.

If the token is expired and a refresh token is available, the backend refreshes before calling Jira. If refresh fails, Jira API routes return `401` with `{"error": "auth_required"}`.

Production database-backed auth is a separate phase. That phase owns `users`, `workspaces`, `auth_connections`, encrypted `auth_tokens`, and `jira_project_access`. Basic API-token mode remains local by default unless a later requirement explicitly asks for server-side Basic token persistence.

Before database work starts, the app must also define session and browser request policy: `HttpOnly` session cookies, `SameSite=Lax`, `Secure` cookies outside local HTTP development, a restricted CORS allowlist, and CSRF protection for state-changing browser routes.

### 4. Jira Client Boundary

Add a focused Jira auth/client helper instead of rewriting every endpoint at once. Implement it in the current backend layout, not as a pre-split root-only module:

- Pure helpers: `backend/auth/jira_auth.py`
- OAuth routes: `backend/routes/auth_routes.py`
- Blueprint registration: `backend/app.py`
- Runtime env compatibility and transition wrappers: `jira_server.py`

Responsibilities:

- `build_jira_headers()`
- `build_jira_api_url(path)`
- `jira_get(path, **kwargs)`
- `jira_post(path, **kwargs)`
- `get_current_auth_status()`

Basic mode keeps calling:

```text
{JIRA_URL}/rest/api/3/...
```

OAuth mode calls:

```text
https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3/...
```

Agile endpoints use the same `/ex/jira/{cloudid}` gateway path with their existing `/rest/agile/1.0/...` suffix.

### 5. Dashboard Isolation

The first OAuth slice does not change `frontend/src/dashboard.jsx`.

OAuth login is exposed through backend routes and can be tested directly at `/api/auth/atlassian/login` plus `/api/auth/status`. Existing dashboard behavior stays unchanged until a later, explicit UI task decides how to present login state.

No Atlassian token is stored in localStorage.

### 6. Local Testing

Local testing requires an Atlassian Developer Console OAuth 2.0 3LO app. The callback URL must exactly match `ATLASSIAN_REDIRECT_URI`. If Atlassian rejects a plain localhost callback in a company tenant, use an HTTPS tunnel and set the callback to the tunnel URL.

Company Microsoft Entra SSO is tested indirectly: during Atlassian login, the user's managed Atlassian account is redirected to the configured company identity provider.

### 7. Rollout

First slice:

1. Add auth mode config and validation.
2. Add OAuth routes and token refresh.
3. Add auth/client helper.
4. Migrate `/api/test` and one small read-only Jira endpoint to the helper.
5. Keep token material out of Flask cookies, browser storage, and dashboard config payloads.

Second slice:

1. Replace repeated inline Basic auth blocks in the remaining Jira endpoints.
2. Remove duplicated URL/header construction.
3. Add Confluence scopes and a Confluence client only when a real Confluence feature needs it.
4. Add a dashboard login UI only after approving a separate UI plan.
5. Prepare the request auth context for later cache partitioning by workspace plus user or auth connection.

Database-backed phase:

1. Introduce PostgreSQL-backed identity and auth tables only after the Jira/Home auth-client boundary exists, stable Atlassian identity is available, and Jira/Home caches are auth-partitioned or disabled for OAuth users.
2. Store connection metadata and encrypted token material in the database.
3. Keep shared dashboard configuration separate from user-owned saved views.
4. Use only normal user and admin account types; ENG/EPM behavior comes from selected configuration, not user roles.
5. Avoid broad Jira/Home validation fan-out during initial dashboard load.

## Error Handling

- Missing OAuth config in OAuth mode: fail startup with a clear configuration error.
- Missing session in OAuth mode: API routes return `401 {"error": "auth_required"}`.
- Atlassian callback `state` mismatch: return `400 {"error": "invalid_oauth_state"}`.
- Token exchange failure: log status and return `401 {"error": "oauth_exchange_failed"}`.
- No accessible resource matching `JIRA_URL`: return `403 {"error": "jira_site_not_accessible"}`.
- Refresh failure: clear token session and return `401 {"error": "auth_required"}`.

## Testing

- Unit tests for auth-mode validation.
- Unit tests for Atlassian authorize URL generation and `state`.
- Unit tests for PKCE verifier/challenge generation and callback token exchange.
- Unit tests for stable Atlassian identity extraction from `https://api.atlassian.com/me`.
- Unit tests for accessible-resource selection by normalized `JIRA_URL`.
- Unit tests for Basic versus OAuth Jira URL/header construction.
- Unit tests for refresh-token success and failure behavior.
- Unit tests that local OAuth token material is stored server-side behind an opaque session id, not directly in Flask's signed session payload.
- Unit tests or source guards for session cookie defaults, CORS allowlist behavior, and CSRF protection before DB-backed admin/config endpoints ship.
- Source guard that auth-mode implementation does not modify `frontend/src/dashboard.jsx`.
- Manual browser test for the local OAuth backend flow.

## References

- Atlassian OAuth 2.0 3LO apps: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
- Atlassian auth code flow: https://developer.atlassian.com/cloud/oauth/getting-started/implementing-oauth-3lo/
- Atlassian SAML SSO with identity providers: https://support.atlassian.com/security-and-access-policies/docs/configure-saml-single-sign-on-with-an-identity-provider/
