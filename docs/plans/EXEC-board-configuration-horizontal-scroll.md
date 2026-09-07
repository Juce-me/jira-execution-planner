# Board Configuration Horizontal Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** Ready for execution on `bugfix/board-configuration-horizontal-scroll` after three independent feasibility, Playwright, and UX/process reviews. This plan changes only the Board Configuration interaction and its generated frontend output.

**Goal:** Make every Board Configuration column reachable with an ordinary mouse, keyboard-accessible controls, and drag-edge scrolling without breaking the settings pane's vertical scrolling.

**Architecture:** Keep `.board-columns` as the horizontal scroll owner and `.group-pane-right` as the vertical scroll owner. Add local scroll-edge state and handlers to `GroupBoardSettings`: a native non-passive rail listener normalizes and translates dominant vertical wheel input only while that rail can move, shared `IconButton` controls move one measured column at a time, and one cancellable animation-frame loop scrolls only while a column or status drag is held inside a narrow edge zone. Reuse the existing shared control geometry and the ENG Board's established off-frame-control principle; do not add persistence, API state, or always-on hover motion.

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

- Modify `frontend/src/settings/GroupBoardSettings.jsx`: import the shared `IconButton`, own the rail ref, edge state, native non-passive wheel routing, explicit scroll actions, drag-edge animation loop, cleanup, focus transfer, and scroll-control markup.
- Modify `frontend/src/styles/settings/group-board.css`: make the rail's horizontal/hidden axes explicit, arrange the compact control group without overriding shared controls, and keep the native horizontal scrollbar readable when the browser displays it.
- Modify `tests/ui/group_board_composer.spec.js`: prove status and column drags auto-scroll at both rail edges and stop after drag cleanup.
- Modify `tests/ui/eng_group_board_settings_tab.spec.js`: prove the real nested modal routes ordinary wheel input correctly, preserves picker/parent vertical scrolling, exposes keyboard controls, and renders the controls without clipping.
- Modify `docs/README_ANALYTICS.md`: extend the existing Group Board composer no-event allowlist row to cover local scroll/navigation interactions.
- Modify at execution completion `docs/plans/EXEC-board-configuration-horizontal-scroll.md` and `docs/plans/README.md`: record implementation outcome/current accuracy while retaining the `EXEC-*` name until acceptance or merge.
- Generate through the authorized fresh-worktree `npm ci` + `npm run build` procedure: `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`. Do not hand-edit generated output.

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
| Focused control disappears because overflow ends | Focus moves to enabled Reset, or to the programmatically focusable rail while Reset is disabled, rather than falling to `body`. |

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
- **Runtime:** No request, polling, storage, cache, or initial-load work. React 19's delegated `wheel` listener is passive, so the rail installs and removes one native `{ passive: false }` listener. At most one `requestAnimationFrame` loop exists during an active edge drag; edge-state updates are equality-guarded.
- **Accessibility:** Overflow exposes two shared `IconButton` instances with stable labels, `disabled` edge states, and `aria-controls` pointing to the labelled rail. If a focused arrow must unmount because overflow ends, focus transfers to enabled Reset or falls back to the programmatically focusable rail. Existing Alt+Arrow column reordering, picker keyboard access, and focus restoration remain unchanged.
- **Analytics:** No `userevent`. The fixed interaction triggers are `wheel`, `scroll control activation`, and `active drag near edge`; `event_type`, `event_name`, `feature_name`, and event params are intentionally absent. Scroll position and draft navigation have no independent product outcome, while the existing safe `settings_action` Save event remains the committed outcome.
- **Independent validation:** Three read-only subagents traced this plan against React DOM 19.2.4, the two Playwright fixtures, shared controls, analytics guidance, and MRT003/MRT018/MRT020/MRT021. Their blocking passive-wheel finding and their unit, cleanup, hit-testing, responsive geometry, focus, shared-control, and build-publication findings are incorporated below.

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
test -f frontend/src/ui/IconButton.jsx
test -f frontend/src/styles/shared/controls.css
test -f tests/ui/group_board_composer.spec.js
test -f tests/ui/eng_group_board_settings_tab.spec.js
test -f docs/README_ANALYTICS.md
test -f docs/plans/README.md
```

Expected: execution is on `bugfix/board-configuration-horizontal-scroll`; all file checks exit `0`; unrelated changes are identified and preserved. Stop if uncertain user edits overlap an allowed file.

- [ ] **Step 2: Confirm the current focused suites are green before changing tests**

No Flask server is required: the composer spec fulfills its harness document and API route, while the real-modal fixture fulfills the dashboard document, committed `frontend/dist` assets, fonts, and API routes. The real-modal fixture reads generated assets when its module loads, so rerun it only after the required build when source changes.

Run:

```bash
npx playwright test tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js --reporter=line --workers=1
mkdir -p tmp/board-configuration-horizontal-scroll
cp test-results/eng-group-board-settings-tab/boards-tab-reference-configuration.png tmp/board-configuration-horizontal-scroll/boards-tab-before.png
```

Expected: both existing specs PASS and the ignored `tmp/board-configuration-horizontal-scroll/boards-tab-before.png` records the settled pre-change modal. Record any unrelated baseline failure before editing. Do not commit the screenshot.

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
    await expect(left).toHaveClass(/icon-button--md/);
    await expect(right).toHaveClass(/icon-button--md/);
    for (const control of [left, right]) {
        const box = await control.boundingBox();
        expect(Math.round(box.width)).toBe(28);
        expect(Math.round(box.height)).toBe(28);
        expect(await control.evaluate((node) => getComputedStyle(node).marginRight)).toBe('0px');
    }
    const desktopGeometry = await dialog.evaluate((node) => {
        const paneNode = node.querySelector('.group-pane-right');
        const toolbar = node.querySelector('.board-columns-toolbar');
        const railNode = node.querySelector('.board-columns');
        const controls = [...node.querySelectorAll('.board-columns-scroll-controls button')];
        const paneBox = paneNode.getBoundingClientRect();
        const toolbarBox = toolbar.getBoundingClientRect();
        const railRect = railNode.getBoundingClientRect();
        return {
            toolbarInsidePane: toolbarBox.left >= paneBox.left - 1 && toolbarBox.right <= paneBox.right + 1,
            railInsidePane: railRect.left >= paneBox.left - 1 && railRect.right <= paneBox.right + 1,
            controlsInsideToolbar: controls.every((control) => {
                const box = control.getBoundingClientRect();
                return box.left >= toolbarBox.left - 1 && box.right <= toolbarBox.right + 1;
            }),
            controlsSeparated: controls[0].getBoundingClientRect().right <= controls[1].getBoundingClientRect().left,
            dialogFits: node.scrollWidth <= node.clientWidth + 1,
            documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        };
    });
    expect(desktopGeometry).toEqual({
        toolbarInsidePane: true,
        railInsidePane: true,
        controlsInsideToolbar: true,
        controlsSeparated: true,
        dialogFits: true,
        documentFits: true,
    });

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

    await left.click();
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeLessThanOrEqual(1);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await right.click();
    expect(Math.abs((await rail.evaluate((node) => node.scrollLeft)) - expectedStep)).toBeLessThanOrEqual(1);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await rail.evaluate((node) => { node.scrollLeft = 0; });
    await rail.hover({ position: { x: 180, y: 100 } });
    await page.mouse.wheel(120, 0);
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    expect(await rail.evaluate((node) => node.scrollLeft)).toBeLessThanOrEqual(140);
    await expect(pane).toHaveJSProperty('scrollTop', 0);

    const wheelUnits = await rail.evaluate((node) => {
        const dispatch = (deltaY, deltaMode, extra = {}) => {
            node.scrollLeft = 0;
            const event = new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaY,
                deltaMode,
                ...extra,
            });
            const allowed = node.dispatchEvent(event);
            return { cancelled: !allowed, left: node.scrollLeft };
        };
        return {
            line: dispatch(3, WheelEvent.DOM_DELTA_LINE),
            page: dispatch(1, WheelEvent.DOM_DELTA_PAGE),
            zoom: dispatch(120, WheelEvent.DOM_DELTA_PIXEL, { ctrlKey: true }),
            pageExpected: Math.min(node.clientWidth, node.scrollWidth - node.clientWidth),
        };
    });
    expect(wheelUnits.line.cancelled).toBe(true);
    expect(wheelUnits.line.left).toBeGreaterThanOrEqual(40);
    expect(wheelUnits.page.cancelled).toBe(true);
    expect(Math.abs(wheelUnits.page.left - wheelUnits.pageExpected)).toBeLessThanOrEqual(1);
    expect(wheelUnits.zoom).toEqual({ cancelled: false, left: 0 });

    await rail.evaluate((node) => { node.scrollLeft = 0; });
    await expect(left).toBeDisabled();
    await rail.hover({ position: { x: 180, y: 100 } });
    await page.mouse.wheel(0, 260);
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await expect(pane).toHaveJSProperty('scrollTop', 0);

    const beforeReverse = await rail.evaluate((node) => node.scrollLeft);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeLessThan(beforeReverse);
    await expect(pane).toHaveJSProperty('scrollTop', 0);

    await pane.evaluate((node) => { node.scrollTop = 200; });
    await rail.evaluate((node) => { node.scrollLeft = 0; });
    await page.mouse.wheel(0, -120);
    await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeLessThan(200);

    await pane.evaluate((node) => { node.scrollTop = 0; });
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
    await page.waitForTimeout(300);
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

    await page.setViewportSize({ width: 375, height: 760 });
    await expect(dialog.locator('.board-columns-scroll-controls')).toBeVisible();
    const narrowGeometry = await dialog.evaluate((node) => {
        const paneNode = node.querySelector('.group-pane-right');
        const toolbar = node.querySelector('.board-columns-toolbar');
        const controls = [...node.querySelectorAll('.board-columns-scroll-controls button')];
        const paneBox = paneNode.getBoundingClientRect();
        const toolbarBox = toolbar.getBoundingClientRect();
        return {
            toolbarInsidePane: toolbarBox.left >= paneBox.left - 1 && toolbarBox.right <= paneBox.right + 1,
            controlsInsideToolbar: controls.every((control) => {
                const box = control.getBoundingClientRect();
                return box.left >= toolbarBox.left - 1 && box.right <= toolbarBox.right + 1;
            }),
            dialogFits: node.scrollWidth <= node.clientWidth + 1,
            documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        };
    });
    expect(narrowGeometry).toEqual({
        toolbarInsidePane: true,
        controlsInsideToolbar: true,
        dialogFits: true,
        documentFits: true,
    });
    await page.waitForTimeout(300);
    await dialog.screenshot({
        path: `${screenshotDir}/boards-tab-horizontal-scroll-controls-narrow.png`,
        animations: 'disabled',
    });
    await right.focus();
    await page.setViewportSize({ width: 1280, height: 480 });
    await expect(dialog.locator('.board-columns-scroll-controls')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Reset to default columns' })).toBeFocused();

    await pane.evaluate((node) => { node.scrollTop = 0; });
    await rail.hover({ position: { x: 180, y: 100 } });
    await page.mouse.wheel(0, 120);
    await expect(rail).toHaveJSProperty('scrollLeft', 0);
    await expect.poll(() => pane.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

    await dialog.getByRole('button', { name: '+ Add column' }).click();
    await expect(dialog.locator('.board-columns-scroll-controls')).toBeVisible();
});
```

