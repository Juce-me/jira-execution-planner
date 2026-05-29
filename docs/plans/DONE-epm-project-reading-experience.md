# EPM Project Reading Experience Implementation Plan

> **Status:** Done. Executed in PR #41 (`94b759b`). Kept for audit context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** Make the EPM all-projects board answer which projects are on track, stale, or missing status updates without changing Jira/Home API behavior.

**Architecture:** Treat the current EPM project board redesign as the baseline. Keep the existing data model, rollup loading, collapse behavior, links, and Home/Jira fetches unchanged; extend the shared project update helper to classify update freshness from the already available `latestUpdateDate`, then render stale or missing update states in `EpmRollupPanel.jsx` and the matching CSS/tests.

**Tech Stack:** React 19 JSX, shared EPM helpers in `frontend/src/epm/epmProjectUtils.mjs`, existing CSS in `frontend/src/styles/dashboard.css`, Node source guards, Playwright visual tests, esbuild generated output.

---

## Revision Snapshot

This plan was partially implemented before this revision. Do not re-execute the old header-only checklist.

Already present in the current code:

- Project titles use natural-case system typography instead of uppercase monospace labels.
- The Jira rollup disclosure is separate from the title/header content.
- Status, owner, Jira label, and target date render in compact metadata positions.
- Latest Home update text renders below the project identity, preserves sanitized HTML, preserves author/date, and links to the specific Home update when available.
- The Playwright fixture already covers desktop, medium, and narrow viewports.

Still true in the current code:

- The Home emoji/icon remains in the title row.
- The project name itself is the Home link; there is no separate plain `Home` link chip.
- Latest updates still use a subtle bordered note style.
- The vertical rail is attached to the rollup body, not the whole project board.

Those remaining differences are not the main UX problem now. The higher-value gap is status freshness: a project can look "On track" even when the last Home status update is stale or missing.

## Execution Status

Updated on 2026-05-26.

Implemented:

- Shared EPM project update freshness classification with a 14-day stale threshold.
- Visible `Stale update`, `No Home update`, and `Update date missing` badges.
- Red stale update date text so status age is scannable without turning the whole update red.
- Visual fixture coverage for expanded stale rows and collapsed missing-update rows.
- Source guards and utility tests for freshness metadata.

Still blocked or out of scope:

- Home/Townsquare write capability remains blocked by `docs/plans/GATE-05-home-write-capability.md`.
- This plan does not add update creation/editing, Jira/Home fetch changes, EPM settings behavior, or new backend routes.

Verified on 2026-05-26:

- `npm run build`
- `node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js`
- `npx playwright test tests/ui/epm_portfolio_header_visual.spec.js tests/ui/epm_multi_subgoal_visual.spec.js tests/ui/epm_initial_config_load.spec.js`
- Visual screenshots inspected at `/tmp/epm-portfolio-header-qa/desktop.png`, `/tmp/epm-portfolio-header-qa/medium.png`, and `/tmp/epm-portfolio-header-qa/narrow.png`.
- `env CONFIG_STORAGE_BACKEND=jsonfile JIRA_AUTH_MODE=basic DATABASE_URL= TEST_DATABASE_URL= .venv/bin/python -m unittest discover -s tests` passed: 687 tests, 1 skipped.

## UX Decision

Use update freshness as the missing/at-risk reading signal:

- `fresh`: a Home update date exists and is at most 14 calendar days old.
- `stale`: a Home update date exists and is more than 14 calendar days old.
- `missing`: there is no Home update content to show, so the UI is only displaying a status fallback such as `Status is on track.`
- `unknown`: update content exists, but no parseable update date is available.

For `stale`, highlight only `.epm-project-board-update-date` in red and add a compact `Stale update` badge. For `missing`, show a `No Home update` badge while keeping fallback copy in the normal update text color. The color must not be the only signal: the visible badge text is required.

Use a strict threshold: exactly 14 days old is still fresh; more than 14 days is stale.

## File Map

Modify:

- `frontend/src/epm/epmProjectUtils.mjs` - compute update age and freshness metadata from existing project fields.
- `frontend/src/epm/EpmRollupPanel.jsx` - add freshness classes and visible stale/missing badges to the latest-update row.
- `frontend/src/styles/dashboard.css` - add stale date and freshness badge treatment.
- `tests/test_epm_project_utils.js` - cover freshness classification and update existing expected objects.
- `tests/test_epm_view_source_guards.js` - guard against losing the freshness UI path.
- `tests/ui/epm_portfolio_header_visual.spec.js` - add stale and missing update fixture rows and style assertions.

Do not modify:

- Backend EPM routes or Home/Townsquare fetchers.
- `frontend/src/api/epmApi.js` or EPM request timing.
- EPM settings behavior.
- Home write routes or mutation UI. `docs/plans/GATE-05-home-write-capability.md` remains blocked.
- Generated `frontend/dist/*` by hand. Run `npm run build` after source changes.

---

### Task 1: Add Failing Freshness Tests

**Files:**
- Modify: `tests/test_epm_project_utils.js`

- [x] **Step 1: Update existing expected update-line objects**

In the existing `buildEpmProjectUpdateLine uses relative dates and status fallback` test, add a `freshness` object to each expected result:

```js
freshness: {
    state: 'fresh',
    label: 'Updated recently',
    ageDays: 14,
    thresholdDays: 14
}
```

for the `2026-04-16` case when `now` is `2026-04-30T12:00:00Z`.

Use this object for the `2026-04-30` case:

```js
freshness: {
    state: 'fresh',
    label: 'Updated recently',
    ageDays: 0,
    thresholdDays: 14
}
```

Use this object for the status-fallback-only case:

```js
freshness: {
    state: 'missing',
    label: 'No Home update',
    ageDays: null,
    thresholdDays: 14
}
```

Also add matching `freshness` objects to the expected results in:

- `buildEpmProjectUpdateLine exposes formatted Home update html when available`
- `buildEpmProjectUpdateLine exposes specific Home update url when available`

Those two existing tests use `2026-04-29` with `now` set to `2026-04-30T12:00:00Z`, so the expected freshness object is:

```js
freshness: {
    state: 'fresh',
    label: 'Updated recently',
    ageDays: 1,
    thresholdDays: 14
}
```

- [x] **Step 2: Add a stale-update test**

Add this test after the existing relative-date test:

```js
test('buildEpmProjectUpdateLine marks Home updates older than two weeks as stale', async () => {
    const { buildEpmProjectUpdateLine } = await import(helperUrl);
    const now = new Date('2026-04-30T12:00:00Z');

    const line = buildEpmProjectUpdateLine({
        latestUpdateDate: '2026-04-15',
        latestUpdateSnippet: 'Rollout is still on track.',
        latestUpdateAuthor: 'Ada Lovelace',
        stateLabel: 'On track'
    }, now);

    assert.strictEqual(line.relativeDate, '2 weeks ago');
    assert.deepStrictEqual(line.freshness, {
        state: 'stale',
        label: 'Stale update',
        ageDays: 15,
        thresholdDays: 14
    });
});
```

- [x] **Step 3: Add an unknown-date test**

Add:

```js
test('buildEpmProjectUpdateLine marks Home update content without a date as unknown freshness', async () => {
    const { buildEpmProjectUpdateLine } = await import(helperUrl);
    const now = new Date('2026-04-30T12:00:00Z');

    const line = buildEpmProjectUpdateLine({
        latestUpdateSnippet: 'Status text exists, but Home did not provide a date.',
        stateLabel: 'On track'
    }, now);

    assert.strictEqual(line.relativeDate, '');
    assert.deepStrictEqual(line.freshness, {
        state: 'unknown',
        label: 'Update date missing',
        ageDays: null,
        thresholdDays: 14
    });
});
```

- [x] **Step 4: Run the utility tests and confirm failure**

Run:

```bash
node --test tests/test_epm_project_utils.js
```

