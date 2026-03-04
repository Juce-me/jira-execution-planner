# "Create Stories" Alert — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Create Stories" alert panel that shows epics (per team) which have both the current sprint label AND the team's configured label in their Jira `labels[]` field — but have no stories yet. This tells teams which epics need stories created for the upcoming sprint.

**Architecture:**
- Backend: add `labels` to epic fetch fields, add `/api/jira/labels` endpoint for autocomplete, extend team catalog with `epicLabel` field.
- Frontend: add label mapping to team groups settings (with Jira label autocomplete), add new alert that filters epics by sprint+team labels, render per-team like Missing Info alert.

**Design doc:** `docs/plans/2026-03-03-epic-lead-time-cohort-design.md` (N/A — this is a standalone plan)

**Tech Stack:** Python/Flask backend, React frontend, esbuild bundler, unittest.

---

## How It Works

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
- Modify: `tests/test_burnout_stats_api.py` (or new test file)

**Step 1: Add `labels` to epic fields list**

In `fetch_epics_for_empty_alert` (line ~1801), add `'labels'` to `fields_list`:

```python
fields_list = ['summary', 'status', 'assignee', 'labels', epic_field]
```

**Step 2: Return labels in epic data**

In the same function where epic details are built (line ~1831), add labels to the returned dict:

```python
epic_data = {
    'key': epic.get('key'),
    'summary': fields.get('summary', ''),
    'status': (fields.get('status') or {}).get('name', ''),
    'labels': fields.get('labels', []),  # ← ADD THIS
    # ... existing fields
}
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

**Step 3: Verify labels flow to frontend**

In the tasks API response builder (line ~2380), ensure `epicDetails` dict entries carry labels through.

**Step 4: Build + test**

Run: `python -m pytest tests/ -v`
Expected: All existing tests pass (labels field is additive, no behavior change).

**Step 5: Commit**

```bash
git add jira_server.py
git commit -m "feat: add labels field to epic fetch responses"
```

---

## Task 2: Backend — `/api/jira/labels` endpoint for autocomplete

**Files:**
- Modify: `jira_server.py`
- Create or modify: `tests/test_create_stories_alert.py`

**Step 1: Write the failing test**

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

**Step 2: Write endpoint**

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

**Step 3: Run tests**

Run: `python -m pytest tests/test_create_stories_alert.py -v`
Expected: PASS.

**Step 4: Commit**

```bash
git add jira_server.py tests/test_create_stories_alert.py
git commit -m "feat: add /api/jira/labels endpoint for label autocomplete"
```

---

## Task 3: Backend — Extend team catalog with `epicLabel` field

**Files:**
- Modify: `jira_server.py` (update `normalize_team_catalog`)

**Step 1: Add test**

In `tests/test_create_stories_alert.py`:

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
```

**Step 2: Update `normalize_team_catalog`**

In `jira_server.py` line ~1416, add `epicLabel` to the catalog entry:

```python
def normalize_team_catalog(raw):
    catalog = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            team_id = str(item.get('id') or '').strip()
            name = str(item.get('name') or '').strip()
            if not team_id or not name:
                continue
            catalog[team_id] = {
                'id': team_id,
                'name': name,
                'epicLabel': str(item.get('epicLabel') or '').strip()  # ← ADD
            }
    elif isinstance(raw, dict):
        for team_id, entry in raw.items():
            if not isinstance(entry, dict):
                continue
            tid = str(entry.get('id') or team_id).strip()
            name = str(entry.get('name') or '').strip()
            if not tid or not name:
                continue
            catalog[tid] = {
                'id': tid,
                'name': name,
                'epicLabel': str(entry.get('epicLabel') or '').strip()  # ← ADD
            }
    return catalog
```

**Step 3: Run tests**

Run: `python -m pytest tests/ -v`

**Step 4: Commit**

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

## Task 5: Frontend — "Create Stories" alert data collection

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Add alert toggle state (line ~388)**

```js
const [showCreateStoriesAlert, setShowCreateStoriesAlert] = useState(savedPrefsRef.current.showCreateStoriesAlert ?? true);
```

Add to `saveUiPrefs` effect dependency array and object.

**Step 2: Build teamEpicLabelMap memo**

After the groups config is loaded:

```js
const teamEpicLabelMap = React.useMemo(() => {
    const map = new Map();
    const catalog = groupsConfig?.teamCatalog || {};
    Object.entries(catalog).forEach(([teamId, entry]) => {
        const label = (entry?.epicLabel || '').trim();
        if (label) map.set(label, { teamId, teamName: entry?.name || teamId });
    });
    return map;
}, [groupsConfig?.teamCatalog]);
```

**Step 3: Build createStoriesEpics memo**

Near the other alert memos (line ~8290):

```js
const createStoriesEpics = React.useMemo(() => {
    const sprintLabel = selectedSprintInfo?.name;
    if (!sprintLabel || teamEpicLabelMap.size === 0) return [];

    const results = [];
    const allEpics = Object.values(epicDetails || {});
    // Also check epicsInScope from empty epic alert flow
    const epicPool = [...allEpics, ...(epicsInScope || [])];
    const seen = new Set();

    epicPool.forEach(epic => {
        if (!epic?.key || seen.has(epic.key)) return;
        seen.add(epic.key);

        const status = normalizeStatus(epic.status || epic.fields?.status?.name);
        if (status === 'done' || status === 'killed') return;
        if (dismissedAlertSet.has(epic.key)) return;

        const labels = epic.labels || epic.fields?.labels || [];
        if (!labels.includes(sprintLabel)) return;

        // Find which teams this epic matches
        const matchedTeams = [];
        labels.forEach(label => {
            const teamInfo = teamEpicLabelMap.get(label);
            if (teamInfo) {
                // Check team is in selected group
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

    return results;
}, [
    selectedSprintInfo?.name, teamEpicLabelMap, epicDetails, epicsInScope,
    dismissedAlertSet, isAllTeamsSelected, selectedTeamSet,
    epicsWithActionableStoriesInSelectedSprint
]);
```

**Step 4: Group by team**

```js
const createStoriesTeams = groupAlertsByTeam(
    createStoriesEpics,
    (item) => ({ id: item.teamId, name: item.teamName }),
    (a, b) => (a.epic.key || '').localeCompare(b.epic.key || '')
);
```

**Step 5: Build + verify**

Run: `npm run build`

**Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat: add createStoriesEpics memo with sprint+team label matching"
```

---

## Task 6: Frontend — "Create Stories" alert rendering

**Files:**
- Modify: `frontend/src/dashboard.jsx`

**Step 1: Add alert card JSX**

After the existing alert cards (near line ~11550), add following the same pattern as Missing Info / Empty Epic:

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

## Task 7: CSS + final polish

**Files:**
- Modify: `frontend/dist/dashboard.css` (team label picker styles)

**Step 1: Add team label picker CSS**

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

Add a new section for "Create Stories":

```markdown
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
git commit -m "feat: add CSS for label picker and document Create Stories alert rules"
```

---

## Task 8: Push branch

```bash
git push -u origin feat/create-stories-alert
```

---

## Execution Summary

| Task | What | Files | ~Lines |
|------|------|-------|--------|
| 1 | Add `labels` to epic fetch | `jira_server.py` | ~15 |
| 2 | `/api/jira/labels` endpoint + tests | `jira_server.py`, `test_create_stories_alert.py` | ~60 |
| 3 | `epicLabel` in team catalog + tests | `jira_server.py`, `test_create_stories_alert.py` | ~20 |
| 4 | Label picker in settings UI | `dashboard.jsx` | ~50 |
| 5 | Alert data collection memo | `dashboard.jsx` | ~80 |
| 6 | Alert rendering JSX | `dashboard.jsx` | ~70 |
| 7 | CSS + ALERT_RULES.md | `dashboard.css`, `ALERT_RULES.md` | ~25 |
| 8 | Push | — | — |
| **Total** | | **5 files** | **~320 lines** |

## Configuration Flow

1. User opens **Dashboard Settings → Team Groups**
2. Selects a group, sees team chips
3. Each team chip now has an **"Epic label"** input with Jira label autocomplete
4. User types `rnd_bsw_perimeter` (autocompleted from Jira) for team "R&D Perimeter"
5. Saves config → `teamCatalog[teamId].epicLabel = "rnd_bsw_perimeter"` persisted

## Alert Flow

1. Sprint "2026Q1" selected
2. Epics loaded with `labels[]` field
3. For each epic with `"2026Q1"` in labels:
   - Check if any label matches a team's `epicLabel`
   - Check if epic has zero stories in the sprint
   - If both → add to "Create Stories" alert for that team
4. Alert renders per-team, same style as Missing Info
