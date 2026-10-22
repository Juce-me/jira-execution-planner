# Lead Times Modes — Design

| Field | Value |
| --- | --- |
| Date | 2026-10-22 |
| Status | Approved by the operator 2026-10-22; implemented by [DONE-lead-times-modes.md](DONE-lead-times-modes.md) (accepted 2026-10-22) |
| Branch | `feature/lead-times-modes` (from `origin/main`) |
| Type | Feature (Statistics > Lead Times): frontend, one backend route, share links, docs |

## Intent

Lead Times answers one question today: "of the Epics **created** in a quarter range, how long did they take to
finish?" The operator also needs the reverse: "of the Epics that **finished** in a recent window (or the most recent
N), how long did they take, and when were they created?" Old Epics that closed recently (the ones with the longest
lead times) never appear in today's view because creation date bounds the query.

## Goals

1. A single-select **mode** at the start of the Lead Times control bar: `Created`, `Closed`, `Last N`. The three modes
   are mutually exclusive ways to choose the Epic set. They never combine.
2. Each mode shows exactly one mode-specific selection control:
   - `Created` → **Created quarter** (Start, End). Today's control, renamed. Behavior unchanged.
   - `Closed` → **Closed quarter** (Start, End). Epics that reached a terminal status in the range, whenever created.
   - `Last N` → **Number of epics** (dropdown: 30, 50, 60). The N most recently closed Epics.
3. The heatmap is built from the Epic set the mode produced. In `Closed` and `Last N`, rows start at the creation
   period of the earliest-created Epic in the set and end at the latest-created one (empty periods in between
   stay as rows, as today).
4. All other filters apply on top of the chosen set in every mode: Group By (Quarter/Month), Project,
   Exclude (Ad Hoc, Excluded Capacity), status chips.
5. The **Assignee** filter is removed from Lead Times.

## Non-goals and anti-goals

- Not combining modes (no "created in X and closed in Y").
- Not changing Created-mode results, request shape defaults, or its Team-or-Component scope.
- Not touching the Board, other Statistics views, or the Sprint selector.
- Not adding a new heatmap, new chart, or new Epic metric. Lead-time definition (`docs/features/statistics.md`
  "Lead Time Definition") is unchanged.
- Failure even if it "works": the closed modes silently dropping long-lived Epics (the whole point of the mode), a
  shared link opening in a different mode than it was made in, or a closed-mode Jira link that opens a different
  set than the chart lists.

## Decisions by the operator (as given)

- Mode is a single select; selecting it reveals only that mode's control (2026-10-22).
- In both closed modes the Epic set is the Board's **exact-Component scope** (Epics whose Jira Component matches
  one of the Department's configured Components; no Team matching). Only when the Department has no Components
  configured, the closed modes fall back to today's Team-or-Component query. Created mode stays as is
  (2026-10-22).
- Closed modes derive the heatmap's first row from the creation date of the earliest closed Epic in the set.
- **"Closed" means `Done`, `Killed` or `Incomplete`** (operator, 2026-10-22). `Postponed` is treated like To Do: it
  is not closed, and Postponed Epics are excluded from both closed modes entirely (set, cards, charts; no chip).
  Created mode is unchanged: there `Postponed` stays terminal and keeps its chip, because that view's
  existing contract (`docs/features/statistics.md`) says so.
- **Last N counts after the filters** (operator, 2026-10-22): "Last 30" shows up to 30 Epics that pass the current
  Project, Exclude and status-chip filters. The server returns one bounded window of the most recently closed
  Epics; the client filters, orders by terminal date and keeps N. Changing N or any filter never refetches.
- **Share links add optional keys and stay at `v=1`** (operator, 2026-10-22). A tab still running an older build
  opens a closed-mode link as Created until it reloads; this is accepted.

## Calls made by the author (change any of these)

- **A1. Resolved by the operator, see Decisions:** closed = `Done`, `Killed`, `Incomplete`; `Postponed` excluded.
  Detail calls: the closed modes need their own closed-status set, because `is_terminal_epic_status` and
  `resolve_terminal_date_from_history` in `jira_server.py` include `Postponed` and Created mode must keep them
  unchanged. The status chips (Done, Killed, Incomplete) narrow the set afterwards, as they do today.
