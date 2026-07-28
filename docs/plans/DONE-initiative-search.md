# Initiative-Level ENG Search Implementation Plan

> **Status:** Done. Executed in `a7cacf6..5d3b136` and accepted on 2026-07-28. Kept for audit context only.

> **Verification note:** Focused unit, analytics, structure, committed-dist browser, screenshot, and deterministic-build checks passed. The repository-wide push gate retained two unrelated alert-summary UI failures and an unchanged Cloud SQL preflight hang.

**Goal:** Extend ENG dashboard search so an Initiative key or summary match reveals every loaded Epic and Story beneath that Initiative while preserving existing Epic descendant matching.

**Architecture:** Keep search local to the already-loaded ENG task and `epicDetails` data. Extract the current inline Story/Epic predicate into one pure hierarchy-aware utility, add Initiative key and summary to its candidates, and keep the existing sprint, team, product/tech, status, Done, and Killed filters authoritative after the search match.

**Tech Stack:** React 19, JavaScript ES modules, Node 20 `node:test`, Playwright, esbuild.

## Global Constraints

- Search only already-loaded ENG work in the selected sprint; do not add a Jira request, endpoint, JQL clause, cache, or backend response field.
- Initiative search fields are `initiative.key` and `initiative.summary`, already present under `epicDetails[epicKey].initiative`.
- An Initiative match keeps every loaded Story whose Epic references that Initiative; the existing grouping pass then renders every matching Epic.
- An Epic key or summary match continues to keep every loaded Story beneath that Epic.
- Existing team, product/tech, status, Done, Killed, and burnout filters remain authoritative.
- Initiative search must work whether Initiative grouping is on or off; search must not change the grouping toggle.
- Missing task, Epic, or Initiative metadata must not throw.
- Keep the existing `app_search` analytics event and typed parameters; never send raw search text, Jira keys, or summaries.
- Do not hand-edit `frontend/dist/`; regenerate it with `npm run build`.
- Capture browser screenshots only after animations and transitions settle.

---

### Task 1: Add and wire the hierarchy-aware ENG search matcher

**Files:**
- Modify: `tests/test_eng_task_utils.js`
- Modify: `frontend/src/eng/engTaskUtils.js`
- Modify: `frontend/src/dashboard.jsx`

**Interfaces:**
- Consumes: a Jira task object, the current query string, and the existing `epicDetails` object keyed by Epic key.
- Produces: `matchesEngTaskSearch(task, query, epicDetails = {}) -> boolean`.
- Preserves: the current `scopedTasks` memo dependencies and all filters applied after the search predicate.

- [x] **Step 1: Add failing unit coverage for Story, Epic, and Initiative matching**

Append tests that import `matchesEngTaskSearch`, construct two Epics under one Initiative plus an unrelated Epic, and filter the Story fixtures through the matcher:

```js
test('ENG search expands Initiative and Epic matches to loaded descendant stories', async () => {
    const { matchesEngTaskSearch } = await import('../frontend/src/eng/engTaskUtils.js');
    const task = (key, epicKey, summary, assignee = 'Story Owner') => ({
        key,
        fields: {
            summary,
            epicKey,
            assignee: { displayName: assignee },
        },
    });
    const tasks = [
        task('PROD-1', 'PROD-EPIC-A', 'Gateway story'),
        task('PROD-2', 'PROD-EPIC-A', 'Checkout story'),
        task('PROD-3', 'PROD-EPIC-B', 'Invoice story'),
        task('PROD-4', 'PROD-EPIC-B', 'Refund story'),
        task('TECH-1', 'TECH-EPIC-X', 'Unrelated platform story'),
    ];
    const epicDetails = {
        'PROD-EPIC-A': {
            summary: 'Payments API',
            assignee: { displayName: 'Payments Lead' },
            initiative: { key: 'INIT-42', summary: 'Payments Initiative' },
        },
        'PROD-EPIC-B': {
            summary: 'Payments Experience',
            assignee: { displayName: 'Payments Lead' },
            initiative: { key: 'INIT-42', summary: 'Payments Initiative' },
        },
        'TECH-EPIC-X': {
            summary: 'Platform Maintenance',
            initiative: { key: 'INIT-99', summary: 'Platform Initiative' },
        },
    };
    const matchingKeys = (query) => tasks
        .filter(item => matchesEngTaskSearch(item, query, epicDetails))
        .map(item => item.key);

    assert.deepEqual(matchingKeys('INIT-42'), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']);
    assert.deepEqual(matchingKeys('payments initiative'), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']);
    assert.deepEqual(matchingKeys('PROD-EPIC-A'), ['PROD-1', 'PROD-2']);
    assert.deepEqual(matchingKeys('payments api'), ['PROD-1', 'PROD-2']);
    assert.deepEqual(matchingKeys('gateway story'), ['PROD-1']);
    assert.deepEqual(matchingKeys('payments lead'), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4']);
    assert.deepEqual(matchingKeys(''), ['PROD-1', 'PROD-2', 'PROD-3', 'PROD-4', 'TECH-1']);
    assert.equal(matchesEngTaskSearch({ key: 'SAFE-1', fields: {} }, 'missing', {}), false);
});
```

