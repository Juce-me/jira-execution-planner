# Board Epic Card Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented and committed locally 2026-10-14 on `improvement/271-board-card-layout` (issue #271): three local commits (tests, card, docs), unpushed, awaiting the operator's request to publish. The operator approved the standalone before/after mockup on 2026-10-14 ("proposed version looks good"); the chip placement was reversed during execution (see Decision 3 and the Execution ledger).

**Goal:** Make the ENG Board Epic card cleaner and consistent: the heavy status pill leaves the title row and becomes a compact chip on the progress row after the stories count, every card's title and rows start at one x, and the information is grouped into three bands (identity, progress and size, people and recency).

**Architecture:** One component (`EngBoardEpicCard.jsx`) and its Board CSS change. The status stays the shared passive `StatusPill`, reusing the existing compact `epic-status-pill` variant, so there is no new pill class, no new font size or radius and no Jira write path. A fixed lead slot (priority icon plus Project Track glyph) is reserved in CSS, not with a placeholder element, so cards without a track glyph still align.

**Tech Stack:** React 19 (`EngBoardEpicCard.jsx`), plain CSS (`board.css`), Playwright (`tests/ui`), Node `node:test` guards, esbuild (`npm run build`).

## Findings that shape the plan

1. **A Board column is not a status.** `board.columns[].statuses` holds one or more Jira statuses (`engBoardColumns.js`), so a column such as "In Progress = In Progress + Analysis" holds Epics in different statuses. The column header cannot replace the per-card status. The operator chose one consistent chip on every card, in every column.
2. **A test pins the glyph's absence.** `eng_group_board_card.spec.js` ("the card renders its three rows…") expects `.epic-track-indicator` to have count 0 on a card with no Project Track. The mockup's hidden-twin placeholder would break that and leave a hidden emoji in the DOM, so the slot is reserved with CSS only (`:has(+ .epic-track-indicator)`; the repo already uses `:has`).
3. **`.eperson` is shared with the Epic panel.** `.eng-board .m-controls > .eperson` (`board.css`) sets its own width. The card's people-row width change must be scoped to `.erow3 > .eperson`.
4. **The date leaves the activation button.** `.erow3` is a sibling of `.ecard-open`, not inside it. After the move, clicking the date no longer opens the panel. The people row already behaves this way, so this is accepted.
5. **Ratchets.** `tests/test_design_system_ratchets.js` registers only pill, chip, badge and button class hooks plus new font-family, font-size and border-radius values. The plan adds none of those: the chip reuses `status-pill`/`epic-status-pill` (0.58rem, 8px radius, both already in use) and `estories`/`eupdated` are layout hooks like `etitle`/`ekey`.
6. **Colour inheritance is already covered.** `status_column_colours.spec.js` ("Board cards, open-Epic panel and drop menu") collects every pill under `.eng-board`, including the card's, with the column-colour flag on and off. It stays valid when the pill moves rows.
7. **Custom properties.** `test_eng_board_styles.js` fails on any custom property `board.css` reads but nothing defines. The two new properties (`--ecard-track-slot`, `--ecard-lead`) are declared in `board.css` itself.
8. **Placement of an empty or unlisted status.** `resolveBoardColumnOwner` (`engBoardColumns.js`) sends any status no column holds, including an empty one, to the first column. The `Unknown` and `Waiting for Release` tests therefore find PLAT-1 in the fixture's first column (`col-1a2b3c4d`).

9. **UI/UX review (2026-10-14): an independent reviewer, then my own re-measurement of its claims in the mockup.** Confirmed: the proposal overflows its card on narrow columns. At a 400px viewport the key, SP or date sit outside the card border on 7 of 10 mock cards, and on all 10 at 360px; the current card overflows on 0 of 10 at 400px and 3 of 10 at 360px. Cause: `.ecard` and `.ecard-open` are `display: grid` with an implicit auto track, and the people row can no longer shrink (wider indent, `flex: none` labels and date). Two CSS declarations fix it (Task 2 Step 2.6, measured: 0 of 10 overflow and one uniform card height at 440, 400, 390 and 360px) and Task 1's narrow test now asserts it. Also confirmed: with "Use column colours for statuses" off (the default) the chip is the solid `.task-status` fill with white 9.28px text (white on `#69c0ff` is 1.98:1), lighter than today's 32px pill but harder to read than the tinted chip; Task 4 Step 3 takes the flag-off screenshot. Pre-existing and out of scope: empty values (`Not set`, `Unassigned`) render amber because `input.issue-person-editor-trigger` sets `color: #d48806`; label and value text is 7.4 to 9.3px; person inputs are about 16px tall; `#d48806` on white is 2.87:1.

## Decisions