- **A2. Resolved by the operator, see Decisions:** Last N counts after the filters, via a bounded server window
  sliced on the client. Detail calls: the window ceiling is 200 Epics (the builder may change it; it must stay in the
  same order of magnitude as the changelog-enrichment cap), the client orders by computed terminal date descending
  with ties broken by key, and Epics whose terminal date could not be resolved (enrichment cap or timeout) are left
  out of the ranking with a visible warning.
- **A3. Closed quarter keeps the quarter picker** even when Group By is Month, as Created quarter does today.
- **A4. "Number of epics" is a dropdown with 30 / 50 / 60.** No free number.
- **A5. Open-work parts are hidden in the two closed modes**, because the set contains only closed Epics: the
  heatmap's `Open` column, the `In Progress` and `Postponed` status chips, the Workflow Status card and the Open
  Epics chart. The Epics Overview, Avg/Median Lead Time cards and the Completed Epics chart stay.
- **A6. Each mode remembers its own selection** (created range, closed range, N) for the session and wherever
  `cohortStartQuarter` persists today, so switching modes and back restores it. Default mode is `Created`; the
  default closed range and Created range are the current quarter, N defaults to 30.
- **A7. Project scope for the closed modes is the existing cohort project scope** (`_cohort_project_scope()`),
  combined with the Component match. The Board's own Product/Tech project set is not introduced.
- **A8. Heatmap column budget in the closed modes gets an overflow column.** Today, an Epic whose elapsed periods
  exceed the budget (12 quarters / 24 months) is counted in the row's `Created` total but silently left out of
  every cell. In the closed modes that would drop exactly the long-lived Epics. In those two modes, elapsed values
  past the budget are summed into a last `Q+12+` / `M+24+` column. Created mode keeps today's behavior (existing,
  out of scope here; recorded so it is not mistaken for a regression).
- **A9. Analytics: no new event.** Same allowlist decision as the other uninstrumented Lead Times controls
  (`docs/README_ANALYTICS.md`, Lead Times capacity cohort filter row). The alternative is a `stats_action` with
  `chart_id=lead_times`, `mode` (`created|closed|last_n`) like the Project Track Mode toggle; say so if wanted.
- **A11. Ad hoc Epics in the closed modes** are tagged `capacityType: "ad_hoc"` when they match the Component scope, but
  the Created-mode widening (`OR key in (<ad hoc keys>)`) is not applied: the closed modes are Component scope
  only, as decided. An ad hoc Epic outside the Components therefore does not appear there.
- **A10. Mode is a dropdown** (operator, 2026-10-22: "dropdown as assignee"): a `select.scenario-input` in a
  `.stats-control-group`, the same kind as Project and the Assignee filter it replaces in the bar. A segmented
  Mode group would not fit the bar (about 957 of 966 px are used today) and would wrap Exclude in Created and Closed
  but not in Last N. The Number-of-epics dropdown is the same kind of select; the quarter modes keep
  `StatsRangeControl`. No new classes (project rule: a new class for an existing control kind is a review-stop; register anything
  genuinely new in `docs/design-system.md` and the ratchet allowlists).

## Current state (verified 2026-10-22 against `origin/main`)

- Control bar and cards: `frontend/src/stats/StatsPanel.jsx` (Lead Times block, `statsView === 'cohort'`).
- State: `useStatsState.js` / `statsGroupState.js` (per Department group; field list is frozen by
  `tests/test_stats_group_state.js`), saved prefs, `shareView/captureState.js` + `codec.js` + `viewDefaults.js`.
