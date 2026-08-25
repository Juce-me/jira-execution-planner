# Filterable Header Dropdowns And Stable Header Controls Implementation Plan

> **Status:** Ready for execution. Complete the unchecked steps in order and keep the plan on `improvement/filterable-header-dropdowns` until the implementation is accepted or merged.

**Goal:** Make the dashboard header controls searchable and layout-stable, relocate the context settings action beside Refresh, and replace the ENG Initiative checkbox with an aligned gray/yellow icon toggle.

**Architecture:** Keep Sprint, Group, and Teams behavior in `frontend/src/dashboard.jsx`, where their open state, options, and selection handlers already live; add one query per dropdown and render one shared input hook inside each existing open toggle. Remove the context gear from the wrapping `.view-filters` row and render the existing ENG/EPM action immediately after Refresh in `.header-actions-row`. In `EngView`, reuse `IconButton`, the filter bar's existing `.fb-trigger` geometry, and the existing `InitiativeIcon`; add only a generic icon-trigger modifier plus Initiative state/tooltip hooks.

**Tech Stack:** React 19, CSS, Playwright, esbuild.

**Spec:** Approved bounded design in the 2026-08-25 task conversation; no separate design artifact is required.

## Global Constraints

- Closed controls continue to show the selected sprint name, active group name, and selected-team summary with the existing caret and dimensions.
- Opening a control replaces only its displayed value with an auto-focused input; the existing toggle shell and panel remain the visual and positioning anchors.
- Group filtering is case-insensitive by group name; Teams filtering is case-insensitive by team name; Sprint filtering preserves the existing case-insensitive name match plus exact `A`, `C`, and `F` state shortcuts.
- Each query starts empty, uses the closed value as its placeholder, and is cleared whenever its dropdown closes, including selection, Escape, outside click, or opening a sibling dropdown.
- Team checkbox/multi-select behavior remains unchanged and the panel stays open while a team option is toggled.
- Sprint, Group, and Teams selection analytics remain unchanged. Query keystrokes add no event because they are transient, high-frequency text and may contain user-authored names.
- Reuse `.sprint-dropdown-toggle`, `.group-dropdown-toggle`, `.team-dropdown-toggle`, their existing panels/options, and the current `:has(...)` layering rules. Add only one shared input class; do not add per-control input variants or change shared control height/flex layout.
- Cover every sibling control named by the request. A test that exercises only Sprint is insufficient.
- Verify the main header and compact sticky header continue to use the same render functions; do not fork their behavior.
- Keep `.view-filters` wrapping behavior for genuinely narrow screens, but remove the settings gear from that width calculation. At 1091×800 and 1440×900, a fixture with multiple visible groups must keep Sprint, Group, Teams, and ENG mode on one center-aligned row.
- Render the existing context settings action immediately after Refresh in `.header-actions-row`. Preserve the ENG `groupsLoading` disabled gate and `trackSettingsAction('teams', 'open', { source_surface: 'dashboard' })`; preserve the EPM `canEditEpmConfiguration` gate and `openEpmSettingsTab` handler.
- Reuse `IconButton`, `.fb-trigger`, and `InitiativeIcon` for Group by Initiative. Add a reusable `.fb-trigger-icon` modifier for square icon triggers; do not restore the obsolete `initiative-toggle` control or reuse the settings-only `.group-visible-control` checkbox style.
- Initiative off/on state is conveyed by `aria-pressed`, a dynamic real tooltip, and color. Off uses neutral gray; on uses the existing Initiative yellow token and pale-yellow surface. The 30×30 button geometry must be identical in both states and vertically centered against Sort.
- Do not change backend routes, API payloads, saved preferences, dropdown selection contracts, or unrelated dashboard controls.
- Do not hand-edit `frontend/dist/`; regenerate it with `npm run build`.
- Do not commit, push, merge, or modify unrelated dirty files unless the user separately authorizes it.

---

### Task 1: Implement and verify the three filterable open toggles

**Files:**
- Modify: `tests/ui/codebase_structure_smoke.spec.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/styles/shared/controls.css`
- Modify: `docs/README_ANALYTICS.md`
- Rebuild: `frontend/dist/dashboard.js`
- Rebuild: `frontend/dist/dashboard.js.map`
- Rebuild: `frontend/dist/dashboard.css`

**Interfaces:**
- Consumes: `visibleControlGroups`, `teamOptions`, `availableSprints`, `showGroupDropdown`, `showTeamDropdown`, `showSprintDropdown`, and `applyExclusiveDropdownState(kind, isOpen)` in `frontend/src/dashboard.jsx`.
- Produces: `groupDropdownQuery: string`, `teamDropdownQuery: string`, the existing `sprintSearch: string`, and memoized `filteredControlGroups`, `filteredTeamOptions`, and `filteredSprints` arrays used only for panel rendering.
- Produces: `.dropdown-toggle-filter-input`, a shared input hook rendered inside each existing `.group-dropdown-toggle.open`, `.team-dropdown-toggle.open`, and `.sprint-dropdown-toggle.open` shell.
- Preserves: current option click/change handlers, `trackFilterChanged(...)` calls, selected values, exclusive dropdown behavior, and the main/compact `surface === activeControlSurface` panel guard.

