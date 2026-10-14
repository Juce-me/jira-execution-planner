# Shareable View Links Implementation Plan: Alert anchors, focus capture and reveal (Tasks 7 and 8)

> **Status:** Proposed 2026-10-14. Slice of [EXEC-shareable-view-links-194.md](EXEC-shareable-view-links-194.md). Read the master's Global Constraints, Review Focus and Execution status before starting, and record each task's status and commit SHA in the master's Execution status table. Slices are grouped by area, not by execution order; the master's table gives the order.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`SUPPORT-shareable-view-links-design-194.md`](SUPPORT-shareable-view-links-design-194.md)

**Tasks in this slice:** Task 7 (alert anchors and focus capture) and Task 8 (focus reveal and Planning rows seed).

---

### Task 7: Alert anchors and focus capture

**Owner note:** depends on Task 3 (only the names `SHARE_VIEW_ALERT_KEYS` and `SHARE_VIEW_ALERT_ANCHORS` from `frontend/src/shareView/viewDefaults.js`, read by one test); blocks Task 8 (the reveal imports `alertCardId`, `measureShareViewStickyBottom` and `SHARE_VIEW_FOCUS_MARGIN` from `focusCapture.js`) and Tasks 9 and 11 (they call `captureShareViewFocus` and `readPlanningRowsMode`). Pins design verification V20 (collapsed groups, followup Epic and Story groups, name-keyed group) and the capture half of V4. `docs/ontology.md` lines for "Alert-to-item navigation" and "Planning Sprint review" are updated by Task 13.

**Background (verified at HEAD):**
- `EngAlertsPanel.jsx` has exactly eleven `className="alert-team-group"` containers (the Postponed card has two lists: Stories and future-routed Epics). Each card root has `id="eng-alert-<kebab key>"`, the `sectionId` of its `ALERT_SUMMARY_CONFIG` entry; card and body both get the `collapsed` class when the category flag is false. A group id is `team.id || team.name || 'unknown'` (`groupAlertsByTeam`), and the `.alert-pill.team` pill shows `group.name`, so an id equal to the pill text is a name fallback.
- `.alert-card-body.collapsed` is `max-height: 0; overflow: hidden`: a collapsed group keeps its layout box (measured on screen at 289..443 px in an 800 px viewport, and at 305..463 px in the React-rendered app), so only the class selector can exclude it.
- The sticky filter bar is `.filterbar-wrap`. `.eng-filter-bar`, named by `measureStickyBottom`'s default list, is carried by no element. A sticky tier counts toward `measureStickyBottom` only while it is stuck, so `T` depends on the scroll position (at scroll 0 the filter bar is not stuck).
- A Planning table row renders `data-planning-row-key` (the numeric issue id), `data-row-kind` (`epic`, `story`, `requirement`, `group`) and `data-issue-key` only when it is not a synthetic row.
- **A capture right after a reveal must give the same target** (re-sharing a freshly opened link must not point one item up). The reveal (Task 8) lands its target `SHARE_VIEW_FOCUS_MARGIN = 12` px below `T`; this module exports that number so the two cannot drift. The design's visible rule, `bottom > T + 1`, then counted the sibling above the target as visible whenever the gap between siblings is under 11 px. Measured: an alert group (gap 9.6 px) leaves 2.4 px of the group above on screen and a Planning table row (no gap) leaves 12 px of the row above, and the capture returned the previous group or row. The rule is therefore `rect.bottom > T + SHARE_VIEW_FOCUS_MARGIN + 1 && rect.top < viewportBottom`: a node that shows only the sliver the landing margin leaves is not visible. Epic blocks (gap 12.8 px) and Story cards (gap 14.4 px) never leave a sliver, but the pin test needs the same margin: revealing the first Story of an Epic lands it 12 px below `T` and leaves that Epic's pinned header a few pixels under its pin line, so a header counts as pinned up to `SHARE_VIEW_FOCUS_MARGIN + 1` px below it (without that, the capture names the Epic instead of the Story).
- No jsdom exists in the repo; DOM-dependent tests build fakes by hand (`tests/test_eng_reading_anchor.js` sets `globalThis.document` and `globalThis.window`). The stand-in below evaluates the modules' real selector strings, and its selector results were compared with Chromium's.

**Files:**
- Create: `frontend/src/shareView/focusCapture.js`
- Create: `tests/test_share_view_alert_anchors.js`
- Create: `tests/test_share_view_focus_capture.js`
- Create: `tests/ui/share_view_focus.spec.js`
- Create: `tests/share_view_fake_dom.js` (test support, a DOM stand-in; not named `test_*.js`, so `npm run test:frontend:unit` does not run it as a test)
- Create: `tests/share_view_alert_panel_fixture.js` (test support, server-renders the real alerts panel; same naming reason)
- Modify: `frontend/src/eng/EngAlertsPanel.jsx` (the eleven `alert-team-group` containers inside the default export `EngAlertsPanel`)
- Modify: `frontend/dist/` (generated by `npm run build`, never hand-edited)
- Test: `tests/ui/eng_alerts_panel_summary.spec.js` (existing; with `tests/ui/eng_alert_loading_order.spec.js` and `tests/ui/eng_missing_story_ghosts.spec.js` it runs unmodified in Step 10)

**Interfaces:**
- Consumes: `measureStickyBottom(selectors)` from `frontend/src/eng/alertEpicNavigation.js` (existing; it reads the global `document` and `window`, so in tests the same stand-ins are installed as globals and passed as `root` and `win`). Test only: `SHARE_VIEW_ALERT_KEYS` (the ten category keys) and `SHARE_VIEW_ALERT_ANCHORS` (the ten plus `followupEpics`), both exported by Task 3's `frontend/src/shareView/viewDefaults.js`.
- Produces (binding): `captureShareViewFocus({ mode, rowsMode, root = document, win = window }) -> null | { kind: 'alertTeam', anchor, id } | { kind: 'epic' | 'story', key }`. `mode` is the Share view mode string; only `'catch-up'` and `'planning'` can return a target. `rowsMode` (`'epic'` or `'story'`) is the Planning table's current rows mode and filters the rows considered; when omitted it is read from the table.
- Produces (extra exports of the same module, used by Task 8 and available to Tasks 9 and 11): `alertCardId(anchor) -> 'eng-alert-...' | undefined` (maps the ten category keys and `followupEpics`), `measureShareViewStickyBottom({ epicHeaders = true } = {}) -> number`, `readPlanningRowsMode(root = document) -> 'epic' | 'story' | null`, `SHARE_VIEW_FOCUS_MARGIN = 12` (the one number shared by the capture's visible rule and the reveal's landing offset).
- Produces (DOM contract): every `.alert-team-group` carries `data-alert-team="<group id>"`; the future-routed Epic groups of the Postponed card also carry `data-alert-kind="epic"`.

**Forbidden regressions for this task:**
- [ ] The alerts markup keeps its classes, keys, ids and click behaviour: only `data-` attributes are added (the existing alert source guards and UI specs pass unmodified).
- [ ] No selector is ever built from a link value or from a DOM value (V4): targets are matched by comparing `dataset` values.
- [ ] `shareView/` never calls `clearEngFilters`, `resetEngFilters`, `navigateToAlertStory`, `handleAlertStoryClick` or `applyEngMode`.
- [ ] No CSS changes (sticky layering is untouched); `frontend/dist` changes only through `npm run build`.
- [ ] A collapsed card's group is never a capture target; a name-keyed group never emits an `alertTeam` (V20).
- [ ] The visible band starts at `T + SHARE_VIEW_FOCUS_MARGIN + 1`, not at the design's `T + 1`, and a header within the margin below its pin line counts as pinned; Task 8's round-trip tests pin that capturing right after a reveal returns the revealed target.

- [ ] **Step 0: Preflight**

```bash
git branch --show-current
git status --short
rg -c 'className="alert-team-group"' frontend/src/eng/EngAlertsPanel.jsx
ls frontend/src/shareView/viewDefaults.js frontend/src/eng/alertEpicNavigation.js frontend/src/eng/planningConfirmedEdit.js tests/css_source_helpers.js
```

Expected: the feature branch name (renamed per `docs/postmortem/MRT022-agent-branded-branch-names.md` if it is auto-generated), no status output, `11`, and the four paths listed. Read the "Alert-to-item navigation", "Alerts derivation" and "Planning Sprint review" entries of `docs/ontology.md` and confirm the paths they name still resolve.

- [ ] **Step 1: Write the failing test for the alert anchors**

Create `tests/share_view_alert_panel_fixture.js`:

```js
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Server-renders the REAL ENG alerts panel with one team group in each of its eleven group lists (the Postponed card has two: Stories and
// future-routed Epics). `ids` and `names` override a list's group id and display name by prop name, `moreGroups` appends groups with the given ids
// to a list (adjacent groups sit 0.6rem apart), `collapsed` names the categories whose card starts collapsed.
const DEFAULT_IDS = {
    missingAlertTeams: 't1', blockedAlertTeams: 't2', postponedAlertTeams: 't3', postponedEpicTeams: 't3', backlogEpicTeams: 't4', missingTeamEpicTeams: 't5',
    missingLabelEpicTeams: 't6', needsStoriesTeams: 't7', analysisEpicTeams: 't8', emptyEpicTeams: 't9', doneEpicTeams: 't10',
};
const COLLAPSIBLE = {
    missing: 'showMissingAlert', blocked: 'showBlockedAlert', followup: 'showPostponedAlert', backlog: 'showBacklogAlert', missingTeam: 'showMissingTeamAlert',
    missingLabels: 'showMissingLabelsAlert', needsStories: 'showNeedsStoriesAlert', waiting: 'showWaitingAlert', empty: 'showEmptyEpicAlert', done: 'showDoneEpicAlert',
};
const SETTERS = ['setShowBacklogAlert', 'setShowBlockedAlert', 'setShowDoneEpicAlert', 'setShowEmptyEpicAlert', 'setShowMissingAlert', 'setShowMissingLabelsAlert',
    'setShowMissingTeamAlert', 'setShowNeedsStoriesAlert', 'setShowPostponedAlert', 'setShowWaitingAlert', 'dismissAlertItem', 'dismissStoryRequirement',
    'handleAlertStoryClick', 'handleStoryRequirementClick'];

let panel;
function loadPanel() {
    if (!panel) {
        const entry = path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx');
        const code = esbuild.buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], loader: { '.jsx': 'jsx' } }).outputFiles[0].text;
        const loaded = { exports: {} };
        new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
        panel = loaded.exports.default;
    }
    return panel;
}

function renderAlertsPanel({ collapsed = [], ids = {}, names = {}, moreGroups = {} } = {}) {
    const id = { ...DEFAULT_IDS, ...ids };
    const epic = (key, teamId) => ({ key, summary: `Synthetic epic ${key}`, status: { name: 'To Do' }, cleanupStoryCount: 0, teamId, teamName: teamId });
    const story = key => ({ key, fields: { summary: `Synthetic story ${key}` } });
    const group = (listName, items) => ({ id: id[listName], name: names[listName] ?? `Team ${id[listName]}`, items });
    const groups = (listName, items) => [group(listName, items), ...(moreGroups[listName] || []).map(extra => ({ id: extra, name: `Team ${extra}`, items }))];
    const alertProps = {
        consolidatedMissingStories: [{ task: story('S-1'), missingFields: ['Story Points'] }],
        missingAlertTeams: groups('missingAlertTeams', [{ task: story('S-1'), missingFields: ['Story Points'] }]),
        blockedTasks: [story('S-2')], blockedAlertTeams: groups('blockedAlertTeams', [story('S-2')]),
        postponedTasks: [story('S-3')], postponedAlertTeams: groups('postponedAlertTeams', [story('S-3')]),
        futureRoutedEpics: [epic('E-3', id.postponedEpicTeams)], postponedEpicTeams: groups('postponedEpicTeams', [epic('E-3', id.postponedEpicTeams)]),
        backlogEpics: [epic('E-4', 'a')], backlogEpicTeams: groups('backlogEpicTeams', [epic('E-4', 'a')]),
        missingTeamEpics: [epic('E-5', 'a')], missingTeamEpicTeams: groups('missingTeamEpicTeams', [epic('E-5', 'a')]),
        missingLabelEpics: [epic('E-6', 'a')], missingLabelEpicTeams: groups('missingLabelEpicTeams', [epic('E-6', 'a')]),
        needsStoriesEntries: [{ id: 'n1' }], needsStoriesEpics: [epic('E-7', 'a')], needsStoriesTeams: groups('needsStoriesTeams', [{ id: 'n1', epic: epic('E-7', 'a'), reason: 'none' }]),
        waitingForStoriesEpics: [epic('E-8', 'a')], analysisEpicTeams: groups('analysisEpicTeams', [epic('E-8', 'a')]),
        emptyEpics: [epic('E-9', 'a')], emptyEpicsForAlert: [epic('E-9', 'a')], emptyEpicTeams: groups('emptyEpicTeams', [epic('E-9', 'a')]),
        doneStoryEpics: [epic('E-10', 'a')], doneEpicTeams: groups('doneEpicTeams', [epic('E-10', 'a')]),
        buildKeyListLink: () => '#', buildTeamStatusLink: () => '#', getBlockedAlertStatusLabel: () => '', getFuturePlanningNeedsStoriesReasonText: () => '',
        isFutureSprintSelected: false, storyReadinessSprintState: 'active', jiraUrl: 'https://jira.example.test',
    };
    for (const name of SETTERS) alertProps[name] = () => {};
    for (const [category, flag] of Object.entries(COLLAPSIBLE)) alertProps[flag] = !collapsed.includes(category);
    return renderToStaticMarkup(React.createElement(loadPanel(), {
        selectedView: 'eng', alertItemCount: 11, alertCounts: {}, showAlertsPanel: true, setShowAlertsPanel: () => {}, collapsed: false, alertProps,
    }));
}

module.exports = { renderAlertsPanel };
```