- Fetch: `useStatsData.js` effect (explicit read and the #251 automatic read `runAutomaticStatsRead(... 'stats_cohort' ...)`),
  `cohortQueryKey`, client cache `cohortCacheRef`, `requestEpicCohortStats` in `frontend/src/api/statsApi.js`.
- Data model: `frontend/src/cohort/cohortUtils.js` (`filterCohortIssues`, `buildCohortGridModel`,
  `buildOpenEpicsBars`, `buildCompletedEpicsBars`, `deriveAssigneeOptions`); rendering `CohortGrid.jsx`,
  `LeadTimesEpicCharts.jsx`, `LeadTimesWorkflowStatusCard.jsx`.
- Backend: `POST /api/stats/epic-cohort` → `get_epic_cohort_stats`, `resolve_epic_cohort_range`,
  `_build_epic_cohort_cache_key`, `fetch_epic_cohort_data` in `jira_server.py`. Query today:
  `issuetype = Epic AND (project in (...) OR key in (<ad hoc epics>)) AND created in [start, end]`, then
  `build_missing_info_scope_clause` (Team OR Component). Terminal dates come from `resolutiondate`, else the
  changelog (capped by `EPIC_COHORT_ENRICH_MAX_ISSUES=200` and a 10 s budget).
- Board Component scope: `backend/services/eng_board.py` (`split_component_batches`, `iter_component_epic_batches`,
  `build_epic_index_jql`). It matches Components exactly and keeps closed Epics only for a 28-day retention window,
  so the Board index itself cannot be reused for the closed modes. Its Component batching (URL-byte budget, MRT031)
  can be.
- Jira links: `LeadTimesWorkflowStatusCard` and `LeadTimesEpicCharts` build Jira search URLs from the created quarter
  range and the assignee filter via `buildJiraCohortStatusSearchUrl` / `buildJiraCohortIssueSearchUrl`
  (`frontend/src/jiraExportUtils.mjs`).

## Behavior

### Controls

Row 1, left to right: **Mode** (dropdown: `Created`, `Closed`, `Last N`), the mode's selection control, Group By,
Project, Exclude: the same five groups as today (Mode takes the slot the Assignee filter leaves). Row 2: status chips
(only Done, Killed and Incomplete in the closed modes, A5). Then the four cards, the heatmap and the Epic charts.
Switching mode swaps only the selection control, clears the selected heatmap row, and loads that mode's data (client
cache hit when the same request was already made). The bar keeps one row and the same height in every mode, with no
clipped or overflowing label. The stretchy selects (Mode, Number of epics, Project) share the free space, so their
widths and the positions of the controls after them may move (about 46 px, measured below) when the fixed-width quarter range is
swapped for the Number-of-epics select; that flex is accepted, a change of row count or height is not. The
Playwright geometry assertions state exactly this.

### Request

`POST /api/stats/epic-cohort` gains `mode`. The client omits it for `created` (the Created request body stays
byte-identical; the server treats an absent `mode` as `created`) and sends it for `closed` and `last_n`. A present
`mode` that is null, empty or unknown is a 400. `startQuarter`/`endQuarter` are sent for `created` and `closed`. `last_n` carries no N and no quarters: N is client-only
state (the server returns the recent window, see below). Invalid combinations (unknown `mode`, quarters sent with
`last_n`, missing quarters for the other modes) answer 400 with the existing error shape. The `end quarter cannot be after the current quarter` rule
applies to `closed` as well. `assignee` data may stay in the payload (Completed Epics rows still show an assignee
name); only the filter goes.

### Epic set by mode

- `created`: unchanged.
- `closed`: Component-scoped Epics (A7) whose **terminal date**, computed exactly as today (`resolutiondate`, else
  first terminal transition in the changelog), is inside the closed range. The query must not rely on
  `resolutiondate` alone, because terminal Epics without it exist and would vanish; it must be a superset query
  (terminal status plus a window condition that also catches status transitions) followed by a post-filter on the
  computed terminal date, so the displayed set equals the definition above. Epics whose current status is not
  `Done`, `Killed` or `Incomplete` (including `Postponed` and every open status) are excluded even if they once
  closed.
- `last_n`: the window (A2) of Component-scoped closed Epics with the latest computed terminal date, ties broken
  by key; Component batches return partial lists that are merged before the ceiling is applied. `meta` states
  whether the window is full (more closed Epics exist beyond it). The client then applies Project, Exclude and the
  status chips, orders by terminal date, and keeps N. If the filters leave fewer than N and the window is full,
  the panel says "Showing X of N: filters leave fewer than N Epics in the most recent 200 closed". If the window is
  not full, fewer than N is simply everything that exists and needs no warning.
- No Components configured: both closed modes use the existing Team-or-Component clause with no `created` bound
  instead of the Component-only clause (the Team clause has no Components to add; the existing helper already
  produces it from the Department's Teams). This fallback is a warning-free path but the panel states the scope
  actually used (see "Scope visibility").

In the closed modes the heatmap's row span is computed on the client from the **displayed** Epics (after the
filters and, for `last_n`, after the N slice): earliest to latest created period, with empty periods between kept
as rows. A server-supplied `range` would keep rows for Epics a filter has removed. `meta` gains `mode`, the closed
window for `closed`, and the window ceiling and full/not-full flag for `last_n`, so the client never infers them
from request state. An empty set returns `issues: []` and the panel shows the existing empty state wording adapted
to the mode.

