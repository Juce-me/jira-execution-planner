# Group Board Help, Fixed Card Titles, And ADF Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the configured Group Board instruction wallpaper, expose its guidance through compact on-demand help, keep long epic summaries inside fixed-height cards, and preserve Jira ADF tables as independently scrollable semantic tables.

**Architecture:** Reuse `EngFilterBar`'s existing `viewControls` slot for a private `EngBoardHelp` component and render the current Board header only for the actionable unconfigured state. Make the existing title flex item explicitly own the remaining card width. Extend the shared server-side ADF walker with static semantic heading/table tags while keeping the existing route, escaping, URL allowlist, client cache, and HTML-injection boundary unchanged.

**Tech Stack:** React 19, CSS, Python 3.10+, Flask, Playwright, `unittest`, Node test runner, esbuild.

## Global Constraints

- Work in the checkout the user is viewing; do not create a worktree.
- Keep Board help closed by default with no local-storage, session, server, settings, or first-view persistence.
- Put the information button in `EngFilterBar.viewControls`; do not add another Board toolbar row or a new `EngFilterBar` prop.
- Keep the unconfigured-board callout and Configure action visible and functional.
- Keep the drag/drop live region mounted, accessible, and layout-free while empty.
- Keep epic summaries on one line with ellipsis; never wrap them, vary card height, hide the issue key, or widen the card.
- Continue fetching exactly one Jira `description` through `GET /api/issues/description`; do not change its request or response contract.
- Render only server-produced safe HTML. Do not accept raw Jira HTML, add a client-side ADF parser, broaden `_safe_adf_href`, or trust Jira table attributes/styles.
- Give each description table its own horizontal scroller. The panel, modal, Board, and document must not gain horizontal overflow.
- Preserve description loading, empty, error, retry, clamp, expansion, cache, ordinary links, and Smart Links.
- Preserve filter-bar height, sticky-stack ordering, pinned Board chrome, Board focus/star/fold, drag/drop, and document-overflow behavior.
- Add no analytics event. Record the approved no-event rationale without collecting help copy, description content, URLs, summaries, or issue keys.
- Do not hand-edit `frontend/dist/`; regenerate it with `npm run build`.
- Do not stage, commit, push, merge, or rewrite history unless the requester explicitly asks during execution.

## Plan Review

**Findings:** No remaining Blocker, P1, P2, or Minor findings after correcting the help control's
dialog relationship and the table width contract in this revision.

- **Endpoint contract:** `GET /api/issues/description?key=<issue-key>` remains the only affected
  route. Its OAuth/authentication, site boundary, request, `{key, html, isEmpty}` success body, and
  existing error bodies do not change. The plan adds renderer coverage only; there is no unsafe
  method, request body, CSRF, `X-Requested-With`, storage, migration, compatibility alias, Jira
  mutation, or Home/Townsquare path to specify.
- **UI state machine:** Board help has only `closed -> open` on trigger and `open -> closed` on
  trigger, outside pointer, or Escape; it resets to closed on remount. Escape restores trigger
  focus, while outside pointer leaves focus with the clicked control. The help owns no dirty,
  save, conflict, rollback, reload, remote-event, retry, auth-expired, or scope-switch state.
- **Ownership and credentials:** The existing signed-in Jira description read and server-side
  escaping boundary remain authoritative. No workspace id, user identity, shared group reference,
  cache ownership, credential resolver, service credential, or write authorization changes.
- **Runtime feasibility:** The change adds no request, polling, SSE, fan-out, migration, cache warm,
  or initial-load work. Help state is local, title containment is CSS, and the ADF walker remains
  one bounded traversal of the already-fetched description.
- **Verification:** Focused backend tests prove semantic output and unsafe-attribute/scheme
  rejection. Element-level Playwright assertions prove help focus/geometry, intentional title
  clipping with stable card height, and independent table scrolling without outer overflow.
  Settled screenshots cover the affected desktop and narrow layouts. No auth/DB/Home/EPM gate doc
  applies because no such boundary changes.

---

### Task 1: Replace The Configured-Board Wallpaper With Compact Help

**Files:**
- Create: `frontend/src/eng/EngBoardHelp.jsx`
- Modify: `frontend/src/eng/EngBoardView.jsx:1-24, 674-726`
- Modify: `frontend/src/styles/eng/board.css:20-83`
- Modify: `tests/ui/eng_group_board_view.spec.js`

**Interfaces:**
- Consumes: `EngFilterBar.viewControls`, `scaleMax: number`, the existing `firstRun`, `onConfigure`, and `announcement` values.
- Produces: `EngBoardHelp({ scaleMax: number })`, a closed-by-default `How Group Board works` trigger/dialog, configured Boards without `.board-head`, and a layout-free empty `.board-say` live region.
- Invariant: no filter, Board view, persisted preference, settings, route, or analytics interface changes.

- [x] **Step 1: Add the failing configured-Board help and gap regression**