Expected before implementation: FAIL because `buildEpmProjectUpdateLine` does not expose `freshness`.

---

### Task 2: Classify Update Freshness In The Shared Helper

**Files:**
- Modify: `frontend/src/epm/epmProjectUtils.mjs`

- [x] **Step 1: Add the threshold constant**

Near the existing helper constants/functions, add:

```js
export const EPM_PROJECT_UPDATE_STALE_DAYS = 14;
```

- [x] **Step 2: Add an age helper**

After `startOfUtcDay(value)`, add:

```js
function getEpmProjectUpdateAgeDays(value, now = new Date()) {
    const date = parseEpmProjectDate(value);
    const nowDay = startOfUtcDay(now);
    if (!date || nowDay === null) return null;
    const dateDay = startOfUtcDay(date);
    return Math.max(0, Math.floor((nowDay - dateDay) / 86400000));
}
```

- [x] **Step 3: Reuse the age helper in relative dates**

Change `formatEpmProjectRelativeDate(value, now = new Date())` so it uses `getEpmProjectUpdateAgeDays`:

```js
function formatEpmProjectRelativeDate(value, now = new Date()) {
    const days = getEpmProjectUpdateAgeDays(value, now);
    if (days === null) return '';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) {
        const weeks = Math.max(1, Math.floor(days / 7));
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    if (days < 365) {
        const months = Math.max(1, Math.floor(days / 30));
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    const years = Math.max(1, Math.floor(days / 365));
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}
```

- [x] **Step 4: Add a freshness helper**

Add below `formatEpmProjectRelativeDate`:

```js
function buildEpmProjectUpdateFreshness(date, hasHomeUpdate, now = new Date()) {
    const ageDays = getEpmProjectUpdateAgeDays(date, now);
    const base = {
        ageDays,
        thresholdDays: EPM_PROJECT_UPDATE_STALE_DAYS
    };
    if (!hasHomeUpdate) {
        return {
            state: 'missing',
            label: 'No Home update',
            ...base,
            ageDays: null
        };
    }
    if (ageDays === null) {
        return {
            state: 'unknown',
            label: 'Update date missing',
            ...base
        };
    }
    if (ageDays > EPM_PROJECT_UPDATE_STALE_DAYS) {
        return {
            state: 'stale',
            label: 'Stale update',
            ...base
        };
    }
    return {
        state: 'fresh',
        label: 'Updated recently',
        ...base
    };
}
```

- [x] **Step 5: Attach freshness to update lines**

Inside `buildEpmProjectUpdateLine(project, now = new Date())`, after `updateUrl` is calculated, add:

```js
const hasHomeUpdate = Boolean(date || snippet || messageHtml || author || updateUrl);
const freshness = buildEpmProjectUpdateFreshness(date, hasHomeUpdate, now);
```

Then add `freshness` to the returned `line` object:

```js
const line = {
    text: [relativeDate, author, message].filter(Boolean).join(' · '),
    title: [date, author].filter(Boolean).join(' · '),
    relativeDate,
    message,
    freshness
};
```

- [x] **Step 6: Run the utility tests**

Run:

```bash
node --test tests/test_epm_project_utils.js
```

Expected: PASS.

---

### Task 3: Render Freshness State In The Project Board

**Files:**
- Modify: `frontend/src/epm/EpmRollupPanel.jsx`

- [x] **Step 1: Normalize the freshness fields**

Inside `renderProjectUpdate(updateLine)`, after `updateHref` is calculated, add:

```jsx
const freshnessState = String(updateLine.freshness?.state || '').trim();
const freshnessLabel = String(updateLine.freshness?.label || '').trim();
const freshnessClassName = freshnessState ? ` is-${freshnessState}` : '';
const showFreshnessLabel = freshnessLabel && freshnessState !== 'fresh';
```

- [x] **Step 2: Add state classes to the row and article**

Change:

```jsx
<div className="epm-project-board-update-row" title={updateLine.title || undefined}>
    <article className="epm-project-board-update" aria-label="Latest Home update">
```

