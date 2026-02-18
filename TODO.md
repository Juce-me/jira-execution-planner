# TODO
- pack statistics bar to 6 in one row, right now it's 8. make it two row or one row (need to think how to fit 12 teams)
- Create a configuration of the env in the UI.

Whistles
- dark mode/company colors?

Tool-for-all phase (multi-user, internal SSO)
- Azure AD (Microsoft SSO) OIDC for login; enforce authenticated sessions in the Flask API.
- Per-user config storage (DB-backed): JQL, board, projects, team field; ship defaults as a template.
- Jira access via user OAuth (3LO) so data is scoped to the signed-in user; define admin fallback if needed.
- Multi-tenant caching + rate limits to protect Jira API and keep dashboards fast.
- Pack to Docker — requires in-app config + SSO first (manual .env edits inside a container defeat the purpose).
- Hosted deployment plan (Docker/VM/PaaS) with HTTPS, secrets management, and audit logging.
