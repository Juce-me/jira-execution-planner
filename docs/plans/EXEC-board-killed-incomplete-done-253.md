# Board Killed and Incomplete Closed-Work Counting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented and committed locally 2026-10-08 (issue #253), unpushed; awaiting the operator's request to push and open the PR (Task 6 Step 4). Proposed and revised the same day after three independent reviews and the operator's answers to the open decisions (see Decisions and Plan validation). Branch: `feature/253-board-killed-incomplete-done`.

**Goal:** On the ENG Board, a child work item in status `Incomplete` counts as done under its Epic (green segment, counted in "n of m"), and a child in status `Killed` is removed from the Epic's total, so neither shows up as remaining work. No Jira status is changed or written; only how the Board counts them.

**Architecture:** The classification lives in one pure module, `frontend/src/eng/engBoardCardModel.js`, in two functions that duplicate the same rule today (`computeEpicStoryProgress` for loaded Stories, `computeEpicStatusCountProgress` for the strict Board's server `statusCounts`). Both move to one private classifier with three new rules: `Killed` is excluded from the total, `Incomplete` is done, the other abandoned statuses are unchanged. No CSS, backend, route, or storage change: the done segment is already green (`.story-subtasks-progress-done`, `#52c41a`).

**Tech Stack:** Node `node:test` (model, view model, drop gate), Playwright against the mocked Board fixtures, esbuild (`npm run build`), Python `unittest` (CI gate).

## Findings that shape the plan

1. **This reverses a recorded decision.** `engBoardCardModel.js:42-51` and `tests/test_eng_board_card_model.js:83-105` deliberately keep Killed in the total as not-done ("abandoned, not delivered") and group it with Cancelled, Rejected and Won't do. Issue #253 and the operator's answers overrule that for Killed (now removed from the total) and for Incomplete (now done). The comment and the test that pins it must be replaced, not left stale; the comment also tied the Board bar to the Story-subtask bar, which this change now matches for Killed.
2. **`Incomplete` is currently "in progress".** `DEFAULT_STATUS_PHASE_RANKS` puts `incomplete` at rank 4 (`engTaskUtils.js:197`), so today it fills the blue in-progress segment, which reads as unfinished. `DEFAULT_STATUS_PHASE_RANKS` itself must not change: it also orders Epics by status (`sortEpicGroups`) and the Catch Up status filter (`engCatchUpFilters.js:110`).
3. **Drop confirmation follows the bar (operator-confirmed).** `openStoryCount` (`engBoardDrop.js:60`) is `total - done` of the same progress object (`EngBoardView.jsx:288`). After this change, dragging an Epic to a resolved status no longer counts Killed (gone from the total) or Incomplete (done) children as "open stories". D42 (`EXEC-eng-group-board.md:240`, "unresolved stories") supports it. Tasks 1 and 5 pin it.
4. **Consumers.** `computeEpicStoryProgress` / `computeEpicStatusCountProgress` are used only by the Board: `EngBoardEpicCard.jsx:39`, `EngBoardEpicPanel.jsx:63`, `EngBoardView.jsx:288` (drop gate) and `engBoardViewModel.js:91` (strict provisional counts). The panel header "n of m stories done" (`EngBoardEpicPanel.jsx:364-365`) renders only on the loaded path; while strict child pages are loading or incomplete it shows `Loading…` or `incomplete`, so the strict path is proven on the card only.
5. **The only green count element is the bar segment.** Nothing on the Board colors a count by status: the `.erow2` and `.m-sp` count text use `var(--text-secondary)`. Story status pills in the panel are already green for Killed and Incomplete (`.task-status.killed`, `.task-status.incomplete`, `epics.css:407-411`) unless "Use column colours for statuses" is on; the operator confirmed the complaint is the progress bar, so pills are out of scope.
6. **Strict total.** The strict path passes `total` (the loaded child count, `engBoardViewModel.js:91`) separately from `statusCounts`; the classifier must subtract the Killed count from that `total` or the strict text would still count Killed children.

## Cross-surface classification (for the record; this plan changes only the Board)

| Surface | Done | Killed | Incomplete | Evidence |
| --- | --- | --- | --- | --- |
| Board card and panel (after this plan) | done | excluded from total | done | `engBoardCardModel.js` |
| Story subtask bar (Catch Up, Planning) | `Done` only | excluded from total | waiting | `backend/services/eng_subtasks.py:4-6` |
| EPM project progress (Story Points) | done, incomplete | tracked separately (`killedStoryPoints`) | completed | `epmProjectUtils.mjs:27-28,343-355` |
| Statistics | `done` bucket | own bucket | own bucket; rate is `done / (done + incomplete)` | `statsUtils.js:31-35,152` |

After this plan the Board matches the Story-subtask bar and EPM on Killed, and EPM on Incomplete. Statistics still treats Incomplete as undelivered; aligning it is out of scope.

## Decisions

Answered by the operator on 2026-10-08:

1. **The complaint is the progress bar.** Killed and Incomplete children must read as closed/completed, not as To Do; their Jira status is not changed.
2. **The drop confirmation follows the bar.** Killed and Incomplete children are not open stories.
3. **Killed is taken off the total.** It is counted neither as done nor as remaining ("easier to manage"). This replaced the earlier default of "Killed counts as done and stays in the total". `Incomplete` counts as done and stays in the total.

Defaults the plan executes unless you say otherwise:

4. **Cancelled, Canceled, Rejected and Won't do are unchanged:** they stay in the total as not-done and still count as open in the drop warning. They now behave unlike Killed; moving them to the excluded set is a one-line change to the sets in Task 2.
5. **An Epic whose children are all Killed shows `0 of 0 stories`** with an empty bar, the same as an Epic with no children today.
6. **Name-based match,** like today's code, not Jira status category (the strict `statusCounts` carries only names).
7. **No cross-module import.** Only `Incomplete` needs naming (Done and the other terminal statuses are already rank 5) and `Killed` is excluded, so two small local name sets replace the earlier idea of reusing `isResolvedStatus` from `engBoardDrop.js`.

## Global Constraints

- Do not edit `frontend/dist/` by hand; rebuild and commit the output (`.github/workflows/verify-frontend-build.yml` fails on a dirty post-build diff).
- Do not change `DEFAULT_STATUS_PHASE_RANKS`, CSS, backend files, or `engBoardDrop.js`. No Jira write path is touched.
- Run every `node`, `npm` and `npx` command below as `fnm exec --using 20 <command>` (`.nvmrc` is 20; the host default is newer).
- Synthetic fixtures only; no real Jira keys, names or data in tests, screenshots or PR text.
- No analytics event: this changes only how an existing count is classified (Task 6 allowlist row).
- No agent attribution in commit or PR text (the project rule overrides any harness reminder).

## Forbidden regressions

- `To Do`, `In Progress` and every other status keep their current buckets.
- Cancelled, Canceled, Rejected, Won't do still do not fill the done segment and stay inside `total`.
- Only `Killed` leaves `total`; every other child still counts in it, and `waiting` stays the residual bucket.
- A card in the strict "loaded so far" state keeps the `N of M+` text and the loading bar.
- The drop gate still warns when a genuinely open Story (for example `To Do`) remains.
- The status pill of a Killed or Incomplete child still shows its real Jira status name.

## Files allowed to touch

| File | Change |
| --- | --- |
| `frontend/src/eng/engBoardCardModel.js` | Shared classifier; both progress functions use it; replace stale comment |
| `tests/test_eng_board_card_model.js` | Replace the "Killed is not done" test; add new cases |
| `tests/test_eng_board_view_model.js` | Update expected strict `childProgress.total` (4 to 3) |
| `tests/ui/eng_group_board_view.spec.js` | Strict card text and segment widths (near line 5410) |
| `tests/ui/eng_group_board_card.spec.js` | Optional extra-status fixture option; one new browser test |
| `tests/ui/eng_group_board_drag.spec.js` | Optional extra-status fixture option; one new confirmation test |
| `frontend/dist/**` | Regenerated by the build |
| `docs/features/eng-workflows.md`, `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, this plan | Documentation (Task 6) |

## Expected behavior

For an Epic with Stories `Done`, `Killed`, `Incomplete`, `In Progress`, `To Do`:

| | Before | After |
| --- | --- | --- |
| Total | 5 | 4 (Killed removed) |
| Card text | `1 of 5 stories` | `2 of 4 stories` |
| Done segment (green) | 20% | 50% (`Done`, `Incomplete`) |
| In-progress segment (blue) | 40% (`In Progress`, `Incomplete`) | 25% (`In Progress`) |
| Panel header (loaded path) | `1 of 5 stories done` | `2 of 4 stories done` |
| Drop to Done warns about (`total - done`) | 4 open | 2 open (`In Progress`, `To Do`) |

Strict `statusCounts { Done: 2, 'In Progress': 1, Killed: 1 }` with 4 loaded children: before `2 of 4+` (done 50%, blue 25%); after `2 of 3+` (done 66.667%, blue 33.333%).

## Acceptance criteria

1. `Incomplete` children fill the green done segment and count in `done`; `Killed` children leave the total, on the card and, on the loaded path, in the panel header. On the strict `statusCounts` path the card text and segment widths prove it (the panel shows no count while loading).
2. Cancelled, Canceled, Rejected and Won't do remain non-done and stay in `total`.
3. Status matching ignores case and surrounding whitespace.
4. Dropping an Epic with Killed or Incomplete children onto a resolved status does not count them as open: a browser case shows `has 3 open stories` (not 5) for an Epic with three To Do children plus one Killed and one Incomplete; one real `To Do` child still warns.
5. Before and after screenshots of the card are inspected and described; the painted segment shares are asserted from element geometry, not only inline style.
6. Full Node suite (Node 20), full Python suite in both environments, the four Board specs and the full Chromium `tests/ui` run pass, and a clean build leaves only the expected `frontend/dist` change.

---

### Task 0: Preflight (no code)

- [ ] **Step 1: Branch and tree.** Run `git fetch origin && git branch --show-current && git status --short && git log --oneline origin/main..HEAD`. Expected: branch `feature/253-board-killed-incomplete-done`; only this plan and `docs/plans/README.md` dirty (or already committed); no unexpected commits. If the branch name is wrong, rename it per `docs/postmortem/MRT022-agent-branded-branch-names.md`.
- [ ] **Step 2: Gate sweep.** `docs/plans/AGENTS.md` applies the startup gate sweep to plan-execution sessions: run `rg --files docs/plans | rg '/GATE-'`, open each file, and apply the weekly-review rule only to a gate that is due. This plan touches no auth, DB, Home or EPM code; record "sweep done, none relevant" here. Any gate-document update stays out of this feature's diff unless a gate is due.
- [ ] **Step 3: File map.** Confirm every file in "Files allowed to touch" exists: `ls frontend/src/eng/engBoardCardModel.js tests/test_eng_board_card_model.js tests/test_eng_board_view_model.js tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_drag.spec.js docs/features/eng-workflows.md docs/ontology.md docs/README_ANALYTICS.md docs/plans/README.md`.
- [ ] **Step 4: Decisions.** Decisions 1 to 3 are answered. Confirm defaults 4 to 7, or record the changes, in this file's Execution status before Task 1.
- [ ] **Step 5: Baseline.** Run `fnm exec --using 20 node --test tests/test_eng_board_card_model.js tests/test_eng_board_view_model.js tests/test_eng_board_drop.js tests/test_eng_board_render.js`. Expected: 44 passing, 0 failing.
- [ ] **Step 6: Clear stale evidence.** `rm -f tmp/eng-group-board-card/killed-incomplete-done-segment*.png` (`tmp/` is gitignored; confirm with `git check-ignore tmp`), so a failing run cannot be mistaken for an old image.

---

### Task 1: Pin the new behavior with failing unit tests

**Files:**
- Modify: `tests/test_eng_board_card_model.js:83-105` (replace the Killed test and its comment block)

**Interfaces:**
- Consumes: `computeEpicStoryProgress(tasks)`, `computeEpicStatusCountProgress(statusCounts, total)` from `frontend/src/eng/engBoardCardModel.js`; `openStoryCount(progress)`, `needsOpenStoryConfirmation({ status, progress })` from `frontend/src/eng/engBoardDrop.js`.
- Produces: tests only.

- [ ] **Step 1: Replace lines 83-105** (the comment block and the `Killed does not count as done` test) with:

```js
// Issue #253 reverses the earlier decision that Killed is abandoned work kept in the total:
// Killed is taken off the total (like the story-subtask bar's EXCLUDED_STATUSES) and Incomplete
// counts as done. Cancelled/Rejected/Won't do stay inside the total as not done.
const progressFor = (names) => names.map((name) => ({ fields: { status: { name } } }));

test('computeEpicStoryProgress: Incomplete counts as done and Killed leaves the total', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStoryProgress(progressFor(['Done', 'Killed', 'Incomplete', 'In Progress', 'To Do']));
    assert.equal(progress.total, 4);
    assert.equal(progress.done, 2);
    assert.equal(progress.inProgress, 1);
    assert.equal(progress.waiting, 1);
    assert.equal(progress.doneWidth, '50%');
    assert.equal(progress.inProgressWidth, '25%');
});