to:

```jsx
<div className={`epm-project-board-update-row${freshnessClassName}`} title={updateLine.title || undefined}>
    <article className={`epm-project-board-update${freshnessClassName}`} aria-label="Latest Home update">
```

- [x] **Step 3: Render a visible badge for stale, missing, and unknown states**

Inside `renderUpdateMeta()`, first change the early return from:

```jsx
if (!updateLine.relativeDate && !updateLine.author) return null;
```

to:

```jsx
if (!updateLine.relativeDate && !updateLine.author && !showFreshnessLabel) return null;
```

Then append this after the author/date spans:

```jsx
{showFreshnessLabel && (
    <span className={`epm-project-board-update-freshness is-${freshnessState}`}>
        {freshnessLabel}
    </span>
)}
```

The badge must be inside the metadata link when `updateHref` exists, so the stale/missing signal stays attached to the update metadata. Do not render it as a separate project action.

- [x] **Step 4: Preserve existing update HTML and links**

Do not change these existing paths:

```jsx
dangerouslySetInnerHTML={{ __html: updateLine.messageHtml }}
```

and:

```jsx
<a className="epm-project-board-update-more" href={updateHref} target="_blank" rel="noopener noreferrer">
    More details
</a>
```

The freshness UI is additive only.

---

### Task 4: Style Stale And Missing Update Signals

**Files:**
- Modify: `frontend/src/styles/dashboard.css`

- [x] **Step 1: Add the freshness badge style**

Place near the existing `.epm-project-board-update-meta` and date/author styles:

```css
.epm-project-board-update-freshness {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    max-width: 100%;
    padding: 0.08rem 0.34rem;
    border: 1px solid transparent;
    border-radius: 999px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    line-height: 1.1;
    text-transform: uppercase;
    white-space: nowrap;
}

.epm-project-board-update-freshness.is-stale,
.epm-project-board-update-freshness.is-missing {
    color: var(--text-secondary);
    border-color: var(--border);
    background: rgba(255, 255, 255, 0.78);
}

.epm-project-board-update-freshness.is-unknown {
    color: #92400e;
    border-color: #fed7aa;
    background: #fff7ed;
}
```

- [x] **Step 2: Make only the stale update date red**

Add this after the existing update metadata hover/focus rules so the stale date does not turn blue on hover:

```css
.epm-project-board-update.is-stale .epm-project-board-update-date {
    color: #b91c1c;
}
```

This implements the red text rule for status updates older than two weeks without making the update copy, author, or missing fallback text red.

- [x] **Step 3: Run a source search for duplicate one-off colors**

Run:

```bash
rg -n "#b91c1c|#fef2f2|#fecaca" frontend/src/styles/dashboard.css
```

Expected: no stale/missing badge, copy, or link rules use red; any matches should be unrelated existing styles or the stale date rule.

---

### Task 5: Update Source Guards

**Files:**
- Modify: `tests/test_epm_view_source_guards.js`

- [x] **Step 1: Add a helper-source guard**

Add a test near the other EPM project update-line source guards:

```js
test('EPM portfolio update line exposes freshness state for stale or missing Home updates', () => {
    assert.ok(helperSource.includes('EPM_PROJECT_UPDATE_STALE_DAYS = 14'), 'Expected two-week Home update freshness threshold');
    assert.ok(helperSource.includes('buildEpmProjectUpdateFreshness'), 'Expected shared update helper to classify freshness');
    assert.ok(helperSource.includes("state: 'stale'"), 'Expected stale Home update state');
    assert.ok(helperSource.includes("state: 'missing'"), 'Expected missing Home update state');
    assert.ok(helperSource.includes('freshness'), 'Expected update line to expose freshness metadata');
});
```

- [x] **Step 2: Add a render/CSS guard**

Add:

```js
test('EPM portfolio renders visible stale and missing update signals', () => {
    assert.ok(epmRollupPanelSource.includes('epm-project-board-update-freshness'), 'Expected visible freshness badge in the project update row');
    assert.ok(epmRollupPanelSource.includes('is-${freshnessState}'), 'Expected update row to receive freshness state classes');
    assert.ok(dashboardCssSource.includes('.epm-project-board-update.is-stale .epm-project-board-update-date'), 'Expected stale update date to be styled');
    assert.ok(!dashboardCssSource.includes('.epm-project-board-update.is-stale .epm-project-board-update-copy'), 'Stale update copy should not get the red date treatment');
    assert.ok(dashboardCssSource.includes('.epm-project-board-update-freshness.is-missing'), 'Expected missing update badge styling');
});
```

- [x] **Step 3: Run the source guards**

Run:

```bash
node --test tests/test_epm_view_source_guards.js
```

Expected: PASS after implementation.

---

### Task 6: Update The Visual Fixture And Assertions

**Files:**
- Modify: `tests/ui/epm_portfolio_header_visual.spec.js`

- [x] **Step 1: Make the fixture include one stale update**

In the second `.epm-project-board`, change the update metadata date from `1 week ago` to `3 weeks ago`, add `is-stale` to `.epm-project-board-update-row` and `.epm-project-board-update`, and add the badge:

```html
<div class="epm-project-board-update-row is-stale">
    <article class="epm-project-board-update is-stale" aria-label="Latest Home update">
        <a class="epm-project-board-update-meta epm-project-board-update-meta-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-325/updates/update-2">
            <span class="epm-project-board-update-date">3 weeks ago</span>
            <span class="epm-project-board-update-author">Grace Hopper</span>
            <span class="epm-project-board-update-freshness is-stale">Stale update</span>
        </a>
```

Keep the existing bullet-list copy so the stale state proves list text stays readable.

- [x] **Step 2: Add collapsed missing-update coverage**

Keep the existing collapsed long-update board with its `today` metadata, author, `profitable pairs` copy, and update-specific `More details` link. Add a separate collapsed board for the missing-update state:

```html
<div class="epm-project-board-update-row is-missing">
    <article class="epm-project-board-update is-missing" aria-label="Home update status">
        <div class="epm-project-board-update-meta">
            <span class="epm-project-board-update-freshness is-missing">No Home update</span>
        </div>
        <span class="epm-project-board-update-copy">Status is on track.</span>
    </article>
</div>
```

This verifies that collapsed project rows still expose missing status information without weakening the existing long-update collapsed-row coverage.

- [x] **Step 3: Add style assertions**

Keep the existing collapsed-copy assertion for the long-update board and add metadata/link assertions so that coverage remains explicit:

```js
await expect(collapsedCopy).toContainText('profitable pairs');
await expect(collapsedUpdate.locator('.epm-project-board-update-date')).toHaveText('today');
await expect(collapsedUpdate.locator('.epm-project-board-update-author')).toHaveText('Katherine Johnson');
await expect(collapsedUpdate.locator('.epm-project-board-update-more')).toHaveAttribute('href', 'https://home.atlassian.com/o/example/s/example/project/CRITE-326/updates/update-3');
```

Then add these assertions after the existing update style checks:

```js
const staleUpdate = page.locator('.epm-project-board').nth(1).locator('.epm-project-board-update');
const staleFreshness = staleUpdate.locator('.epm-project-board-update-freshness');
await expect(staleFreshness).toHaveText('Stale update');
const staleDateColor = await staleUpdate.locator('.epm-project-board-update-date').evaluate((node) => (
    window.getComputedStyle(node).color
));
const staleAuthorColor = await staleUpdate.locator('.epm-project-board-update-author').evaluate((node) => (
    window.getComputedStyle(node).color
));
const staleCopyColor = await staleUpdate.locator('.epm-project-board-update-copy').evaluate((node) => (
    window.getComputedStyle(node).color
));
const staleBadgeStyle = await staleFreshness.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
    };
});
expect(staleDateColor).toBe('rgb(185, 28, 28)');
expect(staleAuthorColor).not.toBe('rgb(185, 28, 28)');
expect(staleCopyColor).not.toBe('rgb(185, 28, 28)');
expect(staleBadgeStyle.color).not.toBe('rgb(185, 28, 28)');
expect(staleBadgeStyle.backgroundColor).not.toBe('rgb(254, 242, 242)');
expect(staleBadgeStyle.borderColor).not.toBe('rgb(254, 202, 202)');

const missingUpdate = missingCollapsedBoard.locator('.epm-project-board-update.is-missing');
await expect(missingUpdate).toHaveAttribute('aria-label', 'Home update status');
const missingFreshness = missingUpdate.locator('.epm-project-board-update-freshness');
await expect(missingFreshness).toHaveText('No Home update');
const missingBadgeStyle = await missingFreshness.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
    };
});
const missingCopyColor = await missingUpdate.locator('.epm-project-board-update-copy').evaluate((node) => (
    window.getComputedStyle(node).color
));
expect(missingBadgeStyle.color).not.toBe('rgb(185, 28, 28)');
expect(missingBadgeStyle.backgroundColor).not.toBe('rgb(254, 242, 242)');
expect(missingBadgeStyle.borderColor).not.toBe('rgb(254, 202, 202)');
expect(missingCopyColor).not.toBe('rgb(185, 28, 28)');
```

- [x] **Step 4: Run the focused visual test**

Run:

```bash
npm run build
npx playwright test tests/ui/epm_portfolio_header_visual.spec.js
```

Expected: PASS after implementation and fresh screenshots under `/tmp/epm-portfolio-header-qa/`.

---

### Task 7: Focused Verification

**Files:**
- Test: `tests/test_epm_project_utils.js`
- Test: `tests/test_epm_view_source_guards.js`
- Test: `tests/ui/epm_portfolio_header_visual.spec.js`
- Test: `tests/ui/epm_multi_subgoal_visual.spec.js`
- Test: `tests/ui/epm_initial_config_load.spec.js`

- [x] **Step 1: Rebuild generated assets**

Run:

```bash
npm run build
```

Expected: build succeeds and regenerates `frontend/dist/dashboard.css`, `frontend/dist/dashboard.js`, and `frontend/dist/dashboard.js.map`.

- [x] **Step 2: Run focused Node tests**

Run:

```bash
node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js
```

Expected: PASS.

- [x] **Step 3: Run focused Playwright coverage**

Run:

```bash
npx playwright test tests/ui/epm_portfolio_header_visual.spec.js tests/ui/epm_multi_subgoal_visual.spec.js tests/ui/epm_initial_config_load.spec.js
```

Expected: PASS.

- [x] **Step 4: Inspect generated screenshots**

Open:

- `/tmp/epm-portfolio-header-qa/desktop.png`
- `/tmp/epm-portfolio-header-qa/medium.png`
- `/tmp/epm-portfolio-header-qa/narrow.png`

Expected:

- On-track projects still show their Home status pill.
- Stale update date text is red and has a visible `Stale update` badge.
- Missing Home status information has a visible `No Home update` badge.
- Long labels, owner names, update badges, and update links do not overlap at desktop, medium, or narrow widths.
- Collapsed project rows still show status freshness even when Jira rollup details are hidden.

- [x] **Step 5: Run the full suite before push**

Run:

```bash
env CONFIG_STORAGE_BACKEND=jsonfile JIRA_AUTH_MODE=basic DATABASE_URL= TEST_DATABASE_URL= .venv/bin/python -m unittest discover -s tests
```

Expected: PASS before any push or merge.

---

## Completion Criteria

- The plan no longer asks workers to redo already-landed header restructuring.
- `buildEpmProjectUpdateLine` exposes deterministic freshness metadata.
- More-than-14-day Home updates render with red date text plus a visible `Stale update` badge.
- Missing Home updates render with a visible `No Home update` badge.
- Existing update HTML, author/date metadata, update links, rollup collapse behavior, and EPM data fetching are unchanged.
- `npm run build`, focused Node tests, focused Playwright tests, and the full Python suite pass before push.