Open for the operator (the reviewer's design suggestions; none is in the tasks below until answered):

- **A. Chip only where it adds information.** Show the chip only in multi-status columns or when the Epic's status is not held by its column. Single-status columns would show no chip, closer to issue #271's "status in the header", but the header would then need to list its statuses, and the operator asked for consistency across columns (Decision 1). Default: Decision 1 stands.
- **B. Label the date.** Prefix the bare date with the existing `.lbl` class as `Updated`, so the people row stays label/value pairs and the date does not read as Delivery owner's attribute. Default: not added (the approved mockup has no label).
- **C. Narrow-width date.** Hide the date below a narrow breakpoint (at 340px it takes about 85px and clips names to "Lena Fis"). `board.css` has no width breakpoint today, so this would add one. Default: not added; the overflow fix above keeps the card intact and the names clip.

Answered by the operator on 2026-10-14:

1. Status is a small chip on the progress row, after the `n of m stories` text, on every card, never a pill on the title row, and consistent across columns.
2. The proposed layout (three bands, shared lead x) is approved from the standalone mockup.

Defaults the plan executes unless you say otherwise:

3. **The chip sits after the `n of m stories` text**, before Story Points (the mockup's default variant). The plan first defaulted to the chip directly after the bar for a single x per column; the operator rejected that on 2026-10-14 during execution ("it doesn't make any sense"), so the chip's x now follows the text length. Tests and markup were flipped accordingly (child order `story-subtasks-progress`, `estories`, `status-pill`, `push`).
4. **The empty Project Track slot is accepted**, so a card without a glyph shows a blank gap between the priority icon and the title.
5. **Column header unchanged** (name, count, SP). **Person labels stay** (`Assignee`, `Delivery owner`).
6. **`No update` keeps its text.** The Delivery owner x can shift by a few pixels on the rare card with no `updated` value (the fixed-width date column was rejected as a magic number). Dated cards align exactly.

## Global Constraints

- Do not edit `frontend/dist/` by hand; run `npm run build` and commit the output (`.github/workflows/verify-frontend-build.yml` fails on a dirty post-build diff).
- Run every `node`, `npm` and `npx` command as `fnm exec --using 20 <command>` (`.nvmrc` is 20).
- Reuse the existing components and classes: `StatusPill`, `getIssueStatusClassName(status, 'epic-status-pill')`, `story-subtasks-progress-*`, `task-priority-icon`, `epic-track-indicator`, `eperson`, `IssuePersonEditor`. No new pill, chip, badge or button class; no new font-family, font-size or border-radius value.
- No transform in `:hover`/`:active`, no `transition: all`, no change to the `.ecard`, `.ecard-open` hover or focus rules.
- No Jira write path is added or widened. The chip is a passive `<span>`; drag-to-transition writes only the dragged Epic key and is untouched.
- Synthetic fixtures and screenshots only. No real Jira keys, names or data in tests, screenshots, docs or PR text. The mockup's names and keys are invented.
- No analytics event (Task 3 allowlist row).
- No agent attribution in commit or PR text; the project rule overrides any harness reminder. Commit with the operator's noreply identity (one-shot `-c user.name` / `-c user.email` flags); never the local personal address.
- Commit, push and PR creation are separate gates. Do not push without explicit operator confirmation, and follow the section 10 publication transaction in `AGENTS.md`.

## Forbidden regressions

- Card hover (column-coloured border and soft shadow on `.ecard` only), the transparent `.ecard-open` and its focus outline, Enter activation.
- Drag, drop and the status-transition flow; the card stays draggable only when transitions are enabled.
- Inline Assignee and Delivery owner editors (open, search, save, error states) keep working in the people row.
- Loading, "loaded so far" and "unavailable" states keep their text, `aria-busy` on `.erow2` and the shimmer bars.
- Long titles stay a single ellipsized line; every card keeps the same height regardless of title length (`geometry.cardHeight` assertion in the existing long-summary test).
- Board column header, folded rails, the Epic panel (including its `.eperson` widths) and Catch Up/Planning Epic headers are unchanged.
- Status colour inheritance ("Use column colours for statuses") still tints the chip.

## Review Focus

1. An Epic with no `updated` value: `No update` must stay at the right of the people row, not vanish (Task 1, test "updated date").
2. A long status name on a narrow column: the chip must never clip or overflow, the stories text yields first, and the key, SP and date stay inside the card border at one card height (Task 1, test "narrow"; the border containment is the UI/UX review's blocker).
3. An Epic whose Jira status is empty: the chip keeps the `Unknown` label (Task 1, test "status chip").
4. Children still loading or partial (`Loading work items…`, `n of m+ … loaded so far`): the chip stays and the text ellipsizes (Task 1 Step 6, progressive-loading spec).
5. Cards with and without a Project Track glyph in the same column: titles, bars and people start at one x, and the glyph stays inside its slot (Task 1, test "one x").

## File map

| File | Change |
| --- | --- |
| `frontend/src/eng/EngBoardEpicCard.jsx` | Move `StatusPill` to row 2 after the stories text; add `estories` and `eupdated` hooks; move the date to row 3 |
| `frontend/src/styles/eng/board.css` | Lead slot, row indents, chip and text sizing, date placement, scoped people-row width |
| `tests/ui/eng_group_board_card.spec.js` | Fixture option `omitFirstEpicUpdated`; four new tests; update one selector |
| `tests/ui/eng_group_board_view.spec.js` | One assertion in the progressive-loading test |
| `docs/features/eng-workflows.md`, `docs/design-system.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md` | Task 3 |
| `frontend/dist/*` | Rebuilt by `npm run build` only |

Verified to exist on 2026-10-14: every path above. `tests/ui/eng_group_board_view.spec.js` has the progressive-loading test around line 5392 (match by the `aria-busy', 'true'` assertion, not the line number).

---

### Task 1: Failing tests

**Files:**
- Modify: `tests/ui/eng_group_board_card.spec.js`, `tests/ui/eng_group_board_view.spec.js`

**Interfaces:**
- Consumes: existing helpers `openBoard(page, options)`, `col(page, id)`, `openColumnCards(page)` and fixture epics `PLAT-1` (no track, long summary, two stories, status To Do), `PLAT-2` (Committed), `PLAT-3` (Flexible, In Progress), `PLAT-4`..`PLAT-7` (no track).
- Produces: option `omitFirstEpicUpdated` (boolean, default `false`) that drops `updated` from the first Epic; hooks asserted by Tasks 2: `.erow2 > .status-pill.epic-status-pill`, `.erow2 > .estories`, `.erow3 > .eupdated`.

- [ ] **Step 1: Capture the "before" image.** On the untouched branch run `JEP_ECARD_PHASE=before fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js --browser=chromium --workers=4 -g "populated open column"`, then `cp tmp/eng-group-board-card/board-card-column.png tmp/eng-group-board-card/board-card-column-before.png`. Run the whole file once (`--workers=4`, no `-g`) and record the pass/skip counts as the baseline.

- [ ] **Step 2: Thread the fixture option**, mirroring `omitFirstEpicAssignee` at its three sites (`epicPayload` ~line 55/65, `installBoardFixture` ~177/263, `openBoard` ~293/313):
  - in the `epicPayload` options object add `omitFirstEpicUpdated = false,` and change `updated,` in the epic literal to `updated: omitFirstEpicUpdated && index === 0 ? undefined : updated,`;
  - add `omitFirstEpicUpdated = false,` to the `installBoardFixture` and `openBoard` option destructures and pass `omitFirstEpicUpdated,` wherever `omitFirstEpicAssignee,` is passed down.

- [ ] **Step 3: Add the tests** after `the card renders its three rows, and the track glyph only when set`:

```js
test('every card starts its title, progress row and people row at one x, with or without a Project Track (issue #271)', async ({ page }) => {
    await openBoard(page);
    const rows = await openColumnCards(page).evaluateAll((cards) => cards.map((card) => {
        const origin = card.getBoundingClientRect().left;
        const x = (selector) => card.querySelector(selector).getBoundingClientRect().left - origin;
        const glyph = card.querySelector('.epic-track-indicator');
        return {
            key: card.dataset.epicKey,
            hasTrack: Boolean(glyph),
            title: x('.etitle'),
            bar: x('.story-subtasks-progress'),
            people: x('.erow3 .eperson'),
            glyphClips: glyph ? glyph.scrollWidth > glyph.clientWidth + 1 : false,
        };
    }));
    // PLAT-2 (Committed) and PLAT-3 (Flexible) carry a glyph; the rest do not, so both shapes are measured.
    expect(rows.filter((row) => row.hasTrack)).toHaveLength(2);
    expect(rows.filter((row) => !row.hasTrack).length).toBeGreaterThanOrEqual(5);
    rows.forEach((row) => {
        expect(Math.abs(row.title - rows[0].title), `${row.key} title x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.bar - row.title), `${row.key} progress row x`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(row.people - row.title), `${row.key} people row x`).toBeLessThanOrEqual(0.5);
        expect(row.glyphClips, `${row.key} glyph inside its slot`).toBe(false);
    });
});