- [x] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
node --test tests/test_eng_task_utils.js
```

Expected: FAIL because `matchesEngTaskSearch` is not exported.

- [x] **Step 3: Implement the pure matcher**

Add this utility near the other task-level ENG helpers in `frontend/src/eng/engTaskUtils.js`:

```js
export function matchesEngTaskSearch(task, query, epicDetails = {}) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return true;

    const fields = task?.fields || {};
    const epicKey = String(fields.epicKey || '');
    const epic = epicKey ? (epicDetails?.[epicKey] || {}) : {};
    const initiative = epic?.initiative || {};
    const candidates = [
        task?.key,
        fields.summary,
        fields.assignee?.displayName,
        epicKey,
        epic.summary,
        epic.assignee?.displayName,
        initiative.key,
        initiative.summary,
    ];

    return candidates.some(value => (
        value != null
        && String(value).toLowerCase().includes(normalizedQuery)
    ));
}
```

- [x] **Step 4: Replace only the inline search predicate**

Import `matchesEngTaskSearch` from `./eng/engTaskUtils.js`. In the `scopedTasks` memo, replace the current Story/Epic candidate block with:

```js
if (!matchesEngTaskSearch(task, query, epicDetails)) {
    return false;
}
```

Keep the existing query normalization, subsequent team/product/tech checks, and memo dependency list unchanged. Do not move status, Done, Killed, or burnout filtering into the utility.

- [x] **Step 5: Verify the matcher and structural budget**

Run:

```bash
node --test tests/test_eng_task_utils.js
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
```

Expected: both commands pass. `frontend/src/dashboard.jsx` should shrink because the inline candidate block is removed.

- [x] **Step 6: Commit the working search slice when implementation commits are authorized**

```bash
git add frontend/src/eng/engTaskUtils.js frontend/src/dashboard.jsx tests/test_eng_task_utils.js
git commit -m "feat: search ENG work by Initiative"
```

---

### Task 2: Prove descendant rendering in the browser

**Files:**
- Modify: `tests/ui/codebase_structure_smoke.spec.js`

**Interfaces:**
- Consumes: `matchesEngTaskSearch` through the bundled dashboard and custom test-owned task/Epic fixtures.
- Produces: browser proof that Initiative and Epic matches render their loaded descendants without new API calls.

- [x] **Step 1: Make the existing API mock accept test-owned ENG hierarchy fixtures**

Inside `installApiMocks`, change only the `/api/tasks-with-team-name` response setup so callers may pass `tasksByProject` and `epicsByProject`:

```js
const defaultTasksByProject = { product: productTasks, tech: techTasks };
const defaultEpicsByProject = {
    product: { [productEpic.key]: productEpic },
    tech: { [techEpic.key]: techEpic },
};
const taskSource = options.tasksByProject?.[project] || defaultTasksByProject[project] || [];
const epics = options.epicsByProject?.[project] || defaultEpicsByProject[project] || {};
const issues = purpose === 'ready-to-close' ? [] : taskSource;
return json({
    issues,
    epics,
    epicsInScope: Object.values(epics),
    names: {},
});
```

Keep all existing default fixtures unchanged so unrelated smoke tests retain their current rendering.

- [x] **Step 2: Add the focused Initiative/Epic browser case**

Add `test('Initiative and Epic search reveal loaded descendants', async ({ page }) => { ... })`. Create two Product Epics with `initiative: { key: 'INIT-42', summary: 'Payments Initiative' }`, two Stories beneath each, and one unrelated Tech Epic/Story. Initialize ENG with the active sprint, all teams, Catch Up mode, Done visible, and Killed hidden. Then:

1. Load the unfiltered fixture and assert three `.epic-block` elements and five `.task-item` elements.
2. Capture `initiative-search-before.png` through `captureSmokeScreenshot`.
3. Fill the first `Search tickets...` input with `Payments Initiative`.
4. Assert both Product Epic blocks and all four Product Stories are visible, while the Tech Epic/Story is absent.
5. Assert exactly two `.epic-block` elements and four `.task-item` elements.
6. Capture `initiative-search-results.png`.
7. Fill the search with `INIT-42` and assert the same two-Epic/four-Story result.
8. Fill the search with the first Product Epic key and assert one Epic block plus its two Stories.
9. Assert `apiMocks.unexpectedCalls` is empty throughout.

Use exact synthetic keys and summaries only; do not copy real Jira data into the fixture or screenshots.

- [x] **Step 3: Run the focused browser case**

Start the local Flask server on port `5050`, verify `GET /api/test`, then run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "Initiative and Epic search reveal loaded descendants"
```