Keep the assertion on `.group-pane-right` rather than a harness override: the regression is specifically the production nested-overflow boundary.

- [ ] **Step 4: Add an open-drag helper and both-direction edge regression**

Add this helper beside `dispatchDrag` in `tests/ui/group_board_composer.spec.js`:

```js
async function startOpenBoardDrag(page, { sourceSelector, handleSelector, edge }) {
    await pressHandle(page, page.locator(handleSelector));
    return page.evaluate(({ sourceSelector: source, edge: requestedEdge }) => {
        const sourceNode = document.querySelector(source);
        const rail = document.querySelector('.board-columns');
        const dataTransfer = new DataTransfer();
        const rect = rail.getBoundingClientRect();
        const point = {
            x: requestedEdge === 'left' ? rect.left + 3 : rect.right - 3,
            y: rect.top + 24,
        };
        const make = (type, at = point, relatedTarget = null) => new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: at.x,
            clientY: at.y,
            relatedTarget,
        });
        const sourceRect = sourceNode.getBoundingClientRect();
        const start = make('dragstart', { x: sourceRect.left + 8, y: sourceRect.top + 8 });
        sourceNode.dispatchEvent(start);
        const targetNode = document.elementFromPoint(point.x, point.y) || rail;
        targetNode.dispatchEvent(make('dragenter'));
        const over = make('dragover');
        targetNode.dispatchEvent(over);
        window.__openBoardDrag = { sourceNode, rail, dataTransfer, point };
        return {
            started: !start.defaultPrevented,
            accepted: over.defaultPrevented,
            targetClass: targetNode.className,
        };
    }, { sourceSelector, edge });
}

async function moveOpenBoardDrag(page, position) {
    return page.evaluate((requestedPosition) => {
        const drag = window.__openBoardDrag;
        const rect = drag.rail.getBoundingClientRect();
        const point = {
            x: requestedPosition === 'left'
                ? rect.left + 3
                : requestedPosition === 'right'
                    ? rect.right - 3
                    : rect.left + (rect.width / 2),
            y: rect.top + 24,
        };
        const target = document.elementFromPoint(point.x, point.y) || drag.rail;
        const event = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: drag.dataTransfer,
            clientX: point.x,
            clientY: point.y,
        });
        target.dispatchEvent(event);
        drag.point = point;
        return { accepted: event.defaultPrevented, targetClass: target.className };
    }, position);
}

async function leaveOpenBoardDrag(page) {
    await page.evaluate(() => {
        const drag = window.__openBoardDrag;
        if (!drag) return;
        const rect = drag.rail.getBoundingClientRect();
        drag.rail.dispatchEvent(new DragEvent('dragleave', {
            bubbles: true,
            cancelable: true,
            dataTransfer: drag.dataTransfer,
            clientX: rect.right + 20,
            clientY: rect.top + 24,
            relatedTarget: document.body,
        }));
    });
}

async function endOpenBoardDrag(page, { drop = false } = {}) {
    await page.evaluate((shouldDrop) => {
        const drag = window.__openBoardDrag;
        if (!drag) return;
        if (shouldDrop) {
            const target = document.elementFromPoint(drag.point.x, drag.point.y) || drag.rail;
            target.dispatchEvent(new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: drag.dataTransfer,
                clientX: drag.point.x,
                clientY: drag.point.y,
            }));
        }
        drag.sourceNode.dispatchEvent(new DragEvent('dragend', {
            bubbles: true,
            cancelable: true,
            dataTransfer: drag.dataTransfer,
        }));
        delete window.__openBoardDrag;
    }, drop);
    await page.mouse.up();
}
```