- [ ] **Step 1: Confirm the execution baseline and named files**

Run:

```bash
git branch --show-current
git status --short
test -f frontend/src/dashboard.jsx
test -f frontend/src/styles/shared/controls.css
test -f tests/ui/codebase_structure_smoke.spec.js
test -f docs/README_ANALYTICS.md
```

Expected: the branch is `improvement/filterable-header-dropdowns`; every named file exists; any dirty files are identified before editing.

- [ ] **Step 2: Add one failing Playwright test covering Sprint, Group, and Teams**

Add a test named `open header dropdown toggles filter groups teams and sprints` near the existing main-header and team-dropdown coverage in `tests/ui/codebase_structure_smoke.spec.js`. Use `installApiMocks` with at least two groups and three sprints:

```js
test('open header dropdown toggles filter groups teams and sprints', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, {
        groups: [
            { id: 'grp-default', name: 'Default', teamIds: ['team-alpha', 'team-beta'] },
            { id: 'grp-platform', name: 'Platform Delivery', teamIds: ['team-beta'] },
        ],
        sprints: [
            { id: selectedSprintId, name: selectedSprintName, state: 'active' },
            { id: 34624, name: '2026Q2 Sprint 41', state: 'closed' },
            { id: 34626, name: '2026Q3 Sprint 43', state: 'future' },
        ],
    });

    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });
    const controls = page.locator('.view-selector').first();

    const group = controls.locator('.group-dropdown');
    await group.locator('.group-dropdown-toggle').click();
    const groupInput = group.getByRole('textbox', { name: 'Filter groups' });
    await expect(groupInput).toBeFocused();
    await expect(groupInput).toHaveValue('');
    await expect(groupInput).toHaveAttribute('placeholder', 'Default');
    await groupInput.fill('platform');
    await expect(group.locator('.group-dropdown-option')).toHaveCount(1);
    await expect(group.locator('.group-dropdown-option')).toContainText('Platform Delivery');
    await page.keyboard.press('Escape');
    await expect(groupInput).toHaveCount(0);

    const teams = controls.locator('.team-dropdown');
    await teams.locator('.team-dropdown-toggle').click();
    const teamInput = teams.getByRole('textbox', { name: 'Filter teams' });
    await expect(teamInput).toBeFocused();
    await teamInput.fill('beta');
    await expect(teams.locator('label.team-dropdown-option')).toHaveCount(1);
    await expect(teams.locator('label.team-dropdown-option')).toContainText('Beta Team');
    await page.keyboard.press('Escape');

    const sprint = controls.locator('.sprint-dropdown');
    await sprint.locator('.sprint-dropdown-toggle').click();
    const sprintInput = sprint.getByRole('textbox', { name: 'Filter sprints' });
    await expect(sprintInput).toBeFocused();
    await sprintInput.fill('f');
    await expect(sprint.locator('.sprint-dropdown-search')).toHaveCount(0);
    await expect(sprint.locator('.sprint-dropdown-option')).toHaveCount(1);
    await expect(sprint.locator('.sprint-dropdown-option')).toContainText('2026Q3 Sprint 43');

    expect(apiMocks.unexpectedCalls).toEqual([]);
});
```

In the same test, add element-level geometry and layer assertions for each open input. Measure the actual input, its toggle shell, and its panel rather than only sibling containers:

```js
const geometry = await sprintInput.evaluate((input) => {
    const toggle = input.closest('.sprint-dropdown-toggle');
    const panel = input.closest('.sprint-dropdown').querySelector('.sprint-dropdown-panel');
    const inputRect = input.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(panelRect.left + 12, panelRect.top + 12);
    return {
        inputInsideToggle: inputRect.left >= toggleRect.left && inputRect.right <= toggleRect.right,
        inputNotClipped: input.scrollWidth <= input.clientWidth,
        panelBelowToggle: panelRect.top >= toggleRect.bottom,
        panelOwnsHitPoint: Boolean(hit?.closest?.('.sprint-dropdown-panel')),
    };
});
expect(geometry).toEqual({
    inputInsideToggle: true,
    inputNotClipped: true,
    panelBelowToggle: true,
    panelOwnsHitPoint: true,
});
```

Factor this measurement into a local test helper and call it for Group, Teams, and Sprint. Capture a settled screenshot while one filtered panel is open:

```js
await captureSmokeScreenshot(page, 'filterable-header-dropdown-input');
```

The behavior helper must also prove query reset paths rather than only the first open: open Group and type, open Teams as the sibling without first closing Group, then reopen Group and assert its input is empty and both group options are back; close Teams by clicking outside, reopen it, and assert all team options are back; close Sprint by selecting the filtered future sprint, reopen it, and assert all three sprints are back. After the main surface passes, scroll until `.compact-sticky-header.is-visible` is visible and run the same focus/filter/geometry helper against `.compact-sticky-header` before capturing the screenshot. This proves the shared render path on both actual surfaces instead of relying on source inspection.

- [ ] **Step 3: Run the focused test and verify the expected RED failure**

Start the configured local server in one terminal:

```bash
SERVER_PORT=5050 .venv/bin/python jira_server.py
```