Create `tests/test_share_view_alert_anchors.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderAlertsPanel } = require('./share_view_alert_panel_fixture.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'eng', 'EngAlertsPanel.jsx'), 'utf8');

test('source: every alert team group carries data-alert-team, and only the future-routed Epic groups carry data-alert-kind', () => {
    const tags = source.match(/<div\b[^>]*className="alert-team-group"[^>]*>/g) || [];
    assert.equal(tags.length, 11);
    for (const tag of tags) assert.match(tag, /data-alert-team=\{group\.id\}/);
    const epicTags = tags.filter(tag => tag.includes('data-alert-kind'));
    assert.equal(epicTags.length, 1);
    assert.match(epicTags[0], /key=\{`future-epic-\$\{group\.id\}`\}/);
    assert.match(epicTags[0], /data-alert-kind="epic"/);
});

test('rendered: each card holds its groups by Team id, Epic groups say so, and a hostile id stays inside its attribute', () => {
    const hostile = 'x"] .alert-card [a="';
    const html = renderAlertsPanel({ ids: { emptyEpicTeams: hostile } });
    const cards = html.split(/(?=<div class="alert-card )/).slice(1);
    const groupsByCard = Object.fromEntries(cards.map((card) => {
        const cardId = card.match(/ id="(eng-alert-[a-z-]+)"/)[1];
        const groups = Array.from(card.matchAll(/<div class="alert-team-group"((?: data-[a-z-]+="[^"]*")*)>/g), (match) => ({
            team: match[1].match(/data-alert-team="([^"]*)"/)?.[1].replaceAll('&quot;', '"'),
            kind: match[1].match(/data-alert-kind="([^"]*)"/)?.[1],
        }));
        return [cardId, groups];
    }));
    assert.deepEqual(groupsByCard, {
        'eng-alert-missing': [{ team: 't1', kind: undefined }],
        'eng-alert-blocked': [{ team: 't2', kind: undefined }],
        'eng-alert-followup': [{ team: 't3', kind: undefined }, { team: 't3', kind: 'epic' }],
        'eng-alert-backlog': [{ team: 't4', kind: undefined }],
        'eng-alert-missing-team': [{ team: 't5', kind: undefined }],
        'eng-alert-missing-labels': [{ team: 't6', kind: undefined }],
        'eng-alert-needs-stories': [{ team: 't7', kind: undefined }],
        'eng-alert-waiting': [{ team: 't8', kind: undefined }],
        'eng-alert-empty': [{ team: hostile, kind: undefined }],
        'eng-alert-done': [{ team: 't10', kind: undefined }],
    });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
fnm exec --using 20 node --test tests/test_share_view_alert_anchors.js
```

Expected: `# tests 2`, `# pass 0`, `# fail 2`. The first test reports `actual: '<div key={group.id} className="alert-team-group">'` against `expected: /data-alert-team=\{group\.id\}/`; the second reports a `deepEqual` mismatch whose actual groups have no `team`.

- [ ] **Step 3: Add the attributes to all eleven groups**

Edit `frontend/src/eng/EngAlertsPanel.jsx`. Each block below is unique in the file at HEAD (verified: the six `<div key={group.id} ...>` sites are made unique by their `.map(group => {` line, the other five by their key template). Indentation is spaces, exactly as shown.

**Site 1: Missing info card (`missingAlertTeams`)** (HEAD line 214).

Replace this:

```jsx
                                                    {missingAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.task.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
```

With:

```jsx
                                                    {missingAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.task.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
```

**Site 2: Blocked card (`blockedAlertTeams`)** (HEAD line 323).

Replace this:

```jsx
                                                    {blockedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
```

With:

```jsx
                                                    {blockedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
```

**Site 3: Postponed card, Story groups (`postponedAlertTeams`)** (HEAD line 422).

Replace this:

```jsx
                                                    {postponedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
```

With:

```jsx
                                                    {postponedAlertTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys, { addSprint: true });
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
```

**Site 4: Postponed card, future-routed Epic groups (`postponedEpicTeams`), the only site that also gets `data-alert-kind="epic"`** (HEAD line 500).

Replace this:

```jsx
                                                            {postponedEpicTeams.map(group => (
                                                                <div key={`future-epic-${group.id}`} className="alert-team-group">
```

With:

```jsx
                                                            {postponedEpicTeams.map(group => (
                                                                <div key={`future-epic-${group.id}`} className="alert-team-group" data-alert-team={group.id} data-alert-kind="epic">
```

**Site 5: Backlog card (`backlogEpicTeams`)** (HEAD line 597).

Replace this:

```jsx
                                                            <div key={`backlog-${group.id}`} className="alert-team-group">
```

With:

```jsx
                                                            <div key={`backlog-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
```

**Site 6: Missing team card (`missingTeamEpicTeams`)** (HEAD line 654).

Replace this:

```jsx
                                                            <div key={`missing-team-${group.id}`} className="alert-team-group">