Then add:

```js
test('status and column drags auto-scroll in both directions and stop after dragend', async ({ page }) => {
    await openComposer(page);
    const rail = page.locator('.board-columns');

    const cases = [
        {
            kind: 'status',
            edge: 'right',
            sourceSelector: '.board-column:first-of-type .component-chip',
            handleSelector: '.board-column:first-of-type .component-chip .chip-grip',
        },
        {
            kind: 'status',
            edge: 'left',
            sourceSelector: '.board-column:last-of-type .component-chip',
            handleSelector: '.board-column:last-of-type .component-chip .chip-grip',
        },
        {
            kind: 'column',
            edge: 'right',
            sourceSelector: '.board-column:first-of-type',
            handleSelector: '.board-column:first-of-type .board-column-drag',
        },
        {
            kind: 'column',
            edge: 'left',
            sourceSelector: '.board-column:last-of-type',
            handleSelector: '.board-column:last-of-type .board-column-drag',
        },
    ];

    for (const scenario of cases) {
        await rail.evaluate((node, edge) => {
            node.scrollLeft = edge === 'right' ? 0 : node.scrollWidth;
        }, scenario.edge);
        const before = await rail.evaluate((node) => node.scrollLeft);
        const drag = await startOpenBoardDrag(page, scenario);
        expect(drag.started, `${scenario.kind} drag should start`).toBe(true);
        expect(drag.accepted, `${scenario.kind} ${scenario.edge} target should accept`).toBe(true);
        if (scenario.edge === 'right') {
            await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(before);
        } else {
            await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeLessThan(before);
        }
        await endOpenBoardDrag(page);
        const stopped = await rail.evaluate((node) => node.scrollLeft);
        await page.waitForTimeout(100);
        await expect(rail).toHaveJSProperty('scrollLeft', stopped);
    }
});

test('drag-edge scrolling stops on neutral, leave, drop, boundary, and unmount', async ({ page }) => {
    await openComposer(page);
    const rail = page.locator('.board-columns');

    const startStatusRight = async () => {
        await rail.evaluate((node) => { node.scrollLeft = 0; });
        const drag = await startOpenBoardDrag(page, {
            edge: 'right',
            sourceSelector: '.board-column:first-of-type .component-chip',
            handleSelector: '.board-column:first-of-type .component-chip .chip-grip',
        });
        expect(drag.started).toBe(true);
        await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    };

    await startStatusRight();
    await moveOpenBoardDrag(page, 'neutral');
    let stopped = await rail.evaluate((node) => node.scrollLeft);
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', stopped);
    await endOpenBoardDrag(page);

    await rail.evaluate((node) => { node.scrollLeft = 18; });
    await startOpenBoardDrag(page, {
        edge: 'left',
        sourceSelector: '.board-column:first-of-type',
        handleSelector: '.board-column:first-of-type .board-column-drag',
    });
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeLessThanOrEqual(1);
    stopped = await rail.evaluate((node) => node.scrollLeft);
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', stopped);
    await endOpenBoardDrag(page);

    await rail.evaluate((node) => { node.scrollLeft = 0; });
    await startOpenBoardDrag(page, {
        edge: 'right',
        sourceSelector: '.board-column:first-of-type',
        handleSelector: '.board-column:first-of-type .board-column-drag',
    });
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await leaveOpenBoardDrag(page);
    stopped = await rail.evaluate((node) => node.scrollLeft);
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', stopped);
    await endOpenBoardDrag(page);

    await startStatusRight();
    await endOpenBoardDrag(page, { drop: true });
    stopped = await rail.evaluate((node) => node.scrollLeft);
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', stopped);

    await rail.evaluate((node) => {
        node.scrollLeft = node.scrollWidth - node.clientWidth - 18;
    });
    await startOpenBoardDrag(page, {
        edge: 'right',
        sourceSelector: '.board-column:last-of-type',
        handleSelector: '.board-column:last-of-type .board-column-drag',
    });
    await expect.poll(async () => rail.evaluate(
        (node) => Math.abs(node.scrollLeft - (node.scrollWidth - node.clientWidth)),
    )).toBeLessThanOrEqual(1);
    stopped = await rail.evaluate((node) => node.scrollLeft);
    await page.waitForTimeout(100);
    await expect(rail).toHaveJSProperty('scrollLeft', stopped);
    await endOpenBoardDrag(page);

    await rail.evaluate((node) => { node.scrollLeft = 0; });
    await startOpenBoardDrag(page, {
        edge: 'right',
        sourceSelector: '.board-column:nth-of-type(2) .component-chip',
        handleSelector: '.board-column:nth-of-type(2) .component-chip .chip-grip',
    });
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    await page.evaluate(() => {
        window.__retiredBoardRail = window.__openBoardDrag.rail;
    });
    await page.evaluate(() => window.__groupBoardHarnessRemount());
    const retiredAtUnmount = await page.evaluate(() => window.__retiredBoardRail.scrollLeft);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.__retiredBoardRail.scrollLeft)).toBe(retiredAtUnmount);
    await page.mouse.up();
    await page.evaluate(() => {
        delete window.__openBoardDrag;
        delete window.__retiredBoardRail;
    });
});
```

