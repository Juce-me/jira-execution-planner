# EPM Multi-Project Rollup

**Date:** 2026-04-27
**Status:** Approved (design)

## Problem

The shipped EPM view (per `docs/superpowers/plans/2026-04-21-epm-project-rollup.md`) requires the user to pick exactly one Project at a time. To compare work across the portfolio they must serially select each Project, wait for its rollup, and remember what they saw. EPMs need to see every accessible Project's Jira work on a tab without that drill-down.

## Goal

Render every Project visible on the current EPM tab as a stacked portfolio board on one screen, while preserving the existing single-Project focus mode as an optional narrow-down. Apply to all three lifecycle tabs (`Active`, `Backlog`, `Archived`).

This is an EPM portfolio rollup feature, not a new codebase/ENG dashboard mode. It should reuse only the existing dashboard pieces that already belong to EPM: the view switch, sprint selector, EPM tab selector, EPM Project metadata, and the current EPM issue row/tree presentation. New portfolio behavior belongs behind EPM-specific modules and interfaces so the ENG codebase view remains a separate stream.

## Non-Goals

- No change to the per-Project rollup endpoint contract or its 5-minute cache.
- No change to lifecycle bucketing (`active` / `backlog` / `archived` / `all`).
- No new cross-Project ordering or sorting controls; Projects stack in the order returned by `build_epm_projects_payload`.
- No change to the ENG view.
- No new ENG/codebase fetch path, task grouping path, planning path, or scenario path.
- No change to the EPM Project picker for custom Projects, settings UX, or label autocomplete.

## Terminology

- **All-Projects mode**: the default EPM view state where every Project visible on the current tab is rendered as a stacked board.
- **Focus mode**: the existing single-Project render path, reached by selecting a specific Project in the picker.
- **Project label**: the single exact Jira label configured for one Project (already specified in the shipped plan; no wildcards, no per-Project fallback label). The "fallback" used elsewhere in this spec (§6) refers to a server-side fan-out when the unioned JQL truncates, not to label resolution.
- **Visible Projects**: the result of `filterEpmProjectsForTab(projects, tab)` for the current tab — Home Projects whose `tabBucket` matches the tab plus custom Projects with `tabBucket: 'all'`.
- **Seed issue**: an issue returned by Q1 because it carries one or more configured Project labels. Seed issues can be Initiatives, Epics, Stories, or other leaf issue types.
- **Project membership**: the ordered set of Project ids that caused an issue to appear in the aggregate rollup. Seed issues get membership from their labels; descendant issues inherit membership from the ancestor key that caused the Q2/Q3 fetch.
- **Portfolio surface**: the EPM all-Projects render path and helpers. It is separate from the ENG/codebase view even though both live under the current dashboard shell.

## Design

### 0. Preparation before new behavior

The current EPM view is mostly tangled inside `jira_server.py` (~6800 lines) and `frontend/src/dashboard.jsx` (~15000 lines). Plan 1 fully extracts the existing EPM implementation into self-contained modules with no behavior change, so Plan 2's portfolio rework lands in a clean boundary. Plan 2 will not begin until Plan 1 ships and verifies.

#### Backend extraction — single `epm_view.py` blueprint

Move every EPM-only handler and helper out of `jira_server.py` into a new Flask Blueprint module `epm_view.py`. `jira_server.py` is left only with the blueprint registration plus any routes that are not exclusively EPM.

In scope for the move:

- All `/api/epm/*` route handlers currently defined in `jira_server.py`: config GET/PUT, scope, projects list, projects preview, single project, per-Project rollup, sub-goals, label autocomplete with prefix filter, and any other EPM-only routes.
- Helpers attached to those handlers: `normalize_epm_config`, `normalize_epm_issue_types`, `normalize_epm_issue_type_sets`, `build_epm_projects_payload`, `build_custom_project_payload`, `find_epm_project_or_404`, `build_epm_rollup_fields_list`, `shape_epm_rollup_issue_payload`, `validate_epm_tab_sprint`, `build_epm_rollup_hierarchy`.
- Module-level state used only by EPM: `EPM_ROLLUP_CACHE`, `EPM_ROLLUP_CACHE_TTL_SECONDS`, `EPM_ROLLUP_QUERY_MAX_RESULTS`.

Out of scope: `epm_home.py` and `epm_scope.py` keep their current responsibilities; `epm_view.py` imports them.

