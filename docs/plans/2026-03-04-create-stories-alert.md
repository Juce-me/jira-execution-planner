# Epic Labels & "Create Stories" Alerts — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Three new epic-level alerts for sprint planning:
1. **Missing Team Field** — epics in scope that have no Jira Team field set. Must be fixed before label-based alerts can group correctly.
2. **Missing Labels** — epics in scope (selected sprint + components/teams) that lack a sprint label or a team label. Surfaces labeling gaps before planning begins.
3. **Create Stories** — epics that have both sprint + team labels but no stories yet. Tells teams which epics need breakdown.

**Architecture:**
- Backend: add `labels` to epic fetch fields (only when epicLabel config exists), add `/api/jira/labels` endpoint for autocomplete, extend team catalog with `epicLabel` field.
- Frontend: add label mapping to team groups settings (with Jira label autocomplete), add "Missing Team Field" alert, add "Missing Labels" alert (fires next), then "Create Stories" alert (fires for fully-labeled epics without stories). All render per-team like Missing Info alert.

**Design doc:** N/A — this is a standalone plan.

**Tech Stack:** Python/Flask backend, React frontend, esbuild bundler, unittest.

---

## Current Baseline (2026-03-06)

Before implementing this plan, the active alert stack is:

- `🧾 Missing Info`
- `⛔️ Blocked`
- `⏭️ Postponed Work`
- `⏳ Waiting for Stories`
- `🧺 Empty Epic`
- `✅ Epic Ready to Close`

And the planned label-based pieces are **not implemented yet**:

- No `epicLabel` in group/team catalog model
- No `/api/jira/labels` endpoint
- No `labels` in empty-epic epic payload path
- No `👥 Missing Team`, `🏷️ Missing Labels`, `📝 Create Stories` alert cards

---

## Postmortem Compliance Notes

These rules from past postmortems apply to every task in this plan:

- **MRT002**: Use stable empty defaults (`EMPTY_ARRAY`, `EMPTY_OBJECT`) — never `[]`/`{}` inline in memo fallbacks. Add a stable `EMPTY_MAP` constant for Map-valued memos.
- **MRT004**: Every new `useMemo` must have an early-return guard for empty/missing data (return `EMPTY_ARRAY` or `EMPTY_MAP` immediately when inputs are falsy).
- **MRT010**: Adding `'labels'` to epic fetch fields increases startup payload. Guard: only include `'labels'` when at least one team has `epicLabel` configured (pass flag from frontend). Verify no load-time regression after Task 1.
- **MRT001**: Teams come from config, not from returned issues. `teamEpicLabelMap` uses config-derived team catalog — correct.

---

## Conflict / Precedence Matrix (Required)

To prevent duplicate epic alerts across panels, route each epic through this order and stop on first match:

1. **Postponed Work**
2. **Missing Team**
3. **Missing Labels**
4. **Create Stories**
5. **Waiting for Stories** (analysis-only path)
6. **Empty Epic** (fallback)

### Suppression rules against existing panels

- `Missing Team` epics must be excluded from `Missing Labels`, `Create Stories`, `Waiting for Stories`, and `Empty Epic`.
- `Missing Labels` epics must be excluded from `Create Stories`, `Waiting for Stories`, and `Empty Epic`.
- `Create Stories` epics must be excluded from `Waiting for Stories` and `Empty Epic`.
- Existing `Postponed Work` routing keeps priority over all of the above.
- `Waiting for Stories` should remain analysis-focused; do not use it as a second bucket for label-driven “no stories yet” epics once Create Stories is enabled.

## How It Works

### Alert 0: Missing Team Field

**Scope:** Epics from `epicsInScope` (the same pool used by Missing Info / Empty Epic alerts).

**Matching rule:** An epic triggers the "Missing Team Field" alert when:
1. The epic is not Done/Killed/dismissed
2. `getEpicTeamInfo(epic)` returns `id` that is falsy or `'Unknown Team'` (no Jira Team field set)

**Grouping:** Single flat list (no team grouping possible since team is unknown).

**Example:** Epic PROD-500 has no Jira Team field → alert fires showing the epic in a flat "Unassigned Team" list.

### Alert 1: Missing Labels

**Scope:** Epics from `epicsInScope` that DO have a valid Jira Team field (excludes those caught by Alert 0).

**Matching rule:** An epic triggers the "Missing Labels" alert when:
1. The epic is not Done/Killed/dismissed
2. The epic belongs to a team in the active group (via Jira Team field)
3. **At least one** of these labels is missing:
   - `selectedSprintInfo.name` (e.g. `"2026Q1"`) is NOT in `epic.labels[]` → missing sprint label
   - None of the configured `epicLabel` values from `teamEpicLabelMap` appear in `epic.labels[]` → missing team label

**Grouping:** Per team using `getEpicTeamInfo(epic)` (Jira Team field), same as Empty Epic alert.

**Example:** Epic PROD-500 has labels `["backend"]` but NOT `"2026Q1"` and NOT `"rnd_bsw_perimeter"`. The epic belongs to team "R&D Perimeter" via Jira Team field → alert fires showing "Missing: sprint, team" for that epic under "R&D Perimeter" group.

### Alert 2: Create Stories

**Matching rule:** An epic triggers the "Create Stories" alert for a team when:
1. `selectedSprintInfo.name` (e.g. `"2026Q1"`) is in `epic.labels[]`
2. The team's configured `epicLabel` (e.g. `"rnd_bsw_perimeter"`) is in `epic.labels[]`
3. The epic has zero actionable stories in the selected sprint (empty or no children)
4. The epic is not Done/Killed

