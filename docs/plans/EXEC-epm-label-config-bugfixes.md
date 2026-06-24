# EXEC-epm-label-config-bugfixes

| Field | Value |
| --- | --- |
| Status | executed (pending merge) |
| Type | bugfix |
| Created | 2026-06-23 |
| Revised | 2026-06-23 (after 3-subagent review; see §12) |
| Executed | 2026-06-24 (see §10 Outcome for per-task commits) |
| Surface | EPM Settings → Projects (label config) |
| Branch | `bugfix/epm-label-config` |

> **Status:** Implemented and verified on branch `bugfix/epm-label-config`; not yet
> merged. Per-task commits and verification are recorded in §10. Rename to
> `DONE-*` only after the PR is merged/accepted.

Fixes three defects in the EPM Settings **Projects** label-configuration UI. No new
routes, no auth-mode changes, no Home/Townsquare or Jira writes. `GATE-05`
(Home write capability) is unaffected — this plan touches only the label-read
autocomplete (`GET /api/jira/labels`), local draft/view state, the existing
`POST /api/epm/config` save, and read-only UI hints.

---

## 1. Problem statement

From the user report (screenshot: project "Rnd", "No Jira label selected.",
search box holding `RnD_Project_App_insta`, a `SHOW ALL LABELS` button, no
results dropdown):

1. **Labels do not work.** Typing in the label field returns no autocomplete
   dropdown and the prefix-filtered request returns nothing ("requests are not
   counting").
2. **Cannot delete an unconfigured project.** A project that is not (fully)
   configured cannot reliably be removed; deletion should be more agile.
3. **Prefix is invisible.** The active label prefix is not shown while the user
   types, so they cannot tell what the search is constrained to.

> The screenshot text `RnD_Project_App_insta` is the **client-side search query**
> (`labelSearchQuery[rowKey]`, filtered via `.includes` in
> `getEpmLabelSearchResults`, `dashboard.jsx:1167-1174`). It is **not** the prefix
> sent to the backend — the prefix comes from `epmConfigDraft.labelPrefix`. So the
> typed text is not itself the cause; the two real causes are 2a and 2b below.

---

## 2. Root causes (verified in source)

### 2a. Label-prefix mask `*` is never stripped before the Jira `startswith` filter
- `frontend/src/dashboard.jsx:1207-1210` (`loadEpmProjectLabels`) sends the raw
  `epmConfigDraft.labelPrefix` (only `.trim()`-ed) as the `prefix` query param.
- `backend/routes/settings_routes.py:849-850` applies `label.lower().startswith(prefix)`
  **literally**, so `prefix="rnd_project_*"` matches zero Jira labels (labels never
  contain `*`). The request fires but returns `[]` → empty dropdown. "Show all
  labels" works because it drops the prefix (`dashboard.jsx:1208-1209` →
  `{ limit: 200 }`).
- The correct normalizer exists for Home-tag matching
  (`backend/epm/projects.py:170-174` `normalize_epm_label_prefix_mask`, strips
  trailing `*`) but is **not** applied to this endpoint.
- **Scope note:** the committed default is `rnd_project_` (no star) —
  `dashboard-config.json:107`, `DEFAULT_EPM_LABEL_PREFIX` at `dashboard.jsx:215`,
  `backend/epm/config.py:6` — which already works. The bug manifests when the
  configured/stored `labelPrefix` is the canonical `rnd_project_*` mask form. EPM
  config is user-owned in DB/OAuth mode (`DONE-03`), so the stored value can differ
  from the committed JSON. **Execution gate:** before claiming Change A fixes the
  report, confirm the failing environment's stored `labelPrefix` value. The fix is
  idempotent/harmless on non-star prefixes regardless.

### 2b. Dropdown anchor race on the "Choose label" button
- `frontend/src/epm/EpmSettings.jsx:457-470` (`openEpmLabelSearchFromButton`)
  sets `epmLabelChanging[rowKey]=true` then `setTimeout(0)` to `querySelector` the
  search input. The input is gated behind `isChangingLabel` (`:551`), so on the
  first paint it may not be in the DOM yet. When `querySelector` returns `null`,
  the `else` branch (`:466-467`) calls `loadEpmProjectLabels` but **never** calls
  `openEpmLabelMenu`, so `epmLabelMenuAnchor` stays `null` and the render gate at
  `EpmSettings.jsx:643` never opens. The fetch happens; the menu never shows.

