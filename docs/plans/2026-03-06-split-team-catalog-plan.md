# Split teamCatalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate the teamCatalog cache from the groups configuration into its own file and API endpoints.

**Architecture:** New `team-catalog.json` file with `GET/POST /api/team-catalog` endpoints. Backend strips catalog from groups config validation/storage. Frontend uses separate state + fetch for the catalog. One-time migration extracts existing catalog data from `dashboard-config.json`.

**Tech Stack:** Python/Flask backend (`jira_server.py`), React frontend (`frontend/src/dashboard.jsx`), unittest tests.

**Design doc:** `docs/plans/2026-03-06-split-team-catalog-design.md`

---

### Task 1: Backend — Add team catalog file functions

**Files:**
- Modify: `jira_server.py:65` (add env var)
- Modify: `jira_server.py:1157-1191` (add new functions after `resolve_dashboard_config_path` block)

**Step 1: Add the env var**

At `jira_server.py:65`, after `DASHBOARD_CONFIG_PATH`, add:

```python
TEAM_CATALOG_PATH = os.getenv('TEAM_CATALOG_PATH', '').strip()
```

**Step 2: Add resolve/load/save functions**

Insert after `save_dashboard_config()` (after line 1191):

```python
def resolve_team_catalog_path():
    return TEAM_CATALOG_PATH or './team-catalog.json'


def load_team_catalog():
    path = resolve_team_catalog_path()
    if not os.path.exists(path):
        return {'catalog': {}, 'meta': {}}
    try:
        with open(path, 'r') as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return {'catalog': {}, 'meta': {}}
        return {
            'catalog': normalize_team_catalog(data.get('catalog') or {}),
            'meta': normalize_team_catalog_meta(data.get('meta') or {})
        }
    except Exception as e:
        log_warning(f'Failed to read team catalog: {e}')
        return {'catalog': {}, 'meta': {}}


def save_team_catalog_file(catalog_data):
    path = resolve_team_catalog_path()
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    normalized = {
        'catalog': normalize_team_catalog(catalog_data.get('catalog') or {}),
        'meta': normalize_team_catalog_meta(catalog_data.get('meta') or {})
    }
    with open(path, 'w') as handle:
        json.dump(normalized, handle, indent=2)
    return normalized


def migrate_team_catalog_from_config():
    """One-time migration: extract teamCatalog from dashboard-config.json into team-catalog.json."""
    catalog_path = resolve_team_catalog_path()
    if os.path.exists(catalog_path):
        return  # Already migrated or manually created
    dashboard_config = load_dashboard_config()
    if not dashboard_config:
        return
    team_groups = dashboard_config.get('teamGroups')
    if not isinstance(team_groups, dict):
        return
    raw_catalog = team_groups.get('teamCatalog') or {}
    raw_meta = team_groups.get('teamCatalogMeta') or {}
    catalog = normalize_team_catalog(raw_catalog)
    if not catalog:
        return  # Nothing to migrate
    save_team_catalog_file({'catalog': catalog, 'meta': raw_meta})
    # Clean up: remove from dashboard config
    team_groups.pop('teamCatalog', None)
    team_groups.pop('teamCatalogMeta', None)
    save_dashboard_config(dashboard_config)
    log_info('Migrated teamCatalog from dashboard-config.json to team-catalog.json')
```

**Step 3: Commit**

```bash
git add jira_server.py
git commit -m "feat: add team catalog file load/save/migrate functions"
```

---

### Task 2: Backend — Add team catalog API endpoints

**Files:**
- Modify: `jira_server.py` (add endpoints near the existing groups-config endpoints, around line 5320)

**Step 1: Write the failing test**

Create `tests/test_team_catalog_api.py`:

