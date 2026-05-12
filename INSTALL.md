# Install And Run

This app has two local run modes:

- JSON-file mode: starts with `python3 jira_server.py` after `.env` is configured.
- DB mode: required for OAuth-backed users, encrypted OAuth tokens, service integrations, and the Home token connection flow.

`python3 jira_server.py` does not start PostgreSQL, create the database, or run migrations.

## 1. Python Environment

From the repo root:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
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

Quick DB verification:

```bash
.venv/bin/python -m unittest tests.test_db_session tests.test_db_migrations
```

## 5. Start The App

```bash
.venv/bin/python jira_server.py
```

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

## 8. Common Failures

`DATABASE_URL is required when CONFIG_STORAGE_BACKEND=db`

Set `DATABASE_URL`, export it before CLI migration/seeding commands, run migrations, then restart Flask.

`TOKEN_ENCRYPTION_MASTER_KEY_B64 or TOKEN_ENCRYPTION_KEY_ID is required`

Generate a 32-byte base64 key and set both `TOKEN_ENCRYPTION_MASTER_KEY_B64` and `TOKEN_ENCRYPTION_KEY_ID`.

`auth_required` after enabling DB mode

Sign in again through `/login`; the DB rows are created during the OAuth callback.

`command not found: alembic`

Use the virtualenv binary:

```bash
.venv/bin/alembic -c backend/db/alembic.ini upgrade head
```