Run in another terminal:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "open header dropdown toggles filter groups teams and sprints"
```

Expected: FAIL because no `Filter groups` textbox exists inside the open Group toggle. A server-start error, fixture error, or timeout is not the required RED result and must be corrected before implementation.

- [ ] **Step 4: Add per-dropdown query state and filtered option arrays**

Beside the current dropdown state declarations in `frontend/src/dashboard.jsx`, add:

```jsx
const [groupDropdownQuery, setGroupDropdownQuery] = useState('');
const [teamDropdownQuery, setTeamDropdownQuery] = useState('');
```

Keep `sprintSearch` as the Sprint query so the existing state/name shortcut contract is retained. Place `filteredControlGroups` beside `filteredSprints`, after `visibleControlGroups` has been returned by `useGroupVisibilityPreferences`. Place `filteredTeamOptions` immediately after the existing `teamOptions` memo near the team-scope logic; `teamOptions` is declared later in the component and must not be referenced from the earlier Sprint/Group memo block. Derive both arrays without changing their sources:

```jsx
const filteredControlGroups = React.useMemo(() => {
    const query = groupDropdownQuery.trim().toLowerCase();
    if (!query) return visibleControlGroups || [];
    return (visibleControlGroups || []).filter(group =>
        String(group?.name || '').toLowerCase().includes(query)
    );
}, [visibleControlGroups, groupDropdownQuery]);

const filteredTeamOptions = React.useMemo(() => {
    const query = teamDropdownQuery.trim().toLowerCase();
    if (!query) return teamOptions;
    return teamOptions.filter(team =>
        String(team?.name || '').toLowerCase().includes(query)
    );
}, [teamOptions, teamDropdownQuery]);
```

Reset transient queries from close state so outside clicks and sibling opens are covered without duplicating reset calls in every close path:

```jsx
useEffect(() => {
    if (!showGroupDropdown) setGroupDropdownQuery('');
}, [showGroupDropdown]);

useEffect(() => {
    if (!showTeamDropdown) setTeamDropdownQuery('');
}, [showTeamDropdown]);

useEffect(() => {
    if (!showSprintDropdown) setSprintSearch('');
}, [showSprintDropdown]);
```

- [ ] **Step 5: Render the input in each existing open toggle and remove Sprint’s panel input**

For each existing toggle shell, keep the same outer class, caret, disabled guard, and dimensions. When closed, keep its current selected-value markup and open behavior. When open, render the corresponding input instead of the selected-value span.

Group:

```jsx
<input
    type="text"
    className="dropdown-toggle-filter-input"
    value={groupDropdownQuery}
    onChange={(event) => setGroupDropdownQuery(event.target.value)}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            setShowGroupDropdown(false);
        }
    }}
    placeholder={activeGroup?.name || 'Group'}
    aria-label="Filter groups"
    autoFocus
/>
```

Teams:

```jsx
<input
    type="text"
    className="dropdown-toggle-filter-input"
    value={teamDropdownQuery}
    onChange={(event) => setTeamDropdownQuery(event.target.value)}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            setShowTeamDropdown(false);
        }
    }}
    placeholder={selectedTeamsLabel}
    aria-label="Filter teams"
    autoFocus
/>
```

Sprint:

```jsx
<input
    type="text"
    className="dropdown-toggle-filter-input"
    value={sprintSearch}
    onChange={(event) => setSprintSearch(event.target.value)}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            setShowSprintDropdown(false);
        }
    }}
    placeholder={sprintName || 'Sprint'}
    aria-label="Filter sprints"
    autoFocus
/>
```

Render `filteredControlGroups`, `filteredTeamOptions`, and `filteredSprints` in the corresponding panels.

While open, the wrapper is only the visual shell: remove its button role/tab stop/accessible select label so the nested input is the sole focus target. Keep closed-state `Select sprint`, `Select group`, and `Filter teams` accessible labels for compatibility. Run the wrapper's open click/Enter/Space handlers only while closed; otherwise input clicks or a typed space would bubble and close the dropdown. Stop every input keydown from reaching the wrapper, then handle Escape by calling the matching `setShow*Dropdown(false)` setter. Remove the old `.sprint-dropdown-search` input from `.sprint-dropdown-panel`.

Render an existing option-style empty row when a non-empty query has no matches:

```jsx
<div className="dropdown-filter-empty" role="status">No matching groups</div>
```

Use corresponding `No matching teams` and `No matching sprints` copy. Preserve `No groups yet`, `Loading groups...`, `Loading sprints...`, and `No sprints available` for genuinely empty/loading unfiltered states.

- [ ] **Step 6: Add one shared input/empty-state style without overriding control layout**

Add only shared descendant hooks to `frontend/src/styles/shared/controls.css`:

```css
.dropdown-toggle-filter-input {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    cursor: text;
    box-sizing: border-box;
}

.dropdown-toggle-filter-input::placeholder {
    color: var(--text-secondary);
    opacity: 1;
}

