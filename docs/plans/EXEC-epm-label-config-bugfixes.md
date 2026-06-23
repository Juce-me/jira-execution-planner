# EXEC-epm-label-config-bugfixes

| Field | Value |
| --- | --- |
| Status | planned |
| Type | bugfix |
| Created | 2026-06-23 |
| Surface | EPM Settings → Projects (label config) |
| Branch | `bugfix/epm-label-config` |

Fixes three defects in the EPM Settings **Projects** label-configuration UI. No new
routes, no auth-mode changes, no Home/Townsquare or Jira writes. `GATE-05`
(Home write capability) is unaffected — this plan touches only the label-read
autocomplete (`GET /api/jira/labels`), local draft/row state, the existing
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

---

## 2. Root causes (verified in source)

### 2a. Label-prefix mask `*` is never stripped before the Jira `startswith` filter
- `frontend/src/dashboard.jsx:1207-1210` (`loadEpmProjectLabels`) sends the raw
  `epmConfigDraft.labelPrefix` (only `.trim()`-ed) as the `prefix` query param.
  The canonical mask form is `rnd_project_*` (see AGENTS.md / `dashboard-config.json:107`
  currently holds `rnd_project_`, but deployments use the `*` mask).
- `backend/routes/settings_routes.py:849-850` applies `label.lower().startswith(prefix)`
  **literally**, so `prefix="rnd_project_*"` matches zero Jira labels (labels never
  contain `*`). The request fires but returns `[]` → empty dropdown.
- The correct normalizer already exists for Home-tag matching
  (`backend/epm/projects.py:170-174` `normalize_epm_label_prefix_mask`, which
  strips trailing `*`) but is **not** applied to this endpoint.
- This is why **"Show all labels"** (which drops the prefix, `dashboard.jsx:1208-1209`
  sends `{ limit: 200 }` only) is the user's only working path.

### 2b. Dropdown anchor race on the "Choose label" button
- `frontend/src/epm/EpmSettings.jsx:457-470` (`openEpmLabelSearchFromButton`)
  sets `epmLabelChanging[rowKey]=true` then `setTimeout(0)` to `querySelector` the
  search input. The input is gated behind `isChangingLabel` (`EpmSettings.jsx:551`),
  so on the first paint it may not be in the DOM yet. When `querySelector` returns
  `null`, the `else` branch (`:466-467`) calls `loadEpmProjectLabels` but **never
  calls `openEpmLabelMenu`**, so `epmLabelMenuAnchor` stays `null` and the dropdown
  render gate at `EpmSettings.jsx:643` (`epmLabelMenuAnchor && labelSearchOpen[...]`)
  never opens. The fetch happens; the menu never shows.

### 2c. Delete visibility is double-gated and inconsistent; Home rows cannot be hidden
- `EpmSettings.jsx:455-456`: `canRemoveProject = project.homeProjectId === null ||
  project.missingFromHomeFetch` and `isEmptyCustomProject = isEmptyCustomEpmProjectRow(project)`.
- Result: a Home-discovered row with a real `homeProjectId` and no label gets **no
  delete action at all** (`:599` requires `canRemoveProject`), while empty custom
  rows get a "Delete" in the label cell (`:537-548`) and partial custom rows get a
  "Remove" in the 4th grid column (`:599-610`). Three different behaviors.
- Even if a delete handler ran, `epmSettingsProjectRows` (`dashboard.jsx:2357-2402`)
  rebuilds the list from `epmSettingsProjects` (Home discovery) on every render, so
  `removeEpmProjectDraft` alone (`dashboard.jsx:1191-1199`, deletes only from
  `epmConfigDraft.projects`) cannot hide a Home-discovered row.

### 2d. Prefix not surfaced while typing
- `EpmSettings.jsx:553-576`: the search input shows only the static placeholder
  `Search Jira labels...`; `epmConfigDraft.labelPrefix` is never displayed.

---

## 3. Decisions (confirmed with user)

- **Delete on every row** (including fully configured rows). One consistent,
  always-visible compact delete action per row.
- **Removal is session-only** — not persisted to config. Home-discovered rows
  reappear on the next Home refresh. The UI must **clearly tell the user** that
  permanent removal requires closing/pausing/archiving the project in Jira Home.
- **Prefix shown as a hint pill + dynamic placeholder** (no change to typing
  semantics; pill is visual only).

---

## 4. Changes

### Change A — Strip the `*` mask for label search (fixes 2a)
**Frontend**
- `frontend/src/epm/epmProjectUtils.mjs`: add exported
  `normalizeEpmLabelPrefixMask(value)` mirroring the backend: trim, strip every
  trailing `*` (with re-trim between strips), return the cleaned prefix.