```python
import json
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    jira_server = None
    _IMPORT_ERROR = exc


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestTeamCatalogAPI(unittest.TestCase):
    def setUp(self):
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        self._tmpdir = tempfile.mkdtemp()
        self._catalog_path = os.path.join(self._tmpdir, 'team-catalog.json')
        self._patcher = patch.object(jira_server, 'resolve_team_catalog_path', return_value=self._catalog_path)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        if os.path.exists(self._catalog_path):
            os.unlink(self._catalog_path)
        os.rmdir(self._tmpdir)

    def test_get_empty_catalog(self):
        resp = self.client.get('/api/team-catalog')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['catalog'], {})
        self.assertEqual(data['meta'], {})

    def test_post_and_get_catalog(self):
        payload = {
            'catalog': {'t1': {'id': 't1', 'name': 'Team One'}},
            'meta': {'updatedAt': '2026-03-06T00:00:00Z', 'source': 'sprint'}
        }
        resp = self.client.post('/api/team-catalog',
                                data=json.dumps(payload),
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['catalog']['t1']['name'], 'Team One')
        self.assertEqual(data['meta']['source'], 'sprint')

        # Verify persisted
        resp2 = self.client.get('/api/team-catalog')
        data2 = resp2.get_json()
        self.assertEqual(data2['catalog']['t1']['name'], 'Team One')

    def test_post_normalizes_catalog(self):
        payload = {
            'catalog': [{'id': ' T2 ', 'name': ' Alpha '}],
            'meta': {'updatedAt': '2026-03-06', 'bogusField': 'ignored'}
        }
        resp = self.client.post('/api/team-catalog',
                                data=json.dumps(payload),
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data['catalog']['T2']['id'], 'T2')
        self.assertEqual(data['catalog']['T2']['name'], 'Alpha')
        self.assertNotIn('bogusField', data['meta'])

    def test_post_merges_with_existing(self):
        # Seed initial data
        initial = {'catalog': {'t1': {'id': 't1', 'name': 'Old'}}, 'meta': {}}
        with open(self._catalog_path, 'w') as f:
            json.dump(initial, f)

        payload = {
            'catalog': {'t2': {'id': 't2', 'name': 'New'}},
            'meta': {'updatedAt': '2026-03-06'},
            'merge': True
        }
        resp = self.client.post('/api/team-catalog',
                                data=json.dumps(payload),
                                content_type='application/json')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn('t1', data['catalog'])
        self.assertIn('t2', data['catalog'])


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestTeamCatalogMigration(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._catalog_path = os.path.join(self._tmpdir, 'team-catalog.json')
        self._dashboard_path = os.path.join(self._tmpdir, 'dashboard-config.json')
        self._cat_patcher = patch.object(jira_server, 'resolve_team_catalog_path', return_value=self._catalog_path)
        self._dash_patcher = patch.object(jira_server, 'resolve_dashboard_config_path', return_value=self._dashboard_path)
        self._cat_patcher.start()
        self._dash_patcher.start()

    def tearDown(self):
        self._cat_patcher.stop()
        self._dash_patcher.stop()
        for f in [self._catalog_path, self._dashboard_path]:
            if os.path.exists(f):
                os.unlink(f)
        os.rmdir(self._tmpdir)

    def test_migration_extracts_catalog(self):
        dashboard = {
            'version': 1,
            'projects': {'selected': []},
            'teamGroups': {
                'version': 1,
                'groups': [{'id': 'g1', 'name': 'G1', 'teamIds': ['t1']}],
                'defaultGroupId': 'g1',
                'teamCatalog': {'t1': {'id': 't1', 'name': 'Team One'}},
                'teamCatalogMeta': {'updatedAt': '2026-03-06'}
            }
        }
        with open(self._dashboard_path, 'w') as f:
            json.dump(dashboard, f)

        jira_server.migrate_team_catalog_from_config()

        # Catalog file created
        self.assertTrue(os.path.exists(self._catalog_path))
        with open(self._catalog_path) as f:
            catalog = json.load(f)
        self.assertEqual(catalog['catalog']['t1']['name'], 'Team One')

        # Dashboard config cleaned up
        with open(self._dashboard_path) as f:
            config = json.load(f)
        self.assertNotIn('teamCatalog', config['teamGroups'])
        self.assertNotIn('teamCatalogMeta', config['teamGroups'])

    def test_migration_skips_if_catalog_exists(self):
        with open(self._catalog_path, 'w') as f:
            json.dump({'catalog': {}, 'meta': {}}, f)
        dashboard = {
            'version': 1,
            'teamGroups': {
                'teamCatalog': {'t1': {'id': 't1', 'name': 'Should Not Overwrite'}}
            }
        }
        with open(self._dashboard_path, 'w') as f:
            json.dump(dashboard, f)

        jira_server.migrate_team_catalog_from_config()

        with open(self._catalog_path) as f:
            catalog = json.load(f)
        self.assertEqual(catalog['catalog'], {})

    def test_migration_skips_empty_catalog(self):
        dashboard = {
            'version': 1,
            'teamGroups': {
                'teamCatalog': {},
                'teamCatalogMeta': {}
            }
        }
        with open(self._dashboard_path, 'w') as f:
            json.dump(dashboard, f)

        jira_server.migrate_team_catalog_from_config()
        self.assertFalse(os.path.exists(self._catalog_path))
```

**Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_team_catalog_api.py -v`
Expected: FAIL — endpoints don't exist yet

**Step 3: Add the API endpoints**

In `jira_server.py`, after the `save_groups_config` endpoint (around line 5340), add:

```python
@app.route('/api/team-catalog', methods=['GET'])
def get_team_catalog():
    """Return the team name catalog."""
    migrate_team_catalog_from_config()
    data = load_team_catalog()
    return jsonify(data)


@app.route('/api/team-catalog', methods=['POST'])
def post_team_catalog():
    """Save the team name catalog."""
    payload = request.get_json(silent=True) or {}
    merge = payload.get('merge', False)
    incoming = {
        'catalog': normalize_team_catalog(payload.get('catalog') or {}),
        'meta': normalize_team_catalog_meta(payload.get('meta') or {})
    }
    if merge:
        existing = load_team_catalog()
        merged_catalog = {**existing['catalog'], **incoming['catalog']}
        incoming['catalog'] = merged_catalog
    saved = save_team_catalog_file(incoming)
    return jsonify(saved)
```

**Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_team_catalog_api.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add jira_server.py tests/test_team_catalog_api.py
git commit -m "feat: add GET/POST /api/team-catalog endpoints with migration"
```

---

### Task 3: Backend — Strip teamCatalog from groups config

**Files:**
- Modify: `jira_server.py:1659-1665` (validate_groups_config normalized output)
- Modify: `jira_server.py:1678-1690` (build_default_groups_config)
- Test: `tests/test_group_excluded_capacity_epics_api.py` (existing test, may need update)

**Step 1: Write the failing test**

Add to `tests/test_team_catalog_api.py`:

```python
@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestGroupsConfigNoCatalog(unittest.TestCase):
    def test_validate_groups_config_excludes_catalog(self):
        payload = {
            'version': 1,
            'groups': [{'id': 'g1', 'name': 'G1', 'teamIds': ['t1']}],
            'defaultGroupId': 'g1',
            'teamCatalog': {'t1': {'id': 't1', 'name': 'Team'}},
            'teamCatalogMeta': {'updatedAt': '2026-03-06'}
        }
        normalized, errors, _warnings = jira_server.validate_groups_config(payload, allow_empty=False)
        self.assertEqual(errors, [])
        self.assertNotIn('teamCatalog', normalized)
        self.assertNotIn('teamCatalogMeta', normalized)

    def test_build_default_groups_config_excludes_catalog(self):
        with patch.object(jira_server, 'build_base_jql', return_value=''):
            config, _warnings = jira_server.build_default_groups_config()
        self.assertNotIn('teamCatalog', config)
        self.assertNotIn('teamCatalogMeta', config)
```

**Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_team_catalog_api.py::TestGroupsConfigNoCatalog -v`
Expected: FAIL — `teamCatalog` still present

**Step 3: Remove catalog from validate_groups_config and build_default_groups_config**

In `validate_groups_config()` (line 1659-1665), change the normalized dict to:

```python
    normalized = {
        'version': payload.get('version') or GROUPS_CONFIG_VERSION,
        'groups': normalized_groups,
        'defaultGroupId': default_group_id,
    }
```

In `build_default_groups_config()` (line 1678-1690), change the config dict to:

```python
    config = {
        'version': GROUPS_CONFIG_VERSION,
        'groups': [{
            'id': 'default',
            'name': 'Default',
            'teamIds': team_ids,
            'missingInfoComponents': [MISSING_INFO_COMPONENT] if MISSING_INFO_COMPONENT else [],
            'excludedCapacityEpics': []
        }],
        'defaultGroupId': 'default',
    }
```

**Step 4: Run all tests to verify nothing breaks**

Run: `python -m pytest tests/ -v`
Expected: ALL PASS (check existing test `test_group_excluded_capacity_epics_api.py` still passes — it doesn't assert on teamCatalog)

**Step 5: Commit**

```bash
git add jira_server.py tests/test_team_catalog_api.py
git commit -m "refactor: remove teamCatalog from groups config validation and defaults"
```

---

### Task 4: Frontend — Add separate team catalog state and fetch

**Files:**
- Modify: `frontend/src/dashboard.jsx:152-158` (state init)
- Modify: `frontend/src/dashboard.jsx` (add loadTeamCatalog, saveTeamCatalog functions)

**Step 1: Add new state, remove catalog from groupsConfig init**

At line 152-158, change initial state:

```jsx
const [groupsConfig, setGroupsConfig] = useState({
    version: 1,
    groups: [],
    defaultGroupId: '',
});
```

Add new state right after (after line 158):

```jsx
const [teamCatalogState, setTeamCatalogState] = useState({ catalog: {}, meta: {} });
```

**Step 2: Add loadTeamCatalog and saveTeamCatalog functions**

Near the existing `loadGroupsConfig` function (find it by searching for `loadGroupsConfig`), add:

```jsx
const loadTeamCatalog = async () => {
    try {
        const response = await fetch(`${BACKEND_URL}/api/team-catalog?t=${Date.now()}`);
        if (!response.ok) return;
        const data = await response.json();
        setTeamCatalogState({
            catalog: data.catalog || {},
            meta: data.meta || {}
        });
        const catalogTeams = buildTeamCatalogList(data.catalog || {});
        if (catalogTeams.length) {
            setAvailableTeams(catalogTeams);
        }
    } catch (err) {
        console.warn('Failed to load team catalog:', err);
    }
};