.dropdown-filter-empty {
    padding: 0.3rem 0.2rem;
    color: var(--text-secondary);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    line-height: 1.2;
}
```

Do not change `display`, `flex-wrap`, `height`, fixed control widths, panel z-indexes, or the main/compact header layout rules. Delete `.sprint-dropdown-search` CSS only after `rg` confirms the class has no remaining source consumer.

- [ ] **Step 7: Document the analytics decision**

Add one row to `docs/README_ANALYTICS.md` under `No-Event Allowlist`:

```markdown
| Header dropdown query typing | `frontend/src/dashboard.jsx` | No separate `userevent`; Sprint, Group, and Teams query text only filters already-loaded local options and is discarded on close. Existing `filter_changed` events remain attached to committed Sprint, Group, and Teams selections, while raw query text, sprint names, group names, and team names are never collected. | 2026-08-25 |
```

- [ ] **Step 8: Run focused GREEN verification and inspect the screenshot**

Run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "open header dropdown toggles filter groups teams and sprints"
```

Expected: 1 passed. Open `/tmp/codebase-structure-qa/filterable-header-dropdown-input.png` and confirm the input remains inside the original control border, the control label is unobscured, the caret stays aligned, the filtered panel is above page content, and no text is clipped.

- [ ] **Step 9: Run sibling-control regression checks**

Run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "ENG Catch Up, Planning, and Scenario render|team dropdown restores scoped team selection|open header dropdown toggles"
npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js tests/ui/eng_priority_transitions.spec.js
```

Expected: all selected tests pass using normal clicks; no `force: true` interaction is introduced. Group switching, team selection persistence, and existing dropdown layering remain green.

- [ ] **Step 10: Rebuild generated frontend output and run final verification**

Run:

```bash
npm run build
npm run test:frontend:unit
python3 -m unittest discover -s tests
git diff --check
git status --short
git diff -- frontend/src/dashboard.jsx frontend/src/styles/shared/controls.css tests/ui/codebase_structure_smoke.spec.js docs/README_ANALYTICS.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
```

Expected: build, frontend unit suite, Python suite, and diff check pass; generated output matches source; the diff contains only this feature plus any explicitly preserved pre-existing changes.

- [ ] **Step 11: Commit the implementation after review**

Do not commit until the user authorizes it. Then run:

```bash
git add frontend/src/dashboard.jsx frontend/src/styles/shared/controls.css tests/ui/codebase_structure_smoke.spec.js docs/README_ANALYTICS.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "improve filterable header dropdowns"
```

Expected: one atomic implementation commit with no local data, screenshots, secrets, or unrelated files.

### Task 2: Keep the main controls row stable and move context settings beside Refresh

**Files:**
- Modify: `tests/ui/codebase_structure_smoke.spec.js`
- Modify: `tests/test_epm_view_source_guards.js`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/styles/shared/controls.css`
- Modify: `docs/README_ANALYTICS.md`
- Rebuild: `frontend/dist/dashboard.js`
- Rebuild: `frontend/dist/dashboard.js.map`
- Rebuild: `frontend/dist/dashboard.css`

**Interfaces:**
- Consumes: `.header-actions-row`, `.view-filters`, `selectedView`, `groupsLoading`, `canEditEpmConfiguration`, `openGroupManage`, `openEpmSettingsTab`, and `trackSettingsAction(...)` in `frontend/src/dashboard.jsx`.
- Produces: one existing `.group-gear-button` immediately after `.refresh-icon` for the active ENG or EPM context; no settings action remains inside `.view-filters`.
- Preserves: the current gear SVG, titles, accessible names, permission/disabled gates, modal-opening handlers, and existing `settings_action` analytics.

- [ ] **Step 1: Add a failing multi-group header-layout Playwright test**

Add `multiple groups keep the main controls on one row and settings beside refresh` to `tests/ui/codebase_structure_smoke.spec.js`. Use a two-group `installApiMocks` fixture so the Group control is present, set the viewport to the screenshot-relevant 1091×800 size, and assert the actual direct children of `.view-filters` share one vertical center:

```js
test('multiple groups keep the main controls on one row and settings beside refresh', async ({ page }) => {
    const calls = [];
    const apiMocks = await installApiMocks(page, calls, {
        groups: [
            { id: 'grp-default', name: 'Default', teamIds: ['team-alpha', 'team-beta'] },
            { id: 'grp-platform', name: 'Platform Delivery', teamIds: ['team-beta'] },
        ],
    });
    await page.setViewportSize({ width: 1091, height: 800 });
    await page.goto(`${appBaseUrl}/`, { waitUntil: 'networkidle' });

    const filters = page.locator('.view-selector .view-filters');
    await expect(filters.locator('.group-dropdown')).toBeVisible();
    await expect(filters.locator('.group-gear-button')).toHaveCount(0);
    const geometry = await filters.evaluate((row) => {
        const visible = [...row.children]
            .map((node) => ({ node, rect: node.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0);
        const centres = visible.map(({ rect }) => rect.top + rect.height / 2);
        return {
            rowCount: centres.reduce((rows, centre) => (
                rows.some(existing => Math.abs(existing - centre) <= 2) ? rows : [...rows, centre]
            ), []).length,
            clipped: visible.some(({ node }) => node.scrollWidth > node.clientWidth + 1),
        };
    });
    expect(geometry).toEqual({ rowCount: 1, clipped: false });

    const headerActions = page.locator('.header-actions-row');
    const settings = headerActions.getByRole('button', { name: 'Manage team groups' });
    await expect(settings).toBeVisible();
    await expect(headerActions.locator('.refresh-icon + .group-gear-button')).toHaveCount(1);
    const centerDelta = await settings.evaluate((button) => {
        const refreshButton = button.previousElementSibling;
        const a = button.getBoundingClientRect();
        const b = refreshButton.getBoundingClientRect();
        return Math.abs((a.top + a.height / 2) - (b.top + b.height / 2));
    });
    expect(centerDelta).toBeLessThanOrEqual(1);

    await captureSmokeScreenshot(page, 'stable-multi-group-header-controls');
    await settings.click();
    await expect(page.locator('.group-modal-backdrop')).toBeVisible();
    expect(apiMocks.unexpectedCalls).toEqual([]);
});
```

