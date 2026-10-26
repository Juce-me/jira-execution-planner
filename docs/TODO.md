# TODO

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

- Compact sticky header at 390px with two or more visible Department groups: the "Find in view" search field covers the "Catch Up" mode radio and blocks its click (found while building the two-group Playwright fixture for #267; the existing 390px sticky-heading test in `tests/ui/planning_review_integration.spec.js` stays on the one-group fixture until fixed). Needs a product fix with geometry checks on every sibling control of that header.

## Deferred
- Catch Up load speed (from the 2026-10-25 production HAR; the weekly charts in Settings -> Admin -> Performance only measure it): add a page-start-to-list metric with a `startOffsetMs`; static and JSON compression, early API prefetch and long-cache hashed bundle names; parallelise `/api/dependencies` and `/api/eng/story-readiness`; stop the alerts fetch duplicating the lane payloads.
- Performance report `trend` and the samples' `recordedAt` still bucket by the database session's date, so they are off by the session offset when it is not UTC; only `_week_start` is normalised.
- Performance Cache filter options come from the `cache_state` column, which is NULL for Catch Up rows, so the filter lists Board values only.
- Extract a shared weekly chart frame from `PerformanceBoardWeeks` and `PerformanceCatchUpWeeks` (they duplicate the axis, legend and readout code on purpose, to leave the Board file and its registered digest alone).
- Design-system Part 2 global hover foundation is implemented locally; acceptance remains open in [EXEC plan](plans/EXEC-design-system-part-2.md). Part 3 surface migration is implemented locally in its [EXEC plan](plans/EXEC-design-system-part-3.md); the original integrated verification passed; current hover-refinement evidence and the resolved WebKit search-clear test race are recorded there. Acceptance remains open. See [design](plans/SUPPORT-design-system-hover-contract-design.md).
- Design-system spec #3: shared Button, font-size/radius/spacing scales and JSX inline-style migration; separate follow-up. Keyboard-only focus behavior, keyframe deduplication and entrance animations remain deferred; touch actions stay required.
- Existing semantic-palette contrast debt: blue status fills, amber metadata, orange Missing pills, gold glyphs, expanded Add status and muted chart details retain recorded palettes. Planning List excluded Epics retain ancestor opacity 0.55 (painted text 2.27231:1, ring 2.06316:1), proven identical to the starting tree. Correct palette/dimming in separate scope; general new ordinary-button text/rings and icon glyphs keep strict measured contrast checks. See [design-system map](design-system.md).
- ENG hidden Initiative-grouping tooltip horizontal overflow — pre-existing on `main` at 755–1023 px (about 26 px); deferred under the user-approved #251 baseline exception on 2026-10-12. Freshness may add zero overflow, and the header regression isolates this tooltip while retaining absolute no-overflow checks elsewhere. Fix tooltip containment separately; preserve its visible hover/focus readout and shared filter controls. See `docs/plans/EXEC-dashboard-data-freshness-251.md`.
- Export improvements (CSV/PDF) — defer until core planning workflows are stable.
- Scenario planner `Publish to Jira` (write start/end dates back to Jira) — parked until draft/history/rollback flow is stable.
- Planning review table keyboard access — won't do for now (user decision 2026-10-02: keyboard users are not a priority; touch is). While the header is docked, the live header is a clone appended to the end of `<body>` and the real header is `aria-hidden`, so sort/move controls come after every row's controls in Tab order and focus can land on an invisible control or drop to `body`; the scroller's `tabIndex=0` makes the page jump on Tab; pinned chrome covers the focused control (no `scroll-padding`); no `aria-sort`; action lists use `role="dialog"` instead of `role="menu"`. Fix sketch: mount the clone just before `.planning-review-scroll`, make the real header `inert` while docked, drop the scroller's `tabIndex`, refocus the same column control after a dock flip, set `scroll-padding` from the dock measurement. Related: item 19 (Accessibility fixes) and `EXEC-planning-review-table-chrome-217.md`.
- Shareable view links v2 candidates (parked from issue #194): a Board Epic panel link (needs a Share action inside the modal panel and a request consumed after the Board columns contain the key), Board facets and Statistics display options in links, stored or short links with revocation and expiry (`docs/plans/FUTURE-db-additional-features.md`).
- Share control and pending-link keyboard polish — won't do for now (keyboard users are not a priority; touch is). The Share notice does not close on Escape, focus does not return to the Share control after Dismiss, and the fallback link field takes focus when it opens. Escape already cancels a pending link (the interaction guard ignores modifier and lock keys). Related: `frontend/src/shareView/ShareViewButton.jsx`, `frontend/src/shareView/interactionGuard.js`, `docs/plans/EXEC-shareable-view-links-194.md`.
