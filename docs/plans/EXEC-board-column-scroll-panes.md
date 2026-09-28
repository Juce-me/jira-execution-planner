# ENG Board Column Scroll Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop, every ENG Board column becomes a bordered pane from its title line to the screen bottom, open columns scroll independently once the board is stuck under the filter bar, and nothing in a column paints outside its pane.

**Architecture:** `EngBoardView` owns two imperative classes on the `.eng-board` root, `is-pane-mode` (desktop gate) and `is-pane-stuck` (board at the sticky line), toggled inside the existing layout pass and rAF-coalesced chrome scheduler. CSS makes the `.board` itself `100dvh - --epic-sticky-top` tall with columns stretched inside it, and the column bodies scroll only while stuck. The dashboard hides the compact sticky header while Board pane mode is active so the sticky line is the filter bar alone.

**Tech Stack:** React 19, esbuild, plain CSS partials, Playwright (Chromium), Node `node:test`, Python `unittest`.

**Design spec (source of truth for intent):** [2026-09-24-executed-board-column-scroll-panes.md](../agents/features/2026-09-24-executed-board-column-scroll-panes.md)

## Global Constraints

- Pane mode only when `matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)')` matches and `innerHeight - measured .filterbar-wrap height >= max(--board-strip-h, focused .col-head height + margin + first card height)`, with 8px hysteresis when turning off.
- Every other viewport keeps today's behavior exactly: page scroll, `.is-chrome-pinned`, `--board-chrome-*`, rail-click reveal, compact header.
- No JS wheel interception or manual scroll routing. No new scroll listeners (MRT003).
- No new z-index tier; no `position: fixed` in pane mode (MRT009, MRT017).
- Every board selector stays scoped under `.eng-board` (`tests/test_eng_board_styles.js`).
- No restyling of cards, title row, status pills, or rail fill; breach styling only moves from `.col-body` to the pane.
- No analytics event.
- Never hand-edit `frontend/dist/`; rebuild with `npm run build`.
- UI specs read `frontend/dist/dashboard.css`, so run `npm run build` after every CSS change before running Playwright.
- Commit messages: descriptive subject under 72 characters, body explains why, **no `Co-Authored-By` or tool branding**.
- Do not push or open a PR; publication is a separate operator-confirmed step (AGENTS.md section 10).

## Shared Names (used across tasks)

| Name | Where | Meaning |
| --- | --- | --- |
| `is-pane-mode` | class on `.eng-board` | desktop pane layout active |
| `is-pane-stuck` | class on `.eng-board` | board at the sticky line; column bodies scroll |
| `--board-pane-trailing` | inline property on `.eng-board` | measured document space below the board, cancelled by negative margin |
| `PANE_MEDIA_QUERY` | `EngBoardView.jsx` constant | `'(min-width: 761px) and (hover: hover) and (pointer: fine)'` |
| `PANE_STUCK_EPSILON` | `EngBoardView.jsx` constant and view spec | `1` (px) |
| `PANE_GATE_HYSTERESIS` | `EngBoardView.jsx` constant | `8` (px) |
| `pageMaxScroll()` | `EngBoardView.jsx` module function | `scrollingElement.scrollHeight - innerHeight`, floored at 0 |
| `onPaneModeChange(boolean)` | `EngBoardView` prop | reports pane mode to the dashboard |
| `boardPaneMode` | dashboard state | last reported pane mode |
| `FALLBACK_VIEWPORT` | view spec constant | `{ width: 800, height: 380 }`, fails the height gate with margin |

## File Map

- Modify: `frontend/src/eng/EngBoardView.jsx` (gate, classes, stuck state, trailing measure, rail reveal, focus re-stick)
- Modify: `frontend/src/styles/eng/board.css` (pane geometry, mask, rails, breach move, announcement placement)
- Modify: `frontend/src/dashboard.jsx` (`boardPaneMode` state, derived `compactStickyVisible`, prop wiring)
- Modify: `tests/test_codebase_structure_budgets.py` (`dashboard.jsx` budget +1, itemized)
- Modify: `frontend/src/issues/useIssueFieldPopover.js` (dismiss when trigger is clipped out of view)
- Modify: `tests/test_eng_board_styles.js` (register `--board-pane-trailing`)
- Modify: `tests/ui/eng_group_board_view.spec.js` (pane tests; old-model tests moved to `FALLBACK_VIEWPORT`)
- Modify: `tests/ui/eng_group_board_filters.spec.js` (sticky snapshot test moved to a gate-failing viewport)
- Modify: `tests/ui/eng_group_board_drag.spec.js` (drop while stuck)
- Modify: `tests/ui/eng_group_board_card.spec.js` (person editor dismissed when its card scrolls out of the pane)
- Modify: docs listed in Task 5
- Regenerate: `frontend/dist/*` via `npm run build`

---

### Task 0: Baseline

**Files:** none changed.

- [ ] **Step 1: Install and build in this worktree**