As part of this extraction, the per-Project rollup route body becomes a pure builder function inside `epm_view.py`. The route keeps only request parsing, calling the builder, JSON response creation, and headers. The builder is exported so Plan 2's aggregate path can reuse it for the fan-out fallback (§6).

No behavior changes in this stream. Existing `tests/test_epm_rollup_api.py`, `tests/test_epm_projects_api.py`, `tests/test_epm_config_api.py`, `tests/test_epm_scope_api.py`, `tests/test_epm_issues_endpoint.py`, and `tests/test_epm_scope_resolution.py` must pass unchanged. Add a new builder unit test that covers the extracted per-Project rollup builder directly.

#### Frontend extraction — modules under `frontend/src/epm/`

Lift all EPM-only state, fetch, controls, and render out of `frontend/src/dashboard.jsx` into `frontend/src/epm/`. After Plan 1, `dashboard.jsx` is the shell/router: it owns the view switch, shared sprint/search controls, layout, and the `<EpmView />` mount point under `selectedView === 'epm'`. It does not contain EPM state, EPM fetch, EPM controls, or EPM render.

Target layout:

- `frontend/src/epm/epmProjectUtils.mjs` — existing pure helpers (`buildRollupTree`, `filterEpmProjectsForTab`, `getEpmProjectIdentity`, `shouldUseEpmSprint`, `getEpmSprintHelper`, `hydrateEpmProjectDraft`, `getEpmProjectDisplayName`). No move; tests already exist.
- `frontend/src/epm/epmFetch.js` (new) — fetch wrappers for `/api/epm/config`, `/api/epm/scope`, `/api/epm/projects`, `/api/epm/projects/preview`, `/api/epm/projects/<id>`, `/api/epm/projects/<id>/rollup`, `/api/epm/sub-goals`, `/api/epm/labels`. Single fetch surface so Plan 2's aggregate call has an obvious home.
- `frontend/src/epm/useEpmRollup.js` (new) — custom hook owning EPM state (`epmTab`, `epmProjects`, `epmProjectsLoading`, `epmProjectsError`, `epmSelectedProjectId`, `epmRollupTree`, `epmRollupLoading`, `epmRollupRequestIdRef`, `epmProjectsPendingSelectionRef`, `epmProjectsRequestIdRef`) plus `refreshEpmProjects`, `refreshEpmRollup`, `refreshEpmView`, and the existing useEffects that drive them.
- `frontend/src/epm/EpmControls.jsx` (new) — `renderEpmTabs` + `renderEpmProjectPicker` as a focused component. Receives shared sprint state via props.
- `frontend/src/epm/EpmRollupTree.jsx` (new) — `renderEpmInitiativeNode`, `renderEpmEpicNode`, `renderEpmRollupIssue` and any closure-captured handlers, lifted out of `dashboard.jsx`.
- `frontend/src/epm/EpmView.jsx` (new) — top-level EPM view component. Mounts `EpmControls` and the EPM render branch (metadata-only card, empty card, focus-mode tree). Consumes `useEpmRollup`.
- `frontend/src/epm/EpmSettings.jsx` (new) — the EPM settings panel content currently inside the settings modal in `dashboard.jsx`. The settings modal shell stays where it is and imports `EpmSettings` for the EPM tab.

Closures that currently capture component-scoped values (search input, sprint state, request id refs) must be re-expressed as explicit props or hook return values. Any helper that depends on shared dashboard state stays in `dashboard.jsx` and is passed in.

No behavior changes. Focus-mode rendering must produce byte-equivalent UI before and after extraction.

#### Isolation tests

Plan 2 (not Plan 1) adds the source guards proving the new aggregate code does not regress isolation:

- EPM modules under `frontend/src/epm/` must not import ENG-only endpoints such as `/api/tasks-with-team-name`, `/api/backlog-epics`, planning, or scenario endpoints.
- ENG render and fetch branches in `dashboard.jsx` remain guarded by `selectedView === 'eng'`.
- EPM render and fetch branches remain guarded by `selectedView === 'epm'`.

Plan 1 must leave `dashboard.jsx` in a state where these guards are trivially testable: every reference to EPM state or EPM fetch in `dashboard.jsx` must be either inside a `selectedView === 'epm'` branch or inside the `<EpmView />` mount.

### 1. Picker behavior

The EPM Project picker gets a new default option:

```text
All projects
```