**Example:** Epic PROD-500 has labels `["2026Q1", "rnd_bsw_perimeter"]`. Team "R&D Perimeter" has `epicLabel: "rnd_bsw_perimeter"` in its config. Sprint "2026Q1" is selected. Epic has no stories → alert fires for team "R&D Perimeter".

---

## Task 1: Backend — Add `labels` to epic fetch + return in response

**Files:**
- Modify: `jira_server.py`
- Create: `tests/test_create_stories_alert.py`

**Step 1: Write test verifying labels appear in epic response**

In `tests/test_create_stories_alert.py`:

```python
import unittest
from unittest.mock import patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    jira_server = None
    _IMPORT_ERROR = exc


class DummyResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestEpicFetchIncludesLabels(unittest.TestCase):

    @patch.object(jira_server, 'jira_search_request')
    def test_fetch_epics_for_empty_alert_includes_labels(self, mock_search):
        mock_search.return_value = DummyResponse({'issues': [
            {
                'key': 'PROD-100',
                'fields': {
                    'summary': 'Test epic',
                    'status': {'name': 'In Progress'},
                    'assignee': {'displayName': 'Alice'},
                    'labels': ['2026Q1', 'rnd_bsw_perimeter'],
                    'customfield_10100': None,
                }
            }
        ], 'total': 1})
        epics = jira_server.fetch_epics_for_empty_alert(
            'Sprint = "2026Q1"', {}, 'customfield_30101', 'customfield_10100'
        )
        self.assertEqual(len(epics), 1)
        self.assertIn('labels', epics[0])
        self.assertEqual(epics[0]['labels'], ['2026Q1', 'rnd_bsw_perimeter'])
```

**Step 2: Run test — verify it fails**

Run: `python -m pytest tests/test_create_stories_alert.py::TestEpicFetchIncludesLabels -v`
Expected: FAIL (labels not yet in fields list or response).

**Step 3: Add `labels` to epic fields list**

In `fetch_epics_for_empty_alert` (line ~1801), add `'labels'` to `fields_list`:

```python
fields_list = ['summary', 'status', 'assignee', 'labels', epic_field]
```

**Step 4: Return labels in epic data**

In the same function where epic details are built (line ~1831), add labels to the returned dict:

```python
epics.append({
    'key': issue.get('key'),
    'summary': fields.get('summary'),
    'status': {'name': status.get('name')} if status else None,
    'assignee': {'displayName': assignee.get('displayName')} if assignee else None,
    'labels': fields.get('labels', []),  # ← ADD THIS
    'team': team_value,
    'teamName': team_name,
    'teamId': team_value.get('id') if isinstance(team_value, dict) else None,
})
```

Also in `fetch_epic_details_bulk` (line ~1716), add `'labels'` to the fields and return it:

```python
fields_list = ['summary', 'reporter', 'assignee', 'labels', epic_field]
```

And in the response building for epic details, include labels:

```python
details[key] = {
    'summary': fields.get('summary', ''),
    'labels': fields.get('labels', []),
    # ... existing fields
}
```

**Step 5: Verify labels flow to frontend**

In the tasks API response builder (line ~2380), ensure `epicDetails` dict entries carry labels through.

**Step 6: Run test — verify it passes**

Run: `python -m pytest tests/test_create_stories_alert.py::TestEpicFetchIncludesLabels -v`
Expected: PASS.

**Step 7: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All existing tests pass (labels field is additive, no behavior change).

**Step 8: Commit**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "feat: add labels field to epic fetch responses"
```

---

## Task 2: Backend — `/api/jira/labels` endpoint for autocomplete

**Files:**
- Modify: `jira_server.py`
- Modify: `tests/test_create_stories_alert.py`

**Step 1: Write the failing test**

Append to `tests/test_create_stories_alert.py`:

```python
@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestJiraLabelsEndpoint(unittest.TestCase):
    def setUp(self):
        self.client = jira_server.app.test_client()
        jira_server.app.testing = True

    @patch.object(jira_server, 'resilient_jira_get')
    def test_get_labels_returns_list(self, mock_get):
        mock_get.return_value = DummyResponse({
            'values': ['2026Q1', 'rnd_bsw_perimeter', 'backend', 'frontend'],
            'total': 4
        })
        resp = self.client.get('/api/jira/labels')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn('labels', data)
        self.assertEqual(len(data['labels']), 4)

    @patch.object(jira_server, 'resilient_jira_get')
    def test_get_labels_with_query_filter(self, mock_get):
        mock_get.return_value = DummyResponse({
            'values': ['rnd_bsw_perimeter', 'rnd_bsw_chassis'],
            'total': 2
        })
        resp = self.client.get('/api/jira/labels?q=rnd')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(len(data['labels']), 2)