Repeat only the geometry assertions after resizing to 1440×900. The assertion must measure each actual control, not only the `.view-filters` bounding box.

- [ ] **Step 2: Add a failing EPM sibling-placement source guard**

Extend `tests/test_epm_view_source_guards.js` so both context gears are covered, not only the reported ENG instance:

```js
test('context settings actions live after refresh, outside wrapping view filters', () => {
    const actionsStart = dashboardSource.indexOf('className="header-actions-row"');
    const filtersStart = dashboardSource.indexOf('className="view-filters"', actionsStart);
    const actionsSource = dashboardSource.slice(actionsStart, filtersStart);
    const filtersEnd = dashboardSource.indexOf('</header>', filtersStart);
    const filtersSource = dashboardSource.slice(filtersStart, filtersEnd);

    assert.ok(actionsSource.indexOf('className="refresh-icon"') < actionsSource.indexOf('Manage team groups'));
    assert.ok(actionsSource.indexOf('className="refresh-icon"') < actionsSource.indexOf('Open EPM settings'));
    assert.ok(actionsSource.includes('groupsLoading'));
    assert.ok(actionsSource.includes('canEditEpmConfiguration'));
    assert.equal(filtersSource.includes('className="group-gear-button"'), false);
});
```

- [ ] **Step 3: Run both checks and verify RED failures**

Run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "multiple groups keep the main controls"
node --test tests/test_epm_view_source_guards.js
```

Expected: Playwright fails because the settings gear is still inside `.view-filters`; the source guard fails because neither context gear is after Refresh. Fixture or server errors are not the required RED result.

- [ ] **Step 4: Move both existing context settings blocks after Refresh**

In `frontend/src/dashboard.jsx`, cut the existing ENG and EPM conditional gear blocks from `.view-filters` and paste them immediately after the closing `</IconButton>` for `.refresh-icon` inside `.header-actions-row`. Preserve their current handlers and SVG paths exactly:

```jsx
{selectedView === 'eng' && (
    <button
        className="group-gear-button"
        onClick={(event) => {
            event.stopPropagation();
            trackSettingsAction('teams', 'open', { source_surface: 'dashboard' });
            openGroupManage();
        }}
        disabled={groupsLoading}
        title="Manage team groups"
        aria-label="Manage team groups"
        type="button"
    >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M19.4 12a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.1-1.2l-.4-2.6H9.6l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0-.1 1.2c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2l.4 2.6h4.8l.4-2.6c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    </button>
)}
{selectedView === 'epm' && canEditEpmConfiguration && (
    <button
        className="group-gear-button"
        onClick={openEpmSettingsTab}
        title="Open EPM settings"
        aria-label="Open EPM settings"
        type="button"
    >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M19.4 12a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.1-1.2l-.4-2.6H9.6l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0-.1 1.2c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2l.4 2.6h4.8l.4-2.6c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    </button>
)}
```

Do not add the gears to `.compact-sticky-header`; this task only relocates the existing main-header configuration entry points.

- [ ] **Step 5: Center the relocated gear without changing its shared size**

Add a placement-only descendant rule to `frontend/src/styles/shared/controls.css` next to `.header-actions-row`:

```css
.header-actions-row > .group-gear-button {
    margin-top: 0;
    align-self: center;
}
```

Keep the existing `.group-gear-button` width, height, icon, border, hover, and disabled behavior unchanged. Do not set `.view-filters` to `nowrap`; narrow-screen wrapping remains valid.

- [ ] **Step 6: Document the settings-relocation no-event decision**

Add this row under `No-Event Allowlist` in `docs/README_ANALYTICS.md`:

```markdown
| Header context settings relocation | `frontend/src/dashboard.jsx` | Moving the ENG/EPM settings gear from the wrapping controls row to the header actions preserves the existing `settings_action` open handlers, permission/disabled gates, and modal destinations. Another event would duplicate the same action, and no group name, team name, or EPM scope value is added to analytics. | 2026-08-25 |
```

- [ ] **Step 7: Run focused GREEN checks and inspect the screenshot**

Run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "multiple groups keep the main controls"
node --test tests/test_epm_view_source_guards.js
```