Run: `npm ci && npm run build`
Expected: exit 0. (AGENTS.md: a build resolving an ancestor checkout's `node_modules` embeds wrong source-map paths.)

- [ ] **Step 2: Run the affected suites and record the baseline**

Run:
```bash
npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_drag.spec.js tests/ui/codebase_structure_smoke.spec.js --reporter=line
node --test tests/test_eng_board_styles.js
.venv/bin/python -m unittest tests.test_codebase_structure_budgets
```
Expected: record pass/fail counts in the Execution Status section below. Any pre-existing failure is listed there by test title and is not fixed by this plan.

- [ ] **Step 3: Keep the "before" screenshots**

Run: `mkdir -p tmp/eng-group-board-view/before && cp tmp/eng-group-board-view/board-1440.png tmp/eng-group-board-view/board-800.png tmp/eng-group-board-view/board-pinned-800.png tmp/eng-group-board-view/before/`
Expected: three files copied (written by the baseline run; `tmp/` is gitignored).

---

### Task 1: Pane-mode gate and compact header suppression

**Files:**
- Modify: `frontend/src/eng/EngBoardView.jsx`
- Modify: `frontend/src/dashboard.jsx:846`, `:13726`, `:13784`, `:17227`
- Modify: `tests/test_codebase_structure_budgets.py:144`
- Test: `tests/ui/eng_group_board_view.spec.js`

**Interfaces:**
- Produces: `.eng-board.is-pane-mode`; `EngBoardView` prop `onPaneModeChange(boolean)`; module function `pageMaxScroll()`; refs `rootRef`, `paneModeRef`; callbacks `setPaneMode(next)`, `syncPaneMode()`; constants `PANE_MEDIA_QUERY`, `PANE_STUCK_EPSILON`, `PANE_GATE_HYSTERESIS`; spec constant `FALLBACK_VIEWPORT`.

- [ ] **Step 1: Write the failing gate and compact-header tests**

Add near `boardGeometry` in `tests/ui/eng_group_board_view.spec.js`:

```js
// Pane mode (docs/agents/features/2026-09-24-executed-board-column-scroll-panes.md). A viewport
// that fails the height gate with margin, for tests that assert the page-scroll/pinned-chrome model.
const FALLBACK_VIEWPORT = { width: 800, height: 380 };
const PANE_STUCK_EPSILON = 1;

async function isPaneMode(page) {
    return page.evaluate(() => Boolean(document.querySelector('.eng-board.is-pane-mode')));
}
```

Add the tests (place them after the `'a resize never leaves the board wider than the viewport...'` test):

```js
test('pane mode turns on only for a wide fine-pointer viewport with enough height', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 900 });
    expect(await isPaneMode(page)).toBe(true);

    await page.setViewportSize(FALLBACK_VIEWPORT);
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(0);

    await page.setViewportSize({ width: 420, height: 900 });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(1);
});

test('the pane-mode height gate sits at filter bar plus rail height, with hysteresis', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 900 });
    const boundary = await page.evaluate(() => {
        const filterBar = document.querySelector('.filterbar-wrap').getBoundingClientRect().height;
        const rail = parseFloat(getComputedStyle(document.querySelector('.eng-board')).getPropertyValue('--board-strip-h'));
        return Math.ceil(filterBar + rail);
    });
    await page.setViewportSize({ width: 1280, height: boundary });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: boundary - 5 });
    await expect(page.locator('.eng-board.is-pane-mode'), 'hysteresis keeps pane mode').toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: boundary - 10 });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: boundary - 1 });
    await expect(page.locator('.eng-board.is-pane-mode'), 'turning on needs the full height').toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: boundary });
    await expect(page.locator('.eng-board.is-pane-mode')).toHaveCount(1);
});

test.describe('touch tablet', () => {
    test.use({ isMobile: true, hasTouch: true });

    test('a landscape touch tablet keeps the page-scroll model', async ({ page }) => {
        await openBoard(page, { width: 1024, height: 768 });
        expect(await isPaneMode(page)).toBe(false);
    });
});

test('Board pane mode keeps the compact header hidden and Catch Up gets it back', async ({ page }) => {
    const longSpecs = [
        ...EPIC_SPECS,
        ...Array.from({ length: 32 }, (_, index) => [`PLAT-IP-${index + 1}`, 'In Progress', 'Major']),
    ];
    await openBoard(page, { width: 1280, height: 700, reducedMotion: true, epicSpecs: longSpecs });
    expect(await isPaneMode(page)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await waitTwoFrames(page);
    const headerGone = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().bottom <= 0);
    expect(headerGone, 'the full header scrolled away, so the compact header would normally show').toBe(true);
    await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Catch Up' }).click();
    await expect(page.locator('.eng-board')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await expect(page.locator('.compact-sticky-header.is-visible')).toHaveCount(1);
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `npx playwright test tests/ui/eng_group_board_view.spec.js -g "pane mode|pane-mode|touch tablet|compact header hidden" --reporter=line`
Expected: FAIL — `.eng-board.is-pane-mode` never appears; compact header becomes visible on Board.

- [ ] **Step 3: Add constants, `pageMaxScroll`, and the prop to `EngBoardView.jsx`**

After `const MENU_EDGE_GAP = 8;` add:

```js
// Pane mode (docs/agents/features/2026-09-24-executed-board-column-scroll-panes.md): desktop only —
// wider than the repo's 760px narrow breakpoint, with a hovering fine pointer so touch tablets keep
// the page-scroll model.
const PANE_MEDIA_QUERY = '(min-width: 761px) and (hover: hover) and (pointer: fine)';
// One tolerance for "the board has reached the sticky line", shared by the stuck check and tests.
const PANE_STUCK_EPSILON = 1;
// Keeps the height gate from flapping on rounding while a viewport is resized.
const PANE_GATE_HYSTERESIS = 8;
```

After `function breachText(...) {...}` add:

```js
function pageMaxScroll() {
    const scroller = document.scrollingElement || document.documentElement;
    return Math.max(0, scroller.scrollHeight - window.innerHeight);
}
```

In the props destructuring, change `onResolvedFocusChange,` to `onResolvedFocusChange, onPaneModeChange,`.

- [ ] **Step 4: Add refs, `setPaneMode`, and `syncPaneMode`**

Next to `const boardRef = React.useRef(null);` add:

```js
    const rootRef = React.useRef(null);
    const paneModeRef = React.useRef(false);
```

Immediately before `const clearBoardChrome = React.useCallback(` add:

```js
    // Both pane classes are imperative, like is-chrome-pinned: the root's className prop never
    // changes, so a React render cannot wipe one class while the other survives.
    const setPaneMode = React.useCallback((next) => {
        const root = rootRef.current;
        if (root) {
            root.classList.toggle('is-pane-mode', next);
            if (!next) {
                root.classList.remove('is-pane-stuck');
                root.style.removeProperty('--board-pane-trailing');
            }
        }
        if (paneModeRef.current !== next) {
            paneModeRef.current = next;
            onPaneModeChange?.(next);
        }
    }, [onPaneModeChange]);

    // The gate reads measured geometry only — never --epic-sticky-top, which still includes the
    // compact header on the pass that first turns pane mode on.
    const syncPaneMode = React.useCallback(() => {
        const root = rootRef.current;
        const board = boardRef.current;
        if (!root || !board) {
            setPaneMode(false);
            return;
        }
        const filterBar = root.parentElement?.querySelector(':scope > .filterbar-wrap');
        const head = board.querySelector('.col.is-focused > .col-head');
        const card = board.querySelector('.col.is-focused .ecard');
        const headSpace = head
            ? head.getBoundingClientRect().height + (parseFloat(getComputedStyle(head).marginBottom) || 0)
            : 0;
        const railHeight = parseFloat(getComputedStyle(root).getPropertyValue('--board-strip-h')) || 0;
        const available = window.innerHeight - (filterBar ? filterBar.getBoundingClientRect().height : 0);
        const required = Math.max(railHeight, headSpace + (card ? card.getBoundingClientRect().height : 0))
            - (root.classList.contains('is-pane-mode') ? PANE_GATE_HYSTERESIS : 0);
        setPaneMode(Boolean(window.matchMedia?.(PANE_MEDIA_QUERY).matches) && available >= required);
    }, [setPaneMode]);
```

- [ ] **Step 5: Call the gate from the existing layout pass, observer, and unmount**

Change the main layout effect to:

```js
    React.useLayoutEffect(() => {
        syncPaneMode();
        applyBoardLayout(smoothRef.current);
        smoothRef.current = false;
        syncHints();
        syncBoardChrome();
    }, [applyBoardLayout, syncBoardChrome, syncHints, syncPaneMode, columns, focusedId, starredId]);

    // Loading, error and empty states render no .board; pane mode must not outlive it, or the
    // dashboard would keep the compact header hidden.
    React.useLayoutEffect(() => {
        if (!boardRef.current) setPaneMode(false);
    });
```

Change the ResizeObserver callback body to:

```js
        const observer = new ResizeObserver(() => {
            syncPaneMode();
            applyBoardLayout(false);
            syncHints();
            syncBoardChrome();
        });
```

and its dependency list to `[applyBoardLayout, syncBoardChrome, syncHints, syncPaneMode]`.

After the `--board-scrollbar-width` cleanup effect add:

```js
    React.useEffect(() => () => setPaneMode(false), [setPaneMode]);
```

Add `ref={rootRef}` to `<div className="eng-board" role="region" aria-label="Group board">`.

- [ ] **Step 6: Wire the dashboard**

In `frontend/src/dashboard.jsx` replace line 846:

```js
            const [compactStickyVisible, setCompactStickyVisible] = useState(false);
```

with:

```js
            const [compactHeaderScrolledAway, setCompactHeaderScrolledAway] = useState(false);
            const [boardPaneMode, setBoardPaneMode] = useState(false);
            const compactStickyVisible = compactHeaderScrolledAway && !boardPaneMode;
```

In the header visibility effect replace `setCompactStickyVisible(rect.bottom <= 0);` with `setCompactHeaderScrolledAway(rect.bottom <= 0);`.

In the dropdown-close effect (the one resetting `setShowTeamDropdown(false)` etc.) replace `}, [compactStickyVisible]);` with `}, [compactHeaderScrolledAway, compactStickyVisible]);` so a main-bar dropdown closes when the top bar scrolls away in pane mode.

In the Board `<EngBoardView ...>` props, after `onFilterBarHeightChange={handleFilterBarHeightChange}` add `onPaneModeChange={setBoardPaneMode}`.

Run: `grep -n "setCompactStickyVisible" frontend/src/dashboard.jsx`
Expected: no output.

- [ ] **Step 7: Ratchet the dashboard budget**

In `tests/test_codebase_structure_budgets.py`, above `"frontend/src/dashboard.jsx": 18093,` add the comment line and bump the value:

```python
    # Board column scroll panes derive compactStickyVisible from the header scroll state and the
    # Board pane-mode report, and pass one callback to EngBoardView (+1).
    "frontend/src/dashboard.jsx": 18094,
