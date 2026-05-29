# Codebase Operability Startup Preflight Slice

> **Status:** Implemented locally and verified on 2026-05-28. Keep as `EXEC-*` until acceptance or merge.

## Goal

Add an operator preflight command that diagnoses local runtime, auth, DB/config storage, token-encryption, and migration readiness before starting Flask.

## Source Plan

This covers the startup/preflight backlog row and the small storage-mode alias row from `docs/plans/FUTURE-codebase-operability-improvements.md`.

## Scope

- Add a preflight script under `scripts/`.
- Add `make preflight`.
- Document when to run the preflight from install/startup docs.
- Unify `CONFIG_STORAGE_BACKEND` DB aliases between config storage and DB engine parsing.

## Out Of Scope

- No Flask app-factory extraction.
- No backend route/service extraction.
- No frontend behavior changes.
- No Home/Townsquare write route or mutation UI.

## Verification

- `.venv/bin/python -m unittest tests.test_startup_preflight tests.test_config_storage_selector tests.test_project_packaging`: passed 12 tests.
- `.venv/bin/python scripts/check_startup_preflight.py`: passed runtime/auth/storage/encryption checks and reported `FAIL migrations: Database is unavailable or migrations are not at head.` for the local DB/OAuth environment.
- `JIRA_AUTH_MODE=basic JIRA_URL=https://example.atlassian.net JIRA_EMAIL=user@example.com JIRA_TOKEN=synthetic-token CONFIG_STORAGE_BACKEND=jsonfile make preflight`: passed all checks in synthetic JSON-file mode.
