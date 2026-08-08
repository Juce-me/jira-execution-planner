# Deferred ENG Alert Loading Implementation Plan

> **Status:** Implemented with focused verification complete on 2026-08-08; broad-suite caveats are documented below. Pending acceptance or merge. Keep `EXEC-*` until accepted or merged.

**Goal:** Show the ENG task list or Board from the primary Jira responses without waiting more than eight seconds for alert-only enrichment, and run alert requests only while Catch Up is active.

**Architecture:** The normal `/api/tasks-with-team-name` response remains the visible-data request but skips story count/distribution enrichment. After both visible Product and Tech requests finish, Catch Up alone starts background `purpose=alerts`, missing-info, ready-to-close, and future-backlog requests; other ENG modes neither request nor render alerts.

**Tech Stack:** Flask, React 19, Node test runner, Playwright, Python `unittest`, esbuild.

## Global Constraints

- Preserve unrelated work already present in `frontend/src/dashboard.jsx` and generated assets.
- Do not change Jira issue selection, Board content, alert rules, or route authorization.
- Primary Product/Tech responses must not call `fetch_story_counts_for_epics` or `fetch_story_distribution_for_epics`.
- `purpose=alerts` must preserve the complete existing alert enrichment payload.
- Catch Up must render visible tasks before background alerts complete.
- Board, Planning, Statistics, and Scenario must not request `/api/missing-info`, `purpose=alerts`, ready-to-close data, or future-backlog alerts.
- No analytics event is added: this changes automatic request scheduling, not a user interaction or reportable product action.
- Do not commit, push, merge, or modify unrelated dirty files.

---

### Task 1: Separate visible task data from alert enrichment

**Files:**
- Modify: `jira_server.py`
- Test: `tests/test_create_stories_alert.py`

**Interfaces:**
- Consumes: existing `purpose` query parameter on `/api/tasks-with-team-name`.
- Produces: default/dashboard requests skip alert count/distribution; `purpose=alerts` retains the current full enrichment.

- [x] Add a failing backend test proving a normal task request never calls the two alert count/distribution helpers and an alerts-purpose request still calls them and returns their fields.
- [x] Run the focused test and confirm it fails for the expected unwanted normal-request enrichment.
- [x] Add the smallest request-purpose guard around the expensive enrichment block while preserving ready-to-close behavior and cache-key separation.
- [x] Run the focused alert and OAuth route tests with the repository virtual environment.

### Task 2: Defer and gate all Catch Up alerts

**Files:**
- Modify: `frontend/src/eng/useEngSprintData.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/api/engApi.js` only if the existing wrapper cannot express the contract
- Modify: `tests/test_dashboard_alert_source_guards.js`
- Modify: `tests/test_frontend_api_source_guards.js` only if the API wrapper changes
- Modify/Create: focused Playwright request-order coverage under `tests/ui/`
- Modify: `docs/features/alerts.md`
- Rebuild: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`

**Interfaces:**
- Consumes: Task 1's `purpose=alerts` backend behavior.
- Produces: visible task loaders resolve first; a Catch Up-only background loader refreshes alert epic data and starts the other alert sources.

- [x] Add failing source/unit and Playwright assertions for request ordering, Catch Up-only alert requests, and alert UI absence outside Catch Up.
- [x] Run the focused tests and confirm their expected failures.
- [x] Remove missing-info from the primary sprint-load effect, add a non-blocking alerts-purpose loader, and gate missing-info, ready-to-close, backlog, and alert rendering on Catch Up after primary Product/Tech completion.
- [x] Document progressive Catch Up alert loading and the no-analytics allowlist reason.
- [x] Run focused Node/Playwright tests, `npm run build`, the full Node and Python suites, then inspect the complete diff.

## Acceptance Criteria

- A normal task response does not include the measured `epic_counts_distribution` work.
- The Board can render as soon as its Product/Tech visible-data requests resolve.
- Catch Up shows tasks before alerts and fills alerts progressively.
- Every alert-related request is absent on first load into Board, Planning, Statistics, or Scenario.
- Existing alert categorization remains unchanged after the Catch Up background requests finish.
- Generated frontend output matches source and all required verification passes.

## Outcome

Implemented as planned. Default/dashboard task responses no longer enter Epic count/distribution enrichment. Catch Up waits for both visible task responses, then starts versioned background alert cohorts; stale cohorts cannot overwrite newer state, and leaving/re-entering Catch Up safely starts a replacement. Other ENG modes neither request nor render alerts.

Fresh verification on the final working diff:

- Focused backend/OAuth: 112 passed.
- Frontend alert source, API, transition, and Board guards: 101 passed.
- Alert request-order, mode-negative, metadata, cancellation, mutation, re-entry, race, backlog, and categorization Playwright coverage: 15 passed.
- Production frontend build: passed.
- Full Python baseline before the final frontend-only race fixes: 1,216 passed, 1 skipped. A fresh sandboxed run executed all 1,216 tests but three database-backed tests failed because access to the local PostgreSQL socket was denied; an approved socket-enabled retry stalled and was interrupted after a bounded wait.
- Full Node suite: 902 passed, 1 unrelated existing EPM `.stat-card` CSS guard failure; this plan changes no CSS source or that guard.

## Current Accuracy

Accurate. Implementation is the source of truth. The plan remains `EXEC-*` only because acceptance or merge has not yet occurred.
