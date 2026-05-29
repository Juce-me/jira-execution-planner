# Codebase Operability Documentation Cleanup Slice

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Remove obsolete quickstart guidance, reclassify the May 1 structure plan as historical support context in place, and refresh contributor-facing structure/setup docs to match the current repo.

## Scope

- Replace `QUICKSTART_ENV.txt` with current virtualenv, DB/OAuth, preflight, and release-zip guidance.
- Update `README.md` structure and troubleshooting snippets that still point to legacy startup commands.
- Update `AGENTS.md` command references away from user-site pip and bare `python3 jira_server.py`.
- Mark `docs/plans/2026-05-01-codebase-structure-optimization.md` as support/history in place because the repository already forbids executing legacy date-only plans directly.

## Out Of Scope

- No backend runtime changes.
- No frontend source changes.
- No plan-file rename; in-place reclassification avoids a Git index move in this slice.

## Verification

- `.venv/bin/python -m unittest tests.test_env_config_docs tests.test_project_packaging`: passed 8 tests.
- `rg -n "pip install --user|JIRA_TOKEN|python3 jira_server.py" QUICKSTART_ENV.txt README.md AGENTS.md tests/README.md`: no matches.
