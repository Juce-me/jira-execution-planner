# Jira Execution Planner

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
- ✅ **Secure Credentials** - Local secrets stay outside git; DB/OAuth user tokens are encrypted in database storage
- ✅ **Team-aware filtering** - Multi-team JQL plus UI dropdown to slice per team and see team name on each story
- ✅ **Team groups** - Define multiple named team groups (1-12 teams), choose a default, and scope the dashboard per group
- ✅ **Epic grouping** - Stories grouped under their epic with assignee and story-point totals
- ✅ **Dependency focus** - Click Depends On/Dependents to highlight related tasks and show missing deps inline
- ✅ **Planning rollups** - Selected story points summarized per team, project, and overall
- ✅ **Capacity planning** - Team capacity vs planning capacity (exclusions via epic toggle)
- ✅ **Scoped planning persistence** - Planning selections persist locally per sprint and team group, then reconcile on refresh
- ✅ **Scoped team persistence** - Team dropdown selection persists locally per sprint and team group, then falls back to All Teams if unavailable
- ✅ **Planning bulk actions** - Quickly include Accepted, To Do, Postponed, and Awaiting Validation stories
- ✅ **Compact sticky controls** - Sticky Sprint/Group/Teams controls keep the same dropdown behavior while using a smaller compact layout
- ✅ **Scenario planner** - [Feature guide](docs/features/scenario-planner.md)
- ✅ **Alerts** - [Feature guide](docs/features/alerts.md)
- ✅ **Sprint statistics** - [Feature guide](docs/features/statistics.md)
- ✅ **EPM view** - [Feature guide](docs/features/epm-view.md)

## 📚 Feature Guides

- [Feature docs index](docs/features/README.md)
- [Alerts](docs/features/alerts.md)
- [Statistics](docs/features/statistics.md)
- [Scenario Planner](docs/features/scenario-planner.md)
- [EPM View](docs/features/epm-view.md)

## 📖 Technical Docs

- Scenario Planner technical rules are included in [Scenario Planner](docs/features/scenario-planner.md)
- Local install, DB mode, migrations, and Home token setup are covered in [INSTALL.md](INSTALL.md)
- Agent work artifact rules are defined in [docs/agents.md](docs/agents.md)

## 📋 Files

- `jira_server.py` - Python Flask backend server
- `jira-dashboard.html` - Frontend dashboard page
- `frontend/` - Frontend source (`src/`) and compiled bundle (`dist/`)
- `docs/features/` - User-facing feature guides for alerts, statistics, and scenario planning
- `docs/agents.md` - Rules for agent-created work artifacts
- `.env.example` - Template for environment variables
- `INSTALL.md` - Local install, PostgreSQL, DB migration, and Home token setup flow
- `.gitignore` - Git ignore file (keeps secrets safe)
- `requirements.txt` - Python dependencies
- `AGENTS.md` - Contributor guide and workflow conventions
- `postmortem/` - Postmortems and incident learnings (index in `postmortem/README.md`)

## 🔧 Setup

### Quick test run (TL;DR)

For the current DB/OAuth path, use [INSTALL.md](INSTALL.md). The short version is:

1. Create a virtualenv and install `requirements.txt`.
2. Copy `.env.example` to `.env`.
3. Configure PostgreSQL, Atlassian OAuth, and token-encryption values.
4. Run Alembic migrations.
5. Start the backend with `.venv/bin/python jira_server.py`.
6. Sign in, then connect the current user's Home/Townsquare token in `Settings -> Connections` if you need EPM.

Starting `python3 jira_server.py` does not start PostgreSQL, create the database, or run migrations. More detailed single-user/legacy setup guidance remains below if you need it.

## 📦 Prebuilt download (no Node required)

If you want the fastest setup with no frontend build step:
1. Download the latest release asset (e.g. `jira-execution-planner-latest.zip`) from GitHub Releases.
2. Unzip it anywhere.
3. Configure `.env` from `.env.example`.
4. Install backend deps: `chmod +x install.sh && ./install.sh`
5. Start the backend: `.venv/bin/python jira_server.py`
6. Open `jira-dashboard.html` in your browser (or visit `http://localhost:5050/`).