test('computeEpicStoryProgress: Done plus Killed is fully done; only Killed is no stories', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const fullyDone = computeEpicStoryProgress(progressFor(['Done', 'Killed']));
    assert.equal(fullyDone.total, 1);
    assert.equal(fullyDone.done, 1);
    assert.equal(fullyDone.doneWidth, '100%');
    const onlyKilled = computeEpicStoryProgress(progressFor(['Killed', 'Killed']));
    assert.equal(onlyKilled.total, 0);
    assert.equal(onlyKilled.done, 0);
    assert.equal(onlyKilled.hasProgress, false);
    assert.equal(onlyKilled.percentLabel, '0%');
});

test('computeEpicStoryProgress: Cancelled, Rejected and Won\'t do stay inside the total but not done', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStoryProgress(progressFor(['Done', 'Cancelled', 'Canceled', 'Rejected', "Won't do"]));
    assert.equal(progress.total, 5);
    assert.equal(progress.done, 1);
    assert.equal(progress.inProgress, 0);
    assert.equal(progress.waiting, 4);
});

test('computeEpicStoryProgress: status matching ignores case and surrounding whitespace', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStoryProgress(progressFor([' KILLED ', 'incomplete', ' Incomplete ']));
    assert.equal(progress.total, 2);
    assert.equal(progress.done, 2);
});