test('status is a compact passive chip after the stories count, never on the title row (issue #271)', async ({ page }) => {
    await openBoard(page, { firstEpicStatus: '' });
    const column = col(page, 'col-1a2b3c4d');
    const card = column.locator('.ecard[data-epic-key="PLAT-2"]');
    await expect(card.locator('.erow1 .status-pill')).toHaveCount(0);
    const chip = card.locator('.erow2 > .status-pill.task-status.epic-status-pill');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('To Do');
    // Passive: a span, never a button, so the card cannot write a status from here.
    expect(await chip.evaluate((node) => node.tagName)).toBe('SPAN');
    expect(await card.locator('.erow2').evaluate((row) => [...row.children].map((child) => child.classList[0])))
        .toEqual(['story-subtasks-progress', 'estories', 'status-pill', 'push']);
    // Compact: the app's epic-status-pill scale (0.58rem), smaller than the card title.
    const sizes = await card.evaluate((node) => ({
        chip: parseFloat(getComputedStyle(node.querySelector('.erow2 > .status-pill')).fontSize),
        title: parseFloat(getComputedStyle(node.querySelector('.etitle')).fontSize),
    }));
    expect(sizes.chip).toBeCloseTo(9.28, 1);
    expect(sizes.chip).toBeLessThan(sizes.title);
    // An empty Jira status keeps the existing "Unknown" label.
    await expect(column.locator('.ecard[data-epic-key="PLAT-1"] .erow2 > .status-pill')).toHaveText('Unknown');
});