### 2c. Delete visibility is double-gated and inconsistent; Home rows cannot be hidden
- `EpmSettings.jsx:455-456`: `canRemoveProject = project.homeProjectId === null ||
  project.missingFromHomeFetch` and `isEmptyCustomProject = isEmptyCustomEpmProjectRow(project)`.
- A Home-discovered row (truthy `homeProjectId`, not missing) gets **no delete
  action at all** (`:599` requires `canRemoveProject`); empty custom rows get a
  "Delete" in the label cell (`:537-548`); partial custom rows get "Remove" in the
  4th grid column (`:599-610`). Three different behaviors.
- `epmSettingsProjectRows` (`dashboard.jsx:2357-2402`) rebuilds Home rows from
  `epmSettingsProjects` (Home discovery) on every render, so `removeEpmProjectDraft`
  (`:1191-1199`, deletes only from `epmConfigDraft.projects`) cannot hide a
  Home-discovered row.

### 2d. Prefix not surfaced while typing
- `EpmSettings.jsx:553-576`: the search input shows only the static placeholder
  `Search Jira labels...`; `epmConfigDraft.labelPrefix` is never displayed.

---

## 3. Decisions (confirmed with user)

- **Delete on every row** (including fully configured rows). One consistent,
  always-visible compact delete action per row.
- **Removal is session-only** for Home-discovered rows — not persisted to config;
  they reappear on the next Home refresh. The UI must **clearly tell the user** that
  permanent removal requires closing/pausing/archiving the project in Jira Home.
- **Prefix shown as a hint pill + dynamic placeholder** (no change to typing
  semantics; pill is visual only).

### 3.1 Two distinct delete operations (review outcome)

Delete behaves differently by row origin, because the two row kinds live in
different places:

| Row kind | `homeProjectId` | Delete action | Mutates `epmConfigDraft`? | Dirty? | Persistence |
| --- | --- | --- | --- | --- | --- |
| Custom / unlinked draft | falsy (`null`/`''`) | `removeEpmProjectDraft(id)` | Yes (row only ever lived in the draft) | Yes | Removed for good once saved |
| Home-discovered | truthy | add ids to session `removedEpmProjectIds` only | **No** | No | Hidden this session; reappears on Home refetch / modal reopen |

Rationale: a Home row's `removeEpmProjectDraft` would drop its label override, which
on save implicitly clears configured shared state (forbidden by repo learnings and
mismatched with the "session-only, reappears" message we show the user). So a Home
row delete is a **pure view filter** that never touches the draft. A Home row that
already has a configured label stays configured but hidden for the session and
reappears with its label; to clear a label the user uses the existing chip `×`
(`EpmSettings.jsx:514-522`) or changes the project state in Jira Home.

---

## 4. Changes

### Change A — Strip the `*` mask for label search (fixes 2a)
**Frontend**
- `frontend/src/epm/epmProjectUtils.mjs`: add exported
  `normalizeEpmLabelPrefixMask(value)` mirroring the backend: trim, strip every
  trailing `*` (re-trim between strips), return the cleaned prefix; `''` for
  empty/nullish.
- `frontend/src/dashboard.jsx` `loadEpmProjectLabels` (`:1207-1210`): build the
  prefix with `normalizeEpmLabelPrefixMask(epmConfigDraft.labelPrefix ?? DEFAULT_EPM_LABEL_PREFIX)`.
  Keep the `showAll || !prefix → { limit: 200 }` branch unchanged.

**Backend**
- `backend/routes/settings_routes.py` `get_jira_labels` (`:796-852`): normalize the
  incoming `prefix` with the mask strip before the `startswith` filter
  (`:849-850`). **Call `normalize_epm_label_prefix_mask(prefix)` directly** — it is
  already bound into this module's namespace via `bind_server_globals(globals())`
  (`backend/routes/__init__.py`; the wrapper is defined at `jira_server.py:2034-2035`).
  Do **not** add `from backend.epm.projects import ...`; that deviates from this
  file's global-binding pattern. Leave the `query` substring path (`:847-848`) and
  the `/rest/api/3/label` fetch loop (`:819-845`) untouched.

