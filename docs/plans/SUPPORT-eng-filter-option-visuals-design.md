# ENG Filter Option Visuals Design

| Field | Value |
| --- | --- |
| Date | 2026-09-03 |
| Status | Approved design reference |
| Issue | [#150 — Improve Filters UI](https://github.com/Juce-me/jira-execution-planner/issues/150) |
| Surface | Shared ENG task-list filter popovers and Board filter popover |

## Assessment

Issue #150 is valid, but its three requests do not all apply to the screenshot's task-list facet set.

- `EngView` renders `Status`, `Priority`, and `Projects` for stories in Catch Up, Planning, Scenario, and Statistics modes that retain the shared task list. The three stats-source-only modes and the Lead Times focus mode do not mount it.
- Board currently renders `Priority`, `Projects`, `Assignee`, and `Delivery track` for epics; it intentionally has no Status facet because status is already the board column. This change uses the Jira field's canonical `Project Track` label in the filter heading and chip.
- The requested Flexible/Committed icons therefore belong to Board's `Project Track` facet, not Catch Up's `Projects` facet.

The current shared option row in `frontend/src/eng/EngFilterBar.jsx` renders only a selection box, label, and count. Every selected row therefore leads with the same orange checkbox even though the application already has:

- active Department board colors in `group.board.columns[].colour`, with each column owning exact status names;
- the classic Jira-style status classes resolved by `getIssueStatusClassName` and colored in `frontend/src/styles/eng/epics.css`;
- the existing priority SVG renderer used by issue cards and transition menus; and
- `getProjectTrackEmoji`, which returns `🔒` for Committed and `🤷` for Flexible.

This can be implemented entirely from loaded frontend state. The existing `GET /api/issues/statuses/catalog` route exposes Jira status-category hints, but fetching it for this presentation change would add a redundant request, provide only coarse Jira category colors, and ignore the user's configured Department board colors.

## Goal

Make Status, Priority, and Project Track options recognizable before reading their labels, and let Board users filter explicitly for epics whose Project Track is unset by unticking both Committed and Flexible. Preserve every other filter-bar interaction, persistence, accessibility, and responsive layout contract.

## Recommended Design

Use the established visual treatment for each field instead of inventing a generic marker:

```text
[✓]  BLOCKED          2   ← the status label itself carries its color
[✓]  ◈ Critical      49   ← existing priority SVG

PROJECT TRACK           7
[✓]  🔒 Committed      4
[✓]  🤷 Flexible       0
```

The examples are schematic: Priority renders the existing application SVG rather than a new diamond. In the Project Track example, the heading total is `7` because neutral means all seven scoped epics are admitted: four Committed, zero Flexible, and three with no value. Named option counts deliberately sum to `4`, not `7`.

### Status

Render the Status label itself as the existing compact colored `StatusPill`. Do not add a dot, circle, swatch, or separate status-icon column: a Jira status already has a color treatment, and the colored label is the meaningful element.

Color precedence:

1. Find the first active Department board column whose exact `statuses[]` entry equals the option's status name. If its `colour` belongs to `BOARD_COLUMN_COLOURS`, use that color.
2. Otherwise reuse `getIssueStatusClassName(status)` and the existing `.task-status.*` CSS palette.
3. If the status is unknown to both sources, render the status label with a new filter-scoped neutral gray fallback. The base `.task-status` rule supplies geometry only; it does not currently supply a background.

The first matching board column wins, matching `buildBoardColumns`' established duplicate-status behavior. Invalid or legacy out-of-enum board colors never reach an inline style; they fall back safely.

Use the validated board color as the configured pill background, but do not inherit the shared status pill's white foreground. Every `BOARD_COLUMN_COLOURS` member fails 4.5:1 against white. The filter-scoped pill uses the app's dark `--text-primary` foreground, which must be verified at 4.5:1 or better against every configured, classic, and neutral background. Scope the default background and foreground to `.eng-filter-status-pill`: known `.task-status.*` rules still choose their established background, a validated inline configured color wins last, and issue-card/transition status pills remain unchanged.

The board-derived color is user configuration for the active Department, not a new persisted filter preference. Switching Department updates the colored labels from the newly active group's already-loaded board data. No cross-user or workspace ownership rule changes.

### Priority

Render the existing `renderPriorityIcon` output for every visible Priority option in every shared task-list filter and on Board. Build the Critical SVG seed from one unconditional `React.useId()` per `EngFilterBar` mount plus the facet and option ids, so two simultaneously mounted bars cannot emit the same gradient id. Wrap the reused icon in an `aria-hidden="true"` visual slot because the adjacent text already provides the option's accessible name.

Do not copy the SVG paths, create a second priority palette, or derive a replacement icon from the checkbox. The filter axes contain the established `PRIORITY_AXIS` values, so the current renderer covers the visible vocabulary. Suppress the reused icon's `data-priority` hover pseudo-tooltip only inside the filter option: the adjacent label already says the same thing, and the absolute tooltip must not be clipped by or enlarge the scrolling popover. Card and transition-menu tooltips remain unchanged.

### Project Track

Render `getProjectTrackEmoji(option.label)` in Board's `track` facet: `🔒` for Committed and `🤷` for Flexible. Keep the visible text label; the emoji is a scanning aid, not the only source of meaning.

Unlike the other multi-select facets, Project Track may reach an explicit empty selection:

- Committed + Flexible checked: neutral; all epics, including untracked epics, are admitted.
- Committed only: only Committed epics are admitted.
- Flexible only: only Flexible epics are admitted.
- both unchecked: only epics with no Project Track value are admitted.

Committed and Flexible are a fixed two-value control and remain visible even when either count is zero. This is a Project Track-only exception to the filter bar's normal hide-at-zero rule. The option's own count can be `0`; it is not hidden or disabled. Keeping both rows visible makes all four checkbox states explicit.

The heading total is the number of epics admitted by the Project Track facet in its current state, not the sum of its two named option counts:

| State for a scope with 4 Committed, 0 Flexible, and 3 unset | Heading total |
| --- | ---: |
| Both checked (neutral) | 7 |
| Committed only | 4 |
| Flexible only | 0 |
| Both unchecked (No Project Track) | 3 |

`No Project Track` means the Jira field is actually absent: `null`, `undefined`, or trim-empty. Normalize case and surrounding whitespace when recognizing Committed/Flexible, but do not classify a populated noncanonical value such as `Other` as untracked. Such a defensive unknown value is admitted in neutral state only and excluded from all three narrowed states.

When both are unchecked, the facet heading total is the count of genuinely untracked epics, the active chip reads `Project Track only No Project Track`, and a visible status line below the two options reads `No Project Track — showing epics without a value`. Expose that line as a polite status update and associate the track option group with it so the otherwise counterintuitive false/false state is clear both visually and to assistive technology. Do not add a third synthetic checkbox: `No Project Track` is the explicit meaning of the two real Jira values both being unchecked, not a Jira field value of its own. `Select all`, the chip clear action, and global `Clear all` restore the neutral both-checked state.

The last-option lock remains unchanged for Status, Priority, and Projects. It is disabled only for the Board `track` facet through an explicit model capability; do not infer special behavior from the facet id inside the generic toggle function.

Project Track state transitions:

| Current state | Action | Next state |
| --- | --- | --- |
| Both checked (neutral) | Uncheck Flexible | Committed only |
| Both checked (neutral) | Uncheck Committed | Flexible only |
| Committed only | Uncheck Committed | No Project Track |
| Flexible only | Uncheck Flexible | No Project Track |
| No Project Track | Check Committed | Committed only |
| No Project Track | Check Flexible | Flexible only |
| Any narrowed state | Select all, clear its chip, or Clear all | Both checked (neutral) |

There is no save, conflict, rollback, remote-event, retry, or auth-expired state for this filter: Board facet state is local UI state and causes no request. Explicit empty survives ordinary rerenders, data refreshes, Board mode unmount/remount, Teams-dropdown changes, and a same-scope Department round trip through the existing per-group snapshot. Teams changes preserve the current snapshot and reconcile its selection against the reduced candidates. A previously unseen Department or a new sprint snapshot follows the existing lifecycle and starts with neutral Board filters.

### Other Facets

Keep `Projects` and `Assignee` text-only. They have no approved shared icon vocabulary, and issue #150 does not authorize inventing one.

### Selection and Accessibility

- The existing `.box` remains the sole selected/unselected indicator and retains `aria-pressed` or `aria-checked` semantics on the option button.
- Give every multi-option list `role="group"` and its facet label as the accessible name. Associate `emptyDescription` only while Project Track is explicitly empty.
- Do not recolor the checkbox; it communicates selection only.
- Priority and Project Track icons are decorative (`aria-hidden="true"`). The colored Status label is not decorative: its text remains the option's accessible label.
- Color is never the only carrier of meaning: every Status retains its text label, selection state, and count.
- Keep every row at exactly three grid columns: checkbox, a `.pop-opt-content` flex cell containing the optional fixed-width visual plus a `min-width: 0` label, and count. Long labels ellipsize inside the middle cell and retain their full text in a title; named hooks replace the current `span:nth-child(2)` lock styling.
- Locked-option behavior for every facet except Project Track, title, focus, Escape handling, plain-click behavior, and touch target remain unchanged. A locked Status pill must expose the lock reason instead of masking it with the pill's nested default title.

## Module and Interface Design

Keep `EngFilterBar` as the shared presentation module and add one pure visual-resolution module at the existing ENG seam:

```js
resolveEngFilterOptionVisual({ facetId, option, boardColumns })
```

It returns one of these small descriptors or `null`:

```js
{ kind: 'status_label', configuredColour: '#597ef7' }
{ kind: 'status_label', configuredColour: null }
{ kind: 'priority', value: 'Critical' }
{ kind: 'project_track', value: 'Committed' }
```

The resolver owns facet classification, first-column-wins status lookup, palette validation, and null fallback. It performs no DOM work, React rendering, fetching, persistence, or analytics. `EngFilterBar` consumes the descriptor and delegates actual visuals to the existing priority renderer, passive `StatusPill`, status-class resolver, and Project Track helper.

Extend the generic facet interface narrowly for the one new selection state:

```js
{
    id: 'track',
    label: 'Project Track',
    kind: 'multi',
    allowEmpty: true,
    showZeroCountOptions: true,
    emptyLabel: 'No Project Track',
    emptyDescription: 'No Project Track — showing epics without a value',
    emptyTotal: untrackedCount,
    // existing fields unchanged
}
```

`engFilterFacets.js` remains vocabulary-independent. `showZeroCountOptions` retains every declared option in the rendered/neutral set for that facet; every other facet still hides zero-count options. `allowEmpty` distinguishes an absent selection (neutral/default: every rendered option checked) from an own-property explicit empty array (active empty selection). `buildFacetView` exposes the state as `isEmptySelection`, checks it before the usual zero-options-equals-neutral comparison, uses `emptyTotal` for the heading, locks no option, and lets `describeFacetChip` use `emptyLabel` and the bar render `emptyDescription`. Facets without these capabilities preserve today's empty-means-neutral, hide-at-zero, and last-option-lock behavior.

The absent-versus-empty distinction must survive same-snapshot reconciliation and reset:

- if an `allowEmpty` facet is absent, keep it neutral; never infer an explicit empty state from counts;
- if the user explicitly selected the empty state, preserve the own-property `facet.id: []` across rerenders and data/count refreshes within the current dashboard state snapshot, including when both named counts are zero;
- a corrupt non-empty selection containing no declared option ids resets to neutral rather than silently becoming the explicit no-value filter;
- Project Track's canonical option ids remain selectable at zero count, so ordinary count changes cannot make a valid non-empty track selection stale; and
- Teams-dropdown changes preserve and reconcile the current selection; a previously unseen Department or new sprint snapshot retains the dashboard's existing neutral initialization instead of introducing cross-snapshot persistence.

Add `resetFacetSelection(selection, facet, counts)` rather than making callers infer reset semantics from array length. For `allowEmpty`, it returns a clone with the facet's own property removed, so reset cannot mean explicit empty. For every ordinary facet, it assigns `neutralFacetSelection(facet, counts)` exactly as today; this is required because Catch Up translates `selection.projects` back into the independent `showTech`/`showProduct` booleans. `Select all` and chip clear use this helper, while each consumer's existing global-clear callback remains authoritative.

`engBoardFilters.js` separates `normalizeTrackId(epic)` from `hasNoProjectTrack(epic)`. It counts only null/undefined/trim-empty values into `emptyTotal` and admits exactly those epics when `trackView.isEmptySelection` is true. A populated unknown value remains admitted only while the facet is neutral. This is Board-local domain behavior; the shared bar does not decide which epics match.

Extend the shared bar interface with only the dependencies it cannot derive:

```jsx
<EngFilterBar
    boardColumns={activeBoardColumns}
    renderPriorityIcon={renderPriorityIcon}
    {...existingProps}
/>
```

`EngBoardView` already receives both `board` and `renderPriorityIcon`. `EngView` needs those two values threaded from `dashboard.jsx`. Do not make the facet domain models own React visuals or add visual metadata to persisted filter state. The Board filter selection already stores arrays in local React state, so `track: []` needs no schema or persistence migration; its lifetime continues to be governed by the existing per-group/per-scope snapshot code.

This keeps the behavior behind one shared module: both consumers get the same visual rules, while filter models remain pure membership/count models and callers do not duplicate facet-specific rendering.

## Preserved Contracts

- No backend route, Jira request, JQL, cache, credential, auth, CSRF, storage, or database change.
- No change to `engCatchUpFilters.js` selection/count semantics.
- No change to Status workflow ordering, Priority ordering, neutral totals, `Select all`, or `Clear all`.
- The only filter-domain changes are the Board Project Track facet's explicit empty selection, canonical label, and fixed rendering of both canonical options at zero count. All other multi-select facets retain their current hide-at-zero rule, last-option lock, and empty-selection reconciliation.
- No change to the Board's absence of a Status facet or the shared task-list bar's absence of a Project Track facet.
- No change to filter persistence/snapshot ownership or the rule that facet ticks emit no analytics.
- No change to popover width/max-height, sticky layering, or the one-row outer filter bar.
- No styling changes to issue-card/transition status pills, priority transition menus, Project Track controls, Board columns, or Settings; all new presentation rules are filter-scoped.

## Alternatives Considered

### Color the checkbox itself

Rejected. It conflates selected state with status meaning, makes an unselected status lose its color, and weakens the consistent orange selection affordance across facets.

### Add a separate Status color dot

Rejected after product review. The Status label itself already has a color treatment; a separate dot duplicates the same information and adds another column without improving meaning.

### Fetch Jira's status catalog when the filter opens

Rejected. The catalog route is useful for transition/configuration workflows but would introduce a new request for already-rendered story data, supply coarse category colors rather than Department board colors, and create failure/loading behavior for a decorative enhancement.

### Copy priority SVGs into the filter bar

Rejected. The app already has one priority renderer and color vocabulary. A copy would drift from issue cards and transition menus.

### Put visual descriptors into every facet option

Rejected. Status colors depend on active Department board configuration, while priority and track visuals are presentation rules. Enriching the filter model would mix view details into its pure filtering interface and force callers to rebuild otherwise stable facet data when only appearance changes.

### Add a third `No Project Track` checkbox

Rejected. The product requirement is specifically that both real values can be unchecked. An invented third value would look like a Jira field value, permit contradictory three-checkbox combinations, and require extra mutual-exclusion rules. The explicit empty-selection capability expresses the state directly and gives it a visible chip/readout.

## File Map

| Path | Action |
| --- | --- |
| `frontend/src/eng/engFilterOptionVisuals.js` | Create the pure descriptor resolver and board-status color lookup. |
| `frontend/src/eng/EngFilterBar.jsx` | Render Status labels as colored pills and optional Priority/Track visuals inside one named middle cell; use a per-mount SVG id prefix, expose the explicit-empty status line, preserve option-button semantics, and use the facet-aware reset helper. |
| `frontend/src/eng/engFilterFacets.js` | Add opt-in `allowEmpty`/`showZeroCountOptions`/empty-copy semantics plus the precise whole-selection reset, while preserving every existing facet's default behavior. |
| `frontend/src/eng/engBoardFilters.js` | Rename the facet label to Project Track, opt only it into fixed zero-count options and empty selection, distinguish blank from unknown values, count/admit genuinely untracked epics, and preserve absent-neutral versus explicit-empty state within the current snapshot. |
| `frontend/src/eng/EngView.jsx` | Accept active board columns and the existing priority renderer, then pass them to the shared bar used by Catch Up, Planning, Scenario, and applicable Statistics modes. |
| `frontend/src/eng/EngBoardView.jsx` | Pass its existing `board.columns` and `renderPriorityIcon` to the shared bar. |
| `frontend/src/dashboard.jsx` | Thread `activeGroup?.board?.columns` and `renderPriorityIcon` into the shared task-list `EngView`; do not alter the renderer implementation or increase the file's structure budget. |
| `frontend/src/styles/eng/filter-bar.css` | Add the scoped neutral Status background/readable foreground, the named middle-cell/ellipsis contract, the fixed decorative slot, and priority-tooltip suppression while retaining exactly three grid columns. Reuse existing known-status/priority palettes. |
| `docs/features/eng-workflows.md` | Document that Project Track always shows both canonical values, both unchecked means only genuinely unset values, the neutral heading includes unset epics, and reset/new scope restores neutral. |
| `tests/test_eng_filter_option_visuals.js` | Add pure visual-resolver coverage. |
| `tests/test_eng_filter_facets.js` | Prove fixed zero-count options, the opt-in empty-selection state, totals, chip copy, exact reset branching, unchanged default hide/lock behavior, and Catch Up Projects reset compatibility. |
| `tests/test_eng_catch_up_filters.js` | Preserve existing task-list facet count/reset behavior and align Project Track terminology in adjacent source assertions/comments. |
| `tests/test_eng_board_filters.js` | Prove the Project Track label, all four states, neutral-versus-option totals, one-sided/all-zero counts, zero-result no-track, blank-versus-unknown membership, and same-snapshot reconciliation. |
| `tests/test_task_filter_menu_compaction_source_guards.js` | Guard the shared wiring, decorative semantics, and no-fetch/no-persistence boundary. |
| `tests/test_analytics_source_guards.js` | Retain the existing no-event allowlist contract for filter visuals/ticks and guard against a new event path. |
| `docs/README_ANALYTICS.md` | Expand the existing ENG filter no-event rationale to cover passive option visuals and explicit No Project Track state without adding an event or parameter. |
| `tests/ui/eng_compact_layout_visual.spec.js` | Verify Catch Up's configured/classic/neutral Status colors and contrast, priority icons and unique SVG ids, tooltip suppression, behavior parity, mobile reachability, geometry, and open-popover screenshots. |
| `tests/ui/eng_group_board_filters.spec.js` | Verify the Project Track heading/total, Board priority icons, Committed/Flexible glyphs, all four states, accessible empty-state copy, zero results, existing no-analytics behavior, ordinary scope reset, and open-popover screenshots. |
| `frontend/dist/*` | Regenerate with `npm run build`; never hand-edit. |

No backend or API test file is in scope because the endpoint matrix is unchanged: this feature adds zero routes and zero requests.

## Implementation Sequence

0. Capture the settled base-ref desktop/mobile filter popovers before source or CSS edits, or render the named base ref in a clean comparison checkout. A screenshot taken only after implementation is not before-state evidence.
1. Add RED pure-model cases proving Project Track can transition `both → Committed → empty → Flexible → both`, keeps both canonical options visible at one-sided and all-zero counts, reports the full scope rather than the named-option sum while neutral, and allows an intentional zero-result empty state, while every other multi facet still hides zeroes and refuses its last untick.
2. Add RED unit cases for exact first-column status ownership, invalid-color fallback, blank-versus-populated-unknown track membership, reset behavior for allow-empty versus ordinary facets, and the descriptor returned for Status/Priority/Track versus text-only facets.
3. Add RED Playwright assertions for colored Status labels and the icon slot on every applicable sibling option, including all configured board colors, representative classic fallbacks, and a genuinely unknown Status; task-list and Board Priority facets; both always-visible Project Track values; computed contrast; unique gradient ids; grouped accessibility; and the explicit-empty status announcement.
4. Implement opt-in fixed-option and empty-selection support in the generic facet model and activate both only in `engBoardFilters.js`, including strict untracked counts/admission and `No Project Track` chip/status copy.
5. Implement the pure visual resolver and shared three-cell option-row rendering, then thread active board columns and the existing priority renderer through both shared-bar consumers.
6. Add scoped CSS for the compact Status label, readable foreground, middle-cell ellipsis, Priority/Track slot, and priority-tooltip suppression. Do not override `.task-priority-icon`, `.task-status`, or the outer filter-bar layout globally.
7. Update the Board behavior documentation and re-run behavior coverage proving Status/Priority/Projects hide/lock behavior, Catch Up Projects reset, Select all, chips, counts, scope resets, and analytics remain unchanged; separately prove Project Track's new label, neutral total, and empty state.
8. Capture and inspect settled after-state screenshots with each decorated popover open at desktop and 375px; include the Board's both-unchecked controls, status line, active chip, and readout in one shared frame. Then rebuild generated frontend output.

## Verification Contract

### Unit and source checks

- A configured Status label uses the color of the first board column that owns its exact name.
- A Status label with no configured column, or an invalid configured color, returns no override and uses the classic status class where known; a genuinely unknown status receives the filter-scoped neutral background rather than a transparent pill.
- The computed filter-pill foreground has at least 4.5:1 contrast against every `BOARD_COLUMN_COLOURS` member and every classic/neutral fallback background used by this surface.
- Priority and Track resolve to their existing visual vocabularies; Projects and Assignee resolve to `null`.
- The resolver imports no API, storage, analytics, or React module.
- The priority SVG implementation remains single-sourced in `dashboard.jsx` for this slice.
- An absent `track` selection remains neutral, while own-property explicit `track: []` is active, has admitted total `untrackedCount`, produces `Project Track only No Project Track`, and admits only epics with no Project Track.
- With four Committed, zero Flexible, and three unset epics, the neutral Project Track heading total is `7`, while the option counts remain `4` and `0`; the heading must not collapse to their sum.
- Committed and Flexible both render at count zero. With only Committed in scope, `Committed` checked/`Flexible` unchecked is narrowed rather than neutral; with neither named value in scope, both controls still render and can enter/leave explicit empty.
- Null, undefined, and trim-empty Project Track values match No Project Track. A populated unknown value does not; it is admitted only in neutral state.
- If every Epic has a named track, explicit `track: []` remains active with total/readout zero and does not get reconciled back to neutral.
- `resetFacetSelection` deletes an `allowEmpty` facet but writes today's neutral option list for ordinary facets; clearing Catch Up Projects still restores `showTech: true` and `showProduct: true`.
- A corrupt non-empty track selection containing no canonical id resets to neutral, never to the no-track filter.
- `allowEmpty` and `showZeroCountOptions` are opt-in: explicit empty selections on Status, Priority, and Projects still reconcile to neutral, their zero-count options stay hidden, and their last checked option remains locked.
- Multi-option lists expose labelled group semantics. Only explicit-empty Project Track uses the polite description association, and a nested Status pill does not mask a locked option's explanation.

Run:

```bash
node --test tests/test_eng_filter_option_visuals.js tests/test_eng_filter_facets.js tests/test_eng_catch_up_filters.js tests/test_eng_board_filters.js tests/test_task_filter_menu_compaction_source_guards.js tests/test_analytics_source_guards.js
```

### Browser behavior and geometry

At 1440px Catch Up:

- every visible Status label is itself a compact colored pill and no separate status dot/swatch renders;
- Status labels assigned to active board columns use those exact computed colors;
- a known but board-unmapped Status uses the established classic color, and a genuinely unknown synthetic Status uses a nontransparent neutral fallback;
- the computed text/background contrast is at least 4.5:1 for a fixture exercising every configured board color;
- every visible Priority option has exactly one existing `.task-priority-icon` SVG;
- all rendered `priority-grad-*` ids are unique, each Critical path references its own local id, and hovering a filter Priority icon creates no pseudo-tooltip or overflow;
- Projects has no visual slot;
- toggling an option changes only selection state and results, not its color/icon identity;
- each row's checkbox, label or icon+label, and count are vertically centered; labels and counts are neither clipped nor overlapped; and option height stays within the current compact-row contract.
- switching to a Department that maps the same Status differently updates the label color from already-loaded configuration without an extra request, and switching back restores the original color.

Planning, Scenario, and one Statistics mode that retains the shared task list receive the same Status/Priority rendering through `EngView`; a stats-source-only view and Lead Times focus mode continue not to mount that bar.

At 1440px Board:

- every Priority option has the same icon class/SVG vocabulary as the Board cards;
- the facet heading reads `Project Track`; with four Committed, zero Flexible, and three unset epics it reads `7`, while its always-visible option rows read `🔒 Committed 4` and `🤷 Flexible 0`;
- unticking the last selected Project Track option succeeds, leaves both option buttons `aria-pressed="false"`, shows the chip `Project Track only No Project Track` plus the associated polite status line, updates the facet/readout totals, and renders only genuinely blank/unset epics;
- checking either option from the empty state removes the no-track meaning and filters to that checked value; `Select all` and both clear actions restore both checked;
- a scope with named tracks but no untracked Epic can still enter No Project Track, shows zero in the heading/readout, and renders the existing active-filter empty state;
- Projects and Assignee remain text-only;
- the Board still has no Status facet; and
- a normal click, never `force: true`, toggles each decorated option.

At 375x667 Catch Up and Board:

- the popover remains within the viewport, scrolls internally, and its final option remains reachable;
- no document horizontal overflow is introduced;
- long labels and three-digit counts stay clear of the fixed visual slot; and
- the outer filter bar and sticky stack retain their existing measured heights/adjacency.

Capture settled before/after screenshots for Catch Up desktop/mobile and Board desktop/mobile with the popover open. The Board no-track after-state must show both unchecked rows, the explanatory line, active chip, and readout together. Inspect the screenshots in addition to element-level `scrollWidth/clientWidth` and bounding-edge assertions, applying MRT020/MRT021.

Run the focused browser files:

```bash
npx playwright test tests/ui/eng_compact_layout_visual.spec.js tests/ui/eng_group_board_filters.spec.js
```

Then run the pinned Node 20 build and full repository verification:

```bash
npm run build
npm run test:frontend:unit
npm run test:frontend:ui
python3 -m unittest discover -s tests
git diff --check
```

Commit the generated `frontend/dist` output with the source change. Re-run `npm run build` from the repository's required clean Node 20 dependency environment and require `git diff --exit-code` so CI's generated-build check cannot discover a stale bundle or machine-specific source-map path.

## Acceptance Criteria

- Shared task-list Status option labels are themselves colored using the active Department board color when mapped, otherwise the established Jira-style fallback; no separate status dot or circle is rendered.
- Every Status option has a nontransparent background and readable text; configured board colors pass 4.5:1 contrast without changing status pills outside the filter.
- Shared task-list and Board Priority options show the same existing icons used on issue/epic cards.
- The Board facet is labelled `Project Track`; its heading shows the full admitted total, and its `🔒 Committed` and `🤷 Flexible` rows always remain visible with their independent counts, including zero.
- Board users can uncheck both Project Track values; this filters only to epics whose field is null/blank and shows `Project Track only No Project Track`, an in-popover explanation, and the correct count. A populated unknown value is not mislabeled as no track.
- The Project Track no-project state survives ordinary rerenders, data refreshes, Board mode switches, Teams-dropdown changes, and same-scope group restoration until the user checks a value, selects all, clears the chip, or clears all filters. A previously unseen Department or new sprint snapshot retains today's neutral initialization.
- Status, Priority, and Projects still prevent an empty selection; the exception does not weaken their last-option lock.
- Selection remains communicated by the existing checkbox/radio indicator; colors and icons do not replace labels or semantic state.
- Projects and Assignee remain unchanged and receive no invented icons.
- Outside the explicit Project Track empty-selection state, filter results, counts, ordering, persistence, chips, analytics, requests, keyboard behavior, popover fit, and sticky layout are unchanged.
- Desktop and mobile screenshots plus element-level geometry assertions show no clipping, overlap, or unreachable options.

## Analytics Impact

No new event is needed. Status/Priority/Track visuals are presentation-only, and the no-project-track state is reached through the existing Project Track facet tick interaction. The existing `docs/README_ANALYTICS.md` no-event row already covers ENG Board/task-list facet ticks, chip clears, and `+n more`; the new state does not introduce a new trigger or workflow. Keep that row authoritative, extend `tests/test_analytics_source_guards.js`, and extend the existing Board browser no-event case through empty-state entry/reset. No taxonomy or GA4 runbook change is required because no canonical event changes.

## Out of Scope

- Native Jira board-column discovery or color fetching.
- New icons for Projects or Assignee.
- Rendering icons inside active-filter chips.
- Adding a synthetic `No Project Track` checkbox or Jira field value.
- Changing filter facet order, persistence, state-snapshot ownership, or default selections; only Project Track's label, rendered zero-count options, and admitted set/count/copy change for explicit `track: []`.
- Extracting or redesigning the existing priority renderer beyond passing it through the existing prop pattern.
- Any issue-card, Board-column, transition-menu, Settings, backend, auth, or data-model change.

## Residual Risk

The phrase "colors from the board" is interpreted as the active Department's configured ENG Group Board columns, because that is the only per-column color source already loaded by this application. If the intended source is a native Jira Software board instead, the issue needs a separate data/API decision before implementation; Jira's existing status catalog route is not equivalent to native board-column colors.