The server binds to `127.0.0.1` by default. Use `APP_BIND_HOST=0.0.0.0` only for intentional network exposure, with `ALLOW_NETWORK_BIND=true`; Basic auth network exposure also requires `ALLOW_BASIC_AUTH_ON_NETWORK=true` and `APP_ENVIRONMENT_KEY=local`. Dev diagnostics require `ALLOW_DEV_DIAGNOSTIC_ENDPOINTS=true` and loopback access.

Prebuilt release zips omit source tests and development plans. Use a source checkout when you need to run the unit test suite.

The UI shows a “New Version Available” badge when a newer release is detected. Release zips include `release-info.json` so update checks work without git. Download the latest zip and replace your folder to update.

### Local mock data (dev)

If you want to develop UI changes without hitting Jira, keep JSON snapshots locally (untracked) and use them as data fixtures in your tooling/tests.

### Step 1: Clone the repository

```bash
git clone <your-repo-url>
cd jira-dashboard
```

### Step 2: Install Python dependencies

**Option A - Using install script (recommended):**
```bash
chmod +x install.sh
./install.sh
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
.venv/bin/python jira_server.py
```

You can override the environment values at launch time instead of editing `.env`:

```bash
python3 jira_server.py \
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

### Step 5: Open the dashboard

Open `jira-dashboard.html` in your browser (or visit `http://localhost:5050/`).

On first launch (or when local config files do not exist), open **Dashboard Settings** and configure:

1. **Scope projects**
   - Add Jira projects and assign each to **Product** or **Tech**
2. **Jira source**
   - Select **Sprint Field**
   - Optionally select **Sprint Board** (faster sprint loading)
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
- `team-groups.json` (team groups and team catalog metadata)

The app now relies on Dashboard Settings for supported runtime configuration. Keep `.env` focused on credentials and local server settings.

## EPM View

Use the `ENG | EPM` switch in the dashboard header to browse project rollups rendered as Initiative -> Epic -> Story/Task hierarchies.

In DB/OAuth mode, EPM is hidden until the signed-in user connects a Home/Townsquare token in `Settings -> Connections`. Jira REST reads use the user's OAuth session; Home/Townsquare metadata reads use only the connected `atlassian_user_api_token` stored encrypted in DB `auth_tokens`.

For setup details, see [INSTALL.md](INSTALL.md). For EPM behavior and configuration rules, see [docs/features/epm-view.md](docs/features/epm-view.md).

## 🧱 Frontend build (contributors)

The repo commits the compiled frontend output so normal users don’t need Node.
If you edit the UI, rebuild and commit `frontend/dist`:

```bash
npm ci
npm run build
```

Optional during development:
```bash
npm run watch
```

CI will fail if `frontend/dist` is out of sync. We precompile JSX so production does not transform JSX in the browser.

## 🔧 How it works

1. **Backend** (`jira_server.py`):
   - Runs on `localhost:5050` by default (overridable via `SERVER_PORT` or `--server_port`)
   - Reads local app settings from `.env`; in DB/OAuth mode, user tokens are stored encrypted in DB
   - Makes secure READ-ONLY API requests to Jira
   - Caches sprint list for 24 hours, task data for 5 minutes (reduces API load)
   - Refresh button bypasses all server caches for immediate Jira updates
   - Returns filtered data to frontend

2. **Frontend** (`jira-dashboard.html`):
   - Displays tasks in a clean, animated interface
   - **Sprint Selector** - Dropdown to choose sprint (2025Q1, 2025Q2, etc.)
   - **Team Groups + Sticky Controls** - Group, Sprint, and Teams controls stay available in a compact sticky header while scrolling
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
3. **Caching**: Sprint list cached for 24 hours for fast loading
4. **Refresh button**: Manually update sprint list from Jira
5. **Two fetch methods**:
   - Fast: Via Board API (set Sprint Board in Dashboard Settings → Jira source)
   - Fallback: Via Issues API (uses your dashboard configuration and selected projects)

## 📊 Sprint Statistics

The Statistics panel covers sprint execution and lead-time views for active or completed sprints.

See the full guide:
- [docs/features/statistics.md](docs/features/statistics.md)

## 🧮 Capacity Planning

Capacity planning uses the loaded sprint tasks plus a separate Jira project for team capacity:

- **Team capacity**: pulled from the configured Capacity project/field (Dashboard Settings → Capacity).
- **Planning capacity**: team capacity minus excluded epic story points (same epic include/exclude toggle).
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
- Make sure the Python server is running (`python3 jira_server.py`)

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
- In DB/OAuth mode, sign in again through `/login`.
- In legacy Basic mode, check that your API token settings are correct in `.env`.

**EPM tab is missing in DB/OAuth mode:**
- Connect the signed-in user's Home/Townsquare token in `Settings -> Connections`; EPM is intentionally hidden until that encrypted user token exists.

**"No tasks found":**
- Verify your configured projects and team groups match your Jira setup
- Check that the sprint exists and has tasks
- If you use a custom JQL override, try simplifying it

**"Team name missing" in tasks output:**
- Open Dashboard Settings → **Field mapping** and set the **Team Field** to your Jira Team[Team] custom field

**"No sprints available" in dropdown:**
- Option 1: Set **Sprint Board** in Dashboard Settings → **Jira source** (faster method)
  - Find your board ID: go to `/api/boards` endpoint or check Jira board URL
- Option 2: Leave Sprint Board empty (fallback method works automatically)
- Check that your selected projects return tasks with sprint information

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
- **Stats**: Teams/Priority update from loaded tasks; Burnout refreshes when sprint/team scope changes and when opening Burnout

## 📦 Project Structure

```
jira-dashboard/
├── AGENTS.md              # Contributor guidelines
├── jira_server.py          # Backend Flask server with caching
├── jira-dashboard.html     # Frontend interface with sprint selector
├── frontend/               # Frontend source + compiled bundle
│   ├── src/                # JSX source (dashboard.jsx + scenario/)
│   └── dist/               # Compiled JS + CSS output (committed)
├── docs/                   # Documentation
│   ├── agents.md           # Agent work artifact rules
│   └── features/           # User-facing feature guides
├── planning/               # Scenario planner core logic
├── tests/                  # Unit tests
├── postmortem/             # Postmortems and incident learnings
├── requirements.txt        # Python dependencies
├── .env.example           # Environment variables template
├── .gitignore             # Git ignore file (includes .env and cache)
├── install.sh             # Installation script
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

- **Sprint list**: cached on disk in `sprints_cache.json` for 24 hours. Use **Refresh Sprints** or `?refresh=true` to force a reload from Jira.
- **Tasks and epics**: cached in server memory for 5 minutes for repeated requests with the same sprint/group/project scope. The refresh button bypasses the server cache and also clears browser-side group state, so changes made in Jira appear immediately after clicking refresh.
- **Statistics**:
  - Teams and Priority views are computed from the currently loaded sprint tasks in the browser.
  - Burnout loads on demand from `/api/stats/burnout` and is reused in the browser for the same sprint/team/task scope during the session.
  - Lead Times loads on demand from `/api/stats/epic-cohort` and is cached both in the browser and on the server for repeated scope requests.
  - Completed-sprint delivery stats from `/api/stats` are persisted in `stats_cache.json`.
- **Reference data**: Jira projects, components, epic search results, labels, and update-check results use short-lived caches to avoid repeated lookup calls while editing settings.
- **Request shaping**: heavy Jira fetches are paginated and capped per endpoint instead of trying to pull everything in one call.
- **Timeout protection**: Jira requests use bounded timeouts, typically between 10 and 30 seconds depending on the endpoint.

## 📚 Documentation & Postmortems

- Keep `README.md`, `AGENTS.md`, and `postmortem/README.md` aligned with structural or workflow changes.
- Agent-created work artifacts live under `docs/agents/` and follow [docs/agents.md](docs/agents.md).
- Postmortems live in `postmortem/` and follow `MRTXXX-short-title.md` naming in creation order (oldest first).
- Postmortem-specific agent instructions live in [postmortem/AGENTS.md](postmortem/AGENTS.md).
- Capture misses and fixes in postmortems and update the index when adding one.

## 🤝 Contributing

Feel free to open issues or submit pull requests!

## 📄 License

MIT License - feel free to use this project however you'd like!

## 🙏 Credits

Built with Flask, Python, React, and esbuild.