Every dragover target is derived from `document.elementFromPoint()` at the supplied coordinate; do not dispatch to a mismatched hard-coded element. If Chromium reports `started`/`accepted` differently, correct the helper's boolean capture only; do not weaken the behavioral `scrollLeft`, boundary, and post-cleanup assertions.

- [ ] **Step 5: Run the new tests and verify RED for the intended reasons**

Run:

```bash
npx playwright test tests/ui/eng_group_board_settings_tab.spec.js --grep "route wheel input by scroll boundary" --reporter=line --workers=1
npx playwright test tests/ui/group_board_composer.spec.js --grep "auto-scroll in both directions|stops on neutral" --reporter=line --workers=1
```

Expected: the modal test FAILS because the named controls do not exist and wheel units/routing are not implemented; the drag tests FAIL because `scrollLeft` remains unchanged near the edges. Fixture, generated-asset, selector, or syntax failures are not acceptable red states.

---

### Task 2: Implement bounded wheel, controls, and drag-edge scrolling

**Files:**

- Modify: `frontend/src/settings/GroupBoardSettings.jsx:38-79, 92-147, 236-257, 321-451, 797-829`
- Modify: `frontend/src/styles/settings/group-board.css:12-18`
- Generate: `frontend/dist/dashboard.js`
- Generate: `frontend/dist/dashboard.js.map`
- Generate: `frontend/dist/dashboard.css`