In `tests/ui/eng_group_board_view.spec.js`, add:

```js
test('configured Board replaces the instruction wallpaper with compact on-demand help', async ({ page }) => {
    await openBoard(page, { width: 1280, height: 720, reducedMotion: true });

    await expect(page.locator('.eng-board .board-head-title')).toHaveCount(0);
    await expect(page.locator('.eng-board .board-head-sub')).toHaveCount(0);
    const helpTrigger = page.getByRole('button', { name: 'How Group Board works' });
    await expect(helpTrigger).toBeVisible();
    await expect(helpTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog', { name: 'How Group Board works' })).toHaveCount(0);

    const closedGeometry = await page.evaluate(() => {
        const wrap = document.querySelector('.filterbar-wrap').getBoundingClientRect();
        const board = document.querySelector('.eng-board .board-scroll').getBoundingClientRect();
        const announcement = document.querySelector('.eng-board .board-say').getBoundingClientRect();
        return {
            gap: board.top - wrap.bottom,
            announcementWidth: announcement.width,
            announcementHeight: announcement.height,
        };
    });
    expect(Math.abs(closedGeometry.gap)).toBeLessThanOrEqual(1);
    expect(closedGeometry.announcementWidth).toBeLessThanOrEqual(1);
    expect(closedGeometry.announcementHeight).toBeLessThanOrEqual(1);

    await helpTrigger.click();
    const help = page.getByRole('dialog', { name: 'How Group Board works' });
    await expect(help).toBeVisible();
    await expect(helpTrigger).toHaveAttribute('aria-expanded', 'true');
    const openGeometry = await help.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const copy = node.querySelector('.board-help-copy');
        return {
            width: rect.width,
            left: rect.left,
            right: rect.right,
            viewport: document.documentElement.clientWidth,
            textTransform: getComputedStyle(copy).textTransform,
            copyFontSize: parseFloat(getComputedStyle(copy).fontSize),
        };
    });
    expect(openGeometry.width).toBeLessThanOrEqual(512 + 1);
    expect(openGeometry.left).toBeGreaterThanOrEqual(11);
    expect(openGeometry.right).toBeLessThanOrEqual(openGeometry.viewport - 11);
    expect(openGeometry.textTransform).toBe('none');
    expect(openGeometry.copyFontSize).toBeGreaterThanOrEqual(13);

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    await expect(helpTrigger).toBeFocused();

    await helpTrigger.click();
    const filtersTrigger = page.getByRole('button', { name: /^Filters/ });
    await filtersTrigger.click();
    await expect(help).toHaveCount(0);
    await expect(filtersTrigger).toBeFocused();
});
```

Extend the existing first-run test in the same file to continue asserting the setup message and
`Configure Group Board` action. Do not change its fixture or expected navigation.

- [x] **Step 2: Run the new regression and verify the behavioral red state**

Run:

```bash
npx playwright test tests/ui/eng_group_board_view.spec.js --grep "configured Board replaces the instruction wallpaper"
```

Expected: FAIL because the configured Board still renders `.board-head-title`/`.board-head-sub`,
has no help trigger, and reserves the current Board-header space. A timeout, missing fixture, or
Chromium startup error is not an acceptable red state.

- [x] **Step 3: Create the private help component**

Create `frontend/src/eng/EngBoardHelp.jsx` with this interface and state machine:

```jsx
import * as React from 'react';

const HELP_MAX_WIDTH = 512;
const HELP_GUTTER = 12;

export default function EngBoardHelp({ scaleMax = 1 }) {
    const [open, setOpen] = React.useState(false);
    const hostRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    const titleId = React.useId();
    const dialogId = React.useId();

    const closeWithFocus = React.useCallback(() => {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
    }, []);

    React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (!hostRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeWithFocus();
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [closeWithFocus, open]);

    React.useLayoutEffect(() => {
        if (!open) return;
        const popover = popoverRef.current;
        if (!popover) return;
        const viewportWidth = document.documentElement.clientWidth;
        popover.style.width = `${Math.min(HELP_MAX_WIDTH, viewportWidth - HELP_GUTTER * 2)}px`;
        popover.style.left = '0px';
        const overflowRight = popover.getBoundingClientRect().right - (viewportWidth - HELP_GUTTER);
        if (overflowRight > 0) popover.style.left = `${-overflowRight}px`;
    }, [open]);

    return (
        <div className="board-help-host" ref={hostRef}>
            <button
                type="button"
                className="board-help-trigger"
                ref={triggerRef}
                aria-label="How Group Board works"
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-controls={open ? dialogId : undefined}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
            >
                ⓘ
            </button>
            {open && (
                <div
                    id={dialogId}
                    className="board-help-popover"
                    role="dialog"
                    aria-labelledby={titleId}
                    ref={popoverRef}
                >
                    <h2 id={titleId}>How Group Board works</h2>
                    <ul className="board-help-copy">
                        <li>Choose a folded column to centre it.</li>
                        <li>Star a column to keep it open for this session.</li>
                        <li>Cards are ordered highest priority first.</li>
                        <li>The tallest bar represents {scaleMax} epics.</li>
                        <li>Drag a card to another column to change its epic status.</li>
                    </ul>
                    <p className="board-help-copy">
                        Shared columns, the default star, and Min/Max limits live in Group Board settings.
                    </p>
                </div>
            )}
        </div>
    );
}
```

