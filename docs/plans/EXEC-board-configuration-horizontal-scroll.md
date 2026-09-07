# Board Configuration Horizontal Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Ready for execution on `bugfix/board-configuration-horizontal-scroll`. This plan changes only the Board Configuration interaction and its generated frontend output.

**Goal:** Make every Board Configuration column reachable with an ordinary mouse, keyboard-accessible controls, and drag-edge scrolling without breaking the settings pane's vertical scrolling.

**Architecture:** Keep `.board-columns` as the horizontal scroll owner and `.group-pane-right` as the vertical scroll owner. Add local scroll-edge state and handlers to `GroupBoardSettings`: dominant vertical wheel input advances the rail only while that rail can move, visible arrow controls move one measured column at a time, and an animation-frame loop scrolls only while a column or status drag is held inside a narrow edge zone. Reuse the existing settings button grammar and the ENG Board's established off-frame-control principle; do not add persistence, API state, or always-on hover motion.

**Tech Stack:** React 19, CSS, Playwright, Node 20, esbuild

---

## Root cause and confirmed baseline

The current code already declares `overflow-x: auto` on `.board-columns`, but its parent `.group-pane-right` declares `overflow-y: auto`. In a production-sized diagnostic with seven columns:

- the rail measured `653px` client width and `1560px` scroll width;
- the pane measured `300px` client height and `797px` scroll height;
- a vertical mouse-wheel delta of `320px` over the rail left `board.scrollLeft` at `0` and moved `pane.scrollTop` to `320`;
- programmatic `scrollLeft` still works, which is all the existing screenshot test proves.

The defect is therefore input routing and discoverability, not missing horizontal overflow. A native scrollbar alone is not a sufficient contract because its visibility depends on browser and operating-system scrollbar settings.

## Scope and file map

Allowed implementation files:

