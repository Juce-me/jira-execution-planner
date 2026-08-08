# Sticky Group Board Column Chrome Implementation Plan

> **Status:** Implementation complete and uncommitted. Focused Board and analytics verification
> passed; the full matrix retains the unrelated drag-gate failure, a stale Planning fixture, and a
> non-green environment-scoped Python diagnostic. Keep this `EXEC-*` plan pending acceptance or
> merge.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every collapsed Group Board rail and every open-column header visible beneath the existing sticky dashboard controls while the user scrolls through a long board, and correct the shared Catch Up/Board filter-bar wrapper's top-heavy spacing.

**Architecture:** Preserve `EngBoardView`'s existing single-column interface. A private animation-frame geometry pass promotes each column's existing visible `.col-head` or `.col-strip` to a fixed layer, publishes its viewport geometry through inline custom properties, preserves its normal-flow space with a pseudo-element, and independently releases it at the board bottom. No portal, duplicate column tree, new state store, or internal vertical scroller is introduced.

The shared filter-bar adjustment transfers its existing `0.85rem` spacer from the top to the bottom. Its total rendered height stays unchanged, so the live sticky-stack offset remains stable in Catch Up and Board.

**Tech Stack:** React 19, CSS, browser DOM geometry, Playwright, Node test runner, esbuild.

## Global Constraints

- Work in the checkout the user is viewing; do not create a worktree.
- Preserve one `.eng-board .col[data-column-id]` element per workflow column, containing its existing header, folded rail, body, handlers, and drag target.
- Use the live `--epic-sticky-top` offset; never hard-code the compact header, Planning, or filter-bar heights.
- Keep the board chrome below the existing filter-bar and compact-header z-index tiers.
- Preserve column widths, 36px folded width, 340px rail height, focus transfer, star persistence, fold semantics, horizontal centering, off-frame hints, and drag/drop behavior.
- Coalesce page-scroll, board-scroll, resize, and rerender geometry work with `requestAnimationFrame`; do not set React state on every page-scroll frame.
- Do not add a portal, cloned controls, a second synchronized column tree, an internal vertical card scroller, a dependency, an API request, or persistence.
- Do not hand-edit `frontend/dist/`; regenerate it with `npm run build`.
- Add no analytics event. Record the passive-positioning reason in `docs/README_ANALYTICS.md`.
- Preserve unrelated work. Do not commit, stage, push, merge, or rewrite history; those actions were not requested.

---

### Task 1: Promote Existing Column Chrome During Vertical Scroll

**Files:**
- Modify: `tests/ui/eng_group_board_view.spec.js`
- Modify: `frontend/src/eng/EngBoardView.jsx`
- Modify: `frontend/src/styles/eng/board.css`
- Modify: `tests/test_eng_board_styles.js`

**Interfaces:**
- Consumes: `EngBoardView`'s existing `boardRef`, `applyBoardLayout`, `syncHints`, column classes, `--epic-sticky-top`, and current focus/fold/star/drop handlers.
- Produces: an imperative pinned state on the existing `.board` plus four private per-column properties: `--board-chrome-left`, `--board-chrome-width`, `--board-chrome-space`, and `--board-chrome-shift-y`.
- Invariant: no caller, prop, persisted preference, route, or semantic column interface changes.

- [x] **Step 1: Extend only the test fixture seam needed to produce a long board**

Parameterize the existing fixture helpers without changing default behavior:

```js
function epicPayload(specs = EPIC_SPECS) {
    const epics = {};
    specs.forEach(([key, status, priority]) => {
        epics[key] = {
            key,
            summary: `${key} epic summary`,
            status,
            priority,
            assignee: { displayName: 'Planner' },
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            projectTrack: null,
            updated: '2026-05-01T00:00:00.000+0000',
        };
    });
    return epics;
}

function storyPayload(specs = EPIC_SPECS) {
    return specs.map(([key], index) => ({
        id: `${key}-1`,
        key: `${key}-1`,
        fields: {
            summary: `${key} story`,
            status: { name: 'In Progress' },
            priority: { name: 'Major' },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Planner' },
            updated: '2026-05-01T00:00:00.000+0000',
            customfield_10004: index + 1,
            epicKey: key,
            parentSummary: `${key} epic summary`,
            projectKey: 'PLAT',
            teamId: 'team-alpha',
            teamName: 'Alpha Team',
            sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
        },
    }));
}

async function installBoardFixture(page, {
    board = { columns: BOARD_COLUMNS }, groups = null, epicSpecs = EPIC_SPECS,
} = {}) {
    // Keep the existing route table; only replace epicPayload() and storyPayload()
    // at /api/tasks-with-team-name with epicPayload(epicSpecs) and storyPayload(epicSpecs).
}
```