Keep outside-click dismissal as `setOpen(false)` so it does not steal focus from the clicked
control. Escape alone calls `closeWithFocus`.

- [x] **Step 4: Wire help and remove only the configured wallpaper**

In `EngBoardView.jsx`:

```jsx
import EngBoardHelp from './EngBoardHelp.jsx';
```

Pass the existing slot:

```jsx
<EngFilterBar
    // existing props unchanged
    viewControls={<EngBoardHelp scaleMax={scaleMax} />}
/>
```

Replace the unconditional Board header with a first-run-only block:

```jsx
{firstRun && (
    <div className="board-head">
        <div>
            <span className="board-head-title">Epics by column</span>
            <div className="board-head-sub board-first-run">
                This group&apos;s board is not set up yet, so every epic in scope sits in one column.
                Compose columns in Settings → Departments → Boards.
            </div>
        </div>
        {onConfigure && (
            <button type="button" className="secondary compact board-configure" onClick={onConfigure}>
                Configure Group Board ↗
            </button>
        )}
    </div>
)}
<span
    className={`board-say${announcement ? ' has-message' : ''}${announcement?.isError ? ' is-error' : ''}`}
    role="status"
    aria-live="polite"
    aria-atomic="true"
>
    {announcement ? announcement.text : ''}
</span>
```

Delete the configured `board-head-sub`, including the static scale sentence. Do not remove the live
region or the first-run copy.

- [x] **Step 5: Add compact Board-specific help and empty-live-region CSS**

In `board.css`:

```css
.eng-board {
    /* existing variables */
    margin-top: 0;
}

.filterbar-wrap:has(.board-help-popover) {
    z-index: calc(var(--sticky-control-overlay-z) + 2);
}

.board-help-host {
    position: relative;
}

.board-help-trigger {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
}

.board-help-popover {
    position: absolute;
    top: calc(100% + 0.4rem);
    left: 0;
    max-width: calc(100vw - 24px);
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-secondary);
    box-shadow: 0 12px 28px rgba(22, 22, 22, 0.16);
    color: var(--text-primary);
    text-align: left;
    text-transform: none;
    letter-spacing: normal;
    z-index: calc(var(--sticky-control-overlay-z) + 3);
}

.board-help-popover h2 {
    margin: 0 0 0.55rem;
    font-size: 0.95rem;
    line-height: 1.25;
}

.board-help-copy {
    margin: 0.45rem 0 0;
    font-family: inherit;
    font-size: 0.82rem;
    line-height: 1.45;
    text-transform: none;
    letter-spacing: normal;
}

.board-help-popover ul {
    padding-left: 1.1rem;
}

.eng-board .board-say:not(.has-message) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.eng-board .board-say.has-message {
    display: block;
    min-height: 0;
    margin: 0 0 0.45rem;
}
```

Keep all bare-button resets scoped through the existing filter-bar rules. Do not change
`.filterbar` height or wrapper padding.

- [x] **Step 6: Build and run the focused help/first-run/sticky checks**

Run:

```bash
npm run build
npx playwright test tests/ui/eng_group_board_view.spec.js --grep "configured Board replaces the instruction wallpaper|first-run|open headers and every collapsed rail pin|pinned chrome stays interactive"
```

Expected: all selected tests PASS. Capture a settled 1280px configured Board and help-open
screenshot under `tmp/eng-group-board-view/`, inspect both, and confirm the columns begin after the
existing filter-bar spacer with no replacement wallpaper or popup overflow.

---

### Task 2: Make The Epic Summary A Deterministic Ellipsis Lane

**Files:**
- Modify: `frontend/src/eng/EngBoardEpicCard.jsx:45-82`
- Modify: `frontend/src/styles/eng/board.css:520-553`
- Modify: `tests/ui/eng_group_board_card.spec.js:25-105, 375-405`

**Interfaces:**
- Consumes: the existing `.erow1`, `.etitle`, `.ekey`, full summary, and semantic card button.
- Produces: a single-line `.etitle` with `flex: 1 1 0` and intentional overflow/ellipsis while indicators and issue key remain fixed.
- Invariant: card markup semantics, card click/drag behavior, metadata rows, accessible name, width, and rendered height stay unchanged.

- [x] **Step 1: Add a deliberately overlong synthetic summary fixture**

Near `EPIC_SPECS` in `tests/ui/eng_group_board_card.spec.js`, add:

```js
const LONG_EPIC_SUMMARY = 'Replace expression-based enrichment targeting with deterministic request-scoped functions while preserving every existing compatibility boundary and diagnostic contract';
```

In `epicPayload`, use it only for `PLAT-1`:

```js
summary: key === 'PLAT-1' ? LONG_EPIC_SUMMARY : `${key} epic summary`,
```

Keep every other fixture value synthetic and unchanged.

- [x] **Step 2: Replace the old all-text-must-not-clip assertion and add the failing lane regression**

The current test includes `.etitle` in a list where every element must have `scrollWidth <=
clientWidth`. Remove `.etitle` from that generic list because title clipping is now intentional;
keep `.ekey`, `.eperson b`, `.erow2 span`, and `.erow2 time` protected.

Add:

```js
test('a very long epic summary ellipsizes in one fixed-height card row', async ({ page }) => {
    await openBoard(page, { width: 960, height: 760 });
    const longCard = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    const shortCard = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-2"]');
    const geometry = await longCard.evaluate((card) => {
        const row = card.querySelector('.erow1');
        const title = card.querySelector('.etitle');
        const key = card.querySelector('.ekey');
        const cardRect = card.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const keyRect = key.getBoundingClientRect();
        const style = getComputedStyle(title);
        return {
            cardHeight: cardRect.height,
            cardOverflow: card.scrollWidth - card.clientWidth,
            rowOverflow: row.scrollWidth - row.clientWidth,
            titleClips: title.scrollWidth > title.clientWidth + 1,
            titleRight: titleRect.right,
            keyLeft: keyRect.left,
            whiteSpace: style.whiteSpace,
            textOverflow: style.textOverflow,
            overflowX: style.overflowX,
            flexGrow: style.flexGrow,
            flexBasis: style.flexBasis,
        };
    });
    const shortHeight = await shortCard.evaluate((card) => card.getBoundingClientRect().height);

    expect(geometry.titleClips).toBe(true);
    expect(geometry.whiteSpace).toBe('nowrap');
    expect(geometry.textOverflow).toBe('ellipsis');
    expect(geometry.overflowX).toBe('hidden');
    expect(geometry.flexGrow).toBe('1');
    expect(geometry.flexBasis).toBe('0%');
    expect(geometry.titleRight).toBeLessThanOrEqual(geometry.keyLeft + 1);
    expect(geometry.cardOverflow).toBeLessThanOrEqual(1);
    expect(geometry.rowOverflow).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.cardHeight - shortHeight)).toBeLessThanOrEqual(1);
    await expect(longCard).toHaveAttribute('aria-label', `PLAT-1: ${LONG_EPIC_SUMMARY}`);
});
```

- [x] **Step 3: Run the new test and verify the contract red state**

Run:

```bash
npx playwright test tests/ui/eng_group_board_card.spec.js --grep "very long epic summary"
```

Expected: FAIL on the explicit flexible-lane contract (`flexGrow`/`flexBasis`) before the CSS
change. The synthetic summary must already overflow its title box; if it does not, lengthen only
`LONG_EPIC_SUMMARY` rather than weakening the assertion.

- [x] **Step 4: Make the title the only flexible first-row lane**

In `board.css`, retain the existing one-line/ellipsis declarations and add the explicit flex
contract:

```css
.eng-board .erow1 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
}

.eng-board .erow1 > .task-priority-icon,
.eng-board .erow1 > .epic-track-indicator,
.eng-board .erow1 > .status-pill,
.eng-board .ekey {
    flex: none;
}

.eng-board .etitle {
    flex: 1 1 0;
    font-size: 0.98rem;
    line-height: 1.25;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.eng-board .ekey {
    /* existing typography */
    margin-left: 0;
}
```

Do not add a fixed height, width, JavaScript measurement, wrap, line clamp, or tooltip state.

- [x] **Step 5: Build and verify card geometry and existing card behavior**

Run:

```bash
npm run build
npx playwright test tests/ui/eng_group_board_card.spec.js
```

Expected: the file passes, including the intentional-title-clipping regression and the remaining
non-title overflow guard. Inspect a settled screenshot containing both the long and short cards;
confirm identical card heights, a visible ellipsis, a stable key lane, and no title/key collision.

---

### Task 3: Render Safe Semantic ADF Headings And Tables

**Files:**
- Modify: `backend/epm/home.py:781-857`
- Modify: `tests/test_oauth_eng_routes.py:1484-1575`
- Modify: `frontend/src/styles/eng/board.css:740-825`
- Modify: `tests/ui/eng_group_board_panel.spec.js:45-55, 123-205, 421-490`

**Interfaces:**
- Consumes: `adf_to_html(value: Any) -> str`, `_render_adf_html_nodes(nodes: list) -> str`, and `_safe_adf_href(value: Any) -> str`.
- Produces: escaped semantic `h1`–`h6`, `table`, `tr`, `th scope="col"`, and `td` markup inside a static `.adf-table-scroll` wrapper.
- Invariant: `GET /api/issues/description?key=...` keeps `{key, html, isEmpty}` and all auth, endpoint-policy, Jira-field, cache, and frontend injection behavior unchanged.