- `frontend/src/dashboard.jsx` `loadEpmProjectLabels` (`:1207-1210`): build the
  prefix with `normalizeEpmLabelPrefixMask(epmConfigDraft.labelPrefix ?? DEFAULT_EPM_LABEL_PREFIX)`.
  Keep the `showAll || !prefix → { limit: 200 }` branch unchanged.

**Backend**
- `backend/routes/settings_routes.py` `get_jira_labels` (`:796-852`): normalize the
  incoming `prefix` with the same mask strip before the `startswith` filter
  (`:849-850`). Reuse `backend/epm/projects.py:normalize_epm_label_prefix_mask`
  (import it) so there is one source of truth. Leave the `query` substring path
  (`:847-848`) and the `/rest/api/3/label` fetch loop (`:819-845`) untouched.

### Change B — Reliable dropdown open (fixes 2b)
- Replace the `setTimeout(0)` + `querySelector` race in `openEpmLabelSearchFromButton`
  (`EpmSettings.jsx:457-470`) with deterministic focus-on-mount:
  - Add a per-row "pending focus" marker (e.g. a `pendingLabelFocusRowKey` ref/state
    in `dashboard.jsx`, exposed to `EpmSettings`).
  - The button handler only sets `epmLabelChanging[rowKey]=true` and records the
    pending marker for `rowKey`.
  - Attach a **callback ref** to the search input (`EpmSettings.jsx:553`): when the
    node mounts and the pending marker matches this `rowKey`, call `node.focus()` and
    clear the marker. Focus fires the existing `onFocus` (`:564-566`) →
    `openEpmLabelMenu(project.id, node, showAllLabels)` which reliably sets
    `epmLabelMenuAnchor` and loads labels.
- Do not change `onBlur` (`:567-573`), the reposition effect
  (`dashboard.jsx:1252-1276`), or keyboard nav (`:1282+`).

### Change C — Prefix hint pill + dynamic placeholder (fixes 2d)
- In the label search wrapper (`EpmSettings.jsx:551-596`), when **not** in
  `showAllLabels` mode and a normalized prefix exists, render a compact,
  non-editable monospace **prefix pill** before the input showing the prefix
  (reuse the existing chip grammar — the `epm-label-selected-chip` / `team-name`
  mono span styles; **no bespoke styles**).
- Dynamic placeholder on the input (`:556`):
  - searching → `Searching labels...` (unchanged)
  - prefix mode → `Labels starting with <prefix>…`
  - show-all mode → `Search all Jira labels…`
- Source the prefix via `normalizeEpmLabelPrefixMask(epmConfigDraft.labelPrefix)`,
  passed into `EpmSettings` as a prop (or derived from the already-passed
  `epmConfigDraft`). Client filter (`getEpmLabelSearchResults`, `dashboard.jsx:1167-1174`,
  `.includes`) is unchanged.

### Change D — Agile per-row delete + session removal + Home notice (fixes 2c)
**State + filtering (`dashboard.jsx`)**
- Add session-local `removedEpmProjectIds` (a `Set`, via `useState`/`useRef`).
- In `epmSettingsProjectRows` (`:2357-2402`), exclude any row whose `id` **or**
  `homeProjectId` is in `removedEpmProjectIds`; add the set to the `useMemo` deps.
- Add `deleteEpmProjectRow(project)`: call `removeEpmProjectDraft(project.id)` (drops
  any draft override / label) **and** add `project.id` and `project.homeProjectId` to
  `removedEpmProjectIds`.
- Reset `removedEpmProjectIds` to empty when the projects view is (re)entered or the
  settings tab changes (extend the existing effect at `:1277-1281`) and after a
  successful `saveEpmConfig`/`refreshEpmProjects` (`:1116-1118`), so a fresh Home
  fetch restores discovered rows. This realizes the "reappears on refresh" behavior.

**UI (`EpmSettings.jsx`)**
- Remove the double-gated delete UI: the in-label-cell empty-row "Delete"
  (`:537-548`) and the column-4 `canRemoveProject` "Remove" (`:599-610`).
- Render exactly **one** compact icon delete (`×`) button in the stable 4th grid
  column for **every** row, calling `deleteEpmProjectRow(project)`. Reuse the
  existing compact `IconButton` / `.secondary.compact` grammar.
- Tooltip + helper text by row type:
  - Home-discovered row (`project.homeProjectId` truthy): tooltip
    `Hide until next refresh — close, pause, or archive it in Jira Home to remove it permanently.`
  - Custom/unlinked row: tooltip `Delete project.`
  - Add **one** section-level helper note above the table (reuse `group-field-helper`):
    "Removing a Home-discovered project only hides it until the next refresh. To
    remove it permanently, close, pause, or archive it in Jira Home."