```

**Step 2: Run test — verify it fails**

Run: `python -m pytest tests/test_create_stories_alert.py::TestJiraLabelsEndpoint -v`
Expected: FAIL (404 — endpoint doesn't exist yet).

**Step 3: Write endpoint**

Add to `jira_server.py` after the existing API endpoints:

```python
@app.route('/api/jira/labels', methods=['GET'])
def get_jira_labels():
    """Fetch available Jira labels for autocomplete."""
    query = request.args.get('q', '').strip()

    auth_string = f"{JIRA_EMAIL}:{JIRA_TOKEN}"
    auth_bytes = auth_string.encode('ascii')
    auth_base64 = base64.b64encode(auth_bytes).decode('ascii')
    headers = {
        'Authorization': f'Basic {auth_base64}',
        'Accept': 'application/json'
    }

    try:
        url = f'{JIRA_URL}/rest/api/3/label'
        params = {'maxResults': 1000}
        resp = resilient_jira_get(url, params=params, headers=headers,
                                   timeout=15, session=HTTP_SESSION,
                                   breaker=JIRA_SEARCH_CIRCUIT_BREAKER)
        if resp.status_code != 200:
            return jsonify({'labels': [], 'error': f'Jira returned {resp.status_code}'}), 200
        data = resp.json()
        labels = data.get('values', [])
        if query:
            q_lower = query.lower()
            labels = [l for l in labels if q_lower in str(l).lower()]
        return jsonify({'labels': labels})
    except Exception as e:
        log_warning(f'Failed to fetch Jira labels: {e}')
        return jsonify({'labels': [], 'error': str(e)}), 200
```

**Step 4: Run tests — verify pass**

Run: `python -m pytest tests/test_create_stories_alert.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "feat: add /api/jira/labels endpoint for label autocomplete"
```

---

## Task 3: Backend — Extend team catalog with `epicLabel` field

**Files:**
- Modify: `jira_server.py` (update `normalize_team_catalog`)
- Modify: `tests/test_create_stories_alert.py`

**Step 1: Write test**

Append to `tests/test_create_stories_alert.py`:

```python
@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestTeamCatalogEpicLabel(unittest.TestCase):

    def test_normalize_preserves_epic_label(self):
        raw = [
            {'id': 'T1', 'name': 'Team A', 'epicLabel': 'rnd_bsw_perimeter'},
            {'id': 'T2', 'name': 'Team B'}
        ]
        result = jira_server.normalize_team_catalog(raw)
        self.assertEqual(result['T1']['epicLabel'], 'rnd_bsw_perimeter')
        self.assertEqual(result['T2'].get('epicLabel', ''), '')

    def test_normalize_dict_form_preserves_epic_label(self):
        raw = {
            'T1': {'id': 'T1', 'name': 'Team A', 'epicLabel': 'rnd_bsw_chassis'},
            'T2': {'id': 'T2', 'name': 'Team B'}
        }
        result = jira_server.normalize_team_catalog(raw)
        self.assertEqual(result['T1']['epicLabel'], 'rnd_bsw_chassis')
        self.assertEqual(result['T2'].get('epicLabel', ''), '')
```

**Step 2: Run test — verify it fails**

Run: `python -m pytest tests/test_create_stories_alert.py::TestTeamCatalogEpicLabel -v`
Expected: FAIL (epicLabel not in output).

**Step 3: Update `normalize_team_catalog`**

In `jira_server.py` line ~1416, add `epicLabel` to the catalog entry in BOTH branches (list and dict):

```python
catalog[team_id] = {
    'id': team_id,
    'name': name,
    'epicLabel': str(item.get('epicLabel') or '').strip()  # ← ADD
}
```

**Step 4: Run tests — verify pass**

Run: `python -m pytest tests/ -v`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "feat: extend team catalog with epicLabel field"
```

---

## Task 4: Frontend — Label autocomplete in team groups settings

**Files:**
- Modify: `frontend/src/dashboard.jsx` (settings modal, team selector section)

**Step 1: Add label fetch state**

Near other settings state (around line 383+):

```js
const [jiraLabels, setJiraLabels] = useState([]);
const [jiraLabelsLoading, setJiraLabelsLoading] = useState(false);
```

**Step 2: Add fetch effect**

When settings modal opens, fetch labels:

```js
useEffect(() => {
    if (!showSettings) return;
    let cancelled = false;
    setJiraLabelsLoading(true);
    fetch(`${BACKEND_URL}/api/jira/labels`)
        .then(r => r.json())
        .then(data => {
            if (!cancelled) setJiraLabels(data.labels || []);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setJiraLabelsLoading(false); });
    return () => { cancelled = true; };
}, [showSettings]);
```

**Step 3: Add epicLabel UI to team selector**

In the team selector section (line ~12911-12958), after each team chip, add an "Epic Label" input with autocomplete dropdown. For each selected team:

```jsx
{(activeGroupDraft.teamIds || []).map((teamId) => {
    const teamName = resolveTeamName(teamId);
    const catalogEntry = groupDraft?.teamCatalog?.[teamId] || {};
    const currentLabel = catalogEntry.epicLabel || '';
    return (
        <div key={teamId} className="selected-team-chip">
            <span className="team-name">{teamName}</span>
            <div className="team-label-picker">
                <input
                    type="text"
                    className="team-label-input"
                    placeholder="Epic label..."
                    value={currentLabel}
                    onChange={(e) => updateTeamEpicLabel(teamId, e.target.value)}
                    list={`labels-${teamId}`}
                />
                <datalist id={`labels-${teamId}`}>
                    {jiraLabels.map(l => <option key={l} value={l} />)}
                </datalist>
            </div>
            <button className="remove-btn" onClick={() => removeTeamFromGroup(activeGroupDraft.id, teamId)}>×</button>
        </div>
    );
})}
```

**Step 4: Add `updateTeamEpicLabel` handler**