Expected: both commands pass. Inspect `/tmp/codebase-structure-qa/stable-multi-group-header-controls.png`: Sprint, Group, Teams, and ENG mode share one row; the gear is immediately right of Refresh; labels and values are unclipped.

- [ ] **Step 8: Rebuild and commit the layout slice after review**

Run:

```bash
npm run build
git diff --check
git add frontend/src/dashboard.jsx frontend/src/styles/shared/controls.css tests/ui/codebase_structure_smoke.spec.js tests/test_epm_view_source_guards.js docs/README_ANALYTICS.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "improve dashboard header control layout"
```

Expected: one atomic commit for header placement/layout only, with no screenshot files or unrelated changes.

### Task 3: Replace Group by Initiative with the approved icon toggle

**Files:**
- Modify: `tests/ui/eng_compact_layout_visual.spec.js`
- Modify: `tests/ui/codebase_structure_smoke.spec.js`
- Modify: `tests/test_initiative_grouping_source_guards.js`
- Modify: `tests/test_task_filter_menu_compaction_source_guards.js`
- Modify: `frontend/src/eng/EngView.jsx`
- Modify: `frontend/src/dashboard.jsx`
- Modify: `frontend/src/styles/eng/filter-bar.css`
- Modify: `docs/README_ANALYTICS.md`
- Rebuild: `frontend/dist/dashboard.js`
- Rebuild: `frontend/dist/dashboard.js.map`
- Rebuild: `frontend/dist/dashboard.css`

**Interfaces:**
- Consumes: `IconButton`, `InitiativeIcon`, `groupByInitiative: boolean`, `setGroupByInitiative(next: boolean)`, `.fb-trigger`, `--text-secondary`, `--bg-primary`, `--border`, `--jira-initiative-accent`, and `--jira-initiative-accent-surface`.
- Produces: `.fb-trigger-icon`, a reusable fixed 30×30 modifier for icon-only filter-bar triggers; `.initiative-grouping-control` and `.initiative-grouping-tooltip`, which add Initiative-specific state color and the hover/focus balloon without changing filter-bar membership.
- Preserves: `hasInitiativeData` visibility, `groupByInitiativeChoice` persistence, Initiative grouping behavior, filter badge/chips, Sort behavior, and the filter bar's 42px desktop height.

- [ ] **Step 1: Replace checkbox expectations with failing icon-state and geometry assertions**

Update `sort and grouping are view controls in the bar and render no chip` in `tests/ui/eng_compact_layout_visual.spec.js` to locate `button[aria-label="Group by Initiative"]` instead of `.group-visible-control input`. Assert the actual Sort toggle and Initiative button centers, geometry, state, computed colors, tooltip, and unchanged chip count:

```js
const grouping = viewControls.getByRole('button', { name: 'Group by Initiative' });
const sortToggle = viewControls.locator('.eng-epic-sort-dropdown .sprint-dropdown-toggle');
await expect(grouping).toHaveAttribute('aria-pressed', 'true');
await expect(grouping).toHaveCSS('color', 'rgb(255, 171, 0)');
await expect(grouping).toHaveCSS('border-color', 'rgb(255, 171, 0)');
await expect(grouping).toHaveCSS('background-color', 'rgba(255, 171, 0, 0.12)');
await waitForVisualSettled(page);
await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/initiative-grouping-on.png` });

const groupedGeometry = await Promise.all([grouping, sortToggle].map(locator => locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, center: rect.top + rect.height / 2 };
})));
expect(groupedGeometry[0].width).toBe(30);
expect(groupedGeometry[0].height).toBe(30);
expect(Math.abs(groupedGeometry[0].center - groupedGeometry[1].center)).toBeLessThanOrEqual(1);