Thread `epicSpecs` through `openBoard`. Build the long-board test data from synthetic keys and the existing `In Progress` status; do not change `EPIC_SPECS` or any existing test's default fixture.

- [x] **Step 2: Write the first failing Playwright regression**

Add a test named `open headers and every collapsed rail pin below the live sticky stack without moving the board`.

The test must:

```js
const longSpecs = [
    ...EPIC_SPECS,
    ...Array.from({ length: 10 }, (_, index) => [
        `PLAT-LONG-${index + 1}`, 'In Progress', 'Major',
    ]),
];

await openBoard(page, {
    width: 800,
    height: 620,
    reducedMotion: true,
    epicSpecs: longSpecs,
});
```

Record the board height and the first visible card's document-space top. Scroll until the compact header is visible and the board is safely inside its sticky range. Then inspect every `.col`: choose `.col-head` for `.is-focused`/`.is-open`, otherwise `.col-strip`.

Assert:

- `.board` has the production pinned-state class;
- every selected chrome element's top equals the numeric live `--epic-sticky-top` within 1px;
- every chrome element's left and width match its owning `.col` within 1px;
- the chrome top is at or below the sticky filter surface's bottom;
- board height and first-card document top changed by at most 1px;
- document horizontal overflow remains at most 1px.

In `tests/test_eng_board_styles.js`, add `--board-chrome-left`, `--board-chrome-width`,
`--board-chrome-space`, and `--board-chrome-shift-y` to `JS_WRITTEN_CUSTOM_PROPERTIES`, each mapped
to `frontend/src/eng/EngBoardView.jsx`. This source guard is part of the red state: it must fail until
the implementation writes all four properties.

- [x] **Step 3: Run the new test and verify the expected failure**

Run:

```bash
npx playwright test tests/ui/eng_group_board_view.spec.js --grep "open headers and every collapsed rail pin"
node --test tests/test_eng_board_styles.js
```

Expected: the Playwright test FAILS because the board has no pinned-state class and the header/rails
scroll above the live sticky offset; the source guard FAILS because `EngBoardView.jsx` does not write
the four registered properties. A setup error, timeout, or fixture failure is not an acceptable red
state.

- [x] **Step 4: Implement the private geometry pass in `EngBoardView`**

Keep the implementation inside `EngBoardView`; do not create a new public seam for one caller. Add a pending-frame ref and private cleanup/sync/schedule callbacks beside the existing board layout code.

The synchronous pass must follow this order:

```js
const board = boardRef.current;
const frame = board.getBoundingClientRect();
const stickyTop = Math.max(
    0,
    parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0,
);
const shouldPin = frame.top <= stickyTop && frame.bottom > stickyTop;
```

When `shouldPin` is false, remove the pinned class and all four inline properties from every `.col`.

When `shouldPin` is true, measure before activating the class:

```js
const isOpen = column.classList.contains('is-focused') || column.classList.contains('is-open');
const chrome = column.querySelector(isOpen ? '.col-head' : '.col-strip');
const columnRect = column.getBoundingClientRect();
const chromeRect = chrome.getBoundingClientRect();
const marginBottom = isOpen ? (parseFloat(getComputedStyle(chrome).marginBottom) || 0) : 0;

column.style.setProperty('--board-chrome-left', `${columnRect.left}px`);
column.style.setProperty('--board-chrome-width', `${columnRect.width}px`);
column.style.setProperty('--board-chrome-space', `${chromeRect.height + marginBottom}px`);
column.style.setProperty('--board-chrome-shift-y', '0px');
```

