# TODO

## Now
- Scenario planner: add versioned draft history for saved overrides
  - Keep one active draft per sprint + team/group scope.
  - Save prior draft snapshots so the user can reload or roll back.
  - Add rollback/reload from saved scenario history before any Jira write-back.

## Config / Admin Follow-ups
- Access model: config tabs/settings admin-only; group config remains editable for non-admin users

## Multi-user / SSO
- Jira user OAuth (3LO) or explicit admin-service-account fallback policy

## Backlog Candidates

RICE = (Reach x Impact x Confidence) / Effort
- Reach: % of user sessions affected (1-10)
- Impact: 3=massive, 2=high, 1=medium, 0.5=low, 0.25=minimal
- Confidence: 100%, 80%, 50%
- Effort: person-weeks

| # | Item | Category | R | I | C | E (wks) | RICE |
|---|---|---|---|---|---|---|---|
| 12 | Centralize auth header construction | Backend | 2 | 0.5 | 100% | 0.25 | **4.0** |
| 14 | API integration tests | Backend | 3 | 2 | 80% | 2 | **2.4** |
| 19 | Accessibility fixes | Frontend | 4 | 1 | 80% | 2 | **1.6** |
| 20 | Extract service layer (backend) | Backend | 3 | 2 | 80% | 3 | **1.6** |
| 22 | JQL builder (replace regex) | Backend | 5 | 1 | 50% | 2 | **1.25** |
| 25 | Frontend tests | Frontend | 3 | 2 | 50% | 3 | **1.0** |

## Deferred
- Export improvements (CSV/PDF) — defer until core planning workflows are stable.
- Scenario planner `Publish to Jira` (write start/end dates back to Jira) — parked until draft/history/rollback flow is stable.
