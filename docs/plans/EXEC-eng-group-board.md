# EXEC — ENG Group Board and compact filter bar

| Field | Value |
| --- | --- |
| Date | 2026-08-04 |
| Status | **Partially executed on `feature/eng-group-board-design` — not merge-ready.** See Execution status below |
| Surface | ENG (new `BOARD` mode) · Settings → Departments → **Boards** |
| Design source | [`assets/eng-group-board/board.html`](assets/eng-group-board/board.html) · [`assets/eng-group-board/group-board-settings.html`](assets/eng-group-board/group-board-settings.html) — approved, in-repo, open them directly |

> **Read before executing:** root `AGENTS.md`, `docs/plans/AGENTS.md`, and this file's
> Data contract (§4) and Jira API surface (§9) sections. The Execution status table is the current
> source of truth: Delivery Owner, epic `updated`, epic description, Initiative shaping, and the
> Board status route now exist. Pre-execution gap statements later in this document are historical,
> not current blockers. This plan does not define optional-sprint Board transport; use
> `SUPPORT-eng-board-optional-sprint-design.md` for that work. §5.5 is the reference configuration
> the tests assert — implement against it rather than reinterpreting the mockups.
>
> **Open the two design assets first** (row above). They are the approved design, not a
> reference: real class names, real geometry, working interactions. Where this document and an
> asset disagree, the asset is right about *appearance and behaviour* and this document is right
> about *data, routes and constraints*. See §0.
>
> **Dispatch note.** §7.4 (Catch Up's facet table) is now specified and rendered in
> `board.html`, so Catch Up's bar migration is dispatchable. The §6.3 description-authenticity
> flag remains a genuine open item. The Board view, the Board filter bar, Board Settings and
> Catch Up's bar are each implementation-ready on their own.

---

## Execution status

Branch `feature/eng-group-board-design`. The 2026-08-08 continuation closes the five defects found
by the first live-Jira pass plus the final review's merge blockers. Every continuation slice was
implemented, reviewed by a separate agent, and any finding was fixed and re-reviewed. **That is
still not live acceptance**: the Playwright suite uses route-fulfilled fixtures, so the OAuth route
and running UI remain a manual gate. Treat "executed" as "code landed and focused-test reviewed",
not as "verified working against this Jira tenant".

| § | Deliverable | State |
| --- | --- | --- |
| §6.5.7 | `engModeState.js` extraction | ✅ executed |
| §9.1, O11 | Delivery Owner field, config + getter + Admin→Mapping UI | ✅ executed; **default deleted, O11 closed** |
| §9.2, §9.3 | `GET /api/issues/description`, `GET /api/board-config/statuses` | ✅ executed |
| §7.2, §7.3, §7.6 | Filter-bar facet model + shared component | ✅ executed |
| §7.4, §7.5 | Catch Up migrated onto the bar; ten filter cards removed | ✅ executed |
| §5.2, §5.3, §5.6 | `board` schema + pure validator + 3 whitelist points | ✅ executed |
| §5.4, §5.8 | Group Board composer | ✅ executed |
| §5.1, D23 | Boards sub-tab + Team groups entry | ✅ executed |
| §5.7, D45 | 409 must not discard a dirty Board draft | ✅ executed |
| §6.5 | Fifth ENG mode + all fallthrough sites | ✅ executed |
| §6.1, §6.1.2 | Board columns + the one-focused-column invariant | ✅ executed |
| §6.2, §8, D41 | Epic card and Board search | ✅ executed; Product/Tech Jira-project inheritance correction pending the optional-sprint production follow-up |
| §7.2 | Board's own facet set | ✅ executed |
| §6.3 | Epic detail panel | ✅ executed |
| §6.4, §9.5, D42 | Card drag-and-drop + unresolved-story gate | ✅ executed |
| §6.1.1, D28 | Measured compact / Planning / filter-bar / epic sticky stack | ✅ corrected in `2f8eb31`, focus threshold aligned in `37f1161` |
| §6.1, §9.4 | Name-based default columns + Epic workflow status source | ✅ corrected in `cfdbb69`; selected-project scope fix pending commit |
| §5.1, §5.6, D45 | Group-only chrome + total Save gate + complete conflict banner | ✅ corrected in `2d25c13`, absent-board composition fixed in `9eb9dad` |
| Board runtime | Loading/error/retry, priority aliases, Board story export, Clear-all semantics | ✅ corrected in `f760301` |
| Review cleanup | Analytics allowlist, dead props/CSS, executable-plan contradictions | ✅ corrected in `a5e0b0f`, live stats cascade preserved in `f82602a` |
| §12 | Verification sweep | ⚠️ executed, but see the coverage table's 36 partial / 4 uncovered rows |
| §6.3 deferred | Mockup description sanitized | ✅ executed |

The implementation blockers are closed. Merge remains gated on the requested manual pass against
the running app and real Jira data: verify sticky hit-testing/plain clicks in Catch Up, Planning and
Board; Board loading/error/empty states; visible project statuses and name-based Reset in the
composer; group-only settings chrome; Save rejection for empty/malformed boards; priority aliases;
Board-scoped Jira export; and both Clear-all behaviors. The OAuth pass must also confirm that each
configured ENG project returns its Epic workflow statuses through
`/rest/api/3/project/{key}/statuses` with the currently consented scopes. Official Atlassian
documentation says the replaced board-configuration endpoint
requires `read:board-scope.admin:jira-software`; adding that scope and forcing re-consent remains a
user decision and is not part of this implementation.

The pre-existing epic-menu focus loss, 36 partial / 4 uncovered coverage rows, slow
`epic-counts-distribution`, and ready-to-close 414 are recorded deferred findings, not regressions
introduced or silently closed by this continuation. See `.superpowers/sdd/progress.md` and the
per-task reports under `.superpowers/sdd/board/` for the decision ledger and focused evidence.

---

## 0. Design assets — use them, don't re-derive them

Two self-contained HTML files under [`assets/eng-group-board/`](assets/eng-group-board/). Open them
in a browser; no build, no server, no dependencies.

| File | Covers |
| --- | --- |
| `board.html` | **Both ENG modes**, switchable with the mode control. `BOARD`: columns, folded rails as the chart, focus and star, epic cards, **card drag-and-drop between columns** with the scoped status menu and the refusal path, the epic detail panel with its story list, the single-row filter bar and facet popover, off-frame hints, Min/Max breach glow. Also renders **Catch up** (§7.4): stories grouped by epic on the app's own `.epic-header` / `.task-item` classes, with the same bar carrying Catch Up's facet set. |
| `group-board-settings.html` | Settings → Departments → **Boards**: the real modal shell and tabs, the group list, the column composer with both assignment paths — `+ Add status` and drag by the grip — validation states, the board preview, and the *Configure board* entry in Team groups. |

Both carry a **Design notes** panel explaining each decision in place. Each starts with
`<meta charset="utf-8">` — keep it: a plain static server sends `text/html` with no charset, and
without the tag every em dash, ellipsis and checkbox glyph in the mockups renders as mojibake.

**How to use them during implementation:**

1. **Lift the class names and CSS from the assets.** They use the app's real classes, and where
   a rule is copied from production the source file and line are in the comment above it.

   | Layer | Class the asset renders | Production source |
   | --- | --- | --- |
   | Page container | `.container`, `max-width: 1040px` | `shared/shell.css:45`, mounted at `dashboard.jsx:12957` |
   | Controls row | `.view-filters` | `shared/controls.css:164` |
   | Sprint / group / teams | `.control-field` + `.control-label` + `.sprint-dropdown-toggle` | `shared/controls.css:172,187,280` |
   | Search | `input.search-input` | `shared/controls.css:1` |
   | ENG mode switch | `.segmented-control.eng-mode-control` + `.segmented-control-button.active` | `ui/SegmentedControl.jsx`, `eng/EngModeControl.jsx`, `shared/controls.css:204,221,226`, `.active` at `:254` |
   | Compact header | `.compact-sticky-header` + `.compact-sticky-header-controls` | `shared/header.css:7,32` |
   | Story rows | `.story-subtask-row` | `eng/subtasks.css:76` (base), `:150` (`min-width: 761px`); markup `issues/IssueCard.jsx:333` |
| Story priority control | `button.task-priority-icon` | `issues/PriorityTransitionMenu.jsx:77-90` — **not** `IssueCard.jsx`, and **not** `eng/subtasks.css`. Styled at `eng/issues.css:355` |
| Story status control | `button.status-pill.task-status` | `eng/status-transitions.css:7`, `ui/StatusPill.jsx` |
   | Settings | `.component-selector`, `.component-chip`, `.remove-btn`, `.group-modal-*` | `group-editor.css:265,286,301,391` |

   **Genuinely new**, and commented as such in the source: the board itself (`.col`, `.col-head`,
   `.col-strip`, `.ecard`), the filter bar (`.filterbar`, `.chip`, `.popover`), the settings
   column container, and the affordance layer D38 adds. Everything else is production.

   Three stand-ins that must **not** ship: the mockup's `--compact-h` (use the app's
   `--compact-header-offset`, §6.1.1), its inline `--container-max` (use `.container`), and its
   `--sticky-controls-z` (an asset-only stand-in that must not map to Planning). The real app uses
   `--sticky-filterbar-z` for the filter bar (D28); no `--sticky-controls-z` exists anywhere in the
   real stylesheets.

   This list is the contract. An earlier revision claimed "very little" was new while the asset
   carried `.shell`, `.seg`, `.field` and `.compact-inner` — four chrome classes that existed in
   no stylesheet and shadowed real components. Enumerate, do not assert.
2. **Lift the geometry.** Strip width, bar direction, open-column width, centring maths,
   padding-per-focus, the rotated-label rule — all present as working CSS and JS rather than
   prose to reinterpret.
3. **Diff against them.** The assets render the §5.5 reference configuration, so a Playwright
   assertion written against the asset and against the app should agree.

**Precedence.** The assets are authoritative for appearance and interaction. This document is
authoritative for data, fields, routes, storage, permissions and performance constraints. If they
conflict on those, the document wins — and the asset should be corrected.

**Sanitisation.** `dashboard-config.json` is gitignored, so the assets carry synthetic
equivalents of everything it holds: group **Northwind**, board **1042**, project keys **PLAT-**
and **CORE-**, team names Alpha–Delta, and a synthetic epic body of the same shape and length as
the real one used to measure the description clamp. Workflow status names are real, because the
entire column design is about them.

A standing guard enforces this — run it after any edit to an asset:

```bash
.venv/bin/python scripts/check_design_assets_sanitized.py
```

It reads whatever is in the local `dashboard-config.json` and fails if any of those values
appear in a tracked design file, so it hardcodes nothing and cannot itself become a place
those values live. With no local config present, as in CI, it skips.

## 1. Goal

Add a configurable, epic-level kanban to ENG, and replace the ENG filter card rows with a
compact bar whose state survives scrolling.

Observable acceptance:

1. A new `BOARD` ENG mode renders epics in columns composed per team group.
2. Column composition is editable at Settings → Departments → **Boards**, reached from a
   *Configure board* line in Team groups, and is shared by everyone using that group.
3. The filter bar is one row, sticky, and states its active filters as removable chips.
4. No **single facet** can produce an empty board, and a board that a *combination* empties says so
   rather than going silently blank.

   > **Narrowed during execution, to what the plan actually specifies.** The only machinery this
   > document gives for the promise is D20's hide-at-zero and §7.3's last-option lock, and both are
   > per-facet by construction. Extending the guarantee to *intersections* would need the cross-facet
   > count recompute that **O6 explicitly rules out** — so the original wording promised something
   > the rest of the plan forbids building. D20's rationale ("an option that can only ever empty the
   > board is not a filter") is about one option admitting nothing, which is exactly what is
   > enforced. Two facets that each admit work but share no epics can still intersect to zero; that
   > state is legitimate, so the board states it and the chips and `Clear all` stay visible as the
   > way out. §7.4 already requires the same of Catch Up: "Empty result renders an explicit empty
   > state, not a blank list."
5. Catch Up keeps the ability to filter stories by status **and** priority, now as two
   orthogonal facets in the same bar (§7.4) — the capability is preserved, the mixed
   single-select control is not.

## 2. Problem being solved

| Symptom | Evidence |
| --- | --- |
| Filter chrome is bulky | 10 buttons locked to `9.75rem × 3.1rem` (`frontend/src/styles/stats/summary.css:123`), ~150px of vertical chrome |
| Selected filters vanish on scroll | `.compact-sticky-header` re-renders only sprint / group / teams / mode / search (`frontend/src/dashboard.jsx:13064`, group control conditionally at `:13073`); `statusFilter`, the four display toggles, sort and grouping are absent |
| Grouping choice does not persist | `groupByInitiative` is recomputed and overwritten (`frontend/src/dashboard.jsx:10481`) |
| One filter mixes three dimensions | `statusFilter` is a single radio group spanning priority, status and totals, so "high priority" and "minor" cannot coexist |

## 3. Settled design decisions

