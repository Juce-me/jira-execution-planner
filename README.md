# Jira Dashboard - Sprint Tasks Viewer

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
- ✅ **Epic grouping** - Stories grouped under their epic with assignee and story-point totals
- ✅ **Planning rollups** - Selected story points summarized per team, project, and overall
- ✅ **Capacity planning** - Team capacity vs planning capacity (exclusions via epic toggle)
- ✅ **Alerts** - Panels for Missing Story Points, Blocked, Missing Epic, Empty Epic, and “Epic Ready to Close” (rules: `ALERT_RULES.md`, ready-to-close uses all-time data)
- ✅ **Sprint statistics** - Teams/Priority views with product/tech split, derived from loaded sprint tasks (with epic include/exclude toggle)

## 📋 Files

- `jira_server.py` - Python Flask backend server
- `jira-dashboard.html` - Frontend dashboard page
- `.env.example` - Template for environment variables
- `.gitignore` - Git ignore file (keeps secrets safe)
- `requirements.txt` - Python dependencies

## 🔧 Setup

### Quick test run (TL;DR)

If you just want to see the dashboard working locally:
1. Install dependencies: `python3 -m pip install --user -r requirements.txt`
2. Copy the env template: `cp .env.example .env`
3. Edit `.env` and set **JIRA_URL**, **JIRA_EMAIL**, **JIRA_TOKEN**, and **JQL_QUERY** (leave the sample JQL if it already fits your projects/teams).
4. Start the backend: `python3 jira_server.py`
5. Visit `http://localhost:5050/api/test` in your browser to confirm connectivity.
6. Open `jira-dashboard.html` in your browser to view the UI. Tasks should load automatically using your JQL and sprint selection.

More detailed setup guidance remains below if you need it.

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
pip3 install --user flask flask-cors requests python-dotenv
```

**Option C - Using python3 directly (if pip3 not available):**
```bash
python3 -m pip install --user flask flask-cors requests python-dotenv
```

### Step 3: Configure credentials

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

# JQL Query to filter tasks (customize based on your needs)
JQL_QUERY=project IN (PROJECT1, PROJECT2) AND issuetype = Story ORDER BY priority DESC

# Optional: Board ID for faster sprint fetching (leave empty if unknown)
JIRA_BOARD_ID=

# Optional: Team custom field id (e.g. customfield_12345) if Team values are missing
JIRA_TEAM_FIELD_ID=

# Optional: priority weights for stats (done/incomplete)
STATS_PRIORITY_WEIGHTS=Blocker:0.40,Critical:0.30,Major:0.20,Minor:0.06,Low:0.03,Trivial:0.01

# Optional: capacity planning (team capacity project + field id)
CAPACITY_PROJECT=
CAPACITY_FIELD_ID=
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
  --jira_query 'project IN (PROJECT1, PROJECT2) AND issuetype = Story'
```

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
   • http://localhost:<PORT>/api/sprints - Get available sprints (cached)
   • http://localhost:<PORT>/api/sprints?refresh=true - Force refresh sprints cache
   • http://localhost:<PORT>/api/boards - Get all boards (to find board ID)
   • http://localhost:<PORT>/api/config - Get public configuration
   • http://localhost:<PORT>/api/test - Test connection
   • http://localhost:<PORT>/api/tasks-fields?limit=5 - Get issues with all fields for JQL_QUERY
   • http://localhost:<PORT>/health - Health check