- [ ] **Step 1: Import the shared control and add geometry/wheel calculations**

Import `IconButton` beside `StatusPill`, then add below `COLOUR_NAMES` in `GroupBoardSettings.jsx`:

```js
import IconButton from '../ui/IconButton.jsx';

const BOARD_SCROLL_EPSILON = 1;
const BOARD_DRAG_EDGE_PX = 44;
const BOARD_DRAG_SCROLL_PX = 12;
const BOARD_WHEEL_LINE_PX = 16;

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

function boardWheelPixelDelta(event, element) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * BOARD_WHEEL_LINE_PX;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * element.clientWidth;
    return event.deltaY;
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
    const resetColumnsButtonRef = React.useRef(null);
    const columnScrollControlsRef = React.useRef(null);
    const columnScrollStateRef = React.useRef({
        overflowing: false,
        canScrollLeft: false,
        canScrollRight: false,
    });
    const columnScrollerId = React.useId();
    const dragScrollDirectionRef = React.useRef(0);
    const dragScrollFrameRef = React.useRef(null);

    const syncColumnScroll = React.useCallback(() => {
        const element = columnsElementRef.current;
        if (!element) return;
        const next = boardScrollState(element);
        const previous = columnScrollStateRef.current;
        if (
            previous.overflowing
            && !next.overflowing
            && columnScrollControlsRef.current?.contains(document.activeElement)
        ) {
            pendingFocusRef.current = () => {
                if (resetColumnsButtonRef.current && !resetColumnsButtonRef.current.disabled) {
                    resetColumnsButtonRef.current.focus();
                } else {
                    columnsElementRef.current?.focus();
                }
            };
        }
        columnScrollStateRef.current = next;
        setColumnScroll((current) => (
            current.overflowing === next.overflowing
            && current.canScrollLeft === next.canScrollLeft
            && current.canScrollRight === next.canScrollRight
                ? current
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

The layout effect covers add/delete/reset. A group switch remounts this component through `key={activeGroupDraft.id}` in `GroupBoardsTab`, so scroll and control state reset without an extra group listener. The observer covers modal/viewport width changes without a window-global listener. The existing pending-focus effect executes the Reset focus transfer after a resize or layout change removes focused controls.

- [ ] **Step 3: Add boundary-aware wheel and explicit one-column scrolling**

Add before the existing drag systems:

```js
    const onColumnsWheel = React.useCallback((event) => {
        const element = columnsElementRef.current;
        if (!element) return;
        if (event.ctrlKey) return;
        if (event.target instanceof Element && event.target.closest('.board-pick')) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.deltaY === 0) return;

        const pixelDelta = boardWheelPixelDelta(event, element);
        const max = Math.max(0, element.scrollWidth - element.clientWidth);
        const next = Math.min(max, Math.max(0, element.scrollLeft + pixelDelta));
        if (Math.abs(next - element.scrollLeft) <= BOARD_SCROLL_EPSILON) return;

        event.preventDefault();
        element.scrollLeft = next;
    }, []);

    React.useEffect(() => {
        const element = columnsElementRef.current;
        if (!element) return undefined;
        element.addEventListener('wheel', onColumnsWheel, { passive: false });
        return () => element.removeEventListener('wheel', onColumnsWheel);
    }, [onColumnsWheel]);

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

