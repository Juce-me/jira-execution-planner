# Jira Dashboard - Sprint Tasks Viewer

Simple local dashboard to display Jira sprint tasks sorted by priority with Python Flask backend.

## 🚀 Features

- ✅ Display tasks from specific sprint
- ✅ Sort by priority (Highest → Lowest)
- ✅ Filter by project and team
- ✅ Clean, minimalist UI
- ✅ Auto-refresh capability
- ✅ Secure credential management with .env

## 📋 Files

- `jira_server.py` - Python Flask backend server
- `jira-dashboard.html` - Frontend dashboard page
- `.env.example` - Template for environment variables
- `.gitignore` - Git ignore file (keeps secrets safe)
- `requirements.txt` - Python dependencies

## 🔧 Setup

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
JIRA_URL=https://criteo.atlassian.net
JIRA_EMAIL=your-email@criteo.com
JIRA_TOKEN=your-api-token-here
JQL_QUERY=project IN (PRODUCT, TECH) AND "Team[Team]" = 2feb0f65-1ec5-4461-88b1-0d6875d39f1c AND Sprint = 28773 ORDER BY priority DESC
```

**How to get Jira API token:**
1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Copy the token and paste it into `.env` file

### Step 4: Start the server

```bash
python3 jira_server.py
```

You should see:
```
🚀 Jira Proxy Server starting...
📧 Using email: your-email@criteo.com
🔗 Jira URL: https://criteo.atlassian.net
📝 JQL Query: project IN (PRODUCT, TECH) AND ...

📋 Endpoints:
   • http://localhost:5000/api/tasks - Get sprint tasks
   • http://localhost:5000/api/test - Test connection
   • http://localhost:5000/health - Health check

✅ Server ready! Open jira-dashboard.html in your browser
```

### Step 5: Open the dashboard

Open `jira-dashboard.html` in your browser. Tasks will load automatically!

## 🔧 How it works

1. **Backend** (`jira_server.py`): 
   - Runs on `localhost:5000`
   - Reads credentials from `.env` file
   - Makes API requests to Jira
   - Returns data to frontend

2. **Frontend** (`jira-dashboard.html`):
   - Displays tasks in a clean interface
   - Sorted by priority (Highest → Lowest)
   - Auto-loads on page open
   - Refresh button to update data

## 🔒 Security Notes

- ⚠️ **Never commit `.env` file to Git!** It contains your secrets
- ✅ The `.env` file is already in `.gitignore`
- ✅ Always use `.env.example` as a template for others
- ✅ Keep your API token secure and don't share it

## 🛠 Troubleshooting

**"Connection refused" error:**
- Make sure the Python server is running (`python3 jira_server.py`)

**"ModuleNotFoundError" when starting server:**
- Install dependencies: `python3 -m pip install --user flask flask-cors requests python-dotenv`

**"JIRA_EMAIL and JIRA_TOKEN must be set" error:**
- Make sure you created `.env` file from `.env.example`
- Check that you filled in all fields in `.env`

**"401 Unauthorized" error:**
- Check that your email and API token are correct in `.env`
- Verify your token hasn't expired

**"No tasks found":**
- Verify the JQL query matches your Jira setup
- Check that the sprint exists and has tasks
- Try simplifying the query in `.env`

**Browser shows old errors after fixing:**
- Do a hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Or open in incognito/private mode

## 📝 Customizing the query

To change the query, edit the `JQL_QUERY` in your `.env` file:

```env
# Simple query - all tasks from PRODUCT
JQL_QUERY=project = PRODUCT ORDER BY priority DESC

# Tasks from last 30 days
JQL_QUERY=project IN (PRODUCT, TECH) AND created >= -30d ORDER BY priority DESC

# Specific sprint (change sprint ID)
JQL_QUERY=project IN (PRODUCT, TECH) AND Sprint = YOUR_SPRINT_ID ORDER BY priority DESC
```

## 🔄 Updating tasks

Click the "Refresh" button on the dashboard to reload tasks from Jira.

## 📦 Project Structure

```
jira-dashboard/
├── jira_server.py          # Backend Flask server
├── jira-dashboard.html     # Frontend interface
├── requirements.txt        # Python dependencies
├── .env.example           # Environment variables template
├── .gitignore             # Git ignore file
├── install.sh             # Installation script
├── README.md              # This file
└── .env                   # Your credentials (NOT in git!)
```

## 🤝 Contributing

Feel free to open issues or submit pull requests!

## 📄 License

MIT License - feel free to use this project however you'd like!

## 🙏 Credits

Built with Flask, Python, and vanilla JavaScript.
