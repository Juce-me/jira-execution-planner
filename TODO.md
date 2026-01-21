# Monday TODO

- ✅ Groups selector: ability to create groups of teams to better alignment if the scope is wide.
- Create a configuration of the env in the UI
- Scenario planner follow-ups (optional): scenario comparison/export.
- Scenario planner: add a small legend for blocked/excluded/quarter markers.
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

- Post-mortem: Scenario planner regressions (Resolved)
  - Symptom: Firefox timeouts, wrong dependency direction, and unreadable lane layouts in large views.
  - Root causes:
    - Scroll-linked updates (layout + edge recompute on every scroll tick) caused Firefox to time out.
    - Jira link direction handling relied on relation labels without normalizing inward/outward semantics.
    - Blocked links were not treated as scheduling prerequisites, allowing overlaps.
    - Full-bleed layout hacks caused width/overlay misalignment and brittle sizing.
    - Excluded items were packed into the same rows as active items, cluttering lanes.
  - Fix:
    - Throttle scroll/resize updates with requestAnimationFrame and cancel pending work on close.
    - Normalize link types into canonical prereq -> dependent edges.
    - Treat blocks/is blocked by as prerequisites in scheduling and edge rendering.
    - Use a stable full-bleed wrapper pattern for the Scenario section.
    - Stack excluded items separately to keep main lanes readable.
  - Prompt to avoid regressions:
    - "Any scroll-based layout/edge updates must be throttled with rAF."
    - "Normalize Jira link types (name/inward/outward) into prereq/dependent before scheduling/rendering."
    - "Blocked links must be treated as hard prerequisites, not just visual cues."