- `All projects` is the default when no Project is selected, and the option for `value=''` in the existing `<select>` becomes that label (replacing the current placeholder `Select project...`).
- Selecting any specific Project switches into focus mode and uses the existing `/api/epm/projects/<id>/rollup` endpoint exactly as today.
- The picker still narrows by tab. The "All" choice means "all Projects visible on this tab," not "all Projects in all tabs."

### 2. Aggregate endpoint

New endpoint: `GET /api/epm/projects/rollup/all`.

Query parameters (same contract as the per-Project endpoint):

- `tab`: one of `active`, `backlog`, `archived`. Required.
- `sprint`: numeric sprint id. Required when `tab=active`; ignored on other tabs.

The server resolves the visible Project set by reusing the existing `build_epm_projects_payload` (Home + custom) and filtering to the requested tab. Projects with no configured label are still included in the response shape but flagged metadata-only (see §4).

For each labeled Project, the server collects the configured Jira label. It then runs Q1 / Q2 / Q3 once per query type, using an explicit aggregate JQL helper instead of adapting the single-label `build_rollup_jqls(label)` API.

Q1 uses all visible Project labels as seed labels:

```text
labels in (L1, L2, ...) AND <existing tab/sprint scope>
```

Every label value is JQL-escaped with the same quoting rules as `_quote_jql_value`.

Q1 can return Initiatives, Epics, Stories, or other leaf issue types. Q1 issue membership is computed from the Project labels on that issue. If a Q1 issue carries two configured Project labels, it belongs to both Projects.

This is an intentional divergence from the per-Project rollup endpoint, whose Q1 is `issuetype=Epic AND labels = "<L>"`. The aggregate Q1 has no issuetype filter, so any labeled issue (e.g., a labeled Initiative or labeled Story) becomes a seed. As a consequence, the same Project rendered through focus mode vs. all-Projects mode may show different content. Tests must lock this divergence in (see §9, "Q1 divergence path") so future refactors do not silently realign the two surfaces.

Q2 fetches children of Q1 seed issues whose configured issue type is Initiative or Epic:

```text
("Epic Link" in (<q1 initiative/epic keys>) OR parent in (<q1 initiative/epic keys>)) AND <existing tab/sprint scope>
```

Seed Stories and other leaf issue types stop at Q1; the aggregate path does not fetch anything below them for v1.

Q2 issue membership is not derived only from the issue's own labels. It is the union of:

- memberships inherited from the Q1 parent key that caused the issue to be fetched
- memberships from any configured Project labels on the Q2 issue itself

Q3 fetches children of Q2 issues whose configured issue type is Epic:

```text
("Epic Link" in (<q2 epic keys>) OR parent in (<q2 epic keys>)) AND <existing tab/sprint scope>
```

Q3 issue membership is the union of:

- memberships inherited from the Q2 Epic key that caused the issue to be fetched
- memberships from any configured Project labels on the Q3 issue itself

Active sprint behavior matches the existing EPM rollup contract: when `tab=active`, the sprint clause is applied to Q1, Q2, and Q3 at the JQL level. This means an Initiative/Epic seed without the selected Sprint is not part of Active, and therefore its descendants are not fetched through that seed. Backlog and Archived ignore the sprint parameter.

After the three queries return, the server walks each shaped issue and assigns it to every Project in its final Project membership set. An issue matching N Project memberships is emitted N times in the response (once per Project), and its key is added to `duplicates`.

The per-Project tree (`initiatives` / `rootEpics` / `orphanStories`) is then constructed for each Project from its assigned issues using the existing three-bucket logic.

Existing helpers still apply where their contract already fits: `build_epm_rollup_fields_list`, `shape_epm_rollup_issue_payload`, `validate_epm_tab_sprint`, `normalize_epm_issue_type_sets`, and `build_epm_rollup_hierarchy`. The aggregate endpoint needs new helpers for multi-label Q1 construction and provenance/membership propagation.

### 3. Response shape

```json
{
  "projects": [
    {
      "project": { "id": "string", "displayName": "string" },
      "rollup": {
        "metadataOnly": false,
        "emptyRollup": false,
        "truncated": false,
        "truncatedQueries": [],
        "initiatives": {},
        "rootEpics": {},
        "orphanStories": []
      }
    }
  ],
  "duplicates": {
    "JIRA-1": ["proj-a", "proj-b"],
    "JIRA-2": ["proj-a", "proj-c", "proj-d"]
  },
  "truncated": false,
  "fallback": false
}
```

