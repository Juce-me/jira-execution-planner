# Repository Guidelines

## Project Structure & Module Organization
- `jira_server.py` hosts the Flask API that talks to Jira and serves scenario planning data.
- `jira-dashboard.html` is the single-file frontend UI (HTML/CSS/JS) for the dashboard.
- `planning/` contains core scheduling logic (`models.py`, `scheduler.py`, `capacity.py`, `analysis.py`).
- `tests/` holds Python unit tests.
- `postmortem/` captures retrospectives, incidents, and misses; add learnings and follow-ups there.
- Config and reference files: `ALERT_RULES.md`, `requirements.txt`, `install.sh`, `.env.example`.
- Keep `AGENTS.md`, `README.md`, and other contributor docs aligned with structural or workflow changes so this stays a universal development guide.

## Build, Test, and Development Commands
```bash
# Install Python dependencies
python3 -m pip install --user -r requirements.txt

# (Optional) Use the helper installer
./install.sh

# Start the backend (default port 5050)
python3 jira_server.py

# Quick API check
curl http://localhost:5050/api/test
```
Open `jira-dashboard.html` in a browser to view the UI.

## Coding Style & Naming Conventions
- Python: 4-space indentation, PEP 8–style names (`snake_case` functions, `CapWords` classes).
- Frontend JS: `camelCase` for variables/functions, `PascalCase` for components where applicable.
- Config keys in `.env` are `UPPER_SNAKE_CASE`.
- No formatter or linter is enforced; match existing style in touched files.

## Testing Guidelines
- Tests use the standard library `unittest` framework in `tests/`.
- Naming: `tests/test_*.py` with `TestCase` classes and `test_*` methods.
- Run all tests:
```bash
python3 -m unittest discover -s tests
```

## Commit & Pull Request Guidelines
- Commit messages are short, imperative, and descriptive (examples: “Improve…”, “Fix…”, “Add…”).
- Keep subject lines concise; add context in the body if needed.
- PRs should include: a clear summary, testing steps, and screenshots for UI changes.
- Link relevant Jira issues or tickets when applicable.

## Security & Configuration Tips
- Store Jira credentials in `.env`; never commit secrets.
- `team-groups.json` and `sprints_cache.json` are local data caches—treat them as generated artifacts.
