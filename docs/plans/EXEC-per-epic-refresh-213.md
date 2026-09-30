# Per-Epic Refresh With Glare Implementation Plan (Issue #213)

> **Status:** Proposed on 2026-09-30 from baseline `main` at `3622ba22`; not started. Approved design: `docs/agents/features/2026-09-29-planned-per-epic-refresh-with-glare.md` (read it first; this plan implements it and does not restate its rationale).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hover-revealed button on each ENG epic header (Catch Up, then Planning) refreshes that one epic's stories and epic info from Jira under the user's own token, patches the view in place, re-checks that epic's alerts only, and plays a subtle amber glare on the cards that changed.

**Architecture:** One new backend purpose (`purpose=epic-refresh` on `GET /api/tasks-with-team-name`) returns the epic's stories and details without the empty-epic scan. A pure merge/diff module decides what changed. A testable controller owns guards, races, per-lane semantics and feedback; a thin hook and an `EpicRefreshButton` mount it in `renderEpicBlock`. Alerts are refreshed per epic in three slices (A client-derived, B epic-scoped alert object and Ready to Close, C missing-info, backlog and Stories Required) through `epicKeys` variants of existing routes.

**Tech Stack:** Python 3.10+ / Flask / unittest; React 19 ES modules; Node 20 `node --test`; Playwright; esbuild; CSS.

## Global Constraints

Every task's requirements include this section. Values are copied from the approved design.