```js
const updateTeamEpicLabel = (teamId, label) => {
    setGroupDraft(prev => {
        const catalog = { ...(prev.teamCatalog || {}) };
        catalog[teamId] = { ...(catalog[teamId] || {}), epicLabel: label };
        return { ...prev, teamCatalog: catalog };
    });
};
```

This persists through the existing save flow — `teamCatalog` is already saved to the groups config.

**Step 5: Build**

Run: `npm run build`

**Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: add epic label picker to team groups settings"
```

---

## Task 5: Frontend — Alert state + stable constants + `teamEpicLabelMap` memo

**Files:**
- Modify: `frontend/src/dashboard.jsx`

This task sets up the shared infrastructure for all three new alerts.

**Step 1: Add stable `EMPTY_MAP` constant (near line 7-8, next to existing EMPTY_ARRAY/EMPTY_OBJECT)**

```js
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_MAP = Object.freeze(new Map());  // ← ADD
```

**Step 2: Add three alert toggle states (near line ~388, after `showDoneEpicAlert`)**

```js
const [showMissingTeamAlert, setShowMissingTeamAlert] = useState(savedPrefsRef.current.showMissingTeamAlert ?? true);
const [showMissingLabelsAlert, setShowMissingLabelsAlert] = useState(savedPrefsRef.current.showMissingLabelsAlert ?? true);
const [showCreateStoriesAlert, setShowCreateStoriesAlert] = useState(savedPrefsRef.current.showCreateStoriesAlert ?? true);
```

**Step 3: Wire into `saveUiPrefs` effect (line ~3011-3067)**

Add to the `saveUiPrefs({...})` object (after `showDoneEpicAlert`):

```js
showMissingTeamAlert,
showMissingLabelsAlert,
showCreateStoriesAlert,
```

Add to the dependency array (after `showDoneEpicAlert`):

```js
showMissingTeamAlert,
showMissingLabelsAlert,
showCreateStoriesAlert,
```

**Step 4: Wire into `buildDefaultGroupState` (line ~2532, after `showDoneEpicAlert`)**

```js
showMissingTeamAlert: savedPrefsRef.current.showMissingTeamAlert ?? true,
showMissingLabelsAlert: savedPrefsRef.current.showMissingLabelsAlert ?? true,
showCreateStoriesAlert: savedPrefsRef.current.showCreateStoriesAlert ?? true,
```

**Step 5: Wire into `buildGroupStateSnapshot` (line ~2600, after `showDoneEpicAlert`)**

```js
showMissingTeamAlert,
showMissingLabelsAlert,
showCreateStoriesAlert,
```

**Step 6: Wire into `applyGroupState` (line ~2696, after `setShowDoneEpicAlert`)**

```js
setShowMissingTeamAlert(nextState.showMissingTeamAlert ?? true);
setShowMissingLabelsAlert(nextState.showMissingLabelsAlert ?? true);
setShowCreateStoriesAlert(nextState.showCreateStoriesAlert ?? true);
```

**Step 7: Build `teamEpicLabelMap` memo with early-return guard**

After the groups config is loaded:

```js
const teamEpicLabelMap = React.useMemo(() => {
    const catalog = groupsConfig?.teamCatalog;
    if (!catalog) return EMPTY_MAP;
    const map = new Map();
    Object.entries(catalog).forEach(([teamId, entry]) => {
        const label = (entry?.epicLabel || '').trim();
        if (label) map.set(label, { teamId, teamName: entry?.name || teamId });
    });
    return map.size > 0 ? map : EMPTY_MAP;
}, [groupsConfig?.teamCatalog]);
```

> **MRT002 compliance**: returns stable `EMPTY_MAP` when no labels configured, preventing downstream memo recalculations.

**Step 8: Build + verify**

Run: `npm run build`

**Step 9: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: add alert toggle states, EMPTY_MAP constant, and teamEpicLabelMap memo"
```

---

## Task 6: Frontend — "Missing Team Field" alert (data + rendering)

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Build `missingTeamEpics` memo**

Near the other alert memos (line ~8290). Must have early-return guard per MRT004:

```js
const missingTeamEpics = React.useMemo(() => {
    if (!epicsInScope || epicsInScope.length === 0) return EMPTY_ARRAY;

    const results = [];
    const seen = new Set();

    epicsInScope.forEach(epic => {
        if (!epic?.key || seen.has(epic.key)) return;
        seen.add(epic.key);

        const status = normalizeStatus(epic.status?.name || '');
        if (status === 'done' || status === 'killed') return;
        if (dismissedAlertSet.has(epic.key)) return;

        const epicTeam = getEpicTeamInfo(epic);
        const hasTeam = epicTeam.id && epicTeam.id !== 'Unknown Team' && epicTeam.name !== 'Unknown Team';
        if (hasTeam) return; // has team field, skip

        results.push({
            key: epic.key,
            summary: epic.summary || '',
            status: epic.status?.name || ''
        });
    });

    return results.length > 0 ? results : EMPTY_ARRAY;
}, [epicsInScope, dismissedAlertSet]);
```

> **MRT004 compliance**: early return on empty `epicsInScope`. Returns `EMPTY_ARRAY` when no results.

**Step 2: Add alert card JSX**

Render **before** Missing Labels alert. Uses a flat list (no team grouping since team is unknown):

