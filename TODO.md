# TODO
- pack statistics bar to 6 in one row, right now it's 8. make it two row or one row (need to think how to fit 12 teams)
- Revisit sticky search UX (reverted experiment on `ui/sticky-search-always`)
  - Goal (still valid): search should be reachable in one move/click while scrolling, without breaking sticky layering.
  - Current failures from rejected attempt:
    - First attempt only styled the existing header search as sticky; it did not actually stick because `position: sticky` was inside `<header>` and bounded by that parent.
    - Second attempt added a separate sticky search shell below the header and kept a header placeholder search; this technically stuck, but UI became confusing (duplicate search fields / visual ambiguity).
    - Planning mode made the extra search treatment feel especially noisy and hard to parse (see rejected screenshot review).
  - Constraints to preserve (important):
    - Sticky stacking is fragile: planning panel > search (if made sticky) > epic header.
    - No overlap/intersection in Catch Up, Planning, Scenario.
    - No duplicate visible search controls.
    - Epic header sticky top must use measured offsets (no hardcoded px).
  - Recommended future approach:
    - Use a single search input only (no placeholder clone).
    - Move the real search control into a stable sticky container outside the short-lived header flow OR refactor the header layout so the search lives in a sticky-capable parent from the start.
    - Implement one mode at a time (first sticky positioning only, then shortcut like `Ctrl/Cmd+F`, then visual polish).
    - Validate manually in Planning mode before building additional behavior.

Whistles
- dark mode/company colors?

Tool-for-all phase (multi-user, internal SSO)
- Azure AD (Microsoft SSO) OIDC for login; enforce authenticated sessions in the Flask API.
- Per-user config storage (DB-backed): JQL, board, projects, team field; ship defaults as a template.
- Jira access via user OAuth (3LO) so data is scoped to the signed-in user; define admin fallback if needed.
- Multi-tenant caching + rate limits to protect Jira API and keep dashboards fast.
- Pack to Docker — requires in-app config + SSO first (manual .env edits inside a container defeat the purpose).
- Hosted deployment plan (Docker/VM/PaaS) with HTTPS, secrets management, and audit logging.

---

## RICE Prioritization (Backlog)

RICE = (Reach x Impact x Confidence) / Effort
- Reach: % of user sessions affected (1-10)
- Impact: 3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal
- Confidence: 100%, 80%, 50%
- Effort: person-weeks

| # | Item | Category | R | I | C | E (wks) | RICE |
|---|---|---|---|---|---|---|---|
| ~~1~~ | ~~Fix thread-safety in global caches~~ | ~~Backend~~ | ~~8~~ | ~~2~~ | ~~80%~~ | ~~0.5~~ | ~~**25.6**~~ |
| ~~2~~ | ~~Dockerize~~ (deferred to Tool-for-all) | ~~Backend~~ | ~~5~~ | ~~2~~ | ~~100%~~ | ~~0.5~~ | ~~**20.0**~~ |
| 3 | Replace `print()` with logging | Backend | 3 | 1 | 100% | 0.5 | **6.0** |
| 4 | Add retry + circuit breaker | Backend | 8 | 1 | 80% | 1 | **6.4** |
| 5 | React Query for data fetching | Frontend | 8 | 2 | 80% | 2 | **6.4** |
| 6 | Bulk actions UI | Feature | 6 | 2 | 80% | 2 | **4.8** |
| 7 | Virtual scrolling (large lists) | Frontend | 6 | 1 | 80% | 1 | **4.8** |
| 8 | Rate limiting | Backend | 3 | 1 | 80% | 0.5 | **4.8** |
| ~~9~~ | ~~In-app configuration UI~~ | ~~Feature~~ | ~~8~~ | ~~2~~ | ~~80%~~ | ~~3~~ | ~~**4.3**~~ |
| ~~10~~ | ~~Remove hardcoded Jira field IDs~~ | ~~Backend~~ | ~~5~~ | ~~2~~ | ~~80%~~ | ~~2~~ | ~~**4.0**~~ |
| 11 | Dark mode | Feature | 8 | 0.5 | 100% | 1 | **4.0** |
| 12 | Centralize auth header construction | Backend | 2 | 0.5 | 100% | 0.25 | **4.0** |
| 13 | Code splitting (lazy load panels) | Frontend | 8 | 0.5 | 80% | 1 | **3.2** |
| 14 | API integration tests | Backend | 3 | 2 | 80% | 2 | **2.4** |
| 15 | Export improvements (CSV/PDF) | Feature | 4 | 1 | 80% | 1.5 | **2.1** |
| 16 | Dependency graph visualization | Feature | 6 | 2 | 50% | 3 | **2.0** |
| 17 | Extract CSS from HTML | Frontend | 2 | 0.5 | 100% | 0.5 | **2.0** |
| 18 | Notifications / changelog | Feature | 7 | 1 | 50% | 2 | **1.75** |
| 19 | Accessibility fixes | Frontend | 4 | 1 | 80% | 2 | **1.6** |
| 20 | Extract service layer (backend) | Backend | 3 | 2 | 80% | 3 | **1.6** |
| 21 | Drag-and-drop scenario planner | Feature | 5 | 3 | 50% | 5 | **1.5** |
| 22 | JQL builder (replace regex) | Backend | 5 | 1 | 50% | 2 | **1.25** |
| 23 | Break frontend into components | Frontend | 3 | 3 | 80% | 6 | **1.2** |
| 24 | State management consolidation | Frontend | 3 | 2 | 80% | 4 | **1.2** |
| 25 | Frontend tests | Frontend | 3 | 2 | 50% | 3 | **1.0** |
| 26 | TypeScript migration | Frontend | 3 | 2 | 50% | 8 | **0.4** |

Quick wins (RICE > 4, effort <= 1 week): #3, 4, 8, 11, 12
High-value features (RICE > 4, effort > 1 week): #5, 6
Note: #23-24 score low but are prerequisites for most future frontend work.
