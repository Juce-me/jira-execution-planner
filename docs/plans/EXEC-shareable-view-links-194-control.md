# Shareable View Links Implementation Plan: Analytics and Share control (Tasks 10 and 12)

> **Status:** Proposed 2026-10-14. Slice of [EXEC-shareable-view-links-194.md](EXEC-shareable-view-links-194.md). Read the master's Global Constraints, Review Focus and Execution status before starting, and record each task's status and commit SHA in the master's Execution status table. Slices are grouped by area, not by execution order; the master's table gives the order.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`SUPPORT-shareable-view-links-design-194.md`](SUPPORT-shareable-view-links-design-194.md)

**Tasks in this slice:** Task 10 (analytics `share_view_action`) and Task 12 (Share control, notice and header surfaces, operator gate G2).

---

### Task 10: Analytics `share_view_action`

**Owner note:** Depends on Task 3 only for the directory `frontend/src/shareView/` (the new source guard scans it). Blocks Task 11 (the apply hook sends `apply_link` through `trackShareViewAction`, after `analyticsReady`) and Task 12 (the Share control sends `copy_link`). It does not touch `frontend/src/dashboard.jsx`, so no budget pin moves here.

**Files:**
- Modify: `frontend/src/analytics/events.js` (`EVENT_NAMES`)
- Modify: `frontend/src/analytics/dashboardAnalytics.js` (constants after `BOARD_SMALL_SCREEN_REASONS`; `buildShareViewActionParams` and `trackShareViewAction` after `trackBoardSmallScreenSupportRequest`; the `useDashboardAnalytics` return object)
- Modify: `docs/README_ANALYTICS.md` (taxonomy row after `board_action`; new `### Shareable View Links` subsection; three No-Event Allowlist rows; one Privacy Rules bullet)
- Modify: `docs/plans/SUPPORT-ga4-user-configuration.md` (revision note; Event Validation row; verification paragraph)
- Test: `tests/test_analytics_events.js`, `tests/test_analytics_source_guards.js`
- Unchanged by decision: `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` (no new dataLayer key is added, and the new test pins that it never mentions `share_view`)
- Regenerated: `frontend/dist/` (source under `frontend/src/` changes)

**What the code already does (read before editing; line numbers are hints):**
- `frontend/src/analytics/analytics.js` `pushDataLayer` (about line 70) returns without pushing unless `enabled && initialized`. `applyAnalyticsContext` (about line 109) sets `initialized = true` as its first statement and `enabled = true` only for an enabled context; `initAnalytics` (about line 140) returns after it.
- `useDashboardAnalytics` (`dashboardAnalytics.js` about lines 137 to 151) already keeps `analyticsReady` in React state and sets it in `.then` after `initAnalytics()` settles. The state therefore flips after `initialized` and never before: an event sent while it is `true` is never dropped for lack of initialization. It also becomes `true` when `GA4_ENABLED=false`, where the push is still dropped by design. The hook does not return it today; this task returns it and adds no second readiness flag.
- `EVENT_PARAMS` already holds `feature_name`, `workflow_action`, `result` and `source_surface`. `SAFE_STRING` accepts every Share token (`share_view`, `copy_link`, `apply_link`, `success`, `failure`, `partial`, `rejected`, `catch_up`, `planning`, `board`, `statistics`) and none of them matches the issue-key, URL, address or raw-text patterns, so `events.js` needs only the new `EVENT_NAMES` entry. `EVENT_PARAM_VALUE_ALLOWLISTS` is keyed by parameter name for every event (`result` also carries `changed`, `unchanged`, `conflict` and `unknown` elsewhere), so Share's enums cannot live there; they live in the builder, as `ISSUE_FIELD_EDIT_*` do.
- The GA4 MCP YAML maps dataLayer keys, not event names. `tests/test_analytics_source_guards.js` 'GA4 MCP YAML dataLayer variables match the app analytics allowlist' compares its `data_layer_variable_name` set with `EVENT_PARAMS` plus `DATA_LAYER_FIELDS`; no key is added, so that test and the YAML stay as they are.
- The README and the runbook are checked only by per-feature `includes(...)` and regex assertions (the `issue_field_edit_action`, `epic_refresh_action` and `module_id` cases); no existing test compares `EVENT_NAMES` with the taxonomy table. The new guard therefore asserts its own documentation strings, so the edits in Step 5 are what turn it green.
- `loadDashboardAnalyticsWithRecorder` in `tests/test_analytics_events.js` strips only `export function ` before it evaluates `dashboardAnalytics.js`, so both new exports must be `export function`, never `export const`.

**Analytics impact review** (the six questions in `docs/README_ANALYTICS.md` "Future Feature Rule"):
1. Decision supported: Share adoption and how often recipients resolve only partially, to decide whether stored links are worth building.
2. `trigger=userevent`, `event_type=event`, canonical `event_name=share_view_action`, `feature_name=share_view`; typed params `workflow_action` (`copy_link` or `apply_link`), `result` (`success` or `failure` for a copy; `success`, `partial` or `rejected` for an apply) and `source_surface` (`catch_up`, `planning`, `board`, `statistics`). Nothing else: no id, name, URL, query text, key or category list.
3. Tests: `tests/test_analytics_events.js` (four new cases), `tests/test_analytics_source_guards.js` (two new cases), `tests/ui/share_view_control.spec.js` (Task 12, the copy event in a real page) and the link-apply spec of Task 11.
4. Taxonomy: the `share_view_action` row after `board_action`, the `Shareable View Links` subsection, three No-Event Allowlist rows and one Privacy Rules bullet.
5. GA4 dimensions: all four params are already mapped by the shared `userevent` tag and already registered, so there is no new custom definition and no named-report reason to give.
6. GA4 admin, GTM and transport: unchanged. The runbook gains a revision note, an Event Validation row and a verification paragraph; the MCP YAML is untouched.

**Interfaces:**
- Consumes: `safeTrackEvent` (module-private), `JepAnalytics.trackEvent` -> `sanitizeAnalyticsParams` -> `pushDataLayer`.
- Produces:
```
buildShareViewActionParams({ workflowAction, result, sourceSurface }) -> { feature_name: 'share_view', workflow_action, result, source_surface } | null
trackShareViewAction({ workflowAction, result, sourceSurface }) -> void      // module export, and returned by useDashboardAnalytics
useDashboardAnalytics(React, options) -> { analyticsReady: boolean, trackShareViewAction, ...existing members }
```
- Contracts the later tasks must honor (this task edits none of their files):
  - The apply event is sent once, when the apply is terminal and `analyticsReady` is `true`; an earlier send is dropped, not queued. Its `sourceSurface` must always be one of the four values, or the builder returns `null` and nothing is sent: for a link whose mode never resolved (invalid, newer, dropped before resolution) pass the recipient's current ENG mode as `analyticsToken(activeEngMode)`.
  - The encoder never emits the GA4 site-search keys `q`, `s`, `search`, `query`, `keyword`; that assertion belongs to Task 3's codec test and is not repeated here.
  - Task 11 destructures the two new members where `dashboard.jsx` calls the hook. This task must not make that edit: two unused destructured names would add two ESLint warnings against the 106 ratchet. The exact edit for Task 11 (it changes no line count):

Replace this:
```
                trackSettingsAction, trackSortChanged, trackStatsAction, trackProductEvent,
            } = useDashboardAnalytics(React, { authMode, selectedView, showPlanning, showStats, showScenario, showBoard, serverConnectionError });
```
with this:
```
                trackSettingsAction, trackSortChanged, trackStatsAction, trackProductEvent, trackShareViewAction, analyticsReady,
            } = useDashboardAnalytics(React, { authMode, selectedView, showPlanning, showStats, showScenario, showBoard, serverConnectionError });
```

**Forbidden regressions for this task:**
- [ ] No new `EVENT_PARAMS` key, no new `DATA_LAYER_FIELDS` key, no change to the two-trigger contract (`pageview`, `userevent`) and no new GTM trigger.
- [ ] No `event_group`, `ga4_event_name`, Universal Analytics field or `has_*` dimension; no direct `gtag('event', ...)`.
- [ ] The `GA4_ENABLED` gate is unchanged: `pushDataLayer` still drops everything unless `enabled && initialized`.
- [ ] No URL, id, key, name, search text or category list can reach the payload.
- [ ] `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` and `frontend/src/dashboard.jsx` are not modified.

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/test_analytics_events.js` (after the last test, `Planning review analytics excludes every custom column and issue value`):

```js
test('share_view_action is a canonical userevent whose params accept only their fixed tokens', async () => {
    const { sanitizeAnalyticsParams, validateAnalyticsPayload } = await loadEvents();
    for (const [workflowAction, results] of [['copy_link', ['success', 'failure']], ['apply_link', ['success', 'partial', 'rejected']]]) {
        for (const result of results) {
            for (const sourceSurface of ['catch_up', 'planning', 'board', 'statistics']) {
                const params = { feature_name: 'share_view', workflow_action: workflowAction, result, source_surface: sourceSurface };
                assert.deepEqual(sanitizeAnalyticsParams(params, 'share_view_action'), params);
                assert.equal(validateAnalyticsPayload({
                    event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'share_view_action', ...params,
                }).event_name, 'share_view_action');
            }
        }
    }
    assert.throws(
        () => validateAnalyticsPayload({ event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'share_view_action' }),
        /feature_name is required/
    );
    // A link, id, key or name can never ride in any of the three free-valued params.
    const base = { feature_name: 'share_view', workflow_action: 'copy_link', result: 'success', source_surface: 'catch_up' };
    for (const value of ['http://localhost:5050/?v=1&mode=catch-up', '?v=1&group=dept%2Fa', 'v=1&sprint=4182', 'PROJ-123', 'Team Alpha', 'dept/a']) {
        for (const name of ['workflow_action', 'result', 'source_surface']) {
            assert.throws(
                () => sanitizeAnalyticsParams({ ...base, [name]: value }, 'share_view_action'),
                /unsafe analytics value/,
                `${name} must reject ${value}`
            );
        }
    }
    for (const forbiddenKey of ['url', 'group', 'sprint', 'teams', 'find', 'query', 'link_url', 'page_location']) {
        assert.throws(() => sanitizeAnalyticsParams({ ...base, [forbiddenKey]: 'catch_up' }, 'share_view_action'), /unsupported analytics parameter/);
    }
});

test('share view analytics builder emits only the fixed bounded contract', async () => {
    const { buildShareViewActionParams } = await loadDashboardAnalytics();
    const hostile = {
        url: 'https://example.invalid/?v=1&group=dept%2Fa&find=secret', groupId: 'dept/a', sprintId: '4182',
        teamNames: ['Alpha Team'], find: 'secret', issueKey: 'PROJ-1', categories: ['teams', 'filters'], dropped: ['find'],
    };
    assert.deepEqual(buildShareViewActionParams({ workflowAction: 'copy_link', result: 'success', sourceSurface: 'catch_up', ...hostile }), {
        feature_name: 'share_view', workflow_action: 'copy_link', result: 'success', source_surface: 'catch_up',
    });
    assert.deepEqual(buildShareViewActionParams({ workflowAction: 'apply_link', result: 'partial', sourceSurface: 'statistics', ...hostile }), {
        feature_name: 'share_view', workflow_action: 'apply_link', result: 'partial', source_surface: 'statistics',
    });
    for (const [workflowAction, results] of [['copy_link', ['success', 'failure']], ['apply_link', ['success', 'partial', 'rejected']]]) {
        for (const result of results) {
            for (const sourceSurface of ['catch_up', 'planning', 'board', 'statistics']) {
                assert.equal(buildShareViewActionParams({ workflowAction, result, sourceSurface })?.result, result);
            }
        }
    }
    for (const invalid of [
        { workflowAction: 'copy_link', result: 'partial', sourceSurface: 'board' },
        { workflowAction: 'copy_link', result: 'rejected', sourceSurface: 'board' },
        { workflowAction: 'apply_link', result: 'failure', sourceSurface: 'board' },
        { workflowAction: 'share', result: 'success', sourceSurface: 'board' },
        { workflowAction: '__proto__', result: 'success', sourceSurface: 'board' },
        { workflowAction: 'copy_link', result: 'success', sourceSurface: 'epm' },
        { workflowAction: 'copy_link', result: 'success', sourceSurface: 'scenario' },
        { workflowAction: 'copy_link', result: 'success', sourceSurface: 'stats' },
        { workflowAction: 'copy_link', result: 'success', sourceSurface: 'https://example.invalid/' },
        { workflowAction: 'copy_link', result: 'success' },
        { result: 'success', sourceSurface: 'board' },
        {},
        undefined,
    ]) {
        assert.equal(buildShareViewActionParams(invalid), null, JSON.stringify(invalid));
    }
});

test('share view action pushes one fixed userevent through the dataLayer and drops anything off-enum', async () => {
    const { initAnalytics } = await loadAnalytics();
    const { trackShareViewAction } = await loadDashboardAnalytics();
    resetDom();
    const pushed = [];
    global.window.dataLayer = { push: entry => pushed.push(entry) };
    await initAnalytics({ fetchContext: async () => ({ enabled: true }) });

    trackShareViewAction({ workflowAction: 'copy_link', result: 'failure', sourceSurface: 'board', url: 'https://example.invalid/?v=1&find=secret' });
    trackShareViewAction({ workflowAction: 'apply_link', result: 'failure', sourceSurface: 'board' });
    trackShareViewAction({ workflowAction: 'apply_link', result: 'partial', sourceSurface: 'epm' });

    assert.deepEqual(pushed, [{
        event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'share_view_action',
        feature_name: 'share_view', workflow_action: 'copy_link', result: 'failure', source_surface: 'board',
    }]);
});

test('useDashboardAnalytics exposes analyticsReady and trackShareViewAction; events sent before it flips are dropped', async () => {
    const { createRuntime } = require('./react_hook_harness');
    const { useDashboardAnalytics } = await loadDashboardAnalytics();
    for (const enabled of [true, false]) {
        resetDom();
        const pushed = [];
        global.window.dataLayer = { push: entry => pushed.push(entry) };
        let releaseContext;
        global.fetch = () => new Promise((resolve) => {
            releaseContext = () => resolve({ ok: true, json: async () => ({ enabled }) });
        });
        const runtime = createRuntime();
        const props = { authMode: 'oauth', selectedView: 'eng', showPlanning: false, showStats: false, showScenario: false, showBoard: false, serverConnectionError: '' };
        const render = () => {
            runtime.begin();
            const result = useDashboardAnalytics(runtime.react, props);
            runtime.commit();
            return result;
        };
        const shareEvents = () => pushed.filter(entry => entry.event_name === 'share_view_action');
        const outcome = { workflowAction: 'apply_link', result: 'success', sourceSurface: 'catch_up' };

        let hook = render();
        assert.equal(hook.analyticsReady, false);
        assert.equal(typeof hook.trackShareViewAction, 'function');
        hook.trackShareViewAction(outcome);
        assert.equal(shareEvents().length, 0, 'before the analytics context resolves the dataLayer drops the event');

        releaseContext();
        await new Promise(resolve => setTimeout(resolve, 0));
        hook = render();
        assert.equal(hook.analyticsReady, true, 'ready flips once initAnalytics has settled');
        hook.trackShareViewAction(outcome);
        // Ready is not enabled: GA4_ENABLED=false still drops by design.
        assert.equal(shareEvents().length, enabled ? 1 : 0);
        runtime.unmount();
        delete global.fetch;
    }
});
```

Append to the end of `tests/test_analytics_source_guards.js` (after the last test, `automatic freshness and its status projection remain passive and analytics-free`):

```js
test('share view analytics stays typed, private, documented and mapped through the two-trigger GTM contract', () => {
    const eventsSource = read('frontend/src/analytics/events.js');
    const dashboardAnalytics = read('frontend/src/analytics/dashboardAnalytics.js');
    const analyticsDoc = read('docs/README_ANALYTICS.md');
    const runbook = read('docs/plans/SUPPORT-ga4-user-configuration.md');
    const yaml = read('docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml');

    assert.ok(jsSetValues(eventsSource, 'EVENT_NAMES').has('share_view_action'));
    for (const token of [
        "['copy_link', new Set(['success', 'failure'])]",
        "['apply_link', new Set(['success', 'partial', 'rejected'])]",
        "new Set(['catch_up', 'planning', 'board', 'statistics'])",
    ]) assert.ok(dashboardAnalytics.includes(token), `Expected fixed Share enum ${token}`);
    const start = dashboardAnalytics.indexOf('export function buildShareViewActionParams');
    const end = dashboardAnalytics.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start, 'Expected to locate buildShareViewActionParams');
    for (const forbidden of ['url', 'URL', 'href', 'location', 'groupId', 'sprintId', 'teamId', 'teams', 'find', 'query', 'search', 'issueKey', 'categories', 'dropped', 'event_group', 'ga4_event_name', 'has_']) {
        assert.equal(dashboardAnalytics.slice(start, end).includes(forbidden), false, `Builder must omit ${forbidden}`);
    }

    // No new dataLayer key: the four params are already mapped by the shared userevent tag, so the MCP YAML is untouched.
    for (const key of ['feature_name', 'workflow_action', 'result', 'source_surface']) {
        assert.ok(jsSetValues(eventsSource, 'EVENT_PARAMS').has(key));
        assert.match(yaml, new RegExp(`data_layer_variable_name: "${key}"`));
    }
    assert.doesNotMatch(yaml, /share_view/);

    assert.ok(analyticsDoc.includes('| `share_view_action` |'));
    assert.ok(analyticsDoc.includes('`feature_name=share_view`'));
    assert.ok(analyticsDoc.includes('Share adoption and how often recipients resolve only partially, to decide whether stored links are worth building'));
    assert.ok(analyticsDoc.includes('### Shareable View Links'));
    assert.ok(analyticsDoc.includes('link queries never reach GA4'));
    for (const row of ['Share link URL strip before analytics initializes', 'Share notice (apply result and Share copy failures)', 'Share fallback link field']) {
        assert.ok(analyticsDoc.includes(`| ${row}`), `Expected no-event allowlist row for ${row}`);
    }
    assert.ok(runbook.includes('`share_view_action`'));
    assert.match(runbook, /Do not register new custom dimensions for Share[^.]*already registered/i);
});