Only after every column has valid properties, add the pinned class. If no visible chrome exists, clear the pinned state instead of leaving partial geometry.

Add one `requestAnimationFrame` scheduler for window `scroll`, window `resize`, and board `scroll`. Call the synchronous pass directly from the existing layout effect after `applyBoardLayout`, and from the existing document-element `ResizeObserver` after layout and hints synchronize. On unmount, remove listeners, disconnect through the existing observer cleanup, cancel a pending frame, remove the pinned class, and clear inline properties.

Keep `syncHints()` in the board-scroll handler; schedule chrome geometry from the same handler. The
first implementation intentionally keeps shift at `0px`; Task 1 Step 8 adds the failing boundary
test before the bottom-release expression is implemented.

- [x] **Step 5: Add the pinned CSS without changing normal board geometry**

Add scoped rules to `frontend/src/styles/eng/board.css`:

```css
.eng-board .board.is-chrome-pinned .col::before {
    content: '';
    display: block;
    height: var(--board-chrome-space);
    pointer-events: none;
}

.eng-board .board.is-chrome-pinned .col-head,
.eng-board .board.is-chrome-pinned .col-strip {
    position: fixed;
    top: var(--epic-sticky-top, 0px);
    left: var(--board-chrome-left);
    width: var(--board-chrome-width);
    z-index: calc(var(--sticky-epic-z) + 1);
    transform: translateY(var(--board-chrome-shift-y));
    transition: none;
}

.eng-board .board.is-chrome-pinned .col-head {
    background: var(--bg-primary);
}
```

The transition override is required because `.col-strip` is a button covered by the global
`button { transition: all 0.3s; }`. When the rail changes from normal `width: 100%` to fixed measured
width, Chromium otherwise interpolates from viewport width even though the custom property is
already 36px. Do not alter the existing normal-state `.col-head`, `.col-strip`, `.col-body`, `.board`,
or column-width declarations beyond the pinned-state additions.

- [x] **Step 6: Run the first regression and source guard to verify green**

Run:

```bash
npx playwright test tests/ui/eng_group_board_view.spec.js --grep "open headers and every collapsed rail pin"
node --test tests/test_eng_board_styles.js
```

Expected: both commands PASS with no warnings or retries. The Playwright regression must observe
the first animation frame after the pinned class appears and assert that every chrome width already
matches its column and no folded rail has an active `CSSTransition` for `width`.

- [x] **Step 7: Write fail-first interaction, horizontal-sync, and release coverage**

Add a second Playwright test named `pinned chrome stays interactive and releases each element at the board bottom` using the same long synthetic fixture.

It must:

- enter the pinned range;
- click a pinned collapsed rail and assert the existing focus transfer occurs;
- wait for centering and assert every promoted element still matches its `.col` left/width within 1px;
- click the newly pinned non-starred focused header's `.fold` keyboard control and assert focus transfers through the existing path;
- scroll near the board bottom and assert each visible chrome element's bottom is no greater than the board bottom plus 1px;
- include at least one rail and one open header whose bottom equals the board bottom within 1px once each element is in its release range;
- hit-test later page content after the board and prove no pinned board chrome covers it.

Run the new test before changing the `0px` shift and confirm it fails specifically because fixed
chrome persists below the board boundary. This proves the regression guards the new behavior rather
than only the fixture.

- [x] **Step 8: Implement independent board-bottom release and verify green**

Replace the temporary zero shift with:

```js
column.style.setProperty(
    '--board-chrome-shift-y',
    `${Math.min(0, frame.bottom - stickyTop - chromeRect.height)}px`,
);
```

Run:

```bash
npx playwright test tests/ui/eng_group_board_view.spec.js --grep "pinned chrome stays interactive"
```

Expected: PASS, with at least one rail and one open header proven to release at their own rendered
height.

- [x] **Step 9: Run focused Board behavior and inspect a settled screenshot**

Run:

```bash
npx playwright test tests/ui/eng_group_board_view.spec.js
npx playwright test tests/ui/eng_group_board_drag.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_filters.spec.js
```

