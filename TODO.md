# Monday TODO

- Groups selector: ability to create groups of teams to better alignment if the scope is wide.
- Create a configuration of the env in the UI
- Scenario planner follow-ups (optional): scenario comparison/export.
- rename to Jira Execution Planner (or think about better name)
- Config: decide on frontend bundling path
  - Full rewrite to vanilla JS (no React, no Babel, no CDN).
  - Keep React but bundle locally (no internet access, no source-map warning).

Whistles
- dark mode/company colors?

- Post-mortem: Missing teams in stats view (Resolved)
  - Symptom: Team selector and stats tables showed fewer teams than the JQL filter contained.
  - Root causes:
    - Team lists derived from returned issues/stats instead of the full Team[Team] filter list; teams with zero issues were omitted.
    - Team field ID resolution was inconsistent, causing teams to drop when fallback fields were used.
    - Cached stats + fresh UI state mixed together, masking missing teams during refresh.
  - Fix: Always scope teams to the configured Team[Team] IDs and use a single authoritative source for the team list (config/JQL), not issue-derived results.
  - Prompt to avoid regressions:
    - "Use Team[Team] IDs from the JQL filter as the authoritative team list. Never derive teams from returned issues. If a team has zero issues, still show it with zeros. Resolve Team[Team] field ID once and reuse it."