test('share view source reaches analytics only through the fixed Share builder', () => {
    const offenders = listSourceFiles(path.join(repoRoot, 'frontend', 'src', 'shareView'))
        .filter(filePath => /dataLayer|gtag\s*\(|JepAnalytics|trackProductEvent|trackEvent\s*\(|analytics\/analytics\.js/.test(fs.readFileSync(filePath, 'utf8')))
        .map(filePath => path.relative(repoRoot, filePath));
    assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
fnm exec --using 20 node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js 2>&1 | grep -E '^(not ok|# (tests|pass|fail))'
```
Expected: five `not ok` lines and `# tests 83`, `# pass 78`, `# fail 5` (47 and 30 existing cases plus six new). The failing cases and their causes: `share_view_action is a canonical userevent whose params accept only their fixed tokens` (`unsupported analytics event_name: share_view_action`); `share view analytics builder emits only the fixed bounded contract` (`buildShareViewActionParams is not a function`); `share view action pushes one fixed userevent through the dataLayer and drops anything off-enum` (`trackShareViewAction is not a function`); `useDashboardAnalytics exposes analyticsReady and trackShareViewAction; events sent before it flips are dropped` (`Expected values to be strictly equal: + actual - expected + undefined - false`, because `analyticsReady` is not returned yet); and `share view analytics stays typed, private, documented and mapped through the two-trigger GTM contract` (the first assertion, `EVENT_NAMES` must contain `share_view_action`). `share view source reaches analytics only through the fixed Share builder` already passes: it guards code that does not exist yet.

- [ ] **Step 3: Implement the event name and the builder**

In `frontend/src/analytics/events.js`, inside `EVENT_NAMES`:

Replace this:
```js
    'epic_refresh_action',
    'board_action',
    'external_link_opened',
```
with this:
```js
    'epic_refresh_action',
    'board_action',
    'share_view_action',
    'external_link_opened',
```

In `frontend/src/analytics/dashboardAnalytics.js`, constants after `BOARD_SMALL_SCREEN_REASONS`:

Replace this:
```js
const BOARD_SMALL_SCREEN_REASONS = new Set(['short', 'narrow', 'touch']);
```
with this:
```js
const BOARD_SMALL_SCREEN_REASONS = new Set(['short', 'narrow', 'touch']);
const SHARE_VIEW_RESULTS = new Map([
    ['copy_link', new Set(['success', 'failure'])],
    ['apply_link', new Set(['success', 'partial', 'rejected'])],
]);
const SHARE_VIEW_SURFACES = new Set(['catch_up', 'planning', 'board', 'statistics']);
```

In the same file, after `trackBoardSmallScreenSupportRequest`:

Replace this:
```js
// The Board's small-screen alert button; the fixed builder drops any unknown reason.
export function trackBoardSmallScreenSupportRequest(reason) {
    const payload = buildBoardSmallScreenSupportParams(reason);
    if (payload) safeTrackEvent('board_action', payload);
}
```
with this:
```js
// The Board's small-screen alert button; the fixed builder drops any unknown reason.
export function trackBoardSmallScreenSupportRequest(reason) {
    const payload = buildBoardSmallScreenSupportParams(reason);
    if (payload) safeTrackEvent('board_action', payload);
}

// Share control: one copy event per click and one apply event per opened link. The fixed builder
// carries enum tokens only and returns null, so nothing is sent, for any other value.
export function buildShareViewActionParams({ workflowAction, result, sourceSurface } = {}) {
    if (!SHARE_VIEW_RESULTS.get(workflowAction)?.has(result) || !SHARE_VIEW_SURFACES.has(sourceSurface)) return null;
    return {
        feature_name: 'share_view',
        workflow_action: workflowAction,
        result,
        source_surface: sourceSurface,
    };
}

export function trackShareViewAction(params) {
    const payload = buildShareViewActionParams(params);
    if (payload) safeTrackEvent('share_view_action', payload);
}
```

In `useDashboardAnalytics`, the returned object (two edits):

Replace this:
```js
    return {
        bucketCount,
        currentDashboardView,
        trackAppError,
```
with this:
```js
    return {
        analyticsReady,
        bucketCount,
        currentDashboardView,
        trackAppError,
```

Replace this:
```js
        trackSettingsAction,
        trackSortChanged,
```
with this:
```js
        trackSettingsAction,
        trackShareViewAction,
        trackSortChanged,
```

- [ ] **Step 4: Run the tests; the code cases pass and only the documentation assertion is left**

```bash
fnm exec --using 20 node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js 2>&1 | grep -E '^(not ok|# (tests|pass|fail))'
```
Expected: one `not ok` (`share view analytics stays typed, private, documented and mapped through the two-trigger GTM contract`, failing on `assert.ok(analyticsDoc.includes('| `share_view_action` |'))`) and `# tests 83`, `# pass 82`, `# fail 1`. The four `test_analytics_events.js` cases are green: `test_analytics_events.js` alone reports `# tests 51`, `# pass 51`.

- [ ] **Step 5: Update the analytics contract and the runbook**

In `docs/README_ANALYTICS.md`, the taxonomy row after `board_action` (the Decision/use column carries the decision supported):

Replace this:
```markdown
| browser | Demand for small-screen Board support |
| `api_result` |
```
with this:
```markdown
| browser | Demand for small-screen Board support |
| `share_view_action` | `feature_name=share_view`, `workflow_action` (`copy_link`\|`apply_link`), `result` (`copy_link`: `success`\|`failure`; `apply_link`: `success`\|`partial`\|`rejected`), `source_surface` (`catch_up`\|`planning`\|`board`\|`statistics`) | One click of the header Share control (`copy_link`: `success` once the URL reached the clipboard, also when optional keys that exceeded the length cap were left out; `failure` when the URL is refused as too long or invalid, or the clipboard is unavailable or rejects the write and the notice shows the read-only URL field instead), and one terminal outcome per opened link (`apply_link`, sent once and only after analytics is ready: `success` every key applied, `partial` some keys skipped, `rejected` invalid, dropped or cancelled). The four enum params are the whole payload: never ids, names, URLs, query text, issue keys or notice categories, and never `epm` or `scenario` as `source_surface` because Share is hidden there. Applying a link uses raw setters that emit no `filter_changed`, `select_content` or `sort_changed`; effect-driven `page_view` (a mode change), `app_search` (a non-empty `find`, length bucket only) and `api_result` still fire exactly as for manual navigation. No new parameter key and no custom definition | `frontend/src/shareView/ShareViewButton.jsx`, `frontend/src/shareView/useShareViewApply.js`, `frontend/src/analytics/dashboardAnalytics.js` | browser | Share adoption and how often recipients resolve only partially, to decide whether stored links are worth building |
| `api_result` |
```

In the same file, a short subsection before `### No-Event Allowlist`, plus the three new rows at the top of that table (rows are newest first):

Replace this:
```markdown
### No-Event Allowlist

These user-visible changes intentionally do not add a new app-owned `userevent`; the reason is documented here so future feature reviews do not re-add duplicate or sensitive analytics.

| Feature action | Primary anchors | Reason | Reviewed on |
| --- | --- | --- | --- |
```
with this:
```markdown
### Shareable View Links

The header Share control and an opened link use canonical `share_view_action` on the existing `userevent` transport (`trigger=userevent`, `event_type=event`). The fixed builder `buildShareViewActionParams` in `frontend/src/analytics/dashboardAnalytics.js` accepts only `workflow_action`, `result` and `source_surface` from closed sets, adds `feature_name=share_view`, and sends nothing for any other value, so a URL, id, name, search text or issue key cannot reach the payload. It measures Share adoption (`copy_link`) and how often a recipient's link resolves only partially (`apply_link` with `result=partial`).

Events sent before analytics initializes are dropped, so the apply outcome waits for `analyticsReady` from `useDashboardAnalytics` (`GA4_ENABLED=false` still drops it by design). Link queries never reach GA4: the app removes `v` and every link key from the address bar with `history.replaceState` before React mounts, which is before analytics initializes and before Google Tag Manager is appended, so the first `page_location` carries no link state; app code never overrides `page_location`. The search text key is `find`, never `q`, `s`, `search`, `query` or `keyword`, so GA4 Enhanced Measurement site search cannot read it. All four parameters are already mapped through the shared GTM tag and registered as custom dimensions, so no GTM, GA4 admin or MCP YAML change is needed.

### No-Event Allowlist

These user-visible changes intentionally do not add a new app-owned `userevent`; the reason is documented here so future feature reviews do not re-add duplicate or sensitive analytics.

| Feature action | Primary anchors | Reason | Reviewed on |
| --- | --- | --- | --- |
| Share link URL strip before analytics initializes | `frontend/src/shareView/entry.js` | Passive privacy control: trigger none; `event_type=none`; `event_name=none`; `feature_name=share_view`; typed params none. Removing `v` and the link keys with `history.replaceState` runs before React mounts, so the first GA4 page location carries no link query and no link value is ever an event parameter. The only analytics for a link is its one `apply_link` `share_view_action`. No GA4 runbook change beyond the Share rows. | 2026-10-14 |
| Share notice (apply result and Share copy failures) and the copied-state icon swap | `frontend/src/shareView/ShareViewButton.jsx` | Presentation of outcomes already counted by `share_view_action` (`apply_link` partial or rejected, `copy_link` failure): trigger none; `event_type=none`; `event_name=none`; `feature_name=share_view`; typed params none. Showing, reading or dismissing the notice adds no event, and the unapplied categories it names are never sent. | 2026-10-14 |
| Share fallback link field (read-only URL shown when the clipboard is unavailable or rejects the write) | `frontend/src/shareView/ShareViewButton.jsx` | Browser-local fallback: trigger none; `event_type=none`; `event_name=none`; `feature_name=share_view`; typed params none. The click is already counted as `copy_link` `failure`; selecting or copying the URL from the field emits nothing, and the URL is never placed in any event. | 2026-10-14 |
```

In the same file, one bullet in `## Privacy Rules`:

Replace this:
```markdown
- Forbidden keys are scrubbed in the analytics wrapper and checked again by tests.
```
with this:
```markdown
- Forbidden keys are scrubbed in the analytics wrapper and checked again by tests.
- Shareable view links: link queries never reach GA4. The address-bar strip runs before analytics initializes, `share_view_action` carries four fixed enum params only, and the search key `find` avoids the GA4 site-search defaults; see Shareable View Links.
```

In `docs/plans/SUPPORT-ga4-user-configuration.md`, the revision note (first item of `**Revision notes:**`):

Replace this:
```markdown
**Revision notes:**
- 2026-09-30: Added the ENG per-Epic refresh event
```
with this:
```markdown
**Revision notes:**
- 2026-10-14: Added the Share control event (`share_view_action`). Its four params (`feature_name`, `workflow_action`, `result`, `source_surface`) are already mapped through the existing `userevent` tag and already registered, so no new parameter key, custom definition, trigger or MCP YAML change is required. Link queries never reach GA4; the verification paragraph below covers the page-location and site-search checks.
- 2026-09-30: Added the ENG per-Epic refresh event
```

The Event Validation row (the runbook's table of user actions, expected GA4 events and forbidden values; it has no table named "Use"), after the `board_action` row:

Replace this:
```markdown
| Request Board small-screen support | `board_action` | `feature_name=eng_board`, `workflow_action=small_screen_support_request`, `reason=short\|narrow\|touch`, `source_surface=board` | viewport sizes, group/column ids or names, free text |
```
with this:
```markdown
| Request Board small-screen support | `board_action` | `feature_name=eng_board`, `workflow_action=small_screen_support_request`, `reason=short\|narrow\|touch`, `source_surface=board` | viewport sizes, group/column ids or names, free text |
| Copy a Share link, or open one | `share_view_action` | `feature_name=share_view`, `workflow_action=copy_link\|apply_link`, `result=success\|failure` (copy) or `success\|partial\|rejected` (apply), `source_surface=catch_up\|planning\|board\|statistics` | link URL or query string, group, Team or Sprint ids or names, search text, issue keys, notice categories |
```

The verification paragraph, after the Board small-screen paragraph:

Replace this:
```markdown
Do not register `reason` as a custom dimension without a named report.
```
with this:
```markdown
Do not register `reason` as a custom dimension without a named report.

For Share links, verify exactly one `share_view_action` per Share click (`workflow_action=copy_link`) and exactly one per opened link (`workflow_action=apply_link`), each carrying only the four documented params and mapped through the single `CE - userevent` trigger. Open a link whose search text is non-empty and confirm the first `page_view` and every later hit show a page location without `v=`, `mode=`, `group=`, `sprint=` or `find=`, and that no `view_search_results` event fires. Do not register new custom dimensions for Share: `feature_name`, `workflow_action`, `result` and `source_surface` are already registered, so build the adoption and partial-rate view in Explore from them.
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
fnm exec --using 20 node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js 2>&1 | grep -E '^(not ok|# (tests|pass|fail))'
```
Expected: no `not ok`; `# tests 83`, `# pass 83`, `# fail 0`.

- [ ] **Step 7: Run the task's regression gate**

```bash
fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^(not ok|# (tests|pass|fail))'
fnm exec --using 20 bash scripts/extraction_lint/run.sh 2>&1 | tail -4
```
Expected: the Node suite reports no `not ok` and `# tests` equal to the previous task's total plus 6 (4 in `test_analytics_events.js`, 2 in `test_analytics_source_guards.js`; the total was 2,477 at `bd5b2bc2` before any task of this plan). The script's mode is 644 in git, so `scripts/extraction_lint/run.sh` alone fails with `Permission denied`; run it through `bash`. The lint tail shows `0 errors`, warnings at or below the 106 ratchet (104 at `bd5b2bc2`) and `owner budgets: 0 problems`. `docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` is unchanged (`git diff --stat -- docs/plans/SUPPORT-ga4-gtm-mcp-execution.yaml` prints nothing).

- [ ] **Step 8: Rebuild the frontend output**

```bash
npm run build
git status --short frontend/dist
```
Expected: the build prints `Dashboard built: <64 hex>` and no error; `git status --short frontend/dist` lists the regenerated files (the entry bundle, the shared chunks whose content hash changed, and the renamed `lazy-views-*.json`; the build ID hashes every `frontend/src` file). Build before committing: `tests/test_scenario_draft_history_source_guards.js` fails any working tree where `frontend/dist` has changes and `frontend/src` has none, so never commit the source and the output separately.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/analytics/events.js frontend/src/analytics/dashboardAnalytics.js docs/README_ANALYTICS.md docs/plans/SUPPORT-ga4-user-configuration.md tests/test_analytics_events.js tests/test_analytics_source_guards.js
git add -A frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add share_view_action analytics event and analyticsReady" -m "The Share control and an opened link need one privacy-safe event with fixed enums. Events sent before analytics initializes are dropped, so the hook now returns analyticsReady for the apply outcome to wait on. No new parameter key, trigger or custom definition; the GA4 MCP YAML is unchanged."
git show --stat HEAD
git status --short
make verify-dist-clean
```
Expected: the six source, documentation and test files plus the regenerated `frontend/dist` files; `git status --short` prints nothing; `make verify-dist-clean` prints nothing and exits 0 (it reads `git status --porcelain -- frontend/dist`, so it passes only after the commit).

### Task 12: Share control, notice and header surfaces

**Owner note:** Depends on Task 3 (`SHARE_VIEW_CATEGORY_BY_KEY`), Task 10 (`trackShareViewAction`) and Task 11 (`const shareView = useShareViewApply(...)` in `dashboard.jsx`). Blocks Task 13 (documentation) and Task 14 (journeys and the headed Firefox and WebKit run). Operator gate G2 sits inside this task: Steps 1 and 2 build and show the mock; Steps 3 to 12 run only once the acceptance line below holds a real date.

**Gate G2 (operator):** Operator acceptance: pending

Replace `pending` with the date of the operator's acceptance in chat, quoting their words, in this task's section of `docs/plans/EXEC-shareable-view-links-194-control.md`. Never write the date on the operator's behalf. If the line still reads `pending`, stop after Step 2 and report.

**Files:**
- Create: `assets/mockups/share-view-control-194.html` (generated in Step 1; committed once accepted)
- Create: `frontend/src/shareView/ShareViewButton.jsx`, `frontend/src/shareView/noticeCopy.js`
- Create: `tests/test_share_view_control.js`, `tests/ui/share_view_control_harness.jsx`, `tests/ui/share_view_control.spec.js`
- Modify: `frontend/src/dashboard.jsx` (import; `renderShareViewControl` before `renderEpmControls`; one call in `.header-actions-row`; one call in `.compact-sticky-header`)
- Modify: `frontend/src/styles/shared/controls.css` (three selector lists and one rule next to the header icon-button rules)
- Modify: `tests/ui/codebase_structure_smoke.spec.js` (the existing header assertions, seven edits)
- Modify: `tests/test_codebase_structure_budgets.py`, `scripts/extraction_lint/owner_budgets.json` (the `dashboard.jsx` pins, same commit)
- Modify: `docs/plans/EXEC-shareable-view-links-194-control.md` (the gate line above)
- Regenerated: `frontend/dist/`
- Not committed (`tmp/` is gitignored): `tmp/share-view-mock/generate.mjs`, `tmp/share-view-mock/shots.mjs` and their PNGs
- Not touched: `frontend/src/eng/EngControls.jsx`, `frontend/src/components/*`, `frontend/src/ui/IconButton.jsx`, `frontend/src/styles/eng/loading.css`, every registered owner module under `scenario/`, `settings/` and `epm/`

**Interfaces:**
- Consumes (Task 11, binding): `shareView = { notice: null | { kind: 'dropped' | 'partial' | 'invalid' | 'newer', categories: string[] }, dismissNotice(), captureShareUrl() -> { ok: true, url, dropped: string[] } | { ok: false, reason: 'disabled' | 'too_long' | 'invalid_state' }, shareDisabled: boolean, applyTerminal: boolean }`.
- Consumes (Task 10): `trackShareViewAction({ workflowAction, result, sourceSurface })`, imported as a module function (the same pattern as `trackBoardSmallScreenSupportRequest` in `EngBoardView.jsx`).
- Consumes (Task 3): `SHARE_VIEW_CATEGORY_BY_KEY` from `frontend/src/shareView/viewDefaults.js`, a frozen plain object keyed by query key (`find`, `alertTeam`, `alerts`, `epic`, `story`, `initiatives`, `sort`, ...).
- Consumes (existing): `IconButton` (`variant="secondary compact"`), the header icon-button rules in `shared/controls.css`, the banner rules `.server-unavailable-banner`, `.connection-recovery-notice`, `.connection-recovery-notice-actions` in `eng/loading.css`, `.search-input`, `.planning-review-sr-only`, `activeControlSurface`, `activeEngMode`, `analyticsToken` in `dashboard.jsx`.
- Produces:
```
<ShareViewButton surface="main" | "compact" share={shareView} sourceSurface={analyticsToken(activeEngMode)} activeControlSurface={activeControlSurface} />
shareViewNoticeMessage(notice) -> string          // apply result copy; '' for an unknown kind
shareViewCopyMessage({ type: 'copied' | 'manual' | 'refused', reason?, dropped? }) -> string
shareViewDroppedCategories(dropped) -> string[]   // notice categories of the encoder's dropped keys
DOM hooks: .share-view, .share-view-button, .share-view-notice, [data-share-view-icon="link" | "copied"]
accessible name: "Copy link to this view"
```
  `ShareViewButton` renders `share.notice` itself, on the surface that is showing. Task 11 must not mount a second notice in `dashboard.jsx`.

**Visual specification (what the mock shows and which test pins it):**

| State | Mock section | Pinned by |
| --- | --- | --- |
| Default, hover | Main header: default (hover it; the page prints the computed size, radius and background live) | harness contract and hover cases; the Node markup contract |
| Copied | Main header: copied (check glyph for two seconds, same 38 by 38 frame) | harness copy case; the painted-ink case |
| Disabled | Main header: disabled | harness disabled case; the Node markup contract |
| Apply notice | partial; group not available | the harness apply-notice table (exact strings) |
| Copy fallback and over-cap | read-only field; categories named | harness fallback and dropped cases |
| Compact surface | compact default; compact refusal notice | harness contract (compact computes what main computes); smoke compact assertions; app swap case |

**Exact user-facing copy** (it names categories, never values; the strings live in `noticeCopy.js` and are pinned by the Node test and by the harness cases; category labels: `group` Department group, `sprint` Sprint, `mode` view mode, `teams` Teams, `filters` filters, `focus` highlighted item, always listed in that order):

| Source | When | Text |
| --- | --- | --- |
| Apply `dropped` | categories include `group` | `This link was not applied: its Department group is not available to you.` |
| Apply `dropped` | categories include `sprint` | `This link was not applied: its Sprint is not available to you.` |
| Apply `dropped` | both | `This link was not applied: its Department group and Sprint are not available to you.` |
| Apply `dropped` | neither (no categories, or others) | `This link could not be applied right now, so your view was left as it was.` |
| Apply `partial` | for example `teams`, `filters` | `Part of this link was not applied: Teams and filters. Everything else was applied.` |
| Apply `invalid` | any | `This link is not valid, so it was not applied. Ask the sender to copy it again.` |
| Apply `newer` | any | `This link was made with a newer version of the app, so it was not applied. Update the app and open the link again.` |
| Copy, keys left out to fit the cap | the clipboard write succeeded | `Link copied, without some details to keep it short: filters and highlighted item.` |
| Copy fallback | `navigator.clipboard` missing or the write rejected | `The browser did not allow copying. Select the link below and copy it.` plus, when keys were left out, ` Left out to keep it short: filters.`; the notice also holds the read-only URL field |
| Copy refusal | `too_long` | `This view has too many selections to fit in one link, so nothing was copied.` |
| Copy refusal | `invalid_state` | `This view cannot be shared as a link right now, so nothing was copied.` |
| Control | always | accessible name `Copy link to this view`; disabled title `Sharing is available once the view has loaded`; hidden status text `Link copied`; field label `Link to copy`; button `Dismiss` |

**Decision: which existing notice is reused (evidence):**

| Candidate | Evidence | Verdict |
| --- | --- | --- |
| `ConnectionRecoveryNotice` (`.server-unavailable-banner.connection-recovery-notice`, `role="status"`, a `<p>` and `.connection-recovery-notice-actions`; its `settings_discarded` kind offers `Dismiss`; `blocked_scope`, built in `frontend/src/scenario/connectionScenarioRecovery.js`, is the precedent for a scope that cannot be restored: its message says the group or sprint is not active) | `frontend/src/components/ConnectionRecoveryNotice.jsx`; rules and mobile stacking in `frontend/src/styles/eng/loading.css` lines 105 to 175, including a banner button hover that stays light | Reused: its classes, anatomy, `Dismiss` label and CSS. The component itself is not reused: it is bound to the connection-recovery kinds and their Recover and Discard actions and sits under recovery source guards, so reusing its classes leaves that path untouched |
| `ServerUnavailableBanner` | same file family; `role="alert"`, error title, a Retry action | Same CSS base, wrong semantics for an information notice |
| `.board-scope-status` | `dashboard.jsx` (Board scope and Sprint catalog status); no rule of its own, it wraps `EmptyState` | A blocking-state placeholder, not a notice |
| `.jira-export-toast` | `JiraExportButton.jsx`, `styles/eng/export.css` | The only header-anchored feedback, but transient (4.5 s), text only and Jira-named; informs the anchoring, not reused |
| `.story-readiness-notice`, `.planning-review-guidance`, `.group-modal-warning` | EngAlertsPanel, PlanningReviewTable, settings modals | Scoped inside panels, tables and modals |

Mounting the banner in flow like `ConnectionRecoveryNotice` fails for this control. Measured in the shared ENG fixture (`tests/ui/eng_epic_refresh_fixture.js`) at 1440 by 900: the header bottom is at 146 px, the Share control's bottom at 59 px, and an in-flow banner (it renders after the filter bar, which spans 155 to 211 px) is above the viewport for any scroll beyond about 170 px, while the compact header appears at 146 px. A copy failure from the compact control, or a partial-apply notice after Stage D's reveal scroll, would be invisible. So the notice is the same banner anchored under the control it belongs to (one rule, `.share-view-notice`, that changes placement only), rendered by whichever surface is showing. Cost to confirm at the gate: while open it covers the right part of the controls row (the ENG mode control at 1440 px) until Dismiss.

Also measured in that fixture, for the operator's review: with Share, the compact header changes nothing at 1028 px and wider; at 761 px the Sprint and Teams controls are 21 and 16 px narrower; at 600 px they go from 19 and 14 px wide to 0 (at 390 px they were already 0). The header height and every sticky offset are unchanged except that, with the ENG/EPM switch present, the main header wraps to a second line at about 900 px (132 px to 164 px high). There is a band of scroll offsets with no Share control in the viewport: it leaves at 59 px and the compact header appears at 146 px. "Exactly one visible" therefore holds as "never two, and the compact control takes over exactly when the compact header shows".

**Forbidden regressions for this task:**
- [ ] The existing header assertions in `codebase_structure_smoke.spec.js` (geometry, `.refresh-icon + .group-gear-button` adjacency, the freshness cases) pass with only the intended edits; sticky offsets and compact-header height are unchanged (MRT009).
- [ ] No new hover rule and no local variant of the shared header icon button (MRT020, MRT021); the banner keeps its own layout and surface.
- [ ] Touch: every action works by tap; nothing needs a drag. Keyboard-only polish stays parked (Escape to dismiss, focus return) and is handed to Task 13 for `docs/TODO.md`.
- [ ] No new `window.addEventListener('keydown', ...)`; no new request; no write; no Jira, Home or service-credential path.
- [ ] `frontend/src/dashboard.jsx` grows by exactly 7 lines and its pins move in the same commit.

- [ ] **Step 0: Confirm the preconditions and read the rules**

```bash
rg -n "SHARE_VIEW_CATEGORY_BY_KEY" frontend/src/shareView/viewDefaults.js
rg -n "export function trackShareViewAction|analyticsReady," frontend/src/analytics/dashboardAnalytics.js
rg -n "const shareView = useShareViewApply\(" frontend/src/dashboard.jsx
git status --short
```
Expected: `viewDefaults.js` exports `SHARE_VIEW_CATEGORY_BY_KEY`; the analytics module exports `trackShareViewAction` and returns `analyticsReady`; exactly one `const shareView = useShareViewApply(` line; a clean tree. If any is missing the plan is stale: stop and report. Read `docs/postmortem/MRT009-sticky-layering-regressions.md`, `MRT020-project-track-filter-bar-bespoke-controls.md`, `MRT021-project-track-segmented-control-override.md` and `MRT029-eng-alert-style-reinvention.md` (the lessons applied here: no sticky offset change, reuse the shared control and its class hooks, neutralize the global button surface, assert computed hover) and record "read" in the status row.

- [ ] **Step 1: Generate the mock (verbatim repository CSS, synthetic data)**

The mock inlines `frontend/dist/dashboard.css` verbatim plus exactly the CSS this task adds, server-renders the neighbouring controls from the real components, and carries the Share markup that Step 5 implements (`<!-- fragment:... -->` markers let a test compare it with the component). `tmp/` is gitignored (`git check-ignore -v tmp/x` prints the `.gitignore` rule). Create `tmp/share-view-mock/generate.mjs`:

```js
// Throwaway generator for assets/mockups/share-view-control-194.html (tmp/ is gitignored; the generated mock is committed).
// Usage from the repository root:  node tmp/share-view-mock/generate.mjs
// The page inlines frontend/dist/dashboard.css verbatim, plus exactly the CSS Task 12 adds (three selector-list additions and
// one rule, shown here in the built stylesheet's formatting). Neighbouring controls are server-rendered from the real components; the Share control
// markup is the contract Task 12 implements and tests against.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require('react-dom/server');
const root = process.cwd();

// ---- 1. verbatim stylesheet plus the proposed CSS --------------------------------------------------------------------
let css = fs.readFileSync(path.join(root, 'frontend/dist/dashboard.css'), 'utf8');
const edits = [
    ['.header-actions-row button.header-icon-button {\n  width: var(--control-height);',
        '.header-actions-row button.header-icon-button,\n.compact-sticky-header button.header-icon-button {\n  width: var(--control-height);'],
    ['.header-actions-row button.header-icon-button:hover {\n  color: var(--text-primary);',
        '.header-actions-row button.header-icon-button:hover,\n.compact-sticky-header button.header-icon-button:hover {\n  color: var(--text-primary);'],
    ['.header-actions-row button.header-icon-button svg {\n  width: 18px;\n  min-width: 18px;\n  height: 18px;\n  flex: none;\n}\n',
        `.header-actions-row button.header-icon-button svg,
.compact-sticky-header button.header-icon-button svg {
  width: 18px;
  min-width: 18px;
  height: 18px;
  flex: none;
}
/* Share notice: the shared banner (eng/loading.css) anchored under the Share control, so it stays
   visible on both header surfaces. It anchors to the nearest positioned ancestor (the main
   header's .subtitle or the sticky compact header), so it never leaves the viewport. The
   typography reset undoes the uppercase, tracked text .subtitle passes down. */
.share-view-notice {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: calc(var(--sticky-control-overlay-z) + 4);
  width: min(26rem, 100%);
  margin: 0;
  box-shadow: 0 12px 28px rgba(22, 22, 22, 0.14);
  text-transform: none;
  letter-spacing: normal;
}
`],
];
for (const [before, after] of edits) {
    if (css.split(before).length !== 2) throw new Error(`Built stylesheet does not contain exactly one: ${before.split('\n')[0]}`);
    css = css.replace(before, () => after);
}

// ---- 2. real neighbouring controls, server-rendered ----------------------------------------------------------------
const bundled = esbuild.buildSync({
    stdin: {
        contents: `
            import * as React from 'react';
            import { SearchControl, SprintControl, TeamControl } from './frontend/src/eng/EngControls.jsx';
            import EngModeControl from './frontend/src/eng/EngModeControl.jsx';
            import JiraExportButton from './frontend/src/components/JiraExportButton.jsx';
            import IconButton from './frontend/src/ui/IconButton.jsx';
            const noop = () => {};
            const ref = () => ({ current: {} });
            const controlProps = (surface) => ({
                surface, extraClassName: surface === 'compact' ? 'compact-sticky-header-search-field' : '', searchActive: false, searchInput: '', setSearchInput: noop, setSearchFocused: noop, searchInputRef: { current: null },
                selectedView: 'eng', boardStrictScope: '', sprintName: '2026Q2 Sprint 42', selectedSprint: '1', sprintsLoading: false, engSprintSelectorState: { ordinarySelectable: true },
                engWorkspaceConfigured: true, getSprintSelectorOptions: () => [], sprintActiveOptionIndex: 0, showSprintDropdown: false, activeControlSurface: surface, closeSprintSelector: noop,
                setShowSprintDropdown: noop, setSprintActiveOptionIndex: noop, sprintSelectorOriginRef: ref(), commitSprintSelectorOption: noop, sprintDropdownRefs: ref(), sprintSearch: '',
                setSprintSearch: noop, sprintOptionDomId: (value) => 'sprint-' + value, sprintTriggerRefs: ref(), openSprintSelector: noop, availableSprints: [{ id: '1' }],
                teamDropdownRefs: ref(), showTeamDropdown: false, isAllTeamsSelected: true, tasks: [{}], loading: false, teamDropdownQuery: '', setTeamDropdownQuery: noop,
                setShowTeamDropdown: noop, selectedTeamsLabel: 'All Teams', longestTeamOptionLabel: 'All Teams', filteredTeamOptions: [], selectedTeamSet: new Set(['all']), toggleTeamSelection: noop,
                applyExclusiveDropdownState: noop,
            });
            const refreshIcon = <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/><path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
            const gearIcon = <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/><path d="M19.4 12a7.5 7.5 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.1-1.2l-.4-2.6H9.6l-.4 2.6a7.4 7.4 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0-.1 1.2c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2l.4 2.6h4.8l.4-2.6c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
            export const parts = {
                searchMain: <SearchControl {...controlProps('main')} />,
                searchCompact: <SearchControl {...controlProps('compact')} />,
                sprintMain: <SprintControl {...controlProps('main')} />, sprintCompact: <SprintControl {...controlProps('compact')} />,
                teamMain: <TeamControl {...controlProps('main')} />, teamCompact: <TeamControl {...controlProps('compact')} />,
                mode: <EngModeControl activeMode="catch-up" isCompletedSprintSelected={false} isFutureSprintSelected={false} onChange={noop} selectedSprint="1" />,
                jira: <JiraExportButton jiraUrl="https://jira.example" epicKeys={['SYN-1']} className="jira-export-header" />,
                refresh: <IconButton variant="secondary compact" className="header-icon-button refresh-icon" title="Refresh tasks and sprints from Jira" aria-label="Refresh tasks and sprints from Jira">{refreshIcon}</IconButton>,
                gear: <button className="header-icon-button group-gear-button" title="Manage team groups" aria-label="Manage team groups" type="button">{gearIcon}</button>,
            };
        `,
        resolveDir: root,
        loader: 'jsx',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'],
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', bundled)(mod, mod.exports, require);
const html = Object.fromEntries(Object.entries(mod.exports.parts).map(([key, element]) => [key, renderToStaticMarkup(element)]));

// ---- 3. the Share control contract (what Task 12's ShareViewButton renders) -----------------------------------------
const LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="link"><g transform="rotate(-45 12 12)" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 7.5H7a4.5 4.5 0 0 0 0 9h2.5"></path><path d="M14.5 7.5H17a4.5 4.5 0 0 1 0 9h-2.5"></path><path d="M9.5 12h5"></path></g></svg>';
const COPIED_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="copied"><path d="M5 12.25l4.5 4.5L19 7.25" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const banner = (message, url = '') => `<div class="server-unavailable-banner connection-recovery-notice share-view-notice" role="status"><div><p>${escape(message)}</p>${url ? `<input class="search-input" type="text" readonly="" value="${escape(url)}" aria-label="Link to copy">` : ''}</div><div class="connection-recovery-notice-actions"><button type="button">Dismiss</button></div></div>`;
const share = ({ icon = LINK_ICON, disabled = false, status = '', notice = '' } = {}) => `<div class="share-view"><button${disabled ? ' disabled=""' : ''} title="${disabled ? 'Sharing is available once the view has loaded' : 'Copy link to this view'}" aria-label="Copy link to this view" class="secondary compact header-icon-button share-view-button" type="button">${icon}</button><span class="planning-review-sr-only" role="status">${status}</span>${notice}</div>`;
const fragment = (name, markup) => `<!-- fragment:${name} -->${markup}<!-- /fragment:${name} -->`;
const URL_EXAMPLE = 'http://127.0.0.1:5050/?v=1&mode=catch-up&group=synthetic-group&sprint=3001&teams=team-alpha,team-beta';

const mainHeader = (control, { reserve = 0, label } = {}) => `
<section class="mock-state" style="min-height:${reserve}px">
  <h3>${label}</h3>
  <header>
    <div class="subtitle">
      <span class="subtitle-main"><img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'></svg>" alt="" class="subtitle-logo" aria-hidden="true">Jira Delivery Planner<span class="subtitle-secondary"> · Product &amp; Tech Projects</span></span>
      <div class="header-actions"><div class="header-actions-row">${html.searchMain}${control}${html.jira}${html.refresh}${html.gear}</div></div>
    </div>
    <div class="view-selector"><div class="controls-label">Controls</div><div class="view-filters">${html.sprintMain}${html.teamMain}${html.mode}</div></div>
  </header>
</section>`;
const compactHeader = (control, { reserve = 0, label } = {}) => `
<section class="mock-state" style="min-height:${reserve}px">
  <h3>${label}</h3>
  <div class="compact-sticky-header is-visible">
    <div class="compact-sticky-header-controls">${html.sprintCompact}${html.teamCompact}${html.mode}</div>
    <div class="compact-sticky-header-search">${html.searchCompact}</div>
    ${control}
  </div>
</section>`;

const body = [
    mainHeader(fragment('default', share()), { label: 'Main header: default (hover it to see the existing header icon-button hover)' }),
    mainHeader(share({ icon: COPIED_ICON, status: 'Link copied' }), { label: 'Main header: copied (the icon swaps for two seconds, still 38 by 38; the status text is visually hidden)' }),
    mainHeader(fragment('disabled', share({ disabled: true })), { label: 'Main header: disabled (hold, load or an unresolved apply in progress)' }),
    mainHeader(fragment('notice-partial', share({ notice: banner('Part of this link was not applied: Teams and filters. Everything else was applied.') })), { reserve: 250, label: 'Main header: apply notice, partial' }),
    mainHeader(share({ notice: banner('This link was not applied: its Department group is not available to you.') }), { reserve: 250, label: 'Main header: apply notice, group not available' }),
    mainHeader(fragment('notice-fallback', share({ notice: banner('The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters.', URL_EXAMPLE) })), { reserve: 280, label: 'Main header: copy fallback (clipboard unavailable or refused), read-only field' }),
    mainHeader(fragment('notice-copied-dropped', share({ icon: COPIED_ICON, status: 'Link copied', notice: banner('Link copied, without some details to keep it short: filters and highlighted item.') })), { reserve: 250, label: 'Main header: link copied, over-cap keys named as categories' }),
    compactHeader(share(), { label: 'Compact header: default (Share follows Search)' }),
    compactHeader(share({ notice: banner('This view cannot be shared as a link right now, so nothing was copied.') }), { reserve: 220, label: 'Compact header: refusal notice' }),
].join('\n');

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Share Control Mock</title>
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style id="repo-css">
/* frontend/dist/dashboard.css, verbatim, except the header icon-button selector additions and the .share-view-notice rule (the CSS Task 12 adds). */
${css}
</style>
<style id="mock-chrome">
/* Page furniture only; it styles nothing the app renders. */
.mock-state h3 { margin: 1.4rem 0 0.4rem; font: 600 0.72rem 'IBM Plex Mono', monospace; letter-spacing: 0.04em; color: var(--text-secondary); text-transform: none; }
.mock-state header { margin-bottom: 0.6rem; }
.mock-intro { font-size: 0.95rem; color: var(--text-secondary); max-width: 62rem; }
.mock-intro li { margin-left: 1.2rem; }
.mock-readout { font: 400 0.7rem 'IBM Plex Mono', monospace; color: var(--text-secondary); margin-top: 1rem; white-space: pre-wrap; }
</style>
</head>
<body>
<div class="container">
<h2>Share control: states (synthetic data)</h2>
<ul class="mock-intro">
<li>Placement: main header Search, Share, Jira export, Refresh, Settings; compact header Search, Share. Hidden in EPM and Scenario.</li>
<li>One shared header icon button: same 38 by 38 frame, border, radius and hover as its siblings. No new hover rule; the compact surface joins the existing rule through its selector list.</li>
<li>Notice: the shared banner (server-unavailable-banner, connection-recovery-notice) anchored under the control so it is visible on both surfaces. It overlays the controls row until dismissed. The alternative, an in-flow banner under the header, is out of view whenever the compact header is the active surface.</li>
<li>Copy strings are final; they name categories, never values.</li>
</ul>
${body}
<div class="mock-readout" id="mock-readout"></div>
</div>
<script>
// Live readout of the first Share control (main and compact) and its Refresh sibling.
const readout = document.getElementById('mock-readout');
function describe(node) {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return Math.round(rect.width * 10) / 10 + ' x ' + Math.round(rect.height * 10) / 10 + ', radius ' + style.borderRadius + ', background ' + style.backgroundColor + ', hovered ' + node.matches(':hover');
}
function update() {
  const main = document.querySelector('.header-actions-row .share-view-button');
  const refresh = document.querySelector('.header-actions-row .refresh-icon');
  const compact = document.querySelector('.compact-sticky-header .share-view-button');
  readout.textContent = 'Share (main): ' + describe(main) + '\\nRefresh (main): ' + describe(refresh) + '\\nShare (compact): ' + describe(compact);
}
document.addEventListener('mouseover', update);
document.addEventListener('mouseout', update);
update();
</script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'assets/mockups'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets/mockups/share-view-control-194.html'), page);
console.log(`wrote assets/mockups/share-view-control-194.html (${page.length} bytes)`);
```

Create `tmp/share-view-mock/shots.mjs`:

```js
// Captures the accepted-for-review states of assets/mockups/share-view-control-194.html with real pointer hover.
// Usage from the repository root:  node tmp/share-view-mock/shots.mjs   (writes PNGs next to this file; synthetic data only)
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const root = process.cwd();
const mock = `file://${path.join(root, 'assets/mockups/share-view-control-194.html')}`;
const out = (name) => path.join(root, 'tmp/share-view-mock', name);

const browser = await chromium.launch();
for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    // The page links Google Fonts; keep the capture offline and let the stylesheet's own fallbacks render.
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(mock);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.screenshot({ path: out(`mock-${width}.png`), fullPage: true });
    if (width === 1440) {
        const share = page.locator('.header-actions-row .share-view-button').first();
        await share.hover();
        await page.waitForTimeout(200);
        const box = await share.evaluate(node => node.closest('header').getBoundingClientRect().toJSON());
        await page.screenshot({ path: out('mock-hover-1440.png'), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
        const readout = await page.locator('#mock-readout').innerText();
        console.log(readout);
    }
    await page.close();
}
await browser.close();
console.log('wrote tmp/share-view-mock/mock-1440.png, mock-hover-1440.png, mock-390.png');
```

Run:

```bash
fnm exec --using 20 node tmp/share-view-mock/generate.mjs
fnm exec --using 20 node tmp/share-view-mock/shots.mjs
```
Expected: `wrote assets/mockups/share-view-control-194.html (` followed by a byte count of about 375,000; then the three readout lines (`Share (main): 38 x 38, radius 10px, background rgb(247, 245, 240), hovered true`, `Refresh (main): 38 x 38, radius 10px, background rgb(255, 255, 255), hovered false`, `Share (compact): 38 x 38, radius 10px, background rgb(255, 255, 255), hovered false`) and `wrote tmp/share-view-mock/mock-1440.png, mock-hover-1440.png, mock-390.png`. The generator throws `Built stylesheet does not contain exactly one:` if the built stylesheet no longer has the three rules it extends; then run `npm run build` first and re-check that no earlier task edited them.

- [ ] **Step 2: Show the mock to the operator and stop**

Open `assets/mockups/share-view-control-194.html` for the operator (`open assets/mockups/share-view-control-194.html` on macOS; a standalone file, no server) and attach `tmp/share-view-mock/mock-1440.png`, `mock-hover-1440.png` and `mock-390.png` in the reply (all synthetic data). Ask for acceptance of each point, with the measured numbers above:
1. Placement: main header Search, Share, Jira export, Refresh, Settings; compact header Search, Share; hidden in EPM and Scenario.
2. Glyphs: link, then a check for two seconds in the same 38 by 38 frame; disabled dims like its siblings.
3. Hover and frame: the existing header icon-button rule, no new hover CSS (the readout above).
4. The notice: the shared banner anchored under the control, with the overlay trade-off and the in-flow alternative described above.
5. The copy: the strings in the mock are the ones Step 5 implements (they name categories, never values).

Do not continue to Step 3 until the operator accepts. If they ask for a change, change the fragments in `generate.mjs` (and, once Step 3 exists, the constants in `tests/test_share_view_control.js` that mirror them), regenerate, and ask again. Once they accept, record the gate line above and continue.

- [ ] **Step 3: Write the failing tests (after acceptance)**

Create `tests/test_share_view_control.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

function load(entry) {
    const code = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom'],
    }).outputFiles[0].text;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, require);
    return module.exports;
}

const copy = load('frontend/src/shareView/noticeCopy.js');
const ShareViewButton = load('frontend/src/shareView/ShareViewButton.jsx').default;

const LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="link"><g transform="rotate(-45 12 12)" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 7.5H7a4.5 4.5 0 0 0 0 9h2.5"></path><path d="M14.5 7.5H17a4.5 4.5 0 0 1 0 9h-2.5"></path><path d="M9.5 12h5"></path></g></svg>';
const button = (attributes) => `<button${attributes.disabled ? ' disabled=""' : ''} title="${attributes.title}" aria-label="Copy link to this view" class="secondary compact header-icon-button share-view-button" type="button">${LINK_ICON}</button><span class="planning-review-sr-only" role="status"></span>`;
const DEFAULT_MARKUP = `<div class="share-view">${button({ title: 'Copy link to this view' })}</div>`;
const DISABLED_MARKUP = `<div class="share-view">${button({ disabled: true, title: 'Sharing is available once the view has loaded' })}</div>`;
const PARTIAL_MARKUP = `<div class="share-view">${button({ title: 'Copy link to this view' })}<div class="server-unavailable-banner connection-recovery-notice share-view-notice" role="status"><div><p>Part of this link was not applied: Teams and filters. Everything else was applied.</p></div><div class="connection-recovery-notice-actions"><button type="button">Dismiss</button></div></div></div>`;

const fakeShare = (patch = {}) => ({
    notice: null, dismissNotice() {}, captureShareUrl() { return { ok: true, url: 'unused', dropped: [] }; }, shareDisabled: false, applyTerminal: true, ...patch,
});
const render = ({ share, ...props } = {}) => renderToStaticMarkup(React.createElement(ShareViewButton, {
    surface: 'main', sourceSurface: 'catch_up', activeControlSurface: 'main', ...props, share: fakeShare(share),
}));

test('notice copy reads its approved strings and names categories only', () => {
    const { shareViewNoticeMessage, shareViewCopyMessage, shareViewDroppedCategories } = copy;
    const cases = [
        [{ kind: 'dropped', categories: ['group'] }, 'This link was not applied: its Department group is not available to you.'],
        [{ kind: 'dropped', categories: ['sprint'] }, 'This link was not applied: its Sprint is not available to you.'],
        [{ kind: 'dropped', categories: ['sprint', 'group'] }, 'This link was not applied: its Department group and Sprint are not available to you.'],
        [{ kind: 'dropped', categories: [] }, 'This link could not be applied right now, so your view was left as it was.'],
        [{ kind: 'dropped', categories: ['teams'] }, 'This link could not be applied right now, so your view was left as it was.'],
        [{ kind: 'partial', categories: ['teams', 'filters'] }, 'Part of this link was not applied: Teams and filters. Everything else was applied.'],
        [{ kind: 'partial', categories: ['focus', 'filters', 'teams', 'mode', 'bogus'] }, 'Part of this link was not applied: view mode, Teams, filters and highlighted item. Everything else was applied.'],
        [{ kind: 'partial', categories: ['focus'] }, 'Part of this link was not applied: highlighted item. Everything else was applied.'],
        [{ kind: 'partial', categories: [] }, 'Part of this link was not applied. Everything else was applied.'],
        [{ kind: 'invalid', categories: [] }, 'This link is not valid, so it was not applied. Ask the sender to copy it again.'],
        [{ kind: 'newer', categories: [] }, 'This link was made with a newer version of the app, so it was not applied. Update the app and open the link again.'],
        [{ kind: 'unknown', categories: [] }, ''],
        [null, ''],
    ];
    for (const [notice, message] of cases) assert.equal(shareViewNoticeMessage(notice), message, JSON.stringify(notice));

    assert.equal(shareViewCopyMessage({ type: 'copied', dropped: ['find', 'alertTeam', 'sort'] }), 'Link copied, without some details to keep it short: filters and highlighted item.');
    assert.equal(shareViewCopyMessage({ type: 'copied', dropped: [] }), '');
    assert.equal(shareViewCopyMessage({ type: 'manual', dropped: [] }), 'The browser did not allow copying. Select the link below and copy it.');
    assert.equal(shareViewCopyMessage({ type: 'manual', dropped: ['sort'] }), 'The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters.');
    assert.equal(shareViewCopyMessage({ type: 'refused', reason: 'too_long' }), 'This view has too many selections to fit in one link, so nothing was copied.');
    assert.equal(shareViewCopyMessage({ type: 'refused', reason: 'invalid_state' }), 'This view cannot be shared as a link right now, so nothing was copied.');

    // The encoder's dropped state keys map to notice categories; inherited object keys never do.
    assert.deepEqual(shareViewDroppedCategories(['find', 'focus', 'alerts', 'initiatives', 'sort', 'epic', 'bogus', '__proto__', 'constructor', 'toString']), ['filters', 'focus']);
    assert.deepEqual(shareViewDroppedCategories(undefined), []);

    // No combination of categories can put a value, id, count or URL into a message.
    const categories = ['group', 'sprint', 'mode', 'teams', 'filters', 'focus'];
    for (let mask = 0; mask < 2 ** categories.length; mask += 1) {
        const subset = categories.filter((_, index) => mask & (1 << index));
        for (const kind of ['dropped', 'partial']) {
            assert.match(shareViewNoticeMessage({ kind, categories: subset }), /^[A-Za-z ,.:]+$/);
        }
    }
});

test('ShareViewButton renders the header icon-button contract and reuses the shared banner for its notice', () => {
    assert.equal(render(), DEFAULT_MARKUP);
    assert.equal(render({ surface: 'compact', activeControlSurface: 'compact' }), DEFAULT_MARKUP);
    assert.equal(render({ share: { shareDisabled: true } }), DISABLED_MARKUP);
    const partial = { notice: { kind: 'partial', categories: ['teams', 'filters'] } };
    assert.equal(render({ share: partial }), PARTIAL_MARKUP);
    // Only the surface that is showing renders the notice.
    assert.equal(render({ activeControlSurface: 'compact', share: partial }), DEFAULT_MARKUP);
    assert.equal(render({ surface: 'compact', activeControlSurface: 'main', share: partial }), DEFAULT_MARKUP);
    // An apply result with no copy renders nothing extra.
    assert.equal(render({ share: { notice: { kind: 'unknown', categories: [] } } }), DEFAULT_MARKUP);
});

test('the dashboard renders the Share control on both header surfaces through one helper, hidden in EPM and Scenario', async () => {
    const source = read('frontend/src/dashboard.jsx');
    assert.ok(source.includes("import ShareViewButton from './shareView/ShareViewButton.jsx';"));
    assert.equal(source.split('renderShareViewControl(').length - 1, 2, 'one call per surface; the definition is an arrow assignment');
    assert.ok(source.includes("const renderShareViewControl = (surface) => selectedView === 'eng' && activeEngMode !== 'scenario' && ("));
    assert.ok(source.includes('<ShareViewButton surface={surface} share={shareView} sourceSurface={analyticsToken(activeEngMode)} activeControlSurface={activeControlSurface} />'));

    const actions = source.slice(source.indexOf('className="header-actions-row"'), source.indexOf('className="view-selector"'));
    const searchAt = actions.indexOf("{renderSearchControl('main')}");
    const shareAt = actions.indexOf("{renderShareViewControl('main')}");
    assert.ok(searchAt >= 0 && searchAt < shareAt && shareAt < actions.indexOf('<JiraExportButton'), 'main: Search, Share, Jira export');
    assert.ok(shareAt < actions.indexOf('refresh-icon'), 'main: Share stays before the Refresh and Settings pair');

    const compact = source.slice(source.indexOf('className={`compact-sticky-header ${compactStickyVisible'), source.indexOf('{shouldRenderEngTaskList && !sprintsLoading && <EngFilterControls'));
    assert.ok(compact.indexOf('className="compact-sticky-header-search"') < compact.indexOf("{renderShareViewControl('compact')}"), 'compact: Share follows the Search container');
    assert.equal(compact.slice(compact.indexOf('className="compact-sticky-header-controls"'), compact.indexOf('className="compact-sticky-header-search"')).includes('renderShareViewControl'), false);

    // The analytics surface token the helper passes is always one of the fixed Share enum values.
    const { analyticsToken } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    const { buildShareViewActionParams } = await import('../frontend/src/analytics/dashboardAnalytics.js');
    for (const mode of ['catch-up', 'planning', 'board', 'statistics']) {
        assert.equal(buildShareViewActionParams({ workflowAction: 'copy_link', result: 'success', sourceSurface: analyticsToken(mode) })?.source_surface, analyticsToken(mode), mode);
    }
});

test('Share adds no hover CSS: the compact surface joins the existing header icon-button rules and the notice reuses the shared banner', () => {
    const controls = read('frontend/src/styles/shared/controls.css');
    for (const suffix of ['', ':hover', '\\s+svg']) {
        assert.match(controls, new RegExp(`\\.header-actions-row button\\.header-icon-button${suffix},\\s*\\.compact-sticky-header button\\.header-icon-button${suffix}\\s*\\{`));
    }
    const stylesDir = path.join(repoRoot, 'frontend', 'src', 'styles');
    const cssFiles = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) walk(path.join(dir, entry.name));
            else if (entry.name.endsWith('.css')) cssFiles.push(path.join(dir, entry.name));
        }
    }(stylesDir));
    const allCss = cssFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(allCss, /share-view[^{,]*:hover/, 'no hover rule of its own');
    assert.doesNotMatch(allCss, /\.share-view-button\b/, 'no local variant of the shared header icon button');
    assert.doesNotMatch(allCss, /\.share-view\s*[,{]/, 'no wrapper rule beyond the shared header rules');

    // The notice rule changes placement and resets the typography .subtitle passes down; the banner's own layout and surface stay untouched.
    const rule = controls.match(/\.share-view-notice \{([\s\S]*?)\n {8}\}/)[1];
    for (const needle of ['position: absolute', 'top: calc(100% + 0.35rem)', 'right: 0', 'text-transform: none', 'letter-spacing: normal']) assert.ok(rule.includes(needle), needle);
    for (const forbidden of ['display', 'flex', 'padding', 'background', 'border', 'color:', 'font', 'hover']) assert.equal(rule.includes(forbidden), false, `the notice rule must not set ${forbidden}`);

    const component = read('frontend/src/shareView/ShareViewButton.jsx');
    for (const required of [
        'variant="secondary compact"', 'className="header-icon-button share-view-button"', 'className="server-unavailable-banner connection-recovery-notice share-view-notice"',
        'className="connection-recovery-notice-actions"', 'className="search-input"', 'className="planning-review-sr-only"',
    ]) assert.ok(component.includes(required), required);
    assert.equal(component.split('navigator.clipboard.writeText').length - 1, 1);
    for (const forbidden of ['window.location', 'history.', 'execCommand', 'console.', 'dangerouslySetInnerHTML', 'dataLayer', 'trackEvent', 'trackProductEvent', 'localStorage']) {
        assert.equal(component.includes(forbidden), false, `ShareViewButton must not use ${forbidden}`);
    }
    assert.ok(component.includes("import { trackShareViewAction } from '../analytics/dashboardAnalytics.js';"));
});

test('the accepted mock and the component render the same Share markup and copy', () => {
    const mock = read('assets/mockups/share-view-control-194.html');
    const fragment = (name) => {
        const match = mock.match(new RegExp(`<!-- fragment:${name} -->([\\s\\S]*?)<!-- /fragment:${name} -->`));
        assert.ok(match, `mock fragment ${name}`);
        return match[1];
    };
    assert.equal(fragment('default'), render(), 'regenerate the mock with tmp/share-view-mock/generate.mjs and re-ask for acceptance if the markup changes');
    assert.equal(fragment('disabled'), render({ share: { shareDisabled: true } }));
    assert.equal(fragment('notice-partial'), render({ share: { notice: { kind: 'partial', categories: ['teams', 'filters'] } } }));
    // Copy-outcome notices are click state, so only their message text is compared.
    const message = (name) => fragment(name).match(/<p>([\s\S]*?)<\/p>/)[1].replace(/&amp;/g, '&');
    assert.equal(message('notice-fallback'), copy.shareViewCopyMessage({ type: 'manual', dropped: ['sort'] }));
    assert.equal(message('notice-copied-dropped'), copy.shareViewCopyMessage({ type: 'copied', dropped: ['find', 'alertTeam'] }));
    assert.ok(mock.includes('id="repo-css"') && mock.includes('--control-height: 38px'), 'the mock inlines the repository stylesheet verbatim');
    // The mock's two CSS edits are the ones the stylesheet carries: the compact selectors and the placement-only notice rule.
    for (const suffix of ['', ':hover', ' svg']) {
        assert.ok(mock.includes(`.header-actions-row button.header-icon-button${suffix},\n.compact-sticky-header button.header-icon-button${suffix} {`), `mock selector list${suffix}`);
    }
    const noticeRule = (css) => css.match(/\.share-view-notice \{([\s\S]*?)\}/)[1].replace(/\s+/g, ' ').trim();
    assert.equal(noticeRule(mock), noticeRule(read('frontend/src/styles/shared/controls.css')));
});
```

Create `tests/ui/share_view_control_harness.jsx` (the real component on both header surfaces inside a structural replica of the real header, so the real cascade applies; a spec drives its fake `share` through `window.__shareHarness`):

```jsx
// Mount harness for the Share control: the real ShareViewButton on both header surfaces, inside a
// structural replica of the real header (same classes, so the real cascade applies), with a fake
// `share` object a spec drives through `window.__shareHarness`. The assertions that prove the
// control inside the real app (hook wiring, scroll swap, EPM and Scenario) are in the app cases of
// share_view_control.spec.js.

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import ShareViewButton from '../../frontend/src/shareView/ShareViewButton.jsx';
import { SearchControl } from '../../frontend/src/eng/EngControls.jsx';
import JiraExportButton from '../../frontend/src/components/JiraExportButton.jsx';
import IconButton from '../../frontend/src/ui/IconButton.jsx';
import { initAnalytics } from '../../frontend/src/analytics/analytics.js';

const state = {
    active: 'main',
    sourceSurface: 'catch_up',
    disabled: false,
    notice: null,
    capture: { ok: true, url: 'http://127.0.0.1:5050/?v=1&mode=catch-up&group=synthetic-group&sprint=3001', dropped: [] },
};
const calls = { captures: 0, dismissed: 0 };
let rerender = () => {};

function Harness() {
    const [, setTick] = React.useState(0);
    rerender = () => setTick(tick => tick + 1);
    const share = {
        notice: state.notice,
        dismissNotice: () => { calls.dismissed += 1; state.notice = null; rerender(); },
        captureShareUrl: () => { calls.captures += 1; return state.capture; },
        shareDisabled: state.disabled,
        applyTerminal: true,
    };
    const searchProps = (surface) => ({
        surface, searchActive: false, searchInput: '', setSearchInput: () => {}, setSearchFocused: () => {}, searchInputRef: { current: null },
    });
    const shareControl = (surface) => (
        <ShareViewButton surface={surface} share={share} sourceSurface={state.sourceSurface} activeControlSurface={state.active} />
    );
    return (
        <div className="container">
            <header>
                <div className="subtitle">
                    <span className="subtitle-main">Jira Delivery Planner</span>
                    <div className="header-actions">
                        <div className="header-actions-row">
                            <SearchControl {...searchProps('main')} />
                            {shareControl('main')}
                            <JiraExportButton jiraUrl="https://jira.example" epicKeys={['SYN-1']} />
                            <IconButton variant="secondary compact" className="header-icon-button refresh-icon" title="Refresh tasks and sprints from Jira" aria-label="Refresh tasks and sprints from Jira">
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M19 7.5a7.5 7.5 0 1 0 2 5.1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/>
                                    <path d="M19 3v4h-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </IconButton>
                            <button className="header-icon-button group-gear-button" title="Manage team groups" aria-label="Manage team groups" type="button">
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" stroke="currentColor" strokeWidth="1.6"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                <div className="view-selector">
                    <div className="controls-label">Controls</div>
                    <div className="view-filters"><span className="harness-controls-row">controls row</span></div>
                </div>
            </header>
            <div className="compact-sticky-header is-visible">
                <div className="compact-sticky-header-controls"><span className="harness-controls-row">compact controls</span></div>
                <div className="compact-sticky-header-search">
                    <SearchControl {...searchProps('compact')} extraClassName="compact-sticky-header-search-field" />
                </div>
                {shareControl('compact')}
            </div>
            <p style={{ height: 1200 }}>content</p>
        </div>
    );
}

window.__shareHarness = {
    state,
    calls,
    set(patch) { Object.assign(state, patch); rerender(); },
};
window.dataLayer = [];
initAnalytics({ fetchContext: async () => ({ enabled: true }) }).then(() => {
    createRoot(document.getElementById('harness-root')).render(<Harness />);
});
```

Create `tests/ui/share_view_control.spec.js` (the harness cases need only the stylesheet source; the app cases need `frontend/dist` built, the shared ENG fixture and Task 11's hook; the fixture routes `/` with a pattern that never matches a URL with a query, so the link case registers its own route):

```js
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { test, expect } = require('@playwright/test');
const { catchUpPrefs, deferred, groupsConfigPayload, mockDashboard, openCatchUp } = require('./eng_epic_refresh_fixture');
const { activeHomeTokenConnection } = require('./epm_home_token_fixture');

const repoRoot = path.join(__dirname, '..', '..');
const appBaseUrl = process.env.JEP_TEST_BASE_URL || 'http://127.0.0.1:5050';
const harnessUrl = `${appBaseUrl}/share-view-control-harness`;
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'jira-dashboard.html'), 'utf8');
const SHARE_LABEL = 'Copy link to this view';
const SYNTHETIC_URL = 'http://127.0.0.1:5050/?v=1&mode=catch-up&group=synthetic-group&sprint=3001';
const APP_URL_PREFIX = /^http:\/\/127\.0\.0\.1:5050\/\?v=1&mode=catch-up&group=group-alpha&sprint=3001(&|$)/;

