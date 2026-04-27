# EPM Multi-Project Rollup

**Date:** 2026-04-27
**Status:** Approved (design)

## Problem

The shipped EPM view (per `docs/superpowers/plans/2026-04-21-epm-project-rollup.md`) requires the user to pick exactly one Project at a time. To compare work across the portfolio they must serially select each Project, wait for its rollup, and remember what they saw. EPMs need to see every accessible Project's Jira work on a tab without that drill-down.

## Goal

Render every Project visible on the current EPM tab as a stacked board on one screen, while preserving the existing single-Project focus mode as an optional narrow-down. Apply to all three lifecycle tabs (`Active`, `Backlog`, `Archived`).

## Non-Goals

- No change to the per-Project rollup endpoint contract or its 5-minute cache.
- No change to lifecycle bucketing (`active` / `backlog` / `archived` / `all`).
- No new cross-Project ordering or sorting controls; Projects stack in the order returned by `build_epm_projects_payload`.
- No change to the ENG view.
- No change to the EPM Project picker for custom Projects, settings UX, or label autocomplete.

## Terminology

- **All-Projects mode**: the default EPM view state where every Project visible on the current tab is rendered as a stacked board.
- **Focus mode**: the existing single-Project render path, reached by selecting a specific Project in the picker.
- **Project label**: the single exact Jira label configured for one Project (already specified in the shipped plan; no wildcards, no per-Project fallback label). The "fallback" used elsewhere in this spec (§6) refers to a server-side fan-out when the unioned JQL truncates, not to label resolution.
- **Visible Projects**: the result of `filterEpmProjectsForTab(projects, tab)` for the current tab — Home Projects whose `tabBucket` matches the tab plus custom Projects with `tabBucket: 'all'`.

## Design

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

For each labeled Project, the server collects the configured Jira label. It then runs the existing Q1 / Q2 / Q3 JQL **once** per query type, with all labels OR'd into a single clause:

```text
labels in (L1, L2, ...) AND <existing tab/sprint scope>
```

Q1 / Q2 / Q3 query semantics, sprint filter placement, three-bucket placement rules, and field shaping all reuse the existing helpers from the shipped plan: `build_rollup_jqls`, `build_epm_rollup_fields_list`, `shape_epm_rollup_issue_payload`, `validate_epm_tab_sprint`. No new helpers for those.

After the three queries return, the server walks each issue once and assigns it to every Project whose label appears in the issue's `labels` field. An issue matching N labels is emitted N times in the response (once per Project), and its key is added to a `duplicates` set.

The per-Project tree (`initiatives` / `rootEpics` / `orphanStories`) is then constructed for each Project from its assigned issues using the existing three-bucket logic.

### 3. Response shape