### Change B — Reliable dropdown open (fixes 2b)
- Replace the `setTimeout(0)` + `querySelector` race in `openEpmLabelSearchFromButton`
  (`EpmSettings.jsx:457-470`) with deterministic focus-on-mount:
  - Add a single per-row "pending focus" marker (e.g. `pendingLabelFocusRowKey`
    ref/state in `dashboard.jsx`, exposed to `EpmSettings`).
  - The button handler only sets `epmLabelChanging[rowKey]=true` and records the
    pending marker for `rowKey`.
  - Attach a **callback ref** to the search input (`EpmSettings.jsx:553`): when the
    node mounts and the pending marker matches this `rowKey`, call `node.focus()`
    **and clear the marker** (so it does not re-focus on later re-renders).
  - **Do NOT open the menu from the callback ref.** Focus fires the existing
    `onFocus` (`:564-566`) which already calls
    `openEpmLabelMenu(project.id, node, showAllLabels)` exactly once. Calling
    `openEpmLabelMenu` in both places would double-set the anchor and double-fetch.
- `showAllLabels` consistency: the marker carries no showAll value; `onFocus` reads
  the per-render `showAllLabels` (`:451`, defaults `false` on first open), which is
  correct.
- Do not change `onBlur` (`:567-573`), the reposition effect
  (`dashboard.jsx:1252-1276`), or keyboard nav (`:1282+`).

### Change C — Prefix hint pill + dynamic placeholder (fixes 2d)
- In the label search wrapper (`EpmSettings.jsx:551-596`), when **not** in
  `showAllLabels` mode and a normalized prefix exists, render a compact,
  non-editable monospace **prefix pill** before the input showing the prefix
  (reuse the existing chip grammar — `epm-label-selected-chip` / `team-name` mono
  span styles; **no bespoke styles**).
- Dynamic placeholder on the input (`:556`):
  - searching → `Searching labels...` (unchanged)
  - prefix mode → `Labels starting with <prefix>…`
  - show-all mode → `Search all Jira labels…`
- Source the prefix via `normalizeEpmLabelPrefixMask(epmConfigDraft.labelPrefix)`
  inside `EpmSettings` (`epmConfigDraft` and `DEFAULT_EPM_LABEL_PREFIX` are already
  props — `dashboard.jsx:14954,14975`; no new prop needed). Client filter
  (`getEpmLabelSearchResults`) is unchanged.
- Note: the editable `labelPrefix` field lives on the **Scope** tab
  (`EpmSettings.jsx:144-153`); the pill/dropdown live on the **Projects** tab, so
  they are never visible at once. `updateEpmLabelPrefixDraft` (`dashboard.jsx:1136-1150`)
  clears EPM label result caches when the prefix changes — acceptable; no stale-pill
  scenario within one view.

### Change D — Agile per-row delete + session removal + Home notice (fixes 2c)
**State + filtering (`dashboard.jsx`)**
- Add session-local `removedEpmProjectIds` (`useState` holding a `Set` of **truthy**
  ids only).
- In `epmSettingsProjectRows` (`:2357-2402`), exclude any row whose trimmed `id` is
  in the set, **or** whose `homeProjectId` is truthy **and** in the set. Never test a
  falsy `homeProjectId` against the set. Add `removedEpmProjectIds` to the `useMemo`
  deps (`:2402`).
- Add `deleteEpmProjectRow(project)` that branches on origin (per §3.1):
  - `homeProjectId` falsy → `removeEpmProjectDraft(project.id)` only (savable draft delete).
  - `homeProjectId` truthy → add only the truthy ids (`project.id`,
    `project.homeProjectId`) to `removedEpmProjectIds`; do **not** call
    `removeEpmProjectDraft` and do **not** mutate `epmConfigDraft`.
- **Reset transitions for `removedEpmProjectIds`** (exact — do not deviate):

  | Transition | Behavior |
  | --- | --- |
  | Modal fully closes (`showGroupManage` → false) | **Reset** to empty |
  | Forced Home refetch that re-sets `epmSettingsProjects` (the `ensureEpmSettingsProjectsLoaded` success path, `dashboard.jsx:1063`; e.g. EpmSettings Retry/refresh) | **Reset** to empty |
  | Settings tab switch (Scope↔Projects or any tab) | **Preserve** |
  | `saveEpmConfig` success | **Preserve** (Home rows were never mutated; save does not call `setEpmSettingsProjects` on the saved-scope path, so a reset here would resurrect deletions) |
  | `saveEpmConfig` failure | **Preserve** |

  Implement the modal-close reset in a dedicated effect keyed on `showGroupManage`
  (not the existing `[showGroupManage, groupManageTab, epmSettingsTab]` effect at
  `:1277-1281`, which also fires on tab switch). Implement the refetch reset inside
  the forced-refresh branch that calls `setEpmSettingsProjects(nextProjects)`
  (`:1063`). Do **not** reset in `saveEpmConfig` (`:1107-1134`).