let harnessHtml;

test.beforeAll(() => {
    const harnessJs = esbuild.buildSync({
        entryPoints: [path.join(__dirname, 'share_view_control_harness.jsx')],
        bundle: true,
        write: false,
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"test"' },
    }).outputFiles[0].text;
    // The real stylesheet bundle, built from source, so the cascade is the app's.
    const dashboardCss = esbuild.buildSync({
        entryPoints: [path.join(repoRoot, 'frontend', 'src', 'styles', 'dashboard.css')],
        bundle: true,
        write: false,
    }).outputFiles[0].text;
    harnessHtml = '<!doctype html><html><head><meta charset="utf-8">'
        + `<style>${dashboardCss}</style></head><body><div id="harness-root"></div><script>${harnessJs}</script></body></html>`;
});

// Clipboard stubs are installed before navigation: `ok` records writes, `rejected` refuses them,
// `missing` models a non-secure origin where navigator.clipboard is undefined.
async function openHarness(page, { width = 1440, height = 900, clipboard = 'ok' } = {}) {
    await page.addInitScript((mode) => {
        window.__copied = [];
        const clipboardValue = {
            ok: { writeText: async (text) => { window.__copied.push(text); } },
            rejected: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
            missing: undefined,
        }[mode];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboardValue });
    }, clipboard);
    await page.route(harnessUrl, route => route.fulfill({ status: 200, contentType: 'text/html', body: harnessHtml }));
    await page.setViewportSize({ width, height });
    await page.goto(harnessUrl);
    await expect(page.getByRole('button', { name: SHARE_LABEL })).toHaveCount(2);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
}