```

Run: `.venv/bin/python -m unittest tests.test_codebase_structure_budgets`
Expected: OK.

- [ ] **Step 8: Run the new tests**

Run: `npx playwright test tests/ui/eng_group_board_view.spec.js -g "pane mode|pane-mode|touch tablet|compact header hidden" --reporter=line`
Expected: PASS.

- [ ] **Step 9: Move compact-header-dependent tests to the fallback viewport**

Run: `npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js tests/ui/codebase_structure_smoke.spec.js --reporter=line`

For every failure that waits for `.compact-sticky-header.is-visible` on Board (expected: `'selector compact surface: remount closes stale panel...'`, `'the compact sticky header paints over the board, including the off-frame hint'`, `'open headers and every collapsed rail pin below the live sticky stack...'`, `'every custom property board.css reads resolves on the live board'`, and the filters spec `'...popover...'` sticky snapshot test at 1280x600), change only its `openBoard` viewport to `FALLBACK_VIEWPORT` (filters spec: declare the same constant at its top). If a moved test's own scroll offsets no longer reach its threshold at 380px height, scale only those offsets; keep every assertion unchanged. Record each moved test title in Execution Status. Any other failure is a regression: fix the code, not the test.

Expected after changes: the three specs match the Task 0 baseline plus the new tests.

- [ ] **Step 10: Commit**

```bash
npm run build
git add frontend/src/eng/EngBoardView.jsx frontend/src/dashboard.jsx tests/test_codebase_structure_budgets.py tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js frontend/dist
git commit -m "Gate ENG Board pane mode and hide compact header in it" -m "Adds the desktop pane-mode gate on .eng-board and reports it to the dashboard, which derives compactStickyVisible so the filter bar is the only sticky layer in Board pane mode. Tests that assert the compact header on Board move to a viewport that fails the gate."
git show --stat HEAD && git status --short
```

---

### Task 2: Pane geometry, stuck state, mask, and rails

**Files:**
- Modify: `frontend/src/eng/EngBoardView.jsx` (`syncPaneMode`, `syncBoardChrome`)
- Modify: `frontend/src/styles/eng/board.css`
- Modify: `tests/test_eng_board_styles.js:21-28`
- Test: `tests/ui/eng_group_board_view.spec.js`

**Interfaces:**
- Consumes: Task 1 `rootRef`, `syncPaneMode`, `pageMaxScroll`, `PANE_STUCK_EPSILON`, `FALLBACK_VIEWPORT`.
- Produces: `.eng-board.is-pane-stuck`; `--board-pane-trailing`; spec helpers `longColumnSpecs()`, `openSecondColumn(page)`, `paneState(page)`, `settleScroll(page)`, `wheelOver(page, locator, deltaY)`, `stickPage(page)`; column id constants `READY_ID = 'col-3c4d5e6f'`, `IN_PROGRESS_ID = 'col-6f708192'`, `TODO_ID = 'col-1a2b3c4d'`.

- [ ] **Step 1: Add pane test helpers**

Below the Task 1 helpers in `tests/ui/eng_group_board_view.spec.js`:

```js
const READY_ID = 'col-3c4d5e6f';
const IN_PROGRESS_ID = 'col-6f708192';
const TODO_ID = 'col-1a2b3c4d';

// Two open columns (In progress is the starred default; Ready to start is focused beside it),
// each well over 30 epics so both panes overflow (MRT018).
function longColumnSpecs(count = 32) {
    return [
        ...EPIC_SPECS,
        ...Array.from({ length: count }, (_, index) => [`PLAT-IP-${index + 1}`, 'In Progress', 'Major']),
        ...Array.from({ length: count }, (_, index) => [`PLAT-RS-${index + 1}`, 'Awaiting Validation', 'Major']),
    ];
}

// Keyboard activation: event.detail is 0, so the rail-click page reveal does not run.
async function openSecondColumn(page) {
    await col(page, READY_ID).locator('.col-strip').focus();
    await page.keyboard.press('Enter');
    await settle(page);
}

async function paneState(page) {
    return page.evaluate(() => {
        const root = document.querySelector('.eng-board');
        const board = root.querySelector('.board');
        const boardRect = board.getBoundingClientRect();
        const columns = [...board.querySelectorAll('.col')].map((column) => {
            const rect = column.getBoundingClientRect();
            const open = column.classList.contains('is-open') || column.classList.contains('is-focused');
            const body = column.querySelector('.col-body');
            const name = column.querySelector('.col-head .nm');
            return {
                id: column.dataset.columnId,
                open,
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                scrollTop: open ? body.scrollTop : null,
                firstCardWidth: open ? body.querySelector('.ecard')?.getBoundingClientRect().width ?? null : null,
                nameRect: open ? name.getBoundingClientRect().toJSON() : null,
                stripBottom: open ? null : column.querySelector('.col-strip').getBoundingClientRect().bottom,
            };
        });
        return {
            paneMode: root.classList.contains('is-pane-mode'),
            stuck: root.classList.contains('is-pane-stuck'),
            scrollY: window.scrollY,
            maxScroll: document.scrollingElement.scrollHeight - window.innerHeight,
            stickyTop: parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0,
            innerHeight: window.innerHeight,
            boardTop: boardRect.top,
            boardBottom: boardRect.bottom,
            boardContentBottom: boardRect.top + board.clientTop + board.clientHeight,
            compactVisible: Boolean(document.querySelector('.compact-sticky-header.is-visible')),
            columns,
        };
    });
}

function openScrollTops(state) {
    return Object.fromEntries(state.columns.filter((c) => c.open).map((c) => [c.id, c.scrollTop]));
}

// Three equal consecutive samples of the page and every open body, like settle() for scrollLeft.
async function settleScroll(page) {
    await page.evaluate(() => { window.__paneSettle = null; });
    await page.waitForFunction(() => {
        const sample = JSON.stringify([
            window.scrollY,
            ...[...document.querySelectorAll('.eng-board .col-body')].map((body) => body.scrollTop),
            document.querySelector('.eng-board')?.className,
        ]);
        const state = window.__paneSettle;
        if (!state || state.sample !== sample) {
            window.__paneSettle = { sample, stable: 0 };
            return false;
        }
        state.stable += 1;
        return state.stable >= 2;
    }, null, { timeout: 5000, polling: 120 });
}

// Moves the pointer onto a visible point of the target, waits out the previous gesture's latch,
// then wheels once.
async function wheelOver(page, locator, deltaY) {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    const x = box.x + box.width / 2;
    const y = Math.min(Math.max(box.y + 80, 10), viewport.height - 20);
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    await page.mouse.wheel(0, deltaY);
    await settleScroll(page);
}

