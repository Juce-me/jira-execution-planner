# Plan: Main Screen UX Improvements

## Context

The main screen has three functional areas that have accumulated rough edges: the filter strip, the alerts panel, and the task list. This plan addresses both functional gaps (alert dismissal persistence, empty state clarity) and visual hierarchy improvements (progress bars, filter chips, alert severity, stat card feedback).

All changes are in `frontend/src/dashboard.jsx` and `frontend/dist/dashboard.css`. Build: `npm run build`.

---

## Improvements

### 1. Persist dismissed alert keys to localStorage

**Problem:** `dismissedAlertKeys` (line 490) is never written to localStorage. Every refresh wipes manual dismissals. Dismissals should persist until the underlying issue is actually fixed — which happens naturally when Jira data refreshes and the task no longer appears in the alert.

**Changes:**
- Hydrate initial state from `savedPrefsRef.current.dismissedAlertKeys ?? []` (same pattern as `showKilled`, line 183).
- In `saveUiPrefs()` (~line 105), include `dismissedAlertKeys` in the saved object.

**Risk:** Low. Follows exact existing pattern.

**Verify:** Dismiss a story, refresh — story stays dismissed. Fix the issue in Jira, refresh — story is gone from alerts naturally.

---

### 2. Alert count badge + Jira link chip on "Show Alerts" button when panel is hidden

**Problem:** Collapsed panel shows "Show Alerts" with no hint of how many issues need attention or a path to act on them.

**Changes:**
- Collect all currently-alerted issue keys into `allAlertedKeys` (union across all 10 alert arrays).
- When `!showAlertsPanel`, add inside the toolbar (line 12719):
  ```jsx
  <span className="alerts-panel-count-badge">{alertItemCount}</span>
  <a className="alert-chip" href={buildKeyListLink(allAlertedKeys)} target="_blank" rel="noopener noreferrer">
    Open in Jira
  </a>
  ```
- CSS: `.alerts-panel-count-badge` — small red pill matching `.alert-chip` style.

**Risk:** Very low. Additive. `buildKeyListLink` handles empty arrays gracefully.

**Verify:** Collapse panel → badge + chip visible. Click chip → Jira opens with all alerted issues. Expand → hidden.

---

### 3. Empty state explains active filters and offers "Clear filters"

**Problem:** Generic "No tasks found" (lines 13813–13817) gives no context and forces users to hunt for active filters.

**Changes:**
- Compute `hasActiveFilters = statusFilter !== null || !showTech || !showProduct || !showDone || !!searchQuery`.
- Build a human-readable list of active filter names (e.g. "High Priority", "Product hidden", "Search: 'foo'").
- Replace the generic `<p>` with the filter list.
- Add a "Clear filters" `<button>` that resets all filter states to defaults in one click.

**Risk:** Low. Leaf render path, purely additive.

**Verify:** Apply High Priority filter on sprint with no HP tasks → empty state names it → Clear → tasks reappear.

---

### 4. Epic progress bar in group headers

**Problem:** Epic headers show total SP (`SP: {epicTotalSp.toFixed(1)}`, line 9974) but no progress context. Users can't see at a glance how much work in an epic is done.

Note: the SP span is inside `<div className="epic-meta">` (line 9973), not inside `.epic-title-row`. The progress bar replaces the SP span in that same location.

**Changes:**
- In `renderEpicBlock`, compute using the same status check as the rest of the codebase (`=== 'Done'`, not `['Done', 'Closed']`):
  ```js
  const doneSp = epicGroup.tasks
    .filter(t => t.fields.status?.name === 'Done')
    .reduce((sum, t) => sum + parseFloat(t.fields.customfield_10004 || 0), 0);
  const pct = epicTotalSp > 0 ? Math.round((doneSp / epicTotalSp) * 100) : 0;
  ```
- Replace the `SP: {epicTotalSp.toFixed(1)}` span with:
  ```jsx
  <span className={`epic-progress${pct === 100 ? ' epic-progress--complete' : ''}`}>
    <span className="epic-progress-label">{doneSp.toFixed(1)} / {epicTotalSp.toFixed(1)} SP</span>
    <span className="epic-progress-bar">
      <span className="epic-progress-fill" style={{width: `${pct}%`}} />
    </span>
    <span className="epic-progress-pct">{pct}%</span>
  </span>
  ```
- When `pct === 100`, add a "Ready to close" badge next to the label — connecting visually to the existing "Ready to Close Epics" alert:
  ```jsx
  {pct === 100 && <span className="epic-ready-badge">Ready to close</span>}
  ```
- CSS: `.epic-progress-bar` — 60px wide, 4px tall, rounded, light gray bg. `.epic-progress-fill` — green fill. `.epic-ready-badge` — small green chip matching `.alert-chip` style.