**UI (`EpmSettings.jsx`)**
- Remove the double-gated delete UI: the in-label-cell empty-row "Delete"
  (`:537-548`) and the column-4 `canRemoveProject` "Remove" (`:599-610`). Drop the
  now-unused `canRemoveProject`/`isEmptyCustomProject` gating for delete (keep
  `isEmptyCustomEpmProjectRow` usage in save-time normalization at
  `dashboard.jsx:1885`).
- Render exactly **one** compact icon delete (`×`) button in the stable 4th grid
  column for **every** row, calling `deleteEpmProjectRow(project)`. Reuse the
  existing compact `IconButton` grammar. Require both a `title` and a per-row
  `aria-label` (e.g. `Delete <project name>`), matching the existing `×` controls
  (`:514-522`, `:165-173`).
- Tooltip by row type:
  - Home-discovered (`project.homeProjectId` truthy): `Hide until next refresh —
    close, pause, or archive it in Jira Home to remove it permanently.`
  - Custom/unlinked: `Delete project.`
- Add **one** section-level helper note (reuse `group-field-helper`) placed **above
  the table header row** (`:416`), not inside the grid: "Removing a Home-discovered
  project only hides it until the next refresh. To remove it permanently, close,
  pause, or archive it in Jira Home."
- **Empty state when all rows are hidden:** when `epmSettingsProjectRows.length === 0`
  but `epmSettingsProjects.length > 0` (or the removed set is non-empty), show a
  dedicated state — "All projects are hidden for this session. Refresh to restore
  Home projects, or add a custom Project." — with Refresh and Add-custom actions,
  instead of falling through to the generic "No projects in this view." branch
  (`:620-623`).
- Keep dropping fully-empty custom rows before save
  (`normalizeEpmConfigDraft` / `isEmptyCustomEpmProjectRow`, `dashboard.jsx:1885`).

---

## 5. Files allowed to touch
- `frontend/src/epm/epmProjectUtils.mjs` — add `normalizeEpmLabelPrefixMask`.
- `frontend/src/dashboard.jsx` — prefix normalize in `loadEpmProjectLabels`;
  `removedEpmProjectIds` state + row filter + reset effects; `deleteEpmProjectRow`;
  pending-focus marker; pass prefix/handlers to `EpmSettings`.
- `frontend/src/epm/EpmSettings.jsx` — unified delete UI, prefix pill, placeholder,
  focus callback ref, empty-state, section helper note.
- `backend/routes/settings_routes.py` — normalize `prefix` in `get_jira_labels`.
- `jira-dashboard.html` — only if a tiny pill class is genuinely needed; prefer
  reusing existing `epm-label-*` / `team-*` classes (default: no change).
- Tests:
  - `tests/test_epm_project_utils.js` — frontend unit for `normalizeEpmLabelPrefixMask`.
  - `tests/test_epm_config_api.py` — extend the existing `/api/jira/labels` cluster
    (`:580-625`) for star-stripping (this is the correct backend test home).
  - `tests/ui/epm_settings_visual_states.spec.js` — update broken assertions +
    add the new UI guards (see §6).
- `frontend/dist/*` — **regenerate via `npm run build` and commit** (the verify
  workflow `.github/workflows/verify-frontend-build.yml` fails on a dirty
  post-build `git diff --exit-code`; committing dist is required, not optional).

Do **not** touch: EPM rollup/aggregate code, Home discovery fetchers, auth/policy
registry, `/api/projects/selected`, sticky layout/z-index, or any write/mutation path.

---

## 6. Verification & acceptance criteria

**Backend (unittest)** — `python3 -m unittest`
- Extend `tests/test_epm_config_api.py` (the `:580-625` cluster) with
  `test_jira_labels_prefix_strips_trailing_star`: mock
  `patch.object(jira_server, 'LABELS_CACHE', {'data': [...], 'timestamp': 9999999999})`
  (matching the existing cases — the route only calls `current_jira_get` on a cache
  miss, so mock the cache, **not** `current_jira_get`), request
  `GET /api/jira/labels?prefix=rnd_project_*`, assert the result is exactly the
  labels starting with `rnd_project_` (star stripped).