test('the updated date ends the people row on the same right edge as the key and the story points (issue #271)', async ({ page }) => {
    await openBoard(page, { omitFirstEpicUpdated: true });
    const column = col(page, 'col-1a2b3c4d');
    const card = column.locator('.ecard[data-epic-key="PLAT-2"]');
    await expect(card.locator('.erow2 time')).toHaveCount(0);
    await expect(card.locator('.erow3 > time.eupdated')).toHaveText('2026-07-21');
    await expect(card.locator('.erow3 > time.eupdated')).toHaveAttribute('datetime', '2026-07-21T00:00:00.000+0000');
    const edges = await card.evaluate((node) => ({
        key: node.querySelector('.ekey').getBoundingClientRect().right,
        points: node.querySelector('.erow2 > .push').getBoundingClientRect().right,
        date: node.querySelector('.erow3 > .eupdated').getBoundingClientRect().right,
    }));
    expect(Math.abs(edges.key - edges.date)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.points - edges.date)).toBeLessThanOrEqual(1);
    // No `updated` on the Epic: the fallback keeps its place at the right edge, as a span.
    const fallback = column.locator('.ecard[data-epic-key="PLAT-1"] .erow3 > .eupdated');
    await expect(fallback).toHaveText('No update');
    expect(await fallback.evaluate((node) => node.tagName)).toBe('SPAN');
    const gap = await column.locator('.ecard[data-epic-key="PLAT-1"]').evaluate((node) => (
        node.querySelector('.ekey').getBoundingClientRect().right
        - node.querySelector('.erow3 > .eupdated').getBoundingClientRect().right));
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
});