- Manual only: no polling, no background requests, nothing persisted (no `localStorage`, private view or shared config).
- Scope: Catch Up and Planning; Planning is enabled last (Task 13). The alerts panel exists only in Catch Up; a Planning refresh issues zero alert requests.
- Button placement (user-approved, 2026-09-30): absolutely positioned over the epic header's upper-right corner, `position:absolute; top:4px; right:6px`, inside the sticky `.epic-header`. It may cover the end of the right-most item while shown. It causes no layout change. At 760 px and below, `.epic-title-row` gets `padding-right:32px` so the Planning stat toggle is never covered.
- Reveal: opacity-hidden until hover or focus within the header; always visible under `@media (hover:none)`; forced visible while busy or in error. Busy uses `aria-disabled="true"` and `aria-busy="true"`, never `disabled`.
- Progress mark: the EPM burst (`epm-burst.svg`, classes `.loading-mark-spinner` and `.loading-mark-signature`) in a new `LoadingMark` at 16 px; shown at least 400 ms; rotation stops under `prefers-reduced-motion`. `LoadingState` and `tests/test_epm_view_source_guards.js` stay untouched.
- No whole-screen loading state; no flip of `loading`, `productTasksLoading` or `techTasksLoading`; no global banner from a refresh failure other than the existing connection-failure handler for a real network outage.
- No wipes: values are replaced in place. A card that enters uses `task-appear` then glints; a card that leaves dissolves with exactly `is-removing`, `task-remove-dissolve`, 0.24 s.
- Glare (specimen variant A): amber edge, 1800 ms, intensity 0.5, ring 1.5 px, beam width 22, sweep down the page (`delay = 0.4 ms per px below the sticky stack`); static border tint under reduced motion at opacity 0.6 for at least 900 ms. Cap 8 cards, in viewport and mounted only, never for the user's own edits (last 10 s), the global Refresh or the initial load. Mechanism is the `data-glare` attribute on `.task-item` (React owns `className`), a `::before` ring (`::after` is taken), no `overflow:hidden`.
- No `rearmCatchUpAlerts`, `loadGroupTasks` or `applyLocalEngIssueField` in any refresh code path. `tests/test_dashboard_alert_source_guards.js` pins the exact count of `rearmCatchUpAlerts` call sites and must stay green.
- Failure copy is fixed text; never show `details`, `jql_used` or `err.message`.
- Every request after a click carries `epicKeys=<that key>` (or is on the explicit allowlist: the epic's own dependency keys).
- Budgets (`tests/test_codebase_structure_budgets.py`): `jira_server.py` 6463, `frontend/src/dashboard.jsx` 18213 (actual 18198). Raise a budget only deliberately, with an itemized comment in the existing style.
- Accepted limitation: a story moved out of the epic appears in its new epic only after that epic, or a department-wide Refresh, is refreshed. Merging is by story key so a moved story is never duplicated.
- Environment: Python via `.venv/bin/python` with the CI env `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile` (Makefile `PYTHON_TEST_ENV`); Node 20 via `fnm exec --using 20`; run `npm ci` before `npm run build`; Playwright per spec with `--workers=1`; `frontend/dist` is only ever built by the orchestrator and committed once, in Task 14.
- Git: branch `feature/213-per-epic-refresh`; no agent or tool attribution anywhere (no `Co-Authored-By`, no "Generated with" footers, in commits or PR text); subagents never push or open a PR; publication follows the AGENTS.md publication transaction and needs explicit user confirmation.

## Execution Protocol (subagent-driven)

- The session already runs in a worktree; do not create another (repo rule). Parallel tasks in the same wave run in this one tree on **disjoint files** (the file maps below guarantee that) and never build `frontend/dist`.
- Subagents do **not** commit. After a task's spec-compliance review and code-quality review both pass and the orchestrator has re-run the task's verification itself, the orchestrator stages only that task's files and commits, then reads `git show --stat HEAD` and `git status` (Gate A) before the next commit.
- Each subagent prompt must include: the task text, the Global Constraints, the named "Read first" ranges, the exact file list it may touch, the verification commands, and "no attribution trailers, no push".
- Waves: T0 inline; Wave 1 = T1, T2, T3, T4 in parallel; Wave 2 = T5 then T6 then T7 sequentially; Wave 3 = T8, T9, T10 in parallel; Wave 4 = T11 then T12; Wave 5 = T13; Final = T14. A failing review sends the task back to a fresh subagent with the reviewer's findings.
- After two failed attempts on the same task, stop and ask the user (AGENTS.md).
- Line numbers in "Read first" are approximate (tree at `3622ba22`); locate by symbol.

## Baseline (filled by Task 0, step 5)

| Suite | Command | Recorded result |
|---|---|---|
| Python | `make test` | count and time recorded at T0 |
| Security | `make test-security` | recorded at T0 |
| Node unit | `fnm exec --using 20 npm run test:frontend:unit` | recorded at T0 |
| Playwright (affected specs, `--workers=1`) | see Task 7 step 8 | known failures from issue #210: `eng_priority_transitions`, `planning_selection_defaults`, two `load_performance` |

## Endpoint Contract Matrix

| Route | Method and auth | Added input | Success body | Errors |
|---|---|---|---|---|
| `/api/tasks-with-team-name` `purpose=epic-refresh` | GET, `authenticated_read`, no CSRF, OAuth per-user token or local Basic | requires `sprint` (digits), `project` (`product` or `tech`), `epicKeys` (exactly one, `^[A-Z][A-Z0-9_]+-\d+$`), plus group team scope | normal issue list plus `epics` for the requested key, `epicsInScope: []`, `capped`, `epicKeysMissing` | 400 `invalid_epic_refresh`; 400 `invalid_epic_keys`; 403 `missing_project_access` per lane; 429 `epic_refresh_rate_limited` with `retryAfterSeconds` and `Retry-After`; 401 lock; 500/502/503 |
| same, `purpose=epic-alerts` (Task 9) | same | same as above | `{epicsInScope: [<enriched epic> or none]}` | same |
| same, `purpose=ready-to-close` (existing) | same | existing; `epicKeys` gets the format check | existing | existing; 400 `invalid_epic_keys` |
| `/api/missing-info` (Task 10) | GET, `authenticated_read` | `epicKeys` (one), `refresh` | existing shape scoped to the epic | 400 `invalid_epic_keys` |
| `/api/backlog-epics` (Task 10) | GET, `authenticated_read` | `epicKeys` (one) | existing shape scoped to the epic | 400 |
| `/api/eng/story-readiness` (Task 10) | GET, `authenticated_read` | `epicKeys` (one) | existing shape scoped to the epic | 400 |
| `/api/dependencies` | POST, `X-Requested-With` in OAuth mode | `refresh`; key format check | existing | 400 |

No new route: no `ENDPOINT_POLICIES` entry; `make test-security` still runs.

## State-Machine Checklist (per epic)

States: `idle` → `busy` → `idle` (applied or unchanged) | `idle` (discarded) | `error` (shown until next interaction).
Transitions and required tests:
- Click ignored while busy, in cooldown (10 s), at 2 in flight, or blocked by a guard (loading flags, `manualRefreshDisabled`, `!tasksFetched`, stale sprint, alert cohort in flight, strict Board active, open menu or editor on that epic).
- Global Refresh, scope change, or sprint change during `busy`: result discarded, no state change, no announcement.
- Lane `ok`: applied. Lane `denied` (403): untouched, silent. Lane `failed` or `rate_limited`: untouched, `error`. Lane `capped` or details missing: no removals inferred.
- Pending, leaving, editor-active or changed-since-click keys: kept as held.
- User-removed cards: never re-added. 401: existing sign-in lock, no extra UI.

## Shared Interfaces (exact names used across tasks)

Backend (`backend/services/epic_refresh.py`, Task 1): `EPIC_REFRESH_PURPOSE = 'epic-refresh'`, `ISSUE_KEY_RE`, `parse_epic_keys(raw) -> list[str]`, `epic_keys_error(args) -> dict | None`, `class EpicRefreshLimiter(min_interval_seconds=8.0, clock=time.monotonic, max_entries=2048)` with `retry_after(scope_key, epic_key) -> int`, `response_meta(issue_count, max_results, requested_keys, epic_details) -> dict`, `evict_scope_entries(cache, lock, key_for_purpose, purposes=('dashboard','alerts'))`. Task 9 adds `fetch_epic_alert_bundle(...)` and `apply_epic_enrichment(...)` to the same module.

Frontend pure modules:
- `frontend/src/eng/epicRefreshPatch.js` (Task 2): `STORY_DISPLAYED_FIELDS`, `EPIC_DISPLAYED_FIELDS`, `normalizeStory(issue)`, `diffStory(held, fetched) -> {changedFields, silent, equal}`, `mergeEpicStories({held, fetched, epicKey, laneApplied, capped, detailsMissing, protectedKeys, clickSnapshot, userRemovedKeys}) -> {items, changedKeys, silentKeys, addedKeys, removedKeys, keptKeys, changed}`, `normalizeEpic(epic)`, `diffEpic(held, fetched) -> {changedFields, silent, equal}`.
- `frontend/src/eng/epicRefreshGlare.js` (Task 3): `GLARE_CAP`, `selectGlareKeys({changedKeys, rects, viewport, suppressed, cap})`, `glareDelayMs(rectTop, viewportTop)`, `playGlare(element, delayMs)`.
- `frontend/src/eng/epicRefreshController.js` (Task 5): `EPIC_REFRESH`, `EPIC_REFRESH_RESULT`, `createEpicRefreshController(deps) -> { refresh(epicKey) }`.

Frontend components: `frontend/src/ui/LoadingMark.jsx` (default export `LoadingMark({ size='xs', className='' })`), `frontend/src/ui/EpicRefreshButton.jsx` (default export `EpicRefreshButton({ epicKey, epicName, state, onRefresh, errorLabel })`), `frontend/src/issues/IssueCard.jsx` (exports `REMOVE_FADE_MS`; new prop `isLeaving`).

Loader (Task 5): `useEngSprintData` returns `loadEpicRefresh({ epicKey, shouldApplyResult, signal }) -> Promise<{ product: Lane, tech: Lane }>` with `Lane = { status: 'ok'|'denied'|'failed'|'rate_limited'|'ignored', items?: issue[], meta?: { epics, capped, epicKeysMissing } }`. `ENG_TASK_LOAD_OUTCOME` gains `LANE_DENIED: 'lane_denied'` and `RATE_LIMITED: 'rate_limited'`.

Analytics (Task 4): event `epic_refresh_action`; `buildEpicRefreshAnalyticsParams({ result, sourceSurface, changedCount })`; `trackEpicRefreshAction` in `dashboardAnalytics.js`; API surface `epic_refresh`; `fetchEpicRefresh(backendUrl, { project, sprint, sprintName, groupId, teamIds, teamLabels, epicKey, signal })` in `engApi.js`.

## File Map

Create: `backend/services/epic_refresh.py`, `tests/test_epic_refresh_service.py`, `tests/test_epic_refresh_purpose.py`, `frontend/src/eng/epicRefreshPatch.js`, `frontend/src/eng/epicRefreshGlare.js`, `frontend/src/eng/epicRefreshController.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/ui/LoadingMark.jsx`, `frontend/src/ui/EpicRefreshButton.jsx`, `tests/test_epic_refresh_patch.js`, `tests/test_epic_refresh_glare.js`, `tests/test_epic_refresh_controller.js`, `tests/test_epic_refresh_source_guards.js`, `tests/ui/eng_epic_refresh.spec.js`.
Modify: `jira_server.py`, `backend/routes/eng_routes.py`, `backend/services/story_readiness.py` (Task 10), `tests/test_codebase_structure_budgets.py`, `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/useStoryReadiness.js` (Task 12), `frontend/src/eng/useStorySubtasks.js`, `frontend/src/api/engApi.js`, `frontend/src/issues/IssueCard.jsx`, `frontend/src/dashboard.jsx`, `frontend/src/styles/eng/{epics,issues,loading}.css`, `frontend/src/analytics/{events,analytics,dashboardAnalytics}.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `docs/README_ANALYTICS.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`, `docs/ontology.md`, `docs/features/eng-workflows.md`, `docs/features/alerts.md`, `README.md`, `docs/plans/README.md`, the design artifact (rename at the end), this plan.
Generate only with `npm run build` (Task 14): `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, `frontend/dist/dashboard.css`.

---

## Task 0: Setup, branch and baseline (inline, no reviewer pair)

**Files:** Modify `docs/plans/README.md`, this plan (baseline table). No source changes.

- [ ] **Step 1: Confirm the issue and rename the branch**

```bash
gh issue view 213 --json number,state,title
git branch --show-current
git branch -m feature/213-per-epic-refresh
git branch --show-current
```
Expected: issue 213 `OPEN`; the last command prints `feature/213-per-epic-refresh`.

- [ ] **Step 2: Gate sweep (AGENTS.md session start for plan execution)**

```bash
rg --files docs/plans | rg '/GATE-'
```
Open each file printed (only `GATE-05-*` exists). It concerns Home/Townsquare writes and is unrelated; leave its `Status` as `Blocked`, and update its `Checked on` date only if the file instructs it. Do not paste secrets.

- [ ] **Step 3: Environment**

```bash
python3 --version && ls .venv >/dev/null 2>&1 || python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt && .venv/bin/python -m pip install -e .
fnm exec --using 20 node --version
fnm exec --using 20 npm ci
```
Expected: Python 3.10 or newer linked to OpenSSL 1.1.1+; Node `v20.x`.

- [ ] **Step 4: Confirm a clean build leaves dist unchanged**

```bash
fnm exec --using 20 npm run build && git diff --exit-code frontend/dist
```
Expected: exit 0. If it differs, stop and ask the user (an existing dist drift would poison every later diff).

- [ ] **Step 5: Record the baseline in the table above**

```bash
make test 2>&1 | tail -5
make test-security 2>&1 | tail -5
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -12
for s in eng_group_board_card eng_status_transitions eng_priority_transitions eng_issue_field_edits eng_story_subtasks eng_alert_loading_order eng_alerts_panel_summary; do fnm exec --using 20 npx playwright test tests/ui/$s.spec.js --workers=1 2>&1 | tail -3; done
```
Write the pass, fail and skip counts into the Baseline table. Known failures from #210 are expected; any other failure is a baseline defect to report to the user before continuing.

- [ ] **Step 6: Index this plan**

Add to `docs/plans/README.md`, under a new heading `## Per-epic refresh (issue #213)` placed before `## Epic header regression review`:

```markdown
## Per-epic refresh (issue #213)

- [Per-epic refresh with glare](EXEC-per-epic-refresh-213.md): proposed (issue #213); an epic-header refresh button that patches one epic in place, re-checks that epic's alerts only, and plays a subtle glare on changed cards. Design: `docs/agents/features/2026-09-29-planned-per-epic-refresh-with-glare.md`. Not started.
```

- [ ] **Step 7: Commit the design and this plan (no push)**

```bash
git add docs/agents/features/2026-09-29-planned-per-epic-refresh-with-glare.md docs/plans/EXEC-per-epic-refresh-213.md docs/plans/README.md
git commit -m "Plan per-epic refresh with glare for issue 213" -m "Adds the approved design and the subagent execution plan."
git show --stat HEAD && git status --short
```
Expected: three files in the commit; the worktree otherwise clean (ignored `tmp/` excluded). The commit message carries no attribution trailer.

---

## Task 1: Backend core — `purpose=epic-refresh`

**Files:**
- Create: `backend/services/epic_refresh.py`, `tests/test_epic_refresh_service.py`, `tests/test_epic_refresh_purpose.py`
- Modify: `backend/routes/eng_routes.py` (guard, near `get_tasks` and `get_tasks_with_team-name`), `jira_server.py` (`fetch_tasks`), `tests/test_codebase_structure_budgets.py`

**Interfaces:**
- Produces: the Shared Interfaces backend block; the endpoint contract row for `epic-refresh`.
- Consumes: `fetch_epic_details_bulk(epic_keys, headers, epic_name_field)`, `build_tasks_cache_key(...)`, `build_jira_home_process_cache_key(auth_context, raw_key)`, `TASKS_CACHE`, `_cache_lock`, `jira_home_partitioned_process_cache_enabled`.

**Read first:** `jira_server.py` `fetch_tasks` (3196-3660: parameter parsing 3207-3225, enrichment block ~3461-3508, `max_results` ~3352, `publish_result` ~3610), `backend/routes/eng_routes.py` (`_ISSUE_KEY_RE` ~110, the `jira_rate_limited` shape ~684, `get_tasks_with_team_name` ~1524, how neighbours obtain `request`, `jsonify` and `current_request_auth_context`), `tests/test_create_stories_alert.py` (scaffolding: `force_basic_auth_mode`, `_mock_response`, the ready-to-close test ~341).

- [ ] **Step 1: Write the failing service tests**

Create `tests/test_epic_refresh_service.py`:

```python
import unittest

from backend.services import epic_refresh


class EpicKeysErrorTests(unittest.TestCase):
    def test_accepts_one_valid_key_for_epic_refresh(self):
        args = {'purpose': 'epic-refresh', 'sprint': '123', 'project': 'product', 'epicKeys': 'EPIC-1'}
        self.assertIsNone(epic_refresh.epic_keys_error(args))

    def test_epic_refresh_requires_one_key_digit_sprint_and_lane(self):
        base = {'purpose': 'epic-refresh', 'sprint': '123', 'project': 'tech', 'epicKeys': 'EPIC-1'}
        for patch in (
            {'epicKeys': ''}, {'epicKeys': 'EPIC-1,EPIC-2'}, {'sprint': ''}, {'sprint': '12a'},
            {'project': 'all'}, {'project': ''},
        ):
            args = {**base, **patch}
            self.assertEqual(epic_refresh.epic_keys_error(args)['error'], 'invalid_epic_refresh', patch)

    def test_rejects_injection_shaped_keys_for_any_purpose(self):
        hostile = [
            'X) OR project is not EMPTY OR issueKey in (Y',
            'EPIC-1"', "EPIC-1'", 'EPIC-1\nORDER BY created', 'epic-1', 'EPIC-', 'EPIC-1 ORDER BY key',
        ]
        for purpose in ('', 'dashboard', 'ready-to-close', 'epic-refresh'):
            for key in hostile:
                args = {'purpose': purpose, 'sprint': '1', 'project': 'product', 'epicKeys': key}
                self.assertEqual(epic_refresh.epic_keys_error(args)['error'], 'invalid_epic_keys', (purpose, key))

    def test_legacy_purposes_keep_multi_key_lists(self):
        keys = ','.join(f'EPIC-{i}' for i in range(1, 60))
        self.assertIsNone(epic_refresh.epic_keys_error({'purpose': 'ready-to-close', 'epicKeys': keys}))


class LimiterTests(unittest.TestCase):
    def test_first_call_allowed_then_blocked_until_interval(self):
        clock = [100.0]
        limiter = epic_refresh.EpicRefreshLimiter(min_interval_seconds=8, clock=lambda: clock[0])
        self.assertEqual(limiter.retry_after('u1', 'EPIC-1'), 0)
        clock[0] = 103.0
        self.assertEqual(limiter.retry_after('u1', 'EPIC-1'), 5)
        self.assertEqual(limiter.retry_after('u2', 'EPIC-1'), 0)
        self.assertEqual(limiter.retry_after('u1', 'EPIC-2'), 0)
        clock[0] = 108.5
        self.assertEqual(limiter.retry_after('u1', 'EPIC-1'), 0)

    def test_table_is_bounded(self):
        limiter = epic_refresh.EpicRefreshLimiter(max_entries=3, clock=lambda: 1.0)
        for index in range(10):
            limiter.retry_after('u', f'EPIC-{index}')
        self.assertLessEqual(len(limiter._seen), 3)


class ResponseMetaTests(unittest.TestCase):
    def test_capped_and_missing_details(self):
        meta = epic_refresh.response_meta(250, 250, ['EPIC-1', 'EPIC-2'], {'EPIC-1': {}})
        self.assertEqual(meta, {'capped': True, 'epicKeysMissing': ['EPIC-2']})
        meta = epic_refresh.response_meta(3, 250, ['EPIC-1'], {'EPIC-1': {}})
        self.assertEqual(meta, {'capped': False, 'epicKeysMissing': []})


class EvictTests(unittest.TestCase):
    def test_evicts_only_named_purposes(self):
        import threading
        cache = {'dashboard-key': 1, 'alerts-key': 2, 'epic-refresh-key': 3, 'other': 4}
        keys = {'dashboard': 'dashboard-key', 'alerts': 'alerts-key'}
        epic_refresh.evict_scope_entries(cache, threading.Lock(), lambda purpose: keys[purpose])
        self.assertEqual(cache, {'epic-refresh-key': 3, 'other': 4})


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_service -v
```
Expected: `ImportError`/`ModuleNotFoundError` for `backend.services.epic_refresh`.

- [ ] **Step 3: Write the service**

Create `backend/services/epic_refresh.py`:

```python
"""Per-epic refresh helpers: request validation, rate limiting, response metadata, cache eviction.

Kept out of jira_server.py, which sits at its structure budget.
"""
import re
import time
from collections import OrderedDict

EPIC_REFRESH_PURPOSE = 'epic-refresh'
ISSUE_KEY_RE = re.compile(r'^[A-Z][A-Z0-9_]+-\d+$')


def parse_epic_keys(raw):
    """Split a comma list into unique, stripped keys, keeping order."""
    keys = []
    for part in str(raw or '').split(','):
        key = part.strip()
        if key and key not in keys:
            keys.append(key)
    return keys


def epic_keys_error(args):
    """Return an error payload for a malformed epicKeys value or epic-refresh request, else None."""
    keys = parse_epic_keys(args.get('epicKeys', ''))
    if any(not ISSUE_KEY_RE.match(key) for key in keys):
        return {'error': 'invalid_epic_keys', 'message': 'Epic keys must look like PROJ-123.'}
    purpose = str(args.get('purpose') or '').strip().lower()
    if purpose == EPIC_REFRESH_PURPOSE:
        lane = str(args.get('project') or '').strip().lower()
        sprint = str(args.get('sprint') or '').strip()
        if len(keys) != 1 or not sprint.isdigit() or lane not in ('product', 'tech'):
            return {
                'error': 'invalid_epic_refresh',
                'message': 'Epic refresh needs one epic key, a numeric sprint and a project lane.',
            }
    return None


class EpicRefreshLimiter:
    """Per user and epic minimum interval between refreshes."""

    def __init__(self, min_interval_seconds=8.0, clock=time.monotonic, max_entries=2048):
        self._min = float(min_interval_seconds)
        self._clock = clock
        self._max = int(max_entries)
        self._seen = OrderedDict()

    def retry_after(self, scope_key, epic_key):
        """Return 0 and record the attempt when allowed, else the whole seconds to wait."""
        now = self._clock()
        key = (str(scope_key), str(epic_key))
        last = self._seen.get(key)
        if last is not None and now - last < self._min:
            return max(1, int(self._min - (now - last) + 0.999))
        self._seen[key] = now
        self._seen.move_to_end(key)
        while len(self._seen) > self._max:
            self._seen.popitem(last=False)
        return 0


def response_meta(issue_count, max_results, requested_keys, epic_details):
    """Truncation and missing-details flags so the client never infers removals from partial data."""
    return {
        'capped': issue_count >= max_results,
        'epicKeysMissing': [key for key in requested_keys if key not in epic_details],
    }


def evict_scope_entries(cache, lock, key_for_purpose, purposes=('dashboard', 'alerts')):
    """Drop the same scope's cached dashboard and alerts entries so a reload is not stale."""
    with lock:
        for purpose in purposes:
            cache.pop(key_for_purpose(purpose), None)
```

- [ ] **Step 4: Run the service tests and confirm they pass**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_service -v
```
Expected: all tests `ok`.

- [ ] **Step 5: Write the failing route tests**

Create `tests/test_epic_refresh_purpose.py`. Reuse the scaffolding and patch list from `tests/test_create_stories_alert.py` (same `force_basic_auth_mode` setUp, `_mock_response`, and `patch.object(jira_server, ...)` list as the ready-to-close test). Required tests, each with exact assertions:

```python
import unittest
from unittest.mock import Mock, patch

from tests.auth_mode_test_utils import force_basic_auth_mode

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


def _mock_response(status_code, payload=None):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload if payload is not None else {}
    return response


def _issue(key, epic='EPIC-1'):
    return {'id': key, 'key': key, 'fields': {
        'summary': f'Story {key}', 'status': {'name': 'To Do'}, 'priority': {'name': 'Medium'},
        'issuetype': {'name': 'Story'}, 'updated': '2026-09-30T10:00:00.000+0000',
        'customfield_10004': 3, 'customfield_epic_link': epic,
        'customfield_sprint': [{'id': 123, 'name': '2026Q3'}],
    }}


def _page(issues, last=True, token=None):
    body = {'issues': issues, 'names': {'customfield_epic_link': 'Epic Link', 'customfield_sprint': 'Sprint'},
            'total': len(issues), 'isLast': last}
    if token:
        body['nextPageToken'] = token
    return _mock_response(200, body)


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class EpicRefreshPurposeTests(unittest.TestCase):
    def setUp(self):
        from backend.routes import eng_routes
        from backend.services import epic_refresh
        force_basic_auth_mode(self, jira_server)
        jira_server.app.testing = True
        self.client = jira_server.app.test_client()
        jira_server.TASKS_CACHE.clear()
        self.eng_routes = eng_routes
        self.epic_refresh = epic_refresh
        # The route guard keeps a module-level limiter; give every test a fresh, non-blocking one.
        eng_routes._EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter(min_interval_seconds=0)

    def _patches(self, search_mock, details=None):
        return (
            patch.object(jira_server, 'build_base_jql', return_value='project = TEST'),
            patch.object(jira_server, 'get_selected_projects_typed', return_value=[]),
            patch.object(jira_server, 'get_configured_issue_types', return_value=['Story']),
            patch.object(jira_server, 'resolve_team_field_id', return_value='customfield_team'),
            patch.object(jira_server, 'resolve_epic_link_field_id', return_value='customfield_epic_link'),
            patch.object(jira_server, 'get_sprint_field_id', return_value='customfield_sprint'),
            patch.object(jira_server, 'jira_search_request', search_mock),
            patch.object(jira_server, 'fetch_epic_details_bulk', Mock(return_value=details if details is not None else {})),
        )

    def _get(self, query, search_mock, details=None):
        from contextlib import ExitStack
        with ExitStack() as stack:
            mocks = [stack.enter_context(p) for p in self._patches(search_mock, details)]
            scan = stack.enter_context(patch.object(jira_server, 'fetch_epics_for_empty_alert', Mock(return_value=[])))
            response = self.client.get('/api/tasks-with-team-name?' + query)
        return response, mocks[-1], scan

    def test_missing_or_malformed_arguments_return_400_without_a_jira_call(self):
        search = Mock()
        for query in (
            'purpose=epic-refresh&project=product&sprint=123',
            'purpose=epic-refresh&project=product&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=product&sprint=abc&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=all&sprint=123&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1,EPIC-2',
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1%22%20OR%20project%20is%20not%20EMPTY',
            'purpose=ready-to-close&project=product&epicKeys=X)%20OR%20issueKey%20in%20(Y',
        ):
            response, _details, _scan = self._get(query, search)
            self.assertEqual(response.status_code, 400, query)
            self.assertIn(response.get_json()['error'], ('invalid_epic_refresh', 'invalid_epic_keys'))
        search.assert_not_called()

    def test_skips_the_empty_epic_scan_and_fetches_details_for_the_requested_key(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        details = {'EPIC-1': {'key': 'EPIC-1', 'summary': 'Epic', 'status': 'In Progress'}}
        response, details_mock, scan = self._get(
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1&refresh=true', search, details)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        scan.assert_not_called()
        self.assertEqual(details_mock.call_args.args[0], ['EPIC-1'])
        body = response.get_json()
        self.assertEqual(body['epics'], details)
        self.assertEqual(body['epicsInScope'], [])
        self.assertIs(body['capped'], False)
        self.assertEqual(body['epicKeysMissing'], [])
        story_jql = search.call_args_list[0].args[0]['jql']
        self.assertIn('Sprint = 123', story_jql)
        self.assertIn('"Epic Link" in ("EPIC-1")', story_jql)
        self.assertIn('parent in ("EPIC-1")', story_jql)

    def test_epic_with_no_stories_still_returns_its_details(self):
        search = Mock(side_effect=[_page([])])
        details = {'EPIC-1': {'key': 'EPIC-1', 'summary': 'Empty epic', 'status': 'In Progress'}}
        response, _d, _s = self._get('purpose=epic-refresh&project=tech&sprint=123&epicKeys=EPIC-1', search, details)
        body = response.get_json()
        self.assertEqual(body['issues'], [])
        self.assertEqual(body['epics'], details)
        self.assertEqual(body['epicKeysMissing'], [])

    def test_missing_details_are_reported_not_hidden(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, {})
        self.assertEqual(response.get_json()['epicKeysMissing'], ['EPIC-1'])

    def test_capped_flag_when_250_rows_come_back(self):
        pages = [
            _page([_issue(f'S-{i}') for i in range(100)], last=False, token='t1'),
            _page([_issue(f'S-{i}') for i in range(100, 200)], last=False, token='t2'),
            _page([_issue(f'S-{i}') for i in range(200, 250)], last=True),
        ]
        search = Mock(side_effect=pages)
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search,
                                     {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual(len(response.get_json()['issues']), 250)
        self.assertIs(response.get_json()['capped'], True)

    def test_never_reads_or_writes_the_tasks_cache(self):
        search = Mock(side_effect=[_page([_issue('S-1')]), _page([_issue('S-1')])])
        before = dict(jira_server.TASKS_CACHE)
        for _ in range(2):
            self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search,
                      {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual(jira_server.TASKS_CACHE, before)
        self.assertEqual(search.call_count, 2)

    def test_rate_limit_returns_429_with_retry_after(self):
        self.eng_routes._EPIC_REFRESH_LIMITER = self.epic_refresh.EpicRefreshLimiter(min_interval_seconds=8)
        search = Mock(side_effect=[_page([]), _page([])])
        first, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9', search,
                                  {'EPIC-9': {'key': 'EPIC-9'}})
        second, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9', search,
                                   {'EPIC-9': {'key': 'EPIC-9'}})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.get_json()['error'], 'epic_refresh_rate_limited')
        self.assertGreaterEqual(second.get_json()['retryAfterSeconds'], 1)
        self.assertEqual(second.headers.get('Retry-After'), str(second.get_json()['retryAfterSeconds']))
        self.assertEqual(search.call_count, 1)

    def test_default_purpose_still_runs_the_empty_epic_scan(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, scan = self._get('project=product&sprint=123&epicKeys=EPIC-1', search, {})
        self.assertEqual(response.status_code, 200)
        scan.assert_called_once()

    def test_two_lane_calls_cost_at_most_two_searches_each(self):
        search = Mock(side_effect=[_page([_issue('S-1')]), _page([])])
        self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertLessEqual(search.call_count, 1)  # epic details are patched; one story page remains


if __name__ == '__main__':
    unittest.main()
```
Adapt patch targets if a name differs in the tree (for example where `fetch_epic_details_bulk` or `fetch_story_*` are bound); keep every assertion. Add three more tests to the same file:

1. **OAuth mode.** Model it on the closest tasks-route test in `tests/test_oauth_eng_routes.py`: a per-user OAuth context returns 200 through `purpose=epic-refresh`, the Jira call carries that user's context, and no `TASKS_CACHE` entry is written.
2. **No request context.** Call the new branch's helpers with no Flask request context (the AGENTS.md learning about `get_*_field_config` and `ConfigStorageError`): it must fall back to default field ids and never raise `ConfigStorageError`.
3. **Read-only.** Find the Jira write paths with `rg "requests\.(put|post|delete)|method=.(PUT|POST|DELETE)" jira_server.py backend/jira_client.py backend/services/jira_issue_*.py`, patch those named symbols to raise, and assert the `epic-refresh` request still returns 200 and never touches them; also patch the Basic-credential helper to raise in OAuth mode and assert the request uses only the per-user context. Name the patched symbols in the test.

- [ ] **Step 6: Run and confirm failures**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_purpose -v
```
Expected: FAIL (400s not returned, scan still called, meta missing).

- [ ] **Step 7: Implement the route guard in `eng_routes.py`**

At module level add (import style follows neighbours; `request`, `jsonify` and `current_request_auth_context` are obtained the way the existing handlers obtain them):

```python
from backend.services import epic_refresh

_EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter()


def _epic_refresh_guard():
    """400 for malformed epicKeys or epic-refresh requests; 429 when refreshed too often."""
    error = epic_refresh.epic_keys_error(request.args)
    if error:
        return jsonify(error), 400
    if str(request.args.get('purpose') or '').strip().lower() == epic_refresh.EPIC_REFRESH_PURPOSE:
        context = current_request_auth_context()
        scope = f"{getattr(context, 'workspace_id', '')}:{getattr(context, 'user_id', '') or 'local'}"
        epic_key = epic_refresh.parse_epic_keys(request.args.get('epicKeys'))[0]
        wait = _EPIC_REFRESH_LIMITER.retry_after(scope, epic_key)
        if wait:
            response = jsonify({'error': 'epic_refresh_rate_limited', 'retryAfterSeconds': wait})
            response.headers['Retry-After'] = str(wait)
            return response, 429
    return None
```
Then in both route functions:

```python
@bp.route('/api/tasks', methods=['GET'])
def get_tasks():
    """Fetch tasks from Jira API."""
    guarded = _epic_refresh_guard()
    if guarded:
        return guarded
    return fetch_tasks(include_team_name=False)


@bp.route('/api/tasks-with-team-name', methods=['GET'])
def get_tasks_with_team_name():
    """Fetch tasks with team name derived from Jira Team field."""
    guarded = _epic_refresh_guard()
    if guarded:
        return guarded
    return fetch_tasks(include_team_name=True)
```
Validation is the injection fix: the key regex admits only letters, digits, underscore and one hyphen, so the unquoted `issueKey in (...)` in `fetch_epic_details_bulk` and the quoted epic clause cannot be broken out of. Do not change `fetch_epic_details_bulk` quoting (other callers and `tests/test_burnout_stats_api.py:146` pin it).

- [ ] **Step 8: Implement the `fetch_tasks` branch in `jira_server.py`**

Four small edits (keep net growth under 15 lines; if an edit can move into `backend/services/epic_refresh.py`, move it):

1. After `lightweight_ready_to_close = request_purpose == 'ready-to-close'` add `is_epic_refresh = request_purpose == EPIC_REFRESH_PURPOSE`, and import `EPIC_REFRESH_PURPOSE, response_meta as epic_refresh_meta, evict_scope_entries` from `backend.services.epic_refresh` with the other service imports.
2. In the epic-enrichment block change `if lightweight_ready_to_close:` to:

```python
        if is_epic_refresh:
            epic_details = fetch_epic_details_bulk(epic_keys_filter, headers, epic_name_field)
            epics_in_scope = []
        elif lightweight_ready_to_close:
```
   Leave the rest of the block unchanged. Run inline: do not place this in the Basic `ThreadPoolExecutor`.
3. Before `data['epicsInScope'] = epics_in_scope` add:

```python
        if is_epic_refresh:
            data.update(epic_refresh_meta(len(slim_issues), max_results, epic_keys_filter, epic_details))
```
4. In `publish_result`, change `if cache_enabled:` to `if cache_enabled and not is_epic_refresh:` and add, before `response = jsonify(data)`:

```python
            if cache_enabled and is_epic_refresh:
                evict_scope_entries(TASKS_CACHE, _cache_lock, lambda purpose: build_jira_home_process_cache_key(
                    auth_context, build_tasks_cache_key(sprint, group_id, project_filter, team_ids, team_label_values,
                                                        include_team_name, use_template, purpose, None, sprint_name=sprint_name)))
```
   Also make the cache **read** skip for this purpose: change the read condition `if cache_enabled and not force_refresh and cached_entry and ...` to additionally require `not is_epic_refresh`.

- [ ] **Step 9: Run the new tests and the affected suites**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_service tests.test_epic_refresh_purpose tests.test_create_stories_alert tests.test_oauth_eng_routes tests.test_burnout_stats_api tests.test_initiative_extraction tests.test_codebase_structure_budgets -v 2>&1 | tail -20
```
Expected: all pass. If the two-lane search-count test fails because details are patched, keep the assertion on story-page count only.

- [ ] **Step 10: Breaker isolation decision checkpoint**

Read `backend/jira_client.py` `resilient_jira_get` and the `current_jira_get` wrapper in `jira_server.py`. If a low-risk way exists to give only `epic-refresh` searches a small attempt budget that honors `Retry-After` and does not record failures on `JIRA_SEARCH_CIRCUIT_BREAKER`, implement it with a test that repeated 429s leave the breaker state unchanged. If none is cheap, leave the code unchanged and write one sentence in this plan's Outcome section: "breaker isolation deferred; the server minimum interval and the client in-flight cap stand in". Do not stretch the change.

- [ ] **Step 11: Ratchet the budget**

```bash
wc -l jira_server.py
```
If above 6463, raise the `"jira_server.py"` value in `tests/test_codebase_structure_budgets.py` to the new count and add a comment line in the existing style: `# feature/213-per-epic-refresh: epic-refresh purpose branch, cache skip and eviction (+N).`

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_codebase_structure_budgets -v
make test-security 2>&1 | tail -4
```
Expected: pass.

- [ ] **Step 12: Report for commit**

Files for the orchestrator's commit: `backend/services/epic_refresh.py`, `tests/test_epic_refresh_service.py`, `tests/test_epic_refresh_purpose.py`, `backend/routes/eng_routes.py`, `jira_server.py`, `tests/test_codebase_structure_budgets.py`. Suggested message: `Add epic-refresh purpose with validation, rate limit and scan-free details`.

---

## Task 2: Pure diff and merge module

**Files:**
- Create: `frontend/src/eng/epicRefreshPatch.js`, `tests/test_epic_refresh_patch.js`

**Interfaces:**
- Produces: the `epicRefreshPatch.js` block in Shared Interfaces. Consumed by Task 5 (controller), Task 8 (alerts A).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_epic_refresh_patch.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffEpic, diffStory, mergeEpicStories, normalizeStory } from '../frontend/src/eng/epicRefreshPatch.js';

const story = (key, fields = {}) => ({
    key,
    id: key,
    fields: {
        summary: `Story ${key}`,
        status: { name: 'To Do' },
        priority: { name: 'Medium' },
        issuetype: { name: 'Story' },
        assignee: { accountId: 'a1', displayName: 'Ana' },
        updated: '2026-09-30T10:00:00.000+0000',
        customfield_10004: 3,
        teamId: 't1',
        epicKey: 'EPIC-1',
        customfield_10101: [{ id: 7 }],
        ...fields,
    },
});
const base = {
    epicKey: 'EPIC-1', laneApplied: true, capped: false, detailsMissing: false,
    protectedKeys: new Set(), clickSnapshot: new Map(), userRemovedKeys: new Set(),
};

test('a comment-only change (updated differs, displayed fields equal) is silent', () => {
    const diff = diffStory(story('S-1'), story('S-1', { updated: '2026-09-30T11:00:00.000+0000' }));
    assert.deepEqual(diff.changedFields, []);
    assert.equal(diff.silent, true);
    assert.equal(diff.equal, false);
});

test('an identical item is equal', () => {
    assert.equal(diffStory(story('S-1'), story('S-1')).equal, true);
});

test('status, priority, summary and issuetype changes are reported by field', () => {
    const diff = diffStory(story('S-1'), story('S-1', { status: { name: 'Done' }, summary: 'New', priority: { name: 'High' }, issuetype: { name: 'Task' } }));
    assert.deepEqual(diff.changedFields.sort(), ['issuetype', 'priority', 'status', 'summary']);
});

test('Story Points null, undefined and 0 are equal; 0 and 3 differ', () => {
    assert.equal(diffStory(story('S-1', { customfield_10004: null }), story('S-1', { customfield_10004: 0 })).equal, true);
    assert.equal(diffStory(story('S-1', { customfield_10004: undefined }), story('S-1', { customfield_10004: 0 })).equal, true);
    assert.deepEqual(diffStory(story('S-1', { customfield_10004: 0 }), story('S-1', { customfield_10004: 3 })).changedFields, ['storyPoints']);
});

test('assignee falls back to display name and ignores unrelated person fields', () => {
    const a = story('S-1', { assignee: { displayName: 'Ana' } });
    const b = story('S-1', { assignee: { displayName: 'Ana', avatar: 'x' } });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { assignee: { displayName: 'Bo' } })).changedFields, ['assignee']);
});

test('sprint compares as an id-sorted list', () => {
    const a = story('S-1', { customfield_10101: [{ id: 2 }, { id: 1 }] });
    const b = story('S-1', { customfield_10101: [{ id: 1 }, { id: 2 }] });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { customfield_10101: [{ id: 3 }] })).changedFields, ['sprint']);
});

test('subtaskSummary compares by content, not key order', () => {
    const a = story('S-1', { subtaskSummary: { total: 2, done: 1 } });
    const b = story('S-1', { subtaskSummary: { done: 1, total: 2 } });
    assert.equal(diffStory(a, b).equal, true);
    assert.deepEqual(diffStory(a, story('S-1', { subtaskSummary: { total: 2, done: 2 } })).changedFields, ['subtaskSummary']);
});

test('normalizeStory is total on an empty issue', () => {
    assert.equal(normalizeStory({}).storyPoints, 0);
    assert.equal(normalizeStory(undefined).status, '');
});

test('merge keeps the held array identity when nothing changed', () => {
    const held = [story('S-1'), story('S-2')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2')] });
    assert.equal(result.items, held);
    assert.equal(result.changed, false);
});

test('merge replaces only the changed item and keeps other identities', () => {
    const held = [story('S-1'), story('S-2')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2', { status: { name: 'Done' } })] });
    assert.equal(result.items[0], held[0]);
    assert.notEqual(result.items[1], held[1]);
    assert.deepEqual(result.changedKeys, ['S-2']);
    assert.equal(result.changed, true);
});

test('a silent-only update replaces the item but reports it as silent', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { updated: '2026-09-30T12:00:00.000+0000' })] });
    assert.deepEqual(result.silentKeys, ['S-1']);
    assert.deepEqual(result.changedKeys, []);
});

test('a fetched story that is not held is added; a user-removed one is not', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1'), story('S-2'), story('S-3')], userRemovedKeys: new Set(['S-3']) });
    assert.deepEqual(result.addedKeys, ['S-2']);
    assert.deepEqual(result.items.map(i => i.key), ['S-1', 'S-2']);
});

test('a held story of this epic missing from a complete lane is removed', () => {
    const held = [story('S-1'), story('S-2'), story('S-9', { epicKey: 'EPIC-2' })];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1')] });
    assert.deepEqual(result.removedKeys, ['S-2']);
    assert.deepEqual(result.items.map(i => i.key), ['S-1', 'S-9']);
});

test('no removal when the lane is capped or the epic details are missing', () => {
    const held = [story('S-1'), story('S-2')];
    assert.equal(mergeEpicStories({ ...base, held, fetched: [story('S-1')], capped: true }).removedKeys.length, 0);
    assert.equal(mergeEpicStories({ ...base, held, fetched: [story('S-1')], detailsMissing: true }).removedKeys.length, 0);
});

test('a lane that did not apply leaves the list untouched', () => {
    const held = [story('S-1')];
    const result = mergeEpicStories({ ...base, held, fetched: [], laneApplied: false });
    assert.equal(result.items, held);
    assert.equal(result.changed, false);
});

test('protected keys and keys edited since the click are kept as held', () => {
    const held = [story('S-1', { status: { name: 'Done' } }), story('S-2', { status: { name: 'In Progress' } })];
    const clickSnapshot = new Map([['S-2', story('S-2', { status: { name: 'To Do' } })]]);
    const result = mergeEpicStories({
        ...base, held, clickSnapshot, protectedKeys: new Set(['S-1']),
        fetched: [story('S-1'), story('S-2')],
    });
    assert.deepEqual(result.keptKeys.sort(), ['S-1', 'S-2']);
    assert.equal(result.items[0], held[0]);
    assert.equal(result.items[1], held[1]);
});

test('a story moved into this epic replaces the copy held under another epic (no duplicate)', () => {
    const held = [story('S-1', { epicKey: 'EPIC-2' })];
    const result = mergeEpicStories({ ...base, held, fetched: [story('S-1', { epicKey: 'EPIC-1' })] });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].fields.epicKey, 'EPIC-1');
    assert.deepEqual(result.changedKeys, ['S-1']);
});

test('epic diff normalizes status and priority shapes and ignores updated-only changes as silent', () => {
    const held = { key: 'EPIC-1', summary: 'E', status: 'In Progress', priority: 'High', projectTrack: 'Committed', assignee: { accountId: 'a1' }, updated: '1' };
    assert.equal(diffEpic(held, { ...held, status: { name: 'In Progress' }, priority: { name: 'High' } }).equal, true);
    const silent = diffEpic(held, { ...held, updated: '2' });
    assert.equal(silent.silent, true);
    assert.deepEqual(diffEpic(held, { ...held, status: 'Done', initiative: { key: 'INIT-1', summary: 'I' } }).changedFields.sort(), ['initiative', 'status']);
    assert.equal(diffEpic(held, undefined).equal, true);
});
```

- [ ] **Step 2: Run and confirm the failure**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_patch.js
```
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

Create `frontend/src/eng/epicRefreshPatch.js`:

```js
// Pure diff and merge rules for the per-epic refresh (issue #213). No React, no I/O.

export const STORY_DISPLAYED_FIELDS = Object.freeze([
    'summary', 'status', 'priority', 'issuetype', 'assignee', 'storyPoints', 'teamId', 'epicKey', 'sprint', 'subtaskSummary',
]);
export const EPIC_DISPLAYED_FIELDS = Object.freeze(['summary', 'status', 'priority', 'projectTrack', 'assignee', 'initiative']);

const nameOf = value => (value && typeof value === 'object' ? String(value.name ?? value.value ?? '') : String(value ?? ''));

const personKey = person => {
    if (!person) return '';
    if (typeof person === 'string') return person;
    return String(person.accountId || person.displayName || '');
};

const sprintKey = value => {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    return list
        .map(item => (item && typeof item === 'object' ? String(item.id ?? item.name ?? '') : String(item)))
        .filter(Boolean)
        .sort()
        .join(',');
};

const stableStringify = value => {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${key}:${stableStringify(value[key])}`).join(',')}}`;
};

const storyPointsKey = value => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
};

export function normalizeStory(issue) {
    const fields = issue?.fields || {};
    return {
        summary: String(fields.summary ?? ''),
        status: nameOf(fields.status),
        priority: nameOf(fields.priority),
        issuetype: nameOf(fields.issuetype),
        assignee: personKey(fields.assignee),
        storyPoints: storyPointsKey(fields.customfield_10004),
        teamId: String(fields.teamId ?? fields.team?.id ?? ''),
        epicKey: String(fields.epicKey ?? ''),
        sprint: sprintKey(fields.customfield_10101),
        subtaskSummary: stableStringify(fields.subtaskSummary),
    };
}

export function diffStory(held, fetched) {
    const before = normalizeStory(held);
    const after = normalizeStory(fetched);
    const changedFields = STORY_DISPLAYED_FIELDS.filter(field => before[field] !== after[field]);
    const updatedChanged = String(held?.fields?.updated ?? '') !== String(fetched?.fields?.updated ?? '');
    return {
        changedFields,
        silent: changedFields.length === 0 && updatedChanged,
        equal: changedFields.length === 0 && !updatedChanged,
    };
}

export function mergeEpicStories({
    held = [], fetched = [], epicKey, laneApplied = true, capped = false, detailsMissing = false,
    protectedKeys = new Set(), clickSnapshot = new Map(), userRemovedKeys = new Set(),
}) {
    const unchanged = { items: held, changedKeys: [], silentKeys: [], addedKeys: [], removedKeys: [], keptKeys: [], changed: false };
    if (!laneApplied) return unchanged;
    const fetchedByKey = new Map(fetched.map(issue => [issue.key, issue]));
    const heldKeys = new Set(held.map(issue => issue.key));
    const canRemove = !capped && !detailsMissing;
    const items = [];
    const changedKeys = [];
    const silentKeys = [];
    const addedKeys = [];
    const removedKeys = [];
    const keptKeys = [];
    let replaced = false;

    for (const current of held) {
        const key = current.key;
        const snapshot = clickSnapshot.get(key);
        const editedSinceClick = Boolean(snapshot) && diffStory(snapshot, current).changedFields.length > 0;
        if (protectedKeys.has(key) || editedSinceClick) {
            items.push(current);
            keptKeys.push(key);
            continue;
        }
        const incoming = fetchedByKey.get(key);
        if (incoming) {
            const diff = diffStory(current, incoming);
            if (diff.equal) {
                items.push(current);
                continue;
            }
            items.push(incoming);
            replaced = true;
            (diff.silent ? silentKeys : changedKeys).push(key);
            continue;
        }
        if (canRemove && String(current.fields?.epicKey ?? '') === String(epicKey)) {
            removedKeys.push(key);
            replaced = true;
            continue;
        }
        items.push(current);
    }
    for (const incoming of fetched) {
        if (heldKeys.has(incoming.key) || userRemovedKeys.has(incoming.key)) continue;
        items.push(incoming);
        addedKeys.push(incoming.key);
        replaced = true;
    }
    return { items: replaced ? items : held, changedKeys, silentKeys, addedKeys, removedKeys, keptKeys, changed: replaced };
}

export function normalizeEpic(epic) {
    return {
        summary: String(epic?.summary ?? ''),
        status: nameOf(epic?.status),
        priority: nameOf(epic?.priority),
        projectTrack: String(epic?.projectTrack ?? ''),
        assignee: personKey(epic?.assignee),
        initiative: epic?.initiative?.key ? `${epic.initiative.key}|${epic.initiative.summary ?? ''}` : '',
    };
}

export function diffEpic(held, fetched) {
    if (!fetched) return { changedFields: [], silent: false, equal: true };
    const before = normalizeEpic(held);
    const after = normalizeEpic(fetched);
    const changedFields = EPIC_DISPLAYED_FIELDS.filter(field => before[field] !== after[field]);
    const updatedChanged = String(held?.updated ?? '') !== String(fetched?.updated ?? '');
    return { changedFields, silent: changedFields.length === 0 && updatedChanged, equal: changedFields.length === 0 && !updatedChanged };
}
```

- [ ] **Step 4: Run and confirm the tests pass**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_patch.js
```
Expected: all pass. Fix the module, never a test.

- [ ] **Step 5: Report for commit**

Files: `frontend/src/eng/epicRefreshPatch.js`, `tests/test_epic_refresh_patch.js`. Message: `Add pure diff and merge rules for per-epic refresh`.

---

## Task 3: UI atoms — burst mark, glare, leaving dissolve, button

**Files:**
- Create: `frontend/src/ui/LoadingMark.jsx`, `frontend/src/ui/EpicRefreshButton.jsx`, `frontend/src/eng/epicRefreshGlare.js`, `tests/test_epic_refresh_glare.js`
- Modify: `frontend/src/issues/IssueCard.jsx` (export `REMOVE_FADE_MS`, `isLeaving` prop), `frontend/src/styles/eng/loading.css` (size modifier), `frontend/src/styles/eng/issues.css` (glare ring), `frontend/src/styles/eng/epics.css` (button overlay and header glare)

**Interfaces:** Produces the LoadingMark, EpicRefreshButton, IssueCard and glare blocks in Shared Interfaces.

**Read first:** `frontend/src/ui/LoadingState.jsx`, `frontend/src/styles/eng/loading.css` (mark and spinner rules), `frontend/src/ui/IconButton.jsx`, the header Refresh button SVG in `dashboard.jsx` (search `refresh-icon`), `frontend/src/issues/IssueCard.jsx` (props, `isRemoveFading`, className line), `frontend/src/styles/eng/issues.css` (`.task-item`, `::after`, `.task-highlight`, `.is-removing`), `frontend/src/styles/eng/epics.css` (`.epic-header`), `tests/test_eng_board_styles.js:100-140` (header CSS regex guards: do not violate), `tmp/glare-specimen.html` (visual reference).

- [ ] **Step 1: Write the failing glare tests**

Create `tests/test_epic_refresh_glare.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLARE_CAP, glareDelayMs, selectGlareKeys } from '../frontend/src/eng/epicRefreshGlare.js';

const rect = (top, height = 60) => ({ top, bottom: top + height });
const viewport = { top: 100, bottom: 700 };

test('selects only mounted, in-viewport keys below the sticky stack, top first', () => {
    const rects = new Map([['A', rect(300)], ['B', rect(120)], ['C', rect(40)], ['D', rect(800)]]);
    const keys = selectGlareKeys({ changedKeys: ['A', 'B', 'C', 'D', 'E'], rects, viewport });
    assert.deepEqual(keys, ['B', 'A']);
});

test('suppressed keys never glint and the cap is 8', () => {
    const rects = new Map(Array.from({ length: 12 }, (_, i) => [`K${i}`, rect(110 + i * 20)]));
    const keys = selectGlareKeys({ changedKeys: [...rects.keys()], rects, viewport, suppressed: new Set(['K0']) });
    assert.equal(GLARE_CAP, 8);
    assert.equal(keys.length, 8);
    assert.ok(!keys.includes('K0'));
});

test('delay grows with distance below the viewport top', () => {
    assert.equal(glareDelayMs(100, 100), 0);
    assert.equal(glareDelayMs(600, 100), 200);
    assert.equal(glareDelayMs(50, 100), 0);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_glare.js
```
Expected: FAIL (module not found).

- [ ] **Step 3: Write the glare helper**

Create `frontend/src/eng/epicRefreshGlare.js`:

```js
export const GLARE_CAP = 8;
const GLARE_ANIMATIONS = new Set(['epic-refresh-glint', 'epic-refresh-tint']);

export function selectGlareKeys({ changedKeys, rects, viewport, suppressed = new Set(), cap = GLARE_CAP }) {
    return changedKeys
        .filter(key => !suppressed.has(key) && rects.has(key))
        .map(key => ({ key, rect: rects.get(key) }))
        .filter(({ rect }) => rect.bottom > viewport.top && rect.top < viewport.bottom)
        .sort((a, b) => a.rect.top - b.rect.top)
        .slice(0, cap)
        .map(({ key }) => key);
}

export function glareDelayMs(rectTop, viewportTop) {
    return Math.max(0, rectTop - viewportTop) * 0.4;
}

// React owns className, so the glare is an attribute React never renders.
export function playGlare(element, delayMs = 0) {
    if (!element) return;
    element.style.setProperty('--glare-delay', `${Math.round(delayMs)}ms`);
    element.removeAttribute('data-glare');
    void element.offsetWidth;
    element.setAttribute('data-glare', 'on');
    const onEnd = event => {
        if (event.target !== element || !GLARE_ANIMATIONS.has(event.animationName)) return;
        element.removeAttribute('data-glare');
        element.removeEventListener('animationend', onEnd);
    };
    element.addEventListener('animationend', onEnd);
}
```

- [ ] **Step 4: Run the glare tests and confirm they pass**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_glare.js
```
Expected: pass.

- [ ] **Step 5: `LoadingMark` and its CSS**

Create `frontend/src/ui/LoadingMark.jsx`:

```jsx
import * as React from 'react';

// The EPM burst, sized for inline controls. Same images and classes as LoadingState.
export default function LoadingMark({ size = 'xs', className = '' }) {
    return (
        <span className={`loading-mark loading-mark-${size} ${className}`.trim()} aria-hidden="true">
            <img className="loading-mark-spinner" src="epm-burst.svg" alt="" />
            <img className="loading-mark-signature" src="epm-burst.svg" alt="" />
        </span>
    );
}
```

Append to `frontend/src/styles/eng/loading.css` (after the `.loading-state-inline .loading-mark` rule group):

```css
        .loading-mark-xs {
            width: 16px;
            height: 16px;
        }

        .loading-mark-xs .loading-mark-spinner {
            filter: none;
        }

        .loading-mark-xs .loading-mark-signature {
            width: 5px;
            height: 5px;
        }

        @media (prefers-reduced-motion: reduce) {
            .loading-mark-xs .loading-mark-spinner {
                animation: none;
            }
        }
```

- [ ] **Step 6: `IssueCard` changes**

In `frontend/src/issues/IssueCard.jsx`: change `const REMOVE_FADE_MS = 240;` to `export const REMOVE_FADE_MS = 240;`; add `isLeaving = false,` to the props destructuring; in the `className` template replace `${isRemoveFading ? 'is-removing' : ''}` with `${isRemoveFading || isLeaving ? 'is-removing' : ''}`; and change the remove button's `disabled={isRemoveFading}` to `disabled={isRemoveFading || isLeaving}`. No other change (EPM also renders `IssueCard` and never passes `isLeaving`).

- [ ] **Step 7: Glare CSS**

Append to `frontend/src/styles/eng/issues.css` after the `.task-item::after` block group:

```css
        /* Per-epic refresh glare (issue #213). ::after is taken by the red overlay and .task-highlight. */
        .task-item[data-glare]::before {
            content: '';
            position: absolute;
            inset: 0 0 0 -3px;
            border-radius: inherit;
            padding: 1.5px;
            pointer-events: none;
            background: linear-gradient(115deg,
                transparent calc(50% - 22%),
                rgba(232, 163, 61, 0.35) calc(50% - 9.9%),
                rgba(232, 163, 61, 1) 50%,
                rgba(232, 163, 61, 0.35) calc(50% + 9.9%),
                transparent calc(50% + 22%));
            background-size: 300% 100%;
            background-position: 100% 0;
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            -webkit-mask-composite: xor;
            mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
            animation: epic-refresh-glint 1800ms cubic-bezier(0.3, 0.1, 0.2, 1) var(--glare-delay, 0ms) 1 both;
        }

        @keyframes epic-refresh-glint {
            0% { background-position: 100% 0; opacity: 0; }
            12% { opacity: 0.5; }
            88% { opacity: 0.5; }
            100% { background-position: 0% 0; opacity: 0; }
        }

        @keyframes epic-refresh-tint {
            0% { opacity: 0; }
            25% { opacity: 0.6; }
            100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
            .task-item[data-glare]::before {
                background: rgba(232, 163, 61, 1);
                background-size: auto;
                animation: epic-refresh-tint 900ms ease-out 1 both;
            }
        }
```

Append to `frontend/src/styles/eng/epics.css` (check `grep -n "epic-header::" frontend/src/styles/**` first; if `::after` or `::before` exists on `.epic-header`, use the free one):

```css
        /* Per-epic refresh (issue #213): header glare and the corner button. */
        .epic-header[data-glare]::after {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            bottom: -1px;
            height: 2px;
            pointer-events: none;
            background: linear-gradient(90deg, transparent calc(50% - 22%), rgba(232, 163, 61, 1) 50%, transparent calc(50% + 22%));
            background-size: 300% 100%;
            background-position: 100% 0;
            animation: epic-refresh-glint 1800ms cubic-bezier(0.3, 0.1, 0.2, 1) var(--glare-delay, 0ms) 1 both;
        }

        .epic-header .epic-refresh-button {
            position: absolute;
            top: 4px;
            right: 6px;
            z-index: 1;
            opacity: 0;
            pointer-events: none;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text-secondary);
            transition: opacity 0.12s ease;
        }

        .epic-header:hover .epic-refresh-button,
        .epic-header:focus-within .epic-refresh-button,
        .epic-header .epic-refresh-button[aria-busy="true"],
        .epic-header .epic-refresh-button[data-state="error"] {
            opacity: 1;
            pointer-events: auto;
        }

        .epic-header .epic-refresh-button[aria-disabled="true"] {
            cursor: progress;
        }

        .epic-header .epic-refresh-button[data-state="error"] {
            color: var(--accent);
            border-color: var(--accent);
        }

        .epic-header .epic-refresh-button svg {
            width: 14px;
            height: 14px;
        }

        .epic-header .epic-refresh-button:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
        }

        @media (hover: none) {
            .epic-header .epic-refresh-button {
                opacity: 1;
                pointer-events: auto;
            }
        }

        @media (max-width: 760px) {
            .epic-header .epic-title-row {
                padding-right: 32px;
            }
        }