```

With:

```jsx
                                                            <div key={`missing-team-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
```

**Site 7: Missing labels card (`missingLabelEpicTeams`)** (HEAD line 706).

Replace this:

```jsx
                                                            <div key={`missing-labels-${group.id}`} className="alert-team-group">
```

With:

```jsx
                                                            <div key={`missing-labels-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
```

**Site 8: Stories required card (`needsStoriesTeams`)** (HEAD line 757).

Replace this:

```jsx
                                                            <div key={`needs-stories-${group.id}`} className="alert-team-group">
```

With:

```jsx
                                                            <div key={`needs-stories-${group.id}`} className="alert-team-group" data-alert-team={group.id}>
```

**Site 9: Waiting card (`analysisEpicTeams`)** (HEAD line 819).

Replace this:

```jsx
                                                    {analysisEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
```

With:

```jsx
                                                    {analysisEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
```

**Site 10: Empty epic card (`emptyEpicTeams`)** (HEAD line 932).

Replace this:

```jsx
                                                    {emptyEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
```

With:

```jsx
                                                    {emptyEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
```

**Site 11: Ready to close card (`doneEpicTeams`)** (HEAD line 1046).

Replace this:

```jsx
                                                    {doneEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group">
```

With:

```jsx
                                                    {doneEpicTeams.map(group => {
                                                        const keys = group.items.map(item => item.key);
                                                        const teamLink = buildKeyListLink(keys);
                                                        return (
                                                            <div key={group.id} className="alert-team-group" data-alert-team={group.id}>
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
fnm exec --using 20 node --test tests/test_share_view_alert_anchors.js
git diff --stat -- frontend/src/eng/EngAlertsPanel.jsx
```

Expected: `# tests 2`, `# pass 2`, `# fail 0`; the diff reports `1 file changed, 11 insertions(+), 11 deletions(-)`.

- [ ] **Step 5: Write the failing tests for the capture**

Create `tests/share_view_fake_dom.js`:

```js
// A minimal DOM stand-in for the Share view focus tests (the repo has no jsdom). The modules under test pass their REAL selector strings to it:
// it evaluates compound selectors of tag, .class, [attr], [attr=value] and :not(.class), joined by descendant combinators, and the selector
// results were compared with Chromium's while it was written. Layout is one document-space box per element; a sticky element's viewport top is
// clamped to its sticky offset and to the bottom of its parent, and a collapsed alert body keeps its children's boxes exactly as the real one
// does (max-height 0 with overflow hidden does not remove a child's rect).

// data-epic-key <-> dataset.epicKey
const datasetKey = name => name.replace(/^data-/, '').replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

function parseCompound(text) {
    const compound = { tag: null, classes: [], notClasses: [], attributes: [] };
    const token = /([a-z][a-z0-9]*)|\.([A-Za-z0-9_-]+)|\[([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]|:not\(\.([A-Za-z0-9_-]+)\)/y;
    for (let index = 0; index < text.length; index = token.lastIndex) {
        token.lastIndex = index;
        const match = token.exec(text);
        if (!match) throw new Error(`Unsupported selector in the DOM stand-in: ${text}`);
        if (match[1]) compound.tag = match[1];
        else if (match[2]) compound.classes.push(match[2]);
        else if (match[3]) compound.attributes.push([datasetKey(match[3]), match[4] ?? match[5]]);
        else compound.notClasses.push(match[6]);
    }
    return compound;
}

function matchesCompound(element, compound) {
    if (compound.tag && element.tagName.toLowerCase() !== compound.tag) return false;
    if (!compound.classes.every(name => element.classList.contains(name))) return false;
    if (compound.notClasses.some(name => element.classList.contains(name))) return false;
    return compound.attributes.every(([name, value]) => (value === undefined ? element.dataset[name] !== undefined : element.dataset[name] === value));
}

function matchesChain(element, chain) {
    if (!matchesCompound(element, chain[chain.length - 1])) return false;
    let index = chain.length - 2;
    for (let ancestor = element.parentElement; ancestor && index >= 0; ancestor = ancestor.parentElement) {
        if (matchesCompound(ancestor, chain[index])) index -= 1;
    }
    return index < 0;
}

const parseSelector = selector => selector.split(',').map(part => part.trim().split(/\s+/).map(parseCompound));

export function createFakeDom({ innerHeight = 800 } = {}) {
    const state = { scrollY: 0, now: 0, nextId: 1, frames: new Map(), timers: new Map() };
    const listeners = new Map();   // `${target}:${name}` -> [{ handler, capture }]
    const listenerApi = target => ({
        addEventListener(name, handler, options) {
            const key = `${target}:${name}`;
            listeners.set(key, [...(listeners.get(key) || []), { handler, capture: options === true || options?.capture === true }]);
        },
        removeEventListener(name, handler, options) {
            const key = `${target}:${name}`;
            const capture = options === true || options?.capture === true;
            listeners.set(key, (listeners.get(key) || []).filter(entry => entry.handler !== handler || entry.capture !== capture));
        },
    });

    class FakeElement {
        constructor(tag, { className = '', id = '', dataset = {}, box = { top: 0, height: 0 }, sticky = null, text = '' } = {}, children = []) {
            this.tagName = tag.toUpperCase();
            this.id = id;
            this.dataset = { ...dataset };
            this.box = { ...box };
            this.sticky = sticky;
            this.textContent = text;
            this.children = [];
            this.parentElement = null;
            this.isConnected = true;
            this.offsetWidth = 0;
            const names = new Set(className.split(/\s+/).filter(Boolean));
            this.classList = { contains: name => names.has(name), add: name => names.add(name), remove: name => names.delete(name) };
            for (const child of children) this.append(child);
        }
        append(child) { child.parentElement = this; this.children.push(child); return child; }
        descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
        getBoundingClientRect() {
            let top = this.sticky ? Math.max(this.box.top - state.scrollY, this.sticky.top) : this.box.top - state.scrollY;
            // A sticky box stays inside its parent: the end of an Epic pushes its pinned header up.
            const parent = this.parentElement;
            if (this.sticky && parent?.box.height > 0) top = Math.min(top, parent.box.top + parent.box.height - state.scrollY - this.box.height);
            return { top, bottom: top + this.box.height, height: this.box.height };
        }
        closest(selector) {
            const chains = parseSelector(selector);
            for (let node = this; node; node = node.parentElement) if (chains.some(chain => matchesCompound(node, chain[0]))) return node;
            return null;
        }
        querySelectorAll(selector) {
            const chains = parseSelector(selector);
            return this.descendants().filter(node => chains.some(chain => matchesChain(node, chain)));
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        // Moving focus or scrolling an element into view is exactly what a link reveal must never do.
        focus() { throw new Error('focus() must not be called'); }
        scrollIntoView() { throw new Error('scrollIntoView() must not be called'); }
    }

    const document = new FakeElement('html');
    Object.assign(document, { visibilityState: 'visible' }, listenerApi('document'));
    const win = {
        innerHeight,
        get scrollY() { return state.scrollY; },
        scrollCalls: [],
        scrollTo(options) {
            this.scrollCalls.push(options);
            state.scrollY = Math.max(0, options.top);
        },
        getComputedStyle: element => ({ position: element.sticky ? 'sticky' : 'static', top: element.sticky ? `${element.sticky.top}px` : 'auto' }),
        requestAnimationFrame(callback) { const id = state.nextId++; state.frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { state.frames.delete(id); },
        setTimeout(callback, delay) { const id = state.nextId++; state.timers.set(id, { callback, at: state.now + delay }); return id; },
        clearTimeout(id) { state.timers.delete(id); },
    };

    return {
        document, window: win,
        el: (tag, options, children) => new FakeElement(tag, options, children),
        append: (parent, ...nodes) => nodes.forEach(node => parent.append(node)),
        // One animation frame: due timers fire, then every queued rAF callback runs with the frame time.
        step(ms = 16) {
            state.now += ms;
            for (const [id, timer] of [...state.timers]) if (timer.at <= state.now) { state.timers.delete(id); timer.callback(); }
            const frames = [...state.frames];
            state.frames.clear();
            frames.forEach(([, callback]) => callback(state.now));
        },
        stepMs(total) { for (let elapsed = 0; elapsed < total; elapsed += 16) this.step(16); },
        // Time passes without a frame, as in a hidden tab where the browser stops running rAF callbacks.
        advanceClock(ms) { state.now += ms; },
        pendingFrames: () => state.frames.size,
        dispatch(target, event) { for (const entry of [...(listeners.get(`${target}:${event.type}`) || [])]) entry.handler(event); },
        listenerCount: () => [...listeners.values()].reduce((sum, entries) => sum + entries.length, 0),
        setScrollY(value) { state.scrollY = value; },
        // Installs the stand-ins as the globals measureStickyBottom and blinkElement read, and returns the restore function.
        install() {
            const previous = { document: globalThis.document, window: globalThis.window };
            globalThis.document = document;
            globalThis.window = win;
            return () => { globalThis.document = previous.document; globalThis.window = previous.window; };
        },
    };
}
```

Create `tests/test_share_view_focus_capture.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

import { alertCardId, captureShareViewFocus, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN } from '../frontend/src/shareView/focusCapture.js';
import { createFakeDom } from './share_view_fake_dom.js';

const SOURCE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src');

// Viewport 800 high. The sticky filter bar covers 0..50, so T is 50 and a node is visible when its bottom is below 50 + the landing margin + 1.
function page() {
    const dom = createFakeDom({ innerHeight: 800 });
    const restore = dom.install();
    const { el } = dom;
    const filterBar = el('div', { className: 'filterbar-wrap', sticky: { top: 0 }, box: { top: 0, height: 50 } });
    const group = (id, name, top, { kind, height = 100 } = {}) => el('div', {
        className: 'alert-team-group', dataset: { alertTeam: id, ...(kind ? { alertKind: kind } : {}) }, box: { top, height },
    }, [el('div', { className: 'alert-team-header', box: { top, height: 30 } }, [el('span', { className: 'alert-pill team', text: name })])]);
    // A collapsed body keeps its children's layout boxes, so their rects stay on screen.
    const card = (id, { expanded = true, bodyExpanded = expanded, top = 60, groups = [] } = {}) => el('div', {
        className: `alert-card following ${expanded ? '' : 'collapsed'}`, id, box: { top, height: 300 },
    }, [el('div', { className: 'alert-card-header', box: { top, height: 40 } }), el('div', { className: `alert-card-body ${bodyExpanded ? '' : 'collapsed'}`, box: { top: top + 40, height: 260 } }, groups)]);
    const header = top => el('div', { className: 'epic-header', sticky: { top: 50 }, box: { top: top + 10, height: 40 } });
    const story = (key, top) => el('div', { className: 'task-item', dataset: { taskKey: key, issueKey: key }, box: { top, height: 70 } });
    const requirement = (id, epicKey, top) => el('a', { className: 'story-requirement-card', dataset: { storyRequirementId: id, epicKey }, box: { top, height: 40 } });
    const epicBlock = (key, top, height, children = []) => el('div', { className: 'epic-block', dataset: { epicKey: key }, box: { top, height } }, [header(top), ...children]);
    const row = (id, kind, key, top, { synthetic = false } = {}) => el('tr', {
        dataset: { planningRowKey: id, rowKind: kind, ...(synthetic ? {} : { issueKey: key }) }, box: { top, height: 30 },
    });
    const mount = (...nodes) => { dom.append(dom.document, filterBar, ...nodes); return dom; };
    return { dom, restore, group, card, epicBlock, story, requirement, row, mount, el };
}
const capture = (dom, options) => captureShareViewFocus({ root: dom.document, win: dom.window, ...options });

test('catch up: the first visible group in an expanded card is the target, and it is named by card and Team', () => {
    const p = page();
    try {
        p.mount(p.el('div', { className: 'alert-panels' }, [
            p.card('eng-alert-blocked', { groups: [p.group('t1', 'Team One', 100), p.group('t2', 'Team Two', 220)] }),
            p.card('eng-alert-done', { top: 400, groups: [p.group('t1', 'Team One', 440)] }),
        ]), p.epicBlock('PROJ-1', 700, 400));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 't1' });
        p.dom.setScrollY(150);   // Team One has scrolled under the filter bar (its bottom is above 51)
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 't2' });
    } finally { p.restore(); }
});

test('visible means the bottom is more than the landing margin plus 1 below T and the top is above the viewport bottom', () => {
    assert.equal(SHARE_VIEW_FOCUS_MARGIN, 12);
    // A 100 high group with T at 50: its bottom must pass 63, so the sliver a reveal leaves above its target is not visible; its top must be above 800.
    const boundary = 50 + SHARE_VIEW_FOCUS_MARGIN + 1 - 100;
    for (const [top, visible] of [[boundary, false], [boundary + 1, true], [799, true], [800, false]]) {
        const p = page();
        try {
            p.mount(p.card('eng-alert-blocked', { groups: [p.group('t1', 'Team One', top)] }));
            assert.equal(capture(p.dom, { mode: 'catch-up' }) !== null, visible, `group top ${top}`);
        } finally { p.restore(); }
    }
});

test('V20: a group inside a collapsed card or body is never visible, even though its box is on screen', () => {
    const p = page();
    try {
        p.mount(p.el('div', { className: 'alert-panels' }, [
            p.card('eng-alert-missing', { expanded: false, top: 60, groups: [p.group('hidden-card', 'Hidden Card', 100)] }),
            p.card('eng-alert-waiting', { bodyExpanded: false, top: 60, groups: [p.group('hidden-body', 'Hidden Body', 110)] }),
            p.card('eng-alert-blocked', { top: 60, groups: [p.group('t2', 'Team Two', 120)] }),
        ]));
        const collapsed = p.dom.document.querySelectorAll('.alert-team-group').find(node => node.dataset.alertTeam === 'hidden-card');
        assert.ok(collapsed.getBoundingClientRect().top > 51, 'the collapsed group still has an on-screen box');
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 't2' });
    } finally { p.restore(); }
});

test('V20: followup story groups and future-routed Epic groups resolve to different anchors', () => {
    const epics = page();
    try {
        epics.mount(epics.card('eng-alert-followup', { groups: [epics.group('t1', 'Team One', 100, { kind: 'epic' })] }));
        assert.deepEqual(capture(epics.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'followupEpics', id: 't1' });
    } finally { epics.restore(); }
    const stories = page();
    try {
        stories.mount(stories.card('eng-alert-followup', { groups: [stories.group('t1', 'Team One', 100)] }));
        assert.deepEqual(capture(stories.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'followup', id: 't1' });
    } finally { stories.restore(); }
});

test('V20: a name-keyed group emits no alertTeam; the two placeholders and real ids still do', () => {
    const named = page();
    try {
        named.mount(named.card('eng-alert-blocked', { groups: [named.group('Orbit', 'Orbit', 100)] }), named.epicBlock('PROJ-1', 420, 300));
        // No fall-through to the Epic below: the reader is on the alerts.
        assert.equal(capture(named.dom, { mode: 'catch-up' }), null);
    } finally { named.restore(); }
    for (const [id, name] of [['unknown', 'Unknown Team'], ['Unknown Team', 'Unknown Team'], ['team-9', 'Orbit']]) {
        const p = page();
        try {
            p.mount(p.card('eng-alert-empty', { groups: [p.group(id, name, 100)] }));
            assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'empty', id });
        } finally { p.restore(); }
    }
});

test('catch up: every alert card id maps to its category key, and an unknown card yields no focus', () => {
    const keys = ['missing', 'blocked', 'followup', 'backlog', 'missingTeam', 'missingLabels', 'needsStories', 'waiting', 'empty', 'done'];
    for (const key of keys) {
        const p = page();
        try {
            p.mount(p.card(alertCardId(key), { groups: [p.group('t1', 'Team One', 100)] }));
            assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: key, id: 't1' });
        } finally { p.restore(); }
    }
    assert.equal(alertCardId('followupEpics'), 'eng-alert-followup');
    assert.equal(alertCardId('__proto__'), undefined);
    const stray = page();
    try {
        stray.mount(stray.card('eng-alert-unexpected', { groups: [stray.group('t1', 'Team One', 100)] }));
        assert.equal(capture(stray.dom, { mode: 'catch-up' }), null);
    } finally { stray.restore(); }
});

test('catch up Epics: an Epic whose header is in its natural position is the epic target', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('PROJ-1', 120, 400, [p.story('PROJ-11', 180), p.story('PROJ-12', 260)]));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-1' });
    } finally { p.restore(); }
});

test('catch up Epics: a pinned header names the first visible Story; a requirement card or no visible card names the Epic', () => {
    const pinned = page();
    try {
        pinned.mount(pinned.epicBlock('PROJ-1', 0, 600, [pinned.story('PROJ-11', 70), pinned.story('PROJ-12', 150), pinned.story('PROJ-13', 230)]));
        pinned.dom.setScrollY(150);   // the header is pinned at 50..90 (T = 90); PROJ-11 is above the band and PROJ-12 (0..70) is hidden under the header
        assert.deepEqual(capture(pinned.dom, { mode: 'catch-up' }), { kind: 'story', key: 'PROJ-13' });
    } finally { pinned.restore(); }
    const requirement = page();
    try {
        requirement.mount(requirement.epicBlock('PROJ-2', 0, 600, [requirement.requirement('req-1', 'PROJ-2', 140), requirement.story('PROJ-21', 190)]));
        requirement.dom.setScrollY(60);   // pinned header (T = 90, so a node must reach below 103); the requirement card (80..120) is the first visible child, so the Epic is the target
        assert.deepEqual(capture(requirement.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-2' });
    } finally { requirement.restore(); }
    const bare = page();
    try {
        bare.mount(bare.epicBlock('PROJ-4', 0, 300));
        bare.dom.setScrollY(60);
        assert.deepEqual(capture(bare.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-4' });
    } finally { bare.restore(); }
});

test('catch up Epics: a header within the landing margin below its pin line counts as pinned, one further down does not', () => {
    // The header sits 10 below its block's top and pins at 50: a block top of 44 puts it 4 below the pin line (inside the margin), 62 puts it 22 below.
    for (const [blockTop, expected] of [[44, { kind: 'story', key: 'PROJ-11' }], [62, { kind: 'epic', key: 'PROJ-1' }]]) {
        const p = page();
        try {
            p.mount(p.epicBlock('PROJ-1', blockTop, 600, [p.story('PROJ-11', blockTop + 70)]));
            assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), expected, `block top ${blockTop}`);
        } finally { p.restore(); }
    }
});

test('catch up Epics: the Epic-less bucket never becomes an epic target', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('NO_EPIC', 120, 300, [p.story('PROJ-31', 180)]), p.epicBlock('PROJ-5', 460, 300));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'story', key: 'PROJ-31' });
        p.dom.setScrollY(200);   // PROJ-31 has scrolled above the band; NO_EPIC has no visible card, so the next Epic is the target
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'epic', key: 'PROJ-5' });
    } finally { p.restore(); }
});

test('Board and Statistics carry no focus, and nothing visible means no focus', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('PROJ-1', 120, 400));
        for (const mode of ['board', 'statistics', undefined]) assert.equal(capture(p.dom, { mode }), null);
        p.dom.setScrollY(2000);
        assert.equal(capture(p.dom, { mode: 'catch-up' }), null);
    } finally { p.restore(); }
});

test('planning table: the first visible real row names the target from its issue key, never from the numeric row key', () => {
    const epics = page();
    try {
        epics.mount(epics.el('table', {}, [
            epics.row('9001', 'epic', 'PROJ-1', 70),
            epics.row('placeholder', 'epic', '', 110, { synthetic: true }),
            epics.row('9002', 'epic', 'PROJ-2', 150),
        ]));
        assert.deepEqual(capture(epics.dom, { mode: 'planning' }), { kind: 'epic', key: 'PROJ-1' });
        epics.dom.setScrollY(60);   // PROJ-1 (10..40) is under the filter bar; the synthetic row is skipped
        assert.deepEqual(capture(epics.dom, { mode: 'planning' }), { kind: 'epic', key: 'PROJ-2' });
        assert.equal(readPlanningRowsMode(epics.dom.document), 'epic');
    } finally { epics.restore(); }
    const stories = page();
    try {
        stories.mount(stories.el('table', {}, [stories.row('7001', 'story', 'PROJ-11', 70), stories.row('awaiting', 'requirement', '', 110, { synthetic: true })]));
        assert.deepEqual(capture(stories.dom, { mode: 'planning' }), { kind: 'story', key: 'PROJ-11' });
        assert.deepEqual(capture(stories.dom, { mode: 'planning', rowsMode: 'story' }), { kind: 'story', key: 'PROJ-11' });
        assert.equal(capture(stories.dom, { mode: 'planning', rowsMode: 'epic' }), null, 'a rows mode that does not match the table names nothing');
        assert.equal(readPlanningRowsMode(stories.dom.document), 'story');
    } finally { stories.restore(); }
});

test('planning list layout uses the Epic and Story blocks; an empty table has no rows mode', () => {
    const p = page();
    try {
        p.mount(p.epicBlock('PROJ-1', 120, 400, [p.story('PROJ-11', 180)]));
        assert.deepEqual(capture(p.dom, { mode: 'planning' }), { kind: 'epic', key: 'PROJ-1' });
        assert.equal(readPlanningRowsMode(p.dom.document), null);
    } finally { p.restore(); }
});

test('hostile attribute values are compared as data and never reach a selector', () => {
    const p = page();
    try {
        p.mount(p.card('eng-alert-blocked', { groups: [p.group('x"]', 'Team', 100)] }));
        assert.deepEqual(capture(p.dom, { mode: 'catch-up' }), { kind: 'alertTeam', anchor: 'blocked', id: 'x"]' });
    } finally { p.restore(); }
});

test('V4: the capture never clears filters, opens Jira, navigates, moves focus or builds a selector from a value', () => {
    const source = fs.readFileSync(path.join(SOURCE_ROOT, 'shareView', 'focusCapture.js'), 'utf8');
    for (const forbidden of ['clearEngFilters', 'resetEngFilters', 'navigateToAlertStory', 'handleAlertStoryClick', 'applyEngMode', 'window.open', 'location', 'scrollIntoView', '.focus(']) {
        assert.equal(source.includes(forbidden), false, `focusCapture.js must not contain ${forbidden}`);
    }
    assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\(\s*`/, 'focusCapture.js builds no template-literal selector');
    assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\([^)]*\+/, 'focusCapture.js concatenates no selector');
});

test('the card id table matches ALERT_SUMMARY_CONFIG, the card ids in the panel and the codec alert vocabulary', () => {
    const alertsSource = fs.readFileSync(path.join(SOURCE_ROOT, 'eng', 'EngAlertsPanel.jsx'), 'utf8');
    const config = Array.from(alertsSource.matchAll(/\{ key: '(\w+)', label: '[^']*', tone: '\w+', sectionId: '(eng-alert-[a-z-]+)' \}/g), match => [match[1], match[2]]);
    assert.equal(config.length, 10);
    for (const [key, sectionId] of config) assert.equal(alertCardId(key), sectionId);
    const cardIds = Array.from(alertsSource.matchAll(/ id="(eng-alert-[a-z-]+)" tabIndex=\{-1\}/g), match => match[1]).sort();
    assert.deepEqual(cardIds, config.map(([, sectionId]) => sectionId).sort());
    const code = esbuild.buildSync({ entryPoints: [path.join(SOURCE_ROOT, 'shareView', 'viewDefaults.js')], bundle: true, write: false, format: 'cjs', platform: 'browser' }).outputFiles[0].text;
    const defaults = { exports: {} };
    new Function('module', 'exports', code)(defaults, defaults.exports);
    assert.deepEqual([...defaults.exports.SHARE_VIEW_ALERT_KEYS].sort(), config.map(([key]) => key).sort());
    assert.deepEqual([...defaults.exports.SHARE_VIEW_ALERT_ANCHORS].sort(), [...config.map(([key]) => key), 'followupEpics'].sort());
});
```

Create `tests/ui/share_view_focus.spec.js` (it renders the real alerts panel through the fixture above, uses the committed `frontend/dist/dashboard.css`, and needs no Flask):

```js
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { renderAlertsPanel } = require('../share_view_alert_panel_fixture.js');

// The Share view focus modules against real CSS: the committed dashboard stylesheet, the REAL server-rendered alerts panel, and hand-written
// Epic, Story and Planning row markup that uses the production class and attribute names (the pill_hover.spec.js approach, no Flask).
const css = fs.readFileSync(path.join(__dirname, '../../frontend/dist/dashboard.css'), 'utf8');
const MODULES_ENTRY = "import { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN } from './shareView/focusCapture.js'; window.__share = { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN };";
const modules = esbuild.buildSync({
    stdin: { contents: MODULES_ENTRY, resolveDir: path.join(__dirname, '../../frontend/src'), loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
}).outputFiles[0].text;

const storyCard = key => `<div class="task-item priority-major" data-task-key="${key}" data-issue-key="${key}"><div class="task-header"><span class="task-title">${key}</span></div></div>`;
const epicBlock = (key, storyKeys) => `<div class="epic-block" data-epic-key="${key}">
    <div class="epic-header"><div class="epic-title"><div class="epic-title-row"><span class="epic-name">Synthetic ${key}</span><span class="epic-key">${key}</span></div></div><div class="epic-meta"><span class="epic-story-points">SP: 8.0</span></div></div>
    ${storyKeys.map(storyCard).join('')}</div>`;
const epics = Array.from({ length: 8 }, (_, index) => epicBlock(`PROJ-${index + 1}`, [1, 2, 3, 4].map(story => `PROJ-${index + 1}${story}`))).join('');

// The main header scrolls away; with `compact` the sticky compact header is up and pushes the filter bar and Epic headers down by its height.
function catchUpHtml({ compact = false, collapsed = [], ids = {}, names = {}, moreGroups = {} } = {}) {
    const offset = compact ? 60 : 0;
    return `<style>${css}</style>
    <div class="container" style="--compact-header-offset:${offset}px;--filterbar-sticky-top:${offset}px;--epic-sticky-top:${offset + 56}px">
        <header style="height:${compact ? 0 : 160}px"></header>
        ${compact ? '<div class="compact-sticky-header is-visible" style="position:sticky;top:0;height:60px;z-index:80"></div>' : ''}
        <div class="filterbar-wrap"><div class="filterbar"></div></div>
        ${renderAlertsPanel({ collapsed, ids, names, moreGroups })}
        <div class="task-list">${epics}</div>
        <div style="height:1500px"></div>
    </div>`;
}
function planningHtml(rowKind) {
    const rows = Array.from({ length: 80 }, (_, index) => `<tr data-planning-row-key="${9000 + index}" data-row-kind="${rowKind}" data-review-row="${rowKind}:${9000 + index}" data-issue-key="PROJ-${index + 1}"><td class="planning-review-selection"></td><td class="planning-review-key">PROJ-${index + 1}</td><td class="planning-review-summary">Synthetic</td></tr>`).join('');
    return `<style>${css}</style>
    <div class="container" style="--compact-header-offset:0px">
        <header style="height:120px"></header>
        <div class="planning-review-sticky-stack"><div class="filterbar-wrap"><div class="filterbar"></div></div></div>
        <section class="planning-review-region"><div class="planning-review-scroll"><table class="planning-review-table"><thead><tr><th></th><th>Key</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    </div>`;
}

async function load(page, html) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setContent(html);
    await page.addScriptTag({ content: modules });
    // Let the card entrance animation finish: it moves boxes by a few pixels.
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState === 'finished'));
}
// Scrolls until the element's top (or bottom) edge sits `gap` px below the sticky stack (measured without Epic headers). The filter bar only
// sticks once the page has scrolled, so the stack is measured again after each jump.
async function scrollBelowStack(page, selector, gap, edge = 'top') {
    for (let pass = 0; pass < 3; pass += 1) {
        await page.evaluate(({ selector, gap, edge }) => {
            const position = document.querySelector(selector).getBoundingClientRect()[edge];
            window.scrollTo({ top: Math.max(0, window.scrollY + position - window.__share.measureShareViewStickyBottom({ epicHeaders: false }) - gap), behavior: 'instant' });
        }, { selector, gap, edge });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
}
const capture = (page, mode, rowsMode) => page.evaluate(({ mode, rowsMode }) => window.__share.captureShareViewFocus({ mode, rowsMode }), { mode, rowsMode });

for (const compact of [false, true]) {
    test.describe(`capture, ${compact ? 'compact header up' : 'main header'}`, () => {
        test('V20: a collapsed card keeps an on-screen group box but is never the target', async ({ page }) => {
            await load(page, catchUpHtml({ compact, collapsed: ['missing'] }));
            const group = await page.evaluate(() => {
                const rect = document.querySelector('#eng-alert-missing .alert-team-group').getBoundingClientRect();
                return { top: rect.top, bottom: rect.bottom, stackBottom: window.__share.measureShareViewStickyBottom(), margin: window.__share.SHARE_VIEW_FOCUS_MARGIN, viewport: window.innerHeight };
            });
            expect(group.bottom).toBeGreaterThan(group.stackBottom + group.margin + 1);
            expect(group.top).toBeLessThan(group.viewport);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'blocked', id: 't2' });
        });

        test('V20: followup Story groups and future-routed Epic groups name different anchors; a name-keyed group names no Team', async ({ page }) => {
            await load(page, catchUpHtml({ compact, ids: { emptyEpicTeams: 'Orbit' }, names: { emptyEpicTeams: 'Orbit' } }));
            await scrollBelowStack(page, '#eng-alert-followup .alert-team-group:not([data-alert-kind])', 6);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'followup', id: 't3' });
            await scrollBelowStack(page, '#eng-alert-followup .alert-team-group[data-alert-kind="epic"]', 6);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'followupEpics', id: 't3' });
            await scrollBelowStack(page, '#eng-alert-empty .alert-team-group', 6);
            expect(await capture(page, 'catch-up')).toBeNull();
        });

        test('a group showing only the landing margin below the stack is not named; two pixels more and it is', async ({ page }) => {
            await load(page, catchUpHtml({ compact, moreGroups: { blockedAlertTeams: ['t2b'] } }));
            const margin = await page.evaluate(() => window.__share.SHARE_VIEW_FOCUS_MARGIN);
            await scrollBelowStack(page, '#eng-alert-blocked .alert-team-group[data-alert-team="t2"]', margin, 'bottom');
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'blocked', id: 't2b' });
            await scrollBelowStack(page, '#eng-alert-blocked .alert-team-group[data-alert-team="t2"]', margin + 2, 'bottom');
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'alertTeam', anchor: 'blocked', id: 't2' });
        });

        test('an Epic whose header is in its natural position is the epic target; a pinned header names the first visible Story', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            await scrollBelowStack(page, '.epic-block[data-epic-key="PROJ-3"]', 10);
            expect(await capture(page, 'catch-up')).toEqual({ kind: 'epic', key: 'PROJ-3' });
            await scrollBelowStack(page, '.epic-block[data-epic-key="PROJ-3"]', -120);
            const pinned = await capture(page, 'catch-up');
            expect(pinned).toMatchObject({ kind: 'story' });
            expect(pinned.key).toMatch(/^PROJ-3[1-4]$/);
        });
    });
}