- [x] **Step 1: Add failing route coverage for headings, tables, escaping, and ignored attributes**

Add this test to `IssueDescriptionRouteTests` in `tests/test_oauth_eng_routes.py`:

```python
def test_description_route_renders_safe_semantic_heading_and_table(self):
    description = {
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 3, "onclick": "alert(1)"},
                "content": [{"type": "text", "text": "Scope <Stories>"}],
            },
            {
                "type": "table",
                "attrs": {"layout": "wide", "width": 9999, "style": "position:fixed"},
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableHeader", "attrs": {"background": "red"},
                             "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Key"}]}]},
                            {"type": "tableHeader",
                             "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Summary"}]}]},
                        ],
                    },
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableCell", "attrs": {"colspan": 2},
                             "content": [{"type": "paragraph", "content": [{"type": "text", "text": "SYNTH-1"}]}]},
                            {"type": "tableCell",
                             "content": [{"type": "paragraph", "content": [
                                 {"type": "text", "text": "<script>safe text</script> ",
                                  "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
                                 {"type": "text", "text": "spec", "marks": [{"type": "link", "attrs": {
                                     "href": "https://docs.example.test/spec?mode=review&section=table"
                                 }}]},
                             ]}]},
                        ],
                    },
                    {
                        "type": "tableRow",
                        "content": [
                            {"type": "tableCell", "content": []},
                            {"type": "tableCell", "content": [{"type": "paragraph", "content": []}]},
                        ],
                    },
                ],
            },
        ],
    }
    with patch.object(jira_server, "JIRA_AUTH_MODE", "atlassian_oauth"), \
         patch.object(jira_server, "current_jira_get", return_value=FakeResponse(200, {
             "fields": {"description": description},
         })):
        response = self.client.get("/api/issues/description?key=SYNTH-1")

    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
    html = response.get_json()["html"]
    self.assertIn("<h3>Scope &lt;Stories&gt;</h3>", html)
    self.assertIn(
        '<div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">'
        "<table><tbody>",
        html,
    )
    self.assertIn('<th scope="col"><p>Key</p></th>', html)
    self.assertIn('<th scope="col"><p>Summary</p></th>', html)
    self.assertIn('<td><p>SYNTH-1</p></td>', html)
    self.assertIn('&lt;script&gt;safe text&lt;/script&gt;', html)
    self.assertIn('<td></td><td></td>', html)
    self.assertNotIn("onclick", html)
    self.assertNotIn("style=", html)
    self.assertNotIn("colspan", html)
    self.assertNotIn("javascript:", html)
```

Add a second small assertion to the existing ordinary description test or a new focused test: a
heading whose `attrs.level` is absent, a string, zero, or seven renders as `<p>`, not a dynamic tag.

- [x] **Step 2: Run focused renderer tests and verify red**

Run:

```bash
.venv/bin/python -m unittest \
  tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_renders_safe_semantic_heading_and_table \
  tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_renders_adf_to_html \
  tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_renders_safe_inline_and_block_smart_links \
  tests.test_oauth_eng_routes.IssueDescriptionRouteTests.test_description_route_xss_guard_strips_unsafe_href_but_keeps_safe_one
```

Expected: the new test FAILS because headings are currently rendered as `<p>` and table structure
is flattened; the three existing safety/compatibility tests PASS.

- [x] **Step 3: Add static semantic heading and table branches to the shared renderer**

In `_render_adf_html_nodes`, split the current `paragraph`/`heading` branch and add table cases
before the unknown-content fallback:

```python
if node_type == "paragraph":
    inner = _render_adf_html_nodes(node.get("content", []))
    if inner:
        parts.append(f"<p>{inner}</p>")
    continue
if node_type == "heading":
    inner = _render_adf_html_nodes(node.get("content", []))
    if inner:
        level = (node.get("attrs") or {}).get("level")
        tag = f"h{level}" if isinstance(level, int) and 1 <= level <= 6 else "p"
        parts.append(f"<{tag}>{inner}</{tag}>")
    continue
if node_type == "table":
    rows = [
        child for child in node.get("content", [])
        if isinstance(child, dict) and child.get("type") == "tableRow"
    ]
    inner = _render_adf_html_nodes(rows)
    if inner:
        parts.append(
            '<div class="adf-table-scroll" role="region" '
            'aria-label="Description table" tabindex="0">'
            f"<table><tbody>{inner}</tbody></table></div>"
        )
    continue
if node_type == "tableRow":
    cells = [
        child for child in node.get("content", [])
        if isinstance(child, dict) and child.get("type") in {"tableHeader", "tableCell"}
    ]
    if cells:
        parts.append(f"<tr>{_render_adf_html_nodes(cells)}</tr>")
    continue
if node_type in {"tableHeader", "tableCell"}:
    tag = "th" if node_type == "tableHeader" else "td"
    scope = ' scope="col"' if tag == "th" else ""
    inner = _render_adf_html_nodes(node.get("content", []))
    parts.append(f"<{tag}{scope}>{inner}</{tag}>")
    continue
```