const shareButton = (page, surface) => page.locator(surface === 'main' ? '.header-actions-row .share-view-button' : '.compact-sticky-header .share-view-button');
const setHarness = (page, patch) => page.evaluate(next => window.__shareHarness.set(next), patch);
const shareEvents = (page) => page.evaluate(() => window.dataLayer.filter(entry => entry && entry.event_name === 'share_view_action'));

// Computed-style report of a hovered control: colours as relative luminance plus the WCAG contrast
// ratio between the glyph (or text) colour and the background, so a dark-on-dark global
// `button:hover` surface cannot pass. Same method as eng_epic_refresh.spec.js.
async function hoverStyleReport(control) {
    return control.evaluate((node) => {
        const channels = (value) => {
            const match = value.match(/rgba?\(([^)]+)\)/);
            return match ? match[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number) : null;
        };
        const luminance = (rgb) => {
            const [red, green, blue] = rgb.map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        };
        const style = getComputedStyle(node);
        const path = node.querySelector('svg path, svg g');
        const stroke = path ? getComputedStyle(path).stroke : null;
        const glyph = channels(stroke && stroke !== 'none' ? stroke : style.color);
        const background = channels(style.backgroundColor);
        const backgroundLuminance = luminance(background);
        const glyphLuminance = luminance(glyph);
        const [lighter, darker] = backgroundLuminance > glyphLuminance ? [backgroundLuminance, glyphLuminance] : [glyphLuminance, backgroundLuminance];
        return {
            hovered: node.matches(':hover'),
            backgroundColor: style.backgroundColor,
            backgroundLuminance,
            glyphColor: stroke && stroke !== 'none' ? stroke : style.color,
            contrast: (lighter + 0.05) / (darker + 0.05),
            transform: style.transform,
            boxShadow: style.boxShadow,
        };
    });
}

