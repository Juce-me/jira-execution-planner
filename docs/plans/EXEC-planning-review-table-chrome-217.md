# Planning review table chrome simplification (#217 follow-up) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: Active. Gate G0 passed on 2026-10-02: the user tested the mockup ("looks good like that") and chose the recommended option for every open item (D12). The awaited-chip baseline is committed (`8449072f`), so Task 0 is done and Slice A is next, then Slices B and C. Execution has started (see Execution status).
Type: feature (UI)
Branch: `feature/217-sprint-review-table` (continues `EXEC-planning-sprint-review-table-217.md`, whose shipped behaviour stays the source of truth for everything not changed here)
Written: 2026-10-02 from five read-only reviews (complexity, interaction, visual QA, accessibility, page layout) on a synthetic fixture in Chromium, plus the user's decisions below.

**Goal:** Return about 54 px of pinned height and remove the first-scroll toolbar relocation by deleting the table toolbar tier, moving column work into the header cell (hover chevron menu, corner "+", boundary "+"), and showing review actions only when there is something to save.

**Architecture:** Header affordances are added inside the single `header(floating)` JSX so the real `<thead>` and the docked clone share one source. The per-column menu and the Add popover reuse `ReviewColumnPopover` / `useIssueFieldPopover` and the `.pop-*` list grammar. Review actions become one small component, first rendered in the toolbar (Slice A) and then portaled into the shared filter bar's existing `viewControls` slot (Slice C). Pure logic (insert position, boundary detection, selected points) lives in `planningReviewTableModel.js` with node unit tests. No new backend route; one backend whitelist change for the Accepted column.

**Tech Stack:** React 19 + esbuild, node:test, Playwright (Chromium; headed Firefox/WebKit for geometry), Flask service whitelist in `backend/services/sprint_review.py`.

## Global Constraints

- Key and Summary stay pinned and non-hideable (AGENTS.md "share column order and optional visibility per workspace/Sprint/row kind … keep Key/Summary pinned").
- Order and visibility stay shared per workspace + Sprint + row kind, remain drafts until Save review, and a layout save is accepted only when its response confirms the exact order and visibility.
- Popups stay anchored, viewport-bounded and never shift the table or page; the docked header and totals keep the measured geometry; rows keep scrolling with the document.
- Numeric headings, values, editors and totals align right; text aligns left.
- Every transparent or icon `<button>` class overrides the global `button:hover` dark surface (`background`, `transform`, `box-shadow`) and `letter-spacing`, with a settled-state hover-contrast assertion in Playwright.
- Reuse shared controls: `SegmentedControl` through its `eng-mode-control` hook, `IconButton` (`sm` = 24 px, `md` = 28 px), `StatusPill`, `.pop-*`, `.planning-review-column-action`. A shorter variant of a shared control is a documented modifier class defined beside that control (like `.sprint-dropdown-compact`), never a local height override (MRT021).
- One filter control across the tool: do not add a new filter-like control; the Filters button and chips are unchanged.
- z-index tokens are unchanged (`--sticky-planning-z`, `--sticky-epic-z`, `--modal-popup-z`; MRT009).
- Keyboard-only access is out of scope (backlog). Touch must work: every action is reachable by tap and none requires dragging.
- `frontend/dist` is never hand-edited: run `npm run build` and commit the regenerated output whenever `frontend/src` changes.
- No Jira, Home or token code is touched; the review routes keep their OAuth/CSRF contract.

## Execution status

Updated 2026-10-02. The user authorized local commits (no push) for this plan; each task is its own atomic commit on `feature/217-sprint-review-table` (see `git log --oneline`). The baseline is `8449072f` (the awaited-chip change, verified with 1,565 unit tests and 61 Chromium cases on exactly that state); the plan itself is `8aab64bc`.

