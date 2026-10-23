# Install And Run

This app has two local run modes:

- JSON-file mode: starts with `python3 jira_server.py` after `.env` is configured.
- DB mode: required for OAuth-backed users, encrypted OAuth tokens, service integrations, and the Home token connection flow.

`python3 jira_server.py` does not start PostgreSQL, create the database, or run migrations.

## 1. Python Environment

Use Python 3.10+ linked against OpenSSL 1.1.1+. macOS system Python builds linked against LibreSSL are not supported because the security-patched HTTP dependency stack requires Python 3.10+ and OpenSSL.

From the repo root:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install -e .
```

## 2. PostgreSQL

Choose exactly one PostgreSQL setup: native PostgreSQL or the optional localhost Docker runner. Do not run both for the same local app instance.

### macOS With Homebrew

```bash
brew install postgresql
brew services start postgresql
createdb jep_local
```

If `createdb` is not on your `PATH`, run:

```bash
export PATH="$(brew --prefix postgresql)/bin:$PATH"
createdb jep_local
```

### Linux With apt

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres createuser --createdb "$USER"
createdb jep_local
```

If your local PostgreSQL is configured with a named app user instead, create it and own the DB:

```bash
createuser jep --createdb --pwprompt
createdb -O jep jep_local
```

Use this URL for the named-user form:

```env
DATABASE_URL=postgresql+psycopg://jep:<password>@localhost:5432/jep_local
```

### Optional localhost Docker runner (source checkout only)

Source-checkout developers may keep Flask in the local `.venv` while running only PostgreSQL in Docker. Before starting the runner, complete section 3 to configure `.env`. Then run:

```bash
./runners/local/run.sh
```