**Risk:** Low. Computed from already-available task data; no new API calls.

**Verify:** Epic with some done tasks shows a partially-filled progress bar. Epic with all done tasks shows 100%, green fill, and "Ready to close" badge.

---

### 5. Active filter chips row above the task list

**Problem:** No at-a-glance summary of which filters are active. Users must scan both filter groups to understand their current view.

**Changes:**
- Below `.filters-strip`, render a `.active-filters-row` when any filter is active:
  ```jsx
  {hasActiveFilters && (
    <div className="active-filters-row">
      <span className="active-filters-label">Filtered:</span>
      {statusFilter && <span className="active-filter-chip">{statusFilterLabel} <button onClick={() => setStatusFilter(null)}>×</button></span>}
      {!showTech && <span className="active-filter-chip">No Tech <button onClick={() => setShowTech(true)}>×</button></span>}
      {!showProduct && <span className="active-filter-chip">No Product <button onClick={() => setShowProduct(true)}>×</button></span>}
      {searchQuery && <span className="active-filter-chip">Search: "{searchQuery}" <button onClick={() => { setSearchQuery(''); setSearchInput(''); }}>×</button></span>}
      <button className="active-filters-clear-all" onClick={clearAllFilters}>Clear all</button>
    </div>
  )}
  ```
  Where `statusFilterLabel` is a lookup map: `{done: 'Done', 'high-priority': 'High Priority', 'in-progress': 'In Progress', 'todo-accepted': 'To Do / Accepted', 'minor-priority': 'Minor Priority'}`.
- CSS: `.active-filters-row` — flex row, wrap, small chips with `background: var(--bg-secondary)`, `border: 1px solid var(--border)`, `border-radius: 999px`, `padding: 2px 8px`, `font-size: 0.75rem`.

**Risk:** Low. Purely additive.

**Verify:** Activate "High Priority" filter → chip appears → click × → filter cleared → chip disappears. "Clear all" resets all at once.

---

### 6. Visual indicator on sprint selector when filters are active

**Problem:** When a user switches sprints, active filters from the previous view persist silently. The sprint selector gives no signal that the task list is still being filtered.

**Changes:**
- In `renderSprintControl` (line ~9718), the existing toggle is a `<div>`. Add `has-filters` to its className and nest the dot badge inside it:
  ```jsx
  <div className={`sprint-dropdown-toggle ${showSprintDropdown ? 'open' : ''}${hasActiveFilters ? ' has-filters' : ''}`} ...>
    <span>{sprintName || 'Sprint'}</span>
    {hasActiveFilters && <span className="sprint-filter-dot" title="Filters active" />}
    <svg .../>
  </div>
  ```
- CSS: `.sprint-filter-dot` — 6px circle, `background: var(--accent)`, positioned top-right of the toggle.

**Risk:** Very low. Additive dot badge, no logic change.

**Verify:** Apply any filter → dot appears on sprint selector. Clear all filters → dot disappears.

---

### 7. Alert cards: severity color coding and snapshot sort by count

**Problem:** All alert cards share the same left-border color regardless of severity. Static ordering doesn't surface the most critical alerts first.

**Background — actual alert card class names:**
Six of the ten alert cards all render with the same class `alert-card following`, which makes them impossible to target individually with CSS alone. The ten cards and their current JSX class names are:

| Alert | Array name | Current class |
|---|---|---|
| Missing info | `consolidatedMissingStories` | `alert-card missing` |
| Blocked | `blockedTasks` | `alert-card blocked` |
| Postponed | `postponedTasks` | `alert-card following` |
| Backlog | `backlogEpics` | `alert-card following` |
| Missing team | `missingTeamEpics` | `alert-card following` |
| Missing labels | `missingLabelEpics` | `alert-card following` |
| Needs stories | `needsStoriesEntries` | `alert-card following` |
| Waiting for stories | `waitingForStoriesEpics` | `alert-card following` |
| Empty epics | `emptyEpicsForAlert` | `alert-card empty-epic` |
| Done epics | `doneStoryEpics` | `alert-card done-epic` |

**Changes (JSX — add unique secondary class to each "following" card):**

Each `alert-card following` `<div>` must gain a second type class so the CSS rules below can target it. Change each card's `className` template literal:

```jsx
// postponedTasks card (line ~12956)
`alert-card following postponed ${showPostponedAlert ? '' : 'collapsed'}`

// backlogEpics card (line ~13127)
`alert-card following backlog ${showBacklogAlert ? '' : 'collapsed'}`

// missingTeamEpics card (line ~13196)
`alert-card following missing-team ${showMissingTeamAlert ? '' : 'collapsed'}`

// missingLabelEpics card (line ~13248)
`alert-card following missing-labels ${showMissingLabelsAlert ? '' : 'collapsed'}`

// needsStoriesEntries card (line ~13300)
`alert-card following needs-stories ${showNeedsStoriesAlert ? '' : 'collapsed'}`

// waitingForStoriesEpics card (line ~13355)
`alert-card following waiting ${showWaitingAlert ? '' : 'collapsed'}`
```