- Modify `frontend/src/settings/GroupBoardSettings.jsx`: own the rail ref, edge state, wheel routing, explicit scroll actions, drag-edge animation loop, cleanup, and scroll-control markup.
- Modify `frontend/src/styles/settings/group-board.css`: make the two scroll axes explicit, style the compact control group, and keep the native horizontal scrollbar readable when the browser displays it.
- Modify `tests/ui/group_board_composer.spec.js`: prove status and column drags auto-scroll at both rail edges and stop after drag cleanup.
- Modify `tests/ui/eng_group_board_settings_tab.spec.js`: prove the real nested modal routes ordinary wheel input correctly, preserves picker/parent vertical scrolling, exposes keyboard controls, and renders the controls without clipping.
- Modify `docs/README_ANALYTICS.md`: extend the existing Group Board composer no-event allowlist row to cover local scroll/navigation interactions.
- Generate with `npm run build`: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`. Do not hand-edit generated output.

No new file or shared abstraction is needed. The behavior belongs to the only Board Configuration rail and depends on that component's existing drag refs.

## Expected behavior

| State/input | Required result |
| --- | --- |
| Rail does not overflow | Scroll controls are absent and wheel input is untouched. |
| Rail at left edge | Left control is visible but disabled; right control is enabled. |
| Rail between edges | Both controls are enabled. |
| Rail at right edge | Right control is visible but disabled; left control is enabled. |
| Vertical-dominant wheel over rail | Rail scrolls horizontally while movement remains in that direction; the parent pane does not move. |
| Horizontal trackpad/wheel delta | Browser-native horizontal scrolling remains authoritative; no synthetic second movement occurs. |
| Wheel at the rail's directional boundary | The event is not prevented, so `.group-pane-right` resumes vertical scrolling. |
| Wheel inside `.board-pick` | The picker keeps vertical ownership; rail translation never runs for that event. |
| Active status or column drag near a rail edge | The rail scrolls continuously toward that edge until the pointer leaves the edge zone, a boundary is reached, or the drag ends. |
| Mere pointer hover near a rail edge | Nothing scrolls. |
| Arrow control activation | The rail moves approximately one rendered column plus its current CSS gap; reduced-motion preference uses immediate rather than smooth movement. |
| Group switch, resize, add/delete/reset columns | Enabled/disabled control state re-synchronizes with the resulting scroll geometry. |

## Forbidden regressions

- Do not replace the modal's vertical scroll, trap vertical wheel input after the horizontal boundary, or prevent users from reaching **Not in a column**, preview, warnings, or footer actions.
- Do not translate wheel input originating inside the vertically scrollable status picker.
- Do not add auto-scroll on passive hover, pointer position without a drag, timers that survive unmount, or background scrolling after `drop`/`dragend`.
- Do not change column width, picker height, status assignment, column reorder semantics, focus restoration, dirty state, validation, Save behavior, mobile group drawer behavior, API calls, or stored board schema.
- Do not add a dependency, backend route, persistent preference, analytics event, or global/shared scroll handler.
- Do not hand-edit `frontend/dist/`.

## Plan review

- **Endpoint contract:** No endpoint changes. `GET /api/board-config/statuses` and `POST /api/groups-config` keep their current method, authorization, request/response, CSRF, workspace, and error contracts.
- **UI state machine:** Scroll state is local and derived from DOM geometry: `no overflow`, `left edge`, `middle`, or `right edge`. Drag-edge state is `stopped`, `left`, or `right`, and always returns to `stopped` on a neutral dragover, boundary, drop, dragend, or unmount.
- **Ownership/security:** No configuration ownership, credential, Jira/Home/Townsquare, workspace, user, or mutation boundary changes.
- **Runtime:** No request, polling, storage, cache, or initial-load work. At most one `requestAnimationFrame` loop exists during an active edge drag; edge-state updates are equality-guarded.
- **Accessibility:** Overflow exposes two native buttons with stable labels, `disabled` edge states, and `aria-controls` pointing to the rail. Existing Alt+Arrow column reordering, picker keyboard access, and focus restoration remain unchanged.
- **Analytics:** No `userevent`. The fixed interaction triggers are `wheel`, `scroll control activation`, and `active drag near edge`; `event_type`, `event_name`, `feature_name`, and event params are intentionally absent. Scroll position and draft navigation have no independent product outcome, while the existing safe `settings_action` Save event remains the committed outcome.

---

### Task 1: Add failing interaction regressions

**Files:**

- Modify: `tests/ui/eng_group_board_settings_tab.spec.js:484-519`
- Modify: `tests/ui/group_board_composer.spec.js:130-160, 560-613`

- [ ] **Step 1: Verify the execution baseline and file map**

Run:

```bash
git status --short --branch
test -f frontend/src/settings/GroupBoardSettings.jsx
test -f frontend/src/styles/settings/group-board.css
test -f tests/ui/group_board_composer.spec.js
test -f tests/ui/eng_group_board_settings_tab.spec.js
test -f docs/README_ANALYTICS.md
```

Expected: execution is on `bugfix/board-configuration-horizontal-scroll`; all file checks exit `0`; unrelated changes are identified and preserved. Stop if uncertain user edits overlap an allowed file.

- [ ] **Step 2: Confirm the current focused suites are green before changing tests**

Prerequisite: serve the app at `http://127.0.0.1:5050` using the repository's configured runtime. The standalone composer harness can use a narrowly scoped temporary HTTP server when application startup is unavailable; never serve the repository root as a fallback.

Run:

```bash
npx playwright test tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js --reporter=line --workers=1
```

Expected: both existing specs PASS. Record any unrelated baseline failure before editing.

- [ ] **Step 3: Add the real-modal wheel, controls, boundary, and picker regression**

Add this test after `the Boards split uses the real 30/70 panes...` in `tests/ui/eng_group_board_settings_tab.spec.js`:

