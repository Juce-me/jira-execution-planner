# Codebase Operability Import-Safe Startup Slice

> **Status:** Done. Executed in PR #54 (`879ad59`). Kept for audit context only.

## Goal

Make Flask app construction explicit and keep startup validation in the launch path instead of import time.

## Scope

- Stop database/config startup validation from running during `import jira_server`.
- Have `jira_server.py` call `create_app()` explicitly instead of importing a prebuilt app object.
- Stop `backend.app` from creating a global app at module import.
- Add tests for import-safe behavior and explicit app creation.

## Out Of Scope

- No route extraction or service extraction.
- No request/response contract changes.
- No static asset path changes.

## Verification

- `.venv/bin/python -m unittest tests.test_app_startup tests.test_network_bind_guards tests.test_project_packaging`: passed 14 tests.
- `.venv/bin/python -m unittest tests.test_backend_route_source_guards tests.test_endpoint_policy_inventory tests.test_oauth_jira_client`: passed 29 tests.
