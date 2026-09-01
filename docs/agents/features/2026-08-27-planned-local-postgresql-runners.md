# Local PostgreSQL Runners

Status: planned
Type: feature

## Current Accuracy

The runner implementation is present on `feature/local-postgresql-runners`, but execution is not closed. Daemon-free verification passes with 39 focused tests, Bash 3.2 syntax checks, and Docker Compose configuration validation. Docker Engine 29.7.2 and Compose v5.4.0 passed the live lifecycle, loopback bind, persistence restart, signal 130/143, concurrent-runner, remote-endpoint, port-collision, exact-cleanup, retained-volume, and production-image isolation checks. The verified image is `sha256:40d1e329fbc67fd3d8790ca7eadd0f6d9a56222bb28404b6e8452aa61e911a0a`, with no `/app/runners`; the disposable release layout also contains no `runners/` path. Ordinary local startup still requires the documented token-encryption configuration, which is absent from the current local `.env`; verification used an unprinted process-only key and did not edit local configuration.

The real GitHub-hosted PostgreSQL job remains unproved because no implementation commit, push, or PR exists. The configured-runtime full suite currently runs 1,323 tests with nine failures in pre-existing EPM configuration behavior, zero errors, and seven skips. Keep this artifact planned and the implementation plan active until those gates pass; do not rename it to executed yet.

## Goal

Provide an explicitly localhost-only development runner that keeps PostgreSQL in Docker only while the source-checkout Flask application is running. Preserve database data between runs, apply Alembic migrations automatically, and add an isolated GitHub Actions runner for PostgreSQL-only tests.

## Isolation Boundary

All runner implementation belongs under `runners/`:

- `runners/local/compose.yaml`
- `runners/local/run.sh`
- `runners/local/README.md`
- `runners/github/run-postgresql-tests.sh`

GitHub requires workflow entry points under `.github/workflows/`, so `.github/workflows/verify-postgresql.yml` is the only runner-related file outside `runners/`, tests, and documentation. It delegates test execution to `runners/github/run-postgresql-tests.sh`.

The change must not modify or be copied into application or deployment paths:

- No application source changes under `backend/`, `frontend/`, `planning/`, or `jira_server.py`.
- No changes to `Dockerfile` or `scripts/docker-entrypoint.sh`.
- No runner files copied into the production image or release archive.
- No changes to production database connection modes or migration ownership.
- No changes to the existing `make run` behavior.

## Local Architecture

`runners/local/compose.yaml` defines one PostgreSQL service with:

- The multi-architecture `postgres:16-alpine` image pinned to reviewed manifest digest `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685` (PostgreSQL 16.15 on Alpine 3.24 when reviewed on 2026-08-27).
- The development-only `jep_local` database and `jep`/`jep` user/password matching the runner's local `DATABASE_URL`.
- Port exposure fixed to `127.0.0.1:5432:5432`.
- A `pg_isready` health check.
- A `jira-planning-local-postgres` named volume that survives `docker compose down`.
- The `jira-planning-local` Compose project name so its resources cannot collide with unrelated Compose projects.

`runners/local/run.sh` is the single local entry point. It resolves the repository root from its own location, checks for Docker Compose and the repository virtual environment, and installs a cleanup trap before starting any container. It then:

1. Resolves the effective Docker endpoint, pins every later command to that local Unix socket, then rejects arguments, unsupported Compose versions, concurrent ownership, every pre-existing project/legacy container or project network, an exact default network, retained-volume users, and foreign volume labels before creating anything.
2. Uses absolute Compose paths plus fixed command-line project/project-directory values and disables ambient Compose `.env` parsing.
3. Starts the isolated PostgreSQL service with Docker Compose's detached, health-gated `--wait` mode and a 60-second timeout.
4. Reports the Compose service status and at most 100 PostgreSQL log lines if the health check does not pass.
5. Exports `DATABASE_URL=postgresql+psycopg://jep:jep@127.0.0.1:5432/jep_local`, `DATABASE_CONNECTION_MODE=url`, `CONFIG_STORAGE_BACKEND=db`, `APP_ENVIRONMENT_KEY=local`, `APP_BIND_HOST=127.0.0.1`, `ALLOW_NETWORK_BIND=false`, `ALLOW_BASIC_AUTH_ON_NETWORK=false`, and `DEBUG_MODE=false` for the child processes.
6. Runs Alembic migrations to `head`.
7. Runs the existing startup preflight.
8. Starts `.venv/bin/python jira_server.py` as the supervised foreground child.