```js
test('overflowing Board columns expose controls and route wheel input by scroll boundary', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await mockConfigSettings(page);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Manage team groups' }).click();
    const dialog = page.getByRole('dialog').first();
    await openBoardsTab(page, dialog);
    await expect(dialog.locator('.board-column')).toHaveCount(7);

    const rail = dialog.locator('.board-columns');
    const pane = dialog.locator('.group-pane-right');
    const left = dialog.getByRole('button', { name: 'Scroll board columns left' });
    const right = dialog.getByRole('button', { name: 'Scroll board columns right' });
    await expect(left).toBeVisible();
    await expect(left).toBeDisabled();
    await expect(right).toBeEnabled();
    await expect(left).toHaveAttribute('aria-controls', await rail.getAttribute('id'));

    const restingLeft = await rail.evaluate((node) => node.scrollLeft);
    const expectedStep = await rail.evaluate((node) => {
        const column = node.querySelector('.board-column');
        return column.getBoundingClientRect().width + (parseFloat(getComputedStyle(node).columnGap) || 0);
    });
    const railBox = await rail.boundingBox();
    await rail.hover({ position: { x: railBox.width - 3, y: 100 } });
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', restingLeft);

    await right.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => Math.abs(
        (await rail.evaluate((node) => node.scrollLeft)) - expectedStep,
    )).toBeLessThanOrEqual(1);
    await expect(left).toBeEnabled();
    await expect(pane).toHaveJSProperty('scrollTop', 0);

    await rail.evaluate((node) => { node.scrollLeft = 0; });
    await expect(left).toBeDisabled();
    await rail.hover({ position: { x: 180, y: 100 } });
    await page.mouse.wheel(0, 260);
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await expect(pane).toHaveJSProperty('scrollTop', 0);

    await rail.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    await expect(right).toBeDisabled();
    await rail.hover({ position: { x: 180, y: 100 } });
    await page.mouse.wheel(0, 260);
    await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

    await pane.evaluate((node) => { node.scrollTop = 0; });
    await rail.evaluate((node) => { node.scrollLeft = 0; });
    await dialog.locator('.board-column').first().locator('.board-add-status').click();
    const picker = dialog.locator('.board-column').first().locator('.board-pick');
    expect(await picker.evaluate((node) => node.scrollHeight)).toBeGreaterThan(
        await picker.evaluate((node) => node.clientHeight),
    );
    await picker.hover();
    await page.mouse.wheel(0, 120);
    await expect.poll(() => picker.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await expect(rail).toHaveJSProperty('scrollLeft', 0);
    await expect(pane).toHaveJSProperty('scrollTop', 0);

    await picker.locator('xpath=..').locator('.board-add-status').click();
    await dialog.screenshot({
        path: `${screenshotDir}/boards-tab-horizontal-scroll-controls.png`,
        animations: 'disabled',
    });

    await dialog.locator('.group-pane-list .group-list-item', { hasText: 'Southridge' }).click();
    await expect(dialog.locator('.board-columns-scroll-controls')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Reset to default columns' }).click();
    await expect(dialog.locator('.board-columns-scroll-controls')).toBeVisible();
    await dialog.locator('.board-column .remove-btn[title="Delete column"]').first().click();
    await expect(dialog.locator('.board-columns-scroll-controls')).toHaveCount(0);

    await page.setViewportSize({ width: 480, height: 760 });
    await expect(dialog.locator('.board-columns-scroll-controls')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 480 });
    await expect(dialog.locator('.board-columns-scroll-controls')).toHaveCount(0);

    await dialog.getByRole('button', { name: '+ Add column' }).click();
    await expect(dialog.locator('.board-columns-scroll-controls')).toBeVisible();
});
```

Keep the assertion on `.group-pane-right` rather than a harness override: the regression is specifically the production nested-overflow boundary.

- [ ] **Step 4: Add an open-drag helper and both-direction edge regression**

Add this helper beside `dispatchDrag` in `tests/ui/group_board_composer.spec.js`:

```js
async function dispatchOpenDragOver(page, { sourceSelector, targetSelector, clientX }) {
    return page.evaluate(({ sourceSelector: source, targetSelector: target, clientX: x }) => {
        const sourceNode = document.querySelector(source);
        const targetNode = document.querySelector(target);
        const dataTransfer = new DataTransfer();
        const make = (type, atX) => new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: atX,
            clientY: targetNode.getBoundingClientRect().top + 24,
        });
        const start = make('dragstart', sourceNode.getBoundingClientRect().left + 8);
        sourceNode.dispatchEvent(start);
        targetNode.dispatchEvent(make('dragenter', x));
        const over = make('dragover', x);
        targetNode.dispatchEvent(over);
        window.__openBoardDrag = { sourceNode, dataTransfer };
        return { started: !start.defaultPrevented, accepted: over.defaultPrevented };
    }, { sourceSelector, targetSelector, clientX });
}

async function endOpenDrag(page) {
    await page.evaluate(() => {
        const drag = window.__openBoardDrag;
        if (!drag) return;
        drag.sourceNode.dispatchEvent(new DragEvent('dragend', {
            bubbles: true,
            cancelable: true,
            dataTransfer: drag.dataTransfer,
        }));
        delete window.__openBoardDrag;
    });
    await page.mouse.up();
}
```

Then add:

```js
test('status and column drags auto-scroll at the rail edges and stop after dragend', async ({ page }) => {
    await openComposer(page);
    const rail = page.locator('.board-columns');
    const frame = await rail.boundingBox();

    const status = page.locator('.board-column').first().locator('.component-chip').first();
    await pressHandle(page, status.locator('.chip-grip'));
    const statusDrag = await dispatchOpenDragOver(page, {
        sourceSelector: '.board-column:nth-of-type(1) .component-chip',
        targetSelector: '.board-column:nth-of-type(3)',
        clientX: frame.x + frame.width - 3,
    });
    expect(statusDrag).toEqual({ started: true, accepted: true });
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await endOpenDrag(page);
    const stoppedRight = await rail.evaluate((node) => node.scrollLeft);
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', stoppedRight);

    await rail.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    const maxLeft = await rail.evaluate((node) => node.scrollLeft);
    const last = page.locator('.board-column').last();
    await pressHandle(page, last.locator('.board-column-drag'));
    const columnDrag = await dispatchOpenDragOver(page, {
        sourceSelector: '.board-column:nth-of-type(7)',
        targetSelector: '.board-columns',
        clientX: frame.x + 3,
    });
    expect(columnDrag).toEqual({ started: true, accepted: true });
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeLessThan(maxLeft);
    await endOpenDrag(page);
    const stoppedLeft = await rail.evaluate((node) => node.scrollLeft);
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', stoppedLeft);
});
```

If Chromium reports `started`/`accepted` differently, correct the helper's boolean capture only; do not weaken the behavioral `scrollLeft` and post-cleanup assertions.

- [ ] **Step 5: Run the new tests and verify RED for the intended reasons**

Run:

```bash
npx playwright test tests/ui/eng_group_board_settings_tab.spec.js --grep "route wheel input by scroll boundary" --reporter=line --workers=1
npx playwright test tests/ui/group_board_composer.spec.js --grep "auto-scroll at the rail edges" --reporter=line --workers=1
```

Expected: the modal test FAILS because the named controls do not exist and vertical wheel input does not advance `scrollLeft`; the drag test FAILS because `scrollLeft` remains unchanged near the edges. Fixture, server, selector, or syntax failures are not acceptable red states.

---

### Task 2: Implement bounded wheel, controls, and drag-edge scrolling

**Files:**

- Modify: `frontend/src/settings/GroupBoardSettings.jsx:38-79, 92-147, 236-257, 321-451, 797-829`
- Modify: `frontend/src/styles/settings/group-board.css:12-18`
- Generate: `frontend/dist/dashboard.js`
- Generate: `frontend/dist/dashboard.js.map`
- Generate: `frontend/dist/dashboard.css`

