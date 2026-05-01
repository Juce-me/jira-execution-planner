# Initiative-Level Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Jira Initiatives as a subtle grouping layer above epics in the Catch Up task list, with a toggle to switch between grouped and flat views.

**Architecture:** Backend adds `parent` to the existing epic-details bulk fetch (zero new API calls), extracting initiative key+summary when the parent is an Initiative type. Frontend adds a `groupEpicsByInitiative()` function that clusters epic groups by initiative key, rendered with a subtle top-banner + left-accent visual. A toggle button in the existing filter bar controls the grouping.

**Tech Stack:** Python (Flask backend), React (JSX frontend), CSS

---

### Task 1: Backend — Add initiative data to epic details response

**Files:**
- Modify: `jira_server.py:1930-1968` (`fetch_epic_details_bulk` function)

- [ ] **Step 1: Write the failing test**

Create `tests/test_initiative_extraction.py`:

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
class TestInitiativeExtraction(unittest.TestCase):

    @patch('jira_server.jira_search_request')
    def test_epic_with_initiative_parent(self, mock_search):
        """Epic whose parent is an Initiative should include initiative in details."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-100',
                'fields': {
                    'summary': 'Payment Gateway v2',
                    'reporter': {'displayName': 'Alice'},
                    'assignee': {'displayName': 'Bob'},
                    'customfield_10011': None,
                    'parent': {
                        'key': 'INIT-42',
                        'fields': {
                            'summary': 'Payments Initiative',
                            'issuetype': {
                                'name': 'Initiative',
                                'hierarchyLevel': 0
                            }
                        }
                    }
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-100'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('PROD-100', result)
        epic = result['PROD-100']
        self.assertIn('initiative', epic)
        self.assertEqual(epic['initiative']['key'], 'INIT-42')
        self.assertEqual(epic['initiative']['summary'], 'Payments Initiative')

    @patch('jira_server.jira_search_request')
    def test_epic_without_initiative_parent(self, mock_search):
        """Epic with no parent should not have initiative field."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-200',
                'fields': {
                    'summary': 'Standalone Epic',
                    'reporter': {'displayName': 'Carol'},
                    'assignee': None,
                    'customfield_10011': None
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-200'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('PROD-200', result)
        self.assertNotIn('initiative', result['PROD-200'])

    @patch('jira_server.jira_search_request')
    def test_epic_with_non_initiative_parent(self, mock_search):
        """Epic whose parent is NOT an Initiative (e.g. another Epic) should not include initiative."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-300',
                'fields': {
                    'summary': 'Sub-epic',
                    'reporter': {'displayName': 'Dave'},
                    'assignee': None,
                    'customfield_10011': None,
                    'parent': {
                        'key': 'PROD-50',
                        'fields': {
                            'summary': 'Parent Epic',
                            'issuetype': {
                                'name': 'Epic',
                                'hierarchyLevel': 1
                            }
                        }
                    }
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-300'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('PROD-300', result)
        self.assertNotIn('initiative', result['PROD-300'])

    @patch('jira_server.jira_search_request')
    def test_initiative_detected_by_hierarchy_level_zero(self, mock_search):
        """Parent with hierarchyLevel 0 but non-'Initiative' name should still be detected."""
        mock_search.return_value = DummyResponse({
            'issues': [{
                'key': 'PROD-400',
                'fields': {
                    'summary': 'Some Epic',
                    'reporter': None,
                    'assignee': None,
                    'customfield_10011': None,
                    'parent': {
                        'key': 'BIZ-10',
                        'fields': {
                            'summary': 'Business Goal',
                            'issuetype': {
                                'name': 'Feature',
                                'hierarchyLevel': 0
                            }
                        }
                    }
                }
            }]
        })

        result = jira_server.fetch_epic_details_bulk(
            ['PROD-400'], {'Authorization': 'Bearer test'}, 'customfield_10011'
        )

        self.assertIn('initiative', result['PROD-400'])
        self.assertEqual(result['PROD-400']['initiative']['key'], 'BIZ-10')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_initiative_extraction.py -v`
Expected: FAIL — `initiative` key not present in result dicts.

- [ ] **Step 3: Implement — add `parent` to fields and extract initiative**

In `jira_server.py`, modify the `fetch_epic_details_bulk` function (starts at line 1930).

Change the `fields` list in the payload (line 1946) to include `'parent'`:

```python
            'fields': ['summary', 'reporter', 'assignee', 'parent', epic_field]
```

Then after building the `epic_details[key]` dict (line 1959-1964), add initiative extraction before the dict is finalized:

```python
                epic_details[key] = {
                    'key': key,
                    'summary': fields.get('summary'),
                    'reporter': (fields.get('reporter') or {}).get('displayName'),
                    'assignee': {'displayName': (fields.get('assignee') or {}).get('displayName')} if fields.get('assignee') else None,
                }
                # Extract initiative from parent if present
                parent = fields.get('parent')
                if parent and parent.get('key'):
                    parent_fields = parent.get('fields') or {}
                    parent_type = parent_fields.get('issuetype') or {}
                    type_name = (parent_type.get('name') or '').lower()
                    hierarchy_level = parent_type.get('hierarchyLevel')
                    if type_name == 'initiative' or hierarchy_level == 0:
                        epic_details[key]['initiative'] = {
                            'key': parent['key'],
                            'summary': parent_fields.get('summary'),
                        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_initiative_extraction.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add jira_server.py tests/test_initiative_extraction.py
git commit -m "Extract initiative parent from epic details bulk fetch"
```

---

### Task 2: Frontend — Add `groupByInitiative` state and grouping function

**Files:**
- Modify: `frontend/src/dashboard.jsx:335` (state declarations area)
- Modify: `frontend/src/dashboard.jsx:7756-7759` (epicGroups memo area)

- [ ] **Step 1: Write the source guard test**

Create `tests/test_initiative_grouping_source_guards.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'dashboard.jsx'),
    'utf8'
);

test('dashboard declares groupByInitiative state', () => {
    assert.ok(
        source.includes('groupByInitiative'),
        'Expected groupByInitiative state variable in dashboard.jsx'
    );
});

test('dashboard defines groupEpicsByInitiative function', () => {
    assert.ok(
        source.includes('groupEpicsByInitiative'),
        'Expected groupEpicsByInitiative function in dashboard.jsx'
    );
});

test('dashboard renders initiative-toggle button', () => {
    assert.ok(
        source.includes('initiative-toggle'),
        'Expected initiative-toggle class in dashboard.jsx'
    );
});

test('dashboard renders initiative-group wrapper', () => {
    assert.ok(
        source.includes('initiative-group'),
        'Expected initiative-group class in dashboard.jsx'
    );
});

test('dashboard renders initiative-label element', () => {
    assert.ok(
        source.includes('initiative-label'),
        'Expected initiative-label class in dashboard.jsx'
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test_initiative_grouping_source_guards.js`
Expected: FAIL — none of these strings exist yet.

- [ ] **Step 3: Add `groupByInitiative` state variable**

Near line 335 in `dashboard.jsx`, where other state variables are declared (near `epicDetails`), add:

```javascript
            const [groupByInitiative, setGroupByInitiative] = useState(false);
```

- [ ] **Step 4: Add `groupEpicsByInitiative` function**

Place this right after the `groupTasksByEpic` function (after line 7754), before the `epicGroups` memo:

```javascript
            const groupEpicsByInitiative = (epicGroupsArray) => {
                const initiativeMap = {};
                const noInitiative = [];

                epicGroupsArray.forEach(eg => {
                    const initiative = epicDetails[eg.key]?.initiative;
                    if (initiative && initiative.key) {
                        if (!initiativeMap[initiative.key]) {
                            initiativeMap[initiative.key] = {
                                initiative,
                                epicGroups: [],
                            };
                        }
                        initiativeMap[initiative.key].epicGroups.push(eg);
                    } else {
                        noInitiative.push(eg);
                    }
                });

                const result = Object.values(initiativeMap);
                if (noInitiative.length > 0) {
                    result.push({ initiative: null, epicGroups: noInitiative });
                }
                return result;
            };
```

- [ ] **Step 5: Add `hasInitiativeData` memo and auto-default logic**

Right after the `epicGroups` memo (after line 7759), add:

```javascript
            const hasInitiativeData = React.useMemo(() => {
                return epicGroups.some(eg => epicDetails[eg.key]?.initiative);
            }, [epicGroups, epicDetails]);

            useEffect(() => {
                if (hasInitiativeData) {
                    setGroupByInitiative(true);
                }
            }, [hasInitiativeData]);

            const initiativeGroups = React.useMemo(() => {
                if (!groupByInitiative) return null;
                return groupEpicsByInitiative(epicGroups);
            }, [groupByInitiative, epicGroups, epicDetails]);
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/dashboard.jsx tests/test_initiative_grouping_source_guards.js
git commit -m "Add groupByInitiative state and initiative grouping logic"
```

---

### Task 3: Frontend — Add Initiative toggle button to filter bar

**Files:**
- Modify: `frontend/src/dashboard.jsx:13239` (after the `.toggle-container` closing div)

- [ ] **Step 1: Add the toggle button markup**

After the closing `</div>` of `.toggle-container` (line 13239) and before the closing `</div>` of `.filters-group` (line 13240), insert the initiative toggle:

```jsx
                                        {hasInitiativeData && (
                                            <>
                                                <span className="initiative-toggle-separator" />
                                                <button
                                                    className={`toggle initiative-toggle ${groupByInitiative ? 'active' : ''}`}
                                                    onClick={() => setGroupByInitiative(prev => !prev)}
                                                    title={groupByInitiative ? 'Switch to flat epic view' : 'Group epics by initiative'}
                                                    type="button"
                                                >
                                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{flexShrink: 0, marginRight: '4px'}}>
                                                        <rect x="1" y="1" width="14" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                                                        <rect x="3" y="7" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.6"/>
                                                        <rect x="3" y="12" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.6"/>
                                                    </svg>
                                                    Initiatives
                                                </button>
                                            </>
                                        )}
```

- [ ] **Step 2: Build and verify toggle renders**

Run: `npm run build`
Expected: Build succeeds. Toggle button appears in the filter bar when initiative data is present.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "Add Initiatives toggle button to filter bar"
```

---

### Task 4: Frontend — Render initiative groups in the task list

**Files:**
- Modify: `frontend/src/dashboard.jsx:13249-13253` (the `.task-list` div and `epicGroups.map`)

- [ ] **Step 1: Replace the flat `epicGroups.map` with initiative-aware rendering**

Replace the section starting at line 13249 (inside the ternary that checks `visibleTasksForList.length === 0`). The key change: when `groupByInitiative` is true and `initiativeGroups` exists, render initiative wrappers around the epic blocks. When off, render exactly as before.

Find this block:

```jsx
                                <div
                                    className={`task-list ${activeDependencyFocus ? 'focus-mode' : ''}`}
                                    onClick={handleDependencyFocusClick}
                                >
                                    {epicGroups.map(epicGroup => {
```

Replace with:

```jsx
                                <div
                                    className={`task-list ${activeDependencyFocus ? 'focus-mode' : ''}`}
                                    onClick={handleDependencyFocusClick}
                                >
                                    {initiativeGroups ? (
                                        initiativeGroups.map(ig => {
                                            const ini = ig.initiative;
                                            const isMultiEpic = ini && ig.epicGroups.length > 1;
                                            return (
                                                <div
                                                    key={ini ? ini.key : 'no-initiative'}
                                                    className={ini ? (isMultiEpic ? 'initiative-group' : 'initiative-group initiative-single') : ''}
                                                >
                                                    {ini && (
                                                        <div className={`initiative-label ${isMultiEpic ? '' : 'initiative-label-only'}`}>
                                                            <span className="initiative-label-name">{ini.summary}</span>
                                                            <a
                                                                className="initiative-label-key"
                                                                href={jiraUrl ? `${jiraUrl}/browse/${ini.key}` : '#'}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                {ini.key} ↗
                                                            </a>
                                                            <span className="initiative-divider" />
                                                        </div>
                                                    )}
                                                    {ig.epicGroups.map(epicGroup => {
```

Then at the bottom of the existing `epicGroups.map` callback (after the closing `</div>` of the `epic-block` and the closing of the `.map`), close the initiative wrappers:

Find the end of the `epicGroups.map` — the `})}` that closes it — and after it add the closing for the initiative group div and the `initiativeGroups.map`:

```jsx
                                    })}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        epicGroups.map(epicGroup => {
```

And duplicate the existing epicGroup rendering for the fallback branch (toggle OFF). Since this is a large block, the cleaner approach is to extract the epic-block rendering into a local variable. Here's the full pattern:

Extract a `renderEpicBlock` helper. Cut the entire body of the existing `epicGroups.map` callback — from `const epicInfo = epicGroup.epic;` through the closing `</div>` of the `epic-block` div and the closing `);` of the return — and paste it into this function. The function takes `epicGroup` as its single argument and returns the JSX that was previously the map callback body. Place it above the task-list `<div>`, inside the component scope:

```javascript
                            const renderEpicBlock = (epicGroup) => {
                                const epicInfo = epicGroup.epic;
                                const epicTitle = epicInfo?.summary || epicGroup.parentSummary ||
                                    (epicGroup.key === 'NO_EPIC' ? 'No Epic Linked' : epicGroup.key);
                                const epicTotalSp = epicGroup.storyPoints || 0;
                                return (
                                    <div
                                        key={epicGroup.key}
                                        className={`epic-block ${excludedEpicSet.has(...) ...}`}
                                        ref={...}
                                    >
                                        {/* ALL existing epic-block content — epic-header, tasks.map, etc. */}
                                        {/* This is a verbatim cut-paste of the existing epicGroups.map callback body */}
                                    </div>
                                );
                            };
```

**Important:** Do NOT rewrite or simplify the epic-block JSX. Cut the entire existing callback body verbatim (it is ~150 lines). The only change is wrapping it in this function instead of being inline in `.map()`.

Then the task-list rendering becomes:

```jsx
                                <div
                                    className={`task-list ${activeDependencyFocus ? 'focus-mode' : ''}`}
                                    onClick={handleDependencyFocusClick}
                                >
                                    {initiativeGroups ? (
                                        initiativeGroups.map(ig => {
                                            const ini = ig.initiative;
                                            const isMultiEpic = ini && ig.epicGroups.length > 1;
                                            return (
                                                <div
                                                    key={ini ? ini.key : 'no-initiative'}
                                                    className={ini ? (isMultiEpic ? 'initiative-group' : 'initiative-group initiative-single') : ''}
                                                >
                                                    {ini && (
                                                        <div className={`initiative-label ${isMultiEpic ? '' : 'initiative-label-only'}`}>
                                                            <span className="initiative-label-name">{ini.summary}</span>
                                                            <a
                                                                className="initiative-label-key"
                                                                href={jiraUrl ? `${jiraUrl}/browse/${ini.key}` : '#'}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                {ini.key} ↗
                                                            </a>
                                                            <span className="initiative-divider" />
                                                        </div>
                                                    )}
                                                    {ig.epicGroups.map(epicGroup => renderEpicBlock(epicGroup))}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        epicGroups.map(epicGroup => renderEpicBlock(epicGroup))
                                    )}
                                </div>
```

- [ ] **Step 2: Build and verify rendering**

Run: `npm run build`
Expected: Build succeeds. When initiative data is present and toggle is ON, epics are wrapped in initiative groups with label rows.

- [ ] **Step 3: Run source guard tests**

Run: `node --test tests/test_initiative_grouping_source_guards.js`
Expected: All 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/dashboard.jsx
git commit -m "Render initiative groups with label and accent wrapper in task list"
```

---

### Task 5: CSS — Add initiative styling

**Files:**
- Modify: `frontend/dist/dashboard.css` (after the `.epic-meta` / `.epic-assignee` block, around line 3311)

- [ ] **Step 1: Add initiative CSS classes**

Insert the following CSS after the `.epic-assignee` rule (around line 3311):

```css
        /* ── Initiative grouping ── */

        .initiative-group {
            border-left: 2px solid #c4b5fd;
            padding-left: 12px;
            margin-bottom: 1.2rem;
        }

        .initiative-group.initiative-single {
            border-left: none;
            padding-left: 0;
        }

        .initiative-label {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
            padding-top: 4px;
        }

        .initiative-label-name {
            font-family: 'IBM Plex Mono', monospace;
            font-size: 0.6rem;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #7c3aed;
            font-weight: 600;
        }

        .initiative-label-only .initiative-label-name {
            color: #64748b;
        }

        .initiative-label-key {
            font-family: 'IBM Plex Mono', monospace;
            font-size: 0.6rem;
            color: #a78bfa;
            text-decoration: none;
            white-space: nowrap;
        }

        .initiative-label-key:hover {
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .initiative-label-only .initiative-label-key {
            color: #94a3b8;
        }

        .initiative-divider {
            flex: 1;
            height: 1px;
            background: linear-gradient(to right, #c4b5fd, transparent);
        }

        .initiative-label-only .initiative-divider {
            background: linear-gradient(to right, #cbd5e1, transparent);
        }

        /* Toggle button overrides */

        .initiative-toggle-separator {
            display: inline-block;
            width: 1px;
            height: 18px;
            background: var(--border);
            margin: 0 4px;
            vertical-align: middle;
        }

        button.toggle.initiative-toggle {
            display: inline-flex;
            align-items: center;
        }

        button.toggle.initiative-toggle.active {
            background: #f5f3ff;
            color: #7c3aed;
            border-color: #c4b5fd;
            font-weight: 500;
        }
```

- [ ] **Step 2: Verify styles visually**

Open the dashboard in a browser, load a sprint that has epics with initiative parents. Confirm:
- Multi-epic initiatives show purple left accent + label
- Single-epic initiatives show gray subtitle label only
- No-initiative epics render without decoration
- Toggle switches between grouped and flat views

- [ ] **Step 3: Commit**

```bash
git add frontend/dist/dashboard.css
git commit -m "Add initiative grouping CSS — label, accent, toggle styles"
```

---

### Task 6: Build and run all tests

**Files:** None (verification only)

- [ ] **Step 1: Run frontend build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run Python tests**

Run: `.venv/bin/python -m pytest tests/test_initiative_extraction.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 3: Run JS source guard tests**

Run: `node --test tests/test_initiative_grouping_source_guards.js`
Expected: All 5 tests PASS.

- [ ] **Step 4: Run full test suite to check for regressions**

Run: `.venv/bin/python -m unittest discover -s tests && node --test tests/test_dashboard_epic_icon_source_guards.js tests/test_initiative_grouping_source_guards.js`
Expected: All tests PASS.

- [ ] **Step 5: Verify no payload bloat**

Open browser dev tools, compare the `/api/tasks` response size before and after. Each epic with an initiative parent gains ~50 bytes (`"initiative":{"key":"INIT-42","summary":"..."}`). Total payload increase should be well under 10%.