async function hoverCentre(page, control) {
    const box = await control.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => control.evaluate(node => node.matches(':hover'))).toBe(true);
}

test.describe('Share control: shared header icon-button contract', () => {
    test('both surfaces carry the header icon-button classes and the 38 by 38 geometry of their siblings', async ({ page }) => {
        await openHarness(page);
        const main = shareButton(page, 'main');
        const compact = shareButton(page, 'compact');
        for (const button of [main, compact]) {
            for (const className of ['secondary', 'compact', 'header-icon-button', 'share-view-button']) await expect(button).toHaveClass(new RegExp(`(^|\\s)${className}(\\s|$)`));
        }
        const read = (button) => button.evaluate((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            const icon = node.querySelector('svg').getBoundingClientRect();
            return {
                width: rect.width, height: rect.height, iconWidth: icon.width, iconHeight: icon.height,
                borderRadius: style.borderRadius, backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.color,
                borderTopWidth: style.borderTopWidth, marginRight: style.marginRight,
            };
        });
        const refresh = await read(page.locator('.header-actions-row .refresh-icon'));
        const mainShare = await read(main);
        const compactShare = await read(compact);
        for (const share of [mainShare, compactShare]) {
            expect(share.width).toBe(38);
            expect(share.height).toBe(38);
            expect(share.iconWidth).toBeCloseTo(18, 3);
            expect(share.iconHeight).toBeCloseTo(18, 3);
            expect(share.marginRight).toBe('0px');
            for (const key of ['borderRadius', 'backgroundColor', 'borderColor', 'color', 'borderTopWidth']) expect(share[key], key).toBe(refresh[key]);
        }
        // The one rule set serves both surfaces: the compact control computes exactly what the main one does.
        expect(compactShare).toEqual(mainShare);
        // Order and adjacency: Search, Share, Jira export in the main row; Share right after Search in the compact row.
        await expect(page.locator('.header-actions-row > .control-search + .share-view + .jira-export')).toHaveCount(1);
        await expect(page.locator('.header-actions-row .refresh-icon + .group-gear-button')).toHaveCount(1);
        await expect(page.locator('.compact-sticky-header > .compact-sticky-header-search + .share-view')).toHaveCount(1);
        // Bottom edges line up with the neighbouring Search input on both surfaces.
        const bottoms = await page.evaluate(() => ['.header-actions-row', '.compact-sticky-header'].map((rowSelector) => {
            const row = document.querySelector(rowSelector);
            return Math.abs(row.querySelector('.search-input').getBoundingClientRect().bottom - row.querySelector('.share-view-button').getBoundingClientRect().bottom);
        }));
        bottoms.forEach(delta => expect(delta).toBeLessThanOrEqual(1));
    });

    test('hover keeps a light surface, a readable glyph and no lift on both surfaces', async ({ page }) => {
        await openHarness(page);
        for (const surface of ['main', 'compact']) {
            const button = shareButton(page, surface);
            await hoverCentre(page, button);
            const report = await hoverStyleReport(button);
            expect(report.hovered).toBe(true);
            expect(report.backgroundLuminance, `${surface} background ${report.backgroundColor} is a light surface, not the dark global button:hover`).toBeGreaterThan(0.8);
            expect(report.contrast, `${surface} glyph ${report.glyphColor} on ${report.backgroundColor}`).toBeGreaterThanOrEqual(3);
            expect(report.transform, `${surface} transform`).toBe('none');
            expect(report.boxShadow, `${surface} box-shadow`).toBe('none');
            await page.mouse.move(2, 2);
        }
    });
});