const saveTeamCatalog = async (catalog, meta, merge = false) => {
    try {
        const response = await fetch(`${BACKEND_URL}/api/team-catalog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalog, meta, merge })
        });
        if (!response.ok) return;
        const data = await response.json();
        setTeamCatalogState({
            catalog: data.catalog || {},
            meta: data.meta || {}
        });
        return data;
    } catch (err) {
        console.warn('Failed to save team catalog:', err);
    }
};
```

**Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat(frontend): add separate teamCatalog state and fetch/save functions"
```

---

### Task 5: Frontend — Wire up loadTeamCatalog on mount and group manage open

**Files:**
- Modify: `frontend/src/dashboard.jsx` (loadGroupsConfig success handler, showGroupManage effect)

**Step 1: Add loadTeamCatalog call to loadGroupsConfig success path**

Find the `loadGroupsConfig` function. In its success handler, where it currently reads `normalized.teamCatalog` (around line 577), replace:

```jsx
// OLD (remove these lines):
const catalogTeams = buildTeamCatalogList(normalized.teamCatalog);
if (catalogTeams.length) {
    setAvailableTeams(catalogTeams);
} else {
    setAvailableTeams(loadTeamsFromCurrentView());
}
setLoadingTeams(false);
const missingIds = new Set();
(normalized.groups || []).forEach(group => {
    (group.teamIds || []).forEach(teamId => {
        if (!normalized.teamCatalog?.[teamId]) {
            missingIds.add(teamId);
        }
    });
});
if (missingIds.size) {
    resolveMissingTeamNames(Array.from(missingIds));
}
```

With:

```jsx
// NEW:
setAvailableTeams(loadTeamsFromCurrentView());
setLoadingTeams(false);
loadTeamCatalog();
```

Note: `loadTeamCatalog` already populates `availableTeams` from the catalog if entries exist. Missing team name resolution will be handled by the `showGroupManage` effect (see below).

**Step 2: Update the showGroupManage effect**

In the `useEffect` that fires when `showGroupManage` opens (around line 541-594), update:

Remove lines 549-550 from the baseline signature:
```jsx
// OLD baseline:
groupDraftBaselineRef.current = JSON.stringify({
    version: normalized.version || 1,
    groups: normalized.groups || [],
    defaultGroupId: normalized.defaultGroupId || '',
    teamCatalog: normalized.teamCatalog || {},
    teamCatalogMeta: normalized.teamCatalogMeta || {}
});

// NEW baseline:
groupDraftBaselineRef.current = JSON.stringify({
    version: normalized.version || 1,
    groups: normalized.groups || [],
    defaultGroupId: normalized.defaultGroupId || '',
});
```

Replace lines 577-594 (catalog init in the effect):
```jsx
// OLD:
const catalogTeams = buildTeamCatalogList(normalized.teamCatalog);
if (catalogTeams.length) {
    setAvailableTeams(catalogTeams);
} else {
    setAvailableTeams(loadTeamsFromCurrentView());
}
setLoadingTeams(false);
const missingIds = new Set();
(normalized.groups || []).forEach(group => {
    (group.teamIds || []).forEach(teamId => {
        if (!normalized.teamCatalog?.[teamId]) {
            missingIds.add(teamId);
        }
    });
});
if (missingIds.size) {
    resolveMissingTeamNames(Array.from(missingIds));
}

// NEW:
const catalogTeams = buildTeamCatalogList(teamCatalogState.catalog);
if (catalogTeams.length) {
    setAvailableTeams(catalogTeams);
} else {
    setAvailableTeams(loadTeamsFromCurrentView());
}
setLoadingTeams(false);
const missingIds = new Set();
(normalized.groups || []).forEach(group => {
    (group.teamIds || []).forEach(teamId => {
        if (!teamCatalogState.catalog?.[teamId]) {
            missingIds.add(teamId);
        }
    });
});
if (missingIds.size) {
    resolveMissingTeamNames(Array.from(missingIds));
}
```

**Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat(frontend): wire loadTeamCatalog on mount and group manage open"
```

---

### Task 6: Frontend — Update fetchTeamsFromJira and resolveMissingTeamNames

**Files:**
- Modify: `frontend/src/dashboard.jsx:915-924` (fetchTeamsFromJira catalog update)
- Modify: `frontend/src/dashboard.jsx:951-958` (resolveMissingTeamNames catalog update)

**Step 1: Update fetchTeamsFromJira**

Replace lines 915-924:

```jsx
// OLD:
handleGroupDraftChange(prev => ({
    ...prev,
    teamCatalog: mergeTeamCatalog(prev.teamCatalog, fetchedTeams),
    teamCatalogMeta: {
        updatedAt: new Date().toISOString(),
        sprintId: String(selectedSprint || ''),
        sprintName: selectedSprintInfo?.name ? String(selectedSprintInfo.name) : '',
        source: 'sprint'
    }
}));

// NEW:
const mergedCatalog = mergeTeamCatalog(teamCatalogState.catalog, fetchedTeams);
saveTeamCatalog(mergedCatalog, {
    updatedAt: new Date().toISOString(),
    sprintId: String(selectedSprint || ''),
    sprintName: selectedSprintInfo?.name ? String(selectedSprintInfo.name) : '',
    source: 'sprint'
});
```

**Step 2: Update resolveMissingTeamNames**

Replace lines 951-958:

```jsx
// OLD:
handleGroupDraftChange(prev => ({
    ...prev,
    teamCatalog: mergeTeamCatalog(prev.teamCatalog, resolvedTeams),
    teamCatalogMeta: {
        ...(prev.teamCatalogMeta || {}),
        resolvedAt: new Date().toISOString()
    }
}));

// NEW:
const mergedCatalog = mergeTeamCatalog(teamCatalogState.catalog, resolvedTeams);
saveTeamCatalog(mergedCatalog, {
    ...teamCatalogState.meta,
    resolvedAt: new Date().toISOString()
}, false);
```

**Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "feat(frontend): save team catalog separately on fetch/resolve"
```

---

### Task 7: Frontend — Update dirty detection and save payload

**Files:**
- Modify: `frontend/src/dashboard.jsx:997-1005` (groupDraftSignature)
- Modify: `frontend/src/dashboard.jsx:1529-1538` (save payload)

**Step 1: Remove catalog from groupDraftSignature**

At line 997-1005, change to:

```jsx
const groupDraftSignature = React.useMemo(() => {
    if (!groupDraft) return '';
    return JSON.stringify({
        version: groupDraft.version || 1,
        groups: groupDraft.groups || [],
        defaultGroupId: groupDraft.defaultGroupId || '',
    });
}, [groupDraft]);
```

**Step 2: Remove catalog from save payload**

At line 1529-1538, change the body to:

```jsx
body: JSON.stringify({
    version: groupDraft.version || 1,
    groups: groupDraft.groups || [],
    defaultGroupId: groupDraft.defaultGroupId || '',
})
```

**Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "refactor(frontend): exclude teamCatalog from dirty detection and save payload"
```

---

### Task 8: Frontend — Update normalizeGroupsConfig and remaining reads

**Files:**
- Modify: `frontend/src/dashboard.jsx:741-783` (normalizeGroupsConfig)
- Modify: `frontend/src/dashboard.jsx:2505-2513` (exportGroupsConfig)
- Modify: `frontend/src/dashboard.jsx:2531-2545` (importGroupsConfig)
- Modify: `frontend/src/dashboard.jsx:2548-2562` (teamNameLookup)
- Modify: `frontend/src/dashboard.jsx:2587-2588` (teamCacheMeta)

**Step 1: Strip catalog parsing from normalizeGroupsConfig**

In `normalizeGroupsConfig` (lines 741-783), remove the entire teamCatalog parsing block (lines 741-783 end). The function should return:

```jsx
return {
    version: Number(config?.version) || 1,
    groups,
    defaultGroupId: String(config?.defaultGroupId || '').trim(),
};
```

Remove the lines that build `teamCatalog`, `teamCatalogMeta` from the raw config (lines 741-783). Keep the `groups` parsing (lines 720-740).

**Step 2: Update exportGroupsConfig**

At line 2505-2513, remove catalog from export payload:

```jsx
const exportGroupsConfig = async () => {
    const source = groupDraft || groupsConfig;
    const payload = {
        version: source.version || 1,
        groups: source.groups || [],
        defaultGroupId: source.defaultGroupId || '',
    };
    const json = JSON.stringify(payload, null, 2);
    // ... rest unchanged
```

**Step 3: Update importGroupsConfig**

At line 2531-2545, after normalizing the imported config, extract and save any embedded catalog:

```jsx
const importGroupsConfig = () => {
    if (!groupImportText.trim()) return;
    try {
        const parsed = JSON.parse(groupImportText);
        const normalized = normalizeGroupsConfig(parsed);
        if (!normalized.groups.length) {
            throw new Error('Imported config has no groups.');
        }
        // If imported JSON contains a teamCatalog, save it separately
        const rawCatalog = parsed?.teamCatalog;
        if (rawCatalog && typeof rawCatalog === 'object' && Object.keys(rawCatalog).length) {
            const catalogEntries = {};
            Object.entries(rawCatalog).forEach(([key, value]) => {
                if (value && typeof value === 'object' && value.id && value.name) {
                    catalogEntries[String(value.id)] = { id: String(value.id), name: String(value.name) };
                }
            });
            if (Object.keys(catalogEntries).length) {
                saveTeamCatalog(catalogEntries, parsed?.teamCatalogMeta || {}, false);
            }
        }
        setGroupDraft(normalized);
        setGroupDraftError('');
        setGroupImportText('');
        setShowGroupImport(false);
    } catch (err) {
        setGroupDraftError(err.message || 'Invalid JSON.');
    }
};
```

**Step 4: Update teamNameLookup**

At line 2548-2562, change catalog source:

```jsx
const teamNameLookup = React.useMemo(() => {
    const map = {};
    (availableTeams || []).forEach(team => {
        if (team?.id) {
            map[team.id] = team.name || team.id;
        }
    });
    const catalog = teamCatalogState?.catalog || {};
    Object.entries(catalog).forEach(([teamId, entry]) => {
        if (!map[teamId] && entry?.name) {
            map[teamId] = entry.name;
        }
    });
    return map;
}, [availableTeams, teamCatalogState]);
```

Note: This also fixes an existing bug where `catalog[teamId]` returned an `{id, name}` object instead of a name string.

**Step 5: Update teamCacheMeta**

At line 2587-2588, change:

```jsx
const teamCacheMeta = React.useMemo(() => {
    return teamCatalogState?.meta || {};
}, [teamCatalogState]);
```

**Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "refactor(frontend): remove teamCatalog from normalizeGroupsConfig and update all reads"
```

---

### Task 9: Frontend — Clean up remaining groupDraft catalog references

**Files:**
- Modify: `frontend/src/dashboard.jsx:1442-1449` (deleteGroupDraft — remove defaultGroupId cleanup that references catalog)
- Modify: `frontend/src/dashboard.jsx:9051` (group option star indicator)

**Step 1: Audit for remaining references**

Search for any remaining `teamCatalog` or `teamCatalogMeta` in `dashboard.jsx`. After Tasks 4-8, there should be none left except possibly in the `groupDraft` object itself (which no longer carries catalog data). Verify with a search.

If any references remain, update them to use `teamCatalogState.catalog` / `teamCatalogState.meta`.

**Step 2: Build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx frontend/dist/
git commit -m "chore: clean up remaining teamCatalog references and rebuild"
```

---

### Task 10: End-to-end verification

**Step 1: Run all backend tests**

Run: `python -m pytest tests/ -v`
Expected: ALL PASS

**Step 2: Manual smoke test**

1. Delete any existing `team-catalog.json`
2. Start the server
3. Open dashboard → Settings → Groups
4. Verify team names display (loaded from catalog or resolved)
5. Click "Fetch Teams" → verify teams load and catalog saves to `team-catalog.json`
6. Reload page → verify team names persist
7. Check `dashboard-config.json` — verify no `teamCatalog` / `teamCatalogMeta` in `teamGroups`
8. Export config → verify no catalog in exported JSON
9. Import config that has `teamCatalog` → verify it gets saved separately

**Step 3: Final commit**

```bash
git commit --allow-empty -m "verify: end-to-end smoke test passed for team catalog split"
```