test('planning table: the first visible row is named by its issue key and the table names its rows mode', async ({ page }) => {
    for (const rowKind of ['epic', 'story']) {
        await load(page, planningHtml(rowKind));
        await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
        const captured = await capture(page, 'planning');
        expect(captured).toMatchObject({ kind: rowKind });
        expect(captured.key).toMatch(/^PROJ-\d+$/);
        expect(await page.evaluate(() => window.__share.readPlanningRowsMode())).toBe(rowKind);
        const row = await page.evaluate(key => { const rect = [...document.querySelectorAll('tr')].find(node => node.dataset.issueKey === key).getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, stackBottom: window.__share.measureShareViewStickyBottom(), margin: window.__share.SHARE_VIEW_FOCUS_MARGIN }; }, captured.key);
        expect(row.bottom).toBeGreaterThan(row.stackBottom + row.margin + 1);
        expect(row.top).toBeLessThan(800);
    }
});
```

- [ ] **Step 6: Run them and confirm they fail**

```bash
fnm exec --using 20 node --test tests/test_share_view_focus_capture.js
fnm exec --using 20 npx playwright test tests/ui/share_view_focus.spec.js --browser=chromium
```

Expected: the Node run ends `# fail 1` with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../frontend/src/shareView/focusCapture.js'`; the Playwright run prints `[ERROR] Could not resolve "./shareView/focusCapture.js"` and `Error: No tests found.`

- [ ] **Step 7: Implement the capture**

Create `frontend/src/shareView/focusCapture.js`:

```js
import { measureStickyBottom } from '../eng/alertEpicNavigation.js';

// The sticky tiers above the reading area. The default list in alertEpicNavigation.js names `.eng-filter-bar`, which no element carries;
// the sticky filter bar is `.filterbar-wrap`. A pinned Epic header hides what is under it, so the capture counts it; a reveal asks for the stack
// without Epic headers (a target Epic's own pinned header would push it down) and adds a Story's own header by height.
const STICKY_SELECTORS = [
    '.compact-sticky-header.is-visible',
    '.filterbar-wrap',
    '.planning-panel.open',
    '.planning-review-sticky-stack',
    '.planning-review-docked-header',
];
export const measureShareViewStickyBottom = ({ epicHeaders = true } = {}) => measureStickyBottom(epicHeaders ? [...STICKY_SELECTORS, '.epic-header'] : STICKY_SELECTORS);

// Where a reveal lands its target below the sticky stack, and how far below the stack a node must reach before the capture calls it visible.
// A node that shows only the sliver the landing margin leaves above the target (the previous sibling) is not visible, so capturing right after a
// reveal returns the revealed target and a forwarded link points at the same place.
export const SHARE_VIEW_FOCUS_MARGIN = 12;

// Alert card id -> category key. These are the `sectionId` values of ALERT_SUMMARY_CONFIG in EngAlertsPanel.jsx; a test pins the pairs.
const ALERT_KEY_BY_SECTION_ID = new Map([
    ['eng-alert-missing', 'missing'],
    ['eng-alert-blocked', 'blocked'],
    ['eng-alert-followup', 'followup'],
    ['eng-alert-backlog', 'backlog'],
    ['eng-alert-missing-team', 'missingTeam'],
    ['eng-alert-missing-labels', 'missingLabels'],
    ['eng-alert-needs-stories', 'needsStories'],
    ['eng-alert-waiting', 'waiting'],
    ['eng-alert-empty', 'empty'],
    ['eng-alert-done', 'done'],
]);
const SECTION_ID_BY_ALERT_KEY = new Map(Array.from(ALERT_KEY_BY_SECTION_ID, ([sectionId, key]) => [key, sectionId]));
// `followupEpics` is the future-routed Epic list inside the `followup` card.
export const alertCardId = anchor => SECTION_ID_BY_ALERT_KEY.get(anchor === 'followupEpics' ? 'followup' : anchor);

// A group id is `team.id || team.name || 'unknown'` (groupAlertsByTeam), so an id equal to the group's own name is a name fallback.
// Only the two placeholders may be named in a link.
const ALERT_PLACEHOLDER_IDS = new Set(['unknown', 'Unknown Team']);
const ALERT_GROUP_SELECTOR = '.alert-card:not(.collapsed) .alert-card-body:not(.collapsed) .alert-team-group';
const NO_EPIC = 'NO_EPIC';
const PLANNING_ROW_SELECTOR = 'tr[data-planning-row-key][data-row-kind][data-issue-key]';

const planningRows = root => Array.from(root.querySelectorAll(PLANNING_ROW_SELECTOR))
    .filter(row => row.dataset.rowKind === 'epic' || row.dataset.rowKind === 'story');
// The table shows one row kind at a time, so the first real row names the current Epics/Stories mode.
export const readPlanningRowsMode = (root = document) => planningRows(root)[0]?.dataset.rowKind || null;

const isVisible = (element, band) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > band.top && rect.top < band.bottom;
};
// A sticky header at its `top` offset is pinned, as in measureStickyBottom; one within the landing margin below it counts too, because revealing
// the first Story of an Epic leaves that Epic's header a few pixels under its pin line and capturing right after must still name the Story.
const isPinned = (header, win) => {
    const style = win.getComputedStyle(header);
    return style.position === 'sticky' && header.getBoundingClientRect().top <= Math.max(1, Number.parseFloat(style.top) || 0) + SHARE_VIEW_FOCUS_MARGIN + 1;
};

function alertTeamFocus(group) {
    const key = ALERT_KEY_BY_SECTION_ID.get(group.closest('.alert-card')?.id);
    const id = group.dataset.alertTeam;
    if (!key || !id) return null;
    if (!ALERT_PLACEHOLDER_IDS.has(id) && id === group.querySelector('.alert-pill.team')?.textContent) return null;
    return { kind: 'alertTeam', anchor: key === 'followup' && group.dataset.alertKind === 'epic' ? 'followupEpics' : key, id };
}

function epicBlockFocus(block, band, win) {
    const epicKey = block.dataset.epicKey;
    const children = Array.from(block.children);
    const header = children.find(child => child.classList.contains('epic-header'));
    if (epicKey !== NO_EPIC && !(header && isPinned(header, win))) return { kind: 'epic', key: epicKey };
    // The header is pinned (or the block is the Epic-less bucket): the first visible card is what the reader is on.
    const card = children.find(child => (child.classList.contains('task-item') || child.classList.contains('story-requirement-card')) && isVisible(child, band));
    if (card?.classList.contains('task-item') && card.dataset.taskKey) return { kind: 'story', key: card.dataset.taskKey };
    return epicKey === NO_EPIC ? null : { kind: 'epic', key: epicKey };
}

// Read-only capture of what the sender is looking at. `T`, the sticky stack's bottom, comes from measureStickyBottom, which reads the global
// document and window: `root` and `win` are those objects in the app and the same stand-ins in tests.
export function captureShareViewFocus({ mode, rowsMode, root = document, win = window } = {}) {
    if (mode !== 'catch-up' && mode !== 'planning') return null;
    const band = { top: measureShareViewStickyBottom() + SHARE_VIEW_FOCUS_MARGIN + 1, bottom: win.innerHeight };
    if (mode === 'catch-up') {
        const group = Array.from(root.querySelectorAll(ALERT_GROUP_SELECTOR)).find(candidate => isVisible(candidate, band));
        if (group) return alertTeamFocus(group);
    } else {
        const kind = rowsMode || readPlanningRowsMode(root);
        const row = planningRows(root).find(candidate => candidate.dataset.rowKind === kind && isVisible(candidate, band));
        if (row) return { kind, key: row.dataset.issueKey };
    }
    for (const block of root.querySelectorAll('.epic-block[data-epic-key]')) {
        const focus = isVisible(block, band) ? epicBlockFocus(block, band, win) : null;
        if (focus) return focus;
    }
    return null;
}
```

- [ ] **Step 8: Run them and confirm they pass**

```bash
fnm exec --using 20 node --test tests/test_share_view_focus_capture.js tests/test_share_view_alert_anchors.js
fnm exec --using 20 npx playwright test tests/ui/share_view_focus.spec.js --browser=chromium
```

Expected: `# tests 18`, `# pass 18`, `# fail 0` (sixteen capture tests and the two anchor tests); Playwright `9 passed`.

- [ ] **Step 9: Rebuild the generated frontend output**

```bash
fnm exec --using 20 npm run build
git status --short -- frontend/dist
```

Expected: the build ends with `Done in ...ms` lines and no error; the status shows ` M frontend/dist/dashboard.js`, ` M frontend/dist/dashboard.js.map`, ` D frontend/dist/lazy-views-<old hash>.json` and `?? frontend/dist/lazy-views-<new hash>.json` (the manifest is renamed because the build id covers every `frontend/src` file; no chunk files change).

- [ ] **Step 10: Run the task's regression gate**

```bash
fnm exec --using 20 npm run test:frontend:unit
fnm exec --using 20 bash scripts/extraction_lint/run.sh
fnm exec --using 20 npx playwright test tests/ui/eng_alerts_panel_summary.spec.js tests/ui/eng_alert_loading_order.spec.js tests/ui/eng_missing_story_ghosts.spec.js --browser=chromium
```

Expected: the unit run ends `# fail 0` (2,495 tests when this plan was drafted, from a baseline of 2,477 plus this task's 18; the real total includes every other task's tests); the lint run ends `✖ 104 problems (0 errors, 104 warnings)`, `owner budgets: 0 problems` and `enforced problems: 0` (the warning count must not rise above the baseline you measured before this task, and never above the 106 ratchet; set `JEP_TEST_PYTHON` first in a worktree without `.venv`); the three UI specs report `49 passed`. `run.sh` is not executable in the checkout, hence `bash`.

- [ ] **Step 11: Commit**