Do not replace the native listener with JSX `onWheel`: React DOM 19.2.4 registers delegated wheel listeners as passive, so `preventDefault()` cannot enforce the nested-scroll boundary there. Do not call `preventDefault()` when the rail cannot move in the requested direction. That boundary rule gives vertical scrolling back to `.group-pane-right`. Preserve browser-native horizontal-dominant gestures and `ctrlKey` zoom gestures.

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
                        ref={resetColumnsButtonRef}
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
                        <div
                            ref={columnScrollControlsRef}
                            className="board-columns-scroll-controls"
                            role="group"
                            aria-label="Board column scrolling"
                        >
                            <IconButton
                                variant="secondary"
                                size="md"
                                aria-label="Scroll board columns left"
                                aria-controls={columnScrollerId}
                                disabled={!columnScroll.canScrollLeft}
                                onClick={() => scrollColumns(-1)}
                            >
                                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                                    <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </IconButton>
                            <IconButton
                                variant="secondary"
                                size="md"
                                aria-label="Scroll board columns right"
                                aria-controls={columnScrollerId}
                                disabled={!columnScroll.canScrollRight}
                                onClick={() => scrollColumns(1)}
                            >
                                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
                                    <path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </IconButton>
                        </div>
                    )}
                </div>
                <div
                    id={columnScrollerId}
                    className="board-columns"
                    aria-label="Board columns"
                    tabIndex={-1}
                    ref={columnsElementRef}
                    onScroll={syncColumnScroll}
                    onDragEnter={onColumnsDragOver}
                    onDragOverCapture={onColumnsDragOverCapture}
                    onDragOver={onColumnsDragOver}
                    onDragLeave={onColumnsDragLeave}
                    onDrop={onColumnsDrop}
                >