This localhost-only runner replaces the manual migration, startup preflight, and Flask launch steps in sections 4 and 5: it starts PostgreSQL, waits for health, applies Alembic migrations, runs startup preflight, and then runs Flask. `Ctrl+C` removes its container and network while preserving the named database volume. It is separate from the production image, release archive, and hosted deployment path; see [the local runner guide](https://github.com/Juce-me/jira-execution-planner/blob/main/runners/local/README.md) for prerequisites and safety boundaries.

## 3. `.env` For DB Mode

Copy the template if needed:

```bash
cp .env.example .env
```

Generate a local token-encryption key:

```bash
python3 -c "import base64,secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

Set these values in `.env`:

```env
APP_ENVIRONMENT_KEY=local
CONFIG_STORAGE_BACKEND=db
DATABASE_URL=postgresql+psycopg:///jep_local
TOKEN_ENCRYPTION_MASTER_KEY_B64=<generated value>
TOKEN_ENCRYPTION_KEY_ID=local-key
```

For OAuth login, also set the Atlassian OAuth block:

```env
JIRA_AUTH_MODE=atlassian_oauth
ATLASSIAN_CLIENT_ID=<from Atlassian Developer Console>
ATLASSIAN_CLIENT_SECRET=<from Atlassian Developer Console>
ATLASSIAN_REDIRECT_URI=http://localhost:5050/api/auth/atlassian/callback
ATLASSIAN_SCOPES=read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access
FLASK_SECRET_KEY=<random secret>
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true
```

Generate a local Flask secret if needed:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 4. Run DB Migrations

`jira_server.py` loads `.env`, but Alembic does not. Export the DB URL for command-line migration runs:

```bash
export DATABASE_URL=postgresql+psycopg:///jep_local
.venv/bin/alembic -c backend/db/alembic.ini upgrade head
```

If you used a named PostgreSQL user, export that URL instead:

```bash
export DATABASE_URL=postgresql+psycopg://jep:<password>@localhost:5432/jep_local
```

Quick DB verification for source checkouts:

```bash
.venv/bin/python -m unittest tests.test_db_session tests.test_db_migrations
```

Prebuilt release zips omit the test suite; skip this check there and use the source checkout when you need to run tests.

The release zip is the runnable package for normal installs. Editable installs assume the source checkout or extracted release directory is still present because Flask serves `jira-dashboard.html` and `frontend/dist` from sibling files. Do not treat `pip install .` by itself as a self-contained wheel distribution.

## 5. Start The App

Check startup prerequisites before launching Flask:

```bash
.venv/bin/python scripts/check_startup_preflight.py
```

The equivalent Make target is:

```bash
make preflight
```

```bash
.venv/bin/python jira_server.py
```

After `./scripts/install.sh` or `python -m pip install -e .`, the equivalent console command is:

```bash
.venv/bin/jira-execution-planner
```

By default the Flask server binds to `127.0.0.1`. Set `APP_BIND_HOST=0.0.0.0` only when intentionally exposing the app, and also set `ALLOW_NETWORK_BIND=true`. Basic auth network exposure additionally requires `ALLOW_BASIC_AUTH_ON_NETWORK=true` and remains local-profile only with `APP_ENVIRONMENT_KEY=local`.

Developer diagnostics such as field probes require `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true` and loopback access. They return `404` when disabled.

Open:

```text
http://localhost:5050/login
```

Sign in again after switching to DB mode. The OAuth callback creates the DB user, workspace, auth connection, and encrypted token rows.

## 6. Home Token Connection Flow

The Home token connection stores a user-owned Atlassian API token in encrypted DB storage as provider `atlassian_user_api_token`. It requires:

- `CONFIG_STORAGE_BACKEND=db`
- `DATABASE_URL`
- applied Alembic migrations
- `TOKEN_ENCRYPTION_MASTER_KEY_B64` and `TOKEN_ENCRYPTION_KEY_ID`
- an OAuth login after DB mode is enabled

After sign-in, open `Settings -> Connections` and connect the current user's Home/Townsquare token. DB/OAuth EPM stays hidden until this connection is active. Jira REST reads continue to use the OAuth session; Home/Townsquare metadata reads use the connected token from `auth_tokens`.

If any of those are missing, `/api/me/connections/home-token` returns:

```json
{"error":"credential_storage_unavailable"}
```

## 7. Storage Boundaries

DB/OAuth EPM separates three storage concerns:

- User Home token connection: encrypted `auth_tokens`, provider `atlassian_user_api_token`, created from `Settings -> Connections`.
- Operator/service integrations: encrypted `service_integration_tokens`, reserved for workflows that explicitly need shared operator credentials.
- EPM saved view state: non-secret user view config only, such as root goal scope, selected sub-goals, label prefix, project label mappings, selected EPM tab, and selected sprint.

Do not seed a Home/Townsquare service integration for the DB/OAuth EPM read path. The EPM tab appears only after the signed-in user connects their own Home token.

## 8. Internal Hosting Pre-SRE Checklist

The repository provides container packaging for verification and image build. It deliberately does not ship production registry push, Helm values, Kubernetes manifests, or deployment jobs.

Can prepare now:
- Build the image with `docker build` and a commit-SHA tag, using the committed `Dockerfile`.
- Run backend/frontend verification in CI: Python dependencies, editable install, `python -m unittest discover -s tests`, `npm ci`, `npm run build`, frontend unit tests, and the committed `frontend/dist` check.
- Keep hosted env values owned by the runtime platform: app secrets, Atlassian OAuth settings, token encryption, DB URL, allowed origins, and optional GA4 values.

Container env contract:

```env
APP_ENVIRONMENT_KEY=production
PORT=5050
APP_BIND_HOST=0.0.0.0
ALLOW_NETWORK_BIND=true
JIRA_URL=https://your-company.atlassian.net
JIRA_AUTH_MODE=atlassian_oauth
CONFIG_STORAGE_BACKEND=db
DATABASE_CONNECTION_MODE=cloud_sql_iam
DATABASE_URL=postgresql+psycopg://<percent-encoded-iam-database-user>@<private-host>:5432/<database>?sslmode=verify-full&sslrootcert=<percent-encoded-mounted-ca-path>
ATLASSIAN_CLIENT_ID=<from-secret>
ATLASSIAN_CLIENT_SECRET=<from-secret>
ATLASSIAN_REDIRECT_URI=<https-origin>/api/auth/atlassian/callback
SESSION_COOKIE_SECURE=true
APP_ALLOWED_ORIGINS=<https-origin>
FLASK_SECRET_KEY=<from-secret>
TOKEN_ENCRYPTION_KEY_SOURCE=env
TOKEN_ENCRYPTION_MASTER_KEY_B64=<from-secret>
TOKEN_ENCRYPTION_KEY_ID=<key-id>
OAUTH_LOCAL_TOKEN_STORE_ALLOWED=false
LOCAL_FILE_STATE_ENABLED=false
SCENARIO_DRAFT_LEGACY_IMPORT_ENABLED=false
RUN_DB_MIGRATIONS=false
GA4_ENABLED=false
```

### Cloud SQL IAM prerequisites

Before enabling this mode, SRE must enable the Cloud SQL PostgreSQL
`cloudsql.iam_authentication` database flag, add the workload's ADC principal as
a Cloud SQL IAM database user, and grant `roles/cloudsql.instanceUser`, which
supplies `cloudsql.instances.login`. The database username must match the ADC
identity mapping, and the IAM database user must receive the required
PostgreSQL database, schema, and table privileges.

This is a direct synchronous psycopg TCP/TLS connection to the SRE-provided
private IP or private DNS endpoint. The app does not use the Cloud SQL Python Connector, pg8000, asyncpg, a Cloud SQL Auth Proxy sidecar/binary, or another proxy process.

The IAM-mode DATABASE_URL must not contain a password. The application obtains
a short-lived login token from Application Default Credentials using only
https://www.googleapis.com/auth/sqlservice.login and passes it to psycopg only
when a new physical connection is opened. There is no password-auth fallback.
Every IAM psycopg connection uses a fixed 10-second connection timeout;
operators cannot override it with a `connect_timeout` DATABASE_URL query
parameter.

SRE supplies the exact percent-encoded IAM database username, host, explicit
port, database name, and TLS settings. sslmode must be require, verify-ca, or
verify-full; verify-ca and verify-full require sslrootcert. sslcert and sslkey
must be provided together when client certificates are required.

Online Alembic uses the same IAM path with NullPool. Offline Alembic SQL
generation does not need Google credentials. Normal web processes retain
SQLAlchemy pooling.

Local development and CI omit cloud_sql_iam mode and keep their existing
DATABASE_URL/TEST_DATABASE_URL behavior.

No live Cloud SQL verification is claimed by the unit test suite. A live claim
requires a separately approved instance, identity, private network path, and TLS
configuration.

`PORT=5050` is the container/Gunicorn listener port used by `scripts/docker-entrypoint.sh`; source-checkout Flask runs still use `SERVER_PORT` unless a command-line port is supplied. The Docker image defaults to `APP_BIND_HOST=0.0.0.0` and `ALLOW_NETWORK_BIND=true` so GCP service networking can reach Gunicorn; startup preflight still fails closed unless hosted OAuth sits behind HTTPS ingress, sets `SESSION_COOKIE_SECURE=true`, uses a real `FLASK_SECRET_KEY`, and provides `APP_ALLOWED_ORIGINS` for the exact HTTPS origin.

Use `RUN_DB_MIGRATIONS=true` only when a single app container is the agreed migration owner for an internal deployment. For multi-replica deployments, run Alembic in a separate release job or init step, then start web containers with `RUN_DB_MIGRATIONS=false`.

**Automatic adoption on upgrade (revision `20261023_0020`).** Upgrading to the new head adopts legacy review data by itself, once, so saved Planning review columns are available as soon as the new version serves: no operator step and no chart change. For every workspace with legacy review content and at least one configured Department group, it adopts the legacy columns, values and Sprint views into each group that holds no review row when its schema row is locked. A group that already holds review rows (a user saved after an earlier release, or an earlier manual adoption) is left alone and logged; restore it with `--merge` below. Legacy tables are never written. The step runs inside the upgrade's transaction, takes the same group schema-row lock every app save takes plus a share lock on the legacy tables until the transaction commits, and stops at a whole-run budget of 100,000 inserted rows (a workspace that does not fit is skipped whole and logged). Failure policy: any database error (lock timeout, deadlock, connection loss, missing tables, permission) fails the upgrade with only its SQLSTATE in the output, so nothing is stamped or written and a rerun is clean; a workspace the planner cannot plan (malformed legacy data, no configured group, over budget) is skipped with its id and reason in the log and left for the script. A workspace skipped for having no configured group is stamped with the revision and never retried, so configure its Department group first. The log goes to stderr at WARNING level (`backend/db/alembic.ini` drops INFO): one line per workspace and a summary. Job logs may not persist, so `--list` is the durable record. `REVIEW_ADOPTION_ON_UPGRADE` is read from the process environment only (Alembic does not load `.env`): unset or `true` runs, `false` skips adoption and logs how many workspaces hold legacy data, and any other value fails the upgrade; with it off, adopt by hand with the steps below. `downgrade 20261020_0019` is a no-op, and a later `upgrade head` adopts nothing new for groups that now hold rows; a downgrade below `20261020_0019` drops the group tables and the next upgrade adopts again from the untouched legacy tables. When upgrading from `20261001_0018` or earlier, keep the quiesce rule below for legacy writers: a legacy row an old pod writes after the revision commits is never adopted (check `--list` after the rollout). With `RUN_DB_MIGRATIONS=true` the adoption time counts against start probes, and two replicas migrating at once can make one of them fail once (rerun it). Open browser drafts receive a `schemaConflict` after an adoption.

**Review adoption cutover (#267).** Planning Sprint review columns are now shared per Department group instead of per workspace/Sprint. Migration `20261020_0019` creates empty group tables and does not move data; revision `20261023_0020` (above) adopts automatically, so the steps below are the manual path: environments that turned adoption off, workspaces it skipped, and any `--list` status other than `adopted` or `nothing to adopt`. Run the manual cutover with application writers quiesced, as for migration `20260827_0008`. The image's entrypoint ends in a fixed `exec gunicorn` and ignores arguments, so every one-off job below needs an entrypoint override (a command-only override still starts gunicorn), the same database URL and connection-mode variables the migration job uses, and a database identity with `UPDATE`, `DELETE` and `TRUNCATE` on `workspace_sprint_reviews` and `sprint_review_cells` (the script takes `LOCK ... IN SHARE MODE` on them) and `INSERT` on the new group review tables, plus `UPDATE`, `DELETE` or `TRUNCATE` on those too for the `EXCLUSIVE` table locks the fresh `--apply` takes. Use placeholders for `<id>` and `<digest>`; the script prints counts and column, Sprint and group ids only.

1. Before the cutover, while the old app still serves: every workspace that holds legacy review rows must have a configured Department group. The script refuses a workspace with legacy rows and no group, and the quiesced app cannot create one. The automatic adoption skips such a workspace (logged) and does not retry it.
2. Back up the database.
3. Record the current `RUN_DB_MIGRATIONS` value and set it to `false`.
4. Stop every replica, so nothing serves.
5. Run Alembic as a one-off job from the new image: `python -m alembic -c backend/db/alembic.ini upgrade head`.
6. Run `python scripts/adopt_legacy_sprint_reviews.py --list` to see, per workspace, whether legacy rows and group rows exist.
7. For every workspace with legacy rows that `--list` still reports `pending`, run the dry run `python scripts/adopt_legacy_sprint_reviews.py --workspace-id <id>`, review the report, then run `python scripts/adopt_legacy_sprint_reviews.py --workspace-id <id> --apply --expected-sha256 <digest>` with the digest the dry run printed. `--apply` recomputes under table locks, refuses when group review rows already exist for the workspace (use `--merge`, below, then), and writes every group in one transaction; legacy rows are never modified. Exit code 0 is success, 2 is a lock timeout with nothing written, and 1 is any other refusal or failure with nothing written.
8. Run `--list` again and confirm every workspace with legacy rows now shows group rows before the app starts.
9. Restore the recorded `RUN_DB_MIGRATIONS` value and start the new app. Open browser tabs must reload; the old bundle sends no `groupId` and gets a 400.

Rollback depends on how far the cutover got:

| Failure point | State | Recovery |
| --- | --- | --- |
| Backup or Alembic upgrade | Nothing serves | Fix and re-run, or restore the backup |
| Adoption step of the upgrade (a database error) | The upgrade's transaction rolls back: nothing stamped, nothing written, legacy rows untouched | Fix the cause (retry a lock timeout; a missing table is head-stamp drift) and rerun `upgrade head` |
| Dry run | Nothing written | Fix the input |
| `--apply` | The single transaction rolls back; legacy rows untouched | Re-run |
| Abort the release after the upgrade | The old image fails its startup preflight against the new head and cannot downgrade a revision it does not know | Run `python -m alembic -c backend/db/alembic.ini downgrade 20261001_0018` from the new image first, then restart the old image |
| After `--apply`, before the new app serves | Only adopted data exists | Clean redo from the new image: `downgrade 20261001_0018`, then `upgrade head`, which adopts again by itself; re-run the script only for a workspace it skipped |
| After the new app served and users wrote | `--apply` refuses because group rows exist | Restore with `--merge` (below); a downgrade loses the entries made since |
| After `--merge --apply` | Legacy data was added to the groups; nothing a user did was overwritten | Restore the pre-run backup (a point-in-time restore loses later writes), or keep the merge, which only adds rows |

Environments that auto-migrate with `RUN_DB_MIGRATIONS=true`, including local runners, now adopt on upgrade (see above); run the manual steps only for workspaces `--list` still reports `pending` or `needs-merge`, with `--merge` below once any group row exists.

**Restoring hidden review columns while the app serves (`--merge`, #299).** When the migration ran without adoption, or users saved something before it ran, `--apply` refuses because group rows exist. `--merge` adopts the legacy columns, values and Sprint views into groups that already hold rows. It never overwrites, clears, renames or resurrects anything in a group: a legacy column claims a group column by id first (so a column adopted earlier and renamed since is recognized), then by kind, label and type; a live cell or Sprint view wins over the legacy one; a column the group archived stays archived. On PostgreSQL it needs no quiesced window (SQLite has no row locks and is for tests only): the apply locks only the groups it writes, through the same schema-row lock every app save takes first, in sorted group order, and exits 2 with nothing written if a lock is not granted within 5 seconds. Its database identity needs `SELECT`, `INSERT` and `UPDATE` on `workspace_group_review_schemas` (`FOR UPDATE` and the column update need `UPDATE`), `SELECT` and `INSERT` on `group_review_cells` and `group_sprint_review_views`, `SELECT` on `workspaces`, `workspace_group_configs` and the two legacy tables, and, for the share lock, `UPDATE`, `DELETE` or `TRUNCATE` on the two legacy tables.

1. Back up the database.
2. Run `python scripts/adopt_legacy_sprint_reviews.py --list`. `needs-merge` means a merge would still insert something, `pending` means no group rows exist yet (the cutover steps above apply, and `--merge` works there too), `adopted` means nothing is left to insert, and `error` means the workspace cannot be planned (run the dry run for the reason).
3. Run the dry run `python scripts/adopt_legacy_sprint_reviews.py --workspace-id <id> --merge`, with `--group <group id>` (repeatable) to restore only some groups; without it every configured group is targeted, including groups created after the release. The report is per group: matches by id (`matched <legacy id> -> <group id>`), added columns, cells and views inserted or skipped, the Sprint-id interval each inserted view now governs (a later Sprint with no view of its own inherits the nearest earlier one), the remaining view slots and the schema revision change. To read the label behind a matched id, run a read-only query such as `SELECT elem->>'label' FROM workspace_group_review_schemas, jsonb_array_elements(columns::jsonb) AS elem WHERE workspace_id = '<id>' AND group_id = '<group id>' AND elem->>'id' = '<column id>';`.
4. Run `python scripts/adopt_legacy_sprint_reviews.py --workspace-id <id> --merge --apply --expected-sha256 <digest>` with the same `--group` flags. It re-reads and re-plans under the locks and writes only if the digest still matches; if a user saved a column or changed a decision in the meantime it exits 1 with nothing written, and you re-run the dry run. A plan with nothing to insert prints "nothing to merge" and exits 0. A plan that would insert more than 100,000 rows in total aborts before any lock (merge groups separately with `--group` to stay under it). Measured on a synthetic single-group plan at that ceiling (99,600 cells, local PostgreSQL 16): the dry run took about 2 seconds and 310 MiB, and the apply about 15 seconds and 360 MiB at its peak, holding the group's schema row lock for most of that time (app saves to that group wait meanwhile); a pod that also runs the app needs that headroom, so a separate one-off job is the safer place for a large merge.
5. Run `--list` again and reload the dashboard.

A second `--merge` is a no-op, with three exceptions: a column that was matched by label (not by id) and then renamed in the group is added again as a new column (archiving it does not, an archived column stays archived); a column the group archives frees an active slot that a previously cap-excluded legacy column can fill; and a Sprint view row an operator purged to free the 500-view cap is inserted again. Open clients keep their drafts and get a `schemaConflict`, `viewConflict` or `cellConflicts` on their next save. A merge only adds rows; to undo one, restore the pre-run backup (a point-in-time restore loses the writes made since), or keep it and archive an unwanted column in the UI.

Junk Sprint views: each group is capped at 500 Sprint views and the app has no delete action. An operator can purge rows by hand, after a backup and a review of the exact rows. In a one-off database session, first run `SELECT id, sprint_id, view_revision FROM group_sprint_review_views WHERE workspace_id = '<id>' AND group_id = '<group id>' AND sprint_id IN ('<sprint id>');`, check the result, then run the same `WHERE` clause with `DELETE FROM group_sprint_review_views` inside a transaction and commit only if the deleted count matches. Deleting a view makes that Sprint inherit again from earlier Sprints; it removes no cells or columns. Run it with application writers stopped or idle.

OAuth2 Proxy may protect the ingress perimeter, but it does not replace app-level Atlassian OAuth. The app still needs Atlassian OAuth 2.0 (3LO) for Jira REST reads and the per-user Home token connection for Home/Townsquare EPM metadata.

Needs SRE ownership or confirmation:
- CI project location, registry/image path, runner build method, default branch/tag policy, and the exact point when image push may be enabled.
- Internal hostname, TLS/proxy termination, OAuth2 Proxy policy, Atlassian redirect/callback URL registration, secure cookie settings, and `APP_ALLOWED_ORIGINS`.
- PostgreSQL provisioning, migration execution owner, durable persistence, log retention, backup/restore ownership, resource limits, and readiness/liveness probe policy.

Blocked until deployment reference:
- Production registry credentials/path, secret references, migration release strategy, Helm or Kubernetes values, namespace/routing/VPN/proxy details, TLS secret names, and real release jobs.

## 9. Common Failures

`DATABASE_URL is required when CONFIG_STORAGE_BACKEND=db`

Set `DATABASE_URL`, export it before CLI migration/seeding commands, run migrations, then restart Flask.

`FAIL migrations: Database is unavailable or migrations are not at head.`

Start PostgreSQL, check `DATABASE_URL`, then run:

```bash
.venv/bin/alembic -c backend/db/alembic.ini upgrade head
```

`TOKEN_ENCRYPTION_MASTER_KEY_B64 or TOKEN_ENCRYPTION_KEY_ID is required`

Generate a 32-byte base64 key and set both `TOKEN_ENCRYPTION_MASTER_KEY_B64` and `TOKEN_ENCRYPTION_KEY_ID`.

`auth_required` after enabling DB mode

Sign in again through `/login`; the DB rows are created during the OAuth callback.

`command not found: alembic`

Use the virtualenv binary:

```bash
.venv/bin/alembic -c backend/db/alembic.ini upgrade head
```
