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

## Plan Review Prompt

Use this prompt when asked to review an `EXEC-*`, `FUTURE-*`, `SUPPORT-*`, or cross-slice plan. Treat the plan as an implementation contract, not prose.

```text
Review the plan for correctness, execution safety, and verification quality.

Before findings:
- Read the root AGENTS.md, docs/plans/AGENTS.md, docs/plans/README.md, every reviewed plan slice, referenced gate docs, and the existing files or functions the plan says it will touch.
- Trace current implementation paths with rg before accepting a migration claim. Inventory old and new routes, storage, callers, source guards, and compatibility aliases.
- Build an endpoint contract matrix for every planned route: method, auth mode, workspace/site boundary, CSRF and X-Requested-With requirements, request body, success body, error bodies, and required tests.
- Build a state-machine checklist for user-visible flows: dirty state, save, stale save, conflict recovery, reload, rollback, scope switch, remote event, retry, and auth-expired recovery.
- Check data ownership boundaries: workspace_id, user identity, shared group references, generated caches, service credentials, OAuth-only routes, and forbidden Home/Townsquare or Jira write paths.
- Check runtime feasibility for polling, SSE, fan-out, heavy reloads, migrations, cache warming, and initial-load impact.
- Check that verification proves the dangerous claims with concrete tests, source guards, UI assertions, screenshots for UI/sticky changes, and named symbols patched to fail on forbidden credential or mutation paths.

Output:
1. Findings first, ordered by severity: Blocker, P1, P2, Minor.
2. For each finding, cite exact file paths and lines, explain the failure mode, and state the concrete plan change required.
3. Do not say "No blockers" until source-of-truth migration, auth/workspace boundaries, dirty/concurrent edit behavior, and verification gates have all been checked.
4. Call out cross-slice terminology drift, missing request/response JSON shapes, and tests that assert only happy paths.
5. End with residual risks only after findings; do not bury blockers in residual risk.
```

Minimum review coverage:
- Source-of-truth migrations: every old caller is removed, delegated, or intentionally preserved with concurrency semantics.
- Auth and CSRF: unsafe routes name both token-bound CSRF and `X-Requested-With` behavior where OAuth mode requires them.
- Workspace and ownership: every id-based route proves the object belongs to the current workspace/site boundary.
- Credential policy: Jira/Home/Townsquare/API-token/service-credential guardrails are enforced by negative tests against concrete symbols, not prose.
- Concurrency: base revision, conflict response shapes, dirty local edits, rollback/reload behavior, and multi-user events are all specified.
- Verification: tests cover no-request-context paths, multi-workspace isolation, source guards, UI behavior, visual proof for layout changes, and gate-doc checks when relevant.

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