await grouping.hover();
await expect(viewControls.getByRole('tooltip')).toHaveText('Group by Initiative — On');
await expect(viewControls.getByRole('tooltip')).toHaveCSS('opacity', '1');
await grouping.click();
await expect(grouping).toHaveAttribute('aria-pressed', 'false');
await expect(grouping).toHaveCSS('color', 'rgb(102, 102, 102)');
await expect(grouping).toHaveCSS('border-color', 'rgb(224, 221, 215)');
await expect(grouping).toHaveCSS('background-color', 'rgb(248, 247, 244)');
await expect(viewControls.getByRole('tooltip')).toHaveText('Group by Initiative — Off');
await expect(page.locator('.initiative-header')).toHaveCount(0);
await page.mouse.move(0, 0);
await waitForVisualSettled(page);
await page.locator('.filterbar-wrap').screenshot({ path: `${screenshotDir}/initiative-grouping-off.png` });
```

Measure the button again after switching off and assert width, height, and center are identical to the on state. Move the pointer away, focus the button, and prove the same tooltip is exposed from `:focus-within`:

```js
await page.mouse.move(0, 0);
await grouping.focus();
await expect(viewControls.getByRole('tooltip')).toHaveCSS('opacity', '1');
```

Run the same centerline/button-size assertion at 1091×800. At the existing narrow breakpoint, keep the filter bar's approved maximum two rows and assert the Sort and Initiative controls share the same second-row center.

- [ ] **Step 2: Update persistence and search coverage to use the button contract**

In `tests/ui/eng_compact_layout_visual.spec.js` and `tests/ui/codebase_structure_smoke.spec.js`, replace checkbox-specific locators and `toBeChecked()` calls with the accessible button and `aria-pressed`:

```js
const grouping = page.getByRole('button', { name: 'Group by Initiative' });
await expect(grouping).toHaveAttribute('aria-pressed', 'true');
await grouping.click();
await expect(grouping).toHaveAttribute('aria-pressed', 'false');
```

Keep the existing assertions that the explicit false choice persists across Refresh/new Initiative data, Initiative headers disappear, search still reveals all matching descendants, and grouping adds no filter chip.

- [ ] **Step 3: Update source guards before implementation**

Change `tests/test_initiative_grouping_source_guards.js` and `tests/test_task_filter_menu_compaction_source_guards.js` to require the shared icon-button contract and reject the old checkbox:

```js
assert.ok(engViewSource.includes("import IconButton from '../ui/IconButton.jsx'"));
assert.ok(engViewSource.includes('className="fb-trigger fb-trigger-icon"'));
assert.ok(engViewSource.includes('aria-label="Group by Initiative"'));
assert.ok(engViewSource.includes('aria-pressed={groupByInitiative}'));
assert.equal(engViewSource.includes('className="group-visible-control"'), false);
assert.equal(engViewSource.includes('type="checkbox"'), false);
assert.equal(engViewSource.includes('initiative-toggle'), false);
```

Keep the existing guards that Group by Initiative remains inside `viewControls`, the old display-card tokens stay absent, and `groupByInitiativeChoice` remains persisted.

- [ ] **Step 4: Run Initiative checks and verify RED failures**

Run:

```bash
node --test tests/test_initiative_grouping_source_guards.js tests/test_task_filter_menu_compaction_source_guards.js
npx playwright test tests/ui/eng_compact_layout_visual.spec.js --grep "sort and grouping|explicit grouping choice"
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "Initiative search"
```

Expected: source guards and Playwright fail because `EngView` still renders `.group-visible-control` with a checkbox. Test fixture, server, or unrelated rendering failures are not the required RED result.

- [ ] **Step 5: Render the icon toggle with semantic pressed state and a real tooltip**

Import `IconButton` in `frontend/src/eng/EngView.jsx` and replace the checkbox label with:

```jsx
{hasInitiativeData && (
    <span className="initiative-grouping-control">
        <IconButton
            className="fb-trigger fb-trigger-icon"
            onClick={() => setGroupByInitiative(!groupByInitiative)}
            aria-label="Group by Initiative"
            aria-pressed={groupByInitiative}
            aria-describedby="initiative-grouping-tooltip"
        >
            <InitiativeIcon size={14} title={null} />
        </IconButton>
        <span
            id="initiative-grouping-tooltip"
            className="initiative-grouping-tooltip"
            role="tooltip"
        >
            {`Group by Initiative — ${groupByInitiative ? 'On' : 'Off'}`}
        </span>
    </span>
)}
```

In `frontend/src/dashboard.jsx`, let the existing icon suppress its native `title` only for this control while preserving the current default everywhere else:

```jsx
function InitiativeIcon({ className = '', size = 14, title = 'INITIATIVE' }) {
    const classes = ['initiative-icon', className].filter(Boolean).join(' ');
    return (
        <span className={classes} aria-hidden="true" title={title || undefined}>
            <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
                <path
                    d="M8 1.75c-2.35 0-4.25 1.91-4.25 4.25 0 1.51.79 2.89 2.08 3.66.39.23.67.66.67 1.14v.45c0 .41.34.75.75.75h1.5c.41 0 .75-.34.75-.75v-.45c0-.48.28-.91.67-1.14A4.25 4.25 0 0 0 12.25 6c0-2.34-1.9-4.25-4.25-4.25Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M6.9 12.7h2.2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                />
                <path
                    d="M7.2 14.25h1.6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                />
            </svg>
        </span>
    );
}
```

The SVG path data is unchanged; `title={null}` prevents a second native tooltip from competing with the production tooltip balloon.

- [ ] **Step 6: Add the shared icon-trigger modifier and approved Initiative states**

Add these hooks next to `.fb-trigger` and `.fb-view-controls` in `frontend/src/styles/eng/filter-bar.css`:

```css
.fb-trigger-icon {
    width: 30px;
    min-width: 30px;
    padding-inline: 0;
    justify-content: center;
}

.initiative-grouping-control {
    position: relative;
    display: inline-flex;
    align-items: center;
}

.initiative-grouping-control .fb-trigger {
    color: var(--text-secondary);
    background: var(--bg-primary);
}

.initiative-grouping-control .initiative-icon {
    color: inherit;
}

.initiative-grouping-control .fb-trigger[aria-pressed="true"] {
    color: var(--jira-initiative-accent);
    border-color: var(--jira-initiative-accent);
    background: var(--jira-initiative-accent-surface);
}

.initiative-grouping-tooltip {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    z-index: calc(var(--sticky-control-overlay-z) + 3);
    width: max-content;
    max-width: 190px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--text-primary);
    color: var(--bg-primary);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.55rem;
    line-height: 1.35;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translate(-50%, 3px);
    transition: opacity 120ms ease, transform 120ms ease;
}

