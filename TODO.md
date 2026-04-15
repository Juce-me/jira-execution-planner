# TODO

## Now
- Scenario planner: add versioned draft history for saved overrides
  - Store multiple named scenarios per sprint + team/group instead of a single override blob.
  - Add rollback/reload from saved scenario history before any Jira write-back.
- Scenario planner: follow up on excluded-capacity styling
  - excluded bars must never stretch across sprint boundaries;
  - they should stack in dedicated lower lanes when overlap exceeds a sprint;
  - render excluded capacity in gray and keep it visually at the bottom of the epic/assignee stack.

## Config / Admin Follow-ups
- Empty Epic alert configuration in settings
  - excluded statuses + optional team scope
- Access model: config tabs/settings admin-only; group config remains editable for non-admin users

## Multi-user / SSO
- Azure AD (Microsoft SSO) OIDC login + authenticated API sessions
- Per-user config storage (DB-backed) with company defaults
- Jira user OAuth (3LO) or explicit admin-service-account fallback policy
- Multi-tenant caching + rate limits
- Hosted deployment plan (Docker/VM/PaaS) with HTTPS, secrets, audit logging

## Backlog Candidates

RICE = (Reach x Impact x Confidence) / Effort
- Reach: % of user sessions affected (1-10)
- Impact: 3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal
- Confidence: 100%, 80%, 50%
- Effort: person-weeks

| # | Item | Category | R | I | C | E (wks) | RICE |
|---|---|---|---|---|---|---|---|
| 5 | React Query for data fetching | Frontend | 8 | 2 | 80% | 2 | **6.4** |
| 7 | Virtual scrolling (large lists) | Frontend | 6 | 1 | 80% | 1 | **4.8** |
| 8 | Rate limiting | Backend | 3 | 1 | 80% | 0.5 | **4.8** |
| 11 | Dark mode | Feature | 8 | 0.5 | 100% | 1 | **4.0** |
| 12 | Centralize auth header construction | Backend | 2 | 0.5 | 100% | 0.25 | **4.0** |
| 13 | Code splitting (lazy load panels) | Frontend | 8 | 0.5 | 80% | 1 | **3.2** |
| 14 | API integration tests | Backend | 3 | 2 | 80% | 2 | **2.4** |
| 16 | Dependency graph visualization | Feature | 6 | 2 | 50% | 3 | **2.0** |
| 18 | Notifications / changelog | Feature | 7 | 1 | 50% | 2 | **1.75** |
| 19 | Accessibility fixes | Frontend | 4 | 1 | 80% | 2 | **1.6** |
| 20 | Extract service layer (backend) | Backend | 3 | 2 | 80% | 3 | **1.6** |
| 22 | JQL builder (replace regex) | Backend | 5 | 1 | 50% | 2 | **1.25** |
| 23 | Break frontend into components | Frontend | 3 | 3 | 80% | 6 | **1.2** |
| 24 | State management consolidation | Frontend | 3 | 2 | 80% | 4 | **1.2** |
| 25 | Frontend tests | Frontend | 3 | 2 | 50% | 3 | **1.0** |
| 26 | TypeScript migration | Frontend | 3 | 2 | 50% | 8 | **0.4** |

Quick wins (RICE > 4, effort <= 1 week): #7, #8, #11, #12
High-value features (RICE > 4, effort > 1 week): #5

## Deferred
- Export improvements (CSV/PDF) — defer until core planning workflows are stable.
- Scenario planner `Publish to Jira` (write start/end dates back to Jira) — parked until draft/history/rollback flow is stable.
