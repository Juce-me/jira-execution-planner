# Jira Execution Planner

Simple local dashboard to display Jira sprint tasks sorted by priority with Python Flask backend.

## 🚀 Features

- ✅ **Dynamic Sprint Selection** - Choose any sprint from dropdown (2025Q1, 2025Q2, etc.)
- ✅ **Smart Sprint Detection** - Auto-selects current quarter on load
- ✅ **Intelligent Caching** - Sprint list cached for 24 hours to reduce Jira API load
- ✅ **Sort by Priority** - Tasks sorted Highest → Lowest
- ✅ **Status filters** - Toggle Done/Killed and use stat cards (In Progress, To Do/Pending/Accepted, High Priority)
- ✅ **Project Filtering** - Separate Tech and Product tasks
- ✅ **Clean, Minimalist UI** - Beautiful typography with smooth animations
- ✅ **Auto-refresh** - Reload button for tasks and sprints
- ✅ **Secure Credentials** - All sensitive data in .env file
- ✅ **Team-aware filtering** - Multi-team JQL plus UI dropdown to slice per team and see team name on each story
- ✅ **Team groups** - Define multiple named team groups (1-12 teams), choose a default, and scope the dashboard per group
- ✅ **Epic grouping** - Stories grouped under their epic with assignee and story-point totals
- ✅ **Dependency focus** - Click Depends On/Dependents to highlight related tasks and show missing deps inline
- ✅ **Planning rollups** - Selected story points summarized per team, project, and overall
- ✅ **Capacity planning** - Team capacity vs planning capacity (exclusions via epic toggle)
- ✅ **Scenario planner** - [Feature guide](docs/features/scenario-planner.md)
- ✅ **Alerts** - [Feature guide](docs/features/alerts.md)
- ✅ **Sprint statistics** - [Feature guide](docs/features/statistics.md)

## 📚 Feature Guides

- [Feature docs index](docs/features/README.md)
- [Alerts](docs/features/alerts.md)
- [Statistics](docs/features/statistics.md)
- [Scenario Planner](docs/features/scenario-planner.md)

## 📖 Technical Docs

- [Scenario Planner Rules](docs/scenario-planner-rules.md)

## 📋 Files

- `jira_server.py` - Python Flask backend server
- `jira-dashboard.html` - Frontend dashboard page
- `frontend/` - Frontend source (`src/`) and compiled bundle (`dist/`)
- `docs/features/` - User-facing feature guides for alerts, statistics, and scenario planning
- `docs/scenario-planner-rules.md` - Technical scenario-planner invariants and scheduling rules
- `.env.example` - Template for environment variables
- `.gitignore` - Git ignore file (keeps secrets safe)
- `requirements.txt` - Python dependencies
- `AGENTS.md` - Contributor guide and workflow conventions
- `postmortem/` - Postmortems and incident learnings (index in `postmortem/README.md`)

## 🔧 Setup

### Quick test run (TL;DR)

If you just want to see the dashboard working locally:
1. Install dependencies: `python3 -m pip install --user -r requirements.txt`
2. Copy the env template: `cp .env.example .env`
3. Edit `.env` and set **JIRA_URL**, **JIRA_EMAIL**, **JIRA_TOKEN**.
4. Start the backend: `python3 jira_server.py`
5. Visit `http://localhost:5050/api/test` in your browser to confirm connectivity.
6. Open `jira-dashboard.html` in your browser (or visit `http://localhost:5050/`), complete **Dashboard Settings** onboarding, then click **Save**.

More detailed setup guidance remains below if you need it.

## 📦 Prebuilt download (no Node required)

If you want the fastest setup with no frontend build step:
1. Download the latest release asset (e.g. `jira-execution-planner-latest.zip`) from GitHub Releases.
2. Unzip it anywhere.
3. Configure `.env` from `.env.example`.
4. Install backend deps: `python3 -m pip install --user -r requirements.txt`
5. Start the backend: `python3 jira_server.py`
6. Open `jira-dashboard.html` in your browser (or visit `http://localhost:5050/`).

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
# If you don't have pip3, install it first:
sudo apt install python3-pip

# Then install packages:
pip3 install --user flask flask-cors requests python-dotenv openpyxl "urllib3<2"
```

**Option C - Using python3 directly (if pip3 not available):**
```bash
python3 -m pip install --user flask flask-cors requests python-dotenv openpyxl "urllib3<2"
```

### Step 3: Configure credentials (and optional server settings)

**Create .env file from template:**
```bash
cp .env.example .env
```

**Edit .env file and add your credentials:**
```bash
nano .env  # or use any text editor
```

```env
# Your Jira instance URL
JIRA_URL=https://your-company.atlassian.net

# Your Jira email
JIRA_EMAIL=your-email@company.com

# Your Jira API token
JIRA_TOKEN=your-api-token-here

# Optional: server port for the local backend
SERVER_PORT=5050