.initiative-grouping-control:hover .initiative-grouping-tooltip,
.initiative-grouping-control:focus-within .initiative-grouping-tooltip {
    opacity: 1;
    visibility: visible;
    transform: translate(-50%, 0);
}
```

Do not add `filter: grayscale(...)`, change `.fb-view-controls` alignment, alter `.filterbar` height, or restore the dead `button.toggle.initiative-toggle` source token.

- [ ] **Step 7: Document the no-event decisions**

Keep Task 1's header-query row and Task 2's settings-relocation row, then add this separate row under `No-Event Allowlist` in `docs/README_ANALYTICS.md`:

```markdown
| ENG Initiative icon toggle | `frontend/src/dashboard.jsx`, `frontend/src/eng/EngView.jsx` | Group by Initiative remains an already-untracked local persisted view preference that only regroups loaded tasks; its icon, tooltip, and gray/yellow presentation add no new product action and send no initiative keys, summaries, group names, team names, or issue data. | 2026-08-25 |
```

- [ ] **Step 8: Run focused GREEN verification and visually inspect both states**

Run:

```bash
node --test tests/test_initiative_grouping_source_guards.js tests/test_task_filter_menu_compaction_source_guards.js
npx playwright test tests/ui/eng_compact_layout_visual.spec.js --grep "sort and grouping|explicit grouping choice"
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "Initiative search"
```

Expected: all selected tests pass using normal clicks. Inspect `test-results/eng-compact-layout-qa/initiative-grouping-on.png` and `initiative-grouping-off.png`: the icon is yellow with a pale-yellow surface only when grouped, neutral gray when off, aligned to Sort in both states, and the bar does not grow.

- [ ] **Step 9: Run final build and regression verification**

Run:

```bash
npm run build
npm run test:frontend:unit
node --test tests/test_initiative_grouping_source_guards.js tests/test_task_filter_menu_compaction_source_guards.js tests/test_epm_view_source_guards.js
npx playwright test tests/ui/codebase_structure_smoke.spec.js tests/ui/eng_compact_layout_visual.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js tests/ui/eng_priority_transitions.spec.js
python3 -m unittest discover -s tests
git diff --check
git status --short
```

Expected: build, frontend unit tests, source guards, all named Playwright files, the full Python suite, and diff check pass. Review the complete source/generated diff and confirm every changed line maps to dropdown filtering, header stability/settings placement, the Initiative toggle, their tests, or analytics documentation.

- [ ] **Step 10: Commit the Initiative slice after review**

Do not commit until the user authorizes it. Then run:

```bash
git add frontend/src/eng/EngView.jsx frontend/src/dashboard.jsx frontend/src/styles/eng/filter-bar.css tests/ui/eng_compact_layout_visual.spec.js tests/ui/codebase_structure_smoke.spec.js tests/test_initiative_grouping_source_guards.js tests/test_task_filter_menu_compaction_source_guards.js docs/README_ANALYTICS.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git commit -m "improve initiative grouping control"
```

Expected: one atomic commit with the approved production states, no screenshots, local data, secrets, or unrelated files.

## Acceptance Criteria

- Opening Sprint, Group, or Teams places focus in an empty input inside the existing toggle shell.
- The input placeholder preserves the closed selection context.
- Typing filters only that control’s already-loaded options with the approved matching rules.
- Sprint has no second filter input inside its panel.
- Escape, outside click, selection, and sibling opening close the dropdown and clear its query.
- Reopening shows the full option list; Teams retains its checkbox selections.
- Main and compact sticky surfaces share behavior and remain correctly layered.
- Adding a second visible group must not increase the main `.view-filters` row count or move any control to another line at the approved desktop widths; the context settings gear is not a child of `.view-filters`.
- The context-specific ENG or EPM settings action renders immediately after Refresh in `.header-actions-row`; exactly one context settings action is present, and its existing click handler, permission gate, disabled state, tooltip, accessible name, and analytics remain unchanged.
- Group by Initiative remains a view preference, not a filter: it renders only when Initiative data exists, adds no chip, preserves the existing persisted explicit choice, and does not change task grouping semantics.
- The Initiative control is a fixed 30×30 icon button in both states. `aria-pressed="false"` uses neutral `var(--text-secondary)` on the normal control surface/border; `aria-pressed="true"` uses `var(--jira-initiative-accent)` (`#ffab00` fallback), `var(--jira-initiative-accent-surface)`, and the Initiative accent border. Use SVG `currentColor`; do not use CSS `filter: grayscale(...)`.
- Hover and keyboard focus expose a real tooltip reading `Group by Initiative — Off` or `Group by Initiative — On`; the button retains the static accessible name `Group by Initiative` plus `aria-pressed` for state.
- Element-level geometry assertions and a reviewed settled screenshot prove the input, label, caret, and panel are not clipped or overlapped.
- Existing selection analytics fire only on committed selections; query typing emits no event and collects no raw names.
- Existing settings-open analytics remain attached to the relocated gear; Initiative regrouping remains an explicitly documented no-event local preference.
- Generated frontend output matches source and all named verification commands pass.
