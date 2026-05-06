# docs/plans/AGENTS.md

Plan-specific instructions for this repository.

## Home/Townsquare 3LO Gate

Before creating or executing any plan that touches Atlassian Home/Townsquare GraphQL auth, Home-backed EPM/APM routes, or Jira-project-backed EPM/APM route migration:

1. Read `docs/atlassian-oauth-setup.md`, especially the Home GraphQL OAuth gate and visibility model.
2. Check whether Atlassian Home/Townsquare GraphQL now accepts user 3LO tokens from a real local OAuth session.
3. Start from the existing readiness plan: `docs/plans/2026-05-06-home-townsquare-3lo-readiness-migration.md`.
4. Run or document this gate before marking any Home/Townsquare-backed route OAuth-ready:

```bash
.venv/bin/python scripts/check_home_graphql_oauth.py
```

After logging in locally through Atlassian OAuth, open the printed `/api/auth/dev/home-graphql-oauth-probe` URL, save the JSON response outside the repo, then run:

```bash
.venv/bin/python scripts/check_home_graphql_oauth.py --input /tmp/home-graphql-oauth-probe.json
```

If the result is `PASS`, tell the user that Home/Townsquare 3LO migration may now be executable and include that result in the new plan. If the result is `FAIL` or credentials are unavailable, state that route migration remains blocked and keep Home/Townsquare-backed routes guarded with `route_not_oauth_ready`.

If database-backed auth has already landed, any Home/Townsquare 3LO implementation plan must resolve user tokens through `RequestAuthContext`, DB `auth_connections`, encrypted `auth_tokens`, DB refresh locking, `token_version`, and revoked/disabled-user checks. Do not plan route code that calls local token-store helpers such as `oauth_session_data`, `save_oauth_session`, `oauth_refresh_lock`, or `OAUTH_TOKEN_STORE` after DB auth exists.

Do not paste OAuth callback URLs, bearer tokens, refresh tokens, API tokens, or probe payloads containing token material into plans, chat, commit messages, or PR notes.

## Service-Credential Policy

Server-side Basic/API-token credentials in `.env` are service-account credentials. Plans must not instruct individual users to create personal Atlassian API tokens for shared app auth.

Home/Townsquare-backed and Jira-project-backed EPM/APM surfaces are read-oriented for normal users. Any mutation route for those surfaces must be explicitly admin-guarded or service-account-only in both tests and implementation.

Share-link plans must not assume workspace membership or workspace ACLs unless a membership schema is introduced first; gate by resolved workspace/site plus Jira authorization until then.
