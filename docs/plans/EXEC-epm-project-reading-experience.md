# EPM Project Reading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the EPM all-projects reading experience so project names, status, labels, Home links, and latest updates remain available but scan like an operational project list instead of a collection of visually noisy cards.

**Architecture:** Keep the existing EPM data model, rollup loading, collapse state, links, and Jira/Home API behavior unchanged. Rework only the EPM project board header/update markup in `EpmRollupPanel.jsx`, the matching CSS in `dashboard.css`, and the Playwright visual fixture that guards geometry and reading rhythm. Remove decorative project icons rather than realigning them; the collapse chevron plus title block is the complete project header affordance.

**Tech Stack:** React 19 JSX, existing CSS in `frontend/src/styles/dashboard.css`, esbuild build output, Playwright UI tests, Node source guards.

---

## Context

The current view contains the right information, but the presentation makes it hard to read:

- Project names render as small blue uppercase monospace text with wide letter spacing, which makes every row feel like a label instead of a title.
- Status, Jira label, and Home link float far to the right, so the eye jumps across the full viewport before reaching the project update.
- Latest updates render inside bordered/shadowed boxes with absolutely positioned date/author metadata, making operational notes look like form fields.
- Update text is too visually separated from the project title, even though it is the main human-readable summary for each project.
- The visual test currently proves there is no overlap, but it also encodes parts of the current card-like treatment that are causing the reading problem.

Relevant prior lessons:

- `postmortem/MRT011-epm-settings-overgeneralized-selection-ux.md`: do not preserve display-heavy cards when the user task is compact review.
- `postmortem/MRT012-epm-active-sprint-value-hidden.md`: visible state and visible scope are part of correctness.
- `docs/plans/GATE-05-home-write-capability.md` was reviewed on 2026-05-13. This plan does not add Home write routes or mutation UI, so the gate remains blocked and does not need a write probe.

## Approaches

**Recommended: component-level reading redesign.** Keep the existing data and controls, but revise markup and CSS so each project reads as title, metadata, update, then Jira work. This solves the actual reading issue while keeping the change local and testable.

**Lower-risk but insufficient: CSS-only polish.** Changing colors, gaps, and font sizes without touching markup would reduce some noise, but the right-floating metadata and absolute update label would still drive poor scanning.

**Higher-scope: structured project digest.** Parsing Home updates into status, blockers, and next actions could produce a richer summary, but it would change content semantics and require backend or sanitizer decisions. Keep that out of this pass.

## File Map

Modify:

- `frontend/src/epm/EpmRollupPanel.jsx` — project header and latest-update markup only.
- `frontend/src/styles/dashboard.css` — `.epm-project-board*` layout, typography, and responsive behavior.
- `tests/ui/epm_portfolio_header_visual.spec.js` — fixture and assertions for the new reading treatment.

Do not modify:

- Backend EPM routes or Home/Townsquare fetchers.
- `frontend/src/api/epmApi.js` or EPM request timing.
- EPM settings behavior.
- Generated `frontend/dist/*` by hand. Run `npm run build` after source changes.

## Design Rules

- Preserve every piece of currently visible project information: project name, collapse affordance, Home status, Jira label, Home link, date, author, update text, HTML links inside updates, and issue rollup body.
- Keep the collapse button separate from links, pills, and long update text. Never nest anchors or metadata inside the toggle.
- Drop the generic project icon SVG. It is decorative, adds no information next to the chevron, and complicates the rail alignment.
- Render the Home link text as plain `Home`; do not append `↗`.
- Use natural-case project titles. Do not uppercase project names through CSS.
- Use system UI typography for titles and update text. Reserve monospace only for Jira labels or compact technical keys.
- Keep title letter spacing at `0`.
- Keep update copy within a readable measure, target `max-width: 72ch`.
- Remove the form-field feeling from updates: no floating meta label, no heavy shadow, no boxed card treatment.
- Keep the title hover model simple: the icon-only collapse button carries the expand/collapse affordance; do not preserve dead title-underlining rules that depend on the title being inside the button.
- On narrow viewports, stack metadata under the title and keep the Home link reachable without horizontal scroll.
- Do not add new data fetches, endpoints, persisted state, or per-project enrichment.

---

### Task 1: Update the Visual Regression Fixture First

**Files:**
- Modify: `tests/ui/epm_portfolio_header_visual.spec.js`

- [ ] **Step 1: Rewrite and expand the fixture to match the new DOM**