async function stickPage(page) {
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await settleScroll(page);
}
```

- [ ] **Step 2: Write the failing geometry and scroll tests**

```js
test('pane mode: before the board sticks, a wheel over a column scrolls the page and no column', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleScroll(page);
    const before = await paneState(page);
    expect(before.paneMode).toBe(true);
    expect(before.stuck).toBe(false);

    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 120);
    const after = await paneState(page);
    expect(after.scrollY).toBeGreaterThan(before.scrollY);
    expect(openScrollTops(after)).toEqual(openScrollTops(before));
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    test(`pane mode at ${viewport.width}x${viewport.height}: max scroll sticks panes between the sticky line and the viewport bottom`, async ({ page }) => {
        await openBoard(page, { ...viewport, reducedMotion: true, epicSpecs: longColumnSpecs() });
        await openSecondColumn(page);
        await stickPage(page);
        const state = await paneState(page);
        await page.screenshot({ path: `${screenshotDir}/board-pane-stuck-${viewport.width}.png`, fullPage: false });

        expect(state.stuck).toBe(true);
        expect(state.compactVisible).toBe(false);
        expect(Math.abs(state.boardTop - state.stickyTop)).toBeLessThanOrEqual(PANE_STUCK_EPSILON);
        expect(Math.abs(state.boardBottom - state.innerHeight)).toBeLessThanOrEqual(PANE_STUCK_EPSILON);
        state.columns.forEach((column) => {
            expect(Math.abs(column.top - state.stickyTop), `${column.id} top`).toBeLessThanOrEqual(PANE_STUCK_EPSILON);
            expect(Math.abs(column.bottom - state.boardContentBottom), `${column.id} bottom`).toBeLessThanOrEqual(PANE_STUCK_EPSILON);
        });
    });
}

test('pane mode: when stuck, a wheel scrolls only the column under the pointer', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await stickPage(page);
    const start = await paneState(page);

    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 300);
    const afterReady = await paneState(page);
    expect(openScrollTops(afterReady)[READY_ID]).toBeGreaterThan(0);
    expect(openScrollTops(afterReady)[IN_PROGRESS_ID]).toBe(openScrollTops(start)[IN_PROGRESS_ID]);
    expect(afterReady.scrollY).toBe(start.scrollY);

    await wheelOver(page, col(page, IN_PROGRESS_ID).locator('.col-body'), 300);
    const afterProgress = await paneState(page);
    expect(openScrollTops(afterProgress)[IN_PROGRESS_ID]).toBeGreaterThan(0);
    expect(openScrollTops(afterProgress)[READY_ID]).toBe(openScrollTops(afterReady)[READY_ID]);
    expect(afterProgress.scrollY).toBe(start.scrollY);
});

test('pane mode: at a column top, a new upward gesture scrolls the page and releases sticky mode', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await stickPage(page);
    const body = col(page, READY_ID).locator('.col-body');
    await wheelOver(page, body, 300);
    await wheelOver(page, body, -5000);
    expect(openScrollTops(await paneState(page))[READY_ID]).toBe(0);

    const stuckY = (await paneState(page)).scrollY;
    await expect.poll(async () => {
        await wheelOver(page, body, -120);
        const state = await paneState(page);
        return state.scrollY < stuckY && !state.stuck;
    }, { timeout: 8000 }).toBe(true);
});

test('pane mode: titles stay inside their panes and cards keep one width stuck or not', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleScroll(page);
    const loose = await paneState(page);
    await stickPage(page);
    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 600);
    const stuck = await paneState(page);

    for (const state of [loose, stuck]) {
        state.columns.filter((c) => c.open).forEach((column) => {
            expect(column.nameRect.left, `${column.id} title left`).toBeGreaterThanOrEqual(column.left + 1);
            expect(column.nameRect.right, `${column.id} title right`).toBeLessThanOrEqual(column.right - 1);
        });
    }
    stuck.columns.filter((c) => c.open).forEach((column) => {
        expect(column.nameRect.top, `${column.id} title below the sticky line`).toBeGreaterThanOrEqual(stuck.stickyTop);
    });
    const titleHits = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col.is-open .nm, .eng-board .col.is-focused .nm')]
        .map((name) => {
            const rect = name.getBoundingClientRect();
            return Boolean(document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2)?.closest('.col-head'));
        }));
    expect(titleHits.every(Boolean)).toBe(true);
    const widths = (state) => Object.fromEntries(state.columns.filter((c) => c.open).map((c) => [c.id, c.firstCardWidth]));
    expect(widths(stuck)).toEqual(widths(loose));
});

test('pane mode: rails reach the board bottom and keep their fill ratios', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true });
    await stickPage(page);
    const state = await paneState(page);
    state.columns.filter((c) => !c.open).forEach((column) => {
        expect(Math.abs(column.stripBottom - state.boardContentBottom), `${column.id} rail bottom`).toBeLessThanOrEqual(PANE_STUCK_EPSILON);
    });
    const ratios = await page.evaluate(() => [...document.querySelectorAll('.eng-board .col:not(.is-open):not(.is-focused) .col-strip')]
        .map((strip) => {
            const fill = strip.querySelector('.fill');
            return { declared: parseFloat(fill.style.height) / 100, painted: fill.getBoundingClientRect().height / strip.clientHeight };
        }));
    ratios.forEach(({ declared, painted }) => expect(Math.abs(declared - painted)).toBeLessThanOrEqual(0.01));
});
```

Run: `npm run build && npx playwright test tests/ui/eng_group_board_view.spec.js -g "pane mode" --reporter=line`
Expected: the new geometry/scroll tests FAIL (no pane CSS, no stuck class).

- [ ] **Step 3: Add the trailing measure to `syncPaneMode`**

Replace the final line of `syncPaneMode` (`setPaneMode(Boolean(...) && available >= required);`) with:

```js
        const next = Boolean(window.matchMedia?.(PANE_MEDIA_QUERY).matches) && available >= required;
        setPaneMode(next);
        if (!next) return;

        // Whatever the document renders below the board (today .container's bottom padding) is
        // cancelled by a negative margin, so maximum page scroll lands the board exactly between
        // the sticky line and the viewport bottom. Measured with the margin removed so it never
        // compounds across passes.
        root.style.setProperty('--board-pane-trailing', '0px');
        const boardBottom = board.getBoundingClientRect().bottom + window.scrollY;
        const scroller = document.scrollingElement || document.documentElement;
        root.style.setProperty('--board-pane-trailing', `${Math.max(0, scroller.scrollHeight - boardBottom)}px`);
```

- [ ] **Step 4: Add the stuck branch to `syncBoardChrome`**

In `syncBoardChrome`, directly after the `stickyTop` constant, insert:

```js
        // Pane mode never pins chrome: the panes are the frame. Stuck is the board at the sticky
        // line, or the page at maximum scroll, so fractional zoom cannot strand the columns.
        const root = rootRef.current;
        if (root?.classList.contains('is-pane-mode')) {
            clearBoardChrome();
            root.classList.toggle(
                'is-pane-stuck',
                frame.top <= stickyTop + PANE_STUCK_EPSILON
                    || window.scrollY >= pageMaxScroll() - PANE_STUCK_EPSILON,
            );
            return;
        }