```

- [ ] **Step 8: `EpicRefreshButton`**

Create `frontend/src/ui/EpicRefreshButton.jsx` (copy the refresh `<svg>` markup from the header Refresh button into `RefreshGlyph`; do not invent a new icon):

```jsx
import * as React from 'react';
import IconButton from './IconButton.jsx';
import LoadingMark from './LoadingMark.jsx';

// Paste the existing header Refresh button <svg> here (dashboard.jsx, search "refresh-icon").
const RefreshGlyph = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        {/* paths copied verbatim from the header Refresh button */}
    </svg>
);

export default function EpicRefreshButton({
    epicKey,
    epicName,
    state = 'idle',
    onRefresh,
    errorLabel = 'Epic refresh failed. Try again.',
}) {
    const busy = state === 'busy';
    const name = epicName || epicKey;
    const label = busy ? `Refreshing ${name}` : state === 'error' ? errorLabel : `Refresh epic ${name}`;
    return (
        <IconButton
            size="sm"
            variant="secondary compact"
            className="epic-refresh-button"
            data-state={state}
            data-epic-refresh={epicKey}
            aria-label={label}
            title={label}
            aria-disabled={busy ? 'true' : undefined}
            aria-busy={busy ? 'true' : undefined}
            onClick={(event) => {
                event.stopPropagation();
                if (!busy) onRefresh?.(epicKey);
            }}
        >
            {busy ? <LoadingMark /> : <RefreshGlyph />}
        </IconButton>
    );
}
```
The `RefreshGlyph` body is the existing markup; the implementer pastes it (this is reuse, not a placeholder).

- [ ] **Step 9: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_glare.js tests/test_eng_board_styles.js tests/test_epm_view_source_guards.js tests/test_dashboard_epic_icon_source_guards.js
```
Expected: pass (the header CSS regex guards and the EPM loader guard stay green; no duplicate of the epic icon SVG markup). Do not run `npm run build`.