- Done: Task B1 (`insertColumnId`, `nearestBoundary` in `planningReviewTableModel.js` with node unit tests) and the logic half of Task C2 (`selectedStoryPoints` with its unit test, and the backend layout whitelist for `accepted` with `test_layout_accepts_the_accepted_column_in_order_and_hidden`). Checks run: `node --test tests/test_planning_review_table_model.js` 14/14; `npm run test:frontend:unit` 1,568 pass; `tests.test_sprint_review` 17 pass; `tests.test_codebase_structure_budgets` pass. The `accepted` column definition and the rows-memo wiring stay in Task C2 because they change the visible table and must land together with its UI test.
- Done: Task 0 (the orphan-Story "No Epic" second line is removed; both Planning specs pass, 62 cases; unit suite 1,568 pass).
- Done: Task A1 (the heading click cycles ascending, descending, off; the index shows only with several criteria).
- Done: Task A2 (Discard and Save only while the review has changes; no "Unsaved" text, no footer "Draft"; inline Discard confirmation).
- Done: Task A3 (the ⋯ menu is gone; the app-header Refresh reloads the review; `review_options_opened` and `refresh_review` retired from the allowlist, docs and tests).
- Done: Task A4 (Key and Epic links use `.task-key-link`, so they no longer show the browser's default blue and purple). Slice A is complete.
- Next: Slice B as B2a, B2b, B3 and B4 (see "Slice B execution notes" after Task B4), then C1, C3, C4; headed Firefox and WebKit runs and the full `tests/ui` run wait for Task Z1.
- Rules already updated: AGENTS.md section 10 (Filters/capacity stack line) and section 11 (the two toolbar lines, plus the keyboard-backlog and live-data lines), `docs/TODO.md` (keyboard backlog), `docs/plans/README.md` (index).
- The `GATE-05` Home-write edit in the working tree is unrelated and stays out of these commits.

## Decisions (user, 2026-10-02)

| # | Decision |
|---|---|
| D1 | Keyboard-only access: won't do, parked in `docs/TODO.md` (Deferred). Touch support: yes. |
| D2 | Delete the table toolbar tier. Epics|Stories and the review actions move to the shared filter bar. A comparison mockup must be tested first (gate G0). |
| D3 | One menu per column, opened from the header cell: approved. The column grip shows on hover. Final lane (D12): grip and chevron together in a 34 px lane (24 px chevron + 10 px grip), 48 px under touch. |
| D4 | "+" on hover at column boundaries: approved as an accelerator; a persistent corner "+" is the always-available path; touch supported, keyboard minor. |
| D5 | Review-state cluster (Discard and Save, only when dirty): approved. |
| D6 | Sort and Initiative grouping in the Filters row are obsolete in Planning Table view: not rendered there. List, Catch Up and Board are unchanged. |
| D7 | "Planned Teams Effort" panel: it is table-on-demand, so it may be hidden in Table mode; where and how is undecided (mock offers three placements). |
| D8 | New "Accepted" column: counts only selected Story Points and shows their sum in the totals. Confirmed 2026-10-02: it stands in for the Planned Teams Effort panel's accepted numbers inside the table, is named "Accepted" and is visible by default. |
| D9 | Visual coherence (links, ink, tokens): approved. |
| D10 | Filter-bar principle: a single filter control across the tool; avoid a second, similar control with different behaviour. A redesign of the Planning filter menu is a separate later topic. |
| D11 | Live-data policy: read-only, never saved; only obfuscated learnings; no saved or published screenshots; any screenshot of live data is deleted. |
| D12 | Mock accepted 2026-10-02 ("looks good like that"); every item the user had not decided goes to the recommended option: hover style H2 (grip and chevron together in the right lane; the user's screenshot showed H1 selected, and switching back is a CSS-only change), accept the small horizontal scroll that the lanes and the visible-by-default Accepted column add at 1440 px, Planned Teams Effort placement P-B (collapsed strip), and neutral ink at weight 400 (amber on hover and focus). |

## Live check (2026-10-02, rounded aggregates only)

A read-only probe of the running app in a signed-in session at 1440×900 confirmed the fixture numbers. Nothing from it was saved: no keys, summaries, names or screenshots, only counts and sizes.

- Pinned heights equal the fixture's: compact header 52.6, Filters 42, overview 46.9, toolbar 46 (+8 gap), docked header 32, docked footer 32, so 227.5 px with the header docked and 259.5 px with the totals too; the body band at deep scroll is about 640 px (about 17 rows).
- A 100 px first scroll lands at scrollY 271; the toolbar moves from x=32 to x=216.5 (184 px to the right) and out from below the Planned Teams Effort panel into the pinned stack.
- Sort epics and Group by Initiative are rendered `aria-disabled="true"` with opacity 1 and a pointer cursor, so they look live while doing nothing.
- The Planned Teams Effort panel is about 440 px tall (about 8 Teams plus Total, calibrated from the height; 212 px in the fixture). At page top the first table row sits at y of about 780 of 900, so only about 2 rows show.
- Epics mode: about 90 rows (about 30% with the awaited chip, about 12% with 0 SP); the table is about 1295 px wide and fits the 1359 px scroller, so the 24 px lanes (+60 px) still fit by about 3 px. Stories mode: about 195 rows including about 40 awaiting-creation placeholders; the table is about 1506 px wide and already scrolls horizontally by about 150 px. Both modes have 8 header cells (6 movable) and no custom columns; Priority and Sprint SP have 0 px label slack inside the current 14 px lane.
- Summary length in characters: Epics median 40, p90 70, max 90; Stories median 50, p90 85, max 120, so most titles ellipsize at 286 px.
- The Filters row is 992 px wide: Filters 90, readout 160, chips 224, view controls 145 (Sort 106 + Group 30). About 320 px is free today and about 455 px once Sort and Group leave, enough for the compact Epics|Stories control and the dirty-only cluster.

Consequences: the panel is the largest first-screen consumer on real data (so P-B is the default for Task C3); the lane growth is acceptable (24 px chevron; 34 px lane with the H2 grip); Task C1's acceptance numbers stand.

## Baseline from the parallel session (not part of this plan's diff)

A parallel session changed the Epic row that is still waiting for Stories (uncommitted when this plan was written):
- `summaryCell` in `frontend/src/eng/PlanningReviewTable.jsx` renders the title plus an inline `StatusPill` ("N Story awaited", classes from `getIssueStatusClassName('Pending', 'planning-review-awaiting')`) inside `.planning-review-summary-line`; the second "N uncreated Story" line is gone. The row keeps its normal height, the title keeps its ellipsis and hover readout, and the 0-SP red tint applies. Option B (naming the Team in Teams in scope) was rejected as it makes the row taller. Reported checks: 1,565 unit tests, 61 Chromium cases across both Planning specs, 35 headed Firefox and 35 headed WebKit cases; not yet seen in the signed-in app; the full `tests/ui` suite was not run.
- Open question that session asked the user: Stories without an Epic still show a "No Epic" second line under the title, which makes those rows taller. The Epic column already says "No Epic" for them (`planningReviewTableModel.js` sets `epic: 'No Epic'` for orphan Stories, and the Epic column is required in Stories mode). Recommendation: remove the line. Answered 2026-10-02: the user agreed, so the line is removed; Task 0 applies it once the awaited-chip change is committed (it edits the same Summary cell).
- Interplay with this plan: none in the header or chrome; Summary is a pinned column and the chip changes only its inner flex line. Row-height arithmetic below assumes every row is one line (about 37 px). Tests added here must not assert the old second line.

## Gate G0: the user tests the mockup

Artifact: `tmp/planning-chrome-mock/index.html` (gitignored; synthetic data, verbatim repository CSS, flips between Current and Proposed, with a live pinned-height readout).

- [x] The user tested the mock (2026-10-02: "looks good like that") and chose the recommended option for every open item (D12).
- [x] Decided (recommended option, D12) from the mock's measured numbers (1440×900, synthetic data tuned to the live aggregates; scroller 1374 px):
  - Pinned stack: Current 227.5 + 32 totals = 259.5 px (28.8%), Proposed 173.5 + 32 = 205.5 px (22.8%); 18 rows fully visible while stuck against 17.
  - First row at page top: Current y 780 (2 rows); Proposed with P-A y 734 (3 rows), with P-B y 315 (15 rows), with P-C y 279 (16 rows).
  - Hover style: H1 puts a 7 px grip on the cell edge that collides with the 16×24 boundary "+" hit area (about 2 px usable); H2 (grip and chevron together in the right lane) has no collision but costs +20 px per movable column. The builder recommends H2.
  - Epics table width: Current 1295.5 px; Proposed H1 1442.6 px (lanes +60, Accepted +87) so it scrolls by 68.6 px at 1440; H2 1512.6 px. Options: accept the scroll, narrow the Accepted column, or shrink the lane.
  - Planned Teams Effort: P-B (collapsed strip) is the default; P-C as built makes Show panel pin a 758 px stack (97% of 900 px), so do not ship it unchanged.
  - Neutral ink keeps the shared weight 600 and reads heavy in black; consider 400 at rest.
  - The Current replica has no scroll snap (a 100 px tick lands at 100 here, 271 in the app); the relocation itself is reproduced.
  - Resolved: H2; accept the scroll (H2 Epics table about 1513 px at 1440 px); P-B, with P-C dropped; ink weight 400.
- [x] **Appendix A** below records the accepted CSS and DOM contract; Slices B and C take their markup and CSS from it, and the steps give the logic, class reuse and tests. When this work is committed, keep the accepted mock in the repo as `assets/mockups/planning-review-chrome-217.html` (synthetic data only), as was done for `planning-sprint-review-217.html`.

## Forbidden regressions

- Shared layout save/conflict protocol, `changeSchema` actions (`add`, `layout`, `rename`, `aggregation`, `archive`), the 30-active-column limit, dirty/draft behaviour, recovery banners, the Sprint-change dialog.
- Docked header and totals geometry, horizontal scroll sync, frozen Key/Summary offsets, popups not shifting content.
- Selection, Undo, Story Points inline editing, Summary and Team editing, status pills, the zero-SP tint, the awaited chip.
- List, Catch Up and Board filter bars (Sort, Group by Initiative, view controls) keep working exactly as before.
- No keyboard regression beyond what already exists (the existing arrow-key reorder on a focused grip may stay; it is not extended).

## Files allowed to touch

`frontend/src/eng/PlanningReviewTable.jsx`, new `PlanningReviewColumnMenu.jsx`, `PlanningReviewStateCluster.jsx`, `PlanningReviewBoundaryPlus.jsx`; delete `PlanningReviewColumnsMenu.jsx` (Task B3); `planningReviewTableModel.js`; `PlanningTableStickyStack.jsx`; `EngFilterControls.jsx`; `frontend/src/dashboard.jsx` (refresh wiring, toolbar host, Planned Teams Effort); `frontend/src/analytics/dashboardAnalytics.js`; `frontend/src/styles/eng/planning-review-table.css`; `frontend/src/styles/shared/controls.css` (compact SegmentedControl modifier only); `backend/services/sprint_review.py` (whitelist only); `tests/test_planning_review_table_model.js`, `tests/test_analytics_events.js`, `tests/test_sprint_review.py`, `tests/ui/planning_review_table.spec.js`, `tests/ui/planning_review_integration.spec.js`; `docs/features/planning-sprint-review.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, `docs/TODO.md`, `AGENTS.md` section 11 (Task Z2 only); regenerated `frontend/dist`.

## Acceptance criteria

1. Pinned stack in Table mode, sticky state, docked header, 1440×900 and 1280×720: at most 175 px (baseline 227.5 px: compact header 52.6 + Filters 42 + overview 46.9 + toolbar 54 + docked header 32).
2. No `.planning-review-toolbar*` or `.planning-review-toolbar-slot` node in the dashboard in Table mode. Epics|Stories sits in `.filterbar-wrap .fb-view-controls`; Sort and Group by Initiative are not rendered there in Table mode and are unchanged in List, Catch Up and Board.
3. The Epics|Stories node is the same DOM node before and after the first scroll and its left edge moves less than 1 px.
4. Pointer devices: no grip and no chevron at rest; hover or focus-within shows them; the header stays 32 px tall and the table width grows only by the lanes (14 → 24 px per movable column, +60 px for six; 34 px with H2) and the Accepted column (about +87 px), both reported.
5. Column jobs reachable only through the header cell and the corner "+": add (append), insert at a boundary, hide, show hidden, rename, total, archive, move left/right, drag.
6. Discard and Save appear only while the review is dirty or saving; there is no "Unsaved" text, no footer "Draft", no ⋯ menu; Discard confirms inline; the app-header Refresh reloads the shared review and keeps the draft.
7. Heading click cycles ascending, descending, off; the sort index shows only with two or more criteria.
8. Touch emulation at 390 px: chevron and corner "+" visible, boundary "+" absent, every action works by tap.
9. Accepted column: a row shows its Story Points only while selected; an Epic shows the sum of its selected Stories; the footer total is the sum over selected rows; ordering and hiding persist through the shared layout save.
10. Key and Epic links use `.task-key-link`; analytics changes exactly as listed below; docs and rules updated (Task Z2).

## Analytics impact

Trigger: user actions inside the Planning review table. Event: existing `planning_action` with `feature_name=planning_review`, `source_surface=planning` and a fixed `workflow_action` allowlist (`REVIEW_ACTIONS` in `frontend/src/analytics/dashboardAnalytics.js`). No new event name, no new parameter, no Team, column-label or value in any payload.
- Removed (control deleted): `review_options_opened`, `refresh_review` (remove from `REVIEW_ACTIONS`, from the `tests/test_analytics_events.js` loop, and from the `docs/README_ANALYTICS.md` sentence that describes the compact toolbar options).
- Re-purposed without a taxonomy change: opening the Add popover (corner or boundary) emits `add_column_opened`; opening a column menu emits `columns_opened`; hide/show emits the already-allowlisted `column_visibility_changed`; rename `column_renamed`; total toggle `column_aggregation_changed`. `column_visibility_changed`, `column_renamed` and `column_aggregation_changed` are allowlisted but never emitted today; `add_column_opened` and `columns_opened` already fire from the toolbar buttons and only change trigger. Document the new triggers in `docs/README_ANALYTICS.md`.
- Unchanged: `row_mode_changed`, `column_added`, `column_archived`, `columns_reordered`, `save_review`, `discard_review`, `load_current_review`, `reapply_review`, `sort_changed`.
- Passive changes (hover reveal, cluster visibility, panel placement) emit nothing.

---

## Slice A: review state and sort (no G0 dependency)

### Task 0: Confirm the baseline and settle the "No Epic" line

**Files:**
- Modify (only if the user answers "remove"): `frontend/src/eng/PlanningReviewTable.jsx` (Summary cell), `frontend/src/styles/eng/planning-review-table.css`, `tests/ui/planning_review_table.spec.js`, `docs/features/planning-sprint-review.md`

- [x] **Step 1: Check the baseline is committed on its own** (done 2026-10-02: `8449072f`). Run `git log --oneline -5` and `git status --short`. Expected: a commit for the awaited chip exists and `PlanningReviewTable.jsx`, its CSS and the two Planning specs are not modified. If they are still modified, stop and ask the operator; they belong to the parallel session.
- [x] **Step 2: The user's answer** to "remove the 'No Epic' second line under orphan Stories?" is yes (2026-10-02).
- [x] **Step 3: failing test** (done 2026-10-02; it failed with row heights `[40, 36.875]`, the height of the extra line).

```js
test('an orphan Story keeps the normal row height and names its Epic only in the Epic column', async ({page}) => {
    await install(page);await page.getByRole('radio',{name:'Stories',exact:true}).click();
    const rows=page.locator('tbody tr');
    const orphan=rows.filter({hasText:'DEMO-3'}),neighbour=rows.filter({hasText:'DEMO-1'});
    const heights=[(await orphan.boundingBox()).height,(await neighbour.boundingBox()).height];
    expect(Math.abs(heights[0]-heights[1]),JSON.stringify(heights)).toBeLessThan(1.5);
    await expect(orphan.locator('td.planning-review-summary')).not.toContainText('No Epic');
    await expect(orphan.locator('td.planning-review-epic')).toHaveText('No Epic');
});
```

Run: `npx playwright test tests/ui/planning_review_table.spec.js -g "orphan Story keeps" --browser=chromium` — failed before the change, passes after.
- [x] **Step 4: Implement** (done 2026-10-02). The `column.id === 'summary'` cell is now just `summaryCell(row)`; the `No Epic` fragment is gone. The `.planning-review-requirement` rule stays because `IssueSummaryEditor.jsx` still uses it for its loading and saving lines. Both Planning specs pass (62 cases); the EXEC-217 baseline note records the follow-up. Commit: `Keep orphan Story rows one line tall (#217)`.

### Task A1: Heading click cycles ascending, descending, off

**Files:** Modify `frontend/src/eng/PlanningReviewTable.jsx` (`changeSort`, heading JSX); Test `tests/ui/planning_review_table.spec.js`.

Status: done 2026-10-02 (failed first with "Cost 0 1↑" for a single sort; now passes; both Planning specs pass, 63 cases; no existing test depended on the old index text).

- [x] **Step 1: failing test.**

```js
test('heading click cycles ascending, descending, off and the index appears only with several criteria', async ({ page }) => {
    await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const cost0 = page.getByRole('button', { name: /^Cost 0/ }), cost1 = page.getByRole('button', { name: /^Cost 1/ });
    await cost0.click(); await expect(cost0).toHaveText('Cost 0 ↑');
    await cost0.click(); await expect(cost0).toHaveText('Cost 0 ↓');
    await cost0.click(); await expect(cost0).toHaveText('Cost 0');
    await cost0.click(); await cost1.click({ modifiers: ['Shift'] });
    await expect(cost0).toHaveText('Cost 0 1↑'); await expect(cost1).toHaveText('Cost 1 2↑');
});
```

Run it with `--browser=chromium`. Expected FAIL (third click currently shows "Cost 0 ↑" again).
- [x] **Step 2: implement.**

```js
const changeSort = (column, additive) => {
    const current = sort.find(item => item.columnId === column.id);
    const direction = !current ? 'asc' : current.direction === 'asc' ? 'desc' : null;   // asc, desc, off
    const kept = additive ? sort.filter(item => item.columnId !== column.id) : [];
    const next = direction ? [...kept, { columnId: column.id, direction }] : kept;
    if (next.length > 5) { setFormError('Use at most five sort criteria.'); return; }
    setSort(next); trackedAction('sort_changed', { sortKey: column.custom ? 'custom' : column.id });
};
```

and in the heading JSX replace the index/arrow span with:

```jsx
const position = sort.findIndex(item => item.columnId === column.id);
const heading = <button …>{column.label}{position >= 0 && <span> {sort.length > 1 ? position + 1 : ''}{sort[position].direction === 'desc' ? '↓' : '↑'}</span>}</button>;
```

(keep the existing `className`, `tabIndex`, `aria-hidden` and `onClick` props on the button).
- [x] **Step 3:** Run the test: PASS. Run the whole spec; fix tests that expected the old "always shows an index" text. Commit: `Let a third heading click clear the sort (#217)`.

### Task A2: Review-state cluster, shown only while dirty

**Files:** Create `frontend/src/eng/PlanningReviewStateCluster.jsx`; Modify `PlanningReviewTable.jsx` (toolbar Save button, `.planning-review-state` span, footer "Draft"), `frontend/src/styles/eng/planning-review-table.css`; Test `tests/ui/planning_review_table.spec.js`.

**Interfaces:** Produces `PlanningReviewStateCluster({ review, editable, onSave, onDiscard })`; returns `null` unless `review.dirty || review.saving`.

Status: done 2026-10-02. Differences from the snippets below (the shipped `PlanningReviewStateCluster.jsx` is authoritative): the cluster also shows a muted "Loading…" note while the review loads, because the removed status text carried that cue and nothing else shows it, so it returns that note instead of `null` in that case; the confirmation text uses the shared `.planning-review-state-note` class; the ⋯ popup lost its "Discard draft" item here since the cluster now owns Discard (the rest of ⋯ goes in Task A3). The Sprint-change dialog also has a "Discard" button, so the capability-loss integration test scopes its locator to that dialog. The new tests were written after the implementation, so their failure was shown by setting the source change aside: all four tests failed on the old source and pass now. Both Planning specs pass (65 cases). Visual check (synthetic fixture): `tmp/217-ui/review-cluster-1440.png` shows Discard and Save at the right end only while dirty, and no footer "Draft".

- [x] **Step 1: failing test** (the rewritten Save/Unsaved/Draft tests are fixed in Step 5).

```js
test('Discard and Save review appear only while the review has changes', async ({ page }) => {
    await install(page); await page.getByRole('radio', { name: 'Stories', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save review', exact: true });
    const discard = page.getByRole('button', { name: 'Discard', exact: true });
    await expect(save).toHaveCount(0); await expect(discard).toHaveCount(0);
    await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
    const toolbar = page.locator('.planning-review-toolbar');
    const clean = (await toolbar.boundingBox()).height;
    await page.getByRole('textbox', { name: 'Cost 0 for DEMO-1', exact: true }).fill('99');
    await expect(save).toBeVisible(); await expect(discard).toBeVisible();
    expect((await toolbar.boundingBox()).height).toBe(clean);
    await discard.click(); await page.getByRole('button', { name: 'Keep', exact: true }).click();
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(true);
    await discard.click(); await discard.click();
    expect(await page.evaluate(() => window.harness.state().dirty)).toBe(false);
    await expect(save).toHaveCount(0);
});
```

Expected FAIL (Save is always present). Also add: Save once → `window.harness.saveCount() === 1` and the cluster disappears.
- [x] **Step 2: component.**

```jsx
import * as React from 'react';

// Review-level actions exist only while there is something to save or discard.
export default function PlanningReviewStateCluster({ review, editable, onSave, onDiscard }) {
    const [confirming, setConfirming] = React.useState(false);
    React.useEffect(() => { if (!review.dirty) setConfirming(false); }, [review.dirty]);
    if (!review.dirty && !review.saving) return null;
    const blocked = !editable || review.loading || review.saving || review.unconfirmed || Boolean(review.conflict);
    return <span className="planning-review-state-cluster">
        <span className="planning-review-sr-only" role="status">{review.saving ? 'Saving…' : 'Unsaved changes'}</span>
        {confirming
            ? <>
                <span className="planning-review-state-confirm">Discard unsaved changes?</span>
                <button type="button" className="planning-action-button" disabled={review.saving} onClick={() => { setConfirming(false); onDiscard(); }}>Discard</button>
                <button type="button" className="planning-action-button" onClick={() => setConfirming(false)}>Keep</button>
            </>
            : <>
                <button type="button" className="planning-action-button" disabled={review.saving} onClick={() => setConfirming(true)}>Discard</button>
                <button type="button" className="planning-action-button" aria-label="Save review" disabled={blocked} onClick={onSave}>{review.saving ? 'Saving…' : 'Save'}</button>
            </>}
    </span>;
}
```

- [x] **Step 3: wire it** in `PlanningReviewTable.jsx`: replace the Save `<button>` and the `.planning-review-state` span with

```jsx
<PlanningReviewStateCluster review={review} editable={editable}
    onSave={async () => { const saved = await review.save(); trackedAction('save_review', { result: saved ? 'success' : 'failure' }); }}
    onDiscard={() => { review.discard(); trackedAction('discard_review'); }} />
```

and change the footer Key cell from `review.dirty ? 'Draft' : ''` to `''`.
- [x] **Step 4: CSS.** Add `.planning-review-state-cluster { display: inline-flex; align-items: center; gap: 0.5rem; margin-left: auto; }` and `.planning-review-state-confirm { font-size: 0.75rem; color: var(--text-secondary, #64748b); }`. Remove the `.planning-review-state` rules (keep `.planning-review-guidance`; the two share one rule, so split it).
- [x] **Step 5:** Rewrite the existing tests that used the permanent Save button, "Unsaved" and the footer "Draft": `grep -n "Save review\|Unsaved\|Draft" tests/ui/*.js`. Add a helper `const saveReview = page => page.getByRole('button', { name: 'Save review', exact: true }).click();` and use it. Run both Planning specs on Chromium: PASS. Commit: `Show Save and Discard only while the review has changes (#217)`.

### Task A3: Remove the ⋯ menu; the app-header Refresh reloads the review; analytics clean-up

**Files:** Modify `PlanningReviewTable.jsx` (`optionsOpen`, the options popover, `review_options_opened` and `refresh_review` emitters), `frontend/src/dashboard.jsx` (`refreshActiveViewFromJira`), `frontend/src/analytics/dashboardAnalytics.js` (`REVIEW_ACTIONS`), `frontend/src/styles/eng/planning-review-table.css` (`.planning-review-options*`), `tests/test_analytics_events.js`, `docs/README_ANALYTICS.md`, `tests/ui/planning_review_integration.spec.js`, `tests/ui/planning_review_table.spec.js`.

Status: done 2026-10-02. The failing integration test was written first and failed with the review read count staying at 1 after the header Refresh. Notes: the toolbar test now checks that the Columns popup does not shift the table (the options popup it used to check is gone) and asserts that no "Review options" button exists; the analytics unit test also asserts that the retired `review_options_opened` and `refresh_review` return no payload; the feature doc and the ontology entry were updated in the same commit (the plan's Task Z2 now only covers the final rewrite). Both Planning specs pass (66 cases), the unit suite passes (1,568). Headed Firefox and WebKit runs wait for Task Z1. Follow-up fix: the first version of the refresh wiring was flaky under load (3 of 8 runs) because a Refresh clicked while the review was still loading was queued by the controller without `force` and swallowed; the wiring now skips the review reload while the review is loading or saving (the old Refresh review button was disabled then too) and the test waits for the loading note to clear; 16 of 16 repeat runs with 4 workers pass.

- [x] **Step 1: failing integration test** (model it on "dirty noninitial Sprint review survives Jira catalog refresh…", which already uses `installPlanningFixture`, `openPlanning` and `json`).

```js
test('the app-header Refresh also reloads the shared review', async ({ page }) => {
    await installPlanningFixture(page);
    let reads = 0;
    await page.route('**/api/eng/sprints/*/review', route => { reads += 1; return json(route, { schemaVersion: 1, sprintId: String(futureSprintId), schemaRevision: 0, columns: [], capabilities: { canRead: true, canSave: true } }); });
    await page.route('**/api/eng/sprints/*/review/values/read', route => json(route, { cells: [], unavailableIssueIds: [] }));
    await openPlanning(page);
    await page.getByRole('button', { name: 'Show Planning table', exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThan(0);
    const before = reads;
    await page.getByRole('button', { name: 'Refresh tasks and sprints from Jira', exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThan(before);
});
```

Expected FAIL (`refreshActiveViewFromJira` never calls the review).
- [x] **Step 2: implement.** In `refreshActiveViewFromJira` (`dashboard.jsx`), inside `if (selectedView === 'eng' && showPlanning) { … }` add `if (planningLayout === 'table' && !planningReview.loading && !planningReview.saving) void planningReview.refresh();` after the existing `setCapacityRefreshNonce(...)` (the guard was added in a follow-up, see the Status note above). The feature doc already states that refresh preserves drafts.
- [x] **Step 3: remove the ⋯ menu.** Delete `optionsOpen`, its `ReviewColumnPopover`, the `review_options_opened` and `refresh_review` `trackedAction` calls, and the `.planning-review-options`, `.planning-review-options-trigger` CSS. "Discard" now lives in the cluster, "Clear sorting" is gone (Task A1), the help paragraph is dropped (its Shift-click hint moves into the column menu in Task B2).
- [x] **Step 4: analytics.** Remove `'review_options_opened'` and `'refresh_review'` from `REVIEW_ACTIONS`; in `tests/test_analytics_events.js` drop `review_options_opened` from the `for (const action of ['panel_expanded','panel_collapsed','review_options_opened'])` loop and add `assert.equal(buildPlanningReviewAnalyticsParams('review_options_opened'), null)`; edit the `docs/README_ANALYTICS.md` sentence that mentions it.
- [x] **Step 5:** Rewrite tests that opened ⋯ (`grep -n "Review options\|Refresh review\|Discard draft\|Clear sorting" tests/ui/*.js`). Run `npm run test:frontend:unit` and both Planning specs: PASS. Commit: `Retire the review options menu and refresh the review with the page (#217)`.

### Task A4: Key and Epic links use the shared ENG link class

**Files:** Modify `PlanningReviewTable.jsx` (the two `TrackedExternalLink` calls for Key and Epic); Test `tests/ui/planning_review_table.spec.js`.

Status: done 2026-10-02. The test failed first (the Key link had no class) and passes now; it checks the Key link in Epics mode and the Epic summary link in Stories mode (both carry `task-key-link`, their colour equals the cell's colour and they have no underline). Both Planning specs pass (67 cases).

- [x] **Step 1: failing test.**

```js
test('Key and Epic links use the ENG neutral link style, not the browser default', async ({ page }) => {
    await install(page);
    const link = page.getByRole('link', { name: 'DEMO-10', exact: true });
    await expect(link).toHaveClass(/task-key-link/);
    const colours = await link.evaluate(node => ({ link: getComputedStyle(node).color, cell: getComputedStyle(node.closest('td')).color, line: getComputedStyle(node).textDecorationLine }));
    expect(colours.link).toBe(colours.cell); expect(colours.line).toBe('none');
});
```

Expected FAIL (default blue, underlined).
- [x] **Step 2: implement.** Add `className="task-key-link"` to the Key link and to the Epic link (`.task-key-link` is `color: inherit; text-decoration: none; border-bottom: 1px solid transparent` with a hover border in `eng/issues.css`). Run the test: PASS. Commit: `Use the ENG link style for review table keys (#217)`.

---

## Slice B: header menus and column creation (after G0)

Read "Slice B execution notes" after Task B4 before starting: it corrects and extends the task text below.

### Task B1: Pure helpers for insert position and boundary detection

**Files:** Modify `frontend/src/eng/planningReviewTableModel.js`; Test `tests/test_planning_review_table_model.js`.

**Produces:** `insertColumnId(order, id, afterId = null)` and `nearestBoundary(edges, x, threshold = 5)`.

- [x] **Step 1: failing tests** (append to `tests/test_planning_review_table_model.js`, which imports the ESM model through `const model = () => import(...)`).

```js
test('insertColumnId places a column after a neighbour, right after the pinned columns, or at the end', async () => {
    const { insertColumnId } = await model();
    const order = ['status', 'priority', 'storyPoints'];
    assert.deepEqual(insertColumnId(order, 'new', 'priority'), ['status', 'priority', 'new', 'storyPoints']);
    assert.deepEqual(insertColumnId(order, 'new', 'summary'), ['new', 'status', 'priority', 'storyPoints']);
    assert.deepEqual(insertColumnId(order, 'new'), ['status', 'priority', 'storyPoints', 'new']);
    assert.deepEqual(insertColumnId(order, 'new', 'missing'), ['status', 'priority', 'storyPoints', 'new']);
    assert.deepEqual(insertColumnId(['a', 'new', 'b'], 'new', 'b'), ['a', 'b', 'new']);
});

test('nearestBoundary returns the column left of the closest edge within the threshold', async () => {
    const { nearestBoundary } = await model();
    const edges = [{ afterId: 'summary', x: 100 }, { afterId: 'status', x: 180 }, { afterId: 'priority', x: 260 }];
    assert.equal(nearestBoundary(edges, 183), 'status');
    assert.equal(nearestBoundary(edges, 98), 'summary');
    assert.equal(nearestBoundary(edges, 190), null);
    assert.equal(nearestBoundary([], 50), null);
});
```

Run `node --test tests/test_planning_review_table_model.js` — expected FAIL (not exported).
- [x] **Step 2: implement.**

```js
// New or moved column ids go after `afterId`; 'summary' means directly after the pinned columns; anything else appends.
export function insertColumnId(order, id, afterId = null) {
    const next = order.filter(item => item !== id);
    let index = next.length;
    if (afterId === 'summary') index = 0;
    else if (afterId && next.includes(afterId)) index = next.indexOf(afterId) + 1;
    next.splice(index, 0, id);
    return next;
}

// `edges` are { afterId, x } header boundaries; returns the afterId of the closest edge within `threshold` px.
export function nearestBoundary(edges, x, threshold = 5) {
    let best = null, closest = Infinity;
    for (const edge of edges) {
        const distance = Math.abs(edge.x - x);
        if (distance <= threshold && distance < closest) { best = edge.afterId; closest = distance; }
    }
    return best;
}
```

- [ ] **Step 3:** Run the unit file: PASS (done 2026-10-02: 14/14; full frontend unit suite 1,568 pass). Commit once authorized: `Add insert-position and boundary helpers for review columns (#217)`.

### Task B2: Header lane (chevron, grip on hover) and the per-column menu

**Files:** Create `frontend/src/eng/PlanningReviewColumnMenu.jsx`; Modify `PlanningReviewTable.jsx` (`header(floating)`, an `openMenu` state replacing `addOpen`/`columnsOpen`/`optionsOpen` incrementally), `planning-review-table.css`, `tests/ui/planning_review_table.spec.js`.

**Interfaces:** Consumes `reorder(column, direction)`, `setColumnVisible(columnId, visible)`, `review.changeSchema({action: 'rename' | 'aggregation' | 'archive', …})`, `ReviewColumnPopover`. Produces `PlanningReviewColumnMenu({ column, editable, review, canMoveLeft, canMoveRight, onMove, onHide, onError, onClose })`.

Menu content by column kind (text labels only; the `.pop-subject` line is the column label, plus " · Shared" for custom columns):
- required Jira columns (`column.required`: Status, Priority, SP, Teams in scope or Team, Epic): Move left, Move right
- optional Jira columns (`column.optional`: Assignee, Component, Project, Capacity, Project Track, Epic Team, and Accepted once Task C2 adds it): Move left, Move right, Hide column
- custom columns: Rename, Show total (numbers only, `aria-pressed`), divider, Move left, Move right, divider, Hide column, Archive column… (inline confirm, copy from `PlanningReviewColumnsMenu`)
- Key and Summary: no lane, no menu.
- A muted last line in every menu: "Shift-click a heading to sort by several columns."

- [ ] **Step 1: failing tests** (name each; all on Chromium).
  1. `lane controls are hidden at rest and revealed by hover`: at rest `.planning-review-colmenu` and the grip have computed `opacity` `0`; after `hover()` on the Priority header they are `1`; header height stays 32 px and the table width is unchanged by hover.
  2. `menu items follow the column kind`: Priority → ['Move left','Move right']; Component (after showing it) adds 'Hide column'; `Cost 0` (custom number) → Rename, Show total, Move left, Move right, Hide column, Archive column….
  3. `Move left and Move right reorder like dragging`: headings order changes; `window.harness.state().dirty` true.
  4. `Hide column hides it and marks the draft`; `Rename` saves on Enter and cancels on Escape; `Archive column…` asks first and Cancel keeps it; `Show total` toggles the footer total.
  5. `lane icon buttons keep a readable hover` — settled state, animations off, computed background luminance not dark (this spec has no such helper: copy `contrastRatio` and the settled `expect.poll` from the test "transparent controls stay readable on hover instead of turning dark" in `tests/ui/eng_group_board_card.spec.js`).
  6. `touch shows the lane without hover`: `test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })` in a `describe`; chevron `opacity` is `1` at rest; tapping it opens the menu; Move right works by tap.
- [ ] **Step 2: implement the header.** In `header(floating)`, for every column except Key and Summary render, inside `.planning-review-head`: the heading button (unchanged), the grip (existing `.planning-review-drag` button, now hover-revealed), and the chevron `IconButton size="sm"` with classes `icon-button--sm planning-review-column-action planning-review-colmenu`, `aria-label={`${column.label} column options`}`, `aria-haspopup="dialog"` (the popover is the existing `role="dialog"` one; menu semantics are in the keyboard backlog), `aria-expanded={open}`. Mount the popover only from the interactive copy: `const interactive = floating || !dock?.header;` and `open={openMenu === column.id && interactive}`. Add `React.useEffect(() => setOpenMenu(null), [dock?.header]);` so a dock flip closes an open menu.
- [ ] **Step 3: CSS.** Copy Appendix A.3 (the accepted H2 lane, corner and reveal rules) and A.5 (touch) into `planning-review-table.css`. Keep the faint header divider (its colour maps to `--border`, Appendix A.7); remove the arrow-key hint from the options help (already gone with Task A3); keep the grip's drag handlers and its arrow-key reorder as they are.
- [ ] **Step 4:** Move `RenameField` and the archive-confirm block from `PlanningReviewColumnsMenu.jsx` into the new menu file (the old file is deleted in Task B3). Run the new tests and both Planning specs: PASS. Commit: `Open column actions from the header cell (#217)`.

### Task B3: Corner "+" with the Add popover and "Show hidden"; delete `+ Column` and `Columns`

**Files:** Modify `PlanningReviewTable.jsx` (select-header cell, `addColumn`, popover content), `planning-review-table.css`; Delete `frontend/src/eng/PlanningReviewColumnsMenu.jsx`; Test both Planning specs.

- [ ] **Step 1: failing tests.** (a) A button named `+ Add column` (same accessible name as the old toolbar button, so existing locators keep working) sits in the select header cell, is inside the viewport at `scrollLeft` 0 and at maximum, and the header stays 32 px. (b) Its popover has the name field, the shared Number|Text control, `Add column`, the note "Shared with everyone reviewing this Sprint.", and a "Show hidden" list of hidden columns; clicking `Capacity` there shows the column. (c) The toolbar has no `+ Column` or `Columns` button and `dialog` "Review column management" never appears. (d) Adding at the corner appends; the result is covered again by Task B4 for a boundary insert.
- [ ] **Step 2: implement.** `addColumn(event, afterId = null)` uses the model helper:

```js
review.changeSchema({ action: 'layout', rowKind: mode, order: insertColumnId(movableIds(), id, afterId), hidden: nextHidden });
```

("Show hidden" rows call `setColumnVisible(column.id, true)`; from a boundary they also move the column with `insertColumnId`.) Render the corner button with `IconButton size="sm"` plus `planning-review-column-action`, absolutely positioned so the header row stays 32 px. Replace `addOpen`/`columnsOpen` with the single `openMenu` state (`'add'` or a column id). Delete the toolbar `+ Column` and `Columns` buttons and `PlanningReviewColumnsMenu.jsx`; `grep -rn "PlanningReviewColumnsMenu" frontend tests docs` must come back empty.
- [ ] **Step 3:** Replace the `openColumns` helper in the spec with `showHiddenColumn(page, 'Capacity')`, and fix the 24 spec references found by `grep -n "openColumns\|Review column management\|Columns" tests/ui/planning_review_table.spec.js`. Run both specs: PASS. Commit: `Add and restore columns from the table corner (#217)`.

### Task B4: Boundary "+" overlay

**Files:** Create `frontend/src/eng/PlanningReviewBoundaryPlus.jsx`; Modify `PlanningReviewTable.jsx`, `planning-review-table.css`; Test `tests/ui/planning_review_table.spec.js`.

**Interfaces:** Consumes `nearestBoundary`, `insertColumnId`. Produces `PlanningReviewBoundaryPlus({ headRowRef, columns, editable, dragging, onOpen })` — one fixed, body-level overlay (so the docked header's `overflow: hidden` cannot clip it) positioned from the live header's cell rects (`getBoundingClientRect` of each `th`); mouse pointers only; absent under `(hover: none)` and while `dragging`. CSS and DOM are in Appendix A.4 and A.8.

- [ ] **Step 1: failing tests.** Within 5 px of a valid boundary (after Summary and after every movable column) a 16×24 hit area appears and `document.elementFromPoint` at its centre returns it on both sides of the boundary; at 10 px it is absent; the hovered cell's chevron hides meanwhile; clicking opens the Add popover; adding inserts the new column directly after the left neighbour; the overlay works while the header is docked (scroll a 60-row review until `dock.header`); it is hidden while a grip is being dragged and under touch emulation.
- [ ] **Step 2: implement** with a 2 px line in the `.planning-review-drop` blue (`#3b82f6`), 32 px tall (header height), a 16 px dot with "+" (`aria-hidden`, `tabIndex={-1}`), `z-index: calc(var(--sticky-epic-z, 50) + 5)` (derived from the existing token, no new tier). Drop any full-height line.
- [ ] **Step 3:** Run both specs and headed Firefox/WebKit for the pointer geometry. Commit: `Insert columns from a boundary "+" in the header (#217)`.

### Slice B execution notes (2026-10-02, written before B2 starts)

Written after re-reading the code these tasks touch. Where it differs from the task text above, these notes win; record any further divergence in Execution status.

**Commits.** Four, each green on its own and each with a fresh `npm run build` and the regenerated `frontend/dist`: B2a (header lane, chevron, menu with Move left, Move right and Hide column), B2b (Rename, Show total and Archive… move into the menu from `PlanningReviewColumnsMenu.jsx`; the old Columns popup keeps working until B3), B3, B4. Subjects: `Open column move and hide from a header chevron menu (#217)`, `Move rename, total and archive into the column menu (#217)`, then the two given in Tasks B3 and B4. Stop after the B3 commit so the operator can try it in the app; B4 starts on their go.

**Facts that correct or extend the tasks.**
1. Two header copies. `header(floating)` renders the real `<thead>` and the docked clone. Each new interactive node (chevron, corner "+") copies the grip's treatment on the real copy while docked (`tabIndex={-1}`, `aria-hidden`), and a popover mounts only from the interactive copy (`floating || !dock?.header`); an open menu closes when `dock?.header` flips.
2. Popover wrapper. `ReviewColumnPopover` wraps its trigger in `span.planning-review-popover-anchor` (`display: inline-flex`, not positioned), so A.3's child selector `.planning-review-head > .planning-review-colmenu` never matches: use the descendant form. The chevron still resolves its absolute position against `.planning-review-head` (`position: relative`), and the popover is placed from the trigger's own rect. But `useIssueFieldPopover` dismisses the popover once the trigger is scrolled fully outside any ancestor that clips overflow (the horizontal scroller, the docked bar), so test the last column's chevron at maximum `scrollLeft` and from the docked clone. The header stays 32 px.
3. Menu items follow the column flags from `buildPlanningReviewColumns` (`required`, `optional`, `custom`), not ids. Accepted (Task C2) is `optional`, so it gets Hide column from the same rule; Task B2 listed it as required by mistake.
4. Analytics. The table spec's harness passes no `onReviewAction`: add one that records into `window.harness` and assert the emitted name for each action (`columns_opened`, `add_column_opened`, `column_visibility_changed`, `column_renamed`, `column_aggregation_changed`, `column_archived`). The allowlist unit test needs no change.
5. Touch tests assert `matchMedia('(hover: none)').matches`, so they prove the media-query path and not only the viewport width.
6. Select header cell (B3). It now also holds the corner button: give that `th` `aria-label="Select"` and update the test "the select header shows no title…" (`toHaveText('Select')`, child count) so it still proves there is no visible title besides the "+" glyph. Every other header already carries `aria-label`.
7. Boundary overlay (B4). `draggedColumn` is a ref, so add a `dragging` state set in the grip's `onDragStart` and cleared in `onDragEnd` and `onDrop`. A.3 marks the left cell `planning-review-boundary-hot` while the overlay shows, so the table keeps a `hotBoundary` state and the overlay gets an `onHover(afterId | null)` callback next to `onOpen`. Behaviour reference: the "boundary + overlay" section of `tmp/planning-chrome-mock/src/mock.js` (gitignored, local): 5 px to engage and 9 px to stay engaged; hidden on scroll, popover, drag and touch.
8. Archived columns. The old Columns popup listed archived columns muted (`Cost 7 · archived`). The accepted mock's popover has no such list, so B3 drops it; say so in the feature doc and in the B3 report.

**Docs move with behaviour, not at Z2.** Each commit updates the paragraphs of `docs/features/planning-sprint-review.md` that it makes untrue (Z2 only consolidates). B2a and B2b update the trigger descriptions in `docs/README_ANALYTICS.md`. B3 and B4 update the Planning Sprint review entry in `docs/ontology.md` (`PlanningReviewColumnsMenu.jsx` is replaced by `PlanningReviewColumnMenu.jsx`, plus `PlanningReviewBoundaryPlus.jsx`) and its verification date, after checking that every path and symbol in the entry resolves.

**Specs to migrate.** About 20 tests use the Columns popup, the toolbar `+ Column` or the grip; find them with `grep -nE "openColumns|Review column management|name: 'Columns'|Add column|Total for|Rename |Archive |archived" tests/ui/planning_review_table.spec.js tests/ui/planning_review_integration.spec.js`. In the table spec replace `openColumns` and `columnsDialog` with two helpers: `openColumnMenu(page, label)` (click `{label} column options`; used for hide, rename, total, archive and move) and `showHiddenColumn(page, label)` (click `+ Add column`, then the label under "Show hidden"). Four need more than a helper swap: "the select header shows no title…" (fact 6), "archiving a review column needs an inline confirmation" (drop the archived-list assertion, fact 8), "Columns popup is a compact single-line checklist…" (rewrite for the Show hidden list and the menu grammar), and the two layering loops in the integration spec ("first Table scroll activates the sticky Filters…", "document scroll docks table headings…"), whose popup hit-tests must open the corner popover and a column menu from the docked clone and keep the `elementFromPoint` check. The "390px creation fits…" test keeps its `+ Add column` locator.

**Checks.** First run the per-commit checks below on the untouched HEAD and compare with the recorded baseline (unit suite 1,568 pass; 67 Chromium cases across both Planning specs). Per commit: `npm run build` (after committing, `git status --short frontend/dist` must be empty); `npm run test:frontend:unit`; `.venv/bin/python -m unittest tests.test_codebase_structure_budgets tests.test_dashboard_css_extraction`; `npx playwright test tests/ui/planning_review_table.spec.js tests/ui/planning_review_integration.spec.js --browser=chromium --workers=4`. After B4: `.venv/bin/python -m unittest discover -s tests`; the same two specs headed in Firefox and WebKit (`--headed --browser=firefox`, then `--browser=webkit`); a Chromium touch pass at 390 px (`hasTouch`, `isMobile`); screenshots of the synthetic fixture in `tmp/217-ui/` compared with the mock's Proposed state; one fresh-eyes review of the slice's diff by a subagent, whose findings are checked against the code before acting. No live-app check in Slice B (Task Z1 owns it).

---

## Slice C: remove the toolbar tier and add the Accepted column (after B3)

### Task C1: Epics|Stories and the review cluster move into the filter bar; Sort and Initiative grouping leave Table view

**Files:** Modify `frontend/src/eng/EngFilterControls.jsx`, `frontend/src/eng/PlanningTableStickyStack.jsx`, `frontend/src/dashboard.jsx` (the `planningToolbarHost` state and the `toolbarHost={compactStickyVisible ? planningToolbarHost : null}` call), `PlanningReviewTable.jsx`, `frontend/src/styles/shared/controls.css`, `planning-review-table.css`; Test `tests/ui/planning_review_integration.spec.js`.

- [ ] **Step 1: failing tests** (integration, Table mode): (1) `.planning-review-toolbar` and `.planning-review-toolbar-slot` do not exist; (2) the `Planning review rows` radiogroup is inside `.filterbar-wrap .fb-view-controls` and has `eng-mode-control`; (3) no element named `Sort epics` and none named `Group by Initiative` exists in Table mode, while both still exist in Planning List and Catch Up; (4) the radiogroup is the same DOM node and keeps its left edge (±1 px) across the first scroll and after returning to the top (tag it with a `data-probe` attribute before scrolling); (5) pinned stack height at 1440×900 and 1280×720 is at most 175 px (use `snapshotStickyStack` from `tests/ui/eng_sticky_stack_helpers.js` and sum compact header, Filters, overview and docked header); (6) the dirty cluster sits at the right end of the Filters row and no popup is covered by it.
- [ ] **Step 2: implement.**
  - `PlanningTableStickyStack.jsx`: drop the `toolbarRef` prop and the `.planning-review-toolbar-slot` div.
  - `EngFilterControls.jsx`: when `planningTable`, `viewControls` is only `<span ref={planningToolbarRef} className="planning-review-controls-host" />`; the Sort dropdown and the Group by Initiative control are not rendered. In List, Catch Up and Board they render exactly as before. Delete the `planningTable` branches that become unreachable inside those two controls (`aria-disabled={Boolean(planningTable)}`, the `title`/tooltip alternatives, the `if (planningTable) return;` guards) — they are orphans of this change.
  - `dashboard.jsx`: pass `toolbarHost={planningToolbarHost}` always (no `compactStickyVisible ? … : null`). `compactStickyVisible` keeps its other jobs.
  - `PlanningReviewTable.jsx`: the toolbar becomes `<div className="planning-review-controls">` holding the `SegmentedControl` and `PlanningReviewStateCluster`; with a host it is portaled into the Filters row, without one (local harnesses) it renders inline above the table as a fallback.
  - `shared/controls.css`: add one documented modifier beside `.sprint-dropdown-compact` (30 px height, `font-size: 0.6rem`, `border-radius: 8px`, padding like `.fb-trigger`) and use it as `className="eng-mode-control segmented-control-compact"`; never override the segmented control's layout locally (MRT021).
  - `planning-review-table.css`: delete the `.planning-review-toolbar*` rules and the portal-specific margins. The cluster buttons take the filter-bar look recorded in Appendix A (Discard as `.fb-trigger`, Save as the single filled button).
- [ ] **Step 3:** Rewrite the integration tests that assert toolbar placement in normal and sticky mode and menu hit-testing under the toolbar (`grep -n "toolbar" tests/ui/planning_review_integration.spec.js`). Run both specs on Chromium and headed Firefox/WebKit for layering. Commit: `Move table controls into the filter bar and drop the toolbar tier (#217)`.

### Task C2: Accepted column (selected Story Points)

**Files:** Modify `frontend/src/eng/planningReviewTableModel.js` (new `selectedStoryPoints`, column definition), `PlanningReviewTable.jsx` (rows memo), `backend/services/sprint_review.py` (`REVIEW_LAYOUT_BUILTINS` for `epic` and `story`, and `hideable` in `apply_layouts`); Test `tests/test_planning_review_table_model.js`, `tests/test_sprint_review.py`, `tests/ui/planning_review_table.spec.js`, `docs/features/planning-sprint-review.md`.

**Produces:** `selectedStoryPoints(row, selectedKeys)` → formatted points string or `null`; built-in column `{ id: 'accepted', label: 'Accepted', type: 'number', aggregation: 'sum', optional: true }` placed after `storyPoints`.

- [x] **Step 1: failing unit tests** (done 2026-10-02, in `tests/test_planning_review_table_model.js`; failed with "selectedStoryPoints is not a function", passes now).

```js
test('selectedStoryPoints counts only ticked Stories', async () => {
    const { buildPlanningReviewRows, selectedStoryPoints } = await model();
    const tasks = [story('1', 'DEMO-1', 1.5), story('2', 'DEMO-2', 2), story('3', 'DEMO-3', 4)];
    const epic = { key: 'DEMO-10', epic: { id: '10', key: 'DEMO-10', summary: 'Epic' }, tasks: tasks.slice(0, 2), requirements: [] };
    const epicRows = buildPlanningReviewRows({ epicGroups: [epic], visibleTasks: tasks, mode: 'epic' });
    const storyRows = buildPlanningReviewRows({ epicGroups: [epic], visibleTasks: tasks, mode: 'story' });
    const none = new Set(), some = new Set(['DEMO-1', 'DEMO-2', 'DEMO-3']);
    assert.equal(selectedStoryPoints(epicRows.find(row => row.key === 'DEMO-10'), none), null);
    assert.equal(selectedStoryPoints(epicRows.find(row => row.key === 'DEMO-10'), some), '3.5');
    assert.equal(selectedStoryPoints(epicRows.find(row => row.id === 'no-epic'), some), '4');
    assert.equal(selectedStoryPoints(storyRows.find(row => row.key === 'DEMO-1'), new Set(['DEMO-1'])), '1.5');
    assert.equal(selectedStoryPoints(storyRows.find(row => row.key === 'DEMO-2'), new Set(['DEMO-1'])), null);
});
```

(`story(id, key, sp)` is the helper at the top of `tests/test_planning_review_table_model.js`.)
- [x] **Step 2: failing backend test** (done 2026-10-02; failed with `ReviewError: invalid_review_request` for both row kinds, passes after the whitelist change; mirrors `test_layout_accepts_the_default_hidden_columns_the_table_sends`).

```python
def test_layout_accepts_the_accepted_column_in_order_and_hidden(self):
    revision = self.add()['schemaRevision']
    for kind in ('story', 'epic'):
        with self.subTest(kind=kind):
            result = self.save(schemas=[{'action': 'layout', 'rowKind': kind, 'order': ['status', 'accepted', 'storyPoints'], 'hidden': ['accepted']}], base=revision)
            revision = result['schemaRevision']
            self.assertEqual(result['layouts'][kind]['hidden'], ['accepted'])
```

Run `python3 -m unittest tests.test_sprint_review -k accepted` — expected FAIL (`ReviewError`).
- [ ] **Step 3: implement.** (Done 2026-10-02: `selectedStoryPoints` and the backend whitelist. Remaining: the column definition and the rows-memo wiring, which land together with the UI test in Step 4.) Model:

```js
// Points of the rows the user has ticked: a Story counts itself; an Epic or the No Epic group counts its ticked children.
export function selectedStoryPoints(row, selectedKeys = new Set()) {
    if (row.rowKind === 'requirement') return null;
    const tasks = (row.rowKind === 'story' ? [row.issue] : row.children || []).filter(task => selectedKeys.has(task.key));
    if (!tasks.length) return null;
    return formatReviewScaled(tasks.reduce((sum, task) => sum + (parseReviewNumber(task.fields?.customfield_10004 ?? task.fields?.storyPoints).scaled ?? 0n), 0n));
}
```

add the column after `storyPoints` in `buildPlanningReviewColumns`; in the component's `rows` memo add `accepted: selectedStoryPoints(row, selectedStoryKeys)` and `selectedStoryKeys` to its dependency list (the existing `reviewValue` returns `row[column.id]` and `planningReviewTotals` already sums number columns with `aggregation: 'sum'`). Backend: add `'accepted'` to both sets of `REVIEW_LAYOUT_BUILTINS` and to `hideable`. It is visible by default (not in `DEFAULT_REVIEW_HIDDEN_COLUMNS`), as the user confirmed on 2026-10-02.
- [ ] **Step 4: failing UI test.** Stories mode: tick `Select DEMO-1` → its Accepted cell reads `1` and the footer Accepted total reads `1`; untick → blank. Epics mode: tick `Select DEMO-10` → the Epic's Accepted cell reads `3` (DEMO-1 + DEMO-2) and the footer reads `3`. Hiding the column from its menu and saving sends a layout the backend accepts.
- [ ] **Step 5:** Run unit, backend and UI tests: PASS. Commit: `Add an Accepted column that sums selected Story Points (#217)`.

### Task C3: Planned Teams Effort placement (the option chosen at G0)

**Files:** Modify `frontend/src/dashboard.jsx` (the `capacity-panel` block and the saved-preferences object next to `planningLayout`), `planning-review-table.css` or the capacity styles; Test `tests/ui/planning_review_integration.spec.js`.

- [ ] **Step 1: failing tests for the chosen option** (default P-B): in Table mode the panel is a 28 px strip and the first body row sits at least 180 px higher than with the panel expanded; expanding shows the grid without refetching; the choice persists through reload via `jira_dashboard_ui_prefs_v1`; Planning List shows the panel exactly as today. For P-C: the panel is absent and the overview's Show panel details contain the same per-Team numbers.
- [ ] **Step 2: implement** with the collapsed state stored in the same saved-preferences object as `planningLayout` (see its three sites in `dashboard.jsx`), the grid kept mounted but hidden while collapsed (like the overview's Collapse panel), and the `.planning-action-button` wording consistent with Show/Collapse panel. Commit: `Let the Planned Teams Effort panel collapse in Table view (#217)`.

### Task C4: Visual pass confirmed at G0

**Files:** Modify `planning-review-table.css`; Test `tests/ui/planning_review_table.spec.js`.

- [ ] **Step 1:** Apply only the overrides listed in Appendix A: editable Summary, Team and Assignee triggers use neutral ink at weight 400 at rest with the current amber on hover and focus (rule A.7; override `button.issue-summary-editor-trigger` and `button/input.issue-person-editor-trigger`, scoped under `.planning-review-table`); map slate hex literals to existing tokens where an exact equivalent exists; stop using the never-defined `--border-color` and `--surface`.
- [ ] **Step 2: tests.** Computed colour at rest versus hover for each trigger; hover-contrast assertion for every transparent button class touched; a screenshot with animations settled for the PR notes. Commit: `Align review table ink and tokens with the rest of ENG (#217)`.

### Task C5 (optional, decide after C1): the remaining first-scroll snap

- [ ] **Step 1:** After C1, measure the first wheel notch in the full-dashboard harness (scrollY before and after, header y before and after, layout shift). If the page still jumps more than the compact header's own height, bring the numbers to the user; removing the snap in `PlanningTableStickyStack.jsx` reverses a documented decision, so it needs a fresh yes. Do not change it without that answer.

---

## Slice Z: documentation, rules and verification

### Task Z1: Verify

- [ ] `npm run build` and commit the regenerated `frontend/dist`; `npm run test:frontend:unit`; `python3 -m unittest discover -s tests`; `npx playwright test tests/ui/planning_review_table.spec.js tests/ui/planning_review_integration.spec.js --browser=chromium --workers=4`; headed Firefox and WebKit for the pointer, hover and layering cases; Chromium touch emulation at 390 px for the lane, corner "+" and menus; then the full `npx playwright test tests/ui --browser=chromium --workers=4` before any push.
- [ ] Verify in the operator's open authenticated dashboard (the project rule for UI work), recording only obfuscated numbers; delete any screenshot of live data.
- [ ] Follow the section 10 publication transaction; push and PR only after explicit user confirmation.

### Task Z2: Docs and rules (on acceptance, not before)

- [ ] `docs/features/planning-sprint-review.md`: rewrite the toolbar, Columns and `+ Column` paragraphs and the sticky-toolbar paragraph to the shipped design; document the Accepted column, the dirty-only cluster and the header Refresh.
- [ ] `docs/README_ANALYTICS.md`: apply the Analytics impact section. `docs/plans/README.md`: index entry for this plan. `docs/plans/EXEC-planning-sprint-review-table-217.md`: one line in its Current Accuracy pointing here (the file is historical; do not rewrite earlier follow-ups).
- [ ] `AGENTS.md` section 11: replace the "visible `+ Column`" line and the toolbar-composition line, and drop the "only when sticky mode activates" clause from the Filters/capacity/toolbar placement line, with one tightened line describing the new design. Replace, do not append.

## Backlog and out of scope

- Keyboard-only access to the table (docked-header clone order, focus return, `scroll-padding`, `aria-sort`, `role="menu"`): parked in `docs/TODO.md` (Deferred).
- Redesign of the Planning filter menu as one shared filter control across the tool (D10).
- Forced-colors support for the drop cue; "Back to top" overlapping the docked totals by about 12 px (not assessed).

## Self-review

- Spec coverage: D1 → TODO.md entry and Global Constraints; D2 → Task C1; D3 → Task B2; D4 → Tasks B3, B4; D5 → Task A2; D6 → Task C1; D7 → Task C3; D8 → Task C2; D9 → Tasks A4, C4; D10 → Global Constraints and Task C1; D11 → Task Z1; the parallel session's chip and "No Epic" question → Baseline and Task 0.
- No new endpoint, route or credential path; the only backend change is the layout whitelist (Task C2, with a failing test first).
- State flows touched: dirty → save, discard, stale/conflict recovery are unchanged except where their buttons live; the Sprint-change dialog still offers Save, Discard and Stay.
- Names used across tasks: `insertColumnId`, `nearestBoundary`, `selectedStoryPoints`, `PlanningReviewStateCluster`, `PlanningReviewColumnMenu`, `PlanningReviewBoundaryPlus`, `openMenu`, `planningToolbarHost`/`planningToolbarRef` (renamed only if C1 finds it clearer).

## Appendix A: the accepted mock (2026-10-02)

Source: `tmp/planning-chrome-mock/` (gitignored: `src/mock.css`, `src/mock.js`; `node tmp/planning-chrome-mock/generate.js` regenerates it). The mock inlines `frontend/dist/dashboard.css` verbatim and captures its Current DOM from the real React components, so the class names below are the real ones. Choices from D12: H2 lane, P-B strip, ink weight 400. The mock scopes its rules under `body.mock-proposed`; drop that prefix when moving a rule. Put each block in the stylesheet named in its heading.

### A.1 `frontend/src/styles/shared/controls.css`, beside `.sprint-dropdown-compact`

```css
.segmented-control-compact { height: 30px; margin: 0; align-self: center; padding: 2px; border-radius: 8px; }
.segmented-control-compact .segmented-control-button { min-width: 0; padding: 0 0.55rem; font-size: 0.6rem; border-radius: 6px; }
```

### A.2 `frontend/src/styles/eng/filter-bar.css`

```css
.fb-trigger-primary { background: var(--text-primary); color: var(--bg-primary); border-color: var(--text-primary); }
.fb-trigger-primary:hover { background: #2f2f2f; color: var(--bg-primary); }
.fb-trigger-primary:disabled { opacity: 0.5; cursor: default; }
```

### A.3 `frontend/src/styles/eng/planning-review-table.css`: lane (H2), corner and reveal

```css
/* 34px lane = 24px chevron IconButton + 10px grip; both sit in the cell's right padding, outside the content box. */
.planning-review-table th.planning-review-movable, .planning-review-table td.planning-review-movable { padding-right: 34px; }
.planning-review-head > .planning-review-colmenu { position: absolute; top: calc(50% - 12px); left: calc(100% + 10px); opacity: 0; }
.planning-review-drag { left: 100%; width: 10px; margin: 0; opacity: 0; }
.planning-review-table th:hover .planning-review-colmenu, .planning-review-table th:hover .planning-review-drag,
.planning-review-table th:focus-within .planning-review-colmenu, .planning-review-table th:focus-within .planning-review-drag,
.planning-review-head > .planning-review-colmenu[aria-expanded="true"],
.planning-review-table th.planning-review-drop .planning-review-colmenu { opacity: 1; }
/* The boundary "+" owns the cell edge while it shows. */
.planning-review-table th.planning-review-boundary-hot .planning-review-colmenu,
.planning-review-docked-table th.planning-review-boundary-hot .planning-review-colmenu { opacity: 0; pointer-events: none; }
/* Corner "+" in the pinned select header cell; absolute so the header row stays 32px. */
.planning-review-corner { position: absolute; top: calc(50% - 12px); left: calc(50% - 12px); border-color: var(--border); border-radius: 50%; color: var(--text-primary); }
```

### A.4 Boundary "+" (same stylesheet; one fixed, body-level overlay)

```css
.planning-review-boundary { position: fixed; z-index: calc(var(--sticky-epic-z, 50) + 5); width: 0; height: 32px; pointer-events: none; }
.planning-review-boundary[hidden] { display: none; }
.planning-review-boundary-line { position: absolute; left: -1px; top: 0; width: 2px; height: 32px; background: #3b82f6; }
.planning-review-boundary-hit { position: absolute; left: -8px; top: 4px; width: 16px; height: 24px; padding: 0; margin: 0; border: 0; border-radius: 8px; background: transparent; pointer-events: auto; cursor: pointer; box-shadow: none; transform: none; }
.planning-review-boundary-hit:hover { background: transparent; transform: none; box-shadow: none; }
.planning-review-boundary-dot { display: grid; place-items: center; width: 16px; height: 16px; margin: 4px 0; border-radius: 50%; background: #3b82f6; color: #fff; font: 700 12px/1 'IBM Plex Mono', monospace; letter-spacing: 0; }
```

### A.5 Touch (same stylesheet)

```css
@media (hover: none) {
    .planning-review-head > .planning-review-colmenu, .planning-review-drag { opacity: 1; }
    .planning-review-table th.planning-review-movable, .planning-review-table td.planning-review-movable { padding-right: 48px; }
    .planning-review-drag { top: calc(50% - 12px); bottom: auto; left: 100%; width: 24px; height: 24px; margin: 0; }
    .planning-review-head > .planning-review-colmenu { left: calc(100% + 24px); }
    .planning-review-boundary { display: none; }
}
```

### A.6 Planned Teams Effort, P-B (collapsed by default in Table view; List unchanged)

```css
.capacity-panel.open.capacity-panel-collapsed { display: flex; align-items: center; height: 28px; max-height: 28px; margin: 0.5rem 0; padding: 0 0.75rem; overflow: hidden; box-shadow: none; cursor: pointer; }
.capacity-panel.open.capacity-panel-collapsed .capacity-header { flex: 1; margin: 0; align-items: center; }
.capacity-panel.open.capacity-panel-collapsed .capacity-grid-wrapper, .capacity-panel.open.capacity-panel-collapsed .capacity-subtitle { display: none; }
.capacity-panel-caret { display: inline-block; margin-left: 0.35rem; transition: transform 0.15s ease; }
.capacity-panel.open:not(.capacity-panel-collapsed) .capacity-panel-caret { transform: rotate(90deg); }
```

### A.7 Coherence (Task C4): edit the existing rules in `planning-review-table.css` in place

| Literal today | Replace with |
|---|---|
| `var(--border-color, #e2e8f0)` and `var(--surface, #fff)` (never defined) | `var(--border)` and `var(--bg-secondary)` |
| `#f8fafc` (th, tfoot, synthetic rows, docked bars, recovery banner) | `var(--bg-primary)` |
| `#cbd5e1` (footer top border, docked shadows, SP editor and capacity toggle borders) | `var(--border)` |
| `#e2e8f0` (sticky-column edges, header divider, heading hover fill) | `var(--border)` |
| `#64748b` (secondary text) | `var(--text-secondary)` |
| `#94a3b8` (grip, input hover border) and `#334155` (grip hover) | `var(--text-secondary)` and `var(--text-primary)` |
| popover `#e2e8f0` border, `#fff` fill, `#334155` text | `var(--border)`, `var(--bg-secondary)`, `var(--text-primary)` |

Kept as they are: the red zero-SP tint `#fff1f0`, the green Included chip, `#3b82f6`, focus rings. Neutral ink (new rule; inspect the Summary editor trigger's base colour in `eng/status-transitions.css` and give it the same treatment if it is amber):

```css
.planning-review-table input.issue-person-editor-trigger, .planning-review-table button.issue-person-editor-trigger { color: var(--text-primary); font-weight: 400; }
.planning-review-table input.issue-person-editor-trigger:hover, .planning-review-table button.issue-person-editor-trigger:hover,
.planning-review-table input.issue-person-editor-trigger:focus-visible, .planning-review-table button.issue-person-editor-trigger:focus-visible { color: #d48806; }
```

### A.8 DOM contract

- Select header cell: `<button type="button" class="icon-button--sm planning-review-column-action planning-review-corner" data-icon-size="sm" aria-label="+ Add column" aria-haspopup="dialog" aria-expanded="false">+</button>` (the mock labels it "Add column"; keep "+ Add column" so existing locators and the submit button's exact name "Add column" stay distinct).
- Each movable header, inside `.planning-review-head`: the heading button, the grip `.planning-review-drag`, then `<button type="button" class="icon-button--sm planning-review-column-action planning-review-colmenu" data-icon-size="sm" aria-label="{label} column options" aria-haspopup="dialog" aria-expanded="false">` with a 12 px chevron-down SVG.
- Column menu: `.planning-review-popover` (300 px) > `.pop-subject` ("{label}", plus " · Shared" for custom columns) and `button.pop-opt` rows: Rename (custom), Show total (custom number; `aria-pressed`, with the `.box` check), a dashed divider, Move left, Move right, a dashed divider, Hide column, Archive column… (custom; inline confirm), then one muted hint line "Shift-click a heading to sort by several columns."
- Add popover: `.pop-subject` "Add column · Epics|Stories" > `.pop-group` > `form.planning-review-add` (name input `.planning-review-column-name[data-autofocus]`; `.planning-review-add-row` with `SegmentedControl.eng-mode-control` Number|Text and `button.planning-action-button` "Add column"), `p.planning-review-guidance` "Shared with everyone reviewing this Sprint.", then `.pop-group` > `.pop-head > .pop-facet` "Show hidden" and a `.pop-list` of `button.pop-opt[aria-pressed="false"]` rows with `.box`, one per hidden column.
- Filters row: `.fb-view-controls` > `div.segmented-control.eng-mode-control.segmented-control-compact[role="radiogroup"][aria-label="Planning review rows"]`; while the review is dirty, after it `button.fb-trigger` "Discard" and `button.fb-trigger.fb-trigger-primary` "Save" (`aria-label="Save review"`); the Discard confirmation replaces both with the text "Discard unsaved changes?" and `button.fb-trigger` "Discard" and "Keep".
- Boundary overlay: `div.planning-review-boundary[hidden]` (fixed, body-level) > `span.planning-review-boundary-line` and `button.planning-review-boundary-hit` > `span.planning-review-boundary-dot` "+".
- Links: Key and Epic are `<a class="task-key-link" …>`.
- Planned Teams Effort: `.capacity-panel.open.capacity-panel-collapsed` in Table view by default; `.capacity-header` toggles it and carries a `.capacity-panel-caret`; the grid stays mounted but hidden.