Expected: PASS with settled before/after screenshots under the smoke test's temporary screenshot directory.

- [x] **Step 4: Inspect the screenshots**

Confirm visually that:

- The before state shows three Epic groups and five Stories.
- The Initiative result shows both matching Product Epic headers and all four descendant Stories.
- The unrelated Tech Epic and Story are absent.
- Search does not introduce sticky-header, overlap, truncation, or grouping-toggle changes.

- [x] **Step 5: Commit the browser proof when implementation commits are authorized**

```bash
git add tests/ui/codebase_structure_smoke.spec.js
git commit -m "test: verify Initiative search descendants"
```

---

### Task 3: Record analytics impact, rebuild, and verify

**Files:**
- Modify: `docs/README_ANALYTICS.md`
- Regenerate: `frontend/dist/dashboard.js`
- Regenerate: `frontend/dist/dashboard.js.map`

**Interfaces:**
- Preserves: the existing `app_search` event with `search_scope`, `query_length_bucket`, `result_count_bucket`, and `source_surface`.
- Produces: current analytics documentation and deterministic built frontend output.

- [x] **Step 1: Update the existing `app_search` taxonomy row**

Extend its trigger text to state that ENG result counts include Story, Epic, and Initiative hierarchy matching. Do not add an event, parameter, custom dimension, raw query value, issue key, or summary.

- [x] **Step 2: Run the frontend unit suite**

```bash
npm run test:frontend:unit
```

Expected: PASS.

- [x] **Step 3: Rebuild generated frontend output**

```bash
npm run build
```

Expected: PASS. Include generated `frontend/dist/dashboard.js` and `frontend/dist/dashboard.js.map` changes; unrelated auth and CSS bundles should remain unchanged.

- [x] **Step 4: Re-run focused verification against the production bundle**

Run:

```bash
node --test tests/test_eng_task_utils.js tests/test_analytics_source_guards.js
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "Initiative and Epic search reveal loaded descendants"
```

Expected: all commands pass.

- [x] **Step 5: Check build determinism and final scope**

Run `npm run build` a second time and confirm `git status --short` does not gain additional changes. Inspect `git diff --check` and `git diff --stat`; every changed line must trace to hierarchy search, its tests, analytics documentation, this plan, or generated output.

- [x] **Step 6: Commit documentation and generated output when implementation commits are authorized**

```bash
git add docs/README_ANALYTICS.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map
git commit -m "docs: record Initiative search analytics"
```

- [x] **Step 7: Apply the repository push gate**

Before any push:

```bash
python3 -m unittest discover -s tests
npm run test:frontend:unit
npx playwright test tests/ui
git log --oneline -5
```

Expected: all suites pass. Review the screenshots and recent commits, then wait for explicit user confirmation before pushing.

## Acceptance Criteria

- Searching an Initiative key or summary in ENG renders every loaded Epic and Story beneath that Initiative.
- Searching an Epic key or summary still renders every loaded Story beneath that Epic.
- Story key, summary, and assignee plus Epic assignee matching remain unchanged.
- Search results remain constrained by the selected sprint and active ENG filters.
- Grouped and flat Initiative views both filter correctly without changing the toggle.
- Missing hierarchy metadata is safe and simply produces no hierarchy-field match.
- No Jira/API request, endpoint, payload, cache, dependency, or migration is added.
- Existing bucketed `app_search` analytics records the updated result count without sending raw search content.
- Focused unit, structure, browser, screenshot, analytics, and build verification pass.