- [ ] **Step 10: Report for commit**

Files: the ten listed above. Message: `Add burst progress mark, glare styles, leaving dissolve and epic refresh button`.

---

## Task 4: Analytics

**Files:**
- Modify: `frontend/src/analytics/events.js`, `frontend/src/analytics/analytics.js`, `frontend/src/analytics/dashboardAnalytics.js`, `frontend/src/api/engApi.js`, `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`, `docs/README_ANALYTICS.md`, `docs/plans/SUPPORT-ga4-user-configuration.md`, `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml`

**Interfaces:** Produces the Analytics block in Shared Interfaces.

**Read first:** `frontend/src/analytics/events.js` (`EVENT_NAMES`, `EVENT_PARAMS`, `validateAnalyticsPayload`), `analytics.js` `API_SURFACES`, `dashboardAnalytics.js` (`buildIssueFieldEditAnalyticsParams` and `trackIssueFieldEditAction`), the nearest existing tests in `tests/test_analytics_events.js` and the source-guard pattern in `tests/test_analytics_source_guards.js:108-143`, the `docs/README_ANALYTICS.md` taxonomy table, and the GA4 runbook and YAML entries for `issue_field_edit_action`.

- [ ] **Step 1: Failing tests**

Add to `tests/test_analytics_events.js`:

```js
test('epic_refresh_action validates and carries only allowlisted params', () => {
    const payload = {
        event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'epic_refresh_action',
        feature_name: 'epic_refresh', workflow_action: 'refresh_result', source_surface: 'catch_up',
        result: 'changed', issue_count_bucket: '1_5',
    };
    assert.doesNotThrow(() => validateAnalyticsPayload(payload));
    assert.throws(() => validateAnalyticsPayload({ ...payload, epic_key: 'EPIC-1' }), /unsupported analytics parameter/);
});

test('buildEpicRefreshAnalyticsParams buckets counts and never includes keys', async () => {
    const { buildEpicRefreshAnalyticsParams } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    assert.deepEqual(
        buildEpicRefreshAnalyticsParams({ result: 'changed', sourceSurface: 'planning', changedCount: 7 }),
        { feature_name: 'epic_refresh', workflow_action: 'refresh_result', source_surface: 'planning', result: 'changed', issue_count_bucket: '6_10' },
    );
    assert.equal(buildEpicRefreshAnalyticsParams({ result: 'unchanged', sourceSurface: 'catch_up', changedCount: 0 }).issue_count_bucket, '0');
});
```
(Match the import and `test` style used at the top of the file.) Add to `tests/test_analytics_source_guards.js` an assertion in the existing style that `engApi.js` calls `trackedFetch('epic_refresh'` and that `API_SURFACES` contains `'epic_refresh'`.

```bash
fnm exec --using 20 node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js
```
Expected: FAIL.

- [ ] **Step 2: Implement**

- `events.js`: add `'epic_refresh_action'` to `EVENT_NAMES` (after `'issue_field_edit_action'`). No new params are needed (`feature_name`, `workflow_action`, `source_surface`, `result`, `issue_count_bucket` exist).
- `analytics.js`: add `'epic_refresh'` to `API_SURFACES` (after `'eng_tasks'`).
- `dashboardAnalytics.js`: export the builder and add the tracker next to `trackIssueFieldEditAction`, and include it in the hook's returned object:

```js
export function buildEpicRefreshAnalyticsParams({ result, sourceSurface, changedCount = 0 } = {}) {
    return {
        feature_name: 'epic_refresh',
        workflow_action: 'refresh_result',
        source_surface: sourceSurface,
        result,
        issue_count_bucket: bucketCount(changedCount),
    };
}
// inside the hook:
const trackEpicRefreshAction = useCallback((params = {}) => {
    trackProductEvent('epic_refresh_action', buildEpicRefreshAnalyticsParams(params));
}, [trackProductEvent]);
```
(Import `bucketCount` from `./events.js` if it is not already imported there.)
- `engApi.js`: add next to `fetchEngTasks`:

```js
export const fetchEpicRefresh = (backendUrl, { project, sprint, sprintName = '', groupId, teamIds = [], teamLabels = [], epicKey, signal } = {}) => {
    const params = new URLSearchParams({
        t: Date.now().toString(),
        sprint: String(sprint ?? ''),
        sprintName,
        team: 'all',
        project,
        groupId: groupId || '',
        refresh: 'true',
        purpose: 'epic-refresh',
        epicKeys: epicKey,
    });
    if (teamIds.length > 0) params.set('teamIds', teamIds.join(','));
    const uniqueTeamLabels = Array.from(new Set(teamLabels.map((label) => String(label || '').trim()).filter(Boolean)));
    if (uniqueTeamLabels.length) params.set('teamLabels', uniqueTeamLabels.join(','));
    return trackedFetch('epic_refresh', `${backendUrl}/api/tasks-with-team-name?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-cache',
        signal,
    }, { featureName: 'epic_refresh' });
};
```
- Docs: add the `epic_refresh_action` row to the `docs/README_ANALYTICS.md` taxonomy (trigger `userevent`, event_type `event`, feature `epic_refresh`, params, the decision it supports: whether manual refresh adoption and change rate justify revisiting the deferred automatic-update designs), a note that `api_surface=epic_refresh` keeps per-click requests out of the `eng_tasks` load series, and matching entries in `docs/plans/SUPPORT-ga4-user-configuration.md` and `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` in the same form as `issue_field_edit_action`. Do not register custom dimensions in bulk and do not add `has_*` params.

- [ ] **Step 3: Verify**

```bash
fnm exec --using 20 node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js tests/test_frontend_api_source_guards.js
```
Expected: pass.

- [ ] **Step 4: Report for commit**

Message: `Add epic_refresh_action analytics event and dedicated API surface`.

---

## Task 5: Loader, controller and hook

**Files:**
- Create: `frontend/src/eng/epicRefreshController.js`, `frontend/src/eng/useEpicRefresh.js`, `tests/test_epic_refresh_controller.js`, `tests/test_epic_refresh_source_guards.js`
- Modify: `frontend/src/eng/useEngSprintData.js`

**Interfaces:**
- Consumes: Task 2 (`mergeEpicStories`, `diffEpic`), Task 3 (`epicRefreshGlare`), Task 4 (`fetchEpicRefresh`).
- Produces: `createEpicRefreshController`, `useEpicRefresh(deps)`, and `loadEpicRefresh` from `useEngSprintData`.

**Read first:** `frontend/src/eng/useEngSprintData.js` (`fetchTasks` ~108-215, `loadAlertEpics` and `loadReadyToClose*` ~330-430, the hook's return object, `ENG_TASK_LOAD_OUTCOME`), `frontend/src/eng/engIssueEditState.js` (`beginRead`/`finishRead`/`reconcileIssues`), `frontend/src/api/http.js` (401 handling).

- [ ] **Step 1: Write the failing controller tests**

Create `tests/test_epic_refresh_controller.js`. The controller takes injected dependencies, so every test uses fakes:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EPIC_REFRESH, EPIC_REFRESH_RESULT, createEpicRefreshController } from '../frontend/src/eng/epicRefreshController.js';

const story = (key, fields = {}) => ({ key, fields: { summary: key, status: { name: 'To Do' }, priority: { name: 'Medium' }, issuetype: { name: 'Story' }, epicKey: 'EPIC-1', customfield_10004: 1, updated: '1', ...fields } });

function harness(overrides = {}) {
    const state = { epoch: 1, version: 1, scopeKey: 'g|1', blocked: false };
    const held = { productTasks: [story('S-1')], techTasks: [], loadedProductTasks: [story('S-1')], loadedTechTasks: [], epicDetails: { 'EPIC-1': { key: 'EPIC-1', summary: 'E', status: 'In Progress', updated: '1' } }, protectedKeys: new Set(), snapshotByKey: new Map(), userRemovedKeys: () => new Set() };
    const calls = { states: [], applied: [], announced: [], tracked: [], loads: 0 };
    let clock = 1000;
    const controller = createEpicRefreshController({
        loadEpicRefresh: overrides.loadEpicRefresh || (async () => ({
            product: { status: 'ok', items: [story('S-1', { status: { name: 'Done' } })], meta: { epics: {}, capped: false, epicKeysMissing: [] } },
            tech: { status: 'ok', items: [], meta: { epics: {}, capped: false, epicKeysMissing: [] } },
        })),
        readGuards: () => ({ ...state }),
        readHeld: () => held,
        apply: update => { calls.applied.push(update); return { hiddenCount: 0 }; },
        setEpicState: (key, value) => calls.states.push([key, value]),
        announce: outcome => calls.announced.push(outcome),
        track: outcome => calls.tracked.push(outcome),
        now: () => clock,
        sleep: async ms => { clock += ms; },
    });
    return { controller, state, held, calls, tick: ms => { clock += ms; }, clockNow: () => clock };
}

test('blocked guard means no load and no state change', async () => {
    const h = harness();
    h.state.blocked = true;
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.BLOCKED);
    assert.equal(h.calls.states.length, 0);
});

test('a changed story is applied once, announced and tracked', async () => {
    const h = harness();
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.CHANGED);
    assert.equal(h.calls.applied.length, 1);
    assert.deepEqual(h.calls.applied[0].changedKeys, ['S-1']);
    assert.deepEqual(h.calls.states.map(s => s[1]), ['busy', 'idle']);
    assert.equal(h.calls.announced.length, 1);
    assert.equal(h.calls.tracked.length, 1);
});

test('an unchanged epic applies nothing and reports unchanged', async () => {
    const h = harness({ loadEpicRefresh: async () => ({
        product: { status: 'ok', items: [story('S-1')], meta: { epics: {}, capped: false, epicKeysMissing: [] } },
        tech: { status: 'ok', items: [], meta: { epics: {}, capped: false, epicKeysMissing: [] } },
    }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.UNCHANGED);
    assert.equal(h.calls.applied.length, 0);
});

test('the busy mark shows at least the minimum time even when the response is instant', async () => {
    const h = harness();
    const start = h.clockNow();
    await h.controller.refresh('EPIC-1');
    assert.ok(EPIC_REFRESH.MIN_BUSY_MS >= 400);
    assert.ok(h.clockNow() - start >= EPIC_REFRESH.MIN_BUSY_MS);
});

test('an epoch change while fetching discards the result silently', async () => {
    const h = harness({ loadEpicRefresh: async () => {
        return { product: { status: 'ok', items: [story('S-1', { status: { name: 'Done' } })], meta: { epics: {}, capped: false, epicKeysMissing: [] } }, tech: { status: 'ok', items: [], meta: { epics: {}, capped: false, epicKeysMissing: [] } } };
    } });
    const pending = h.controller.refresh('EPIC-1');
    h.state.epoch += 1;
    const out = await pending;
    assert.equal(out.result, EPIC_REFRESH_RESULT.DISCARDED);
    assert.equal(h.calls.applied.length, 0);
    assert.equal(h.calls.announced.length, 0);
    assert.equal(h.calls.tracked.length, 0);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('a denied lane is left untouched and raises no error', async () => {
    const h = harness({ loadEpicRefresh: async () => ({
        product: { status: 'ok', items: [story('S-1', { status: { name: 'Done' } })], meta: { epics: {}, capped: false, epicKeysMissing: [] } },
        tech: { status: 'denied' },
    }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.CHANGED);
    assert.equal(h.calls.states.at(-1)[1], 'idle');
});

test('a failed lane applies the good lane and leaves the epic in the error state', async () => {
    const h = harness({ loadEpicRefresh: async () => ({
        product: { status: 'ok', items: [story('S-1', { status: { name: 'Done' } })], meta: { epics: {}, capped: false, epicKeysMissing: [] } },
        tech: { status: 'failed' },
    }) });
    const out = await h.controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.FAILURE);
    assert.equal(out.partial, true);
    assert.equal(h.calls.applied.length, 1);
    assert.equal(h.calls.states.at(-1)[1], 'error');
});

test('a rate-limited or thrown load is a failure with nothing applied', async () => {
    for (const load of [async () => ({ product: { status: 'rate_limited' }, tech: { status: 'rate_limited' } }), async () => { throw new Error('boom'); }]) {
        const h = harness({ loadEpicRefresh: load });
        const out = await h.controller.refresh('EPIC-1');
        assert.equal(out.result, EPIC_REFRESH_RESULT.FAILURE);
        assert.equal(h.calls.applied.length, 0);
        assert.equal(h.calls.states.at(-1)[1], 'error');
    }
});

test('a capped lane never removes cards; an uncapped lane does', async () => {
    const make = capped => harness({ loadEpicRefresh: async () => ({
        product: { status: 'ok', items: [], meta: { epics: {}, capped, epicKeysMissing: [] } },
        tech: { status: 'ok', items: [], meta: { epics: {}, capped: false, epicKeysMissing: [] } },
    }) });
    const capped = make(true); const cappedOut = await capped.controller.refresh('EPIC-1');
    assert.equal(cappedOut.removedKeys.length, 0);
    const open = make(false); const openOut = await open.controller.refresh('EPIC-1');
    assert.deepEqual(openOut.removedKeys, ['S-1']);
});

test('second click while in flight and the third epic at two in flight are blocked; cooldown applies after', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ loadEpicRefresh: async () => { await gate; return { product: { status: 'ok', items: [story('S-1')], meta: { epics: {}, capped: false, epicKeysMissing: [] } }, tech: { status: 'ok', items: [], meta: { epics: {}, capped: false, epicKeysMissing: [] } } }; } });
    const first = h.controller.refresh('EPIC-1');
    assert.equal((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    const second = h.controller.refresh('EPIC-2');
    assert.equal((await h.controller.refresh('EPIC-3')).result, EPIC_REFRESH_RESULT.BLOCKED);
    release();
    await Promise.all([first, second]);
    assert.equal((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
    h.tick(EPIC_REFRESH.COOLDOWN_MS + 1);
    assert.notEqual((await h.controller.refresh('EPIC-1')).result, EPIC_REFRESH_RESULT.BLOCKED);
});

test('hidden changes are reported when the apply callback says no changed card is visible', async () => {
    const h = harness();
    const original = h.calls.applied;
    const controller = createEpicRefreshController({
        loadEpicRefresh: async () => ({ product: { status: 'ok', items: [story('S-1', { status: { name: 'Done' } })], meta: { epics: {}, capped: false, epicKeysMissing: [] } }, tech: { status: 'ok', items: [], meta: { epics: {}, capped: false, epicKeysMissing: [] } } }),
        readGuards: () => ({ epoch: 1, version: 1, scopeKey: 'g|1', blocked: false }),
        readHeld: () => h.held,
        apply: () => ({ hiddenCount: 1 }),
        setEpicState: () => {}, announce: outcome => original.push(outcome), track: () => {},
        now: () => 0, sleep: async () => {},
    });
    const out = await controller.refresh('EPIC-1');
    assert.equal(out.result, EPIC_REFRESH_RESULT.HIDDEN);
});
```

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_controller.js
```
Expected: FAIL (module not found).

- [ ] **Step 2: Write the controller**

Create `frontend/src/eng/epicRefreshController.js`:

```js
import { diffEpic, mergeEpicStories } from './epicRefreshPatch.js';

export const EPIC_REFRESH = Object.freeze({ COOLDOWN_MS: 10000, MAX_IN_FLIGHT: 2, MIN_BUSY_MS: 400 });
export const EPIC_REFRESH_RESULT = Object.freeze({
    CHANGED: 'changed', UNCHANGED: 'unchanged', HIDDEN: 'hidden', FAILURE: 'failure', DISCARDED: 'discarded', BLOCKED: 'blocked',
});

const LANES = ['product', 'tech'];
const listNames = lane => ({ display: `${lane}Tasks`, loaded: `loaded${lane === 'product' ? 'Product' : 'Tech'}Tasks` });