```

- [ ] **Step 5: Add the pane CSS**

In `frontend/src/styles/eng/board.css`, after the `.eng-board .board.is-chrome-pinned .col:not(.is-open):not(.is-focused) .col-strip { ... }` rule, add:

```css
        /* ── Pane mode (desktop; EngBoardView owns the gate): every column is a bordered pane from
           its title line to the viewport bottom, and open columns scroll inside it only while the
           board is stuck. The BOARD owns the height and the columns stretch inside its content
           box, which already excludes the horizontal scrollbar — nothing is measured per column.
           The negative margin cancels the document space below the board (measured in JS), so
           maximum page scroll is exactly the stuck position. ── */
        .eng-board.is-pane-mode {
            margin-bottom: calc(-1 * var(--board-pane-trailing, 0px));
        }

        .eng-board.is-pane-mode .board {
            height: calc(100dvh - var(--epic-sticky-top, 0px));
            align-items: stretch;
            padding-bottom: 0;
        }

        .eng-board.is-pane-mode .col {
            display: flex;
            flex-direction: column;
            min-height: 0;
        }

        /* The rail's own border and radius, so an open pane and a folded rail read as one set. */
        .eng-board.is-pane-mode .col.is-open,
        .eng-board.is-pane-mode .col.is-focused {
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            padding-top: 0.45rem;
        }

        .eng-board.is-pane-mode .col.is-open .col-head,
        .eng-board.is-pane-mode .col.is-focused .col-head {
            flex: none;
            width: auto;
            margin-inline: 0.45rem;
        }

        /* scrollbar-gutter keeps the card width identical when overflow flips to auto. The 4px top
           and inline padding keep card focus rings clear of the scroller's clip edge. */
        .eng-board.is-pane-mode .col-body {
            flex: 1 1 auto;
            min-height: 0;
            overflow-x: hidden;
            overflow-y: hidden;
            scrollbar-gutter: stable;
            scrollbar-width: thin;
            padding: 4px 0.45rem 0.45rem;
        }

        .eng-board.is-pane-mode.is-pane-stuck .col-body {
            overflow-y: auto;
        }

        .eng-board.is-pane-mode .col:not(.is-open):not(.is-focused) .col-strip {
            flex: 1 1 auto;
            height: auto;
        }
```

- [ ] **Step 6: Register the new JS-written property**

In `tests/test_eng_board_styles.js`, add to `JS_WRITTEN_CUSTOM_PROPERTIES`:

```js
    '--board-pane-trailing': 'frontend/src/eng/EngBoardView.jsx',
```

Run: `node --test tests/test_eng_board_styles.js`
Expected: PASS.

- [ ] **Step 7: Run the pane tests**

Run: `npm run build && npx playwright test tests/ui/eng_group_board_view.spec.js -g "pane mode" --reporter=line`
Expected: PASS. Open `tmp/eng-group-board-view/board-pane-stuck-1440.png` and `-1280.png` and confirm: bordered panes from the title line to the bottom edge, no card above the pane top, rails full height.

- [ ] **Step 8: Move page-scroll-geometry tests to the fallback viewport**

Run: `npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_drag.spec.js --reporter=line`

For each failure that asserts the old model at a pane-mode viewport — expected: `'folded rails are a 340px track...'`, `'a low folded-rail count stays readable with a short fill'`, `'only a pointer click on a folded rail reveals its first card...'`, `'non-rail Board interactions never reveal the page vertically'`, `'pinned chrome stays interactive and releases each element at the board bottom'`, and the breach test (Task 3 adds its pane counterpart) — change only its viewport to `FALLBACK_VIEWPORT` (scaling only its own scroll offsets if needed) and record the title in Execution Status. A failure that is not an old-model assertion is a regression: fix the code.

- [ ] **Step 9: Commit**

```bash
npm run build
git add frontend/src/eng/EngBoardView.jsx frontend/src/styles/eng/board.css tests/test_eng_board_styles.js tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_drag.spec.js frontend/dist
git commit -m "Make ENG Board columns viewport-tall scroll panes on desktop" -m "The board owns a 100dvh-minus-sticky-line height with columns stretched inside it, so panes end at the viewport bottom without per-column measurement. Column bodies scroll only once the board is stuck, which gives the page-first then column hand-off natively."
git show --stat HEAD && git status --short
```

---

### Task 3: Rail reveal, focus re-stick, scroll position, announcements, breach, drop

**Files:**
- Modify: `frontend/src/eng/EngBoardView.jsx` (rail reveal layout effect, `handleBoardFocus`, `.board` `onFocus`)
- Modify: `frontend/src/styles/eng/board.css` (announcement placement, breach move, reduced motion)
- Test: `tests/ui/eng_group_board_view.spec.js`, `tests/ui/eng_group_board_drag.spec.js`

**Interfaces:**
- Consumes: Task 1–2 names, helpers `paneState`, `wheelOver`, `stickPage`, `settleScroll`, `openSecondColumn`, `longColumnSpecs`.
- Produces: `handleBoardFocus(event)`.

- [ ] **Step 1: Write the failing tests**

In `tests/ui/eng_group_board_view.spec.js`:

```js
test('pane mode: a pointer click on a rail sticks the board with the opened column at its top', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, epicSpecs: longColumnSpecs() });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleScroll(page);
    await col(page, READY_ID).locator('.col-strip').click();
    await settle(page);
    await settleScroll(page);
    const state = await paneState(page);
    expect(state.stuck).toBe(true);
    expect(openScrollTops(state)[READY_ID]).toBe(0);
});

test('pane mode: open columns keep their scroll position; a folded column reopens at its top', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await stickPage(page);
    await wheelOver(page, col(page, READY_ID).locator('.col-body'), 400);
    const scrolled = openScrollTops(await paneState(page))[READY_ID];
    expect(scrolled).toBeGreaterThan(0);

    // A rail has nothing to scroll, so an upward wheel over it moves the page and releases sticky mode.
    await wheelOver(page, col(page, TODO_ID).locator('.col-strip'), -200);
    const released = await paneState(page);
    expect(released.stuck).toBe(false);
    expect(openScrollTops(released)[READY_ID]).toBe(scrolled);

    await wheelOver(page, col(page, TODO_ID).locator('.col-strip'), 400);
    expect((await paneState(page)).stuck).toBe(true);
    expect(openScrollTops(await paneState(page))[READY_ID]).toBe(scrolled);

    await col(page, READY_ID).locator('.fold').click();
    await settle(page);
    await openSecondColumn(page);
    expect(openScrollTops(await paneState(page))[READY_ID]).toBe(0);
});

test('pane mode: focus landing below the fold of a loose column sticks the board', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleScroll(page);
    await page.evaluate((id) => {
        const cards = document.querySelectorAll(`.eng-board .col[data-column-id="${id}"] .ecard .ecard-open`);
        cards[cards.length - 1].focus();
    }, READY_ID);
    await settleScroll(page);
    const state = await paneState(page);
    expect(state.stuck).toBe(true);
    expect(openScrollTops(state)[READY_ID]).toBeGreaterThan(0);
});

test('pane mode: a breached open column carries the unclipped breach ring on its pane', async ({ page }) => {
    await openBoard(page, { width: 1440, height: 900 });
    const read = await page.evaluate((id) => {
        const column = document.querySelector(`.eng-board .col[data-column-id="${id}"]`);
        const body = column.querySelector('.col-body');
        return {
            paneShadow: getComputedStyle(column).boxShadow,
            paneAnimation: getComputedStyle(column).animationName,
            bodyShadow: getComputedStyle(body).boxShadow,
        };
    }, IN_PROGRESS_ID);
    expect(read.paneShadow).not.toBe('none');
    expect(read.paneAnimation).toBe('board-breach-glow');
    expect(read.bodyShadow).toBe('none');
    await page.screenshot({ path: `${screenshotDir}/board-pane-breach.png`, fullPage: false });
});
```

In `tests/ui/eng_group_board_drag.spec.js`, after `'the drop menu is not clipped by the board scroll container...'`:

```js
test('pane mode: a drop while stuck keeps the board stuck and shows the announcement in view', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForFunction(() => document.querySelector('.eng-board')?.classList.contains('is-pane-stuck'));

    // Same one-status move as 'one eligible status transitions straight through...'.
    await dragCard(page, 'PLAT-1', 'col-wrap');
    await expect(liveRegion(page)).toHaveText('PLAT-1 → Release · Doing → Wrap up');
    const state = await page.evaluate(() => {
        const say = document.querySelector('.eng-board .board-say').getBoundingClientRect();
        return {
            stuck: document.querySelector('.eng-board').classList.contains('is-pane-stuck'),
            sayInView: say.top >= 0 && say.bottom <= window.innerHeight,
        };
    });
    expect(state.stuck).toBe(true);
    expect(state.sayInView).toBe(true);
});
```

Run: `npm run build && npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_drag.spec.js -g "pane mode" --reporter=line`
Expected: the five new tests FAIL.

- [ ] **Step 2: Rail reveal in pane mode**

Replace the body of the `pendingVerticalRevealRef` layout effect from `const board = boardRef.current;` to the end of the effect with:

```js
        const board = boardRef.current;
        const column = board && Array.from(board.children).find((child) => child.dataset.columnId === columnId);
        if (!column || !column.classList.contains('is-focused')) return;
        const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

        // Pane mode: the opened column starts at its top and the page goes to the one position
        // where the board is stuck — maximum scroll — rather than to a card.
        if (rootRef.current?.classList.contains('is-pane-mode')) {
            const body = column.querySelector('.col-body');
            if (body) body.scrollTop = 0;
            window.scrollTo({ top: pageMaxScroll(), behavior });
            return;
        }

        const card = column.querySelector('.ecard');
        const header = column.querySelector('.col-head');
        if (!card || !header) return;

        const stickyTop = Math.max(
            0,
            parseFloat(getComputedStyle(board).getPropertyValue('--epic-sticky-top')) || 0,
        );
        const headerRect = header.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const headerMarginBottom = parseFloat(getComputedStyle(header).marginBottom) || 0;
        window.scrollTo({
            top: Math.max(0, window.scrollY + cardRect.top - (stickyTop + headerRect.height + headerMarginBottom)),
            behavior,
        });