test('in a narrow column the stories text gives way before the status chip does (issue #271)', async ({ page }) => {
    await openBoard(page, { firstEpicStatus: 'Waiting for Release' });
    // Force the squeeze deterministically: the open-column width is one custom property.
    await page.locator('.eng-board').evaluate((node) => node.style.setProperty('--board-open-w', '340px'));
    await settle(page);
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    const geometry = await card.evaluate((node) => {
        const row = node.querySelector('.erow2');
        const chip = row.querySelector('.status-pill');
        const text = row.querySelector('.estories');
        const right = node.getBoundingClientRect().right;
        const edge = (selector) => node.querySelector(selector).getBoundingClientRect().right - right;
        return {
            rowOverflow: row.scrollWidth - row.clientWidth,
            cardOverflow: node.scrollWidth - node.clientWidth,
            chipClips: chip.scrollWidth > chip.clientWidth + 1,
            chipInside: chip.getBoundingClientRect().right <= right,
            textEllipsis: getComputedStyle(text).textOverflow,
            textClips: text.scrollWidth > text.clientWidth,
            // The right rail must stay inside the card border (the grid track must not grow past it).
            keyOutside: edge('.ekey'),
            pointsOutside: edge('.erow2 > .push'),
            dateOutside: edge('.erow3 > .eupdated'),
            pointsHeight: node.querySelector('.erow2 > .push').getBoundingClientRect().height,
            cardHeight: node.getBoundingClientRect().height,
        };
    });
    const shortHeight = await col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-2"]')
        .evaluate((node) => node.getBoundingClientRect().height);
    expect(geometry.textClips, 'the stories text is the element that yields').toBe(true);
    expect(geometry.textEllipsis).toBe('ellipsis');
    expect(geometry.chipClips).toBe(false);
    expect(geometry.chipInside).toBe(true);
    expect(geometry.rowOverflow).toBeLessThanOrEqual(1);
    expect(geometry.cardOverflow).toBeLessThanOrEqual(1);
    expect(geometry.keyOutside).toBeLessThanOrEqual(1);
    expect(geometry.pointsOutside).toBeLessThanOrEqual(1);
    expect(geometry.dateOutside).toBeLessThanOrEqual(1);
    // Story Points stay on one line, so every card keeps one height.
    expect(geometry.pointsHeight).toBeLessThan(20);
    expect(Math.abs(geometry.cardHeight - shortHeight)).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 4: Update the existing overflow guard.** In `card text-bearing elements do not overflow their box` change the selector `'.ekey, .eperson b, .erow2 span, .erow2 time'` to `'.ekey, .eperson b, .erow2 span, .erow3 .eupdated'`. Keep the `>= 25` vacuous-pass guard.

- [ ] **Step 5: Run the new tests and see them fail.** `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js --browser=chromium --workers=4 -g "issue #271"`. Expected: all four FAIL against the current markup (for example `.erow2 > .status-pill` count 0, `.eupdated` not found), and `card text-bearing elements…` now fails because `.erow3 .eupdated` matches nothing, tripping the `>= 25` guard.

- [ ] **Step 6: Pin the loading state.** In `tests/ui/eng_group_board_view.spec.js`, in the progressive-loading test directly after `await expect(card.locator('.erow2')).toHaveAttribute('aria-busy', 'true');`, add:

```js
    await expect(card.locator('.erow2 > .status-pill')).toHaveCount(1);
    await expect(card.locator('.erow2 > .estories')).toContainText('Loading work items');
```

  This is the test titled `All work preserves bounded partial cards after a hard limit and retries only on request`. Run `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_view.spec.js --browser=chromium --workers=4 -g "All work preserves bounded partial cards"`; expected FAIL on the first new line (`.erow2 > .status-pill` count 0).

- [ ] **Step 7: Commit the failing tests.** `git add tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_view.spec.js`, then run `git diff --cached --stat` and read it (two files, tests only) before `git commit -m "Pin the Board card layout bands and aligned lead slot (#271)"`. After the commit run `git show --stat HEAD` and `git status`.

---

### Task 2: Card markup and CSS

**Files:**
- Modify: `frontend/src/eng/EngBoardEpicCard.jsx`, `frontend/src/styles/eng/board.css`, generated `frontend/dist/*`

**Interfaces:**
- Consumes: the hooks Task 1 asserts.
- Produces: `.erow2 > .status-pill.task-status.epic-status-pill`, `.erow2 > .estories`, `.erow3 > .eupdated`, custom properties `--ecard-track-slot` and `--ecard-lead` on `.eng-board .ecard`.

- [ ] **Step 1: Markup** in `EngBoardEpicCard.jsx`:
  1. Row 1: delete the line `<StatusPill className={getIssueStatusClassName(status)} label={status || 'Unknown'} status={status} />`.
  2. Row 2: change the bare `<span>{incomplete ? … }</span>` (the stories text) to `<span className="estories">{incomplete ? … }</span>`, leaving its contents untouched.
  3. Row 2: immediately after the closing `</span>` of `.estories`, insert `<StatusPill className={getIssueStatusClassName(status, 'epic-status-pill')} label={status || 'Unknown'} status={status} />`.
  4. Row 2: delete the whole `{epic.updated ? (<time …>…</time>) : (<span>No update</span>)}` block.
  5. Row 3: after the Delivery owner line (the last child of `.erow3`), add `{epic.updated ? (<time className="eupdated" dateTime={epic.updated}>{formatSubtaskUpdatedDate(epic.updated)}</time>) : (<span className="eupdated">No update</span>)}`.
  6. Update the file's header comment: the status pill bullet now says "the status is the shared `<StatusPill>` in its passive span form, using the compact `epic-status-pill` variant on the progress row".

- [ ] **Step 2: CSS** in `board.css` (match indentation of the surrounding rules):
  1. In the `.eng-board .ecard { … }` rule add, after `transition: …;`:

```css
            /* Lead slot: the priority icon (16px, issues.css) plus the Project Track glyph in a fixed slot, so every
               title starts at one x whether or not the Epic has a track. Rows 2 and 3 indent to the same x. */
            --ecard-track-slot: 1.0625rem;
            --ecard-lead: calc(16px + 0.4rem + var(--ecard-track-slot) + 0.4rem);
```
  2. In the group `.eng-board .erow1 > .task-priority-icon, .eng-board .erow1 > .epic-track-indicator, .eng-board .erow1 > .status-pill, .eng-board .ekey` delete the `.eng-board .erow1 > .status-pill,` line.
  3. After that group add:

```css
        .eng-board .erow1 > .epic-track-indicator {
            width: var(--ecard-track-slot);
            justify-content: center;
        }

        /* No track glyph: the priority icon keeps the glyph's slot, so the title does not move left. */
        .eng-board .erow1 > .task-priority-icon:not(:has(+ .epic-track-indicator)) {
            margin-right: calc(var(--ecard-track-slot) + 0.4rem);
        }
```
  4. In `.eng-board .erow2, .eng-board .erow3 { … }` change `padding-left: 1.65rem;` to `padding-left: var(--ecard-lead);`.
  5. Replace the rule `.eng-board .erow2 time { font-variant-numeric: tabular-nums; }` with:

```css
        .eng-board .erow2 > .status-pill {
            flex: none;
        }

        .eng-board .erow2 > .estories {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .eng-board .erow3 > .eperson {
            max-width: none;
        }

        .eng-board .erow3 > .eupdated {
            flex: none;
            margin-left: auto;
            font-variant-numeric: tabular-nums;
        }
```
  6. Narrow-column containment (UI/UX review, measured in the mockup): add `grid-template-columns: minmax(0, 1fr);` to the existing `.eng-board .ecard` rule and to the existing `.eng-board .ecard-open` rule (both are `display: grid` with an implicit auto track that otherwise grows past the card border once the people row stops shrinking), and add `white-space: nowrap;` to the existing `.eng-board .erow2 .push` rule so Story Points never wrap to a second line.

  Leave `.eng-board .eperson` (the base rule) and `.eng-board .m-controls > .eperson` untouched.

- [ ] **Step 3: Build and run the new tests.** `fnm exec --using 20 npm run build`, then `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_view.spec.js --browser=chromium --workers=4`. Expected: the four `issue #271` tests, the updated overflow guard and the progressive-loading test PASS, and the file's other tests keep the Task 1 Step 1 baseline.

- [ ] **Step 4: Guards.** `fnm exec --using 20 node --test tests/test_eng_board_styles.js tests/test_design_system_ratchets.js tests/test_design_system_hover_foundation.js tests/test_design_system_status_binding.js tests/test_design_system_write_contract.js`. Expected: 0 failures, `design_system_baseline.json` unchanged. If a ratchet fails, fix the CSS cause (a new font-size, radius, class kind or transform). Do not edit the baseline.

- [ ] **Step 5: Related Board specs.** `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_drag.spec.js tests/ui/status_column_colours.spec.js tests/ui/design_system_hover_eng.spec.js tests/ui/design_system_status_contract.spec.js tests/ui/eng_board_progressive_loading.spec.js --browser=chromium --workers=4`. Expected: no new failures against their pre-change results (record both counts).

- [ ] **Step 6: After image.** `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js --browser=chromium --workers=4 -g "populated open column"`, then `cp tmp/eng-group-board-card/board-card-column.png tmp/eng-group-board-card/board-card-column-after.png`. Open both and describe the visible difference (pill gone from the title row, chip after the stories count, one title x, date on the people row). Capture hover and focus too: the existing hover test's `card-hover-after.png` must show the unchanged column-coloured border and soft shadow.

- [ ] **Step 7: Commit.** `git add frontend/src/eng/EngBoardEpicCard.jsx frontend/src/styles/eng/board.css frontend/dist`, run `git diff --cached --stat` and read it (the two sources plus generated dist only), then `git commit -m "Group the Board Epic card into identity, progress and people bands (#271)"`. Run `git show --stat HEAD` and `git status`.

---

### Task 3: Documentation

**Files:**
- Modify: `docs/features/eng-workflows.md`, `docs/design-system.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, this plan

- [ ] **Step 1: Feature doc.** In `docs/features/eng-workflows.md`, in the Board section directly after the sentence "Hover highlights the whole Epic card …", add: "Each Epic card reads in three bands: the title row (priority, Project Track, title and key), the progress row (bar, `n of m` stories, the Epic's status as a compact chip and Story Points) and the people row (Assignee, Delivery owner and the last-updated date). Titles and rows share one left edge whether or not the Epic has a Project Track. The status is a passive chip; changing it still happens only by dragging the card to another column or from the Epic panel."

- [ ] **Step 2: Design-system map.** In `docs/design-system.md`, Status pill row, "Existing hooks / variants" cell: append "; compact `epic-status-pill` variant on the Board Epic card's progress row". Do not change the registry JSON. Run `fnm exec --using 20 node --test tests/test_design_system_ratchets.js tests/test_design_system_write_contract.js` afterwards to prove the map still parses.

- [ ] **Step 3: Ontology.** In `docs/ontology.md`, directly after the `Board Epic story progress` entry (~line 81), add an entry in the file's inline style: `- **Board Epic card layout** (aliases: Epic card, ecard; verified <date from date +%F>): [EngBoardEpicCard](../frontend/src/eng/EngBoardEpicCard.jsx) renders three bands (.erow1 identity, .erow2 progress and size, .erow3 people and recency) styled in [board.css](../frontend/src/styles/eng/board.css); status is the shared passive StatusPill with the epic-status-pill variant; the lead slot is --ecard-lead.` Then check that every path and symbol in the entry resolves with `rg`, and update the file's Coverage line to mention the card layout.

- [ ] **Step 4: Analytics allowlist.** In `docs/README_ANALYTICS.md`, No-Event Allowlist (columns `Feature action | Primary anchors | Reason | Reviewed on`), add `Board Epic card layout (status chip on the progress row, date on the people row) | frontend/src/eng/EngBoardEpicCard.jsx | Passive presentation only: no new interaction, state change or Jira write | <date from date +%F>`.

- [ ] **Step 5: Plan index.** Add this plan to `docs/plans/README.md` under "Current Planning Work", next to the other Board plans: `- [Board Epic card layout #271](EXEC-board-card-layout-271.md): <current status>`. Update this plan's `Status` line and add `## Outcome` and `## Current Accuracy` sections once executed.

- [ ] **Step 6: Commit.** Stage the five docs and this plan by name, read `git diff --cached --stat` (docs only), then `git commit -m "Document the Board Epic card layout and its analytics allowlist row (#271)"`. Run `git show --stat HEAD` and `git status`.

---

### Task 4: Gates and publication readiness

**Files:** none (verification and reporting)

- [ ] **Step 1: CI-equivalent gates.** Read each summary line and report the actual counts:
  - `fnm exec --using 20 npm run build` followed by `git status --short frontend/dist` (clean, nothing left to commit).
  - `fnm exec --using 20 node --test tests/test_*.js`: 0 failures.
  - `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests` and `.venv/bin/python -m unittest discover -s tests`: 0 failures. The diff touches no Python, so any failure is a baseline question to report, not to fix here.
  - Full Chromium run, required before push (`AGENTS.md` section 10): `fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4` (about 8 minutes): 0 failures.

- [ ] **Step 2: Headed Firefox and WebKit.** The lead slot changes emoji geometry, and headless runs place emoji ink about 2px differently. Run `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js --browser=firefox --headed --workers=1` and again with `--browser=webkit`. Expected: the `issue #271` tests pass in both, including the `glyphClips` assertion, and the existing headed Project Track glyph guard still passes. Report any engine difference with the measured numbers.

- [ ] **Step 3: Visual proof for the PR notes.** Keep `board-card-column-before.png` and `board-card-column-after.png` (synthetic fixture) for the PR notes. Add one screenshot of a multi-status column if the fixture has one; otherwise state that the chip is identical across columns by construction (one component, one class). Also capture, from the same fixture, (a) the chip with "Use column colours for statuses" off (the default; solid `.task-status` fill, white text) next to the tinted one, and describe whether it still reads as lighter than the old pill, and (b) the card at a 390px viewport, showing the key, SP and date inside the border. Settle animations before capturing.

- [ ] **Step 4: Authenticated localhost check.** If the operator has the dashboard open and signed in, reproduce the reported card in that browser and compare it with the issue screenshots; the operator signs in. Keep it read-only: numbers and visible layout only, save no screenshot of live data.

- [ ] **Step 5: Stop for publication.** Run the section 10 publication transaction checks (`git fetch`, base and head SHAs, `git status --short`, `git log --oneline origin/main..HEAD`, `git diff --name-status origin/main...HEAD`) and compare the commit list and changed paths with this plan: three commits, and only the paths in the file map plus the generated dist and docs. Report them and wait for explicit operator confirmation before any push or PR.

## Self-review (2026-10-14)

- **Spec coverage:** pill removed from row 1 (Task 2 Step 1.1, test 2); chip after the stories count on every card (Step 1.3, test 2); one title x (Step 2.1 to 2.4, test 1); date on the people row (Step 1.4 and 1.5, test 3); header unchanged and labels kept (no edit; Decisions 5); loading and partial states (Task 1 Step 6, existing aria-busy assertions); docs, analytics, ontology, plan index (Task 3); headed engines (Task 4 Step 2).
- **Placeholder scan:** the only deferred values are the two review dates, supplied by `date +%F` at execution.
- **Name consistency:** `estories`, `eupdated`, `--ecard-track-slot`, `--ecard-lead`, `omitFirstEpicUpdated` are spelled identically in tests, markup and CSS.

## Execution ledger (2026-10-14)

Executed inline on `improvement/271-board-card-layout`, in the checkout the operator is viewing. Operator scope ruling 2026-10-14: ship this layout as approved from the mockup and nothing else (no derived Epic status hint, no shared status classifier, no Story Points split); the related discovery notes are context only.

- Pre-flight: Task 1 produces the hooks and the `omitFirstEpicUpdated` option that Task 2 satisfies and Task 3 documents; no conflicts found.
- Ruling: no git worktree — repository rule forbids the worktree skill unless asked — cost if wrong: none.
- Ruling: progress is tracked in this file, not a scratch ledger — standing operator rule — cost if wrong: none.
- Baseline before any change: `eng_group_board_card.spec.js` 36 passed, 1 skipped (headed-only Project Track glyph guard), Chromium, `--workers=4`.
- Task 1: complete (commit 201e01cc). RED observed: the four `issue #271` card tests and the progressive-loading assertion fail on the old markup for the intended reasons (progress row x off by 61.8px; status pill on `.erow1`; time in `.erow2`; no chip in `.erow2`).
- Ruling (Task 1 Step 5): `card text-bearing elements do not overflow their box` still passes before the change, unlike the plan's expectation, because the `>= 25` guard is met by other matches; the selector edit stays, and the date test already asserts `.erow3 > .eupdated` exists on both the dated and the fallback card — cost if wrong: none, the date is still covered.
- Ruling (Task 2 Step 2): added `min-width: 0` to the grouped `.erow2, .erow3` rule — with the plan's CSS alone the narrow-column test failed with a 61px card overflow, because both rows are grid items with an automatic minimum width and their no-wrap content (chip, text, date, people) widened the card's track before flex could shrink anything; the plan's own Review Focus 2 needs the stories text to yield first — cost if wrong: none visible; the rows can now shrink below their content, which is the intended squeeze order.
- Operator correction (Task 2, 2026-10-14): the chip must not sit between the bar and the stories count; Decision 3's default is reversed. Markup now orders row 2 as bar, `n of m stories`, chip, Story Points (the mockup's default variant), and the pinned child order in the card spec changed to match. Ruling: the spec correction lands in the Task 2 commit instead of rewriting the unpushed Task 1 commit (201e01cc) — history stays three commits and nothing is rewritten — cost if wrong: Task 1 pins the superseded order at that one commit.

## Outcome

Implemented with changes. The implementation is now the source of truth.

- The status chip sits after the `n of m stories` text and before Story Points, not directly after the bar (Decision 3 reversed by the operator during execution); the card spec pins child order `story-subtasks-progress`, `estories`, `status-pill`, `push`.
- `.erow2` and `.erow3` also gained `min-width: 0` (ledger ruling) so the stories text, not the chip, yields in a narrow column.
- The card's one-x claim now covers the title, the progress bar and the people row; the chip's own x follows the stories text length.
- Gate results are recorded under Execution ledger, Task 4. The related discovery notes were dropped; they are not part of this change.

## Current Accuracy

Mostly accurate: Goal, Decisions, Task 1 Step 3 and Task 2 Step 1 were corrected in place to the final chip placement. The Task 1 commit (201e01cc) still pins the superseded child order; the Task 2 commit (bf474d79) corrects it.

- Task 2: complete (commit bf474d79). Card and view specs: 262 passed, 1 skipped (headed-only glyph guard), 0 failed (Chromium, `--workers=4`). Related Board specs: 134 passed, 4 failed in `eng_board_progressive_loading.spec.js` with "campaign server startup timed out" (machine load average about 37 from a concurrent unrelated test run); all four pass when re-run alone (4/4). Node guards: 72/72, baseline JSON untouched. Hover image shows the unchanged column-coloured border and soft shadow.
- Task 3: complete. Feature doc, design-system map row, ontology entry (paths and symbols resolved with `rg`), analytics allowlist row and plan index updated.
- Task 4 gates, run on the final tree: `npm run build` exit 0 and `git status --short frontend/dist` empty; `node --test tests/test_*.js` 0 failed; Python `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile` 2131 tests OK (29 skipped); Python default environment 2131 tests, 1 error in `test_oauth_route_guards` (`test_basic_mode_does_not_apply_oauth_route_guard`): the local Postgres socket is not running, environmental, and this change touches no Python file.
- Full Chromium `tests/ui` run on the final tree (`--workers=4`, 31 minutes, machine under heavy load from an unrelated run): 1588 passed, 8 skipped, 2 did not run, 14 failed; all 14 failures pass when re-run alone (16 of 16 with sibling cases), so none reproduced.
- Not run before publication, by the operator's instruction to publish: the headed Firefox and WebKit runs of the card spec, and a fresh-context whole-branch review. The PR description states this.