### Heatmap and cards in the closed modes

Row labels, cell counts, hover detail and status colors are unchanged. Rows span the displayed Epics (above). The overflow column is A8.
`totalCreated` ("Created") keeps its meaning (Epics in the set created in that period). Hidden parts: A5. The
Completed Epics chart's description and the card notes name the mode ("Closed in <range>" / "Last N closed"), and
its Jira link reproduces the displayed set (see "Jira links").

### Scope visibility

The active mode and its value are visible in the view itself (the mode control and its selection control), per the
project rule that scoped views show their scope. When the closed modes use the Team-or-Component fallback or the
Component-only scope, a one-line note under the controls says which ("Scope: Components" / "Scope: Teams or
Components (no Components configured)").

### Jira links

`created` mode links are **frozen**: today's construction minus the assignee clause, nothing else. Two divergences
already exist there and are out of scope, recorded so they are not mistaken for regressions: the link ANDs the
Component and Team clauses while the server ORs them, and the Exclude Ad Hoc / Excluded Capacity toggles are not in
the links.

In the closed modes, each link opens exactly the Epics its chart currently lists (post-filter: Project, Exclude,
status chips, selected heatmap row), as an explicit `key in (...)` list, because terminal dates can be
changelog-derived and not expressible in JQL. The link is hidden when the list would exceed a URL length limit;
the builder sets that limit and may use a JQL form instead when it is provably identical to the listed set
(verified against real Jira, see Verification).

### Share links

A Lead Times link made in `closed` or `last_n` must open in that mode on a current build. Two additive optional
keys join the `cohort` view: `lead` (`closed` or `last_n`; absent means `created`) and `n` (30, 50 or 60; only with
`lead=last_n`). The version stays `v=1` (operator decision): the decoder already ignores unknown keys and every
existing link keeps decoding as Created. The link carries **only the active mode's selection**: `created` writes
`from`/`to` as today; `closed` writes `lead=closed` plus `from`/`to`, which then mean the closed range; `last_n`
writes `lead=last_n` and `n` and omits `from`/`to` (so `encodeRange` must return `undefined` for it and the decoder
must accept a Lead Times link without them). Selections of the inactive modes are not carried; the recipient gets
their defaults. Invalid `lead` or `n` values fall back to Created defaults, as invalid values do elsewhere in the
codec. Update `SHARE_VIEW_STATS_KEYS_BY_VIEW.cohort`, capture, apply and the codec tests. The known cost is the
stale-tab case in the Decisions list; the shareable-links doc states it.

### Persistence and state

New per-group fields for mode, closed range and N sit beside `cohortStartQuarter`/`cohortEndQuarter` in the stats
group state seam and saved prefs; the removed `cohortAssigneeFilter` is deleted from state, defaults, apply/capture,
saved prefs reads (a stale saved value is ignored) and the frozen field list in tests. `cohortQueryKey`, the client
cache and the server cache key include the mode and its fetch parameters (the quarter range for `created` and
`closed`; nothing for `last_n`, whose N is client-only) so two modes never share a cache entry. The #251
automatic read sends the identical request shape as the explicit read.

## Constraints

- Initial dashboard load and the Lead Times first paint must not get a heavier request in Created mode (default).
  The closed modes are on demand, one request per distinct (mode, parameters, scope); define and respect fan-out
  limits: page cap, changelog enrichment cap and timeout (reuse the existing ones), and a hard ceiling on Epics
  returned. Hitting a ceiling sets `meta.truncated` and a visible warning, never a silent shortfall.
- Jira pagination for search is `nextPageToken`/`isLast`; any Jira GET carrying JQL is sized by the continuation
  request (`paged_search_bytes`, MRT031), not the first. Check the transport of `jira_search_request` before
  deciding whether Component batching is needed.
- OAuth routes: the existing route is already OAuth-ready (`tests/test_oauth_stats_routes.py`); the change must keep
  the CSRF / `X-Requested-With` behavior and use only the signed-in user's Jira context.
- Jira credentials policy, no real Jira fixture data, synthetic test data only.
- Registered owner files: `scripts/extraction_lint/owner_budgets.json` tracks `StatsPanel.jsx`, `useStatsData.js`
  and others; re-sync ceilings, aggregates, `unresolved` inventory and `sourceDigest` deliberately in the same
  commit and run `tests.test_codebase_structure_budgets` (no CI runs the lint). `jira_server.py` growth is
  checked by the structure-budget tests as well.
- Do not hand-edit `frontend/dist/`; run `npm run build` and commit generated output if the frontend-build workflow
  requires a clean post-build diff.
- Long lists: MRT018 applies. The closed modes can return many Epics and long creation spans (a five-year-old Epic
  closed this quarter yields ~20 quarterly or ~60 monthly rows). Verify with more than 30 completed Epics and
  more than 30 heatmap rows, with the inner view overflow and load-more behavior intact.

## Left to the builder

- Exact JQL for the closed-quarter window and for last-N ordering, including how to treat Epics with no
  `resolutiondate`, validated with a read-only live probe (memory: use the Basic-auth probe credentials, never
  save live data, never route probes through the app's OAuth store). Candidates: a terminal-status query with
  `status CHANGED TO ... DURING (...)` unioned with `resolutiondate` bounds; an `ORDER BY resolutiondate DESC` page
  walk for last-N plus a separate pass for terminal Epics with an empty `resolutiondate`. Do not assume Jira's
  null ordering or the availability of a status-category date field without checking.
- Whether Component batching is needed, and the ceiling values.
- Backend structure: a new fetch function beside `fetch_epic_cohort_data` or a shared normalizer; reuse the
  existing issue normalization so Created mode output is byte-identical.
- The control layout details inside the existing control-bar grid, the empty-state wording, the overflow column
  label, and the one-line scope note styling, using existing hooks.
- Test split between unit (`tests/test_*.py`, `tests/test_*.js`) and Playwright, within the verification below.

## Verification (acceptance)

1. Python: mode validation (default `created`, 400s for bad `mode`, quarters sent with `last_n`, missing quarters,
   closed range after the current quarter), closed-window post-filter on computed terminal dates including an Epic
   with no `resolutiondate`, last-N window ordering, ceiling and full/not-full flag, Component-only vs fallback
   scope, cache keys differ per mode, Created output unchanged (golden comparison with synthetic data).
2. Node: `cohortUtils` (overflow column, closed-mode row span from the displayed Epics, the N slice after filters
   with the key tie-break and the "Showing X of N" condition, hidden-part model), `statsGroupState` field list
   (assignee removed, new fields), `useStatsData` request shape for explicit and automatic reads, share-link
   capture/apply round trip for all three modes and for a legacy link, `jiraExportUtils` links without assignee.
3. Playwright (synthetic data): mode switch swaps exactly one control with no layout shift (element-level geometry on
   the text-bearing elements, per the filter-bar learning), each reused control keeps its shared class and single
   row/fixed height, the removed Assignee control is absent, the `In Progress` chip, Open column, Workflow Status
   card and Open chart are absent in the closed modes and present in Created, no refetch on UI-only controls
   (including N, Project, Exclude and the chips in Last N), one request per mode switch, Last N showing exactly N
   Epics when the filtered window holds more and the "Showing X of N" note when it does not, a long-list case
   (MRT018), and a screenshot per mode reviewed by eye.
4. Share-link and freshness specs updated and green: `tests/ui/shareable_view_links.spec.js`,
   `tests/ui/dashboard_data_freshness.spec.js`, plus the Lead Times cases in
   `tests/ui/codebase_structure_smoke.spec.js`.
5. Live read-only check against real Jira by the operator for the JQL claims (numbers only; no saved data).
6. Docs updated in the same change: `docs/features/statistics.md` (Lead Times section, scope and filtering),
   `docs/ontology.md` Lead Times entry (new verification date, symbols that resolve),
   `docs/README_ANALYTICS.md` (allowlist row, A9), `docs/features/shareable-view-links.md`, and the
   `docs/plans/README.md` index. Full Python suite, full Node suite, `npm run build`, and the full Chromium
   `tests/ui` run before push, per the repository gate.

## Amendments from the plan validation (2026-10-22)

Four independent read-only reviews of the plan against the source found these; each is a decision of this design
unless it says otherwise.

- **Created request unchanged.** The cold-start request multiset in `tests/ui/codebase_structure_smoke.spec.js`
  freezes exact Created bodies, so the client omits `mode` for Created (see Request). The client cache key for Created
  is likewise unchanged; only the closed modes prefix their keys.
- **Empty scope short-circuits.** `build_missing_info_scope_clause` returns an empty string when there are no
  Components and no Teams, which would make a project-wide query. The closed modes then make no Jira search request, return
  `issues: []` and `meta.scope = 'none'`, and the panel says `Scope: none configured (no Components or Teams)`.
- **The unresolved pass is bounded by status history.** Epics without `resolutiondate` need one changelog request each
  (4 workers, 10 s budget), so the pass must be small. `closed`: the unresolved query adds
  `status CHANGED TO <closed status> DURING (<start - 1 day>, <end + 2 days>)` for each closed status; `last_n`: the
  resolved passes run first and the unresolved query adds `status CHANGED TO ... AFTER <the day before the ceiling-th
  resolution day>` when the resolved rows fill the ceiling, and no bound when they do not. Both are safe supersets
  (the repository's Board already queries `status CHANGED TO ... AFTER`); an earlier idea, `updated >=`, was dropped
  because a bulk edit of old Epics would flood the candidate set. One shared page counter (80) bounds the whole
  closed request, a non-200 on any pass is an error (never a warning), and the Task 1 probe gate is latency-based and
  also parses every JQL form the query uses.
- **Long-lived Epics need the full changelog.** The embedded changelog is partial. In the closed modes the terminal-date
  lookup reuses the repository's full-changelog paging when `changelog.total` exceeds the embedded histories; Created
  mode keeps today's lookup.
- **Window edges.** The resolved query widens the closed range by one day on each side (JQL dates use the requesting
  user's timezone; `terminalDate` uses the response's offset) and the post-filter on the computed terminal date makes
  that safe. The closed range end is not capped at today.
- **Stated semantics.** An Epic Killed, reopened and Killed again gets its first terminal transition date when it has no
  `resolutiondate` (existing rule); Last N ranks by calendar day then key (codepoint order on both sides), so Epics
  sharing the boundary day are cut by key, not by time of day.
- **Mode/data mismatch guard.** Cached or in-flight data from another mode must never render under a new mode, in either
  direction. The derived layer uses `cohortData` only when its `meta.mode` (absent means `created`) equals the current
  mode, and exposes `cohortAwaitingMode` for the in-between state: the panel shows the loading line, and the warnings,
  the empty message, the Project-filter prune and the selected-row prune are all held while it is true, so a Project
  selection survives Created, Closed and back to Created. The Mode dropdown's handler clears the selected row.
- **Closed modes ignore the `open` and `postponed` status toggles** (forced off), so a persisted `postponed: true`
  cannot reveal anything and cannot be stuck on with its chip hidden.
- **Empty and shortfall states.** The panel receives the scope, whether the fetched set was empty, and the shortfall.
  An empty fetched set shows the heatmap's own empty message with closed-mode wording; there is no third empty box.
- **Card notes name the mode.** Avg and Median Lead Time notes read `Epics closed in the selected range` and
  `Middle lead time of epics closed in the selected range` in `closed`, and `Most recently closed epics` and
  `Middle lead time of the most recently closed epics` in `last_n`; Created keeps today's notes.
- **Share links.** `lead` and `n` apply to the Lead Times view only. An invalid `lead` is dropped and reported; the
  link then applies as Created with its own `from`/`to`. Applying a link also resets the inactive modes' selections to
  their defaults (the link states the whole view). `lead=last_n` without a valid `n` applies 30 and reports. A Last N
  link carries no `from`/`to`; the resolver gives it the default quarter pair so the apply step still writes the mode.
- **Closed-mode Jira link.** When the chart lists more than 250 Epics the link is hidden and a `.stats-note` says why.
- **Control bar widths (measured on the real CSS at 966 px usable).** Created and Closed fit one row at 955.5 px; Last N fits
  at 811 px, the stretchy Mode and Number-of-epics selects widen to about 187 px each and Group By and Project move about
  46 px left. Row count and height must be equal in all modes at 1280 px; at 375 px labels must not clip (4 / 4 / 3 rows).
- **Closed-mode ties.** The Last N resolved pass completes the boundary day instead of cutting by time of day, so the
  kept set is the first N by day then key.