Do not copy any Jira `attrs` value into HTML. Keep text escaping, `_safe_adf_href`, Smart Links,
marks, lists, hard breaks, and unknown-node recursion unchanged.

- [x] **Step 4: Run focused backend tests and verify green**

Run the exact Step 2 command again, plus:

```bash
.venv/bin/python -m unittest tests.test_oauth_eng_routes.IssueDescriptionRouteTests
```

Expected: all `IssueDescriptionRouteTests` PASS with no unsafe attribute or scheme in the returned
HTML.

- [x] **Step 5: Add the failing browser fixture and table-local overflow regression**

In `tests/ui/eng_group_board_panel.spec.js`, add a separate table fixture rather than changing
`DESCRIPTION_HTML`'s clamp intent:

```js
const TABLE_DESCRIPTION_HTML = `
    <h3>Scope (Child Stories)</h3>
    <div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">
        <table><tbody>
            <tr><th scope="col">#</th><th scope="col">Key</th><th scope="col">Component</th><th scope="col">Summary</th></tr>
            <tr><td>1</td><td>SYNTH-1</td><td>Gateway</td><td>Add deterministic span-linked logging to the gateway application</td></tr>
            <tr><td>2</td><td>SYNTH-2</td><td>Distribution</td><td>Propagate the trace context through distribution</td></tr>
        </tbody></table>
    </div>
    <div class="adf-table-scroll" role="region" aria-label="Description table" tabindex="0">
        <table><tbody><tr><th scope="col">Owner</th><th scope="col">Outcome</th></tr><tr><td>Platform</td><td>Verified</td></tr></tbody></table>
    </div>`;
```

Parameterize `installBoardFixture` with `descriptionHtml = DESCRIPTION_HTML` and return that value
from `/api/issues/description`. Add:

```js
test('description tables keep semantic columns and scroll only the selected table', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls, { width: 1280, height: 820, descriptionHtml: TABLE_DESCRIPTION_HTML });
    await openPanel(page, 'PLAT-1');
    const body = panel(page).locator('.m-desc-body');
    const heading = body.getByRole('heading', { name: 'Scope (Child Stories)', level: 3 });
    await expect(heading).toBeVisible();
    await expect(body.getByRole('table')).toHaveCount(2);
    await expect(body.getByRole('columnheader', { name: 'Key' })).toBeVisible();
    await expect(body.getByRole('cell', { name: 'SYNTH-1' })).toBeVisible();
    const headingStyle = await heading.evaluate((node) => ({
        textTransform: getComputedStyle(node).textTransform,
        fontSize: parseFloat(getComputedStyle(node).fontSize),
    }));
    expect(headingStyle.textTransform).toBe('none');
    expect(headingStyle.fontSize).toBeGreaterThanOrEqual(14);

    await page.setViewportSize({ width: 375, height: 812 });
    const wrappers = body.locator('.adf-table-scroll');
    await expect(wrappers).toHaveCount(2);
    const before = await wrappers.evaluateAll((nodes) => nodes.map((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        scrollLeft: node.scrollLeft,
        overflowX: getComputedStyle(node).overflowX,
    })));
    expect(before[0].scrollWidth).toBeGreaterThan(before[0].clientWidth + 1);
    expect(before[0].overflowX).toBe('auto');
    expect(before[1].scrollLeft).toBe(0);

    await wrappers.first().focus();
    await expect(wrappers.first()).toBeFocused();
    await wrappers.first().evaluate((node) => { node.scrollLeft = node.scrollWidth; });
    const after = await wrappers.evaluateAll((nodes) => nodes.map((node) => node.scrollLeft));
    expect(after[0]).toBeGreaterThan(0);
    expect(after[1]).toBe(0);

    const outerOverflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panel: document.querySelector('.epic-panel').scrollWidth - document.querySelector('.epic-panel').clientWidth,
        body: document.querySelector('.epic-panel .m-body').scrollWidth - document.querySelector('.epic-panel .m-body').clientWidth,
        description: document.querySelector('.m-desc-body').scrollWidth - document.querySelector('.m-desc-body').clientWidth,
    }));
    Object.entries(outerOverflow).forEach(([surface, overflow]) => {
        expect(overflow, `${surface} owns no table overflow`).toBeLessThanOrEqual(1);
    });
});
```

- [x] **Step 6: Run the new browser regression and verify red**

Run:

```bash
npm run build
npx playwright test tests/ui/eng_group_board_panel.spec.js --grep "description tables keep semantic columns"
```