```

- [ ] **Step 3: Focus re-stick**

After `handleBoardScroll` add:

```js
    // focus() — Tab, the panel's focus return, a drop menu closing — still scrolls an
    // overflow-hidden column body, leaving it offset with no scrollbar while the board is loose.
    // Taking the page to the stuck position makes that body scrollable again. The check runs a
    // frame later because focus() scrolls into view after dispatching the focus event. Focus
    // handling only; wheel input is never intercepted.
    const handleBoardFocus = React.useCallback((event) => {
        const body = event.target.closest?.('.col-body');
        if (!body) return;
        window.requestAnimationFrame(() => {
            const root = rootRef.current;
            if (!root?.classList.contains('is-pane-mode') || root.classList.contains('is-pane-stuck')) return;
            if (body.scrollTop > 0) window.scrollTo({ top: pageMaxScroll(), behavior: 'instant' });
        });
    }, []);
```

Add `onFocus={handleBoardFocus}` to the `.board` div, next to `onScroll={handleBoardScroll}`.

- [ ] **Step 4: Announcement placement, breach move, reduced motion**

In `board.css`, after the pane rules from Task 2, add:

```css
        /* A drop outcome must neither push the board off the sticky line nor sit hidden under the
           filter bar, so in pane mode it floats at the bottom of the board, which is the viewport
           bottom when stuck. Rail border, radius and surface; no new tokens. */
        .eng-board.is-pane-mode .board-say.has-message {
            position: absolute;
            left: 50%;
            bottom: 0.75rem;
            transform: translateX(-50%);
            z-index: 6;
            margin: 0;
            padding: 0.35rem 0.7rem;
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: 8px;
        }

        .eng-board.is-pane-mode {
            position: relative;
        }

        /* The breach ring moves to the pane: on .col-body it would be clipped by the pane and
           read as a second border nested inside it. Same values as the rail/body rule. */
        .eng-board.is-pane-mode .col.is-breach.is-open,
        .eng-board.is-pane-mode .col.is-breach.is-focused {
            box-shadow: 0 0 0 1px var(--warn), 0 0 12px rgba(207, 19, 34, 0.34);
            animation: board-breach-glow 2.2s ease-in-out infinite;
        }

        .eng-board.is-pane-mode .col.is-breach .col-body {
            border-radius: 0;
            box-shadow: none;
            animation: none;
        }
```

In the existing `@media (prefers-reduced-motion: reduce)` block that stops the breach animation, add:

```css
            .eng-board.is-pane-mode .col.is-breach.is-open,
            .eng-board.is-pane-mode .col.is-breach.is-focused { animation: none; }
```

- [ ] **Step 5: Run and commit**

Run: `npm run build && npx playwright test tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_drag.spec.js --reporter=line`
Expected: all new tests PASS; totals match baseline plus new tests. Inspect `tmp/eng-group-board-view/board-pane-breach.png`.

```bash
git add frontend/src/eng/EngBoardView.jsx frontend/src/styles/eng/board.css tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_drag.spec.js frontend/dist
git commit -m "Adapt Board rail reveal, focus, breach and drops to pane mode" -m "A rail click now lands the board stuck with the column at its top, focus in a loose column re-sticks the board so its body is scrollable, the breach ring moves to the pane so it is not clipped, and drop announcements float in view instead of shifting the board."
git show --stat HEAD && git status --short
```

---

### Task 4: Leak class — popover dismissal, overlay layering, sticky stacks

**Files:**
- Modify: `frontend/src/issues/useIssueFieldPopover.js`
- Test: `tests/ui/eng_group_board_card.spec.js`, `tests/ui/eng_group_board_view.spec.js`

**Interfaces:**
- Consumes: Task 2 helpers in the view spec.
- Produces: module functions `clippingAncestors(node)`, `isOutsideRect(rect, clipRect)` in `useIssueFieldPopover.js`.

- [ ] **Step 1: Write the failing tests**

In `tests/ui/eng_group_board_card.spec.js`, after `'Board person controls neither open nor drag the card wrapper'`:

```js
test('a Board person editor closes when its card scrolls out of the pane', async ({ page }) => {
    await openBoard(page);
    await page.setViewportSize({ width: 1440, height: 520 });
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForFunction(() => document.querySelector('.eng-board')?.classList.contains('is-pane-stuck'));
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    await card.getByRole('combobox', { name: 'Assignee: Alice Adams' }).click();
    await expect(page.locator('.issue-person-editor-menu')).toBeVisible();
    await card.evaluate((node) => { node.closest('.col-body').scrollTop = 10000; });
    await expect(page.locator('.issue-person-editor-menu')).toHaveCount(0);
});
```

If the card spec's `openBoard` fixture has too few epics in `col-1a2b3c4d` for its body to overflow at 520px, extend only that test's fixture through the spec's existing epic-spec option; record the change in Execution Status.

In `tests/ui/eng_group_board_view.spec.js`:

```js
test('pane mode leak class: nothing from a column paints over the filter bar, the top bar or outside its pane', async ({ page }) => {
    // The reported state: wide desktop, starred In progress open beside the focused column, stuck
    // and partially scrolled.
    await openBoard(page, { width: 2000, height: 1060, reducedMotion: true, epicSpecs: longColumnSpecs() });
    await openSecondColumn(page);
    await stickPage(page);
    await wheelOver(page, col(page, IN_PROGRESS_ID).locator('.col-body'), 500);
    await page.screenshot({ path: `${screenshotDir}/board-pane-leak-class.png`, fullPage: false });

    const leaks = await page.evaluate(() => {
        const found = [];
        const probe = (x, y, label) => {
            const hit = document.elementFromPoint(x, y);
            if (hit?.closest('.ecard')) found.push(label);
        };
        const filterBar = document.querySelector('.filterbar-wrap').getBoundingClientRect();
        for (let x = 20; x < window.innerWidth; x += 40) {
            probe(x, filterBar.top + filterBar.height / 2, `filter bar @${x}`);
            probe(x, 2, `top edge @${x}`);
        }
        document.querySelectorAll('.eng-board .col.is-open, .eng-board .col.is-focused').forEach((column) => {
            const rect = column.getBoundingClientRect();
            probe(rect.left + rect.width / 2, rect.top - 2, `${column.dataset.columnId} above`);
            probe(rect.left - 2, rect.top + rect.height / 2, `${column.dataset.columnId} left`);
            probe(rect.right + 2, rect.top + rect.height / 2, `${column.dataset.columnId} right`);
            column.querySelectorAll('.ecard').forEach((card) => {
                const cardRect = card.getBoundingClientRect();
                const body = column.querySelector('.col-body').getBoundingClientRect();
                const visibleTop = Math.max(cardRect.top, body.top);
                const visibleBottom = Math.min(cardRect.bottom, body.bottom);
                if (visibleBottom > visibleTop && (cardRect.left < rect.left || cardRect.right > rect.right)) {
                    found.push(`${card.dataset.epicKey} overflows its pane horizontally`);
                }
            });
        });
        return found;
    });
    expect(leaks).toEqual([]);

    // Overlays still paint above the panes, each opened with a normal click.
    await page.getByRole('button', { name: 'Filters' }).click();
    const popoverOption = page.locator('.popover .pop-opt').first();
    await expect(popoverOption).toBeVisible();
    await popoverOption.click();
    await page.keyboard.press('Escape');
    await col(page, IN_PROGRESS_ID).locator('.ecard .ecard-open').first().click();
    await expect(page.locator('.epic-panel')).toBeVisible();
    const panelOnTop = await page.evaluate(() => {
        const rect = document.querySelector('.epic-panel').getBoundingClientRect();
        return Boolean(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20)?.closest('.epic-panel'));
    });
    expect(panelOnTop).toBe(true);
});
```

Also move `'the compact sticky header paints over the board...'` coverage check: confirm the Board help popover test (`'open Board help recalculates its width and viewport gutters after resize'`) still passes in pane mode at its viewport; if it is a pane-mode viewport and passes, add no test.

Run: `npm run build && npx playwright test tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_view.spec.js -g "scrolls out of the pane|leak class" --reporter=line`
Expected: the person-editor test FAILS (menu follows the trigger). The leak-class test may already pass; it is the regression guard for the reported bug.

- [ ] **Step 2: Dismiss a popover whose trigger is clipped out of view**

In `frontend/src/issues/useIssueFieldPopover.js`, after the two constants add:

```js
// Every ancestor that clips its overflow. A trigger scrolled fully outside any of them is no longer
// on screen, so its panel is dismissed instead of floating over whatever is there now.
function clippingAncestors(node) {
    const ancestors = [];
    for (let element = node.parentElement; element && element !== document.body; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') ancestors.push(element);
    }
    return ancestors;
}