```jsx
{missingTeamEpics.length > 0 && (
    <div className={`alert-card missing-team ${showMissingTeamAlert ? '' : 'collapsed'}`}>
        <div
            className="alert-card-header"
            role="button"
            tabIndex={0}
            onClick={() => setShowMissingTeamAlert(prev => !prev)}
        >
            <div className="alert-header-left">
                <span className={`alert-collapse-toggle ${showMissingTeamAlert ? 'open' : ''}`}>▸</span>
                <div className="alert-title">👥 Missing Team</div>
                <div className="alert-subtitle">
                    These epics have no Jira Team field set — assign a team before planning labels or stories.
                </div>
            </div>
            <a
                className="alert-chip"
                href={buildKeyListLink(missingTeamEpics.map(item => item.key))}
                target="_blank"
                rel="noopener noreferrer"
                title="Open these epics in Jira"
                onClick={e => e.stopPropagation()}
            >
                {missingTeamEpics.length} {missingTeamEpics.length === 1 ? 'epic' : 'epics'}
            </a>
        </div>
        <div className={`alert-card-body ${showMissingTeamAlert ? '' : 'collapsed'}`}>
            <div className="alert-stories">
                {missingTeamEpics.map((epic) => (
                    <div key={epic.key} className="alert-story">
                        <div className="alert-story-main" role="button" tabIndex={0}
                             onClick={() => handleAlertStoryClick(epic.key)}>
                            <a
                                className="alert-story-link"
                                href={`${jiraUrl}/browse/${epic.key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                            >
                                {epic.key} · {epic.summary}
                            </a>
                        </div>
                        <button className="task-remove alert-remove"
                                onClick={() => dismissAlertItem(epic.key)}>×</button>
                    </div>
                ))}
            </div>
        </div>
    </div>
)}
```

**Step 3: Build + verify**

Run: `npm run build`

**Step 4: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: add Missing Team Field alert for epics without Jira team"
```

---

## Task 7: Frontend — "Missing Labels" alert data collection

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Build `missingTeamEpicKeys` set (for exclusion)**

```js
const missingTeamEpicKeys = React.useMemo(() => {
    if (missingTeamEpics === EMPTY_ARRAY) return EMPTY_OBJECT;
    return new Set(missingTeamEpics.map(e => e.key));
}, [missingTeamEpics]);
```

**Step 2: Build `missingLabelsEpics` memo**

Near the other alert memos, **after** `missingTeamEpics`:

```js
const missingLabelsEpics = React.useMemo(() => {
    if (teamEpicLabelMap === EMPTY_MAP) return EMPTY_ARRAY;
    const sprintLabel = selectedSprintInfo?.name;
    if (!sprintLabel) return EMPTY_ARRAY;
    if (!epicsInScope || epicsInScope.length === 0) return EMPTY_ARRAY;

    const results = [];
    const seen = new Set();
    const epicPool = epicsInScope;

    epicPool.forEach(epic => {
        if (!epic?.key || seen.has(epic.key)) return;
        seen.add(epic.key);

        // Skip epics already flagged for missing team (Alert 0)
        if (missingTeamEpicKeys instanceof Set && missingTeamEpicKeys.has(epic.key)) return;

        const status = normalizeStatus(epic.status?.name || '');
        if (status === 'done' || status === 'killed') return;
        if (dismissedAlertSet.has(epic.key)) return;

        // Team filter: only check epics belonging to teams in active group
        const epicTeam = getEpicTeamInfo(epic);
        if (!isAllTeamsSelected && !selectedTeamSet.has(epicTeam.id)) return;

        const labels = epic.labels || EMPTY_ARRAY;
        const hasSprintLabel = labels.includes(sprintLabel);
        const hasTeamLabel = labels.some(l => teamEpicLabelMap.has(l));

        const missingTypes = [];
        if (!hasSprintLabel) missingTypes.push('sprint');
        if (!hasTeamLabel) missingTypes.push('team');

        if (missingTypes.length === 0) return; // fully labeled, skip

        results.push({
            key: epic.key,
            summary: epic.summary || '',
            labels,
            status: epic.status?.name || '',
            missingTypes,
            teamId: epicTeam.id,
            teamName: epicTeam.name
        });
    });

    return results.length > 0 ? results : EMPTY_ARRAY;
}, [
    selectedSprintInfo?.name, teamEpicLabelMap, epicsInScope,
    missingTeamEpicKeys, dismissedAlertSet, isAllTeamsSelected, selectedTeamSet
]);
```

> **MRT004 compliance**: three early-return guards. **MRT002**: uses `EMPTY_ARRAY` for empty `labels` fallback instead of inline `[]`.

**Step 3: Group by team**

```js
const missingLabelsTeams = groupAlertsByTeam(
    missingLabelsEpics,
    (item) => ({ id: item.teamId, name: item.teamName }),
    (a, b) => (a.key || '').localeCompare(b.key || '')
);
```

**Step 4: Build + verify**

Run: `npm run build`

