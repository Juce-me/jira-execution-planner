# docs/plans/AGENTS.md

Plan-specific instructions for this repository.

## Plan Naming

Use `EXEC-*` for implementation plans, `DONE-*` for executed plans kept for audit, `GATE-*` for blocked external capability gates that must be rechecked over time, `SUPPORT-*` for review, handoff, setup, or historical-reference workflows, and `FUTURE-*` for deferred scope. Do not create new date-only auth/DB/Home migration docs.

Do not rename an `EXEC-*` plan to `DONE-*` until the implementation has been completed, verified, and accepted or merged. Add a short top note naming the execution commit or PR, for example:

```md
> **Status:** Done. Executed in `<commit-or-PR>`. Kept for audit context only.
```

## Startup Gate Sweep

At the start of any session that touches auth, DB, Home/Townsquare, EPM, or plan execution:

1. List gated docs with `rg --files docs/plans | rg '/GATE-'`.
2. Open each `GATE-*` file.
3. Check whether the external blocker might now be testable.
4. Run the gate command only when the file's required credentials, approved target, and safety constraints are available.
5. Update the gate's `Checked on` and `Last result` fields.
6. Keep `Status` as `Blocked` unless the required command prints the documented `PASS` result.
7. Never paste token material, personal emails, Authorization headers, OAuth callback URLs, bearer tokens, refresh tokens, or raw sensitive probe payloads into the gate doc.

## Home/Townsquare 3LO Gate

Before creating or executing any plan that touches Atlassian Home/Townsquare GraphQL auth, Home-backed EPM/APM routes, or Jira-project-backed EPM/APM route migration:

1. Read `docs/SUPPORT-atlassian-oauth-setup.md`, especially the Home GraphQL OAuth gate and visibility model.
2. Check whether Atlassian Home/Townsquare GraphQL now accepts user 3LO tokens from a real local OAuth session.
3. Start from the canonical Part 2 support reference: `docs/plans/SUPPORT-epm-home-oauth-migration.md`.
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