function isOutsideRect(rect, clipRect) {
    return rect.bottom <= clipRect.top || rect.top >= clipRect.bottom
        || rect.right <= clipRect.left || rect.left >= clipRect.right;
}
```

In the positioning layout effect, after `if (!panel || !trigger) return undefined;` add `const clippers = clippingAncestors(trigger);`, and make the first lines of `positionPanel`:

```js
            const triggerRect = trigger.getBoundingClientRect();
            if (clippers.some((clipper) => isOutsideRect(triggerRect, clipper.getBoundingClientRect()))) {
                onDismissRef.current?.();
                return;
            }
```

(removing the now-duplicate `const triggerRect = trigger.getBoundingClientRect();` line that follows).

- [ ] **Step 3: Run the popover consumers and the sticky stacks**

Run:
```bash
npm run build
npx playwright test tests/ui/eng_group_board_card.spec.js tests/ui/eng_issue_field_edits.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_filters.spec.js --reporter=line
npx playwright test tests/ui --grep "sticky" --reporter=line
```
Expected: new tests PASS; every other result matches the Task 0 baseline. The sticky run covers Catch Up, Planning and Scenario stacks through `collectStickySnapshots`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/issues/useIssueFieldPopover.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_view.spec.js frontend/dist
git commit -m "Close field popovers whose trigger scrolls out of view" -m "With Board columns scrolling inside panes, a person editor could follow its trigger out of the pane and paint over the title row or filter bar. Adds a leak-class regression test for the reported screenshot state."
git show --stat HEAD && git status --short
```

---

### Task 5: Documentation, visual proof, full verification

**Files:**
- Modify: `docs/features/eng-workflows.md` (Board section)
- Modify: `docs/ontology.md` (ENG Board entry and coverage line)
- Modify: `docs/README_ANALYTICS.md` ("ENG Group Board sticky column chrome" row)
- Modify: `docs/agents/features/2026-08-08-executed-sticky-board-column-chrome.md`, `docs/agents/features/2026-08-08-executed-unfolded-board-column-scroll.md`, `docs/plans/EXEC-sticky-board-column-chrome.md` (Current Accuracy)
- Modify: `docs/plans/README.md` (index entry for this plan)
- Rename: `docs/agents/features/2026-09-24-executed-board-column-scroll-panes.md` → `2026-09-24-executed-board-column-scroll-panes.md` with `Status: executed`, `## Outcome`, `## Current Accuracy`; update links to it
- Modify: this plan's Execution Status

- [ ] **Step 1: Before/after screenshots**

"Before": `tmp/eng-group-board-view/before/` from Task 0 Step 3. "After": `board-pane-stuck-1440.png`, `board-pane-stuck-1280.png`, `board-pane-leak-class.png`, `board-pane-breach.png`, plus `board-1440.png` and `board-800.png` rewritten by the full run. The fallback-viewport shot is `board-pinned-800.png` (existing pinned-chrome model, unchanged below the gate); the short-list board (default fixture) showing full-height panes is `board-pane-breach.png`. No additional screenshot tests were added beyond those already written in Tasks 2-4. Wait for animations to settle (`reducedMotion: true`). Inspect each pair against spec acceptance criteria 2, 6, 7, 13, 14 and record the visible differences in Execution Status.

- [ ] **Step 2: Update docs**

- `docs/features/eng-workflows.md` Board section: one paragraph — desktop pane mode (gate), page-first sticky hand-off, per-column scroll with preserved position, rails full height, compact header hidden in Board pane mode, fallback keeps pinned chrome.
- `docs/ontology.md`: add to the ENG Board entry "pane mode layout: `EngBoardView` `syncPaneMode`/`syncBoardChrome`, `board.css` pane rules; tests `tests/ui/eng_group_board_view.spec.js` (pane mode)"; add "ENG Board pane mode (2026-09-25)" to the coverage line.
- `docs/README_ANALYTICS.md` row: rename to "ENG Group Board column panes and sticky chrome" and state passive layout; no scroll position or column scroll is collected.
- Superseded artifacts: add `Current Accuracy: applies only below the Board pane-mode gate (narrow, short, or touch viewports); desktop behavior is superseded by 2026-09-24-executed-board-column-scroll-panes.md.`
- `docs/plans/README.md`: add this plan under active `EXEC-*` entries.

- [ ] **Step 3: Full verification at the exact head**

Run:
```bash
npm ci && npm run build
git status --short
npx playwright test tests/ui --reporter=line
node --test tests/test_*.js
.venv/bin/python -m unittest discover -s tests
```
Expected: `git status --short` shows no dist diff after the build (CI `verify-frontend-build.yml` contract); Playwright, Node and Python totals equal the Task 0 baseline plus new tests, with any pre-existing failures unchanged and listed. Manually check the stuck hand-off in Firefox and Safari against the running app and record the result.

- [ ] **Step 4: Commit**

```bash
git add docs frontend/dist
git commit -m "Document ENG Board column scroll panes and mark superseded designs" -m "Records pane mode, the sticky hand-off and fallback in feature docs and the ontology, rewords the analytics allowlist row, limits the August sticky-chrome artifacts to fallback viewports, and marks the design spec executed."
git show --stat HEAD && git status --short
```

---

