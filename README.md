# Jira Delivery Planner

Simple local dashboard to display Jira sprint tasks sorted by priority with Python Flask backend.

## 🚀 Features

- ✅ **Dynamic Sprint Selection** - Choose any sprint from dropdown (2025Q1, 2025Q2, etc.)
- ✅ **Smart Sprint Detection** - Auto-selects current quarter on load
- ✅ **Intelligent Caching** - Sprint list cached for 24 hours, task data for 5 minutes; manual refresh bypasses all caches
- ✅ **Sort by Priority** - Tasks sorted Highest → Lowest
- ✅ **Status filters** - Toggle Done/Killed and use stat cards (In Progress, To Do/Pending/Accepted, High Priority)
- ✅ **Project Filtering** - Separate Tech and Product tasks
- ✅ **Clean, Minimalist UI** - Beautiful typography with smooth animations
- ✅ **Auto-refresh** - Reload button for tasks and sprints
- ✅ **Per-Epic refresh** - Hover an Epic header in Catch Up or Planning to refresh just that Epic's Stories, header and alerts from Jira; changed cards glint and nothing else reloads
- ✅ **Secure Credentials** - Local secrets stay outside git; DB/OAuth user tokens are encrypted in database storage
- ✅ **Team-aware filtering** - Multi-team JQL plus UI dropdown to slice per team and see team name on each story
- ✅ **Team groups** - Define workspace-shared department groups (1-12 teams), choose a shared default, and let each user choose which groups appear in dashboard controls
- ✅ **Epic grouping** - Stories grouped under their epic with assignee and story-point totals
- ✅ **Dependency focus** - Click Depends On/Dependents to highlight related tasks and show missing deps inline
- ✅ **Planning rollups** - Selected story points summarized per team, project, and overall
- ✅ **Capacity planning** - Team capacity vs planning capacity (exclusions via epic toggle)
- ✅ **Scoped planning persistence** - Planning selections persist locally per sprint and team group, then reconcile on refresh
- ✅ **Scoped team persistence** - Team dropdown selection persists locally per sprint and team group, then falls back to All Teams if unavailable
- ✅ **Planning bulk actions** - Quickly include Accepted, To Do, Postponed, and Awaiting Validation stories
- ✅ **Planning spreadsheet** - Compact Epic/Story table with shared Department group custom review drafts; see [Planning Sprint review](docs/features/planning-sprint-review.md)
- ✅ **Compact sticky controls** - Sticky Sprint/Group/Teams controls keep the same dropdown behavior while using a smaller compact layout
- ✅ **Scenario planner** - [Feature guide](docs/features/scenario-planner.md)
- ✅ **Alerts** - [Feature guide](docs/features/alerts.md)
- ✅ **Shareable view links** - Share the current Catch Up, Planning, Board or Statistics view as one link; the recipient signs in and lands in the same view with their own access ([Feature guide](docs/features/shareable-view-links.md))
- ✅ **Sprint statistics** - [Feature guide](docs/features/statistics.md)
- ✅ **EPM view** - [Feature guide](docs/features/epm-view.md)

## 📚 Feature Guides

- [Feature docs index](docs/features/README.md)
- [Alerts](docs/features/alerts.md)
- [Shareable View Links](docs/features/shareable-view-links.md)
- [Statistics](docs/features/statistics.md)
- [Scenario Planner](docs/features/scenario-planner.md)
- [EPM View](docs/features/epm-view.md)

## 📖 Technical Docs

- Scenario Planner technical rules are included in [Scenario Planner](docs/features/scenario-planner.md)
- Local install, DB mode, migrations, and Home token setup are covered in [INSTALL.md](INSTALL.md)
- Agent work artifact rules are defined in [docs/AGENTS.md](docs/AGENTS.md)
- Product analytics rules are defined in [docs/README_ANALYTICS.md](docs/README_ANALYTICS.md)
- Self-hosted data handling is described in the [privacy notice](docs/PRIVACY.md)

## 📋 Files