# Optional: debug mode (auto-reload, verbose errors)
DEBUG_MODE=false

# Optional: server log level
LOG_LEVEL=INFO

# Optional: custom path for scenario overrides file
SCENARIO_OVERRIDES_PATH=./scenario-overrides.json
```

**How to get Jira API token:**
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Copy the token and paste it into `.env` file

### Step 4: Start the server

```bash
python3 jira_server.py
```

You can override the environment values at launch time instead of editing `.env`:

```bash
python3 jira_server.py \
  --server_port 5050 \
  --jira_url https://your-company.atlassian.net \
  --jira_email your-email@company.com \
  --jira_token your-api-token-here \
```

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

CI will fail if `frontend/dist` is out of sync. We precompile JSX to avoid in-browser Babel in production.

You should see:
```
🚀 Jira Proxy Server starting...
📧 Using email: your-email@company.com
🔗 Jira URL: https://your-company.atlassian.net
📊 Board ID: 1234
📝 JQL Query: project IN (PROJECT1, PROJECT2) AND ...
💾 Cache expires after: 24 hours

📋 Endpoints:
   • http://localhost:<PORT>/api/tasks - Get sprint tasks
   • http://localhost:<PORT>/api/tasks-with-team-name - Get sprint tasks with a derived teamName field
   • http://localhost:<PORT>/api/dependencies - Get issue dependencies (POST)
   • http://localhost:<PORT>/api/issues/lookup?keys=KEY-1,KEY-2 - Lookup dependency issues (GET)
   • http://localhost:<PORT>/api/scenario - Scenario planner (GET/POST)
   • http://localhost:<PORT>/api/scenario/overrides - Scenario overrides (GET/POST)
   • http://localhost:<PORT>/api/sprints - Get available sprints (cached)
   • http://localhost:<PORT>/api/sprints?refresh=true - Force refresh sprints cache
   • http://localhost:<PORT>/api/boards - Get all boards (to find board ID)
   • http://localhost:<PORT>/api/config - Get public configuration
   • http://localhost:<PORT>/api/test - Test connection
   • http://localhost:<PORT>/api/tasks-fields?limit=5 - Get issues with all fields for JQL_QUERY
   • http://localhost:<PORT>/health - Health check

✅ Server ready! Open jira-dashboard.html in your browser (or visit http://localhost:5050/)
```

`<PORT>` will be `5050` by default, or whatever you set via `SERVER_PORT` in `.env` or the `--server_port` flag.

Jira API docs used:
- Issue search (JQL): https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get
- Field metadata: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-get

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

## 🔧 How it works

1. **Backend** (`jira_server.py`):
   - Runs on `localhost:5050` by default (overridable via `SERVER_PORT` or `--server_port`)
   - Reads credentials from `.env` file
   - Makes secure READ-ONLY API requests to Jira
   - Caches sprint list for 24 hours (reduces API load)
   - Returns filtered data to frontend

2. **Frontend** (`jira-dashboard.html`):
   - Displays tasks in a clean, animated interface
   - **Sprint Selector** - Dropdown to choose sprint (2025Q1, 2025Q2, etc.)
   - Auto-selects current quarter on first load
   - Sorted by priority (Highest → Lowest)
   - Filter toggles for Done/Killed/Tech/Product tasks
   - Dependency focus mode (chips highlight related tasks, missing deps shown inline)
   - Click stat cards to filter by status
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
- ✅ Keep your API token secure and don't share it
- ✅ All API requests are READ-ONLY (no modifications to Jira)
- ✅ No hardcoded company-specific URLs or IDs in code

## 🛠 Troubleshooting

**"Connection refused" error:**
- Make sure the Python server is running (`python3 jira_server.py`)

**"ModuleNotFoundError" when starting server:**
- Install dependencies: `python3 -m pip install --user flask flask-cors requests python-dotenv openpyxl "urllib3<2"`

**"JIRA_URL, JIRA_EMAIL and JIRA_TOKEN must be set" error:**
- Make sure you created `.env` file from `.env.example`
- Check that you filled in all required fields in `.env` (URL, email, token)

**"401 Unauthorized" error:**
- Check that your email and API token are correct in `.env`
- Verify your token hasn't expired

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

- **Tasks**: Click "Refresh Page" in the header (also refreshes ready-to-close data)
- **Sprints**: CMD+R/CTRL+R
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
├── docs/features/          # User-facing feature guides
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
- **Tasks and epics**: cached in server memory for repeated requests with the same sprint/group/project scope, and the UI also reuses the already loaded group state when possible.
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
- Postmortems live in `postmortem/` and follow `MRTXXX-short-title.md` naming in creation order (oldest first).
- Capture misses and fixes in postmortems and update the index when adding one.

## 🤝 Contributing

Feel free to open issues or submit pull requests!

## 📄 License

MIT License - feel free to use this project however you'd like!

## 🙏 Credits

Built with Flask, Python, React (via CDN), and Babel, plus vanilla JavaScript.