- [ ] **Step 1: Add the geometry constants and pure calculations**

Add below `COLOUR_NAMES` in `GroupBoardSettings.jsx`:

```js
const BOARD_SCROLL_EPSILON = 1;
const BOARD_DRAG_EDGE_PX = 44;
const BOARD_DRAG_SCROLL_PX = 12;

function boardScrollState(element) {
    const max = Math.max(0, element.scrollWidth - element.clientWidth);
    return {
        overflowing: max > BOARD_SCROLL_EPSILON,
        canScrollLeft: element.scrollLeft > BOARD_SCROLL_EPSILON,
        canScrollRight: element.scrollLeft < max - BOARD_SCROLL_EPSILON,
    };
}

function boardColumnScrollStep(element) {
    const column = element.querySelector('.board-column, .board-add-column');
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    return column ? column.getBoundingClientRect().width + gap : element.clientWidth * 0.8;
}
```

Keep these private to this file. They contain no product state and introduce no reusable public contract.

- [ ] **Step 2: Add local scroll state, refs, synchronization, and cleanup**

Add with the component's existing state/refs:

```js
    const [columnScroll, setColumnScroll] = React.useState({
        overflowing: false,
        canScrollLeft: false,
        canScrollRight: false,
    });
    const columnsElementRef = React.useRef(null);
    const columnScrollerId = React.useId();
    const dragScrollDirectionRef = React.useRef(0);
    const dragScrollFrameRef = React.useRef(null);

    const syncColumnScroll = React.useCallback(() => {
        const element = columnsElementRef.current;
        if (!element) return;
        const next = boardScrollState(element);
        setColumnScroll((previous) => (
            previous.overflowing === next.overflowing
            && previous.canScrollLeft === next.canScrollLeft
            && previous.canScrollRight === next.canScrollRight
                ? previous
                : next
        ));
    }, []);

    React.useLayoutEffect(() => {
        syncColumnScroll();
    }, [columns.length, syncColumnScroll]);

    React.useEffect(() => {
        const element = columnsElementRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(syncColumnScroll);
        observer.observe(element);
        return () => observer.disconnect();
    }, [syncColumnScroll]);
```

The layout effect covers add/delete/reset/group reseed. The observer covers modal/viewport width changes without a window-global listener.

- [ ] **Step 3: Add boundary-aware wheel and explicit one-column scrolling**

Add before the existing drag systems:

```js
    const onColumnsWheel = (event) => {
        const element = columnsElementRef.current;
        if (!element) return;
        if (event.target instanceof Element && event.target.closest('.board-pick')) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.deltaY === 0) return;

        const max = Math.max(0, element.scrollWidth - element.clientWidth);
        const next = Math.min(max, Math.max(0, element.scrollLeft + event.deltaY));
        if (Math.abs(next - element.scrollLeft) <= BOARD_SCROLL_EPSILON) return;

        event.preventDefault();
        element.scrollLeft = next;
    };

    const scrollColumns = (direction) => {
        const element = columnsElementRef.current;
        if (!element) return;
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        element.scrollBy({
            left: direction * boardColumnScrollStep(element),
            behavior: reduceMotion ? 'auto' : 'smooth',
        });
    };
```

Do not call `preventDefault()` when the rail cannot move in the requested direction. That boundary rule is what gives vertical scrolling back to `.group-pane-right`.

- [ ] **Step 4: Add one animation-frame loop for active drag-edge scrolling**

Add before `resetDragState`, then call `stopColumnDragScroll()` as the first line of `resetDragState`:

```js
    const stopColumnDragScroll = React.useCallback(() => {
        dragScrollDirectionRef.current = 0;
        if (dragScrollFrameRef.current !== null) {
            window.cancelAnimationFrame(dragScrollFrameRef.current);
            dragScrollFrameRef.current = null;
        }
    }, []);

    const runColumnDragScroll = React.useCallback(function tick() {
        const element = columnsElementRef.current;
        const direction = dragScrollDirectionRef.current;
        if (!element || !direction) {
            dragScrollFrameRef.current = null;
            return;
        }
        const before = element.scrollLeft;
        element.scrollLeft += direction * BOARD_DRAG_SCROLL_PX;
        syncColumnScroll();
        if (Math.abs(element.scrollLeft - before) <= BOARD_SCROLL_EPSILON) {
            dragScrollDirectionRef.current = 0;
            dragScrollFrameRef.current = null;
            return;
        }
        dragScrollFrameRef.current = window.requestAnimationFrame(tick);
    }, [syncColumnScroll]);

    const onColumnsDragOverCapture = (event) => {
        const element = columnsElementRef.current;
        if (!element || !dragKindRef.current) return;
        const rect = element.getBoundingClientRect();
        const direction = event.clientX <= rect.left + BOARD_DRAG_EDGE_PX
            ? -1
            : (event.clientX >= rect.right - BOARD_DRAG_EDGE_PX ? 1 : 0);
        const availability = boardScrollState(element);
        const canMove = direction < 0 ? availability.canScrollLeft : availability.canScrollRight;

        if (!direction || !canMove) {
            stopColumnDragScroll();
            return;
        }
        if (dragScrollDirectionRef.current === direction && dragScrollFrameRef.current !== null) return;
        stopColumnDragScroll();
        dragScrollDirectionRef.current = direction;
        dragScrollFrameRef.current = window.requestAnimationFrame(runColumnDragScroll);
    };

    React.useEffect(() => stopColumnDragScroll, [stopColumnDragScroll]);
```

Also stop the loop when a drag leaves the rail:

```js
    const onColumnsDragLeave = (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) stopColumnDragScroll();
    };
```

Keep all existing `resetDragState()` calls. They already cover refused/cancelled dragend and successful status/column drops; adding cleanup there prevents any surviving frame loop.

- [ ] **Step 5: Render labelled controls and wire the rail**

Replace the Reset-only button row and `.board-columns` opening markup with:

```jsx
                <div className="group-modal-button-row board-columns-toolbar">
                    <button
                        type="button"
                        className="secondary compact"
                        disabled={catalog.state !== 'ready' || !catalog.entries.length}
                        title={catalog.state === 'ready' && catalog.entries.length
                            ? 'Replace these columns with the To Do / In Progress / Done default'
                            : catalogUnavailableLine(catalog, 'there is nothing to derive columns from')}
                        onClick={resetToDefaultColumns}
                    >
                        Reset to default columns
                    </button>
                    {columnScroll.overflowing && (
                        <div className="board-columns-scroll-controls" role="group" aria-label="Board column scrolling">
                            <button
                                type="button"
                                className="secondary compact board-columns-scroll-button"
                                aria-label="Scroll board columns left"
                                aria-controls={columnScrollerId}
                                disabled={!columnScroll.canScrollLeft}
                                onClick={() => scrollColumns(-1)}
                            >
                                ←
                            </button>
                            <button
                                type="button"
                                className="secondary compact board-columns-scroll-button"
                                aria-label="Scroll board columns right"
                                aria-controls={columnScrollerId}
                                disabled={!columnScroll.canScrollRight}
                                onClick={() => scrollColumns(1)}
                            >
                                →
                            </button>
                        </div>
                    )}
                </div>
                <div
                    id={columnScrollerId}
                    className="board-columns"
                    ref={columnsElementRef}
                    onScroll={syncColumnScroll}
                    onWheel={onColumnsWheel}
                    onDragEnter={onColumnsDragOver}
                    onDragOverCapture={onColumnsDragOverCapture}
                    onDragOver={onColumnsDragOver}
                    onDragLeave={onColumnsDragLeave}
                    onDrop={onColumnsDrop}
                >
```