Each row is a decision already taken with the requester. Do not revisit during execution
without asking.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Light theme only | The app has no competing theme layer — four `:root` blocks (`frontend/src/styles/shared/shell.css:7`, plus `eng/epics.css:154`, `epm/project-board.css:1`, `eng/export.css:1`), all additive design tokens with no conflicting values — and no `prefers-color-scheme` anywhere. A dark theme is separate scope. |
| D2 | `BOARD` is a new fifth ENG mode | Catch Up keeps its dependency focus, planning selection and alerts wiring untouched. |
| D3 | Epic is the card; stories live in a detail panel | Per-story status stays visible one click away, so epic-as-card loses nothing. |
| D4 | Columns are composed from the selected board's statuses | Board 1042 exposes 12 statuses but groups them into only 3 columns, hiding Analysis, Blocked and Killed. The board supplies the allowed status set; the group composes the columns. |
| D5 | Status colours are unchanged | Explicitly out of scope. Column accent colour is configurable instead. |
| ~~D6~~ | ~~No drag-and-drop for epics~~ | **Reversed by D37.** The original reasoning — a column move is a status transition and the transition machinery already exists — is correct and is exactly *why* dragging works: the card is a second trigger for the existing action, not a second action. The status pill remains the click target and the keyboard path. |
| D7 | One focused column, always horizontally centred | Never stacked; the focus model is identical at every viewport width. |
| D8 | One column may be starred and then never folds | Star and focus are independent; the focused column is the centred one. |
| D9 | Folded columns are the chart | A folded column is a fixed-height track with the bar hanging from the top, length = epic count. No separate chart widget. |
| D10 | Every open column shares one width | Two different open widths produced two different card renderings and visible content bleed. |
| D11 | Epics sort by priority, highest first | Rank is the `PRIORITY_AXIS` index, so no second ordering table can drift. |
| D12 | Story rows reuse `.story-subtask-row` unchanged | See §6.3. Sorting reorders rows and never restyles them. |
| D13 | Board filters carry no status facet | Status is the column; filtering by it would only empty columns. |
| D14 | Catch Up keeps its current status filters | Catch Up is a list, so status filtering is meaningful there. The two surfaces share the bar and chip grammar, not the facet set. |
| D15 | The compact sticky header carries every Catch Up control, search included | Nothing may be lost on scroll. Reuse `.compact-sticky-header`; the filter bar sticks *below* it via a runtime offset, never under it. |
| D16 | Controls and filter bar stay at container width and centred | The app has exactly one container — `.container`, `max-width: 1040px` (`shared/shell.css:45`), mounted once at `dashboard.jsx:12957`. Same width and centring as Catch Up. Only the board itself is full-bleed. |
| D17 | The chosen panel never shrinks to fit another column | Open width is fixed, not a fit-two formula. Columns running off the frame is acceptable because the board scrolls; off-frame content gets an explicit hint. |
| D18 | Rotated column labels read bottom-to-top | `writing-mode: vertical-rl` alone runs top-to-bottom, so the label is rotated 180°. Only stacked upright letters may run top-to-bottom. |
| D19 | **Board filters act on epics; Catch Up filters act on stories** | Search is the exception and acts on both. Same bar, same chip grammar, different subject — so counts, facet vocabularies and results are not interchangeable between the two surfaces. The popover states its subject explicitly. |
| D20 | A facet option with nothing in scope is hidden, not shown at zero | An option that can only ever empty the board is not a filter. Recomputed whenever scope changes; hidden options are excluded from the "everything ticked" and last-option-locks logic. |
| D21 | Delivery track is the last facet | Coarsest cut, and the one most often left alone. |
| D22 | Story elements inherit Catch Up's editability and visual design | Whatever is editable on a story in Catch Up is editable here, rendered with the same classes. **Only placement and arrangement may differ.** A new class for a control that already exists is a review stop. |
| D23 | Group Board gets its own **Boards** sub-tab | A third sub-tab beside Team groups and Group labels. Team groups carries a one-line *Configure board* entry that summarises the setup and navigates there, so the group editor stays scannable rather than absorbing a full column composer. The Boards tab keeps the same group list, so the group is always the scope. |
| D24 | **Min/Max warn, they never block** | They control nothing: no transition is prevented and Save is not blocked. A column whose epic count falls outside its range glows red — in settings, in the preview, and on the board — and states the breach in words. The work is already in that state in Jira, so refusing to show it would only hide the problem. |
| D25 | The configuration UI inherits the app's settings design | No popup of its own and no new control vocabulary: it *is* the settings modal. Sections use `.component-selector` + `.component-selector-label`, statuses use `.component-chip` + `.component-name` + `.remove-btn`, counts use `.group-modal-meta`, warnings use `.group-modal-warning`. The only new CSS is the side-by-side column arrangement, because nothing in the app lays configuration out in columns. |
| D26 | The whole column header folds the column | Not only the `Fold` label. The star inside the header is exempt — it is its own control. A **starred column has no fold action at all**: its header carries `cursor: default` and clicking it does nothing. |
| D27 | Search also matches Delivery Owner | Search resolves against epic key, summary, assignee **and the shaped Delivery Owner when `deliveryOwnerField` is configured**, so a card can be found by the person accountable for delivery, not only its assignee. See §8. |
| D28 | Normal sticky tiers follow `shell.css`: epic `--sticky-epic-z` 50 < filter bar `--sticky-filterbar-z` 55 < Planning `--sticky-planning-z` 60 < compact `--sticky-compact-z` 70 < overlay `--sticky-control-overlay-z` 80 | Physical adjacency, not overlap, is the contract: Dashboard derives compact `C`, open-Planning `P`, and measured responsive outer filter-wrapper `F`; Planning top is `C`, filter-bar top is `C + P`, and epic top is `C + P + F`. Planning and the filter bar are not peers. `--sticky-controls-z` remains an asset-only name and must not ship. An open facet popover or Catch Up sort panel lifts the filter bar's sticky parent to `calc(overlay + 2)` while the child keeps `calc(overlay + 3)`. |
| D29 | The filter popover is sized at open time, not in CSS | `100vw` counts the scrollbar (375 vs 360 usable, which produced 11px of document overflow), and the trigger sits in a sticky bar so the room below it changes with scroll. A CSS-only `max-height` left the last facet at y=901 in a 667px viewport — unreachable, since the pinned bar means page scroll cannot reveal it. Width and max-height come from `documentElement.clientWidth` and the trigger's rect; the panel scrolls internally. |
| D30 | Sort and grouping are view controls, not facets | They change order and structure, not membership, so they never appear as chips. `ENG_EPIC_SORT_OPTIONS` verbatim (`engTaskUtils.js:180`): Priority (default) · Status · Committed ⬇ · Flexible ⬇, every one tie-broken by priority. `groupByInitiative` stays a boolean toggle. Both are Catch Up only — the Board sorts by priority inside columns (D11) and its columns *are* the grouping. |
| D31 | No *Compare with today* control | It was a review aid I added to argue for replacing the ten cards; it was never requested and is not a feature. Removed from the asset so nobody implements it. |
| D32 | **The Catch Up view below the bar is inherited and must not be touched** | Implementation replaces the filter chrome and nothing else. `.task-list`, `.epic-block`, `.epic-header`, `.task-item`, `IssueCard.jsx`, the subtask panel, dependency pills, planning selection and alerts are out of scope — see §7.5 for the explicit boundary. |
| D33 | Delivery track is multi-select: Committed · Flexible, both ticked | Both ticked is the neutral state and admits **everything, including the 65 epics with no track** — which is why the facet heading shows a neutral total rather than the sum of its options, since no option represents untracked work. Unticking one narrows to the other; the last cannot be unticked (D20). This replaces the earlier `Any` pseudo-option, so the facet now behaves like every other multi. |
| D34 | Every facet heading carries its admitted total | The number beside the heading is what the facet currently admits: its neutral total when everything is ticked, otherwise the sum of ticked options. |
| D35 | **A chip states the shorter truth: `hidden X` or `only Y`** | Enumerating everything ticked produced a 565px Status chip listing eight statuses, which wrapped the bar onto three rows. When fewer options are excluded than included the chip names the **excluded** ones — `Status hidden Killed` — otherwise it names the included ones. Names are capped at two plus `+n`; the full list stays in the chip's title and in the popover. Neutral still renders nothing. |
| D36 | **The filter bar is one row, sized to its content** | Fixed height, `flex-wrap: nowrap`, `width: max-content` with `max-width: 100%` — it sits in the layout like the controls row above it instead of stretching as a full-width band. The chips lane is the only elastic part: it clips rather than wraps and collapses trailing chips into one `+n more` that opens the popover. Below 720px the view controls may take a second row, never a third; the bar cannot scroll horizontally there, because an overflow container would clip the popover anchored inside it. |
| D37 | **Dragging an epic card to another column changes its status** | A column is a *set* of statuses, so a drop is not always one answer: one status transitions straight away, several open the app's own `StatusTransitionMenu` scoped to that column. Only transitions Jira actually offers are eligible; a drop with no eligible transition is refused and nothing moves. Drag is an accelerator layered on the existing action — see §6.4 and §9.5. |
| D38 | **Status → column assignment has an explicit non-drag path** | `+ Add status` on each column opens an in-place list and assigns on click. Drag-only was undiscoverable — chips carried `draggable` with no grip, no grab cursor and a drop target that only appeared mid-drag — and unreachable by keyboard. The picker offers every status the column does not already hold, orphans first, so it also moves a status between columns; the leftover pool is a drop target too, so a chip can be dragged back out. |
| D39 | **Production widths and shared controls are authoritative; the mockup mirrors them** | The app has one container, `.container` at `max-width: 1040px` (`shared/shell.css:45`) — there is no `.shell` and no 1560px layout. The ENG mode switch is `SegmentedControl` (`ui/SegmentedControl.jsx`) rendered by `EngModeControl` with the `eng-mode-control` hook; the sprint/group/teams pickers are `.control-field` + `.control-label` + a `*-dropdown-toggle`; search is `.search-input`; the compact lane is `.compact-sticky-header-controls`. Consumers pass the class hook and nothing else — no local CSS may change a shared control's `display`, `flex-wrap` or `height` (MRT021), and no `min-width` magic numbers or overflowing `nowrap` (MRT020). The mockup previously carried `.shell`, `.seg`, `.field` and `.compact-inner`, which existed in no stylesheet; it now renders the production classes so what an implementer lifts is what ships. |
| D40 | **Board is a fourth boolean, not an enum member** | There is no ENG mode enum: `showPlanning` / `showStats` / `showScenario` are independent booleans and Catch Up is the all-false fallthrough (`dashboard.jsx:655-657`, `:12337-12343`). So Board inherits Catch Up everywhere by default — including rendering the entire Catch Up task list beneath itself. §6.5.4 lists all eleven fallthrough sites; each is an explicit keep-or-change. Board persists in `localStorage` like the others, is available in **every** sprint state, and triggers no fetch on entry. |
| D41 | **Product/Tech is inherited from each story's Jira project; an Epic may inherit both** | Classify each story only through the configured mapping for `fields.projectKey`; issue type and Ad Hoc membership never determine Board classification. The Epic's Projects membership is the union of its complete story cohort, so an Epic spanning Product and Tech projects matches both. A story in a project mapped to `other` matches neither option. See §4.4. |
| D42 | **Moving an epic to a resolved column with open stories warns, it never blocks** | Jira's workflow decides what is *allowed* (§6.4); this decides what is *sensible*. Dropping into a column whose chosen status is `Done`, `Killed` or `Incomplete` while the epic has unresolved stories inserts one confirmation step into the same `StatusTransitionMenu` — *"DEMO-1001 has 5 open stories" · Move to Done anyway · Keep it where it is*. Blocking is wrong for the same reason D24 gives for Min/Max: the board reports on work, it does not police it. |
| D43 | **Exactly one column is focused, always** | §6.1 asserted this but nothing enforced it, and the dead state was reachable: unstar the starred column, fold the focused one, and every column folds — the board becomes bare rails with no content. Focus is now resolved through one function that cannot return nothing, and folding the focused column **transfers** focus rather than clearing it. See §6.1.2. |
| D44 | **The group validator stays pure; live-status checking is a separate, injected concern** | `backend/services/group_config.py` imports only `json` and runs on **every read** (`settings_routes.py:348,376`, `shared_group_config.py:58-66`), so it structurally cannot call Jira — and must not start, or every config load becomes a network round-trip inside a DB session. Structural validation of `board` is pure and follows the `teamLabels` precedent: an injected `normalize_group_board_fn`. Status-existence checking is advisory, happens in the composer against `/api/board-config/statuses`, and never blocks a save. See §5.6. |
| D45 | **A 409 on the unified save must not discard a Board draft** | Today the client calls `applySavedGroupsConfig(errorPayload.current)` on 409 (`dashboard.jsx:3157-3158`), which runs `setGroupDraft(normalized)` and resets the dirty baseline (`:3071-3084`) — the user's in-progress edits are destroyed and the form stops reading as dirty. Adding a column composer to that payload makes the loss much larger. See §5.7. |
| D46 | **Column order is drag-plus-keyboard; the colour palette is a fixed enum** | The composer already renders a `⠿` handle with `cursor: grab` and `title="Reorder column"` and a colour swatch `<button>` — **neither has a handler**. Affordances that promise nothing are the same defect D38 fixed for statuses. Order becomes real drag with an `Alt+←/→` keyboard equivalent; colour becomes a closed seven-value palette, which also gives §5.6 its `colour` enum. See §5.8. |

## 4. Data contract

### 4.1 Fields the board consumes

**Read the normalized shape, not Jira's.** `fetch_epic_details_bulk` flattens Jira's objects
before the frontend ever sees them (`jira_server.py:2601-2608`). Writing `epic.status.name`
against this payload yields `undefined`, and `epic.status` is `''` — falsy, not absent — when
Jira has no status. The literal producer:

```python
epic_details[key] = {
    'key': key,
    'summary': fields.get('summary'),
    'status': (fields.get('status') or {}).get('name') or '',
    'priority': (fields.get('priority') or {}).get('name') or None,
    'reporter': (fields.get('reporter') or {}).get('displayName'),
    'assignee': {'displayName': (...)} if fields.get('assignee') else None,
    'projectTrack': (fields.get(project_track_field) or {}).get('value') if ... else None,
}
```

| Field | Type on the wire | Notes |
| --- | --- | --- |
| `key`, `summary` | `str`, `str \| null` | `summary` is not defaulted |
| `status` | **`str`**, `''` when absent | **Not** `status.name`. Drives column placement |
| `priority` | **`str \| null`** | **Not** `priority.name`. One of `PRIORITY_AXIS` (`frontend/src/stats/statsConstants.js:1`) |
| `assignee` | **`{ displayName } \| null`** | The one field that stays an object — null-check before reading |
| `projectTrack` | **`str \| null`** | **Not** the raw `customfield_35024`. The option's `.value` is already flattened out |
| `reporter` | `str \| null` | Returned but consumed by nothing today; do not start rendering it without asking |
| `updated` | **New — see §9.1** | Raw ISO 8601 on the story row today, but **not fetched for epics**: `fetch_epic_details_bulk` (`jira_server.py:2571-2625`) requests `summary, status, priority, reporter, assignee, parent, epic_field, project_track_field` only. Must be added to that field list. Rendered `YYYY-MM-DD` by `formatSubtaskUpdatedDate` (`frontend/src/issues/subtaskProgressUtils.js:26`), same as stories. |
| Story points | Derived client-side | **Not read directly off the epic.** Summed from child stories' `customfield_10004` via `groupTasksByEpic` (`frontend/src/dashboard.jsx:10417-10441`, sum at `:10432-10434`) — this is existing behaviour, reused unchanged. |
| Delivery track | `projectTrack` (from `customfield_35024`) | Already a string: `Committed` / `Flexible` / `null`. The custom field id belongs in the backend field list, never in a frontend read |
| **Delivery Owner** | **`deliveryOwnerField`, no default** — see §9.1 | Type `user`. Configurable, never hardcoded (O11): the *name* "Delivery Owner" is unambiguous in the field catalog, unlike "R&D Owner" and "Rnd Owner" which each have four duplicates, but the *id* is per-instance, so the field is unset until an admin picks it and the epic payload omits `deliveryOwner` until then. |
| Epic progress | Derived client-side | Shape of `buildStorySubtaskProgress`: `{ total, done, inProgress }` |
| Column epic / SP counts | Derived client-side | Single pass over epics in the selected sprint and group |

Priority vocabulary is exactly the six `PRIORITY_AXIS` values. Jira's
`highest` / `high` / `medium` / `lowest` are aliases and do not occur on epics.
**There is no Medium.**

#### Two epic shapes exist, and they disagree — check which one you have

This is the trap. The app carries **two** differently-shaped epic payloads, and the board consumes
the first:

| Payload | Container | `status` | `assignee` | Also carries |
| --- | --- | --- | --- | --- |
| `data.epics` — the board's source | **dict keyed by epic key** (`jira_server.py:3396`) | `str` | `{displayName}` | `projectTrack`, `initiative` |
| `epicsInScope` — the alerts source | list (`backend/services/alert_epics.py:18-30`) | **`{name}`** | `{displayName}` | `labels`, `team`, `teamName`, `teamId` |

`data.epics` is a **dict, not a list** — iterate its values. Because both shapes are live,
`engTaskUtils.js:216-220` exports a defensive, named helper, `epicStatusName`, doing
`typeof x.status === 'string' ? x.status : x.status?.name`. `dashboard.jsx` carries its **own**
unnamed inline duplicate of the same ternary at `:12644-12646` — it does **not** call the named
function, so this is not itself a "reuse" precedent to point an implementer at. **Import and call
`engTaskUtils.js`'s `epicStatusName` directly, rather than reading the field directly** — a bare
`.status` read is correct only until someone points it at `epicsInScope`.

Local write-back after a transition goes through `applyLocalEpicDetailsFieldUpdate`
(`frontend/src/eng/engIssueLocalUpdates.js:46-57`), which sets flat scalars — independent
confirmation that `status`, `priority` and `projectTrack` are strings, and the shape the board's
drag-and-drop (§6.4) must write.

### 4.4 Product vs Tech: inherited from Jira project (D41)

The Board Projects facet filters **Epics**, but its source classification belongs to each child
story's Jira project. Normalize the configured Jira project mapping to explicit
`product|tech|other` values and classify each story from `fields.projectKey`. Issue type, Epic type,
key prefix, and Ad Hoc membership do not participate.

An Epic's Projects membership is the union of classifications in its complete in-scope story
cohort. Therefore an Epic with stories from both Product and Tech projects matches both options but
is still counted once. An Epic with no in-scope stories, or only stories from projects classified
`other`, matches neither narrowed option and remains visible only while the Projects facet is
neutral. Counts and filtering must wait until the complete child cohort is authoritative.

The current Board seam injects Boolean `isTechTask` into its filter pipeline and
`engBoardCardModel.js` currently defines Product as its negation. That executed seam does **not**
satisfy D41 because it classifies `other` as Product. The optional-sprint production follow-up must
replace it end to end with `classifyBoardProject(task) -> 'product'|'tech'|'other'`, including the
dashboard caller, card model, facet counts, and admission predicate. Never call
`classifyCapacityIssue`, apply its Ad Hoc override, inspect issue type, or implement Product as “not
Tech” for Board classification. Sibling Catch Up/capacity behavior is out of scope.

### 4.2 Measured distributions

Probed read-only against the live instance (Basic service credentials), epics in the
configured projects. These numbers drive the empty-state and scale decisions below.

| Measure | Result | Consequence |
| --- | --- | --- |
| Epic priorities (2000 sampled) | Minor 725, Critical 586, Major 572, Blocker 97, Low 11, Trivial 9 | Filter offers the six real values |
| Delivery Owner populated | 787 / 2000 (39%) | Needs an explicit "Not set" state |
| Delivery Owner ≠ assignee, where set | 90% | Not redundant with assignee; show both |
| Epic assignee empty | 90 / 2000 (4.5%) | `Unassigned only` is a useful facet option |
| Delivery track empty | 2258 / 3000 (75%) | Track facet must default to `Any`, or three quarters of the board disappears |
| Board 1042 columns | 3 columns over 12 statuses | Importing board columns verbatim is worse than composing |
| Epic vs story workflow | Identical; all 12 epic statuses are on the board | Epic status → column mapping is safe |

### 4.3 Historical pre-execution gaps — closed by the Execution status slices

| Gap | Detail |
| --- | --- |
| **Epic description absent** | `fetch_epic_details_bulk` returns key, summary, status, priority, reporter, assignee, projectTrack, initiative — no `description`. Jira serves it as ADF, not HTML. |
| **Delivery Owner absent** | When `deliveryOwnerField` is unset, no Delivery Owner field is requested and the shaped value is absent. |
| **Epic `updated` absent** | Same fetch never requests it either. Needed for §6.2 row 2. |
| **Board status source** | `GET /api/board-config/statuses` reads each configured ENG project's workflow catalog and flattens only its Epic statuses; the saved board's project location is a legacy fallback when no projects are configured. It never calls the admin-scoped board-configuration resource or global status catalog. |

## 5. Group Board configuration

### 5.1 Placement (D23)

Settings → **Departments** → **Boards**. A third Departments sub-tab beside the existing
`teams` and `labels` leaves, with the same split layout: the group list on the left so the
group is always the visible scope, the composer on the right.

**Team groups** keeps a one-line entry in the group editor — *Board · N columns · Configure
board →* — inserted between the two `<GroupEpicSelector>` blocks and
`<details className="group-advanced">` (`frontend/src/settings/TeamGroupsSettings.jsx:401`), so
Advanced and Danger zone stay last. The line only summarises and navigates; it holds no
controls.

Implementation notes:

- A new leaf tab id (`boards`) joins `DEPARTMENT_SETTINGS_TAB_IDS` (`dashboard.jsx:239`) and
  needs a `id="department-settings-boards-tab"` DOM id, matching the existing convention
  asserted in `tests/test_epm_settings_source_guards.js:536-551`.
- The same test asserts leaf ids are **absent** from `settingsModalAllTabs` (`:520-534`) — add
  `boards` as a leaf, not a top-level tab.

Config is **shared per group**, matching the existing group-config model.

### 5.2 Stored shape

Added to each entry of `teamGroups.groups[]`:

```jsonc
board: {
  columns: [
    {
      id: "col-7f3a91c2",         // ^col-[0-9a-f]{8}$, generated once, never reused
      name: "In progress",        // free text, 1-40 chars, case-insensitively unique
      statuses: ["In Progress", "Release"],   // real Jira status names only
      colour: "#2f80ed",          // one of the seven BOARD_COLUMN_COLOURS (§5.8)
      star: true,                 // the starred column; at most one true, zero is legal
      min: null,                  // WIP guidance, null = none
      max: null
    }
  ]
}
```

> **§5.6 is the authoritative grammar for this shape.** This example previously showed a
> human-readable slug id (`"in-progress"`) and named the star field `alwaysShow`; both contradicted
> §5.6's table and §6.1.2's `id`-keyed focus resolution, and are corrected above. Ids are opaque hex
> because column identity must survive a rename — §6.1.2 explains why keying focus and the stored
> star off `name` silently rebinds them when someone renames a column.

Rules:

- Every status belongs to at most one column. Unmapped statuses collect into a synthetic
  **Unmapped** column so no epic silently disappears.
- Only real statuses from the selected board may be referenced. No invented statuses.
- At most one column may set `alwaysShow: true`.
- A column with no statuses does not render.

**No `boardId` field in this shape, and no board-picker UI.** The app's single saved Jira board id
is already stored at `dashboard_config['board']['boardId']`,
already exposed by `GET /api/board-config` (`backend/routes/settings_routes.py:909-916`,
`authenticated_read`) and set by the existing Settings screen that calls
`POST /api/board-config` (`:920-943`, `shared_admin_write`). Every group in the app shares that
one board. Group Board uses that id only as the server-side starting point for its status catalog;
the id is not part of the group board and never renders in Team groups, the Boards list, or composer
chrome. §9.3's endpoint reads the same `get_board_config()` call server-side and takes no board id
from the request.

### 5.3 Save path and the three whitelist points

Saves ride the existing group payload: `POST /api/groups-config`
(`backend/routes/settings_routes.py:397`), policy `user_write`
(`backend/security/policy.py:94` — `:93` is the sibling `GET` policy, `authenticated_read`).
Board config must **not** ride `/api/board-config`, which is global and `shared_admin_write`
(see §5.2 — that endpoint stays untouched; Group Board only *reads* the board id it already
stores).

A new group field is silently dropped unless added in all three:

1. `frontend/src/settings/groupConfigUtils.js` normalizer
2. `backend/services/group_config.py` validator whitelist (`:100-108`)
3. `build_default_groups_config` (`backend/services/group_config.py:140-151`)

Constraints to preserve: `validate_groups_config(..., allow_empty=True)` — board validation
must not introduce a teams precondition; and the implicit-clear guard must still reject an
empty `groups` array without `clearGroups: true`.

### 5.4 Composer UI

Arranged like Jira's own board-column screen — columns side by side, each with a drag handle,
colour swatch, editable name, star, delete, `Min`/`Max` inputs, and one chip per status showing
its work-item count. A status at zero is shown at zero rather than hidden.