- `jira_server.py` - Python Flask backend server
- `jira-dashboard.html` - Frontend dashboard page
- `frontend/` - Frontend source (`src/`) and generated bundle (`dist/`, gitignored build output)
- `assets/` - Static assets (icons, images)
- `docs/features/` - User-facing feature guides for alerts, statistics, and scenario planning
- `docs/AGENTS.md` - Rules for agent-created work artifacts
- `.env.example` - Template for environment variables
- `INSTALL.md` - Local install, PostgreSQL, DB migration, and Home token setup flow
- `.gitignore` - Git ignore file (keeps secrets safe)
- `requirements.txt` - Python dependencies
- `AGENTS.md` - Contributor guide and workflow conventions
- `docs/postmortem/` - Postmortems and incident learnings (index in `docs/postmortem/README.md`)

## 🔧 Setup

### Quick test run (TL;DR)

For the current DB/OAuth path, use [INSTALL.md](INSTALL.md). The short version is:

1. Create a virtualenv with Python 3.10+ linked against OpenSSL 1.1.1+ and install `requirements.txt`.
2. Copy `.env.example` to `.env`.
3. Configure PostgreSQL, Atlassian OAuth, and token-encryption values.
4. Run Alembic migrations.
5. Run `.venv/bin/python scripts/check_startup_preflight.py`.
6. Start the backend with `.venv/bin/python jira_server.py`.
7. Sign in, then connect the current user's Home/Townsquare token in `Settings -> Connections` if you need EPM.