- `projects` is ordered the same way `build_epm_projects_payload` orders the visible Projects on this tab.
- Each `rollup` is shaped exactly like the existing per-Project rollup response body. Project metadata lives only under the sibling `project` field — there are no duplicate flat `id` / `displayName` fields on the entry. The frontend reuses `buildRollupTree` by passing `payload.projects[i].rollup`.
- `duplicates` is always an object. Empty duplicate sets are `{}`, not `[]`.
- `duplicates` is keyed by issue key, with each value being the ordered list of Project ids in the issue's final Project membership set (length always >= 2; single-Project matches are not in the map). Used by the frontend to render badges and the top-of-stack banner without having to walk every tree.
- Each Project entry's `rollup.emptyRollup` flag is `true` when the Project has a configured label but zero assigned issues across Q1 / Q2 / Q3 in the requested scope. Distinct from `rollup.metadataOnly`, which means no label is configured.
- `truncated: true` indicates the response carries a partial tree because at least one of Q1 / Q2 / Q3 hit the per-query cap.
- `fallback: true` indicates the server fell back to per-Project fan-out (see §6) and the response is therefore complete despite individual Q1 / Q2 / Q3 attempts having truncated.

`truncated` and `fallback` are independent flags. If the unioned JQL truncated and the fan-out fallback succeeded, the response carries `fallback: true, truncated: false`. If both the unioned JQL and one or more per-Project fan-out queries truncated, the response carries both `truncated: true, fallback: true`.

### 4. Metadata-only Projects in the aggregate

Projects with no configured label are included in `projects` with `rollup.metadataOnly: true` and an empty `rollup`. The frontend renders the existing metadata-only card inline in the stack (Project name, latest update, "Open Settings" CTA), preserving the same component used by focus mode.

This means `metadataOnly` is a per-Project flag in the aggregate response, distinct from any global flag. The shipped per-Project endpoint's top-level `metadataOnly: true` shape is unchanged.

### 5. Caching

- Cache key: `(base_jql, tuple of sorted Project labels for the visible set, tab, sprint_id, issue_type_config_signature)`. Stored in a new module-level dict `EPM_AGGREGATE_ROLLUP_CACHE` with the same `EPM_ROLLUP_CACHE_TTL_SECONDS = 300` TTL.
- The existing per-Project `EPM_ROLLUP_CACHE` is not touched and continues to serve focus-mode requests.
- A change to any Project's label invalidates the aggregate entry naturally because the label tuple is part of the key.
- A change to dashboard scope or configured Initiative/Epic/leaf issue type buckets invalidates naturally because `base_jql` and the issue-type config signature are part of the key.

### 6. Truncation fallback

When any of Q1 / Q2 / Q3 in the aggregate path returns truncated results (Jira `nextPageToken` pagination did not exhaust within `EPM_ROLLUP_QUERY_MAX_RESULTS = 2000`), the server transparently falls back to per-Project fan-out:

- Iterate visible labeled Projects, calling the extracted per-Project rollup builder for each, parallelized through a `ThreadPoolExecutor` with `max_workers=8` (matching the Home fan-out pattern in `epm_home.py`).
- Each per-Project call goes through the existing per-Project cache, so warm Projects return immediately.
- Merge the per-Project results into the same response shape, set `fallback: true`. If any individual per-Project rollup itself truncates, set `truncated: true` as well.
- The fallback path computes `duplicates` by walking the merged per-Project rollups and recording issue keys that appear under more than one Project.

The aggregate cache stores the fallback result the same way it stores a non-fallback result; subsequent identical queries within the TTL skip the fan-out.

### 7. Frontend state and fetch

New state added to `useEpmRollup.js` (the hook created in Plan 1):

- `epmRollupBoards`: `Array<{ project, tree }>` for all-projects mode. `tree` is the result of `buildRollupTree(projectEntry.rollup)`. `null` when not loaded.
- `epmDuplicates`: object keyed by issue key, matching the backend `duplicates` contract. The warning banner uses `Object.keys(epmDuplicates).length`; inline badges read the Project id list for the current issue key.
- `epmAggregateTruncated`: boolean.
- `epmAggregateFallback`: boolean. Carried in state for diagnostics; not rendered in the UI in v1.

The existing `epmRollupTree` state stays for focus mode.

`refreshEpmRollup` is renamed `refreshEpmBoards` and dispatches:

- If `epmSelectedProjectId === ''`: call `/api/epm/projects/rollup/all?tab=&sprint=`, populate `epmRollupBoards` / `epmDuplicates` / `epmAggregateTruncated` / `epmAggregateFallback`, clear `epmRollupTree`.
- If `epmSelectedProjectId !== ''`: existing focus-mode path; clear the all-projects state.

Existing gating is preserved: when `tab === 'active' && !selectedSprint`, no fetch fires and the "Select a sprint" empty-state stays.

The rollup-trigger `useEffect` (relocated to `useEpmRollup.js` in Plan 1) keeps the same dependency set; on every fire, `refreshEpmBoards` resets the unused branch's state (focus mode clears `epmRollupBoards` / `epmDuplicates` / aggregate flags; all-projects mode clears `epmRollupTree`) so stale state from the previous mode never leaks into render.

### 8. Render

The EPM render branch (relocated to `EpmView.jsx` in Plan 1, currently rendering the focus-mode tree) is wrapped in a conditional:

- When `epmSelectedProjectId !== ''`: existing focus-mode render, unchanged.
- When `epmSelectedProjectId === ''` and `epmRollupBoards` is populated: render the stacked all-projects view.

Stacked all-projects view structure:

1. Top banner, conditional on `Object.keys(epmDuplicates).length > 0`:

   ```text
   N issues appear in multiple projects - see badges below.
   ```

2. Top truncation banner, conditional on `epmAggregateTruncated`:

   ```text
   This rollup is truncated; narrow the label or Jira scope.
   ```

3. For each entry in `epmRollupBoards`:
   - `tree.kind === 'metadataOnly'`: render the existing metadata-only card (Project name, latest update line, "Open in Jira Home" link, "Open Settings" CTA).
   - `tree.kind === 'emptyRollup'` or an empty `tree`: render a one-line collapsed header showing the Project's display name and an expand chevron. Clicking expands to a "No issues in this scope" placeholder.
   - Otherwise: render the existing per-Project tree block (Initiatives → Epics → Stories, plus the Project-level group containing root epics and orphan stories), reusing the `EpmRollupTree.jsx` helpers (`renderEpmInitiativeNode`, `renderEpmEpicNode`, `renderEpmRollupIssue`).