On `INT`, `TERM`, normal exit, migration failure, preflight failure, or Flask failure, one `EXIT` cleanup trap runs an exact-project `docker compose down` only when this process acquired the fixed machine-wide lock and established resource ownership. Every supervised child runs in its own process group; signal handlers send bounded `TERM` then `KILL` escalation to that group, reap it, return 130/143, ignore repeated signals while teardown completes, and let the single exit trap clean up once. Cleanup preserves an original nonzero status; when the original status is zero, a failed cleanup becomes the returned failure status. Cleanup never passes `--remove-orphans`, `--volumes`, or another broad removal option, so foreign resources are untouched and database state survives shutdown.

The runner does not accept a database-host override and does not support exposing PostgreSQL or Flask on a network interface. Developers needing hosted or production-like deployment behavior must use the existing deployment path instead.

## GitHub Architecture

`.github/workflows/verify-postgresql.yml` defines a dedicated GitHub-hosted Ubuntu job with Python 3.11 and the same digest-pinned PostgreSQL service image as the local runner. The service creates the synthetic `jep_ci` database with the `jep`/`jep` user/password, binds only `127.0.0.1:5432`, uses bounded `pg_isready` health checks, and is inspected through `job.services.postgres.id` before tests to prove that exact published binding at runtime. The workflow uses only `pull_request`, `push` to `main`, and manual dispatch events; read-only contents permission; per-ref cancellation; a 15-minute timeout; checkout without persisted credentials; reviewed commit-SHA action pins; no secrets, environment, artifacts, deployment, release, or self-hosted runner. It installs the pinned backend requirements, exports `DATABASE_URL` and `TEST_DATABASE_URL` as the exact same synthetic URL, and delegates migration and test execution to `runners/github/run-postgresql-tests.sh`.

The GitHub runner verifies the PostgreSQL behaviors that SQLite cannot prove:

- Database migrations reach the current head.
- OAuth token refresh serialization uses real PostgreSQL locking.
- User-view advisory locks, row locks, and concurrency behavior pass with `REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1`.

The delegated script runs Alembic to `head`, then runs:

```text
python -m unittest tests.test_db_migrations tests.test_token_refresh_race tests.test_user_view_config_concurrency
```

It requires `GITHUB_ACTIONS=true`, sets `REQUIRE_POSTGRES_USER_VIEW_CONCURRENCY=1`, and fails before Alembic unless both database variables exactly equal the fixed synthetic CI URL. Broad loopback parsing is forbidden because libpq query options can redirect a superficially local URL.

The runner uses only synthetic CI credentials and database names. It does not deploy, publish images, contact Jira, or depend on repository secrets.

## Failure Behavior

- Missing Docker, Docker Compose, `.venv`, or an available Docker daemon fails before Flask starts with an actionable message.
- A non-Unix Docker endpoint, foreign runner resource, concurrent runner lock, or unsupported Compose `--wait-timeout` capability fails before resource ownership is armed.
- An occupied PostgreSQL port or unhealthy database fails within a bounded wait and triggers cleanup.
- A failed migration or startup preflight prevents Flask startup and triggers cleanup.
- `Ctrl+C` reaches Flask and the cleanup trap, leaving no runner PostgreSQL container or network running.
- Cleanup failure is reported without hiding an original nonzero startup or application exit status; cleanup failure becomes the result when the original result was successful.
- GitHub service-health, migration, and test failures fail the workflow job directly.

## Files Allowed To Change

