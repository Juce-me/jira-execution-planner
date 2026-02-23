# Repository Guidelines

## Project Structure & Module Organization
- `jira_server.py` hosts the Flask API that talks to Jira and serves scenario planning data.
- `jira-dashboard.html` is the single-file frontend UI (HTML/CSS/JS) for the dashboard.
- `planning/` contains core scheduling logic (`models.py`, `scheduler.py`, `capacity.py`, `analysis.py`).
- `tests/` holds Python unit tests.
- `postmortem/` captures retrospectives, incidents, and misses; add learnings and follow-ups there.
- Postmortems use `MRTXXX-short-title.md` names, numbered by creation order (oldest first) and indexed in `postmortem/README.md`.
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

## Postmortem Learning
- Review relevant postmortems before making related changes.
- Incorporate the documented prevention steps to avoid repeating past issues.

## Sticky UI Layering
- Sticky order (top → bottom):
  - Planning panel (`.planning-panel.open`, when visible)
  - Epic header (`.epic-header`)
- Epic header must sit directly below the planning panel when planning is open.
- When planning is closed, epic header sticks to the top.
- If you change any sticky element, validate the order and spacing in Catch Up, Planning, and Scenario modes.

## Commit & Pull Request Guidelines
- Commit messages are short, imperative, and descriptive (examples: “Improve…”, “Fix…”, “Add…”).
- Keep subject lines concise; add context in the body if needed.
- PRs should include: a clear summary, testing steps, and screenshots for UI changes.
- Link relevant Jira issues or tickets when applicable.

## Security & Configuration Tips
- Store Jira credentials in `.env`; never commit secrets.
- `team-groups.json` and `sprints_cache.json` are local data caches—treat them as generated artifacts.
- **Test Data Security**: Test fixtures in `tests/fixtures/` may contain real Jira data (issue keys, summaries, API responses). Keep these files LOCAL ONLY:
  - Never commit fixture files containing actual Jira data to the repository
  - `tests/fixtures/.gitignore` blocks all JSON/CSV/XML by default
  - Use sanitized or synthetic data for committed examples (suffix: `-template.json` or `-example-sanitized.json`)
  - Tests that use real data must include warnings and be kept in local branches only
  - API keys, issue keys, team names, and project-specific information must remain local

## Debugging & Bug Fixes
- Before implementing any fix, confirm you understand the ROOT CAUSE by stating it back to the user. Do not fix surface-level symptoms. If a bug involves data fetching or configuration, check whether the issue is in user-configured settings vs hardcoded defaults before writing code.

## Project Architecture & API Notes
- This project uses: Backend (Python), Frontend (JavaScript/HTML). The Jira API integration uses nextPageToken/isLast pagination (NOT startAt/total). Always verify API response shapes before assuming pagination patterns.

## API Performance & Request Efficiency
- Initial page-load API requests are performance-critical. When changing frontend data loading or backend endpoints, treat load time as a first-class requirement.
- Target: fetching all data required for the initial dashboard render should complete in under 1 second when Jira/backend conditions are healthy. If that target is not met, call out the bottleneck and measure before/after.
- Avoid redundant API requests. If two requests return overlapping data, justify why both are needed (or refactor to combine, defer, or use a lighter endpoint).
- Do not reuse a heavy endpoint for lightweight UI needs if a narrower response can be introduced safely.
- When adding caching, document cache scope and invalidation/refresh behavior so performance fixes do not create stale-data bugs.

## Feature Implementation Rules
- When the user describes a concept or domain term (e.g., 'quarter'), ask for clarification on how it maps to existing data structures before implementing. Never assume a new UI element is needed if the concept might map to an existing one (e.g., sprint selector).

## Commit Message Guidelines
- Never write commit messages that claim results you haven't verified (e.g., 'optimized load time from 7.8s to 2s'). If you haven't measured the outcome, use neutral language like 'attempt to optimize' or 'refactor for performance'.

## UI & Styling Changes
- For UI/styling changes, implement ONE small change at a time and ask the user to verify before proceeding. Do not make sweeping visual changes in a single pass.

## Git Workflow Protocol
Follow this checklist for ALL work in this repo. No exceptions.

### PRE-FLIGHT (before any code changes)
1. Run `git status` and `git branch` — confirm clean working tree and correct branch
2. Run `git pull origin $(git branch --show-current)` — always sync first
3. Test SSH connectivity: `ssh -T git@github.com` — if it fails, STOP and give the user the fix command to paste. Do NOT attempt to fix SSH yourself.

### DURING WORK
4. Make atomic commits with honest messages describing ONLY what actually changed
5. Never claim a performance improvement without showing before/after measurements
6. After every 2-3 commits, run `git pull --rebase` to stay synced

### POST-WORK
7. Run the full test suite (`python3 -m unittest discover -s tests`) before final push
8. Run `git log --oneline -5` and show the user the commits for review
9. Only push after the user explicitly confirms