Retain the existing reset button logic, mapped columns, `+ Add column`, and drag handlers verbatim around this replacement.

- [ ] **Step 6: Make both scroll axes and the compact controls visually explicit**

Update the opening rules in `frontend/src/styles/settings/group-board.css`:

```css
        .board-columns-toolbar {
            flex-wrap: nowrap;
            justify-content: space-between;
        }

        .board-columns-scroll-controls {
            display: flex;
            flex: none;
            gap: 0.35rem;
            margin-left: auto;
        }

        .group-modal-button-row .board-columns-scroll-button {
            min-width: 34px;
            width: 34px;
            height: 30px;
            padding: 0;
        }

        .board-columns {
            display: flex;
            gap: 0.5rem;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: thin;
            scrollbar-color: var(--text-secondary) var(--bg-secondary);
            padding-bottom: 0.7rem;
            align-items: flex-start;
        }

        .board-columns::-webkit-scrollbar {
            height: 10px;
        }

        .board-columns::-webkit-scrollbar-track {
            background: var(--bg-secondary);
            border-radius: 999px;
        }

        .board-columns::-webkit-scrollbar-thumb {
            background: var(--text-secondary);
            border: 2px solid var(--bg-secondary);
            border-radius: 999px;
        }
```

The buttons are the guaranteed visible fallback when native scrollbars are system-hidden. Do not hide the native scrollbar or create a custom fake thumb.

- [ ] **Step 7: Rebuild generated frontend output**

Run:

```bash
npm run build
```

Expected: exit `0`; source changes regenerate `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`. Investigate any unrelated generated-file change; never edit dist manually.

- [ ] **Step 8: Run the new regressions and verify GREEN**

Run:

```bash
npx playwright test tests/ui/eng_group_board_settings_tab.spec.js --grep "route wheel input by scroll boundary" --reporter=line --workers=1
npx playwright test tests/ui/group_board_composer.spec.js --grep "auto-scroll at the rail edges" --reporter=line --workers=1
```

Expected: both tests PASS. The wheel test proves rail movement, parent boundary release, picker isolation, control states, and no controls without overflow. The drag test proves both drag systems and frame-loop cleanup.

---

### Task 3: Record analytics scope and complete visual/regression verification

**Files:**

- Modify: `docs/README_ANALYTICS.md:133`
- Verify: all files named in this plan

- [ ] **Step 1: Extend the existing no-event allowlist row**

Replace the existing `Group Board composer draft edits` row in `docs/README_ANALYTICS.md` with:

```md
| Group Board composer draft edits and local scroll navigation | `frontend/src/settings/GroupBoardSettings.jsx` | Draft churn, wheel/arrow navigation, drag-edge scrolling, and scroll position are not tracked. They have no independent product outcome; the existing settings save event covers the committed action without sending status names, column names, group names, Jira ids, or scroll geometry. | 2026-09-07 |
```

Do not add or change analytics code, event schemas, GTM triggers, GA4 dimensions, or tests that expect a new event.

- [ ] **Step 2: Run both complete affected UI specs**

Run:

```bash
npx playwright test tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js --reporter=line --workers=1
```

Expected: all tests in both files PASS, including existing assignment, reorder, focus, validation, save, narrow-viewport drawer, and screenshot coverage.

- [ ] **Step 3: Inspect settled visual proof**

Open `test-results/eng-group-board-settings-tab/boards-tab-horizontal-scroll-controls.png` with the available image-viewing tool.

Expected:

- Reset remains on the left and two compact arrow controls are visible on the right;
- controls do not overlap a column, header, or scrollbar;
- the right control is visually available at the initial left edge and the disabled left state is distinguishable;
- the rail and native scrollbar stay inside the 70% composer pane;
- no horizontal overflow appears on the modal or document;
- labels, status pills, `+ Add status`, and the settings footer remain unclipped.