test('computeEpicStatusCountProgress: server status counts apply the same rules', async () => {
    const { computeEpicStatusCountProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const progress = computeEpicStatusCountProgress(
        { Done: 2, Killed: 1, Incomplete: 1, 'In Progress': 1, Cancelled: 1, 'To Do': 2 }, 8,
    );
    assert.equal(progress.total, 7);
    assert.equal(progress.done, 3);
    assert.equal(progress.inProgress, 1);
    assert.equal(progress.waiting, 3);
});

test('drop gate: Killed and Incomplete children are no longer open stories', async () => {
    const { computeEpicStoryProgress } = await import('../frontend/src/eng/engBoardCardModel.js');
    const { openStoryCount, needsOpenStoryConfirmation } = await import('../frontend/src/eng/engBoardDrop.js');
    const resolved = computeEpicStoryProgress(progressFor(['Done', 'Killed', 'Incomplete']));
    assert.equal(openStoryCount(resolved), 0);
    assert.equal(needsOpenStoryConfirmation({ status: 'Done', progress: resolved }), false);
    const withOpen = computeEpicStoryProgress(progressFor(['Done', 'Killed', 'To Do']));
    assert.equal(openStoryCount(withOpen), 1);
    assert.equal(needsOpenStoryConfirmation({ status: 'Done', progress: withOpen }), true);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `fnm exec --using 20 node --test tests/test_eng_board_card_model.js`
Expected: FAIL on five tests (`Incomplete counts as done and Killed leaves the total`, `Done plus Killed…`, `status matching ignores case…`, `server status counts…`, `drop gate…`), because today Killed stays in the total and Incomplete counts as in progress. The `Cancelled, Rejected and Won't do` test passes before and after: it pins the unchanged behavior. If any of the five fails to fail, stop: the premise is wrong.

---

### Task 2: One classifier for both progress functions

**Files:**
- Modify: `frontend/src/eng/engBoardCardModel.js:35-80` (comment, constants, both functions)

**Interfaces:**
- Consumes: `getStatusPhaseRank(name)` from `./engTaskUtils.js` (already imported); `buildStorySubtaskProgress` (already imported).
- Produces: unchanged exports `computeEpicStoryProgress(tasks)` and `computeEpicStatusCountProgress(statusCounts, total)`, same return shape. `classifyChildStatus` is private and returns `'excluded' | 'waiting' | 'done' | 'inProgress'`. No new import.

- [ ] **Step 1: Replace lines 35-80** (everything from the `§6.2 row 2's "n of m stories" bar` comment to the end of the file) with:

```js
// §6.2 row 2's "n of m stories" bar. The epic payload never carries how many of its stories are
// done or in progress, so this counts child stories into buckets and feeds the raw counts through
// buildStorySubtaskProgress (issues/subtaskProgressUtils.js) exactly as a story's own subtask bar
// does, rather than re-deriving the percentages by hand.
//
// Issue #253. Killed is taken off the total entirely — neither done nor remaining work, the same
// line the story-subtask bar draws (backend/services/eng_subtasks.py: EXCLUDED_STATUSES) — so an
// epic of Done + Killed reads "1 of 1". Incomplete is done even though DEFAULT_STATUS_PHASE_RANKS
// ranks it 4 (that rank is for board/status SORT order). Every other rank-5 status is done, except
// the remaining abandoned-work statuses: Cancelled, Rejected and Won't do stay IN the total but
// land in `waiting` (buildStorySubtaskProgress's residual bucket), not `done`. In progress is the
// shared rank 4.
const DONE_PHASE_RANK = 5;
const IN_PROGRESS_PHASE_RANK = 4;
const EXCLUDED_STATUS_NAMES = new Set(['killed']);
const DONE_STATUS_NAMES = new Set(['incomplete']);
const ABANDONED_STATUS_NAMES = new Set(['cancelled', 'canceled', 'rejected', "won't do"]);

function classifyChildStatus(statusName) {
    const normalized = String(statusName || '').trim().toLowerCase();
    if (EXCLUDED_STATUS_NAMES.has(normalized)) return 'excluded';
    if (ABANDONED_STATUS_NAMES.has(normalized)) return 'waiting';
    if (DONE_STATUS_NAMES.has(normalized)) return 'done';
    const rank = getStatusPhaseRank(statusName);
    if (rank === DONE_PHASE_RANK) return 'done';
    if (rank === IN_PROGRESS_PHASE_RANK) return 'inProgress';
    return 'waiting';
}

export function computeEpicStoryProgress(tasks = []) {
    const list = tasks || [];
    let done = 0;
    let inProgress = 0;
    let excluded = 0;
    list.forEach((task) => {
        const bucket = classifyChildStatus(task?.fields?.status?.name);
        if (bucket === 'excluded') excluded += 1;
        else if (bucket === 'done') done += 1;
        else if (bucket === 'inProgress') inProgress += 1;
    });
    return buildStorySubtaskProgress({ total: list.length - excluded, done, inProgress });
}

export function computeEpicStatusCountProgress(statusCounts = {}, total = 0) {
    let done = 0;
    let inProgress = 0;
    let excluded = 0;
    for (const [name, count] of Object.entries(statusCounts)) {
        const bucket = classifyChildStatus(name);
        if (bucket === 'excluded') excluded += count;
        else if (bucket === 'done') done += count;
        else if (bucket === 'inProgress') inProgress += count;
    }
    return buildStorySubtaskProgress({ total: total - excluded, done, inProgress });
}
```

- [ ] **Step 2: Run the unit tests**

Run: `fnm exec --using 20 node --test tests/test_eng_board_card_model.js tests/test_eng_board_drop.js tests/test_eng_board_render.js`
Expected: all pass. `tests/test_eng_board_view_model.js` is not in this run on purpose: its provisional-count test fails until Task 3. (Baseline before any edit: 44 passing across these three files plus the view-model file.)

---

### Task 3: Update the tests that pinned the old numbers, and prove the strict path

**Files:**
- Modify: `tests/test_eng_board_view_model.js:107-113`
- Modify: `tests/ui/eng_group_board_view.spec.js` (near line 5410, test `All work preserves bounded partial cards after a hard limit and retries only on request`)

- [ ] **Step 1: Run to see the expected failure**

Run: `fnm exec --using 20 node --test tests/test_eng_board_view_model.js`
Expected: FAIL in `pending child pages expose provisional counts…` (`childProgress.total` is now 3, not 4).

- [ ] **Step 2: Fix the view-model test.** The fixture is `statusCounts: { Done: 2, 'In Progress': 1, Killed: 1 }` with `loadedChildren: 4`. Change only `assert.equal(group.childProgress.total, 4);` to `3`. `done` stays 2 and `inProgress` stays 1.

- [ ] **Step 3: Fix and extend the strict browser spec.** Replace the line `await expect(card).toContainText('2 of 4+ work items');` with:

```js
    // Killed leaves the total (issue #253): Done 2 and In Progress 1 of the 3 that remain.
    await expect(card).toContainText('2 of 3+ work items');
    expect(await card.locator('.story-subtasks-progress-done').evaluate((el) => el.style.width)).toBe('66.667%');
    expect(await card.locator('.story-subtasks-progress-in-progress').evaluate((el) => el.style.width)).toBe('33.333%');
```

- [ ] **Step 4: Run both**

Run: `fnm exec --using 20 node --test tests/test_eng_board_view_model.js`
Expected: PASS.

Run: `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_view.spec.js --browser=chromium -g "All work preserves bounded partial cards"`
Expected: PASS (1 test). This spec bundles from source in memory (`sourceBundle`, `eng_group_board_view.spec.js:140-146`), so it does not need the build.

---

### Task 4: Browser proof of the green segment on the loaded path (card and panel)

**Files:**
- Modify: `tests/ui/eng_group_board_card.spec.js` (fixture option and one test)

**Interfaces:**
- Consumes: `openBoard(page, options)` (line 256) and `installBoardFixture(page, fieldCalls, options)` (line 145) in the spec; `storyPayload(...)` (line 77). This spec serves the committed `frontend/dist/dashboard.js` (it has no `sourceBundle` path), so its result depends on the build.
- Produces: option `extraFirstEpicStatuses` (array of status names, default `[]`) that appends one synthetic Story per name to `PLAT-1` only, with 0 Story Points so no existing sum changes.

- [ ] **Step 1: Thread the fixture option.** Add `extraFirstEpicStatuses = [],` after `excludedCapacityEpics = [],` in the destructured options of both `installBoardFixture` and `openBoard`; pass `extraFirstEpicStatuses,` after `excludedCapacityEpics,` in the `installBoardFixture(page, fieldCalls, {...})` call inside `openBoard`; and extend `storyPayload`:

```js
function storyPayload(firstStoryAssignee = 'Planner', firstEpicStoryPoints = null, firstEpicKey = 'PLAT-1', includeNoEpic = false, extraFirstEpicStatuses = []) {
```

with `, extraFirstEpicStatuses` appended to the call `storyPayload(storyAssigneeName, firstEpicStoryPoints, firstEpicKey, includeNoEpic)` (line 242). Inside the `if (key === 'PLAT-1') {` block, after the existing `rows.push({... PLAT-1 story 2 ...})`, add:

```js
            extraFirstEpicStatuses.forEach((statusName, extraIndex) => {
                rows.push({
                    id: `${actualKey}-${extraIndex + 3}`,
                    key: `${actualKey}-${extraIndex + 3}`,
                    fields: {
                        summary: `${key} story ${extraIndex + 3}`,
                        status: { name: statusName },
                        priority: { name: 'Major' },
                        issuetype: { name: 'Story' },
                        assignee: { displayName: 'Planner' },
                        updated: '2026-07-28T00:00:00.000+0000',
                        customfield_10004: 0,
                        epicKey: actualKey,
                        parentSummary: `${key} epic summary`,
                        projectKey: 'PLAT',
                        teamId: 'team-alpha',
                        teamName: 'Alpha Team',
                        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                    },
                });
            });
```

- [ ] **Step 2: Add the test** after `the card renders its three rows…` (after its closing `});`, before `Delivery owner shows "Not set"…`):

```js
test('Incomplete fills the green done segment and Killed leaves the total (issue #253)', async ({ page }) => {
    // PLAT-1 already has Done + In Progress; add Killed, Incomplete and Cancelled (stays in the total, not done).
    await openBoard(page, { extraFirstEpicStatuses: ['Killed', 'Incomplete', 'Cancelled'] });
    const card = col(page, 'col-1a2b3c4d').locator('.ecard[data-epic-key="PLAT-1"]');
    await expect(card).toBeVisible();
    // Captured before any assertion so a failing run against the old bundle still leaves the "before" image.
    await card.screenshot({ path: path.join(screenshotDir, 'killed-incomplete-done-segment.png'), animations: 'disabled' });
    // Five children, Killed off the total: Done + Incomplete done, In Progress, Cancelled waiting.
    await expect(card.locator('.erow2')).toContainText('2 of 4 stories');

    const track = card.locator('.story-subtasks-progress-track');
    const done = card.locator('.story-subtasks-progress-done');
    const inProgress = card.locator('.story-subtasks-progress-in-progress');
    // Painted geometry (the segment's share of the track), not only the inline style.
    const share = async (segment) => (await segment.boundingBox()).width / (await track.boundingBox()).width;
    expect(await share(done)).toBeCloseTo(0.5, 1);
    expect(await share(inProgress)).toBeCloseTo(0.25, 1);
    expect(await done.evaluate((el) => el.style.width)).toBe('50%');
    // The segment is the app's existing green, not a new colour.
    expect(await done.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(82, 196, 26)');

    await card.locator('.ecard-open').click();
    await expect(page.getByRole('dialog')).toContainText('2 of 4 stories done');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
});
```

- [ ] **Step 3: Prove it fails on the old bundle (this is the "before" evidence).** The committed `frontend/dist` still holds the old behavior, so do not build yet.

Run: `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js --browser=chromium -g "issue #253"`
Expected: FAIL with received text `1 of 5 stories`. Then `mv tmp/eng-group-board-card/killed-incomplete-done-segment.png tmp/eng-group-board-card/killed-incomplete-done-segment-before.png`.

- [ ] **Step 4: Build.** Run `fnm exec --using 20 npm run build`. Expected: succeeds. Record the actual `git status --short -- frontend/dist` output (the dry runs showed `dashboard.js` and `dashboard.js.map` modified and the `lazy-views-<hash>.json` manifest replaced: old file deleted, new file untracked). If `dashboard.js` shows no change, stop and investigate: the source change must reach the bundle.

- [ ] **Step 5: Verify it passes and inspect both images.**

Run: `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js --browser=chromium -g "issue #253"`
Expected: PASS. Open the `-before` and the new `killed-incomplete-done-segment.png` and describe the difference (before: green about 20%, blue about 40%, text `1 OF 5 STORIES`; after: green about 50%, blue about 25%, text `2 OF 4 STORIES`).

---

### Task 5: Browser proof that the drop confirmation no longer counts Killed and Incomplete

**Files:**
- Modify: `tests/ui/eng_group_board_drag.spec.js` (`storyPayload` at line 86, `installBoardFixture` options at line 114, one new test after `a resolution status with open stories confirms once, inside the same menu`)

**Interfaces:**
- Consumes: `openBoard(page, calls, options)` (options flow `loadDashboard` to `installBoardFixture`), `dragCard`, `dropMenu`, `menuOptions`. PLAT-1 has five children (two `Done`, three `To Do`).
- Produces: option `extraPlat1Statuses` (array of status names, default `[]`) that appends children to `PLAT-1` only.

- [ ] **Step 1: Add the fixture option.** Change `function storyPayload() {` to `function storyPayload(extraPlat1Statuses = []) {`; inside the `EPIC_SPECS.forEach` callback, after the existing `for` loop, add:

```js
        if (epicKey === 'PLAT-1') {
            extraPlat1Statuses.forEach((statusName, extraIndex) => {
                stories.push({
                    id: `${epicKey}-x${extraIndex}`,
                    key: `${epicKey}-x${extraIndex}`,
                    fields: {
                        summary: `${epicKey} extra story ${extraIndex}`,
                        status: { name: statusName },
                        priority: { name: 'Major' },
                        issuetype: { name: 'Story' },
                        assignee: null,
                        updated: '2026-07-28T00:00:00.000+0000',
                        customfield_10004: 2,
                        epicKey,
                        parentSummary: `${epicKey} epic summary`,
                        projectKey: 'PLAT',
                        teamId: 'team-alpha',
                        teamName: 'Alpha Team',
                        sprint: [{ id: selectedSprintId, name: selectedSprintName, state: 'active' }],
                    },
                });
            });
        }
```

Add `extraPlat1Statuses = [],` after `transitionFails = false,` in the `installBoardFixture` options, and change `issues: storyPayload(),` (line 184) to `issues: storyPayload(extraPlat1Statuses),`.

- [ ] **Step 2: Add the test** before `the confirmation defaults to Keep it where it is, never the destructive answer`:

```js
test('Killed and Incomplete stories are not counted as open in the confirmation (issue #253)', async ({ page }) => {
    const calls = [];
    await openBoard(page, calls, { extraPlat1Statuses: ['Killed', 'Incomplete'] });

    await dragCard(page, 'PLAT-1', 'col-done');
    await menuOptions(page).filter({ hasText: 'Done' }).click();

    // PLAT-1 keeps its three To Do stories open; Killed is off the total and Incomplete is done.
    await expect(page.locator('.eng-board-drop-warn')).toHaveText('PLAT-1 has 3 open stories');
    expect(transitionCalls(calls)).toHaveLength(0);
});
```

- [ ] **Step 3: Verify.** Before the Task 4 build, run it against the old bundle: `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_drag.spec.js --browser=chromium -g "issue #253"`. Expected: FAIL with `PLAT-1 has 5 open stories` (the old classifier counts Killed and Incomplete as open). After the Task 4 build, rerun the same command. Expected: PASS. This spec also serves the committed bundle.

---

### Task 6: Documentation, gates and publication readiness

**Files:**
- Modify: `docs/features/eng-workflows.md` (Board section, the sentence at line 83), `docs/ontology.md`, `docs/README_ANALYTICS.md`, `docs/plans/README.md`, this plan

- [ ] **Step 1: Documentation.**
  - `docs/features/eng-workflows.md` (the sentence "Opening an Epic shows its Stories and status progress."): add: "The Epic card and panel count a child in `Done` or `Incomplete` as done (green) and leave a `Killed` child out of the total; `Cancelled`, `Rejected` and `Won't do` stay in the total but not in the done segment. An Epic whose children are all Killed shows `0 of 0`, like an Epic with no children. Dropping an Epic onto a resolved status warns only about the children still open."
  - `docs/ontology.md`: under "ENG Board cross-sprint loading", add an entry in the file's inline style: `- **Board Epic story progress** (aliases: card progress bar, "n of m stories"; verified 2026-10-08): ...` naming `computeEpicStoryProgress` / `computeEpicStatusCountProgress` in [`engBoardCardModel.js`](../frontend/src/eng/engBoardCardModel.js); consumes `getStatusPhaseRank`; produces `total/done/inProgress/waiting` for `EngBoardEpicCard`, `EngBoardEpicPanel`, the drop gate (`openStoryCount` in `engBoardDrop.js`) and strict `childProgress` in `engBoardViewModel.js`; tests `test_eng_board_card_model.js`, `test_eng_board_view_model.js`, `eng_group_board_card.spec.js`, `eng_group_board_drag.spec.js`. Add "Board Epic story progress classification (2026-10-08)" to the `Coverage:` line at the top of the file. Check that every path and symbol resolves before saving.
  - `docs/README_ANALYTICS.md`, No-Event Allowlist (columns `Feature action | Primary anchors | Reason | Reviewed on`): add the row `Board Epic story progress classification (Incomplete counts as done, Killed leaves the total) | frontend/src/eng/engBoardCardModel.js | Passive presentation only: trigger none; event_type=none; event_name=none; feature_name=eng_board; typed params none. Reclassifying which statuses count in an existing count, and the resulting change to the open-stories drop warning, adds no event, parameter or dimension. | 2026-10-08` (format the cells like the neighboring rows, with code spans).
  - `docs/plans/README.md`: the index line already exists; update its wording if the decisions change the scope.

- [ ] **Step 2: Gates (CI-equivalent).** Read each summary line and report actual counts:
  - `fnm exec --using 20 node --test tests/test_*.js` (Node 20 prints TAP-style `# pass` / `# fail` lines): 0 failures.
  - `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests` and `.venv/bin/python -m unittest discover -s tests`: 0 failures. The diff touches no Python, so any failure is baseline: record the test id and compare with the known baseline failures listed in `docs/plans/EXEC-board-column-status-colours.md` (Execution status); never report green over a failure.
  - `fnm exec --using 20 npx playwright test tests/ui/eng_group_board_card.spec.js tests/ui/eng_group_board_view.spec.js tests/ui/eng_group_board_panel.spec.js tests/ui/eng_group_board_drag.spec.js --browser=chromium --workers=4`: 0 failures.
  - Full Chromium run required before push (`AGENTS.md` section 10): `fnm exec --using 20 npx playwright test tests/ui --browser=chromium --workers=4` (about 9 minutes): 0 failures.
  - `make verify-dist-clean` after a final `fnm exec --using 20 npm run build` on the committed revision.
  - Server startup (`.venv/bin/python jira_server.py`, `curl http://localhost:5050/api/test`) is required only when the diff touches Python or startup paths; this plan does not, so skip and say so.

- [ ] **Step 3: Self-review the diff.** Run `git status --short` and `git diff --stat`. Every changed file must be in "Files allowed to touch". Remove anything else, including stray `tmp/` artifacts that are not ignored.

- [ ] **Step 4: Stop for operator confirmation.** Do not commit, push or open a PR until the operator asks. When they do, follow the full publication transaction in `AGENTS.md` section 10 (MRT025): fetch the base and record base and head SHAs; run `git status --short`, `git log --oneline origin/main..HEAD` and `git diff --name-status origin/main...HEAD` and compare commits and paths with this plan; build at the exact proposed head; verify commit contents with `git show --stat HEAD` and `git status` before any push; send the PR body through stdin with `gh pr create --body-file -`; then prove the remote head equals the local head, read back the rendered body, check the remote changed-file list and commit count, and report the actual CI state. PR notes must include the before and after card screenshots (synthetic data), `Closes #253`, sanitized text only, and no agent attribution.

## Plan validation (dry runs, 2026-10-08, all reverted)

Pass 1 and pass 2 validated the earlier "Killed counts as done, stays in the total" design: Task 1 tests failed before the fix, the card and drag browser tests failed on the old bundle (`1 of 5 stories`, `5 open stories`) and passed after a rebuild, the full Node 20 suite passed (2,082), the CI-environment Python suite passed (2,128 tests, 29 skipped) and the full Chromium `tests/ui` run passed (1,313 passed, 8 skipped). Three independent reviewers (requirement coverage, regression tracing, plan-as-contract) found no blocker; their confirmed findings are fixed in this version (drop-gate arithmetic, build-before-run order in Task 4, strict-path panel claim, preflight, before/after screenshots and painted geometry, drop-gate browser case, analytics row format, full publication transaction, Node 20 runtime).

Pass 3 (the current design: Killed leaves the total, Incomplete is done, local name sets) was applied from this plan's own text: the five new unit tests failed on the old model (the Cancelled test passed), the three changed browser tests failed on the old code with `1 of 5 stories`, `5 open stories` and `2 of 4+` (strict), and all passed after Task 2 and the build. The implementation is now in the working tree; its results are under Execution status.

## Execution status

Implemented and committed locally on 2026-10-08 as a single commit (source, tests, regenerated `frontend/dist`, docs and this plan; find it with `git log --oneline origin/main..HEAD`), unpushed. Decisions 1 to 3 were answered by the operator on 2026-10-08 and defaults 4 to 7 were accepted by proceeding.

- Task 0 preflight: branch `feature/253-board-killed-incomplete-done` was 0 commits ahead of `origin/main`; gate sweep done, only `GATE-05` exists and its next review is 2026-10-12, not due; every file in the file map exists; baseline 44 passing across the four unit files.
- Tasks 1 to 3: five new unit tests failed first, then passed; the unit files now total 49 passing (44 baseline, 6 added, 1 replaced); strict `childProgress.total` 4 to 3 and the strict browser widths `66.667%` / `33.333%`.
- Tasks 4 and 5: both browser tests failed on the old bundle (`1 of 5 stories`; `PLAT-1 has 5 open stories`) and pass after the build. Screenshots inspected: before, green about 20% and blue about 40% with `1 OF 5 STORIES`; after, green about 50% and blue about 25% with `2 OF 4 STORIES`.
- Task 6 documentation: `docs/features/eng-workflows.md`, `docs/ontology.md` (entry plus Coverage line; every link and symbol checked to resolve), `docs/README_ANALYTICS.md` allowlist row and `docs/plans/README.md`.
- Gates, all under the pinned Node 20 where applicable:
  - `node --test tests/test_*.js`: 2,083 passed, 0 failed.
  - `JIRA_AUTH_MODE=basic CONFIG_STORAGE_BACKEND=jsonfile .venv/bin/python -m unittest discover -s tests`: 2,128 tests, OK, 29 skipped.
  - `.venv/bin/python -m unittest discover -s tests` (default environment): 2,128 tests, 1 error, 29 skipped. The error is `test_oauth_route_guards.test_basic_mode_does_not_apply_oauth_route_guard`, a psycopg database-connect failure; `EXEC-board-column-status-colours.md` already records this test as failing in the default environment only on an unmodified branch. This diff contains no Python files. It is a pre-existing environment failure, not a pass.
  - `npx playwright test tests/ui --browser=chromium --workers=4`: 1,313 passed, 8 skipped, 0 failed (9.2 minutes), including the three new or changed tests.
  - A second `npm run build` left `frontend/dist` byte-identical (same fingerprint). `make verify-dist-clean` passed on the committed revision after a rebuild at that head.
  - Server startup was not required: no Python or startup path changed. Headed Firefox and WebKit geometry runs were not required: no emoji or form-control geometry changed.
- Diff scope check: ten tracked files plus this plan, all in "Files allowed to touch", and the regenerated `frontend/dist` (`dashboard.js`, `dashboard.js.map`, and the `lazy-views-<hash>.json` manifest replaced: one deleted, one untracked).

Remaining: the operator's request to push and open the PR, then the rest of the publication transaction in Task 6 Step 4 (remote-head, rendered-body, changed-file and CI readback). Rename to `DONE-board-killed-incomplete-done-253.md` only after merge, with the top note required by `docs/plans/AGENTS.md`.

## Outcome / Current Accuracy

Pending execution.