```

Retain the existing reset button logic, mapped columns, `+ Add column`, and drag handlers verbatim around this replacement. The arrow instances must keep `IconButton`'s documented `icon-button--md` geometry; do not add `compact` or local width/height overrides.

- [ ] **Step 6: Make the rail axis and compact control layout explicit**

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

The shared icon buttons are the guaranteed visible fallback when native scrollbars are system-hidden. The toolbar may arrange them, but must not override `IconButton` display, flex, margin, padding, width, or height. Do not hide the native scrollbar or create a custom fake thumb.

- [ ] **Step 7: Rebuild generated frontend output from an isolated dependency tree**

Repository rules require `npm ci` in a fresh Git worktree before `npm run build`, while also forbidding a secondary worktree without explicit user authorization. Obtain that authorization before this step. Keep all implementation edits in the active checkout; use the temporary worktree only to install dependencies and generate output. After authorization, run:

```bash
board_scroll_build_dir="$(mktemp -d /tmp/jep-board-scroll-build.XXXXXX)"
git worktree add --detach "$board_scroll_build_dir" HEAD
cp frontend/src/settings/GroupBoardSettings.jsx "$board_scroll_build_dir/frontend/src/settings/GroupBoardSettings.jsx"
cp frontend/src/styles/settings/group-board.css "$board_scroll_build_dir/frontend/src/styles/settings/group-board.css"
npm --prefix "$board_scroll_build_dir" ci
npm --prefix "$board_scroll_build_dir" run build
cp "$board_scroll_build_dir/frontend/dist/dashboard.js" frontend/dist/dashboard.js
cp "$board_scroll_build_dir/frontend/dist/dashboard.js.map" frontend/dist/dashboard.js.map
cp "$board_scroll_build_dir/frontend/dist/dashboard.css" frontend/dist/dashboard.css
git -C "$board_scroll_build_dir" status --short
git -C "$board_scroll_build_dir" restore -- frontend/src/settings/GroupBoardSettings.jsx frontend/src/styles/settings/group-board.css frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
git worktree remove "$board_scroll_build_dir"
```

Expected: `npm ci` and the build exit `0`; before restore, the temporary worktree reports only the two copied sources and the three expected generated files; the active checkout receives exactly `frontend/dist/dashboard.js`, `frontend/dist/dashboard.js.map`, and `frontend/dist/dashboard.css`; the temporary worktree is removed cleanly. Investigate any other generated-file change; never edit dist manually or execute feature work in the temporary checkout.

- [ ] **Step 8: Run the new regressions and verify GREEN**

Run:

```bash
npx playwright test tests/ui/eng_group_board_settings_tab.spec.js --grep "route wheel input by scroll boundary" --reporter=line --workers=1
npx playwright test tests/ui/group_board_composer.spec.js --grep "auto-scroll in both directions|stops on neutral" --reporter=line --workers=1
```

Expected: all three tests PASS. The wheel test proves normalized input, both directional boundary releases, native horizontal movement, parent/non-overflow pass-through, picker isolation, shared control geometry, focus transfer, and desktop/narrow containment. The drag tests prove both drag systems at both edges plus neutral, leave, drop, dragend, boundary, and unmount cleanup.

---

### Task 3: Record analytics scope and complete visual/regression verification

**Files:**

- Modify: `docs/README_ANALYTICS.md:133`
- Modify at completion: `docs/plans/EXEC-board-configuration-horizontal-scroll.md`
- Modify at completion: `docs/plans/README.md`
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

- [ ] **Step 3: Inspect settled desktop and narrow visual proof**

Open all three with the available image-viewing tool:

- `tmp/board-configuration-horizontal-scroll/boards-tab-before.png`
- `test-results/eng-group-board-settings-tab/boards-tab-horizontal-scroll-controls.png`
- `test-results/eng-group-board-settings-tab/boards-tab-horizontal-scroll-controls-narrow.png`

Expected:

- Reset remains on the left and two compact arrow controls are visible on the right;
- controls do not overlap a column, header, or scrollbar;
- the right control is visually available at the initial left edge and the disabled left state is distinguishable;
- the rail and native scrollbar stay inside the 70% composer pane;
- the 375px control row remains inside the composer pane without wrapping or crowding;
- no horizontal overflow appears on the modal or document at either tested viewport;
- labels, status pills, `+ Add status`, and the settings footer remain unclipped.

Compare both after screenshots with the generated pre-change fixture screenshot and the supplied report image. The tests must already assert shared 28px control geometry, zero margins, toolbar/rail containment, control separation, and modal/document scroll widths; visual inspection remains required because geometry alone cannot detect every rendering defect. All screenshots are temporary ignored QA evidence; do not commit them.

- [ ] **Step 4: Run focused unit, analytics, and diff verification**

Run:

```bash
npm run test:frontend:unit
node --test tests/test_analytics_events.js tests/test_analytics_source_guards.js
git diff --check
```

Expected: every command exits `0`; the analytics contract still accepts no new Group Board scroll event; `git diff --check` is silent. Generated-output reproducibility is checked from a fresh dependency tree after an authorized commit in Step 7, not by rebuilding from an ancestor-resolved `node_modules` directory in the active checkout.

- [ ] **Step 5: Review scope and forbidden regressions**

Run:

```bash
git status --short
git diff -- frontend/src/settings/GroupBoardSettings.jsx frontend/src/styles/settings/group-board.css tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js docs/README_ANALYTICS.md docs/plans/EXEC-board-configuration-horizontal-scroll.md docs/plans/README.md
git diff --stat -- frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css
```

Expected: every implementation change is in the allowed file map and traces to wheel routing, visible controls, drag-edge scrolling, tests, analytics rationale, or required generated output. There is no API, persistence, schema, shared modal, group-selection, Save, or unrelated formatting change.

- [ ] **Step 6: Record implementation status and current accuracy**

Keep the `EXEC-*` filename until acceptance or merge. Change the top status note and the `docs/plans/README.md` entry to **Implemented and verified; pending acceptance and Git publication**. Add an `## Outcome` section naming the exact verification results and an `## Current Accuracy` section stating whether implementation matched this contract or listing each approved divergence.