- Keep dropping fully-empty custom rows before save
  (`normalizeEpmConfigDraft` / `isEmptyCustomEpmProjectRow`, `dashboard.jsx:1885`).

---

## 5. Files allowed to touch
- `frontend/src/epm/epmProjectUtils.mjs` — add `normalizeEpmLabelPrefixMask`.
- `frontend/src/dashboard.jsx` — prefix normalize in `loadEpmProjectLabels`;
  `removedEpmProjectIds` state + row filter + reset; `deleteEpmProjectRow`;
  pending-focus marker; pass prefix/handlers to `EpmSettings`.
- `frontend/src/epm/EpmSettings.jsx` — delete UI, prefix pill, placeholder,
  focus callback ref.
- `backend/routes/settings_routes.py` — normalize `prefix` in `get_jira_labels`.
- `jira-dashboard.html` — only if a tiny pill class is genuinely needed; prefer
  reusing existing `epm-label-*` / `team-*` classes (default: no change).
- Tests: `tests/test_epm_project_utils.js` (frontend unit),
  `tests/test_oauth_settings_routes.py` **or** new `tests/test_jira_labels_route.py`
  (backend), `tests/ui/epm_settings_visual_states.spec.js` (Playwright).
- `frontend/dist/*` — regenerate via `npm run build` and commit if
  `.github/workflows/verify-frontend-build.yml` requires a clean post-build diff.

Do **not** touch: EPM rollup/aggregate code, Home discovery fetchers, auth/policy
registry, `/api/projects/selected`, sticky layout/z-index, or any write/mutation path.

---

## 6. Verification & acceptance criteria

**Backend (unittest)** — `python3 -m unittest`
- `GET /api/jira/labels?prefix=rnd_project_*` returns labels that start with
  `rnd_project_` (the `*` is stripped before filtering). Mock `current_jira_get`
  to return a known label set.
- `GET /api/jira/labels?prefix=rnd_project_` (no star) unchanged.
- `GET /api/jira/labels?query=foo` substring path unchanged.
- Confirm `POST /api/epm/config` accepts an empty `projects` map without error
  (deleting all rows must save) — add/extend a case in `test_epm_config_api.py`.

**Frontend unit** — `npm run test:frontend:unit`
- `normalizeEpmLabelPrefixMask('rnd_project_*') === 'rnd_project_'`.
- Strips multiple/spaced trailing stars (`'rnd_project_ * *'`), trims, and returns
  `''` for empty/nullish input.

**UI (Playwright + screenshots)** — `npm run test:frontend:ui`
- (a) Open EPM Settings → Projects, click **Choose label**: the input focuses and
  the label dropdown appears with prefix-matched labels — no manual "Show all"
  needed. (Regression guard for 2b.)
- (b) Type a suffix → results filter; selecting one sets the label chip.
- (c) Prefix **pill** is visible showing the prefix; placeholder names it;
  "Show all labels" hides the pill and switches the placeholder to all-labels copy.
- (d) **Every** row shows the delete icon. Deleting a Home-discovered row removes it
  from the list for the session; the section helper / tooltip explains it reappears
  after refresh and how to remove it permanently in Jira Home.
- (e) Sticky/header layout unaffected; the delete button is not squeezed when the
  search UI is open. Capture before/after screenshots (wait for transitions to
  settle per project learnings).

**Full gate** — full `python3 -m unittest discover -s tests` green;
`npm run build` clean; commit `frontend/dist` if the verify workflow requires it.

---

## 7. Forbidden regressions
- Do not change the Jira pagination/label fetch loop or the `query` substring path.
- Do not alter `onBlur` close, menu reposition, or keyboard nav beyond the open-path fix.
- Do not persist removals to EPM config (session-only per decision).
- Do not remove the empty-custom-row drop-before-save.
- Do not introduce bespoke dropdown/chip/pill styles; reuse `team-search-*` /
  `epm-label-*` classes.
- No auth/route policy changes: `/api/jira/labels` stays `authenticated_read`,
  `/api/epm/config` POST stays `shared_admin_write`.
- No sticky offset / z-index changes (MRT009).

---

## 8. Analytics impact
No new user-visible feature event. The label-search and EPM save flows already emit
`trackSettingsAction('epm', …)`. Bugfix restores intended behavior; no new event,
param, or taxonomy change. Allowlist reason: defect repair within an existing
instrumented flow.

---

## 9. Outcome
_(fill on execution)_

## 10. Current Accuracy
_(fill on execution)_