- Keep the existing cluster green: `prefix=rnd_project_` (no star), `query=...`
  substring, and query-then-prefix-then-limit ordering unchanged.
- Empty-projects save: the "delete every row" path is already covered —
  `POST /api/epm/config` with `'projects': {}` returns 200
  (`tests/test_epm_config_api.py` lines 55/70/88 and the `:518-544` cache-clear
  cases). Reference these; add a focused assertion only if a gap appears.

**Frontend unit** — `npm run test:frontend:unit` (`node --test tests/test_*.js`)
- In `tests/test_epm_project_utils.js` (dynamic `import()` of the `.mjs`, existing
  pattern): `normalizeEpmLabelPrefixMask('rnd_project_*') === 'rnd_project_'`; strips
  multiple/spaced trailing stars; trims; returns `''` for empty/nullish.

**UI (Playwright + screenshots)** — `npm run test:frontend:ui`
First update the assertions Change C/D break:
- `epm_settings_visual_states.spec.js:252` (`getByPlaceholder('Search Jira labels...')`)
  → assert the new dynamic placeholder.
- `:236`/`:241` ("Delete empty project" appears then disappears) → rework for the
  unified per-row delete model and new `aria-label`.

New/updated assertions, each falsifiable:
- (a) **2b guard:** click **Choose label** *alone* (do **not** also click the input,
  which masks the race) and assert `.epm-label-menu-layer` becomes visible. The
  current test at `:251-253` clicks the input after the button — remove that input
  click so the test actually exercises the open-from-button path.
- (b) **2a guard:** in the `page.route('**/api/jira/labels**', …)` handler, capture
  `route.request().url()` and assert the outgoing `prefix` is `rnd_project_` with
  **no** `*` (the stub returns a fixed list regardless of params, so this URL
  assertion — or the unit test — is the real end-to-end proof). Selecting a result
  sets the label chip.
- (c) Prefix **pill** visible showing the prefix; placeholder names it; "Show all
  labels" hides the pill and switches the placeholder to all-labels copy.
- (d) **Every** row shows the delete icon (count == rows). Deleting a
  Home-discovered row hides it for the session and the section helper/tooltip
  explains permanent removal; then trigger a forced refetch (Retry) and assert the
  Home row **returns** (proves the reset path, not just the hide). Deleting a custom
  row removes it (and stays gone after save).
- (e) Sticky/header layout unaffected; the delete button is not squeezed when the
  search UI is open. Capture before/after screenshots (wait for transitions to
  settle per project learnings).

**Full gate** — full `python3 -m unittest discover -s tests` green;
`npm run test:frontend:unit` green; `npm run build` clean and `frontend/dist`
committed.

---

## 7. Forbidden regressions
- Do not change the Jira label fetch loop or the `query` substring path.
- Do not alter `onBlur` close, menu reposition, or keyboard nav beyond the open-path fix.
- Do not open the label menu from both the callback ref and `onFocus` (no double-open).
- Do not mutate `epmConfigDraft` when deleting a Home-discovered row (no implicit
  label/shared-state clear).
- Do not reset `removedEpmProjectIds` on tab switch or on `saveEpmConfig` success.
- Do not persist Home-row removals to EPM config (session-only per decision).
- Do not remove the empty-custom-row drop-before-save.
- Do not introduce bespoke dropdown/chip/pill styles; reuse `team-search-*` /
  `epm-label-*` classes.
- No auth/route policy changes: `/api/jira/labels` stays `authenticated_read`,
  `/api/epm/config` POST stays `shared_admin_write`.
- No sticky offset / z-index changes (MRT009).

---

## 8. Analytics impact
No new user-visible feature event. The label-search and EPM save flows already emit
`trackSettingsAction('epm', …)`. This bugfix restores intended behavior; no new
event, param, or taxonomy change. Allowlist reason: defect repair within an existing
instrumented flow.

---

## 9. Residual risks
- The 2b race is timing-dependent; a fast CI machine may pass the UI test regardless
  of the fix. The deterministic callback-ref (Change B) is the real guard; the
  Choose-label-alone assertion (6a) is the best available UI proof.
