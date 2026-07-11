# ENG Catch Up Targeted Task Updates Implementation Plan

> **Status:** Implemented and verified locally across commits `33990e8`, `8155e18`, `8a179df`, `73926dc`, `5af4cea`, `90e73bf`, `6936685`, and `9c3a5af`; kept as `EXEC-*` pending user review/merge.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change status or priority for one selected ENG Catch Up Epic, Story, or expanded Subtask without refreshing the task lists, while keeping multiple background writes bounded and ordered.

**Architecture:** Reuse the existing OAuth-bound status and priority write endpoints, which already return per-issue results. Catch Up applies an optimistic field patch to every in-memory ENG collection that can render the issue, submits through one shared queue capped at four concurrent requests and serialized per issue key, then reconciles the selected field from the response or rolls it back on failure. Planning retains its existing batch-and-refresh behavior; non-ENG surfaces remain read-only.

**Tech Stack:** React 19, existing Flask/Jira OAuth routes, browser `fetch`, Node `node:test`, Python `unittest`, Playwright, esbuild-generated `frontend/dist`.

## Global Constraints

- Keep writes OAuth-bound and protected by the existing token-bound CSRF plus `X-Requested-With` contract.
- Do not use Jira Basic credentials, Home/Townsquare APIs, service integrations, or local token stores for writes.
- Keep Catch Up status/priority updates scoped to one issue key per request.
- Bound browser mutation concurrency to four and serialize status/priority writes for the same issue key.
- Never trigger a Catch Up task-list refetch after a targeted write.
- Preserve Planning, EPM, Stats, Scenario, and Settings behavior.
- Include analytics impact review; no new event names are required because existing status/priority action events remain the canonical contract.

## File Map

Modify:

- `frontend/src/api/jiraIssueApi.js` — deduplicate concurrent CSRF token reads for background writes.
- `frontend/src/eng/useEngStatusTransitions.js` — optimistic Catch Up status update, queue submission, rollback, stale-result guards.
- `frontend/src/eng/useEngPriorityTransitions.js` — optimistic Catch Up priority update, queue submission, rollback, stale-result guards.
- `frontend/src/dashboard.jsx` — patch all ENG render collections and expanded subtask state; keep Planning refresh callbacks unchanged.
- `frontend/src/issues/IssueCard.jsx` — mark only the pending issue’s status/priority control busy.
- `frontend/src/issues/StatusTransitionMenu.jsx`, `frontend/src/issues/PriorityTransitionMenu.jsx` — preserve existing menu contracts while consuming per-issue pending state.
- `frontend/src/issues/useStorySubtasks.js` — expose a targeted local field patch helper.
- `docs/README_ANALYTICS.md` — document that no new analytics event is introduced and existing event names remain in use.
- `tests/test_frontend_api_source_guards.js`, `tests/test_planning_action_source_guards.js`, `tests/test_codebase_structure_budgets.py` — update source/size guards for the new wiring.
- `tests/ui/eng_status_transitions.spec.js`, `tests/ui/eng_priority_transitions.spec.js` — cover optimistic success, bounded rapid edits, rollback, and no task-list refetch.
- `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map` — regenerate with `npm run build`; never hand-edit.

Create:

- `frontend/src/eng/engIssueLocalUpdates.js` — pure helpers that patch one issue field across flat issue arrays, keyed Epic details, and expanded subtask maps.
- `frontend/src/eng/engIssueMutationQueue.js` — shared queue with global concurrency cap and same-key serialization.
- `tests/test_eng_issue_local_updates.js` — unit coverage for targeted immutable patches.
- `tests/test_eng_issue_mutation_queue.js` — unit coverage for concurrency and ordering.

## Task 1: Targeted patch helpers and mutation queue

**Files:** the two new frontend modules and their two Node tests.

- [x] Write failing tests for immutable one-issue patches, unchanged references for unrelated entities, and a queue that caps concurrency while serializing the same key.
- [x] Run `node --test tests/test_eng_issue_local_updates.js tests/test_eng_issue_mutation_queue.js`; the partial implementation was already present in the checkout, so the focused tests were used as the red/green verification boundary.
- [x] Implement the smallest pure patch helpers and queue API:

  ```js
  export function applyLocalIssueFieldUpdate(issues, issueKey, fieldName, fieldValue) { /* immutable one-key patch */ }
  export function applyLocalEpicDetailsFieldUpdate(epicDetails, issueKey, fieldName, fieldValue) { /* keyed patch */ }
  export function applyLocalSubtaskFieldUpdate(storySubtasksByKey, issueKey, fieldName, fieldValue) { /* nested patch */ }
  export function createIssueMutationQueue({ maxConcurrency = 4 } = {}) { /* enqueue(key, runner) */ }
  export function enqueueEngIssueMutation(issueKey, runner) { /* shared queue */ }
  ```

- [x] Re-run the two Node test files and confirm green.
- [x] Commit only these four new files with `git add ... && git commit -m "feat: add bounded ENG issue mutation primitives"`.

## Task 2: Wire optimistic Catch Up status and priority updates

**Files:** `useEngStatusTransitions.js`, `useEngPriorityTransitions.js`, `dashboard.jsx`, `IssueCard.jsx`, `useStorySubtasks.js`, both menu components, API wrapper, analytics note.

- [x] Add/extend source tests first to prove Catch Up does not call the existing scope refresh callbacks and that pending state is keyed by issue.
- [x] Run the focused Node/source tests and observe the expected failures.
- [x] In the status and priority hooks, apply the local field patch before enqueueing the one-key write; reconcile only the matching result; restore the captured prior value on transport or per-issue failure; suppress stale result/error state when the menu has moved to another issue.
- [x] Keep non-Catch Up execution on the existing path, including Planning’s batch refresh and affected-subtask refresh behavior.
- [x] In dashboard wiring, patch product/tech stories, Epic rows/details, ready-to-close lists, and expanded subtask state through the new pure helpers.
- [x] Pass pending issue-key sets to controls so only the active entity is disabled.
- [x] Deduplicate in-flight CSRF reads in `jiraIssueApi.js` so rapid writes share one token request.
- [x] Update the analytics note to state that existing canonical events are reused; do not introduce new event names or parameters.
- [x] Run focused Node/source tests and commit the implementation plus tests with `git commit -m "feat: apply ENG Catch Up updates per issue"`.

## Task 3: UI regression coverage for rapid background edits

**Files:** the two ENG Playwright specs.

- [x] Add fixture assertions that count task-list requests and expose delayed writes with in-flight/max-in-flight counters.
- [x] Add failing UI cases for two different issues edited rapidly, same-issue pending disablement, status/priority optimistic rendering, rollback on a failed write, and zero follow-up task-list/subtask fetches.
- [x] Run the focused Playwright files; the elevated rerun passed all 30 tests.
- [x] Commit only the UI test changes with `git commit -m "test: cover background ENG issue updates"`.

## Task 4: Build and repository verification

**Files:** generated frontend output and any narrowly required source guards.

- [x] Run `npm run build` and verify generated `frontend/dist` changes are limited to the build output.
- [x] Run `node --test` for all targeted source/unit suites and `.venv/bin/python -m unittest discover -s tests` for the Python suite.
- [x] Run `git diff --check`, inspect `git diff --stat`, and verify no secrets, absolute paths, or generated test artifacts are staged.
- [x] Commit generated output and guard-only changes across the task commits listed above.
- [x] Re-read this plan and record the completed local verification; leave the `EXEC-*` name until user review/merge.