Starting `.venv/bin/python jira_server.py` directly still does not start PostgreSQL, create the database, or run migrations. Source-checkout developers who want a localhost-only PostgreSQL lifecycle may instead run `./runners/local/run.sh`; it keeps Flask in `.venv`, starts only PostgreSQL in Docker, migrates before startup, and removes the container on `Ctrl+C` while retaining its named volume. Production and release startup paths are unchanged. See [INSTALL.md](INSTALL.md) and [the local runner guide](https://github.com/Juce-me/jira-execution-planner/blob/main/runners/local/README.md).

## 📦 Prebuilt download (no Node required)

The release zip contains a built `frontend/dist`, so this path needs no Node and no frontend build step:
1. Download the latest release asset (e.g. `jira-execution-planner-latest.zip`) from GitHub Releases.
2. Unzip it anywhere.
3. Configure `.env` from `.env.example`.
4. Install backend deps: `chmod +x scripts/install.sh && ./scripts/install.sh`
5. Start the backend: `.venv/bin/python jira_server.py`
6. Visit `http://localhost:5050/` with the backend running. Direct `file://` opening of `jira-dashboard.html` is unsupported.

The server binds to `127.0.0.1` by default. Use `APP_BIND_HOST=0.0.0.0` only for intentional network exposure, with `ALLOW_NETWORK_BIND=true`; Basic auth network exposure also requires `ALLOW_BASIC_AUTH_ON_NETWORK=true` and `APP_ENVIRONMENT_KEY=local`. Dev diagnostics require `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true` and loopback access.

Prebuilt release zips omit source tests and development plans. Use a source checkout when you need to run the unit test suite.

The release zip is the runnable package for normal installs. Editable installs assume the source checkout or extracted release directory is still present because Flask serves `jira-dashboard.html` and `frontend/dist` from sibling files. Do not treat `pip install .` by itself as a self-contained wheel distribution.

Download the latest release zip and replace your folder to update. The app does not check for new releases.

### Local mock data (dev)

If you want to develop UI changes without hitting Jira, keep JSON snapshots locally (untracked) and use them as data fixtures in your tooling/tests.

In-app load measurement is enabled by default when a database is configured and migrated to head. Set `APP_PERFORMANCE_DEBUG=false` to opt out. Normal selected-group sprint requests record Product/Tech request timings, issue/Epic/Story counts, payload bytes, Jira request/page/retry counts, backend stages, and requested dependency time. Overall duration starts at the paired load and ends after two animation frames following completion (a browser-paint approximation). Lazy alert and subtask requests and in-memory group restoration are outside this baseline. Persistence occurs afterwards and never blocks the dashboard load.

Tool admins can open **Settings → Admin → Performance** to inspect 30 days of observations, averages, p50/p95, and expandable slow-load details. The target is 2 seconds and the p95 SLO is 4 seconds; spikes remain visible. Compare matching group, sprint, cache state and revision. Local revision labels include the served frontend bundle hash and update after a rebuild. For backend-only comparisons, set `APP_REVISION` to a distinct build label and restart. Reports are isolated by workspace and server environment. Unknown completeness is contextual evidence only; failed, cancelled and capped loads are shown separately. Debug samples are not a production-wide SLO measurement.

### Step 1: Clone the repository

```bash
git clone <your-repo-url>
cd jira-dashboard
```

### Step 2: Install Python dependencies

Use Python 3.10+ linked against OpenSSL 1.1.1+; macOS system Python builds linked against LibreSSL are not supported because the security-patched HTTP dependency stack requires Python 3.10+ and OpenSSL.

**Option A - Using install script (recommended):**
```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

**Option B - Manual installation:**
```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install -e .
```

**Option C - Standard local targets:**
```bash
make install
make test
make run
```

### Step 3: Configure credentials (and optional server settings)

**Create .env file from template:**
```bash
cp .env.example .env
```

**Edit `.env` and choose the run mode.**
```bash
nano .env  # or use any text editor
```

DB/OAuth mode is the production-like local path. It requires `JIRA_URL`, `JIRA_AUTH_MODE=atlassian_oauth`, Atlassian OAuth client values, `CONFIG_STORAGE_BACKEND=db`, `DATABASE_URL`, and token-encryption settings. Full setup, migrations, and Home token connection steps live in [INSTALL.md](INSTALL.md).

Server-side API-token auth remains a legacy compatibility mode. Do not use legacy Jira/Home Basic credentials for the DB/OAuth EPM path.

### Step 4: Start the server

```bash
.venv/bin/python scripts/check_startup_preflight.py
```

```bash
.venv/bin/python jira_server.py
```

You can override the environment values at launch time instead of editing `.env`:

```bash
.venv/bin/python jira_server.py \
  --server_port 5050 \
  --jira_url https://your-company.atlassian.net
```

### Atlassian OAuth login

The dashboard can run with Atlassian OAuth 2.0 (3LO) for user Jira access instead of server-side Jira Basic auth.

1. Create an OAuth 2.0 app in the Atlassian Developer Console.
2. Add the required User Identity API and Jira API scopes documented in [docs/SUPPORT-atlassian-oauth-setup.md](docs/SUPPORT-atlassian-oauth-setup.md).
3. Set the callback URL to `http://localhost:5050/api/auth/atlassian/callback`, or to an HTTPS tunnel URL if your Atlassian app requires HTTPS.
4. In `.env`, set `JIRA_AUTH_MODE=atlassian_oauth`, `APP_ENVIRONMENT_KEY=local`, `JIRA_URL`, the Atlassian OAuth client settings, `FLASK_SECRET_KEY`, DB storage settings, token-encryption settings, and `OAUTH_LOCAL_TOKEN_STORE_ALLOWED=true` for local single-process testing. `JIRA_URL` selects the matching Atlassian cloud site after login.
5. Start the server and open `/login`. The `Sign in with Atlassian` action starts Atlassian OAuth; for managed Atlassian accounts backed by Microsoft Entra SSO, Atlassian redirects through Microsoft automatically before returning to the local callback.
6. Confirm `/api/auth/status` reports `authenticated: true`, then use `/api/test` to verify Jira REST access. In DB/OAuth mode, EPM Home/Townsquare metadata becomes available after the signed-in user connects a Home token in `Settings -> Connections`.

Jira still receives Atlassian OAuth tokens, not Microsoft Entra tokens. Direct Microsoft access tokens cannot be used as Jira REST API bearer tokens.

### Optional GA4/GTM analytics

Product analytics are disabled by default. To enable the internal employee analytics path for a deployment, set:

```bash
GA4_ENABLED=true
GTM_CONTAINER_ID=GTM-NZJW2CFN
GA4_MEASUREMENT_ID=G-6QERX19WB0
GA4_USER_ID_PEPPER=<deployment-secret>
```

`GA4_ENABLED=false` is the deployment kill switch. It prevents GTM from loading on new page loads, disables app-owned analytics sends, and open dashboard tabs re-check the server switch every 60 seconds so collection stops without clearing the GTM ID, measurement ID, or pepper variables. `GA4_DEBUG_MODE=true` adds GA4 DebugView metadata for validation only; leave it false outside controlled testing. The event contract and forbidden payload rules are in [docs/README_ANALYTICS.md](docs/README_ANALYTICS.md), and the GA4/GTM operator runbook is [docs/plans/SUPPORT-ga4-user-configuration.md](docs/plans/SUPPORT-ga4-user-configuration.md).

### Step 5: Open the dashboard

Visit `http://localhost:5050/` with the backend running. Direct `file://` opening of `jira-dashboard.html` is unsupported.

On first launch (or when local config files do not exist), open **Dashboard Settings** and configure:

1. **Scope projects**
   - Add Jira projects and assign each to **Product** or **Tech**
2. **Jira source**
   - Select **Sprint Field**
   - In DB/OAuth mode, select **Sprint Board**; the persisted Sprint catalog is Board-backed and returns `409 sprint_board_required` when no effective Board is configured
   - In legacy Basic/local mode, **Sprint Board** is optional; omitting it retains the Issues API fallback
3. **Field mapping**
   - Set **Issue Type**, **Parent Name Field**, **Story Points Field**, **Team Field**
4. **Capacity** (used by the Planning module)
   - Select **Capacity Project**
   - Select **Capacity Field** (numeric team capacity field)
5. **Team groups**
   - Create at least one group and choose which teams it contains
6. Click **Save** to persist configuration locally

Saved local JSON files:
- `dashboard-config.json` (projects, Jira source, field mapping, capacity, priority weights)
- `team-groups.json` (team groups)
- `team-catalog.json` (derived team catalog metadata)

The app now relies on Dashboard Settings for supported runtime configuration. Keep `.env` focused on credentials and local server settings.

In OAuth mode, Dashboard Settings → **Admin → Access** lists users already known from Atlassian sign-in and stores app-admin membership against their stable Atlassian account identity. `SETTINGS_ADMIN_ONLY=true` restricts Admin settings to app admins; `false` lets every authenticated OAuth user edit and save them. App-admin membership and the user directory always stay app-admin only. If the workspace has no selected Jira projects (and no `JQL_QUERY`) or no Jira source Board, the dashboard loads no ENG Jira data: app admins get Admin settings opened on the missing tab, and other users see the display names of the app admins to contact. Basic mode treats the local user as an administrator.

In DB/OAuth mode, administrator settings are shared once per workspace and use administrator writes. Department groups and their board layouts are also workspace-shared, but every authenticated user may configure them. Group visibility, favorite/active group, and EPM settings are private to the current user. EPM scope, label prefix, issue types, and project-label mappings live in that user's default private saved view; EPM tab and selected sprint remain private UI state. Derived Sprint catalogs persist per workspace and Jira source Board; Sprint-Team membership persists per workspace and Sprint and is accepted only for the current effective scope. The workspace Team-name directory is separate from membership. See [backend/security/CONFIGURATION_OWNERSHIP.md](backend/security/CONFIGURATION_OWNERSHIP.md) for the complete ownership and access contract.

## EPM View

Use the `ENG | EPM` switch in the dashboard header to browse project rollups rendered as Initiative -> Epic -> Story/Task hierarchies.

In DB/OAuth mode, EPM is hidden until the signed-in user connects a Home/Townsquare token in `Settings -> Connections`. Jira REST reads use the user's OAuth session; Home/Townsquare metadata reads use only the connected `atlassian_user_api_token`, represented in DB `auth_connections` and stored encrypted in `auth_tokens`.

For setup details, see [INSTALL.md](INSTALL.md). For EPM behavior and configuration rules, see [docs/features/epm-view.md](docs/features/epm-view.md).

## 🧱 Frontend build (contributors)

`frontend/dist` is generated build output and is not committed. A source checkout must build it before the server can serve the dashboard; people without Node use the release zip, which ships a built `frontend/dist`. Build after cloning and after every pull or branch switch that touches `frontend/src`:

```bash
npm ci
npm run build
```

Optional during development:
```bash
npm run watch
```

Startup preflight (`.venv/bin/python scripts/check_startup_preflight.py`) fails when the build is missing and the server warns when it looks stale (sources newer than the output). To update a branch, run `make sync` (`scripts/sync_main.sh`): it untracks any previously committed `frontend/dist` on the first sync past this change and rebuilds. We precompile JSX so production does not transform JSX in the browser.

Run the local verification path before preparing a PR. It runs the CI checks plus the Playwright `tests/ui` suite (about 8 minutes), which has no CI job by design. The UI suite and `npm run test:frontend:unit` read `frontend/dist`, so build first (`npm run build && npx playwright test tests/ui --browser=chromium --workers=4` for the UI suite alone):

```bash
make verify
```

## Internal Hosting Pre-SRE Checklist

This repo ships container packaging for verification and image build only. It does not include production registry push, release, or deployment automation.

Can prepare now:
- Build the container from `Dockerfile`, the image builds its own `frontend/dist` in a build stage, run startup preflight, and expose `/health` as shallow liveness.
- Run CI verification that installs backend/frontend dependencies, runs tests/builds, and tags the image with the commit SHA.
- Keep runtime env ownership explicit: app secrets, Atlassian OAuth settings, DB URL, token encryption, GA4 toggles, and local defaults remain outside the image.
- Response compression is done by the app (gzip, `Vary: Accept-Encoding`; see Performance & Caching). An ingress or proxy that also compresses must leave a response that already has a `Content-Encoding` alone.

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

`PORT=5050` is the container/Gunicorn listener port. `SERVER_PORT` remains a local Flask compatibility setting for source-checkout runs. The Docker image defaults to `APP_BIND_HOST=0.0.0.0` and `ALLOW_NETWORK_BIND=true` so GCP service networking can reach Gunicorn; startup preflight still fails closed unless hosted OAuth sets `SESSION_COOKIE_SECURE=true`, a real `FLASK_SECRET_KEY`, and an explicit `APP_ALLOWED_ORIGINS` value matching the HTTPS origin.

For migrations, use `RUN_DB_MIGRATIONS=true` only for a single-instance internal deployment where the app container is the agreed migration owner. For multi-replica deployments, run Alembic as a separate release job or init step before rolling out app replicas, and keep `RUN_DB_MIGRATIONS=false` on the web containers.

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

Migration `20260827_0008` must run with application writers quiesced and only after a database backup. Its workspace-EPM archive is migration-only rollback state: the migration is reversible, and operators or application code must never use the archive to infer or create a private EPM owner.

OAuth2 Proxy is perimeter access only. The app still requires Atlassian OAuth 2.0 (3LO) because Jira REST reads use the signed-in user's Atlassian OAuth session, and Home/Townsquare EPM reads require the user's connected Home token stored encrypted in DB.

Needs SRE ownership or confirmation:
- CI project location, registry/image path, runner container-build method, branch/tag policy, and when image push may be enabled.
- Hosted HTTPS origin, Atlassian OAuth redirect/callback registration, OAuth2 Proxy boundary, TLS termination, secure cookie settings, and `APP_ALLOWED_ORIGINS`.
- PostgreSQL provisioning, migration owner, persistence/backups, log retention, resource limits, and production readiness probe policy.

Blocked until deployment reference:
- Production registry credentials/path, secret references, migration release strategy, Helm or Kubernetes values, namespace/routing/VPN/proxy details, TLS secret names, and real release jobs.

## 🔧 How it works

1. **Backend** (`jira_server.py`):
   - Runs on `localhost:5050` by default (overridable via `SERVER_PORT` or `--server_port`)
   - Reads local app settings from `.env`; in DB/OAuth mode, user tokens are stored encrypted in DB
   - Makes secure READ-ONLY API requests to Jira
   - Caches sprint list for 24 hours, task data for 5 minutes (reduces API load)
   - Refresh button bypasses all server caches for immediate Jira updates
   - The per-Epic refresh button reloads one Epic (its Stories, header and, in Catch Up, its alerts) without touching the rest of the page
   - Returns filtered data to frontend

2. **Frontend** (`jira-dashboard.html`):
   - Displays tasks in a clean, animated interface
   - **Sprint Selector** - Dropdown to choose sprint (2025Q1, 2025Q2, etc.)
   - **Team Groups + Sticky Controls** - Workspace-shared Group, Sprint, and Teams controls stay available in a compact sticky header while scrolling
   - Auto-selects current quarter on first load
   - Sorted by priority (Highest → Lowest)
   - Filter toggles for Done/Killed/Tech/Product tasks
   - Dependency focus mode (chips highlight related tasks, missing deps shown inline)
   - Click stat cards to filter by status
   - Planning selections persist locally per `sprint + group` and prune stories that move out of scope on refresh
   - Planning module includes bulk actions for Accepted, To Do, Postponed, and Awaiting Validation
   - Refresh buttons for tasks and sprints
   - Ready-to-close alert uses all-time story data (no sprint filter)
   - Statistics panel for active/closed sprints (derived from loaded sprint tasks)

## 🔗 Dependencies

- Click **Depends On** or **Dependents** on a story to enter focus mode (dims unrelated cards and highlights related ones).
- Relationship direction is shown via right-side pills (“← BLOCKED BY” / “BLOCKS →”).
- Missing dependencies (not in the current sprint load) are shown inline under the focused story.
- Missing dependency details are fetched via `/api/issues/lookup` and cached client-side.

## 🎯 Sprint Selection

The dashboard supports dynamic sprint selection:

1. **Auto-detection**: Automatically selects current quarter (e.g., 2025Q4)
2. **Dropdown**: Choose from available sprints starting from 2025Q1
3. **Caching**: In DB/OAuth mode, the validated Sprint list is shared per workspace and source Board and refreshed after 24 hours; Basic/local mode keeps its compatible file cache
4. **Refresh button**: Manually update sprint list from Jira
5. **Two fetch methods**:
   - DB/OAuth: Board API only (set Sprint Board in Dashboard Settings → Jira source); no effective Board returns `409 sprint_board_required`
   - Legacy Basic/local: Board API when configured, otherwise the Issues API fallback uses the dashboard configuration and selected projects

## 📊 Sprint Statistics

The Statistics panel covers sprint execution and lead-time views for active or completed sprints, including a **Project Track** tab: a filter bar (Start/End sprint, Capacity side Product/Tech/Tech+Product, Exclude Ad Hoc, Exclude Excluded Capacity, Mode Epic/Team), a range totals bar and per-sprint chart of story points by Project Track, a By assignee/By team breakdown, and an Epic-mode-only time-in-phase section built from the Jira changelog.

See the full guide:
- [docs/features/statistics.md](docs/features/statistics.md)

## 🧮 Capacity Planning

Capacity planning uses the loaded sprint tasks plus a separate Jira project for team capacity:

- **Team capacity**: pulled from the configured Capacity project/field (Dashboard Settings → Capacity).
- **Planning capacity**: team capacity minus excluded epic story points (same epic include/exclude toggle).
- **Excluded capacity epics**: work that is **not** included in planning capacity. Their story points are subtracted from team capacity so planning capacity reflects only the work you intend to deliver.
- **Ad Hoc capacity epics** (including business-as-usual work): work that **is** included as Product planning capacity but reported separately, so you can see how much delivered Product capacity went to ad hoc work. Configure Ad Hoc epics separately from excluded epics; the same epic cannot be both.
- **Admin Capacity** is only the Jira capacity project/field (Dashboard Settings → Capacity). It does not store the excluded or Ad Hoc epic lists — those are saved per Department/team group in Department settings.
- **Split**: estimated capacity split is 70% Product / 30% Tech.

Priority weights used for weighted delivery:
- Blocker 0.40
- Critical 0.30
- Major 0.20
- Minor 0.06
- Low 0.03
- Trivial 0.01

## 🗓️ Scenario Planner

See the full guide:
- [docs/features/scenario-planner.md](docs/features/scenario-planner.md)

## 🔒 Security Notes

- ⚠️ **Never commit `.env` file to Git!** It contains your secrets
- ✅ The `.env` file is already in `.gitignore`
- ✅ Sprint cache file (`sprints_cache.json`) is also in `.gitignore`
- ✅ Always use `.env.example` as a template for others
- ✅ DB/OAuth EPM stores each user's Home token encrypted in DB `auth_tokens`; shared service credentials are not used as an EPM fallback
- ✅ All API requests are READ-ONLY (no modifications to Jira)
- ✅ No hardcoded company-specific URLs or IDs in code

## 🛠 Troubleshooting

**"Connection refused" error:**
- Make sure the Python server is running (`.venv/bin/python jira_server.py`)

**"ModuleNotFoundError" when starting server:**
- Install dependencies from the repo root: `.venv/bin/python -m pip install -r requirements.txt`

**`DATABASE_URL is required when CONFIG_STORAGE_BACKEND=db`:**
- Follow [INSTALL.md](INSTALL.md): start PostgreSQL, create the database, set `DATABASE_URL`, run Alembic migrations, then restart Flask.

**`TOKEN_ENCRYPTION_MASTER_KEY_B64 or TOKEN_ENCRYPTION_KEY_ID is required`:**
- Generate and set the token-encryption values from [INSTALL.md](INSTALL.md). DB/OAuth token storage will not start without them.

**"Required Jira Basic auth settings must be set" error:**
- Make sure you created `.env` file from `.env.example`
- Check that you filled in the required Basic auth settings for legacy API-token mode, or switch to DB/OAuth mode with `JIRA_AUTH_MODE=atlassian_oauth`

**"401 Unauthorized" error:**
- In DB/OAuth mode, any application API `401` blocks the mounted dashboard behind the global sign-in recovery screen. Use its same-tab **Sign in again** action; the new authenticated document bootstraps from scratch and does not replay the failed request.
- In legacy Basic mode, check that your API token settings are correct in `.env`.

**EPM tab is missing in DB/OAuth mode:**
- Connect the signed-in user's Home/Townsquare token in `Settings -> Connections`; EPM is intentionally hidden until that encrypted user token exists.

**"No tasks found":**
- Verify your configured projects and shared team groups match your Jira setup
- Check that the sprint exists and has tasks
- If you use a custom JQL override, try simplifying it

**"Team name missing" in tasks output:**
- Open Dashboard Settings → **Field mapping** and set the **Team Field** to your Jira Team[Team] custom field

**"No sprints available" in dropdown:**
- In DB/OAuth mode, set **Sprint Board** in Dashboard Settings → **Jira source**; it is required for the Board-backed Sprint catalog, and an absent effective Board returns `409 sprint_board_required`
  - Find your board ID: go to `/api/boards` endpoint or check Jira board URL
- In legacy Basic/local mode, set **Sprint Board** for the Board API path or leave it empty to use the Issues API fallback
- For the legacy fallback, check that your selected projects return tasks with sprint information

**Planning panel shows no capacity / capacity comparison looks wrong:**
- Open Dashboard Settings → **Capacity**
- Select both **Capacity Project** and **Capacity Field**
- Click **Save** (changes are applied only after saving)

**Sprints loading slowly:**
- First load fetches from Jira (may take a few seconds)
- Subsequent loads use 24-hour cache (instant)
- To find board ID for faster loading: visit `http://localhost:5050/api/boards`

**Want to refresh sprint list manually:**
- Click "Refresh Sprints" button in the dashboard
- Or visit: `http://localhost:5050/api/sprints?refresh=true`

**Browser shows old errors after fixing:**
- Do a hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Or open in incognito/private mode

## 🔄 Updating data

- **Tasks**: Click the refresh button in the header — bypasses server cache and fetches fresh data from Jira (also refreshes sprints and ready-to-close data)
- **Sprints**: Also refreshed by the header refresh button, or CMD+R/CTRL+R (page reload uses server cache bypass on first load)
- **Auto-reload**: Tasks reload automatically when you change sprint selection
- **Return after an absence (#251, in progress)**: The implementation checks the active scope silently after more than 12 minutes away and defers around editing. Source-check text qualifies cached or incomplete coverage. [Behavior and remaining verification gates](docs/features/eng-workflows.md#return-after-an-absence).
- **Stats**: Teams/Priority update from loaded tasks; Burnout refreshes when sprint/team scope changes and when opening Burnout

## 📦 Project Structure

```
jira-dashboard/
├── AGENTS.md              # Contributor guidelines
├── jira_server.py          # Flask entrypoint and compatibility shims
├── jira-dashboard.html     # Served dashboard shell
├── backend/
│   ├── routes/             # Flask blueprints by route surface
│   ├── auth/               # OAuth, DB auth context, CSRF, token crypto
│   ├── config/             # JSON/DB config repositories and validation
│   ├── epm/                # Home/Townsquare access, EPM scope, rollups
│   ├── security/           # Endpoint policy and security headers
│   └── services/           # Service extraction namespace
├── frontend/               # Frontend source + compiled bundle
│   ├── src/
│   │   ├── api/            # Frontend endpoint wrappers
│   │   ├── eng/            # ENG dashboard view modules
│   │   ├── epm/            # EPM controls, settings, and rollup views
│   │   ├── scenario/       # Scenario planner helpers/components
│   │   ├── settings/       # Settings modal modules
│   │   ├── stats/          # Statistics views and utilities
│   │   ├── ui/             # Shared UI primitives
│   │   └── dashboard.jsx   # App shell and remaining legacy wiring
│   └── dist/               # Generated JS + CSS output (gitignored; run npm run build)
├── docs/                   # Documentation
│   ├── plans/              # EXEC/DONE/FUTURE/SUPPORT/GATE plans
│   ├── features/           # User-facing feature guides
│   └── postmortem/         # Postmortems and incident learnings
├── planning/               # Scenario planner core logic
├── tests/                  # Python, Node, source-guard, and UI tests
├── assets/                 # Static assets (icons, images)
├── requirements.txt        # Python dependencies
├── .env.example           # Environment variables template
├── .gitignore             # Git ignore file (includes .env and cache)
├── scripts/install.sh     # Installation script
├── README.md              # This file
├── .env                   # Your credentials (NOT in git!)
├── dashboard-config.json  # Dashboard settings (auto-generated, NOT in git!)
├── team-groups.json       # Team groups config (auto-generated, NOT in git!)
├── scenario-overrides.json # Scenario planner overrides (auto-generated, NOT in git!)
├── sprints_cache.json     # Sprint cache (auto-generated, NOT in git!)
└── tasks.test.local.json  # Local task snapshots (optional, NOT in git!)
```

## 🚀 Performance & Caching

The dashboard uses a few different cache layers to keep Jira traffic reasonable:

- **Basic/local Sprint list**: cached on disk in `sprints_cache.json` for 24 hours. Use **Refresh Sprints** or `?refresh=true` to force a reload from Jira.
- **DB/OAuth Sprint and Team catalogs**: Sprint values persist in `workspace_sprint_catalogs` per workspace/source Board. Team availability persists in `workspace_sprint_team_catalogs` per workspace/Sprint and is bound to the effective Board/project/base-JQL/Team-field scope digest; names remain in the separate `workspace_team_catalogs` directory. A complete validated empty result replaces older choices. A matching failed refresh retains the last validated result with a warning instead of publishing partial discovery.
- **Catalog browser lifecycle**: Restored Sprint labels are display-only until the current server identity and browser context validate them. Pending refresh completion is bound to one attempt/identity, bounded by hard server and browser deadlines, and cancelled on auth, configuration, or document-lifetime changes. Manual refresh coalesces with an ordinary pending attempt; Retry forces only when no such attempt exists.
- **Tasks and epics**: cached in server memory for 5 minutes for repeated requests with the same sprint/group/project scope. The refresh button bypasses the server cache and also clears browser-side group state, so changes made in Jira appear immediately after clicking refresh.
- **Statistics**:
  - Teams and Priority views are computed from the currently loaded sprint tasks in the browser.
  - Burnout loads on demand from `/api/stats/burnout` and is reused in the browser for the same sprint/team/task scope during the session.
  - Lead Times loads on demand from `/api/stats/epic-cohort` and is cached both in the browser and on the server for repeated scope requests.
  - Completed-sprint delivery stats from `/api/stats` are persisted in `stats_cache.json`.
- **Reference data**: Jira projects, components, epic search results, labels, and update-check results use short-lived caches to avoid repeated lookup calls while editing settings.
- **Request shaping**: heavy Jira fetches are paginated and capped per endpoint instead of trying to pull everything in one call.
- **Timeout protection**: Jira requests use bounded timeouts, typically between 10 and 30 seconds depending on the endpoint.
- **Response compression**: the app gzips JSON, JavaScript, CSS, HTML and SVG responses of 1 KB or more for clients that accept gzip (standard-library `gzip`, level 6, no extra dependency). Static `/frontend/dist/*` files are compressed once per process and reused; a compressed response carries a weak ETag, so a conditional request still gets a 304. `Vary: Accept-Encoding` is set on these responses whatever the client sent. Streams (the Board NDJSON stream and Scenario draft events), `/api/auth/*`, source maps (`*.map`), range and error responses and bodies that already have a `Content-Encoding` are never compressed.

## 📚 Documentation & Postmortems

- Keep `README.md`, `AGENTS.md`, and `docs/postmortem/README.md` aligned with structural or workflow changes.
- Agent-created work artifacts live under `docs/agents/` and follow [docs/AGENTS.md](docs/AGENTS.md).
- Postmortems live in `docs/postmortem/` and follow `MRTXXX-short-title.md` naming in creation order (oldest first).
- Postmortem-specific agent instructions live in [docs/postmortem/AGENTS.md](docs/postmortem/AGENTS.md).
- Capture misses and fixes in postmortems and update the index when adding one.

## 🤝 Contributing

Feel free to open issues or submit pull requests!

## 📄 License

MIT License - feel free to use this project however you'd like!

## 🙏 Credits

Built with Flask, Python, React, and esbuild.