test.describe('Share control: copy outcomes', () => {
    test('a click copies the captured URL once, swaps the icon at a fixed 38 by 38 and reports one fixed event', async ({ page }) => {
        await openHarness(page);
        const button = shareButton(page, 'main');
        const status = page.locator('.header-actions-row .share-view [role="status"]');
        await button.click();
        await expect(button.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
        await expect(status).toHaveText('Link copied');
        const box = await button.boundingBox();
        expect(box.width).toBeCloseTo(38, 1);
        expect(box.height).toBeCloseTo(38, 1);
        expect(await page.evaluate(() => window.__copied)).toEqual([SYNTHETIC_URL]);
        await expect(page.locator('.share-view-notice')).toHaveCount(0);
        expect(await shareEvents(page)).toEqual([{
            event: 'userevent', trigger: 'userevent', event_type: 'event', event_name: 'share_view_action',
            feature_name: 'share_view', workflow_action: 'copy_link', result: 'success', source_surface: 'catch_up',
        }]);
        // The link icon returns by itself and the status text clears.
        await expect(button.locator('[data-share-view-icon="link"]')).toHaveCount(1, { timeout: 4000 });
        await expect(status).toHaveText('');
        expect(await page.evaluate(() => window.__shareHarness.calls.captures)).toBe(1);
    });

    test('over-cap dropped keys are named in the notice as categories, never as values', async ({ page }) => {
        await openHarness(page);
        await setHarness(page, { capture: { ok: true, url: SYNTHETIC_URL, dropped: ['find', 'alertTeam', 'sort'] } });
        await shareButton(page, 'main').click();
        const notice = page.locator('.share-view-notice');
        await expect(notice.locator('p')).toHaveText('Link copied, without some details to keep it short: filters and highlighted item.');
        await expect(notice.getByRole('textbox')).toHaveCount(0);
        expect(await page.evaluate(() => window.__copied)).toEqual([SYNTHETIC_URL]);
        const events = await shareEvents(page);
        expect(events.map(event => event.result)).toEqual(['success']);
    });

    for (const clipboard of ['missing', 'rejected']) {
        test(`clipboard ${clipboard}: the notice shows the whole link in a selectable read-only field and reports a failure`, async ({ page }) => {
            await openHarness(page, { clipboard });
            const longUrl = `${SYNTHETIC_URL}&find=${'a'.repeat(1400)}`;
            await setHarness(page, { capture: { ok: true, url: longUrl, dropped: ['sort'] } });
            await shareButton(page, 'main').click();
            const notice = page.locator('.share-view-notice');
            await expect(notice.locator('p')).toHaveText('The browser did not allow copying. Select the link below and copy it. Left out to keep it short: filters.');
            const field = notice.getByRole('textbox', { name: 'Link to copy' });
            await expect(field).toHaveAttribute('readonly', '');
            await expect(field).toHaveValue(longUrl);
            await expect(field).toBeFocused();
            expect(await field.evaluate(node => [node.selectionStart, node.selectionEnd, node.value.length])).toEqual([0, longUrl.length, longUrl.length]);
            expect(await page.evaluate(() => window.__copied)).toEqual([]);
            expect((await shareEvents(page)).map(event => event.result)).toEqual(['failure']);
            await expect(shareButton(page, 'main').locator('[data-share-view-icon="copied"]')).toHaveCount(0);
            await notice.getByRole('button', { name: 'Dismiss' }).click();
            await expect(notice).toHaveCount(0);
        });
    }

    for (const [reason, message] of [
        ['too_long', 'This view has too many selections to fit in one link, so nothing was copied.'],
        ['invalid_state', 'This view cannot be shared as a link right now, so nothing was copied.'],
    ]) {
        test(`a capture refused as ${reason} shows its message, copies nothing and shows no field`, async ({ page }) => {
            await openHarness(page);
            await setHarness(page, { capture: { ok: false, reason } });
            await shareButton(page, 'main').click();
            const notice = page.locator('.share-view-notice');
            await expect(notice.locator('p')).toHaveText(message);
            await expect(notice.getByRole('textbox')).toHaveCount(0);
            expect(await page.evaluate(() => window.__copied)).toEqual([]);
            expect((await shareEvents(page)).map(event => event.result)).toEqual(['failure']);
        });
    }

    test('a disabled control stays inert, light and unlifted', async ({ page }) => {
        await openHarness(page);
        await setHarness(page, { disabled: true });
        for (const surface of ['main', 'compact']) {
            const button = shareButton(page, surface);
            await expect(button).toBeDisabled();
            await expect(button).toHaveAttribute('title', 'Sharing is available once the view has loaded');
            await expect(button).toHaveAttribute('aria-label', SHARE_LABEL);
            await button.click({ force: true });
            const box = await button.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            const report = await hoverStyleReport(button);
            expect(report.transform).toBe('none');
            expect(report.boxShadow).toBe('none');
            expect(report.backgroundLuminance).toBeGreaterThan(0.8);
            await page.mouse.move(2, 2);
        }
        expect(await page.evaluate(() => window.__shareHarness.calls.captures)).toBe(0);
        expect(await shareEvents(page)).toEqual([]);
    });
});

const APPLY_NOTICES = [
    [{ kind: 'dropped', categories: ['group'] }, 'This link was not applied: its Department group is not available to you.'],
    [{ kind: 'dropped', categories: ['sprint'] }, 'This link was not applied: its Sprint is not available to you.'],
    [{ kind: 'dropped', categories: ['sprint', 'group'] }, 'This link was not applied: its Department group and Sprint are not available to you.'],
    [{ kind: 'dropped', categories: [] }, 'This link could not be applied right now, so your view was left as it was.'],
    [{ kind: 'partial', categories: ['teams', 'filters'] }, 'Part of this link was not applied: Teams and filters. Everything else was applied.'],
    [{ kind: 'partial', categories: ['focus', 'filters', 'teams', 'mode', 'bogus'] }, 'Part of this link was not applied: view mode, Teams, filters and highlighted item. Everything else was applied.'],
    [{ kind: 'invalid', categories: [] }, 'This link is not valid, so it was not applied. Ask the sender to copy it again.'],
    [{ kind: 'newer', categories: [] }, 'This link was made with a newer version of the app, so it was not applied. Update the app and open the link again.'],
];

test.describe('Share control: apply notice', () => {
    for (const [notice, message] of APPLY_NOTICES) {
        test(`the ${notice.kind} notice for [${notice.categories.join(', ')}] reads exactly its copy, names categories only and dismisses through the hook`, async ({ page }) => {
            await openHarness(page);
            await setHarness(page, { notice });
            const banner = page.locator('.share-view-notice');
            await expect(banner).toHaveCount(1);
            await expect(banner.locator('p')).toHaveText(message);
            await expect(banner).toHaveAttribute('role', 'status');
            await expect(banner).toHaveClass(/server-unavailable-banner connection-recovery-notice/);
            await expect(banner.getByRole('textbox')).toHaveCount(0);
            await banner.getByRole('button', { name: 'Dismiss' }).click();
            await expect(banner).toHaveCount(0);
            expect(await page.evaluate(() => window.__shareHarness.calls.dismissed)).toBe(1);
            // The notice is not an analytics event.
            expect(await shareEvents(page)).toEqual([]);
        });
    }

    test('only the surface that is showing renders the notice, so exactly one is ever on screen', async ({ page }) => {
        await openHarness(page);
        await setHarness(page, { notice: { kind: 'partial', categories: ['teams'] } });
        await expect(page.locator('.share-view-notice')).toHaveCount(1);
        await expect(page.locator('.header-actions-row .share-view-notice')).toHaveCount(1);
        await setHarness(page, { active: 'compact' });
        await expect(page.locator('.share-view-notice')).toHaveCount(1);
        await expect(page.locator('.compact-sticky-header .share-view-notice')).toHaveCount(1);
        await expect(page.locator('.header-actions-row .share-view-notice')).toHaveCount(0);
    });

    test('a Share failure clears when its surface stops showing', async ({ page }) => {
        await openHarness(page, { clipboard: 'missing' });
        await shareButton(page, 'main').click();
        await expect(page.locator('.share-view-notice')).toHaveCount(1);
        await setHarness(page, { active: 'compact' });
        await expect(page.locator('.share-view-notice')).toHaveCount(0);
        await setHarness(page, { active: 'main' });
        await expect(page.locator('.share-view-notice')).toHaveCount(0);
    });

    // Element-level geometry (MRT020): the painted text, the field and the Dismiss button, not only the container box.
    for (const width of [1440, 1028, 760, 390, 375]) {
        for (const surface of ['main', 'compact']) {
            test(`the fallback notice stays inside the viewport and its header, unclipped and hit-testable, on ${surface} at ${width}px`, async ({ page }) => {
                await openHarness(page, { width, clipboard: 'missing' });
                await setHarness(page, { active: surface, capture: { ok: true, url: `${SYNTHETIC_URL}&find=${'a'.repeat(900)}`, dropped: [] } });
                await shareButton(page, surface).click();
                const notice = page.locator('.share-view-notice');
                await expect(notice).toBeVisible();
                const metrics = await notice.evaluate((node, surfaceName) => {
                    const rect = node.getBoundingClientRect();
                    const host = node.closest(surfaceName === 'main' ? '.subtitle' : '.compact-sticky-header').getBoundingClientRect();
                    const share = node.parentElement.querySelector('.share-view-button').getBoundingClientRect();
                    const paragraph = node.querySelector('p');
                    const range = document.createRange();
                    range.selectNodeContents(paragraph);
                    const paintedRight = Math.max(...[...range.getClientRects()].map(item => item.right));
                    const field = node.querySelector('input').getBoundingClientRect();
                    const dismiss = node.querySelector('button').getBoundingClientRect();
                    const hit = (x, y) => node.contains(document.elementFromPoint(x, y));
                    const paragraphStyle = getComputedStyle(paragraph);
                    return {
                        textTransform: paragraphStyle.textTransform, letterSpacing: paragraphStyle.letterSpacing,
                        left: rect.left, right: rect.right, top: rect.top, viewport: document.documentElement.clientWidth,
                        hostLeft: host.left, hostRight: host.right, shareBottom: share.bottom,
                        paragraphClip: paragraph.scrollWidth - paragraph.clientWidth, paintedRight,
                        fieldLeft: field.left, fieldRight: field.right, dismissLeft: dismiss.left, dismissRight: dismiss.right, dismissWidth: dismiss.width,
                        centreHit: hit(rect.left + rect.width / 2, rect.top + rect.height / 2),
                        dismissHit: hit(dismiss.left + dismiss.width / 2, dismiss.top + dismiss.height / 2),
                        fieldHit: hit(field.left + field.width / 2, field.top + field.height / 2),
                        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    };
                }, surface);
                expect(metrics.left).toBeGreaterThanOrEqual(metrics.hostLeft - 1);
                expect(metrics.right).toBeLessThanOrEqual(metrics.hostRight + 1);
                expect(metrics.left).toBeGreaterThanOrEqual(-1);
                expect(metrics.right).toBeLessThanOrEqual(metrics.viewport + 1);
                expect(metrics.top).toBeGreaterThanOrEqual(metrics.shareBottom);
                // The main header's .subtitle passes down uppercase, tracked text; the notice resets it.
                expect(metrics.textTransform).toBe('none');
                expect(['normal', '0px']).toContain(metrics.letterSpacing);
                expect(metrics.paragraphClip).toBeLessThanOrEqual(1);
                expect(metrics.paintedRight).toBeLessThanOrEqual(metrics.right);
                expect(metrics.fieldLeft).toBeGreaterThanOrEqual(metrics.left);
                expect(metrics.fieldRight).toBeLessThanOrEqual(metrics.right);
                expect(metrics.dismissLeft).toBeGreaterThanOrEqual(metrics.left);
                expect(metrics.dismissRight).toBeLessThanOrEqual(metrics.right);
                expect(metrics.dismissWidth).toBeGreaterThan(40);
                expect(metrics.centreHit && metrics.dismissHit && metrics.fieldHit, 'the notice is not covered by anything').toBe(true);
                // The notice is anchored in the viewport and adds no document overflow.
                expect(metrics.documentOverflow).toBeLessThanOrEqual(0);
            });
        }
    }

    test('the Dismiss button keeps the shared banner hover: a light surface and a readable label', async ({ page }) => {
        await openHarness(page);
        await setHarness(page, { notice: { kind: 'invalid', categories: [] } });
        const dismiss = page.locator('.share-view-notice').getByRole('button', { name: 'Dismiss' });
        await hoverCentre(page, dismiss);
        const report = await hoverStyleReport(dismiss);
        expect(report.backgroundLuminance).toBeGreaterThan(0.8);
        expect(report.contrast).toBeGreaterThanOrEqual(3);
    });
});

// Absolute-pixel ink bounds of what a control paints inside its inset box, compared with the centre of
// that box (same method as eng_group_board_card.spec.js). Integer-aligned clips keep the result exact at
// the fractional positions flex layout produces.
async function paintedInkOffset(page, locator, inset = 3) {
    const rect = await locator.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, w: box.width, h: box.height };
    });
    const x0 = Math.floor(rect.x) - 2;
    const y0 = Math.floor(rect.y) - 2;
    const width = Math.ceil(rect.x + rect.w) + 2 - x0;
    const height = Math.ceil(rect.y + rect.h) + 2 - y0;
    const image = await page.screenshot({ clip: { x: x0, y: y0, width, height }, animations: 'disabled' });
    return page.evaluate(async ({ base64, x0: originX, y0: originY, rect: box, inset: edge, width: clipWidth }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const scale = img.width / clipWidth;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        const data = context.getImageData(0, 0, img.width, img.height).data;
        const pixel = (x, y) => { const o = (y * img.width + x) * 4; return [data[o], data[o + 1], data[o + 2]]; };
        const left = Math.ceil((box.x + edge - originX) * scale);
        const top = Math.ceil((box.y + edge - originY) * scale);
        const right = Math.floor((box.x + box.w - edge - originX) * scale);
        const bottom = Math.floor((box.y + box.h - edge - originY) * scale);
        const ground = pixel(left, top);
        let minX = Infinity; let minY = Infinity; let maxX = -1; let maxY = -1;
        for (let y = top; y < bottom; y += 1) {
            for (let x = left; x < right; x += 1) {
                const p = pixel(x, y);
                if (Math.max(...p.map((channel, i) => Math.abs(channel - ground[i]))) > 30) {
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                }
            }
        }
        return {
            painted: maxX >= 0,
            dx: originX + ((minX + maxX + 1) / 2) / scale - (box.x + box.w / 2),
            dy: originY + ((minY + maxY + 1) / 2) / scale - (box.y + box.h / 2),
        };
    }, { base64: image.toString('base64'), x0, y0, rect, inset, width });
}

test.describe('Share control: painted glyph ink', () => {
    test.use({ deviceScaleFactor: 2 });

    // Glyph ink placement is only representative headed, in the engines the app is reviewed in. Run:
    //   npx playwright test tests/ui/share_view_control.spec.js --browser=firefox --headed -g "painted glyph ink"
    //   npx playwright test tests/ui/share_view_control.spec.js --browser=webkit --headed -g "painted glyph ink"
    test('the link and copied glyphs are centred in their 38 by 38 frame at rest and on hover, on both surfaces', async ({ page }, testInfo) => {
        test.skip(process.platform !== 'darwin', 'Glyph ink placement is reviewed on macOS.');
        test.skip(testInfo.project.use.headless !== false, 'Glyph ink placement is only representative headed.');
        await openHarness(page);
        await page.evaluate(() => document.fonts.ready);
        for (const surface of ['main', 'compact']) {
            const button = shareButton(page, surface);
            await button.scrollIntoViewIfNeeded();
            for (const state of ['rest', 'hover']) {
                if (state === 'hover') await button.hover(); else await page.mouse.move(2, 2);
                await page.waitForTimeout(300);
                const ink = await paintedInkOffset(page, button);
                expect(ink.painted, `${surface} link ${state} paints`).toBe(true);
                expect(Math.abs(ink.dx), `${surface} link ${state} horizontal offset`).toBeLessThanOrEqual(0.75);
                expect(Math.abs(ink.dy), `${surface} link ${state} vertical offset`).toBeLessThanOrEqual(0.75);
            }
            // The copied glyph lasts two seconds after a click, so both of its states are measured at once.
            await button.click();
            await expect(button.locator('[data-share-view-icon="copied"]')).toHaveCount(1);
            for (const state of ['hover', 'rest']) {
                if (state === 'rest') await page.mouse.move(2, 2);
                await page.waitForTimeout(250);
                const ink = await paintedInkOffset(page, button);
                expect(ink.painted, `${surface} copied ${state} paints`).toBe(true);
                expect(Math.abs(ink.dx), `${surface} copied ${state} horizontal offset`).toBeLessThanOrEqual(0.75);
                expect(Math.abs(ink.dy), `${surface} copied ${state} vertical offset`).toBeLessThanOrEqual(0.75);
            }
            await expect(button.locator('[data-share-view-icon="link"]')).toHaveCount(1, { timeout: 4000 });
        }
    });
});

async function installClipboard(page, mode = 'ok') {
    await page.addInitScript((value) => {
        window.__copied = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: value === 'missing' ? undefined : { writeText: async (text) => { window.__copied.push(text); } },
        });
    }, mode);
}

const enableAnalytics = (ctx) => ctx.respond('/api/analytics/context', ({ json }) => json({ enabled: true }));

// Share controls inside the viewport and not under an aria-hidden ancestor, by surface.
const visibleShareSurfaces = (page) => page.evaluate(() => [...document.querySelectorAll('.share-view-button')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden'
        && rect.bottom > 0 && rect.top < window.innerHeight && !node.closest('[aria-hidden="true"]');
}).map(node => (node.closest('.compact-sticky-header') ? 'compact' : 'main')));

