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
ATLASSIAN_SCOPES=read:me read:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access
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

After `./install.sh` or `python -m pip install -e .`, the equivalent console command is:

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

The repository provides a handoff skeleton for GitLab verification and container build. It deliberately does not ship production registry push, Helm values, Kubernetes manifests, or deployment jobs.

Can prepare now:
- Build the image with `docker build -t "$IMAGE_NAME:$CI_COMMIT_SHA" .` or the GitLab `container` stage, using the committed `Dockerfile`.
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
DATABASE_URL=<postgresql-url-from-secret>
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

`PORT=5050` is the container/Gunicorn listener port used by `scripts/docker-entrypoint.sh`; source-checkout Flask runs still use `SERVER_PORT` unless a command-line port is supplied. The Docker image defaults to `APP_BIND_HOST=0.0.0.0` and `ALLOW_NETWORK_BIND=true` so GCP service networking can reach Gunicorn; startup preflight still fails closed unless hosted OAuth sits behind HTTPS ingress, sets `SESSION_COOKIE_SECURE=true`, uses a real `FLASK_SECRET_KEY`, and provides `APP_ALLOWED_ORIGINS` for the exact HTTPS origin.

Use `RUN_DB_MIGRATIONS=true` only when a single app container is the agreed migration owner for an internal deployment. For multi-replica deployments, run Alembic in a separate release job or init step, then start web containers with `RUN_DB_MIGRATIONS=false`.

OAuth2 Proxy may protect the ingress perimeter, but it does not replace app-level Atlassian OAuth. The app still needs Atlassian OAuth 2.0 (3LO) for Jira REST reads and the per-user Home token connection for Home/Townsquare EPM metadata.

Needs SRE ownership or confirmation:
- GitLab group/repo path, registry/image path, runner build method, default branch/tag policy, and the exact point when image push may be enabled with `PUSH_IMAGE=true`.
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