- Create `runners/local/compose.yaml`.
- Create `runners/local/run.sh`.
- Create `runners/local/README.md`.
- Create `runners/github/run-postgresql-tests.sh`.
- Create `.github/workflows/verify-postgresql.yml`.
- Create or update runner-focused tests under `tests/`.
- Update `README.md` and `INSTALL.md` only to point source-checkout developers to the optional localhost runner and preserve the existing production guidance.
- Update this artifact's status and outcome after execution.
- Update `AGENTS.md` only for the durable runner-isolation rule created from the user's correction.

## Forbidden Regressions

- Do not alter the application startup entry point, production container entry point, release archive contents, or Cloud SQL behavior.
- Do not expose local PostgreSQL beyond loopback.
- Do not delete the persistent volume on ordinary shutdown.
- Do not source `.env` as shell code or print its contents.
- Do not log database passwords, OAuth material, Jira credentials, or token-encryption values.
- Do not make the standard test suite require Docker or PostgreSQL; only the dedicated runner and workflow require them.
- Do not make the release workflow depend on `runners/`.
- Do not call `backend.db.reset_local`, accept runner arguments, source `.env` as shell, honor ambient Compose project/file overrides, use a remote Docker context, or clean up resources the process did not establish ownership over.

## Verification

Automated checks:

- Runner-focused unit/source-guard tests prove the isolation paths, loopback bind, named-volume preservation, migration-before-preflight-before-Flask order, cleanup trap, and absence of deployment commands.
- Daemon-free black-box tests with stub Docker/Python commands prove hostile inherited network/Compose values are overridden, stage failures retain their original exit codes, signals remove child process trees and exit 130/143, repeated signals cannot interrupt cleanup, the fixed lock is released, and foreign/pre-existing resources are untouched.
- `bash -n runners/local/run.sh runners/github/run-postgresql-tests.sh` passes.
- `docker compose -f runners/local/compose.yaml config` passes without starting services.
- The focused Python runner tests pass.
- The PostgreSQL GitHub runner command passes against a real PostgreSQL database, including the saved-view concurrency gate.
- The full Python suite passes before any push.

Manual localhost check when the Docker daemon is available:

1. Start `runners/local/run.sh` with safe local configuration.
2. Confirm PostgreSQL becomes healthy and migrations reach `head` before Flask starts.
3. Confirm the Flask health endpoint responds.
4. Press `Ctrl+C`.
5. Confirm the runner container and network are gone.
6. Confirm the named volume remains and data survives the next start.

## Acceptance Criteria

- One localhost-only command starts PostgreSQL, migrates, preflights, and runs Flask.
- `Ctrl+C` stops and removes runner containers and the runner network.
- PostgreSQL data persists across ordinary runner restarts.
- No application or deployment implementation file changes.
- The production image and release archive do not contain runner files.
- GitHub Actions runs the real PostgreSQL locking and concurrency coverage without secrets or deployment behavior.
- Existing local, production, and release startup commands retain their current behavior.
- Analytics impact: no event is added because this is developer/CI tooling with no user-visible application interaction.

## Accepted Residual Risks

- Docker CLI/daemon access is host-administrator access; this runner is not a sandbox for an untrusted checkout.
- The known development database password and dedicated-cluster superuser do not isolate other processes on the same workstation.
- The persistent volume can retain encrypted tokens, configuration, and Jira-derived data; host disk encryption and workstation access control remain necessary.
- `SIGKILL`, power loss, Docker daemon failure, Docker prune, or Docker Desktop reset can bypass cleanup or remove retained data. A later run fails closed on ambiguous stale resources.
- The app still uses the Jira site configured in the developer's `.env`; localhost-only describes network binding and runner infrastructure, not offline Jira behavior.
- Named-volume disk growth cannot be portably capped by Compose. The runner bounds CPU, memory, PIDs, log rotation, health waits, and CI job duration, but developers still monitor Docker disk use.
- Digest/action pins require explicit reviewed updates when security or maintenance releases are adopted.
- Runner files remain in the Docker build context but are not copied by the allowlisted Dockerfile or release workflow; source guards prevent current packaging contamination without changing deployment files.