✅ Server ready! Open jira-dashboard.html in your browser
```

`<PORT>` will be `5050` by default, or whatever you set via `SERVER_PORT` in `.env` or the `--server_port` flag.

Jira API docs used:
- Issue search (JQL): https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get
- Field metadata: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-get

### Step 5: Open the dashboard

Open `jira-dashboard.html` in your browser. Tasks will load automatically!

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
   - Click stat cards to filter by status
   - Refresh buttons for tasks and sprints
   - Ready-to-close alert uses all-time story data (no sprint filter)
   - Statistics panel for active/closed sprints (derived from loaded sprint tasks)

## 🎯 Sprint Selection

The dashboard supports dynamic sprint selection:

1. **Auto-detection**: Automatically selects current quarter (e.g., 2025Q4)
2. **Dropdown**: Choose from available sprints starting from 2025Q1
3. **Caching**: Sprint list cached for 24 hours for fast loading
4. **Refresh button**: Manually update sprint list from Jira
5. **Two fetch methods**:
   - Fast: Via Board API (requires `JIRA_BOARD_ID` in .env)
   - Fallback: Via Issues API (uses `STATS_JQL_BASE` if set, otherwise `JQL_QUERY`)

## 📊 Sprint Statistics

The Statistics panel focuses on active or completed (closed) quarter sprints:

- Uses the same loaded sprint tasks as the list below (no separate stats fetch).
- Stats are available for active and completed sprints; future sprints disable the panel.
- Teams view shows product/tech split and delivery rates by team.
- Priority view aggregates Done vs Incomplete by priority (no team dimension).
- Incomplete = any status except `Done` or `Killed` (killed is excluded from rate calculations).
- Epic include/exclude toggle appears under each epic while Stats is open (selection persists locally).

## 🧮 Capacity Planning

Capacity planning uses the loaded sprint tasks plus a separate Jira project for team capacity:

- **Team capacity**: pulled from the capacity project using `CAPACITY_PROJECT` and `CAPACITY_FIELD_ID`.
- **Planning capacity**: team capacity minus excluded epic story points (same epic include/exclude toggle).
- **Split**: estimated capacity split is 70% Product / 30% Tech.

Priority weights used for weighted delivery:
- Blocker 0.40
- Critical 0.30
- Major 0.20
- Minor 0.06
- Low 0.03
- Trivial 0.01

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
- Install dependencies: `python3 -m pip install --user flask flask-cors requests python-dotenv`

**"JIRA_URL, JIRA_EMAIL and JIRA_TOKEN must be set" error:**
- Make sure you created `.env` file from `.env.example`
- Check that you filled in all required fields in `.env` (URL, email, token)

**"401 Unauthorized" error:**
- Check that your email and API token are correct in `.env`
- Verify your token hasn't expired

**"No tasks found":**
- Verify the JQL query matches your Jira setup
- Check that the sprint exists and has tasks
- Try simplifying the query in `.env`

**"Team name missing" in tasks output:**
- Set `JIRA_TEAM_FIELD_ID` in `.env` (use the Team[Team] custom field id, e.g. `customfield_12345`)

**"No sprints available" in dropdown:**
- Option 1: Set `JIRA_BOARD_ID` in `.env` file (faster method)
  - Find your board ID: go to `/api/boards` endpoint or check Jira board URL
- Option 2: Leave `JIRA_BOARD_ID` empty (fallback method works automatically)
- Check that your JQL query returns tasks with sprint information

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

## 📝 Customizing the query

To change the query, edit the `JQL_QUERY` in your `.env` file:

```env
# Simple query - all stories from PROJECT1
JQL_QUERY=project = PROJECT1 AND issuetype = Story ORDER BY priority DESC

# Multiple projects
JQL_QUERY=project IN (PROJECT1, PROJECT2) AND issuetype = Story ORDER BY priority DESC

# Filter by assignee
JQL_QUERY=project = PROJECT1 AND assignee = currentUser() ORDER BY priority DESC

# Tasks from last 30 days
JQL_QUERY=project = PROJECT1 AND created >= -30d ORDER BY priority DESC
```

**Note**: Don't include `Sprint = ID` in your JQL - the app adds it automatically based on dropdown selection (ready-to-close ignores sprint filtering). Statistics use the same loaded sprint tasks.

## 🔄 Updating data

- **Tasks**: Click "Refresh Page" in the header (also refreshes ready-to-close data)
- **Sprints**: Click "Refresh Sprints" button next to sprint dropdown
- **Auto-reload**: Tasks reload automatically when you change sprint selection
- **Stats**: Open Statistics panel; results update automatically as tasks load or epics are included/excluded

## 📦 Project Structure

```
jira-dashboard/
├── jira_server.py          # Backend Flask server with caching
├── jira-dashboard.html     # Frontend interface with sprint selector
├── requirements.txt        # Python dependencies
├── .env.example           # Environment variables template
├── .gitignore             # Git ignore file (includes .env and cache)
├── install.sh             # Installation script
├── README.md              # This file
├── .env                   # Your credentials (NOT in git!)
├── sprints_cache.json     # Sprint cache (auto-generated, NOT in git!)
└── tasks.test.local.json  # Local task snapshots (optional, NOT in git!)
```

## 🚀 Performance & Caching

The application uses intelligent caching to minimize Jira API load:

- **Sprint list cached for 24 hours** - After first load, sprints load instantly
- **Cache file**: `sprints_cache.json` (auto-generated, not committed to git)
- **Manual refresh**: Use "Refresh Sprints" button or `?refresh=true` parameter
- **Live task data**: Stories/epics are fetched fresh on each refresh (no cache)
- **Stats**: Derived from loaded sprint tasks (no stats cache)
- **Reduced API calls**: Jira queries are capped (200 for sprint discovery, 250 for task fetches)
- **Timeout protection**: Jira requests use 20–30 second timeouts

## 🤝 Contributing

Feel free to open issues or submit pull requests!

## 📄 License

MIT License - feel free to use this project however you'd like!

## 🙏 Credits

Built with Flask, Python, React (via CDN), and Babel, plus vanilla JavaScript.