export function createEpicRefreshController({
    loadEpicRefresh, readGuards, readHeld, apply, setEpicState, announce, track,
    now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
    const inFlight = new Set();
    const cooldownUntil = new Map();
    const sameScope = (a, b) => a.epoch === b.epoch && a.version === b.version && a.scopeKey === b.scopeKey;

    function applyLanes(epicKey, lanes, clickSnapshot) {
        const held = readHeld(epicKey);
        const update = { changedKeys: [], silentKeys: [], addedKeys: [], removedKeys: [], epicDetailsPatch: null, lists: {} };
        let failed = false;
        let okLanes = 0;
        let fetchedEpic;
        for (const lane of LANES) {
            const result = lanes?.[lane] || { status: 'failed' };
            if (result.status === 'denied' || result.status === 'ignored') continue;
            if (result.status !== 'ok') { failed = true; continue; }
            okLanes += 1;
            const meta = result.meta || {};
            fetchedEpic = fetchedEpic || meta.epics?.[epicKey];
            const common = {
                fetched: result.items || [], epicKey, laneApplied: true, capped: meta.capped === true,
                detailsMissing: (meta.epicKeysMissing || []).includes(epicKey),
                protectedKeys: held.protectedKeys, clickSnapshot,
            };
            const names = listNames(lane);
            const display = mergeEpicStories({ ...common, held: held[names.display] || [], userRemovedKeys: held.userRemovedKeys(lane) });
            const loaded = mergeEpicStories({ ...common, held: held[names.loaded] || [], userRemovedKeys: new Set() });
            if (display.changed) update.lists[names.display] = display.items;
            if (loaded.changed) update.lists[names.loaded] = loaded.items;
            update.changedKeys.push(...display.changedKeys);
            update.silentKeys.push(...display.silentKeys, ...loaded.silentKeys.filter(key => !display.silentKeys.includes(key)));
            update.addedKeys.push(...display.addedKeys);
            update.removedKeys.push(...display.removedKeys);
        }
        const epicDiff = diffEpic(held.epicDetails?.[epicKey], fetchedEpic);
        if (!epicDiff.equal) update.epicDetailsPatch = { [epicKey]: fetchedEpic };
        const epicChanged = epicDiff.changedFields.length > 0;
        update.epicChanged = epicChanged;
        const changedCount = new Set([...update.changedKeys, ...update.addedKeys, ...update.removedKeys]).size + (epicChanged ? 1 : 0);
        const dirty = changedCount > 0 || update.silentKeys.length > 0 || update.epicDetailsPatch;
        let result = changedCount > 0 ? EPIC_REFRESH_RESULT.CHANGED : EPIC_REFRESH_RESULT.UNCHANGED;
        if (dirty) {
            const applied = apply(update) || {};
            if (changedCount > 0 && applied.hiddenCount >= changedCount) result = EPIC_REFRESH_RESULT.HIDDEN;
            update.hiddenCount = applied.hiddenCount || 0;
        }
        if (failed) result = EPIC_REFRESH_RESULT.FAILURE;
        return { result, partial: failed && okLanes > 0, changedCount, ...update };
    }

    async function refresh(epicKey) {
        const started = now();
        if (inFlight.has(epicKey) || inFlight.size >= EPIC_REFRESH.MAX_IN_FLIGHT || (cooldownUntil.get(epicKey) || 0) > started) {
            return { result: EPIC_REFRESH_RESULT.BLOCKED };
        }
        const clickGuards = readGuards(epicKey);
        if (clickGuards.blocked) return { result: EPIC_REFRESH_RESULT.BLOCKED, reason: clickGuards.reason };
        const clickSnapshot = readHeld(epicKey).snapshotByKey;
        inFlight.add(epicKey);
        setEpicState(epicKey, 'busy');
        let outcome;
        try {
            const lanes = await loadEpicRefresh({ epicKey, shouldApplyResult: () => sameScope(readGuards(epicKey), clickGuards) });
            const remaining = Math.max(0, EPIC_REFRESH.MIN_BUSY_MS - (now() - started));
            if (remaining) await sleep(remaining);
            outcome = sameScope(readGuards(epicKey), clickGuards)
                ? applyLanes(epicKey, lanes, clickSnapshot)
                : { result: EPIC_REFRESH_RESULT.DISCARDED };
        } catch (error) {
            outcome = { result: EPIC_REFRESH_RESULT.FAILURE };
        } finally {
            inFlight.delete(epicKey);
            cooldownUntil.set(epicKey, now() + EPIC_REFRESH.COOLDOWN_MS);
        }
        setEpicState(epicKey, outcome.result === EPIC_REFRESH_RESULT.FAILURE ? 'error' : 'idle');
        if (outcome.result !== EPIC_REFRESH_RESULT.DISCARDED) {
            announce(outcome);
            track(outcome);
        }
        return outcome;
    }

    return { refresh };
}
```
- [ ] **Step 3: Run the controller tests**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_controller.js tests/test_epic_refresh_patch.js
```
Expected: pass.

- [ ] **Step 4: Add the loader to `useEngSprintData.js`**

1. Extend the outcomes: add `LANE_DENIED: 'lane_denied'` and `RATE_LIMITED: 'rate_limited'` to `ENG_TASK_LOAD_OUTCOME`.
2. Add `const EPIC_REFRESH_META = Symbol('epicRefreshMeta');`.
3. In `fetchTasks`, when `options.epicRefresh` is true: call `fetchEpicRefresh` (import from `../api/engApi.js`) instead of `fetchEngTasks` with `{ project, sprint: sprintParam, sprintName: selectedSprintName || '', groupId: activeGroupId, teamIds: groupTeamIds, teamLabels: groupTeamLabels, epicKey: options.epicKeys[0], signal: requestSignal }`; and just before `tokenRetained = true;` attach the meta:

```js
            if (options.epicRefresh) {
                Object.defineProperty(filteredTasks, EPIC_REFRESH_META, {
                    value: {
                        epics: Object.fromEntries(reconciledEntriesList.map(epic => [epic.key, epic])),
                        capped: data.capped === true,
                        epicKeysMissing: Array.isArray(data.epicKeysMissing) ? data.epicKeysMissing : [],
                    },
                });
            }
```
   where `reconciledEntriesList` is the existing `reconciledEpicEntries` array (rename the reference, do not recompute). This bypasses `filterEpicsByTaskEpicKeys` for the refresh (the existing `filteredEpics` is still computed and unused when `updateEpics:false`).
4. In the `catch` block, before the generic handling, add:

```js
            if (options.epicRefresh && err.code === 'missing_project_access') return ENG_TASK_LOAD_OUTCOME.LANE_DENIED;
            if (options.epicRefresh && err.code === 'epic_refresh_rate_limited') return ENG_TASK_LOAD_OUTCOME.RATE_LIMITED;
```
5. Add the loader next to `loadReadyToCloseTechTasks`:

```js
    // Per-epic refresh (issue #213): both lanes, no loading flag, results handed back for one atomic apply.
    const loadEpicRefresh = async ({ epicKey, shouldApplyResult, signal } = {}) => {
        if (strictBoardActive) return { product: { status: 'ignored' }, tech: { status: 'ignored' } };
        const fetchLane = async project => {
            const data = await fetchTasks(project, {
                epicRefresh: true,
                epicKeys: [epicKey],
                updateEpics: false,
                useLoading: false,
                setErrorOnFailure: false,
                forceRefresh: true,
                shouldApplyResult,
                signal,
            });
            const readToken = data?.[ISSUE_EDIT_READ_TOKEN];
            try {
                if (Array.isArray(data)) return { status: 'ok', items: data, meta: data[EPIC_REFRESH_META] };
                if (data === ENG_TASK_LOAD_OUTCOME.LANE_DENIED) return { status: 'denied' };
                if (data === ENG_TASK_LOAD_OUTCOME.RATE_LIMITED) return { status: 'rate_limited' };
                if (data === ENG_TASK_LOAD_OUTCOME.IGNORED) return { status: 'ignored' };
                return { status: 'failed' };
            } finally {
                issueEditState?.finishRead(readToken);
            }
        };
        const [product, tech] = await Promise.all([fetchLane('product'), fetchLane('tech')]);
        return { product, tech };
    };
```
6. Add `loadEpicRefresh` to the hook's return object.

- [ ] **Step 5: The thin hook**

Create `frontend/src/eng/useEpicRefresh.js`. It owns the React state the controller needs (`epicStates`, `leavingKeys`, `announcement`), builds the controller once with refs to current values, and returns `{ epicStates, leavingKeys, announcement, refreshEpic }`. Implementation contract (write it to satisfy exactly this):
- Inputs (all passed from `dashboard.jsx`, which owns the state): `loadEpicRefresh`; current values via a `latest` ref updated every render: `productTasks`, `techTasks`, `loadedProductTasks`, `loadedTechTasks`, `epicDetails`, the setters `setProductTasks`, `setTechTasks`, `setLoadedProductTasks`, `setLoadedTechTasks`, `setEpicDetails`; `readGuards(epicKey)` returning `{ blocked, reason, epoch, version, scopeKey }` (computed in `dashboard.jsx` from the guard list in Global Constraints and the State-Machine Checklist); `getProtectedKeys(epicKey)` (pending status, priority, Project Track, field-edit keys, `activeEditor` key, and current `leavingKeys`); `visibleKeys()` returning the set of task keys currently rendered (so hidden-by-filter changes are counted); `getGlareTargets()` returning `Map<key, HTMLElement>` and the viewport `{top,bottom}` (below the sticky stack); `clearAggregateSources()` (the excluded-capacity, burnout and cohort cache clear the single-field edit path uses, without `rearmCatchUpAlerts`); `track(params)`; `sourceSurface`.
- `readHeld(epicKey)`: returns the `latest` lists, `epicDetails`, `protectedKeys: getProtectedKeys(epicKey)`, `snapshotByKey` (Map of the epic's held items by key, taken from the display lists), and `userRemovedKeys(lane)` = keys in `loaded<Lane>Tasks` that are absent from `<lane>Tasks`.
- `apply(update)`: in one `React.startTransition` or batched block, call `setProductTasks`/`setTechTasks`/`setLoadedProductTasks`/`setLoadedTechTasks` with `update.lists[...]` for lists present, merge `update.epicDetailsPatch` into `epicDetails` (whole objects), add `update.removedKeys` to `leavingKeys` and drop them from the lists after `REMOVE_FADE_MS` (import from `IssueCard.jsx`) using a timer that is cleared on unmount, call `clearAggregateSources()`, then after the commit (`requestAnimationFrame`) compute `selectGlareKeys` over `update.changedKeys + update.addedKeys` (suppress keys the user edited in the last 10 s) and call `playGlare` with `glareDelayMs`, and play the header glare if `update.epicChanged`. Return `{ hiddenCount }` = number of changed keys not in `visibleKeys()`.
- `announce(outcome)`: set `announcement` to fixed text: `changed` → `"<n> stories updated"` (singular for 1), `unchanged` → `"Epic is up to date"`, `hidden` → `"<n> changes hidden by filters"`, `failure` → `"Epic refresh failed"`.
- `track(outcome)`: call the `trackEpicRefreshAction({ result: outcome.result === 'hidden' ? 'changed' : outcome.result, sourceSurface, changedCount: outcome.changedCount || 0 })`.
Keep the file under 160 lines; all decisions live in the controller, which has tests.

- [ ] **Step 6: Source guard test**

Create `tests/test_epic_refresh_source_guards.js` in the style of `tests/test_dashboard_alert_source_guards.js` (read it first) asserting, by reading source text:
- `frontend/src/eng/useEpicRefresh.js`, `epicRefreshController.js` and `epicRefreshPatch.js` contain none of `rearmCatchUpAlerts`, `loadGroupTasks`, `applyLocalEngIssueField`, `localStorage`, `setLoading(`, `setProductTasksLoading`, `setTechTasksLoading`;
- `useEngSprintData.js` `loadEpicRefresh` passes `useLoading: false` and `forceRefresh: true` and `epicRefresh: true`;
- `frontend/src/api/engApi.js` contains `purpose: 'epic-refresh'` and `trackedFetch('epic_refresh'`;
- no file outside `frontend/src/api/` contains the literal `/api/tasks-with-team-name`.

- [ ] **Step 7: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_controller.js tests/test_epic_refresh_patch.js tests/test_epic_refresh_source_guards.js tests/test_frontend_api_source_guards.js tests/test_dashboard_alert_source_guards.js
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -8
```
Expected: pass, no change to other suites.

- [ ] **Step 8: Report for commit**

Files: the six listed. Message: `Add per-epic refresh loader, controller and hook`.

---

## Task 6: Dashboard wiring, overlay mount and the department-wide-request guards

**Files:**
- Modify: `frontend/src/dashboard.jsx`, `frontend/src/eng/useStorySubtasks.js`, `tests/test_codebase_structure_budgets.py`

**Interfaces:** Consumes Tasks 3 and 5. Produces the mounted feature for Catch Up only (Planning gate is Task 13).

**Read first:** `dashboard.jsx` `renderEpicBlock` (~14461-14660), the `useEngSprintData(` call and destructuring (~7155-7200), `loadMeasuredGroupTasks` (~7215), `refreshLegacyBoardTasks`, the alert effect (~7802-7857), the dependencies effect and `fetchDependencies` (~12194-12230 and ~7249), `removeTask` (~12249), `epicInteractionActive` (~14485), `statusTransitionActiveKey`, `priorityTransitionActiveKey`, `projectTrackTransitionActiveKey`, `issueFieldEdits`, the `IssueCard` render site (~14739), `manualRefreshDisabled` (~14923), `invalidateEngIssueFieldSources` and its cache clears in `engIssueEditState.js:84-96`, `frontend/src/eng/useStorySubtasks.js`.

- [ ] **Step 1: Failing source-guard assertions**

Extend `tests/test_epic_refresh_source_guards.js` with assertions that `dashboard.jsx` contains: `useEpicRefresh(`; `EpicRefreshButton`; `isLeaving={`; `loadEpochRef`; and that the count of `rearmCatchUpAlerts();` call sites is unchanged (copy the exact pattern from `tests/test_dashboard_alert_source_guards.js:144-145`). Run:

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_source_guards.js
```
Expected: FAIL.

- [ ] **Step 2: Epoch and cohort refs**

In `dashboard.jsx`: add `const loadEpochRef = useRef(0);` and `const alertCohortInFlightRef = useRef(false);` next to `catchUpAlertVersionRef`. As the first statement of `loadMeasuredGroupTasks` add `loadEpochRef.current += 1;` (this also covers `refreshLegacyBoardTasks` and the long-absence path). In the alert effect, set `alertCohortInFlightRef.current = true` when a cohort starts and `false` in every completion, discard and cleanup path of that effect (use a `finally` on the cohort promise chain; do not change what the effect loads or when).

- [ ] **Step 3: Instantiate the hook**

Destructure `loadEpicRefresh` from `useEngSprintData`. After `useStorySubtasks`, call `useEpicRefresh({...})` with the inputs listed in Task 5 Step 5:
- `readGuards(epicKey)`: `blocked` is true when any of `loading`, `productTasksLoading`, `techTasksLoading`, `manualRefreshDisabled`, `!tasksFetched`, `String(lastLoadedSprintRef.current ?? '') !== String(selectedSprint ?? '')`, `alertCohortInFlightRef.current`, `strictBoardOwnerActive`, `!isCatchUpMode` (Task 13 widens this), or the epic has an active interaction (`statusTransitionActiveKey`, `priorityTransitionActiveKey`, `projectTrackTransitionActiveKey` equal to the key, or `issueFieldEdits.activeEditor?.issueKey === key`); `epoch: loadEpochRef.current`, `version: groupLoadVersionRef.current`, `scopeKey: \`${activeGroupId}|${selectedSprint}\``. Read live values through a ref, not stale closure values.
- `getProtectedKeys`: union of `pendingStatusIssueKeys`, `pendingPriorityIssueKeys`, `pendingProjectTrackIssueKeys`, `issueFieldEdits.pendingIssueKeys`, the active editor key, and the hook's `leavingKeys`.
- `clearAggregateSources`: the same three aggregate-cache clears `invalidateEngIssueFieldSources` performs, without `rearmCatchUpAlerts` and without `setDependencyData`.

- [ ] **Step 4: Mount the button and pass `isLeaving`**

In `renderEpicBlock`, as the last child of `.epic-header` (inside the `<div className="epic-header">`), add:

```jsx
{isCatchUpMode && epicGroup.key !== 'NO_EPIC' && (
    <EpicRefreshButton
        epicKey={epicGroup.key}
        epicName={epicTitle}
        state={epicRefresh.epicStates[epicGroup.key] || 'idle'}
        onRefresh={epicRefresh.refreshEpic}
    />
)}
```
Import `EpicRefreshButton` at the top of `dashboard.jsx`. `renderEpicBlock` is a plain function and cannot host hooks, so the hook lives at `App` level (Step 3) and the button only receives its state and handler. At the `IssueCard` render site add `isLeaving={epicRefresh.leavingKeys.has(task.key)}`. Render the status region once near the top of the ENG view: `<div className="sr-only" role="status">{epicRefresh.announcement}</div>` (reuse the existing visually-hidden utility class; search for `sr-only` or `visually-hidden`; if a page-level status region already exists, feed it instead and add no second one; never add `aria-live="polite"`, `tests/ui/onboarding_tour.spec.js` asserts exactly one).

- [ ] **Step 5: Suppress the department-wide dependency refetch and invalidate subtasks**

- In the dependencies effect (keyed on `dependencyKeySignature`), skip the refetch when the signature change came from a refresh apply: keep a ref `dependencySignatureLoadedRef` set by `fetchDependencies` on success and by the hook's `apply` (via a callback prop `markDependencySignature(nextSignature)`), and have the effect return early when its current signature equals the ref.
- After `apply`, POST `/api/dependencies` for the epic's whole key set through the existing `fetchDependencies`-style request but with `refresh` and a per-key merge into `dependencyData` (replace only those keys; on any failed or non-2xx response keep the old entries). Add `refresh` to the `frontend/src/api` dependency function in `engApi.js` (the route change is Task 10's backend counterpart; until then send `refresh=true` harmlessly).
- In `useStorySubtasks.js` add `invalidateStorySubtasks(keys)` that drops cached entries for those keys and reloads the ones whose panel is open (`expanded`); call it from the hook's `apply` for changed story keys.

- [ ] **Step 6: Budget ratchet**

```bash
wc -l frontend/src/dashboard.jsx
```
Raise `"frontend/src/dashboard.jsx"` in `tests/test_codebase_structure_budgets.py` to the new count with an itemized comment in the existing style (hook instantiation, guards, mount, `isLeaving`, dependency gate, status region). Keep wiring lines minimal; every non-wiring line belongs in the new modules.

- [ ] **Step 7: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_source_guards.js tests/test_dashboard_alert_source_guards.js tests/test_eng_board_styles.js
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -8
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_codebase_structure_budgets -v
```
Expected: pass (30 test files read `dashboard.jsx`; if another source guard fails, fix the code, never the guard, unless the guard pins a count this task legitimately changes).

- [ ] **Step 8: Report for commit**

Files: `frontend/src/dashboard.jsx`, `frontend/src/eng/useStorySubtasks.js`, `tests/test_codebase_structure_budgets.py`, `tests/test_epic_refresh_source_guards.js`, `frontend/src/api/engApi.js` (dependencies `refresh`). Message: `Mount per-epic refresh in Catch Up with dependency and alert-cohort guards`.

---

## Task 7: Playwright spec for the core refresh

**Files:** Create `tests/ui/eng_epic_refresh.spec.js`.

**Read first:** `tests/ui/eng_group_board_card.spec.js:163-238` (route fixture pattern), `tests/ui/epm_home_token_fixture.js` (`installDashboardShell`), `tests/ui/eng_alert_loading_order.spec.js:77-124` (`calls[]` and `deferred()` gating), `tests/ui/eng_dependency_chip_visual.spec.js:563-590` (`is-removing` assertions), `tests/ui/eng_sticky_stack_helpers.js`.

- [ ] **Step 1: Build the fixture**

The spec defines `mockDashboard(page, { tasksFor })` with `page.route('**/api/**', ...)` that records `calls[]` (`{ method, pathname, search, body }`), serves `/api/tasks-with-team-name` by `purpose`/`project`/`epicKeys` (full scope for the initial loads, the epic's stories plus `epics` for `purpose=epic-refresh`), answers `/api/eng/story-readiness` with `{ schemaVersion: 1, complete: true, scope: {}, epics: [] }`, `/api/auth/*`, `/api/config`, `/api/sprints` and the other endpoints the model spec stubs, and exposes `respond(handler)` so each test overrides one route. Every test starts in Catch Up with two epics (`EPIC-1` with three stories, `EPIC-2` with two), one story with an assignee long enough to reach the header's right edge.

- [ ] **Step 2: Write the tests (normal clicks, never `force`)**

Write each as its own `test(...)`:
1. `hidden at rest, visible on hover and on keyboard focus` — opacity 0 and `pointer-events:none` at rest; hovering the header and tabbing into it make the button visible and clickable.
2. `visible under hover:none` — use a CDP session (`Emulation.setEmulatedMedia` with `{ name: 'hover', value: 'none' }`; `page.emulateMedia` cannot set `hover`) and assert opacity 1.
3. `header geometry is identical with the button shown and hidden` — for a direct epic, an initiative-grouped epic and at 1280 px, 1024 px and 390 px: compare `getBoundingClientRect()` of `.epic-title-row > *` and `.epic-meta > *` exactly between hovered and un-hovered (move the mouse away first), and assert `scrollWidth - clientWidth <= 1` on the header; assert the button rect lies inside the header rect.
4. `assignee, story points and status stay clickable` — `document.elementFromPoint` at the centre of each target returns that target (or its descendant); at 390 px the Planning stat toggle centre is not covered (run in Task 13 for Planning).
5. `an open status menu layers above the button` — open the epic status menu and assert `elementFromPoint` at the menu item is the menu item.
6. `a click sends one request per lane with epicKeys and never renders LoadingState` — two calls with `purpose=epic-refresh&epicKeys=EPIC-1`, `refresh=true`; assert `.loading-state` never appears (poll with `page.waitForFunction` over the click-to-settle window) and every call after the click carries `epicKeys=EPIC-1` or is on the allowlist (`POST /api/dependencies` with only that epic's keys).
7. `the burst shows for at least 400 ms and the arrows return` — with `page.clock` installed before navigation, fast-forward less than 400 ms and assert `.epic-refresh-button .loading-mark-xs` is present and `aria-busy="true"`, fast-forward the rest and assert the glyph is back and `aria-busy` is absent.
8. `a changed story is replaced in place` — change S-1 status from To Do to Done in the refresh response; assert the same DOM node (`handle.evaluate(node => node)` identity check via a `data-test-id` counter set before the click), scroll position and applied filters unchanged, the clicked header's `getBoundingClientRect().top` unchanged.
9. `glare plays only on changed in-viewport cards, capped at 8` — 12 changed cards: exactly 8 have `data-glare` (read within the first animation frames), none for unchanged cards; freeze with `document.getAnimations().forEach(a => { a.pause(); a.currentTime = 900; })` and screenshot (never `animations:'disabled'`, which jumps to the end and hides the glare).
10. `reduced motion uses the static tint` — `page.emulateMedia({ reducedMotion: 'reduce' })`; computed `animationName` of `.task-item[data-glare]::before` is `epic-refresh-tint`.
11. `the no-change case shows no glare and no layout change`.
12. `a card that leaves dissolves with is-removing 0.24 s; a card that enters fades in then glints`.
13. `a user-removed card stays removed after a refresh` — click the card's × first.
14. `a global Refresh during a per-epic refresh discards the result` — gate the epic response with `deferred()`, click the header Refresh button, release, assert the epic's old values are not applied on top of the global reload.
15. `an edit confirmed during the fetch is kept` — start the refresh, confirm a status change on a story in that epic, release a stale response, assert the confirmed value stays.
16. `two epics at once; the third is blocked` — two requests in flight, the third click issues no request; a second click on the same epic within 10 s issues no request.
17. `a 401 uses the existing sign-in lock`, `a 429 shows the fixed label and no banner and no retry`, `an HTTP 500 shows the error state and no global banner`, `a denied product lane (403) applies the tech lane silently`, `one failed lane shows the error state and still applies the other`.
18. `the announcement region says "1 story updated" / "Epic is up to date" / "N changes hidden by filters"` — assert the single `role="status"` text.
19. `changes hidden by the default Killed filter announce and do not glint`.
20. `an alert cohort in flight disables the button` — gate the alerts request with `deferred()` and assert `aria-disabled` or no request on click.

- [ ] **Step 3: Build, then run the spec and the neighbours**

```bash
fnm exec --using 20 npm run build
fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js --workers=1
fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js tests/ui/eng_status_transitions.spec.js tests/ui/eng_priority_transitions.spec.js tests/ui/eng_issue_field_edits.spec.js tests/ui/eng_story_subtasks.spec.js tests/ui/eng_dependency_chip_visual.spec.js --workers=1
```
Expected: the new spec passes; the neighbours show only the baseline failures recorded at T0 (`eng_priority_transitions` has one known failure from #210). Do not commit `frontend/dist` (Task 14); restore it with `git checkout -- frontend/dist` after the run.

- [ ] **Step 4: Report for commit**

Files: `tests/ui/eng_epic_refresh.spec.js`. Message: `Add Playwright coverage for per-epic refresh`.

---

## Task 8: Alerts A — client-derived alerts follow the refresh

**Files:**
- Create: `frontend/src/eng/epicRefreshAlerts.js`, `tests/test_epic_refresh_alerts.js`
- Modify: `frontend/src/eng/useEpicRefresh.js`, `frontend/src/dashboard.jsx` (minimal wiring), `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `dashboard.jsx` Missing Info derivation (`hasStoryPoints` ~13243, `/api/missing-info` union ~13290-13349), `backend/routes/eng_routes.py` missing-info predicate and the exact `missingFields` names (~1440-1480), `frontend/src/eng/useEngWorkHierarchy.js` ghost rows (~263-293), `backend/services/story_readiness.py` actionable rule (~166), `docs/features/alerts.md`.

- [ ] **Step 1: Failing tests** in `tests/test_epic_refresh_alerts.js` for two pure functions, exported from `epicRefreshAlerts.js`:
  - `recomputeMissingPlanningInfo({ held, refreshedStories, epicKey })`: for each held missing-info entry whose `fields.epicKey === epicKey` and whose story is among `refreshedStories`, recompute `missingFields` with the exact names the endpoint uses (read them from `eng_routes.py`; at minimum `'Story Points'` when Story Points is null, empty or at most 0 and `'Assignee'` when the assignee is empty); keep the entry only when the recomputed list is non-empty; entries whose story is not among the refreshed stories stay untouched; return the same array when nothing changes. Tests: Story Points from empty to 3 removes the entry; Story Points 3 to 0 adds it back; a story outside the refreshed set is untouched; an unrelated epic's entry is untouched.
  - `shouldHideReadinessGhost({ requirement, stories })`: true when `stories` already holds a story for that team and epic that is actionable by the `story_readiness.py` rule (not Blocked, Done, Killed or Incomplete); false otherwise. Tests for each excluded status and for another team's story.

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js
```
Expected: FAIL.

- [ ] **Step 2: Implement both functions** in `epicRefreshAlerts.js` (pure, no React).
- [ ] **Step 3: Wire** in `useEpicRefresh.js`'s `apply`: merge `recomputeMissingPlanningInfo` into `missingPlanningInfoTasks` through the setter passed from `dashboard.jsx`; add `setMissingPlanningInfoTasks` to the hook inputs and pass it (one line). Filter the readiness ghosts at the render of ghost rows with `shouldHideReadinessGhost` against the current lists (`useEngWorkHierarchy.js` input, no new request). Only when `isCatchUpMode`.
- [ ] **Step 4: Playwright** — add to `eng_epic_refresh.spec.js`: Story Points from empty to a value removes that story's Missing Info entry with no `/api/missing-info` request and no department-wide request; the Stories Required ghost for a team disappears when the refresh adds an actionable story for that team; dismissals (`dismissedAlertKeys`) survive; a department reload started mid-refresh discards the per-epic alert result (capture `catchUpAlertVersionRef` at click through a value exposed by the hook and compare at apply).
- [ ] **Step 5: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_dashboard_alert_source_guards.js
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_alert_loading_order.spec.js tests/ui/eng_alerts_panel_summary.spec.js tests/ui/eng_missing_story_ghosts.spec.js --workers=1
```
Then `git checkout -- frontend/dist`. Re-check the `dashboard.jsx` line count against the budget (ratchet with an itemized comment if needed).
- [ ] **Step 6: Report for commit.** Message: `Keep client-derived alerts in step with a per-epic refresh`.

---

## Task 9: Alerts B backend — scoped epic alert object

**Files:**
- Modify: `jira_server.py` (`fetch_epics_for_empty_alert` gets `epic_keys`; a short `epic-alerts` branch), `backend/services/epic_refresh.py` (`fetch_epic_alert_bundle`, `apply_epic_enrichment`), `tests/test_epic_refresh_purpose.py`, `tests/test_create_stories_alert.py`, `tests/test_codebase_structure_budgets.py`

**Read first:** `jira_server.py` `fetch_epics_for_empty_alert` (~2880), `fetch_story_counts_for_epics` and `fetch_story_distribution_for_epics` (~2985-3190), the enrichment block in `fetch_tasks` (~3509-3548) and `backend/services/alert_epics.py`.

- [ ] **Step 1: Failing tests.** In `tests/test_epic_refresh_purpose.py` add, with the same scaffolding:
  - `purpose=epic-alerts&epicKeys=EPIC-1&sprint=123&project=product` returns `{epicsInScope: [...]}` and **no** `issues`; `fetch_epics_for_empty_alert` is called once with `epic_keys=['EPIC-1']`, `complete_alert_scope=False`, and the JQL it builds still contains the sprint-label alternative and the team and alias scope clause (assert on the JQL string the search mock receives).
  - The epic is enriched (`totalStories`, `selectedStories`, `selectedActionableStories`, `futureOpenStories`, `openStoriesOutsideSelected`, `selectedActionableByTeam`) from `fetch_story_counts_for_epics` and `fetch_story_distribution_for_epics`, each called with `['EPIC-1']` only.
  - An epic outside the scope returns `epicsInScope: []` (the client removes it); a future-sprint epic that is in scope only by label is returned, not dropped.
  - `epic-alerts` needs the same validation, rate limit and cache behavior as `epic-refresh` (no `TASKS_CACHE` write), and the `alerts` purpose still runs the complete scan unchanged (`tests/test_create_stories_alert.py` stays green).
- [ ] **Step 2: Add the parameter.** In `jira_server.py`:

```python
def fetch_epics_for_empty_alert(jql, headers, team_field_id, epic_name_field, sprint_field_id=None, scope_team_ids=None, scope_team_labels=None, scope_sprint_label=None, complete_alert_scope=False, epic_keys=None):
    ...
    if scope_clause:
        epic_jql = add_clause_to_jql(epic_jql, scope_clause)
    if epic_keys:
        epic_jql = add_clause_to_jql(epic_jql, f'issueKey in ({", ".join(quote_jql_value(key) for key in epic_keys)})')
```
  (`quote_jql_value` comes from `backend.services.alert_epics`; import it with the existing import list.)
- [ ] **Step 3: Extract the enrichment assignment** (the per-epic field assignments currently inline at ~3520-3547) into `backend/services/epic_refresh.py::apply_epic_enrichment(epics, counts, distribution)` verbatim, and call it from both `fetch_tasks` (replacing the inline block) and the new branch. This reduces `jira_server.py` lines; verify with `tests/test_create_stories_alert.py` (all enrichment tests must pass unchanged).
- [ ] **Step 4: Add `fetch_epic_alert_bundle`** in the service: takes the callables (`fetch_epics`, `fetch_counts`, `fetch_distribution`) and the request values, returns `{'epicsInScope': enriched}`; add the `epic-alerts` branch in `fetch_tasks` right after the JQL and field ids are resolved, returning before the story fetch (a few lines calling the service).
- [ ] **Step 5: Verify and ratchet**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_epic_refresh_purpose tests.test_epic_refresh_service tests.test_create_stories_alert tests.test_codebase_structure_budgets -v 2>&1 | tail -15
make test-security 2>&1 | tail -4
```
Expected: pass; update the `jira_server.py` budget and comment only if the file grew.
- [ ] **Step 6: Report for commit.** Message: `Add scope-aware epic alert purpose for one epic`.

---

## Task 10: Alerts C backend — `epicKeys` on missing-info, backlog and story-readiness

**Files:**
- Modify: `backend/routes/eng_routes.py`, `backend/services/story_readiness.py`, `jira_server.py` (only if `fetch_backlog_epics_for_alert` needs the parameter), `tests/test_oauth_eng_routes.py`, `tests/test_story_readiness.py`, `tests/test_create_stories_alert.py`, `tests/test_oauth_cache_isolation.py`

**Read first:** `eng_routes.py` missing-info route and `MISSING_INFO_CACHE` key (~1282-1480, key at ~1299-1305), backlog route (~2070), story-readiness route and compute (`_story_readiness_cache_key` ~229, `_story_readiness_compute` ~361, the `ValueError` validation block ~523, LRU ~92), `POST /api/dependencies` (~829), and the tests pinned to these keys (`tests/test_oauth_eng_routes.py:581`, `:632`, `:205-250`; `tests/test_story_readiness.py:201-320`).

- [ ] **Step 1: Failing tests**, one group per route:
  - **missing-info:** `epicKeys=EPIC-1` (format-checked, one key) ANDs `issueKey in` into the epic query, keeping the sprint, component, team, status and project scope; the cache key gains the epics **only when present** (so the pinned existing key is unchanged); `refresh=true` bypasses the cache; a full-scope call after a per-epic call returns the full payload; a bad key returns 400 `invalid_epic_keys`.
  - **backlog-epics:** `epicKeys=EPIC-1` scopes both searches; future sprints only semantics unchanged; 400 on a bad key.
  - **story-readiness:** `epicKeys=EPIC-1` is validated inside the existing `ValueError` block; the per-epic call uses its own cache key and its own in-flight key, **never writes or reads the department snapshot cache** (assert the 128-entry LRU has no per-epic entry and a following department call computes the full payload); keys are passed to `_story_readiness_compute` as a separate argument, not inside the `requested` tuple; the existing stubs in `tests/test_oauth_eng_routes.py:205-250` and `tests/test_story_readiness.py:201-320` still pass unchanged.
  - **dependencies:** accepts `refresh`; format check on keys; result not cached when `refresh=true`.
- [ ] **Step 2: Implement** each change with the smallest edit; reuse `epic_refresh.epic_keys_error` for validation and add a helper `epic_refresh.single_epic_key(args)` (first parsed key or `None`) to the service with a two-line unit test.
- [ ] **Step 3: Verify**

```bash
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest tests.test_oauth_eng_routes tests.test_story_readiness tests.test_create_stories_alert tests.test_oauth_cache_isolation tests.test_epic_refresh_service tests.test_epic_refresh_purpose -v 2>&1 | tail -20
make test-security 2>&1 | tail -4
```
Expected: pass.
- [ ] **Step 4: Report for commit.** Message: `Add single-epic scoping to missing-info, backlog and story-readiness`.

---

## Task 11: Alerts B frontend — Ready to Close, Empty Epic, Missing Team and Missing Labels for one epic

**Files:** Modify `frontend/src/eng/useEngSprintData.js`, `frontend/src/eng/epicRefreshAlerts.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/dashboard.jsx` (minimal wiring), `frontend/src/api/engApi.js`, `tests/test_epic_refresh_alerts.js`, `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `loadAlertEpics`/`loadReadyToClose*` (~330-430 of `useEngSprintData.js`), the `*EpicsInScope` and `readyToClose*` state and the Waiting, Ready to Close and Empty Epic derivations in `dashboard.jsx` (~13481-13660).

- [ ] **Step 1: Failing tests** in `tests/test_epic_refresh_alerts.js`: a pure `mergeEpicScopeEntries({ held, incoming, epicKey })` that replaces or deletes the entry for `epicKey` by key (epic-shaped, status `{name}`), keeping other epics and the array identity when nothing changes; and the trigger function `alertCallsFor(outcomeDiff, { isFutureSprint, isCatchUp })` returning the set of epic-scoped calls per the design's trigger matrix (status change → ready-to-close and epic-alerts; membership change → all epic-level calls; Story Points or assignee only → none; epic `updated` change or future sprint → epic-alerts; Planning → none).
- [ ] **Step 2: Implement** both in `epicRefreshAlerts.js`; add `fetchEpicAlertBundle` and `fetchEpicReadyToClose` to `engApi.js` (they reuse `trackedFetch('epic_refresh', ...)` with `purpose=epic-alerts` and `purpose=ready-to-close&epicKeys=<key>&sprint=`), and loaders in `useEngSprintData.js` that return data without applying it (read-token finished on every path).
- [ ] **Step 3: Wire** the calls after a successful `apply` in `useEpicRefresh.js` only when `alertCallsFor` says so, for the owning lane only (the lane whose lists hold the epic), merging into `*EpicsInScope` and `readyToClose*EpicsInScope`/`readyToClose*Tasks` with deletion. Capture `catchUpAlertVersionRef` at click and discard alert results if it changed.
- [ ] **Step 4: Playwright:** a status change makes exactly the ready-to-close and epic-alerts calls for that epic only; no other alert call; a refresh with no displayed change makes none; a department reload mid-refresh discards the alert result; an epic that leaves scope disappears from the Empty Epic alert; a future-sprint label-only epic stays.
- [ ] **Step 5: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_dashboard_alert_source_guards.js tests/test_frontend_api_source_guards.js
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_alert_loading_order.spec.js tests/ui/eng_alerts_panel_summary.spec.js --workers=1
```
Then `git checkout -- frontend/dist` and re-check the `dashboard.jsx` budget.
- [ ] **Step 6: Report for commit.** Message: `Re-check scope-based epic alerts after a per-epic refresh`.

---

## Task 12: Alerts C frontend — missing-info, backlog and Stories Required for one epic

**Files:** Modify `frontend/src/eng/useStoryReadiness.js`, `frontend/src/eng/useEpicRefresh.js`, `frontend/src/eng/epicRefreshAlerts.js`, `frontend/src/api/engApi.js`, `frontend/src/dashboard.jsx` (minimal wiring), `tests/test_story_readiness_api.js`, `tests/test_epic_refresh_alerts.js`, `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `useStoryReadiness.js` (whole file: state machine, `refreshRevision`, `snapshot:null` while loading), `engApi.js` `fetchStoryReadiness`, `tests/test_story_readiness_api.js`, the ghost-row rendering in `useEngWorkHierarchy.js`.

- [ ] **Step 1: Failing tests:** `mergeReadinessEpic({ snapshot, epicPayload, epicKey })` (upsert and delete by epic key in `snapshot.epics[]`, preserving other epics and identity when equal; stale readiness assignee, track or initiative never shadows cleared `epicDetails` fields); merges for the missing-info and backlog lists keyed by `fields.epicKey` and epic key; `alertCallsFor` extended with missing-info (membership or Story Points/team change), backlog (future sprint only) and readiness (status, membership or team change).
- [ ] **Step 2: Implement:** add `epicKeys` to `fetchStoryReadiness` (separate function `fetchEpicReadiness` so the department request is untouched), `fetchEpicMissingInfo`, `fetchEpicBacklog` in `engApi.js`; add `mergeEpic(epicKey, payload)` to `useStoryReadiness` that updates the snapshot without the `snapshot:null` blanking; wire the conditional calls in `useEpicRefresh.js` after the Task 11 calls.
- [ ] **Step 3: Playwright:** after a membership change, the Stories Required ghost for that epic updates with no department-wide readiness request and no blanking of other epics' ghosts; missing-info and backlog calls are epic-scoped and only when the matrix says so; a failed per-epic readiness call leaves the existing ghosts and raises no banner.
- [ ] **Step 4: Verify**

```bash
fnm exec --using 20 node --test tests/test_epic_refresh_alerts.js tests/test_story_readiness_api.js tests/test_frontend_api_source_guards.js tests/test_dashboard_alert_source_guards.js
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_missing_story_ghosts.spec.js tests/ui/eng_alert_loading_order.spec.js --workers=1
```
Then `git checkout -- frontend/dist` and re-check the `dashboard.jsx` budget.
- [ ] **Step 5: Report for commit.** Message: `Re-check missing-info, backlog and Stories Required for one epic`.

---

## Task 13: Planning enablement

**Files:** Modify `frontend/src/dashboard.jsx` (gate and capacity guard), `tests/ui/eng_epic_refresh.spec.js`

**Read first:** `dashboard.jsx` capacity scope signature and the `/api/capacity` effect (~12790-12882), the Planning selection effect and `resolvePlanningSelectionState` (~11617-11734 and `planningSelectionState.mjs`), `planningCapacityUtils.js:453` (`displayedTeamOptions`).

- [ ] **Step 1: Failing tests** (Playwright, Planning mode): the button appears on Planning headers; a Planning refresh issues **zero** alert requests and zero `/api/capacity` requests when the displayed teams are unchanged; capacity cards do not blank; a story that moves out of the epic is not double-counted in the capacity bar; future-sprint default-all mode auto-selects a newly arrived story; in manual selection mode a removed story's selection is pruned and persisted exactly as a normal reload would; header geometry and overlay layering tests from Task 7 repeat in Planning at 1280, 1024 and 390 px, including that the Planning stat toggle centre is not covered at 390 px.
- [ ] **Step 2: Implement:** widen the `readGuards` mode check to `isCatchUpMode || showPlanning`, mount the button under the same condition, suppress the alert calls when `!isCatchUpMode`, and keep `capacityScopeSignature` stable across the apply (recompute it only when the set of displayed teams actually changes, as the existing code intends; do not add a new request path).
- [ ] **Step 3: Verify**

```bash
fnm exec --using 20 npm run build && fnm exec --using 20 npx playwright test tests/ui/eng_epic_refresh.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/planning_capacity_editing.spec.js tests/ui/planning_selection_defaults.spec.js --workers=1
```
Expected: new tests pass; `planning_selection_defaults` shows only its known baseline failure (#210). Then `git checkout -- frontend/dist` and re-check the `dashboard.jsx` budget.
- [ ] **Step 4: Report for commit.** Message: `Enable per-epic refresh in Planning with capacity and selection guards`.

---

## Task 14: Docs, final verification, dist and publication prep (orchestrator, inline)

**Files:** Modify `docs/ontology.md`, `README.md`, `docs/features/eng-workflows.md`, `docs/features/alerts.md`, `docs/README_ANALYTICS.md` (confirm Task 4), `docs/plans/README.md`, this plan, the design artifact; generate `frontend/dist/*`.

- [ ] **Step 1: Docs.** In `docs/ontology.md` add an `Epic refresh` entry (concept, canonical name, aliases `per-epic refresh`, entry points `epicRefreshController.js`, `epicRefreshPatch.js`, `useEpicRefresh.js`, `EpicRefreshButton.jsx`, `purpose=epic-refresh` and `purpose=epic-alerts` in `fetch_tasks`, relations to the Catch Up hierarchy, Alert Epic candidate and Story-readiness snapshot, verification date 2026-09-30) and check every path and symbol resolves with `rg`. Update `docs/features/alerts.md` (the statement near line 12 that task refreshes invalidate alert cohorts now has the per-epic exception), `docs/features/eng-workflows.md` (the refresh semantics and the limitation about moved stories), and `README.md` near the refresh description (~355) with the new per-epic button. Re-read each section against the shipped behavior.
- [ ] **Step 2: Full verification at the exact head**

```bash
make test 2>&1 | tail -6
make test-security 2>&1 | tail -4
fnm exec --using 20 npm run test:frontend:unit 2>&1 | tail -10
```
Compare the counts with the Baseline table: no new failures.
- [ ] **Step 3: Startup verification** (backend startup paths changed): start `.venv/bin/python jira_server.py`, `curl http://localhost:5050/api/test`, confirm no dependency or runtime warning before the Flask banner, stop the server.
- [ ] **Step 4: Build and commit dist once**

```bash
fnm exec --using 20 npm ci && fnm exec --using 20 npm run build
git add frontend/dist
git commit -m "Rebuild frontend bundle for per-epic refresh"
git show --stat HEAD && git status --short
fnm exec --using 20 npm run build && git diff --exit-code frontend/dist
```
Expected: dist files in the commit; the second build leaves no diff (this is CI's `verify-frontend-build` check); the source map contains no ancestor-checkout paths.
- [ ] **Step 5: Full Playwright against the baseline**

```bash
for f in tests/ui/*.spec.js; do fnm exec --using 20 npx playwright test "$f" --workers=1 2>&1 | tail -2; done
```
Only the baseline failures from issue #210 may remain; any other failure blocks publication.
- [ ] **Step 6: Whole-branch review.** Dispatch one final reviewer over `git diff origin/main...HEAD` with the design and this plan: spec coverage, forbidden regressions, stray files, local data, absolute paths, secrets, attribution trailers.
- [ ] **Step 7: Close the artifacts.** Rename the design to `docs/agents/features/2026-09-29-executed-per-epic-refresh-with-glare.md` with `Status: executed`, add `## Outcome` and `## Current Accuracy`, update every link; keep this plan as `EXEC-*` until acceptance or merge, add a top status note with the commit range, record the deferred breaker-isolation decision if Task 1 step 10 deferred it, and update the `docs/plans/README.md` entry.
- [ ] **Step 8: Publication transaction (AGENTS.md section 10).** Do not push. Report to the user: fetch the base, record exact base and head SHAs, `git status --short`, `git log --oneline origin/main..HEAD`, `git diff --name-status origin/main...HEAD`; compare the commit list and every changed path with this plan's file map; list screenshots for the PR (hover reveal, busy mark, glare frame, Planning header); wait for the user's explicit confirmation before `git push`, then use `gh pr create --body-file -` with a body written in the reply, read it back as rendered text, verify remote head equals the approved local head, and report the CI state. No attribution lines anywhere.

---

## Self-Review (run against the design)

- Goal and decisions (design section 1): Tasks 3, 6, 13 (button, placement, scope), Task 4 (analytics), Tasks 8, 11, 12 (alerts), Global Constraints (no wipes, glare numbers, manual only).
- Facts and traps (section 2): guarded in Tasks 1, 5, 6 (validation, read token, cohort, dependencies, subtasks, budgets).
- Interaction and accessibility (3.1): Tasks 3, 6, 7 (reveal, `aria-disabled`, announcements, cap and cooldown in Task 5's controller).
- Endpoint matrix (3.2): Tasks 1, 9, 10, plus the matrix above.
- Backend (3.3): Task 1 (validation, meta, cache, limiter, inline, budget, breaker checkpoint).
- Frontend data flow (3.4), diff and merge (3.5): Tasks 2 and 5 (per lane, capped, snapshot, protected, removed-by-user, moved story).
- Alerts (3.6): Tasks 8, 9, 10, 11, 12.
- Glare (3.7): Task 3 (CSS, helper, `data-glare`, header sweep, reduced motion, `isLeaving`), Task 5 (selection and delay), Task 7 (frozen-frame screenshot).
- Persistence, ordering (3.8): no storage anywhere (source guard in Task 5); anchoring asserted in Task 7 test 8.
- Analytics (3.9): Task 4.
- Acceptance criteria (section 6): mapped to Tasks 1, 2, 5, 7, 8 through 13 and the final verification in Task 14.
- Open risks carried, not hidden: the baseline suite is not green (issue #210); Jira search counts are from reading the code, not measured (record measured counts and time per click in the Outcome); Story Readiness per epic is the highest-risk slice; breaker isolation may be deferred (Task 1 step 10).