**Changes (CSS — severity colors, after JSX above is in place):**
```css
.alert-card.blocked        { border-left-color: #e53e3e; }  /* red — blockers */
.alert-card.missing-team   { border-left-color: #e53e3e; }  /* red — no team */
.alert-card.missing        { border-left-color: #dd6b20; }  /* orange — missing info */
.alert-card.missing-labels { border-left-color: #dd6b20; }  /* orange */
.alert-card.following      { border-left-color: #d69e2e; }  /* yellow — postponed/needs-stories base */
.alert-card.backlog        { border-left-color: #d69e2e; }  /* yellow */
.alert-card.waiting        { border-left-color: #a0aec0; }  /* gray — waiting */
```

**Changes (JSX — snapshot sort by count):**
- Build a data array `[{type, count, jsx}, ...]` and sort it **once at render time** (not reactively — cards should not shift position as items are dismissed mid-session). Use `useMemo` with `[selectedSprint, activeGroupId]` as dependencies so order re-evaluates only on sprint/group change, not on every dismissal.
- Each card block is already self-contained in a `{consolidatedX.length > 0 && ...}` guard — extract each into a named variable, then push into the array.

**Risk:** Medium for sort restructure (JSX refactor). Low for CSS + class additions. Implement JSX class additions and CSS first; sort second.

**Verify:** On load, card with most issues appears first. Dismissing items within a session does not reorder cards. New sprint load re-sorts correctly.

---

### 8. Stat card active state matches card type color

**Problem:** The active stat card shows a generic blue glow (CSS line 3639) regardless of type, creating a visual mismatch with the type-colored values inside each card.

**Changes (CSS only):**
```css
.stat-card.done.active          { border-color: #52c41a; box-shadow: 0 0 0 2px rgba(82,196,26,0.2);    background: #f6ffed; }
.stat-card.high-priority.active { border-color: #d4380d; box-shadow: 0 0 0 2px rgba(212,56,13,0.18);   background: #fff2e8; }
.stat-card.minor.active         { border-color: #64748b; box-shadow: 0 0 0 2px rgba(100,116,139,0.18);  background: #f8fafc; }
.stat-card.in-progress.active   { border-color: #597ef7; box-shadow: 0 0 0 2px rgba(89,126,247,0.18);   background: #f0f4ff; }
.stat-card.todo-accepted.active { border-color: #9254de; box-shadow: 0 0 0 2px rgba(146,84,222,0.18);   background: #f9f0ff; }
```

**Risk:** Very low. CSS-only, all additive.

**Verify:** Click "Done Tasks" → card turns green-tinted. Click "High Priority" → red-tinted.

---

### 9. Done task title strikethrough

**Problem:** Done tasks already have a green border and green background, but the title text has no visual completion signal.

**Changes (CSS only):**
```css
.task-item.status-done .task-title a {
    text-decoration: line-through;
    text-decoration-color: rgba(82, 196, 26, 0.5);
}
```

**Risk:** Very low. Single CSS rule.

**Verify:** Done tasks have struck-through title; in-progress tasks do not.

---

### 10. Story point badge pill

**Problem:** `.task-inline-sp` already has a color and weight but renders as plain inline text. A pill shape makes SP scannable across a dense task list.

**Changes (CSS only — enhances existing `.task-inline-sp` rule at CSS line 2935):**
```css
.task-inline-sp {
    display: inline-flex;
    align-items: center;
    background: rgba(89, 126, 247, 0.1);
    color: #597ef7;
    border-radius: 999px;
    padding: 1px 7px;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.02em;
}
```

**Risk:** Very low. Replaces existing rule on the same class.

**Verify:** SP count shows as a small blue pill badge on each task.

---

### 11. Epic group collapsible toggle + collapse all

**Problem:** Long epic groups dominate the task list with no way to collapse completed or less-relevant epics, and no way to get a high-level overview of all epics at once.

**Changes:**
- Add state: `const [collapsedEpics, setCollapsedEpics] = useState(new Set())`.
- Add chevron button at the start of `.epic-title-row` (line ~9920):
  ```jsx
  <button
    className={`epic-collapse-btn ${collapsedEpics.has(epicGroup.key) ? 'collapsed' : ''}`}
    onClick={() => setCollapsedEpics(prev => {
      const s = new Set(prev);
      s.has(epicGroup.key) ? s.delete(epicGroup.key) : s.add(epicGroup.key);
      return s;
    })}
    title={collapsedEpics.has(epicGroup.key) ? 'Expand' : 'Collapse'}
    type="button"
  >
    <svg viewBox="0 0 12 12" width="12" height="12">
      <path d="M2.5 4.5l3.5 3 3.5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  </button>
  ```