4. Each issue row inside any per-Project tree checks whether `issue.key` is a key in the `epmDuplicates` object. When true, an inline `Also in: PROJ-B, PROJ-C` badge renders next to the existing row chrome. The badge text lists the display names of the other Projects (i.e., the Project ids in `epmDuplicates[issue.key]` minus the current Project's id, mapped to display names via the `epmProjects` state exposed by `useEpmRollup`).

The empty-state behavior is consistent across tabs: empty Project boards collapse on every tab. The "Select a sprint" empty-state on `Active` without a selected sprint short-circuits the entire all-projects render, same as it does today for focus mode.

### 9. Tests

Backend (`tests/test_epm_rollup_all_api.py`, new):

- Happy path: three labeled Projects, distinct labels, distinct issues per Project. Response groups correctly, no duplicates.
- Seed duplicate path: an issue carrying two Projects' labels appears in both Project rollups and its key is in `duplicates`.
- Descendant provenance path: a labeled Initiative fetches an unlabeled Epic and unlabeled Story; both descendants inherit the Project membership and appear under that Project.
- Cross-Project descendant duplicate path: a descendant reached from two Project seeds appears in both Project rollups and its key is in `duplicates`, even when the descendant has no Project label.
- Seed Story stop path: a labeled Story appears in its Project rollup, but no children are fetched below that Story.
- Active tab requires sprint: 400 when `tab=active` without `sprint`.
- Active tab applies sprint filter to Q1, Q2, and Q3 JQL.
- Backlog / Archived ignore sprint param.
- Metadata-only Projects appear with `rollup.metadataOnly: true` and an empty rollup.
- Exact response contract: each Project entry has exactly `{project, rollup}` (no flat `id` / `displayName` siblings), `project` has `{id, displayName}`, `rollup` has the same shape consumed by `buildRollupTree`, and empty `duplicates` is `{}`.
- Q1 divergence path: an Issue typed as Initiative or Story that carries a Project label is a Q1 seed in the aggregate response, even though the per-Project endpoint (which filters Q1 by `issuetype=Epic`) would not surface it as a Q1 hit. The test pins this difference so refactors don't silently realign the two surfaces.
- Aggregate cache hit on identical params; cache miss when a Project's label changes, `base_jql` changes, or issue-type config changes.
- Truncation triggers fallback: stub aggregate Q1/Q2/Q3 to exceed `EPM_ROLLUP_QUERY_MAX_RESULTS`, assert per-Project builder fan-out runs and `fallback: true` in response.
- Truncation in fan-out propagates `truncated: true`.
- Empty visible-Project set returns `{projects: [], duplicates: {}}` without 500.

Frontend pure-function (`tests/test_epm_project_utils.js`, extend):

- `groupAggregateRollupResponse(rawResponse)` (new helper): given a raw aggregate response, returns the same `{boards, duplicates}` shape the renderer reads. Tests cover: dedup-within-Project (existing `takeIssueOnce` semantics carried over), duplicate object passes through unchanged, metadata-only Projects pass through unchanged, empty Projects produce `emptyRollup` boards, and malformed `duplicates` normalizes to `{}`.

Source-guard (`tests/test_epm_view_source_guards.js`, extend):

- Renderer hits `/api/epm/projects/rollup/all` when no Project is selected.
- All-Projects render path exists (grep for the "appear in multiple projects" banner string).
- Inline duplicate badge rendering reads `epmDuplicates`.
- Existing focus-mode render path is still reached when a Project is selected.
- EPM aggregate fetch/render helpers live under `frontend/src/epm/`, with only minimal routing/wiring added to `dashboard.jsx`.
- EPM aggregate code does not reference ENG task/planning/scenario endpoints.
- ENG render and fetch branches remain guarded by `selectedView === 'eng'`.

### 10. Performance and load

Initial dashboard render with the EPM view active and Active tab selected fires one aggregate call instead of N per-Project calls. With 20 Projects on Active and a warm aggregate cache, this is one in-memory lookup; cold, it is three Jira `search/jql` round-trips total (Q1/Q2/Q3) versus 60 in a fan-out approach. The fallback path costs the same as the current per-Project path because it reuses the per-Project cache, so a tab-flip after a single per-Project warm-up only fans out to the cold Projects.

The aggregate cache lives in process memory; the same restart-clears-cache semantics as the existing per-Project cache.

## Implementation Streams

This design ships across **two implementation plans**, in order. The first plan must be merged and verified before the second begins. Splitting them keeps the refactor diff reviewable on its own and prevents new behavior from masking regressions in the extraction.

### Plan 1 — Refactor (no behavior change)

This plan extracts the entire current EPM view from `jira_server.py` and `frontend/src/dashboard.jsx` into self-contained modules. No new endpoints, no new UI, no new state — only relocation. Plan 1 must merge and verify before Plan 2 begins.

#### Stream A: Backend extraction into `epm_view.py`

- Create `epm_view.py` as a Flask Blueprint module.
- Move every EPM-only route handler and helper enumerated in §0's "Backend extraction" subsection from `jira_server.py` into `epm_view.py`.
- Convert the per-Project rollup route body into a pure builder function inside `epm_view.py`; the route keeps only request parsing, calling the builder, JSON response creation, and headers. Export the builder so Plan 2's fan-out fallback can call it directly.
- Register the blueprint in `jira_server.py` so URL paths and behavior are unchanged.
- Move EPM-only module state (`EPM_ROLLUP_CACHE`, `EPM_ROLLUP_CACHE_TTL_SECONDS`, `EPM_ROLLUP_QUERY_MAX_RESULTS`) into `epm_view.py`.
- `epm_home.py` and `epm_scope.py` are unchanged; `epm_view.py` imports them.
- Verification:
  - `.venv/bin/python -m unittest tests.test_epm_rollup_api tests.test_epm_projects_api tests.test_epm_config_api tests.test_epm_scope_api tests.test_epm_issues_endpoint tests.test_epm_scope_resolution` — all green, no test changes required.
  - New direct unit test for the extracted per-Project rollup builder, verifying it can be invoked without going through Flask.
  - Full backend suite: `.venv/bin/python -m unittest discover -s tests` — all green.

#### Stream C-prep: Frontend extraction into `frontend/src/epm/`

- Create the new modules listed in §0's "Frontend extraction" subsection: `epmFetch.js`, `useEpmRollup.js`, `EpmControls.jsx`, `EpmRollupTree.jsx`, `EpmView.jsx`, `EpmSettings.jsx`.
- Move EPM state, fetch, useEffects, controls, render helpers, and the EPM render branch out of `dashboard.jsx` into the appropriate new modules.
- Move the EPM settings panel content into `EpmSettings.jsx`; the settings modal shell stays in its current location and imports `EpmSettings`.
- `dashboard.jsx` mounts `<EpmView />` under `selectedView === 'epm'`. After this stream, `dashboard.jsx` contains no EPM state, no EPM fetch, no EPM rendering helpers — only the mount point and any shared shell pieces (view switch, sprint/search controls passed as props).
- Re-express any closure capture as explicit props or hook return values; do not leak `dashboard.jsx`-scoped values into EPM modules through global state.
- Rebuild the bundle (`npm run build`) and check `frontend/dist/dashboard.js` is updated; do not hand-edit it.
- Verification:
  - `node --test tests/test_epm_project_utils.js` — green, no test changes required.
  - Existing EPM source guards (`tests/test_epm_view_source_guards.js`, `tests/test_epm_settings_source_guards.js`, `tests/test_epm_shell_source_guards.js`) — green. If a guard breaks because it grepped `dashboard.jsx` for a string that now lives under `frontend/src/epm/`, update the guard to grep the new location; do not silently widen its scope.
  - **Manually verify focus mode in EPM Active, Backlog, and Archived after extraction.** Confirm the rendered tree, metadata-only card, empty-rollup card, truncation banner, project picker, tab switch, and EPM settings panel are visually and behaviorally identical to pre-refactor.
  - Manually verify ENG view across Catch Up, Planning, and Scenario modes — no EPM extraction should touch ENG render paths, and the existing sticky/header behavior must remain unchanged (per AGENTS.md repo-specific constraints).

### Plan 2 — EPM portfolio rework (new behavior)

#### Stream B: Aggregate endpoint and provenance

- Add `GET /api/epm/projects/rollup/all`.
- Add a deliberate multi-label Q1 helper (label-only, no issuetype filter — see §2 divergence note).
- Track Project membership from Q1 labels and propagate memberships through Q2/Q3 descendants per §2.
- Stop traversal below seed Stories and other leaf issue types.
- Compute `duplicates` from final membership sets, always returning an object.
- Add aggregate cache key parts: `base_jql`, sorted label tuple, tab, sprint, and issue-type config signature.
- Implement the per-Project fan-out fallback path described in §6, reusing the Stream A builder.
- Verification: new `tests/test_epm_rollup_all_api.py` plus existing rollup API tests, all green.

#### Stream C-feature: All-Projects UI

- Extend `useEpmRollup.js` (created in Plan 1) with all-Projects mode state: `epmRollupBoards`, `epmDuplicates`, `epmAggregateTruncated`, `epmAggregateFallback`. Add the dispatch logic in the renamed `refreshEpmBoards`.
- Extend `epmFetch.js` with the aggregate `/api/epm/projects/rollup/all` call.
- Extend `EpmView.jsx` with the all-Projects render branch (stacked Project boards, top duplicate banner, top truncation banner, collapsed empty boards, metadata-only cards inline, inline `Also in: ...` badges on duplicate issue rows). Reuse `EpmRollupTree.jsx` for per-Project tree rendering.
- Picker default option `All projects` lives in `EpmControls.jsx`.
- Add `groupAggregateRollupResponse` to `epmProjectUtils.mjs` (or a new sibling pure-function module) per §9.
- Verification: `node --test tests/test_epm_project_utils.js` (extended) and EPM source guards (extended).

#### Stream D: Isolation, performance, and regression guards

- Add source guards proving EPM aggregate code does not touch ENG task/planning/scenario fetch paths.
- Preserve `selectedView === 'eng'` guards around ENG-only render/fetch work.
- Preserve `selectedView === 'epm'` guards around EPM-only render/fetch work.
- Run focused backend and frontend tests, then the full suite before push.
- For UI changes, verify visually in EPM Active, Backlog, Archived, focus mode, and all-Projects mode.

## Open Questions

None. This revision pins the Project label seed semantics (with the deliberate Q1 divergence from focus mode), descendant membership propagation, response shape (single canonical Project metadata location), truncation criterion, cache key, the two-plan implementation split (refactor first, then portfolio rework), and the full EPM extraction targets for Plan 1 (`epm_view.py` blueprint on the backend, `frontend/src/epm/` module set on the frontend).
