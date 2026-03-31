# CLAUDE.md

This file provides Claude-specific guidance for this repository.

`AGENTS.md` is the authoritative repo workflow and engineering guide. If `CLAUDE.md` and `AGENTS.md` ever differ, follow `AGENTS.md`.

## Working Rules

- Do not develop directly on `main`.
- Use the repo semantic branch prefixes from `AGENTS.md`:
  - `feature/` for new functionality
  - `bugfix/` for fixes
  - `improvement/` for refinements or refactors
  - `docs/` for documentation-only work
- Follow the full pre-flight, during-work, and post-work git checklist in `AGENTS.md`.
- Do not use the `using-git-worktrees` skill in this repository unless the user explicitly asks for a worktree.
- Keep `README.md`, `AGENTS.md`, and `CLAUDE.md` aligned when workflow or structure changes.

## Commands

```bash
# Install Python dependencies
python3 -m pip install --user -r requirements.txt

# Optional helper install
./install.sh

# Start backend (default port 5050)
python3 jira_server.py

# Frontend build
npm ci
npm run build
npm run watch

# Run tests
python3 -m unittest discover -s tests
```

## Repo Notes

- Frontend source lives in `frontend/src/`; committed build artifacts live in `frontend/dist/`.
- Jira pagination uses `nextPageToken` and `isLast`, never `startAt` and `total`.
- Sticky order is planning panel first, then epic header; validate Catch Up, Planning, and Scenario after sticky UI changes.
- Treat `team-groups.json`, `team-catalog.json`, and `sprints_cache.json` as generated local cache files.
- Before bug fixes, confirm the root cause back to the user instead of patching symptoms.