- Gate the task list render: `{!collapsedEpics.has(epicGroup.key) && epicGroup.tasks.map(...)}`.
- Add "Collapse all / Expand all" toggle above the task list (near the `.active-filters-row`), visible only when `epicGroups.length > 1`.
- CSS: `.epic-collapse-btn` — ghost button, `transition: transform 0.2s`. `.collapsed svg { transform: rotate(-90deg); }`.

**Risk:** Medium. Touches the task rendering loop. State is intentionally not persisted (resets on sprint change is correct behavior).

**Verify:** Chevron collapses individual epic. "Collapse all" hides all task bodies. "Expand all" restores. Other epics unaffected by individual collapse.

---

### 12. Relative timestamps with time for same-day updates

**Problem:** `Last Update: 2026-04-01` (line 10171) — absolute date with no relative context. For same-day updates, "today" gives no differentiation across 20 tasks all updated the same day.

**Changes:**
- Add helper (~line 100):
  ```js
  function relativeDate(dateStr) {
    const d = new Date(dateStr);
    const days = Math.floor((Date.now() - d) / 86400000);
    if (days === 0) return d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return d.toLocaleDateString('en-CA');
  }
  ```
- Replace line 10171 with `relativeDate(task.fields.updated)`.
- Keep absolute datetime in `title` attribute on the wrapping `<span>`.

**Risk:** Very low. Pure display change.

**Verify:** Task updated today shows "14:32". Task updated yesterday shows "yesterday". Older tasks show "3d ago" or absolute date. Hover shows full datetime.

---

### 13. Search result text highlighting

**Problem:** When `searchQuery` is active, the task list is filtered but matching text within titles is not highlighted. Users can't see why a task matched.

**Changes:**
- Add helper:
  ```js
  function highlightMatch(text, query) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return [text.slice(0, idx), <mark key="m">{text.slice(idx, idx + query.length)}</mark>, text.slice(idx + query.length)];
  }
  ```
- In task title render (line ~10112), replace `{task.fields.summary}` with `{highlightMatch(task.fields.summary, searchQuery)}`.
- CSS: `mark` — `background: rgba(250, 173, 20, 0.3); color: inherit; border-radius: 2px; padding: 0 1px`.

**Risk:** Low. Only triggers when `searchQuery` is non-empty. Handles missing match gracefully.

**Verify:** Search "login" → matching text in task titles highlighted in yellow. Clear search → highlights gone.

---

## Files to modify

| File | Sections |
|------|----------|
| `frontend/src/dashboard.jsx` | ~100 (helpers: `relativeDate`, `highlightMatch`), ~105 (`saveUiPrefs`), ~183 (state init + `collapsedEpics`), ~9718 (sprint selector filter dot), ~9920 (epic collapse toggle), ~9973 (epic progress bar + ready badge in `.epic-meta`), ~10112 (search highlight), ~10171 (relative date), ~12719 (alerts badge + chip), ~12956/13127/13196/13248/13300/13355 (add unique class to each `following` alert card), ~13693–13817 (filter chips + collapse-all + empty state) |
| `frontend/dist/dashboard.css` | `.task-item.status-done .task-title a` strikethrough, `.task-inline-sp` pill, `.epic-collapse-btn`, `.epic-progress-*`, `.epic-ready-badge`, `.active-filters-*`, `.sprint-filter-dot`, `.alerts-panel-count-badge`, `.alert-card` severity variants, `.stat-card` type-specific active states, `mark` highlight |

## Build & verification

```bash
npm run build
python3 jira_server.py
# Open jira-dashboard.html in browser
```

End-to-end checklist:
1. Dismiss alert story → refresh → still dismissed
2. Collapse alerts panel → count badge + "Open in Jira" chip visible → chip opens Jira
3. Apply filter → active chip appears → × removes it → "Clear all" resets all
4. Sprint selector shows dot badge when any filter is active
5. Done tasks have strikethrough title
6. SP shows as a small blue pill badge
7. Each epic header shows "X.X / Y.Y SP · Z%" progress bar
8. Epic at 100% shows "Ready to close" badge
9. Epic groups can be collapsed/expanded; "Collapse all / Expand all" buttons work
10. Stat cards glow in their type color when active (Done=green, High Priority=red, etc.)
11. Alert cards: blocked/missing-team are red, postponed are yellow; sort order fixed at sprint load
12. Task updated today shows time (e.g. "14:32"); yesterday shows "yesterday"; hover shows full datetime
13. Search active → matching text highlighted yellow in task titles