**Step 5: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: add missingLabelsEpics memo for epics without sprint/team labels"
```

---

## Task 8: Frontend — "Missing Labels" alert rendering

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Add alert card JSX**

Render **after** Missing Team, **before** Create Stories. Follow the same pattern as Missing Info / Empty Epic:

```jsx
{missingLabelsEpics.length > 0 && (
    <div className={`alert-card missing-labels ${showMissingLabelsAlert ? '' : 'collapsed'}`}>
        <div
            className="alert-card-header"
            role="button"
            tabIndex={0}
            onClick={() => setShowMissingLabelsAlert(prev => !prev)}
        >
            <div className="alert-header-left">
                <span className={`alert-collapse-toggle ${showMissingLabelsAlert ? 'open' : ''}`}>▸</span>
                <div className="alert-title">🏷️ Missing Labels</div>
                <div className="alert-subtitle">
                    These epics are missing sprint or team labels — add labels before assigning stories or teams.
                </div>
            </div>
            <a
                className="alert-chip"
                href={buildKeyListLink(missingLabelsEpics.map(item => item.key))}
                target="_blank"
                rel="noopener noreferrer"
                title="Open these epics in Jira"
                onClick={e => e.stopPropagation()}
            >
                {missingLabelsEpics.length} {missingLabelsEpics.length === 1 ? 'epic' : 'epics'}
            </a>
        </div>
        <div className={`alert-card-body ${showMissingLabelsAlert ? '' : 'collapsed'}`}>
            {missingLabelsTeams.map(group => {
                const keys = group.items.map(item => item.key);
                const teamLink = buildKeyListLink(keys);
                return (
                    <div key={group.id} className="alert-team-group">
                        <div className="alert-team-header">
                            {teamLink ? (
                                <a className="alert-team-link" href={teamLink} target="_blank" rel="noopener noreferrer">
                                    <span className="alert-pill team">{group.name}</span>
                                    <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'} missing labels</span>
                                </a>
                            ) : (
                                <div className="alert-team-title">
                                    <span className="alert-pill team">{group.name}</span>
                                    <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'} missing labels</span>
                                </div>
                            )}
                        </div>
                        <div className="alert-stories">
                            {group.items.map((epic) => (
                                <div key={epic.key} className="alert-story">
                                    <div className="alert-story-main" role="button" tabIndex={0}
                                         onClick={() => handleAlertStoryClick(epic.key)}>
                                        <a
                                            className="alert-story-link"
                                            href={`${jiraUrl}/browse/${epic.key}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                        >
                                            {epic.key} · {epic.summary}
                                        </a>
                                    </div>
                                    <span className="alert-pill status">
                                        Missing: {epic.missingTypes.join(', ')}
                                    </span>
                                    <button className="task-remove alert-remove"
                                            onClick={() => dismissAlertItem(epic.key)}>×</button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
)}
```

> **CSS note**: uses existing `.alert-pill.status` class (red-tinted, `background: #fff1f0; color: #d4380d`) — matches existing "Missing: SP, Epic, Team" pills in Missing Info alert. No new CSS class needed.

**Step 2: Build + verify**

Run: `npm run build`

**Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: render Missing Labels alert panel with per-team groups"
```

---

## Task 9: Frontend — "Create Stories" alert data collection

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Build `createStoriesEpics` memo**

Near the other alert memos, **after** `missingLabelsEpics`:

```js
const createStoriesEpics = React.useMemo(() => {
    if (teamEpicLabelMap === EMPTY_MAP) return EMPTY_ARRAY;
    const sprintLabel = selectedSprintInfo?.name;
    if (!sprintLabel) return EMPTY_ARRAY;
    if (!epicsInScope || epicsInScope.length === 0) return EMPTY_ARRAY;

    const results = [];
    const epicPool = [...(epicsInScope || EMPTY_ARRAY), ...Object.values(epicDetails || EMPTY_OBJECT)];
    const seen = new Set();

    epicPool.forEach(epic => {
        if (!epic?.key || seen.has(epic.key)) return;
        seen.add(epic.key);

        const status = normalizeStatus(epic.status?.name || epic.status || '');
        if (status === 'done' || status === 'killed') return;
        if (dismissedAlertSet.has(epic.key)) return;

        const labels = epic.labels || epic.fields?.labels || EMPTY_ARRAY;
        if (!labels.includes(sprintLabel)) return;

        // Find which teams this epic matches via labels
        const matchedTeams = [];
        labels.forEach(label => {
            const teamInfo = teamEpicLabelMap.get(label);
            if (teamInfo) {
                if (isAllTeamsSelected || selectedTeamSet.has(teamInfo.teamId)) {
                    matchedTeams.push(teamInfo);
                }
            }
        });

        if (matchedTeams.length === 0) return;

        // Check if epic has stories in the selected sprint
        const hasStories = epicsWithActionableStoriesInSelectedSprint?.has(epic.key);
        if (hasStories) return;

        matchedTeams.forEach(team => {
            results.push({
                epic: { key: epic.key, summary: epic.summary || '', labels, status: epic.status || '' },
                teamId: team.teamId,
                teamName: team.teamName
            });
        });
    });

    return results.length > 0 ? results : EMPTY_ARRAY;
}, [
    selectedSprintInfo?.name, teamEpicLabelMap, epicDetails, epicsInScope,
    dismissedAlertSet, isAllTeamsSelected, selectedTeamSet,
    epicsWithActionableStoriesInSelectedSprint
]);
```

> **MRT004 compliance**: three early-return guards. **MRT002**: stable `EMPTY_ARRAY`/`EMPTY_OBJECT` fallbacks.

**Step 2: Group by team**

```js
const createStoriesTeams = groupAlertsByTeam(
    createStoriesEpics,
    (item) => ({ id: item.teamId, name: item.teamName }),
    (a, b) => (a.epic.key || '').localeCompare(b.epic.key || '')
);
```

**Step 3: Build + verify**

Run: `npm run build`

**Step 4: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: add createStoriesEpics memo with sprint+team label matching"
```

---

## Task 10: Frontend — "Create Stories" alert rendering

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Add alert card JSX**

After the Missing Labels alert card, add following the same pattern:

```jsx
{createStoriesEpics.length > 0 && (
    <div className={`alert-card create-stories ${showCreateStoriesAlert ? '' : 'collapsed'}`}>
        <div
            className="alert-card-header"
            role="button"
            tabIndex={0}
            onClick={() => setShowCreateStoriesAlert(prev => !prev)}
        >
            <div className="alert-header-left">
                <span className={`alert-collapse-toggle ${showCreateStoriesAlert ? 'open' : ''}`}>▸</span>
                <div className="alert-title">📝 Create Stories</div>
                <div className="alert-subtitle">
                    These epics are tagged for this sprint and team but have no stories yet — time to break them down.
                </div>
            </div>
            <a
                className="alert-chip"
                href={buildKeyListLink(createStoriesEpics.map(item => item.epic.key))}
                target="_blank"
                rel="noopener noreferrer"
                title="Open these epics in Jira"
                onClick={e => e.stopPropagation()}
            >
                {createStoriesEpics.length} {createStoriesEpics.length === 1 ? 'epic' : 'epics'}
            </a>
        </div>
        <div className={`alert-card-body ${showCreateStoriesAlert ? '' : 'collapsed'}`}>
            {createStoriesTeams.map(group => {
                const keys = group.items.map(item => item.epic.key);
                const teamLink = buildKeyListLink(keys);
                return (
                    <div key={group.id} className="alert-team-group">
                        <div className="alert-team-header">
                            {teamLink ? (
                                <a className="alert-team-link" href={teamLink} target="_blank" rel="noopener noreferrer">
                                    <span className="alert-pill team">{group.name}</span>
                                    <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'} need stories</span>
                                </a>
                            ) : (
                                <div className="alert-team-title">
                                    <span className="alert-pill team">{group.name}</span>
                                    <span>{group.items.length} {group.items.length === 1 ? 'epic' : 'epics'} need stories</span>
                                </div>
                            )}
                        </div>
                        <div className="alert-stories">
                            {group.items.map(({ epic }) => (
                                <div key={`${epic.key}-${group.id}`} className="alert-story">
                                    <div className="alert-story-main" role="button" tabIndex={0}
                                         onClick={() => handleAlertStoryClick(epic.key)}>
                                        <a
                                            className="alert-story-link"
                                            href={`${jiraUrl}/browse/${epic.key}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                        >
                                            {epic.key} · {epic.summary}
                                        </a>
                                    </div>
                                    <span className="alert-pill status">
                                        Labels: {epic.labels.filter(l => l !== selectedSprintInfo?.name).join(', ') || 'none'}
                                    </span>
                                    <button className="task-remove alert-remove"
                                            onClick={() => dismissAlertItem(epic.key)}>×</button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
)}
```

**Step 2: Build + verify**

Run: `npm run build`

**Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: render Create Stories alert panel with per-team groups"
```

---

## Task 10.5: Frontend — Conflict suppression wiring with existing alerts

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Goal:** enforce one-home-per-epic routing for label-driven alerts vs existing `Waiting for Stories` / `Empty Epic` / `Postponed Work`.

**Implementation:**

1. Build key sets:
   - `missingTeamEpicKeySet`
   - `missingLabelsEpicKeySet`
   - `createStoriesEpicKeySet`

2. Apply suppression in downstream memo filters:
   - `waitingForStoriesEpics`: exclude keys in the three sets above
   - `emptyEpicsForAlert`: exclude keys in the three sets above

3. Keep postponed routing first:
   - If epic is routed by postponed logic (`status = postponed` or `futureOpenStories` rule), it must not appear in label-driven alerts.

4. Add one test/memo assertion path (frontend unit or integration-style smoke check) that a sample epic can appear in only one of these panels.

**Build + verify**

Run:

```bash
npm run build
python -m pytest tests/ -v
```

**Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: enforce precedence between label-driven and existing epic alerts"
```

---

## Task 11: CSS + ALERT_RULES.md

**Files:**
- Modify: `frontend/dist/dashboard.css` (team label picker styles)
- Modify: `ALERT_RULES.md`

**Step 1: Add team label picker CSS**

> **CSS conformance note**: The Missing Labels pill uses existing `.alert-pill.status` class (`background: #fff1f0; color: #d4380d`) — same as Missing Info alert pills. No new pill class needed. Only the label picker input in settings needs new CSS.

```css
/* Team epic label picker in settings */
.team-label-picker { display: flex; align-items: center; margin-left: 8px; }
.team-label-input {
    background: #1e293b; color: #e2e8f0; border: 1px solid #475569;
    border-radius: 4px; padding: 2px 6px; font-size: 0.72rem; width: 140px;
}
.team-label-input::placeholder { color: #64748b; }
.team-label-input:focus { border-color: #60a5fa; outline: none; }
```

**Step 2: Update ALERT_RULES.md**

Add three new sections:

```markdown
### 👥 Missing Team
- **Trigger:** Epic is in scope (selected sprint) but has no Jira Team field set (`getEpicTeamInfo` returns `'Unknown Team'`).
- **Excluded:** Done or Killed epics; dismissed items.
- **Grouping:** Flat list (no team grouping possible).
- **Purpose:** Must be fixed before label-based alerts can group correctly.

### 🏷️ Missing Labels
- **Trigger:** Epic is in scope, has a Jira Team field, but is missing the sprint label (`selectedSprintInfo.name` not in `epic.labels[]`) or a team label (no configured `epicLabel` found in `epic.labels[]`).
- **Excluded:** Done or Killed epics; dismissed items; epics already flagged by Missing Team alert.
- **Grouping:** Per team (via Jira Team field, same as Empty Epic alert).
- **Pill:** Shows which labels are missing: "Missing: sprint", "Missing: team", or "Missing: sprint, team".
- **Purpose:** Surfaces labeling gaps before planning — add labels before assigning stories or teams.

### 📝 Create Stories
- **Trigger:** Epic has the current sprint name AND a team's configured `epicLabel` in its Jira `labels[]` field, but has no actionable stories in the selected sprint.
- **Excluded:** Done or Killed epics; dismissed items.
- **Grouping:** Per team (matched via `epicLabel` in team catalog).
- **Configuration:** Each team's `epicLabel` is set in Dashboard Settings → Team Groups → select a team → "Epic label" field (autocompletes from Jira labels).
- **Sprint matching:** The selected sprint name (e.g. `2026Q1`) must appear as a label on the epic.
```

**Step 3: Build + full test suite**

Run: `npm run build && python -m pytest tests/ -v`

**Step 4: Commit**

```bash
git add frontend/dist/dashboard.css ALERT_RULES.md
git commit -m "feat: add CSS for label picker and document alert rules"
```

---

## Task 12: Smoke test + load-time regression check + push

**Step 1: `git pull --rebase`**

```bash
git pull --rebase origin main
```

Resolve any conflicts if needed, then re-run `npm run build && python -m pytest tests/ -v`.

**Step 2: Manual smoke test checklist**

Verify in browser (per MRT007):

- [ ] Page loads in < 1 second (per MRT010 — adding `labels` to epic fetch must not cause regression)
- [ ] Dashboard Settings → Team Groups → team chips show "Epic label" input with autocomplete
- [ ] Save a label config → reload → label persists
- [ ] Alerts panel shows "Missing Team" for epics with no Jira Team field (if any exist)
- [ ] Alerts panel shows "Missing Labels" for epics with team but missing sprint/team labels
- [ ] Alerts panel shows "Create Stories" for epics with both labels but no stories
- [ ] Missing Labels pills show "Missing: sprint", "Missing: team", or "Missing: sprint, team"
- [ ] Alert toggle (collapse/expand) works for all three new alerts
- [ ] Dismiss (×) works for all three new alerts
- [ ] Alert toggle state persists across page reload (localStorage)
- [ ] No console errors

**Step 3: Push**

```bash
git push origin feat/create-stories-alert
```

---

## Execution Summary

| Task | What | Files | ~Lines |
|------|------|-------|--------|
| 1 | Add `labels` to epic fetch + test | `jira_server.py`, `test_create_stories_alert.py` | ~25 |
| 2 | `/api/jira/labels` endpoint + tests | `jira_server.py`, `test_create_stories_alert.py` | ~60 |
| 3 | `epicLabel` in team catalog + tests | `jira_server.py`, `test_create_stories_alert.py` | ~25 |
| 4 | Label picker in settings UI | `dashboard.jsx` | ~50 |
| 5 | Alert state + EMPTY_MAP + teamEpicLabelMap | `dashboard.jsx` | ~40 |
| 6 | Missing Team alert (data + rendering) | `dashboard.jsx` | ~70 |
| 7 | Missing Labels data collection | `dashboard.jsx` | ~55 |
| 8 | Missing Labels alert rendering | `dashboard.jsx` | ~70 |
| 9 | Create Stories data collection | `dashboard.jsx` | ~55 |
| 10 | Create Stories alert rendering | `dashboard.jsx` | ~70 |
| 11 | CSS + ALERT_RULES.md | `dashboard.css`, `ALERT_RULES.md` | ~35 |
| 12 | Smoke test + regression check + push | — | — |
| **Total** | | **5 files** | **~555 lines** |

## Configuration Flow

1. User opens **Dashboard Settings → Team Groups**
2. Selects a group, sees team chips
3. Each team chip now has an **"Epic label"** input with Jira label autocomplete
4. User types `rnd_bsw_perimeter` (autocompleted from Jira) for team "R&D Perimeter"
5. Saves config → `teamCatalog[teamId].epicLabel = "rnd_bsw_perimeter"` persisted

## Alert Flow

1. Sprint "2026Q1" selected
2. Epics loaded with `labels[]` field
3. **Missing Team** (fires first): for each epic in scope:
   - If Jira Team field is unset → show in flat "Unassigned Team" list
4. **Missing Labels** (fires next): for each epic in scope WITH a valid Jira Team field:
   - Check if `"2026Q1"` is in `epic.labels[]` — if not → missing sprint label
   - Check if any configured `epicLabel` is in `epic.labels[]` — if not → missing team label
   - Shows "Missing: sprint, team" pills per epic, grouped by Jira team
5. **Create Stories** (fires for fully-labeled epics): for each epic with both sprint + team labels:
   - Check if epic has zero stories in the sprint
   - If no stories → add to "Create Stories" alert for that team
6. **Suppression pass:** remove routed epics from `Waiting for Stories` and `Empty Epic` (and from lower-priority label buckets) using the precedence matrix above.
7. All alerts render per-team (except Missing Team which is flat), same style as Missing Info