```bash
git add frontend/dist frontend/src/eng/EngAlertsPanel.jsx frontend/src/shareView/focusCapture.js tests/share_view_alert_panel_fixture.js tests/share_view_fake_dom.js tests/test_share_view_alert_anchors.js tests/test_share_view_focus_capture.js tests/ui/share_view_focus.spec.js
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Mark alert team groups and capture the visible Share focus" -m "A Share link names the alerts team group, Epic, Story or Planning row the sender is reading. Every .alert-team-group now carries data-alert-team (the future-routed Epic groups also data-alert-kind), so a group is found by comparing data and never by building a selector from a link value. focusCapture.js reads the first visible target with the sticky-stack measure the reveal will share, and exports the one landing margin that keeps a capture taken right after a reveal on the revealed target."
git show --stat HEAD
git status --short
make verify-dist-clean
```

Expected: `git show --stat HEAD` lists exactly ten files (`frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, the renamed `lazy-views` manifest, `EngAlertsPanel.jsx`, `focusCapture.js`, the two helpers, the two test files and the UI spec; `EngAlertsPanel.jsx` shows 22 changed lines); `git status --short` and `make verify-dist-clean` print nothing and exit 0.

### Task 8: Focus reveal and Planning rows seed

**Owner note:** depends on Task 7 (`alertCardId`, `measureShareViewStickyBottom`, `SHARE_VIEW_FOCUS_MARGIN`, the test helper `tests/share_view_fake_dom.js` and the spec `tests/ui/share_view_focus.spec.js`) and Task 5 (`takeInitialPlanningRowMode`, plus `setPendingPlanningRowMode` and `resetShareViewForTests` in tests); blocks Tasks 9 and 11 (the apply machine and hook call `revealShareViewFocus` in Stage D and `setPendingPlanningRowMode` in Stage B). `docs/ontology.md` ("Alert-to-item navigation": it still says the navigation is not an Epic or Team target interface; "Planning Sprint review") is updated by Task 13. Pins design verification V20 (the reveal half) and the reveal half of V4.

**Background (verified at HEAD and in Chromium with the committed stylesheet):**
- Which existing class paints where (share of the target's box repainted at the first animation frame): `epic-flash` on an `.alert-team-group` 36% (Team header row, padding and gaps; the white story rows keep their fill) and on an `.epic-block` 19% (a clear frame); `task-highlight` on a Story card 98% through a `::after` overlay, leaving the card's own `animation: task-appear 0.18s ease-out both` alone (`epic-flash` on a Story card replaces that animation, and it replays 50 ms after the class is removed); `planning-review-confirmed` paints each row cell's `::after` with `epicFlash`. So no new class is added.
- A pinned Epic header counts toward `measureStickyBottom`. For the target Epic's own header that overstates the stack and the correction pass pushes the Epic about 36 px too low; a Story, though, must clear its Epic's header, whose current position is no measure of its final one (the end of its Epic pushes it up while the page is still moving). So an Epic, alert group or table row aligns to the stack without Epic headers, and a Story to that stack plus its Epic header's height.
- The landing offset and the capture's visible rule are one pair. The reveal lands the target `SHARE_VIEW_FOCUS_MARGIN` (12 px, imported from `focusCapture.js`) below the stack, within `LANDING_TOLERANCE_PX = 1`; the capture counts a node as visible only below `T + 12 + 1`, so the sibling above is never visible after a reveal and re-sharing a freshly opened link names the same target. The tolerance is 1 because the capture's `+ 1` is the most landing error it forgives: Planning rows touch, so with a 2 px tolerance a stack that moved by 2 px between the settle frames left the row above reaching 1 px past the capture's threshold, and the capture named it (reproduced in the fake DOM).
- `revealIfHidden` in `planningConfirmedEdit.js` is deliberately not reused: it scrolls the minimum distance, its band list names `.eng-filter-bar` (no element carries it; on an Epic block above the viewport it left the block's top at 11.6 px under a filter bar that ends at 55.6 px), and it scrolls smoothly, which is still moving when the two-frame settle check measures.
- The table's rows mode is `React.useState('epic')`. No lint or test rule restricts import direction (`eslint.config.mjs` has no `no-restricted-imports`; `check_hook_interfaces.mjs` checks `dashboard.jsx` destructure sites only; the budget test registers files under `scenario/`, `settings/` and `epm/` and pins 80 listed modules, none of them `PlanningReviewTable.jsx` or in `shareView/`), so `eng/ -> shareView/` is allowed. The app mounts without `StrictMode`.

**Files:**
- Create: `frontend/src/shareView/focusReveal.js`
- Create: `tests/test_share_view_focus_reveal.js`
- Create: `tests/test_share_view_planning_rows_seed.js`
- Modify: `frontend/src/eng/PlanningReviewTable.jsx` (the import list, and the `mode` state of the default export `PlanningReviewTable`)
- Modify: `tests/ui/share_view_focus.spec.js` (created by Task 7: the `MODULES_ENTRY` constant, and the end of the file)
- Modify: `frontend/dist/` (generated by `npm run build`)
- Test: `tests/ui/planning_review_table.spec.js` (existing; with `tests/ui/planning_review_integration.spec.js` and `tests/ui/planning_selection_defaults.spec.js` it runs unmodified in Step 10)
- Unchanged on purpose: `frontend/src/eng/planningConfirmedEdit.js` (`blinkElement` is reused as exported; nothing needs exporting) and every stylesheet (the three existing highlight classes already paint, see Background)

**Interfaces:**
- Consumes: `blinkElement(element, className, durationMs = 1200)` from `frontend/src/eng/planningConfirmedEdit.js` (existing; never moves focus); `alertCardId`, `measureShareViewStickyBottom`, `SHARE_VIEW_FOCUS_MARGIN` from `frontend/src/shareView/focusCapture.js` (Task 7); `takeInitialPlanningRowMode() -> 'epic' | 'story' | null` (one-shot, Task 5); test only: `setPendingPlanningRowMode(mode)`, `resetShareViewForTests()` (Task 5).
- Produces (binding): `revealShareViewFocus(target, { mode, root = document, win = window, timeoutMs = 8000, isCancelled = () => false }) -> { cancel(): void, done: Promise<'revealed' | 'missing' | 'cancelled'> }`. `target` is the focus shape `resolveShareViewFocus` returns (`{ kind: 'alertTeam', anchor, id }` or `{ kind: 'epic' | 'story', key }`); `mode` is the Share view mode string (`'planning'` also searches table rows before the list). It scrolls with `win.scrollTo({ top, behavior: 'instant' })` so the target's top lands `SHARE_VIEW_FOCUS_MARGIN` below the sticky stack (within 1 px), and blinks with `blinkElement`; it never focuses, never clears a filter, never opens Jira and never navigates.
- Produces: `PlanningReviewTable` opens in the mode returned by `takeInitialPlanningRowMode()` and otherwise in `'epic'`.
- Contract for the apply machine (Tasks 9 and 11): an `alertTeam` target is found only inside an expanded card, so Stage B must have expanded its category (a collapsed card never resolves and the reveal ends `'missing'` after 8 s of visible time); call `setPendingPlanningRowMode` in Stage B before the commit that mounts the Planning table; pass `isCancelled` or call `cancel()` for the lifecycle cancellations. Seed hazards: (a) a table that is already mounted when Stage B runs (a recipient whose saved layout is the Planning table) never reads the seed, so Stage B must seed before the table mounts or the App must remount the table, for example with a `key` that changes when a link applies; (b) Task 5's store keeps the seed after `finishShareView` on purpose (a table that mounts after a cancel still takes it) and Task 4's plan carries `rows` only for the table layout, so an unread seed can only come from case (a), and it would then be taken by the next manual mount of the table; (c) the app must stay free of `StrictMode`, which would run the initializer twice and lose the seed.

**Forbidden regressions for this task:**
- [ ] Without a seed the Planning table still opens in Epics, and the Epics/Stories switch behaves exactly as before for every user choice.
- [ ] The reveal never calls `clearEngFilters`, `resetEngFilters`, `navigateToAlertStory`, `handleAlertStoryClick`, `applyEngMode`, `window.open`, `scrollIntoView` or `.focus()`, and builds no selector from a link value (V4 guard in the tests).
- [ ] Capturing right after a reveal returns the revealed target for an alert group, an Epic block, a Story card and a Planning row (round-trip tests); the landing offset is the imported `SHARE_VIEW_FOCUS_MARGIN`, never a literal, and the landing tolerance stays 1 px.
- [ ] No stylesheet changes; the highlight classes `epic-flash`, `task-highlight` and `planning-review-confirmed` keep painting (CSS source test).
- [ ] Sticky layering and the Planning confirmed-edit motion are untouched (`planningConfirmedEdit.js` and `usePlanningRowMotion.js` are not edited; the existing Planning UI specs pass).

- [ ] **Step 0: Preflight**

```bash
git log --oneline -3
git status --short
ls frontend/src/shareView/focusCapture.js frontend/src/shareView/store.js tests/share_view_fake_dom.js tests/ui/share_view_focus.spec.js
rg -n "React.useState\('epic'\)" frontend/src/eng/PlanningReviewTable.jsx
rg -n "takeInitialPlanningRowMode|setPendingPlanningRowMode|resetShareViewForTests" frontend/src/shareView/store.js
```

Expected: the Task 7 commit is the latest, no status output, all four paths listed, one match on the `mode` state line, and the three Task 5 names exported from `store.js`.

- [ ] **Step 1: Write the failing test for the rows seed**

Create `tests/test_share_view_planning_rows_seed.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const SOURCE_ROOT = path.join(__dirname, '..', 'frontend', 'src');

// The boundary "+" always portals into document.body, which the server renderer cannot do; the rows mode does not depend on it.
const stubBoundaryPlus = {
    name: 'stub-boundary-plus',
    setup(build) {
        build.onResolve({ filter: /^\.\/PlanningReviewBoundaryPlus\.jsx$/ }, () => ({ path: 'PlanningReviewBoundaryPlus', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'module.exports = () => null;' }));
    },
};

// One bundle holds the real table and the real store, so the seed the test sets is the seed the table reads.
let tablePromise;
const loadTable = () => { tablePromise = tablePromise || buildTable(); return tablePromise; };
async function buildTable() {
    const code = (await esbuild.build({
        stdin: {
            contents: "export { default as PlanningReviewTable } from './eng/PlanningReviewTable.jsx'; export { setPendingPlanningRowMode, resetShareViewForTests } from './shareView/store.js';",
            resolveDir: SOURCE_ROOT, loader: 'jsx',
        },
        bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'], plugins: [stubBoundaryPlus],
    })).outputFiles[0].text;
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', code)(loaded, loaded.exports, require);
    return loaded.exports;
}

const noop = () => {};
const epic = { key: 'PROJ-1', id: '1001', summary: 'Synthetic epic', status: 'In Progress', priority: 'Major', storyPoints: 3, teamName: 'Synthetic team', teamId: 'team-1' };
const story = { key: 'PROJ-11', id: '2001', fields: { summary: 'Synthetic story', status: { name: 'To Do' }, priority: { name: 'Major' }, epicKey: 'PROJ-1', customfield_10004: 3, teamId: 'team-1', teamName: 'Synthetic team' } };
const review = {
    layouts: {}, columns: [], cells: {}, drafts: {}, capabilities: { canSave: false, reason: 'unavailable' }, loading: false, saving: false,
    error: '', conflict: null, unconfirmed: false, unavailableIssueIds: [], isRowReadable: () => true,
    setCell: () => ({ valid: true }), changeSchema: () => true, save: async () => true, discard: noop,
};
const tableProps = {
    epicGroups: [{ key: 'PROJ-1', epic, tasks: [story], requirements: [] }], visibleTasks: [story], review,
    jiraUrl: 'https://jira.example.test', getTeamInfo: () => ({ id: 'team-1', name: 'Synthetic team' }), admittedTeamCount: 1, admittedProjectCount: 1,
    renderPriorityIcon: noop,
};

// Each render is a new mount: the state initializer runs once per render here, as it does once per mount in the browser.
function mountTable(table) {
    globalThis.document = { body: {} };
    try { return renderToStaticMarkup(React.createElement(table.PlanningReviewTable, tableProps)); }
    finally { delete globalThis.document; }
}
const activeOption = markup => markup.match(/segmented-control-button active"[^>]*>([^<]+)</)?.[1];
const rowKinds = markup => Array.from(markup.matchAll(/<tr[^>]*data-row-kind="([a-z]+)"/g), match => match[1]);

test('a Planning table nobody seeded opens in Epics', async () => {
    const table = await loadTable();
    table.resetShareViewForTests();
    const markup = mountTable(table);
    assert.equal(activeOption(markup), 'Epics');
    assert.deepEqual(rowKinds(markup), ['epic']);
});

test('a link seed is consumed by the first table mount only; the next mount resets to Epics like any user choice', async () => {
    const table = await loadTable();
    table.resetShareViewForTests();
    table.setPendingPlanningRowMode('story');
    const first = mountTable(table);
    const second = mountTable(table);
    assert.equal(activeOption(first), 'Stories');
    assert.deepEqual(rowKinds(first), ['story']);
    assert.equal(activeOption(second), 'Epics');
    assert.deepEqual(rowKinds(second), ['epic']);
});

test('source: the seed is read lazily inside the table, and the app mounts without StrictMode, which would run the initializer twice', () => {
    const tableSource = fs.readFileSync(path.join(SOURCE_ROOT, 'eng', 'PlanningReviewTable.jsx'), 'utf8');
    assert.ok(tableSource.includes("import { takeInitialPlanningRowMode } from '../shareView/store.js';"));
    assert.ok(tableSource.includes("const [mode, setMode] = React.useState(() => takeInitialPlanningRowMode() || 'epic');"));
    assert.equal(tableSource.match(/takeInitialPlanningRowMode\(/g).length, 1, 'the seed is taken in one place');
    assert.equal(fs.readFileSync(path.join(SOURCE_ROOT, 'dashboard.jsx'), 'utf8').includes('StrictMode'), false,
        'StrictMode runs a state initializer twice: the second call would find the one-shot seed already taken');
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
fnm exec --using 20 node --test tests/test_share_view_planning_rows_seed.js
```

Expected: `# tests 3`, `# pass 1`, `# fail 2`: the seeded-mount test reports `expected: 'Stories'`, `actual: 'Epics'`, and the source test reports `expected: true`, `actual: false`.

- [ ] **Step 3: Seed the table's initial mode**

Edit `frontend/src/eng/PlanningReviewTable.jsx`.

Replace this (the import list):

```jsx
import { usePlanningRowMotion } from './usePlanningRowMotion.js';
```

With:

```jsx
import { usePlanningRowMotion } from './usePlanningRowMotion.js';
import { takeInitialPlanningRowMode } from '../shareView/store.js';
```

Replace this (the first statement of `PlanningReviewTable`):

```jsx
    const [mode, setMode] = React.useState('epic');
```

With:

```jsx
    const [mode, setMode] = React.useState(() => takeInitialPlanningRowMode() || 'epic');
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
fnm exec --using 20 node --test tests/test_share_view_planning_rows_seed.js
git diff --stat -- frontend/src/eng/PlanningReviewTable.jsx
```

Expected: `# tests 3`, `# pass 3`, `# fail 0`; the diff reports `2 insertions(+), 1 deletion(-)`.

- [ ] **Step 5: Write the failing tests for the reveal**

Create `tests/test_share_view_focus_reveal.js`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { captureShareViewFocus } from '../frontend/src/shareView/focusCapture.js';
import { revealShareViewFocus } from '../frontend/src/shareView/focusReveal.js';
import { createFakeDom } from './share_view_fake_dom.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { readDashboardCssSource } = createRequire(import.meta.url)('./css_source_helpers.js');

// Viewport 800 high; the sticky filter bar covers 0..50, so a revealed target's top lands at 62 (T + 12). With `filterBarDocTop` the bar
// starts lower in the document and only sticks once the page has scrolled, as in the app.
function page({ visibility = 'visible', filterBarDocTop = 0 } = {}) {
    const dom = createFakeDom({ innerHeight: 800 });
    const restore = dom.install();
    dom.document.visibilityState = visibility;
    const { el } = dom;
    const filterBar = el('div', { className: 'filterbar-wrap', sticky: { top: 0 }, box: { top: filterBarDocTop, height: 50 } });
    const group = (id, top, { kind, expanded = true } = {}) => {
        const node = el('div', { className: 'alert-team-group', dataset: { alertTeam: id, ...(kind ? { alertKind: kind } : {}) }, box: { top, height: 100 } });
        const body = el('div', { className: `alert-card-body ${expanded ? '' : 'collapsed'}`, box: { top, height: 100 } }, [node]);
        return { node, body, card: cardId => el('div', { className: `alert-card ${expanded ? '' : 'collapsed'}`, id: cardId, box: { top, height: 140 } }, [body]) };
    };
    const story = (key, top) => el('div', { className: 'task-item', dataset: { taskKey: key, issueKey: key }, box: { top, height: 70 } });
    const header = top => el('div', { className: 'epic-header', sticky: { top: 50 }, box: { top: top + 10, height: 40 } });
    const epicBlock = (key, top, children = []) => el('div', { className: 'epic-block', dataset: { epicKey: key }, box: { top, height: 400 } }, [header(top), ...children]);
    const row = (id, kind, key, top) => el('tr', { dataset: { planningRowKey: id, rowKind: kind, issueKey: key }, box: { top, height: 30 } });
    dom.append(dom.document, filterBar);
    return { dom, restore, el, group, story, epicBlock, row, mount: (...nodes) => dom.append(dom.document, ...nodes) };
}
const flush = async () => { for (let index = 0; index < 4; index += 1) await Promise.resolve(); };
function run(p, target, options = {}) {
    const handle = revealShareViewFocus(target, { root: p.dom.document, win: p.dom.window, ...options });
    const outcome = { result: undefined };
    handle.done.then((value) => { outcome.result = value; });
    return { handle, outcome };
}
const alertTarget = { kind: 'alertTeam', anchor: 'blocked', id: 't1' };

test('an expanded alert group is scrolled to T + 12 once its transition could have finished, then blinks', async () => {
    const p = page();
    try {
        const g = p.group('t1', 1500);
        p.mount(g.card('eng-alert-blocked'));
        const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
        p.dom.stepMs(300);
        assert.equal(p.dom.window.scrollCalls.length, 0, 'the 0.35s expand transition is waited out first');
        p.dom.stepMs(160);
        assert.deepEqual(p.dom.window.scrollCalls, [{ top: 1438, behavior: 'instant' }]);
        assert.equal(g.node.getBoundingClientRect().top, 62);
        p.dom.stepMs(100);
        await flush();
        assert.equal(outcome.result, 'revealed');
        assert.equal(p.dom.window.scrollCalls.length, 1, 'already in place: the single correction pass does not scroll');
        assert.ok(g.node.classList.contains('epic-flash'));
        p.dom.stepMs(1300);
        assert.equal(g.node.classList.contains('epic-flash'), false, 'the blink class is removed after the animation');
        assert.equal(p.dom.listenerCount(), 0, 'every document listener is removed on finish');
    } finally { p.restore(); }
});

test('one correction scroll follows when the sticky stack grows during the two settle frames, and never a second', async () => {
    const p = page();
    try {
        const g = p.group('t1', 1500);
        p.mount(g.card('eng-alert-blocked'));
        const compact = p.el('div', { className: 'compact-sticky-header is-visible', sticky: { top: 0 }, box: { top: 0, height: 90 } });
        const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
        while (p.dom.window.scrollCalls.length === 0) p.dom.step(16);
        p.dom.step(16);   // the first settle frame passes before the stack grows: the check waits for the second one
        p.dom.append(p.dom.document, compact);
        p.dom.stepMs(100);
        await flush();
        assert.equal(outcome.result, 'revealed');
        assert.deepEqual(p.dom.window.scrollCalls, [{ top: 1438, behavior: 'instant' }, { top: 1398, behavior: 'instant' }]);
        assert.equal(g.node.getBoundingClientRect().top, 102);
    } finally { p.restore(); }
});

test('an Epic reveal is not pushed down by its own pinned header; a Story reveal lands below its parent header', async () => {
    const epic = page({ filterBarDocTop: 160 });
    try {
        const block = epic.epicBlock('PROJ-1', 1500);
        epic.mount(block);
        const { outcome } = run(epic, { kind: 'epic', key: 'PROJ-1' }, { mode: 'catch-up' });
        epic.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
        // The first jump happens before the filter bar sticks (T = 0) and parks the block under it, pinning its own header; that header is ignored.
        assert.deepEqual(epic.dom.window.scrollCalls, [{ top: 1488, behavior: 'instant' }, { top: 1438, behavior: 'instant' }]);
        assert.equal(block.getBoundingClientRect().top, 62);
    } finally { epic.restore(); }
    const story = page({ filterBarDocTop: 160 });
    try {
        const card = story.story('PROJ-2', 1500);
        story.mount(story.epicBlock('PROJ-2', 1400, [card]));
        const { outcome } = run(story, { kind: 'story', key: 'PROJ-2' }, { mode: 'catch-up' });
        story.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
        assert.equal(card.getBoundingClientRect().top, 102, 'the parent header, 40 high below a 50 high stack, is cleared by its height');
    } finally { story.restore(); }
});

test('a Story at the end of its Epic is not left under the header the end of the Epic pushes up', async () => {
    const p = page({ filterBarDocTop: 160 });
    try {
        const card = p.el('div', { className: 'task-item', dataset: { taskKey: 'PROJ-9', issueKey: 'PROJ-9' }, box: { top: 1500, height: 40 } });
        const block = p.el('div', { className: 'epic-block', dataset: { epicKey: 'PROJ-9' }, box: { top: 1400, height: 150 } }, [
            p.el('div', { className: 'epic-header', sticky: { top: 50 }, box: { top: 1410, height: 40 } }), card,
        ]);
        p.mount(block);
        const { outcome } = run(p, { kind: 'story', key: 'PROJ-9' }, { mode: 'catch-up' });
        p.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
        const headerRect = block.children[0].getBoundingClientRect();
        assert.equal(headerRect.bottom, 90, 'the header ends up fully pinned under the 50 high stack');
        assert.equal(card.getBoundingClientRect().top, 102);
    } finally { p.restore(); }
});

test('a target that renders late, or a card that expands late, is revealed 0.35s after it is first seen expanded', async () => {
    const late = page();
    try {
        const { outcome } = run(late, alertTarget, { mode: 'catch-up' });
        late.dom.stepMs(1200);
        const g = late.group('t1', 1500);
        late.mount(g.card('eng-alert-blocked'));
        late.dom.stepMs(300);
        assert.equal(late.dom.window.scrollCalls.length, 0);
        late.dom.stepMs(400);
        await flush();
        assert.equal(late.dom.window.scrollCalls.length, 1);
        late.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { late.restore(); }
    const collapsed = page();
    try {
        const g = collapsed.group('t1', 1500, { expanded: false });
        collapsed.mount(g.card('eng-alert-blocked'));
        const { outcome } = run(collapsed, alertTarget, { mode: 'catch-up' });
        collapsed.dom.stepMs(1000);
        assert.equal(collapsed.dom.window.scrollCalls.length, 0, 'a collapsed card is not scrolled to');
        g.body.parentElement.classList.remove('collapsed');
        g.body.classList.remove('collapsed');
        collapsed.dom.stepMs(300);
        assert.equal(collapsed.dom.window.scrollCalls.length, 0);
        collapsed.dom.stepMs(120);
        assert.equal(collapsed.dom.window.scrollCalls.length, 1);
        collapsed.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { collapsed.restore(); }
});

test('V20: followup Story groups and future-routed Epic groups are revealed separately even when they share a Team id', async () => {
    for (const [anchor, kind] of [['followup', undefined], ['followupEpics', 'epic']]) {
        const p = page();
        try {
            const stories = p.group('t1', 1500);
            const epics = p.group('t1', 1700, { kind: 'epic' });
            const card = p.el('div', { className: 'alert-card', id: 'eng-alert-followup', box: { top: 1500, height: 400 } }, [p.el('div', { className: 'alert-card-body' }, [stories.node, epics.node])]);
            p.mount(card);
            const { outcome } = run(p, { kind: 'alertTeam', anchor, id: 't1' }, { mode: 'catch-up' });
            p.dom.stepMs(700);
            await flush();
            assert.equal(outcome.result, 'revealed', anchor);
            const [hit, other] = kind ? [epics.node, stories.node] : [stories.node, epics.node];
            assert.ok(hit.classList.contains('epic-flash'), `${anchor} blinks its own list`);
            assert.equal(other.classList.contains('epic-flash'), false);
        } finally { p.restore(); }
    }
});

test('a target that never appears resolves missing after 8 seconds of visible time, without touching the page', async () => {
    const p = page();
    try {
        const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
        p.dom.stepMs(7900);
        await flush();
        assert.equal(outcome.result, undefined);
        p.dom.stepMs(200);
        await flush();
        assert.equal(outcome.result, 'missing');
        assert.deepEqual(p.dom.window.scrollCalls, []);
        assert.equal(p.dom.listenerCount(), 0);
        assert.equal(p.dom.pendingFrames(), 0);
    } finally { p.restore(); }
});

test('each deliberate input cancels the reveal; a bare modifier key does not', async () => {
    const events = [{ type: 'wheel' }, { type: 'touchmove' }, { type: 'pointerdown' }, { type: 'touchstart' }, { type: 'keydown', key: 'a' }];
    for (const event of events) {
        const p = page();
        try {
            const g = p.group('t1', 1500);
            p.mount(g.card('eng-alert-blocked'));
            const { outcome } = run(p, alertTarget, { mode: 'catch-up' });
            p.dom.stepMs(100);
            p.dom.dispatch('document', event);
            await flush();
            assert.equal(outcome.result, 'cancelled', event.type);
            p.dom.stepMs(1000);
            assert.deepEqual(p.dom.window.scrollCalls, [], `${event.type} stops every later scroll`);
            assert.equal(p.dom.listenerCount(), 0);
        } finally { p.restore(); }
    }
    const modifier = page();
    try {
        const g = modifier.group('t1', 1500);
        modifier.mount(g.card('eng-alert-blocked'));
        const { outcome } = run(modifier, alertTarget, { mode: 'catch-up' });
        modifier.dom.dispatch('document', { type: 'keydown', key: 'Shift' });
        modifier.dom.stepMs(700);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { modifier.restore(); }
});

test('cancel() and isCancelled() both end the reveal as cancelled', async () => {
    const direct = page();
    try {
        const { handle, outcome } = run(direct, alertTarget, { mode: 'catch-up' });
        handle.cancel();
        handle.cancel();
        await flush();
        assert.equal(outcome.result, 'cancelled');
        assert.equal(direct.dom.pendingFrames(), 0);
    } finally { direct.restore(); }
    const pulled = page();
    try {
        const g = pulled.group('t1', 1500);
        pulled.mount(g.card('eng-alert-blocked'));
        let cancelled = false;
        const { outcome } = run(pulled, alertTarget, { mode: 'catch-up', isCancelled: () => cancelled });
        pulled.dom.stepMs(200);
        cancelled = true;
        pulled.dom.stepMs(32);
        await flush();
        assert.equal(outcome.result, 'cancelled');
        assert.deepEqual(pulled.dom.window.scrollCalls, []);
    } finally { pulled.restore(); }
});

test('a hidden tab neither scrolls nor spends the budget; visibilitychange resumes the reveal', async () => {
    const p = page({ visibility: 'hidden' });
    try {
        const { outcome } = run(p, alertTarget, { mode: 'catch-up', timeoutMs: 500 });
        p.dom.stepMs(5000);
        assert.equal(p.dom.pendingFrames(), 0, 'no frame is queued while hidden');
        const g = p.group('t1', 1500);
        p.mount(g.card('eng-alert-blocked'));
        p.dom.document.visibilityState = 'visible';
        p.dom.dispatch('document', { type: 'visibilitychange' });
        p.dom.stepMs(700);
        await flush();
        assert.equal(outcome.result, 'revealed', 'the 5 hidden seconds did not count against a 500ms budget');
    } finally { p.restore(); }
    const midway = page();
    try {
        const g = midway.group('t1', 1500);
        midway.mount(g.card('eng-alert-blocked'));
        const { outcome } = run(midway, alertTarget, { mode: 'catch-up' });
        midway.dom.stepMs(100);
        midway.dom.document.visibilityState = 'hidden';
        midway.dom.stepMs(2000);
        assert.deepEqual(midway.dom.window.scrollCalls, [], 'nothing scrolls while the tab is hidden');
        midway.dom.document.visibilityState = 'visible';
        midway.dom.dispatch('document', { type: 'visibilitychange' });
        midway.dom.stepMs(700);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { midway.restore(); }
    // A real browser queues no frame while hidden, so the first visible frame arrives with a huge time gap: it counts for at most 100ms.
    const gap = page();
    try {
        const { outcome } = run(gap, alertTarget, { mode: 'catch-up', timeoutMs: 500 });
        gap.dom.stepMs(32);
        gap.dom.document.visibilityState = 'hidden';
        gap.dom.advanceClock(5000);
        gap.dom.document.visibilityState = 'visible';
        gap.dom.step(16);
        const g = gap.group('t1', 1500);
        gap.mount(g.card('eng-alert-blocked'));
        gap.dom.stepMs(700);
        await flush();
        assert.equal(outcome.result, 'revealed');
    } finally { gap.restore(); }
});

test('each target kind blinks with the existing class that paints on it', async () => {
    const seen = [];
    const story = page();
    try {
        const card = story.story('PROJ-12', 1500);
        story.mount(story.epicBlock('PROJ-1', 1400, [card]));
        const { outcome } = run(story, { kind: 'story', key: 'PROJ-12' }, { mode: 'catch-up' });
        story.dom.stepMs(300);
        await flush();
        seen.push(['story card', outcome.result, card.classList.contains('task-highlight')]);
        story.dom.stepMs(1300);
        assert.ok(card.classList.contains('task-highlight'), 'the 1.8s pulse outlives the default 1.2s blink');
        story.dom.stepMs(1000);
        assert.equal(card.classList.contains('task-highlight'), false);
    } finally { story.restore(); }
    const epic = page();
    try {
        const block = epic.epicBlock('PROJ-2', 1500);
        epic.mount(block);
        const { outcome } = run(epic, { kind: 'epic', key: 'PROJ-2' }, { mode: 'catch-up' });
        epic.dom.stepMs(300);
        await flush();
        seen.push(['epic block', outcome.result, block.classList.contains('epic-flash')]);
    } finally { epic.restore(); }
    const table = page();
    try {
        const epicRow = table.row('9001', 'epic', 'PROJ-3', 1500);
        table.mount(table.el('table', {}, [epicRow, table.row('9002', 'epic', 'PROJ-4', 1530)]));
        const { outcome } = run(table, { kind: 'epic', key: 'PROJ-3' }, { mode: 'planning' });
        table.dom.stepMs(300);
        await flush();
        seen.push(['planning row', outcome.result, epicRow.classList.contains('planning-review-confirmed')]);
    } finally { table.restore(); }
    const list = page();
    try {
        const card = list.story('PROJ-13', 1500);
        list.mount(list.epicBlock('PROJ-1', 1400, [card]));
        const { outcome } = run(list, { kind: 'story', key: 'PROJ-13' }, { mode: 'planning' });
        list.dom.stepMs(300);
        await flush();
        seen.push(['planning list card', outcome.result, card.classList.contains('task-highlight')]);
    } finally { list.restore(); }
    assert.deepEqual(seen, [['story card', 'revealed', true], ['epic block', 'revealed', true], ['planning row', 'revealed', true], ['planning list card', 'revealed', true]]);
});

// Capturing right after a reveal must name the revealed target, so forwarding a received link points at the same place. The layouts use the real
// gaps between siblings: alert groups 0.6rem (9.6 px), Epic blocks 0.8rem (12.8 px), Story cards 0.9rem (14.4 px), Planning table rows none.
async function revealThenCapture(p, target, mode) {
    const { outcome } = run(p, target, { mode });
    p.dom.stepMs(700);
    await flush();
    assert.equal(outcome.result, 'revealed', JSON.stringify(target));
    return captureShareViewFocus({ mode, root: p.dom.document, win: p.dom.window });
}

test('round trip: capturing right after revealing an alert group names that group, not the one above it', async () => {
    for (const id of ['t1', 't2', 't3']) {
        const p = page({ filterBarDocTop: 160 });
        try {
            const groups = ['t1', 't2', 't3'].map((groupId, index) => p.el('div', { className: 'alert-team-group', dataset: { alertTeam: groupId }, box: { top: 1500 + index * 109.6, height: 100 } }, [p.el('span', { className: 'alert-pill team', text: `Team ${groupId}` })]));
            p.mount(p.el('div', { className: 'alert-card', id: 'eng-alert-blocked', box: { top: 1500, height: 400 } }, [p.el('div', { className: 'alert-card-body', box: { top: 1500, height: 400 } }, groups)]));
            assert.deepEqual(await revealThenCapture(p, { kind: 'alertTeam', anchor: 'blocked', id }, 'catch-up'), { kind: 'alertTeam', anchor: 'blocked', id });
        } finally { p.restore(); }
    }
});

test('round trip: capturing right after revealing an Epic block, or a Story card below its pinned header, names the same target', async () => {
    for (const key of ['PROJ-1', 'PROJ-2', 'PROJ-3']) {
        const p = page({ filterBarDocTop: 160 });
        try {
            p.mount(...['PROJ-1', 'PROJ-2', 'PROJ-3'].map((epicKey, index) => p.epicBlock(epicKey, 1400 + index * 412.8)));
            assert.deepEqual(await revealThenCapture(p, { kind: 'epic', key }, 'catch-up'), { kind: 'epic', key });
        } finally { p.restore(); }
    }
    for (const key of ['PROJ-91', 'PROJ-92', 'PROJ-93', 'PROJ-94']) {
        const p = page({ filterBarDocTop: 160 });
        try {
            const cards = ['PROJ-91', 'PROJ-92', 'PROJ-93', 'PROJ-94'].map((storyKey, index) => p.el('div', { className: 'task-item', dataset: { taskKey: storyKey, issueKey: storyKey }, box: { top: 1460 + index * 84.4, height: 70 } }));
            p.mount(p.epicBlock('PROJ-9', 1400, cards));
            assert.deepEqual(await revealThenCapture(p, { kind: 'story', key }, 'catch-up'), { kind: 'story', key });
        } finally { p.restore(); }
    }
});

test('round trip: capturing right after revealing a Planning table row names that row, not the adjacent row above it', async () => {
    for (const kind of ['epic', 'story']) {
        for (const index of [0, 1, 2, 3]) {
            const p = page({ filterBarDocTop: 160 });
            try {
                p.mount(p.el('table', {}, [0, 1, 2, 3].map(position => p.row(String(9000 + position), kind, `PROJ-${position + 1}`, 1500 + position * 30))));
                const key = `PROJ-${index + 1}`;
                assert.deepEqual(await revealThenCapture(p, { kind, key }, 'planning'), { kind, key }, `${kind} row ${key}`);
            } finally { p.restore(); }
        }
    }
});

test('round trip: a stack that moves by 2 px between the settle frames is corrected, so a Planning row is never captured as the row above it', async () => {
    // Table rows touch, so the row above ends exactly where the target begins; a landing more than 1 px below T + margin would leave it visible to the capture.
    for (const [shrink, scrolls] of [[0, 1], [1, 1], [2, 2], [3, 2]]) {
        const p = page({ filterBarDocTop: 160 });
        try {
            p.mount(p.el('table', {}, [0, 1, 2, 3].map(position => p.row(String(9000 + position), 'epic', `PROJ-${position + 1}`, 1500 + position * 30))));
            p.dom.setScrollY(1000);   // the filter bar is already stuck, so the first jump measures its 50 px
            const { outcome } = run(p, { kind: 'epic', key: 'PROJ-3' }, { mode: 'planning' });
            while (p.dom.window.scrollCalls.length === 0) p.dom.step(16);
            p.dom.document.querySelector('.filterbar-wrap').box.height = 50 - shrink;
            p.dom.stepMs(200);
            await flush();
            assert.equal(outcome.result, 'revealed');
            assert.equal(p.dom.window.scrollCalls.length, scrolls, `the stack moved by ${shrink} px`);
            assert.deepEqual(captureShareViewFocus({ mode: 'planning', root: p.dom.document, win: p.dom.window }), { kind: 'epic', key: 'PROJ-3' }, `the stack moved by ${shrink} px`);
        } finally { p.restore(); }
    }
});

test('a row kind that does not match the table, and an unknown anchor or kind, resolve missing', async () => {
    const cases = [
        [{ kind: 'story', key: 'PROJ-3' }, 'planning'],
        [{ kind: 'alertTeam', anchor: 'nope', id: 't1' }, 'catch-up'],
        [{ kind: 'alertTeam', anchor: '__proto__', id: 't1' }, 'catch-up'],
        [{ kind: 'board', key: 'PROJ-3' }, 'catch-up'],
        [null, 'catch-up'],
    ];
    for (const [target, mode] of cases) {
        const p = page();
        try {
            const g = p.group('t1', 1500);
            p.mount(p.el('table', {}, [p.row('9001', 'epic', 'PROJ-3', 1200)]), g.card('eng-alert-blocked'));
            const { outcome } = run(p, target, { mode, timeoutMs: 300 });
            p.dom.stepMs(400);
            await flush();
            assert.equal(outcome.result, 'missing', JSON.stringify(target));
            assert.deepEqual(p.dom.window.scrollCalls, []);
        } finally { p.restore(); }
    }
});

test('V4: hostile ids are compared as data, so they neither throw nor match another node', async () => {
    const hostile = 'x"],.alert-card,[a="';
    const p = page();
    try {
        const exact = p.group(hostile, 1500);
        const decoy = p.group('x', 1700);
        const epic = p.epicBlock(hostile, 2000, [p.story(hostile, 2100)]);
        p.mount(exact.card('eng-alert-blocked'), decoy.card('eng-alert-done'), epic);
        const hits = [];
        for (const [target, node] of [
            [{ kind: 'alertTeam', anchor: 'blocked', id: hostile }, exact.node],
            [{ kind: 'epic', key: hostile }, epic],
            [{ kind: 'story', key: hostile }, epic.children[1]],
        ]) {
            const { outcome } = run(p, target, { mode: 'catch-up' });
            p.dom.stepMs(700);
            await flush();
            hits.push([outcome.result, node.classList.contains('epic-flash') || node.classList.contains('task-highlight')]);
        }
        assert.deepEqual(hits, [['revealed', true], ['revealed', true], ['revealed', true]]);
        assert.equal(decoy.node.classList.contains('epic-flash'), false);
        const { outcome } = run(p, { kind: 'epic', key: 'x"]' }, { mode: 'catch-up', timeoutMs: 200 });
        p.dom.stepMs(300);
        await flush();
        assert.equal(outcome.result, 'missing');
    } finally { p.restore(); }
});

test('V4: the focus modules never clear filters, open Jira, navigate, move focus or build a selector from a value', () => {
    for (const file of ['focusCapture.js', 'focusReveal.js']) {
        const source = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'src', 'shareView', file), 'utf8');
        for (const forbidden of ['clearEngFilters', 'resetEngFilters', 'navigateToAlertStory', 'handleAlertStoryClick', 'applyEngMode', 'window.open', 'location', 'scrollIntoView', '.focus(', 'onMissing']) {
            assert.equal(source.includes(forbidden), false, `${file} must not contain ${forbidden}`);
        }
        assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\(\s*`/, `${file} builds no template-literal selector`);
        assert.doesNotMatch(source, /(?:querySelector|querySelectorAll|closest|matches)\([^)]*\+/, `${file} concatenates no selector`);
    }
});

test('the reveal lands targets at the one margin the capture adds to its visible rule', () => {
    const revealSource = fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'src', 'shareView', 'focusReveal.js'), 'utf8');
    assert.match(revealSource, /import \{[^}]*SHARE_VIEW_FOCUS_MARGIN[^}]*\} from '\.\/focusCapture\.js';/);
    assert.ok(revealSource.includes('(stackBottom + SHARE_VIEW_FOCUS_MARGIN)'), 'the landing offset is the shared constant, not a literal');
});

test('the three reused highlight classes still paint through an animation', () => {
    const css = readDashboardCssSource(REPO_ROOT);
    assert.match(css, /\.epic-flash\s*\{\s*animation:\s*epicFlash\s/);
    assert.match(css, /@keyframes epicFlash\s*\{\s*0%\s*\{\s*background:\s*rgba\(255,\s*255,\s*0,\s*0\.45\)/);
    assert.match(css, /\.task-item\.task-highlight::after\s*\{\s*animation:\s*taskHighlightPulse\s/);
    assert.match(css, /\.planning-review-table tr\.planning-review-confirmed td::after\s*\{[^}]*animation:\s*epicFlash\s/);
});
```

Edit `tests/ui/share_view_focus.spec.js`. Replace this (the `MODULES_ENTRY` constant):

```js
const MODULES_ENTRY = "import { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN } from './shareView/focusCapture.js'; window.__share = { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN };";
```

With:

```js
const MODULES_ENTRY = "import { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN } from './shareView/focusCapture.js'; import { revealShareViewFocus } from './shareView/focusReveal.js'; window.__share = { captureShareViewFocus, measureShareViewStickyBottom, readPlanningRowsMode, SHARE_VIEW_FOCUS_MARGIN, revealShareViewFocus };";
```

Replace this (the last lines of the file, the end of the Planning table capture test):

```js
        expect(row.top).toBeLessThan(800);
    }
});
```

With:

```js
        expect(row.top).toBeLessThan(800);
    }
});

// Where a reveal leaves the target relative to the stack: T + SHARE_VIEW_FOCUS_MARGIN, within the 1px the reveal tolerates (the capture's `+ 1`).
const landing = (page, selectorKind) => page.evaluate((kind) => {
    const find = {
        group: () => [...document.querySelectorAll('#eng-alert-blocked .alert-team-group')].find(node => node.dataset.alertTeam === 't2'),
        epic: () => [...document.querySelectorAll('.epic-block')].find(node => node.dataset.epicKey === 'PROJ-6'),
        story: () => [...document.querySelectorAll('.task-item')].find(node => node.dataset.taskKey === 'PROJ-73'),
        row: () => [...document.querySelectorAll('tr')].find(node => node.dataset.issueKey === 'PROJ-40'),
    }[kind];
    const node = find();
    const parentHeader = node.closest('.epic-block')?.querySelector('.epic-header')?.getBoundingClientRect();
    return {
        top: node.getBoundingClientRect().top, className: node.className, headerBottom: parentHeader?.bottom ?? null,
        stackBottom: window.__share.measureShareViewStickyBottom({ epicHeaders: kind === 'story' }), margin: window.__share.SHARE_VIEW_FOCUS_MARGIN,
        animations: document.getAnimations().map(animation => animation.animationName),
        cellAnimation: kind === 'row' ? getComputedStyle(node.cells[0], '::after').animationName : null,
    };
}, selectorKind);
const reveal = (page, target, mode) => page.evaluate(async ({ target, mode }) => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const focusBefore = document.activeElement;
    const result = await window.__share.revealShareViewFocus(target, { mode }).done;
    return { result, focusMoved: document.activeElement !== focusBefore };
}, { target, mode });

for (const compact of [false, true]) {
    test.describe(`reveal, ${compact ? 'compact header up' : 'main header'}`, () => {
        test('an alert group lands at T + 12 and paints the epic-flash blink without moving focus', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            expect(await reveal(page, { kind: 'alertTeam', anchor: 'blocked', id: 't2' }, 'catch-up')).toEqual({ result: 'revealed', focusMoved: false });
            const landed = await landing(page, 'group');
            expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
            expect(landed.className).toContain('epic-flash');
            expect(landed.animations).toContain('epicFlash');
        });

        test('an Epic block lands at T + 12 and paints the epic-flash blink', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            expect((await reveal(page, { kind: 'epic', key: 'PROJ-6' }, 'catch-up')).result).toBe('revealed');
            const landed = await landing(page, 'epic');
            expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
            expect(landed.className).toContain('epic-flash');
            expect(landed.animations).toContain('epicFlash');
        });

        test('a Story card lands below its pinned parent header and paints the task-highlight pulse', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            expect((await reveal(page, { kind: 'story', key: 'PROJ-73' }, 'catch-up')).result).toBe('revealed');
            const landed = await landing(page, 'story');
            expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
            expect(landed.top).toBeGreaterThanOrEqual(landed.headerBottom);
            expect(landed.className).toContain('task-highlight');
            expect(landed.animations).toContain('taskHighlightPulse');
        });

        test('a real wheel event cancels a reveal in flight', async ({ page }) => {
            await load(page, catchUpHtml({ compact }));
            await page.evaluate(() => {
                window.__share.revealShareViewFocus({ kind: 'alertTeam', anchor: 'blocked', id: 't2' }, { mode: 'catch-up' }).done.then((value) => { window.__revealResult = value; });
            });
            await page.mouse.move(400, 400);
            await page.mouse.wheel(0, 40);
            await page.waitForFunction(() => window.__revealResult !== undefined);
            expect(await page.evaluate(() => window.__revealResult)).toBe('cancelled');
        });
    });
}

test('planning table: a row lands below the sticky stack at T + 12 and paints the row blink', async ({ page }) => {
    await load(page, planningHtml('epic'));
    expect((await reveal(page, { kind: 'epic', key: 'PROJ-40' }, 'planning')).result).toBe('revealed');
    const landed = await landing(page, 'row');
    expect(Math.abs(landed.top - (landed.stackBottom + landed.margin))).toBeLessThanOrEqual(1);
    expect(landed.className).toContain('planning-review-confirmed');
    expect(landed.cellAnimation).toBe('epicFlash');
});

// Forwarding a received link: capturing right after a reveal must name the revealed target, not the sibling above it (alert groups sit 9.6 px
// apart and table rows touch, so a sliver of the one above would show if the capture counted it).
for (const compact of [false, true]) {
    test(`round trip, ${compact ? 'compact header up' : 'main header'}: capture after reveal names the same alert group, Epic block or Story card`, async ({ page }) => {
        await load(page, catchUpHtml({ compact, moreGroups: { blockedAlertTeams: ['t2b', 't2c'] } }));
        for (const target of [
            { kind: 'alertTeam', anchor: 'blocked', id: 't2b' }, { kind: 'alertTeam', anchor: 'blocked', id: 't2c' },
            { kind: 'epic', key: 'PROJ-6' }, { kind: 'story', key: 'PROJ-71' }, { kind: 'story', key: 'PROJ-73' },
        ]) {
            expect((await reveal(page, target, 'catch-up')).result, JSON.stringify(target)).toBe('revealed');
            expect(await capture(page, 'catch-up'), JSON.stringify(target)).toEqual(target);
        }
    });
}

test('round trip, planning table: capture after reveal names the same row, not the adjacent row above it', async ({ page }) => {
    for (const rowKind of ['epic', 'story']) {
        await load(page, planningHtml(rowKind));
        const target = { kind: rowKind, key: 'PROJ-40' };
        expect((await reveal(page, target, 'planning')).result, rowKind).toBe('revealed');
        expect(await capture(page, 'planning'), rowKind).toEqual(target);
    }
});
```

- [ ] **Step 6: Run them and confirm they fail**

```bash
fnm exec --using 20 node --test tests/test_share_view_focus_reveal.js
fnm exec --using 20 npx playwright test tests/ui/share_view_focus.spec.js --browser=chromium
```

Expected: the Node run ends `# fail 1` with `ERR_MODULE_NOT_FOUND ... frontend/src/shareView/focusReveal.js`; the Playwright run prints `[ERROR] Could not resolve "./shareView/focusReveal.js"` and `Error: No tests found.`

- [ ] **Step 7: Implement the reveal**

Create `frontend/src/shareView/focusReveal.js`:

```js
import { blinkElement } from '../eng/planningConfirmedEdit.js';
import { alertCardId, measureShareViewStickyBottom, SHARE_VIEW_FOCUS_MARGIN } from './focusCapture.js';

const EXPAND_WAIT_MS = 350;     // .alert-card-body animates max-height for 0.35s
const FRAME_CAP_MS = 100;       // a longer frame (a hidden tab, a stalled main thread) does not count against the budget
const SETTLE_FRAMES = 2;        // the compact header, the filter bar and the docked Planning header settle within two frames
const LANDING_TOLERANCE_PX = 1; // the capture counts a node as visible only past T + SHARE_VIEW_FOCUS_MARGIN + 1, so a landing off by more than 1 px is corrected
const TASK_HIGHLIGHT_MS = 2200; // the 1.8s pulse plus the margin dashboard.jsx gives it
const INTERRUPTS = ['wheel', 'touchmove', 'pointerdown', 'touchstart', 'keydown'];
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);
const PLANNING_ROW_SELECTOR = 'tr[data-planning-row-key][data-row-kind][data-issue-key]';

// Targets are found by comparing dataset values, never by building a selector from a link value. Each result names the existing class whose
// animation paints on that target: `epic-flash` on the alert group and Epic block, `task-highlight` (a pseudo-element overlay) on the Story
// card, `planning-review-confirmed` on the table row.
function findAlertGroup({ anchor, id }, root) {
    const cardId = alertCardId(anchor);
    const card = Array.from(root.querySelectorAll('.alert-card')).find(candidate => candidate.id === cardId);
    const group = card && Array.from(card.querySelectorAll('.alert-team-group')).find(candidate => (
        candidate.dataset.alertTeam === id && (candidate.dataset.alertKind === 'epic') === (anchor === 'followupEpics')
    ));
    if (!group) return null;
    const collapsed = card.classList.contains('collapsed') || Boolean(group.closest('.alert-card-body')?.classList.contains('collapsed'));
    return { element: group, className: 'epic-flash', collapsed, settle: true };
}

function findTarget(target, mode, root) {
    const { kind, key } = target || {};
    if (kind === 'alertTeam') return findAlertGroup(target, root);
    if (kind !== 'epic' && kind !== 'story') return null;
    if (mode === 'planning') {
        const row = Array.from(root.querySelectorAll(PLANNING_ROW_SELECTOR)).find(candidate => candidate.dataset.rowKind === kind && candidate.dataset.issueKey === key);
        if (row) return { element: row, className: 'planning-review-confirmed' };
    }
    if (kind === 'story') {
        const card = Array.from(root.querySelectorAll('.task-item[data-task-key]')).find(candidate => candidate.dataset.taskKey === key);
        return card ? { element: card, className: 'task-highlight', durationMs: TASK_HIGHLIGHT_MS, belowEpicHeader: true } : null;
    }
    const block = Array.from(root.querySelectorAll('.epic-block[data-epic-key]')).find(candidate => candidate.dataset.epicKey === key);
    return block ? { element: block, className: 'epic-flash' } : null;
}

// Puts the target's top SHARE_VIEW_FOCUS_MARGIN below the sticky stack, give or take LANDING_TOLERANCE_PX. An instant jump: a smooth one would still be
// moving when the settle check measures.
// A Story also clears its own Epic's header by the header's height: while the page is still moving, that header may sit pushed up by the end
// of its Epic instead of pinned, so its current position is no measure of where it will be.
function alignBelowStickyStack({ element, belowEpicHeader = false }, win) {
    const header = belowEpicHeader ? element.closest('.epic-block')?.querySelector('.epic-header') : null;
    const stackBottom = measureShareViewStickyBottom({ epicHeaders: false }) + (header ? header.getBoundingClientRect().height : 0);
    const delta = element.getBoundingClientRect().top - (stackBottom + SHARE_VIEW_FOCUS_MARGIN);
    if (Math.abs(delta) <= LANDING_TOLERANCE_PX) return;
    win.scrollTo({ top: Math.max(0, win.scrollY + delta), behavior: 'instant' });
}

// Scrolls to and blinks the link's focus target without moving keyboard focus, clearing a filter or leaving the page. A target that never
// appears within `timeoutMs` of visible time resolves 'missing'; any deliberate input or `isCancelled()` resolves 'cancelled'.
export function revealShareViewFocus(target, { mode, root = document, win = window, timeoutMs = 8000, isCancelled = () => false } = {}) {
    let finished = false;
    let frame = null;
    let lastTime = null;
    let elapsed = 0;
    let readySince = null;
    let settleFramesLeft = 0;
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });

    const finish = (result) => {
        if (finished) return;
        finished = true;
        if (frame !== null) win.cancelAnimationFrame(frame);
        for (const name of INTERRUPTS) root.removeEventListener(name, onInterrupt, true);
        root.removeEventListener('visibilitychange', onVisible);
        resolveDone(result);
    };
    const schedule = () => { frame = win.requestAnimationFrame(step); };
    function onInterrupt(event) {
        if (event.type === 'keydown' && MODIFIER_KEYS.has(event.key)) return;
        finish('cancelled');
    }
    function onVisible() {
        if (!finished && frame === null && root.visibilityState === 'visible') schedule();
    }
    function step(time) {
        frame = null;
        if (finished) return;
        if (isCancelled()) { finish('cancelled'); return; }
        if (root.visibilityState !== 'visible') { lastTime = null; return; }   // `visibilitychange` resumes the loop
        elapsed += lastTime === null ? 0 : Math.min(time - lastTime, FRAME_CAP_MS);
        lastTime = time;
        const found = findTarget(target, mode, root);
        if (!found || found.collapsed) {
            readySince = null;
            settleFramesLeft = 0;
            if (elapsed >= timeoutMs) finish('missing'); else schedule();
            return;
        }
        if (settleFramesLeft === 0) {
            readySince = readySince ?? time;
            if (found.settle && time - readySince < EXPAND_WAIT_MS) { schedule(); return; }
            alignBelowStickyStack(found, win);
            settleFramesLeft = SETTLE_FRAMES;
            schedule();
            return;
        }
        settleFramesLeft -= 1;
        if (settleFramesLeft > 0) { schedule(); return; }
        alignBelowStickyStack(found, win);
        blinkElement(found.element, found.className, found.durationMs);
        finish('revealed');
    }

    for (const name of INTERRUPTS) root.addEventListener(name, onInterrupt, { capture: true, passive: true });
    root.addEventListener('visibilitychange', onVisible);
    schedule();
    return { cancel: () => finish('cancelled'), done };
}
```

- [ ] **Step 8: Run them and confirm they pass**

```bash
fnm exec --using 20 node --test tests/test_share_view_focus_reveal.js tests/test_share_view_planning_rows_seed.js
fnm exec --using 20 npx playwright test tests/ui/share_view_focus.spec.js --browser=chromium
```

Expected: `# tests 23`, `# pass 23`, `# fail 0` (twenty reveal tests and the three seed tests); Playwright `21 passed` (nine capture tests from Task 7, nine reveal tests and three round-trip tests).

- [ ] **Step 9: Rebuild the generated frontend output**

```bash
fnm exec --using 20 npm run build
git status --short -- frontend/dist
```

Expected: no build error; ` M frontend/dist/dashboard.js`, ` M frontend/dist/dashboard.js.map`, the `lazy-views` manifest replaced again (` D` the Task 7 file, `?? ` a new one) and no chunk files (the table and the store are in the main bundle).

- [ ] **Step 10: Run the task's regression gate**

```bash
fnm exec --using 20 npm run test:frontend:unit
fnm exec --using 20 bash scripts/extraction_lint/run.sh
fnm exec --using 20 npx playwright test tests/ui/planning_review_table.spec.js tests/ui/planning_review_integration.spec.js tests/ui/planning_selection_defaults.spec.js --browser=chromium --workers=2
```

Expected: the unit run ends `# fail 0` (2,518 when this plan was drafted); the lint run ends `✖ 104 problems (0 errors, 104 warnings)` with `owner budgets: 0 problems` and `enforced problems: 0` (the warning count must not rise; the two new files add none); the three Planning UI specs report no failure (164 passed in the final scratch replay; an earlier replay saw one timing flake, described next). One existing test, `planning_review_table.spec.js` "the page scrolls to a moved row only when it would be off-screen...", measures a smooth scroll and failed once when three specs ran together under load; it passed 3 of 3 alone and in a full-file rerun (84 of 84). If it fails, rerun that file alone before treating it as a regression; any other failure is one.

- [ ] **Step 11: Commit**

```bash
git add frontend/dist frontend/src/eng/PlanningReviewTable.jsx frontend/src/shareView/focusReveal.js tests/test_share_view_focus_reveal.js tests/test_share_view_planning_rows_seed.js tests/ui/share_view_focus.spec.js
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Reveal the Share focus target and seed the Planning rows mode" -m "revealShareViewFocus scrolls a link's alert group, Epic, Story or Planning row to the landing margin below the sticky stack (the margin focusCapture.js treats as the visible edge, so capturing again names the same target) and blinks it with the highlight class that already paints on that target. It never moves focus, never clears a filter, never opens Jira and stops on any deliberate input. The Planning review table now reads its initial Epics/Stories mode from the one-shot link seed, so a link's rows choice survives the first mount while any later mount resets like a user choice."
git show --stat HEAD
git status --short
make verify-dist-clean
```

Expected: `git show --stat HEAD` lists exactly eight files (`frontend/dist/dashboard.js`, `dashboard.js.map`, the renamed manifest, `PlanningReviewTable.jsx` with `3 +-`, `focusReveal.js`, the reveal and seed tests, and the UI spec); `git status --short` and `make verify-dist-clean` print nothing and exit 0.

## Notes for the executor

Decisions already settled while this slice was drafted; none changes a binding name in the master.

1. `revealIfHidden` is not reused and `planningConfirmedEdit.js` is untouched: `revealIfHidden` scrolls the minimum distance, measures with a list that names `.eng-filter-bar` (it left an Epic block under the sticky bar) and scrolls smoothly. `blinkElement` is reused. The `.eng-filter-bar` selector, which no element carries, is also in `alertEpicNavigation.js`; that pre-existing defect is left for a separate fix.
2. The reveal's `T` omits pinned Epic headers (counting the target's own header pushed it 36 px low); a Story target adds its own Epic header's height. Capture counts pinned Epic headers because they hide what is under them.
3. Capture and reveal share `SHARE_VIEW_FOCUS_MARGIN` (12): capture treats an element as visible only past `T + 12 + 1`, the reveal lands at `T + 12` with a 1 px tolerance, so a capture right after a reveal returns the same target. A target near the end of the page cannot reach `T + 12`.
4. No new highlight CSS: `epic-flash` paints on alert groups and Epic blocks, `task-highlight` on Story cards, `planning-review-confirmed` on Planning table rows (measured in Chromium and pinned by tests).
5. `focusCapture.js` also exports `alertCardId`, `measureShareViewStickyBottom` and `readPlanningRowsMode` (the Planning rows mode is the table's local state, so Task 11a's capture reads it with this export).
6. Seed hazards for Task 11b: a Planning table that is already mounted never reads the seed (the table is keyed and the seed is written at Stage C), and the one-shot initializer relies on one call per mount (the app has no `StrictMode`; the seed test fails with an explanation if one is added).
7. DOM-dependent tests import the ES modules directly: the modules read free `document` and `window` globals and `assert.deepEqual` rejects objects built in a `vm` realm. Test support files `tests/share_view_fake_dom.js` and `tests/share_view_alert_panel_fixture.js` are not named `test_*.js`, so `npm run test:frontend:unit` does not run them as tests.
8. `eng/PlanningReviewTable.jsx` imports `shareView/store.js`, and `shareView/` modules import `eng/` helpers; no rule in the ESLint config, `check_hook_interfaces.mjs` or the budget test forbids it. Keep `store.js` free of component imports to avoid a cycle.
9. One existing Planning UI spec (`the page scrolls to a moved row...` in `planning_review_table.spec.js`) is timing-flaky under load and passes alone.
