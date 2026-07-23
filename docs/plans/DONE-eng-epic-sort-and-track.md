# ENG Epic Sort + Product Track Implementation Plan

> **Status:** Done. Executed and merged in [PR #92](https://github.com/Juce-me/jira-execution-planner/pull/92). Kept for audit context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Product Track" indicator (🔒 Committed / 🤷 Flexible) and an effective-priority pill to each ENG epic header, plus a single "Sort" dropdown that orders epics by Priority, Status (workflow phase), or Product Track (committed-first / flexible-first), each tie-broken by priority.

**Architecture:** A new Jira custom field (`customfield_35024`, configurable) is fetched server-side in `fetch_epic_details_bulk` and surfaced per epic as `epic.projectTrack`. All ordering/derivation logic is pure and lives in `frontend/src/eng/engTaskUtils.js` (unit-tested with `node:test`). `dashboard.jsx` computes the sorted `epicGroups` via `sortEpicGroups(...)` and renders header badges; `EngView.jsx` renders a `sprint-dropdown`-styled Sort control whose value persists in localStorage UI prefs alongside `epmProjectSort`.

**Tech Stack:** Python 3.10+/Flask backend (`jira_server.py`), React 19 + esbuild frontend (`frontend/src/`), `node:test` unit tests, Playwright UI tests, `unittest` backend tests.

## Global Constraints

- **Read-only only.** No Jira writes, no new OAuth scopes, no new mutation routes. `customfield_35024` is read via the existing `jira_search_request` path. `GATE-05` unaffected.
- **Field id default + configurable.** `PROJECT_TRACK_FIELD_DEFAULT = 'customfield_35024'`; overridable via `dashboard-config.json` key `projectTrackField` (`{fieldId, fieldName}`), following the `sprintField`/`teamField` getter pattern. Do NOT pre-populate `dashboard-config.json` (the default covers it; it may be a local file).
- **Status phase order (built-in fallback):** the BSWRND prod/tech board column order — phase 0 To Do, 1 Analysis, 2 Ready (accepted/awaiting validation/postponed/pending), 3 Blocked, 4 In Progress (in progress/incomplete/release), 5 Done (done/killed) — **extended with the app's known status synonyms** (`closed`/`resolved`/`released`/`complete`/`completed`/`cancelled`/`rejected`/`won't do` → 5; `in review`/`in development`/`in testing` → 4; `on hold`/`impediment`/`waiting`/`waiting for release` → 3; `backlog`/`open`/`reopened`/`selected for development` → 0) so common statuses are not dumped to the unmapped bucket. Unmapped → 999 (sorted last). The comparator accepts `opts.phaseRanks` so a future per-group board-import foundation can inject a board-derived map without changing call sites.
- **Sort option values (exact):** `default`, `priority`, `status`, `track-committed`, `track-flexible`. Default label `Default (Jira order)`.
- **Track emoji map (exact):** `committed` → `🔒`, `flexible` → `🤷`. Empty/unknown → no indicator.
- **Effective epic priority** = most-urgent (lowest `PRIORITY_ORDER` rank) among the epic's child tasks; `{name:null, rank:999}` when no child carries a priority. Epics are NOT given their own Jira priority field.
- **Build + commit dist.** Any change consumed by `dashboard.jsx`/`EngView.jsx` requires `npm run build` and committing `frontend/dist/` (CI `verify-frontend-build.yml` fails on a dirty post-build diff). Never hand-edit `frontend/dist/`.
- **Tests use synthetic keys only** (`PRODUCT-1`, `TECH-2`). Never commit real Jira fixture data or real custom-field values beyond the field id already conventional in this repo.
- **Do not touch sticky layering** (`.epic-header` / planning-panel z-index/top offsets) — see MRT009.
- **Reuse `sprint-dropdown*` classes** for the Sort control; no bespoke dropdown styles.
- **Commits:** atomic, per-task message provided. No `Co-Authored-By` trailers. Work on a `feature/` branch, never `main`.

---

## File Structure

- `jira_server.py` — add `PROJECT_TRACK_FIELD_DEFAULT` + `get_project_track_field_config()` + `get_project_track_field_id()`; fetch + parse the field in `fetch_epic_details_bulk` (one new fetched field, one new dict key `projectTrack`).
- `frontend/src/eng/engTaskUtils.js` — add pure exports: `DEFAULT_STATUS_PHASE_RANKS`, `PROJECT_TRACK_EMOJI`, `DEFAULT_ENG_EPIC_SORT`, `ENG_EPIC_SORT_OPTIONS`, `normalizeEngEpicSort`, `getEngEpicSortLabel`, `getEpicEffectivePriority`, `getStatusPhaseRank`, `getProjectTrackRank`, `getProjectTrackEmoji`, `compareEpicGroups`, `sortEpicGroups`.
- `frontend/src/dashboard.jsx` — extend the `engTaskUtils.js` import (line 29); add `engEpicSort` state (~407); persist it in the UI-prefs save effect (~5285–5339); sort `epicGroups` via `sortEpicGroups` (~10294–10297); render priority pill + track emoji in the epic header `epic-meta` (~12368); pass `engEpicSort`/`setEngEpicSort` to `EngView` (~14636).
- `frontend/src/eng/EngView.jsx` — add an always-visible "Sort" `sprint-dropdown` control near the View controls block (~274).
- `frontend/src/styles/eng/epics.css` — add `.epic-priority-pill` and `.epic-track-indicator`.
- `tests/test_project_track_field.py` — backend getter + fetch/parse tests (new).
- `tests/test_eng_epic_sort.js` — pure-logic unit tests (new, `node:test`).
- `tests/ui/eng_epic_sort_and_track.spec.js` — Playwright UI proof (new).
- `frontend/dist/*` — regenerated by `npm run build` (committed, not hand-edited).
- `docs/plans/README.md` — index entry (added with this plan).

---

## Task 0: Branch + baseline (main session, before dispatching task subagents)

**Files:** none (repo state only)

- [ ] **Step 1: Sync main and branch**

```bash
cd /Users/a.feygin/Documents/jira-execution-planner
git checkout main && git pull
git checkout -b feature/eng-epic-sort-and-track
```

- [ ] **Step 2: Establish green baseline**

Run: `npm run test:frontend:unit && python3 -m unittest discover -s tests 2>&1 | tail -5`
Expected: existing suites pass (record the pass line). If anything is already red, stop and report before changing code.

---

## Task 1: Backend — fetch & expose `projectTrack` per epic

**Files:**
- Modify: `jira_server.py:2200-2254` (add default + getters), `jira_server.py:2455-2506` (`fetch_epic_details_bulk`)
- Test: `tests/test_project_track_field.py`

**Interfaces:**
- Produces: `get_project_track_field_id() -> str`; each value in `fetch_epic_details_bulk(...)` gains `epic['projectTrack']` = the field option's `.value` string (`"Committed"`/`"Flexible"`) or `None`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_project_track_field.py`:

```python
import unittest
from unittest.mock import patch

import jira_server


class _FakeResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class ProjectTrackFieldConfigTests(unittest.TestCase):
    def test_default_field_id_when_config_absent(self):
        with patch.object(jira_server, 'load_dashboard_config', return_value={}):
            self.assertEqual(jira_server.get_project_track_field_id(), 'customfield_35024')

    def test_config_overrides_field_id(self):
        cfg = {'projectTrackField': {'fieldId': 'customfield_99999', 'fieldName': 'Project Track'}}
        with patch.object(jira_server, 'load_dashboard_config', return_value=cfg):
            self.assertEqual(jira_server.get_project_track_field_id(), 'customfield_99999')


class FetchEpicDetailsProjectTrackTests(unittest.TestCase):
    def test_field_requested_and_value_parsed(self):
        captured = {}

        def fake_search(payload):
            captured['payload'] = payload
            return _FakeResp(200, {'issues': [
                {'key': 'PRODUCT-1', 'fields': {
                    'summary': 'Epic one',
                    'status': {'name': 'In Progress'},
                    'customfield_35024': {'value': 'Committed'},
                }},
                {'key': 'TECH-2', 'fields': {
                    'summary': 'Epic two',
                    'status': {'name': 'To Do'},
                    'customfield_35024': None,
                }},
            ]})

        with patch.object(jira_server, 'load_dashboard_config', return_value={}), \
             patch.object(jira_server, 'jira_search_request', side_effect=fake_search):
            details = jira_server.fetch_epic_details_bulk(['PRODUCT-1', 'TECH-2'], {}, None)

        self.assertIn('customfield_35024', captured['payload']['fields'])
        self.assertEqual(details['PRODUCT-1']['projectTrack'], 'Committed')
        self.assertIsNone(details['TECH-2']['projectTrack'])


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest tests.test_project_track_field -v`
Expected: FAIL — `AttributeError: module 'jira_server' has no attribute 'get_project_track_field_id'`.

- [ ] **Step 3: Add the field default + getters**

In `jira_server.py`, after `TEAM_FIELD_DEFAULT = 'customfield_30101'` (line 2204) add:

```python
PROJECT_TRACK_FIELD_DEFAULT = 'customfield_35024'
```

After `get_team_field_id()` (ends line 2253) add:

```python
def get_project_track_field_config():
    config = load_dashboard_config()
    if config and 'projectTrackField' in config:
        pt = config['projectTrackField']
        return {'fieldId': pt.get('fieldId', ''), 'fieldName': pt.get('fieldName', '')}
    return {'fieldId': PROJECT_TRACK_FIELD_DEFAULT, 'fieldName': ''}


def get_project_track_field_id():
    return get_project_track_field_config()['fieldId'] or PROJECT_TRACK_FIELD_DEFAULT
```

- [ ] **Step 4: Fetch & parse the field in `fetch_epic_details_bulk`**

In `jira_server.py`, after `epic_field = epic_name_field or PARENT_NAME_FIELD_DEFAULT` (line 2461) add:

```python
    project_track_field = get_project_track_field_id()
```

Change the fields list (line 2471) to include it:

```python
            'fields': ['summary', 'status', 'reporter', 'assignee', 'parent', epic_field, project_track_field]
```

Add the `projectTrack` key to the epic dict (inside the `epic_details[key] = { ... }` block, after the `assignee` line at 2489):

```python
                    'projectTrack': (fields.get(project_track_field) or {}).get('value') if fields.get(project_track_field) else None,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m unittest tests.test_project_track_field -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Guard against import/startup regressions**

Run: `python3 -m unittest tests.test_app_startup -v`
Expected: PASS (confirms `jira_server` still imports cleanly).

- [ ] **Step 7: Commit**

```bash
git add jira_server.py tests/test_project_track_field.py
git commit -m "feat(eng): fetch Project Track custom field for epics"
```

---

## Task 2: Frontend — pure epic ordering & badge logic

**Files:**
- Modify: `frontend/src/eng/engTaskUtils.js` (append new exports; reuse existing `PRIORITY_ORDER`)
- Test: `tests/test_eng_epic_sort.js`

**Interfaces:**
- Consumes: `PRIORITY_ORDER` (already exported at `engTaskUtils.js:1`).
- Produces (all named exports): `DEFAULT_STATUS_PHASE_RANKS`, `PROJECT_TRACK_EMOJI`, `DEFAULT_ENG_EPIC_SORT`, `ENG_EPIC_SORT_OPTIONS`, `normalizeEngEpicSort(value) -> string`, `getEngEpicSortLabel(value) -> string`, `getEpicEffectivePriority(epicGroup, priorityOrder?) -> {name, rank}`, `getStatusPhaseRank(statusName, phaseRanks?) -> number`, `getProjectTrackRank(track, committedFirst?) -> number`, `getProjectTrackEmoji(track) -> string`, `compareEpicGroups(a, b, sortMode, opts?) -> number`, `sortEpicGroups(groups, sortMode, opts?) -> Array`. `epicGroup` shape: `{ key, epic: { status, projectTrack } | null, tasks: [{ fields: { priority: {name} } }] }`. `opts`: `{ priorityOrder?, phaseRanks?, order? }` where `order` maps `epicKey -> insertion index`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_eng_epic_sort.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const modUrl = pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'src', 'eng', 'engTaskUtils.js')
).href;

function epic(key, status, track, taskPriorities) {
  return {
    key,
    epic: { status, projectTrack: track },
    tasks: (taskPriorities || []).map(p => ({ fields: { priority: p ? { name: p } : null } })),
  };
}

test('effective priority is the most urgent child priority', async () => {
  const { getEpicEffectivePriority } = await import(modUrl);
  assert.equal(getEpicEffectivePriority(epic('E1', 'To Do', null, ['Low', 'High', 'Medium'])).name, 'High');
  assert.equal(getEpicEffectivePriority(epic('E2', 'To Do', null, [])).rank, 999);
});

test('status phase rank follows the built-in workflow order', async () => {
  const { getStatusPhaseRank } = await import(modUrl);
  assert.equal(getStatusPhaseRank('To Do'), 0);
  assert.equal(getStatusPhaseRank('Backlog'), 0);
  assert.equal(getStatusPhaseRank('Awaiting Validation'), 2);
  assert.equal(getStatusPhaseRank('In Review'), 4);
  assert.equal(getStatusPhaseRank('Done'), 5);
  assert.equal(getStatusPhaseRank('Released'), 5);
  assert.equal(getStatusPhaseRank('Unknown Status'), 999);
});

test('project track rank honors committed-first vs flexible-first', async () => {
  const { getProjectTrackRank } = await import(modUrl);
  assert.equal(getProjectTrackRank('Committed', true), 0);
  assert.equal(getProjectTrackRank('Flexible', true), 1);
  assert.equal(getProjectTrackRank('Committed', false), 1);
  assert.equal(getProjectTrackRank('', true), 2);
});

test('getProjectTrackEmoji maps values', async () => {
  const { getProjectTrackEmoji } = await import(modUrl);
  assert.equal(getProjectTrackEmoji('Committed'), '🔒');
  assert.equal(getProjectTrackEmoji('Flexible'), '🤷');
  assert.equal(getProjectTrackEmoji(''), '');
});

test('normalizeEngEpicSort + label', async () => {
  const { normalizeEngEpicSort, getEngEpicSortLabel } = await import(modUrl);
  assert.equal(normalizeEngEpicSort('bogus'), 'default');
  assert.equal(normalizeEngEpicSort('track-flexible'), 'track-flexible');
  assert.equal(getEngEpicSortLabel('priority'), 'Priority');
});

test('sortEpicGroups: priority orders most-urgent first, then insertion order', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'Done', null, ['Low']),
    epic('B', 'To Do', null, ['Blocker']),
    epic('C', 'In Progress', null, ['Medium']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'priority', { order }).map(g => g.key), ['B', 'C', 'A']);
});

test('sortEpicGroups: status orders by workflow phase then priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'Done', null, ['High']),
    epic('B', 'To Do', null, ['Low']),
    epic('C', 'In Progress', null, ['Medium']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'status', { order }).map(g => g.key), ['B', 'C', 'A']);
});

test('sortEpicGroups: track-committed groups committed first then priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'To Do', 'Flexible', ['Blocker']),
    epic('B', 'To Do', 'Committed', ['Low']),
    epic('C', 'To Do', 'Committed', ['High']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'track-committed', { order }).map(g => g.key), ['C', 'B', 'A']);
});

test('getEpicEffectivePriority: unknown priority name outranks no-priority', async () => {
  const { getEpicEffectivePriority } = await import(modUrl);
  assert.equal(getEpicEffectivePriority(epic('U', 'To Do', null, ['Wacky'])).rank, 998);
  assert.equal(getEpicEffectivePriority(epic('N', 'To Do', null, [])).rank, 999);
});

test('sortEpicGroups: status sorts unmapped last and tiebreaks same phase by priority', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [
    epic('A', 'Mystery Status', null, ['Blocker']),
    epic('B', 'In Progress', null, ['Low']),
    epic('C', 'In Progress', null, ['High']),
  ];
  const order = { A: 0, B: 1, C: 2 };
  assert.deepEqual(sortEpicGroups(groups, 'status', { order }).map(g => g.key), ['C', 'B', 'A']);
});

test('sortEpicGroups: default keeps insertion order', async () => {
  const { sortEpicGroups } = await import(modUrl);
  const groups = [epic('A', 'Done', null, ['Low']), epic('B', 'To Do', null, ['Blocker'])];
  const order = { A: 0, B: 1 };
  assert.deepEqual(sortEpicGroups(groups, 'default', { order }).map(g => g.key), ['A', 'B']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test_eng_epic_sort.js`
Expected: FAIL — exports `getEpicEffectivePriority`/`sortEpicGroups`/etc. are `undefined`.

- [ ] **Step 3: Implement the exports**

Append to `frontend/src/eng/engTaskUtils.js`:

```javascript

// --- Epic ordering: effective priority, status phase, Product Track ---

// Built-in status→phase rank fallback: the BSWRND prod/tech board column order
// (To Do → Analysis → Ready → Blocked → In Progress → Done) extended with the app's known
// status synonyms (mirrors the buckets in getTaskCategory()/statusColors.js). Unmapped → 999
// (sorted last). A future per-group board-import foundation can pass a board-derived map via
// sortEpicGroups(..., { phaseRanks }); this constant is the fallback.
export const DEFAULT_STATUS_PHASE_RANKS = Object.freeze({
    // 0 — To Do
    'to do': 0, 'todo': 0, 'open': 0, 'reopened': 0, 'backlog': 0, 'selected for development': 0,
    // 1 — Analysis
    'analysis': 1,
    // 2 — Ready to start
    'accepted': 2, 'awaiting validation': 2, 'postponed': 2, 'pending': 2,
    // 3 — Blocked / external
    'blocked': 3, 'external block': 3, 'on hold': 3, 'impediment': 3, 'waiting': 3, 'waiting for release': 3,
    // 4 — In progress
    'in progress': 4, 'in development': 4, 'in review': 4, 'in testing': 4, 'incomplete': 4, 'release': 4,
    // 5 — Done / terminal
    'done': 5, 'closed': 5, 'resolved': 5, 'released': 5, 'complete': 5, 'completed': 5,
    'killed': 5, 'cancelled': 5, 'canceled': 5, 'rejected': 5, "won't do": 5,
});

export const PROJECT_TRACK_EMOJI = Object.freeze({
    committed: '🔒',
    flexible: '🤷',
});

export const DEFAULT_ENG_EPIC_SORT = 'default';

export const ENG_EPIC_SORT_OPTIONS = Object.freeze([
    { value: 'default', label: 'Default (Jira order)' },
    { value: 'priority', label: 'Priority' },
    { value: 'status', label: 'Status' },
    { value: 'track-committed', label: 'Track: Committed first' },
    { value: 'track-flexible', label: 'Track: Flexible first' },
]);

export function normalizeEngEpicSort(value) {
    return ENG_EPIC_SORT_OPTIONS.some(o => o.value === value) ? value : DEFAULT_ENG_EPIC_SORT;
}

export function getEngEpicSortLabel(value) {
    const match = ENG_EPIC_SORT_OPTIONS.find(o => o.value === normalizeEngEpicSort(value));
    return match ? match.label : '';
}

// Most-urgent (lowest PRIORITY_ORDER rank) child-task priority. Returns { name, rank }.
// A present-but-unrecognized priority name resolves to rank 998 (still outranks a no-priority
// epic, which is { name:null, rank:999 } and sorts last).
export function getEpicEffectivePriority(epicGroup, priorityOrder = PRIORITY_ORDER) {
    let bestName = null;
    let bestRank = 999;
    const tasks = (epicGroup && epicGroup.tasks) || [];
    for (const task of tasks) {
        const name = task && task.fields && task.fields.priority && task.fields.priority.name;
        if (!name) continue;
        const rank = priorityOrder[name];
        const resolved = (rank === undefined || rank === null) ? 998 : rank;
        if (resolved < bestRank) {
            bestRank = resolved;
            bestName = name;
        }
    }
    return { name: bestName, rank: bestName === null ? 999 : bestRank };
}

function epicStatusName(epic) {
    const status = epic && epic.status;
    if (!status) return '';
    return typeof status === 'string' ? status : (status.name || '');
}

export function getStatusPhaseRank(statusName, phaseRanks = DEFAULT_STATUS_PHASE_RANKS) {
    if (!statusName) return 999;
    const key = String(statusName).trim().toLowerCase();
    const rank = phaseRanks[key];
    return (rank === undefined || rank === null) ? 999 : rank;
}

export function getProjectTrackRank(track, committedFirst = true) {
    const t = String(track || '').trim().toLowerCase();
    if (t === 'committed') return committedFirst ? 0 : 1;
    if (t === 'flexible') return committedFirst ? 1 : 0;
    return 2;
}

export function getProjectTrackEmoji(track) {
    const t = String(track || '').trim().toLowerCase();
    return PROJECT_TRACK_EMOJI[t] || '';
}

function epicInsertionRank(epicGroup, order) {
    const rank = order && order[epicGroup.key];
    return (rank === undefined || rank === null) ? 999999 : rank;
}

export function compareEpicGroups(a, b, sortMode, opts = {}) {
    const {
        priorityOrder = PRIORITY_ORDER,
        phaseRanks = DEFAULT_STATUS_PHASE_RANKS,
        order = {},
    } = opts;
    const mode = normalizeEngEpicSort(sortMode);
    const insertionTie = epicInsertionRank(a, order) - epicInsertionRank(b, order);
    if (mode === 'default') return insertionTie;

    const pa = getEpicEffectivePriority(a, priorityOrder).rank;
    const pb = getEpicEffectivePriority(b, priorityOrder).rank;

    if (mode === 'priority') {
        return pa !== pb ? pa - pb : insertionTie;
    }
    if (mode === 'status') {
        const sa = getStatusPhaseRank(epicStatusName(a.epic), phaseRanks);
        const sb = getStatusPhaseRank(epicStatusName(b.epic), phaseRanks);
        if (sa !== sb) return sa - sb;
        return pa !== pb ? pa - pb : insertionTie;
    }
    // track-committed | track-flexible
    const committedFirst = mode === 'track-committed';
    const ta = getProjectTrackRank(a.epic && a.epic.projectTrack, committedFirst);
    const tb = getProjectTrackRank(b.epic && b.epic.projectTrack, committedFirst);
    if (ta !== tb) return ta - tb;
    return pa !== pb ? pa - pb : insertionTie;
}

export function sortEpicGroups(groups, sortMode, opts = {}) {
    return [...(groups || [])].sort((a, b) => compareEpicGroups(a, b, sortMode, opts));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test_eng_epic_sort.js`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/eng/engTaskUtils.js tests/test_eng_epic_sort.js
git commit -m "feat(eng): add epic sort comparator and track/priority helpers"
```

---

## Task 3: Surface A — epic header priority pill + Product Track emoji

**Files:**
- Modify: `frontend/src/dashboard.jsx:29` (import), `frontend/src/dashboard.jsx:~12368` (epic-meta render)
- Modify: `frontend/src/styles/eng/epics.css` (append pill + indicator styles)
- Test: `tests/ui/eng_epic_sort_and_track.spec.js` (created here, extended in Task 4)
- Build: `frontend/dist/*`

**Interfaces:**
- Consumes: `getEpicEffectivePriority`, `getProjectTrackEmoji` from `engTaskUtils.js`; `epicGroup.epic.projectTrack` from Task 1.
- Produces: header markup `.epic-priority-pill` and `.epic-track-indicator` inside `.epic-meta`.

- [ ] **Step 1: Extend the import**

In `frontend/src/dashboard.jsx` line 29, add `getEpicEffectivePriority` and `getProjectTrackEmoji`:

```javascript
import { PRIORITY_ORDER, getEpicTeamInfo, getTaskTeamInfo, groupTasksByTeam, resetEngFilters, getEpicEffectivePriority, getProjectTrackEmoji } from './eng/engTaskUtils.js';
```

- [ ] **Step 2: Render the pill + emoji in the epic header**

In `renderEpicBlock`, locate the `.epic-meta` block (the `<div className="epic-meta">` around line 12368, immediately before the `epicStatus && <StatusPill .../>` at ~12369). Compute the badge values near the top of `renderEpicBlock` (where `epicInfo`/`epicStatus` are already derived, ~12301):

```javascript
        const effectivePriority = getEpicEffectivePriority(epicGroup);
        const projectTrackValue = epicInfo?.projectTrack || '';
        const projectTrackEmoji = getProjectTrackEmoji(projectTrackValue);
```

Then, as the FIRST children of `<div className="epic-meta">` (before the StatusPill), insert:

```jsx
                    {effectivePriority.name && (
                        <span
                            className="epic-priority-pill"
                            title={`Priority: ${effectivePriority.name}`}
                        >
                            {effectivePriority.name}
                        </span>
                    )}
                    {projectTrackEmoji && (
                        <span
                            className="epic-track-indicator"
                            title={`Product Track: ${projectTrackValue}`}
                            aria-label={`Product Track: ${projectTrackValue}`}
                        >
                            {projectTrackEmoji}
                        </span>
                    )}
```

- [ ] **Step 3: Add CSS**

Append to `frontend/src/styles/eng/epics.css` (mirrors `.epic-status-pill` sizing):

```css
.epic-priority-pill {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.18rem 0.48rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-secondary);
    background: #fff;
    white-space: nowrap;
}

.epic-track-indicator {
    font-size: 0.85rem;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    cursor: default;
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: completes; `git status --short frontend/dist` shows modified `dashboard.js` (+ its `.map`) and `dashboard.css` (the CSS build emits no sourcemap).

- [ ] **Step 5: Write the Playwright proof**

Create `tests/ui/eng_epic_sort_and_track.spec.js`. The reusable harness in `tests/ui/eng_alerts_panel_summary.spec.js` is a set of MODULE-LEVEL helpers (there is NO `beforeEach`): `installDashboardShell(page)` (imported from `./epm_home_token_fixture`; reads the built `frontend/dist/dashboard.{js,css}` from disk — so `npm run build` MUST run before the UI test), `installAlertsFixture(page)` (registers `page.route('**/api/**', ...)` stubs), `openEng(page, viewport, showAlertsPanel, prefOverrides)` (sets viewport, installs the fixture, seeds `localStorage 'jira_dashboard_ui_prefs_v1'`, navigates, waits for the ENG view), and the `story()`/`epic()` factories. Copy those helpers. The `/api/tasks-with-team-name` stub returns `{ issues, epics: { KEY: epic }, epicsInScope, names }`; ADD a `projectTrack` field to the `epic()` factory output and inject two epics: `COMMIT-1` (`projectTrack: 'Committed'`, one child task `priority.name: 'High'`) and `FLEX-1` (`projectTrack: 'Flexible'`, one child `priority.name: 'Low'`). Assertions:

```javascript
const { test, expect } = require('@playwright/test');
// Reuse installDashboardShell / installAlertsFixture / openEng / story() / epic()
// from eng_alerts_panel_summary.spec.js; add projectTrack to epic() and inject COMMIT-1/FLEX-1.

test('epic header shows effective priority pill and Product Track emoji', async ({ page }) => {
  // await openEng(page, { width: 1280, height: 900 }) with the injected fixture
  const committedHeader = page.locator('.epic-block', { hasText: 'COMMIT-1' }).locator('.epic-header');
  await expect(committedHeader.locator('.epic-priority-pill')).toHaveText(/High/i);
  await expect(committedHeader.locator('.epic-track-indicator')).toHaveText('🔒');

  const flexHeader = page.locator('.epic-block', { hasText: 'FLEX-1' }).locator('.epic-header');
  await expect(flexHeader.locator('.epic-track-indicator')).toHaveText('🤷');
});
```

- [ ] **Step 6: Run the Playwright proof**

Prereq: the app must be serving on `http://127.0.0.1:5050` — there is NO Playwright `webServer` config, so start it yourself in a separate shell: `.venv/bin/python jira_server.py` (or set `JEP_TEST_BASE_URL`). `frontend/dist` must be freshly built (Step 4).
Run: `npx playwright test eng_epic_sort_and_track`
Expected: PASS. NOTE: `npm run test:frontend:ui -- <name>` does NOT filter (the script's `tests/ui` positional OR-matches every spec) — always use `npx playwright test <name>`. If setup differs, fix the harness wiring to match the reference helpers, not the assertions.

- [ ] **Step 7: Visual proof (real app)**

Launch `.venv/bin/python jira_server.py`, open the ENG view in the Playwright MCP browser, wait for CSS transitions to settle, and screenshot an epic header showing the priority pill + 🔒/🤷. Confirm the pill sits before the status pill and the emoji sits immediately after the pill. Also check a constrained viewport (~1100px) to confirm the added badges do NOT wrap the sticky `.epic-header` onto a second line or grow its height (Project-Learnings: header pills must not increase header row height). Attach the screenshots to the PR notes.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/styles/eng/epics.css tests/ui/eng_epic_sort_and_track.spec.js frontend/dist
git commit -m "feat(eng): show epic priority pill and Product Track emoji"
```

---

## Task 4: Surface B — Sort dropdown + persisted state + sorted epicGroups

**Files:**
- Modify: `frontend/src/dashboard.jsx` (import ~29; state ~407; UI-prefs save effect ~5285–5339; `epicGroups` memo ~10294–10297; `EngView` props ~14636)
- Modify: `frontend/src/eng/EngView.jsx:~274` (Sort control)
- Test: `tests/ui/eng_epic_sort_and_track.spec.js` (extend)
- Build: `frontend/dist/*`

**Interfaces:**
- Consumes: `normalizeEngEpicSort`, `DEFAULT_ENG_EPIC_SORT`, `sortEpicGroups` (dashboard); `ENG_EPIC_SORT_OPTIONS`, `getEngEpicSortLabel` (EngView) from `engTaskUtils.js`.
- Produces: `engEpicSort` state (persisted key `engEpicSort` in `jira_dashboard_ui_prefs_v1`); `epicGroups` ordered by `sortEpicGroups`; `EngView` props `engEpicSort`, `setEngEpicSort`.

- [ ] **Step 1: Extend the dashboard import**

Update the line 29 import (from Task 3) to also bring in the sort wiring:

```javascript
import { PRIORITY_ORDER, getEpicTeamInfo, getTaskTeamInfo, groupTasksByTeam, resetEngFilters, getEpicEffectivePriority, getProjectTrackEmoji, normalizeEngEpicSort, DEFAULT_ENG_EPIC_SORT, sortEpicGroups } from './eng/engTaskUtils.js';
```

- [ ] **Step 2: Add persisted state + analytics handler next to `epmProjectSort`**

In `frontend/src/dashboard.jsx`, immediately after the `epmProjectSort` state (line 407) add:

```javascript
    const [engEpicSort, setEngEpicSort] = useState(
        normalizeEngEpicSort(savedPrefsRef.current.engEpicSort || DEFAULT_ENG_EPIC_SORT)
    );
    const handleEngEpicSortChange = (value) => {
        setEngEpicSort(value);
        // Reuse the EXISTING EPM sort analytics helper — never create a new event name
        // (the GA4 event-name allowlist is closed per AGENTS.md). Confirm the helper's exact
        // name/signature/import at the EPM Projects sort call site
        // (frontend/src/analytics/dashboardAnalytics.js, canonical event `sort_changed`).
        trackSortChanged('eng_epics', value, { feature_name: 'eng' });
    };
```

Ensure `trackSortChanged` is imported in `dashboard.jsx` (it is already used for EPM Projects sort; reuse that import — add it only if missing). `normalizeEngEpicSort`/`DEFAULT_ENG_EPIC_SORT` come from the Step 1 import.

- [ ] **Step 3: Persist it in the UI-prefs save effect**

In the `saveUiPrefs({ ... })` object inside the effect at lines 5285–5334 (the one that already lists `epmProjectSort`), add a sibling line:

```javascript
            engEpicSort,
```

Add `engEpicSort` to that effect's dependency array (line ~5339), next to `epmProjectSort`.

- [ ] **Step 4: Sort `epicGroups`**

Replace the `epicGroups` memo (lines 10294–10297) with:

```javascript
    const epicGroups = React.useMemo(() => {
        const groups = Object.values(groupTasksByEpic(visibleTasksForList));
        return sortEpicGroups(groups, engEpicSort, { order: epicOrderRef.current });
    }, [visibleTasksForList, epicDetails, engEpicSort]);
```

(`initiativeGroups` derives from `epicGroups`, so grouped views inherit the order automatically — no change there.)

- [ ] **Step 5: Pass props to `EngView`**

At the `<EngView ... />` instantiation (~line 14636), add:

```jsx
                    engEpicSort={engEpicSort}
                    setEngEpicSort={handleEngEpicSortChange}
```

- [ ] **Step 6: Render the Sort control in `EngView`**

`EngView.jsx` currently imports only React, `EmptyState`, `LoadingState` (no `engTaskUtils.js` import) — add a NEW import line:

```jsx
import { ENG_EPIC_SORT_OPTIONS, getEngEpicSortLabel } from './engTaskUtils.js';
```

Accept `engEpicSort`, `setEngEpicSort` in the destructured component props (`setEngEpicSort` is the analytics-firing handler from dashboard Step 2 — EngView stays analytics-free). Add local dropdown state + a select helper near the top of the component body:

```jsx
    const [showSortDropdown, setShowSortDropdown] = React.useState(false);
    const sortDropdownRef = React.useRef(null);
    React.useEffect(() => {
        if (!showSortDropdown) return undefined;
        const onDocClick = (e) => {
            if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target)) {
                setShowSortDropdown(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [showSortDropdown]);

    const selectEngEpicSort = (value) => {
        setEngEpicSort(value);   // dashboard handler also fires the sort_changed analytics event
        setShowSortDropdown(false);
    };
```

Insert this control immediately BEFORE the `{hasInitiativeData && (` View-controls block (~line 274), as a third sibling INSIDE the existing `.display-view-row` container so it is always visible. `eng-epic-sort-dropdown` is a unique selector hook used by the Playwright test; no new CSS is required (`.display-view-section` from `eng/filters.css` and `.sprint-dropdown*` from `shared/controls.css` already style it):

```jsx
            <div className="display-view-section">
                <div className="filters-label">Sort</div>
                <div className="sprint-dropdown eng-epic-sort-dropdown" ref={sortDropdownRef}>
                    <div
                        className={`sprint-dropdown-toggle ${showSortDropdown ? 'open' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label="Sort epics"
                        aria-expanded={showSortDropdown}
                        onClick={() => setShowSortDropdown(v => !v)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowSortDropdown(v => !v); } }}
                    >
                        <span>{getEngEpicSortLabel(engEpicSort)}</span>
                        <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M6 9L1 4h10z" /></svg>
                    </div>
                    {showSortDropdown && (
                        <div className="sprint-dropdown-panel">
                            <div className="sprint-dropdown-list">
                                {ENG_EPIC_SORT_OPTIONS.map(option => (
                                    <div
                                        key={option.value}
                                        className={`sprint-dropdown-option ${engEpicSort === option.value ? 'selected' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => selectEngEpicSort(option.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectEngEpicSort(option.value); } }}
                                    >
                                        {option.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
```

- [ ] **Step 7: Analytics — taxonomy + test (event already wired in Step 2)**

The sort-change event fires from `handleEngEpicSortChange` (Step 2) via the EXISTING `sort_changed` event / `trackSortChanged` helper — no new event name.
- Read the EPM Projects sort call site (`rg -n "trackSortChanged" frontend/src`) to confirm the helper signature and the EPM `sort_changed` taxonomy entry.
- Add a `sort_changed` row for the `eng_epics` scope to the taxonomy in `docs/README_ANALYTICS.md`, mirroring the EPM Projects `sort_changed` entry (same `event_name`, typed params).
- Add/extend a unit or assertion test that the event fires on ENG sort change, mirroring the EPM sort analytics test.
- The header track/priority badges are passive display with NO event — add a one-line No-Event Allowlist note in `docs/README_ANALYTICS.md`, consistent with existing ENG view-control toggles (`groupByInitiative` etc. emit no events).

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: completes; `frontend/dist` updated.

- [ ] **Step 9: Extend the Playwright proof**

Add to `tests/ui/eng_epic_sort_and_track.spec.js` a test that opens the Sort dropdown, picks "Track: Committed first", and asserts the committed epic's `.epic-block` appears before the flexible one in the `.task-list`:

```javascript
test('Sort dropdown reorders epics by Product Track (committed first)', async ({ page }) => {
  // ...harness navigates to the ENG view with the injected fixture (COMMIT-1 flexible-ordered after FLEX-1 initially)...
  await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle').click();
  await page.locator('.eng-epic-sort-dropdown .sprint-dropdown-option', { hasText: 'Track: Committed first' }).click();
  const keys = await page.locator('.task-list .epic-block .epic-key').allInnerTexts();
  const iCommit = keys.findIndex(k => k.includes('COMMIT-1'));
  const iFlex = keys.findIndex(k => k.includes('FLEX-1'));
  expect(iCommit).toBeGreaterThanOrEqual(0);
  expect(iCommit).toBeLessThan(iFlex);
});
```

- [ ] **Step 10: Run the Playwright proof**

Prereq: app serving on `http://127.0.0.1:5050` (no `webServer` config) — run `.venv/bin/python jira_server.py` in a separate shell (or set `JEP_TEST_BASE_URL`); `frontend/dist` freshly built (Step 8).
Run: `npx playwright test eng_epic_sort_and_track`
Expected: PASS (both tests). (`npm run test:frontend:ui -- <name>` does NOT filter — it runs the whole `tests/ui` suite.)

- [ ] **Step 11: Visual proof (real app)**

In the running app (Playwright MCP), open the Sort dropdown, confirm it reuses the `sprint-dropdown` look and sits in the existing ENG control stack without distributed/uneven spacing (Project-Learnings: one compact control stack), switch through Priority / Status / Track options, and screenshot the reordered list. Confirm the selection survives a page reload (localStorage persistence). Attach screenshots to PR notes.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/src/eng/EngView.jsx tests/ui/eng_epic_sort_and_track.spec.js frontend/dist docs/README_ANALYTICS.md
git commit -m "feat(eng): add epic Sort dropdown (priority, status, track)"
```

---

## Task 5: Full verification + docs

**Files:** `docs/plans/EXEC-eng-epic-sort-and-track.md` (status note), `docs/plans/README.md` (already indexed)

- [ ] **Step 1: Run all unit/UI/backend suites**

The UI suite needs the app serving on `http://127.0.0.1:5050` (no `webServer` config) and a freshly built `frontend/dist`; start `.venv/bin/python jira_server.py` first (or set `JEP_TEST_BASE_URL`).

```bash
npm run test:frontend:unit
npm run build
npm run test:frontend:ui    # or: npx playwright test tests/ui
python3 -m unittest discover -s tests
```
Expected: all PASS. Read the output; do not claim success without the pass lines.

- [ ] **Step 2: Verify clean dist**

Run: `npm run build && git diff --exit-code`
Expected: exit 0 (no diff). CI's `verify-frontend-build.yml` runs an UNSCOPED `git diff --exit-code` after build, so ensure neither `frontend/dist` nor any other file is left dirty.

- [ ] **Step 3: Backend server smoke (conditional)**

`tests.test_app_startup` (Task 1) already proves clean import. `/api/test` makes a LIVE Jira `myself` call, so it returns healthy only with valid local Jira/OAuth creds. If creds are available: launch `.venv/bin/python jira_server.py` and `curl http://localhost:5050/api/test`, expecting a healthy response with no warnings before the Flask banner. If creds are unavailable, skip this and rely on `test_app_startup`.

- [ ] **Step 4: Update plan outcome**

Add an `## Outcome` + `## Current Accuracy` section to this plan describing what shipped vs planned, then (after merge) rename to `DONE-eng-epic-sort-and-track.md` with the execution commit/PR note per `docs/plans/AGENTS.md`. Confirm the `docs/plans/README.md` entry still matches.

- [ ] **Step 5: Review and update root `AGENTS.md`**

Edit the root `AGENTS.md` (the real file; `CLAUDE.md`/`GEMINI.md` are symlinks to it — do not touch them). Keep the file lean (it is already large): tighten or merge rather than add near-duplicates.
- Section 11 (Project Learnings): add at most 1–2 concrete recurring-correction lines surfaced this session. Strong candidate: "When the user names a Jira field like `X[Dropdown]`, treat it as an existing Jira custom field to fetch and display, not a convention to invent." Add a second only if the implementation revealed another durable rule (e.g. "ENG epic ordering is a pure comparator in `engTaskUtils.js` `sortEpicGroups`; the Sort control reuses `sprint-dropdown`; Product Track is read-only from the configurable `projectTrackField` / `customfield_35024`; status sort uses the `DEFAULT_STATUS_PHASE_RANKS` fallback with an `opts.phaseRanks` seam for the deferred board-import foundation").
- Only edit Section 10 if a verified project fact genuinely belongs there; do not duplicate what the code already records.
- Verify `CLAUDE.md` and `GEMINI.md` still resolve to `AGENTS.md` (`ls -l CLAUDE.md GEMINI.md`).

- [ ] **Step 6: Final commit**

```bash
git add docs/plans/EXEC-eng-epic-sort-and-track.md AGENTS.md
git commit -m "docs(eng): record epic sort + track plan outcome and learnings"
```

---

## Self-Review

- **Spec coverage:** A (priority pill + Product Track emoji) → Tasks 1+3; B (sort: priority/status/track committed-first/flexible-first, priority tiebreak) → Tasks 2+4. Persistence → Task 4. Status sort uses the built-in `DEFAULT_STATUS_PHASE_RANKS` fallback (board-import foundation deferred to a later plan; comparator already accepts `opts.phaseRanks`). Column pill + grouping-by-column deferred (out of A+B scope).
- **Type consistency:** `epicGroup.epic.projectTrack` (backend key `projectTrack`, Task 1) matches frontend reads (Tasks 3, 4). Sort option values (`default`/`priority`/`status`/`track-committed`/`track-flexible`) identical across `ENG_EPIC_SORT_OPTIONS`, comparator, and the Playwright test. `getEpicEffectivePriority` returns `{name, rank}` everywhere. `sortEpicGroups(groups, mode, { order })` signature consistent between Task 2 definition and Task 4 call site.
- **Placeholder scan:** Backend/JS unit test code is complete and runnable. The two Playwright tests intentionally reference the existing `eng_alerts_panel_summary.spec.js` harness for fixture setup (a real file the executor copies) while providing concrete assertions — this is the one place exact setup is delegated to a named existing file, plus real-app MCP visual proof as a second gate.

---

## Outcome

**Status:** Executed and verified locally; pending PR/merge. Rename to `DONE-eng-epic-sort-and-track.md` after merge per `docs/plans/AGENTS.md`.

Implemented with changes on branch `feature/eng-epic-sort-and-track` (commits `603f850..d756285`, 11 commits). Verified: JS unit 412/0, full Python suite 913 OK (skipped=1), `frontend/dist` clean after build, Playwright `eng_epic_sort_and_track` 2/2 live with a normal click. Final whole-branch review (opus): READY TO MERGE — no Blocker/P1/P2.

Divergences from the plan as written:
- **Surface A shipped as a chevron, not a text pill (user feedback).** The epic priority renders via the existing story `renderPriorityIcon` chevron, and the priority + Product-Track (🔒/🤷) indicators sit at the FRONT of `.epic-title-row` (after the epic icon, before the name), mirroring the story row — not a `.epic-priority-pill` in `.epic-meta`. Commit `78e6942`; the `.epic-priority-pill` CSS was removed.
- **Review-driven fixes:** ENG Sort dropdown panel z-index lift via `.filters-strip:has(...)` so it renders above `.task-list` (`ad38bfb`); analytics `source_surface:'eng'` + extracted pure `buildSortChangedParams` with a real unit test (`003c934`); `get_project_track_field_config` made resilient to no-request-context config reads in DB mode (`d756285`).
- **Structure budgets ratcheted:** `jira_server.py` 5948→5966, `frontend/src/dashboard.jsx` 15395→15419.
- **Deferred (C-phase, not in this branch):** board-imported per-group workflow, group-by-kanban-column, the per-epic column pill. The sort comparator already accepts an injected `opts.phaseRanks` map for that future work.

## Current Accuracy

Accurate as the intent record, subject to the divergences above. Shipped code is the source of truth; this plan's Task 3 "priority pill in `.epic-meta`" text is superseded by the Task 6 chevron / title-row placement.