Compare it with the supplied before screenshot. The screenshot is temporary QA evidence under ignored `test-results/`; do not commit it.

- [ ] **Step 4: Run focused build, unit, analytics, and diff verification**

Run:

```bash
npm run build
npm run test:frontend:unit
node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js
git diff --check
```

Expected: every command exits `0`; the second build leaves generated output stable; the analytics contract still accepts no new Group Board scroll event; `git diff --check` is silent.

- [ ] **Step 5: Review scope and forbidden regressions**

Run:

```bash
git status --short
git diff -- frontend/src/settings/GroupBoardSettings.jsx frontend/src/styles/settings/group-board.css tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js docs/README_ANALYTICS.md
git diff --stat -- frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
```

Expected: every implementation change is in the allowed file map and traces to wheel routing, visible controls, drag-edge scrolling, tests, analytics rationale, or required generated output. There is no API, persistence, schema, shared modal, group-selection, Save, or unrelated formatting change.

- [ ] **Step 6: Report completion and stop before Git publication**

Report the exact commands/results, inspected screenshot path, and final changed-file list. Do not commit, push, merge, or open a PR unless the user explicitly authorizes that Git action.

If commit authorization is later given, use one atomic commit:

```bash
git add frontend/src/settings/GroupBoardSettings.jsx frontend/src/styles/settings/group-board.css tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js docs/README_ANALYTICS.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css docs/plans/EXEC-board-configuration-horizontal-scroll.md
git commit -m "Fix Board Configuration horizontal scrolling"
```

Before any later push, run the repository's full Python suite, review `git log --oneline -5`, and wait for explicit user confirmation as required by `AGENTS.md`.

## Acceptance criteria

- A standard vertical-wheel gesture over an overflowing Board Configuration rail changes `scrollLeft` without moving `.group-pane-right` while horizontal travel remains.
- At the rail's directional boundary, the same wheel gesture moves `.group-pane-right` vertically.
- Wheel input inside `.board-pick` scrolls that picker and changes neither rail nor parent position.
- Two labelled native buttons are visible whenever the rail overflows, expose correct disabled states, reference the rail with `aria-controls`, and move approximately one rendered column per activation.
- Both status-chip and column-handle drags continuously scroll near the right/left rail edges and stop on dragend, drop, neutral position, boundary, and unmount.
- Passive edge hover never moves the rail.
- Adding, deleting, resetting, switching, or resizing columns refreshes control availability without persistence or requests.
- No-overflow configurations render no redundant scroll controls.
- The settings pane's vertical reachability, Board Configuration editing, validation, Save, focus, narrow viewport, and generated-build contracts remain green.
- A settled screenshot visibly proves the controls and horizontal rail remain contained in the real settings modal.
- No new analytics event is emitted; the no-event allowlist explicitly covers the interaction.

## Plan self-review

- **Spec coverage:** The approved wheel translation, visible controls, drag-only edge scrolling, modal-boundary release, picker isolation, reduced motion, responsive resynchronization, visual proof, analytics review, build, and regression gates each have an implementation step and an assertion.
- **File-map validity:** Every file listed as `Modify` or `Generate` exists on the planning branch; no speculative file is named.
- **Type/name consistency:** `columnsElementRef`, `columnScroll`, `syncColumnScroll`, `onColumnsWheel`, `scrollColumns`, `onColumnsDragOverCapture`, and `stopColumnDragScroll` use the same names in state, handlers, markup, tests, and cleanup.
- **Scope:** Frontend-only local interaction; no endpoint, schema, persistence, dependency, shared modal, or product-model change.
- **Placeholders:** None.
- **Residual risk:** Native scrollbar appearance remains OS-controlled, which is why explicit native buttons are the guaranteed path. Browser dragover frequency is not trusted; the bounded animation-frame loop supplies continuous movement and its cleanup is directly tested.