```json
{
  "projects": [
    {
      "id": "string",
      "displayName": "string",
      "metadataOnly": false,
      "emptyRollup": false,
      "tree": {
        "initiatives": [...],
        "rootEpics": [...],
        "orphanStories": [...]
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
- Each `tree` is shaped exactly like the existing per-Project rollup response; the frontend reuses `buildRollupTree` verbatim by passing `payload.projects[i].tree` plus the per-Project `metadataOnly` / `emptyRollup` flags.
- `duplicates` is an object keyed by issue key, with each value being the ordered list of Project ids whose label the issue matched (length always >= 2; single-Project matches are not in the map). Used by the frontend to render badges and the top-of-stack banner without having to walk every tree.
- Each Project entry's `emptyRollup` flag is `true` when the Project has a configured label but zero matching issues across Q1 / Q2 / Q3 in the requested scope. Distinct from `metadataOnly`, which means no label is configured.
- `truncated: true` indicates the response carries a partial tree because at least one of Q1 / Q2 / Q3 hit the per-query cap.
- `fallback: true` indicates the server fell back to per-Project fan-out (see §6) and the response is therefore complete despite individual Q1 / Q2 / Q3 attempts having truncated.

`truncated` and `fallback` are independent flags. If the unioned JQL truncated and the fan-out fallback succeeded, the response carries `fallback: true, truncated: false`. If both the unioned JQL and one or more per-Project fan-out queries truncated, the response carries both `truncated: true, fallback: true`.

### 4. Metadata-only Projects in the aggregate

Projects with no configured label are included in `projects` with `metadataOnly: true` and an empty `tree`. The frontend renders the existing metadata-only card inline in the stack (Project name, latest update, "Open Settings" CTA), preserving the same component used by focus mode.

This means `metadataOnly` is a per-Project flag in the aggregate response, distinct from any global flag. The shipped per-Project endpoint's top-level `metadataOnly: true` shape is unchanged.

### 5. Caching

- Cache key: `(tuple of sorted Project labels for the visible set, tab, sprint_id)`. Stored in a new module-level dict `EPM_AGGREGATE_ROLLUP_CACHE` with the same `EPM_ROLLUP_CACHE_TTL_SECONDS = 300` TTL.
- The existing per-Project `EPM_ROLLUP_CACHE` is not touched and continues to serve focus-mode requests.
- A change to any Project's label invalidates the aggregate entry naturally because the label tuple is part of the key.

### 6. Truncation fallback

When any of Q1 / Q2 / Q3 in the aggregate path returns `isLast: false` after `EPM_ROLLUP_QUERY_MAX_RESULTS = 2000` rows, the server transparently falls back to per-Project fan-out:

- Iterate visible labeled Projects, calling the existing per-Project rollup builder for each, parallelized through a `ThreadPoolExecutor` with `max_workers=8` (matching the Home fan-out pattern in `epm_home.py`).
- Each per-Project call goes through the existing per-Project cache, so warm Projects return immediately.
- Merge the per-Project results into the same response shape, set `fallback: true`. If any individual per-Project rollup itself truncates, set `truncated: true` as well.
- The fallback path still computes the cross-Project `duplicates` set by walking the merged issue list.

The aggregate cache stores the fallback result the same way it stores a non-fallback result; subsequent identical queries within the TTL skip the fan-out.

### 7. Frontend state and fetch

New state in `dashboard.jsx`:

- `epmRollupBoards`: `Array<{ project, tree, metadataOnly, emptyRollup }>` for all-projects mode. `null` when not loaded.
- `epmDuplicates`: `Set<string>` of issue keys that the warning banner and inline badges read.
- `epmAggregateTruncated`: boolean.
- `epmAggregateFallback`: boolean. Carried in state for diagnostics; not rendered in the UI in v1.

The existing `epmRollupTree` state stays for focus mode.

`refreshEpmRollup` is renamed `refreshEpmBoards` and dispatches:

- If `epmSelectedProjectId === ''`: call `/api/epm/projects/rollup/all?tab=&sprint=`, populate `epmRollupBoards` / `epmDuplicates` / `epmAggregateTruncated` / `epmAggregateFallback`, clear `epmRollupTree`.
- If `epmSelectedProjectId !== ''`: existing focus-mode path; clear the all-projects state.

Existing gating is preserved: when `tab === 'active' && !selectedSprint`, no fetch fires and the "Select a sprint" empty-state stays.

The `useEffect` at `dashboard.jsx:8762-8764` keeps the same dependency set; on every fire, `refreshEpmBoards` resets the unused branch's state (focus mode clears `epmRollupBoards` / `epmDuplicates` / aggregate flags; all-projects mode clears `epmRollupTree`) so stale state from the previous mode never leaks into render.

### 8. Render

The render branch at `dashboard.jsx:14948` (currently the focus-mode tree) is wrapped in a conditional:

- When `epmSelectedProjectId !== ''`: existing focus-mode render, unchanged.
- When `epmSelectedProjectId === ''` and `epmRollupBoards` is populated: render the stacked all-projects view.

Stacked all-projects view structure:

1. Top banner, conditional on `epmDuplicates.size > 0`:

   ```text
   N issues appear in multiple projects — see badges below.
   ```

2. Top truncation banner, conditional on `epmAggregateTruncated`:

   ```text
   This rollup is truncated; narrow the label or Jira scope.
   ```

3. For each entry in `epmRollupBoards`:
   - `metadataOnly: true`: render the existing metadata-only card (Project name, latest update line, "Open in Jira Home" link, "Open Settings" CTA).
   - `emptyRollup: true` or empty `tree`: render a one-line collapsed header showing the Project's display name and an expand chevron. Clicking expands to a "No issues in this scope" placeholder.
   - Otherwise: render the existing per-Project tree block (Initiatives → Epics → Stories, plus the Project-level group containing root epics and orphan stories), reusing `renderEpmInitiativeNode`, `renderEpmEpicNode`, `renderEpmRollupIssue`.

4. Each issue row inside any per-Project tree checks whether `issue.key` is a key in the `epmDuplicates` map. When true, an inline `Also in: PROJ-B, PROJ-C` badge renders next to the existing row chrome. The badge text lists the display names of the other Projects (i.e., the Project ids in `epmDuplicates[issue.key]` minus the current Project's id, mapped to display names via the existing `epmProjects` state).

The empty-state behavior is consistent across tabs: empty Project boards collapse on every tab. The "Select a sprint" empty-state on `Active` without a selected sprint short-circuits the entire all-projects render, same as it does today for focus mode.

### 9. Tests

Backend (`tests/test_epm_rollup_all_api.py`, new):

- Happy path: three labeled Projects, distinct labels, distinct issues per Project. Response groups correctly, no duplicates.
- Duplicate path: an issue carrying two Projects' labels appears in both Project trees and its key is in `duplicates`.
- Active tab requires sprint: 400 when `tab=active` without `sprint`.
- Active tab applies sprint filter to the unioned JQL.
- Backlog / Archived ignore sprint param.
- Metadata-only Projects appear with `metadataOnly: true` and empty tree.
- Aggregate cache hit on identical params; cache miss when a Project's label changes.
- Truncation triggers fallback: stub the unioned JQL to return `isLast: false`, assert per-Project fan-out runs and `fallback: true` in response.
- Truncation in fan-out propagates `truncated: true`.
- Empty visible-Project set returns `{projects: [], duplicates: []}` without 500.

Frontend pure-function (`tests/test_epm_project_utils.js`, extend):

- `groupAggregateRollupResponse(rawResponse)` (new helper): given a raw aggregate response, returns the same `{boards, duplicates}` shape the renderer reads. Tests cover: dedup-within-Project (existing `takeIssueOnce` semantics carried over), dupe-detection-across-Projects produces correct `duplicates` set, metadata-only Projects pass through unchanged, empty Projects produce `emptyRollup: true` boards.

Source-guard (`tests/test_epm_view_source_guards.js`, extend):

- Renderer hits `/api/epm/projects/rollup/all` when no Project is selected.
- All-projects render path exists (grep for the "appear in multiple projects" banner string).
- Inline duplicate badge rendering reads `epmDuplicates`.
- Existing focus-mode render path is still reached when a Project is selected.

### 10. Performance and load

Initial dashboard render with the EPM view active and Active tab selected fires one aggregate call instead of N per-Project calls. With 20 Projects on Active and a warm aggregate cache, this is one in-memory lookup; cold, it is three Jira `search/jql` round-trips total (Q1/Q2/Q3) versus 60 in a fan-out approach. The fallback path costs the same as the current per-Project path because it reuses the per-Project cache, so a tab-flip after a single per-Project warm-up only fans out to the cold Projects.

The aggregate cache lives in process memory; the same restart-clears-cache semantics as the existing per-Project cache.

## Open Questions

None. All design choices are pinned.