- `GET /api/jira/labels` uses `startAt`/`maxResults`/`isLast` against
  `/rest/api/3/label` (`settings_routes.py:819-845`) — that is the Jira label
  endpoint's own contract, pre-existing, and explicitly out of scope here. Do not
  "fix" it to `nextPageToken` in this plan.

---

## 10. Outcome

**Implemented as planned** (subagent-driven execution; each task TDD'd, reviewed,
fixed, and re-verified before the next). Per-task commits on `bugfix/epm-label-config`:

| Task | Change | Commit(s) | Verification |
| --- | --- | --- | --- |
| 1 | Change A backend — strip `*` in `get_jira_labels` + test | `2138ab1` | `tests/test_epm_config_api.py` 25/25; new test fails pre-fix, passes post-fix |
| 2 | `normalizeEpmLabelPrefixMask` helper + unit test | `b24a091` | frontend unit 387/387 (1 fail pre-impl) |
| 3 | Changes A-frontend / B / C / D wiring (`dashboard.jsx`, `EpmSettings.jsx`) + dist | `b39e1f7`, fix `ac3dcaf` | `npm run build` clean; unit 387/387; source guards 23/23 |
| 4 | Playwright spec updates + determinism fix | `78a6b06`, fix `12af7da` | EPM settings spec 22/22 both viewports |

Plan commits: `4d43911` (initial), `a0cb4a8` (post-review revision).

**Final whole-branch verification (2026-06-24):** full backend suite **905 passed**
(1 skip), frontend unit **387 passed**, EPM Playwright **22 passed** (desktop +
mobile), `npm run build` produces a clean `frontend/dist` diff. Final adversarial
whole-branch review: **READY TO MERGE** — no Blockers/P1; confirmed the backend test
is non-tautological (revert→fail), reset transitions are exactly modal-close +
forced-refetch, Home-row delete never mutates `epmConfigDraft`, and the unrelated
`tests/ui/eng_alerts_panel_summary.spec.js` failure is not caused by this branch.

Open follow-up (non-blocking, recorded for the PR): the source-guard at
`tests/test_epm_settings_source_guards.js:265` is a weak guard for Change B (the
asserted string also appears in `onChange`/`onFocus`); the real Change-B regression
guard is the Playwright 2b test. Also confirm in the failing environment whether the
stored `labelPrefix` was the `rnd_project_*` mask form (the §2a execution gate).

## 11. Current Accuracy

Accurate as of `12af7da`. The shipped code matches this plan; once merged, rename to
`DONE-*` and add the merge commit/PR to the top status note.

---

## 12. Plan review resolutions (2026-06-23)

Three review subagents (correctness/source-trace, state-machine/regression,
verification-quality) ran the `docs/plans/AGENTS.md` review prompt. All findings
verified against source and folded in:

- **Blocker (state machine):** session removal was unsaveable and the original
  reset-on-save would resurrect deletions because the saved-scope path never calls
  `setEpmSettingsProjects` (only 991/1030/1063/1122). → §3.1 + §4 Change D split the
  operation by origin and fixed the reset transition table (reset only on modal
  close and forced refetch).
- **P1 (correctness):** do not `import` `normalize_epm_label_prefix_mask` into
  `settings_routes.py`; it is bound via `bind_server_globals`. → Change A.
- **P1 (regression):** `removeEpmProjectDraft` on a configured Home row implicitly
  clears a saved label. → §3.1, Home rows never mutate the draft.
- **P1 (regression):** reset-on-tab-change resurrects deletions. → reset table.
- **P1 (verification):** correct backend test home is the existing cluster in
  `tests/test_epm_config_api.py:580-625`, mocking `LABELS_CACHE` (not
  `current_jira_get`). → §6.
- **P1 (verification):** Change C/D break existing spec assertions at
  `epm_settings_visual_states.spec.js:252` and `:236`/`:241`. → §6 lists them as
  must-update.
- **P2s:** truthy-id-only set membership; prefix-source on Projects tab; 6(a) must
  click Choose-label alone to actually exercise the race; 6(b) assert outgoing
  `prefix` has no `*`; 6(d) assert reappear-on-refetch. → folded into §4/§6.
- **Minors:** dedicated empty-state when all rows hidden; helper note above header
  row; per-row delete `aria-label`; empty-projects POST already covered. → §4/§6.