## Execution Status

| Task | Status | Commit | Notes |
| --- | --- | --- | --- |
| 0 Baseline | complete | base `07f609f2` | 253 passed / 2 pre-existing failures across the five affected specs; node style 10/10; budgets OK. |
| 1 Gate + compact header | complete | `07f609f2..6b83315e` | Gate, `onPaneModeChange`, `compactStickyVisible` derivation. Deviation: a `window` `resize` listener also calls `syncPaneMode` (the `documentElement` `ResizeObserver` stops firing once the page is taller than the viewport). |
| 2 Pane geometry | complete | `6b83315e..f0216383` | Board/pane height, mask, rails, `is-pane-stuck`. Deviation: `wheelOver` test helper clamps `x` to the part of the target box inside the viewport. |
| 3 Interactions | complete | `f0216383..e58cf7ad` (`8586ee13`, `e58cf7ad`) | Rail reveal, focus re-stick, scroll-position keep/reset, breach move, drop announcement placement. Approved deviation: open-column `scrollTop` resets to 0 on reopen from any input (pointer or keyboard), because `.col-body` stays mounted through fold/reopen. |
| 4 Leak class | complete | `e58cf7ad..0d49843e` (`72d625ba`, `0d49843e`) | Popover dismissal on clipped trigger; leak-class regression test. Follow-up commit exempts onboarding preview popovers from the clipped-trigger dismissal. |
| 5 Docs + verification | complete | `0d49843e..HEAD` | Docs in `72a45032`. Full verification before merging main: Playwright `tests/ui` 904 passed / 18 failed / 2 skipped — 17 failures reproduce on the pre-change base `e72584ac` (see below) and one (`eng_group_board_panel` "the panel caps at 92vh") was an old-model premise, moved to a width-gated fallback; Node 1467/1467; Python 1937 OK (skipped 25) with the worktree env overrides. |
| Merge origin/main | complete | `e7561597` | Merged `origin/main` into the branch. Post-merge Board UI specs (view, filters, card, drag, panel, settings_tab, group_board_composer, eng_board_progressive_loading): 346 passed / 5 failed — 4 pre-existing (`eng_group_board_settings_tab` :371 and both :795 cases, `group_board_composer` :1047) and "a configured board offers no first-run state, and names its leftovers Unmapped", which fails identically on `origin/main` (stale after main's #202, not this branch). Node 1467/1467 under Node 20; Python 1938 OK (skipped 25) post-merge (1937 pre-merge; main added one). |
| Final review fix | complete | this commit | Approved deviation: the board's focus re-stick skips pointer-initiated focus (a `pointerdown` flag on `.board`, cleared a frame after `pointerup`/`pointercancel`), because a card button takes focus on mousedown and moving the page before mouseup dropped the click. Keyboard and programmatic focus still re-stick. New test "pane mode: a pointer click on a card in a loose, scrolled column opens it". |
| Revision (fixed-height page) | complete | `4c02c380..HEAD` (`0f424909`, `1f4ddd8e`, docs in this commit) | Implements the spec's "Revision 2026-09-25: Fixed-Height Page" (decisions 9-12, R1-R6). `0f424909`: `board_action` contract (`reason` allowlisted as `short`\|`narrow`\|`touch`, mapped through the GTM `userevent` tag like `field_name`, unregistered). `1f4ddd8e`: `--board-pane-top` geometry, always-scrollable `.col-body`, 340px rails (`flex: none`), removal of `is-pane-stuck`/focus re-stick/pointer guard/pane rail reveal/compact-header wiring and the dashboard +1 budget, small-screen alert with reason state; pane tests rewritten to R1-R6. The panel "caps at 92vh" test is back at its original viewport, and the group-switch scroll-to-top workaround and drag-test page stick are removed (stuck-model only). Verification: `eng_group_board_view` 178, `eng_group_board_filters` 17, `eng_group_board_card` 31, `eng_group_board_drag` 29, `eng_group_board_panel` 24, `eng_board_progressive_loading` 11, `codebase_structure_smoke` 21, `onboarding_tour` 100 passed; Node 1470/1470 under Node 20; Python 1938 OK (skipped 25) with the worktree env overrides. |
| Follow-up fixes (user-requested, all on this branch) | complete | `1f5feb13`, `f296d0ba`, `064dcc44`, `17bd2069`, `7a8adee9`, `c5187a36`, `8c4fbb0c`, `fe7a4f53`, `8a2166a6` | The user asked to fix every failing test here. Stale tests after main's #176/#192/#196/#202 updated (`1f5feb13`, `17bd2069`). Real bugs fixed with RED-first tests: Lead Times cohort grid hook order (`f296d0ba`); capacity focus loss and Planning unmount on auth lock (`064dcc44`); first capacity save dropping the legacy workspace config, which made `/api/sprints` return 409 `sprint_board_required` (`7a8adee9`); Board panel description DOM rebuilt on every Board render, a race this branch's resize re-renders exposed (`c5187a36`); outage wiped after a recovery reload (`8c4fbb0c`); mid-body Sprint read abort treated as an empty catalog (`fe7a4f53`, tightened to the dashboard line budget in `8a2166a6`). Final verification: Playwright `tests/ui` 926 passed / 0 failed / 2 skipped at `fe7a4f53` (the `8a2166a6` delta is the same logic on one line; its test passed 16/16 with 8 workers); Node 1471/1471 and Python OK (skipped 25) at `8a2166a6`; Node 20 build leaves `frontend/dist` clean. |

Moved-to-fallback tests (assertions unchanged; each now runs at a viewport that fails the pane-mode gate):

- `eng_group_board_view.spec.js`: "selector compact surface: remount closes stale panel..." (800x420 → `FALLBACK_VIEWPORT`); "the compact sticky header paints over the board, including the off-frame hint" (800x420 → `FALLBACK_VIEWPORT`); "open headers and every collapsed rail pin below the live sticky stack..." (800x620 → `FALLBACK_VIEWPORT`); "pinned chrome stays interactive and releases each element at the board bottom" (800x620 → `FALLBACK_VIEWPORT`); "every custom property board.css reads resolves on the live board" (800x620 → `FALLBACK_VIEWPORT`); "folded rails are a 340px track with the bar hanging from the top, scaled to the largest column" (default 1280x900 → `FALLBACK_VIEWPORT`); "only a pointer click on a folded rail reveals its first card below the live sticky header" (800x620 → `FALLBACK_VIEWPORT`); "non-rail Board interactions never reveal the page vertically" (800x620 → 760x620, a width-gated fallback rather than `FALLBACK_VIEWPORT`, because at `FALLBACK_VIEWPORT` height the pip is not reachable).
- `eng_group_board_filters.spec.js`: "the Board filter-bar popover paints over the board and takes a plain click" (1280x600 → `FALLBACK_VIEWPORT`).
- Reverted by the fixed-height revision (the stuck model was their only reason): "the panel caps at 92vh and scrolls internally" runs at its original 1280x780 again; the group-switch test's scroll-to-top workaround and the Chromium drag-loop test's page stick are removed.

Pre-existing failures (all fixed later on this branch — see the Follow-up fixes row; they failed identically on the pre-change base `e72584ac`, unrelated to this feature): `codebase_structure_smoke` — "2147 Lead Times capacity exclusions" and "2866 multiple groups main controls one row"; `eng_alert_loading_order` :319 and :342; `eng_compact_layout_visual` :1007, :1184, :1204; `eng_group_board_settings_tab` :371 and both :795 cases; `epm_settings_visual_states` :338 desktop and mobile; `global_auth_lock` :963; `group_board_composer` :1047; `planning_capacity_editing` :691 and :911. `eng_board_measurement_runner` :33 failed once under full-suite load and passed on a serial re-run.