Expected: the plan and index no longer look unexecuted, yet are not renamed to `DONE-*` prematurely.

- [ ] **Step 7: Report completion and stop before Git publication**

Report the exact commands/results, inspected screenshot path, and final changed-file list. Do not commit, push, merge, or open a PR unless the user explicitly authorizes that Git action.

If commit authorization is later given, use one atomic commit:

```bash
git add frontend/src/settings/GroupBoardSettings.jsx frontend/src/styles/settings/group-board.css tests/ui/group_board_composer.spec.js tests/ui/eng_group_board_settings_tab.spec.js docs/README_ANALYTICS.md frontend/dist/dashboard.js frontend/dist/dashboard.js.map frontend/dist/dashboard.css docs/plans/EXEC-board-configuration-horizontal-scroll.md docs/plans/README.md
git commit -m "Fix Board Configuration horizontal scrolling"
```

After that authorized commit, use the already authorized temporary-build-worktree procedure to reproduce CI from the commit itself:

```bash
board_scroll_verify_dir="$(mktemp -d /tmp/jep-board-scroll-verify.XXXXXX)"
git worktree add --detach "$board_scroll_verify_dir" HEAD
npm --prefix "$board_scroll_verify_dir" ci
npm --prefix "$board_scroll_verify_dir" run build
git -C "$board_scroll_verify_dir" diff --exit-code -- frontend/dist
git worktree remove "$board_scroll_verify_dir"
```

Expected: the build exits `0` and `git diff --exit-code -- frontend/dist` is silent, proving committed source and generated output agree under a fresh local dependency tree. If it differs, stop, preserve the diff for diagnosis, and do not push. Before any later push, also run the repository's full Python suite, review `git log --oneline -5`, and wait for explicit user confirmation as required by `AGENTS.md`.

## Acceptance criteria

- A standard vertical-wheel gesture over an overflowing Board Configuration rail changes `scrollLeft` without moving `.group-pane-right` while horizontal travel remains.
- Pixel-, line-, and page-mode vertical wheel input is normalized; positive and negative gestures move in the expected direction.
- At either rail directional boundary, the same wheel gesture moves `.group-pane-right` vertically.
- Horizontal-dominant wheel/trackpad input remains browser-native and is not synthetically double-applied; `ctrlKey` zoom gestures are untouched.
- Wheel input inside `.board-pick` scrolls that picker and changes neither rail nor parent position.
- Two labelled shared `IconButton` controls are visible whenever the rail overflows, retain the documented 28px/zero-margin geometry, expose correct disabled states, reference the rail with `aria-controls`, and move approximately one rendered column per activation from mouse or keyboard; reduced motion is immediate.
- Both status-chip and column-handle drags continuously scroll near the right/left rail edges and stop on dragend, drop, neutral position, boundary, and unmount.
- Passive edge hover never moves the rail.
- Adding, deleting, resetting, switching, or resizing columns refreshes control availability without persistence or requests.
- No-overflow configurations render no redundant scroll controls.
- If overflow ends while an arrow is focused, focus transfers to enabled Reset (or the labelled rail while Reset is disabled) instead of falling to `body`.
- The settings pane's vertical reachability, Board Configuration editing, validation, Save, focus, narrow viewport, and generated-build contracts remain green.
- Settled desktop and 375px screenshots plus element-level geometry prove the controls and horizontal rail remain contained in the real settings modal.
- A post-commit fresh-worktree build leaves `frontend/dist` clean before publication.
- No new analytics event is emitted; the no-event allowlist explicitly covers the interaction.

## Plan self-review

- **Spec coverage:** The approved wheel translation, visible controls, drag-only edge scrolling, modal-boundary release, picker isolation, reduced motion, responsive resynchronization, visual proof, analytics review, build, and regression gates each have an implementation step and an assertion.
- **File-map validity:** Every file listed as `Modify` or `Generate` exists on the planning branch; no speculative file is named.
- **Type/name consistency:** `columnsElementRef`, `columnScroll`, `syncColumnScroll`, native `onColumnsWheel`, `scrollColumns`, `onColumnsDragOverCapture`, and `stopColumnDragScroll` use the same names in state, handlers, markup, tests, and cleanup.
- **Scope:** Frontend-only local interaction; no endpoint, schema, persistence, dependency, shared modal, or product-model change.
- **Placeholders:** None.
- **Residual risk:** Native scrollbar appearance remains OS-controlled, which is why shared native buttons are the guaranteed path. Browser dragover frequency is not trusted; the bounded animation-frame loop supplies continuous movement and every termination path is behaviorally tested. The implementation still requires explicit user authorization for the repository-mandated temporary build worktree.