Add a settled screenshot to the existing gitignored `tmp/eng-group-board-view/` directory while the long board is pinned at 800px width. Inspect it directly and confirm that open headers are opaque, rails begin below the filter bar, card content does not jump, and no chrome overlaps compact controls.

Expected: all focused tests PASS; screenshot inspection shows the requested pinned layout.

---

### Task 2: Rebalance The Shared Filter-Bar Wrapper

**Files:**
- Modify: `frontend/src/styles/eng/filter-bar.css`
- Modify: `tests/ui/eng_compact_layout_visual.spec.js`
- Modify: `tests/ui/eng_group_board_filters.spec.js`

**Interfaces:**
- Consumes: the shared `EngFilterBar` wrapper used by Catch Up and Board.
- Produces: the same total wrapper height with its existing spacer below the bar rather than above it.
- Invariant: `EngFilterBar` height reporting and the derived `--epic-sticky-top` value do not change.

- [x] **Step 1: Add failing inset geometry coverage in both modes**

In the existing Catch Up sticky-stack test and Board filter-bar geometry coverage, measure the outer
`.filterbar-wrap` and its direct `.filterbar` child:

```js
const geometry = await page.locator('.filterbar-wrap').evaluate((wrap) => {
    const bar = wrap.querySelector(':scope > .filterbar');
    const wrapRect = wrap.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const styles = getComputedStyle(wrap);
    return {
        topInset: barRect.top - wrapRect.top,
        bottomInset: wrapRect.bottom - barRect.bottom,
        paddingBottom: parseFloat(styles.paddingBottom) || 0,
        heightIdentity: wrapRect.height - barRect.height
            - (barRect.top - wrapRect.top)
            - (wrapRect.bottom - barRect.bottom),
        wrapperHeight: wrapRect.height,
    };
});
```

Assert in both modes that `topInset <= 1`, `bottomInset > 1`, bottom inset matches computed bottom
padding within 1px, and `heightIdentity` is within 1px of zero. Preserve the existing Catch Up and
Board sticky-stack assertions. Record the current wrapper height before the CSS change and assert it
remains within 1px afterward.

Run:

```bash
npx playwright test tests/ui/eng_compact_layout_visual.spec.js --grep "sticky stack"
npx playwright test tests/ui/eng_group_board_filters.spec.js --grep "filter"
```

Expected: both new inset checks FAIL with approximately `13.6px` above and `0px` below.

- [x] **Step 2: Transfer, rather than add, the shared spacer**

Change only the wrapper padding declaration:

```css
.filterbar-wrap {
    /* existing declarations remain */
    padding-block: 0 0.85rem;
}
```

Do not use symmetric block padding or change `.filterbar` height, because either would move every
downstream sticky surface.

- [x] **Step 3: Verify both modes and inspect settled screenshots**

Re-run the two focused commands. Expected: both PASS and report the same outer wrapper height as the
red-state measurement. Capture and inspect one settled Catch Up screenshot and one settled Board
screenshot, confirming the controls sit close to the surface above and retain lower breathing room.

---

### Task 3: Record Analytics Decision, Rebuild, And Close Verification

**Files:**
- Modify: `docs/README_ANALYTICS.md`
- Modify: `frontend/dist/dashboard.css`
- Modify: `frontend/dist/dashboard.js`
- Modify: `frontend/dist/dashboard.js.map`
- Modify: `docs/agents/features/2026-08-08-planned-sticky-board-column-chrome.md`
- Modify: `docs/plans/EXEC-sticky-board-column-chrome.md`
- Modify: `docs/plans/README.md`

**Interfaces:**
- Consumes: Tasks 1 and 2's source and test behavior.
- Produces: generated frontend artifacts, the documented no-event decision, verified execution status, and current plan index.

- [x] **Step 1: Add the analytics no-event allowlist row**

Under `docs/README_ANALYTICS.md` → `## Allowlist`, add:

```markdown
| ENG Group Board sticky column chrome | `frontend/src/eng/EngBoardView.jsx`, `frontend/src/styles/eng/board.css` | Passive positioning adds no new user action or application state; Board focus/fold/star interactions remain intentionally untracked under the existing Board allowlist, and scroll position itself is not collected. | 2026-08-08 |
| ENG shared filter-bar wrapper spacing | `frontend/src/styles/eng/filter-bar.css` | Passive layout correction in existing Catch Up and Board controls; no new action, state, or data collection is introduced. | 2026-08-08 |
```

Do not add an event, parameter, trigger, or analytics implementation change.

- [x] **Step 2: Rebuild generated frontend output**

Run:

```bash
npm run build
```

Expected: exit 0. Confirm `git diff --exit-code -- frontend/dist/` fails before accepting the build result, because Task 1 changed frontend source and generated output must change.

- [ ] **Step 3: Run the complete verification matrix**

Run:

```bash
node --test tests/test_eng_board_styles.js
npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_drag.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_filters.spec.js
npx playwright test tests/ui/eng_compact_layout_visual.spec.js
python3 -m unittest discover -s tests
npm run build
git diff --check
```

Expected: every command exits 0, the Python suite reports zero failures/errors, Playwright reports zero failures/retries, the second build leaves no additional generated diff, and `git diff --check` prints nothing.

- [x] **Step 4: Inspect the final diff for scope and sensitive data**

Run:

```bash
git status --short
git diff --stat
git diff -- frontend/src/eng/EngBoardView.jsx frontend/src/styles/eng/board.css tests/test_eng_board_styles.js tests/ui/eng_group_board_view.spec.js docs/README_ANALYTICS.md
```

Confirm every changed source line traces to this plan, no local absolute paths or real Jira data entered tracked files, and generated output is build-produced only.

- [x] **Step 5: Update execution artifacts without committing**

Rename the feature artifact to `docs/agents/features/2026-08-08-executed-sticky-board-column-chrome.md`, change its status to `executed`, and add `Outcome` and `Current Accuracy` sections recording the actual implementation and verification.

Keep this file named `EXEC-sticky-board-column-chrome.md` until the requester accepts or merges the result. Add a top status note that implementation is complete and locally verified but uncommitted. Check every completed checkbox and add an `## Outcome` section with exact test counts from Step 3.

Add the plan to `docs/plans/README.md` under ENG Group Board with its current status and expected output. Do not modify unrelated plan entries.

## Outcome

Implementation is complete and generated output was rebuilt without hand edits. The analytics
allowlist records both passive layout decisions.

Verification recorded on 2026-08-08:

- `node --test tests/test_eng_board_styles.js`: 6 passed, 0 failed.
- Combined Board Playwright files: 82 passed, 1 failed. The known unrelated
  done-category drag-gate test could not find `.eng-board-drop-warn`.
- Catch Up visual spec: 23 passed, 1 failed. Its Planning sticky-stack setup could not find
  `.alerts-panel-toolbar` before the layout assertions ran. Diagnosis: the fixture sets
  `showPlanning: true` while still expecting that Catch-Up-only toolbar.
- The plan's literal `python3` command used an unmanaged runtime and ended with 382 tests run,
  1 failure, 97 errors, and 138 skipped because required dependencies were unavailable.
  The repository virtual-environment rerun was interrupted after synthetic `db:5432` leaked into
  the migration check and blocked the startup-preflight test.
- A scoped in-memory diagnostic patched startup migration validation and completed 1,216 tests in
  12.774 seconds with 4 failures and 1 skip. Three excluded-capacity API tests leaked the configured
  PostgreSQL URL and attempted `/tmp/.s.PGSQL.5432`, returning 500 instead of 200. The remaining
  local-loopback startup-preflight test expected exit code 1 but received 0 because the diagnostic
  patch bypassed the validation it asserts. This is diagnostic completeness, not a green suite.
- Both `npm run build` commands exited 0; the first produced the expected non-empty generated
  artifact diff, and `git diff --check` exited 0 with no whitespace errors.

The incomplete checklist entries represent verification work that did not reach a clean result;
they are intentionally not marked complete. No commit, staging, push, merge, or history rewrite
was performed.