Expected: FAIL because `.adf-table-scroll`/table/heading styling does not yet constrain or style
the fixture. If semantics pass from fixture HTML, the red assertion must be table-local overflow,
normal-case heading geometry, or outer-overflow containment—not a missing fixture.

- [x] **Step 7: Add readable heading and table-local CSS**

Replace the dormant uppercase micro-label heading rule and add table rules in `board.css`:

```css
.eng-board .m-desc-body h1,
.eng-board .m-desc-body h2,
.eng-board .m-desc-body h3,
.eng-board .m-desc-body h4,
.eng-board .m-desc-body h5,
.eng-board .m-desc-body h6 {
    margin: 1rem 0 0.4rem;
    font-family: inherit;
    color: var(--text-primary);
    text-transform: none;
    letter-spacing: normal;
    line-height: 1.3;
}

.eng-board .m-desc-body h1,
.eng-board .m-desc-body h2 { font-size: 1.05rem; }
.eng-board .m-desc-body h3,
.eng-board .m-desc-body h4,
.eng-board .m-desc-body h5,
.eng-board .m-desc-body h6 { font-size: 0.92rem; }

.eng-board .m-desc-body .adf-table-scroll {
    max-width: 100%;
    margin: 0.55rem 0 0.8rem;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    border: 1px solid var(--border);
    border-radius: 8px;
}

.eng-board .m-desc-body .adf-table-scroll:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

.eng-board .m-desc-body table {
    width: 100%;
    min-width: 36rem;
    border-collapse: collapse;
    table-layout: auto;
    font-size: 0.78rem;
    line-height: 1.35;
}

.eng-board .m-desc-body th,
.eng-board .m-desc-body td {
    min-width: 7rem;
    padding: 0.45rem 0.55rem;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
    white-space: normal;
    overflow-wrap: anywhere;
}

.eng-board .m-desc-body th {
    background: var(--bg-primary);
    font-weight: 600;
}

.eng-board .m-desc-body th:last-child,
.eng-board .m-desc-body td:last-child { border-right: 0; }
.eng-board .m-desc-body tr:last-child > * { border-bottom: 0; }
.eng-board .m-desc-body th > :last-child,
.eng-board .m-desc-body td > :last-child { margin-bottom: 0; }
```

Do not add overflow to `.m-desc`, `.m-desc-body`, `.m-body`, or `.epic-panel`.

- [x] **Step 8: Run focused panel and renderer coverage and inspect screenshots**

Run:

```bash
npm run build
.venv/bin/python -m unittest tests.test_oauth_eng_routes.IssueDescriptionRouteTests
npx playwright test tests/ui/eng_group_board_panel.spec.js
```

Expected: all commands PASS. Capture and inspect desktop and 375px table screenshots. Confirm real
headers/cells, compact normal-case headings, per-table horizontal containment, and unchanged
description clamp/expand and story-row layout.

---

### Task 4: Align Documentation, Rebuild, And Verify The Complete Slice

**Files:**
- Modify: `docs/plans/EXEC-eng-group-board.md:1550-1590`
- Modify: `docs/README_ANALYTICS.md` (`No-Event Allowlist`)
- Modify: `docs/agents/features/2026-08-08-planned-board-help-title-and-adf-tables.md`
- Modify: `docs/plans/EXEC-board-help-title-adf-tables.md`
- Modify: `docs/plans/README.md`
- Modify: `tests/ui/eng_group_board_drag.spec.js` (approved Task 1 scale assertion only)
- Modify: `tests/ui/eng_group_board_view.spec.js` (approved Task 1 scale assertion only)
- Modify: `tests/ui/eng_group_board_filters.spec.js` (approved Task 1 help/sticky geometry assertions only)
- Regenerate: `frontend/dist/dashboard.css`
- Regenerate: `frontend/dist/dashboard.js`
- Regenerate: `frontend/dist/dashboard.js.map`

**Interfaces:**
- Consumes: Tasks 1-3's verified UI and renderer behavior.
- Produces: current ADF policy documentation, no-event rationale, generated assets, executed work-artifact status, and complete verification evidence.

- [x] **Step 1: Update the canonical Group Board ADF policy**

In `docs/plans/EXEC-eng-group-board.md`, change the supported-node table to state:

```markdown
| Node | `paragraph` | `<p>` |
| Node | `heading` | Escaped semantic `<h1>`–`<h6>` for valid levels; invalid levels degrade to `<p>` |
| Node | `table` | Static `.adf-table-scroll` region containing `<table><tbody>`; Jira attributes are ignored |
| Node | `tableRow` | `<tr>` containing only supported header/cell children |
| Node | `tableHeader`, `tableCell` | `<th scope="col">`, `<td>` with recursively escaped content; Jira attributes are ignored |
```

Remove `table` from the unsupported-node sentence. Keep `panel`, `mediaSingle`, `codeBlock`,
`mention`, `emoji`, and `status` in the recursive text fallback. Preserve the raw-HTML prohibition.