> **The per-status work-item count does not ship, and this is a gap in the plan rather than in the
> implementation.** Nothing in the app can supply it: `GET /api/board-config/statuses` (§9.3) returns
> the board's statuses and columns but no counts, and there is no other source of "work items per
> status on the board." The figures in §5.5's fixture (To Do (36), Analysis (22), …) are the
> mockup's, measured in Jira by hand. The composer therefore renders the chip with **no count** —
> deliberately blank rather than a misleading `0`, and distinct from the sprint-scoped **epic** count
> a column shows, which is a different number (§5.5's To Do column is 36 work items but 18 epics).
> Supplying it would need a new counts source; §9.4 bars new fan-out for the board, so a
> settings-only aggregate is a separate decision nobody has asked for. Revisit only if the requester
> wants the number.

**Two ways to put a status in a column, and the click one is primary (D38).**

| Path | Control | Notes |
| --- | --- | --- |
| Click | `+ Add status` under each column's chips | Opens an in-place list inside that column and assigns on click. Keyboard-reachable. |
| Drag | The chip, by its `⠿` grip | Accelerator. Drop targets light up across every column while a drag is live. |
| Remove | The chip's `×`, or drag it onto **Not in a column** | Both send the status back to the leftover pool. |

The picker lists **every status the column does not already hold** — orphans first, labelled
`not in a column`, then the ones held elsewhere, labelled `from <column>` — because assigning
moves a status rather than copying it. Restricting it to orphans would leave the control dead in
the reference configuration, where all twelve statuses are already mapped, and force a drag for
the most common edit. Eleven rows would double a column's height, so the list scrolls inside
itself at `max-height: 190px`.

This replaces a drag-only interaction where the chips carried `draggable` with no grip, no grab
cursor, and a drop target that only appeared once a drag was already under way — so the one
affordance was invisible until after you had guessed it existed.

**Built from existing classes (D25).** The composer is not a new design:

| Element | Existing class | Source |
| --- | --- | --- |
| Every labelled block | `.component-selector` + `.component-selector-label` | `group-editor.css:265,271` |
| Chip rows | `.selected-components-list` | `group-editor.css:279` |
| A status | `.component-chip` + `.component-name` + `.remove-btn` | `group-editor.css:286,297,301` |
| Status colour | `.task-status.<slug>`, produced by `getIssueStatusClassName()` (`frontend/src/issues/issueViewUtils.js:20-23`) | `eng/epics.css:320-355` (`:313` is the colourless base rule). **Not** `.status-pill.task-status.<slug>` — that compound selector doesn't exist in `epics.css`; `.status-pill` is a separate class from `eng/status-transitions.css:7`, owning shape/interactivity via `<StatusPill>` (`ui/StatusPill.jsx`), not colour |
| Counts, helper text | `.group-modal-meta` | `group-editor.css:391` |
| Breach / empty warnings | `.group-modal-warning` | `group-editor.css:396` |
| Summary + action stack | `.group-projects-subsection` | `team-groups.css:153` |
| Blocking errors | `.group-modal-validation` banner + footer Save | `SettingsModal.jsx:68` |
| Picker rows | `.component-chip` again, as `<button>` | Same chip, clickable — no second chip design |

New CSS is the side-by-side column container, because nothing in the app lays configuration out
in columns, plus the small affordance layer D38 requires: the chip grip, the drop-target state,
`+ Add status`, and the picker's scroll box. No new component and no popup — the picker renders
inside the column it belongs to.

> **Two measured deviations from the asset, made during execution.** A composer column is **200px**,
> not the asset's 168px, and **picker rows carry no work-item count**. At 168px a picker row's
> `from <column>` label measured **6px** — a row that cannot state its provenance has no purpose,
> and the only way to keep both at that width is `flex-wrap` on a shared control, which MRT021
> forbids. The count belongs on the **chips** ("one chip per status showing its work-item count"),
> which is where this section already puts it; the picker rows never owed one. A width floor on the
> `from <column>` label guards the fix. The asset still renders 168px.
>
> **The chip grip is deliberately not focusable.** It is a pointer-only accelerator; §10.1's keyboard
> table never lists it, and D38 exists precisely because drag was keyboard-unreachable — `+ Add
> status` and the chip's `×` are the keyboard paths, both asserted. A tabbable control with no
> keyboard action would be the worse outcome. The board preview is not new either — it reuses the board's own
`.col` / `.col-strip` / `.fill` / `.vert`, so it cannot drift from what the board renders.

Two severities, deliberately different:

- **Empty column** — invalid config, the column would render nothing. Blocks Save via the
  validation banner.
- **Min/Max breach** — a fact about the work, not the config. Reported and glowing, never
  blocking (D24).

### 5.8 Reorder, colour and numeric input (D46)

Three controls in the composer were drawn but never wired. A handle with `cursor: grab` and
`title="Reorder column"` that does nothing is worse than no handle: it is the §5.4 status-chip
defect again, one section up.

#### Column order

Order is meaningful — it is the board's left-to-right reading order, it drives the "sort by status"
axis (D30) and it decides which neighbour receives focus when a column folds (§6.1.2).

| Aspect | Rule |
| --- | --- |
| Drag | Grab `.board-column-drag`; the column follows the pointer, others shift to show the gap; drop commits |
| Drop position | Insert **before** the column whose horizontal midpoint the pointer has not yet passed; past the last midpoint, append |
| Keyboard | `Alt+←` / `Alt+→` on the focused handle moves the column one place and keeps focus on it. No new widget, no drag required |
| Announce | `aria-live="polite"`: *"Analysis moved to position 2 of 7"* |
| Persistence | Array order in `columns[]` **is** the order. No `order` field — a second source of truth would drift |
| Not draggable | The status chips inside a column already own drag (D38). Reorder is initiated **only** from the handle, never from the column body, or the two gestures collide |

#### Colour

A closed enum, not a picker. Seven values, six of which the reference configuration uses — this both
wires the swatch and gives §5.6 its `colour` enum:

```js
export const BOARD_COLUMN_COLOURS = [
  '#8c8c8c',  // grey — the default for a new column
  '#b37feb',  // violet
  '#597ef7',  // blue
  '#13c2c2',  // teal
  '#52c41a',  // green
  '#e8a11d',  // amber
  '#ff4d4f',  // red
];
```

Clicking the swatch opens a seven-cell grid beneath it, in place, built from the same
`.board-pick` box the status picker uses (§5.4) — no new popup. Arrow keys move between cells,
Enter selects, Escape closes; the current colour has `aria-checked="true"`.

Red is in the palette deliberately, and this is the one place the plan admits a genuine conflict:
red is also the breach signal (D24). The reference configuration exercises it on purpose —
**External block** is red and does *not* breach, sitting beside **Analysis** which does — so the two
readings are distinguishable in the one case that matters. Breach is a border and an animated glow;
accent is a fill. If a reviewer decides that is still too subtle, the fix is to drop red from the
palette, not to change the breach signal. Tracked as **O10**.

#### Min / Max numeric grammar

Today's handler is `Math.max(0, parseInt(raw, 10) || 0)`, which turns `abc` into `0` — a silent,
meaningful value the user never typed, and `0` is a legitimate Min.

| Input | Result |
| --- | --- |
| `""` (empty, after trim) | `null` — "no threshold". This is the only way to clear one |
| `^\d+$`, `0…9999` | That integer |
| Anything else — `abc`, `5x`, `-3`, `1.5`, `10000` | **Rejected on blur:** revert to the last valid value and mark the input `.hot` with a title saying why. Never coerce to `0` |
| `min > max` on the same column | Both inputs `.hot`, blocking error in the validation banner (§5.6) — unsatisfiable, unlike a breach |

Parse on **blur**, not on every keystroke: parsing mid-type turns `12` into `1` then `12` and fights
the caret, which is why the current code has to restore the selection manually after each render.

### 5.5 Reference configuration — the fixture tests assert

This is the exact configuration the mockups render. It is not illustrative: implement against
it, and use it as the test fixture so the shipped board can be diffed against the agreed
design. It is the Northwind group over board **1042**.

| # | Column | Colour | Star | Min | Max | Statuses (work items on the board) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | To do | `#8c8c8c` | — | — | — | To Do (36) |
| 2 | Analysis | `#b37feb` | — | **15** | — | Analysis (22) |
| 3 | Ready to start | `#597ef7` | — | — | — | Awaiting Validation (13), Postponed (6), **Pending (0)** |
| 4 | Accepted in Q | `#13c2c2` | — | — | 12 | Accepted (9) |
| 5 | External block | `#ff4d4f` | — | — | 5 | Blocked (2) |
| 6 | In progress | `#597ef7` | **★** | — | **20** | In Progress (48), Release (1) |
| 7 | Done | `#52c41a` | — | — | — | Done (260), Killed (83), Incomplete (4) |

> **Colour correction, made during execution.** Column 6 read `#2f80ed` in an earlier revision — a
> value that is **not in `BOARD_COLUMN_COLOURS`** (§5.8), which §5.6 makes a closed enum. It is a
> fourth mockup stand-in of the same kind as `--compact-h`, `--container-max`, `--sticky-controls-z`
> and `--mono`: the assets still render it, and it must not ship. Per §0 the document governs data
> constraints while the asset governs appearance, so it becomes the enum's own blue, `#597ef7` —
> the closest faithful value, and the one the neighbouring *Ready to start* column already uses.
> The validator coerces any out-of-enum value to the default grey **with a warning**, so a fixture
> built literally from the old value would have produced an unexplained coercion warning.

Invariants this fixture is chosen to exercise:

- **All 12 board statuses are mapped exactly once.** 1 + 1 + 3 + 1 + 1 + 2 + 3 = 12.
- **`Pending` has 0 work items** and must still render, at zero — a real status with no work is
  not the same as an unmapped status.
- **Exactly one column is starred** (In progress), and it is the default focus.
- **Two columns breach in opposite directions:** Analysis is 11 epics against `min 15` (4 under),
  In progress is 26 against `max 20` (6 over). Both must glow **on the board and in settings** —
  the two surfaces render one configuration, and the board asset carried only `max 20` until this
  was caught, so the under-min path went unrendered. Neither may block Save.
- **A column's accent may be red** (External block, `#ff4d4f`) *without* being a breach — the
  breach signal must stay distinguishable from a red accent (see §14).
- Sprint-scoped epic counts per column, in order: 18, 11, 9, 7, 2, 26, 14 → **87 epics**, and the
  bar scale max is 26.

Default produced by *Reset to default columns* — the second fixture, derived only from trimmed,
case-insensitive status names:

| Column | Statuses | Epics |
| --- | --- | --- |
| To Do | To Do, Analysis, Awaiting Validation, Postponed, Pending, Accepted, Blocked, Release | 48 |
| In Progress ★ | In Progress | 25 |
| Done | Done, Killed, Incomplete | 14 |

Both fixtures total 12 statuses. A test that the two are interchangeable — same status set,
different grouping — is the cheapest guard against a mapping bug.

### 5.6 The `board` schema, and where each rule is enforced (D44)

The composer can transiently reach states the stored schema rejects: deleting every column, blank
and duplicate names, id reuse after a delete, and zero starred columns. Deleting the final column
must preserve a present `{ columns: [] }` draft so unified Save blocks it; only an omitted `board`
key means unconfigured. This is the complete grammar, and — crucially — **which layer enforces each
rule**.

| Field | Type | Rule | Enforced by |
| --- | --- | --- | --- |
| `columns` | array | **1–12 entries.** Zero columns is invalid: the board would render nothing | Validator (error) |
| `columns[].id` | string | `^col-[0-9a-f]{8}$`. Generated once at creation and **never reused** — a deleted id must not come back, or per-user focus state rebinds to a different column. Malformed and duplicate ids are errors | Composer generates; validator rejects malformed and duplicate ids |
| `columns[].name` | string | Trimmed; 1–40 chars after trimming; **case-insensitively unique** within the board. Blank after trim is an error | Validator (error) |
| `columns[].colour` | string | One of the seven `BOARD_COLUMN_COLOURS` (§5.8). Anything else → the default grey | Validator (coerce + warning) |
| `columns[].star` | bool | **At most one** `true` across the board. Two or more is an error. **Zero is legal** — §6.1.2 resolves focus without a star | Validator (error) |
| `columns[].min` | int \| null | `null` or integer `0…9999`. `""` → `null` | Validator (coerce) |
| `columns[].max` | int \| null | same | Validator (coerce) |
| `min` vs `max` | — | When both are set, `min <= max`. Violation is an **error**, not a warning: it is unsatisfiable, unlike a breach which is merely true | Validator (error) |
| `columns[].statuses` | string[] | Each status appears in **at most one** column across the whole board. Duplicates are an error. An empty list is an error — the column would render nothing | Validator (error) |

**Stale statuses are a warning, never an error.** A saved status that no longer exists on the board
(renamed or deleted in Jira) must not make the config unsavable — that would strand a group behind
someone else's Jira edit. It is retained verbatim in storage, flagged in the composer, and matches
no epic at runtime.

> **Corrected during execution:** this sentence used to say the *validator* reports staleness in
> `warnings`, which contradicts the enforcement table two rows above and D44. The validator is pure
> and has **no live status source**, so it cannot detect staleness at all and correctly emits neither
> an error nor a warning. The warning is the composer's, raised against
> `GET /api/board-config/statuses`, advisory only, and never blocking. Unmapped statuses continue to collect in the synthetic
**Unmapped** column (§5.4), which is render-time behaviour and never stored.

#### Validator architecture

`validate_groups_config` is pure — `group_config.py` imports only `json` — and it runs on **every
read**, not only writes (`settings_routes.py:348,376`; `shared_group_config.py:58-66`, inside a DB
session). Putting a Jira call in it would add a network round-trip to every config load. So the
split is:

| Concern | Where | Blocking |
| --- | --- | --- |
| Structure — every row of the table above | `normalize_group_board_fn`, injected into `validate_groups_config` exactly as `normalize_group_team_labels_fn` is today (`group_config.py:29,99`), wired in `jira_server.py:2475-2485` | Yes, via `errors` |
| Status **existence** on the live board | The composer, against `GET /api/board-config/statuses` (§9.3) | No — advisory only |

Two further requirements that follow from the existing code rather than from taste:

1. There is **no named allow-list constant** to add `board` to. The whitelist is the literal dict at
   `group_config.py:100-108`; a field absent from it is silently dropped, which
   `tests/test_team_catalog_api.py:238-249` pins as intended behaviour. So the round-trip test in
   §12.1 is not optional — without it, a `board` field that is never added to that dict disappears
   with no error at all.
2. `build_default_groups_config` (`group_config.py:123`, defaults dict `:140-151`) constructs its
   group independently and already omits `teamLabels`.

   > **Corrected during execution — do not "fix" this back.** An earlier revision said to add `board`
   > there too. That is exactly the change that caused a real bug: the only value a default group
   > could carry is `{'columns': []}`, and **zero columns is a validation error**. Because this
   > validator runs on **every read**, not only on writes, every pre-existing group would then fail
   > re-validation on its *second* load — raising `InvalidSharedGroupConfig` in DB mode, and in JSON
   > mode silently discarding the user's entire saved group config and substituting an auto Default
   > group. An absent board is therefore the **omitted key**, in the defaults and in the normalized
   > dict alike, and `tests/test_group_config_service.py` pins `assertNotIn('board', …)`.

### 5.7 Saving alongside everything else, and what a 409 must not do (D45)

**Correct a premise first.** There are two unrelated things called "board config":

| | Group Board (this feature) | Global board id |
| --- | --- | --- |
| Shape | `groups[].board` | `dashboard_config['board']` |
| Route | `POST /api/groups-config` (`user_write`) | `POST /api/board-config` (`settings_routes.py:920-943`) |
| Concurrency | `baseRevision` optimistic lock | **None** |
| Dirty flag | `sharedGroupsChanged` | `isBoardConfigDirty` (`dashboard.jsx:2275`) |

They share only the footer button. This feature touches the **left** column; do not add fields to
the right one, and do not assume its lack of conflict protection is acceptable for group data.

The footer Save runs twelve sections in sequence (`dashboard.jsx:3109-3144`, then the groups POST at
`:3152`). Sections 1–9 — including the global board id — are committed **before** the groups POST.

#### 409 behaviour

The server returns `409 { error: 'group_config_conflict', message, current }` when the optimistic
`UPDATE … WHERE config_revision = baseRevision` matches no row (`shared_group_config.py:173-175`).
Today the client's handler is:

```js
if (response.status === 409 && errorPayload.current) {
    applySavedGroupsConfig(errorPayload.current);   // setGroupDraft(...) + baseline reset
}
throw new Error(errorMessage);
```

`applySavedGroupsConfig` (`dashboard.jsx:3071-3084`) overwrites `groupDraft` **and** resets
`groupDraftBaselineRef`, so the user's edits are gone and the form no longer reads as dirty. For a
one-checkbox change that is merely rude; for a column composer it discards real work.

**Required behaviour when a Board draft is dirty:**

| Rule | Detail |
| --- | --- |
| Keep the draft | Do **not** call `applySavedGroupsConfig` on 409. Store `errorPayload.current` as `groupsConfigConflict` and leave `groupDraft` alone. **Implemented for every group-draft conflict, not only a dirty `board`**: the groups POST only runs when the draft is already dirty, so narrowing to `board` would have kept silently destroying `teamIds` and label edits for no gain |
| Say so | A conflict banner in the existing `.group-modal-validation` slot: *"Team groups changed while you were editing. Your board layout is unsaved."* |
| Two explicit exits | **Discard mine** → apply the server config (today's behaviour, now a deliberate choice) · **Keep mine** → re-read `configRevision` from `current`, rebase the payload on it, and re-POST |
| Never auto-merge | Column layout is order- and identity-sensitive; a silent three-way merge would produce a board nobody designed |
| Report the partial save | Sections 1–9 already committed. The banner must say which sections saved, or the user cannot reason about the state they are in |

#### The regression test that does not exist

Backend 409 is covered (`tests/test_shared_group_config_routes.py:131-148`,
`tests/test_shared_group_config_service.py:133-161`). **No test covers the client branch.**
`tests/ui/settings_unified_save.spec.js` has one test and its POST mock always returns 200
(`:81-86`). Add to that file:

- Board section dirty → mock returns 409 with `current` → assert `groupDraft` still holds the local
  columns, the conflict banner is visible, and the modal stays open.
- **Keep mine** re-POSTs with `baseRevision` taken from `current.configRevision`, and succeeds.
- **Discard mine** applies the server config and clears dirty.
- The whole unified save with **every** section dirty, Board included, persists them together —
  the existing test only covers department + EPM.

## 6. Board UI specification

### 6.1 Columns

- Default composition is name-based: exact **In Progress** gets its own starred column;
  **Done**, **Killed**, and **Incomplete** form Done; every other real status falls to **To Do**.
  Matching is trimmed and case-insensitive, catalog order is preserved, duplicate names appear once,
  and empty phases are omitted so Reset never creates an invalid stored column.

  > **Corrected during execution: this default is a *composer* action, not a board-render-time
  > derivation.** The status catalog is loaded only by the composer, while the payload the board
  > renders from carries epic `status` as a bare string, so the derivation is **unreachable without
  > a fetch**. §6.5.5 forbids
  > exactly that ("Board additionally must not trigger any new fetch on entry… Entering Board is a
  > pure re-render"), and §9.3's own table names the composer as that endpoint's only consumer. Two
  > statements against one, and the no-fetch side is the one with a committed Playwright assertion
  > behind it. So the default is produced by the composer — *Reset to default columns*, and the board
  > a group gets when it is first composed — and **a group with no `board` config renders a
  > first-run state on the board, not a derived default**. Do not relax §6.5.5 to buy a nicer
  > first-run screen: one catalog request on Board entry would cost the plan's only hard performance
  > guarantee.

- **A group with no `board` config** renders a single first-run column holding every epic in scope,
  which must say plainly that the board is unconfigured and link to Settings → Departments →
  **Boards**. It must **not** be labelled *Unmapped*: that word means "your configuration forgot
  these statuses", which is a different and misleading thing to tell someone who has not configured
  anything yet. The asset's *Configure Group Board ↗* link is what makes this state actionable.

- **The star on the board is a session-scoped view preference, not an edit of shared config.** The
  stored `columns[].star` (§5.2) is the group's shared default and the composer owns it; a one-click
  control on the board must not rewrite shared group config for everyone. The board seeds from the
  stored value and may then be re-starred for the session, alongside focus. Both survive a mode
  round-trip and a group switch; neither is written back. The control states this, so the user is
  not surprised when a reload returns the group's default.
- A folded column is a fixed-height track (340px) with a bar hanging from the **top**,
  length = epic count ÷ largest column's epic count. The full track equals the largest
  column, stated once above the board.
- Folded strip width 36px; the vertical label is `0.74rem` at weight 600, rotated 180° so it
  reads bottom-to-top (D18).
- Exactly one column is focused. It is horizontally centred, always.
- At most one column is starred (★). A starred column never folds and its Fold control is
  withdrawn. Star and focus are independent: focusing elsewhere leaves the starred column
  open beside the focused one.
- **Folding (D26):** the entire `.col-head` is the fold target, not just the `Fold` label —
  clicking the name, the count or the story-point text all fold the column. Two exemptions:
  the star is its own control and must not fold, and a **starred column has no fold action at
  all** (`cursor: default`, header click is a no-op). Folding a folded column is done from its
  rail, which focuses it.
- Every open column shares **one fixed width**, `min(660px, 92vw)`. This is deliberately not a
  fit-two formula: the chosen panel keeps its full reading width and additional columns run
  off the frame rather than squeezing it (D17).
- The board bleeds to the viewport width rather than the `.container` 1040px cap, measured from
  `documentElement.clientWidth` so the vertical scrollbar cannot cause overflow. Controls and
  the filter bar stay at container width and centred (D16). At 1040px an open column is still
  660px, because the board is measured against the viewport and not against its container.
- Padding is computed per focus so the centre is reachable without over-scroll.
- **Off-frame hint:** when columns sit outside the visible frame, an edge affordance on that
  side shows how many and, on click, focuses the next column in that direction — so the hint
  is a control, not decoration. It carries a slow nudge animation, suppressed under
  `prefers-reduced-motion`.
- The board never stacks at any width.

### 6.1.2 Focus: one column, always (D43)

§6.1 says "exactly one column is focused". Nothing enforced it, and the dead state was reachable in
three clicks: unstar the starred column, then fold the focused one — `focused` became `null` and
**every column folded**, leaving bare rails with no content and no stated way back.

**Invariant: at all times, exactly one column is focused and open.** One function may choose focus,
and it cannot return nothing:

```js
function resolveFocus(preferred) {
  const ids = COLUMNS.map(c => c.id);
  if (preferred && ids.includes(preferred)) return preferred;
  if (starred && ids.includes(starred)) return starred;
  const withWork = COLUMNS.find(c => c.epics > 0);
  return (withWork || COLUMNS[0] || {}).id || null;
}
```

**This is `id`-keyed, not `name`-keyed like the mockup's demonstration.** `board.html`'s own JS
resolves focus and drop targets by `name` (`COLUMNS.map(c => c.name)`, `dataset.name`) and its
`COLUMNS` model has no `id` field at all. Per §0's precedence rule the document wins on this data
point: `board.columns[]` is shared, DB-backed config (§5.2) — everyone in the group sees the same
star and column layout — so one user renaming a column must not silently rebind another user's
in-progress focus, or the stored `star`, to the wrong column. `id` is stable across a rename; `name`
is not. The composer must generate real `columns[].id` values matching `^col-[0-9a-f]{8}$` (§5.6),
and the board must key every column-identity operation — focus, star, drag/drop target resolution
(§6.4), `dataset.*` attributes — off `id`, never off `name`.

| Situation | Resolution |
| --- | --- |
| Initial load, one column starred | The starred column (the reference configuration's case) |
| Initial load, **zero** starred | First column with at least one epic; if every rendered configured column contains zero epics, the first column. Deterministic, never nothing |
| Folding the focused column | Focus **transfers**, never clears: to the starred column if there is one, else the left neighbour, else the right |
| Folding the first column | Right neighbour — there is no left one |
| Unstarring the focused column | Focus is re-asserted through `resolveFocus`; the column stays focused, it simply stops being pinned |
| Focused column **renamed** in settings | Focus survives untouched — `id` did not change |
| Focused column **deleted** in settings | `resolveFocus` re-runs; a stale `id` never survives, because `preferred` is checked against the live `id`s |
| Every column empty | When every rendered configured column contains zero epics, still exactly one is focused — this does not mean a zero-column config or a column with no statuses |
| Zero columns | Not reachable: §5.6 makes an empty `columns[]` a validation error |

Verified in the asset: the invariant holds through unstarring, eight consecutive folds, and folding
the first column — **on the asset's own `name`-keyed model.** Re-verify the same total against the
`id`-keyed implementation once built; only the key changes, not the invariant. Assert it as a
**total** — after every focus-affecting action, `document.querySelectorAll('.col.is-focused').length
=== 1` — not as a set of individual cases.

### 6.1.1 Sticky header

The compact sticky header appears once the controls row leaves the viewport and carries the
full Catch Up control set: sprint, group, teams, the ENG mode control, and search. Its
contents align with the unstuck controls row so nothing shifts horizontally when it appears
(verified: **zero horizontal delta** between the first compact control and the first control in
the unstuck row — assert the delta, not a literal `left`, which moves with the centred container:
it is 24 when the viewport is narrower than `.container` and 224 at 1440. The alignment comes from
both living inside `.container`, so the compact header must not be given a negative inline margin
to bleed it wider — the mockup did that and it pushed 10px of document overflow at 360px, the same
scrollbar arithmetic as D29. Production does not bleed it: `shared/header.css:7` has padding only). It publishes its
height to the existing `--compact-header-offset` custom property. Dashboard owns the complete
ordered stack: `C = compactStickyVisible ? compactHeaderOffset : 0`,
`P = showPlanning ? planningOffset : 0`, and `F` is the measured border-box height of the outer,
responsive `.filterbar-wrap`. Planning top is `C`; filter-bar top is `C + P`, published as
`--filterbar-sticky-top`; epic top is `C + P + F`. `EngFilterBar` reports the initial outer height
through a stable callback, observes it with `ResizeObserver`, and clears it to zero on unmount;
both `EngView` and `EngBoardView` forward that callback. No 42/56/80px sticky offset may replace
the live wrapper measurement. The mockup's `--compact-h` remains an asset-only stand-in.

### 6.2 Epic card

Row 1: priority icon · delivery-track glyph (only when set) · status pill · summary · key.
Row 2: story progress bar · `n of m stories` · story points · updated date.
Row 3: `Assignee <name>` · `Delivery owner <name or "Not set">`.

Cards sort by `PRIORITY_AXIS` index, highest first, and reveal `PAGE_SIZE` at a time.

### 6.3 Epic detail panel

- Opens on card click, dismisses on outside click or Escape.
- Header reuses the app's existing controls verbatim — `.task-priority-icon`,
  `.epic-track-indicator`, `button.status-pill.task-status` — with the pill itself opening
  `.status-transition-menu`. No new labelled dropdowns wrapping controls that already exist.
- Description renders as structured text, clamped to **`11.5rem`** with a fade and a
  *Show full description* control. Panel caps at 92vh and scrolls internally.
  Measured need: a representative epic body of this shape renders **1364px tall inside a 709px panel**
  (~6 headings, nested lists, ~2,600 characters). The committed asset's placeholder equivalent
  renders 1235px tall unclamped, inside a 662px modal (92vh at 1280×720) — same conclusion, and
  the figure a reader can reproduce from the asset.

> **Resolved by human review — implementation may proceed.** This section previously called the
> asset's description body a "synthetic equivalent," while `board.html`'s own Design notes panel
> said the opposite and described the body as copied from Jira. The asset now uses synthetic text
> throughout (`board.html:893-894`, echoed at `:764`). Reviewed and confirmed safe to build against
> as-is — `scripts/check_design_assets_sanitized.py` still would not catch this either way, since
> it only diffs board id, group name and project-key tokens against local config and never
> inspects description prose.
>
> **Deferred action — completed, the last task.** After Board view implementation was verified,
> as part of the docs-update step, `board.html`'s epic-detail description body was replaced with
> lorem-ipsum placeholder prose of the same shape (six headings, nested lists, ~2,650 characters)
> — see the matching row at the end of §13's file map. The Design notes sentences that had called
> the body real (`:764`, `:893-894`, `:1016`) were corrected to describe it as a placeholder. Only
> the sanitized version ships.

#### Story rows inherit Catch Up (D22)

The story list is built on `.story-subtask-row`
(`frontend/src/styles/eng/subtasks.css:76`, and `:150` for the `min-width: 761px` block; markup
per `frontend/src/issues/IssueCard.jsx:333`). The inheritance rule is:

> Whatever is editable on a story in Catch Up is editable here, rendered with the same
> classes and the same visual design. **Only placement and arrangement may differ.**

Concretely:

| Element | Class | Editable |
| --- | --- | --- |
| Priority | `button.task-priority-icon[data-priority]` inside `span.priority-transition`, with `aria-haspopup="menu"` and `data-priority-transition-trigger="true"` (`issues/PriorityTransitionMenu.jsx:77-90`) | Yes — opens the existing priority transition menu. **The bare `.task-priority-icon` is a non-interactive `<span>`** (`dashboard.jsx:11365-11398`); only the menu's wrapper renders the `<button>`, so assert the button, not the class alone |
| Status | `button.status-pill.task-status.<slug>` | Yes — the pill is the trigger for `StatusTransitionMenu` |
| Summary | `a.story-subtask-name` | Link to Jira |
| Assignee | `span.story-subtask-assignee` | Read-only |
| Updated | `time.story-subtask-updated` | Read-only |

Do not introduce a new class for any of these. A bespoke priority span was written and then
removed during design precisely because `.task-priority-icon` already exists; repeating that
is a review stop.

Cells are table-aligned: `pri · name · status · assignee · updated` on desktop, and
`"pri name" / "status status updated"` below 761px. The priority control's **fixed-width box
is load-bearing** — the glyphs differ in width, so a content-sized element with
`justify-self: center` breaks the column's left edge. This was caught by measurement, not by
eye.

Sorting: `Assignee, then status` (default), `Status`, `Assignee`. Status order follows the
board's column order left to right, so Done falls last. **Sorting changes row order only** —
never the row layout.

#### The priority cell is additive — Catch Up's row does not change (D32)

The other consumer of `.story-subtask-row` is Catch Up's own story-subtask panel, which §7.5
puts explicitly out of scope. So the priority cell is **not** added to the shared rule. It
lives on a `.has-priority` modifier that only the Board's epic panel applies:

| Consumer | Class | Grid areas (desktop) |
| --- | --- | --- |
| Catch Up subtask panel | `.story-subtask-row` | `name status assignee updated` — unchanged |
| Board epic detail panel | `.story-subtask-row.has-priority` | `pri name status assignee updated` |

Both templates live in `subtasks.css`, in the same mobile and `min-width: 761px` blocks, so the
two consumers stay in one file and one grammar. This is not a local layout override of a shared
component (MRT021): the base rule is untouched, and the modifier is part of the shared stylesheet,
not a Board-scoped `.col-body .story-subtask-row { … }` escape hatch — which remains forbidden.

Verified in the asset: a bare row computes the four-cell template while panel rows compute five
and stay column-aligned.

Story points remain absent from both rows.

### 6.4 Moving an epic by dragging its card (D37)

Dragging a card to another column changes the epic's status. It is a **second trigger for the
transition the app already performs**, not a second way of performing it: same hook, same route,
same menu, same optimistic patch and refresh. §9.5 lists the symbols; nothing new is added to the
Jira surface.

**A column is a set of statuses, so the drop has to resolve which one.**

| Target column holds | On drop |
| --- | --- |
| One eligible status | Transition straight to it |
| Several eligible | Open `StatusTransitionMenu` at the drop point, **scoped to that column's statuses** |
| None eligible | Refuse — nothing moves, and the card says why |

"Eligible" means Jira offers the transition for that issue right now, from
`POST /api/issues/transitions/options`. The column's configured statuses are intersected with
that response; the menu never offers a transition Jira would reject. Because the options call is
async, the sequence is **ask, then commit** — the card does not move on drop, it moves when the
write succeeds, through the hook's existing `onApplyLocalStatus` patch and
`onTransitionSuccessRefresh`. The board must not invent a second refresh policy.

**Added during execution.** The drop asks through `openSingleIssueStatusControl` — the same call
the status pill makes when it is clicked — rather than calling `loadTransitionOptions` on its own,
and releases it again with `closeSingleIssueStatusControl` at every terminal outcome. Both halves
are load-bearing, and neither is bookkeeping. `submitStatusTransition` builds its write target from
`activeSingleIssueTarget`, falling back to a key-only target whose `currentStatus` is empty, so
without the open call a write that *throws* would roll the epic back to no status at all and drop
it into Unmapped — a corruption the widened optimistic patch (§13) newly exposes. And without the
close, the hook's in-flight-request guard still holds the previous (completed) request, so dragging
the same epic twice deduplicates the second options load to `null`. Close-then-open is exactly the
pill's own toggle. Because the options then arrive on the hook's state rather than in a returned
promise, the drop waits for `transitionOptionsLoading` to settle for *that* epic before it resolves
— which is also what keeps "ask, then commit" true.

**Drop targets and feedback**

- Every column is a target, open or folded — a folded rail accepts a drop, so moving an epic into
  a column you are not looking at does not require unfolding it first.
- The source column is **not** a target and is never highlighted: dropping an epic where it
  already is would be a no-op, and highlighting it would promise otherwise.
- The hovered target outlines in its own column colour; the outline clears on `dragend`
  regardless of where the pointer ended up.
- Outcome is announced in an `aria-live="polite"` line under the board head — the move as
  `KEY → Status · From → To`, the refusal as the reason. This is the only new element the feature
  adds to the board chrome.

**Counts move with the card.** Column epic count, story-point total, bar height, the shared bar
scale and any Min/Max breach all re-derive after a successful move. A move that pushes a column
past its Max makes it glow immediately (D24) — the breach is a fact about the work, and the work
just changed.

#### The unresolved-story gate (D42)

A column is "resolved" when the status chosen for the drop is `Done`, `Killed` or `Incomplete` —
the three the reference configuration puts in the Done column, and the `done` `statusCategory` in
the general case. Dropping an epic there while it still has open stories is usually a mistake, and
the data to notice is already on the card: `progress.total - progress.done`.

| Condition | Behaviour |
| --- | --- |
| Target status not resolved | Move immediately. No extra step |
| Resolved, and every story done | Move immediately. **No confirmation for the correct case** |
| Resolved, with open stories | One confirmation, rendered **inside the same menu**: a warning line *"DEMO-1001 has 5 open stories"*, then *Move to Done anyway* and *Keep it where it is* |

**Added during execution: the category has to be fetched, or the general case cannot fire.** A
column stores status *names* (`board.columns[].statuses`) and the transitions endpoint returns
names, so nothing that reaches the gate carries a `statusCategory`. Left there, "resolved" would
collapse to the three literal names and a `done`-category status called anything else — `Cancelled`,
`Shipped` — would move past the gate silently. The board therefore resolves the chosen status
against the separate issue-transition status catalog (`GET /api/issues/statuses/catalog`) before
asking D42's question. The composer's `/api/board-config/statuses` contract intentionally carries
only `{id, name}`. Transition-category metadata is requested lazily,
on the first drop rather than on board load, so a user who never drags never pays for it; a catalog
that fails to load degrades the gate to the three literal names rather than blocking the drop.

It **warns, it never blocks** — same reasoning as D24. Jira's workflow decides what is permitted;
if Jira allows the transition and the user confirms, the board performs it. A board that refused a
move Jira allows would be lying about the state of the work.

The gate sits inside `moveEpic`, so a single-status column reaches it too — it is a property of the
destination status, not of how the status was chosen. `Escape` and *Keep it where it is* both leave
the epic exactly where it was.

**Drag never becomes the only path.** The status pill inside the epic detail panel stays the
click target and the keyboard route (D22, and the repo's own rule that the displayed status is
the trigger). Pointer-only status changes would be an accessibility regression, so a drag-only
board is not acceptable even if it is the nicer gesture.

### 6.5 Board mode: state, persistence, gating (D40)

There is **no enum** holding the ENG mode. It is three independent booleans, and Catch Up is the
all-false fallthrough — which means a fifth mode inherits Catch Up's behaviour everywhere unless
each site is changed deliberately. That inheritance is the main implementation hazard in this
feature; §6.5.4 lists every place it bites.

#### 6.5.1 State

| Item | Value |
| --- | --- |
| Declaration | `const [showBoard, setShowBoard] = useState(savedPrefsRef.current.showBoard ?? false)`, beside the existing three at `dashboard.jsx:655-657` |
| Enum value | `'board'`, added to the `activeEngMode` chain (`dashboard.jsx:12337-12343`). Note the existing values are `'catch-up'` **hyphenated**, `'planning'`, `'statistics'`, `'scenario'` |
| Default | **Off.** Catch Up remains the default mode; `?? false` gives that for free on a fresh profile |
| Mutual exclusion | `applyEngMode` (`dashboard.jsx:12344-12350`) sets all four booleans from `nextMode`. Add the matching guard effect beside `:5080` / `:5165` / `:5172`, since those also fire on programmatic sets |
| Label | **`Board`**. The four existing labels are `Catch Up`, `Planning`, `Statistics`, `Scenario` — note the production label is `Catch Up` with a capital U; the mockup's `Catch up` is a mockup typo, not a rename |
| Position | Third, between `Planning` and `Statistics`, as the mockup renders it |

#### 6.5.2 Persistence

Persisted in `localStorage` under `jira_dashboard_ui_prefs_v1` (`dashboard.jsx:302`), written by
the effect at `:5333-5345` — add `showBoard` to both the payload and the dependency array
(`:5399-5401`). Nineteen Playwright specs seed that key directly, so an absent `showBoard` **must**
read as `false`.

Board is **not** URL-addressable, and this change does not make it so — no ENG mode is. Board also
does **not** get Scenario's force-reset-on-load treatment (`dashboard.jsx:304-316`, which sets
`prefs.showScenario = false`): the board is cheap to restore and holds no draft state.

Board must also join the per-group in-memory state: `buildDefaultGroupState` (`:4657-4659`),
capture (`:4760-4762`), restore (`:4868-4870`). Without it, switching group silently drops out
of Board.

#### 6.5.3 Availability by sprint state

`isCompletedSprintSelected` is `state === 'closed'` and `isFutureSprintSelected` is
`state === 'future'` (`dashboard.jsx:1640-1642`).

**Board is available in every sprint state, including no sprint selected.** It is a read view over
whatever is in scope, exactly like Catch Up, and unlike Planning and Scenario it holds no draft
that a closed sprint would invalidate. So its `EngModeControl` entry carries **no `disabled`
predicate**, and — unlike Planning, Statistics and Scenario — it needs **no force-off effect**
(the ones at `:5087`, `:5179`, `:9976`).

One consequence to accept deliberately: drag-and-drop on a closed sprint will offer transitions
Jira may still permit. That is Jira's call, not the board's (§6.4), and matches the fact that
Catch Up's status pills are already live on a closed sprint.

#### 6.5.4 The fallthrough sites — every one is a deliberate decision

Each of these currently means "not Stats and not Scenario", so Board lands in the Catch Up branch
by default. **A reviewer should check this table line by line.**

| Site | Today | Board must |
| --- | --- | --- |
| `dashboard.jsx:10416` `shouldRenderEngTaskList` | `selectedView === 'eng' && !isStatsSourceOnlyStatsView` | **Change.** Otherwise the whole Catch Up task list renders *underneath* the board |
| `dashboard.jsx:13093` capacity panel | `selectedView === 'eng' && !isCompletedSprintSelected` | **Change.** The capacity panel's DOM would sit under the board |
| `engStatusTransitionUtils.js:61-66` `isStatusTransitionSurfaceEnabled` | returns `true` for any non-Stats/Scenario ENG surface | **Keep `true`, deliberately** — §6.4 needs it. Add `board` to the comment and to `tests/test_eng_status_transition_utils.js:12-20`, which enumerates every mode |
| `dashboard.jsx:11031`, `:11067` priority + track menus | inherit `statusTransitionEnabled` | **Keep**, same reasoning: the epic panel edits both |
| `dashboard.jsx:10957` `statusTransitionSourceSurface` | `showPlanning ? 'planning' : 'catch_up'` | **Change** → `'board'` (§9.5) |
| `dashboard.jsx:12985` export `sourceSurface` | `… : 'catch_up'` | **Change** → `'board'` |
| `dashboard.jsx:10546-10555` export epic keys | `showScenario ? scenarioJiraEpicKeys : visibleTaskJiraEpicKeys` | **Change.** Board must export the epics it shows, not the task list's |
| `analytics/dashboardAnalytics.js:86` `engMode` | chain ends `'catch_up'` | **Change** → `'board'` (§10) |
| `dashboard.jsx:12337` `activeEngMode` | chain ends `'catch-up'` | **Change**, or the Board radio never reads `aria-checked="true"` |
| `dashboard.jsx:12616` `allowSelection: showPlanning` | false for Board | **Keep** — correct already; the board has no checkboxes |
| `dashboard.jsx:12944-12946` manual refresh | ENG-wide | **Keep** |

#### 6.5.5 Mode-switch effects

`applyEngMode` writes booleans and fires one analytics event; everything else lives in effects.
Board's entry and exit must therefore be explicit about what they do **not** do — matching the
existing modes:

- Does **not** clear `selectedTasks` (the Planning selection survives a mode round-trip today).
- Does **not** abort in-flight fetches — `abortSprintFetches()` runs only on sprint change, called
  from inside `resetSprintScopedState()` (`dashboard.jsx:5122`), which the sprint-change effect at
  `:5148-5151` invokes.
- Does **not** reset scroll.
- Board additionally **must not** trigger any new fetch on entry: it renders from the same
  `data.epics` and task data Catch Up already loaded (§9.4). Entering Board is a pure re-render.

On exit, Board must clear only its own transient UI: the drop menu, the drag highlight and the
`aria-live` message. It owns no other state.

#### 6.5.6 Unit and Playwright assertions

| Level | Assertion |
| --- | --- |
| Unit | `isStatusTransitionSurfaceEnabled({ selectedView: 'eng', showBoard: true })` is `true`; extend the mode table in `tests/test_eng_status_transition_utils.js:12-20` |
| Unit | `activeEngMode` returns `'board'` when `showBoard` and nothing else is set, and Board loses to Scenario/Statistics/Planning in the existing precedence order |
| Unit | `applyEngMode('board')` sets exactly one boolean true |
| Source guard | `tests/test_epm_view_source_guards.js:337-345` — the mode control still renders `ariaLabel="ENG view mode"` with no `mode-switch-button` |
| Playwright | `page.locator('.view-selector .eng-mode-control').getByRole('radio', { name: 'Board' }).click()` then the board is visible — matching the idiom at `tests/ui/codebase_structure_smoke.spec.js:1015-1017` |
| Playwright | The same click from `.compact-sticky-header .eng-mode-control` (idiom at `:1065-1068`) |
| Playwright | In Board, `.task-list` renders **zero** Catch Up task items — the `shouldRenderEngTaskList` fix, asserted rather than assumed |
| Playwright | Seeding `{ showBoard: true }` into `jira_dashboard_ui_prefs_v1` before navigation lands in Board; seeding nothing lands in Catch Up |
| Playwright | Switching Board → Statistics → Board restores the board with its focused column unchanged |
| Playwright | On a **closed** sprint the Board radio is enabled and the board renders (unlike Planning/Scenario) |

#### 6.5.7 The line budget is the real blocker

`tests/test_codebase_structure_budgets.py:74` caps `frontend/src/dashboard.jsx` at 16000 lines and
the file is at **15993**. Item (b)-(m) above are all edits *inside* that file. Seven lines will not
cover them. **Plan for extraction, not a budget bump:** lift the mode derivation
(`activeEngMode` + `applyEngMode` + the mutual-exclusion effects) into
`frontend/src/eng/engModeState.js` and import it, which removes more lines than Board adds. A
budget bump is a review stop; every prior bump carries an in-file justification comment
(`test_codebase_structure_budgets.py:40-73`).

## 7. Filter bar

One sticky row — literally one, at any width and any number of active facets: a `Filters` trigger
with an active-count badge, a `n of m epics` readout, removable chips naming each active facet,
and a clear-all. §7.6 specifies the geometry, because a filter block that grows to three rows is
the problem this design exists to remove, and the first version of it did exactly that.

### 7.1 Subject: epics here, stories in Catch Up (D19)

| Surface | Filters operate on | Notes |
| --- | --- | --- |
| **Board** | **Epics** | Column placement, counts and every facet resolve against epics |
| **Catch Up** | **Stories** | Unchanged from today, status filters included (D14) |
| Search | Both | The one filter whose subject does not change |

The two surfaces share the bar and the chip grammar, **not** the facet set and **not** the
subject. Counts are therefore not comparable between them, and no facet state should be
carried across when switching modes. The popover states its subject on screen so the
difference is visible rather than implied.

### 7.2 Facets, in order

| # | Facet | Kind | Options |
| --- | --- | --- | --- |
| 1 | Priority | Multi | The `PRIORITY_AXIS` values **present in scope** |
| 2 | Projects | Multi | Tech · Product |
| 3 | Assignee | Single | `Anyone` (default) · `Unassigned only` |
| 4 | Delivery track | **Multi** | `Committed` · `Flexible`, **both ticked by default** (D33) |

Delivery track is deliberately last (D21).

### 7.3 Rules

- **No facet can reach an empty set.** Single-select facets always have one option active. In
  a multi-select facet the last active option locks, with a reason on hover.
- **An option with zero items in scope is hidden, not shown at zero** (D20). It is recomputed
  whenever scope changes, and hidden options are excluded from the "everything ticked" test,
  from the last-option-locks rule, and from Select all.
- A multi-select facet with everything ticked states that it is not filtering, rather than
  presenting itself as an active filter.
- No status facet, and no Done/Killed toggles — folding the Done column does that job.
- **Delivery track's neutral state is load-bearing.** Both options ticked means "not filtering by
  track", and that is the only state which includes the 75% of epics with no track set. Its
  heading total therefore reads the full scope, not `8 + 14` — no option represents untracked
  work, so an option-sum would silently under-report by 65 epics.
- Each facet heading shows the count it currently admits (D34).
- **A chip names the smaller side (D35).** With fewer options excluded than included it reads
  `Status hidden Killed`; otherwise `Status only In Progress`. The verb is coloured so it cannot
  be skim-read as part of the list. Enumerating the ticked side unconditionally is what produced
  the 565px chip.
- **A chip names at most two options, then `+n`.** The untruncated list lives in the chip's
  `title` and in the popover, which is the source of truth.
- Radio facets have no verb — `Assignee Unassigned only` is already the shorter truth.

### 7.4 Catch Up's facet table

§7.2 is the **Board** facet table. This is Catch Up's. It is now designed and rendered in
`board.html` — switch the ENG mode control to **Catch up** — so it is no longer a gap.

Catch Up filters **stories** (D19). Status stays a facet, because Catch Up is a list and status is
not a column here (D13 applies to the Board only).

| # | Facet | Kind | Options |
| --- | --- | --- | --- |
| 1 | Status | Multi | The board's statuses **present among the stories in scope**, in board-column order, so the facet reads in workflow order |
| 2 | Priority | Multi | The `PRIORITY_AXIS` values present in scope |
| 3 | Projects | Multi | Tech · Product |

Delivery track and Assignee are **not** Catch Up facets: track is an epic field, and assignee
filtering is not part of Catch Up today. Adding either is a scope decision, not an omission.

#### Mapping from today's state

Grounded in the real predicates at `frontend/src/dashboard.jsx:10065-10089`, not inferred:

| Today | Real predicate | Becomes |
| --- | --- | --- |
| `statusFilter = null` | passthrough | Status: all ticked · Priority: all ticked |
| `statusFilter = 'in-progress'` | `status === 'In Progress'` | Status = {In Progress} |
| `statusFilter = 'todo-accepted'` | `status ∈ {To Do, Pending, Accepted}` | Status = those three |
| `statusFilter = 'done'` | `status === 'Done'` | Status = {Done} |
| `statusFilter = 'killed'` | via `showKilled` (`:4855-4858`) | **Status: all ticked, Killed included** — *corrected during execution.* The saved value never meant "only Killed": `normalizedInitialStatusFilter` / `normalizedInitialShowKilled` mapped it to `statusFilter = null` **plus** `showKilled = true`, i.e. passthrough *including* Killed. Neutral reproduces that story set; `{Killed}` would have been a behaviour change |
| `statusFilter = 'high-priority'` | `priority ∈ {Blocker, Highest, Critical, High}` | Priority = {Blocker, Critical, Major} |
| `statusFilter = 'minor-priority'` | `priority ∈ {Minor, Low, Trivial, Lowest}` | Priority = {Minor, Low, Trivial}. *Execution note:* going through `PRIORITY_ALIASES` also folds `Medium → Minor`, which the old raw-name predicate excluded. Accepted — this row's own instruction is to use the alias table rather than hand-write a second normalization, and §4.2 records that the raw aliases do not occur on issues in these projects |
| `showDone` | Display toggle | Status: untick Done |
| `showKilled` | Display toggle | Status: untick Killed |
| `showTech` / `showProduct` | Display toggles | Projects facet |
| `groupByInitiative` | grouping, not a filter | Stays a grouping control, and gets persisted (§2) |

`Highest → Blocker` and `High → Major` follow `PRIORITY_ALIASES`
(`frontend/src/stats/statsConstants.js:12`); the raw aliases do not occur on issues in these
projects (§4.2).

#### What this buys

Today `statusFilter` is a **single** select spanning status, priority and totals, so *"In Progress
**and** high priority"* is unrepresentable — it is §2's "one filter mixes three dimensions" symptom.
Splitting it into two orthogonal multi-selects makes that expressible. Verified in the asset:
selecting Status = {In Progress, Blocked} with Priority = {Blocker, Critical, Major} yields 3 of 13
stories and two chips, a state the current UI cannot reach.

The four Display toggles are **subsumed**, not ported: once Status is a real multi-select facet,
"hide done" is unticking Done. That removes four controls rather than restyling them.

#### View controls — order and structure, not filtering (D30)

Sort and grouping live in the same bar but outside the chip grammar, because they change order and
structure rather than membership. Both are Catch Up only.

| Control | Options | Source |
| --- | --- | --- |
| Sort | Priority (default) · Status · Committed ⬇ · Flexible ⬇ | `ENG_EPIC_SORT_OPTIONS` verbatim, `frontend/src/eng/engTaskUtils.js:180` |
| Group by initiative | Off (default) · On | `groupByInitiative`, today's boolean |

Every sort is tie-broken by priority, as the app already does. Grouping wraps epic blocks in
`.initiative-group` / `.initiative-header` / `.initiative-body` with the existing accent rail
(`eng/epics.css:163-205`). Neither renders a chip; the sort label and the checkbox show their own
state, and `groupByInitiative` must persist (§2).

#### Behaviour

- An epic group with no matching story is hidden entirely; the header states `n of m stories`.
- Zero-count status options are hidden (D20), driven by the data — in the asset three statuses
  have no story in scope and are absent from the facet.
- Empty result renders an explicit empty state, not a blank list.
- The readout is the **real filtered count**, not a sum of facet counts.

### 7.5 Catch Up scope boundary — what implementation may not touch (D32)

Catch Up's list is **inherited from the current dashboard**. This work replaces the filter chrome
above it and nothing else. Treat everything below the bar as read-only.

**In scope for Catch Up:**

- Remove the `.filters-strip` card rows — the six `.status-filter-grid` cards and four
  `.display-filter-grid` cards.
- Render the compact bar in their place, with the §7.4 facet set.
- Map the existing filter state to the new facets per §7.4, keeping the same predicates.
- Restore the sort and grouping controls into the bar (D30), and persist `groupByInitiative` (§2).

**Out of scope — do not modify, restyle, refactor or "improve":**

| Untouchable | Why |
| --- | --- |
| `.task-list`, `.epic-block`, `.epic-header` | The list structure is inherited as-is |
| `.task-item` and every child: `.task-header`, `.task-headline`, `.task-title`, `.task-meta`, `.task-inline-meta`, `.task-assignee`, `.task-updated` | Existing card, existing behaviour |
| `frontend/src/issues/IssueCard.jsx` | Renders the above; **not in the file map** |
| `.story-subtasks-panel` and `.story-subtask-row` **base rules** | See the note below |
| `.dependency-pill`, `.dependency-pill-stack`, `.dependency-strip` | Existing dependency UI |
| Planning selection, alerts, status/priority/track transition menus | Existing behaviour reached from these rows |

> **One correctness exception, taken during execution.** This table scopes the *Catch Up filter-bar
> migration* — it means "do not restyle or rewire these while replacing the filter chrome", not "this
> code is frozen for the whole plan". It collided with §10.1: `IssueFieldOptionMenu` closed on Escape
> without returning focus to its trigger, so focus landed on `<body>`, and because the epic panel
> binds Escape to the panel element the panel became **keyboard-undismissable** — §10.1's focus trap
> escapable in one gesture. A board-local focus shim would have been the parallel path §9.5 forbids,
> so the fix went into the shared component, where it is a general correctness fix every consumer
> benefits from rather than a board special-case: a menu that drops focus to `<body>` is wrong on
> Catch Up and Planning too, merely less visible there because neither has a trap to escape. The
> outside-click path was deliberately left alone (the user pointed somewhere else), now asserted on
> all three surfaces.
>
> **Still open, and deliberately not decided here:** focus also falls to `<body>` after a *successful
> option selection*, because the clicked option unmounts while the menu stays open. Same symptom,
> different mechanism, pre-existing on all three surfaces, and choosing where focus should land is a
> UX decision nobody has made.

The filtered result feeding the list is the only thing that changes. If a task appears to require
editing a file in that table, stop and ask — it means the boundary or the design is wrong.

#### The one place this nearly broke, and how it is avoided

§6.3 needs story **priority** in the Board's epic detail panel, and that panel reuses
`.story-subtask-row`. Adding a priority cell to the base rule would have changed Catch Up's subtask
panel — a direct violation of this boundary.

Resolved by making it **additive**: priority lives on a `.has-priority` modifier that only the epic
panel applies.

| Consumer | Class | Grid areas |
| --- | --- | --- |
| Catch Up subtask panel | `.story-subtask-row` | `name status assignee updated` — **unchanged from today** |
| Board epic detail panel | `.story-subtask-row.has-priority` | `pri name status assignee updated` |

Verified in the asset: a bare `.story-subtask-row` computes the app's existing four-cell template,
while the panel's rows compute five and stay column-aligned. This supersedes the earlier plan to
change the shared row, and closes **O7** — the ENG subtask panel does not gain a priority column,
because it is not ours to change.

### 7.6 The bar is one row and stays one row (D36)

The first version of this bar wrapped. At a 958px viewport with three facets active it stood
**146px tall over three rows** — taller than the ten filter cards it replaced, and the exact
failure §2 is about. Three rules prevent it, and each is measurable.

| Rule | Implementation | Why not the obvious alternative |
| --- | --- | --- |
| **Sized to content, not to the container** | `display: inline-flex`, `width: max-content`, `max-width: 100%` | A full-width band invites its contents to fill it. The controls row above is content-width; the bar now matches it. |
| **Never wraps** | `flex-wrap: nowrap`; trigger, readout and view controls are all `flex: none` | Only the chips lane may flex, so wrapping cannot start there. |
| **The chips lane clips, then collapses** | `overflow: hidden`, then hide chips from the end and add one `+n more` until `scrollWidth <= clientWidth` | Horizontal scrolling hides active filter state behind a gesture; a `+n more` that opens the popover puts it one click away and visible in the badge. |

Recomputed on render and on resize. `Clear all` never collapses — with chips hidden it is the one
control that still acts on all of them.

The fixed heights below describe the inner `.filterbar` geometry only. Sticky layout measures the
outer `.filterbar-wrap` border box, including its top padding, at each viewport width; the live rect,
not 42px or 80px copied into an offset, must drive `F` and the epic-header top.

**Below 720px** the view controls may take a second row, never a third: the chips lane keeps
`flex: 1 1 0` so its content cannot push it onto a line of its own, with a `3.5rem` floor so
`+n more` stays legible. The bar does **not** adopt `.controls-row`'s horizontal-scroll treatment
at this width, even though that is the app's usual narrow-screen answer — an `overflow-x` ancestor
would clip the facet popover anchored inside the bar, which D29 already fought to keep on screen.

Measured after the change, same three-facet state. The **Rows** and **Height** columns are the
contract; the **Chips shown** column is illustrative and was measured on the asset before D16/D39
pinned the app's real container width, so it is corrected here against the shipped bar:

| Viewport | Rows | Height | Chips shown (asset, full-bleed) | Chips shown (shipped, `.container`) |
| --- | --- | --- | --- | --- |
| 1440 | 1 | 42px | all three | **two + `+1 more`** |
| 960 | 1 | 42px | one + `+2 more` | one + `+2 more` |
| 360 | 2 | 80px | `+3 more` only | **`Clear all` survives; `+n more` takes the clip** |

Two corrections made during execution, both forced by the app rather than by choice:

- **1440 cannot show all three chips.** The bar is content-width inside `.container`
  (`max-width: 1040px`, D16) rather than the asset's full-bleed shell, so at a 1440 viewport it is
  919px wide and the chips lane gets ~589px. Three chips plus `Clear all` need ~650px, so the
  collapse rule fires — correctly. It fires at the full 1040px container too. The rule is right and
  the asset's number was measured under the wrong width.
- **At 360 the lane cannot hold both `+n more` and `Clear all`.** The asset clips `Clear all`; the
  shipped bar clips `+n more` instead, because "**`Clear all` never collapses**" is an explicit rule
  above and nothing becomes unreachable — the `Filters` trigger and its active-count badge open the
  same popover the `+n more` chip would.

## 8. Search — extended to Delivery Owner (D27)

Search is the one filter whose subject does not change between surfaces (§7.1). On the Board it
narrows the epic set, and the cards that survive are the ones rendered in their columns.

Fields searched, on the Board:

| Field | Match | Why |
| --- | --- | --- |
| `key` | Case-insensitive substring | Existing behaviour — reuse `matchesEngTaskSearch` (`frontend/src/eng/engTaskUtils.js:21-44`), which has **no separate exact-full-key path**; drop that claim, it is not real |
| `summary` | Case-insensitive substring | Existing behaviour, same function |
| `assignee.displayName` | Case-insensitive substring | Existing behaviour, same function |
| **Configured `deliveryOwner` `.displayName`** | Case-insensitive substring | When `deliveryOwnerField` is configured, it names a different person from the assignee 90% of the time (§4.2), so search includes the shaped value without assuming a site-specific field id. |

`engBoardSearch.js` (§13) is a **new** OR-predicate function for epics — it is not
`matchesEngTaskSearch` reused as-is (that function matches stories against an epic-keyed lookup;
this one matches epics directly and adds Delivery Owner). Model it on the same shape and
case-insensitive-substring semantics, not a fresh implementation style.

Rules:

- Matching is **client-side over the already-fetched epic set** — no extra request or JQL change.
  When configured, Delivery Owner is already shaped as `epic.deliveryOwner` for the card (§9), so
  search costs nothing beyond a comparison; when unset, that candidate is absent.
- A match on Delivery Owner is not visually distinguished from a match on assignee; both simply
  keep the card. The card already shows both people, so the reason is visible.
- Epics with no Delivery Owner are unmatchable by that field, and must not be excluded by a
  search that would otherwise match their key or summary — i.e. the predicate is an OR across
  fields, never an AND.
- Search composes with the facets as an additional narrowing, and is **not** represented as a
  removable chip; the search box already shows its own state.
- Empty search is a no-op, not "match nothing".

## 9. Jira API surface — exactly what is added

The rule: **extend the Jira read surface only by the fields this design actually renders.**
Everything below is required by a named UI element; nothing is added speculatively.

### 9.1 New issue fields

| Field | Needed by | Added to |
| --- | --- | --- |
| `deliveryOwnerField` Delivery Owner, **no default** | Epic card row 3 (§6.2), search (§8) | The existing epic detail fetch, alongside `projectTrack` — read through a new getter, not hardcoded (below) |
| Epic `updated` | Epic card row 2 (§6.2) | The existing epic detail fetch (`fetch_epic_details_bulk`, `jira_server.py:2571-2625`) — **not already present for epics**, unlike the story-level field of the same name |
| `description` | Epic detail panel (§6.3) | **Not** the bulk fetch — see 9.2 |

That is the whole list. In particular these are **not** added, because they are already present:
epic and story `priority`, `status`, `assignee`, `summary`, `key`; story-level `updated`; delivery
track (`customfield_35024`); story subtask progress. Epic story points are **not** a raw field at
all — see §4.1, they are a client-side rollup and stay that way.

**`deliveryOwnerField` is configurable and has no default at all.** The original plan proposed a
`DELIVERY_OWNER_FIELD_DEFAULT` fallback mirroring `PROJECT_TRACK_FIELD_DEFAULT =
'customfield_35024'` (`jira_server.py`), read through
`get_project_track_field_config()` / `get_project_track_field_id()`. That shipped, and the guessed
constant was the wrong shape of answer: a Delivery Owner custom field id is per-instance, so any
built-in value is a claim this repo cannot make. **The constant has since been deleted** (O11).
`get_delivery_owner_field_config()` returns `{'fieldId': '', 'fieldName': ''}` until an admin saves
one, `get_delivery_owner_field_id()` returns `''`, and `fetch_epic_details_bulk` then neither asks
Jira for the field nor emits a `deliveryOwner` key at all — the epic payload simply omits it, so
"no field is configured" can never be rendered as "this epic has no Delivery Owner". Downstream is
already tolerant and covered by tests: the card falls back to **Not set**
(`EngBoardEpicCard.jsx`, `epic.deliveryOwner?.displayName`) and the search predicate skips the
missing candidate rather than matching nothing (`engBoardSearch.js`).

Unlike `projectTrackField`, this one needs a **settings UI**, and with no default it is the *only*
way the field is ever set. Settings → **Admin → Mapping** already has this exact control for four other single-field
mappings — Sprint Field, Parent Name Field, Story Points Field, Team Field — each a live search
against `jiraFields` with a selected-chip/remove pattern and a "Show Jira technical IDs" toggle
(`frontend/src/settings/JiraFieldSettings.jsx`, rendered when `groupManageTab === 'mapping'`). Add
**Delivery Owner Field** as a fifth entry in that same block, reusing its exact search/chip/toggle
markup (`.team-search-input`, `.selected-team-chip`, `.field-id-hint`) — do not build a second field
picker under a different tab. See O11.

### 9.2 Description is fetched lazily, not in bulk

`description` is Jira ADF, not HTML, and the synthetic reference description is ~2,600 characters,
rendering ~1200-1400px tall (§6.3). Adding it to `fetch_epic_details_bulk` would inflate every epic in
every sprint load for content that is only read when a panel is open, against the standing rule
that initial dashboard load is performance-critical.

Therefore: fetch `description` for **one** epic, on panel open. Fan-out is one request per opened
panel, cached for the session. This resolves O2.

**No such route exists today.** `description` is requested by no `fields` list in the repo — not by
`fetch_epic_details_bulk` (`jira_server.py:2588`), `/api/issues/lookup` (`eng_routes.py:145-154`),
`/api/epics/search` (`settings_routes.py:746`) or any other. Nothing expands `renderedFields`
either. Two tests actively assert description does **not** leak from the status catalog
(`tests/test_jira_issue_transitions.py:528,549`), so this is a deliberate absence being reversed
for one narrow purpose, not an oversight to quietly fill.

#### Endpoint contract

| Item | Value |
| --- | --- |
| Route | `GET /api/issues/description?key=<ISSUE-KEY>` |
| Why a query param, not `/<key>` | `routes_requiring_samples()` (`backend/security/policy.py:190-191`) forces an entry in `tests/endpoint_security_samples.py` for any path containing `<`. A query param avoids that and matches the two closest existing routes, `/api/issues/lookup` and `/api/issues/subtasks` (`eng_routes.py:130,192`), both `GET` with query params. |
| Policy | `EndpointPolicy("eng-api-issue-description", "/api/issues/description", PUBLIC_METHODS, "authenticated_read")` — `PUBLIC_METHODS` is `frozenset({"GET"})` (`policy.py:6`) |
| Auth | The signed-in user's OAuth Jira context, same as every other ENG read. Never a service credential. |
| Request | `key` — one issue key, `^[A-Z][A-Z0-9_]+-\d+$`. Exactly one; no batch, no comma list |
| 200 | `{ "key": str, "html": str, "isEmpty": bool }` — `html` already rendered server-side and escaped, `isEmpty` true when Jira's description is null or renders to whitespace |
| 400 | `{ "error": "invalid_issue_key" }` — malformed or missing `key` |
| 404 | `{ "error": "issue_not_found" }` — Jira 404, or the user cannot see it. Do **not** distinguish the two: that difference leaks the existence of issues outside the user's permissions |
| 502 | `{ "error": "issue_description_fetch_failed", "message": str(e) }` — **not** a direct precedent match: `eng_routes.py:260,289,323,361,396` (the existing 502 upstream-failure handlers) are all bare `{"error": "<code>"}` with **no** `message` key. The `{error, message: str(e)}` shape instead matches `eng_routes.py:127,189`, but those are generic `except Exception` handlers returning **500**, not 502. This endpoint's shape (502 status + a diagnostic message) is a new combination — keep it as specified, since it's more useful here than either existing pattern alone, but do not cite the 502 lines as if they already do this. |
| Caching | Client-side, per issue key, for the session. No server cache: the body is user-permission-scoped |

#### ADF rendering happens on the server, reusing what exists

An earlier revision said "render ADF → text client-side". That was wrong: `frontend/src` contains
**zero** ADF handling, so there is nothing client-side to reuse and it would mean shipping a new
parser. The repo already has a tested ADF renderer, server-side, in `backend/epm/home.py`:

| Helper | Line | Use |
| --- | --- | --- |
| `adf_to_html(value)` | `home.py:781` | The one to call |
| `_render_adf_html_nodes(nodes)` | `home.py:806` | The node walker |
| `_safe_adf_href(value)` | `home.py:799` | Href allowlist — the XSS guard |
| `adf_to_text(value)` | `home.py:742` | Plain-text fallback |

These are field-agnostic: Home/Goals GraphQL payloads use them, and
`GET /api/issues/description` also passes Jira issue-description ADF through `adf_to_html` in
`backend/routes/eng_routes.py`. **Reuse them; do not write a second renderer.** If the epic panel
needs a node type they do not cover, extend the shared helper so both callers benefit.

#### Supported node and mark policy — exactly what `_render_adf_html_nodes` handles

| Kind | Supported | Rendered as |
| --- | --- | --- |
| Node | `paragraph` | `<p>` |
| Node | `heading` | Escaped semantic `<h1>`–`<h6>` for valid levels; invalid levels degrade to `<p>` |
| Node | `table` | Static `.adf-table-scroll` region containing `<table><tbody>`; Jira attributes are ignored |
| Node | `tableRow` | `<tr>` containing only supported header/cell children |
| Node | `tableHeader`, `tableCell` | `<th scope="col">`, `<td>` with recursively escaped content; Jira attributes are ignored |
| Node | `bulletList`, `orderedList` | `<ul>`, `<ol>` |
| Node | `listItem` | `<li>` |
| Node | `hardBreak` | `<br>` |
| Node | `text` | escaped text |
| Mark | `strong`, `em` | `<strong>`, `<em>` |
| Mark | `link` | `<a href>` **only** when `_safe_adf_href` returns non-empty — i.e. `https?://` or `mailto:` and nothing else |
| Node | `inlineCard`, `blockCard` | Escaped `<a href>` using `attrs.url` as the fallback label, only when `_safe_adf_href` accepts the URL |
| Anything else | **Not supported** | Its `content` is walked and its text preserved; the node itself contributes no markup |

That last row is the policy, and it is deliberate: `panel`, `mediaSingle`, `codeBlock`,
`mention`, `emoji` and `status` all degrade to their text. Smart Link nodes with an unsafe or missing
URL render nothing. Supported table nodes retain semantic rows and cells inside a static,
table-local scroll region, while Jira-provided table attributes remain ignored. **Never render
`description` as raw HTML from Jira, and never
`dangerouslySetInnerHTML` anything that did not come through `adf_to_html`.**

#### Panel states

| State | Renders |
| --- | --- |
| Loading | A skeleton in the description block only; the rest of the panel (title, controls, story list) is already populated from `data.epics` and must not wait on it |
| Empty (`isEmpty`) | *No description* in `.group-modal-meta` grammar — not an empty box |
| Error | The failure and a **Retry** button in the block; the panel stays open and the story list stays usable |
| Loaded | Clamped to **`11.5rem`** with the fade, *Show full description* toggles it (§6.3) |

A second open of the same epic in one session must not refetch.

### 9.3 One new endpoint

A board's status set is resolved without the admin-scoped board-configuration resource.

| Item | Value |
| --- | --- |
| Route | `GET /api/board-config/statuses` |
| Request | No parameters. Reads the app's single configured board server-side via the same `get_board_config()` call `get_board_config_endpoint` already uses (§5.2) — the client never passes a board id. |
| Returns (200) | `{ boardId, projectKeys, statuses: [{ id, name }] }`, plus `projectKey` when the scope has exactly one project; statuses come only from Epic issue-type groups, are deduplicated by id in first-seen order, and are never empty |
| Returns (400) | `{ error: 'no_board_configured' }` when `get_board_config()`'s `boardId` is empty — Settings has no board saved yet |
| Returns (502) | Distinct codes for missing board project (`board_project_unavailable`), Jira refusal of either ordinary read (`board_statuses_forbidden`), other upstream/load failure (`board_statuses_fetch_failed`), and empty/unusable statuses (`board_statuses_unavailable`) |
| Upstream | One `GET /rest/api/3/project/{projectKey}/statuses` per configured selected project, with the captured request auth context. If none are configured, resolve the saved board's location through `GET /rest/agile/1.0/board/{boardId}` and fetch that single project's statuses. |
| Auth | `authenticated_read` in `backend/security/policy.py` |
| Consumer | Group Board composer only |
| Caching | Project workflows change rarely; cache per saved board id plus saved selected-project signature for the browser session |

Official Atlassian docs establish that [Get configuration](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-configuration-get)
requires `read:board-scope.admin:jira-software`, while [Get board](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/#api-rest-agile-1-0-board-boardid-get)
uses the ordinary board read scope and [Get all statuses for project](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-projectidorkey-statuses-get)
is covered by the app's existing classic `read:jira-work` scope. Do not add or change OAuth scopes.
A real local OAuth browser request remains required acceptance evidence.

Adding this route requires, or the suites fail: an entry in `backend/security/policy.py`
(`tests/test_endpoint_policy_inventory.py`), and an `X-Requested-With` + tracked-surface helper in
`frontend/src/api/` (`tests/test_frontend_api_source_guards.js`). It does **not** need an entry in
`tests/endpoint_security_samples.py` — `routes_requiring_samples()` (`backend/security/policy.py:190-191`)
only requires that file for paths containing `<` (dynamic segments), and this route has none. The
real coverage point is a new `("GET", "/api/board-config/statuses")` sample under the
`"authenticated_read"` key of `SECURITY_SAMPLES` in `tests/test_endpoint_security_matrix.py:9-40`.

### 9.4 What must not happen

- No new JQL, and no change to the base JQL. Columns are a client-side grouping of epics already
  in scope, not seven queries.
- No per-epic fan-out for card data. Everything on the card comes from the existing bulk fetch,
  including configured `deliveryOwner` when that field is set.
- No new write path to Jira from this feature beyond the transitions that already exist (status,
  priority, project track), all through the signed-in user's OAuth context. Card drag-and-drop
  (D37) is a new *trigger* for the existing status transition, not a new write path — see §9.5.

### 9.5 Drag-and-drop adds no API surface, and one gate it must not miss

Everything the drop needs already ships. Reuse these; adding a parallel route or a second menu is
a review stop.

| Need | Existing symbol | Where |
| --- | --- | --- |
| Which transitions Jira offers for this epic | `POST /api/issues/transitions/options`, policy `authenticated_read` | `backend/security/policy.py:84`, `backend/routes/eng_routes.py:266` |
| Perform the transition | `POST /api/issues/transitions`, policy `user_write` | `backend/security/policy.py:85`, `backend/routes/eng_routes.py:297` |
| Client wiring, cache, abort, pending keys, error codes | `useEngStatusTransitions` — `loadTransitionOptions`, `submitStatusTransition`, `pendingIssueKeys`, `transitionError` | `frontend/src/eng/useEngStatusTransitions.js:158` |
| The menu itself | `StatusTransitionMenu`, whose panel is `IssueFieldOptionMenu` — the drop menu mounts that panel directly, since a drop point has no status pill to hang a second trigger from | `frontend/src/issues/StatusTransitionMenu.jsx`, `frontend/src/issues/IssueFieldOptionMenu.jsx` |
| The single-issue target the write is built from | `openSingleIssueStatusControl` / `closeSingleIssueStatusControl` — see §6.4's execution note | `frontend/src/eng/useEngStatusTransitions.js` |
| Target shape `{ key, issueType, currentStatus, summary }` | `buildEngStatusTargets` / `buildCatchUpStatusTargets` | `frontend/src/eng/engStatusTransitionUtils.js` |
| Optimistic local patch, then scope refresh | `onApplyLocalStatus`, `onTransitionSuccessRefresh` | `frontend/src/dashboard.jsx:11005,11008` |
| Batch cap | `MAX_STATUS_TRANSITION_ISSUES = 50` | `engStatusTransitionUtils.js:6` — a drag is one issue, so it is never the binding limit |

**The gate to check.** `isStatusTransitionSurfaceEnabled({ selectedView, showPlanning, showStats,
showScenario })` (`engStatusTransitionUtils.js:61`) returns true for any ENG surface that is not
Stats or Scenario, so a fifth ENG mode is enabled by default and needs no change there. What does
need changing is one line above the hook: `sourceSurface` is derived as
`showPlanning ? 'planning' : 'catch_up'` (`dashboard.jsx:10957`). Left alone, every Board
transition reports itself as Catch Up.

`sourceSurface` reaches analytics through `buildStatusActionAnalyticsParams`, so this is an
analytics change, not cosmetics. Add a `board` value, extend the taxonomy in
`docs/README_ANALYTICS.md`, and cover it in the status-action analytics tests. Per the repo's
analytics rule, a user-visible feature that emits events without a taxonomy entry is incomplete.

**Not eligible ≠ error.** A drop whose column shares no offered transition with the epic is a
normal outcome, not a failure: refuse it in the UI, say so in the live region, and do not call
the write route. Reserve `transitionError` for a write that actually failed.

## 10. Guardrails: keyboard, layering, analytics

Three classes of guardrail the rest of this document assumed rather than stated. Selector and
z-index naming (D28), geometry and clip assertions (§12.2, §12.6) and screenshot states (§12.10)
already exist and are not repeated here.

### 10.1 Focus and keyboard

The board adds a drag gesture, two menus and a popover. Every one needs a keyboard path, and the
repo's own rule is that the **displayed status is the trigger** — not a separate button.

| Surface | Keyboard contract |
| --- | --- |
| Column rail (`.col-strip`) | A real `<button>` already. `Enter`/`Space` focuses that column |
| Column header | Focusable when foldable; `Enter`/`Space` folds. A **starred** header is inert and must be **removed from the tab order** (`tabindex="-1"`), not merely unresponsive (D26) |
| Star | Its own `<button>` inside the header, reachable and toggleable independently |
| Epic card | A `<button>`; `Enter` opens the detail panel. Drag is pointer-only **by design** — the keyboard equivalent of a move is the status pill inside the panel (§6.4) |
| Epic panel | Focus moves to the panel on open and is **trapped** while it is open; `Escape` closes and returns focus to the card that opened it |
| Status / priority / track menus | Inherited from `StatusTransitionMenu` and `PriorityTransitionMenu` — arrow keys, `Enter`, `Escape`. **Do not re-implement**; the drop menu (§6.4) reuses the same component |
| Drop confirmation (D42) | Reachable only from a drag, so it is pointer-only by construction — but it must still take `Escape` to dismiss, and must return focus to the dragged card |
| Filter popover | `Escape` closes and returns focus to the `Filters` trigger; options are real buttons with `aria-pressed` / `aria-checked` |
| `+n more` chip | A `<button>` that opens the popover (§7.6) |
| Composer reorder | `Alt+←` / `Alt+→` (§5.8) |
| Composer colour | Arrow keys within the grid, `Enter` to pick, `Escape` to close (§5.8) |

Assert `:focus-visible` is never suppressed on any of these, and that the tab order follows visual
order left-to-right across columns.

### 10.2 Layering, proved by hit-testing

D28 fixes both physical adjacency and fallback tiers. At actual scroll offsets `0`, `160`, `420`,
and `maxScroll - 1`, assert the exposed bands `compact -> filter bar -> pinned epic` in Catch Up,
`compact -> Planning -> filter bar -> pinned epic` in Planning, and `compact -> filter bar` on
Board. The filter wrapper's live outer rect supplies `F`; stale Planning/filter or filter/epic peer
overlap is a failure, not evidence that a higher z-index won. Guard with separate hit tests and
**normal clicks**, never by comparing `z-index` strings:

- `document.elementFromPoint` at separate points inside the filter bar and pinned epic header must
  return each surface's own closest owner, and tests must require at least one pinned-header witness.
- Open the facet popover and Catch Up sort panel over the sticky content, lift the wrapper stacking
  context, and select a visible option with a plain click.
- Every dropdown, popover and menu opened over the board is clickable with a **plain**
  `.click()`. A Playwright `click({ force: true })` masks exactly this class of bug and is
  forbidden in these specs — it is how a real layering regression shipped before (MRT-noted in
  §14).
- The drop menu (§6.4) is appended to `<body>` and positioned `fixed`, so assert it is not clipped
  by the board's `overflow-x` container.

### 10.3 Analytics

The repo requires an analytics review for every user-visible feature, so this is a deliverable, not
a follow-up. Board reuses existing event names — **no new event is introduced**.

| Trigger | Event | Params | Notes |
| --- | --- | --- | --- |
| Entering Board from the mode control | `select_content` (existing, `eng_mode`) | `content_type: 'eng_mode'`, `item_id: 'board'`, `from_mode`, `dashboard_view: 'eng'` | Already fired by `applyEngMode` (`dashboard.jsx:12348`); only the value `'board'` is new |
| Pageview while in Board | existing pageview | `eng_mode: 'board'` | Requires the fix at `analytics/dashboardAnalytics.js:86`, which otherwise reports `catch_up` |
| Status change by drag | `issue_status_action` (existing) | `source_surface: 'board'` + the existing param set from `buildStatusActionAnalyticsParams` | Requires the `sourceSurface` fix at `dashboard.jsx:10957` (§9.5) |

`eng_mode` is already allowlisted (`frontend/src/analytics/events.js:42`), so no bulk custom-dimension
registration is needed. `docs/README_ANALYTICS.md` must gain `board` as a value of both `eng_mode`
and `source_surface`.

**Explicit no-event allowlist** — these are deliberately not tracked:

| Interaction | Why no event |
| --- | --- |
| Focusing / folding / starring a column | View-arrangement noise; high frequency, no decision rests on it |
| Filter facet ticks, chip clears, `+n more` | Catch Up's filters emit nothing today; adding it for Board only would make the two surfaces incomparable |
| Opening the epic detail panel | Reading is not an action; the transitions performed inside it are already tracked |
| Drag started but cancelled or refused | A non-event by definition. The **completed** transition is tracked by `issue_status_action` |
| Composer edits before Save | Draft churn. The save is already covered by the settings save event |

If a later request wants funnel data on the board, add it deliberately with a named event — do not
let per-interaction tracking accrete.

## 11. Open decisions

Four of these were marked "open" while already answered elsewhere in this document — a real
internal contradiction, since it invites an implementer to re-decide something already settled.
Resolved below with a pointer to where. The remaining genuinely-open ones are resolved to the
lowest-risk default (no new UI beyond the mockups, consistent with existing app patterns) so
nothing here blocks dispatch; override any of them explicitly if the default is wrong.

| # | Question | Status | Resolution |
| --- | --- | --- | --- |
| O1 | Should editing Group Board be admin-only? | **Resolved: no** | `/api/groups-config` stays `user_write` for the `board` field, same as every other group field (`teamIds`, `excludedCapacityEpics`, `adHocCapacityEpics`, `teamLabels`, `missingInfoComponents` — none of which are admin-gated today). Matches existing pattern; revisit only if the requester wants Group Board treated differently from the rest of group config. |
| O2 | Description delivery: bulk or lazy? | **Resolved — see §9.2** | "This resolves O2" (§9.2). Lazy per-panel fetch. Kept only for the record; not a live decision. |
| O3 | Should a starred column stay on screen? | **Resolved: accept scroll-off** | No mockup demonstrates star-away-from-focus, and pinning would be new interaction design beyond both mockups. The existing off-frame hint (§6.1) already covers "a column is outside the frame"; no separate pinning behaviour is added. |
| O4 | Should Done be excluded from the bar scale? | **Resolved: moot, close it** | §4.2/§4.1: column epic/SP counts are "a single pass over epics in the selected sprint and group," and both §5.5 fixtures already show Done within range of the largest column under sprint scope (max column is 26, not Done's board-wide 347). The board-wide imbalance O4 describes cannot occur under the sprint-scoped counting this document already specifies. |
| O5 | Assignee hidden below 761px in `.story-subtask-row` — change the shared row, or accept it? | **Resolved: accept, unchanged** | The shared row is not edited at all (D32/§7.5) — priority arrives as an additive `.has-priority` modifier. Changing the base rule to fix an unrelated pre-existing mobile-width behaviour is doubly out of scope. |
| O6 | Do facet counts need to be live? | **Rewritten — see below** | D20 already makes counts functional (not cosmetic), so "do they need to be live" isn't the open part. The real open question: **do counts recompute cross-facet as other facets/search change, or only when scope (sprint/group) changes?** The mockup's own `hideEmptyOptions()` only runs once at load and never on a filter change (`board.html:1763`, defined at `:1952`), i.e. scope-change-only. Ship that (cheaper, and what the mockup actually demonstrates); flag if cross-facet recompute is actually wanted. |
| O7 | Does the ENG subtask panel show subtask priority? | **Resolved: no — closed by D32** | The question only existed because the shared row was going to gain a column. It no longer does (§6.3, §7.5): priority is an additive `.has-priority` modifier used solely by the Board's epic panel, `IssueCard.jsx` is out of scope, and Catch Up's panel renders exactly as it does today. |
| O10 | Is red too ambiguous in the colour palette, given red is also the breach signal? | **Open, non-blocking** | §5.8 keeps red and relies on breach being a border + animated glow while accent is a fill, with the reference configuration exercising both side by side. If a reviewer disagrees, drop red from `BOARD_COLUMN_COLOURS` — do not change the breach signal. |
| O8 | Should red be removed from the column-colour palette? | **Superseded by O10** | Aesthetic judgement call the document itself already frames as "not a defect" (breach states itself in words regardless). Does not block dispatch of any thread. |
| O9 | Should the composer offer *import the board's own layout*? | **Resolved: not built in v1** | The approved mockup (`group-board-settings.html`) has no button, handler, or UI for this. §9.3 still returns `columns` (cheap, already needed for the endpoint's own status catalog), but the composer does not expose an import action until a future pass adds the mockup for it. |
| O11 | Is there a correct built-in Jira field id for Delivery Owner? | **CLOSED — by deleting the guess, not by confirming it** | The plan originally shipped `DELIVERY_OWNER_FIELD_DEFAULT = 'customfield_11147'` as an unverified fallback (§9.1). A Delivery Owner custom field id is per-instance, so no value this repo hardcodes can be right everywhere, and a wrong one is worse than none: it silently reads some other instance's field and renders the result as delivery ownership. The constant is now **removed**. `get_delivery_owner_field_id()` returns `''` until an admin saves one at Settings → Admin → Mapping; while it is unset, `fetch_epic_details_bulk` does not request the field and the epic payload omits `deliveryOwner` entirely, which the card (**Not set**) and the search predicate (skips the absent candidate) already handle — both now covered by tests. Configuring the field is a normal admin action, and the Mapping picker searches the whole instance field catalog so the field is actually findable there. |

## 12. Verification

### 12.1 The reference configuration is the fixture

§5.5 is not illustrative. Both fixtures — the 7-column Northwind configuration and the
3-column name-based default — go in a shared test fixture and are asserted directly, so the
shipped board can be diffed against the agreed design rather than eyeballed.

Assert, against the 7-column fixture:

| Claim | Assertion |
| --- | --- |
| Every board status is mapped exactly once | Flatten all columns' statuses: length 12, set size 12, equal to the board's status set |
| Column order and names | Exactly `To do, Analysis, Ready to start, Accepted in Q, External block, In progress, Done` |
| Column colours | Each column's computed accent equals the value in §5.5 |
| `Pending` remains mapped | The status chip exists in `Ready to start`; it is **not** absent and **not** in the unmapped list. The shared reference fixture retains its board-wide work-item count for parity, but production renders no count because it has no `statusWorkItems` data source. |
| Exactly one starred column | `In progress`, and it is the default focus |
| Epic counts per column | `18, 11, 9, 7, 2, 26, 14`, totalling 87; bar scale max is 26 |
| Bar heights | Each folded column's fill height equals `round(epics / 26 * 100)%` |
| Breach both directions | `Analysis` flagged 4 under min 15; `In progress` flagged 6 over max 20 |
| Breach never blocks | With both breaches present, footer Save is **enabled** and the validation banner is empty |
| Empty column does block | Removing `Analysis`'s only status disables Save and fills the banner naming that column |
| Priority order within a column | `In progress` renders Blocker → Critical → Critical → Major → Major → Minor → Minor → Low → Trivial |
| Reset to defaults | Produces the 3-column fixture, still covering all 12 statuses |
| Round trip | The 7-column fixture survives save → reload in both JSON and DB modes, byte-identical |

### 12.2 The UI is transferred accurately

The mockups are the spec for geometry and class usage, not a loose reference. Each row below is a
concrete assertion, not an inspection.

| Element | Contract |
| --- | --- |
| Folded strip | width `36px`; bar hangs from the **top**; label `0.74rem` weight `600` |
| Label reading direction | `writing-mode: vertical-rl` **plus** `rotate(180deg)`; verified with a clipped screenshot, because the transform value alone does not prove reading direction |
| Open column width | one fixed value for every open column; unchanged when a second column opens |
| Focus centring | focused column centred within 1px, for every column, at 420 / 1440 / 1920 / 2560 |
| Never stacked | all columns share one row at every width |
| Header fold (D26) | clicking `.col-head .nm` folds a non-starred column; clicking a starred column's header is a no-op; clicking `.col-star` re-stars without folding; `cursor` is `pointer` when foldable and `default` when starred |
| Off-frame hint | appears only when a column is outside the frame; its count matches; the strip is `pointer-events: none` and does not swallow clicks meant for the rails |
| Breach glow | resolves to `rgb(207, 19, 34)`; **assert the computed value, not the declaration** — an undefined `--warn` silently drops the whole `box-shadow` and this was a real bug during design |
| Story row, base | a bare `.story-subtask-row` is `name · status · assignee · updated` — the app's current four cells, unchanged (D32) |
| Story row, epic panel | `.story-subtask-row.has-priority` is `pri · name · status · assignee · updated`, one left edge per column, asserted across all rows **and** after changing sort |
| Story controls | `button.task-priority-icon[data-priority]` and `button.status-pill.task-status`, both real buttons with `aria-haspopup`; no bespoke replacement class |
| Container width | the controls row and filter bar are bounded by `.container` at `1040px`; the full-bleed board's width equals `documentElement.clientWidth` (D16, D39) |
| Mode control is the shared one | the ENG mode row is `div.segmented-control.eng-mode-control` containing five `button.segmented-control-button`, exactly one `.active`; it computes `flex-wrap: nowrap`, its buttons share one `top`, and none is clipped (`scrollWidth <= clientWidth`) — the MRT020/MRT021 assertions, per control |
| No shadow chrome | the rendered tree contains no `.shell`, `.seg`, `.field` or `.compact-inner`; every chrome element resolves to a class that exists in `frontend/src/styles/` (D39) |
| Settings inherits | composer renders `.component-selector`, `.component-chip`, `.remove-btn`, `.group-modal-meta`, `.group-modal-warning`; introduces no second modal or backdrop |
| Settings preview | uses the board's own `.col` / `.col-strip` / `.fill` / `.vert`, asserted by class so it cannot drift |
| Hidden options | a zero-count facet option occupies **zero height** — `[hidden]` alone does not hide an element whose class sets `display`, which was also a real bug during design |
| No horizontal overflow | `documentElement.scrollWidth - clientWidth <= 1` at every tested width |
| Board sticky stack (D28) | At real pixel scroll offsets, compact bottom is adjacent to filter-wrapper top; hit-test each exposed band. Open a Board facet over the full-bleed board, prove a Board element is beneath it, then select an option with a plain click. |

Two failure modes above cost real time during design and must be asserted on computed geometry
rather than on declarations: an invalid `var()` dropping a whole declaration, and the `hidden`
attribute losing to an author `display` rule.

### 12.3 Catch Up shares the bar

| Claim | Assertion |
| --- | --- |
| Facet sets differ by mode | Board renders `Priority · Projects · Assignee · Track` and **no Status facet**; Catch Up renders `Status · Priority · Projects` |
| Subject is stated | The popover reads *Filtering epics* on Board and *Filtering stories* on Catch Up; the readout unit matches |
| Status reads in workflow order | Catch Up's Status options follow board-column order, not alphabetical |
| Zero-count statuses hidden | A status with no story in scope is absent from the facet (D20), driven by the data |
| Status and priority compose | Status = {In Progress, Blocked} with Priority = {Blocker, Critical, Major} yields exactly the stories matching both, with two chips — the state today's single select cannot reach |
| Empty epic groups hidden | An epic whose stories are all filtered out renders no header |
| Real count, not an estimate | The readout equals the rendered story count, not a sum of facet counts |
| Empty result | Renders an explicit empty state, not a blank list |
| Round trip loses nothing | Switching Board → Catch Up → Board restores the Board's facet set and open-column width unchanged |
| Sticky layering (D28) | At multiple actual scroll offsets, require a pinned-header witness and no steady-state overlap: `epic.top ~= filterbar-wrap.bottom` within 1px. In Catch Up assert `compact -> filter bar -> epic`; in Planning assert `compact -> Planning -> filter bar -> epic`. Hit-test separate points inside the bar and epic rects so each owns its exposed band, then select a popover option with a plain click. |
| Popover fits and scrolls (D29) | At 375x667 the panel fits both axes, scrolls internally, the last facet option is reachable, and `documentElement.scrollWidth - clientWidth == 0` |
| View controls are scoped | Sort and Group by render in Catch Up and are absent on the Board |
| Sort actually reorders | Each of the four options produces its documented epic order, tie-broken by priority; the two track directions differ from each other |
| Grouping wraps, not restyles | Enabling it produces `.initiative-group` wrappers containing every epic block, and disabling it restores the flat list |
| Rows are the app's rows | `.epic-header`, `.task-item.priority-<name>`, `.task-meta > .status-pill.task-status`, `.task-inline-meta`, `.dependency-pill.blocked` — asserted by class, no bespoke substitutes |

### 12.4 Delivery track and facet totals (D33, D34)

| Claim | Assertion |
| --- | --- |
| Both ticked is neutral | Committed + Flexible both ticked admits every epic in scope, **including epics with no track** — the readout equals the unfiltered count |
| Neutral produces no chip | With both ticked, no `Track` chip is rendered and the facet does not count toward the active-filter badge |
| One ticked filters | Committed only → exactly the committed epics; Flexible only → exactly the flexible epics; each renders one chip |
| No empty set | Unticking the last remaining option is refused; the option stays ticked and the epic list is unchanged |
| Heading total, neutral | With everything ticked, the total beside the facet heading is the facet's neutral total (all epics in scope), **not** the sum of its option counts |
| Heading total, filtered | With a subset ticked, the total is the sum of the ticked options' counts and updates on every tick |
| Every facet carries one | `Priority`, `Projects`, `Assignee` and `Track` each render a total beside the heading; none is blank or `NaN` |

### 12.5 The Catch Up boundary holds (D32, §7.5)

These are guard assertions. They exist to fail if an implementer edits inherited UI.

| Claim | Assertion |
| --- | --- |
| The list is untouched | `git diff` against the merge base touches none of the files listed in §7.5's untouchable table — a grep-level check in review, not a runtime one |
| The shared row is untouched | A `.story-subtask-row` with no `.has-priority` computes the same `grid-template-areas` as on `main`, at both mobile and `min-width: 761px` |
| Priority is additive only | `.has-priority` appears solely in the Board's epic panel; no `.story-subtask-row` inside `.story-subtasks-panel` carries it |
| Catch Up rows still render as today | `.epic-header`, `.task-item`, `.task-meta`, `.dependency-pill` render with unchanged classes and unchanged computed layout after the filter bar replaces the strip |
| Only the strip is gone | The six `.status-filter-grid` and four `.display-filter-grid` cards no longer render; nothing else disappears from the Catch Up DOM |

### 12.6 The bar holds one row, and the chips stay short (D35, D36)

| Claim | Assertion |
| --- | --- |
| One row on desktop | With every facet active, `.filterbar` height equals its single-row height at 1440 / 1280 / 960 / 800 — assert the number, not "looks fine" |
| Two rows maximum below 720px | At 360 and 375 the bar is at most two rows; the chips lane is never a row of its own |
| Responsive outer height drives the stack | At desktop and narrow widths read the live `.filterbar-wrap` rect, prove `epic.top ~= filterbar-wrap.bottom`, and prove `epicStickyTop - filterbarStickyTop` equals that outer height. The 375px witness must exercise the two-row Catch Up bar. |
| Content-width, not full-bleed | `.filterbar` width is less than its container's at 1440 with one chip active, and `max-width` clamps it at 100% when full |
| Inversion picks the smaller side | Untick Killed only → the chip reads `hidden Killed`; leave only In Progress ticked → `only In Progress`; the boundary case prefers `only` |
| Names are capped | A facet with four named options renders two plus `+2`, and the chip's `title` carries all four |
| Collapse is real, not cosmetic | At 960 with three facets active, hidden chips have zero width and the `+n more` count equals the number hidden |
| `+n more` opens the popover | Clicking it opens the facet panel and does not clear anything |
| `Clear all` never collapses | It stays visible and clickable at every tested width |
| Supported-width lane fit | `scrollWidth - clientWidth <= 1` on `.fb-chips` at supported widths. At the deliberate 360px edge case, `Clear all` remains visible and clickable while `+n more` may take the clip |
| No document overflow | `documentElement.scrollWidth - clientWidth <= 1` throughout |

The regression this guards is on record: 958px, three facets, **146px over three rows**. Assert
the height, not the appearance.

### 12.7 Dragging a card moves the epic (D37)

| Claim | Assertion |
| --- | --- |
| Single-status column | Dropping on a one-status column transitions to it with no menu |
| Multi-status column asks | Dropping on a multi-status column offers the statuses that are both configured in that column and present in Jira's offered transitions; nothing has moved yet |
| The menu is scoped by both | Options are the intersection of the column's statuses and the transitions Jira offers for that issue; a status the column holds but Jira will not accept is absent |
| Ask, then commit | The card is still in its source column while the menu is open; it moves only after the write resolves |
| No eligible transition | The drop is refused, the source column is unchanged, the target count is unchanged, no write is issued, and the live region says why |
| Same column is inert | The source column is not highlighted on `dragover` and the event is not `preventDefault`ed |
| Folded columns accept drops | A drop on a folded rail moves the epic without unfolding it first |
| Counts follow the card | Source and target epic counts, story-point totals, bar heights and the shared scale all re-derive; a move past Max makes the target glow |
| Highlight always clears | After `dragend` no `.is-drop` remains, including on a cancelled drag |
| Announced | The `aria-live` region reports the move and the refusal |
| Keyboard path intact | The epic panel's status pill still opens the same menu and performs the same transition with no pointer |
| Analytics | A board transition reports `sourceSurface: 'board'`, not `catch_up` (§9.5) |

### 12.8 Assigning a status to a column (D38)

| Claim | Assertion |
| --- | --- |
| A non-drag path exists | `+ Add status` opens a picker and a click assigns — the whole flow reachable by keyboard |
| The picker is never dead | In the all-status-mapped reference configuration, a picker lists every status held by another column: `12 - targetColumn.statuses.length` options (nine to eleven across the fixture) |
| Provenance is stated | Each row reads `not in a column` or `from <column>`; orphans sort first |
| Assign moves, not copies | After assigning, the status appears in the target column and nowhere else |
| The picker stays bounded | It may increase the composer row within its bounded height; the picker scrolls internally rather than expanding for every option |
| Chips look draggable | Every status chip renders a grip and computes `cursor: grab` |
| Both drag directions work | Pool → column assigns; column → pool orphans; both highlight their target and clear it on `dragend` |

### 12.9 Board mode, focus, schema and conflict (D40–D46)

| Claim | Assertion |
| --- | --- |
| Mode is a real fifth option | `activeEngMode === 'board'` with only `showBoard` set; the Board radio is the only one `aria-checked` |
| No Catch Up bleed-through | In Board, zero `.task-item` render and the capacity panel is absent from the DOM — the two fallthroughs at `dashboard.jsx:10416` and `:13093` |
| Board persists | `{ showBoard: true }` in `jira_dashboard_ui_prefs_v1` lands in Board; an absent key lands in Catch Up |
| Available on a closed sprint | The Board radio is enabled and the board renders, while Planning and Scenario are disabled |
| Mode round-trip | Board → Statistics → Board restores the same focused column |
| Focus is a total (D43) | After **every** focus-affecting action — load, focus, fold, star, unstar, column delete — `.col.is-focused` has exactly one element. Assert the total, not the cases |
| Zero-star config | With no starred column the board still opens exactly one, chosen by the §6.1.2 rule |
| Fold transfers focus | Folding the focused column leaves a different column focused, never none; folding the first column falls right |
| Epic side is project-inherited (D41) | Stories with different issue types but the same Jira project classify identically; an Epic with stories in both a Tech and a Product project matches **both** Projects options and is counted once; `other` matches neither |
| Resolved-column gate (D42) | Dropping an epic with open stories on Done shows the confirmation and moves nothing; *Move anyway* completes it; an epic with everything done skips the confirmation entirely |
| Schema (D44) | Each row of §5.6 has a validator unit test — zero columns, malformed and duplicate ids, blank and duplicate names, two stars, `min > max`, duplicate status across columns, empty status list. Arbitrary imported members return `errors`, never exceptions; an omitted group `board` remains legal while a present `{ columns: [] }` blocks unified Save |
| Stale status warns | The composer retains and visibly warns about a saved status missing from the live catalog; it remains non-blocking and matches no epic at runtime. The pure backend validator has no live catalog and emits no stale-status `warnings` |
| Validator stays pure | `backend/services/group_config.py` imports nothing but `json` — a source guard, because a Jira call there would run on every config read |
| Field survives storage | `board` round-trips save → reload in both JSON and DB modes. Without this the literal dict at `group_config.py:100-108` silently drops it, with no error |
| 409 keeps the draft (D45) | Any rejected groups POST leaves `groupDraft` holding the local edits, shows the conflict banner naming both sections that already committed and still-pending EPM/group-visibility sections, and keeps the modal open. *Keep mine* re-POSTs with the server's `configRevision`; *Discard mine* applies the server config |
| Unified save covers Board | Extend `tests/ui/settings_unified_save.spec.js` so every dirty section — department, EPM **and** Board — persists in one Save |
| Reorder (D46) | Drag reorders and persists as array order; `Alt+←`/`Alt+→` moves the focused column and keeps focus on the handle; the live region announces the new position |
| Colour is an enum | Only the seven `BOARD_COLUMN_COLOURS` are selectable; an out-of-enum stored value coerces to grey with a warning |
| Numeric grammar | `""` → `null`; `abc` and `-3` revert on blur and never become `0`; `min > max` blocks Save |
| Keyboard (§10.1) | Every control in the table is reachable and operable by keyboard; a starred header is out of the tab order; the epic panel traps focus and restores it on `Escape` |
| Layering (§10.2) | Catch Up witnesses compact/filter/epic adjacency, Planning witnesses compact/planning/filter/epic adjacency, and Board witnesses compact/filter plus an overlay over the full-bleed board. Each uses live rects, separate ownership hit tests, a required pinned-header witness where epics exist, and plain overlay clicks. `click({ force: true })` appears nowhere in these specs. |
| Analytics (§10.3) | A board transition reports `source_surface: 'board'`; a board pageview reports `eng_mode: 'board'`; no new event name is emitted |

### 12.10 Search

- A search matching only a Delivery Owner keeps that card; matching neither keeps nothing.
- Epics with no Delivery Owner are still matchable by key or summary — the predicate is an OR.
- Search adds no request: assert no network call fires on typing.

### 12.11 Everything else

Beyond the standard suites, this change also requires:

- **Geometry, per the repo's rules** — element-level assertions plus a settled screenshot.
  Never a screenshot alone, never container bounding boxes alone.
  - Focused column centred within 1px, for every column, at 420 / 1440 / 1920 / 2560.
  - All open columns equal width; zero card overflow past the column box.
  - The chosen panel's width is unchanged when a second column opens.
  - Board on one row at every width, i.e. never stacked.
  - `documentElement.scrollWidth - clientWidth <= 1` at every width.
  - Compact-header controls align with the unstuck controls row (zero horizontal delta), and
    the filter bar's top is never above the compact header's bottom.
  - Off-frame hints appear only when a column is actually outside the frame, and their count
    matches the number outside.
  - Column labels read bottom-to-top — assert the computed transform *and* look at a clipped
    screenshot of a rail, since the transform value alone does not prove reading direction.
- **Dropdown layering** — opening a facet or sort dropdown lifts the owning wrapper above the
  adjacent task/Board surface. Prove the exposed overlay with `document.elementFromPoint` and select
  an option with a plain click, never `click({force:true})`; the contract does not prescribe an
  obsolete `.filters-strip:has()` selector or legacy stylesheet.
- **Sort invariance** — story row markup is byte-identical across sort modes; only order
  changes.
- **Story row table alignment** — every cell in a column shares one left edge, asserted across
  all rows **and** after changing sort. This is what catches the fixed-width-box requirement on
  the priority control.
- **Inherited controls** — the story row's priority and status are the app's own
  `button.task-priority-icon` and `button.status-pill.task-status`, asserted by class and by
  being real `<button>`s with `aria-haspopup`. Assert no bespoke replacement class exists.
- **Shared-row column count** — the Board epic-detail modifier renders five cells (`pri`, name,
  status, assignee, updated), while the unchanged Catch Up subtask row renders four (name, status,
  assignee, updated); assert each consumer against its own grid contract.
- **No-empty-filter** — attempting to clear the last active option in a multi-select facet
  leaves it active.
- **Zero-count options hidden** — a facet option with no items in scope is absent from the DOM
  flow, and Select all does not re-enable it.
- **Facet order and subject** — Delivery track is last, and the popover names its subject
  (epics on Board, stories in Catch Up).
- **Settings inherits, not invents (D25)** — assert the composer renders `.component-selector`,
  `.component-chip`, `.remove-btn`, `.group-modal-meta` and `.group-modal-warning`, and that it
  introduces no second modal or backdrop of its own. A bespoke chip, label or warning class in
  `GroupBoardSettings.jsx` is a review stop.
- **Breach never blocks** — a Min/Max breach leaves footer Save enabled and the validation
  banner empty; an empty column disables Save and fills the banner. Both asserted.
- **Preview cannot drift** — the settings preview uses the board's own column classes, asserted
  by class rather than by appearance.
- **New sub-tab** — `id="department-settings-boards-tab"` exists, `boards` is a leaf and not a
  top-level tab, and the *Configure board* line in Team groups navigates to it.
- **Group config round-trip** — a `board` field survives save → reload in both JSON and DB
  modes, proving all three whitelist points.
- `tests/ui/settings_unified_save.spec.js` must gain the new section so the footer save still
  persists every dirty section together.

## 13. File map

| Path | Action |
| --- | --- |
| `frontend/src/eng/EngModeControl.jsx` | Edit — **add the fifth option** `{ value: 'board', label: 'Board' }`. Its four options are hardcoded (`:17-37`) and D2 adds a mode, so without this the board has no entry point. Add the option and nothing else: the component's whole body is one `SegmentedControl` and it stays that way |
| ~~`frontend/src/ui/SegmentedControl.jsx`~~ | **Not touched** — five options need no component change |
| ~~`frontend/src/styles/shared/controls.css`~~ | **Not touched** — `.segmented-control` already sizes to its option count. Adding a `min-width`, a `flex-wrap`, or a height override for the fifth option is the MRT020/MRT021 recurrence and a review stop (D39) |
| `frontend/src/eng/EngBoardView.jsx` | Create — board container, columns, focus/star state |
| `frontend/src/eng/engBoardColumns.js` | Create — status→column mapping, name-based default, priority sort |
| `frontend/src/eng/EngBoardEpicCard.jsx` | Create |
| `frontend/src/eng/EngBoardEpicPanel.jsx` | Create — detail panel, reusing existing controls and `.story-subtask-row` |
| `frontend/src/eng/EngFilterBar.jsx` | Create — bar, chips, facet popover; takes the facet set as
  input so Board and Catch Up share one component (§7.4) |
| `frontend/src/eng/EngView.jsx` | Edit — replace the ten filter cards with the bar; Catch Up's
  `statusFilter` and four Display toggles collapse into the Status/Priority/Projects facets per the
  §7.4 mapping. Existing source guards assert the old card labels and grids and must be rewritten:
  `tests/test_task_filter_menu_compaction_source_guards.js:25,29` (string-asserts the
  `status-filter-grid`/`display-filter-grid` class names and card labels) and
  `tests/ui/eng_compact_layout_visual.spec.js` (Playwright geometry/count assertions, e.g. `:264`). |
| `frontend/src/eng/engFilterFacets.js` | Create — facet model, the no-empty-set rule, and the chip copy rule (`hidden`/`only`, two names then `+n`, D35) |
| `frontend/src/eng/engBoardDrop.js` | Create — resolve a drop: intersect the target column's statuses with the transitions Jira offers, then 0 / 1 / many (D37, §6.4). Pure function, so the resolution is unit-testable without a drag |
| `frontend/src/eng/useEngStatusTransitions.js` | **Not edited to special-case the board** — that remains a review stop (§9.5). **One generalization is permitted, and only this one:** the hook's `isCatchUp` branch gates the optimistic local patch, so on the board a status change waits for a full scope refetch. For a menu click that is only latency; for a *dragged card* it reads as a failed drop, and the natural workaround — a board-local optimistic patch — is exactly the parallel path §9.5 forbids. Widening `isCatchUp` to `sourceSurface !== 'planning'` and **renaming it** to `isSingleIssueSurface` restores the hook's actual invariant (Planning is the batch surface; every other surface acts on one explicit issue) rather than adding a board case. Conditions: the rename ships with the widening, and a test proves Catch Up's behaviour is byte-identical. Anything beyond this is still a review stop |
| `frontend/src/eng/engStatusTransitionUtils.js` | Edit — `sourceSurface` gains `board`; `isStatusTransitionSurfaceEnabled` already admits a fifth ENG mode and must not be narrowed (§9.5) |
| `frontend/src/eng/engProjectTrackTransitionUtils.js` | Edit — added during execution. It collapsed anything not `'planning'` to `'catch_up'`, so a board track change reported the wrong `source_surface` |
| `frontend/src/eng/engBoardPanelStories.js` | Create — added during execution: the panel's story-list model (the three sort orders, status ordered by the board's own column order). Pure, so the orders are testable without a DOM |
| `frontend/src/eng/engEpicDescriptionCache.js` | Create — added during execution: the per-session description cache §9.2 requires. Keyed on backend URL + normalized epic key, and a failed entry is evicted so *Retry* re-requests. §9.3 deliberately added no server cache, which is why the client owns one |
| `frontend/src/eng/engBoardCardModel.js` | Edit in the optional-sprint production follow-up — replace Boolean `isTechTask`/negation with exact `classifyBoardProject` tri-state union; `other` matches neither option |
| `frontend/src/eng/engBoardFilters.js` | Edit in the optional-sprint production follow-up — carry the same tri-state classifier through Projects counts and admission |
| `frontend/src/eng/useEngBoardFilters.js` | Edit in the optional-sprint production follow-up — pass `classifyBoardProject` through the Board filter pipeline; this file was created during the original execution to keep `dashboard.jsx` within budget |
| `tests/test_eng_board_card_model.js`, `tests/test_eng_board_filters.js`, `tests/ui/eng_group_board_filters.spec.js` | Edit in the optional-sprint production follow-up — prove `other` matches neither and issue type cannot change a Jira-project classification |
| `frontend/src/eng/engModeState.js` | Create — lift `activeEngMode`, `applyEngMode` and the mutual-exclusion effects out of `dashboard.jsx`. This is how the fifth mode fits in 7 lines of budget headroom (§6.5.7) |
| `frontend/src/capacityClassification.mjs` | **Not edited** — its capacity/Ad Hoc rules are not the Board contract. Board Projects membership comes from the caller's explicit Jira-project tri-state classifier (D41); issue type must not affect it |
| `backend/services/group_config.py` | Edit — inject `normalize_group_board_fn` (mirroring `normalize_group_team_labels_fn` at `:29,99`), add `board` to the normalized dict at `:100-108`, and to `build_default_groups_config` `:140-151` (§5.6) |
| `backend/services/group_board.py` | Create — the pure `normalize_group_board` validator. Pure by contract: no imports that can perform I/O (§5.6) |
| `jira_server.py` | Edit — wire `normalize_group_board_fn` into the `validate_groups_config` call at `:2475-2485`; add `description` to no bulk field list (§9.2 is a separate route); add `get_delivery_owner_field_config()`/`get_delivery_owner_field_id()` with an empty no-default result until Settings saves `deliveryOwnerField` (§9.1, O11) |
| `frontend/src/settings/JiraFieldSettings.jsx` | Edit — add **Delivery Owner Field** as a fifth entry in the `groupManageTab === 'mapping'` block, alongside Parent Name Field / Story Points Field / Team Field, reusing the same search/chip/toggle markup (§9.1, O11) |
| `tests/ui/settings_unified_save.spec.js` | Edit — the 409 cases and the all-sections-dirty case (§5.7) |
| `docs/README_ANALYTICS.md` | Edit — add the `board` source surface to the status-action taxonomy (§9.5) |
| `frontend/src/settings/GroupBoardSettings.jsx` | Create — composer, built from the existing settings classes in §5.4, including the `+ Add status` picker (D38). New CSS is the column container plus the grip/drop/picker affordance layer |
| `frontend/src/styles/eng/board.css` | Create — must be added to `frontend/src/styles/eng.css`, and to `expected_partials` in `test_dashboard_css_source_import_graph_includes_feature_partials` (`tests/test_dashboard_css_extraction.py:126-142`). That test only checks a floor (`expected_partials.issubset(imported)`) — it will **not** fail if `board.css` is left out, so add it explicitly rather than relying on the test to catch a missed import. |
| `frontend/src/styles/eng/subtasks.css` | Edit — **add** a `.has-priority` modifier in both the mobile and `min-width: 761px` blocks. The base `.story-subtask-row` rules must not change (D32/§7.5) |
| ~~`frontend/src/issues/IssueCard.jsx`~~ | **Not touched** — out of scope per §7.5 |
| `frontend/src/settings/TeamGroupsSettings.jsx` | Edit — mount Group Board section; props must be added to both the destructure list and the `dashboard.jsx` spread or `tests/test_epm_settings_source_guards.js:145` fails |
| `frontend/src/settings/groupConfigUtils.js` | Edit — whitelist `board` |
| `backend/routes/eng_routes.py` | Edit — `GET /api/issues/description` (§9.2), by the same pattern as `/api/issues/lookup`/`/api/issues/subtasks` already in this file |
| `backend/routes/settings_routes.py` | Edit — `GET /api/board-config/statuses` (§9.3) |
| `backend/security/policy.py` | Edit — `authenticated_read` for **both** new routes: `GET /api/issues/description` (§9.2) and `GET /api/board-config/statuses` (§9.3), or `tests/test_endpoint_policy_inventory.py` fails |
| `tests/test_endpoint_security_matrix.py` | Edit — add **both** new routes to `SECURITY_SAMPLES["authenticated_read"]` (`:9-40`): `("GET", "/api/issues/description")` and `("GET", "/api/board-config/statuses")`. `tests/endpoint_security_samples.py` is **not** touched for either — it only covers dynamic-segment routes (§9.2, §9.3) |
| `frontend/src/api/boardConfigApi.js` | Create — fetch board statuses and the lazy epic description, each with `X-Requested-With` and a tracked surface (`tests/test_frontend_api_source_guards.js`) |
| `frontend/src/eng/engBoardSearch.js` | Create — the OR predicate over key, summary, assignee and Delivery Owner (§8) |
| `tests/fixtures/groupBoardReference.*` | Create — the two §5.5 fixtures, shared by the Python and Playwright suites |
| `frontend/src/dashboard.jsx` | Edit — wire the optional-sprint follow-up's `classifyBoardProject` into the Board-only pipeline. **Budget is 16000 lines and the file is at 15993** (`tests/test_codebase_structure_budgets.py:74`); logic stays in the new modules, and the budget changes only with an itemized justification. |
| `docs/plans/assets/eng-group-board/board.html` | Edit — **done, last task.** Epic-detail-panel description body replaced with lorem-ipsum placeholder prose of the same shape (six headings, nested lists, ~2,650 characters), per §6.3. Design notes sentences that called the body real are corrected. |

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| `dashboard.jsx` has 7 lines of headroom | All new logic in new modules; treat a budget bump as a review stop |
| A new group field is silently stripped | Round-trip test covering all three whitelist points |
| Reusing a shared component then overriding its layout | Assert the shared class and the single-row/fixed-height contract, per MRT021 |
| A fifth segment overflows the mode control | It is the control MRT020 and MRT021 were both about. Assert per-button clipping and single-row on `.eng-mode-control` itself; if five options genuinely do not fit at the narrowest supported width, shorten a **label**, never add a width override (D39) |
| The mockup drifts from production chrome again | §0's class table is the contract, and §12.2 asserts no shadow chrome renders. The asset carried `.shell`/`.seg`/`.field`/`.compact-inner` for several revisions while the document claimed it used real classes |
| The filter bar grows a second row again once real data widens a chip | The chip copy rule caps length (D35) and the lane collapses (D36), but the guard is the asserted **height**, not the appearance — §12.6. It has already regressed once, at 146px |
| Drag-and-drop grows its own transition path | §9.5 names every symbol to reuse; a new route, a second menu, or an edit to `useEngStatusTransitions` for the board's benefit is a review stop |
| Board transitions land in analytics as Catch Up | `sourceSurface` is derived from `showPlanning` alone today (`dashboard.jsx:10957`); §9.5 makes adding `board` and its taxonomy entry part of the feature, not cleanup |
| Drag becomes the only way to move an epic | The epic panel's status pill stays the keyboard path, asserted in §12.7 |
| Inventing a control that already exists | A bespoke story-priority span was written and removed during design. Every story control must resolve to a Catch Up class (D22); assert by class, not by appearance |
| Changing `.story-subtask-row` misaligns its other consumer | Assert Catch Up keeps four cells and the Board `.has-priority` modifier renders five (§6.3) |
| Wrong facet counts silently hide real filters | D20 makes counts functional; assert an option with items in scope is never hidden |
| An undefined CSS custom property silently drops a whole declaration | Hit twice during design (`--warn`, and the app's own `--text-muted`). Assert computed values, not declarations (§12.2) |
| The `hidden` attribute loses to an author `display` rule | Hit twice during design. Assert zero height, not the attribute (§12.2) |
| A red column accent reads as a breach | `External block` is `#ff4d4f`. The breach also states itself in words, but if this is unacceptable, remove red from the column palette — see below |
| `description` inflating every sprint load | Resolved: lazy per-panel fetch, never in the bulk payload (§9.2) |
| Columns implemented as seven queries | Forbidden by §9.4. Columns are a client-side grouping of epics already in scope |
| Board columns drift from the real board | Column statuses validated against the board's status set on save |
| Done dominating the bar scale | See O4 |