Update `loadHeaderFixture(page)` so it no longer hard-codes the old header where chevron, project icon, and project name are nested inside `.epm-project-board-toggle`.

Replace that fixture shape with the target DOM shape:

```html
<div class="epm-project-board-header">
    <button type="button" class="epm-project-board-toggle" aria-expanded="true" aria-label="Collapse AI for RFP creation">
        <span class="epm-project-board-chevron">...</span>
    </button>
    <div class="epm-project-board-title-block">
        <h3 class="epm-project-board-name">AI for RFP creation</h3>
        <div class="epm-project-board-meta" aria-label="Project metadata">
            <span class="epm-project-board-status-pill">On track</span>
            <span class="epm-project-board-label-pill">RnD_Project_RFP_AI</span>
            <a class="epm-project-board-link" href="https://home.atlassian.com/o/example/s/example/project/CRITE-324">Home</a>
        </div>
    </div>
</div>
```

The expanded fixture must include:

- three `.epm-project-board` sections
- a status pill in `.epm-project-board-meta`
- a long Jira label that must ellipsize or wrap safely
- one update with a single sentence
- one update with a bullet list
- one long project name
- one plain `Home` link with no `↗` glyph

Keep the existing checks that `.epm-project-board-toggle` does not contain anchors or update content.

- [ ] **Step 2: Delete old card-encoding assertions before adding new ones**

Delete the current assertions in `tests/ui/epm_portfolio_header_visual.spec.js` that encode the old boxed update treatment. In the current file, these are lines 117-119:

```js
expect(updateMetaBox.y).toBeLessThanOrEqual(updateBox.y + 1);
expect(updateMetaBox.x).toBeGreaterThan(updateBox.x);
expect(updateMetaBox.x + updateMetaBox.width).toBeLessThan(updateBox.x + updateBox.width);
```

Delete the current card-style checks. In the current file, these are lines 135-137:

```js
expect(updateStyle.borderRadius).toBe('8px');
expect(updateStyle.backgroundColor).toBe('rgb(255, 255, 255)');
expect(updateStyle.color).not.toBe('rgb(255, 255, 255)');
```

These assertions conflict with the target design and must not remain beside the new assertions.

- [ ] **Step 3: Add failing assertions for the desired reading treatment**

Add computed-style checks for the first board:

```js
const titleStyle = await page.locator('.epm-project-board-name').first().evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
        fontFamily: style.fontFamily,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
        whiteSpace: style.whiteSpace,
    };
});
expect(titleStyle.textTransform).toBe('none');
expect(titleStyle.letterSpacing).toBe('0px');
expect(titleStyle.fontFamily).not.toContain('IBM Plex Mono');
expect(titleStyle.whiteSpace).not.toBe('nowrap');
```

Add computed-style checks for the update without asserting exact `ch` serialization from `getComputedStyle`:

```js
const updateStyle = await update.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
        boxShadow: style.boxShadow,
        borderTopStyle: style.borderTopStyle,
        fontSizePx: Number.parseFloat(style.fontSize),
        maxWidthValue: style.maxWidth,
        maxWidthPx: Number.parseFloat(style.maxWidth),
    };
});
expect(updateStyle.boxShadow).toBe('none');
expect(updateStyle.borderTopStyle).toBe('none');
expect(updateStyle.maxWidthValue).not.toBe('none');
expect(Number.isFinite(updateStyle.maxWidthPx)).toBe(true);
expect(updateStyle.maxWidthPx).toBeLessThanOrEqual(760);
expect(updateStyle.fontSizePx).toBeGreaterThanOrEqual(14);
expect(updateBox.width).toBeLessThanOrEqual(760);
```

Add a meta-position check:

```js
const updateMetaStyle = await page.locator('.epm-project-board-update-meta').first().evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
        position: style.position,
        backgroundColor: style.backgroundColor,
    };
});
expect(updateMetaStyle.position).toBe('static');
expect(updateMetaStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
```

Add a separator check so date and author still read as one metadata phrase:

```js
const authorSeparator = await page.locator('.epm-project-board-update-author').first().evaluate((node) => {
    return window.getComputedStyle(node, '::before').content;
});
expect(authorSeparator).toBe('"·"');
```

Add rail-position checks that anchor the vertical line to the collapse column instead of relying only on a broad `top < update row` range:

```js
const board = page.locator('.epm-project-board').first();
const boardBox = await board.boundingBox();
const railStyle = await board.evaluate((node) => {
    const style = window.getComputedStyle(node, '::before');
    return {
        content: style.content,
        left: Number.parseFloat(style.left),
        top: Number.parseFloat(style.top),
        width: Number.parseFloat(style.width),
    };
});
const railCenterX = boardBox.x + railStyle.left + (railStyle.width / 2);
const toggleCenterX = toggleBox.x + (toggleBox.width / 2);
const railStartY = boardBox.y + railStyle.top;
const toggleCenterY = toggleBox.y + (toggleBox.height / 2);
expect(railStyle.content).not.toBe('none');
expect(Math.abs(railCenterX - toggleCenterX)).toBeLessThanOrEqual(2);
expect(Math.abs(railStartY - toggleCenterY)).toBeLessThanOrEqual(4);
```

- [ ] **Step 4: Run the visual test and confirm it fails before implementation**

Run:

```bash
npm run build
npx playwright test tests/ui/epm_portfolio_header_visual.spec.js
```

Expected result before implementation: FAIL on the new DOM, typography, update-style, separator, or rail-alignment assertions.

---

### Task 2: Rework Project Header Markup

**Files:**
- Modify: `frontend/src/epm/EpmRollupPanel.jsx`

- [ ] **Step 1: Verify the heading level**

Run:

```bash
rg -n "<h[1-6]|\\.epm-project-board-name|h3\\b" frontend/src/epm frontend/src/styles/dashboard.css
```

Expected before this implementation: `EpmRollupPanel.jsx` has `h2` only for empty states and no project-list heading above each project board; `EpmRollupTree.jsx` uses `h3` for task titles. Keep project board titles at `h3` unless this command shows a new enclosing project-list heading that changes the outline.

- [ ] **Step 2: Make the collapse button icon-only**

In `renderPortfolioHeader(project)`, keep the existing `toggleCollapsed(project)` behavior, but render the button as an icon affordance with an explicit label:

```jsx
<button
    type="button"
    className="epm-project-board-toggle"
    onClick={() => toggleCollapsed(project)}
    aria-expanded={!collapsed}
    aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${getEpmProjectDisplayName(project)}`}
>
    <span className="epm-project-board-chevron">{renderChevron()}</span>
</button>
```

- [ ] **Step 3: Render title and metadata as readable content**

Next to the toggle, render the title block. Do not render `renderProjectIcon()` in the portfolio header.

```jsx
<div className="epm-project-board-title-block">
    <h3 className="epm-project-board-name">{getEpmProjectDisplayName(project)}</h3>
    <div className="epm-project-board-meta" aria-label="Project metadata">
        {projectStatus && (
            <StatusPill className="epm-project-board-status-pill" label={projectStatus} />
        )}
        {project?.label && (
            <StatusPill className="epm-project-board-label-pill" label={project.label} />
        )}
        {project?.homeUrl && (
            <a
                className="epm-project-board-link"
                href={project.homeUrl}
                target="_blank"
                rel="noopener noreferrer"
            >
                Home
            </a>
        )}
    </div>
</div>
```

This keeps the link and pills out of the toggle and keeps the title in normal document flow.

- [ ] **Step 4: Preserve the update render call**

Keep `renderProjectUpdate(updateLine)` immediately after the header. Do not move update text into the toggle or metadata row.

---

### Task 3: Rework Latest Update Markup

**Files:**
- Modify: `frontend/src/epm/EpmRollupPanel.jsx`

- [ ] **Step 1: Keep update HTML and links intact**

Do not parse or rewrite `updateLine.messageHtml` in this pass. Continue using the existing `dangerouslySetInnerHTML` path so Home-provided emphasis, bullets, and links survive unchanged.

- [ ] **Step 2: Move date/author into normal flow**

Change `renderProjectUpdate(updateLine)` so `.epm-project-board-update-meta` is a normal child above the copy, not an absolute overlay:

```jsx
const renderProjectUpdate = (updateLine) => {
    if (!updateLine?.text) return null;
    return (
        <div className="epm-project-board-update-row" title={updateLine.title || undefined}>
            <article className="epm-project-board-update" aria-label="Latest Home update">
                {(updateLine.relativeDate || updateLine.author) && (
                    <div className="epm-project-board-update-meta">
                        {updateLine.relativeDate && <span className="epm-project-board-update-date">{updateLine.relativeDate}</span>}
                        {updateLine.author && <span className="epm-project-board-update-author">{updateLine.author}</span>}
                    </div>
                )}
                {updateLine.messageHtml ? (
                    <div className="epm-project-board-update-copy" dangerouslySetInnerHTML={{ __html: updateLine.messageHtml }} />
                ) : (
                    <span className="epm-project-board-update-copy">{updateLine.message || updateLine.text}</span>
                )}
            </article>
        </div>
    );
};
```

This intentionally drops the literal `· ` prefix from the author span in JSX because the separator belongs in CSS. Task 4 adds the separator back with `.epm-project-board-update-date + .epm-project-board-update-author::before`.

---

### Task 4: Apply the Reading-Focused CSS

**Files:**
- Modify: `frontend/src/styles/dashboard.css`

- [ ] **Step 1: Replace the header grid and recalibrate the rail**

Update the EPM project rail and header selectors so the vertical line is anchored to the icon-only collapse column, not to a decorative project icon:

```css
.epm-project-board::before {
    left: 0.78rem;
    top: 0.8rem;
    bottom: 8px;
    width: 2px;
}