// App cases: the real dashboard and the real useShareViewApply hook against the shared ENG fixture (build `frontend/dist` first).
test.describe('Share control: in the app', () => {
    test('a click in the main header copies the link for the open view and sends one private event', async ({ page }) => {
        await installClipboard(page);
        const ctx = await mockDashboard(page);
        enableAnalytics(ctx);
        await openCatchUp(page, ctx, { width: 1440, height: 900 });
        const button = page.locator('.header-actions-row .share-view-button');
        await expect(button).toBeEnabled();
        await button.click();
        await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
        expect((await page.evaluate(() => window.__copied))[0]).toMatch(APP_URL_PREFIX);
        await expect.poll(async () => (await shareEvents(page)).length).toBe(1);
        expect((await shareEvents(page))[0]).toMatchObject({
            event: 'userevent', event_name: 'share_view_action', feature_name: 'share_view',
            workflow_action: 'copy_link', result: 'success', source_surface: 'catch_up',
        });
        const serialised = JSON.stringify(await page.evaluate(() => window.dataLayer));
        for (const fragment of ['http', '?v=', 'group-alpha']) expect(serialised, `no ${fragment} in any analytics payload`).not.toContain(fragment);
    });

    test('the compact header takes the control over exactly when it appears and two controls are never on screen', async ({ page }) => {
        await installClipboard(page);
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width: 1440, height: 900 });
        const headerBottom = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().bottom + window.scrollY);
        const sampled = [];
        for (const y of [0, 40, Math.round(headerBottom / 2), Math.round(headerBottom) - 2, Math.round(headerBottom) + 2, 700, 1500]) {
            await page.evaluate(top => window.scrollTo(0, top), y);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.waitForTimeout(150);
            const state = await page.evaluate(() => ({ scrollY: window.scrollY, compact: Boolean(document.querySelector('.compact-sticky-header.is-visible')) }));
            const visible = await visibleShareSurfaces(page);
            sampled.push({ ...state, visible });
            expect(visible.length, `scrollY ${state.scrollY}: ${visible}`).toBeLessThanOrEqual(1);
            if (state.compact) expect(visible, `scrollY ${state.scrollY}`).toEqual(['compact']);
            if (state.scrollY === 0) expect(visible).toEqual(['main']);
        }
        expect(sampled.some(item => item.compact)).toBe(true);
        // The compact control copies the same link the main control copies, apart from the focus target, which follows the scroll position.
        await page.locator('.compact-sticky-header .share-view-button').click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(0);
        await page.locator('.header-actions-row .share-view-button').click();
        await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(2);
        const [fromCompact, fromMain] = await page.evaluate(() => window.__copied);
        expect(fromCompact).toMatch(APP_URL_PREFIX);
        const withoutFocus = (url) => url.replace(/&(?:epic|story|alertTeam)=[^&]*/g, '');
        expect(withoutFocus(fromCompact)).toBe(withoutFocus(fromMain));
    });

    // Sticky layering (MRT009) and the header's no-overflow contract: the baseline is the same page with the Share wrappers hidden.
    test('Share adds no compact-header height, moves no sticky offset and adds no horizontal overflow', async ({ page }) => {
        const ctx = await mockDashboard(page);
        await openCatchUp(page, ctx, { width: 1440, height: 900, prefs: { showPlanning: true, planningLayout: 'list' } });
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
        const setShare = (shown) => page.evaluate((visible) => {
            let style = document.getElementById('share-baseline');
            if (!style) { style = document.createElement('style'); style.id = 'share-baseline'; document.head.appendChild(style); }
            style.textContent = visible ? '' : '.share-view { display: none !important; }';
        }, shown);
        const measure = async () => {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(200);
            const top = await page.evaluate(() => ({ header: document.querySelector('header').getBoundingClientRect().height, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
            await page.evaluate(() => window.scrollTo(0, 900));
            await page.waitForTimeout(300);
            const scrolled = await page.evaluate(() => {
                const container = getComputedStyle(document.querySelector('.container'));
                return {
                    compact: document.querySelector('.compact-sticky-header').getBoundingClientRect().height,
                    offsets: ['--compact-header-offset', '--planning-sticky-top', '--filterbar-sticky-top', '--epic-sticky-top'].map(name => container.getPropertyValue(name).trim()),
                };
            });
            return { ...top, ...scrolled };
        };
        for (const width of [1440, 1028, 900, 760, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await setShare(false);
            const baseline = await measure();
            await setShare(true);
            const withShare = await measure();
            expect(withShare.compact, `${width}px compact header height`).toBe(baseline.compact);
            expect(withShare.offsets, `${width}px sticky offsets`).toEqual(baseline.offsets);
            expect(withShare.overflow, `${width}px horizontal overflow`).toBeLessThanOrEqual(baseline.overflow);
            // One header line stays one line while it fits (the actions row may wrap below that).
            if (width >= 1028) expect(withShare.header, `${width}px header height`).toBe(baseline.header);
        }
    });

    test('the control is hidden in EPM and in Scenario and returns in the ENG modes', async ({ page }) => {
        const ctx = await mockDashboard(page);
        ctx.respond('/api/me/connections/home-token', ({ json }) => json(activeHomeTokenConnection()));
        await openCatchUp(page, ctx, { width: 1440, height: 900 });
        await expect(page.locator('.share-view-button')).toHaveCount(1);
        await page.getByRole('radio', { name: 'EPM', exact: true }).click();
        await expect(page.getByRole('radio', { name: 'EPM', exact: true })).toBeChecked();
        await expect(page.locator('.share-view-button')).toHaveCount(0);
        await page.getByRole('radio', { name: 'ENG', exact: true }).click();
        await expect(page.locator('.share-view-button')).toHaveCount(1);
        const modes = page.locator('.view-selector .eng-mode-control');
        await modes.getByRole('radio', { name: 'Scenario' }).click();
        await expect(modes.getByRole('radio', { name: 'Scenario' })).toBeChecked();
        await expect(page.locator('.share-view-button')).toHaveCount(0);
        await page.evaluate(() => window.scrollTo(0, 700));
        await expect(page.locator('.share-view-button')).toHaveCount(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await modes.getByRole('radio', { name: 'Catch Up' }).click();
        await expect(page.locator('.share-view-button')).toHaveCount(1);
    });

    test('the control stays disabled while the Department groups are loading', async ({ page }) => {
        const ctx = await mockDashboard(page);
        const release = deferred();
        ctx.respond('/api/groups-config', async ({ json }) => { await release.promise; return json(groupsConfigPayload); });
        await page.addInitScript((prefs) => window.localStorage.setItem('jira_dashboard_ui_prefs_v1', JSON.stringify(prefs)), catchUpPrefs());
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(appBaseUrl, { waitUntil: 'domcontentloaded' });
        const button = page.locator('.header-actions-row .share-view-button');
        await expect(button).toBeDisabled();
        release.resolve();
        await expect(page.locator('.epic-block[data-epic-key="EPIC-1"]')).toBeVisible();
        await expect(button).toBeEnabled();
    });

    test('an opened link that cannot be applied shows its notice under the control, and Dismiss closes it', async ({ page }) => {
        await mockDashboard(page);
        // The shared fixture routes `/` with a pattern that never matches a URL with a query.
        await page.route(/^http:\/\/127\.0\.0\.1:5050\/\?v=1&/, route => route.fulfill({ status: 200, contentType: 'text/html', body: dashboardHtml }));
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${appBaseUrl}/?v=1&mode=catch-up&group=missing-group&sprint=3001`);
        const notice = page.locator('.header-actions-row .share-view-notice');
        await expect(notice.locator('p')).toHaveText('This link was not applied: its Department group is not available to you.');
        await expect(page.locator('.share-view-notice')).toHaveCount(1);
        await notice.getByRole('button', { name: 'Dismiss' }).click();
        await expect(page.locator('.share-view-notice')).toHaveCount(0);
    });

    for (const mode of ['catch-up', 'planning']) {
        test(`the fallback notice is not covered by the sticky stack in ${mode} when the compact control is used`, async ({ page }) => {
            await installClipboard(page, 'missing');
            const ctx = await mockDashboard(page);
            await openCatchUp(page, ctx, { width: 1440, height: 900, prefs: mode === 'planning' ? { showPlanning: true, planningLayout: 'list' } : {} });
            await page.evaluate(() => window.scrollTo(0, 900));
            await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(1);
            await page.locator('.compact-sticky-header .share-view-button').click();
            const notice = page.locator('.compact-sticky-header .share-view-notice');
            await expect(notice).toBeVisible();
            const hits = await notice.evaluate((node) => {
                const inside = (element) => {
                    const rect = element.getBoundingClientRect();
                    return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
                };
                return { notice: inside(node), field: inside(node.querySelector('input')), dismiss: inside(node.querySelector('button')) };
            });
            expect(hits).toEqual({ notice: true, field: true, dismiss: true });
            await notice.getByRole('button', { name: 'Dismiss' }).click();
            await expect(page.locator('.share-view-notice')).toHaveCount(0);
        });
    }
});
```

In `tests/ui/codebase_structure_smoke.spec.js`, update the existing header assertions (seven edits). In `multiple groups keep the main controls on one row and settings beside refresh`, Share becomes the fourth icon button, is asserted visible and in order, and joins the geometry list:

Replace this:
```js
    const settings = headerActions.getByRole('button', { name: 'Manage team groups' });
    await expect(jiraExport).toBeVisible();
    await expect(refresh).toBeVisible();
    await expect(settings).toBeVisible();
    await expect(headerActions.locator('.refresh-icon + .group-gear-button')).toHaveCount(1);
    const iconButtonGeometry = await headerActions.evaluate((row) => {
```
with this:
```js
    const settings = headerActions.getByRole('button', { name: 'Manage team groups' });
    const share = headerActions.getByRole('button', { name: 'Copy link to this view' });
    await expect(jiraExport).toBeVisible();
    await expect(refresh).toBeVisible();
    await expect(settings).toBeVisible();
    await expect(share).toBeVisible();
    await expect(headerActions.locator('.refresh-icon + .group-gear-button')).toHaveCount(1);
    await expect(headerActions.locator('.control-search + .share-view + .jira-export')).toHaveCount(1);
    const iconButtonGeometry = await headerActions.evaluate((row) => {
```

Replace this:
```js
        const buttons = [
            row.querySelector('.jira-export-icon-button'),
            row.querySelector('.refresh-icon'),
            row.querySelector('.group-gear-button'),
        ];
```
with this:
```js
        const buttons = [
            row.querySelector('.jira-export-icon-button'),
            row.querySelector('.refresh-icon'),
            row.querySelector('.group-gear-button'),
            row.querySelector('.share-view-button'),
        ];
```

Replace this:
```js
                row.querySelector('.jira-export-icon-button'),
                row.querySelector('.refresh-icon'),
                row.querySelector('.group-gear-button'),
            ].map((control) => Math.abs(controlsBottom - control.getBoundingClientRect().bottom)),
```
with this:
```js
                row.querySelector('.jira-export-icon-button'),
                row.querySelector('.refresh-icon'),
                row.querySelector('.group-gear-button'),
                row.querySelector('.share-view-button'),
            ].map((control) => Math.abs(controlsBottom - control.getBoundingClientRect().bottom)),
```

Replace this:
```js
    const [jiraGeometry, refreshGeometry, settingsGeometry] = iconButtonGeometry.buttons;
    for (const geometry of [jiraGeometry, refreshGeometry, settingsGeometry]) {
```
with this:
```js
    const [jiraGeometry, refreshGeometry, settingsGeometry, shareGeometry] = iconButtonGeometry.buttons;
    for (const geometry of [jiraGeometry, refreshGeometry, settingsGeometry, shareGeometry]) {
```

The same test's exact button count at 1209 px becomes four:

Replace this:
```js
    expect(reportedViewportGeometry.buttonSizes).toEqual([
        { width: 38, height: 38 },
        { width: 38, height: 38 },
        { width: 38, height: 38 },
    ]);
```
with this:
```js
    expect(reportedViewportGeometry.buttonSizes).toEqual([
        { width: 38, height: 38 },
        { width: 38, height: 38 },
        { width: 38, height: 38 },
        { width: 38, height: 38 },
    ]);
```

In `open header dropdown toggles filter groups teams and sprints`, the compact header at 1440 and 1028 px must carry exactly one Share control, 38 by 38 and inside the viewport:

Replace this:
```js
        const compactHeader = page.locator('.compact-sticky-header.is-visible');
        await expect(compactHeader).toBeVisible();
        for (const dropdownCase of dropdownCases) {
```
with this:
```js
        const compactHeader = page.locator('.compact-sticky-header.is-visible');
        await expect(compactHeader).toBeVisible();
        const compactShare = compactHeader.getByRole('button', { name: 'Copy link to this view' });
        await expect(compactShare).toHaveCount(1);
        await expect(compactShare).toBeVisible();
        const compactShareBox = await compactShare.boundingBox();
        expect(compactShareBox.width).toBeCloseTo(38, 1);
        expect(compactShareBox.height).toBeCloseTo(38, 1);
        expect(compactShareBox.x).toBeGreaterThanOrEqual(0);
        expect(compactShareBox.x + compactShareBox.width).toBeLessThanOrEqual(viewportWidth + 1);
        for (const dropdownCase of dropdownCases) {
```

and at 760, 390 and 375 px it must stay inside the viewport:

Replace this:
```js
        const compactHeader = page.locator('.compact-sticky-header.is-visible');
        await expect(compactHeader).toBeVisible();
        const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
```
with this:
```js
        const compactHeader = page.locator('.compact-sticky-header.is-visible');
        await expect(compactHeader).toBeVisible();
        const narrowShareBox = await compactHeader.getByRole('button', { name: 'Copy link to this view' }).boundingBox();
        expect(narrowShareBox.x).toBeGreaterThanOrEqual(0);
        expect(narrowShareBox.x + narrowShareBox.width).toBeLessThanOrEqual(width + 1);
        const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
```

- [ ] **Step 4: Run them and confirm they fail**

```bash
fnm exec --using 20 node --test tests/test_share_view_control.js 2>&1 | grep -E '^(not ok|# (tests|pass|fail))|Could not resolve' | head -4
npx playwright test tests/ui/share_view_control.spec.js --browser=chromium --workers=2 -g 'Share control: (shared header|copy outcomes|apply notice)' 2>&1 | grep -E 'passed|failed|did not run|Could not resolve' | sort -u
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g 'multiple groups keep the main controls|open header dropdown toggles filter groups' --browser=chromium --workers=2 2>&1 | grep -E 'passed|failed|Locator:|Expected:|Received:|not found'
```
Expected: the Node file fails to load (`not ok 1 - .../tests/test_share_view_control.js`, `Could not resolve ".../frontend/src/shareView/noticeCopy.js"`); the harness group reports `1 failed`, `29 did not run`, with `Could not resolve "../../frontend/src/shareView/ShareViewButton.jsx"`; both smoke cases fail on the source as it is (`Locator: locator('.header-actions-row').getByRole('button', { name: 'Copy link to this view' })`, `element(s) not found`, and `Locator: locator('.compact-sticky-header.is-visible').getByRole('button', { name: 'Copy link to this view' })`, `Expected: 1`, `Received: 0`).

- [ ] **Step 5: Implement the copy module and the component (no CSS, no wiring yet)**

Create `frontend/src/shareView/noticeCopy.js`:

```js
import { SHARE_VIEW_CATEGORY_BY_KEY } from './viewDefaults.js';

// Notice categories in display order. A label names what was not applied, never a value.
const CATEGORY_LABELS = new Map([
    ['group', 'Department group'],
    ['sprint', 'Sprint'],
    ['mode', 'view mode'],
    ['teams', 'Teams'],
    ['filters', 'filters'],
    ['focus', 'highlighted item'],
]);

function labelList(categories) {
    const labels = [...CATEGORY_LABELS].filter(([category]) => categories.includes(category)).map(([, label]) => label);
    return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : (labels[0] || '');
}

// The encoder reports dropped state keys; `focus` is the state slot that the epic and story query keys fill.
export function shareViewDroppedCategories(dropped) {
    const categories = new Set();
    for (const key of Array.isArray(dropped) ? dropped : []) {
        const category = key === 'focus' ? 'focus' : Object.hasOwn(SHARE_VIEW_CATEGORY_BY_KEY, key) ? SHARE_VIEW_CATEGORY_BY_KEY[key] : null;
        if (category) categories.add(category);
    }
    return [...categories];
}

// Apply result from the store: { kind: 'dropped' | 'partial' | 'invalid' | 'newer', categories }.
export function shareViewNoticeMessage(notice) {
    const categories = Array.isArray(notice?.categories) ? notice.categories : [];
    switch (notice?.kind) {
        case 'newer':
            return 'This link was made with a newer version of the app, so it was not applied. Update the app and open the link again.';
        case 'invalid':
            return 'This link is not valid, so it was not applied. Ask the sender to copy it again.';
        case 'dropped': {
            const scope = labelList(categories.filter(category => category === 'group' || category === 'sprint'));
            if (!scope) return 'This link could not be applied right now, so your view was left as it was.';
            return `This link was not applied: its ${scope} ${categories.includes('group') && categories.includes('sprint') ? 'are' : 'is'} not available to you.`;
        }
        case 'partial': {
            const list = labelList(categories);
            return `Part of this link was not applied${list ? `: ${list}` : ''}. Everything else was applied.`;
        }
        default:
            return '';
    }
}

// Share's own outcomes: `copied` (written to the clipboard), `manual` (clipboard unavailable or refused;
// the notice also shows the URL) and `refused` (the encoder produced no link; nothing was copied).
export function shareViewCopyMessage({ type, reason, dropped }) {
    const left = labelList(shareViewDroppedCategories(dropped));
    if (type === 'copied') return left ? `Link copied, without some details to keep it short: ${left}.` : '';
    if (type === 'manual') return `The browser did not allow copying. Select the link below and copy it.${left ? ` Left out to keep it short: ${left}.` : ''}`;
    return reason === 'too_long'
        ? 'This view has too many selections to fit in one link, so nothing was copied.'
        : 'This view cannot be shared as a link right now, so nothing was copied.';
}
```

Create `frontend/src/shareView/ShareViewButton.jsx`:

```jsx
import * as React from 'react';
import IconButton from '../ui/IconButton.jsx';
import { trackShareViewAction } from '../analytics/dashboardAnalytics.js';
import { shareViewCopyMessage, shareViewNoticeMessage } from './noticeCopy.js';

const COPIED_MS = 2000;
const LABEL = 'Copy link to this view';

// The Share control, rendered on both header surfaces. It copies the captured URL; when the
// clipboard is unavailable or refuses the write, the notice shows the URL in a read-only field.
export default function ShareViewButton({ surface, share, sourceSurface, activeControlSurface }) {
    const [copied, setCopied] = React.useState(false);
    const [local, setLocal] = React.useState(null);
    const timerRef = React.useRef(null);
    const active = surface === activeControlSurface;

    React.useEffect(() => () => window.clearTimeout(timerRef.current), []);
    React.useEffect(() => { if (!active) setLocal(null); }, [active]);

    const report = (result) => trackShareViewAction({ workflowAction: 'copy_link', result, sourceSurface });
    const copy = async () => {
        if (share.shareDisabled) return;
        const captured = share.captureShareUrl();
        if (!captured.ok) {
            if (captured.reason === 'disabled') return;
            setLocal({ message: shareViewCopyMessage({ type: 'refused', reason: captured.reason }) });
            report('failure');
            return;
        }
        try {
            await navigator.clipboard.writeText(captured.url);
        } catch {
            setCopied(false);
            setLocal({ message: shareViewCopyMessage({ type: 'manual', dropped: captured.dropped }), url: captured.url });
            report('failure');
            return;
        }
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), COPIED_MS);
        setCopied(true);
        const message = shareViewCopyMessage({ type: 'copied', dropped: captured.dropped });
        setLocal(message ? { message } : null);
        report('success');
    };

    const notice = local || (share.notice ? { message: shareViewNoticeMessage(share.notice) } : null);
    return (
        <div className="share-view">
            <IconButton
                variant="secondary compact"
                className="header-icon-button share-view-button"
                onClick={copy}
                disabled={share.shareDisabled}
                title={share.shareDisabled ? 'Sharing is available once the view has loaded' : LABEL}
                aria-label={LABEL}
            >
                {copied ? (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="copied">
                        <path d="M5 12.25l4.5 4.5L19 7.25" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                ) : (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" data-share-view-icon="link">
                        <g transform="rotate(-45 12 12)" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9.5 7.5H7a4.5 4.5 0 0 0 0 9h2.5"/>
                            <path d="M14.5 7.5H17a4.5 4.5 0 0 1 0 9h-2.5"/>
                            <path d="M9.5 12h5"/>
                        </g>
                    </svg>
                )}
            </IconButton>
            {/* The app's only visually hidden utility, defined with the Planning review styles. */}
            <span className="planning-review-sr-only" role="status">{copied ? 'Link copied' : ''}</span>
            {active && notice?.message && (
                <div className="server-unavailable-banner connection-recovery-notice share-view-notice" role="status">
                    <div>
                        <p>{notice.message}</p>
                        {notice.url && (
                            <input
                                className="search-input"
                                type="text"
                                readOnly
                                autoFocus
                                value={notice.url}
                                aria-label="Link to copy"
                                onFocus={(event) => event.target.select()}
                            />
                        )}
                    </div>
                    <div className="connection-recovery-notice-actions">
                        <button type="button" onClick={local ? () => setLocal(null) : () => share.dismissNotice()}>Dismiss</button>
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 6: Run again; only the CSS and the wiring are left**

```bash
fnm exec --using 20 node --test tests/test_share_view_control.js 2>&1 | grep -E '^(not ok|ok|# (tests|pass|fail))'
npx playwright test tests/ui/share_view_control.spec.js --browser=chromium --workers=3 -g 'Share control: (shared header|copy outcomes|apply notice)' 2>&1 | grep -E '✘|passed|failed'
```
Expected: Node `# tests 5`, `# pass 2`, `# fail 3`: the copy strings and the markup contract pass; `the dashboard renders the Share control on both header surfaces...`, `Share adds no hover CSS...` and `the accepted mock and the component render the same Share markup and copy` fail (in the last one the markup and copy assertions pass; its final assertion compares the mock's `.share-view-notice` rule with `controls.css`, which Step 7 adds). The harness group reports `9 failed` and `21 passed`; the nine are exactly the cases that need the stylesheet: `both surfaces carry the header icon-button classes and the 38 by 38 geometry of their siblings` (the compact control is unstyled), `hover keeps a light surface, a readable glyph and no lift on both surfaces`, `a disabled control stays inert, light and unlifted`, and the fallback-notice geometry case on main at 1440, 1028, 760, 390 and 375 px plus on compact at 375 px (no placement rule, no typography reset).

- [ ] **Step 7: Add the CSS and the dashboard wiring**

In `frontend/src/styles/shared/controls.css`, the compact surface joins the three existing header icon-button rules through their selector lists (no declaration changes, so the hover, geometry and glyph size are the ones the siblings have), and one placement rule is added after the glyph rule:

Replace this:
```css
        .header-actions-row button.header-icon-button {
            width: var(--control-height);
```
with this:
```css
        .header-actions-row button.header-icon-button,
        .compact-sticky-header button.header-icon-button {
            width: var(--control-height);
```

Replace this:
```css
        .header-actions-row button.header-icon-button:hover {
            color: var(--text-primary);
```
with this:
```css
        .header-actions-row button.header-icon-button:hover,
        .compact-sticky-header button.header-icon-button:hover {
            color: var(--text-primary);
```

Replace this:
```css
        .header-actions-row button.header-icon-button svg {
            width: 18px;
            min-width: 18px;
            height: 18px;
            flex: none;
        }
```
with this:
```css
        .header-actions-row button.header-icon-button svg,
        .compact-sticky-header button.header-icon-button svg {
            width: 18px;
            min-width: 18px;
            height: 18px;
            flex: none;
        }

        /* Share notice: the shared banner (eng/loading.css) anchored under the Share control, so it stays
           visible on both header surfaces. It anchors to the nearest positioned ancestor (the main
           header's .subtitle or the sticky compact header), so it never leaves the viewport. The
           typography reset undoes the uppercase, tracked text .subtitle passes down. */
        .share-view-notice {
            position: absolute;
            top: calc(100% + 0.35rem);
            right: 0;
            z-index: calc(var(--sticky-control-overlay-z) + 4);
            width: min(26rem, 100%);
            margin: 0;
            box-shadow: 0 12px 28px rgba(22, 22, 22, 0.14);
            text-transform: none;
            letter-spacing: normal;
        }
```

In `frontend/src/dashboard.jsx`, the import:

Replace this:
```jsx
import JiraExportButton from './components/JiraExportButton.jsx';
```
with this:
```jsx
import JiraExportButton from './components/JiraExportButton.jsx';
import ShareViewButton from './shareView/ShareViewButton.jsx';
```

one helper before `renderEpmControls` (it hides the control in EPM and Scenario and passes the analytics surface token, `catch_up`, `planning`, `board` or `statistics`):

Replace this:
```jsx
            const renderEpmControls = (surface, { showProjectPicker = true, showStateControl = true } = {}) => (
```
with this:
```jsx
            const renderShareViewControl = (surface) => selectedView === 'eng' && activeEngMode !== 'scenario' && (
                <ShareViewButton surface={surface} share={shareView} sourceSurface={analyticsToken(activeEngMode)} activeControlSurface={activeControlSurface} />
            );

            const renderEpmControls = (surface, { showProjectPicker = true, showStateControl = true } = {}) => (
```

the main surface, immediately before the Jira export block in `.header-actions-row` (this keeps `.refresh-icon + .group-gear-button` adjacent):

Replace this:
```jsx
                                    {renderSearchControl('main')}
                                    {!(boardScopeRequested && !strictBoardActive) && (
```
with this:
```jsx
                                    {renderSearchControl('main')}
                                    {renderShareViewControl('main')}
                                    {!(boardScopeRequested && !strictBoardActive) && (
```

and the compact surface, a flex sibling after the Search container (the container keeps its own `flex: 0 1 190px` width contract and the exact `<div className="compact-sticky-header-search">` text that `tests/test_epm_shell_source_guards.js` pins):

Replace this:
```jsx
                                <div className="compact-sticky-header-search">
                                    {renderSearchControl('compact', 'compact-sticky-header-search-field')}
                                </div>
```
with this:
```jsx
                                <div className="compact-sticky-header-search">
                                    {renderSearchControl('compact', 'compact-sticky-header-search-field')}
                                </div>
                                {renderShareViewControl('compact')}
```

- [ ] **Step 8: Rebuild and run everything for this task**

```bash
npm run build
fnm exec --using 20 node --test tests/test_share_view_control.js 2>&1 | grep -E '^(not ok|# (tests|pass|fail))'
npx playwright test tests/ui/share_view_control.spec.js --browser=chromium --workers=3 2>&1 | grep -E '✘|passed|failed|skipped'
npx playwright test tests/ui/codebase_structure_smoke.spec.js -g 'multiple groups keep the main controls|open header dropdown toggles filter groups|Task9 freshness reserved copy' --browser=chromium --workers=2 2>&1 | grep -E '✘|passed|failed'
```
Expected: `# tests 5`, `# pass 5`, `# fail 0`; the spec reports `38 passed` and `1 skipped` (the painted-ink case runs only headed, Step 11); the four smoke cases pass (`open header dropdown toggles...`, `multiple groups keep the main controls...` and the two `Task9 freshness reserved copy...` cases; the last two walk nine widths and three search states and require every `.header-icon-button` to be exactly 38 by 38). The harness cases build the stylesheet from source; the app cases and the smoke cases use the `frontend/dist` that `npm run build` just wrote, so they fail on a stale build. The app cases exercise Task 11's real hook: if one fails because the hook disagrees with the binding (`shareDisabled` while the groups load, or a `dropped` notice for an unresolved group), report it against Task 11 instead of patching it here.

- [ ] **Step 9: Pin the `dashboard.jsx` budgets (same commit)**

`dashboard.jsx` grew by exactly 7 lines (the import 1, the helper and its blank line 4, two call sites 2). Measure, then move the legacy pin and the manifest together with a one-line reason; `appPlusOwners` is the dashboard plus the unchanged `uniqueOwners` aggregate. Create the throwaway script `tmp/share-view-mock/budget-pins.py` (gitignored):

```python
import json
import re
import sys

n = int(sys.argv[1])

# Legacy line budget (tests/test_codebase_structure_budgets.py): one pin plus a one-line reason.
path = 'tests/test_codebase_structure_budgets.py'
source = open(path).read()
source, count = re.subn(
    r'\n    "frontend/src/dashboard\.jsx": \d+,',
    f'\n    # Issue #194 Share control: its import, one render helper and the two header call sites (+7).\n    "frontend/src/dashboard.jsx": {n},',
    source,
)
assert count == 1, 'legacy pin not found exactly once'
open(path, 'w').write(source)

# Extraction manifest: the dashboard entry and the aggregate it feeds (appPlusOwners = dashboard + unique owners).
path = 'scripts/extraction_lint/owner_budgets.json'
text = open(path).read()
unique_owners = json.loads(text)['aggregates']['uniqueOwners']['measured']
text, count = re.subn(
    r'("dashboard": \{\s*"path": "frontend/src/dashboard\.jsx",\s*"lineCount": )\d+(,\s*"lineCeiling": )\d+',
    lambda match: f'{match.group(1)}{n}{match.group(2)}{n}',
    text,
)
assert count == 1, 'dashboard manifest entry not found exactly once'
text, count = re.subn(
    r'("appPlusOwners": \{\s*"measured": )\d+(,\s*"ceiling": )\d+',
    lambda match: f'{match.group(1)}{n + unique_owners}{match.group(2)}{n + unique_owners}',
    text,
)
assert count == 1, 'appPlusOwners aggregate not found exactly once'
open(path, 'w').write(text)
print(f'dashboard.jsx pinned at {n}; appPlusOwners pinned at {n + unique_owners}')
```

```bash
wc -l frontend/src/dashboard.jsx
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets 2>&1 | tail -4
N=$(wc -l < frontend/src/dashboard.jsx | tr -d ' ')
$PY tmp/share-view-mock/budget-pins.py "$N"
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets 2>&1 | tail -4
git diff --stat -- tests/test_codebase_structure_budgets.py scripts/extraction_lint/owner_budgets.json
```
Expected: the first run fails (`frontend/src/dashboard.jsx: <N> lines exceeds budget <N-7>`, `dashboard measured lineCount differs from actual`, `appPlusOwners: measured aggregate ... differs from unique actual ...`); the script prints `dashboard.jsx pinned at <N>; appPlusOwners pinned at <N + uniqueOwners>`; the second run reports `Ran 2 tests` and `OK`; the diff touches the legacy dict (a new comment line plus the pin), the manifest's `dashboard` entry (`lineCount` and `lineCeiling`) and `appPlusOwners` (`measured` and `ceiling`).

- [ ] **Step 10: Run the task's regression gate**

```bash
fnm exec --using 20 node --test tests/test_*.js 2>&1 | grep -E '^(not ok|# (tests|pass|fail))'
env JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile APP_ENVIRONMENT_KEY=local ATLASSIAN_SCOPES='read:me read:jira-work write:jira-work read:jira-user read:board-scope:jira-software read:sprint:jira-software read:project:jira offline_access' $PY -m unittest tests.test_codebase_structure_budgets tests.test_dashboard_css_extraction 2>&1 | tail -3
fnm exec --using 20 bash scripts/extraction_lint/run.sh 2>&1 | grep -E 'problems|owner budgets'
npx playwright test tests/ui/codebase_structure_smoke.spec.js tests/ui/planning_review_integration.spec.js tests/ui/dashboard_data_freshness.spec.js tests/ui/eng_compact_layout_visual.spec.js tests/ui/planning_selection_defaults.spec.js tests/ui/onboarding_tour.spec.js --browser=chromium --workers=4 2>&1 | grep -E '✘|passed|failed|skipped'
npx playwright test tests/ui/share_view_control.spec.js --browser=firefox --workers=2 2>&1 | grep -E '✘|passed|failed|skipped'
npx playwright test tests/ui/share_view_control.spec.js --browser=webkit --workers=2 2>&1 | grep -E '✘|passed|failed|skipped'
```
Expected: no `not ok`, `# tests` equal to the previous task's total plus 5; `OK` for both Python modules; the lint reports `0 errors`, `104 warnings` (105 before this task: Task 11b's transient `'shareView' is assigned a value but never used` is cleared because `renderShareViewControl` now reads it; the new files add none; the ratchet is 106) and `owner budgets: 0 problems`; the Chromium UI set passes with no skipped header case (`onboarding_tour.spec.js` `offscreen target scrolls once on step entry...` is timing-sensitive under four workers: if it is the only failure, run it alone with `--repeat-each=3` before treating it as a regression; it passed 3 of 3 alone, at the base and with Share. On a machine busy with other test runs, `open header dropdown toggles filter groups teams and sprints` (about 19 s alone against the 30 s limit) and some Firefox and WebKit cases can time out as well: re-run each failure alone with `--workers=1` before treating it as a regression); Firefox and WebKit report `38 passed` and `1 skipped`. In a headless WebKit run, the two `Task9 freshness reserved copy...` smoke cases already fail at `bd5b2bc2` with or without Share (document width 782 px against 781 and 755 px at several widths, identical sets of failing assertions), so compare against that baseline instead of running them as a gate here.

- [ ] **Step 11: Run the painted-ink check in headed Firefox and WebKit at 2x**

```bash
npx playwright test tests/ui/share_view_control.spec.js --browser=firefox --headed -g "painted glyph ink"
npx playwright test tests/ui/share_view_control.spec.js --browser=webkit --headed -g "painted glyph ink"
```
Expected: `1 passed` in each (headless runs and non-macOS platforms skip it). It measures the absolute-pixel ink of the link and the copied glyph at rest and on hover on both surfaces against the centre of the 38 by 38 frame, tolerance 0.75 px. Headless runs of the same measurement, with the skips removed, gave at most 0.41 px of offset in Chromium, Firefox and WebKit. Look at the screenshot of a failure before changing a tolerance.

- [ ] **Step 12: Commit**

```bash
git add assets/mockups/share-view-control-194.html docs/plans/EXEC-shareable-view-links-194-control.md frontend/src/shareView/ShareViewButton.jsx frontend/src/shareView/noticeCopy.js frontend/src/dashboard.jsx frontend/src/styles/shared/controls.css tests/test_share_view_control.js tests/ui/share_view_control_harness.jsx tests/ui/share_view_control.spec.js tests/ui/codebase_structure_smoke.spec.js tests/test_codebase_structure_budgets.py scripts/extraction_lint/owner_budgets.json
git add -A frontend/dist
git -c user.name=Juce -c user.email=Juce-me@users.noreply.github.com commit -m "Add the Share control to both header surfaces" -m "The control copies a self-contained view link from the main and compact headers, reuses the shared header icon button and the shared banner, and falls back to a read-only field when the clipboard is unavailable. No new hover CSS: the compact surface joins the existing icon-button rules. The accepted mock is kept in assets/mockups and pinned to the component by a parity test."
git show --stat HEAD
git status --short
make verify-dist-clean
```
Expected: the 12 listed files plus the regenerated `frontend/dist` files; `git status --short` prints nothing (`tmp/share-view-mock/` is ignored); `make verify-dist-clean` prints nothing and exits 0 (it reads `git status --porcelain -- frontend/dist`, so it passes only after the commit).

## Notes for the executor

Decisions already settled while this slice was drafted; none changes a binding name in the master.

1. `ShareViewButton` takes two props beyond `surface` and `share`: `sourceSurface` (the `copy_link` event's `source_surface`) and `activeControlSurface` (the prop `SprintControl`, `GroupControl` and `TeamControl` already receive, so only the showing surface renders the notice). `dashboard.jsx` passes them through `renderShareViewControl`.
2. The compact control is a flex sibling directly after `.compact-sticky-header-search`, not a child: a child would shrink Search or need a `:has()` rule, and the guard in `tests/test_epm_shell_source_guards.js` slices on the exact `<div className="compact-sticky-header-search">` text. Measured cost: nothing moves at 1028 px and wider; at 761 px Sprint and Teams are 21 and 16 px narrower.
3. The notice renders inside `ShareViewButton`, anchored under the control, reusing `.server-unavailable-banner.connection-recovery-notice` with one placement rule, `.share-view-notice`. There is no notice mount in `dashboard.jsx`, so Task 11 adds none. It covers the right part of the controls row until Dismiss; the operator reviews this at gate G2.
4. At most one control is visible at any scroll position: the compact one exactly while the compact header is visible. For about 87 px of scroll neither is on screen, as for every control in the main actions row; closing that band would change `compactStickyVisible`, which is outside this feature.
5. `dropped` carries the state key `focus`, which `SHARE_VIEW_CATEGORY_BY_KEY` (a query-key map) does not contain; `shareViewDroppedCategories` maps it locally and every other key through `Object.hasOwn`.
6. Task 10 does not edit `dashboard.jsx` (to avoid two unused-name lint warnings): Task 11b destructures `analyticsReady` and `trackShareViewAction` from `useDashboardAnalytics`, sends `apply_link` only after `analyticsReady` with a valid `sourceSurface`, calls `dismissNotice()` with no arguments, and keeps `captureShareUrl()` synchronous (Safari requires the clipboard write inside the click).
7. Test infrastructure: the UI specs read a built `frontend/dist` even for harness cases; the shared fixture routes `/` with a regexp that never matches a URL with a query, so the link case registers its own route; the smoke spec builds `dashboard.jsx` from source but serves `frontend/dist/dashboard.css`, so CSS edits reach it only after `npm run build`.
8. Two `Task9 freshness reserved copy` cases in `codebase_structure_smoke.spec.js` already fail in headless WebKit at the base (document width 782 px against 781 and 755 px). Record the WebKit baseline in Task 0 before Task 14 treats them as regressions. Lint runs as `fnm exec --using 20 bash scripts/extraction_lint/run.sh`.
9. The `docs/README_ANALYTICS.md` rows written by Task 10 precede the behavior Tasks 11 and 12 implement; the source guards check the documentation text only. The table in `docs/plans/SUPPORT-ga4-user-configuration.md` that lists a user action, its GA4 event and what it must and must not include is its Event Validation table, so the new row goes there; no row is added to Reports To Build.
10. Gate G2: Step 2 stops with `Operator acceptance: pending`; Steps 3 to 12 run only after the operator accepts the mock and the date is recorded in this file.
