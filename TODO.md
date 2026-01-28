# Monday TODO

- Frontend build (chosen): esbuild bundle with React included; compiled output committed to `frontend/dist`.
- Create a configuration of the env in the UI
- Scenario planner follow-ups (optional): scenario comparison/export.
- Scenario planner: add a small legend for blocked/excluded/quarter markers.
- Config: keep React but bundle locally (no internet access, no runtime Babel).
- Pack to Docker.
- CI/CD + multi-user deployment ideation:
  - Shared instance for many users (secrets, API key strategy, config storage/sharing).

Whistles
- dark mode/company colors?

Tool-for-all phase (multi-user, internal SSO)
- Azure AD (Microsoft SSO) OIDC for login; enforce authenticated sessions in the Flask API.
- Per-user config storage (DB-backed): JQL, board, projects, team field; ship defaults as a template.
- Jira access via user OAuth (3LO) so data is scoped to the signed-in user; define admin fallback if needed.
- Multi-tenant caching + rate limits to protect Jira API and keep dashboards fast.
- Hosted deployment plan (Docker/VM/PaaS) with HTTPS, secrets management, and audit logging.