.epm-project-board-header {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr);
    align-items: start;
    column-gap: 0.65rem;
    width: 100%;
    margin: 0;
    min-width: 0;
}

.epm-project-board-title-block {
    min-width: 0;
}
```

The `::before` line must visually align with the collapse button center in the Playwright fixture. If the exact `top` value needs a small adjustment after screenshots, update the CSS and the rail-position assertion together.

- [ ] **Step 2: Make the toggle compact**

Replace the existing `.epm-project-board-toggle` rule so it is an icon button, not a grid title container. This removes the old `grid-template-columns: 14px 18px minmax(0, auto)` declaration.

```css
.epm-project-board-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--epm-project-accent);
    border-radius: 6px;
    transition: background-color 0.14s ease, box-shadow 0.14s ease, color 0.14s ease;
}
```

Keep the existing hover/focus principle: a light accent surface with dark readable text, no transform.

- [ ] **Step 3: Delete dead title-hover selectors**

Delete the now-orphaned selectors:

```css
.epm-project-board-toggle:hover .epm-project-board-name,
.epm-project-board-toggle:focus-visible .epm-project-board-name {
    text-decoration: underline;
    text-underline-offset: 2px;
}
```

Do not replace them with a title underline. The collapse button is icon-only and the project title is not a button or link.

- [ ] **Step 4: Replace project-title typography**

Update `.epm-project-board-name`:

```css
.epm-project-board-name {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.95rem;
    line-height: 1.25;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-primary);
    font-weight: 650;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
    min-width: 0;
}
```

- [ ] **Step 5: Move metadata under the title**

Update `.epm-project-board-meta`:

```css
.epm-project-board-meta {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.4rem;
    flex-wrap: wrap;
    min-width: 0;
    max-width: 100%;
    margin-top: 0.25rem;
}
```

Keep `.epm-project-board-label-pill` ellipsizing long labels with `max-width: min(22rem, 100%)`.

- [ ] **Step 6: Remove the boxed-update treatment**

Update `.epm-project-board-update-row`, `.epm-project-board-update`, and `.epm-project-board-update-meta`:

```css
.epm-project-board-update-row {
    display: block;
    max-width: 72ch;
    margin: 0.45rem 0 0.75rem 2.25rem;
}

.epm-project-board-update {
    max-width: 72ch;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.9rem;
    line-height: 1.45;
    color: var(--text-primary);
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
    display: block;
    margin: 0;
    padding: 0;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
}