- [x] **Step 2: Record the analytics no-event decision**

Add this row to `docs/README_ANALYTICS.md` → `No-Event Allowlist`:

```markdown
| ENG Board help, fixed card titles, and description tables | `frontend/src/eng/EngBoardHelp.jsx`, `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/eng/EngBoardEpicPanel.jsx`, `backend/epm/home.py` | Help is an ephemeral read-only disclosure with no persisted or shared state; title truncation and semantic table rendering are passive presentation. Existing Board view/filter interactions remain intentionally untracked and `eng_issue_description` continues to cover API reliability. Never collect help copy, description text, table cells, URLs, summaries, or issue keys. | 2026-08-08 |
```

Do not add an event, trigger, parameter, data-layer call, or analytics test for a nonexistent event.

- [x] **Step 3: Rebuild and run the complete focused verification matrix**

Run:

```bash
npm run build
node --test tests/test_eng_board_styles.js tests/test_frontend_api_source_guards.js
.venv/bin/python -m unittest tests.test_oauth_eng_routes.IssueDescriptionRouteTests
npx playwright test \
  tests/ui/eng_group_board_view.spec.js \
  tests/ui/eng_group_board_card.spec.js \
  tests/ui/eng_group_board_panel.spec.js \
  tests/ui/eng_group_board_drag.spec.js \
  tests/ui/eng_group_board_filters.spec.js
npx playwright test tests/ui/eng_compact_layout_visual.spec.js --grep "Catch Up exposes the compact, filter-bar, and pinned-epic sticky stack"
npm run build
git diff --check
```

Expected for changed behavior: the new help, long-summary, and table tests pass; existing Board
view/card/panel/filter/sticky checks pass; both builds exit 0; the second build creates no further
generated diff; `git diff --check` prints nothing.

Do not modify drag or transition behavior or weaken unrelated tests. During finalization, the
done-category drag gate exposed a stale fixture URL: it still mocked the settings composer status
catalog after the Board moved to the transition status catalog. Updating only that mock restored
the intended category-aware coverage.

- [x] **Step 4: Run the full Python suite and report the environment honestly**

Run:

```bash
.venv/bin/python -m unittest discover -s tests
```

Expected product behavior: no failure traces to the ADF renderer change. This checkout has existing
database-environment leakage that can attempt `db:5432` or a local PostgreSQL socket during
unrelated startup/excluded-capacity tests. If that recurs, stop the external connection attempt,
record the exact test and stack, and do not change DB/preflight code in this slice or claim a clean
full suite.

- [x] **Step 5: Inspect final screenshots and diff scope**

Inspect the settled screenshots directly, including:

- configured Board with no wallpaper;
- help open at desktop and narrow width;
- long and short cards side by side;
- description table at desktop and 375px after scrolling only the first table.

Run:

```bash
git status --short
git diff --stat
git diff -- \
  frontend/src/eng/EngBoardHelp.jsx \
  frontend/src/eng/EngBoardView.jsx \
  frontend/src/eng/EngBoardEpicCard.jsx \
  frontend/src/styles/eng/board.css \
  backend/epm/home.py \
  tests/test_oauth_eng_routes.py \
  tests/ui/eng_group_board_view.spec.js \
  tests/ui/eng_group_board_card.spec.js \
  tests/ui/eng_group_board_panel.spec.js \
  docs/README_ANALYTICS.md
```

Confirm every line traces to this plan, no real Jira data or local absolute path entered tracked
files, and generated assets came only from the build.

- [x] **Step 6: Update execution artifacts without unrequested Git mutations**

After verification, rename the work artifact to:

```text
docs/agents/features/2026-08-08-executed-board-help-title-and-adf-tables.md
```

Set `Status: executed` and add `Outcome` and `Current Accuracy` with exact test counts and any
unchanged baseline failures. Keep this implementation plan named `EXEC-*` pending requester
acceptance or merge, check completed steps only, add an `## Outcome`, and update its
`docs/plans/README.md` entry. Do not stage or commit unless the requester explicitly asks.

## Outcome

Implemented and verified with recorded exceptions. The feature-specific help, long-summary, and
semantic-table checks pass; Node guards pass 55/55, description-route tests pass 12/12, the compact
sticky check passes 1/1, and the full Python suite ran 1,219 tests with 1,218 passed and 1 skipped. Both frontend
builds exited 0 and produced identical generated files; `git diff --check` exited 0.

Task 4's first complete five-spec Board run passed 100 of 107 tests and supplied RED evidence for
five stale assertions invalidated by the approved help contract. After updating those assertions,
their focused rerun passed 5/5 and that Task 4 matrix passed 106/107. Finalization also corrected
the drag fixture's stale status-catalog URL without changing product drag or transition behavior.
The final six-spec Board/EPM matrix passes 113/113, and the full frontend unit suite passes 903/903.
This plan remains `EXEC-*` pending requester acceptance or merge.