.epm-project-board-update-meta {
    position: static;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    background: transparent;
    white-space: normal;
    line-height: 1.2;
    padding: 0;
    margin-bottom: 0.18rem;
}
```

- [ ] **Step 7: Add the date/author separator in CSS**

Add:

```css
.epm-project-board-update-date + .epm-project-board-update-author::before {
    content: '·';
    margin-right: 0.35rem;
    color: var(--text-secondary);
}
```

This preserves the old readable separator without baking punctuation into the React text node.

- [ ] **Step 8: Keep mobile layout within the viewport**

Add or update the narrow viewport rules. Do not add an `.epm-project-board-icon { display: none; }` rule because the icon is removed from markup and the header grid already has only two columns.

```css
@media (max-width: 640px) {
    .epm-project-board-update-row {
        max-width: calc(100% - 2.15rem);
        margin-left: 2.15rem;
    }
}
```

Use an existing media-query block if one already covers this section; do not add duplicate scattered responsive rules.

- [ ] **Step 9: Confirm removed selectors stay removed**

Run:

```bash
rg -n "epm-project-board-icon|epm-project-board-toggle:hover \\.epm-project-board-name|epm-project-board-toggle:focus-visible \\.epm-project-board-name|Home ↗" frontend/src/epm/EpmRollupPanel.jsx frontend/src/styles/dashboard.css tests/ui/epm_portfolio_header_visual.spec.js
```

Expected: no matches.

---

### Task 5: Build and Run Focused Verification

**Files:**
- Test: `tests/ui/epm_portfolio_header_visual.spec.js`
- Test: `tests/ui/codebase_structure_smoke.spec.js`
- Test: `tests/ui/epm_multi_subgoal_visual.spec.js`
- Test: `tests/ui/epm_initial_config_load.spec.js`
- Test: `tests/test_epm_project_utils.js`
- Test: `tests/test_epm_view_source_guards.js`
- Test: `tests/test_epm_shell_source_guards.js`

- [ ] **Step 1: Rebuild generated assets**

Run:

```bash
npm run build
```

Expected: build succeeds and regenerates `frontend/dist/dashboard.css`, `frontend/dist/dashboard.js`, and `frontend/dist/dashboard.js.map`.

- [ ] **Step 2: Run EPM source guards**

Run:

```bash
node --test tests/test_epm_project_utils.js tests/test_epm_view_source_guards.js tests/test_epm_shell_source_guards.js
```

Expected: all tests pass.

- [ ] **Step 3: Run focused Playwright coverage**

Run:

```bash
npx playwright test tests/ui/epm_portfolio_header_visual.spec.js tests/ui/epm_multi_subgoal_visual.spec.js tests/ui/epm_initial_config_load.spec.js
```

Expected: all tests pass. The portfolio header test should write fresh screenshots under `/tmp/epm-portfolio-header-qa/`.

- [ ] **Step 4: Run sticky/collapse smoke coverage**

Run:

```bash
npx playwright test tests/ui/codebase_structure_smoke.spec.js --grep "EPM"
```

Expected: EPM collapse and sticky-header checks still pass.

- [ ] **Step 5: Confirm viewport coverage includes the awkward mid-width**

Open `tests/ui/epm_portfolio_header_visual.spec.js` and verify the viewport list includes:

```js
{ name: 'desktop', width: 1520, height: 900 },
{ name: 'medium', width: 960, height: 760 },
{ name: 'narrow', width: 520, height: 720 },
```

Expected: the portfolio header visual test writes screenshots for all three sizes.

---

### Task 6: Manual Visual QA

**Files:**
- No code changes.

- [ ] **Step 1: Inspect generated screenshots**

Open the screenshots written by the portfolio visual test:

- `/tmp/epm-portfolio-header-qa/desktop.png`
- `/tmp/epm-portfolio-header-qa/medium.png`
- `/tmp/epm-portfolio-header-qa/narrow.png`

Expected:

- project titles read as titles, not all-caps labels
- status, Jira label, and Home link are visually subordinate to the title
- update text sits directly under the project identity and reads as prose
- long labels do not overlap title or Home link
- the collapsed/expanded affordance remains obvious
- no update card shadow or floating date label remains
- the rail starts from the collapse column and does not look detached from the header

- [ ] **Step 2: Optional real-view check if local EPM credentials are available**

This is useful evidence, but it is not a completion gate. Do not block the plan if local Atlassian/Jira/Home credentials are unavailable.

Run the app locally:

```bash
python3 jira_server.py
```

Open `http://localhost:5050`, switch to EPM Active all-projects, and compare against the screenshot that triggered this plan.

Expected:

- the first viewport shows several project sections without the heavy bordered update boxes
- Home links still open in a new tab
- HTML emphasis, bullets, and links inside Home updates still render
- project collapse/expand still works
- Catch Up, Planning, and Scenario sticky behavior is unchanged when returning to ENG

---

## Completion Criteria

- `frontend/src/epm/EpmRollupPanel.jsx` changes are limited to project header/update markup.
- `frontend/src/styles/dashboard.css` changes are limited to EPM project board reading/layout selectors unless a related responsive rule must move for correctness.
- `tests/ui/epm_portfolio_header_visual.spec.js` fails before the implementation and passes after it.
- `npm run build` passes.
- EPM source guards pass.
- Focused EPM Playwright tests pass.
- Before/after screenshots are available in the implementation notes or PR notes.
- The optional credential-backed real-view check is recorded if available, but missing local EPM credentials do not block completion.
